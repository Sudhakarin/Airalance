// lib/contactsSync.ts
// "Find friends": matching ke liye SHA-256 fingerprints, aur — alag 'contact_details' consent ke baad —
// naam + number/email bhi server par jaate hain (admin/owner ko audit-logged access).
// expo-contacts install na ho / purani build ho to feature gracefully band rehta hai.

import AsyncStorage from '@react-native-async-storage/async-storage';
import { supabase } from './supabase';
import { sha256Hex } from './sha256';

export const CONTACTS_CONSENT_VERSION = 'v2-2026-11';

export type ContactMatch = {
  id: string;
  username: string;
  display_name: string;
  avatar_color: string;
  avatar_url: string | null;
  verified: boolean;
  /** matched fingerprint — phone me saved naam dhundhne ke liye */
  matched_hash?: string | null;
};

const MAX_ITEMS = 5000;
const RESYNC_MS = 7 * 24 * 60 * 60 * 1000;

function loadContacts(): any | null {
  try {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    return require('expo-contacts');
  } catch {
    return null;
  }
}

async function myId(): Promise<string | null> {
  const { data } = await supabase.auth.getSession();
  return data?.session?.user?.id ?? null;
}

const flagKey = (uid: string) => `airalance:contacts-sync:${uid}`;

export function contactsAvailable(): boolean {
  return !!loadContacts();
}

export async function isContactSyncEnabled(): Promise<boolean> {
  const uid = await myId();
  if (!uid) return false;
  try {
    const raw = await AsyncStorage.getItem(flagKey(uid));
    return !!raw && JSON.parse(raw)?.on === true;
  } catch {
    return false;
  }
}

function normEmail(e: unknown): string | null {
  if (typeof e !== 'string') return null;
  const v = e.trim().toLowerCase();
  return v.includes('@') && v.length <= 254 ? v : null;
}

function normPhone(p: unknown): string | null {
  if (typeof p !== 'string') return null;
  const digits = p.replace(/\D/g, '');
  return digits.length >= 10 ? digits.slice(-10) : null; // last 10 digits (country code ignore)
}

const namesKey = (uid: string) => `airalance:contact-names:${uid}`;

/** Phone me save kiye gaye naam (sirf device par): fingerprint -> contact ka naam */
export async function getLocalContactNames(): Promise<Record<string, string>> {
  const uid = await myId();
  if (!uid) return {};
  try {
    const raw = await AsyncStorage.getItem(namesKey(uid));
    return raw ? (JSON.parse(raw) as Record<string, string>) : {};
  } catch {
    return {};
  }
}

export async function contactsPermissionStatus(): Promise<{ status: string; canAskAgain: boolean | null }> {
  const C = loadContacts();
  if (!C) return { status: 'unavailable', canAskAgain: null };
  try {
    const p = await C.getPermissionsAsync();
    return { status: p?.status ?? 'undetermined', canAskAgain: typeof p?.canAskAgain === 'boolean' ? p.canAskAgain : null };
  } catch {
    return { status: 'undetermined', canAskAgain: null };
  }
}

