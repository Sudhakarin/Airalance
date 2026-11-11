// app/_layout.tsx
// Root layout — fonts, auth, theme, navigation stack, push notifications, sounds,
// SQLite init, network tracker, stale cache cleanup, notification deep-nav
// ✅ FIX: sync in-memory userId cache with auth state (instant cold start)
// ✅ FIX: initialWindowMetrics on SafeAreaProvider — kills first-frame layout jump
// ✅ FIX: SafeAreaProvider mounted IMMEDIATELY (never behind conditional null)
//         — native insets ready before first content frame → zero jump
// ✅ FIX: permissions moved to lib/permissions.ts — one flow asks notifications,
//         mic, camera, nearby devices, phone; blocked ones → "Open Settings";
//         Expo push token registers only AFTER notification permission is granted
//         and re-checks when user comes back from Settings
// ✅ NEW: <BanGuard /> — banned user ko full-screen popup (Logout / Appeal)
// ✅ NEW: <AppDialogHost /> — saare Alert.alert popups app ke theme me
// ✅ NEW: <PermissionsSync /> — user ki permissions admin panel ke liye sync
// ✅ NEW: <PermissionPrompts /> — pehli baar Contacts + Location ka Allow/Deny (notification ki tarah)

import { useEffect, useState, useRef } from 'react';
import { Stack, useRouter, usePathname } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import {
  StyleSheet,
  Platform,
  AppState,
  View,
  Text,
  Pressable,
} from 'react-native';
import {
  SafeAreaProvider,
  initialWindowMetrics,
} from 'react-native-safe-area-context';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import * as SplashScreen from 'expo-splash-screen';
import * as Font from 'expo-font';
import * as Device from 'expo-device';
import * as Notifications from 'expo-notifications';
import Constants from 'expo-constants';
import AsyncStorage from '@react-native-async-storage/async-storage';
import {
  Inter_400Regular,
  Inter_500Medium,
  Inter_600SemiBold,
} from '@expo-google-fonts/inter';
import {
  Poppins_400Regular,
  Poppins_500Medium,
  Poppins_600SemiBold,
  Poppins_700Bold,
} from '@expo-google-fonts/poppins';
import { JetBrainsMono_400Regular } from '@expo-google-fonts/jetbrains-mono';
import { supabase } from '../lib/supabase';
import { setUserIdCache } from '../lib/auth';
import { setSessionUnlocked } from '../lib/pin';
import { initSounds } from '../lib/sounds';
import { getDB } from '../lib/db';
import { preloadChatList, setMemUserId } from '../lib/chatListCache';
import { initNetwork } from '../lib/network';
import { startPresence, stopPresence } from '../lib/presence';
import { CallProvider } from '../contexts/CallContext';
import {
  getFcmToken,
  onFcmTokenRefresh,
  onNotificationOpenedApp,
} from '../lib/fcm';
import { useOTAUpdate } from '../lib/useOTAUpdate';
import UpdateOverlay from '../components/UpdateOverlay';
import IncomingCallBridge from '../components/IncomingCallBridge';
import BanGuard from '../components/BanGuard';
import AppDialogHost from '../components/AppDialogHost';
import PermissionsSync from '../components/PermissionsSync';
import PermissionPrompts from '../components/PermissionPrompts';
import {
  runPermissionFlow,
  setupNotificationChannels,
  getNotificationStatus,
} from '../lib/permissions';

SplashScreen.preventAutoHideAsync().catch(() => {});

Notifications.setNotificationHandler({
  handleNotification: async () => ({
    shouldPlaySound: true,
    shouldSetBadge: true,
    shouldShowBanner: true,
    shouldShowList: true,
  }),
});

const FONT_MAP = {
  Inter_400Regular,
  Inter_500Medium,
  Inter_600SemiBold,
  Poppins_400Regular,
  Poppins_500Medium,
  Poppins_600SemiBold,
  Poppins_700Bold,
  JetBrainsMono_400Regular,
};

