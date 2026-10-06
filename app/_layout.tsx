// app/_layout.tsx
// Root layout — fonts, auth, theme, navigation stack, push notifications, sounds, SQLite init, network tracker, stale cache cleanup

import { useEffect, useState, useRef, useCallback } from 'react';
import { Stack, useRouter } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import {
  StyleSheet,
  Platform,
  AppState,
  View,
  Text,
  Pressable,
} from 'react-native';
import { SafeAreaProvider } from 'react-native-safe-area-context';
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
import { setSessionUnlocked } from '../lib/pin';
import { initSounds } from '../lib/sounds';
import { getDB } from '../lib/db';
import { initNetwork } from '../lib/network';
import { CallProvider } from '../contexts/CallContext';
import { getFcmToken, onFcmTokenRefresh } from '../lib/fcm';

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
// FIX #4: Global Error Boundary — kisi bhi screen ka render error
// white-screen/crash ki jagah graceful screen + retry dikhayega
// ============================================================
export function ErrorBoundary({ error, retry }: { error: Error; retry: () => void }) {
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
  const router = useRouter();
  const [fontsLoaded, setFontsLoaded] = useState(false);
  const [authReady, setAuthReady] = useState(false);
  const [userId, setUserId] = useState<string | null>(null);
  const pushRegisteredForUserRef = useRef<string | null>(null);
  const fcmRegisteredForUserRef = useRef<string | null>(null);
  // FIX #3: double-navigation guard (cold-start + listener overlap)
  const lastNotifNavRef = useRef<{ key: string; time: number }>({ key: '', time: 0 });

  // ---------- Init sounds (once on mount) ----------
  // FIX #6: try/catch — sounds init fail ho toh startup crash na ho
  useEffect(() => {
    try {
      initSounds();
    } catch (err) {
      console.warn('[sounds] init failed:', err);
    }
  }, []);

  // ---------- Init SQLite (once on mount) ----------
  useEffect(() => {
    (async () => {
      try {
        await getDB();
        console.log('[db] SQLite ready');
      } catch (err) {
        console.warn('[db] SQLite init failed:', err);
      }
    })();
  }, []);

  // ---------- Init network tracker (once on mount) ----------
  useEffect(() => {
    try {
      initNetwork();
      console.log('[net] Network tracker ready');
    } catch (err) {
      console.warn('[net] Network init failed:', err);
    }
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
  // FIX #5: sirf 'background' pe lock — 'inactive' iOS me permission dialogs,
  // control center, incoming-call overlay pe bhi fire hota hai
  // → bina wajah PIN screen aati thi. (Strict chahiye toh 'inactive' wapas add kar dena)
  useEffect(() => {
    const sub = AppState.addEventListener('change', (state) => {
      if (state === 'background') {
        setSessionUnlocked(false);
      }
    });
    return () => sub.remove();
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
  // FIX #2: .catch add kiya — getSession reject hua toh splash FOREVER stuck na ho
  useEffect(() => {
    let mounted = true;

    supabase.auth
      .getSession()
      .then(({ data: { session } }) => {
        if (!mounted) return;
        setUserId(session?.user?.id ?? null);
        setAuthReady(true);
      })
      .catch((err) => {
        console.warn('[auth] getSession failed:', err);
        if (mounted) setAuthReady(true); // app stuck na ho
      });

    const { data: listener } = supabase.auth.onAuthStateChange(
      (_event, session) => {
        if (!mounted) return;
        setUserId(session?.user?.id ?? null);
        setAuthReady(true);
      }
    );

    return () => {
      mounted = false;
      listener.subscription.unsubscribe();
    };
  }, []);

  // FIX #2b: FAILSAFE — worst case me bhi splash max 8s tak hi rahe
  useEffect(() => {
    const t = setTimeout(() => {
      setFontsLoaded(true);
      setAuthReady(true);
    }, 8000);
    return () => clearTimeout(t);
  }, []);

  // ---------- Push registration (Expo) ----------
  useEffect(() => {
    if (!authReady || !userId) return;
    if (Platform.OS === 'web') return;
    if (pushRegisteredForUserRef.current === userId) return;

    let cancelled = false;

    async function registerPush() {
      if (!Device.isDevice) return;

      if (Platform.OS === 'android') {
        try {
          await Notifications.setNotificationChannelAsync('default', {
            name: 'Notifications',
            importance: Notifications.AndroidImportance.MAX,
            vibrationPattern: [0, 250, 250, 250],
            lightColor: '#7C5CFF',
            sound: 'default',
          });

          await Notifications.setNotificationChannelAsync('calls', {
            name: 'Incoming calls',
            importance: Notifications.AndroidImportance.MAX,
            vibrationPattern: [0, 1000, 1000, 1000],
            lightColor: '#22C55E',
            sound: 'default',
            bypassDnd: true,
            lockscreenVisibility:
              Notifications.AndroidNotificationVisibility.PUBLIC,
            audioAttributes: {
              usage: Notifications.AndroidAudioUsage.VOICE_COMMUNICATION,
              contentType: Notifications.AndroidAudioContentType.SPEECH,
            },
          });
        } catch (e) {
          console.warn('[push] Channel register failed:', e);
        }
      }

      let { status } = await Notifications.getPermissionsAsync();
      if (status !== 'granted') {
        const res = await Notifications.requestPermissionsAsync();
        status = res.status;
      }
      if (status !== 'granted') return;
      if (cancelled) return;

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
        }
      } catch (err) {
        console.warn('[push] Token registration failed:', err);
      }
    }

    registerPush();

    return () => {
      cancelled = true;
    };
  }, [authReady, userId]);

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

  // ---------- Notification navigation helper ----------
  // FIX #1 (CRITICAL): URLSearchParams Hermes me EXIST nahi karta —
  // call notification tap karte hi app CRASH ho jata tha.
  // Ab expo-router ka params object use hota hai.
  const navigateFromNotification = useCallback(
    (data: Record<string, any> | null | undefined) => {
      if (!data) return;

      if (data.screen === 'call' && data.callId) {
        const callId = String(data.callId);
        const callType = data.callType ?? 'audio';

        // Same notification dobara navigate na ho (cold-start + listener overlap)
        const key = `call:${callId}:${callType}`;
        const now = Date.now();
        if (
          lastNotifNavRef.current.key === key &&
          now - lastNotifNavRef.current.time < 3000
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
      }
      // Future: chat/status notifications handle karne ho toh yahan add karo
    },
    [router]
  );

  // ---------- Notification tap handler ----------
  // FIX #3: cold-start bhi handle — app killed ho tab bhi call screen khulegi
  useEffect(() => {
    // App band tha, user ne notification tap kiya
    Notifications.getLastNotificationResponseAsync()
      .then((response) => {
        const data = response?.notification?.request?.content
          ?.data as Record<string, any> | undefined;
        if (!data) return;
        // Root navigation settle hone do
        setTimeout(() => navigateFromNotification(data), 250);
      })
      .catch(() => {});

    // App chal raha ho (background/foreground) tab tap
    const sub = Notifications.addNotificationResponseReceivedListener(
      (response) => {
        const data = response?.notification?.request?.content
          ?.data as Record<string, any> | undefined;
        navigateFromNotification(data);
      }
    );

    return () => sub.remove();
  }, [navigateFromNotification]);

  // ---------- Hide splash only when BOTH fonts + auth are ready ----------
  const onLayoutRootView = useCallback(async () => {
    if (fontsLoaded && authReady) {
      await SplashScreen.hideAsync().catch(() => {});
    }
  }, [fontsLoaded, authReady]);

  // FIX #7: backup effect — splash hide guaranteed (onLayout miss ho toh bhi)
  useEffect(() => {
    if (fontsLoaded && authReady) {
      SplashScreen.hideAsync().catch(() => {});
    }
  }, [fontsLoaded, authReady]);

  if (!fontsLoaded || !authReady) {
    return null;
  }

  return (
    <GestureHandlerRootView style={styles.root} onLayout={onLayoutRootView}>
      <SafeAreaProvider>
        <CallProvider>
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
              options={{ animation: 'fade', animationDuration: 200 }}
            />
            <Stack.Screen
              name="chat/[id]"
              options={{ animation: 'slide_from_right', animationDuration: 220 }}
            />
            <Stack.Screen
              name="profile/[id]"
              options={{ animation: 'slide_from_right', animationDuration: 220 }}
            />
            <Stack.Screen
              name="status/[userId]"
              options={{ animation: 'fade', animationDuration: 200 }}
            />
            <Stack.Screen
              name="status/create"
              options={{ animation: 'slide_from_bottom', animationDuration: 240 }}
            />
            <Stack.Screen
              name="news/[id]"
              options={{ animation: 'slide_from_right', animationDuration: 220 }}
            />
            <Stack.Screen
              name="settings/index"
              options={{ animation: 'slide_from_right', animationDuration: 220 }}
            />
            <Stack.Screen
              name="notifications"
              options={{ animation: 'slide_from_right', animationDuration: 220 }}
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
      </SafeAreaProvider>
    </GestureHandlerRootView>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: '#0A0C12' },
  // Error Boundary styles
  errorContainer: {
    flex: 1,
    backgroundColor: '#0A0C12',
    alignItems: 'center',
    justifyContent: 'center',
    padding: 24,
  },
  errorTitle: { color: '#FFFFFF', fontSize: 20, fontWeight: '700', marginBottom: 8 },
  errorMsg: { color: '#9CA3AF', fontSize: 13, textAlign: 'center', marginBottom: 24 },
  errorBtn: {
    backgroundColor: '#7C5CFF',
    paddingHorizontal: 28,
    paddingVertical: 12,
    borderRadius: 12,
  },
  errorBtnText: { color: '#FFFFFF', fontSize: 15, fontWeight: '600' },
});
