// lib/fcm.ts
// Firebase Cloud Messaging — background message handler for incoming calls

import { Platform } from 'react-native';

let messaging: any = null;

if (Platform.OS !== 'web') {
  try {
    messaging = require('@react-native-firebase/messaging').default;
  } catch (err) {
    console.warn('[fcm] messaging not available:', err);
  }
}

// ✅ Background message handler — MUST be registered before app renders
export function registerBackgroundHandler(onIncomingCall: (data: any) => void) {
  if (!messaging) return;

  messaging().setBackgroundMessageHandler(async (remoteMessage: any) => {
    console.log('[fcm] background message:', remoteMessage);

    const data = remoteMessage?.data;
    if (!data) return;

    if (data.screen === 'call' && data.callId) {
      console.log('[fcm] background incoming call:', data.callId);
      onIncomingCall(data);
    }
  });
}

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