// ============================================================
// Global Error Boundary
// ============================================================
export function ErrorBoundary({
  error,
  retry,
}: {
  error: Error;
  retry: () => void;
}) {
  return (
    <View style={styles.errorContainer}>
      <Text style={styles.errorTitle}>Something went wrong</Text>
      <Text style={styles.errorMsg} numberOfLines={4}>
        {error?.message ?? 'Unexpected error'}
      </Text>
      <Pressable onPress={retry} style={styles.errorBtn}>
        <Text style={styles.errorBtnText}>Try again</Text>
      </Pressable>
    </View>
  );
}

export default function RootLayout() {
  const { status: otaStatus } = useOTAUpdate();
  const router = useRouter();
  const pathname = usePathname();
  const [fontsLoaded, setFontsLoaded] = useState(false);
  const [authReady, setAuthReady] = useState(false);
  const [userId, setUserId] = useState<string | null>(null);
  const [notifGranted, setNotifGranted] = useState(false);
  const pushRegisteredForUserRef = useRef<string | null>(null);
  const fcmRegisteredForUserRef = useRef<string | null>(null);
  const lastNotifNavRef = useRef<{ key: string; time: number }>({
    key: '',
    time: 0,
  });
  const [pendingNotif, setPendingNotif] = useState<Record<string, any> | null>(
    null
  );

  const isReady = fontsLoaded && authReady;

  // ---------- Init sounds ----------
  useEffect(() => {
    try {
      initSounds();
    } catch (err) {
      console.warn('[sounds] init failed:', err);
    }
  }, []);

  // ---------- Init SQLite ----------
  useEffect(() => {
    (async () => {
      try {
        await getDB();
        console.log('[db] SQLite ready');
        // Chat list into memory now → Chats tab opens instantly
        preloadChatList();
      } catch (err) {
        console.warn('[db] SQLite init failed:', err);
      }
    })();
  }, []);

  // ---------- Init network tracker ----------
  useEffect(() => {
    try {
      initNetwork();
      console.log('[net] Network tracker ready');
    } catch (err) {
      console.warn('[net] Network init failed:', err);
    }
  }, []);

  // ---------- Android notification channels (as early as possible) ----------
  useEffect(() => {
    setupNotificationChannels().catch((err) =>
      console.warn('[push] Channel setup failed:', err)
    );
  }, []);

  // ---------- Cleanup stale AsyncStorage keys ----------
  useEffect(() => {
    (async () => {
      try {
        const keys = await AsyncStorage.getAllKeys();
        const stale = keys.filter(
          (k) =>
            k.startsWith('airalance:chats:') ||
            k.startsWith('airalance:messages:')
        );
        if (stale.length > 0) {
          await AsyncStorage.multiRemove(stale);
          console.log('[cleanup] removed', stale.length, 'stale keys');
        }
      } catch (err) {
        console.warn('[cleanup] failed:', err);
      }
    })();
  }, []);

  // ---------- Web-only: hide scrollbars ----------
  useEffect(() => {
    if (Platform.OS !== 'web') return;
    if (typeof document === 'undefined') return;
    if (document.getElementById('hide-scrollbars')) return;

    const style = document.createElement('style');
    style.id = 'hide-scrollbars';
    style.innerHTML = `
      * { scrollbar-width: none !important; -ms-overflow-style: none !important; }
      *::-webkit-scrollbar { display: none !important; width: 0 !important; height: 0 !important; }
      html, body { scrollbar-width: none !important; -ms-overflow-style: none !important; }
      html::-webkit-scrollbar, body::-webkit-scrollbar { display: none !important; width: 0 !important; height: 0 !important; }
    `;
    document.head.appendChild(style);
  }, []);

  // ---------- Lock session reset on background ----------
  useEffect(() => {
    const sub = AppState.addEventListener('change', (state) => {
      if (state === 'background') {
        setSessionUnlocked(false);
      }
    });
    return () => sub.remove();
  }, []);

  // ---------- Notification permission status: on start + every time app
  //            comes to foreground (e.g. user returns from Settings) ----------
  useEffect(() => {
    if (Platform.OS === 'web') return;

    let mounted = true;
    const check = async () => {
      try {
        const s = await getNotificationStatus();
        if (mounted) setNotifGranted(s === 'granted');
      } catch {}
    };

    check();
    const sub = AppState.addEventListener('change', (state) => {
      if (state === 'active') check();
    });
    return () => {
      mounted = false;
      sub.remove();
    };
  }, []);

  // ---------- Load fonts ----------
  useEffect(() => {
    let mounted = true;
    (async () => {
      try {
        const allLoaded = Object.keys(FONT_MAP).every((f) => Font.isLoaded(f));
        if (!allLoaded) {
          await Font.loadAsync(FONT_MAP);
        }
      } catch (e) {
        console.warn('Font loading failed', e);
      } finally {
        if (mounted) setFontsLoaded(true);
      }
    })();
    return () => {
      mounted = false;
    };
  }, []);

  // ---------- Auth ----------
  useEffect(() => {
    let mounted = true;

    supabase.auth
      .getSession()
      .then(({ data: { session } }) => {
        if (!mounted) return;
        setUserId(session?.user?.id ?? null);
        setUserIdCache(session?.user?.id ?? null);
        setMemUserId(session?.user?.id ?? null);
        setAuthReady(true);
      })
      .catch((err) => {
        console.warn('[auth] getSession failed:', err);
        if (mounted) setAuthReady(true);
      });

    const { data: listener } = supabase.auth.onAuthStateChange(
      (_event, session) => {
        if (!mounted) return;
        setUserId(session?.user?.id ?? null);
        setUserIdCache(session?.user?.id ?? null);
        setMemUserId(session?.user?.id ?? null);
        setAuthReady(true);
      }
    );

    return () => {
      mounted = false;
      listener.subscription.unsubscribe();
    };
  }, []);

  // ---------- Realtime presence (online/offline + last_seen) ----------
  useEffect(() => {
    if (!authReady) return;
    if (userId) startPresence(userId);
    else stopPresence();
  }, [authReady, userId]);

  // FAILSAFE — splash max 8s tak hi rahe
  useEffect(() => {
    const t = setTimeout(() => {
      setFontsLoaded(true);
      setAuthReady(true);
    }, 8000);
    return () => clearTimeout(t);
  }, []);

  // ============================================================
  // PERMISSION FLOW (after login, once app is visible)
  // notifications → mic → camera → nearby devices → phone
  // Blocked → "Open Settings" alert (max 1/day)
  // Special perms (full-screen intent, battery, overlay) → one-time guide
  // ============================================================
  useEffect(() => {
    if (!isReady || !userId) return;
    if (Platform.OS === 'web') return;

    let cancelled = false;
    const t = setTimeout(async () => {
      try {
        const report = await runPermissionFlow();
        if (!cancelled) setNotifGranted(report.notifications === 'granted');
      } catch (err) {
        console.warn('[perm] flow failed:', err);
      }
    }, 1500);

    return () => {
      cancelled = true;
      clearTimeout(t);
    };
  }, [isReady, userId]);

  // ---------- Push registration (Expo) — only after permission granted ----------
  useEffect(() => {
    if (!authReady || !userId || !notifGranted) return;
    if (Platform.OS === 'web') return;
    if (pushRegisteredForUserRef.current === userId) return;

    let cancelled = false;

    async function registerPush() {
      if (!Device.isDevice) return;

      try {
        const projectId =
          Constants.expoConfig?.extra?.eas?.projectId ??
          Constants.easConfig?.projectId;
        if (!projectId) {
          console.warn('[push] No EAS projectId found — Expo push skipped');
          return;
        }

        const token = (
          await Notifications.getExpoPushTokenAsync({ projectId })
        ).data;
        if (cancelled) return;

        const { error } = await supabase
          .from('profiles')
          .update({ expo_push_token: token })
          .eq('id', userId);

        if (!error) {
          pushRegisteredForUserRef.current = userId;
          console.log('[push] Token saved for user:', userId);
        } else {
          console.warn('[push] Save failed:', error.message);
        }
      } catch (err) {
        console.warn('[push] Token registration failed:', err);
      }
    }

    registerPush();

    return () => {
      cancelled = true;
    };
  }, [authReady, userId, notifGranted]);

  // ---------- FCM token registration ----------
  useEffect(() => {
    if (!authReady || !userId) return;
    if (Platform.OS === 'web') return;
    if (fcmRegisteredForUserRef.current === userId) return;

    let cancelled = false;

    async function registerFcm() {
      try {
        await new Promise((r) => setTimeout(r, 800));
        if (cancelled) return;

        const token = await getFcmToken();
        if (!token || cancelled) {
          console.warn('[fcm] No token received');
          return;
        }

        const { error } = await supabase
          .from('profiles')
          .update({ fcm_token: token })
          .eq('id', userId);

        if (!error) {
          fcmRegisteredForUserRef.current = userId;
          console.log('[fcm] Token saved for user:', userId);
        } else {
          console.warn('[fcm] Save failed:', error.message);
        }
      } catch (err) {
        console.warn('[fcm] Register failed:', err);
      }
    }

    registerFcm();

    const unsub = onFcmTokenRefresh(async (newToken) => {
      try {
        await supabase
          .from('profiles')
          .update({ fcm_token: newToken })
          .eq('id', userId);
        console.log('[fcm] Token refreshed');
      } catch (err) {
        console.warn('[fcm] Refresh save failed:', err);
      }
    });

    return () => {
      cancelled = true;
      if (unsub) unsub();
    };
  }, [authReady, userId]);

  // Which notification taps we react to: calls + chat / follow / connect etc.
  const isHandledTap = (d?: Record<string, any>) =>
    !!d &&
    ((d.screen === 'call' && !!d.callId) ||
      d.screen === 'chat' ||
      d.screen === 'chats' ||
      d.screen === 'notifications');

  // ============================================================
  // BLACK-SCREEN FIX — STEP 1: Notification tap STASH
  // ============================================================
  useEffect(() => {
    Notifications.getLastNotificationResponseAsync()
      .then((response) => {
        const data = response?.notification?.request?.content?.data as
          | Record<string, any>
          | undefined;
        if (isHandledTap(data)) {
          setPendingNotif(data as Record<string, any>);
        }
      })
      .catch(() => {});

    const sub = Notifications.addNotificationResponseReceivedListener(
      (response) => {
        const data = response?.notification?.request?.content?.data as
          | Record<string, any>
          | undefined;
        if (isHandledTap(data)) {
          setPendingNotif(data as Record<string, any>);
        }
      }
    );

    return () => sub.remove();
  }, []);

  // FCM (Firebase) notification taps — these do NOT reach expo-notifications
  // listeners, so handle them here too (duplicates are filtered by lastNotifNavRef)
  useEffect(() => {
    if (Platform.OS === 'web') return;
    const unsub = onNotificationOpenedApp((data) => {
      if (isHandledTap(data)) {
        setPendingNotif(data);
      }
    });
    return () => unsub();
  }, []);

  // ============================================================
  // BLACK-SCREEN FIX — STEP 2: App settle hone ke baad navigate
  // ============================================================
  useEffect(() => {
    if (!pendingNotif || !authReady) return;
    if (!userId) return;

    const delay = pathname === '/' ? 900 : 350;

    const t = setTimeout(() => {
      const d = pendingNotif;
      setPendingNotif(null);

      // ---- chat / follow / connect etc. → open the right screen ----
      if (d.screen !== 'call') {
        const target =
          d.screen === 'chat' && d.chatId
            ? `/chat/${String(d.chatId)}`
            : d.screen === 'notifications'
            ? '/notifications'
            : '/(tabs)/chats';
        const navKey = `nav:${target}`;
        const t0 = Date.now();
        if (
          lastNotifNavRef.current.key === navKey &&
          t0 - lastNotifNavRef.current.time < 4000
        ) {
          return;
        }
        lastNotifNavRef.current = { key: navKey, time: t0 };
        try {
          router.push(target as any);
        } catch (err) {
          console.warn('[notif] Navigation failed:', err);
        }
        return;
      }

      const callId = String(d.callId);
      const callType = d.callType === 'video' ? 'video' : 'audio';

      const key = `call:${callId}:${callType}`;
      const now = Date.now();
      if (
        lastNotifNavRef.current.key === key &&
        now - lastNotifNavRef.current.time < 4000
      ) {
        return;
      }
      lastNotifNavRef.current = { key, time: now };

      try {
        router.push({
          pathname: '/call/[id]',
          params: { id: callId, role: 'receiver', type: callType },
        });
      } catch (err) {
        console.warn('[notif] Navigation failed:', err);
      }
    }, delay);

    return () => clearTimeout(t);
  }, [pendingNotif, authReady, userId, pathname, router]);

  // ---------- Hide splash (single consolidated effect) ----------
  useEffect(() => {
    if (!isReady) return;
    // ✅ FIX: let content lay out 2 frames before hiding splash
    let id2 = 0;
    const id1 = requestAnimationFrame(() => {
      id2 = requestAnimationFrame(() => {
        SplashScreen.hideAsync().catch(() => {});
      });
    });
    return () => {
      cancelAnimationFrame(id1);
      if (id2) cancelAnimationFrame(id2);
    };
  }, [isReady]);

  // ============================================================
  // RENDER
  // ✅ FIX: NEVER return null here.
  // GestureHandlerRootView + SafeAreaProvider mount IMMEDIATELY so native
  // insets are measured before the first content frame. When isReady flips,
  // content mounts with insets already correct → no jump.
  // ============================================================
  return (
    <GestureHandlerRootView style={styles.root}>
      <SafeAreaProvider initialMetrics={initialWindowMetrics}>
        {!isReady ? (
          // Splash is still visible on top — this placeholder is just to
          // keep SafeAreaProvider mounted and let native insets settle.
          <View style={styles.loadingPlaceholder} />
        ) : (
          <CallProvider>
            <IncomingCallBridge />
            <BanGuard />
            <PermissionsSync />
            <PermissionPrompts />
            <AppDialogHost />
            <StatusBar style="light" />
            <Stack
              screenOptions={{
                headerShown: false,
                contentStyle: { backgroundColor: '#0A0C12' },
                animation: 'slide_from_right',
                animationDuration: 220,
              }}
            >
              <Stack.Screen name="index" options={{ animation: 'none' }} />
              <Stack.Screen
                name="(auth)"
                options={{ animation: 'fade', animationDuration: 200 }}
              />
              <Stack.Screen
                name="(tabs)"
                options={{ animation: 'none' }}
              />
              <Stack.Screen
                name="chat/[id]"
                options={{
                  animation: 'slide_from_right',
                  animationDuration: 220,
                }}
              />
              <Stack.Screen
                name="profile/[id]"
                options={{
                  animation: 'slide_from_right',
                  animationDuration: 220,
                }}
              />
              <Stack.Screen
                name="status/[userId]"
                options={{ animation: 'fade', animationDuration: 200 }}
              />
              <Stack.Screen
                name="status/create"
                options={{
                  animation: 'slide_from_bottom',
                  animationDuration: 240,
                }}
              />
              <Stack.Screen
                name="news/[id]"
                options={{
                  animation: 'slide_from_right',
                  animationDuration: 220,
                }}
              />
              <Stack.Screen
                name="settings/index"
                options={{
                  animation: 'slide_from_right',
                  animationDuration: 220,
                }}
              />
              <Stack.Screen
                name="notifications"
                options={{
                  animation: 'slide_from_right',
                  animationDuration: 220,
                }}
              />
              <Stack.Screen
                name="call/[id]"
                options={{
                  animation: 'fade',
                  animationDuration: 200,
                  presentation: 'modal',
                }}
              />
            </Stack>
          </CallProvider>
        )}
        <UpdateOverlay status={otaStatus} />
      </SafeAreaProvider>
    </GestureHandlerRootView>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: '#0A0C12' },
  loadingPlaceholder: { flex: 1, backgroundColor: '#0A0C12' },
  errorContainer: {
    flex: 1,
    backgroundColor: '#0A0C12',
    alignItems: 'center',
    justifyContent: 'center',
    padding: 24,
  },
  errorTitle: {
    color: '#FFFFFF',
    fontSize: 20,
    fontWeight: '700',
    marginBottom: 8,
  },
  errorMsg: {
    color: '#9CA3AF',
    fontSize: 13,
    textAlign: 'center',
    marginBottom: 24,
  },
  errorBtn: {
    backgroundColor: '#7C5CFF',
    paddingHorizontal: 28,
    paddingVertical: 12,
    borderRadius: 12,
  },
  errorBtnText: { color: '#FFFFFF', fontSize: 15, fontWeight: '600' },
});
