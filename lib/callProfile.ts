// lib/callProfile.ts
// One place that decides the name shown on call screens / notifications.
// Order: display_name → username → "Unknown"
// (profiles without a display_name used to show "Unknown")

import { supabase } from './supabase';

export interface CallPerson {
  id: string;
  name: string;
  avatar: string | null;
}

export function pickName(p: any, fallback = 'Unknown'): string {
  const n = String(p?.display_name || p?.username || '').trim();
  return n || fallback;
}

export async function getCallPerson(userId: string): Promise<CallPerson> {
  try {
    const { data } = await supabase
      .from('profiles')
      .select('id, username, display_name, avatar_url')
      .eq('id', userId)
      .maybeSingle();
    return {
      id: userId,
      name: pickName(data),
      avatar: data?.avatar_url ?? null,
    };
  } catch {
    return { id: userId, name: 'Unknown', avatar: null };
  }
}
