import { Platform } from 'react-native';
import {
  getMessaging,
  getToken,
  onMessage,
  onTokenRefresh,
  getInitialNotification,
  onNotificationOpenedApp as onNotificationOpenedAppFB
} from '@react-native-firebase/messaging';

let messagingInstance: any = null;

if (Platform.OS !== 'web') {
  try {
    messagingInstance = getMessaging();
  } catch (err) {
    console.warn('[fcm] Failed to initialize messaging:', err);
  }
}

export function registerBackgroundHandler(_onIncomingCall: (data: any) => void) {
  console.log('[fcm] registerBackgroundHandler called (no-op, using index.js)');
}

export async function getFcmToken(): Promise<string | null> {
  if (!messagingInstance) return null;
  try {
    return await getToken(messagingInstance);
  } catch (err) {
    console.warn('[fcm] getToken failed:', err);
    return null;
  }
}

export function onFcmTokenRefresh(cb: (token: string) => void) {
  if (!messagingInstance) return () => {};
  return onTokenRefresh(messagingInstance, cb);
}

export function onForegroundMessage(cb: (data: any) => void) {
  if (!messagingInstance) return () => {};
  return onMessage(messagingInstance, async (remoteMessage: any) => {
    cb(remoteMessage?.data);
  });
}

export function onNotificationOpenedApp(cb: (data: any) => void) {
  if (!messagingInstance) return;

  getInitialNotification(messagingInstance).then((remoteMessage: any) => {
    if (remoteMessage?.data) cb(remoteMessage.data);
  });

  onNotificationOpenedAppFB(messagingInstance, (remoteMessage: any) => {
    if (remoteMessage?.data) cb(remoteMessage.data);
  });
}

export { messagingInstance as messaging };
