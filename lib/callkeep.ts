// lib/callkeep.ts
// react-native-callkeep setup + event handlers
// ✅ Web-safe: react-native-callkeep is native-only

import { Platform } from 'react-native';

// ✅ Web-safe: load callkeep only on native
let RNCallKeepModule: any = null;
if (Platform.OS !== 'web') {
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
    RNCallKeepModule.displayIncomingCall(
      callId,
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
