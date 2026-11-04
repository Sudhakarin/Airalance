// supabase/functions/send-push/index.ts
// Push notification bhejne wali Edge Function (FCM V1 API + Expo fallback)
// ✅ Supports: chat messages, locked chats, incoming calls
// ✅ FIX: Calls are now DATA-ONLY (+ high priority). A `notification` block makes
//         Android show its own plain notification when the app is closed and the
//         app's background handler (call UI) never runs.
// ✅ SAFETY NET: a call push is sent data-only first (app shows the WhatsApp-style
//    call UI). If the phone does NOT confirm within 3s (OEM blocks data pushes,
//    app force-stopped, handler crashed…), a normal system notification is sent
//    — so an incoming call can never silently disappear.
// ✅ NEW: screen:'call_cancel' push removes the ringing notification
// ✅ FIX: chat — Expo push only when FCM failed (was sending BOTH = double notification)

import { serve } from 'https://deno.land/std@0.177.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import { SignJWT, importPKCS8 } from 'https://deno.land/x/jose@v5.2.0/index.ts';

const EXPO_PUSH_URL = 'https://exp.host/--/api/v2/push/send';

// Supabase background-task helper (keeps the function alive after responding)
declare const EdgeRuntime: any;

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers':
    'authorization, x-client-info, apikey, content-type',
};

// ============================================================
// FCM V1 — OAuth2 access token (JWT signing)
// ============================================================

let cachedAccessToken: { token: string; expiresAt: number } | null = null;

async function getFcmAccessToken(serviceAccount: any): Promise<string> {
  if (cachedAccessToken && cachedAccessToken.expiresAt > Date.now() + 60000) {
    return cachedAccessToken.token;
  }

  const privateKey = await importPKCS8(serviceAccount.private_key, 'RS256');

  const now = Math.floor(Date.now() / 1000);
  const jwt = await new SignJWT({
    scope: 'https://www.googleapis.com/auth/firebase.messaging',
  })
    .setProtectedHeader({ alg: 'RS256', typ: 'JWT' })
    .setIssuer(serviceAccount.client_email)
    .setAudience('https://oauth2.googleapis.com/token')
    .setIssuedAt(now)
    .setExpirationTime(now + 3600)
    .sign(privateKey);

  const res = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer',
      assertion: jwt,
    }),
  });

  if (!res.ok) {
    const err = await res.text();
    throw new Error(`FCM token error: ${err}`);
  }

  const data = await res.json();
  cachedAccessToken = {
    token: data.access_token,
    expiresAt: Date.now() + data.expires_in * 1000,
  };
  return data.access_token;
}

// ============================================================
// Send FCM V1 message
// ============================================================

