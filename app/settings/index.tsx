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

      {/* Header */}
      <View style={styles.header}>
        <TouchableOpacity
          style={styles.headerBtn}
          onPress={() => router.back()}
          activeOpacity={0.7}
        >
          <Ionicons name="chevron-back" size={22} color={COLORS.text} />
        </TouchableOpacity>
        <Text style={styles.headerTitle}>Settings</Text>
        <View style={{ width: 40 }} />
      </View>

      <ScrollView
        contentContainerStyle={styles.scroll}
        showsVerticalScrollIndicator={false}
      >
        {/* User card */}
        {profile && (
          <View style={styles.userCard}>
            <Avatar
              name={profile.display_name}
              color={profile.avatar_color}
              avatarUrl={profile.avatar_url}
              size={56}
            />
            <View style={styles.userInfo}>
              <View style={styles.userNameRow}>
                <Text style={styles.userName} numberOfLines={1}>
                  {profile.display_name}
                </Text>
                {profile.verified && (
                  <Ionicons
                    name="checkmark-circle"
                    size={15}
                    color={COLORS.violetLight}
                    style={{ marginLeft: 4 }}
                  />
                )}
              </View>
              <Text style={styles.userUsername}>@{profile.username}</Text>
            </View>
          </View>
        )}

        {/* Section: How you use Airalance */}
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

        {/* Section: Privacy */}
        <SectionTitle>Privacy</SectionTitle>
        <SettingsGroup>
          <SettingsRow
            icon="at-outline"
            tint="#B79CFF"
            title="Tag & mention"
            subtitle="Choose who can tag or mention you"
            onPress={() => {}}
          />
          <Divider />
          <SettingsRow
            icon="ban-outline"
            tint="#FF8A8A"
            title="Blocked"
            subtitle="Accounts you've blocked"
            onPress={() => {}}
          />
        </SettingsGroup>

        {/* Section: Account */}
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
            subtitle="Check your account's standing"
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

        {/* Section: Subscription */}
        <SectionTitle>Subscription</SectionTitle>
        <TouchableOpacity
          style={styles.premiumCard}
          activeOpacity={0.85}
        >
          <LinearGradient
            colors={['rgba(167,139,250,0.20)', 'rgba(244,96,122,0.10)']}
            start={{ x: 0, y: 0 }}
            end={{ x: 1, y: 1 }}
            style={styles.premiumCardInner}
          >
            <View style={styles.premiumIcon}>
              <Ionicons name="sparkles" size={20} color="#FFFFFF" />
            </View>
            <View style={{ flex: 1 }}>
              <Text style={styles.premiumTitle}>Aira One</Text>
              <Text style={styles.premiumSub}>Coming soon</Text>
            </View>
            <Ionicons
              name="chevron-forward"
              size={18}
              color="rgba(255,255,255,0.5)"
            />
          </LinearGradient>
        </TouchableOpacity>

        {/* Log out */}
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

        <Text style={styles.version}>Airalance · v1.0.0</Text>
      </ScrollView>
    </SafeAreaView>
  );
}

// ---- Small helper components ----

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
        <Ionicons name={icon} size={18} color="#FFFFFF" />
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
        size={18}
        color="rgba(255,255,255,0.3)"
      />
    </TouchableOpacity>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: COLORS.ink900 },
  scroll: { paddingBottom: SPACING.xxl, paddingHorizontal: SPACING.md },
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
    paddingHorizontal: SPACING.sm,
    paddingVertical: SPACING.sm,
  },
  headerBtn: {
    width: 40,
    height: 40,
    borderRadius: 20,
    alignItems: 'center',
    justifyContent: 'center',
  },
  headerTitle: {
    fontSize: 17,
    fontFamily: FONTS.displayBold,
    color: '#FFFFFF',
  },

  userCard: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: SPACING.md,
    padding: SPACING.md,
    borderRadius: RADII.xl,
    backgroundColor: 'rgba(124,92,255,0.10)',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.06)',
    marginTop: SPACING.md,
  },
  userInfo: { flex: 1, minWidth: 0 },
  userNameRow: { flexDirection: 'row', alignItems: 'center' },
  userName: {
    fontSize: 16,
    fontFamily: FONTS.bodySemiBold,
    color: '#FFFFFF',
    flexShrink: 1,
  },
  userUsername: {
    fontSize: 13,
    fontFamily: FONTS.body,
    color: COLORS.mist,
    marginTop: 2,
  },

  sectionTitle: {
    fontSize: 11,
    fontFamily: FONTS.bodySemiBold,
    color: COLORS.mist,
    textTransform: 'uppercase',
    letterSpacing: 0.8,
    marginTop: SPACING.xl,
    marginBottom: SPACING.sm,
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
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: SPACING.md,
    paddingHorizontal: SPACING.md,
    paddingVertical: 14,
  },
  rowIcon: {
    width: 36,
    height: 36,
    borderRadius: 10,
    alignItems: 'center',
    justifyContent: 'center',
  },
  rowTitle: {
    fontSize: 15,
    fontFamily: FONTS.bodyMedium,
    color: '#FFFFFF',
  },
  rowSubtitle: {
    fontSize: 12,
    fontFamily: FONTS.body,
    color: COLORS.mist,
    marginTop: 2,
  },
  divider: {
    height: 1,
    backgroundColor: 'rgba(255,255,255,0.05)',
    marginLeft: 60,
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
    gap: SPACING.md,
    padding: SPACING.md,
  },
  premiumIcon: {
    width: 44,
    height: 44,
    borderRadius: 12,
    backgroundColor: 'rgba(244,96,122,0.6)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  premium',
Title: {
    fontSize:    16,
    fontFamily: FONTS.displayBold,
    justifyContent color: '#FFFFFF',
  },
  premiumSub:: {
    fontSize: 12,
    fontFamily ': FONTS.body,
    color: COLORS.mist,
    marginTop: 2,
  },

  logoutBtn: {
    marginTop: SPACING.xl,
    paddingVertical: 16,
    borderRadius: RADII.xl,
    borderWidth: 1,
    borderColor: 'rgba(239,68,68,0.3)',
    backgroundColor: 'rgba(239,68,68,0.08)',
    alignItems: 'centercenter',
  },
  logoutText: {
    color: COLORS.danger,
    fontSize: 15,
    fontFamily: FONTS.bodySemiBold,
  },

  version: {
    textAlign: 'center',
    color: COLORS.mist,
    fontSize: 11,
    fontFamily: FONTS.body,
    marginTop: SPACING.xl,
    opacity: 0.5,
  },
});
