// lib/pin.ts
// PIN hashing + session unlock tracking for chat lock feature

import AsyncStorage from '@react-native-async-storage/async-storage';
import * as Crypto from 'expo-crypto';

let sessionUnlocked = false;

export function pinStorageKey(userId: string) {
  return `chat_lock_pin:${userId}`;
}

export async function hashPin(pin: string): Promise<string> {
  return Crypto.digestStringAsync(
    Crypto.CryptoDigestAlgorithm.SHA256,
    `airalance:${pin}`
  );
}

export function setSessionUnlocked(v: boolean) {
  sessionUnlocked = v;
}

export function isSessionUnlocked() {
  return sessionUnlocked;
}

/**
 * Reads stored PIN hash for a user.
 * Backward compat: if stored value is a plaintext 4-digit PIN (old format),
 * hash it and save the hash back, then return the hash.
 */
export async function loadStoredPinHash(
  userId: string
): Promise<string | null> {
  try {
    const raw = await AsyncStorage.getItem(pinStorageKey(userId));
    if (!raw) return null;
    // Old plaintext format — migrate
    if (/^\d{4}$/.test(raw)) {
      const hashed = await hashPin(raw);
      await AsyncStorage.setItem(pinStorageKey(userId), hashed);
      return hashed;
    }
    return raw;
  } catch {
    return null;
  }
}

export async function savePinHash(userId: string, pin: string) {
  const hashed = await hashPin(pin);
  await AsyncStorage.setItem(pinStorageKey(userId), hashed);
  return hashed;
}
