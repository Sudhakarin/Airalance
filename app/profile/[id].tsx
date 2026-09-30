// app/profile/[id].tsx
// Other user's profile — view, follow, connect, message, block + AsyncStorage cache

import { useEffect, useState, useCallback, useRef } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  TouchableOpacity,
  ActivityIndicator,
  Alert,
  Modal,
  FlatList,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { LinearGradient } from 'expo-linear-gradient';
import AsyncStorage from '@react-native-async-storage/async-storage';
import {
  COLORS,
  FONTS,
  RADII,
  SPACING,
  GRADIENTS,
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
  last_seen: string | null;
  status_total?: number | null;
};

type ConnectionStatus = 'loading' | 'none' | 'pending' | 'connected' | 'declined';
type ListTab = 'followers' | 'following';

const CACHE_TTL_MS = 1000 * 60 * 60 * 24; // 24 hours

function userProfileCacheKey(userId: string) {
  return `airalance:profile:user:${userId}`;
}

type UserProfileCachePayload = {
  t: number;
  profile: Profile;
  followersCount: number;
  followingCount: number;
  statusCount: number;
  isFollowing: boolean;
  isBlocked: boolean;
  convoId: string | null;
  connectionStatus: ConnectionStatus;
};

async function readUserProfileCache(
  userId: string
): Promise<UserProfileCachePayload | null> {
  try {
    const raw = await AsyncStorage.getItem(userProfileCacheKey(userId));
    if (!raw) return null;
    const parsed = JSON.parse(raw) as UserProfileCachePayload;
    if (!parsed?.profile) return null;
    if (Date.now() - (parsed.t ?? 0) > CACHE_TTL_MS) return null;
    return parsed;
  } catch {
    return null;
  }
}

async function writeUserProfileCache(
  userId: string,
  payload: Omit<UserProfileCachePayload, 't'>
) {
  try {
    await AsyncStorage.setItem(
      userProfileCacheKey(userId),
      JSON.stringify({ t: Date.now(), ...payload })
    );
  } catch {}
}

