// app/index.tsx
// Entry point — decides where to send the user (login or tabs)

import { useEffect, useState } from 'react';
import { View, ActivityIndicator, StyleSheet, Text } from 'react-native';
import { useRouter } from 'expo-router';
import { COLORS, FONTS } from '../constants/theme';
import { supabase } from '../lib/supabase';

export default function Index() {
  const router = useRouter();
  const [checking, setChecking] = useState(true);

  useEffect(() => {
    let mounted = true;

    async function checkAuth() {
      try {
        const { data, error } = await supabase.auth.getSession();
        if (!mounted) return;

        if (error) {
          console.warn('Auth check error:', error.message);
        }

        // Small delay so the splash feels smooth (not a flash)
        await new Promise((resolve) => setTimeout(resolve, 400));
        if (!mounted) return;

        if (data.session) {
          // Logged in — go to main app
          router.replace('/(tabs)/home');
        } else {
          // Not logged in — go to login
          router.replace('/(auth)/login');
        }
      } catch (err) {
        console.warn('Auth check crashed:', err);
        if (mounted) router.replace('/(auth)/login');
      } finally {
        if (mounted) setChecking(false);
      }
    }

    checkAuth();

    return () => {
      mounted = false;
    };
  }, [router]);

  return (
    <View style={styles.container}>
      {/* Background glow — same as website */}
      <View style={styles.glowTop} />
      <View style={styles.glowBottom} />

      {/* Logo / Brand */}
      <View style={styles.logoWrap}>
        <Text style={styles.brand}>Airalance!</Text>
        <Text style={styles.tagline}>Where Privacy Matters</Text>
      </View>

      {/* Loading spinner */}
      {checking && (
        <View style={styles.loaderWrap}>
          <ActivityIndicator size="large" color={COLORS.violet} />
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: COLORS.ink900,
    alignItems: 'center',
    justifyContent: 'center',
    overflow: 'hidden',
  },

  // Aurora-style glow backgrounds (matches website)
  glowTop: {
    position: 'absolute',
    top: -200,
    width: 500,
    height: 500,
    borderRadius: 250,
    backgroundColor: 'rgba(124, 92, 255, 0.18)', // violet glow
  },
  glowBottom: {
    position: 'absolute',
    bottom: -150,
    right: -150,
    width: 400,
    height: 400,
    borderRadius: 200,
    backgroundColor: 'rgba(34, 211, 184, 0.08)', // teal glow
  },

  // Logo
  logoWrap: {
    alignItems: 'center',
    justifyContent: 'center',
  },
  brand: {
    fontSize: 44,
    fontFamily: FONTS.displayBold,
    color: '#FFFFFF',
    letterSpacing: -0.5,
    textAlign: 'center',
  },
  tagline: {
    marginTop: 8,
    fontSize: 14,
    fontFamily: FONTS.body,
    color: COLORS.mist,
    letterSpacing: 0.3,
  },

  // Loader
  loaderWrap: {
    position: 'absolute',
    bottom: 80,
  },
});
