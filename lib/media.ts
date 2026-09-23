// lib/media.ts
// Media upload helpers — images, voice notes, statuses

import { supabase } from './supabase';
import { CONSTANTS } from '../constants/theme';

/**
 * Upload a file (image/audio/video) to a Supabase storage bucket.
 * Returns the public URL of the uploaded file.
 */
export async function uploadFile(opts: {
  bucket: string;
  path: string;
  uri: string;
  contentType?: string;
}): Promise<string> {
  const { bucket, path, uri, contentType } = opts;

  const response = await fetch(uri);
  const arrayBuffer = await response.arrayBuffer();

  const { error } = await supabase.storage
    .from(bucket)
    .upload(path, arrayBuffer, {
      contentType: contentType ?? 'application/octet-stream',
      upsert: true,
    });

  if (error) throw error;

  const { data } = supabase.storage.from(bucket).getPublicUrl(path);
  return data.publicUrl;
}

/**
 * Upload an image to the chat media bucket.
 * Path: <conversationId>/<userId>-<timestamp>.<ext>
 */
export async function uploadChatImage(opts: {
  conversationId: string;
  userId: string;
  uri: string;
  mimeType?: string;
}): Promise<string> {
  const { conversationId, userId, uri, mimeType } = opts;
  const ext = (uri.split('.').pop() ?? 'jpg').toLowerCase().slice(0, 5);
  const path = `${conversationId}/${userId}-${Date.now()}.${ext}`;
  return uploadFile({
    bucket: CONSTANTS.CHAT_MEDIA_BUCKET,
    path,
    uri,
    contentType: mimeType ?? 'image/jpeg',
  });
}

/**
 * Upload a voice note to the chat media bucket.
 */
export async function uploadVoiceNote(opts: {
  conversationId: string;
  userId: string;
  uri: string;
  mimeType?: string;
}): Promise<string> {
  const { conversationId, userId, uri, mimeType } = opts;
  const path = `${conversationId}/${userId}-${Date.now()}.m4a`;
  return uploadFile({
    bucket: CONSTANTS.CHAT_MEDIA_BUCKET,
    path,
    uri,
    contentType: mimeType ?? 'audio/m4a',
  });
}

/**
 * Upload a status media (image or video).
 */
export async function uploadStatusMedia(opts: {
  userId: string;
  uri: string;
  mimeType?: string;
}): Promise<string> {
  const { userId, uri, mimeType } = opts;
  const ext = (uri.split('.').pop() ?? 'jpg').toLowerCase().slice(0, 5);
  const path = `${userId}/${Date.now()}.${ext}`;
  return uploadFile({
    bucket: CONSTANTS.STATUS_MEDIA_BUCKET,
    path,
    uri,
    contentType: mimeType ?? 'image/jpeg',
  });
}

/**
 * Upload a user avatar.
 */
export async function uploadAvatar(opts: {
  userId: string;
  uri: string;
  mimeType?: string;
}): Promise<string> {
  const { userId, uri, mimeType } = opts;
  const ext = (uri.split('.').pop() ?? 'jpg').toLowerCase().slice(0, 5);
  const path = `${userId}/avatar-${Date.now()}.${ext}`;
  return uploadFile({
    bucket: 'avatars',
    path,
    uri,
    contentType: mimeType ?? 'image/jpeg',
  });
}
