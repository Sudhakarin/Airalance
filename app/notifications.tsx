// app/notifications.tsx
// Notifications screen — connection requests + app notifications

import { useEffect, useState, useCallback } from 'react';
import {
  View,
  Text,
  StyleSheet,
  FlatList,
  TouchableOpacity,
  ActivityIndicator,
  RefreshControl,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { LinearGradient } from 'expo-linear-gradient';
import { COLORS, FONTS, RADII, SPACING } from '../constants/theme';
import { supabase } from '../lib/supabase';
import Avatar from '../components/Avatar';
import VerifiedBadge from '../components/VerifiedBadge';

type AppNotification = {
  id: string;
  user_id: string;
  type: string;
  title: string;
  body: string;
  actor_id: string | null;
  read: boolean | null;
  created_at: string;
  actor_profile?: {
    display_name: string;
    avatar_color: string;
    avatar_url: string | null;
    verified: boolean | null;
  } | null;
};

type ConnectionRequest = {
  id: string;
  from_user_id: string;
  to_user_id: string;
  status: string;
  created_at: string;
  from_profile?: {
    display_name: string;
    username: string;
    avatar_color: string;
    avatar_url: string | null;
  } | null;
};

export default function NotificationsScreen() {
  const router = useRouter();
  const [myId, setMyId] = useState<string | null>(null);
  const [appNotifs, setAppNotifs] = useState<AppNotification[]>([]);
  const [requests, setRequests] = useState<ConnectionRequest[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  const load = useCallback(async () => {
    const { data: authData } = await supabase.auth.getUser();
    if (!authData.user) return;
    const uid = authData.user.id;
    setMyId(uid);

    // App notifications (excluding 'message' type)
    const { data: n } = await supabase
      .from('app_notifications')
      .select(
        '*, actor_profile:profiles!app_notifications_actor_id_fkey(*)'
      )
      .eq('user_id', uid)
      .neq('type', 'message')
      .order('created_at', { ascending: false })
      .limit(50);
    setAppNotifs((n ?? []) as AppNotification[]);

    // Pending connection requests
    const { data: r } = await supabase
      .from('connection_requests')
      .select(
        '*, from_profile:profiles!connection_requests_from_user_id_fkey(*)'
      )
      .eq('to_user_id', uid)
      .eq('status', 'pending')
      .order('created_at', { ascending: false });
    setRequests((r ?? []) as ConnectionRequest[]);

    setLoading(false);
    setRefreshing(false);
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  // Realtime
  useEffect(() => {
    if (!myId) return;
    const channel = supabase
      .channel('notifs-realtime')
      .on(
        'postgres_changes',
        {
          event: '*',
          schema: 'public',
          table: 'app_notifications',
          filter: `user_id=eq.${myId}`,
        },
        () => load()
      )
      .on(
        'postgres_changes',
        {
          event: '*',
          schema: 'public',
          table: 'connection_requests',
          filter: `to_user_id=eq.${myId}`,
        },
        () => load()
      )
      .subscribe();
    return () => {
      supabase.removeChannel(channel);
    };
  }, [myId, load]);

  async function onRefresh() {
    setRefreshing(true);
    await load();
  }

  async function acceptRequest(req: ConnectionRequest) {
    await supabase
      .from('connection_requests')
      .update({ status: 'accepted' })
      .eq('id', req.id);

    // Create conversation if not exists
    const { data: mine } = await supabase
      .from('conversation_participants')
      .select('conversation_id')
      .eq('user_id', myId);
    const myIds = (mine ?? []).map((r: any) => r.conversation_id);
    let convoId: string | null = null;
    if (myIds.length > 0) {
      const { data: shared } = await supabase
        .from('conversation_participants')
        .select('conversation_id')
        .eq('user_id', req.from_user_id)
        .in('conversation_id', myIds);
      if (shared && shared.length > 0) convoId = shared[0].conversation_id;
    }
    if (!convoId && myId) {
      const { data: convo } = await supabase
        .from('conversations')
        .insert({ is_group: false, created_by: myId })
        .select()
        .single();
      if (convo) {
        convoId = convo.id;
        await supabase.from('conversation_participants').insert([
          { conversation_id: convoId, user_id: myId },
          { conversation_id: convoId, user_id: req.from_user_id },
        ]);
      }
    }

    load();
  }

  async function declineRequest(req: ConnectionRequest) {
    await supabase
      .from('connection_requests')
      .update({ status: 'declined' })
      .eq('id', req.id);
    load();
  }

  async function markAllRead() {
    if (!myId) return;
    await supabase
      .from('app_notifications')
      .update({ read: true })
      .eq('user_id', myId)
      .eq('read', false);
    load();
  }

  function formatTime(iso: string) {
    const diff = Date.now() - new Date(iso).getTime();
    const min = Math.floor(diff / 60000);
    if (min < 1) return 'just now';
    if (min < 60) return `${min}m`;
    const hr = Math.floor(min / 60);
    if (hr < 24) return `${hr}h`;
    return `${Math.floor(hr / 24)}d`;
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

  const isEmpty = requests.length === 0 && appNotifs.length === 0;

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
        <Text style={styles.headerTitle}>Notifications</Text>
        {appNotifs.some((n) => !n.read) ? (
          <TouchableOpacity
            style={styles.markReadBtn}
            onPress={markAllRead}
            activeOpacity={0.7}
          >
            <Text style={styles.markReadText}>Mark all</Text>
          </TouchableOpacity>
        ) : (
          <View style={{ width: 60 }} />
        )}
      </View>

      <FlatList
        data={[
          ...requests.map((r) => ({ kind: 'request' as const, item: r })),
          ...appNotifs.map((n) => ({ kind: 'app' as const, item: n })),
        ]}
        keyExtractor={(entry, i) =>
          entry.kind === 'request'
            ? `req-${entry.item.id}`
            : `app-${entry.item.id}-${i}`
        }
        contentContainerStyle={styles.list}
        refreshControl={
          <RefreshControl
            refreshing={refreshing}
            onRefresh={onRefresh}
            tintColor={COLORS.violet}
          />
        }
        ListEmptyComponent={
          isEmpty ? (
            <View style={styles.emptyWrap}>
              <View style={styles.emptyIconWrap}>
                <Ionicons
                  name="notifications-outline"
                  size={40}
                  color={COLORS.mist}
                />
              </View>
              <Text style={styles.emptyTitle}>All caught up</Text>
              <Text style={styles.emptySub}>
                You don't have any new notifications.
              </Text>
            </View>
          ) : null
        }
        renderItem={({ item: entry }) => {
          if (entry.kind === 'request') {
            const req = entry.item;
            const p = req.from_profile;
            return (
              <View style={styles.card}>
                <Avatar
                  name={p?.display_name ?? 'User'}
                  color={p?.avatar_color ?? COLORS.violet}
                  avatarUrl={p?.avatar_url ?? null}
                  size={44}
                />
                <View style={styles.cardBody}>
                  <Text style={styles.cardTitle}>
                    <Text style={styles.bold}>
                      {p?.display_name ?? 'Someone'}
                    </Text>{' '}
                    wants to connect with you
                  </Text>
                  <Text style={styles.cardSub}>@{p?.username}</Text>
                  <View style={styles.requestActions}>
                    <TouchableOpacity
                      style={styles.acceptBtn}
                      onPress={() => acceptRequest(req)}
                      activeOpacity={0.85}
                    >
                      <LinearGradient
                        colors={['#9C82FF', '#7C5CFF']}
                        start={{ x: 0, y: 0 }}
                        end={{ x: 1, y: 1 }}
                        style={styles.acceptBtnInner}
                      >
                        <Text style={styles.acceptText}>Accept</Text>
                      </LinearGradient>
                    </TouchableOpacity>
                    <TouchableOpacity
                      style={styles.declineBtn}
                      onPress={() => declineRequest(req)}
                      activeOpacity={0.85}
                    >
                      <Text style={styles.declineText}>Leave</Text>
                    </TouchableOpacity>
                  </View>
                </View>
              </View>
            );
          }

          const n = entry.item;
          const ap = n.actor_profile;
          return (
            <TouchableOpacity
              style={styles.card}
              activeOpacity={0.75}
              onPress={() => {}}
            >
              {n.type === 'verified' ? (
                <View style={[styles.iconCircle, { backgroundColor: 'rgba(124,92,255,0.18)' }]}>
                  <VerifiedBadge size={24} />
                </View>
              ) : n.type === 'status_like' ? (
                <View style={[styles.iconCircle, { backgroundColor: 'rgba(239,68,68,0.18)' }]}>
                  <Ionicons name="heart" size={22} color="#EF4444" />
                </View>
              ) : n.type === 'follow' ? (
                <View style={[styles.iconCircle, { backgroundColor: 'rgba(34,211,184,0.18)' }]}>
                  <Ionicons name="person-add" size={22} color={COLORS.teal} />
                </View>
              ) : ap ? (
                <Avatar
                  name={ap.display_name}
                  color={ap.avatar_color}
                  avatarUrl={ap.avatar_url}
                  size={44}
                />
              ) : (
                <View style={styles.iconCircle}>
                  <Ionicons name="notifications" size={22} color={COLORS.violetLight} />
                </View>
              )}
              <View style={styles.cardBody}>
                <Text style={styles.cardTitle}>{n.body}</Text>
                <Text style={styles.cardSub}>{formatTime(n.created_at)}</Text>
              </View>
            </TouchableOpacity>
          );
        }}
      />
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: COLORS.ink900 },
  loadingWrap: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  glowTop: {
    position: 'absolute',
    top: -200,
    left: -100,
    width: 500,
    height: 500,
    borderRadius: 250,
    backgroundColor: 'rgba(124,92,255,0.10)',
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
  markReadBtn: {
    paddingHorizontal: 12,
    paddingVertical: 8,
    minWidth: 60,
    alignItems: 'flex-end',
  },
  markReadText: {
    color: COLORS.violetLight,
    fontSize: 13,
    fontFamily: FONTS.bodySemiBold,
  },

  list: { paddingHorizontal: SPACING.md, paddingBottom: SPACING.xxl, flexGrow: 1 },

  card: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: SPACING.md,
    padding: SPACING.md,
    borderRadius: RADII.xl,
    backgroundColor: 'rgba(255,255,255,0.04)',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.06)',
    marginBottom: 10,
  },
  iconCircle: {
    width: 44,
    height: 44,
    borderRadius: 22,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(255,255,255,0.06)',
  },
  cardBody: { flex: 1, minWidth: 0 },
  cardTitle: {
    color: '#FFFFFF',
    fontSize: 14,
    fontFamily: FONTS.body,
    lineHeight: 19,
  },
  bold: { fontFamily: FONTS.bodySemiBold },
  cardSub: {
    color: COLORS.mist,
    fontSize: 12,
    fontFamily: FONTS.body,
    marginTop: 3,
  },
  requestActions: {
    flexDirection: 'row',
    gap: 8,
    marginTop: 10,
  },
  acceptBtn: { borderRadius: 999, overflow: 'hidden', flex: 1 },
  acceptBtnInner: {
    paddingVertical: 8,
    alignItems: 'center',
    justifyContent: 'center',
  },
  acceptText: {
    color: '#FFFFFF',
    fontSize: 13,
    fontFamily: FONTS.bodySemiBold,
  },
  declineBtn: {
    flex: 1,
    paddingVertical: 8,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: 999,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.10)',
  },
  declineText: {
    color: COLORS.mistLight,
    fontSize: 13,
    fontFamily: FONTS.bodySemiBold,
  },

  emptyWrap: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingTop: 100,
    gap: 10,
  },
  emptyIconWrap: {
    width: 88,
    height: 88,
    borderRadius: 44,
    backgroundColor: 'rgba(255,255,255,0.04)',
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 4,
  },
  emptyTitle: {
    fontSize: 17,
    fontFamily: FONTS.displayBold,
    color: '#FFFFFF',
  },
  emptySub: {
    fontSize: 13,
    fontFamily: FONTS.body,
    color: COLORS.mist,
    textAlign: 'center',
    paddingHorizontal: 40,
  },
});
