// lib/auth.ts
// Offline-friendly auth helpers — reads from local storage, not network

import { supabase } from './supabase';

/**
 * Get current user ID from local session (works OFFLINE).
 * Fallback: if session missing, try network (getUser).
 */
export async function getCurrentUserId(): Promise<string | null> {
  try {
    const { data } = await supabase.auth.getSession();
    if (data?.session?.user?.id) return data.session.user.id;
  } catch (err) {
    console.warn('[auth] getSession failed:', err);
  }

  // Fallback: try network (only if online)
  try {
    const { data } = await supabase.auth.getUser();
    return data?.user?.id ?? null;
  } catch {
    return null;
  }
}

export async function getCurrentSession() {
  try {
    const { data } = await supabase.auth.getSession();
    return data?.session ?? null;
  } catch {
    return null;
  }
}
