// app/profile/[id].tsx
// Other user's profile — view, follow, connect, message, block

import { useEffect, useState, useCallback } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  TouchableOpacity,
  ActivityIndicator,
  Alert,
  Modal,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { LinearGradient } from 'expo-linear-gradient';
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

  const isVerified = (p: Profile | null) =>
    !!p &&
    (!!p.verified ||
      VERIFIED_USERNAMES.includes(p.username?.toLowerCase() ?? ''));

  // Load profile + counts
  const loadProfile = useCallback(async () => {
    if (!userId) return;
    try {
      const { data: authData } = await supabase.auth.getUser();
      const myUid = authData.user?.id ?? null;
      setMyId(myUid);

      // Profile
      const { data: p, error } = await supabase
        .from('profiles')
        .select('*')
        .eq('id', userId)
        .single();

      if (error) throw error;
      setProfile(p as Profile);

      // Counts
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

      setFollowersCount(f1.count ?? 0);
      setFollowingCount(f2.count ?? 0);
      const totalFromProfile = (p as any)?.status_total;
      const liveCount = statusRes.count ?? 0;
      setStatusCount(
        typeof totalFromProfile === 'number'
          ? Math.max(totalFromProfile, liveCount)
          : liveCount
      );

      if (!myUid || myUid === userId) {
        setConnectionStatus('connected');
        setLoading(false);
        return;
      }

      // Am I following them?
      const { data: followRow } = await supabase
        .from('follows')
        .select('follower_id')
        .eq('follower_id', myUid)
        .eq('followed_id', userId)
        .maybeSingle();
      setIsFollowing(!!followRow);

      // Am I blocking them?
      const { data: blockRow } = await supabase
        .from('blocked_users')
        .select('blocker_id')
        .eq('blocker_id', myUid)
        .eq('blocked_id', userId)
        .maybeSingle();
      setIsBlocked(!!blockRow);

      // Connection status — shared conversation?
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
          setConvoId(theirs[0].conversation_id);
          setConnectionStatus('connected');
          setLoading(false);
          return;
        }
      }

      // Connection request state
      const { data: req } = await supabase
        .from('connection_requests')
        .select('*')
        .or(
          `and(from_user_id.eq.${myUid},to_user_id.eq.${userId}),and(from_user_id.eq.${userId},to_user_id.eq.${myUid})`
        )
        .maybeSingle();

      if (req) {
        if (req.status === 'accepted') {
          setConnectionStatus('connected');
          // no convo yet — will create on Message tap
        } else if (req.status === 'pending') {
          setConnectionStatus('pending');
        } else if (req.status === 'declined') {
          setConnectionStatus('declined');
        } else {
          setConnectionStatus('none');
        }
      } else {
        setConnectionStatus('none');
      }
    } catch (err) {
      console.warn('Load profile error:', err);
    } finally {
      setLoading(false);
    }
  }, [userId]);

  useEffect(() => {
    loadProfile();
  }, [loadProfile]);

  // Toggle follow
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
          setFollowersCount((c) => (c === null ? c : Math.max(0, c - 1)));
        }
      } else {
        const { error } = await supabase
          .from('follows')
          .insert({ follower_id: myId, followed_id: userId });
        if (!error) {
          setIsFollowing(true);
          setFollowersCount((c) => (c === null ? c : c + 1));
        }
      }
    } catch (err) {
      console.warn('Follow error:', err);
    } finally {
      setFollowToggling(false);
    }
  }

  // Confirm connect request
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
      }
    } catch (err) {
      console.warn('Connect error:', err);
    } finally {
      setSendingRequest(false);
    }
  }

  // Open chat (or create one if connected but no convo)
  async function openChat() {
    if (!myId || !userId) return;
    if (convoId) {
      router.push(`/chat/${convoId}`);
      return;
    }
    if (connectionStatus !== 'connected') return;

    try {
      // Find existing
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
      router.push(`/chat/${foundId}`);
    } catch (err) {
      console.warn('Open chat error:', err);
    }
  }

  // Block / unblock
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
        if (!error) setIsBlocked(false);
      } else {
        Alert.alert(
          'Block user',
          `Block @${profile?.username}? They won't be able to message or see your status.`,
          [
            { text: 'Cancel', style: 'cancel' },
            {
              text: 'Block',
              style: 'destructive',
              onPress: async () => {
                const { error } = await supabase
                  .from('blocked_users')
                  .insert({ blocker_id: myId, blocked_id: userId });
                if (!error) setIsBlocked(true);
              },
            },
          ]
        );
      }
    } catch (err) {
      console.warn('Block error:', err);
    } finally {
      setBlocking(false);
    }
  }

  // Format last seen
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
  const isMe = myId === userId;
  const canOpenLists = connectionStatus === 'connected';

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      <View style={styles.glowTop} />

      {/* Header */}
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
        {/* Avatar + online */}
        <View style={styles.avatarWrap}>
          <View style={styles.avatarInner}>
            <Avatar
              name={profile.display_name}
              color={profile.avatar_color}
              avatarUrl={profile.avatar_url}
              size={104}
            />
          </View>
        </View>

        {/* Name + username */}
        <View style={styles.nameBlock}>
          <View style={styles.nameRow}>
            <Text style={styles.displayName} numberOfLines={2}>
              {profile.display_name}
            </Text>
            {verified && (
              <Ionicons
                name="checkmark-circle"
                size={18}
                color={COLORS.violetLight}
                style={{ marginLeft: 4 }}
              />
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

        {/* Stats */}
        <View style={styles.statsWrap}>
          <StatItem
            label="Followers"
            value={followersCount}
            onPress={canOpenLists ? () => {} : undefined}
          />
          <View style={styles.statDivider} />
          <StatItem
            label="Following"
            value={followingCount}
            onPress={canOpenLists ? () => {} : undefined}
          />
          <View style={styles.statDivider} />
          <StatItem label="Status" value={statusCount} />
        </View>

        {/* Action buttons */}
        <View style={styles.actionsRow}>
          {/* Follow button */}
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
              <ActivityIndicator
                size="small"
                color="#FFFFFF"
              />
            ) : (
              <Text style={styles.followBtnText}>
                {isFollowing ? 'Following' : 'Follow'}
              </Text>
            )}
          </TouchableOpacity>

          {/* Connection action */}
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

          {/* More options */}
          <TouchableOpacity
            style={styles.iconBtn}
            onPress={() => setMenuOpen(true)}
            activeOpacity={0.85}
          >
            <Ionicons name="ellipsis-vertical" size={18} color="#FFFFFF" />
          </TouchableOpacity>
        </View>

        {/* Bio */}
        {profile.bio ? (
          <Text style={styles.bio}>{profile.bio}</Text>
        ) : null}
        {profile.bio_link ? (
          <Text style={styles.bioLink}>{profile.bio_link}</Text>
        ) : null}
      </ScrollView>

      {/* Connect modal */}
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
                size={72}
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
                    You've already sent a request to {profile.display_name}.
                    Waiting for them to accept.
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

      {/* Menu modal */}
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
      <TouchableOpacity style={styles.statItem} onPress={onPress} activeOpacity={0.7}>
        {content}
      </TouchableOpacity>
    );
  }
  return <View style={styles.statItem}>{content}</View>;
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
    paddingHorizontal: SPACING.md,
    paddingVertical: SPACING.sm,
    gap: SPACING.sm,
  },
  headerBtn: {
    width: 40,
    height: 40,
    borderRadius: 20,
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

  // Avatar
  avatarWrap: {
    alignItems: 'center',
    marginTop: SPACING.md,
  },
  avatarInner: {
    borderRadius: 999,
    padding: 3,
    backgroundColor: 'rgba(255,255,255,0.10)',
  },

  // Name
  nameBlock: {
    alignItems: 'center',
    paddingHorizontal: SPACING.lg,
    marginTop: SPACING.md,
  },
  nameRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
  },
  displayName: {
    fontSize: 22,
    fontFamily: FONTS.displayBold,
    color: '#FFFFFF',
    textAlign: 'center',
  },
  username: {
    fontSize: 14,
    fontFamily: FONTS.body,
    color: COLORS.mist,
    marginTop: 2,
  },
  statusPill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    marginTop: 10,
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: RADII.full,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.10)',
    backgroundColor: 'rgba(255,255,255,0.04)',
  },
  statusDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
  },
  statusText: {
    fontSize: 12,
    fontFamily: FONTS.body,
    color: COLORS.mistLight,
  },

  // Stats
  statsWrap: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: SPACING.lg,
  },
  statItem: {
    alignItems: 'center',
    paddingHorizontal: SPACING.lg,
  },
  statValue: {
    fontSize: 18,
    fontFamily: FONTS.displayBold,
    color: '#FFFFFF',
  },
  statLabel: {
    fontSize: 11,
    fontFamily: FONTS.body,
    color: COLORS.mist,
    textTransform: 'uppercase',
    letterSpacing: 0.6,
    marginTop: 3,
  },
  statDivider: {
    width: 1,
    height: 32,
    backgroundColor: 'rgba(255,255,255,0.08)',
  },

  // Action buttons
  actionsRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 10,
    paddingHorizontal: SPACING.lg,
    marginTop: SPACING.xl,
  },
  followBtn: {
    minWidth: 170,
    height: 46,
    borderRadius: RADII.lg,
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
    fontSize: 15,
    fontFamily: FONTS.bodySemiBold,
  },
  iconBtn: {
    width: 46,
    height: 46,
    borderRadius: RADII.lg,
    backgroundColor: '#2E2E2E',
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.06)',
  },
  iconBtnLoading: {
    width: 46,
    height: 46,
    borderRadius: RADII.lg,
    backgroundColor: '#2E2E2E',
    opacity: 0.5,
  },

  // Bio
  bio: {
    paddingHorizontal: SPACING.xl,
    marginTop: SPACING.xl,
    fontSize: 14,
    fontFamily: FONTS.body,
    color: COLORS.mistLight,
    textAlign: 'center',
    lineHeight: 19,
  },
  bioLink: {
    paddingHorizontal: SPACING.xl,
    marginTop: 8,
    fontSize: 13,
    fontFamily: FONTS.bodySemiBold,
    color: COLORS.teal,
    textAlign: 'center',
  },

  // Loading
  loadingWrap: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },

  // Modal
  modalOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.7)',
    alignItems: 'center',
    justifyContent: 'center',
    padding: SPACING.xl,
  },
  modalCard: {
    width: '100%',
    maxWidth: 360,
    backgroundColor: COLORS.ink800,
    borderRadius: RADII.xxl,
    padding: SPACING.xl,
    alignItems: 'center',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.08)',
  },
  modalName: {
    fontSize: 18,
    fontFamily: FONTS.displayBold,
    color: '#FFFFFF',
    marginTop: SPACING.md,
    textAlign: 'center',
  },
  modalUsername: {
    fontSize: 13,
    fontFamily: FONTS.body,
    color: COLORS.mist,
    marginTop: 2,
  },
  modalDivider: {
    height: 1,
    width: '100%',
    backgroundColor: 'rgba(255,255,255,0.06)',
    marginVertical: SPACING.lg,
  },
  modalMessage: {
    fontSize: 14,
    fontFamily: FONTS.body,
    color: COLORS.mistLight,
    textAlign: 'center',
    lineHeight: 20,
    marginBottom: SPACING.lg,
  },
  modalRow: {
    flexDirection: 'row',
    gap: 10,
    width: '100%',
  },
  modalCancel: {
    flex: 1,
    height: 46,
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
    height: 46,
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
    height: 46,
    borderRadius: RADII.full,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.12)',
    alignItems: 'center',
    justifyContent: 'center',
  },

  // Menu
  menuCard: {
    position: 'absolute',
    bottom: 40,
    left: SPACING.xl,
    right: SPACING.xl,
    backgroundColor: COLORS.ink800,
    borderRadius: RADII.xl,
    padding: SPACING.md,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.08)',
  },
  menuItem: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    paddingVertical: 14,
    paddingHorizontal: SPACING.md,
  },
  menuItemText: {
    fontSize: 15,
    fontFamily: FONTS.bodyMedium,
    color: COLORS.danger,
  },
  menuCancel: {
    marginTop: 6,
    paddingVertical: 14,
    alignItems: 'center',
    borderTopWidth: 1,
    borderTopColor: 'rgba(255,255,255,0.06)',
  },
  menuCancelText: {
    fontSize: 14,
    fontFamily: FONTS.bodySemiBold,
    color: COLORS.mistLight,
  },
});
