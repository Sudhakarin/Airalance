// lib/notifications.ts
// In-app notification helpers (write to Supabase + REAL phone push)
// ✅ NEW: notifyUser now also sends a push to the phone (follow, connect request
//         accepted/declined, verified, status like/mention/reply …).
//         Before this it only wrote a row for the in-app bell list — nothing
//         ever reached the phone for those events.

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
 * Write an in-app notification for a user AND push it to their phone.
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

  // Phone push (fire and forget — never blocks or breaks the caller)
  try {
    supabase.functions
      .invoke('send-push', {
        body: {
          userId: opts.userId,
          title: opts.title,
          body: opts.body,
          data: { screen: 'notifications', type: opts.type },
        },
      })
      .catch((e: any) => console.warn('notifyUser push failed:', e));
  } catch (e) {
    console.warn('notifyUser push failed:', e);
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
