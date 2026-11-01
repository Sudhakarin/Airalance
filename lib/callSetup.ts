// lib/callSetup.ts
// "Allow for calls" helper — shown ONCE, the first time the user taps the call
// button (never at app start). Android only.

import { Platform, Linking } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';

const KEY_SHOWN = 'perm:call-setup-shown:v1';

let notifee: any = null;
if (Platform.OS === 'android') {
  try {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const m = require('@notifee/react-native');
    notifee = m.default ?? m;
  } catch {}
}

export async function shouldShowCallSetup(): Promise<boolean> {
  if (Platform.OS !== 'android') return false;
  try {
    return !(await AsyncStorage.getItem(KEY_SHOWN));
  } catch {
    return false;
  }
}

export async function markCallSetupShown(): Promise<void> {
  try {
    await AsyncStorage.setItem(KEY_SHOWN, String(Date.now()));
  } catch {}
}

// true = Unrestricted (good), false = still optimized, null = can't tell
export async function isBatteryUnrestricted(): Promise<boolean | null> {
  if (!notifee) return null;
  try {
    return !(await notifee.isBatteryOptimizationEnabled());
  } catch {
    return null;
  }
}

async function intentOrAppSettings(action: string) {
  try {
    await Linking.sendIntent(action);
  } catch {
    Linking.openSettings().catch(() => {});
  }
}

export async function openBatterySettings(): Promise<void> {
  try {
    if (notifee) {
      await notifee.openBatteryOptimizationSettings();
      return;
    }
  } catch {}
  Linking.openSettings().catch(() => {});
}

export const openOverlaySettings = () =>
  intentOrAppSettings('android.settings.action.MANAGE_OVERLAY_PERMISSION');

// Android 14+ only
export const openFullScreenSettings = () =>
  intentOrAppSettings('android.settings.MANAGE_APP_USE_FULL_SCREEN_INTENT');
