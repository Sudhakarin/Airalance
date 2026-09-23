// app/settings/index.tsx
// Settings screen — profile, privacy, account options

import { useEffect, useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  TouchableOpacity,
  Alert,
  ActivityIndicator,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { LinearGradient } from 'expo-linear-gradient';
import { COLORS, FONTS, RADII, SPACING } from '../../constants/theme';
import { supabase } from '../../lib/supabase';
import Avatar from '../../components/Avatar';
import VerifiedBadge from '../../components/VerifiedBadge';

type Profile = {
  id: string;
  username: string;
  display_name: string;
  avatar_color: string;
  avatar_url: string | null;
  verified: boolean | null;
};

export default function SettingsScreen() {
  const router = useRouter();
  const [profile, setProfile] = useState<Profile | null>(null);
  const [loading, setLoading] = useState(true);
  const [loggingOut, setLoggingOut] = useState(false);

  useEffect(() => {
    async function load() {
      const { data: authData } = await supabase.auth.getUser();
      if (!authData.user) {
        setLoading(false);
        return;
      }
      const { data } = await supabase
        .from('profiles')
        .select('*')
        .eq('id', authData.user.id)
        .single();
      setProfile(data as Profile);
      setLoading(false);
    }
    load();
  }, []);

  async function handleLogout() {
    Alert.alert('Log out', 'Are you sure you want to log out?', [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Log out',
        style: 'destructive',
        onPress: async () => {
          setLoggingOut(true);
          await supabase.auth.signOut();
          router.replace('/(auth)/login');
        },
      },
    ]);
  }

  if (loading) {
    return (
      <SafeAreaView style={styles.safe} edges={['top']}>
        <View style={styles.loadingWrap}>
          <ActivityIndicator color={COLORS.violet} />
        </View>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      <View style={styles.glowTop} />

      <View style={styles.header}>
        <TouchableOpacity
          style={styles.headerBtn}
          onPress={() => router.back()}
          activeOpacity={0.7}
        >
          <Ionicons name="chevron-back" size={26} color={COLORS.text} />
        </TouchableOpacity>
        <Text style={styles.headerTitle}>Settings</Text>
        <View style={{ width: 46 }} />
      </View>

      <ScrollView
        contentContainerStyle={styles.scroll}
        showsVerticalScrollIndicator={false}
      >
        {profile && (
          <View style={styles.userCard}>
            <Avatar
              name={profile.display_name}
              color={profile.avatar_color}
              avatarUrl={profile.avatar_url}
              size={68}
            />
            <View style={styles.userInfo}>
              <View style={styles.userNameRow}>
                <Text style={styles.userName} numberOfLines={1}>
                  {profile.display_name}
                </Text>
                {profile.verified && <VerifiedBadge size={18} />}
              </View>
              <Text style={styles.userUsername}>@{profile.username}</Text>
            </View>
          </View>
        )}

        <SectionTitle>How you use Airalance</SectionTitle>
        <SettingsGroup>
          <SettingsRow
            icon="time-outline"
            tint="#6EA8FF"
            title="Time management"
            subtitle="See how much time you spend"
            onPress={() => {}}
          />
          <Divider />
          <SettingsRow
            icon="color-palette-outline"
            tint="#FFB067"
            title="Appearance"
            subtitle="Chat theme and wallpaper"
            onPress={() => {}}
          />
        </SettingsGroup>

        <SectionTitle>Privacy</SectionTitle>
        <SettingsGroup>
          <SettingsRow
            icon="at-outline"
            tint="#B79CFF"
            title="Tag and mention"
            subtitle="Choose who can tag or mention you"
            onPress={() => {}}
          />
          <Divider />
          <SettingsRow
            icon="ban-outline"
            tint="#FF8A8A"
            title="Blocked"
            subtitle="Accounts you have blocked"
            onPress={() => {}}
          />
        </SettingsGroup>

        <SectionTitle>Account</SectionTitle>
        <SettingsGroup>
          <SettingsRow
            icon="checkmark-circle-outline"
            tint="#3EE0C4"
            title="Request verification"
            subtitle="Apply for the verified badge"
            onPress={() => {}}
          />
          <Divider />
          <SettingsRow
            icon="shield-checkmark-outline"
            tint="#4ADE9A"
            title="Account status"
            subtitle="Check your account standing"
            onPress={() => {}}
          />
          <Divider />
          <SettingsRow
            icon="person-add-outline"
            tint="#FFC857"
            title="Invite friends"
            subtitle="Share Airalance with your friends"
            onPress={() => {}}
          />
        </SettingsGroup>

        <SectionTitle>Subscription</SectionTitle>
        <TouchableOpacity style={styles.premiumCard} activeOpacity={0.85}>
          <LinearGradient
            colors={['rgba(167,139,250,0.20)', 'rgba(244,96,122,0.10)']}
            start={{ x: 0, y: 0 }}
            end={{ x: 1, y: 1 }}
            style={styles.premiumCardInner}
          >
            <View style={styles.premiumIcon}>
              <Ionicons name="sparkles" size={24} color="#FFFFFF" />
            </View>
            <View style={{ flex: 1 }}>
              <Text style={styles.premiumTitle}>Aira One</Text>
              <Text style={styles.premiumSub}>Coming soon</Text>
            </View>
            <Ionicons
              name="chevron-forward"
              size={22}
              color="rgba(255,255,255,0.5)"
            />
          </LinearGradient>
        </TouchableOpacity>

        <TouchableOpacity
          style={styles.logoutBtn}
          onPress={handleLogout}
          disabled={loggingOut}
          activeOpacity={0.85}
        >
          {loggingOut ? (
            <ActivityIndicator color={COLORS.danger} />
          ) : (
            <Text style={styles.logoutText}>Log out</Text>
          )}
        </TouchableOpacity>

        <Text style={styles.version}>Airalance v1.0.0</Text>
      </ScrollView>
    </SafeAreaView>
  );
}

function SectionTitle({ children }: { children: React.ReactNode }) {
  return <Text style={styles.sectionTitle}>{children}</Text>;
}

function SettingsGroup({ children }: { children: React.ReactNode }) {
  return <View style={styles.group}>{children}</View>;
}

function Divider() {
  return <View style={styles.divider} />;
}

function SettingsRow({
  icon,
  tint,
  title,
  subtitle,
  onPress,
}: {
  icon: any;
  tint: string;
  title: string;
  subtitle?: string;
  onPress: () => void;
}) {
  return (
    <TouchableOpacity
      style={styles.row}
      onPress={onPress}
      activeOpacity={0.7}
    >
      <View style={[styles.rowIcon, { backgroundColor: tint }]}>
        <Ionicons name={icon} size={22} color="#FFFFFF" />
      </View>
      <View style={{ flex: 1, minWidth: 0 }}>
        <Text style={styles.rowTitle}>{title}</Text>
        {subtitle && (
          <Text style={styles.rowSubtitle} numberOfLines={1}>
            {subtitle}
          </Text>
        )}
      </View>
      <Ionicons
        name="chevron-forward"
        size={22}
        color="rgba(255,255,255,0.3)"
      />
    </TouchableOpacity>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: '#000000' },
  scroll: { paddingBottom: SPACING.xxl, paddingHorizontal: 18 },
  loadingWrap: {
    flex: 1,
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
    backgroundColor: 'rgba(124,92,255,0.12)',
  },

  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 14,
    paddingVertical: 14,
  },
  // Header button — 46 (was 40)
  headerBtn: {
    width: 46,
    height: 46,
    borderRadius: 23,
    alignItems: 'center',
    justifyContent: 'center',
  },
  // Header title — 22 (was 17)
  headerTitle: {
    fontSize: 22,
    fontFamily: FONTS.displayBold,
    color: '#FFFFFF',
  },

  // User card — bigger padding
  userCard: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 14,
    padding: 18,
    borderRadius: RADII.xl,
    backgroundColor: 'rgba(124,92,255,0.10)',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.06)',
    marginTop: 16,
  },
  userInfo: { flex: 1, minWidth: 0 },
  userNameRow: { flexDirection: 'row', alignItems: 'center' },
  // User name — 19 (was 16)
  userName: {
    fontSize: 19,
    fontFamily: FONTS.bodySemiBold,
    color: '#FFFFFF',
    flexShrink: 1,
  },
  // Username — 15.5 (was 13)
  userUsername: {
    fontSize: 15.5,
    fontFamily: FONTS.body,
    color: COLORS.mist,
    marginTop: 3,
  },

  // Section title — 13.5 (was 11)
  sectionTitle: {
    fontSize: 13.5,
    fontFamily: FONTS.bodySemiBold,
    color: COLORS.mist,
    textTransform: 'uppercase',
    letterSpacing: 0.8,
    marginTop: SPACING.xl,
    marginBottom: SPACING.md,
    paddingHorizontal: 4,
    opacity: 0.75,
  },
  group: {
    backgroundColor: 'rgba(255,255,255,0.04)',
    borderRadius: RADII.xl,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.06)',
    overflow: 'hidden',
  },
  // Row — bigger padding
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 14,
    paddingHorizontal: 18,
    paddingVertical: 18,
  },
  // Row icon — 46 (was 36)
  rowIcon: {
    width: 46,
    height: 46,
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center',
  },
  // Row title — 18 (was 15)
  rowTitle: {
    fontSize: 18,
    fontFamily: FONTS.bodyMedium,
    color: '#FFFFFF',
  },
  // Row subtitle — 14.5 (was 12)
  rowSubtitle: {
    fontSize: 14.5,
    fontFamily: FONTS.body,
    color: COLORS.mist,
    marginTop: 3,
  },
  divider: {
    height: 1,
    backgroundColor: 'rgba(255,255,255,0.05)',
    marginLeft: 78,
  },

  premiumCard: {
    borderRadius: RADII.xl,
    overflow: 'hidden',
    borderWidth: 1.5,
    borderColor: 'rgba(167,139,250,0.4)',
  },
  premiumCardInner: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 14,
    padding: 18,
  },
  // Premium icon — 54 (was 44)
  premiumIcon: {
    width: 54,
    height: 54,
    borderRadius: 14,
    backgroundColor: 'rgba(244,96,122,0.6)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  // Premium title — 20 (was 16)
  premiumTitle: {
    fontSize: 20,
    fontFamily: FONTS.displayBold,
    color: '#FFFFFF',
  },
  // Premium sub — 14.5 (was 12)
  premiumSub: {
    fontSize: 14.5,
    fontFamily: FONTS.body,
    color: COLORS.mist,
    marginTop: 3,
  },

  logoutBtn: {
    marginTop: SPACING.xl,
    paddingVertical: 19,
    borderRadius: RADII.xl,
    borderWidth: 1,
    borderColor: 'rgba(239,68,68,0.3)',
    backgroundColor: 'rgba(239,68,68,0.08)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  // Logout text — 18 (was 15)
  logoutText: {
    color: COLORS.danger,
    fontSize: 18,
    fontFamily: FONTS.bodySemiBold,
  },

  // Version — 13 (was 11)
  version: {
    textAlign: 'center',
    color: COLORS.mist,
    fontSize: 13,
    fontFamily: FONTS.body,
    marginTop: SPACING.xl,
    opacity: 0.5,
  },
});
