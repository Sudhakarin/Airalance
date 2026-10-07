// lib/call.ts
// Supabase signaling for WebRTC calls — create/accept/reject/end + realtime + call log

import { supabase } from './supabase';

export type CallStatus =
  | 'ringing'
  | 'accepted'
  | 'rejected'
  | 'ended'
  | 'missed'
  | 'cancelled';

export type CallType = 'audio' | 'video';

export type Call = {
  id: string;
  caller_id: string;
  receiver_id: string;
  call_type: CallType;
  status: CallStatus;
  offer: any | null;
  answer: any | null;
  started_at: string;
  accepted_at: string | null;
  ended_at: string | null;
  duration_seconds: number | null;
  ended_by: string | null;
  created_at: string;
};

// Call log status (what we store inside messages.content JSON)
export type CallLogStatus = 'answered' | 'missed' | 'declined' | 'cancelled';

// ============================================================
// Create a new call (caller side)
// ============================================================

export async function createCall(
  callerId: string,
  receiverId: string,
  callType: CallType,
  offer: any
): Promise<Call> {
  const { data, error } = await supabase
    .from('calls')
    .insert({
      caller_id: callerId,
      receiver_id: receiverId,
      call_type: callType,
      status: 'ringing',
      offer,
    })
    .select()
    .single();

  if (error) throw error;
  return data as Call;
}

// ============================================================
// Accept call (receiver side) — sets answer SDP
// ============================================================

export async function acceptCall(
  callId: string,
  answer: any
): Promise<void> {
  const { error } = await supabase
    .from('calls')
    .update({
      status: 'accepted',
      answer,
      accepted_at: new Date().toISOString(),
    })
    .eq('id', callId);

  if (error) throw error;
}

// ============================================================
// Reject / Cancel / End
// ============================================================

export async function rejectCall(callId: string): Promise<void> {
  const { error } = await supabase
    .from('calls')
    .update({
      status: 'rejected',
      ended_at: new Date().toISOString(),
    })
    .eq('id', callId);

  if (error) throw error;
}

export async function cancelCall(
  callId: string,
  callerId: string
): Promise<void> {
  const { error } = await supabase
    .from('calls')
    .update({
      status: 'cancelled',
      ended_at: new Date().toISOString(),
      ended_by: callerId,
    })
    .eq('id', callId);

  if (error) throw error;
}

export async function endCall(
  callId: string,
  userId: string
): Promise<void> {
  // Fetch call to compute duration
  const { data: call } = await supabase
    .from('calls')
    .select('accepted_at')
    .eq('id', callId)
    .single();

  const endedAt = new Date();
  let duration: number | null = null;
  if (call?.accepted_at) {
    duration = Math.round(
      (endedAt.getTime() - new Date(call.accepted_at).getTime()) / 1000
    );
  }

  const { error } = await supabase
    .from('calls')
    .update({
      status: 'ended',
      ended_at: endedAt.toISOString(),
      ended_by: userId,
      duration_seconds: duration,
    })
    .eq('id', callId);

  if (error) throw error;
}

// ============================================================
// Fetch single call
// ============================================================

export async function getCall(callId: string): Promise<Call | null> {
  const { data, error } = await supabase
    .from('calls')
    .select('*')
    .eq('id', callId)
    .single();

  if (error) return null;
  return data as Call;
}

// ============================================================
// Call history
// ============================================================

export async function getCallHistory(userId: string): Promise<Call[]> {
  const { data, error } = await supabase
    .from('calls')
    .select('*')
    .or(`caller_id.eq.${userId},receiver_id.eq.${userId}`)
    .order('created_at', { ascending: false })
    .limit(50);

  if (error) return [];
  return (data ?? []) as Call[];
}

// ============================================================
// Realtime — subscribe to a specific call's updates
// ============================================================

