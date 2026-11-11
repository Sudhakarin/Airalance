// components/PermissionPrompts.tsx
// Pehli baar app kholne par (login ke baad) notification ki tarah hi Contacts aur Location
// ka Allow / Don't allow aata hai. Pehle ek chhota app-style disclosure (Google Play ki
// "prominent disclosure" ki zaroorat), phir phone ka asli permission dialog.
//
// Har user ke liye sirf ek baar. "Not now" par baad me Settings → Contacts & location se on ho sakta hai.
// app/_layout.tsx me ek baar  <PermissionPrompts />  lagao (AppDialogHost ke saath).

import { useEffect, useRef } from 'react';
import { Alert, AppState } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import * as Notifications from 'expo-notifications';
import { supabase } from '../lib/supabase';
import { isOnline } from '../lib/network';
import { fetchMyBanStatus } from '../lib/ban';
import {
  contactsAvailable,
  contactsPermissionStatus,
  enableContactSync,
  isContactSyncEnabled,
} from '../lib/contactsSync';
import {
  locationAvailable,
  locationPermissionStatus,
  enableLocation,
  getCachedLocation,
} from '../lib/userLocation';

const KEY = (uid: string) => `airalance:perm-intro:v1:${uid}`;
const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

function ask(title: string, message: string): Promise<boolean> {
  return new Promise((resolve) => {
    Alert.alert(
      title,
      message,
      [
        { text: 'Not now', style: 'cancel', onPress: () => resolve(false) },
        { text: 'Continue', onPress: () => resolve(true) },
      ],
      { cancelable: false }
    );
  });
}

// notification ka prompt pehle khatam hone do, dono dialogs aapas me na takraayein
async function waitForNotificationAnswer() {
  for (let i = 0; i < 40; i++) {
    try {
      const p = await Notifications.getPermissionsAsync();
      if (p.status !== 'undetermined') return;
    } catch {
      return;
    }
    await sleep(1000);
  }
}

export default function PermissionPrompts() {
  const running = useRef(false);

  useEffect(() => {
    const run = async () => {
      if (running.current) return;
      running.current = true;
      try {
        const { data } = await supabase.auth.getSession();
        const uid: string | undefined = data?.session?.user?.id;
        if (!uid) return;
        if (await AsyncStorage.getItem(KEY(uid))) return;
        // purani build (modules nahi) => abhi mat poochho, update ke baad poochhenge
        if (!contactsAvailable() && !locationAvailable()) return;

        await waitForNotificationAnswer();
        await sleep(1200);
        if (!isOnline()) return; // agli baar try karenge

        try {
          const ban = await fetchMyBanStatus();
          if (ban.banned) return; // banned user ko prompts nahi
        } catch {}

        // ---- Contacts ----
        if (contactsAvailable()) {
          const st = await contactsPermissionStatus();
          if (st.status === 'granted') {
            if (!(await isContactSyncEnabled())) await enableContactSync();
          } else if (st.canAskAgain !== false) {
            const yes = await ask(
              'Find your friends',
              'Airalance can show which of your contacts are already on Airalance, like WhatsApp. Your contacts are turned into encrypted fingerprints on your phone, so we never receive names or readable numbers. You can turn this off anytime in Settings.'
            );
            if (yes) await enableContactSync();
          }
        }

        // ---- Location ----
        if (locationAvailable()) {
          const st = await locationPermissionStatus();
          if (st.status === 'granted') {
            if (!(await getCachedLocation())) await enableLocation();
          } else if (st.canAskAgain !== false) {
            const yes = await ask(
              'News from your area',
              'Allow location to see news from your city and neighbourhood. We save only your area (city, locality and postal code), never your exact coordinates. You can turn this off anytime in Settings.'
            );
            if (yes) await enableLocation();
          }
        }

        await AsyncStorage.setItem(KEY(uid), String(Date.now()));
      } catch (err) {
        console.warn('[permission-prompts] failed:', err);
      } finally {
        running.current = false;
      }
    };

    run();
    const sub = AppState.addEventListener('change', (st: string) => {
      if (st === 'active') run();
    });
    const { data } = supabase.auth.onAuthStateChange((event: string, session: any) => {
      if (event === 'SIGNED_IN' && session?.user) setTimeout(run, 3000);
    });
    return () => {
      sub.remove();
      data?.subscription?.unsubscribe();
    };
  }, []);

  return null;
}
