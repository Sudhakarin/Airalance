// app/(tabs)/profile.tsx
// My profile — offline auth + network auto-reload + SQLite wipe on logout
// ✅ invalidateUserIdCache on logout

import { useEffect, useState, useCallback, useRef } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  TouchableOpacity,
  TextInput,
  ActivityIndicator,
  Alert,
  Modal,
  FlatList,
  Platform,
  Pressable,
} from 'react-native';
import { BlurView } from 'expo-blur';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { LinearGradient } from 'expo-linear-gradient';
import * as ImagePicker from 'expo-image-picker';
import * as Notifications from 'expo-notifications';
import AsyncStorage from '@react-native-async-storage/async-storage';
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
import {
  getCurrentUserId,
  getCurrentSession,
  invalidateUserIdCache,
} from '../../lib/auth';
import { subscribeNetwork, isOnline } from '../../lib/network';
import { dbWipeAll } from '../../lib/db';
import Avatar from '../../components/Avatar';
import VerifiedBadge from '../../components/VerifiedBadge';
import StatusRing from '../../components/StatusRing';
import {
  hapticLight,
  hapticMedium,
  hapticSuccess,
  hapticError,
} from '../../lib/haptics';

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

type ListTab = 'followers' | 'following';

type CustomDialog = {
  icon: any;
  iconColor: string;
  iconBg: string;
  title: string;
  message: string;
  primaryLabel: string;
  secondaryLabel?: string;
  danger?: boolean;
  onPrimary: () => void;
  onSecondary?: () => void;
};

const CACHE_TTL_MS = 1000 * 60 * 60 * 24 * 7;

function profileCacheKey(uid: string) {
  return `airalance:profile:me:${uid}`;
}

type ProfileCachePayload = {
  t: number;
  profile: Profile;
  followersCount: number;
  followingCount: number;
  statusCount: number;
  activeStatusCount: number;
  followingIds: string[];
};

async function readProfileCache(uid: string): Promise<ProfileCachePayload | null> {
  try {
    const raw = await AsyncStorage.getItem(profileCacheKey(uid));
    if (!raw) return null;
    const parsed = JSON.parse(raw) as ProfileCachePayload;
    if (!parsed?.profile) return null;
    if (Date.now() - (parsed.t ?? 0) > CACHE_TTL_MS) return null;
    return parsed;
  } catch {
    return null;
  }
}

async function writeProfileCache(
  uid: string,
  payload: Omit<ProfileCachePayload, 't'>
) {
  try {
    await AsyncStorage.setItem(
      profileCacheKey(uid),
      JSON.stringify({ t: Date.now(), ...payload })
    );
  } catch {}
}

function formatCount(n: number): string {
  if (n < 1000) return String(n);
  const fmt = (v: number, unit: string) =>
    `${(v < 10 ? Math.round(v * 10) / 10 : Math.round(v))
      .toString()
      .replace(/\.0$/, '')}${unit}`;
  if (n < 1_000_000) return fmt(n / 1000, 'K');
  return fmt(n / 1_000_000, 'M');
}

function SkeletonBlock({
  width,
  height,
  borderRadius = 6,
  style,
}: {
  width: number | string;
  height: number;
  borderRadius?: number;
  style?: any;
}) {
  return (
    <View
      style={[
        {
          width,
          height,
          borderRadius,
          backgroundColor: 'rgba(255,255,255,0.08)',
        },
        style,
      ]}
    />
  );
}

function ProfileSkeleton() {
  return (
    <View style={styles.skeletonContainer}>
      <View style={styles.skeletonTopSection}>
        <SkeletonBlock width={80} height={80} borderRadius={40} />
        <View style={styles.skeletonRightCol}>
          <SkeletonBlock
            width="60%"
            height={20}
            borderRadius={6}
            style={{ marginBottom: 10 }}
          />
          <View style={styles.skeletonStatsGrid}>
            {[1, 2, 3].map((i) => (
              <View key={i} style={styles.skeletonStatItem}>
                <SkeletonBlock width={30} height={18} borderRadius={4} />
                <SkeletonBlock
                  width={50}
                  height={12}
                  borderRadius={4}
                  style={{ marginTop: 4 }}
                />
              </View>
            ))}
          </View>
        </View>
      </View>

      <View style={styles.skeletonBioBlock}>
        <SkeletonBlock width="30%" height={16} borderRadius={4} />
        <SkeletonBlock
          width="80%"
          height={14}
          borderRadius={4}
          style={{ marginTop: 10 }}
        />
        <SkeletonBlock
          width="60%"
          height={14}
          borderRadius={4}
          style={{ marginTop: 6 }}
        />
      </View>

      <View style={styles.skeletonCard}>
        {[1, 2, 3, 4].map((i) => (
          <View key={i} style={styles.skeletonRow}>
            <SkeletonBlock width={80} height={14} borderRadius={4} />
            <SkeletonBlock width={120} height={14} borderRadius={4} />
          </View>
        ))}
      </View>

      <View style={styles.skeletonCard}>
        <View style={styles.skeletonRow}>
          <SkeletonBlock width={60} height={14} borderRadius={4} />
          <SkeletonBlock width={40} height={10} borderRadius={4} />
        </View>
        <SkeletonBlock
          width="100%"
          height={60}
          borderRadius={8}
          style={{ marginHorizontal: 18, marginBottom: 12 }}
        />
      </View>

      <SkeletonBlock
        width="100%"
        height={48}
        borderRadius={24}
        style={{ marginTop: 10 }}
      />
    </View>
  );
}

