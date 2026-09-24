// app/call/[id].tsx
// Voice call screen (UI only — WebRTC would need react-native-webrtc)

import { useEffect, useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  ActivityIndicator,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { COLORS, FONTS, SPACING } from '../../constants/theme';
import { supabase } from '../../lib/supabase';
import Avatar from '../../components/Avatar';

type Profile = {
  id: string;
  display_name: string;
  username: string;
  avatar_color: string;
  avatar_url: string | null;
  verified: boolean | null;
};

export default function CallScreen() {
  const router = useRouter();
  const params = useLocalSearchParams<{ id: string }>();
  const userId = params.id;

  const [profile, setProfile] = useState<Profile | null>(null);
  const [loading, setLoading] = useState(true);
  const [callState, setCallState] = useState<'calling' | 'connected'>(
    'calling'
  );
  const [seconds, setSeconds] = useState(0);
  const [micOn, setMicOn] = useState(true);

  useEffect(() => {
    async function load() {
      if (!userId) return;
      const { data } = await supabase
        .from('profiles')
        .select('*')
        .eq('id', userId)
        .single();
      setProfile(data as Profile);
      setLoading(false);

      setTimeout(() => setCallState('connected'), 2000);
    }
    load();
  }, [userId]);

  useEffect(() => {
    if (callState !== 'connected') return;
    const t = setInterval(() => setSeconds((s) => s + 1), 1000);
    return () => clearInterval(t);
  }, [callState]);

  function formatTime(s: number) {
    const m = Math.floor(s / 60).toString().padStart(2, '0');
    const sec = (s % 60).toString().padStart(2, '0');
    return `${m}:${sec}`;
  }

  if (loading || !profile) {
    return (
      <View style={styles.loadingWrap}>
        <ActivityIndicator color={COLORS.violet} />
      </View>
    );
  }

  return (
    <View style={styles.container}>
      <View style={styles.glowTop} />
      <View style={styles.glowBottom} />

      <SafeAreaView style={styles.safe} edges={['top', 'bottom']}>
        <View style={styles.body}>
          <View style={styles.avatarWrap}>
            <View
              style={[
                styles.avatarRing,
                callState === 'connected' && styles.avatarRingConnected,
              ]}
            >
              <Avatar
                name={profile.display_name}
                color={profile.avatar_color}
                avatarUrl={profile.avatar_url}
                size={100}
              />
            </View>
          </View>

          <View style={styles.nameRow}>
            <Text style={styles.name}>{profile.display_name}</Text>
            {profile.verified && (
              <Ionicons
                name="checkmark-circle"
                size={16}
                color={COLORS.violetLight}
                style={{ marginLeft: 6 }}
              />
            )}
          </View>
          <Text style={styles.username}>@{profile.username}</Text>

          <Text style={styles.status}>
            {callState === 'calling' ? 'Calling…' : formatTime(seconds)}
          </Text>
        </View>

        <View style={styles.controls}>
          <TouchableOpacity
            style={styles.iconBtn}
            onPress={() => setMicOn((v) => !v)}
            activeOpacity={0.85}
          >
            <Ionicons
              name={micOn ? 'mic-outline' : 'mic-off-outline'}
              size={22}
              color={micOn ? '#FFFFFF' : COLORS.danger}
            />
          </TouchableOpacity>

          <TouchableOpacity
            style={styles.hangupBtn}
            onPress={() => router.back()}
            activeOpacity={0.85}
          >
            <Ionicons
              name="call"
              size={24}
              color="#FFFFFF"
              style={{ transform: [{ rotate: '135deg' }] }}
            />
          </TouchableOpacity>

          <TouchableOpacity
            style={styles.iconBtn}
            onPress={() => {}}
            activeOpacity={0.85}
          >
            <Ionicons
              name="volume-high-outline"
              size={22}
              color="#FFFFFF"
            />
          </TouchableOpacity>
        </View>
      </SafeAreaView>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#07080D',
  },
  safe: { flex: 1 },
  loadingWrap: {
    flex: 1,
    backgroundColor: '#07080D',
    alignItems: 'center',
    justifyContent: 'center',
  },
  glowTop: {
    position: 'absolute',
    top: -200,
    left: -100,
    width: 500,
    height: 500,
    borderRadius: 250,
    backgroundColor: 'rgba(124,92,255,0.22)',
  },
  glowBottom: {
    position: 'absolute',
    bottom: -200,
    right: -100,
    width: 460,
    height: 460,
    borderRadius: 230,
    backgroundColor: 'rgba(34,211,184,0.10)',
  },

  body: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: SPACING.lg,
  },
  avatarWrap: {
    marginBottom: SPACING.lg,
  },
  avatarRing: {
    padding: 5,
    borderRadius: 999,
    borderWidth: 2,
    borderColor: 'rgba(124,92,255,0.4)',
  },
  avatarRingConnected: {
    borderColor: 'rgba(34,211,184,0.6)',
  },
  nameRow: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  name: {
    fontSize: 20,
    fontFamily: FONTS.displayBold,
    color: '#FFFFFF',
  },
  username: {
    fontSize: 13,
    fontFamily: FONTS.body,
    color: COLORS.mist,
    marginTop: 3,
  },
  status: {
    fontSize: 14,
    fontFamily: FONTS.bodyMedium,
    color: COLORS.teal,
    marginTop: SPACING.md,
  },

  controls: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 20,
    paddingBottom: SPACING.xl,
  },
  iconBtn: {
    width: 54,
    height: 54,
    borderRadius: 27,
    backgroundColor: 'rgba(255,255,255,0.08)',
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.10)',
  },
  hangupBtn: {
    width: 60,
    height: 60,
    borderRadius: 30,
    backgroundColor: COLORS.danger,
    alignItems: 'center',
    justifyContent: 'center',
    shadowColor: COLORS.danger,
    shadowOffset: { width: 0, height: 8 },
    shadowOpacity: 0.5,
    shadowRadius: 16,
    elevation: 10,
  },
});
