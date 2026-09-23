// app/_layout.tsx
// Root layout — fonts, auth, theme, navigation stack

import { useEffect, useState } from 'react';
import { Stack } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { View, ActivityIndicator, StyleSheet, Text } from 'react-native';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import * as SplashScreen from 'expo-splash-screen';
import * as Font from 'expo-font';
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
import { COLORS } from '../constants/theme';
import { supabase } from '../lib/supabase';

SplashScreen.preventAutoHideAsync().catch(() => {});

export default function RootLayout() {
  const [fontsLoaded, setFontsLoaded] = useState(false);
  const [authReady, setAuthReady] = useState(false);

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
    supabase.auth.getSession().then(() => {
      if (mounted) setAuthReady(true);
    });
    const { data: listener } = supabase.auth.onAuthStateChange(() => {
      if (mounted) setAuthReady(true);
    });
    return () => {
      mounted = false;
      listener.subscription.unsubscribe();
    };
  }, []);

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
            contentStyle: { backgroundColor: COLORS.ink900 },
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
    backgroundColor: COLORS.ink900,
  },
  loadingContainer: {
    flex: 1,
    backgroundColor: COLORS.ink900,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 16,
  },
  loadingText: {
    color: COLORS.text,
    fontSize: 18,
    fontWeight: '600',
    letterSpacing: 0.5,
  },
});
