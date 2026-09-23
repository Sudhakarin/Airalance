// lib/notifications.ts
// In-app notification helpers (write to Supabase + optional push)

import { supabase } from './supabase';

type NotificationType =
  | 'request_accepted'
  | 'request_declined'
  | 'verified'
  | 'message'
  | 'status_like'
  | 'status_mention'
  | 'status_reply'
  | 'follow';

/**
 * Write an in-app notification for a user.
 * Skips if the target is the current user (to avoid self-notifications).
 */
export async function notifyUser(opts: {
  userId?: string | null;
  fromUserId?: string | null;
  type: NotificationType;
  title: string;
  body: string;
}): Promise<void> {
  if (!opts.userId || !opts.fromUserId) return;
  if (opts.userId === opts.fromUserId) return;

  try {
    await supabase.from('app_notifications').insert({
      user_id: opts.userId,
      actor_id: opts.fromUserId,
      type: opts.type,
      title: opts.title,
      body: opts.body,
    });
  } catch (e) {
    console.warn('notifyUser failed:', e);
  }
}

/**
 * Mark all notifications as read for the current user.
 */
export async function markAllRead(): Promise<void> {
  const { data } = await supabase.auth.getUser();
  if (!data.user) return;
  await supabase
    .from('app_notifications')
    .update({ read: true })
    .eq('user_id', data.user.id)
    .eq('read', false);
}

/**
 * Delete a single notification.
 */
export async function deleteNotification(
  notificationId: string
): Promise<void> {
  await supabase.from('app_notifications').delete().eq('id', notificationId);
}
