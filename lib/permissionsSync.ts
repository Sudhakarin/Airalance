// lib/permissionsSync.ts
// User ne kaun si permission allow / deny ki — Supabase me sync karta hai
// (Admin panel → user detail → Permissions me dikhta hai).

import { Platform } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import * as ImagePicker from 'expo-image-picker';
import * as MediaLibrary from 'expo-media-library';
import * as Notifications from 'expo-notifications';
import { AudioModule } from 'expo-audio';
import Constants from 'expo-constants';
import { supabase } from './supabase';

type PermStatus = 'granted' | 'denied' | 'undetermined' | 'limited';
type PermItem = {
  permission: 'notifications' | 'camera' | 'microphone' | 'photos' | 'contacts' | 'location';
  status: PermStatus;
  can_ask_again: boolean | null;
};

const RESYNC_MS = 12 * 60 * 60 * 1000; // same state ho to bhi 12 ghante me ek baar

function norm(r: any): { status: PermStatus; can_ask_again: boolean | null } {
  const s = r?.status;
  let status: PermStatus =
    s === 'granted' ? 'granted' : s === 'denied' ? 'denied' : 'undetermined';
  if (status === 'granted' && r?.accessPrivileges === 'limited') status = 'limited';
  return {
    status,
    can_ask_again: typeof r?.canAskAgain === 'boolean' ? r.canAskAgain : null,
  };
}

async function safe(fn: () => Promise<any>) {
  try {
    return norm(await fn());
  } catch {
    return null;
  }
}

function optionalModule(name: 'expo-contacts' | 'expo-location'): any | null {
  try {
    if (name === 'expo-contacts') return require('expo-contacts');
    return require('expo-location');
  } catch {
    return null;
  }
}

export async function collectPermissions(): Promise<PermItem[]> {
  const items: PermItem[] = [];
  const add = (
    permission: PermItem['permission'],
    v: { status: PermStatus; can_ask_again: boolean | null } | null
  ) => {
    if (v) items.push({ permission, ...v });
  };
  add('notifications', await safe(() => Notifications.getPermissionsAsync()));
  add('camera', await safe(() => ImagePicker.getCameraPermissionsAsync()));
  add('microphone', await safe(() => AudioModule.getRecordingPermissionsAsync()));
  add('photos', await safe(() => MediaLibrary.getPermissionsAsync()));
  const Contacts = optionalModule('expo-contacts');
  if (Contacts) add('contacts', await safe(() => Contacts.getPermissionsAsync()));
  const Location = optionalModule('expo-location');
  if (Location) add('location', await safe(() => Location.getForegroundPermissionsAsync()));
  return items;
}

export async function syncPermissions(): Promise<void> {
  const { data } = await supabase.auth.getSession();
  const uid: string | undefined = data?.session?.user?.id;
  if (!uid) return;

  const items = await collectPermissions();
  if (items.length === 0) return;

  const payload = JSON.stringify(items);
  const key = `airalance:perm-sync:${uid}`;
  try {
    const raw = await AsyncStorage.getItem(key);
    if (raw) {
      const c = JSON.parse(raw);
      if (c?.hash === payload && Date.now() - Number(c?.at ?? 0) < RESYNC_MS) return;
    }
  } catch {}

  const { error } = await supabase.rpc('sync_my_permissions', {
    p_items: items,
    p_platform: Platform.OS,
    p_app_version: (Constants as any)?.expoConfig?.version ?? null,
  });
  if (error) {
    console.warn('[permissions] sync failed:', error.message);
    return;
  }
  try {
    await AsyncStorage.setItem(key, JSON.stringify({ hash: payload, at: Date.now() }));
  } catch {}
}
