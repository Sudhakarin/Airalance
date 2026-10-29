// lib/presence.ts
// Realtime online/offline status using Supabase Presence + last_seen heartbeat
// - App foreground  -> user "online" (track)
// - App background / closed -> user "offline" (untrack / socket drop)
// - profiles.last_seen is still updated for the "Last seen X ago" label

import { AppState, AppStateStatus } from 'react-native';
import { supabase } from './supabase';

type Listener = (onlineIds: Set<string>) => void;

const HEARTBEAT_MS = 30000;

let channel: ReturnType<typeof supabase.channel> | null = null;
let currentUserId: string | null = null;
let subscribed = false;
let onlineIds = new Set<string>();
let heartbeat: ReturnType<typeof setInterval> | null = null;
let appStateSub: { remove: () => void } | null = null;
const listeners = new Set<Listener>();

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
    onlineIds = new Set(Object.keys(channel.presenceState()));
    emit();
  } catch (err) {
    console.warn('[presence] sync error:', err);
  }
}

async function touchLastSeen() {
  if (!currentUserId) return;
  try {
    await supabase
      .from('profiles')
      .update({ last_seen: new Date().toISOString() })
      .eq('id', currentUserId);
  } catch (err) {
    console.warn('[presence] last_seen update failed:', err);
  }
}

async function goActive() {
  if (!channel || !subscribed) return;
  try {
    await channel.track({ online_at: new Date().toISOString() });
  } catch (err) {
    console.warn('[presence] track failed:', err);
  }
  touchLastSeen();
  if (!heartbeat) heartbeat = setInterval(touchLastSeen, HEARTBEAT_MS);
}

function goInactive() {
  if (heartbeat) {
    clearInterval(heartbeat);
    heartbeat = null;
  }
  touchLastSeen();
  try {
    channel?.untrack();
  } catch (err) {
    console.warn('[presence] untrack failed:', err);
  }
}

function onAppStateChange(state: AppStateStatus) {
  if (state === 'active') goActive();
  else goInactive();
}

export function startPresence(userId: string) {
  if (currentUserId === userId && channel) return;
  stopPresence();

  currentUserId = userId;
  channel = supabase.channel('online-users', {
    config: { presence: { key: userId } },
  });

  channel
    .on('presence', { event: 'sync' }, syncFromState)
    .on('presence', { event: 'join' }, syncFromState)
    .on('presence', { event: 'leave' }, syncFromState)
    .subscribe((status) => {
      if (status === 'SUBSCRIBED') {
        subscribed = true;
        if (AppState.currentState === 'active') goActive();
      }
    });

  appStateSub = AppState.addEventListener('change', onAppStateChange);
}

export function stopPresence() {
  if (heartbeat) {
    clearInterval(heartbeat);
    heartbeat = null;
  }
  appStateSub?.remove();
  appStateSub = null;
  if (channel) {
    try {
      channel.untrack();
    } catch {}
    supabase.removeChannel(channel);
  }
  channel = null;
  currentUserId = null;
  subscribed = false;
  onlineIds = new Set();
  emit();
}

export function isUserOnline(userId: string | null | undefined): boolean {
  if (!userId) return false;
  return onlineIds.has(userId);
}

export function subscribePresence(cb: Listener): () => void {
  listeners.add(cb);
  return () => {
    listeners.delete(cb);
  };
}
