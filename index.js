// index.js
// Custom entry point — registers FCM background handler BEFORE React loads
// ✅ Required for background/killed app calls to trigger CallKeep

import { Platform } from 'react-native';

// ============================================================
// FCM Background Handler (top-level — required by Firebase)
// This runs even when the app is killed/background
// ============================================================
if (Platform.OS !== 'web') {
  try {
    const messaging = require('@react-native-firebase/messaging').default;

    messaging().setBackgroundMessageHandler(async (remoteMessage) => {
      console.log('[bg] FCM message:', JSON.stringify(remoteMessage));

      const data = remoteMessage?.data;
      if (!data) return;

      // ============================================================
      // CALL — display CallKeep native UI directly
      // ============================================================
      if (data.screen === 'call' && data.callId) {
        try {
          const CallKeep = require('react-native-callkeep');
          const RNCallKeep = CallKeep?.default ?? CallKeep;

          // Ensure CallKeep is set up (may not have run if app was killed)
          try {
            await RNCallKeep.setup({
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
                  'Airalance needs phone account access to show calls',
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
            });
          } catch (setupErr) {
            console.log('[bg] CallKeep setup skipped:', setupErr?.message);
          }

          const callerName = data.callerName || data.title || 'Unknown';
          const hasVideo = data.callType === 'video';

          RNCallKeep.displayIncomingCall(
            data.callId,
            callerName,
            'generic',
            hasVideo
          );

          console.log('[bg] ✅ CallKeep displayed:', data.callId, callerName);
        } catch (err) {
          console.warn('[bg] CallKeep display error:', err);
        }
      }
    });

    console.log('[bg] FCM background handler registered');
  } catch (err) {
    console.warn('[bg] FCM setup failed:', err);
  }
}

// ============================================================
// Load Expo Router (MUST be last)
// ============================================================
import 'expo-router/entry';
