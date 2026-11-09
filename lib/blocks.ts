// lib/blocks.ts
// Do users ke beech block ka status (dono taraf se).

import { supabase } from './supabase';

export type BlockStatus = {
  /** Maine us user ko block kiya hai */
  i_blocked: boolean;
  /** Us user ne mujhe block kiya hai */
  blocked_me: boolean;
};

export async function fetchBlockStatus(userId: string): Promise<BlockStatus> {
  const { data, error } = await supabase.rpc('get_block_status', { p_user: userId });
  if (error) throw new Error(error.message || 'Request failed');
  return { i_blocked: !!data?.i_blocked, blocked_me: !!data?.blocked_me };
}
