// lib/presence.ts
// WhatsApp-style realtime presence on top of Supabase Presence.
//
// Kya badla (v2):
//  - App background jaate hi untrack + last_seen DONO ek saath (parallel) -> turant offline
//  - Viewer ko "leave" event milte hi last-seen LOCALLY stamp ho jata hai (DB ka wait nahi)
//  - Resume par socket ka liveness probe (track + timeout); dead ho to channel rebuild
//  - Channel error/close par backoff ke saath auto-reconnect, network wapas aate hi reconnect
//  - iOS 'inactive' (notification shade, app switcher) ko offline NAHI maante, sirf 'background'
//  - "Active now" ab sirf presence se aata hai, last_seen < 1 min se kabhi nahi
//
// Public API pehle jaisi hai: startPresence, stopPresence, isUserOnline, subscribePresence
// Naya: getLastSeenLocal, lastSeenLabel

import { AppState, AppStateStatus } from 'react-native';
import { supabase } from './supabase';
import { isOnline as isNetworkOnline, subscribeNetwork } from './network';

type Listener = (onlineIds: Set<string>) => void;

// Sirf un cases ke liye jahan goInactive kabhi nahi chalta (force-kill / net drop) aur
// jo viewer us waqt presence me nahi tha. Live viewers ko to presence se instant milta hai.
const HEARTBEAT_MS = 60000;
const PROBE_TIMEOUT_MS = 4000;
const RECONNECT_BASE_MS = 3000;
const RECONNECT_MAX_MS = 20000;

let channel: ReturnType<typeof supabase.channel> | null = null;
let currentUserId: string | null = null;
let subscribed = false;
let foreground = false;
let onlineIds = new Set<string>();
// userId -> ISO time jab humne unhe offline jaate dekha (instant "last seen")
const lastSeenLocal = new Map<string, string>();
let heartbeat: ReturnType<typeof setInterval> | null = null;
let reconnectTimer: ReturnType<typeof setTimeout> | null = null;
let reconnectAttempt = 0;
let appStateSub: { remove: () => void } | null = null;
let netUnsub: (() => void) | null = null;
const listeners = new Set<Listener>();

function channelState(ch: unknown): string {
  return String((ch as any)?.state ?? '');
}

function withTimeout<T>(p: Promise<T>, ms: number): Promise<T | 'timed out'> {
  return new Promise((resolve) => {
    const t = setTimeout(() => resolve('timed out'), ms);
    p.then(
      (v) => {
        clearTimeout(t);
        resolve(v);
      },
      () => {
        clearTimeout(t);
        resolve('timed out');
      }
    );
  });
}

function emit() {
  const snap = new Set(onlineIds);
  listeners.forEach((l) => {
    try {
      l(snap);
    } catch (err) {
      console.warn('[presence] listener error:', err);
    }
  });
}

function syncFromState() {
  if (!channel) return;
  try {
    const next = new Set(Object.keys(channel.presenceState()));
    const nowIso = new Date().toISOString();
    let changed = false;

    // jo pehle online the aur ab nahi -> last seen = abhi
    onlineIds.forEach((id) => {
      if (!next.has(id)) {
        lastSeenLocal.set(id, nowIso);
        changed = true;
      }
    });
    // naye online -> purana local last-seen hata do
    next.forEach((id) => {
      if (!onlineIds.has(id)) changed = true;
      lastSeenLocal.delete(id);
    });

    onlineIds = next;
    if (changed) emit();
  } catch (err) {
    console.warn('[presence] sync error:', err);
  }
}

async function touchLastSeen() {
  if (!currentUserId || !isNetworkOnline()) return;
  try {
    await supabase
      .from('profiles')
      .update({ last_seen: new Date().toISOString() })
      .eq('id', currentUserId);
  } catch (err) {
    console.warn('[presence] last_seen update failed:', err);
  }
}

function startHeartbeat() {
  if (heartbeat) return;
  heartbeat = setInterval(touchLastSeen, HEARTBEAT_MS);
}

function stopHeartbeat() {
  if (heartbeat) {
    clearInterval(heartbeat);
    heartbeat = null;
  }
}

// track() bhejo; true = server ne ack kiya (socket zinda hai)
async function announce(): Promise<boolean> {
  const ch = channel;
  if (!ch || !subscribed) return false;
  const res = await withTimeout(
    ch.track({ online_at: new Date().toISOString() }),
    PROBE_TIMEOUT_MS
  );
  if (ch !== channel) return false; // beech me channel badal gaya
  if (res !== 'ok') return false;
  touchLastSeen();
  startHeartbeat();
  return true;
}

function scheduleReconnect() {
  if (reconnectTimer || !currentUserId) return;
  const delay = Math.min(
    RECONNECT_BASE_MS * 2 ** reconnectAttempt,
    RECONNECT_MAX_MS
  );
  reconnectAttempt += 1;
  reconnectTimer = setTimeout(() => {
    reconnectTimer = null;
    if (!currentUserId || !foreground) return; // background me reconnect nahi (battery)
    if (channel && subscribed && channelState(channel) === 'joined') return;
    if (!isNetworkOnline()) {
      scheduleReconnect(); // net aane tak wait
      return;
    }
    connect();
  }, delay);
}

