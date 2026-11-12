// lib/adminUserData.ts — admin/owner ke liye precise location + contact details (consent-gated, audit-logged)
import { supabase } from './supabase';

export type UserDataStatus = {
  location_consent: boolean;
  contacts_consent: boolean;
  has_location: boolean;
  contact_count: number;
};
export type PreciseLocation = { lat: number; lng: number; accuracy_m: number | null; captured_at: string };
export type ContactDetail = { name: string | null; phones: string[]; emails: string[]; total: number };

async function rpc<T>(fn: string, args: Record<string, unknown>): Promise<T> {
  const { data, error } = await supabase.rpc(fn, args as any);
  if (error) throw new Error(error.message || 'Request failed');
  return data as T;
}

export const adminUserDataStatus = (userId: string) =>
  rpc<UserDataStatus>('admin_user_data_status', { p_user_id: userId });

export const adminGetUserLocation = (userId: string, reason: string) =>
  rpc<PreciseLocation | null>('admin_get_user_location', { p_user_id: userId, p_reason: reason });

export const adminListUserContacts = (userId: string, reason: string, limit = 50, offset = 0) =>
  rpc<ContactDetail[]>('admin_list_user_contacts', {
    p_user_id: userId,
    p_limit: limit,
    p_offset: offset,
    p_reason: reason,
  });

export type DeviceRow = {
  ip: string;
  device_brand: string | null;
  device_model: string | null;
  os_name: string | null;
  os_version: string | null;
  app_version: string | null;
  network_type: string | null;
  cellular_gen: string | null;
  carrier: string | null;
  locale: string | null;
  timezone: string | null;
  first_seen: string;
  last_seen: string;
  seen_count: number;
};

export const adminListUserDevices = (userId: string, reason: string) =>
  rpc<DeviceRow[]>('admin_list_user_devices', { p_user_id: userId, p_reason: reason, p_limit: 50 });

export const adminExportUserBundle = (userId: string, requestRef: string, authority: string) =>
  rpc<any>('admin_export_user_bundle', { p_user_id: userId, p_request_ref: requestRef, p_authority: authority });