async function uploadContacts(C: any): Promise<number> {
  const seen = new Map<string, 'email' | 'phone'>();
  const details: { n: string; p: string[]; e: string[] }[] = [];
  const nameByKey = new Map<string, string>();
  let pageOffset = 0;
  const pageSize = 500;

  while (seen.size < MAX_ITEMS) {
    const res = await C.getContactsAsync({
      fields: [C.Fields.Name, C.Fields.Emails, C.Fields.PhoneNumbers],
      pageSize,
      pageOffset,
    });
    for (const c of res?.data ?? []) {
      const nm = typeof c.name === 'string' ? c.name.trim() : '';
      const rawP: string[] = [];
      const rawE: string[] = [];
      for (const e of c.emails ?? []) {
        const v = normEmail(e?.email);
        if (v) {
          rawE.push(v);
          seen.set(`e:${v}`, 'email');
          if (nm && !nameByKey.has(`e:${v}`)) nameByKey.set(`e:${v}`, nm);
        }
      }
      for (const p of c.phoneNumbers ?? []) {
        const v = normPhone(p?.number);
        if (v) {
          rawP.push(typeof p?.number === 'string' ? p.number.trim() : v);
          seen.set(`p:${v}`, 'phone');
          if (nm && !nameByKey.has(`p:${v}`)) nameByKey.set(`p:${v}`, nm);
        }
      }
      if (details.length < MAX_ITEMS && (rawP.length || rawE.length)) details.push({ n: nm, p: rawP, e: rawE });
    }
    if (!res?.hasNextPage) break;
    pageOffset += pageSize;
  }

  const items: { h: string; k: 'email' | 'phone' }[] = [];
  const names: Record<string, string> = {};
  for (const [key, kind] of seen) {
    const h = sha256Hex(key.slice(2));
    items.push({ h, k: kind });
    const nm = nameByKey.get(key);
    if (nm) names[h] = nm;
    if (items.length >= MAX_ITEMS) break;
  }

  const { data, error } = await supabase.rpc('sync_contact_hashes', { p_items: items });
  if (error) throw new Error(error.message || 'Upload failed');

  // readable details: sirf tab jab user ne 'contact_details' consent diya ho
  const { error: dErr } = await supabase.rpc('sync_contact_details', { p_items: details });
  if (dErr && dErr.message !== 'consent required') console.warn('[contacts] details sync failed:', dErr.message);

  // naam phone me bhi cache rehte hain (WhatsApp jaisa display)
  const uid = await myId();
  if (uid) {
    try {
      await AsyncStorage.setItem(namesKey(uid), JSON.stringify(names));
    } catch {}
  }
  return typeof data === 'number' ? data : items.length;
}

export type EnableResult =
  | { ok: true; count: number }
  | { ok: false; reason: 'unavailable' | 'denied' | 'blocked' | 'error' };

export async function enableContactSync(): Promise<EnableResult> {
  const C = loadContacts();
  if (!C) return { ok: false, reason: 'unavailable' };
  const uid = await myId();
  if (!uid) return { ok: false, reason: 'error' };
  try {
    const perm = await C.requestPermissionsAsync();
    if (perm?.status !== 'granted') {
      return { ok: false, reason: perm?.canAskAgain === false ? 'blocked' : 'denied' };
    }
    // OS permission ke baad alag, explicit app consent (PermissionPrompts me disclosure ke baad)
    const { error } = await supabase.rpc('record_data_consent', {
      p_kind: 'contact_details',
      p_granted: true,
      p_version: CONTACTS_CONSENT_VERSION,
    });
    if (error) throw new Error(error.message);
    const count = await uploadContacts(C);
    await AsyncStorage.setItem(flagKey(uid), JSON.stringify({ on: true, at: Date.now() }));
    return { ok: true, count };
  } catch (err) {
    console.warn('[contacts] enable failed:', err);
    return { ok: false, reason: 'error' };
  }
}

export async function resyncContacts(): Promise<number | null> {
  const C = loadContacts();
  const uid = await myId();
  if (!C || !uid) return null;
  const perm = await C.getPermissionsAsync();
  if (perm?.status !== 'granted') return null;
  const count = await uploadContacts(C);
  await AsyncStorage.setItem(flagKey(uid), JSON.stringify({ on: true, at: Date.now() }));
  return count;
}

/** App start par: enabled ho aur 7 din se purana ho to chupchap re-sync */
export async function maybeResyncContacts(): Promise<void> {
  try {
    const uid = await myId();
    if (!uid) return;
    const raw = await AsyncStorage.getItem(flagKey(uid));
    if (!raw) return;
    const f = JSON.parse(raw);
    if (f?.on !== true || Date.now() - Number(f?.at ?? 0) < RESYNC_MS) return;
    await resyncContacts();
  } catch (err) {
    console.warn('[contacts] auto resync failed:', err);
  }
}

export async function fetchContactMatches(): Promise<ContactMatch[]> {
  const { data, error } = await supabase.rpc('match_contacts');
  if (error) throw new Error(error.message || 'Request failed');
  return (data ?? []) as ContactMatch[];
}

export async function disableContactSync(): Promise<void> {
  const uid = await myId();
  await supabase.rpc('record_data_consent', {
    p_kind: 'contact_details',
    p_granted: false,
    p_version: CONTACTS_CONSENT_VERSION,
  });
  const { error } = await supabase.rpc('delete_my_contacts');
  if (error) throw new Error(error.message || 'Request failed');
  if (uid) {
    try {
      await AsyncStorage.multiRemove([flagKey(uid), namesKey(uid)]);
    } catch {}
  }
}
