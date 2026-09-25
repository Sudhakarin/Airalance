// app/_layout.tsx
// Root layout — fonts, auth, theme, navigation stack, push notifications

import { useEffect, useState } from 'react';
import { Stack } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { View, ActivityIndicator, StyleSheet, Text, Platform } from 'react-native';
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
import { COLORS } from '../constants/theme';
import { supabase } from '../lib/supabase';

SplashScreen.preventAutoHideAsync().catch(() => {});

Notifications.setNotificationHandler({
  handleNotification: async () => ({
    shouldPlaySound: true,
    shouldSetBadge: true,
    shouldShowBanner: true,
    shouldShowList: true,
  }),
});

export default function RootLayout() {
  const [fontsLoaded, setFontsLoaded] = useState(false);
  const [authReady, setAuthReady] = useState(false);
  const [userId, setUserId] = useState<string | null>(null);

  useEffect(() => {
    if (Platform.OS !== 'web') return;
    if (typeof document === 'undefined') return;

    const style = document.createElement('style');
    style.id = 'hide-scrollbars';
    style.innerHTML = `
      * {
        scrollbar-width: none !important;
        -ms-overflow-style: none !important;
      }
      *::-webkit-scrollbar {
        display: none !important;
        width: 0 !important;
        height: 0 !important;
      }
      html, body {
        scrollbar-width: none !important;
        -ms-overflow-style: none !important;
      }
      html::-webkit-scrollbar,
      body::-webkit-scrollbar {
        display: none !important;
        width: 0 !important;
        height: 0 !important;
      }
    `;
    if (!document.getElementById('hide-scrollbars')) {
      document.head.appendChild(style);
    }
  }, []);

  useEffect(() => {
    async function loadFonts() {
      try {
        await Font.loadAsync({
          Inter_400Regular,
          Inter_500Medium,
          Inter_600SemiBold,
          Poppins_400Regular,
          Poppins_500Medium,
          Poppins_600SemiBold,
          Poppins_700Bold,
          JetBrainsMono_400Regular,
        });
      } catch (e) {
        console.warn('Font loading failed', e);
      } finally {
        setFontsLoaded(true);
      }
    }
    loadFonts();
  }, []);

  useEffect(() => {
    let mounted = true;
    supabase.auth.getSession().then(({ data: { session } }) => {
      if (mounted) {
        setUserId(session?.user?.id ?? null);
        setAuthReady(true);
      }
    });
    const { data: listener } = supabase.auth.onAuthStateChange(
      (_event, session) => {
        if (mounted) {
          setUserId(session?.user?.id ?? null);
          setAuthReady(true);
        }
      }
    );
    return () => {
      mounted = false;
      listener.subscription.unsubscribe();
    };
  }, []);

  useEffect(() => {
    if (!authReady || !userId) return;

    async function registerForPushNotificationsAsync() {
      if (Platform.OS === 'web') return;

      if (!Device.isDevice) {
        console.log('[push] Must use physical device for push notifications');
        return;
      }

      // ALWAYS register Android channel FIRST (needed for Settings to show Notifications section)
      if (Platform.OS === 'android') {
        try {
          await Notifications.setNotificationChannelAsync('default', {
            name: 'Notifications',
            importance: Notifications.AndroidImportance.MAX,
            vibrationPattern: [0, 250, 250, 250],
            lightColor: '#7C5CFF',
            sound: 'default',
          });
          console.log('[push] Android channel registered');
        } catch (channelErr) {
          console.warn('[push] Channel register failed:', channelErr);
        }
      }

      // Then check/request permission
      const { status: existingStatus } =
        await Notifications.getPermissionsAsync();
      let finalStatus = existingStatus;

      if (existingStatus !== 'granted') {
        const { status } = await Notifications.requestPermissionsAsync();
        finalStatus = status;
      }

      if (finalStatus !== 'granted') {
        console.log('[push] Permission not granted');
        return;
      }

      try {
        const projectId =
          Constants.expoConfig?.extra?.eas?.projectId ??
          Constants.easConfig?.projectId;

        if (!projectId) {
          console.warn('[push] No projectId found');
          return;
        }

        const token = (
          await Notifications.getExpoPushTokenAsync({ projectId })
        ).data;

        console.log('[push] Expo Push Token:', token);

        const { data: { user }, error: userError } =
          await supabase.auth.getUser();
        console.log(
          '[push] Current user:',
          user?.id ?? 'null',
          'Error:',
          userError
        );

        if (user && token) {
          const { error: updateError } = await supabase
            .from('profiles')
            .update({ expo_push_token: token })
            .eq('id', user.id);

          if (updateError) {
            console.error('[push] Token save FAILED:', updateError);
          } else {
            console.log('[push] Token SAVED successfully to Supabase');
          }
        } else {
          console.warn('[push] Skipped saving: user or token is missing');
        }
      } catch (err) {
        console.warn('[push] Token registration failed:', err);
      }
    }

    registerForPushNotificationsAsync();
  }, [authReady, userId]);

  useEffect(() => {
    if (fontsLoaded && authReady) {
      SplashScreen.hideAsync().catch(() => {});
    }
  }, [fontsLoaded, authReady]);

  if (!fontsLoaded || !authReady) {
    return (
      <View style={styles.loadingContainer}>
        <ActivityIndicator size="large" color={COLORS.violet} />
        <Text style={styles.loadingText}>Airalance</Text>
      </View>
    );
  }

  return (
    <GestureHandlerRootView style={styles.root}>
      <SafeAreaProvider>
        <StatusBar style="light" />
        <Stack
          screenOptions={{
            headerShown: false,
            contentStyle: { backgroundColor: '#000000' },
            animation: 'fade',
          }}
        >
          <Stack.Screen name="index" options={{ animation: 'none' }} />
          <Stack.Screen name="(auth)" options={{ animation: 'fade' }} />
          <Stack.Screen name="(tabs)" options={{ animation: 'fade' }} />
          <Stack.Screen
            name="chat/[id]"
            options={{ animation: 'slide_from_right' }}
          />
          <Stack.Screen
            name="profile/[id]"
            options={{ animation: 'slide_from_right' }}
          />
          <Stack.Screen
            name="status/[userId]"
            options={{ animation: 'fade' }}
          />
          <Stack.Screen
            name="status/create"
            options={{ animation: 'slide_from_bottom' }}
          />
          <Stack.Screen
            name="news/[id]"
            options={{ animation: 'slide_from_right' }}
          />
          <Stack.Screen
            name="settings/index"
            options={{ animation: 'slide_from_right' }}
          />
          <Stack.Screen
            name="notifications"
            options={{ animation: 'slide_from_right' }}
          />
          <Stack.Screen
            name="call/[id]"
            options={{ animation: 'fade', presentation: 'modal' }}
          />
        </Stack>
      </SafeAreaProvider>
    </GestureHandlerRootView>
  );
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
    backgroundColor: '#000000',
  },
  loadingContainer: {
    flex: 1,
    backgroundColor: '#000000',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 20,
  },
  loadingText: {
    color: COLORS.text,
    fontSize: 24,
    fontWeight: '600',
    letterSpacing: 0.5,
  },
});
