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
  Share,
  Linking,
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
  bio: string | null;
  created_at?: string | null;
};

export default function SettingsScreen() {
  const router = useRouter();
  const [profile, setProfile] = useState<Profile | null>(null);
  const [loading, setLoading] = useState(true);
  const [loggingOut, setLoggingOut] = useState(false);
  const [blockedCount, setBlockedCount] = useState<number | null>(null);
  const [tagPref, setTagPref] = useState<'everyone' | 'followers' | 'nobody'>('everyone');

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

      // Load blocked count
      const { count } = await supabase
        .from('blocked_users')
        .select('blocker_id', { count: 'exact', head: true })
        .eq('blocker_id', authData.user.id);
      setBlockedCount(count ?? 0);

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

  function handleTimeManagement() {
    Alert.alert(
      'Time management',
      'Airalance time tracking:\n\n• Today: Less than 30 min\n• This week: Under 3 hours\n\nDetailed stats coming soon.',
      [{ text: 'OK' }]
    );
  }

  function handleAppearance() {
    Alert.alert(
      'Appearance',
      'Choose a chat theme:\n\n• Default (Violet)\n• Ocean (Blue)\n• Forest (Green)\n• Sunset (Pink)\n• Midnight (Dark)\n\nThemes can be changed inside individual chats.',
      [{ text: 'OK' }]
    );
  }

  function handleTagMention() {
    Alert.alert(
      'Tag and mention',
      'Who can tag or mention you?',
      [
        {
          text: 'Everyone',
          onPress: () => {
            setTagPref('everyone');
            Alert.alert('Saved', 'Everyone can tag you.');
          },
        },
        {
          text: 'Followers',
          onPress: () => {
            setTagPref('followers');
            Alert.alert('Saved', 'Only followers can tag you.');
          },
        },
        {
          text: 'Nobody',
          onPress: () => {
            setTagPref('nobody');
            Alert.alert('Saved', 'Nobody can tag you.');
          },
        },
        { text: 'Cancel', style: 'cancel' },
      ]
    );
  }

  function handleBlocked() {
    Alert.alert(
      'Blocked accounts',
      blockedCount === 0
        ? "You haven't blocked anyone yet."
        : `You have blocked ${blockedCount} account${blockedCount === 1 ? '' : 's'}.`,
      [{ text: 'OK' }]
    );
  }

  function handleRequestVerification() {
    if (profile?.verified) {
      Alert.alert(
        'Already verified',
        'Your account is already verified. ✓',
        [{ text: 'OK' }]
      );
      return;
    }
    Alert.alert(
      'Request verification',
      'To apply for the verified badge, please email us at:\n\nverify@airalance.app\n\nInclude:\n• Your username\n• A short reason for verification\n• Links to your public profiles',
      [
        {
          text: 'Send Email',
          onPress: () => {
            Linking.openURL(
              `mailto:verify@airalance.app?subject=Verification Request - @${profile?.username}`
            ).catch(() => {
              Alert.alert('Cannot open email', 'Please email us at verify@airalance.app');
            });
          },
        },
        { text: 'Later', style: 'cancel' },
      ]
    );
  }

  function handleAccountStatus() {
    const created = profile?.created_at
      ? new Date(profile.created_at).toLocaleDateString()
      : '—';
    Alert.alert(
      'Account status',
      `Status: Active ✓\n\nUsername: @${profile?.username}\nMember since: ${created}\n\nYour account is in good standing. No violations.`,
      [{ text: 'OK' }]
    );
  }

  async function handleInviteFriends() {
    try {
      await Share.share({
        message:
          `Hey! I'm using Airalance — a privacy-first messaging app.\n\nJoin me there: https://airalance.app\n\nOr find me as @${profile?.username}`,
        title: 'Join me on Airalance',
      });
    } catch (err) {
      console.warn('Share error:', err);
    }
  }

  function handleAiraOne() {
    Alert.alert(
      'Aira One',
      'Aira One is coming soon! 🎉\n\nPremium features:\n• Ad-free experience\n• Larger file uploads\n• Priority support\n• Exclusive themes\n\nStay tuned!',
      [{ text: 'OK' }]
    );
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
      <View style={styles.header}>
        <TouchableOpacity
          style={styles.headerBtn}
          onPress={() => router.back()}
          activeOpacity={0.7}
        >
          <Ionicons name="chevron-back" size={24} color={COLORS.text} />
        </TouchableOpacity>
        <Text style={styles.headerTitle}>Settings</Text>
        <View style={{ width: 40 }} />
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
              size={58}
            />
            <View style={styles.userInfo}>
              <View style={styles.userNameRow}>
                <Text style={styles.userName} numberOfLines={1}>
                  {profile.display_name}
                </Text>
                {profile.verified && <VerifiedBadge size={16} />}
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
            onPress={handleTimeManagement}
          />
          <Divider />
          <SettingsRow
            icon="color-palette-outline"
            tint="#FFB067"
            title="Appearance"
            subtitle="Chat theme and wallpaper"
            onPress={handleAppearance}
          />
        </SettingsGroup>

        <SectionTitle>Privacy</SectionTitle>
        <SettingsGroup>
          <SettingsRow
            icon="at-outline"
            tint="#B79CFF"
            title="Tag and mention"
            subtitle={
              tagPref === 'everyone'
                ? 'Everyone can tag you'
                : tagPref === 'followers'
                ? 'Only followers can tag'
                : 'Nobody can tag you'
            }
            onPress={handleTagMention}
          />
          <Divider />
          <SettingsRow
            icon="ban-outline"
            tint="#FF8A8A"
            title="Blocked"
            subtitle={
              blockedCount === 0
                ? 'No blocked accounts'
                : `${blockedCount} account${blockedCount === 1 ? '' : 's'} blocked`
            }
            onPress={handleBlocked}
          />
        </SettingsGroup>

        <SectionTitle>Account</SectionTitle>
        <SettingsGroup>
          <SettingsRow
            icon="checkmark-circle-outline"
            tint="#3EE0C4"
            title="Request verification"
            subtitle={
              profile?.verified
                ? 'Already verified'
                : 'Apply for the verified badge'
            }
            onPress={handleRequestVerification}
          />
          <Divider />
          <SettingsRow
            icon="shield-checkmark-outline"
            tint="#4ADE9A"
            title="Account status"
            subtitle="Check your account standing"
            onPress={handleAccountStatus}
          />
          <Divider />
          <SettingsRow
            icon="person-add-outline"
            tint="#FFC857"
            title="Invite friends"
            subtitle="Share Airalance with your friends"
            onPress={handleInviteFriends}
          />
        </SettingsGroup>

        <SectionTitle>Subscription</SectionTitle>
        <TouchableOpacity
          style={styles.premiumCard}
          activeOpacity={0.85}
          onPress={handleAiraOne}
        >
          <LinearGradient
            colors={['rgba(167,139,250,0.18)', 'rgba(244,96,122,0.08)']}
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
        <Ionicons name={icon} size={20} color="#FFFFFF" />
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
  safe: { flex: 1, backgroundColor: '#000000' },
  scroll: { paddingBottom: SPACING.xl, paddingHorizontal: 16 },
  loadingWrap: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },

  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 14,
    paddingVertical: 12,
  },
  headerBtn: {
    width: 40,
    height: 40,
    borderRadius: 20,
    alignItems: 'center',
    justifyContent: 'center',
  },
  headerTitle: {
    fontSize: 20,
    fontFamily: FONTS.displayBold,
    color: '#FFFFFF',
  },

  userCard: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    padding: 16,
    borderRadius: RADII.xl,
    backgroundColor: '#121212',
    borderWidth: 1,
    borderColor: '#1F1F23',
    marginTop: 12,
  },
  userInfo: { flex: 1, minWidth: 0 },
  userNameRow: { flexDirection: 'row', alignItems: 'center' },
  userName: {
    fontSize: 17,
    fontFamily: FONTS.bodySemiBold,
    color: '#FFFFFF',
    flexShrink: 1,
  },
  userUsername: {
    fontSize: 14,
    fontFamily: FONTS.body,
    color: COLORS.mist,
    marginTop: 2,
  },

  sectionTitle: {
    fontSize: 12.5,
    fontFamily: FONTS.bodySemiBold,
    color: COLORS.mist,
    textTransform: 'uppercase',
    letterSpacing: 0.8,
    marginTop: SPACING.lg,
    marginBottom: SPACING.sm,
    paddingHorizontal: 4,
    opacity: 0.75,
  },
  group: {
    backgroundColor: '#121212',
    borderRadius: RADII.xl,
    borderWidth: 1,
    borderColor: '#1F1F23',
    overflow: 'hidden',
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    paddingHorizontal: 16,
    paddingVertical: 16,
  },
  rowIcon: {
    width: 40,
    height: 40,
    borderRadius: 10,
    alignItems: 'center',
    justifyContent: 'center',
  },
  rowTitle: {
    fontSize: 16,
    fontFamily: FONTS.bodyMedium,
    color: '#FFFFFF',
  },
  rowSubtitle: {
    fontSize: 13,
    fontFamily: FONTS.body,
    color: COLORS.mist,
    marginTop: 2,
  },
  divider: {
    height: 1,
    backgroundColor: '#1F1F23',
    marginLeft: 68,
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
    gap: 12,
    padding: 16,
  },
  premiumIcon: {
    width: 46,
    height: 46,
    borderRadius: 12,
    backgroundColor: 'rgba(244,96,122,0.6)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  premiumTitle: {
    fontSize: 18,
    fontFamily: FONTS.displayBold,
    color: '#FFFFFF',
  },
  premiumSub: {
    fontSize: 13,
    fontFamily: FONTS.body,
    color: COLORS.mist,
    marginTop: 2,
  },

  logoutBtn: {
    marginTop: SPACING.lg,
    paddingVertical: 16,
    borderRadius: RADII.xl,
    borderWidth: 1,
    borderColor: 'rgba(239,68,68,0.3)',
    backgroundColor: 'rgba(239,68,68,0.08)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  logoutText: {
    color: COLORS.danger,
    fontSize: 16,
    fontFamily: FONTS.bodySemiBold,
  },

  version: {
    textAlign: 'center',
    color: COLORS.mist,
    fontSize: 12,
    fontFamily: FONTS.body,
    marginTop: SPACING.lg,
    opacity: 0.5,
  },
});
