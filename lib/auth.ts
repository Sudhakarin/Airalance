// lib/auth.ts
// Offline-friendly auth helpers — reads from local storage, not network
// ✅ FIX: In-memory cache + no aggressive network fallback
// ✅ FIX: Parallel calls share same promise (no duplicate work)
// ✅ FIX: Cold start never blocks on network

import { supabase } from './supabase';

// ✅ In-memory cache — survives across all getCurrentUserId() calls
let cachedUserId: string | null = null;
let cacheInitialized = false;
let initPromise: Promise<string | null> | null = null;

/**
 * Get current user ID.
 * - Reads from LOCAL session (fast, offline-friendly)
 * - Caches result in memory — subsequent calls are instant (0ms)
 * - NEVER falls back to network (that was causing 2-3s cold-start lag)
 * - If session is null, returns null immediately — auth listener will update cache later
 */
export async function getCurrentUserId(): Promise<string | null> {
  // ✅ Fast path — instant return if cache ready
  if (cacheInitialized) return cachedUserId;

  // ✅ Dedupe — parallel calls share the same promise
  if (initPromise) return initPromise;

  initPromise = (async () => {
    try {
      const { data } = await supabase.auth.getSession();
      if (data?.session?.user?.id) {
        cachedUserId = data.session.user.id;
        cacheInitialized = true;
        return cachedUserId;
      }
    } catch (err) {
      console.warn('[auth] getSession failed:', err);
    }

    // ✅ Session null → don't hit network. Return null now.
    // onAuthStateChange will fire and call setUserIdCache() when session is ready.
    cachedUserId = null;
    cacheInitialized = true;
    return null;
  })();

  try {
    return await initPromise;
  } finally {
    // Allow the same promise to be reused for a short window (parallel calls)
    setTimeout(() => {
      initPromise = null;
    }, 50);
  }
}

/**
 * Set userId explicitly — call this from supabase.auth.onAuthStateChange
 * (in _layout.tsx)
 */
export function setUserIdCache(id: string | null) {
  cachedUserId = id;
  cacheInitialized = true;
  initPromise = null;
}

/**
 * Invalidate cache — call on logout
 */
export function invalidateUserIdCache() {
  cachedUserId = null;
  cacheInitialized = false;
  initPromise = null;
}

export async function getCurrentSession() {
  try {
    const { data } = await supabase.auth.getSession();
    return data?.session ?? null;
  } catch {
    return null;
  }
}
