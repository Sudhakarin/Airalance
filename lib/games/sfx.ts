// lib/games/sfx.ts
// Sound effects for the games. Files live in assets/games-sfx (generated WAVs).
// Uses expo-av. Rapid sounds (step / hit / wall / tap) get a small pool so they can overlap.

import { Audio } from 'expo-av';
import * as Haptics from 'expo-haptics';

const FILES = {
  tap: require('../../assets/games-sfx/tap.wav'),
  select: require('../../assets/games-sfx/select.wav'),
  dice: require('../../assets/games-sfx/dice.wav'),
  land: require('../../assets/games-sfx/land.wav'),
  step: require('../../assets/games-sfx/step.wav'),
  out: require('../../assets/games-sfx/out.wav'),
  capture: require('../../assets/games-sfx/capture.wav'),
  home: require('../../assets/games-sfx/home.wav'),
  win: require('../../assets/games-sfx/win.wav'),
  lose: require('../../assets/games-sfx/lose.wav'),
  error: require('../../assets/games-sfx/error.wav'),
  whoosh: require('../../assets/games-sfx/whoosh.wav'),
  hint: require('../../assets/games-sfx/hint.wav'),
  strike: require('../../assets/games-sfx/strike.wav'),
  hit: require('../../assets/games-sfx/hit.wav'),
  wall: require('../../assets/games-sfx/wall.wav'),
  pocket: require('../../assets/games-sfx/pocket.wav'),
  queen: require('../../assets/games-sfx/queen.wav'),
  place: require('../../assets/games-sfx/place.wav'),
  pick: require('../../assets/games-sfx/pick.wav'),
  clear: require('../../assets/games-sfx/clear.wav'),
  clear2: require('../../assets/games-sfx/clear2.wav'),
  combo: require('../../assets/games-sfx/combo.wav'),
  drop: require('../../assets/games-sfx/drop.wav'),
  c4land: require('../../assets/games-sfx/c4land.wav'),
} as const;

export type SfxName = keyof typeof FILES;

const POOL_SIZE: Partial<Record<SfxName, number>> = {
  step: 3,
  hit: 4,
  wall: 3,
  tap: 2,
  whoosh: 3,
  pocket: 2,
  place: 2,
  pick: 2,
  c4land: 2,
  combo: 2,
};

const pool: Partial<Record<SfxName, Audio.Sound[]>> = {};
const cursor: Partial<Record<SfxName, number>> = {};
let loading: Promise<void> | null = null;
let muted = false;
let lastPlayed: Partial<Record<SfxName, number>> = {};

export function isMuted() {
  return muted;
}
export function setMuted(v: boolean) {
  muted = v;
}

/** Call once when a game screen opens. Safe to call many times. */
export function initSfx(): Promise<void> {
  if (loading) return loading;
  loading = (async () => {
    try {
      await Audio.setAudioModeAsync({
        playsInSilentModeIOS: true,
        allowsRecordingIOS: false,
        staysActiveInBackground: false,
      });
    } catch {}
    const names = Object.keys(FILES) as SfxName[];
    await Promise.all(
      names.map(async (n) => {
        const count = POOL_SIZE[n] ?? 1;
        const list: Audio.Sound[] = [];
        for (let i = 0; i < count; i++) {
          try {
            const { sound } = await Audio.Sound.createAsync(FILES[n], {
              shouldPlay: false,
              volume: 1,
            });
            list.push(sound);
          } catch {}
        }
        pool[n] = list;
      })
    );
  })();
  return loading;
}

export function play(name: SfxName, volume = 1) {
  if (muted) return;
  const list = pool[name];
  if (!list || list.length === 0) return;
  // tiny rate-limit so collision storms do not stack up
  const now = Date.now();
  const minGap = name === 'hit' ? 30 : name === 'wall' ? 45 : 0;
  if (minGap && now - (lastPlayed[name] ?? 0) < minGap) return;
  lastPlayed[name] = now;
  const i = ((cursor[name] ?? -1) + 1) % list.length;
  cursor[name] = i;
  const s = list[i];
  s.setStatusAsync({
    positionMillis: 0,
    shouldPlay: true,
    volume: Math.max(0, Math.min(1, volume)),
  }).catch(() => {});
}

/** Small vibration feedback. Never throws. */
export function haptic(kind: 'light' | 'medium' | 'success' | 'error' = 'light') {
  if (muted) return;
  try {
    if (kind === 'success') Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => {});
    else if (kind === 'error') Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error).catch(() => {});
    else
      Haptics.impactAsync(
        kind === 'medium' ? Haptics.ImpactFeedbackStyle.Medium : Haptics.ImpactFeedbackStyle.Light
      ).catch(() => {});
  } catch {}
}

/** Call when leaving the games area to free native players. */
export async function unloadSfx() {
  const all = Object.values(pool).flat() as Audio.Sound[];
  loading = null;
  for (const k of Object.keys(pool)) delete pool[k as SfxName];
  await Promise.all(all.map((s) => s.unloadAsync().catch(() => {})));
}
