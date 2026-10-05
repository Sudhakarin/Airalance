// lib/call.ts
// Supabase signaling for WebRTC calls — create/accept/reject/end + realtime

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
