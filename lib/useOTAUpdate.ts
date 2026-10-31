// lib/useOTAUpdate.ts
// Silent OTA updates: app open + background->foreground par check,
// naya JS mile to download karke turant reload.

import { useEffect, useRef } from 'react';
import { AppState, Platform } from 'react-native';
import * as Updates from 'expo-updates';

const MIN_GAP_MS = 5 * 60 * 1000; // 5 min se pehle dobara check nahi

export function useOTAUpdate() {
  const lastCheckRef = useRef(0);
  const busyRef = useRef(false);

  useEffect(() => {
    if (__DEV__ || Platform.OS === 'web' || !Updates.isEnabled) return;

    const check = async () => {
      if (busyRef.current) return;
      if (Date.now() - lastCheckRef.current < MIN_GAP_MS) return;
      busyRef.current = true;
      lastCheckRef.current = Date.now();
      try {
        const res = await Updates.checkForUpdateAsync();
        if (res.isAvailable) {
          await Updates.fetchUpdateAsync();
          await Updates.reloadAsync();
        }
      } catch (err) {
        console.warn('[ota] update check failed:', err);
      } finally {
        busyRef.current = false;
      }
    };

    check();

    const sub = AppState.addEventListener('change', (s) => {
      if (s === 'active') check();
    });
    return () => sub.remove();
  }, []);
}
