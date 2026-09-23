// app/(tabs)/profile.tsx
// My profile — view + edit name, bio, avatar; logout; settings

import { useEffect, useState, useCallback } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  TouchableOpacity,
  TextInput,
  ActivityIndicator,
  Alert,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter, useFocusEffect } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { LinearGradient } from 'expo-linear-gradient';
import * as ImagePicker from 'expo-image-picker';
import {
  COLORS,
  FONTS,
  RADII,
  SPACING,
  GRADIENTS,
  CONSTANTS,
  VERIFIED_USERNAMES,
} from '../../constants/theme';
import { supabase } from '../../lib/supabase';
import Avatar from '../../components/Avatar';
import VerifiedBadge from '../../components/VerifiedBadge';

type Profile = {
  id: string;
  username: string;
  display_name: string;
  avatar_color: string;
  avatar_url: string | null;
  bio: string | null;
  bio_link: string | null;
  verified: boolean | null;
  status_total?: number | null;
};

export default function ProfileScreen() {
  const router = useRouter();
  const [profile, setProfile] = useState<Profile | null>(null);
  const [email, setEmail] = useState('');
  const [followersCount, setFollowersCount] = useState<number | null>(null);
  const [followingCount, setFollowingCount] = useState<number | null>(null);
  const [statusCount, setStatusCount] = useState<number | null>(null);
  const [nameDraft, setNameDraft] = useState('');
  const [bioDraft, setBioDraft] = useState('');
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [loggingOut, setLoggingOut] = useState(false);

  const isVerified = (p: Profile | null) =>
    !!p &&
    (!!p.verified ||
      VERIFIED_USERNAMES.includes(p.username?.toLowerCase() ?? ''));

  // Load profile
  const loadProfile = useCallback(async () => {
    try {
      const { data: authData } = await supabase.auth.getUser();
      if (!authData.user) return;
      setEmail(authData.user.email ?? '');

      const { data, error } = await supabase
        .from('profiles')
        .select('*')
        .eq('id', authData.user.id)
        .single();

      if (error) throw error;
      setProfile(data as Profile);
      setNameDraft((data as Profile).display_name ?? '');
      setBioDraft((data as Profile).bio ?? '');

      // Load counts in parallel
      const [f1, f2, statusRes] = await Promise.all([
        supabase
          .from('follows')
          .select('follower_id', { count: 'exact', head: true })
          .eq('followed_id', authData.user.id),
        supabase
          .from('follows')
          .select('followed_id', { count: 'exact', head: true })
          .eq('follower_id', authData.user.id),
        supabase
          .from('statuses')
          .select('id', { count: 'exact', head: true })
          .eq('user_id', authData.user.id),
      ]);

      setFollowersCount(f1.count ?? 0);
      setFollowingCount(f2.count ?? 0);
      const totalFromProfile = (data as any)?.status_total;
      const liveCount = statusRes.count ?? 0;
      setStatusCount(
        typeof totalFromProfile === 'number'
          ? Math.max(totalFromProfile, liveCount)
          : liveCount
      );
    } catch (err) {
      console.warn('Load profile error:', err);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadProfile();
  }, [loadProfile]);

  useFocusEffect(
    useCallback(() => {
      loadProfile();
    }, [loadProfile])
  );

  // Pick + upload avatar
  async function pickAvatar() {
    if (!profile || uploading) return;

    const permission = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (!permission.granted) {
      Alert.alert(
        'Permission needed',
        'Please allow access to your photos to change your avatar.'
      );
      return;
    }

    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ImagePicker.MediaTypeOptions.Images,
      allowsEditing: true,
      aspect: [1, 1],
      quality: 0.85,
    });

    if (result.canceled || !result.assets?.[0]) return;

    const asset = result.assets[0];
    setUploading(true);

    try {
      const response = await fetch(asset.uri);
      const arrayBuffer = await response.arrayBuffer();
      const ext =
        (asset.uri.split('.').pop() ?? 'jpg').toLowerCase().slice(0, 5);
      const path = `${profile.id}/avatar-${Date.now()}.${ext}`;

      const { error: uploadError } = await supabase.storage
        .from('avatars')
        .upload(path, arrayBuffer, {
          contentType: asset.mimeType ?? 'image/jpeg',
          upsert: true,
        });

      if (uploadError) throw uploadError;

      const { data: publicUrlData } = supabase.storage
        .from('avatars')
        .getPublicUrl(path);

      const avatarUrl = publicUrlData.publicUrl;

      const { error: updateError } = await supabase
        .from('profiles')
        .update({ avatar_url: avatarUrl })
        .eq('id', profile.id);

      if (updateError) throw updateError;

      setProfile({ ...profile, avatar_url: avatarUrl });
    } catch (err: any) {
      console.warn('Avatar upload error:', err);
      Alert.alert('Upload failed', err?.message ?? 'Please try again.');
    } finally {
      setUploading(false);
    }
  }

  // Save name + bio
  async function saveChanges() {
    if (!profile || saving) return;
    const trimmedName = nameDraft.trim();
    const trimmedBio = bioDraft.trim();

    const nameChanged = trimmedName && trimmedName !== profile.display_name;
    const bioChanged = trimmedBio !== (profile.bio ?? '');

    if (!nameChanged && !bioChanged) return;

    setSaving(true);
    try {
      const update: Record<string, any> = {};
      if (nameChanged) update.display_name = trimmedName;
      if (bioChanged) update.bio = trimmedBio;

      const { error } = await supabase
        .from('profiles')
        .update(update)
        .eq('id', profile.id);

      if (error) throw error;

      setProfile({
        ...profile,
        display_name: nameChanged ? trimmedName : profile.display_name,
        bio: bioChanged ? trimmedBio : profile.bio,
      });
    } catch (err: any) {
      Alert.alert('Save failed', err?.message ?? 'Please try again.');
    } finally {
      setSaving(false);
    }
  }

  // Logout
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

  // ---- RENDER ----

  if (loading || !profile) {
    return (
      <SafeAreaView style={styles.safe} edges={['top']}>
        <View style={styles.loadingWrap}>
          <ActivityIndicator color={COLORS.violet} />
        </View>
      </SafeAreaView>
    );
  }

  const verified = isVerified(profile);
  const initialsForCounts = {
    followers: followersCount,
    following: followingCount,
    status: statusCount,
  };

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      <View style={styles.glowTop} />

      {/* Header */}
      <View style={styles.header}>
        <Text style={styles.headerTitle}>Profile</Text>
        <TouchableOpacity
          onPress={() => router.push('/settings')}
          style={styles.headerBtn}
          activeOpacity={0.7}
        >
          <Ionicons name="settings-outline" size={20} color={COLORS.text} />
        </TouchableOpacity>
      </View>

      <ScrollView
        contentContainerStyle={styles.scroll}
        showsVerticalScrollIndicator={false}
        keyboardShouldPersistTaps="handled"
      >
        {/* Top row: avatar + stats */}
        <View style={styles.topRow}>
          <TouchableOpacity
            onPress={pickAvatar}
            disabled={uploading}
            activeOpacity={0.85}
            style={styles.avatarWrap}
          >
            <Avatar
              name={profile.display_name}
              color={profile.avatar_color}
              avatarUrl={profile.avatar_url}
              size={82}
            />
            <View style={styles.cameraBadge}>
              {uploading ? (
                <ActivityIndicator size="small" color="#FFFFFF" />
              ) : (
                <Ionicons name="camera" size={13} color="#FFFFFF" />
              )}
            </View>
          </TouchableOpacity>

          <View style={styles.statsWrap}>
            <StatItem
              label="status"
              value={initialsForCounts.status}
              onPress={() => router.push('/(tabs)/status')}
            />
            <StatItem
              label="followers"
              value={initialsForCounts.followers}
              onPress={() => {}}
            />
            <StatItem
              label="following"
              value={initialsForCounts.following}
              onPress={() => {}}
            />
          </View>
        </View>

        {/* Name + username + bio */}
        <View style={styles.bioBlock}>
          <View style={styles.nameRow}>
            <Text style={styles.displayName} numberOfLines={1}>
              {profile.display_name}
            </Text>
            {verified && <VerifiedBadge size={18} />}
          </View>
          <Text style={styles.username}>@{profile.username}</Text>
          {profile.bio ? (
            <Text style={styles.bio}>{profile.bio}</Text>
          ) : null}
          {profile.bio_link ? (
            <Text style={styles.bioLink}>{profile.bio_link}</Text>
          ) : null}
        </View>

        {/* Info card */}
        <View style={styles.card}>
          <View style={styles.infoRow}>
            <Text style={styles.infoLabel}>Full name</Text>
            <TextInput
              style={styles.infoInput}
              value={nameDraft}
              onChangeText={setNameDraft}
              placeholder="Your name"
              placeholderTextColor={COLORS.mist}
              underlineColorAndroid="transparent"
            />
          </View>

          <View style={styles.divider} />

          <View style={styles.infoRow}>
            <Text style={styles.infoLabel}>Email</Text>
            <Text style={styles.infoValue} numberOfLines={1}>
              {email || '—'}
            </Text>
          </View>

          <View style={styles.divider} />

          <View style={styles.infoRow}>
            <Text style={styles.infoLabel}>Username</Text>
            <View style={styles.usernameRow}>
              <Text style={styles.infoValue}>@{profile.username}</Text>
              {verified && <VerifiedBadge size={14} />}
            </View>
          </View>

          <View style={styles.divider} />

          <TouchableOpacity
            style={styles.infoRow}
            onPress={handleLogout}
            activeOpacity={0.7}
            disabled={loggingOut}
          >
            <Text style={styles.infoLabel}>Account</Text>
            {loggingOut ? (
              <ActivityIndicator size="small" color={COLORS.danger} />
            ) : (
              <Text style={styles.logoutText}>Log out</Text>
            )}
          </TouchableOpacity>
        </View>

        {/* Bio card */}
        <View style={styles.card}>
          <View style={styles.bioHeader}>
            <Text style={styles.infoLabel}>Bio</Text>
            <Text style={styles.bioCounter}>
              {bioDraft.length}/{CONSTANTS.MAX_BIO_LENGTH}
            </Text>
          </View>
          <TextInput
            style={styles.bioInput}
            value={bioDraft}
            onChangeText={(t) =>
              setBioDraft(t.slice(0, CONSTANTS.MAX_BIO_LENGTH))
            }
            placeholder="Write something about yourself…"
            placeholderTextColor={COLORS.mist}
            multiline
            numberOfLines={3}
            textAlignVertical="top"
            underlineColorAndroid="transparent"
          />
        </View>

        {/* Save button */}
        <TouchableOpacity
          style={[
            styles.saveBtn,
            (!nameDraft.trim() ||
              (nameDraft.trim() === profile.display_name &&
                bioDraft.trim() === (profile.bio ?? ''))) &&
              styles.saveBtnDisabled,
          ]}
          onPress={saveChanges}
          disabled={
            saving ||
            !nameDraft.trim() ||
            (nameDraft.trim() === profile.display_name &&
              bioDraft.trim() === (profile.bio ?? ''))
          }
          activeOpacity={0.85}
        >
          <LinearGradient
            colors={GRADIENTS.violet}
            start={{ x: 0, y: 0 }}
            end={{ x: 1, y: 1 }}
            style={styles.saveBtnGradient}
          >
            {saving ? (
              <ActivityIndicator size="small" color="#FFFFFF" />
            ) : (
              <Text style={styles.saveBtnText}>Save Changes</Text>
            )}
          </LinearGradient>
        </TouchableOpacity>
      </ScrollView>
    </SafeAreaView>
  );
}

