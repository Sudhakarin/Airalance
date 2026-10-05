// supabase/functions/send-push/index.ts
// Push notification bhejne wali Edge Function (locked chat + call support)

import { serve } from 'https://deno.land/std@0.177.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const EXPO_PUSH_URL = 'https://exp.host/--/api/v2/push/send';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers':
    'authorization, x-client-info, apikey, content-type',
};

serve(async (req) => {
  // CORS preflight
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  try {
    const body_json = await req.json();
    const { userId, title, body, data } = body_json;

    if (!userId || !title || !body) {
      return new Response(
        JSON.stringify({ error: 'userId, title, body required' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // Supabase client with service role
    const supabase = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
    );

    // Get user's push token
    const { data: profile, error: profileError } = await supabase
      .from('profiles')
      .select('expo_push_token')
      .eq('id', userId)
      .single();

    if (profileError || !profile?.expo_push_token) {
      return new Response(
        JSON.stringify({ error: 'No push token for user' }),
        { status: 404, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // ============================================================
    // CALL NOTIFICATION (incoming call)
    // ============================================================
    if (data?.screen === 'call' && data?.callId) {
      const payload = {
        to: profile.expo_push_token,
        sound: 'default',
        title,
        body,
        priority: 'high',
        channelId: 'calls', // Android high-priority channel
        categoryId: 'incoming_call', // iOS category
        vibrate: [0, 1000, 1000, 1000],
        interruptionLevel: 'timeSensitive', // iOS 15+ — breaks through DND
        ttl: 60, // call notification expires after 60 sec (matches ring timeout)
        data: {
          screen: 'call',
          callId: data.callId,
          callerId: data.callerId,
          callType: data.callType,
          role: 'receiver',
        },
      };

      const response = await fetch(EXPO_PUSH_URL, {
        method: 'POST',
        headers: {
          Accept: 'application/json',
          'Accept-Encoding': 'gzip, deflate',
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(payload),
      });

      const result = await response.json();
      return new Response(JSON.stringify({ ...result, type: 'call' }), {
        status: 200,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    // ============================================================
    // CHAT MESSAGE (existing logic + locked chat handling)
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

    // Send push via Expo
    const response = await fetch(EXPO_PUSH_URL, {
      method: 'POST',
      headers: {
        Accept: 'application/json',
        'Accept-Encoding': 'gzip, deflate',
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        to: profile.expo_push_token,
        sound: 'default',
        title: finalTitle,
        body: finalBody,
        data: finalData,
      }),
    });

    const result = await response.json();

    return new Response(
      JSON.stringify({
        ...result,
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