function connect() {
  if (!currentUserId) return;

  if (reconnectTimer) {
    clearTimeout(reconnectTimer);
    reconnectTimer = null;
  }

  // purana channel hatao. onlineIds ko JAAN-BOOJH ke clear nahi karte, taaki naye
  // channel ka pehla sync sirf asli leave/join ka diff nikaale (sab ko "left" na maane).
  if (channel) {
    const old = channel;
    channel = null;
    subscribed = false;
    try {
      supabase.removeChannel(old);
    } catch {}
  }

  const ch = supabase.channel('online-users', {
    config: { presence: { key: currentUserId } },
  });
  channel = ch;

  ch.on('presence', { event: 'sync' }, syncFromState)
    .on('presence', { event: 'join' }, syncFromState)
    .on('presence', { event: 'leave' }, syncFromState)
    .subscribe((status) => {
      if (channel !== ch) return; // purane channel ka stale callback
      if (status === 'SUBSCRIBED') {
        subscribed = true;
        reconnectAttempt = 0;
        if (foreground) {
          announce().then((ok) => {
            if (!ok && foreground && channel === ch) scheduleReconnect();
          });
        }
      } else if (
        status === 'CHANNEL_ERROR' ||
        status === 'TIMED_OUT' ||
        status === 'CLOSED'
      ) {
        subscribed = false;
        if (foreground) scheduleReconnect();
      }
    });
}

// App foreground me aaya (ya net wapas aaya): jaldi se check karo ki hum sach me online hain
async function goActive() {
  foreground = true;
  if (!currentUserId) return;

  if (!channel) {
    connect();
    return;
  }
  const st = channelState(channel);
  if (st === 'joining') return; // SUBSCRIBED handler announce kar dega
  if (!subscribed || st !== 'joined') {
    connect();
    return;
  }

  // Socket background me chupchap mar chuka ho sakta hai -> probe
  const ok = await announce();
  if (!ok && foreground) connect();
}

// App background gaya: turant offline + last_seen, dono PARALLEL (pehle sequential tha)
async function goInactive() {
  foreground = false;
  stopHeartbeat();
  if (reconnectTimer) {
    clearTimeout(reconnectTimer);
    reconnectTimer = null;
  }
  const ch = channel;
  await Promise.allSettled([
    ch && subscribed ? ch.untrack() : Promise.resolve(),
    touchLastSeen(),
  ]);
}

function onAppStateChange(state: AppStateStatus) {
  if (state === 'active') goActive();
  else if (state === 'background') goInactive();
  // 'inactive' (iOS control center / app switcher) -> online hi rehne do, WhatsApp jaisa
}

export function startPresence(userId: string) {
  if (currentUserId === userId && channel) return;
  stopPresence();

  currentUserId = userId;
  foreground = AppState.currentState !== 'background';
  reconnectAttempt = 0;

  connect();

  appStateSub = AppState.addEventListener('change', onAppStateChange);
  netUnsub = subscribeNetwork((isUp: boolean) => {
    if (isUp && foreground) goActive();
  });
}

export function stopPresence() {
  stopHeartbeat();
  if (reconnectTimer) {
    clearTimeout(reconnectTimer);
    reconnectTimer = null;
  }
  appStateSub?.remove();
  appStateSub = null;
  netUnsub?.();
  netUnsub = null;
  if (channel) {
    const old = channel;
    channel = null;
    try {
      old.untrack();
    } catch {}
    try {
      supabase.removeChannel(old);
    } catch {}
  }
  currentUserId = null;
  subscribed = false;
  foreground = false;
  onlineIds = new Set();
  lastSeenLocal.clear();
  emit();
}

export function isUserOnline(userId: string | null | undefined): boolean {
  if (!userId) return false;
  return onlineIds.has(userId);
}

export function subscribePresence(cb: Listener): () => void {
  listeners.add(cb);
  // Naye subscriber ko current state turant do (late-mounting screens ke liye)
  try {
    cb(new Set(onlineIds));
  } catch (err) {
    console.warn('[presence] listener error:', err);
  }
  return () => {
    listeners.delete(cb);
  };
}

// ============================================================
// Last seen helpers (chat screen, chats list, profile — sab yahi use karein)
// ============================================================

/** Is session me humne user ko jab offline jaate dekha (ISO), warna null */
export function getLastSeenLocal(userId: string | null | undefined): string | null {
  if (!userId) return null;
  return lastSeenLocal.get(userId) ?? null;
}

function newestIso(a?: string | null, b?: string | null): string | null {
  const ta = a ? new Date(a).getTime() : NaN;
  const tb = b ? new Date(b).getTime() : NaN;
  if (isNaN(ta) && isNaN(tb)) return null;
  if (isNaN(ta)) return b ?? null;
  if (isNaN(tb)) return a ?? null;
  return ta >= tb ? (a as string) : (b as string);
}

/**
 * Offline user ke liye label. Local (instant) aur DB last_seen me se jo naya ho wo use hota hai.
 * NOTE: ye kabhi "Active now" nahi deta — wo sirf isUserOnline() true hone par dikhana hai.
 */
export function lastSeenLabel(
  userId: string | null | undefined,
  dbLastSeen: string | null | undefined
): string {
  const iso = newestIso(getLastSeenLocal(userId), dbLastSeen);
  if (!iso) return 'Offline';
  const t = new Date(iso).getTime();
  if (isNaN(t)) return 'Offline';
  const min = Math.floor(Math.max(0, Date.now() - t) / 60000);
  if (min < 1) return 'Last seen just now';
  if (min < 60) return `Last seen ${min}m ago`;
  const hr = Math.floor(min / 60);
  if (hr < 24) return `Last seen ${hr}h ago`;
  return `Last seen ${Math.floor(hr / 24)}d ago`;
}
