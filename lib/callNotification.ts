// lib/callNotification.ts
// WhatsApp-style incoming call notification for Android (via @notifee/react-native):
//  - heads-up banner with Answer / Decline when the phone is in use
//  - FULL-SCREEN call screen on the lock screen (full-screen intent)
//  - loops the ringtone until answered / declined / 60s
// iOS keeps using CallKit (react-native-callkeep). Everything here is a safe
// no-op on iOS / web / if notifee is missing.

import { Platform } from 'react-native';

let notifee: any = null;
let N: any = null;
if (Platform.OS === 'android') {
  try {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    N = require('@notifee/react-native');
    notifee = N.default ?? N;
  } catch (err) {
    console.warn('[callnotif] notifee not available:', err);
  }
}

// Shared with index.js (background handler) and IncomingCallBridge
export const PENDING_CALL_ACTION_KEY = 'airalance:pending-call-action';

const CHANNEL_ID = 'incoming_call_v1';
const RING_TIMEOUT_MS = 45000;

export function isCallNotificationAvailable(): boolean {
  return !!notifee;
}

async function ensureChannel(): Promise<string> {
  return notifee.createChannel({
    id: CHANNEL_ID,
    name: 'Incoming calls',
    importance: N.AndroidImportance.HIGH,
    visibility: N.AndroidVisibility.PUBLIC,
    sound: 'ringtone',
    vibration: true,
    vibrationPattern: [300, 1000, 300, 1000],
    bypassDnd: true,
    lights: true,
    lightColor: '#22C55E',
  });
}

export async function showIncomingCallNotification(
  data: Record<string, any>,
  callerName: string,
  hasVideo: boolean
): Promise<boolean> {
  if (!notifee) return false;
  try {
    const channelId = await ensureChannel();
    const callId = String(data.callId);

    const strData: Record<string, string> = {};
    Object.keys(data || {}).forEach((k) => {
      strData[k] = String(data[k]);
    });

    const avatar =
      typeof data.callerAvatar === 'string' && data.callerAvatar.startsWith('http')
        ? data.callerAvatar
        : undefined;

    await notifee.displayNotification({
      id: callId,
      title: callerName,
      body: hasVideo ? 'Incoming video call' : 'Incoming voice call',
      data: strData,
      android: {
        channelId,
        category: N.AndroidCategory.CALL,
        importance: N.AndroidImportance.HIGH,
        visibility: N.AndroidVisibility.PUBLIC,
        smallIcon: 'ic_launcher',
        color: '#22C55E',
        largeIcon: avatar,
        circularLargeIcon: true,
        ongoing: true,
        autoCancel: false,
        loopSound: true,
        timeoutAfter: RING_TIMEOUT_MS,
        showTimestamp: true,
        pressAction: { id: 'default', launchActivity: 'default' },
        // Lock screen → opens the app full-screen (MainActivity has
        // showWhenLocked + turnScreenOn via plugins/withCallKeep.js)
        fullScreenAction: { id: 'default', launchActivity: 'default' },
        actions: [
          {
            title: '<font color="#F87171">Decline</font>',
            pressAction: { id: 'decline' },
          },
          {
            title: '<font color="#4ADE80">Answer</font>',
            pressAction: { id: 'answer', launchActivity: 'default' },
          },
        ],
      },
    });
    return true;
  } catch (err) {
    console.warn('[callnotif] show failed:', err);
    return false;
  }
}

export async function cancelCallNotification(
  callId: string | null | undefined
): Promise<void> {
  if (!notifee || !callId) return;
  const id = String(callId);
  try {
    await notifee.cancelNotification(id);
  } catch {}
  // Also remove the system "safety-net" notification for this call (best effort)
  try {
    const list = await notifee.getDisplayedNotifications();
    for (const n of list || []) {
      if (String(n?.notification?.data?.callId ?? '') === id) {
        try {
          await notifee.cancelDisplayedNotification(
            String(n.id),
            n?.notification?.android?.tag ?? id
          );
        } catch {}
      }
    }
  } catch {}
}

// Tell the server "this phone is showing the call" → no safety-net notification
export async function ackRinging(callId: string): Promise<void> {
  try {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const { supabase } = require('./supabase');
    await supabase
      .from('calls')
      .update({ ringing_shown_at: new Date().toISOString() })
      .eq('id', callId);
  } catch (err) {
    console.warn('[callnotif] ack failed:', err);
  }
}

// A call notification that is still on screen (e.g. user opened the app from
// the lock screen) → returns its callId
export async function getDisplayedCallNotification(): Promise<{
  callId: string;
  callType: string;
} | null> {
  if (!notifee) return null;
  try {
    const list = await notifee.getDisplayedNotifications();
    const hit = (list || []).find(
      (n: any) =>
        n?.notification?.data?.screen === 'call' &&
        n?.notification?.data?.callId
    );
    if (!hit) return null;
    return {
      callId: String(hit.notification.data.callId),
      callType: String(hit.notification.data.callType ?? 'audio'),
    };
  } catch {
    return null;
  }
}

// App cold-started by tapping / answering / full-screen launch
export async function getInitialCallAction(): Promise<{
  callId: string;
  answer: boolean;
} | null> {
  if (!notifee) return null;
  try {
    const initial = await notifee.getInitialNotification();
    const d = initial?.notification?.data;
    if (!d || d.screen !== 'call' || !d.callId) return null;
    return {
      callId: String(d.callId),
      answer: initial?.pressAction?.id === 'answer',
    };
  } catch {
    return null;
  }
}

// Decline from the notification button (works from background / killed too).
// 1) write 'rejected' to the DB (verified + retried — a silent failure here is
//    exactly what leaves the caller stuck on "Calling…")
// 2) push the result straight to the caller so their screen closes at once
export async function declineCallById(
  callId: string,
  callerId?: string | null
): Promise<void> {
  await cancelCallNotification(callId);

  try {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const { rejectCall, getCall } = require('./call');
    for (let i = 0; i < 3; i++) {
      try {
        await rejectCall(callId);
      } catch (err) {
        console.warn('[callnotif] reject attempt failed:', i, err);
      }
      const row = await getCall(callId);
      if (!row || row.status !== 'ringing') break; // done
      await new Promise((r) => setTimeout(r, 600));
    }
  } catch (err) {
    console.warn('[callnotif] decline failed:', err);
  }

  if (callerId) {
    try {
      // eslint-disable-next-line @typescript-eslint/no-var-requires
      const { supabase } = require('./supabase');
      await supabase.functions.invoke('send-push', {
        body: {
          userId: callerId,
          title: 'Call update',
          body: 'Call update',
          data: { screen: 'call_cancel', callId, status: 'rejected' },
        },
      });
    } catch (err) {
      console.warn('[callnotif] decline push failed:', err);
    }
  }
}

// Notification interactions while the app is open
export function subscribeForegroundCallEvents(
  cb: (callId: string, answer: boolean) => void
): () => void {
  if (!notifee) return () => {};
  try {
    return notifee.onForegroundEvent(({ type, detail }: any) => {
      const d = detail?.notification?.data;
      if (!d || d.screen !== 'call' || !d.callId) return;
      const callId = String(d.callId);
      const actionId = detail?.pressAction?.id;

      if (type === N.EventType.ACTION_PRESS && actionId === 'decline') {
        declineCallById(callId, d.callerId ? String(d.callerId) : null);
        return;
      }
      if (type === N.EventType.ACTION_PRESS || type === N.EventType.PRESS) {
        cb(callId, actionId === 'answer');
      }
    });
  } catch {
    return () => {};
  }
}
