// index.js
// Custom entry point — registers FCM background handler BEFORE React loads
//
// ANDROID: incoming call = WhatsApp-style full-screen call notification
//          (lib/callNotification.ts, @notifee/react-native)
// iOS:     incoming call = CallKit via react-native-callkeep
//
// Server must send call pushes as DATA-ONLY (no `notification` block),
// otherwise Android shows its own plain notification and this handler never runs.

import { Platform } from 'react-native';

// Expo push service wraps the real payload as a JSON string in data.body.
// Unpack it so data.screen / data.callId are always at the top level.
function normalizeData(raw) {
  const data = { ...(raw || {}) };
  if (typeof data.body === 'string' && data.body.trim().startsWith('{')) {
    try {
      Object.assign(data, JSON.parse(data.body));
    } catch {}
  }
  return data;
}

// Last-resort fallback if notifee is unavailable
async function showFallbackCallNotification(data, callerName, hasVideo) {
  try {
    const Notifications = require('expo-notifications');
    await Notifications.scheduleNotificationAsync({
      content: {
        title: callerName,
        body: hasVideo ? 'Incoming video call' : 'Incoming voice call',
        data,
        sound: true,
        priority: Notifications.AndroidNotificationPriority.MAX,
        sticky: true,
        autoDismiss: true,
      },
      trigger: { channelId: 'calls' },
    });
  } catch (err) {
    console.warn('[bg] Fallback call notification failed:', err);
  }
}

// ============================================================
// ANDROID — notification button / tap handler (runs when app is
// in background or killed). Decline works without opening the app.
// ============================================================
if (Platform.OS === 'android') {
  try {
    const notifeeModule = require('@notifee/react-native');
    const notifee = notifeeModule.default ?? notifeeModule;
    const { EventType } = notifeeModule;

    notifee.onBackgroundEvent(async ({ type, detail }) => {
      const d = detail?.notification?.data;
      if (!d || d.screen !== 'call' || !d.callId) return;

      const callId = String(d.callId);
      const actionId = detail?.pressAction?.id;
      const cn = require('./lib/callNotification');

      if (type === EventType.ACTION_PRESS && actionId === 'decline') {
        await cn.declineCallById(callId);
        return;
      }

      if (type === EventType.ACTION_PRESS || type === EventType.PRESS) {
        // App is being opened — IncomingCallBridge picks this up
        const AsyncStorage =
          require('@react-native-async-storage/async-storage').default;
        await AsyncStorage.setItem(
          cn.PENDING_CALL_ACTION_KEY,
          JSON.stringify({
            callId,
            answer: actionId === 'answer',
            ts: Date.now(),
          })
        );
      }
    });
  } catch (err) {
    console.warn('[bg] notifee event setup failed:', err);
  }
}

// ============================================================
// FCM Background Handler (top-level — required by Firebase)
// Runs when the app is in background / killed (data messages)
// ============================================================
if (Platform.OS !== 'web') {
  try {
    const messaging = require('@react-native-firebase/messaging').default;

    messaging().setBackgroundMessageHandler(async (remoteMessage) => {
      console.log('[bg] FCM message:', JSON.stringify(remoteMessage));

      const data = normalizeData(remoteMessage?.data);
      if (!data || Object.keys(data).length === 0) return;

      // ---------- Caller hung up before we answered ----------
      if (data.screen === 'call_cancel' && data.callId) {
        if (Platform.OS === 'android') {
          const cn = require('./lib/callNotification');
          await cn.cancelCallNotification(String(data.callId));
        }
        return;
      }

      // ---------- Incoming call ----------
      if (data.screen === 'call' && data.callId) {
        const callerName = data.callerName || data.title || 'Unknown';
        const hasVideo = data.callType === 'video';

        // ===== ANDROID: WhatsApp-style full-screen call notification =====
        if (Platform.OS === 'android') {
          const cn = require('./lib/callNotification');
          const ok = await cn.showIncomingCallNotification(
            data,
            callerName,
            hasVideo
          );
          if (!ok) await showFallbackCallNotification(data, callerName, hasVideo);
          return;
        }

        // ===== iOS: CallKit =====
        try {
          const CallKeep = require('react-native-callkeep');
          const RNCallKeep = CallKeep?.default ?? CallKeep;

          try {
            await RNCallKeep.setup({
              ios: {
                appName: 'Airalance',
                supportsVideo: true,
                maximumCallGroups: '1',
                maximumCallsPerCallGroup: '1',
                includesCallsInRecents: false,
              },
              android: {},
            });
          } catch (setupErr) {
            console.log('[bg] CallKeep setup skipped:', setupErr?.message);
          }

          // Signature: (uuid, handle, localizedCallerName, handleType, hasVideo)
          RNCallKeep.displayIncomingCall(
            String(data.callId),
            callerName,
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
