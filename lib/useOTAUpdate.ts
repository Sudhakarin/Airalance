// lib/useOTAUpdate.ts
// App open + background->foreground par update check.
// Naya update mile to status badalta hai (UI overlay dikhane ke liye),
// download hota hai, phir app reload hota hai.

import { useEffect, useRef, useState } from 'react';
import { AppState, Platform } from 'react-native';
import * as Updates from 'expo-updates';

export type OTAStatus = 'idle' | 'checking' | 'downloading' | 'restarting';

const MIN_GAP_MS = 5 * 60 * 1000; // 5 min se pehle dobara check nahi
const CHECK_TIMEOUT_MS = 6000; // slow/no internet par app atke nahi
const FETCH_TIMEOUT_MS = 90000;

function withTimeout<T>(p: Promise<T>, ms: number): Promise<T> {
  return new Promise((resolve, reject) => {
    const t = setTimeout(() => reject(new Error('timeout')), ms);
    p.then(
      (v) => {
        clearTimeout(t);
        resolve(v);
      },
      (e) => {
        clearTimeout(t);
        reject(e);
      }
    );
  });
}

export function useOTAUpdate(): { status: OTAStatus } {
  const [status, setStatus] = useState<OTAStatus>('idle');
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
        setStatus('checking');
        const res = await withTimeout(
          Updates.checkForUpdateAsync(),
          CHECK_TIMEOUT_MS
        );
        if (!res.isAvailable) {
          setStatus('idle');
          return;
        }

        setStatus('downloading');
        await withTimeout(Updates.fetchUpdateAsync(), FETCH_TIMEOUT_MS);

        setStatus('restarting');
        await new Promise((r) => setTimeout(r, 700)); // 100% dikhne do
        await Updates.reloadAsync();
      } catch (err) {
        console.warn('[ota] update failed:', err);
        setStatus('idle');
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

  return { status };
}
