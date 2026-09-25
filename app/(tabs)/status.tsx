// app/(tabs)/status.tsx
// Status tab — shows status list grouped by user with story rings + proper spacing

import { useEffect, useState, useCallback } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  TouchableOpacity,
  ActivityIndicator,
  RefreshControl,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter, useFocusEffect } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { COLORS, FONTS, RADII, SPACING } from '../../constants/theme';
import { supabase } from '../../lib/supabase';
import Avatar from '../../components/Avatar';
import StatusRing from '../../components/StatusRing';
import VerifiedBadge from '../../components/VerifiedBadge';

type Profile = {
  id: string;
  username: string;
  display_name: string;
  avatar_color: string;
  avatar_url: string | null;
  verified: boolean | null;
};

type Status = {
  id: string;
  user_id: string;
  media_url: string | null;
  media_type: 'image' | 'video' | 'text' | null;
  text_content: string | null;
  bg_color: string | null;
  created_at: string;
  expires_at: string;
  profile: Profile | null;
};

type UserStatusGroup = {
  userId: string;
  profile: Profile | null;
  statuses: Status[];
  latestAt: string;
};

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

function StatusSkeleton() {
  return (
    <View style={styles.skeletonWrap}>
      <View style={styles.myStatusRow}>
        <SkeletonBlock width={58} height={58} borderRadius={29} />
        <View style={{ flex: 1, gap: 8 }}>
          <SkeletonBlock width="40%" height={16} borderRadius={6} />
          <SkeletonBlock width="60%" height={12} borderRadius={4} />
        </View>
      </View>

      <View style={styles.thickDivider} />

      <View style={styles.section}>
        <SkeletonBlock
          width={100}
          height={12}
          borderRadius={4}
          style={{ marginBottom: 12, marginHorizontal: 18 }}
        />
        {[1, 2, 3].map((i) => (
          <View key={i} style={styles.statusRow}>
            <SkeletonBlock width={58} height={58} borderRadius={29} />
            <View style={{ flex: 1, gap: 6 }}>
              <SkeletonBlock width="50%" height={16} borderRadius={6} />
              <SkeletonBlock width="30%" height={12} borderRadius={4} />
            </View>
          </View>
        ))}
      </View>
    </View>
  );
}