// --- Small stat component ---
function StatItem({
  label,
  value,
  onPress,
}: {
  label: string;
  value: number | null;
  onPress?: () => void;
}) {
  return (
    <TouchableOpacity
      style={styles.statItem}
      onPress={onPress}
      activeOpacity={0.7}
    >
      <Text style={styles.statValue}>
        {value === null ? '—' : value}
      </Text>
      <Text style={styles.statLabel}>{label}</Text>
    </TouchableOpacity>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: COLORS.ink900 },
  scroll: { paddingBottom: SPACING.xxl },

  glowTop: {
    position: 'absolute',
    top: -200,
    left: -100,
    width: 500,
    height: 500,
    borderRadius: 250,
    backgroundColor: 'rgba(124, 92, 255, 0.10)',
  },

  // Header
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: SPACING.lg,
    paddingVertical: SPACING.md,
  },
  headerTitle: {
    fontSize: 28,
    fontFamily: FONTS.displayBold,
    color: '#FFFFFF',
    letterSpacing: -0.3,
  },
  headerBtn: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: 'rgba(255,255,255,0.05)',
    alignItems: 'center',
    justifyContent: 'center',
  },

  // Top row
  topRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: SPACING.lg,
    paddingVertical: SPACING.md,
    gap: SPACING.lg,
  },
  avatarWrap: {
    position: 'relative',
  },
  cameraBadge: {
    position: 'absolute',
    bottom: 0,
    right: 0,
    width: 28,
    height: 28,
    borderRadius: 14,
    backgroundColor: COLORS.violet,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 2,
    borderColor: COLORS.ink900,
  },
  statsWrap: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-around',
  },
  statItem: {
    alignItems: 'flex-start',
    gap: 2,
    paddingVertical: 6,
    paddingHorizontal: 4,
  },
  statValue: {
    fontSize: 20,
    fontFamily: FONTS.displayBold,
    color: '#FFFFFF',
    lineHeight: 24,
  },
  statLabel: {
    fontSize: 12,
    fontFamily: FONTS.body,
    color: COLORS.mist,
  },

  // Bio block
  bioBlock: {
    paddingHorizontal: SPACING.lg,
    paddingBottom: SPACING.lg,
    gap: 3,
  },
  nameRow: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  displayName: {
    fontSize: 20,
    fontFamily: FONTS.displayBold,
    color: '#FFFFFF',
    flexShrink: 1,
  },
  username: {
    fontSize: 14,
    fontFamily: FONTS.body,
    color: COLORS.mist,
    marginTop: 1,
  },
  bio: {
    fontSize: 14,
    fontFamily: FONTS.body,
    color: COLORS.mistLight,
    marginTop: 6,
    lineHeight: 19,
  },
  bioLink: {
    fontSize: 14,
    fontFamily: FONTS.bodySemiBold,
    color: COLORS.teal,
    marginTop: 4,
  },

  // Card
  card: {
    marginHorizontal: SPACING.lg,
    marginBottom: SPACING.md,
    backgroundColor: 'rgba(255,255,255,0.04)',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.06)',
    borderRadius: RADII.xl,
    overflow: 'hidden',
  },
  infoRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: SPACING.lg,
    paddingVertical: 14,
    gap: SPACING.md,
  },
  infoLabel: {
    fontSize: 12,
    fontFamily: FONTS.body,
    color: COLORS.mist,
    letterSpacing: 0.2,
  },
  infoValue: {
    fontSize: 14,
    fontFamily: FONTS.bodyMedium,
    color: '#FFFFFF',
    flexShrink: 1,
    textAlign: 'right',
  },
  // ✅ FIXED: web outline removed
  infoInput: {
    flex: 1,
    fontSize: 14,
    fontFamily: FONTS.body,
    color: '#FFFFFF',
    textAlign: 'right',
    paddingVertical: 0,
    borderWidth: 0,
    borderColor: 'transparent',
    backgroundColor: 'transparent',
    outlineStyle: 'none',
    outlineWidth: 0,
    outlineColor: 'transparent',
    boxShadow: 'none',
  } as any,
  usernameRow: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  divider: {
    height: 1,
    backgroundColor: 'rgba(255,255,255,0.05)',
    marginLeft: SPACING.lg,
  },
  logoutText: {
    fontSize: 14,
    fontFamily: FONTS.bodyMedium,
    color: COLORS.danger,
  },

  // Bio card
  bioHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: SPACING.lg,
    paddingTop: 14,
    paddingBottom: 6,
  },
  bioCounter: {
    fontSize: 10,
    fontFamily: FONTS.body,
    color: COLORS.mist,
    opacity: 0.7,
  },
  // ✅ FIXED: web outline removed
  bioInput: {
    paddingHorizontal: SPACING.lg,
    paddingBottom: 14,
    fontSize: 14,
    fontFamily: FONTS.body,
    color: '#FFFFFF',
    minHeight: 70,
    lineHeight: 19,
    borderWidth: 0,
    borderColor: 'transparent',
    backgroundColor: 'transparent',
    outlineStyle: 'none',
    outlineWidth: 0,
    outlineColor: 'transparent',
    boxShadow: 'none',
  } as any,

  // Save button
  saveBtn: {
    marginHorizontal: SPACING.lg,
    marginTop: SPACING.md,
    borderRadius: RADII.full,
    overflow: 'hidden',
  },
  saveBtnDisabled: {
    opacity: 0.4,
  },
  saveBtnGradient: {
    paddingVertical: 15,
    alignItems: 'center',
    justifyContent: 'center',
  },
  saveBtnText: {
    color: '#FFFFFF',
    fontSize: 15,
    fontFamily: FONTS.bodySemiBold,
    letterSpacing: 0.3,
  },

  // Loading
  loadingWrap: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
});
