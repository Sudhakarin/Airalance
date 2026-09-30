// app/index.tsx
// Entry point — decides where to send the user (welcome or tabs)

import { useEffect } from 'react';
import { View, StyleSheet } from 'react-native';
import { useRouter } from 'expo-router';
import { supabase } from '../lib/supabase';

export default function Index() {
  const router = useRouter();

  useEffect(() => {
    let mounted = true;

    async function checkAuth() {
      try {
        const { data, error } = await supabase.auth.getSession();
        if (!mounted) return;

        if (error) {
          console.warn('Auth check error:', error.message);
        }

        if (data.session) {
          router.replace('/(tabs)/home');
        } else {
          router.replace('/(auth)/welcome');
        }
      } catch (err) {
        console.warn('Auth check crashed:', err);
        if (mounted) router.replace('/(auth)/welcome');
      }
    }

    checkAuth();

    return () => {
      mounted = false;
    };
  }, [router]);

  // Blank screen — splash will stay visible until route is decided
  return <View style={styles.container} />;
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#0A0C12',
  },
});
