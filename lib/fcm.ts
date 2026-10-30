import { Platform } from 'react-native';

let getMessaging: any = null;
let getToken: any = null;
let onMessage: any = null;
let onTokenRefresh: any = null;
let getInitialNotification: any = null;
let onNotificationOpenedAppFirebase: any = null;

if (Platform.OS !== 'web') {
  try {
    const messagingModule = require('@react-native-firebase/messaging');
    getMessaging = messagingModule.getMessaging;
    getToken = messagingModule.getToken;
    onMessage = messagingModule.onMessage;
    onTokenRefresh = messagingModule.onTokenRefresh;
    getInitialNotification = messagingModule.getInitialNotification;
    onNotificationOpenedAppFirebase = messagingModule.onNotificationOpenedApp;
  } catch (err) {
    console.warn('[fcm] messaging module not available:', err);
  }
}

let messagingInstance: any = null;
if (getMessaging) {
  try {
    messagingInstance = getMessaging();
  } catch (e) {
    console.warn('[fcm] Failed to initialize messaging instance', e);
  }
}

// Background handler is in index.js
export function registerBackgroundHandler(_onIncomingCall: (data: any) => void) {
  console.log('[fcm] registerBackgroundHandler called (no-op, using index.js)');
}

// Token
export async function getFcmToken(): Promise<string | null> {
  if (!messagingInstance || !getToken) return null;
  try {
    return await getToken(messagingInstance);
  } catch (err) {
    console.warn('[fcm] getToken failed:', err);
    return null;
  }
}

export function onFcmTokenRefresh(cb: (token: string) => void) {
  if (!messagingInstance || !onTokenRefresh) return () => {};
  return onTokenRefresh(messagingInstance, cb);
}

// Foreground handlers
export function onForegroundMessage(cb: (data: any) => void) {
  if (!messagingInstance || !onMessage) return () => {};
  return onMessage(messagingInstance, async (remoteMessage: any) => {
    cb(remoteMessage?.data);
  });
}

export function onNotificationOpenedApp(cb: (data: any) => void) {
  if (!messagingInstance || !getInitialNotification) return;
  
  getInitialNotification(messagingInstance).then((remoteMessage: any) => {
    if (remoteMessage?.data) cb(remoteMessage.data);
  });

  if (onNotificationOpenedAppFirebase) {
    onNotificationOpenedAppFirebase(messagingInstance, (remoteMessage: any) => {
      if (remoteMessage?.data) cb(remoteMessage.data);
    });
  }
}

export const messaging = messagingInstance;