export function subscribeToCall(
  callId: string,
  onUpdate: (call: Call) => void
) {
  const channel = supabase
    .channel(`call:${callId}`)
    .on(
      'postgres_changes',
      {
        event: 'UPDATE',
        schema: 'public',
        table: 'calls',
        filter: `id=eq.${callId}`,
      },
      (payload) => {
        onUpdate(payload.new as Call);
      }
    )
    .subscribe();

  return () => {
    supabase.removeChannel(channel);
  };
}

// ============================================================
// Realtime — subscribe to incoming calls for a user (as receiver)
// ============================================================

export function subscribeToIncomingCalls(
  userId: string,
  onIncoming: (call: Call) => void
) {
  const channel = supabase
    .channel(`incoming-calls:${userId}`)
    .on(
      'postgres_changes',
      {
        event: 'INSERT',
        schema: 'public',
        table: 'calls',
        filter: `receiver_id=eq.${userId}`,
      },
      (payload) => {
        const call = payload.new as Call;
        if (call.status === 'ringing') {
          onIncoming(call);
        }
      }
    )
    .subscribe();

  return () => {
    supabase.removeChannel(channel);
  };
}

// ============================================================
// Find direct (1-on-1) conversation between two users
// (fallback — normally caller passes conversationId directly)
// ============================================================

async function findDirectConversation(
  userA: string,
  userB: string
): Promise<string | null> {
  try {
    // 1) Get all conversation ids for userA
    const { data: myConvs } = await supabase
      .from('conversation_participants')
      .select('conversation_id')
      .eq('user_id', userA);

    if (!myConvs || myConvs.length === 0) return null;
    const ids = myConvs.map((c: any) => c.conversation_id);

    // 2) Among those, find ones where userB is also a participant
    const { data: matches } = await supabase
      .from('conversation_participants')
      .select('conversation_id')
      .in('conversation_id', ids)
      .eq('user_id', userB);

    if (!matches || matches.length === 0) return null;

    // 3) Return the first one that is a direct (non-group) conversation
    for (const m of matches as any[]) {
      const { data: conv } = await supabase
        .from('conversations')
        .select('id, is_group')
        .eq('id', m.conversation_id)
        .single();

      if (conv && !conv.is_group) return conv.id as string;
    }
    return null;
  } catch (e) {
    console.warn('[call] findDirectConversation failed:', e);
    return null;
  }
}

// ============================================================
// Insert a WhatsApp-style call log into the chat (messages table)
// ------------------------------------------------------------
// - sender_id is always the caller (so direction = sender_id === me)
// - content is JSON: { call_id, call_type, status, duration_seconds }
// - message_type = 'call'
// - conversationId is REQUIRED (passed from chat screen). Fallback lookup
//   is best-effort only — may fail if RLS is restrictive.
// - Returns true if the log was inserted, false otherwise.
// ============================================================

export async function insertCallLog(params: {
  callId: string;
  conversationId: string | null;
  callerId: string;
  receiverId: string;
  callType: CallType;
  status: CallLogStatus;
  durationSeconds: number | null;
}): Promise<boolean> {
  const {
    callId,
    conversationId,
    callerId,
    receiverId,
    callType,
    status,
    durationSeconds,
  } = params;

  try {
    let convId = conversationId;

    // Fallback lookup if conversationId not provided
    if (!convId) {
      convId = await findDirectConversation(callerId, receiverId);
    }

    if (!convId) {
      console.warn(
        '[call] insertCallLog: no conversationId — cannot insert call log'
      );
      return false;
    }

    const content = JSON.stringify({
      call_id: callId,
      call_type: callType,
      status,
      duration_seconds: durationSeconds ?? 0,
    });

    const { error } = await supabase.from('messages').insert({
      conversation_id: convId,
      sender_id: callerId,
      content,
      message_type: 'call',
    });

    if (error) {
      console.warn('[call] insertCallLog failed:', error.message, error);
      return false;
    }

    console.log('[call] ✅ call log inserted:', callId, status);
    return true;
  } catch (e) {
    console.warn('[call] insertCallLog error:', e);
    return false;
  }
}