export default function UserProfileScreen() {
  const router = useRouter();
  const params = useLocalSearchParams<{ id: string }>();
  const userId = params.id;

  const [profile, setProfile] = useState<Profile | null>(null);
  const [myId, setMyId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [connectionStatus, setConnectionStatus] =
    useState<ConnectionStatus>('loading');
  const [convoId, setConvoId] = useState<string | null>(null);
  const [isFollowing, setIsFollowing] = useState(false);
  const [followersCount, setFollowersCount] = useState<number | null>(null);
  const [followingCount, setFollowingCount] = useState<number | null>(null);
  const [statusCount, setStatusCount] = useState<number | null>(null);
  const [isBlocked, setIsBlocked] = useState(false);
  const [blocking, setBlocking] = useState(false);
  const [followToggling, setFollowToggling] = useState(false);
  const [connectPopup, setConnectPopup] = useState<
    'ask' | 'pending' | 'declined' | null
  >(null);
  const [sendingRequest, setSendingRequest] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);

  const [listTab, setListTab] = useState<ListTab | null>(null);
  const [followers, setFollowers] = useState<Profile[]>([]);
  const [following, setFollowing] = useState<Profile[]>([]);
  const [listLoading, setListLoading] = useState(false);

  const cacheShownRef = useRef(false);

  const isVerified = (p: Profile | null) =>
    !!p &&
    (!!p.verified ||
      (VERIFIED_USERNAMES as readonly string[]).includes(
        p.username?.toLowerCase() ?? ''
      ));

  // ✅ Cache-first: show cached profile instantly
  useEffect(() => {
    if (!userId || cacheShownRef.current) return;
    (async () => {
      const cache = await readUserProfileCache(userId);
      if (cache) {
        setProfile(cache.profile);
        setFollowersCount(cache.followersCount);
        setFollowingCount(cache.followingCount);
        setStatusCount(cache.statusCount);
        setIsFollowing(cache.isFollowing);
        setIsBlocked(cache.isBlocked);
        setConvoId(cache.convoId);
        setConnectionStatus(cache.connectionStatus);
        setLoading(false);
      }
      cacheShownRef.current = true;
    })();
  }, [userId]);

  // Helper: sync cache after change
  const syncCache = useCallback(
    async (patch: Partial<Omit<UserProfileCachePayload, 't' | 'profile'>>) => {
      if (!userId) return;
      const cached = await readUserProfileCache(userId);
      if (!cached) return;
      const next = {
        profile: cached.profile,
        followersCount: patch.followersCount ?? cached.followersCount,
        followingCount: patch.followingCount ?? cached.followingCount,
        statusCount: patch.statusCount ?? cached.statusCount,
        isFollowing: patch.isFollowing ?? cached.isFollowing,
        isBlocked: patch.isBlocked ?? cached.isBlocked,
        convoId: patch.convoId !== undefined ? patch.convoId : cached.convoId,
        connectionStatus: patch.connectionStatus ?? cached.connectionStatus,
      };
      await writeUserProfileCache(userId, next);
    },
    [userId]
  );

  const loadProfile = useCallback(async () => {
    if (!userId) return;
    try {
      const { data: authData } = await supabase.auth.getUser();
      const myUid = authData.user?.id ?? null;
      setMyId(myUid);

      const { data: p, error } = await supabase
        .from('profiles')
        .select('*')
        .eq('id', userId)
        .single();

      if (error) throw error;
      const profileData = p as Profile;
      setProfile(profileData);

      const [f1, f2, statusRes] = await Promise.all([
        supabase
          .from('follows')
          .select('follower_id', { count: 'exact', head: true })
          .eq('followed_id', userId),
        supabase
          .from('follows')
          .select('followed_id', { count: 'exact', head: true })
          .eq('follower_id', userId),
        supabase
          .from('statuses')
          .select('id', { count: 'exact', head: true })
          .eq('user_id', userId),
      ]);

      const followersCnt = f1.count ?? 0;
      const followingCnt = f2.count ?? 0;
      setFollowersCount(followersCnt);
      setFollowingCount(followingCnt);
      const totalFromProfile = (p as any)?.status_total;
      const liveCount = statusRes.count ?? 0;
      const finalStatus = typeof totalFromProfile === 'number'
        ? Math.max(totalFromProfile, liveCount)
        : liveCount;
      setStatusCount(finalStatus);

      if (!myUid || myUid === userId) {
        setConnectionStatus('connected');
        setLoading(false);
        await writeUserProfileCache(userId, {
          profile: profileData,
          followersCount: followersCnt,
          followingCount: followingCnt,
          statusCount: finalStatus,
          isFollowing: false,
          isBlocked: false,
          convoId: null,
          connectionStatus: 'connected',
        });
        return;
      }

      const { data: followRow } = await supabase
        .from('follows')
        .select('follower_id')
        .eq('follower_id', myUid)
        .eq('followed_id', userId)
        .maybeSingle();
      const followingFlag = !!followRow;
      setIsFollowing(followingFlag);

      const { data: blockRow } = await supabase
        .from('blocked_users')
        .select('blocker_id')
        .eq('blocker_id', myUid)
        .eq('blocked_id', userId)
        .maybeSingle();
      const blockedFlag = !!blockRow;
      setIsBlocked(blockedFlag);

      let resolvedConvo: string | null = null;
      let resolvedStatus: ConnectionStatus = 'none';

      const { data: mine } = await supabase
        .from('conversation_participants')
        .select('conversation_id')
        .eq('user_id', myUid);
      const myConvoIds = (mine ?? []).map((r: any) => r.conversation_id);

      if (myConvoIds.length > 0) {
        const { data: theirs } = await supabase
          .from('conversation_participants')
          .select('conversation_id')
          .eq('user_id', userId)
          .in('conversation_id', myConvoIds);
        if (theirs && theirs.length > 0) {
          resolvedConvo = theirs[0].conversation_id;
          resolvedStatus = 'connected';
          setConvoId(resolvedConvo);
          setConnectionStatus('connected');
          setLoading(false);

          await writeUserProfileCache(userId, {
            profile: profileData,
            followersCount: followersCnt,
            followingCount: followingCnt,
            statusCount: finalStatus,
            isFollowing: followingFlag,
            isBlocked: blockedFlag,
            convoId: resolvedConvo,
            connectionStatus: resolvedStatus,
          });
          return;
        }
      }

      const { data: req } = await supabase
        .from('connection_requests')
        .select('*')
        .or(
          `and(from_user_id.eq.${myUid},to_user_id.eq.${userId}),and(from_user_id.eq.${userId},to_user_id.eq.${myUid})`
        )
        .maybeSingle();

      if (req) {
        if (req.status === 'accepted') resolvedStatus = 'connected';
        else if (req.status === 'pending') resolvedStatus = 'pending';
        else if (req.status === 'declined') resolvedStatus = 'declined';
        else resolvedStatus = 'none';
      } else {
        resolvedStatus = 'none';
      }
      setConnectionStatus(resolvedStatus);

      await writeUserProfileCache(userId, {
        profile: profileData,
        followersCount: followersCnt,
        followingCount: followingCnt,
        statusCount: finalStatus,
        isFollowing: followingFlag,
        isBlocked: blockedFlag,
        convoId: resolvedConvo,
        connectionStatus: resolvedStatus,
      });
    } catch (err) {
      console.warn('Load profile error:', err);
    } finally {
      setLoading(false);
    }
  }, [userId]);

  useEffect(() => {
    loadProfile();
  }, [loadProfile]);

  async function loadFollowLists(tab: ListTab) {
    if (!userId) return;
    setListTab(tab);
    setListLoading(true);
    try {
      const column = tab === 'followers' ? 'follower_id' : 'followed_id';
      const match = tab === 'followers' ? 'followed_id' : 'follower_id';

      const { data: rows } = await supabase
        .from('follows')
        .select(column)
        .eq(match, userId);

      const ids = (rows ?? []).map((r: any) => r[column]);
      if (ids.length === 0) {
        if (tab === 'followers') setFollowers([]);
        else setFollowing([]);
        setListLoading(false);
        return;
      }

      const { data: profiles } = await supabase
        .from('profiles')
        .select('*')
        .in('id', ids);

      if (tab === 'followers') setFollowers((profiles ?? []) as Profile[]);
      else setFollowing((profiles ?? []) as Profile[]);
    } catch (err) {
      console.warn('Load follow lists error:', err);
    } finally {
      setListLoading(false);
    }
  }

  async function toggleFollow() {
    if (!myId || !userId || followToggling) return;
    setFollowToggling(true);
    try {
      if (isFollowing) {
        const { error } = await supabase
          .from('follows')
          .delete()
          .eq('follower_id', myId)
          .eq('followed_id', userId);
        if (!error) {
          setIsFollowing(false);
          const nextCount = followersCount !== null ? Math.max(0, followersCount - 1) : null;
          if (nextCount !== null) setFollowersCount(nextCount);
          await syncCache({
            isFollowing: false,
            ...(nextCount !== null ? { followersCount: nextCount } : {}),
          });
        }
      } else {
        const { error } = await supabase
          .from('follows')
          .insert({ follower_id: myId, followed_id: userId });
        if (!error) {
          setIsFollowing(true);
          const nextCount = followersCount !== null ? followersCount + 1 : null;
          if (nextCount !== null) setFollowersCount(nextCount);
          await syncCache({
            isFollowing: true,
            ...(nextCount !== null ? { followersCount: nextCount } : {}),
          });

          const { data: me } = await supabase
            .from('profiles')
            .select('display_name')
            .eq('id', myId)
            .single();

          await supabase.functions.invoke('send-push', {
            body: {
              userId: userId,
              title: 'New follower',
              body: `${me?.display_name || 'Someone'} started following you`,
              data: { screen: 'profile', userId: myId },
            },
          });
        }
      }
    } catch (err) {
      console.warn('Follow error:', err);
    } finally {
      setFollowToggling(false);
    }
  }

  async function confirmConnect() {
    if (!myId || !userId || sendingRequest) return;
    setSendingRequest(true);
    try {
      const { data: existing } = await supabase
        .from('connection_requests')
        .select('id')
        .eq('from_user_id', myId)
        .eq('to_user_id', userId)
        .maybeSingle();

      const { error } = existing
        ? await supabase
            .from('connection_requests')
            .update({
              status: 'pending',
              created_at: new Date().toISOString(),
            })
            .eq('id', existing.id)
        : await supabase.from('connection_requests').insert({
            from_user_id: myId,
            to_user_id: userId,
          });

      if (!error) {
        setConnectionStatus('pending');
        setConnectPopup(null);
        await syncCache({ connectionStatus: 'pending' });

        const { data: me } = await supabase
          .from('profiles')
          .select('display_name')
          .eq('id', myId)
          .single();

        await supabase.functions.invoke('send-push', {
          body: {
            userId: userId,
            title: 'Connection request',
            body: `${me?.display_name || 'Someone'} wants to connect with you`,
            data: { screen: 'profile', userId: myId },
          },
        });
      }
    } catch (err) {
      console.warn('Connect error:', err);
    } finally {
      setSendingRequest(false);
    }
  }

  async function openChat() {
    if (!myId || !userId) return;
    if (convoId) {
      router.push(`/chat/${convoId}`);
      return;
    }
    if (connectionStatus !== 'connected') return;

    try {
      const { data: mine } = await supabase
        .from('conversation_participants')
        .select('conversation_id')
        .eq('user_id', myId);
      const myIds = (mine ?? []).map((r: any) => r.conversation_id);
      let foundId: string | null = null;
      if (myIds.length > 0) {
        const { data: theirs } = await supabase
          .from('conversation_participants')
          .select('conversation_id')
          .eq('user_id', userId)
          .in('conversation_id', myIds);
        if (theirs && theirs.length > 0) foundId = theirs[0].conversation_id;
      }

      if (!foundId) {
        const { data: convo, error } = await supabase
          .from('conversations')
          .insert({ is_group: false, created_by: myId })
          .select()
          .single();
        if (error || !convo) return;
        foundId = convo.id;
        await supabase.from('conversation_participants').insert([
          { conversation_id: foundId, user_id: myId },
          { conversation_id: foundId, user_id: userId },
        ]);
      }

      setConvoId(foundId);
      await syncCache({ convoId: foundId });
      router.push(`/chat/${foundId}`);
    } catch (err) {
      console.warn('Open chat error:', err);
    }
  }

  async function toggleBlock() {
    if (!myId || !userId || blocking) return;
    setMenuOpen(false);
    setBlocking(true);
    try {
      if (isBlocked) {
        const { error } = await supabase
          .from('blocked_users')
          .delete()
          .eq('blocker_id', myId)
          .eq('blocked_id', userId);
        if (!error) {
          setIsBlocked(false);
          await syncCache({ isBlocked: false });
        }
      } else {
        Alert.alert('Block user', `Block @${profile?.username}?`, [
          { text: 'Cancel', style: 'cancel' },
          {
            text: 'Block',
            style: 'destructive',
            onPress: async () => {
              const { error } = await supabase
                .from('blocked_users')
                .insert({ blocker_id: myId, blocked_id: userId });
              if (!error) {
                setIsBlocked(true);
                await syncCache({ isBlocked: true });
              }
            },
          },
        ]);
      }
    } catch (err) {
      console.warn('Block error:', err);
    } finally {
      setBlocking(false);
    }
  }

  function formatLastSeen(iso: string | null | undefined) {
    if (!iso) return 'Offline';
    const diffMs = Date.now() - new Date(iso).getTime();
    const diffMin = Math.floor(diffMs / 60000);
    if (diffMin < 1) return 'Active now';
    if (diffMin < 60) return `Last seen ${diffMin}m ago`;
    const diffHr = Math.floor(diffMin / 60);
    if (diffHr < 24) return `Last seen ${diffHr}h ago`;
    return `Last seen ${Math.floor(diffHr / 24)}d ago`;
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
  const canOpenLists = connectionStatus === 'connected';
  const listData = listTab === 'followers' ? followers : following;

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      <View style={styles.header}>
        <TouchableOpacity
          onPress={() => router.back()}
          style={styles.headerBtn}
          activeOpacity={0.7}
        >
          <Ionicons name="chevron-back" size={22} color={COLORS.text} />
        </TouchableOpacity>
        <Text style={styles.headerUsername} numberOfLines={1}>
          @{profile.username}
        </Text>
        <TouchableOpacity
          onPress={() => setMenuOpen(true)}
          style={styles.headerBtn}
          activeOpacity={0.7}
        >
          <Ionicons
            name="ellipsis-horizontal"
            size={20}
            color={COLORS.text}
          />
        </TouchableOpacity>
      </View>

      <ScrollView
        contentContainerStyle={styles.scroll}
        showsVerticalScrollIndicator={false}
      >
        <View style={styles.avatarWrap}>
          <View style={styles.avatarInner}>
            <Avatar
              name={profile.display_name}
              color={profile.avatar_color}
              avatarUrl={profile.avatar_url}
              size={90}
            />
          </View>
        </View>

        <View style={styles.nameBlock}>
          <View style={styles.nameRow}>
            <Text style={styles.displayName} numberOfLines={2}>
              {profile.display_name}
            </Text>
            {verified && (
              <View style={styles.badgeWrap}>
                <VerifiedBadge size={18} />
              </View>
            )}
          </View>
          <Text style={styles.username}>@{profile.username}</Text>

          <View style={styles.statusPill}>
            <View
              style={[
                styles.statusDot,
                {
                  backgroundColor:
                    profile.last_seen &&
                    Date.now() - new Date(profile.last_seen).getTime() <
                      60000
                      ? COLORS.teal
                      : 'rgba(255,255,255,0.3)',
                },
              ]}
            />
            <Text style={styles.statusText}>
              {formatLastSeen(profile.last_seen)}
            </Text>
          </View>
        </View>

        <View style={styles.statsWrap}>
          <StatItem
            label="Followers"
            value={followersCount}
            onPress={
              canOpenLists ? () => loadFollowLists('followers') : undefined
            }
          />
          <View style={styles.statDivider} />
          <StatItem
            label="Following"
            value={followingCount}
            onPress={
              canOpenLists ? () => loadFollowLists('following') : undefined
            }
          />
          <View style={styles.statDivider} />
          <StatItem label="Status" value={statusCount} />
        </View>

        <View style={styles.actionsRow}>
          <TouchableOpacity
            style={[
              styles.followBtn,
              isFollowing && styles.followBtnActive,
            ]}
            onPress={toggleFollow}
            disabled={followToggling}
            activeOpacity={0.85}
          >
            {followToggling ? (
              <ActivityIndicator size="small" color="#FFFFFF" />
            ) : (
              <Text style={styles.followBtnText}>
                {isFollowing ? 'Following' : 'Follow'}
              </Text>
            )}
          </TouchableOpacity>

          {connectionStatus === 'loading' && (
            <View style={styles.iconBtnLoading} />
          )}

          {connectionStatus === 'none' && (
            <TouchableOpacity
              style={styles.iconBtn}
              onPress={() => setConnectPopup('ask')}
              activeOpacity={0.85}
            >
              <Ionicons
                name="person-add-outline"
                size={20}
                color="#FFFFFF"
              />
            </TouchableOpacity>
          )}

          {connectionStatus === 'pending' && (
            <TouchableOpacity
              style={styles.iconBtn}
              onPress={() => setConnectPopup('pending')}
              activeOpacity={0.85}
            >
              <Ionicons name="time-outline" size={20} color="#FFFFFF" />
            </TouchableOpacity>
          )}

          {connectionStatus === 'declined' && (
            <TouchableOpacity
              style={styles.iconBtn}
              onPress={() => setConnectPopup('declined')}
              activeOpacity={0.85}
            >
              <Ionicons
                name="close-circle-outline"
                size={20}
                color={COLORS.danger}
              />
            </TouchableOpacity>
          )}

          {connectionStatus === 'connected' && (
            <TouchableOpacity
              style={styles.iconBtn}
              onPress={openChat}
              activeOpacity={0.85}
            >
              <Ionicons
                name="chatbubble-outline"
                size={20}
                color="#FFFFFF"
              />
            </TouchableOpacity>
          )}

          <TouchableOpacity
            style={styles.iconBtn}
            onPress={() => setMenuOpen(true)}
            activeOpacity={0.85}
          >
            <Ionicons name="ellipsis-vertical" size={18} color="#FFFFFF" />
          </TouchableOpacity>
        </View>

        {profile.bio ? <Text style={styles.bio}>{profile.bio}</Text> : null}
        {profile.bio_link ? (
          <Text style={styles.bioLink}>{profile.bio_link}</Text>
        ) : null}
      </ScrollView>

      {connectPopup && (
        <Modal
          visible
          transparent
          animationType="fade"
          onRequestClose={() => setConnectPopup(null)}
        >
          <View style={styles.modalOverlay}>
            <View style={styles.modalCard}>
              <Avatar
                name={profile.display_name}
                color={profile.avatar_color}
                avatarUrl={profile.avatar_url}
                size={70}
              />
              <Text style={styles.modalName}>{profile.display_name}</Text>
              <Text style={styles.modalUsername}>@{profile.username}</Text>

              <View style={styles.modalDivider} />

              {connectPopup === 'ask' && (
                <>
                  <Text style={styles.modalMessage}>
                    Do you want to connect with{' '}
                    <Text style={{ fontFamily: FONTS.bodySemiBold }}>
                      {profile.display_name}
                    </Text>
                    ?
                  </Text>
                  <View style={styles.modalRow}>
                    <TouchableOpacity
                      style={styles.modalCancel}
                      onPress={() => setConnectPopup(null)}
                      activeOpacity={0.85}
                    >
                      <Text style={styles.modalCancelText}>Cancel</Text>
                    </TouchableOpacity>
                    <TouchableOpacity
                      style={styles.modalPrimary}
                      onPress={confirmConnect}
                      disabled={sendingRequest}
                      activeOpacity={0.85}
                    >
                      <LinearGradient
                        colors={GRADIENTS.violet}
                        start={{ x: 0, y: 0 }}
                        end={{ x: 1, y: 1 }}
                        style={styles.modalPrimaryGradient}
                      >
                        {sendingRequest ? (
                          <ActivityIndicator size="small" color="#FFFFFF" />
                        ) : (
                          <Text style={styles.modalPrimaryText}>
                            Yes, Connect
                          </Text>
                        )}
                      </LinearGradient>
                    </TouchableOpacity>
                  </View>
                </>
              )}

              {connectPopup === 'pending' && (
                <>
                  <Text style={styles.modalMessage}>
                    You've already sent a request.
                  </Text>
                  <TouchableOpacity
                    style={styles.modalFull}
                    onPress={() => setConnectPopup(null)}
                    activeOpacity={0.85}
                  >
                    <Text style={styles.modalCancelText}>OK</Text>
                  </TouchableOpacity>
                </>
              )}

              {connectPopup === 'declined' && (
                <>
                  <Text style={styles.modalMessage}>
                    {profile.display_name} declined your request.
                  </Text>
                  <TouchableOpacity
                    style={styles.modalFull}
                    onPress={() => setConnectPopup(null)}
                    activeOpacity={0.85}
                  >
                    <Text style={styles.modalCancelText}>OK</Text>
                  </TouchableOpacity>
                </>
              )}
            </View>
          </View>
        </Modal>
      )}

      {menuOpen && (
        <Modal
          visible
          transparent
          animationType="fade"
          onRequestClose={() => setMenuOpen(false)}
        >
          <TouchableOpacity
            style={styles.modalOverlay}
            activeOpacity={1}
            onPress={() => setMenuOpen(false)}
          >
            <View style={styles.menuCard}>
              <TouchableOpacity
                style={styles.menuItem}
                onPress={toggleBlock}
                disabled={blocking}
                activeOpacity={0.85}
              >
                <Ionicons
                  name="ban-outline"
                  size={20}
                  color={COLORS.danger}
                />
                <Text style={styles.menuItemText}>
                  {blocking
                    ? 'Please wait…'
                    : isBlocked
                    ? 'Unblock User'
                    : 'Block User'}
                </Text>
              </TouchableOpacity>

              <TouchableOpacity
                style={styles.menuCancel}
                onPress={() => setMenuOpen(false)}
                activeOpacity={0.85}
              >
                <Text style={styles.menuCancelText}>Cancel</Text>
              </TouchableOpacity>
            </View>
          </TouchableOpacity>
        </Modal>
      )}

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
                  <Ionicons name="close" size={22} color="#FFFFFF" />
                </TouchableOpacity>
                <View style={styles.listTabs}>
                  <TouchableOpacity
                    onPress={() => loadFollowLists('followers')}
                    style={styles.listTabBtn}
                    activeOpacity={0.7}
                  >
                    <Text
                      style={[
                        styles.listTabText,
                        listTab === 'followers' && styles.listTabTextActive,
                      ]}
                    >
                      Followers
                    </Text>
                    {listTab === 'followers' && (
                      <View style={styles.listTabUnderline} />
                    )}
                  </TouchableOpacity>
                  <TouchableOpacity
                    onPress={() => loadFollowLists('following')}
                    style={styles.listTabBtn}
                    activeOpacity={0.7}
                  >
                    <Text
                      style={[
                        styles.listTabText,
                        listTab === 'following' && styles.listTabTextActive,
                      ]}
                    >
                      Following
                    </Text>
                    {listTab === 'following' && (
                      <View style={styles.listTabUnderline} />
                    )}
                  </TouchableOpacity>
                </View>
                <View style={styles.listHeaderBtn} />
              </View>

              {listLoading ? (
                <View style={styles.listLoading}>
                  <ActivityIndicator color={COLORS.violet} />
                </View>
              ) : listData.length === 0 ? (
                <View style={styles.listEmpty}>
                  <Ionicons
                    name="people-outline"
                    size={36}
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
                  data={listData}
                  keyExtractor={(item) => item.id}
                  contentContainerStyle={styles.listContent}
                  renderItem={({ item }) => (
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
                          <Text
                            style={styles.personName}
                            numberOfLines={1}
                          >
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
                          @{item.username}
                        </Text>
                      </View>
                    </TouchableOpacity>
                  )}
                />
              )}
            </SafeAreaView>
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
  const content = (
    <>
      <Text style={styles.statValue}>
        {value === null ? '—' : value}
      </Text>
      <Text style={styles.statLabel}>{label}</Text>
    </>
  );
  if (onPress) {
    return (
      <TouchableOpacity
        style={styles.statItem}
        onPress={onPress}
        activeOpacity={0.7}
      >
        {content}
      </TouchableOpacity>
    );
  }
  return <View style={styles.statItem}>{content}</View>;
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: '#000000' },
  scroll: { paddingBottom: SPACING.lg },

  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 14,
    paddingVertical: 10,
    gap: SPACING.sm,
  },
  headerBtn: {
    width: 38,
    height: 38,
    borderRadius: 19,
    backgroundColor: 'rgba(255,255,255,0.05)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  headerUsername: {
    flex: 1,
    textAlign: 'center',
    fontSize: 14,
    fontFamily: FONTS.bodySemiBold,
    color: COLORS.mistLight,
  },

  avatarWrap: { alignItems: 'center', marginTop: 10 },
  avatarInner: {
    borderRadius: 999,
    padding: 4,
    backgroundColor: 'rgba(255,255,255,0.10)',
  },

  nameBlock: {
    alignItems: 'center',
    paddingHorizontal: SPACING.lg,
    marginTop: 10,
  },
  nameRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
  },
  displayName: {
    fontSize: 20,
    fontFamily: FONTS.displayBold,
    color: '#FFFFFF',
    textAlign: 'center',
    includeFontPadding: false,
    textAlignVertical: 'center',
  } as any,
  badgeWrap: {
    marginLeft: 4,
    marginTop: 1,
    justifyContent: 'center',
    alignItems: 'center',
  },
  badgeWrapSmall: {
    marginLeft: 3,
    marginTop: 1,
    justifyContent: 'center',
    alignItems: 'center',
  },
  username: {
    fontSize: 13.5,
    fontFamily: FONTS.body,
    color: COLORS.mist,
    marginTop: 3,
  },
  statusPill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    marginTop: 8,
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderRadius: RADII.full,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.10)',
    backgroundColor: 'rgba(255,255,255,0.04)',
  },
  statusDot: { width: 7, height: 7, borderRadius: 4 },
  statusText: {
    fontSize: 12,
    fontFamily: FONTS.body,
    color: COLORS.mistLight,
  },

  statsWrap: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: SPACING.md,
  },
  statItem: { alignItems: 'center', paddingHorizontal: 18 },
  statValue: {
    fontSize: 16.5,
    fontFamily: FONTS.displayBold,
    color: '#FFFFFF',
    includeFontPadding: false,
    textAlignVertical: 'center',
  } as any,
  statLabel: {
    fontSize: 10.5,
    fontFamily: FONTS.body,
    color: COLORS.mist,
    textTransform: 'uppercase',
    letterSpacing: 0.6,
    marginTop: 3,
  },
  statDivider: {
    width: 1,
    height: 28,
    backgroundColor: 'rgba(255,255,255,0.08)',
  },

  actionsRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    paddingHorizontal: SPACING.lg,
    marginTop: SPACING.lg,
  },
  followBtn: {
    minWidth: 140,
    height: 42,
    borderRadius: RADII.md,
    backgroundColor: '#E54E60',
    alignItems: 'center',
    justifyContent: 'center',
  },
  followBtnActive: {
    backgroundColor: '#2E2E2E',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.06)',
  },
  followBtnText: {
    color: '#FFFFFF',
    fontSize: 14,
    fontFamily: FONTS.bodySemiBold,
  },
  iconBtn: {
    width: 42,
    height: 42,
    borderRadius: RADII.md,
    backgroundColor: '#2E2E2E',
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.06)',
  },
  iconBtnLoading: {
    width: 42,
    height: 42,
    borderRadius: RADII.md,
    backgroundColor: '#2E2E2E',
    opacity: 0.5,
  },

  bio: {
    paddingHorizontal: SPACING.lg,
    marginTop: SPACING.md,
    fontSize: 13.5,
    fontFamily: FONTS.body,
    color: COLORS.mistLight,
    textAlign: 'center',
    lineHeight: 19,
  },
  bioLink: {
    paddingHorizontal: SPACING.lg,
    marginTop: 6,
    fontSize: 13,
    fontFamily: FONTS.bodySemiBold,
    color: COLORS.teal,
    textAlign: 'center',
  },

  loadingWrap: { flex: 1, alignItems: 'center', justifyContent: 'center' },

  modalOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.7)',
    alignItems: 'center',
    justifyContent: 'center',
    padding: SPACING.lg,
  },
  modalCard: {
    width: '100%',
    maxWidth: 340,
    backgroundColor: '#121212',
    borderRadius: RADII.xl,
    padding: SPACING.lg,
    alignItems: 'center',
    borderWidth: 1,
    borderColor: '#1F1F23',
  },
  modalName: {
    fontSize: 17,
    fontFamily: FONTS.displayBold,
    color: '#FFFFFF',
    marginTop: SPACING.sm,
    textAlign: 'center',
  },
  modalUsername: {
    fontSize: 12.5,
    fontFamily: FONTS.body,
    color: COLORS.mist,
    marginTop: 2,
  },
  modalDivider: {
    height: 1,
    width: '100%',
    backgroundColor: '#1F1F23',
    marginVertical: SPACING.md,
  },
  modalMessage: {
    fontSize: 13.5,
    fontFamily: FONTS.body,
    color: COLORS.mistLight,
    textAlign: 'center',
    lineHeight: 19,
    marginBottom: SPACING.md,
  },
  modalRow: { flexDirection: 'row', gap: 10, width: '100%' },
  modalCancel: {
    flex: 1,
    height: 42,
    borderRadius: RADII.full,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.12)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  modalCancelText: {
    color: COLORS.mistLight,
    fontSize: 14,
    fontFamily: FONTS.bodySemiBold,
  },
  modalPrimary: {
    flex: 1,
    borderRadius: RADII.full,
    overflow: 'hidden',
  },
  modalPrimaryGradient: {
    height: 42,
    alignItems: 'center',
    justifyContent: 'center',
  },
  modalPrimaryText: {
    color: '#FFFFFF',
    fontSize: 14,
    fontFamily: FONTS.bodySemiBold,
  },
  modalFull: {
    width: '100%',
    height: 42,
    borderRadius: RADII.full,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.12)',
    alignItems: 'center',
    justifyContent: 'center',
  },

  menuCard: {
    position: 'absolute',
    bottom: 30,
    left: SPACING.lg,
    right: SPACING.lg,
    backgroundColor: '#121212',
    borderRadius: RADII.xl,
    padding: SPACING.sm,
    borderWidth: 1,
    borderColor: '#1F1F23',
  },
  menuItem: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    paddingVertical: 14,
    paddingHorizontal: SPACING.sm,
  },
  menuItemText: {
    fontSize: 14,
    fontFamily: FONTS.bodyMedium,
    color: COLORS.danger,
  },
  menuCancel: {
    marginTop: 4,
    paddingVertical: 14,
    alignItems: 'center',
    borderTopWidth: 1,
    borderTopColor: '#1F1F23',
  },
  menuCancelText: {
    fontSize: 14,
    fontFamily: FONTS.bodySemiBold,
    color: COLORS.mistLight,
  },

  listModalWrap: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.7)',
    justifyContent: 'flex-end',
  },
  listModal: {
    backgroundColor: '#000000',
    borderTopLeftRadius: 22,
    borderTopRightRadius: 22,
    height: '80%',
    borderTopWidth: 1,
    borderColor: '#1F1F23',
  },
  listHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: SPACING.sm,
    paddingTop: SPACING.sm,
    paddingBottom: 8,
  },
  listHeaderBtn: {
    width: 38,
    height: 38,
    alignItems: 'center',
    justifyContent: 'center',
  },
  listTabs: {
    flex: 1,
    flexDirection: 'row',
    justifyContent: 'center',
    gap: 24,
  },
  listTabBtn: {
    paddingVertical: 8,
    alignItems: 'center',
    position: 'relative',
  },
  listTabText: {
    fontSize: 15,
    fontFamily: FONTS.bodySemiBold,
    color: COLORS.mist,
  },
  listTabTextActive: { color: '#FFFFFF' },
  listTabUnderline: {
    position: 'absolute',
    bottom: 0,
    height: 2,
    width: 36,
    borderRadius: 2,
    backgroundColor: COLORS.violetLight,
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
    fontSize: 14,
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
    paddingHorizontal: SPACING.sm,
    borderRadius: RADII.lg,
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
});
