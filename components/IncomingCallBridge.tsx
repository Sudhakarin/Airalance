// components/IncomingCallBridge.tsx
// Connects the Android call notification (Answer / Decline / full-screen /
// tap) to the in-app call screen. Render it INSIDE <CallProvider>.

import { useEffect, useRef } from 'react';
import { AppState, Platform } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { useCall } from '../contexts/CallContext';
import {
  PENDING_CALL_ACTION_KEY,
  getDisplayedCallNotification,
  getInitialCallAction,
  subscribeForegroundCallEvents,
} from '../lib/callNotification';

export default function IncomingCallBridge() {
  const { openIncomingFromPush } = useCall();
  const openRef = useRef(openIncomingFromPush);
  openRef.current = openIncomingFromPush;

  useEffect(() => {
    if (Platform.OS !== 'android') return;

    const check = async (includeInitial: boolean) => {
      try {
        // 1) Answer / tap recorded by the background handler
        const raw = await AsyncStorage.getItem(PENDING_CALL_ACTION_KEY);
        if (raw) {
          await AsyncStorage.removeItem(PENDING_CALL_ACTION_KEY);
          const a = JSON.parse(raw);
          if (a?.callId && Date.now() - (a.ts || 0) < 90000) {
            await openRef.current(String(a.callId), !!a.answer);
            return;
          }
        }

        // 2) App was killed and got launched by the notification
        if (includeInitial) {
          const init = await getInitialCallAction();
          if (init) {
            await openRef.current(init.callId, init.answer);
            return;
          }
        }

        // 3) A call notification is still showing (lock-screen full-screen
        //    launch, or user opened the app while it rings)
        const shown = await getDisplayedCallNotification();
        if (shown) await openRef.current(shown.callId, false);
      } catch (e) {
        console.warn('[call-bridge] check failed:', e);
      }
    };

    const t = setTimeout(() => check(true), 250);
    const sub = AppState.addEventListener('change', (s) => {
      if (s === 'active') check(false);
    });
    const unsubFg = subscribeForegroundCallEvents((callId, answer) => {
      openRef.current(callId, answer);
    });

    return () => {
      clearTimeout(t);
      sub.remove();
      unsubFg();
    };
  }, []);

  return null;
}