export default function ProfileScreen() {
  const router = useRouter();
  const [profile, setProfile] = useState<Profile | null>(null);
  const [email, setEmail] = useState('');
  const [followersCount, setFollowersCount] = useState<number | null>(null);
  const [followingCount, setFollowingCount] = useState<number | null>(null);
  const [statusCount, setStatusCount] = useState<number | null>(null);
  const [activeStatusCount, setActiveStatusCount] = useState<number>(0);
  const [nameDraft, setNameDraft] = useState('');
  const [bioDraft, setBioDraft] = useState('');
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [loggingOut, setLoggingOut] = useState(false);
  const [notifPermission, setNotifPermission] = useState<string>('undetermined');

  const [online, setOnline] = useState(isOnline());

  const [listTab, setListTab] = useState<ListTab | null>(null);
  const [listUsers, setListUsers] = useState<Profile[]>([]);
  const [listLoading, setListLoading] = useState(false);
  const [myFollowingIds, setMyFollowingIds] = useState<Set<string>>(new Set());
  const [followsMeIds, setFollowsMeIds] = useState<Set<string>>(new Set());
  const [toggleLoadingId, setToggleLoadingId] = useState<string | null>(null);

  const [dialog, setDialog] = useState<CustomDialog | null>(null);

  const cacheShownRef = useRef(false);
  const myIdRef = useRef<string | null>(null);
  const profileLoadedRef = useRef(false);

  const isVerified = (p: Profile | null) =>
    !!p &&
    (!!p.verified ||
      (VERIFIED_USERNAMES as readonly string[]).includes(
        p.username?.toLowerCase() ?? ''
      ));

  useEffect(() => {
    setOnline(isOnline());
    const unsub = subscribeNetwork(setOnline);
    return unsub;
  }, []);

  useEffect(() => {
    (async () => {
      const uid = await getCurrentUserId();
      if (!uid) return;
      myIdRef.current = uid;

      const session = await getCurrentSession();
      if (session?.user?.email) setEmail(session.user.email);

      if (cacheShownRef.current) return;
      const cache = await readProfileCache(uid);
      if (cache) {
        setProfile(cache.profile);
        setNameDraft(cache.profile.display_name ?? '');
        setBioDraft(cache.profile.bio ?? '');
        setFollowersCount(cache.followersCount);
        setFollowingCount(cache.followingCount);
        setStatusCount(cache.statusCount);
        setActiveStatusCount(cache.activeStatusCount ?? 0);
        setMyFollowingIds(new Set(cache.followingIds ?? []));
        setLoading(false);
      }
      cacheShownRef.current = true;
    })();
  }, []);

  const loadProfile = useCallback(async () => {
    try {
      const uid = await getCurrentUserId();
      if (!uid) {
        setLoading(false);
        return;
      }
      myIdRef.current = uid;

      if (!isOnline()) {
        setLoading(false);
        return;
      }

      const { data, error } = await supabase
        .from('profiles')
        .select('*')
        .eq('id', uid)
        .single();

      if (error) throw error;
      const p = data as Profile;
      setProfile(p);
      setNameDraft(p.display_name ?? '');
      setBioDraft(p.bio ?? '');

      const [f1, f2, totalStatusRes, activeStatusRes, followingRes] =
        await Promise.all([
          supabase
            .from('follows')
            .select('follower_id', { count: 'exact', head: true })
            .eq('followed_id', uid),
          supabase
            .from('follows')
            .select('followed_id', { count: 'exact', head: true })
            .eq('follower_id', uid),
          supabase
            .from('statuses')
            .select('id', { count: 'exact', head: true })
            .eq('user_id', uid),
          supabase
            .from('statuses')
            .select('id', { count: 'exact', head: true })
            .eq('user_id', uid)
            .gt('expires_at', new Date().toISOString()),
          supabase
            .from('follows')
            .select('followed_id')
            .eq('follower_id', uid),
        ]);

      const followers = f1.count ?? 0;
      const following = f2.count ?? 0;
      const totalCount = totalStatusRes.count ?? 0;
      const liveCount = activeStatusRes.count ?? 0;

      const totalFromProfile = (p as any)?.status_total;
      const finalStatus =
        typeof totalFromProfile === 'number'
          ? Math.max(totalFromProfile, totalCount)
          : totalCount;

      setFollowersCount(followers);
      setFollowingCount(following);
      setStatusCount(finalStatus);
      setActiveStatusCount(liveCount);

      const ids = new Set<string>(
        (followingRes.data ?? []).map((r: any) => r.followed_id)
      );
      setMyFollowingIds(ids);

      if (Platform.OS !== 'web') {
        const { status } = await Notifications.getPermissionsAsync();
        setNotifPermission(status);
      }

      await writeProfileCache(uid, {
        profile: p,
        followersCount: followers,
        followingCount: following,
        statusCount: finalStatus,
        activeStatusCount: liveCount,
        followingIds: Array.from(ids),
      });
    } catch (err) {
      console.warn('Load profile error:', err);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadProfile();
  }, [loadProfile]);

  useEffect(() => {
    if (online && myIdRef.current) {
      loadProfile();
    }
  }, [online, loadProfile]);

  const syncCache = useCallback(
    async (patch: Partial<{
      profile: Profile;
      followersCount: number;
      followingCount: number;
      statusCount: number;
      activeStatusCount: number;
      followingIds: Set<string>;
    }>) => {
      const uid = myIdRef.current;
      if (!uid) return;
      const cached = await readProfileCache(uid);
      const base: ProfileCachePayload =
        cached ?? {
          t: Date.now(),
          profile: profile as Profile,
          followersCount: followersCount ?? 0,
          followingCount: followingCount ?? 0,
          statusCount: statusCount ?? 0,
          activeStatusCount: activeStatusCount ?? 0,
          followingIds: Array.from(myFollowingIds),
        };
      const next = {
        profile: patch.profile ?? base.profile,
        followersCount: patch.followersCount ?? base.followersCount,
        followingCount: patch.followingCount ?? base.followingCount,
        statusCount: patch.statusCount ?? base.statusCount,
        activeStatusCount: patch.activeStatusCount ?? base.activeStatusCount,
        followingIds: patch.followingIds
          ? Array.from(patch.followingIds)
          : base.followingIds,
      };
      await writeProfileCache(uid, next);
    },
    [profile, followersCount, followingCount, statusCount, activeStatusCount, myFollowingIds]
  );

  const loadFollowList = useCallback(
    async (tab: ListTab) => {
      if (!profile) return;
      if (!isOnline()) {
        Alert.alert('Offline', 'Cannot load list while offline.');
        return;
      }
      setListTab(tab);
      setListLoading(true);
      try {
        const column = tab === 'followers' ? 'follower_id' : 'followed_id';
        const match = tab === 'followers' ? 'followed_id' : 'follower_id';

        const { data: rows } = await supabase
          .from('follows')
          .select(column)
          .eq(match, profile.id);

        const ids = (rows ?? []).map((r: any) => r[column]);
        if (tab === 'followers') setFollowersCount(ids.length);
        else setFollowingCount(ids.length);

        if (ids.length === 0) {
          setListUsers([]);
          setListLoading(false);
          return;
        }

        try {
          const chunks: string[][] = [];
          for (let i = 0; i < ids.length; i += 100) {
            chunks.push(ids.slice(i, i + 100));
          }
          const [iFollowRes, followMeRes] = await Promise.all([
            Promise.all(
              chunks.map((ch) =>
                supabase
                  .from('follows')
                  .select('followed_id')
                  .eq('follower_id', profile.id)
                  .in('followed_id', ch)
              )
            ),
            Promise.all(
              chunks.map((ch) =>
                supabase
                  .from('follows')
                  .select('follower_id')
                  .eq('followed_id', profile.id)
                  .in('follower_id', ch)
              )
            ),
          ]);

          const failed = [...iFollowRes, ...followMeRes].some((r) => r.error);
          if (!failed) {
            const iFollow = new Set<string>();
            iFollowRes.forEach((r) =>
              (r.data ?? []).forEach((x: any) => iFollow.add(x.followed_id))
            );
            const followMe = new Set<string>();
            followMe.deleteRes.forEach(((idr) =>
              (r.data ??));
 []).forEach((x: any             ) => followMe.add(x.follower_id))
            );

            setMyFollowingIds((prev) => {
              const next = new Set(prev);
              ids.forEach((id: string) => next iFollow.forEach((id) => next.add(id));
              return next;
            });
            setFollowsMeIds((prev) => {
              const next = new Set(prev);
              ids.forEach((id: string) => next.delete(id));
              followMe.forEach((id) => next.add(id));
              return next;
            });
          }
        } catch (err) {
          console.warn('Refresh follow state error:', err);
        }

        const { data: profiles } = await supabase
          .from('profiles')
          .select('*')
          .in('id', ids);

        setListUsers((profiles ?? []) as Profile[]);
      } catch (err) {
        console.warn('Load follow list error:', err);
      } finally {
        setListLoading(false);
      }
    },
    [profile]
  );

  async function toggleFollowFromList(targetId: string) {
    if (!profile || toggleLoadingId) return;
    if (targetId === profile.id) return;
    if (!isOnline()) {
      Alert.alert('Offline', 'Cannot follow while offline.');
      return;
    }

    const isFollowing = myFollowingIds.has(targetId);
    setToggleLoadingId(targetId);

    try {
      if (isFollowing) {
        const { error } = await supabase
          .from('follows')
          .delete()
          .eq('follower_id', profile.id)
          .eq('followed_id', targetId);
        if (!error) {
          const nextIds = new Set(myFollowingIds);
          nextIds.delete(targetId);
          setMyFollowingIds(nextIds);
          const nextFollowing = followingCount !== null ? Math.max(0, followingCount - 1) : null;
          if (nextFollowing !== null) setFollowingCount(nextFollowing);
          await syncCache({
            followingIds: nextIds,
            ...(nextFollowing !== null ? { followingCount: nextFollowing } : {}),
          });
        }
      } else {
        const { error } = await supabase
          .from('follows')
          .insert({ follower_id: profile.id, followed_id: targetId });
        if (!error) {
          const nextIds = new Set(myFollowingIds);
          nextIds.add(targetId);
          setMyFollowingIds(nextIds);
          const nextFollowing = followingCount !== null ? followingCount + 1 : null;
          if (nextFollowing !== null) setFollowingCount(nextFollowing);
          await syncCache({
            followingIds: nextIds,
            ...(nextFollowing !== null ? { followingCount: nextFollowing } : {}),
          });

          await supabase.functions.invoke('send-push', {
            body: {
              userId: targetId,
              title: 'New follower',
              body: `${profile.display_name} started following you`,
              data: { screen: 'profile', userId: profile.id },
            },
          });
        }
      }
    } catch (err) {
      console.warn('Toggle follow error:', err);
    } finally {
      setToggleLoadingId(null);
    }
  }

  async function pickAvatar() {
    if (!profile || uploading) return;
    if (!isOnline()) {
      Alert.alert('Offline', 'Cannot upload avatar while offline.');
      return;
    }

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

      const nextProfile = { ...profile, avatar_url: avatarUrl };
      setProfile(nextProfile);
      await syncCache({ profile: nextProfile });
      hapticSuccess();
    } catch (err: any) {
      console.warn('Avatar upload error:', err);
      hapticError();
      Alert.alert('Upload failed', err?.message ?? 'Please try again.');
    } finally {
      setUploading(false);
    }
  }

  async function saveChanges() {
    if (!profile || saving) return;
    if (!isOnline()) {
      Alert.alert('Offline', 'Cannot save changes while offline.');
      return;
    }
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

      const nextProfile: Profile = {
        ...profile,
        display_name: nameChanged ? trimmedName : profile.display_name,
        bio: bioChanged ? trimmedBio : profile.bio,
      };
      setProfile(nextProfile);
      await syncCache({ profile: nextProfile });
      hapticSuccess();
    } catch (err: any) {
      hapticError();
      Alert.alert('Save failed', err?.message ?? 'Please try again.');
    } finally {
      setSaving(false);
    }
  }

  async function requestNotificationPermission() {
    if (Platform.OS === 'web') return;
    hapticLight();

    const { status: existing } = await Notifications.getPermissionsAsync();

    if (existing === 'granted') {
      setDialog({
        icon: 'notifications',
        iconColor: COLORS.teal,
        iconBg: 'rgba(34,211,184,0.15)',
        title: 'Notifications enabled',
        message:
          'You are all set. You will receive messages and status updates right away.',
        primaryLabel: 'Great',
        onPrimary: () => setDialog(null),
      });
      return;
    }

    const { status } = await Notifications.requestPermissionsAsync();
    setNotifPermission(status);

    if (status === 'granted') {
      hapticSuccess();
      setDialog({
        icon: 'checkmark-circle',
        iconColor: COLORS.teal,
        iconBg: 'rgba(34,211,184,0.15)',
        title: 'Notifications enabled',
        message:
          'You will now receive notifications. Please restart the app once for full effect.',
        primaryLabel: 'Got it',
        onPrimary: () => setDialog(null),
      });
    } else {
      hapticError();
      setDialog({
        icon: 'notifications-off',
        iconColor: COLORS.danger,
        iconBg: 'rgba(239,68,68,0.15)',
        title: 'Permission denied',
        message:
          'Enable notifications from phone settings:\n\nSettings → Apps → Airalance → Notifications',
        primaryLabel: 'OK',
        danger: true,
        onPrimary: () => setDialog(null),
      });
    }
  }

  function handleLogout() {
    hapticMedium();
    setDialog({
      icon: 'log-out-outline',
      iconColor: COLORS.danger,
      iconBg: 'rgba(239,68,68,0.15)',
      title: 'Log out?',
      message:
        'You will need to sign in again to access your chats and status.',
      primaryLabel: 'Log out',
      secondaryLabel: 'Cancel',
      danger: true,
      onPrimary: async () => {
        setDialog(null);
        setLoggingOut(true);
        try {
          const uid = myIdRef.current;
          if (uid) await AsyncStorage.removeItem(profileCacheKey(uid));
        } catch {}
        try {
          await dbWipeAll();
        } catch (err) {
          console.warn('[logout] SQLite wipe failed:', err);
        }
        invalidateUserIdCache();
        await supabase.auth.signOut();
        router.replace('/(auth)/login');
      },
      onSecondary: () => setDialog(null),
    });
  }

  if (loading || !profile) {
    return (
      <SafeAreaView style={styles.safe} edges={['top']}>
        <View style={styles.header}>
          <Text style={styles.headerTitle}>Airalance!</Text>
          <View style={styles.headerBtn} />
        </View>
        <ScrollView
          contentContainerStyle={styles.scroll}
          showsVerticalScrollIndicator={false}
        >
          <ProfileSkeleton />
        </ScrollView>
      </SafeAreaView>
    );
  }

  const verified = isVerified(profile);
  const statusShown = statusCount;

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      <View style={styles.header}>
        <Text style={styles.headerTitle}>Airalance!</Text>
        <TouchableOpacity
          onPress={() => router.push('/settings')}
          style={styles.headerBtn}
          activeOpacity={0.7}
        >
          <Ionicons name="settings-outline" size={19} color={COLORS.text} />
        </TouchableOpacity>
      </View>

      {!online && (
        <View style={styles.offlineBanner}>
          <Ionicons name="cloud-offline-outline" size={14} color="#FFFFFF" />
          <Text style={styles.offlineBannerText}>
            You're offline — showing cached profile
          </Text>
        </View>
      )}

      <ScrollView
        contentContainerStyle={styles.scroll}
        showsVerticalScrollIndicator={false}
        keyboardShouldPersistTaps="handled"
      >
        <View style={styles.topSection}>
          <TouchableOpacity
            onPress={pickAvatar}
            disabled={uploading}
            activeOpacity={0.85}
            style={styles.avatarWrap}
          >
            <StatusRing hasStatus={activeStatusCount > 0} viewed={true}>
              <Avatar
                name={profile.display_name}
                color={profile.avatar_color}
                avatarUrl={profile.avatar_url}
                size={80}
              />
            </StatusRing>

            <View style={styles.cameraBadge}>
              {uploading ? (
                <ActivityIndicator size="small" color="#FFFFFF" />
              ) : (
                <Ionicons name="camera" size={11} color="#FFFFFF" />
              )}
            </View>
          </TouchableOpacity>

          <View style={styles.rightCol}>
            <View style={styles.nameRow}>
              <Text style={styles.displayName} numberOfLines={1}>
                {profile.display_name}
              </Text>
              {verified && (
                <View style={styles.badgeWrap}>
                  <VerifiedBadge size={16} />
                </View>
              )}
            </View>

            <View style={styles.statsGrid}>
              <StatItem
                label="status"
                value={statusShown}
                onPress={() => router.push('/(tabs)/status')}
              />
              <StatItem
                label="followers"
                value={followersCount}
                onPress={() => loadFollowList('followers')}
              />
              <StatItem
                label="following"
                value={followingCount}
                onPress={() => loadFollowList('following')}
              />
            </View>
          </View>
        </View>

        <View style={styles.bioBlock}>
          <Text style={styles.username}>@{profile.username}</Text>
          {profile.bio ? <Text style={styles.bio}>{profile.bio}</Text> : null}
          {profile.bio_link ? (
            <Text style={styles.bioLink}>{profile.bio_link}</Text>
          ) : null}
        </View>

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
              {verified && (
                <View style={styles.badgeWrapSmall}>
                  <VerifiedBadge size={13} />
                </View>
              )}
            </View>
          </View>

          <View style={styles.divider} />

          <TouchableOpacity
            style={styles.infoRow}
            onPress={requestNotificationPermission}
            activeOpacity={0.7}
          >
            <Text style={styles.infoLabel}>Notifications</Text>
            <Text
              style={[
                styles.infoValue,
                notifPermission === 'granted' && { color: COLORS.teal },
              ]}
            >
              {notifPermission === 'granted' ? 'Enabled ✓' : 'Tap to enable'}
            </Text>
          </TouchableOpacity>

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

      {listTab && (
        <Modal
          visible
          transparent
          animationType="slide"
          onRequestClose={() => setListTab(null)}
        >
          <View style={styles.listModalWrap}>
            <SafeAreaView style={styles.listModal} edges={['top']}>
              <View style={styles.listHeader}>
                <TouchableOpacity
                  onPress={() => setListTab(null)}
                  style={styles.listHeaderBtn}
                  activeOpacity={0.7}
                >
                  <Ionicons name="chevron-back" size={22} color="#FFFFFF" />
                </TouchableOpacity>
                <View style={styles.listHeaderCenter}>
                  <Text style={styles.listHeaderUsername} numberOfLines={1}>
                    {profile.username}
                  </Text>
                  {verified && (
                    <View style={styles.badgeWrapSmall}>
                      <VerifiedBadge size={13} />
                    </View>
                  )}
                </View>
                <View style={styles.listHeaderBtn} />
              </View>

              <View style={styles.listTabsRow}>
                <TouchableOpacity
                  onPress={() => loadFollowList('followers')}
                  style={styles.listTabBtn}
                  activeOpacity={0.7}
                >
                  <Text
                    style={[
                      styles.listTabText,
                      listTab === 'followers' && styles.listTabTextActive,
                    ]}
                  >
                    {followersCount === null ? '' : `${followersCount} `}
                    followers
                  </Text>
                  {listTab === 'followers' && (
                    <View style={styles.listTabUnderline} />
                  )}
                </TouchableOpacity>
                <TouchableOpacity
                  onPress={() => loadFollowList('following')}
                  style={styles.listTabBtn}
                  activeOpacity={0.7}
                >
                  <Text
                    style={[
                      styles.listTabText,
                      listTab === 'following' && styles.listTabTextActive,
                    ]}
                  >
                    {followingCount === null ? '' : `${followingCount} `}
                    following
                  </Text>
                  {listTab === 'following' && (
                    <View style={styles.listTabUnderline} />
                  )}
                </TouchableOpacity>
              </View>

              {listLoading ? (
                <View style={styles.listLoading}>
                  <ActivityIndicator color={COLORS.violet} />
                </View>
              ) : listUsers.length === 0 ? (
                <View style={styles.listEmpty}>
                  <Ionicons
                    name="people-outline"
                    size={38}
                    color={COLORS.mist}
                  />
                  <Text style={styles.listEmptyText}>
                    {listTab === 'followers'
                      ? 'No followers yet'
                      : 'Not following anyone yet'}
                  </Text>
                </View>
              ) : (
                <FlatList
                  data={listUsers}
                  extraData={{ myFollowingIds, followsMeIds, toggleLoadingId }}
                  keyExtractor={(item) => item.id}
                  contentContainerStyle={styles.listContent}
                  renderItem={({ item }) => {
                    const isMe = item.id === profile.id;
                    const isFollowing = myFollowingIds.has(item.id);
                    const followsMe = followsMeIds.has(item.id);
                    const busy = toggleLoadingId === item.id;

                    return (
                      <TouchableOpacity
                        style={styles.personRow}
                        onPress={() => {
                          setListTab(null);
                          router.push(`/profile/${item.id}`);
                        }}
                        activeOpacity={0.7}
                      >
                        <Avatar
                          name={item.display_name}
                          color={item.avatar_color}
                          avatarUrl={item.avatar_url}
                          size={46}
                        />
                        <View style={styles.personInfo}>
                          <View style={styles.personNameRow}>
                            <Text style={styles.personName} numberOfLines={1}>
                              {item.display_name}
                            </Text>
                            {isVerified(item) && (
                              <View style={styles.badgeWrapSmall}>
                                <VerifiedBadge size={13} />
                              </View>
                            )}
                          </View>
                          <Text
                            style={styles.personUsername}
                            numberOfLines={1}
                          >
                            {item.username}
                          </Text>
                        </View>

                        {!isMe && (
                          <TouchableOpacity
                            style={[
                              styles.followBtnSmall,
                              isFollowing && styles.followBtnSmallFollowing,
                            ]}
                            onPress={() => toggleFollowFromList(item.id)}
                            disabled={busy}
                            activeOpacity={0.85}
                          >
                            {busy ? (
                              <ActivityIndicator
                                size="small"
                                color="#FFFFFF"
                              />
                            ) : (
                              <Text
                                style={[
                                  styles.followBtnSmallText,
                                  isFollowing &&
                                    styles.followBtnSmallTextFollowing,
                                ]}
                              >
                                {isFollowing
                                  ? 'Following'
                                  : followsMe
                                  ? 'Follow back'
                                  : 'Follow'}
                              </Text>
                            )}
                          </TouchableOpacity>
                        )}
                      </TouchableOpacity>
                    );
                  }}
                />
              )}
            </SafeAreaView>
          </View>
        </Modal>
      )}

      <Modal
        visible={!!dialog}
        transparent
        animationType="fade"
        onRequestClose={() => setDialog(null)}
        statusBarTranslucent
      >
        <BlurView
          intensity={50}
          tint="dark"
          experimentalBlurMethod="dimezisBlurView"
          style={styles.blurBackdrop}
        >
          <Pressable
            style={styles.backdropPress}
            onPress={() => setDialog(null)}
          >
            <Pressable
              style={styles.dialogCard}
              onPress={(e) => e.stopPropagation()}
            >
              {dialog && (
                <>
                  <View
                    style={[
                      styles.dialogIconWrap,
                      { backgroundColor: dialog.iconBg },
                    ]}
                  >
                    <Ionicons
                      name={dialog.icon}
                      size={22}
                      color={dialog.iconColor}
                    />
                  </View>

                  <Text style={styles.dialogTitle}>{dialog.title}</Text>
                  <Text style={styles.dialogSub}>{dialog.message}</Text>

                  <View style={styles.dialogButtons}>
                    {dialog.secondaryLabel && (
                      <TouchableOpacity
                        style={styles.dialogBtnSecondary}
                        onPress={dialog.onSecondary}
                        activeOpacity={0.75}
                      >
                        <Text style={styles.dialogBtnSecondaryText}>
                          {dialog.secondaryLabel}
                        </Text>
                      </TouchableOpacity>
                    )}
                    <TouchableOpacity
                      style={[
                        dialog.danger
                          ? styles.dialogBtnDanger
                          : styles.dialogBtnPrimary,
                        !dialog.secondaryLabel && { flex: 1 },
                      ]}
                      onPress={dialog.onPrimary}
                      activeOpacity={0.75}
                    >
                      <Text style={styles.dialogBtnPrimaryText}>
                        {dialog.primaryLabel}
                      </Text>
                    </TouchableOpacity>
                  </View>
                </>
              )}
            </Pressable>
          </Pressable>
        </BlurView>
      </Modal>
    </SafeAreaView>
  );
}

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
      activeOpacity={0.6}
    >
      <Text style={styles.statValue}>
        {value === null ? '—' : formatCount(value)}
      </Text>
      <Text style={styles.statLabel}>{label}</Text>
    </TouchableOpacity>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: '#000000' },
  scroll: { paddingBottom: SPACING.lg },

  offlineBanner: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    paddingHorizontal: 14,
    paddingVertical: 7,
    backgroundColor: '#B45309',
  },
  offlineBannerText: {
    color: '#FFFFFF',
    fontSize: 12,
    fontFamily: FONTS.bodyMedium,
    flexShrink: 1,
  },

  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 18,
    paddingVertical: 10,
  },
  headerTitle: {
    fontSize: 24,
    fontFamily: FONTS.displayBold,
    color: '#FFFFFF',
    letterSpacing: -0.5,
  },
  headerBtn: {
    width: 38,
    height: 38,
    borderRadius: 19,
    backgroundColor: 'rgba(255,255,255,0.05)',
    alignItems: 'center',
    justifyContent: 'center',
  },

  topSection: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 18,
    paddingTop: 8,
    paddingBottom: 12,
    gap: 14,
  },
  avatarWrap: { position: 'relative' },
  cameraBadge: {
    position: 'absolute',
    bottom: 1,
    right: 1,
    width: 24,
    height: 24,
    borderRadius: 12,
    backgroundColor: COLORS.violet,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 2.5,
    borderColor: '#000000',
  },

  rightCol: {
    flex: 1,
    minWidth: 0,
    justifyContent: 'center',
    gap: 10,
  },

  nameRow: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  displayName: {
    fontSize: 18,
    fontFamily: FONTS.displayBold,
    color: '#FFFFFF',
    flexShrink: 1,
    includeFontPadding: false,
    textAlignVertical: 'center',
  } as any,
  badgeWrap: {
    marginLeft: 2,
    marginTop: 1,
    justifyContent: 'center',
    alignItems: 'center',
  },
  badgeWrapSmall: {
    marginLeft: 2,
    marginTop: 1,
    justifyContent: 'center',
    alignItems: 'center',
  },

  statsGrid: {
    flexDirection: 'row',
  },
  statItem: {
    flex: 1,
    alignItems: 'flex-start',
    gap: 2,
  },
  statValue: {
    fontSize: 17,
    fontFamily: FONTS.displayBold,
    color: '#FFFFFF',
    lineHeight: 20,
    includeFontPadding: false,
  } as any,
  statLabel: {
    fontSize: 11.5,
    fontFamily: FONTS.body,
    color: 'rgba(255,255,255,0.7)',
  },

  bioBlock: {
    paddingHorizontal: 18,
    paddingTop: 8,
    paddingBottom: 16,
  },
  username: {
    fontSize: 14,
    fontFamily: FONTS.bodySemiBold,
    color: '#FFFFFF',
  },
  bio: {
    fontSize: 13.5,
    fontFamily: FONTS.body,
    color: 'rgba(255,255,255,0.85)',
    marginTop: 5,
    lineHeight: 19,
  },
  bioLink: {
    fontSize: 13.5,
    fontFamily: FONTS.bodySemiBold,
    color: COLORS.teal,
    marginTop: 5,
  },

  card: {
    marginHorizontal: 18,
    marginBottom: 10,
    backgroundColor: '#121212',
    borderWidth: 1,
    borderColor: '#1F1F23',
    borderRadius: RADII.xl,
    overflow: 'hidden',
  },
  infoRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 18,
    paddingVertical: 12,
    gap: SPACING.sm,
  },
  infoLabel: {
    fontSize: 13,
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
    backgroundColor: '#1F1F23',
    marginLeft: 18,
  },
  logoutText: {
    fontSize: 14,
    fontFamily: FONTS.bodyMedium,
    color: COLORS.danger,
  },

  bioHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 18,
    paddingTop: 12,
    paddingBottom: 6,
  },
  bioCounter: {
    fontSize: 10.5,
    fontFamily: FONTS.body,
    color: COLORS.mist,
    opacity: 0.7,
  },
  bioInput: {
    paddingHorizontal: 18,
    paddingBottom: 12,
    fontSize: 14,
    fontFamily: FONTS.body,
    color: '#FFFFFF',
    minHeight: 70,
    lineHeight: 20,
    borderWidth: 0,
    borderColor: 'transparent',
    backgroundColor: 'transparent',
    outlineStyle: 'none',
    outlineWidth: 0,
    outlineColor: 'transparent',
    boxShadow: 'none',
  } as any,

  saveBtn: {
    marginHorizontal: 18,
    marginTop: 10,
    borderRadius: RADII.full,
    overflow: 'hidden',
  },
  saveBtnDisabled: { opacity: 0.4 },
  saveBtnGradient: {
    paddingVertical: 14,
    alignItems: 'center',
    justifyContent: 'center',
  },
  saveBtnText: {
    color: '#FFFFFF',
    fontSize: 14.5,
    fontFamily: FONTS.bodySemiBold,
    letterSpacing: 0.3,
  },

  loadingWrap: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },

  listModalWrap: { flex: 1, backgroundColor: '#000000' },
  listModal: { flex: 1, backgroundColor: '#000000' },
  listHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: SPACING.sm,
    paddingTop: SPACING.sm,
    paddingBottom: SPACING.sm,
  },
  listHeaderBtn: {
    width: 38,
    height: 38,
    alignItems: 'center',
    justifyContent: 'center',
  },
  listHeaderCenter: {
    flexDirection: 'row',
    alignItems: 'center',
    flex: 1,
    justifyContent: 'center',
  },
  listHeaderUsername: {
    fontSize: 16,
    fontFamily: FONTS.displayBold,
    color: '#FFFFFF',
    includeFontPadding: false,
    textAlignVertical: 'center',
  } as any,
  listTabsRow: {
    flexDirection: 'row',
    justifyContent: 'space-around',
    borderBottomWidth: 1,
    borderBottomColor: '#1F1F23',
  },
  listTabBtn: {
    flex: 1,
    paddingVertical: 12,
    alignItems: 'center',
    position: 'relative',
  },
  listTabText: {
    fontSize: 14,
    fontFamily: FONTS.bodySemiBold,
    color: 'rgba(255,255,255,0.45)',
  },
  listTabTextActive: { color: '#FFFFFF' },
  listTabUnderline: {
    position: 'absolute',
    bottom: -1,
    height: 1.5,
    width: '100%',
    backgroundColor: '#FFFFFF',
  },
  listLoading: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  listEmpty: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 10,
  },
  listEmptyText: {
    color: COLORS.mist,
    fontSize: 14.5,
    fontFamily: FONTS.body,
  },
  listContent: {
    paddingHorizontal: SPACING.sm,
    paddingTop: SPACING.sm,
    paddingBottom: SPACING.lg,
  },
  personRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: SPACING.sm,
    paddingVertical: 10,
    paddingHorizontal: 4,
  },
  personInfo: { flex: 1, minWidth: 0 },
  personNameRow: { flexDirection: 'row', alignItems: 'center' },
  personName: {
    fontSize: 14.5,
    fontFamily: FONTS.bodySemiBold,
    color: '#FFFFFF',
    flexShrink: 1,
    includeFontPadding: false,
    textAlignVertical: 'center',
  } as any,
  personUsername: {
    fontSize: 12.5,
    fontFamily: FONTS.body,
    color: COLORS.mist,
    marginTop: 2,
  },

  followBtnSmall: {
    minWidth: 100,
    height: 34,
    paddingHorizontal: 14,
    borderRadius: 8,
    backgroundColor: '#E54E60',
    alignItems: 'center',
    justifyContent: 'center',
  },
  followBtnSmallFollowing: {
    backgroundColor: '#2E2E2E',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.06)',
  },
  followBtnSmallText: {
    color: '#FFFFFF',
    fontSize: 13,
    fontFamily: FONTS.bodySemiBold,
  },
  followBtnSmallTextFollowing: {
    color: '#FFFFFF',
  },

  skeletonContainer: {
    paddingHorizontal: 18,
    paddingTop: 10,
  },
  skeletonTopSection: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 14,
    marginBottom: 12,
  },
  skeletonRightCol: {
    flex: 1,
    gap: 10,
  },
  skeletonStatsGrid: {
    flexDirection: 'row',
  },
  skeletonStatItem: {
    flex: 1,
    gap: 2,
  },
  skeletonBioBlock: {
    marginTop: 8,
    marginBottom: 16,
    gap: 6,
  },
  skeletonCard: {
    backgroundColor: '#121212',
    borderWidth: 1,
    borderColor: '#1F1F23',
    borderRadius: RADII.xl,
    overflow: 'hidden',
    marginBottom: 10,
  },
  skeletonRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 18,
    paddingVertical: 14,
  },

  blurBackdrop: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.35)',
  },
  backdropPress: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 24,
  },
  dialogCard: {
    width: '100%',
    maxWidth: 320,
    backgroundColor: 'rgba(20,22,30,0.96)',
    borderRadius: 20,
    paddingTop: 20,
    paddingBottom: 10,
    paddingHorizontal: 8,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.09)',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 12 },
    shadowOpacity: 0.5,
    shadowRadius: 24,
    elevation: 16,
  },
  dialogIconWrap: {
    width: 52,
    height: 52,
    borderRadius: 26,
    alignItems: 'center',
    justifyContent: 'center',
    alignSelf: 'center',
    marginBottom: 12,
  },
  dialogTitle: {
    fontSize: 16,
    fontFamily: FONTS.displayBold,
    color: '#FFFFFF',
    textAlign: 'center',
    marginBottom: 5,
    paddingHorizontal: 12,
  },
  dialogSub: {
    fontSize: 13,
    fontFamily: FONTS.body,
    color: COLORS.mistLight,
    textAlign: 'center',
    lineHeight: 18,
    marginBottom: 14,
    paddingHorizontal: 12,
  },
  dialogButtons: {
    flexDirection: 'row',
    gap: 10,
    paddingHorizontal: 8,
    marginTop: 4,
  },
  dialogBtnSecondary: {
    flex: 1,
    paddingVertical: 11,
    borderRadius: 12,
    backgroundColor: 'rgba(255,255,255,0.06)',
    alignItems: 'center',
  },
  dialogBtnSecondaryText: {
    fontSize: 14,
    fontFamily: FONTS.bodySemiBold,
    color: COLORS.mistLight,
  },
  dialogBtnPrimary: {
    flex: 1,
    paddingVertical: 11,
    borderRadius: 12,
    backgroundColor: COLORS.violet,
    alignItems: 'center',
  },
  dialogBtnDanger: {
    flex: 1,
    paddingVertical: 11,
    borderRadius: 12,
    backgroundColor: COLORS.danger,
    alignItems: 'center',
  },
  dialogBtnPrimaryText: {
    fontSize: 14,
    fontFamily: FONTS.bodySemiBold,
    color: '#FFFFFF',
  },
});
