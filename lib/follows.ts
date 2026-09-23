// lib/follows.ts
// Follow / connection helpers

import { supabase } from './supabase';

/**
 * Check if current user follows a specific user.
 */
export async function isFollowing(targetUserId: string): Promise<boolean> {
  const { data: auth } = await supabase.auth.getUser();
  if (!auth.user) return false;
  const { data } = await supabase
    .from('follows')
    .select('follower_id')
    .eq('follower_id', auth.user.id)
    .eq('followed_id', targetUserId)
    .maybeSingle();
  return !!data;
}

/**
 * Follow a user.
 */
export async function followUser(targetUserId: string): Promise<boolean> {
  const { data: auth } = await supabase.auth.getUser();
  if (!auth.user) return false;
  const { error } = await supabase
    .from('follows')
    .insert({ follower_id: auth.user.id, followed_id: targetUserId });
  return !error;
}

/**
 * Unfollow a user.
 */
export async function unfollowUser(targetUserId: string): Promise<boolean> {
  const { data: auth } = await supabase.auth.getUser();
  if (!auth.user) return false;
  const { error } = await supabase
    .from('follows')
    .delete()
    .eq('follower_id', auth.user.id)
    .eq('followed_id', targetUserId);
  return !error;
}

/**
 * Get follower/following counts for a user.
 */
export async function getFollowCounts(userId: string) {
  const [f1, f2] = await Promise.all([
    supabase
      .from('follows')
      .select('follower_id', { count: 'exact', head: true })
      .eq('followed_id', userId),
    supabase
      .from('follows')
      .select('followed_id', { count: 'exact', head: true })
      .eq('follower_id', userId),
  ]);
  return {
    followers: f1.count ?? 0,
    following: f2.count ?? 0,
  };
}

/**
 * Get list of followers (user IDs → profiles).
 */
export async function getFollowers(userId: string) {
  const { data: rows } = await supabase
    .from('follows')
    .select('follower_id')
    .eq('followed_id', userId);
  const ids = (rows ?? []).map((r: any) => r.follower_id);
  if (ids.length === 0) return [];
  const { data: profiles } = await supabase
    .from('profiles')
    .select('*')
    .in('id', ids);
  return profiles ?? [];
}

/**
 * Get list of following (user IDs → profiles).
 */
export async function getFollowing(userId: string) {
  const { data: rows } = await supabase
    .from('follows')
    .select('followed_id')
    .eq('follower_id', userId);
  const ids = (rows ?? []).map((r: any) => r.followed_id);
  if (ids.length === 0) return [];
  const { data: profiles } = await supabase
    .from('profiles')
    .select('*')
    .in('id', ids);
  return profiles ?? [];
}

/**
 * Check connection status between current user and another user.
 */
export async function getConnectionStatus(
  otherUserId: string
): Promise<'none' | 'pending' | 'connected' | 'declined'> {
  const { data: auth } = await supabase.auth.getUser();
  if (!auth.user) return 'none';
  const myId = auth.user.id;

  // Check shared conversation
  const { data: mine } = await supabase
    .from('conversation_participants')
    .select('conversation_id')
    .eq('user_id', myId);
  const myConvoIds = (mine ?? []).map((r: any) => r.conversation_id);

  if (myConvoIds.length > 0) {
    const { data: shared } = await supabase
      .from('conversation_participants')
      .select('conversation_id')
      .eq('user_id', otherUserId)
      .in('conversation_id', myConvoIds);
    if (shared && shared.length > 0) return 'connected';
  }

  // Check connection request
  const { data: req } = await supabase
    .from('connection_requests')
    .select('status')
    .or(
      `and(from_user_id.eq.${myId},to_user_id.eq.${otherUserId}),and(from_user_id.eq.${otherUserId},to_user_id.eq.${myId})`
    )
    .maybeSingle();

  if (req) {
    if (req.status === 'accepted') return 'connected';
    if (req.status === 'pending') return 'pending';
    if (req.status === 'declined') return 'declined';
  }
  return 'none';
}
