// app/(tabs)/profile.tsx
// My profile — larger fonts + spacing

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
  Modal,
  FlatList,
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
import StatusRing from '../../components/StatusRing';

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

function formatCount(n: number): string {
  if (n < 1000) return String(n);
  const fmt = (v: number, unit: string) =>
    `${(v < 10 ? Math.round(v * 10) / 10 : Math.round(v))
      .toString()
      .replace(/\.0$/, '')}${unit}`;
  if (n < 1_000_000) return fmt(n / 1000, 'K');
  return fmt(n / 1_000_000, 'M');
}

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

  const [listTab, setListTab] = useState<ListTab | null>(null);
  const [listUsers, setListUsers] = useState<Profile[]>([]);
  const [listLoading, setListLoading] = useState(false);
  const [myFollowingIds, setMyFollowingIds] = useState<Set<string>>(new Set());
  const [toggleLoadingId, setToggleLoadingId] = useState<string | null>(null);

  const isVerified = (p: Profile | null) =>
    !!p &&
    (!!p.verified ||
      VERIFIED_USERNAMES.includes(p.username?.toLowerCase() ?? ''));

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

      const [f1, f2, statusRes, followingRes] = await Promise.all([
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
        supabase
          .from('follows')
          .select('followed_id')
          .eq('follower_id', authData.user.id),
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

      const ids = new Set<string>(
        (followingRes.data ?? []).map((r: any) => r.followed_id)
      );
      setMyFollowingIds(ids);
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

  const loadFollowList = useCallback(
    async (tab: ListTab) => {
      if (!profile) return;
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
        if (ids.length === 0) {
          setListUsers([]);
          setListLoading(false);
          return;
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
          setMyFollowingIds((prev) => {
            const next = new Set(prev);
            next.delete(targetId);
            return next;
          });
          setFollowingCount((c) => (c === null ? c : Math.max(0, c - 1)));
        }
      } else {
        const { error } = await supabase
          .from('follows')
          .insert({ follower_id: profile.id, followed_id: targetId });
        if (!error) {
          setMyFollowingIds((prev) => {
            const next = new Set(prev);
            next.add(targetId);
            return next;
          });
          setFollowingCount((c) => (c === null ? c : c + 1));
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
  const ownActiveStatusCount = statusCount ?? 0;
  const statusShown =
    statusCount === null ? null : Math.max(statusCount, ownActiveStatusCount);

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
            <StatusRing
              hasStatus={ownActiveStatusCount > 0}
              viewed={true}
            >
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
          {profile.bio ? (
            <Text style={styles.bio}>{profile.bio}</Text>
          ) : null}
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
            <View style={styles.listModal}>
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
                  keyExtractor={(item) => item.id}
                  contentContainerStyle={styles.listContent}
                  renderItem={({ item }) => {
                    const isMe = item.id === profile.id;
                    const isFollowing = myFollowingIds.has(item.id);
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
                                {isFollowing ? 'Following' : 'Follow back'}
                              </Text>
                            )}
                          </TouchableOpacity>
                        )}
                      </TouchableOpacity>
                    );
                  }}
                />
              )}
            </View>
          </View>
        </Modal>
      )}
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
    marginLeft: 6,
    marginTop: 1,
    justifyContent: 'center',
    alignItems: 'center',
  },
  badgeWrapSmall: {
    marginLeft: 5,
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
});
