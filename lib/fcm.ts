// lib/fcm.ts
// Firebase Cloud Messaging — token + foreground handlers
// ✅ Background handler moved to index.js (top-level requirement by Firebase)

import { Platform } from 'react-native';

let messaging: any = null;

if (Platform.OS !== 'web') {
  try {
    messaging = require('@react-native-firebase/messaging').default;
  } catch (err) {
    console.warn('[fcm] messaging not available:', err);
  }
}

// ============================================================
// Background handler — REMOVED
// ============================================================
// Firebase requires setBackgroundMessageHandler to be registered
// at the TOP LEVEL of the app (before React loads).
// It is now registered in `index.js` at project root.
//
// This function is kept as a no-op for backward compatibility
// so existing imports don't break.
// ============================================================
export function registerBackgroundHandler(
  _onIncomingCall: (data: any) => void
) {
  // No-op — see index.js for actual background handler
  console.log('[fcm] registerBackgroundHandler called (no-op, using index.js)');
}

// ============================================================
// Token
// ============================================================

export async function getFcmToken(): Promise<string | null> {
  if (!messaging) return null;
  try {
    const token = await messaging().getToken();
    return token;
  } catch (err) {
    console.warn('[fcm] getToken failed:', err);
    return null;
  }
}

export function onFcmTokenRefresh(cb: (token: string) => void) {
  if (!messaging) return () => {};
  return messaging().onTokenRefresh(cb);
}

// ============================================================
// Foreground handlers (app open)
// ============================================================

export function onForegroundMessage(cb: (data: any) => void) {
  if (!messaging) return () => {};
  return messaging().onMessage(async (remoteMessage: any) => {
    cb(remoteMessage?.data);
  });
}

export function onNotificationOpenedApp(cb: (data: any) => void) {
  if (!messaging) return;
  messaging()
    .getInitialNotification()
    .then((remoteMessage: any) => {
      if (remoteMessage?.data) cb(remoteMessage.data);
    });

  messaging().onNotificationOpenedApp((remoteMessage: any) => {
    if (remoteMessage?.data) cb(remoteMessage.data);
  });
}

export { messaging };
