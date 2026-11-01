// lib/callkeep.ts
// react-native-callkeep setup + event handlers
// ✅ Web-safe: react-native-callkeep is native-only
// ✅ FIX: displayIncomingCall argument order (name showed as "generic")
// ✅ FIX: Android answer from native UI now brings the app to foreground
// ✅ FIX: no extra permission dialog from setup (we ask them in lib/permissions.ts)

import { Platform } from 'react-native';

// ✅ Web-safe: load callkeep only on native
let RNCallKeepModule: any = null;
// ✅ iOS only (CallKit). On Android the incoming-call UI is the WhatsApp-style
// full-screen notification in lib/callNotification.ts, so every wrapper below
// is a safe no-op there.
if (Platform.OS === 'ios') {
  try {
    const CallKeep = require('react-native-callkeep');
    // Module can be either default export or the module itself
    RNCallKeepModule = CallKeep?.default ?? CallKeep;
  } catch (err) {
    console.warn('[callkeep] not available:', err);
  }
}

const CALLKEEP_OPTIONS = {
  ios: {
    appName: 'Airalance',
    supportsVideo: true,
    maximumCallGroups: '1',
    maximumCallsPerCallGroup: '1',
    includesCallsInRecents: false,
  },
  android: {
    additionalPermissions: [] as string[],
    alertTitle: 'Permissions required',
    alertDescription:
      'Airalance needs to access your phone accounts to show incoming calls',
    cancelButton: 'Cancel',
    okButton: 'Allow',
    imageName: 'ic_launcher',
    foregroundService: {
      channelId: 'com.airalance.app.call',
      channelName: 'Airalance calls',
      notificationTitle: 'Airalance is active',
      notificationIcon: 'ic_launcher',
    },
  },
};

let isSetup = false;

export async function setupCallKeep(): Promise<boolean> {
  if (Platform.OS === 'web') return false;
  if (!RNCallKeepModule) return false;
  if (isSetup) return true;

  try {
    await RNCallKeepModule.setup(CALLKEEP_OPTIONS);
    isSetup = true;
    console.log('[callkeep] setup complete');
    return true;
  } catch (err) {
    console.warn('[callkeep] setup failed:', err);
    return false;
  }
}

export function displayIncomingCall(
  callId: string,
  callerName: string,
  hasVideo: boolean
) {
  if (!RNCallKeepModule) return;
  try {
    // Signature: (uuid, handle, localizedCallerName, handleType, hasVideo)
    RNCallKeepModule.displayIncomingCall(
      callId,
      callerName,
      callerName,
      'generic',
      hasVideo
    );
  } catch (err) {
    console.warn('[callkeep] displayIncomingCall failed:', err);
  }
}

export function endCallKeep(callId: string) {
  if (!RNCallKeepModule) return;
  try {
    RNCallKeepModule.endCall(callId);
  } catch (err) {
    console.warn('[callkeep] endCall failed:', err);
  }
}

// Android: has the user enabled "Airalance" under Calling accounts?
// Without that, the system incoming-call screen NEVER shows (silent no-op).
// Returns null when it can't be determined.
export async function isPhoneAccountEnabled(): Promise<boolean | null> {
  if (Platform.OS !== 'android' || !RNCallKeepModule) return null;
  try {
    const fn =
      RNCallKeepModule.hasPhoneAccount ??
      RNCallKeepModule.checkPhoneAccountEnabled;
    if (typeof fn !== 'function') return null;
    return !!(await fn.call(RNCallKeepModule));
  } catch {
    return null;
  }
}

// Android: opens the system "Calling accounts" settings page
export function openPhoneAccountsSettings(): boolean {
  if (Platform.OS !== 'android' || !RNCallKeepModule) return false;
  try {
    RNCallKeepModule.openPhoneAccounts();
    return true;
  } catch {
    return false;
  }
}

export function setAvailable() {
  if (!RNCallKeepModule) return;
  try {
    RNCallKeepModule.setAvailable(true);
  } catch {}
}

export function setUnavailable() {
  if (!RNCallKeepModule) return;
  try {
    RNCallKeepModule.setAvailable(false);
  } catch {}
}

export function registerCallKeepEvents(handlers: {
  onAnswerCall: (callId: string) => void;
  onEndCall: (callId: string) => void;
  onStartCall?: (callId: string) => void;
}) {
  if (!RNCallKeepModule) return () => {};

  const listeners: Array<{ event: string; fn: (...args: any[]) => void }> = [];

  const add = (event: string, fn: (...args: any[]) => void) => {
    RNCallKeepModule.addEventListener(event, fn);
    listeners.push({ event, fn });
  };

  add('answerCall', ({ callUUID }: any) => {
    console.log('[callkeep] answerCall:', callUUID);
    // Android: answering from lock screen / background must bring the app up
    if (Platform.OS === 'android') {
      try {
        RNCallKeepModule.backToForeground?.();
      } catch {}
    }
    handlers.onAnswerCall(callUUID);
  });

  add('endCall', ({ callUUID }: any) => {
    console.log('[callkeep] endCall:', callUUID);
    handlers.onEndCall(callUUID);
  });

  add('didPerformSetMutedCallAction', ({ callUUID, muted }: any) => {
    console.log('[callkeep] mute toggle:', callUUID, muted);
  });

  return () => {
    listeners.forEach(({ event, fn }) => {
      try {
        RNCallKeepModule.removeEventListener(event, fn);
      } catch {}
    });
  };
}

export { RNCallKeepModule };
