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
import { Swipeable } from 'react-native-gesture-handler';
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

function stripTrailingEmoji(text: string): string {
  const emojiRegex =
    /[\u{1F300}-\u{1FAFF}\u{1F000}-\u{1F02F}\u{1F900}-\u{1F9FF}\u{2600}-\u{27BF}\u{2190}-\u{21FF}\u{2B00}-\u{2BFF}\u{FE0F}\u{200D}]+\s*$/u;
  return text.replace(emojiRegex, '').trim();
}

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

    // ✅ Notify: Request accepted
    if (myId) {
      const { data: me } = await supabase
        .from('profiles')
        .select('display_name')
        .eq('id', myId)
        .single();

      await supabase.functions.invoke('send-push', {
        body: {
          userId: req.from_user_id,
          title: 'Request accepted',
          body: `${me?.display_name || 'Someone'} accepted your connection request`,
          data: { screen: 'profile', userId: myId },
        },
      });
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

  async function deleteNotification(id: string) {
    setAppNotifs((prev) => prev.filter((n) => n.id !== id));
    await supabase.from('app_notifications').delete().eq('id', id);
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
      <View style={styles.header}>
        <TouchableOpacity
          style={styles.headerBtn}
          onPress={() => router.back()}
          activeOpacity={0.7}
        >
          <Ionicons name="chevron-back" size={24} color={COLORS.text} />
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
          <View style={{ width: 80 }} />
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
                  size={36}
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
                  size={34}
                />
                <View style={styles.cardBody}>
                  <Text style={styles.cardTitle} numberOfLines={1}>
                    <Text style={styles.bold}>
                      {p?.display_name ?? 'Someone'}
                    </Text>{' '}
                    wants to connect
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
          const bodyText = stripTrailingEmoji(n.body || '');
          const actorName = ap?.display_name || '';

          const nameIndex = actorName ? bodyText.indexOf(actorName) : -1;
          const hasName = nameIndex >= 0;

          const beforeName = hasName
            ? bodyText.slice(0, nameIndex)
            : '';
          const namePart = hasName
            ? bodyText.slice(nameIndex, nameIndex + actorName.length)
            : '';
          const afterName = hasName
            ? bodyText.slice(nameIndex + actorName.length)
            : bodyText;

          const renderRightActions = () => (
            <TouchableOpacity
              style={styles.deleteAction}
              onPress={() => deleteNotification(n.id)}
              activeOpacity={0.8}
            >
              <Ionicons name="trash-outline" size={18} color="#FFFFFF" />
            </TouchableOpacity>
          );

          return (
            <Swipeable renderRightActions={renderRightActions}>
              <TouchableOpacity
                style={styles.card}
                activeOpacity={0.75}
                onPress={() => {}}
              >
                {ap ? (
                  <Avatar
                    name={ap.display_name}
                    color={ap.avatar_color}
                    avatarUrl={ap.avatar_url}
                    size={34}
                  />
                ) : (
                  <View style={styles.iconCircle}>
                    <Ionicons
                      name="notifications"
                      size={18}
                      color={COLORS.violetLight}
                    />
                  </View>
                )}
                <View style={styles.cardBody}>
                  {hasName ? (
                    <View style={styles.cardTitleRow}>
                      {beforeName ? (
                        <Text style={styles.cardTitle}>{beforeName}</Text>
                      ) : null}
                      <Text style={[styles.cardTitle, styles.bold]}>
                        {namePart}
                      </Text>
                      {ap?.verified && (
                        <View style={styles.badgeInline}>
                          <VerifiedBadge size={12} />
                        </View>
                      )}
                      {afterName ? (
                        <Text style={styles.cardTitle}>{afterName}</Text>
                      ) : null}
                    </View>
                  ) : (
                    <View style={styles.cardTitleRow}>
                      <Text style={styles.cardTitle}>{bodyText}</Text>
                      {ap?.verified && (
                        <View style={styles.badgeInline}>
                          <VerifiedBadge size={12} />
                        </View>
                      )}
                    </View>
                  )}
                  <Text style={styles.cardSub}>
                    {formatTime(n.created_at)}
                  </Text>
                </View>
              </TouchableOpacity>
            </Swipeable>
          );
        }}
      />
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: '#000000' },
  loadingWrap: { flex: 1, alignItems: 'center', justifyContent: 'center' },

  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    paddingVertical: 10,
  },
  headerBtn: {
    width: 38,
    height: 38,
    borderRadius: 19,
    alignItems: 'center',
    justifyContent: 'center',
  },
  headerTitle: {
    fontSize: 19,
    fontFamily: FONTS.displayBold,
    color: '#FFFFFF',
  },
  markReadBtn: {
    paddingHorizontal: 10,
    paddingVertical: 6,
    minWidth: 76,
    alignItems: 'flex-end',
  },
  markReadText: {
    color: COLORS.violetLight,
    fontSize: 13.5,
    fontFamily: FONTS.bodySemiBold,
  },

  list: { paddingHorizontal: 14, paddingBottom: SPACING.lg, flexGrow: 1 },

  // ---------- Card (compact) ----------
  card: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 10,
    padding: 11,
    borderRadius: 16,
    backgroundColor: '#121212',
    borderWidth: 1,
    borderColor: '#1F1F23',
    marginBottom: 8,
  },
  iconCircle: {
    width: 34,
    height: 34,
    borderRadius: 17,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#1A1C23',
  },
  cardBody: { flex: 1, minWidth: 0 },
  cardTitleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    flexWrap: 'wrap',
  },
  badgeInline: {
    marginLeft: 3,
    marginRight: 2,
    justifyContent: 'center',
    alignItems: 'center',
  },
  cardTitle: {
    color: '#FFFFFF',
    fontSize: 13,
    fontFamily: FONTS.body,
    lineHeight: 17,
  },
  bold: { fontFamily: FONTS.bodySemiBold },
  cardSub: {
    color: COLORS.mist,
    fontSize: 11.5,
    fontFamily: FONTS.body,
    marginTop: 1,
  },
  requestActions: {
    flexDirection: 'row',
    gap: 6,
    marginTop: 7,
  },
  acceptBtn: { borderRadius: 999, overflow: 'hidden', flex: 1 },
  acceptBtnInner: {
    paddingVertical: 6,
    alignItems: 'center',
    justifyContent: 'center',
  },
  acceptText: {
    color: '#FFFFFF',
    fontSize: 12.5,
    fontFamily: FONTS.bodySemiBold,
  },
  declineBtn: {
    flex: 1,
    paddingVertical: 6,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: 999,
    borderWidth: 1,
    borderColor: '#2A2A30',
  },
  declineText: {
    color: COLORS.mistLight,
    fontSize: 12.5,
    fontFamily: FONTS.bodySemiBold,
  },

  deleteAction: {
    width: 56,
    height: '82%',
    backgroundColor: COLORS.danger,
    borderRadius: 14,
    justifyContent: 'center',
    alignItems: 'center',
    marginLeft: 6,
    marginTop: 1,
  },

  emptyWrap: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingTop: 80,
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
  emptySub: {
    fontSize: 13,
    fontFamily: FONTS.body,
    color: COLORS.mist,
    textAlign: 'center',
    paddingHorizontal: 30,
    lineHeight: 18,
  },
});
