// lib/userLocation.ts
// Personalised news ke liye precise location (GPS) se area nikalta hai: city + locality + postal code.
// Server par sirf ye area save hota hai — exact coordinates kahin store nahi hote. expo-location install na ho to feature band rehta hai.
//
// News screen me use:   const region = await getNewsRegion();   // { city, region, country, country_code } | null

import AsyncStorage from '@react-native-async-storage/async-storage';
import { supabase } from './supabase';

export type UserLocation = {
  city: string | null;
  district: string | null;
  postal_code: string | null;
  region: string | null;
  country: string | null;
  country_code: string | null;
  at: number;
};

const REFRESH_MS = 12 * 60 * 60 * 1000;

function loadLocationModule(): any | null {
  try {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    return require('expo-location');
  } catch {
    return null;
  }
}

async function myId(): Promise<string | null> {
  const { data } = await supabase.auth.getSession();
  return data?.session?.user?.id ?? null;
}

const key = (uid: string) => `airalance:location:${uid}`;

export function locationAvailable(): boolean {
  return !!loadLocationModule();
}

export async function getCachedLocation(): Promise<UserLocation | null> {
  const uid = await myId();
  if (!uid) return null;
  try {
    const raw = await AsyncStorage.getItem(key(uid));
    return raw ? (JSON.parse(raw) as UserLocation) : null;
  } catch {
    return null;
  }
}

/** News ke liye: user ka region (agar usne location on ki hai) */
export async function getNewsRegion(): Promise<UserLocation | null> {
  return getCachedLocation();
}

async function getPosition(L: any): Promise<any> {
  try {
    // fresh GPS fix (Balanced ~ 100 m)
    const cur = await Promise.race([
      L.getCurrentPositionAsync({ accuracy: L.Accuracy?.Balanced ?? 3 }),
      new Promise((_, rej) => setTimeout(() => rej(new Error('timeout')), 12000)),
    ]);
    if (cur) return cur;
  } catch {}
  const last = await L.getLastKnownPositionAsync?.({ maxAge: 10 * 60 * 1000 });
  if (last) return last;
  throw new Error('no position');
}

export async function locationPermissionStatus(): Promise<{ status: string; canAskAgain: boolean | null }> {
  const L = loadLocationModule();
  if (!L) return { status: 'unavailable', canAskAgain: null };
  try {
    const p = await L.getForegroundPermissionsAsync();
    return { status: p?.status ?? 'undetermined', canAskAgain: typeof p?.canAskAgain === 'boolean' ? p.canAskAgain : null };
  } catch {
    return { status: 'undetermined', canAskAgain: null };
  }
}

async function resolveAndSave(L: any, uid: string): Promise<UserLocation> {
  const pos = await getPosition(L);
  const { latitude, longitude } = pos.coords;
  const geo = (await L.reverseGeocodeAsync({ latitude, longitude }))?.[0] ?? {};

  const loc: UserLocation = {
    city: geo.city || geo.subregion || null,
    district: geo.district || null,
    postal_code: geo.postalCode || null,
    region: geo.region || null,
    country: geo.country || null,
    country_code: geo.isoCountryCode || null,
    at: Date.now(),
  };

  const { error } = await supabase.rpc('set_my_location', {
    p_city: loc.city,
    p_region: loc.region,
    p_country: loc.country,
    p_country_code: loc.country_code,
    p_district: loc.district,
    p_postal_code: loc.postal_code,
  });
  if (error) throw new Error(error.message || 'Could not save location');
  await AsyncStorage.setItem(key(uid), JSON.stringify(loc));
  return loc; // coordinates yahin chhod diye jaate hain, kahin store nahi hote
}

export type EnableLocationResult =
  | { ok: true; location: UserLocation }
  | { ok: false; reason: 'unavailable' | 'denied' | 'blocked' | 'error' };

export async function enableLocation(): Promise<EnableLocationResult> {
  const L = loadLocationModule();
  if (!L) return { ok: false, reason: 'unavailable' };
  const uid = await myId();
  if (!uid) return { ok: false, reason: 'error' };
  try {
    const perm = await L.requestForegroundPermissionsAsync();
    if (perm?.status !== 'granted') {
      return { ok: false, reason: perm?.canAskAgain === false ? 'blocked' : 'denied' };
    }
    return { ok: true, location: await resolveAndSave(L, uid) };
  } catch (err) {
    console.warn('[location] enable failed:', err);
    return { ok: false, reason: 'error' };
  }
}

export async function refreshLocation(): Promise<UserLocation | null> {
  const L = loadLocationModule();
  const uid = await myId();
  if (!L || !uid) return null;
  const perm = await L.getForegroundPermissionsAsync();
  if (perm?.status !== 'granted') return null;
  return resolveAndSave(L, uid);
}

/** App start par: location on ho aur 12 ghante se purani ho to chupchap refresh */
export async function maybeRefreshLocation(): Promise<void> {
  try {
    const cur = await getCachedLocation();
    if (!cur || Date.now() - cur.at < REFRESH_MS) return;
    await refreshLocation();
  } catch (err) {
    console.warn('[location] auto refresh failed:', err);
  }
}

export async function disableLocation(): Promise<void> {
  const uid = await myId();
  const { error } = await supabase.rpc('clear_my_location');
  if (error) throw new Error(error.message || 'Request failed');
  if (uid) {
    try {
      await AsyncStorage.removeItem(key(uid));
    } catch {}
  }
}
