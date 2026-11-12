// lib/deviceInfo.ts — device + network info server par log karta hai (IP server khud nikaalta hai)
import { Platform } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import * as Device from 'expo-device';
import * as Crypto from 'expo-crypto';
import Constants from 'expo-constants';
import NetInfo from '@react-native-community/netinfo';
import { supabase } from './supabase';

const INSTALL_KEY = 'airalance:install-id';
const LAST_KEY = 'airalance:device-log-at';
const EVERY_MS = 6 * 60 * 60 * 1000; // 6 ghante me ek baar

async function getInstallId(): Promise<string> {
  let id = await AsyncStorage.getItem(INSTALL_KEY);
  if (!id) {
    id = Crypto.randomUUID();
    await AsyncStorage.setItem(INSTALL_KEY, id);
  }
  return id;
}

export async function logDeviceSession(force = false): Promise<void> {
  try {
    const { data } = await supabase.auth.getSession();
    if (!data?.session?.user) return;

    const last = Number(await AsyncStorage.getItem(LAST_KEY)) || 0;
    if (!force && Date.now() - last < EVERY_MS) return;

    const net: any = await NetInfo.fetch();
    const det: any = net?.details ?? {};
    const info = {
      install_id: await getInstallId(),
      brand: Device.brand ?? null,
      model: Device.modelName ?? Device.modelId ?? null,
      os: Device.osName ?? Platform.OS,
      os_version: Device.osVersion ?? String(Platform.Version),
      app_version: Constants.expoConfig?.version ?? null,
      network: net?.type ?? null,
      cellular_gen: net?.type === 'cellular' ? det?.cellularGeneration ?? null : null,
      carrier: net?.type === 'cellular' ? det?.carrier ?? null : null,
      locale: Intl.DateTimeFormat().resolvedOptions().locale ?? null,
      timezone: Intl.DateTimeFormat().resolvedOptions().timeZone ?? null,
    };

    const { error } = await supabase.rpc('log_my_device', { p_info: info });
    if (error) {
      console.warn('[device] log failed:', error.message);
      return;
    }
    await AsyncStorage.setItem(LAST_KEY, String(Date.now()));
  } catch (e) {
    console.warn('[device] log error:', e);
  }
}
