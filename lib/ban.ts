// lib/ban.ts
// Banned user ke liye: apna ban status lo aur appeal bhejo.

import { supabase } from './supabase';

export type BanStatus = {
  banned: boolean;
  username?: string | null;
  reason?: string | null;
  category?: string | null;
  banned_at?: string | null;
  ban_until?: string | null; // null = permanent
  ref?: string;
  appeal_status?: 'pending' | 'approved' | 'rejected' | null;
  appeal_note?: string | null;
  appeal_at?: string | null;
  can_appeal?: boolean;
};

export async function fetchMyBanStatus(): Promise<BanStatus> {
  const { data, error } = await supabase.rpc('my_ban_status');
  if (error) throw new Error(error.message || 'Request failed');
  return (data ?? { banned: false }) as BanStatus;
}

export async function submitBanAppeal(message: string): Promise<void> {
  const { error } = await supabase.rpc('submit_ban_appeal', { p_message: message });
  if (error) throw new Error(error.message || 'Request failed');
}