async function sendFcmMessage(
  serviceAccount: any,
  fcmToken: string,
  message: {
    title: string;
    body: string;
    data?: Record<string, string>;
    isCall?: boolean; // system notification (guaranteed to show)
    isCallData?: boolean; // data-only (app draws the call UI)
    isCancel?: boolean;
  }
): Promise<{ ok: boolean; error?: string }> {
  try {
    const accessToken = await getFcmAccessToken(serviceAccount);

    const fcmPayload: any = {
      message: {
        token: fcmToken,
        data: {
          ...(message.data || {}),
          title: message.title,
          body: message.body,
        },
      },
    };

    if (message.isCancel) {
      // Silent: just tells the app to dismiss the ringing notification
      fcmPayload.message.android = { priority: 'HIGH', ttl: '30s' };
      fcmPayload.message.apns = {
        headers: { 'apns-priority': '5', 'apns-push-type': 'background' },
        payload: { aps: { 'content-available': 1 } },
      };
    } else if (message.isCallData) {
      // ============================================================
      // DATA-ONLY (no `notification` block) → app's background handler runs and
      // draws the WhatsApp-style full-screen call notification (notifee).
      // ============================================================
      fcmPayload.message.android = { priority: 'HIGH', ttl: '60s' };
    } else if (message.isCall) {
      // ============================================================
      // SYSTEM notification — guaranteed to be shown by Google Play Services,
      // even when the app is killed. Used as the safety net (and on iOS).
      // ============================================================
      fcmPayload.message.notification = {
        title: message.title,
        body: message.body,
      };
      fcmPayload.message.android = {
        priority: 'HIGH',
        ttl: '60s',
        notification: {
          channelId: 'calls',
          sound: 'ringtone',
          tag: String(message.data?.callId ?? ''),
          notificationPriority: 'PRIORITY_MAX',
          visibility: 'PUBLIC',
          defaultVibrateTimings: true,
        },
      };
      fcmPayload.message.apns = {
        headers: {
          'apns-priority': '10',
          'apns-push-type': 'alert',
        },
        payload: {
          aps: {
            alert: {
              title: message.title,
              body: message.body,
            },
            sound: 'default',
            'interruption-level': 'time-sensitive',
            'content-available': 1,
          },
        },
      };
    } else {
      fcmPayload.message.notification = {
        title: message.title,
        body: message.body,
      };
      fcmPayload.message.android = {
        priority: 'HIGH',
        notification: {
          sound: 'default',
          channelId: 'default',
        },
      };
      fcmPayload.message.apns = {
        payload: {
          aps: {
            sound: 'default',
            badge: 1,
          },
        },
      };
    }

    const res = await fetch(
      `https://fcm.googleapis.com/v1/projects/${serviceAccount.project_id}/messages:send`,
      {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${accessToken}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(fcmPayload),
      }
    );

    if (!res.ok) {
      const err = await res.text();
      return { ok: false, error: err };
    }

    return { ok: true };
  } catch (err) {
    return { ok: false, error: String(err) };
  }
}

// ============================================================
// Expo Push fallback
// ============================================================

async function sendExpoPush(
  expoToken: string,
  title: string,
  body: string,
  data: any
): Promise<any> {
  const isCall = data?.screen === 'call';

  const response = await fetch(EXPO_PUSH_URL, {
    method: 'POST',
    headers: {
      Accept: 'application/json',
      'Accept-Encoding': 'gzip, deflate',
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      to: expoToken,
      sound: isCall ? 'default' : 'default',
      title,
      body,
      data,
      priority: isCall ? 'high' : 'default',
      channelId: isCall ? 'calls' : 'default',
      // ✅ Android 11 killed-app: full-screen intent + notification
      ...(isCall
        ? {
            categoryIdentifier: 'incoming_call',
            _displayInForeground: true,
          }
        : {}),
    }),
  });
  return await response.json();
}

