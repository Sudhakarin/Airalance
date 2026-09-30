// lib/sounds.ts
// Centralized sound effect helpers — WhatsApp-style subtle feedback

import { createAudioPlayer, AudioPlayer, setAudioModeAsync } from 'expo-audio';
import { Platform } from 'react-native';

let sendPlayer: AudioPlayer | null = null;
let receivePlayer: AudioPlayer | null = null;
let muted = false;
let initialized = false;

/**
 * Preload sound players. Call once on app startup.
 * Silently fails if sound files are missing.
 */
export async function initSounds() {
  if (initialized) return;
  if (Platform.OS === 'web') {
    initialized = true;
    return;
  }
  try {
    await setAudioModeAsync({
      playsInSilentMode: false,
      allowsRecording: false,
      shouldPlayInBackground: false,
    });

    sendPlayer = createAudioPlayer(require('../assets/sounds/send.mp3'));
    receivePlayer = createAudioPlayer(require('../assets/sounds/receive.mp3'));

    initialized = true;
  } catch (e) {
    console.warn('[sounds] init failed — sound files might be missing:', e);
    initialized = true;
  }
}

/**
 * Play message-sent sound. Fire-and-forget.
 */
export function playSend() {
  if (muted || !sendPlayer) return;
  try {
    sendPlayer.seekTo(0);
    sendPlayer.play();
  } catch {}
}

/**
 * Play message-received sound. Fire-and-forget.
 */
export function playReceive() {
  if (muted || !receivePlayer) return;
  try {
    receivePlayer.seekTo(0);
    receivePlayer.play();
  } catch {}
}

/**
 * Mute / unmute all app sounds. Persisted in-memory only (session-scoped).
 */
export function setSoundsMuted(v: boolean) {
  muted = v;
}

export function isSoundsMuted() {
  return muted;
}
