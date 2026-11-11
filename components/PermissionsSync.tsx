// components/PermissionsSync.tsx
// Background me permission status sync (UI nahi dikhata).
// app/_layout.tsx me ek baar  <PermissionsSync />  lagao.

import { useEffect, useRef } from 'react';
import { AppState } from 'react-native';
import { supabase } from '../lib/supabase';
import { syncPermissions } from '../lib/permissionsSync';
import { maybeResyncContacts } from '../lib/contactsSync';
import { maybeRefreshLocation } from '../lib/userLocation';

export default function PermissionsSync() {
  const busy = useRef(false);
  const lastRun = useRef(0);

  useEffect(() => {
    const run = async (force = false) => {
      if (busy.current) return;
      if (!force && Date.now() - lastRun.current < 30000) return;
      busy.current = true;
      lastRun.current = Date.now();
      try {
        await syncPermissions();
        // opt-in features: contacts (7 din) aur location (12 ghante) chupchap refresh
        await maybeResyncContacts();
        await maybeRefreshLocation();
      } catch (err) {
        console.warn('[permissions] sync error:', err);
      } finally {
        busy.current = false;
      }
    };

    run(true);

    // user OS settings se wapas aaye (permission badli ho sakti hai)
    const sub = AppState.addEventListener('change', (st: string) => {
      if (st === 'active') run();
    });
    // fresh login ke baad
    const { data } = supabase.auth.onAuthStateChange((event: string, session: any) => {
      if (event === 'SIGNED_IN' && session?.user) setTimeout(() => run(true), 1500);
    });

    return () => {
      sub.remove();
      data?.subscription?.unsubscribe();
    };
  }, []);

  return null;
}