// ============================================================
// Main handler
// ============================================================

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  try {
    const body_json = await req.json();
    const { userId, title, body, data } = body_json;

    if (!userId || !title || !body) {
      return new Response(
        JSON.stringify({ error: 'userId, title, body required' }),
        {
          status: 400,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        }
      );
    }

    const supabase = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
    );

    // Get user's push tokens (FCM + Expo)
    const { data: profile, error: profileError } = await supabase
      .from('profiles')
      .select('expo_push_token, fcm_token')
      .eq('id', userId)
      .single();

    if (profileError || !profile) {
      return new Response(JSON.stringify({ error: 'Profile not found' }), {
        status: 404,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    // ============================================================
    // CALL CANCELLED — silently remove the ringing notification
    // ============================================================
    if (data?.screen === 'call_cancel' && data?.callId) {
      const saJson = Deno.env.get('FCM_SERVICE_ACCOUNT');
      let cancelResult: any = { ok: false };
      if (saJson && profile.fcm_token) {
        try {
          cancelResult = await sendFcmMessage(
            JSON.parse(saJson),
            profile.fcm_token,
            {
              title,
              body,
              isCancel: true,
              data: {
                screen: 'call_cancel',
                callId: String(data.callId),
                status: String(data.status ?? ''),
              },
            }
          );
        } catch (err) {
          console.warn('[fcm] cancel send failed:', err);
        }
      }
      return new Response(JSON.stringify({ type: 'call_cancel', fcm: cancelResult }), {
        status: 200,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    // ============================================================
    // CALL — data-only high-priority push (app shows the call UI)
    // ============================================================
    if (data?.screen === 'call' && data?.callId) {
      const fcmServiceAccountJson = Deno.env.get('FCM_SERVICE_ACCOUNT');
      let fcmResult: any = { ok: false };
      let expoResult: any = null;

      if (fcmServiceAccountJson && profile.fcm_token) {
        try {
          const serviceAccount = JSON.parse(fcmServiceAccountJson);
          const callData: Record<string, string> = {
            screen: 'call',
            callId: String(data.callId),
            callerId: String(data.callerId),
            callType: String(data.callType),
            role: 'receiver',
            callerName: title,
            callerAvatar: String(data.callerAvatar ?? ''),
          };

          // 1) data-only → the app draws the WhatsApp-style call UI
          fcmResult = await sendFcmMessage(serviceAccount, profile.fcm_token, {
            title,
            body,
            isCallData: true,
            data: callData,
          });

          // 2) SAFETY NET — if the phone didn't confirm within 3s, send a normal
          //    system notification so the call can never silently disappear
          const fallbackTask = (async () => {
            try {
              await new Promise((r) => setTimeout(r, 3000));
              const { data: row } = await supabase
                .from('calls')
                .select('*')
                .eq('id', String(data.callId))
                .maybeSingle();
              if (!row || row.status !== 'ringing') return; // answered / ended
              if (row.ringing_shown_at) return; // phone already shows the call
              await sendFcmMessage(serviceAccount, profile.fcm_token, {
                title,
                body,
                isCall: true,
                data: callData,
              });
              console.log('[fcm] safety-net notification sent for', data.callId);
            } catch (err) {
              console.warn('[fcm] safety-net failed:', err);
            }
          })();
          try {
            EdgeRuntime.waitUntil(fallbackTask);
          } catch {
            /* no background-task support — task still runs while the instance lives */
          }
        } catch (err) {
          console.warn('[fcm] call send failed:', err);
        }
      }

      // Fallback to Expo
      if (!fcmResult.ok && profile.expo_push_token) {
        expoResult = await sendExpoPush(
          profile.expo_push_token,
          title,
          body,
          {
            screen: 'call',
            callId: data.callId,
            callerId: data.callerId,
            callType: data.callType,
            role: 'receiver',
            callerName: title,
          }
        );
      }

      return new Response(
        JSON.stringify({
          type: 'call',
          fcm: fcmResult,
          expo: expoResult,
        }),
        {
          status: 200,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        }
      );
    }

    // ============================================================
    // CHAT MESSAGE (locked chat handling)
    // ============================================================
    let finalTitle = title;
    let finalBody = body;
    let finalData: Record<string, unknown> = { ...(data || {}) };
    let isLockedChat = false;

    const chatId = data?.chatId;
    if (chatId && data?.screen === 'chat') {
      const { data: settings } = await supabase
        .from('chat_settings')
        .select('is_locked')
        .eq('user_id', userId)
        .eq('conversation_id', chatId)
        .maybeSingle();

      if (settings?.is_locked === true) {
        isLockedChat = true;
        finalTitle = 'Airalance';
        finalBody = '1 new message';
        finalData = {
          screen: 'chats',
          locked: true,
          chatId,
        };
      }
    }

    // Try FCM first
    const fcmServiceAccountJson = Deno.env.get('FCM_SERVICE_ACCOUNT');
    let fcmResult: any = { ok: false };

    if (fcmServiceAccountJson && profile.fcm_token) {
      try {
        const serviceAccount = JSON.parse(fcmServiceAccountJson);
        fcmResult = await sendFcmMessage(serviceAccount, profile.fcm_token, {
          title: finalTitle,
          body: finalBody,
          data: finalData as Record<string, string>,
        });
      } catch (err) {
        console.warn('[fcm] message send failed:', err);
      }
    }

    // Fallback only — sending to both tokens caused double notifications
    let expoResult: any = null;
    if (!fcmResult.ok && profile.expo_push_token) {
      expoResult = await sendExpoPush(
        profile.expo_push_token,
        finalTitle,
        finalBody,
        finalData
      );
    }

    return new Response(
      JSON.stringify({
        fcm: fcmResult,
        expo: expoResult,
        locked: isLockedChat,
      }),
      {
        status: 200,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      }
    );
  } catch (error) {
    return new Response(JSON.stringify({ error: String(error) }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});