export default function StatusScreen() {
  const router = useRouter();
  const [myStatuses, setMyStatuses] = useState<Status[]>([]);
  const [otherGroups, setOtherGroups] = useState<UserStatusGroup[]>([]);
  const [viewedIds, setViewedIds] = useState<Set<string>>(new Set());
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [myId, setMyId] = useState<string | null>(null);
  const [myProfile, setMyProfile] = useState<Profile | null>(null);

  useEffect(() => {
    supabase.auth.getUser().then(({ data }) => {
      if (data.user) {
        setMyId(data.user.id);
        supabase
          .from('profiles')
          .select('*')
          .eq('id', data.user.id)
          .single()
          .then(({ data: p }) => {
            if (p) setMyProfile(p as Profile);
          });
      }
    });
  }, []);

  const loadStatuses = useCallback(async () => {
    if (!myId) return;
    try {
      const { data: statusData, error } = await supabase
        .from('statuses')
        .select('*, profile:profiles(*)')
        .gt('expires_at', new Date().toISOString())
        .order('created_at', { ascending: true });

      if (error) throw error;

      const all = (statusData ?? []) as Status[];
      const mine = all.filter((s) => s.user_id === myId);
      const others = all.filter((s) => s.user_id !== myId);

      const grouped: Record<string, UserStatusGroup> = {};
      others.forEach((s) => {
        if (!grouped[s.user_id]) {
          grouped[s.user_id] = {
            userId: s.user_id,
            profile: s.profile,
            statuses: [],
            latestAt: s.created_at,
          };
        }
        grouped[s.user_id].statuses.push(s);
        if (s.created_at > grouped[s.user_id].latestAt) {
          grouped[s.user_id].latestAt = s.created_at;
        }
      });

      setMyStatuses(mine);
      setOtherGroups(Object.values(grouped));

      const { data: views } = await supabase
        .from('status_views')
        .select('status_id')
        .eq('viewer_id', myId);
      setViewedIds(new Set((views ?? []).map((v: any) => v.status_id)));
    } catch (err) {
      console.warn('Load statuses error:', err);
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [myId]);

  useEffect(() => {
    loadStatuses();
  }, [loadStatuses]);

  useFocusEffect(
    useCallback(() => {
      if (myId) loadStatuses();
    }, [myId, loadStatuses])
  );

  async function onRefresh() {
    setRefreshing(true);
    await loadStatuses();
  }

  function isGroupViewed(group: UserStatusGroup) {
    return group.statuses.every((s) => viewedIds.has(s.id));
  }

  function formatTime(iso: string) {
    const diff = Date.now() - new Date(iso).getTime();
    const min = Math.floor(diff / 60000);
    if (min < 1) return 'just now';
    if (min < 60) return `${min}m ago`;
    const hr = Math.floor(min / 60);
    if (hr < 24) return `${hr}h ago`;
    return `${Math.floor(hr / 24)}d ago`;
  }

  function openStatusViewer(userId: string) {
    router.push(`/status/${userId}`);
  }

  function openCreateStatus() {
    router.push('/status/create');
  }

  const recent = otherGroups
    .filter((g) => !isGroupViewed(g))
    .sort((a, b) => (a.latestAt < b.latestAt ? 1 : -1));
  const viewed = otherGroups
    .filter((g) => isGroupViewed(g))
    .sort((a, b) => (a.latestAt < b.latestAt ? 1 : -1));

  const myAllViewed = myStatuses.every((s) => viewedIds.has(s.id));

  if (loading && myStatuses.length === 0 && otherGroups.length === 0) {
    return (
      <SafeAreaView style={styles.safe} edges={['top']}>
        <View style={styles.header}>
          <Text style={styles.headerTitle}>Status</Text>
          <View style={styles.headerBtn} />
        </View>
        <ScrollView
          contentContainerStyle={styles.scroll}
          showsVerticalScrollIndicator={false}
        >
          <StatusSkeleton />
        </ScrollView>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      <View style={styles.header}>
        <Text style={styles.headerTitle}>Status</Text>
        <TouchableOpacity
          onPress={openCreateStatus}
          style={styles.headerBtn}
          activeOpacity={0.7}
        >
          <Ionicons name="add" size={22} color={COLORS.text} />
        </TouchableOpacity>
      </View>

      <ScrollView
        contentContainerStyle={styles.scroll}
        showsVerticalScrollIndicator={false}
        refreshControl={
          <RefreshControl
            refreshing={refreshing}
            onRefresh={onRefresh}
            tintColor={COLORS.violet}
          />
        }
      >
        <TouchableOpacity
          style={styles.myStatusRow}
          onPress={() =>
            myStatuses.length > 0
              ? openStatusViewer(myId!)
              : openCreateStatus()
          }
          activeOpacity={0.7}
        >
          <View style={styles.myStatusAvatarWrap}>
            <StatusRing
              hasStatus={myStatuses.length > 0}
              viewed={myAllViewed}
            >
              {myProfile && (
                <Avatar
                  name={myProfile.display_name}
                  color={myProfile.avatar_color}
                  avatarUrl={myProfile.avatar_url}
                  size={58}
                />
              )}
            </StatusRing>
            {myStatuses.length === 0 && (
              <TouchableOpacity
                style={styles.addBadge}
                onPress={openCreateStatus}
                activeOpacity={0.85}
              >
                <Ionicons name="add" size={13} color="#FFFFFF" />
              </TouchableOpacity>
            )}
          </View>

          <View style={styles.myStatusInfo}>
            <Text style={styles.myStatusTitle}>My Status</Text>
            <Text style={styles.myStatusSubtitle}>
              {myStatuses.length > 0
                ? `Tap to view · ${myStatuses.length} update${
                    myStatuses.length > 1 ? 's' : ''
                  }`
                : 'Tap to add a status update'}
            </Text>
          </View>

          <View style={styles.myStatusIcons}>
            <TouchableOpacity
              style={styles.iconBtn}
              onPress={openCreateStatus}
              activeOpacity={0.7}
            >
              <Ionicons
                name="text-outline"
                size={18}
                color={COLORS.violetLight}
              />
            </TouchableOpacity>
          </View>
        </TouchableOpacity>

        <View style={styles.thickDivider} />

        {recent.length > 0 && (
          <View style={styles.section}>
            <Text style={styles.sectionTitle}>Recent updates</Text>
            {recent.map((group, index) => (
              <View key={group.userId}>
                <TouchableOpacity
                  style={styles.statusRow}
                  onPress={() => openStatusViewer(group.userId)}
                  activeOpacity={0.7}
                >
                  <StatusRing hasStatus viewed={false}>
                    <Avatar
                      name={group.profile?.display_name ?? 'Unknown'}
                      color={group.profile?.avatar_color ?? COLORS.violet}
                      avatarUrl={group.profile?.avatar_url ?? null}
                      size={58}
                    />
                  </StatusRing>
                  <View style={styles.statusInfo}>
                    <View style={styles.statusNameRow}>
                      <Text style={styles.statusName} numberOfLines={1}>
                        {group.profile?.display_name ?? 'Unknown'}
                      </Text>
                      {group.profile?.verified && (
                        <VerifiedBadge size={14} />
                      )}
                    </View>
                    <Text style={styles.statusTime}>
                      {group.statuses.length > 1
                        ? `${group.statuses.length} updates · `
                        : ''}
                      {formatTime(group.latestAt)}
                    </Text>
                  </View>
                </TouchableOpacity>
                {index < recent.length - 1 && (
                  <View style={styles.separator} />
                )}
              </View>
            ))}
          </View>
        )}

        {viewed.length > 0 && (
          <View style={styles.section}>
            <Text style={styles.sectionTitle}>Viewed updates</Text>
            {viewed.map((group, index) => (
              <View key={group.userId}>
                <TouchableOpacity
                  style={styles.statusRow}
                  onPress={() => openStatusViewer(group.userId)}
                  activeOpacity={0.7}
                >
                  <StatusRing hasStatus viewed={true}>
                    <Avatar
                      name={group.profile?.display_name ?? 'Unknown'}
                      color={group.profile?.avatar_color ?? COLORS.violet}
                      avatarUrl={group.profile?.avatar_url ?? null}
                      size={58}
                    />
                  </StatusRing>
                  <View style={styles.statusInfo}>
                    <View style={styles.statusNameRow}>
                      <Text
                        style={[styles.statusName, styles.statusNameViewed]}
                        numberOfLines={1}
                      >
                        {group.profile?.display_name ?? 'Unknown'}
                      </Text>
                      {group.profile?.verified && (
                        <VerifiedBadge size={14} />
                      )}
                    </View>
                    <Text style={styles.statusTime}>
                      {group.statuses.length > 1
                        ? `${group.statuses.length} updates · `
                        : ''}
                      {formatTime(group.latestAt)}
                    </Text>
                  </View>
                </TouchableOpacity>
                {index < viewed.length - 1 && (
                  <View style={styles.separator} />
                )}
              </View>
            ))}
          </View>
        )}

        {recent.length === 0 &&
          viewed.length === 0 &&
          myStatuses.length === 0 && (
            <View style={styles.emptyWrap}>
              <View style={styles.emptyIconWrap}>
                <Ionicons
                  name="ellipse-outline"
                  size={36}
                  color={COLORS.mist}
                />
              </View>
              <Text style={styles.emptyTitle}>No status updates</Text>
              <Text style={styles.emptySubtitle}>
                When your connections post a status, it will appear here.
              </Text>
              <TouchableOpacity
                style={styles.emptyBtn}
                onPress={openCreateStatus}
                activeOpacity={0.85}
              >
                <Text style={styles.emptyBtnText}>Add your status</Text>
              </TouchableOpacity>
            </View>
          )}
      </ScrollView>
    </SafeAreaView>
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

  myStatusRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: SPACING.sm,
    paddingHorizontal: 18,
    paddingVertical: 12,
  },
  myStatusAvatarWrap: { position: 'relative' },
  addBadge: {
    position: 'absolute',
    bottom: 2,
    right: 2,
    width: 24,
    height: 24,
    borderRadius: 12,
    backgroundColor: COLORS.violet,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 2.5,
    borderColor: '#000000',
  },
  myStatusInfo: { flex: 1 },
  myStatusTitle: {
    fontSize: 16,
    fontFamily: FONTS.bodySemiBold,
    color: '#FFFFFF',
    marginBottom: 2,
  },
  myStatusSubtitle: {
    fontSize: 12.5,
    fontFamily: FONTS.body,
    color: COLORS.mist,
  },
  myStatusIcons: { flexDirection: 'row', gap: 6 },
  iconBtn: {
    width: 34,
    height: 34,
    borderRadius: 17,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(124, 92, 255, 0.1)',
  },

  thickDivider: {
    height: 1,
    backgroundColor: 'rgba(255,255,255,0.08)',
    marginHorizontal: 18,
    marginTop: SPACING.sm,
    marginBottom: SPACING.sm,
  },

  section: {
    marginTop: SPACING.sm,
  },
  sectionTitle: {
    fontSize: 11.5,
    fontFamily: FONTS.bodySemiBold,
    color: COLORS.mist,
    textTransform: 'uppercase',
    letterSpacing: 0.8,
    paddingHorizontal: 18,
    paddingBottom: SPACING.sm,
    opacity: 0.7,
  },

  statusRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: SPACING.sm,
    paddingHorizontal: 18,
    paddingVertical: 10,
  },
  statusInfo: { flex: 1, minWidth: 0 },
  statusNameRow: { flexDirection: 'row', alignItems: 'center' },
  statusName: {
    fontSize: 16,
    fontFamily: FONTS.bodySemiBold,
    color: '#FFFFFF',
    flexShrink: 1,
  },
  statusNameViewed: { color: COLORS.mistLight },
  statusTime: {
    fontSize: 12.5,
    fontFamily: FONTS.body,
    color: COLORS.mist,
    marginTop: 2,
  },

  separator: {
    height: 1,
    backgroundColor: 'rgba(255,255,255,0.05)',
    marginLeft: 88,
    marginRight: 18,
  },

  loadingWrap: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 12,
  },
  emptyWrap: {
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 30,
    paddingTop: 60,
    gap: 10,
  },
  emptyIconWrap: {
    width: 76,
    height: 76,
    borderRadius: 38,
    backgroundColor: '#121212',
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 4,
  },
  emptyTitle: {
    fontSize: 16.5,
    fontFamily: FONTS.displayBold,
    color: '#FFFFFF',
  },
  emptySubtitle: {
    fontSize: 13,
    fontFamily: FONTS.body,
    color: COLORS.mist,
    textAlign: 'center',
    lineHeight: 18,
  },
  emptyBtn: {
    marginTop: SPACING.sm,
    paddingHorizontal: 20,
    paddingVertical: 10,
    borderRadius: RADII.full,
    backgroundColor: COLORS.violet,
  },
  emptyBtnText: {
    color: '#FFFFFF',
    fontSize: 13,
    fontFamily: FONTS.bodySemiBold,
  },

  skeletonWrap: {
    paddingBottom: SPACING.lg,
  },
  skeletonRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: SPACING.sm,
    paddingHorizontal: 18,
    paddingVertical: 10,
  },
});
