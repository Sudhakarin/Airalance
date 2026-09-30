// app/_layout.tsx
// Root layout — fonts, auth, theme, navigation stack, push notifications

import { useEffect, useState, useRef, useCallback } from 'react';
import { Stack } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { StyleSheet, Platform, AppState } from 'react-native';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import * as SplashScreen from 'expo-splash-screen';
import * as Font from 'expo-font';
import * as Device from 'expo-device';
import * as Notifications from 'expo-notifications';
import Constants from 'expo-constants';
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

export default function RootLayout() {
  const [fontsLoaded, setFontsLoaded] = useState(false);
  const [authReady, setAuthReady] = useState(false);
  const [userId, setUserId] = useState<string | null>(null);
  const pushRegisteredForUserRef = useRef<string | null>(null);

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
          await Notifications.setNotificationChannelAsync('default', {
            name: 'Notifications',
            importance: Notifications.AndroidImportance.MAX,
            vibrationPattern: [0, 250, 250, 250],
            lightColor: '#7C5CFF',
            sound: 'default',
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

  // ---------- Hide splash AFTER first native layout (no blank frame) ----------
  const onLayoutRootView = useCallback(async () => {
    if (fontsLoaded && authReady) {
      await SplashScreen.hideAsync().catch(() => {});
    }
  }, [fontsLoaded, authReady]);

  // While not ready, keep returning null → splash stays visible
  if (!fontsLoaded || !authReady) {
    return null;
  }

  return (
    <GestureHandlerRootView style={styles.root} onLayout={onLayoutRootView}>
      <SafeAreaProvider>
        <StatusBar style="light" />
        <Stack
          screenOptions={{
            headerShown: false,
            contentStyle: { backgroundColor: '#000000' },
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
      </SafeAreaProvider>
    </GestureHandlerRootView>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: '#000000' },
});
