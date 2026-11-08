// lib/admin.ts
// Admin / Management panel ke liye typed Supabase RPC wrappers.
// Security server par hai (admin.sql) — yahan ka role sirf UI dikhane ke liye hai.

import { supabase } from './supabase';

export type AdminRole = 'owner' | 'admin' | 'moderator';

export const VERIFICATION_BUCKET = 'verification-docs';

export function roleRank(r?: AdminRole | null): number {
  return r === 'owner' ? 3 : r === 'admin' ? 2 : r === 'moderator' ? 1 : 0;
}

export type AdminStats = {
  total: number;
  today: number;
  week: number;
  verified: number;
  banned: number;
  shadowbanned: number;
  restricted: number;
  pending: number;
  admins: number;
  signups: number[]; // last 7 days, oldest -> newest
};

export type UserFilter =
  | 'all'
  | 'verified'
  | 'unverified'
  | 'banned'
  | 'restricted'
  | 'shadowbanned'
  | 'admins';

export type AdminUserRow = {
  id: string;
  username: string;
  display_name: string;
  avatar_color: string;
  avatar_url: string | null;
  verified: boolean;
  email: string | null;
  created_at: string | null;
  messaging_restricted: boolean;
  feature_restricted: boolean;
  shadowbanned: boolean;
  account_locked: boolean;
  ban_reason: string | null;
  admin_role: AdminRole | null;
};

export type AdminUserDetail = {
  profile: {
    id: string;
    username: string;
    display_name: string;
    avatar_color: string;
    avatar_url: string | null;
    verified: boolean | null;
    bio: string | null;
    created_at: string | null;
    messaging_restricted: boolean | null;
    feature_restricted: boolean | null;
    shadowbanned: boolean | null;
    account_locked: boolean | null;
    ban_reason: string | null;
    banned_at: string | null;
  };
  email: string | null;
  last_sign_in_at: string | null;
  banned_until: string | null;
  admin_role: AdminRole | null;
  requests: {
    id: string;
    status: string;
    created_at: string;
    reviewed_at: string | null;
    review_note: string | null;
  }[];
  log: {
    action: string;
    details: Record<string, any> | null;
    created_at: string;
    admin_username: string | null;
  }[];
};

export type RequestStatus = 'pending' | 'approved' | 'rejected' | 'all';

export type VerificationRequestRow = {
  id: string;
  user_id: string;
  full_name: string | null;
  age: number | null;
  nationality: string | null;
  about: string | null;
  links: string | null;
  selfie_path: string | null;
  status: string;
  created_at: string;
  review_note: string | null;
  reviewed_at: string | null;
  username: string | null;
  display_name: string | null;
  avatar_color: string | null;
  avatar_url: string | null;
  email: string | null;
  verified: boolean;
};

export type AdminMember = {
  user_id: string;
  role: AdminRole;
  username: string | null;
  display_name: string | null;
  email: string | null;
  avatar_color: string | null;
  avatar_url: string | null;
  created_at: string;
};

export type AuditEntry = {
  id: number;
  action: string;
  details: Record<string, any> | null;
  created_at: string;
  admin_username: string | null;
  target_id: string | null;
  target_username: string | null;
};

export type UserFlag = 'messaging_restricted' | 'feature_restricted' | 'shadowbanned';

async function rpc<T>(fn: string, args?: Record<string, unknown>): Promise<T> {
  const { data, error } = await supabase.rpc(fn, args as any);
  if (error) throw new Error(error.message || 'Request failed');
  return data as T;
}

export function errMsg(e: unknown): string {
  const m = (e as any)?.message;
  if (typeof m === 'string' && m.length > 0) {
    if (m === 'not authorized') return 'You are not allowed to do this.';
    return m.charAt(0).toUpperCase() + m.slice(1);
  }
  return 'Something went wrong. Please try again.';
}

/** Throws on network error (taaki cached role wipe na ho). null = admin nahi hai. */
export async function fetchAdminRole(): Promise<AdminRole | null> {
  const r = await rpc<string | null>('admin_role');
  return r === 'owner' || r === 'admin' || r === 'moderator' ? r : null;
}

export const adminStats = () => rpc<AdminStats>('admin_stats');

export const adminListUsers = (
  search: string,
  filter: UserFilter,
  limit: number,
  offset: number
) =>
  rpc<AdminUserRow[]>('admin_list_users', {
    p_search: search.trim() || null,
    p_filter: filter,
    p_limit: limit,
    p_offset: offset,
  });

export const adminGetUser = (userId: string) =>
  rpc<AdminUserDetail>('admin_get_user', { p_user_id: userId });

export const adminSetVerified = (userId: string, verified: boolean) =>
  rpc<void>('admin_set_verified', { p_user_id: userId, p_verified: verified });

export const adminSetFlag = (
  userId: string,
  flag: UserFlag,
  value: boolean,
  reason?: string
) =>
  rpc<void>('admin_set_flag', {
    p_user_id: userId,
    p_flag: flag,
    p_value: value,
    p_reason: reason ?? null,
  });

export const adminBanUser = (userId: string, banned: boolean, reason?: string) =>
  rpc<void>('admin_ban_user', {
    p_user_id: userId,
    p_banned: banned,
    p_reason: reason ?? null,
  });

export const adminListRequests = (status: RequestStatus, limit: number, offset: number) =>
  rpc<VerificationRequestRow[]>('admin_list_requests', {
    p_status: status,
    p_limit: limit,
    p_offset: offset,
  });

export const adminReviewRequest = (requestId: string, approve: boolean, note?: string) =>
  rpc<void>('admin_review_request', {
    p_request_id: requestId,
    p_approve: approve,
    p_note: note ?? null,
  });

export const adminListAdmins = () => rpc<AdminMember[]>('admin_list_admins');

export const adminAddAdmin = (identifier: string, role: 'admin' | 'moderator') =>
  rpc<void>('admin_add_admin', { p_identifier: identifier, p_role: role });

export const adminRemoveAdmin = (userId: string) =>
  rpc<void>('admin_remove_admin', { p_user_id: userId });

export const adminAuditLog = (limit: number, offset: number) =>
  rpc<AuditEntry[]>('admin_get_audit_log', { p_limit: limit, p_offset: offset });

/** Private bucket ki selfie ka temporary link (10 min) */
export async function getSelfieUrl(path: string): Promise<string | null> {
  try {
    const { data, error } = await supabase.storage
      .from(VERIFICATION_BUCKET)
      .createSignedUrl(path, 600);
    if (error) return null;
    return data?.signedUrl ?? null;
  } catch {
    return null;
  }
}
