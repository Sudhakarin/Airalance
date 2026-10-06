// supabase/functions/send-push/index.ts
// Push notification bhejne wali Edge Function (FCM V1 API + Expo fallback)
// ✅ Supports: chat messages, locked chats, incoming calls (data message)

import { serve } from 'https://deno.land/std@0.177.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import { SignJWT, importPKCS8 } from 'https://deno.land/x/jose@v5.2.0/index.ts';

const EXPO_PUSH_URL = 'https://exp.host/--/api/v2/push/send';

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
  // Cache token (valid ~1 hour)
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
    isCall?: boolean;
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

    if (message.isCall) {
      // High-priority data-only message for calls (triggers background handler)
      fcmPayload.message.android = {
        priority: 'HIGH',
        ttl: '60s',
      };
      fcmPayload.message.apns = {
        headers: {
          'apns-priority': '10',
          'apns-push-type': 'voip',
        },
        payload: {
          aps: {
            'content-available': 1,
            'interruption-level': 'time-sensitive',
          },
        },
      };
    } else {
      // Regular notification
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
  const response = await fetch(EXPO_PUSH_URL, {
    method: 'POST',
    headers: {
      Accept: 'application/json',
      'Accept-Encoding': 'gzip, deflate',
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      to: expoToken,
      sound: 'default',
      title,
      body,
      data,
      priority: data?.screen === 'call' ? 'high' : 'default',
      channelId: data?.screen === 'call' ? 'calls' : 'default',
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
    // CALL — FCM data message (triggers CallKeep in background)
    // ============================================================
    if (data?.screen === 'call' && data?.callId) {
      const fcmServiceAccountJson = Deno.env.get('FCM_SERVICE_ACCOUNT');
      let fcmResult: any = { ok: false };
      let expoResult: any = null;

      if (fcmServiceAccountJson && profile.fcm_token) {
        try {
          const serviceAccount = JSON.parse(fcmServiceAccountJson);
          fcmResult = await sendFcmMessage(serviceAccount, profile.fcm_token, {
            title,
            body,
            isCall: true,
            data: {
              screen: 'call',
              callId: String(data.callId),
              callerId: String(data.callerId),
              callType: String(data.callType),
              role: 'receiver',
            },
          });
        } catch (err) {
          console.warn('[fcm] call send failed:', err);
        }
      }

      // Fallback to Expo (works when app is foreground/background)
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

    // Fallback / parallel — Expo
    let expoResult: any = null;
    if (profile.expo_push_token) {
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
