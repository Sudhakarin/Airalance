// app/_layout.tsx
// Root layout — fonts, auth, theme, navigation stack, push notifications, sounds, SQLite init, network tracker, stale cache cleanup

import { useEffect, useState, useRef, useCallback } from 'react';
import { Stack, useRouter } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { StyleSheet, Platform, AppState, View } from 'react-native';
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
// App loading skeleton (chat list shape) — shown while auth loads
// ============================================================
function AppLoadingSkeleton() {
  return (
    <View style={styles.skeletonRoot}>
      {/* Header */}
      <View style={styles.skHeader}>
        <View style={styles.skTitle} />
        <View style={styles.skHeaderIcon} />
      </View>

      {/* Chat rows */}
      {[0, 1, 2, 3, 4, 5].map((i) => (
        <View key={i} style={styles.skRow}>
          <View style={styles.skAvatar} />
          <View style={styles.skRowContent}>
            <View
              style={[
                styles.skLine,
                { width: `${45 + ((i * 13) % 25)}%` },
              ]}
            />
            <View
              style={[
                styles.skLineSmall,
                { width: `${55 + ((i * 17) % 30)}%` },
              ]}
            />
          </View>
        </View>
      ))}
    </View>
  );
}

export default function RootLayout() {
  const router = useRouter();
  const [fontsLoaded, setFontsLoaded] = useState(false);
  const [authReady, setAuthReady] = useState(false);
  const [userId, setUserId] = useState<string | null>(null);
  const pushRegisteredForUserRef = useRef<string | null>(null);

  // ---------- Init sounds (once on mount) ----------
  useEffect(() => {
    initSounds();
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

  // ---------- Cleanup stale AsyncStorage keys (chats/messages now in SQLite) ----------
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
      if (state === 'background' || state === 'inactive') {
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
  useEffect(() => {
    let mounted = true;

    supabase.auth.getSession().then(({ data: { session } }) => {
      if (!mounted) return;
      setUserId(session?.user?.id ?? null);
      setAuthReady(true);
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

  // ---------- Push registration ----------
  useEffect(() => {
    if (!authReady || !userId) return;
    if (Platform.OS === 'web') return;
    if (pushRegisteredForUserRef.current === userId) return;

    let cancelled = false;

    async function registerPush() {
      if (!Device.isDevice) return;

      if (Platform.OS === 'android') {
        try {
          // ✅ Default channel — messages/notifications
          await Notifications.setNotificationChannelAsync('default', {
            name: 'Notifications',
            importance: Notifications.AndroidImportance.MAX,
            vibrationPattern: [0, 250, 250, 250],
            lightColor: '#7C5CFF',
            sound: 'default',
          });

          // ✅ Calls channel — high priority, ring-like behavior
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
        if (!projectId) return;

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

  // ---------- Notification tap handler (navigate to call/chat) ----------
  useEffect(() => {
    const sub = Notifications.addNotificationResponseReceivedListener(
      (response) => {
        const data = response.notification.request.content.data as any;
        if (!data) return;

        // ✅ Incoming call — navigate to call screen
        if (data.screen === 'call' && data.callId) {
          const params = new URLSearchParams({
            role: 'receiver',
            type: data.callType ?? 'audio',
          });
          router.push(`/call/${data.callId}?${params.toString()}`);
        }
        // Chat navigation already handled elsewhere (if exists)
      }
    );

    return () => sub.remove();
  }, [router]);

  // ---------- Hide splash when fonts ready (skeleton takes over during auth) ----------
  const onLayoutRootView = useCallback(async () => {
    if (fontsLoaded) {
      await SplashScreen.hideAsync().catch(() => {});
    }
  }, [fontsLoaded]);

  // Fonts not ready → keep splash (return null, splash still showing)
  if (!fontsLoaded) {
    return null;
  }

  // Fonts ready but auth pending → show skeleton
  if (!authReady) {
    return (
      <GestureHandlerRootView style={styles.root} onLayout={onLayoutRootView}>
        <SafeAreaProvider>
          <StatusBar style="light" />
          <AppLoadingSkeleton />
        </SafeAreaProvider>
      </GestureHandlerRootView>
    );
  }

  // Everything ready → real app
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

  // ---------- Skeleton styles ----------
  skeletonRoot: {
    flex: 1,
    backgroundColor: '#0A0C12',
    paddingHorizontal: 16,
    paddingTop: 60,
  },
  skHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 24,
  },
  skTitle: {
    width: 120,
    height: 26,
    borderRadius: 6,
    backgroundColor: 'rgba(255,255,255,0.08)',
  },
  skHeaderIcon: {
    width: 38,
    height: 38,
    borderRadius: 19,
    backgroundColor: 'rgba(255,255,255,0.08)',
  },
  skRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 12,
    gap: 12,
  },
  skAvatar: {
    width: 54,
    height: 54,
    borderRadius: 27,
    backgroundColor: 'rgba(255,255,255,0.08)',
  },
  skRowContent: {
    flex: 1,
    gap: 8,
  },
  skLine: {
    height: 14,
    borderRadius: 5,
    backgroundColor: 'rgba(255,255,255,0.08)',
  },
  skLineSmall: {
    height: 12,
    borderRadius: 4,
    backgroundColor: 'rgba(255,255,255,0.06)',
  },
});
