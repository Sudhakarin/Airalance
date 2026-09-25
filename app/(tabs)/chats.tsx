// app/(tabs)/chats.tsx
// Chats list — optimized with debounced realtime, limited queries, memoized rows

import { useEffect, useState, useCallback, useRef, memo } from 'react';
import {
  View,
  Text,
  StyleSheet,
  FlatList,
  TouchableOpacity,
  RefreshControl,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { COLORS, FONTS, RADII, SPACING } from '../../constants/theme';
import { supabase } from '../../lib/supabase';
import Avatar from '../../components/Avatar';
import VerifiedBadge from '../../components/VerifiedBadge';

type OtherProfile = {
  id: string;
  username: string;
  display_name: string;
  avatar_color: string;
  avatar_url: string | null;
  verified: boolean | null;
  last_seen?: string | null;
};

type Conversation = {
  id: string;
  is_group: boolean;
  name: string | null;
  other_profile: OtherProfile | null;
  last_message: string;
  last_at: string;
  unread_count: number;
};

// Fixed row height for getItemLayout (avatar 54 + paddingVertical 12×2)
const ROW_HEIGHT = 78;

function formatTime(iso: string) {
  if (!iso) return '';
  const date = new Date(iso);
  const now = new Date();
  const diffMs = now.getTime() - date.getTime();
  const diffMin = Math.floor(diffMs / 60000);
  if (diffMin < 1) return 'now';
  if (diffMin < 60) return `${diffMin}m`;
  const diffHr = Math.floor(diffMin / 60);
  if (diffHr < 24) return `${diffHr}h`;
  const diffDay = Math.floor(diffHr / 24);
  if (diffDay < 7) return `${diffDay}d`;
  return date.toLocaleDateString();
}

// ---------- Skeleton ----------
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
        { width, height, borderRadius, backgroundColor: 'rgba(255,255,255,0.08)' },
        style,
      ]}
    />
  );
}

function ChatListSkeleton() {
  return (
    <View style={styles.skeletonWrap}>
      {[0, 1, 2, 3, 4, 5, 6].map((i) => (
        <View key={i} style={styles.skeletonRow}>
          <SkeletonBlock width={54} height={54} borderRadius={27} />
          <View style={styles.skeletonInfo}>
            <View style={styles.skeletonTop}>
              <SkeletonBlock
                width={`${45 + ((i * 13) % 25)}%`}
                height={14}
                borderRadius={5}
              />
              <SkeletonBlock width={32} height={10} borderRadius={4} />
            </View>
            <SkeletonBlock
              width={`${55 + ((i * 17) % 30)}%`}
              height={12}
              borderRadius={4}
              style={{ marginTop: 8 }}
            />
          </View>
        </View>
      ))}
    </View>
  );
}

// ---------- Memoized Chat Row with custom comparator ----------
// Comparator ensures only rows whose VISIBLE content changed re-render.
// Without it, every setConversations(newArray) would re-render all 100 rows.
const ChatRow = memo(
  function ChatRow({
    item,
    onPress,
    showSeparator,
  }: {
    item: Conversation;
    onPress: (id: string) => void;
    showSeparator: boolean;
  }) {
    const displayName = item.is_group
      ? item.name ?? 'Group'
      : item.other_profile?.display_name ?? 'Unknown';
    const color = item.other_profile?.avatar_color ?? COLORS.violet;
    const hasUnread = item.unread_count > 0;

    return (
      <View style={styles.rowContainer}>
        <TouchableOpacity
          style={styles.row}
          onPress={() => onPress(item.id)}
          activeOpacity={0.6}
        >
          <Avatar
            name={displayName}
            color={color}
            avatarUrl={item.other_profile?.avatar_url ?? null}
            size={54}
          />

          <View style={styles.rowInfo}>
            <View style={styles.rowTop}>
              <View style={styles.rowNameWrap}>
                <Text style={styles.rowName} numberOfLines={1}>
                  {displayName}
                </Text>
                {item.other_profile?.verified && <VerifiedBadge size={14} />}
              </View>
              <Text
                style={[styles.rowTime, hasUnread && styles.rowTimeUnread]}
              >
                {formatTime(item.last_at)}
              </Text>
            </View>

            <View style={styles.rowBottom}>
              <Text
                style={[styles.rowMessage, hasUnread && styles.rowMessageUnread]}
                numberOfLines={1}
              >
                {item.last_message}
              </Text>
              {hasUnread && (
                <View style={styles.unreadBadge}>
                  <Text style={styles.unreadText}>
                    {item.unread_count > 99 ? '99+' : item.unread_count}
                  </Text>
                </View>
              )}
            </View>
          </View>
        </TouchableOpacity>

        {showSeparator && <View style={styles.separator} />}
      </View>
    );
  },
  (prev, next) =>
    prev.item.id === next.item.id &&
    prev.item.last_at === next.item.last_at &&
    prev.item.last_message === next.item.last_message &&
    prev.item.unread_count === next.item.unread_count &&
    prev.item.other_profile?.display_name ===
      next.item.other_profile?.display_name &&
    prev.item.other_profile?.avatar_url ===
      next.item.other_profile?.avatar_url &&
    prev.item.other_profile?.avatar_color ===
      next.item.other_profile?.avatar_color &&
    prev.item.other_profile?.verified === next.item.other_profile?.verified &&
    prev.showSeparator === next.showSeparator
);

// ---------- Screen ----------
export default function ChatsScreen() {
  const router = useRouter();
  const [conversations, setConversations] = useState<Conversation[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [myId, setMyId] = useState<string | null>(null);

  // Refs to guard against overlapping loads & debounce realtime
  const realtimeTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const isLoadingRef = useRef(false);

  useEffect(() => {
    supabase.auth.getUser().then(({ data }) => {
      if (data.user) setMyId(data.user.id);
    });
  }, []);

  // ---------- Load conversations (optimized) ----------
  const loadConversations = useCallback(async () => {
    if (!myId) return;
    if (isLoadingRef.current) return; // prevent overlap
    isLoadingRef.current = true;

    try {
      // 1. Which conversations am I in?
      const { data: participantRows, error: pError } = await supabase
        .from('conversation_participants')
        .select('conversation_id')
        .eq('user_id', myId);

      if (pError) throw pError;

      const convoIds = (participantRows ?? []).map((r) => r.conversation_id);
      if (convoIds.length === 0) {
        setConversations([]);
        return;
      }

      // 2. Fetch everything in parallel
      const [convosRes, othersRes, unreadRes, lastMsgRes] = await Promise.all([
        supabase
          .from('conversations')
          .select('id, is_group, name')
          .in('id', convoIds),

        supabase
          .from('conversation_participants')
          .select(
            'conversation_id, user_id, profiles(id, username, display_name, avatar_color, avatar_url, verified, last_seen)'
          )
          .in('conversation_id', convoIds)
          .neq('user_id', myId),

        supabase
          .from('messages')
          .select('id, conversation_id')
          .in('conversation_id', convoIds)
          .neq('sender_id', myId)
          .is('read_at', null),

        // Only grab the most recent few per conversation — not ALL history
        supabase
          .from('messages')
          .select('conversation_id, content, message_type, created_at, is_deleted')
          .in('conversation_id', convoIds)
          .order('created_at', { ascending: false })
          .limit(Math.max(convoIds.length * 2, 40)),
      ]);

      const convos = convosRes.data ?? [];
      const otherParticipants = othersRes.data ?? [];
      const unreadRows = unreadRes.data ?? [];
      const lastMessages = lastMsgRes.data ?? [];

      // Unread counts per conversation
      const unreadCounts: Record<string, number> = {};
      for (const m of unreadRows as any[]) {
        unreadCounts[m.conversation_id] =
          (unreadCounts[m.conversation_id] || 0) + 1;
      }

      // Pick latest message per conversation from the limited set
      const lastPerConvo = new Map<string, any>();
      for (const m of lastMessages as any[]) {
        if (!lastPerConvo.has(m.conversation_id)) {
          lastPerConvo.set(m.conversation_id, m);
        }
      }

      const rows: Conversation[] = convos.map((c) => {
        const other = (otherParticipants as any[]).find(
          (p) => p.conversation_id === c.id
        );
        const last = lastPerConvo.get(c.id);

        let preview = 'Say hello 👋';
        if (last) {
          if (last.is_deleted) preview = 'This message was deleted';
          else if (last.message_type === 'image') preview = '📷 Photo';
          else if (last.message_type === 'voice') preview = '🎤 Voice message';
          else if (last.content?.startsWith('[STATUS_REPLY]'))
            preview = '↩️ Replied to your status';
          else preview = last.content || '';
        }

        return {
          id: c.id,
          is_group: c.is_group,
          name: c.name,
          other_profile: (other as any)?.profiles ?? null,
          last_message: preview,
          last_at: last?.created_at ?? '',
          unread_count: unreadCounts[c.id] ?? 0,
        };
      });

      rows.sort((a, b) => (a.last_at < b.last_at ? 1 : -1));
      setConversations(rows);
    } catch (err) {
      console.warn('Load conversations error:', err);
    } finally {
      isLoadingRef.current = false;
      setLoading(false);
      setRefreshing(false);
    }
  }, [myId]);

  useEffect(() => {
    loadConversations();
  }, [loadConversations]);

  // ---------- Debounced realtime (500ms batch) ----------
  useEffect(() => {
    if (!myId) return;

    const scheduleReload = () => {
      if (realtimeTimeoutRef.current) clearTimeout(realtimeTimeoutRef.current);
      realtimeTimeoutRef.current = setTimeout(() => {
        loadConversations();
      }, 500);
    };

    const channel = supabase
      .channel('chats-list-realtime')
      .on(
        'postgres_changes',
        { event: 'INSERT', schema: 'public', table: 'messages' },
        scheduleReload
      )
      .on(
        'postgres_changes',
        { event: 'UPDATE', schema: 'public', table: 'messages' },
        scheduleReload
      )
      .subscribe();

    return () => {
      if (realtimeTimeoutRef.current) clearTimeout(realtimeTimeoutRef.current);
      supabase.removeChannel(channel);
    };
  }, [myId, loadConversations]);

  // ---------- Handlers (stable refs for FlatList) ----------
  const onRefresh = useCallback(async () => {
    setRefreshing(true);
    await loadConversations();
  }, [loadConversations]);

  const openChat = useCallback(
    (convoId: string) => {
      router.push(`/chat/${convoId}`);
    },
    [router]
  );

  const renderItem = useCallback(
    ({ item, index }: { item: Conversation; index: number }) => (
      <ChatRow
        item={item}
        onPress={openChat}
        showSeparator={index < conversations.length - 1}
      />
    ),
    [openChat, conversations.length]
  );

  const keyExtractor = useCallback((item: Conversation) => item.id, []);

  const getItemLayout = useCallback(
    (_: any, index: number) => ({
      length: ROW_HEIGHT,
      offset: ROW_HEIGHT * index,
      index,
    }),
    []
  );

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      <View style={styles.header}>
        <Text style={styles.headerTitle}>Chats</Text>
        <TouchableOpacity
          onPress={() => router.push('/(tabs)/search')}
          style={styles.headerBtn}
          activeOpacity={0.7}
        >
          <Ionicons name="create-outline" size={20} color={COLORS.text} />
        </TouchableOpacity>
      </View>

      {loading && conversations.length === 0 ? (
        <ChatListSkeleton />
      ) : (
        <FlatList
          data={conversations}
          keyExtractor={keyExtractor}
          renderItem={renderItem}
          getItemLayout={getItemLayout}
          contentContainerStyle={styles.listContent}
          // -------- Performance props --------
          initialNumToRender={12}
          maxToRenderPerBatch={10}
          windowSize={7}
          updateCellsBatchingPeriod={50}
          removeClippedSubviews={true}
          keyboardShouldPersistTaps="handled"
          // -----------------------------------
          refreshControl={
            <RefreshControl
              refreshing={refreshing}
              onRefresh={onRefresh}
              tintColor={COLORS.violet}
              colors={[COLORS.violet]}
            />
          }
          ListEmptyComponent={
            <View style={styles.emptyWrap}>
              <View style={styles.emptyIconWrap}>
                <Ionicons
                  name="chatbubbles-outline"
                  size={44}
                  color={COLORS.mist}
                />
              </View>
              <Text style={styles.emptyTitle}>No conversations yet</Text>
              <Text style={styles.emptySubtitle}>
                Tap Search to find people and start chatting
              </Text>
              <TouchableOpacity
                style={styles.emptyBtn}
                onPress={() => router.push('/(tabs)/search')}
                activeOpacity={0.85}
              >
                <Text style={styles.emptyBtnText}>Find people</Text>
              </TouchableOpacity>
            </View>
          }
        />
      )}
    </SafeAreaView>
  );
}

// ---------- Styles ----------
const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: '#000000' },

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

  listContent: {
    paddingHorizontal: SPACING.sm,
    paddingBottom: SPACING.lg,
    flexGrow: 1,
  },

  rowContainer: {
    height: ROW_HEIGHT,
    position: 'relative',
  },
  row: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    gap: SPACING.sm,
    paddingVertical: 12,
    paddingHorizontal: SPACING.sm,
  },
  rowInfo: { flex: 1, minWidth: 0 },
  rowTop: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 4,
  },
  rowNameWrap: {
    flexDirection: 'row',
    alignItems: 'center',
    flex: 1,
    minWidth: 0,
  },
  rowName: {
    fontSize: 16.5,
    fontFamily: FONTS.bodySemiBold,
    color: '#FFFFFF',
    flexShrink: 1,
  },
  rowTime: {
    fontSize: 12,
    fontFamily: FONTS.body,
    color: COLORS.mist,
    marginLeft: 8,
  },
  rowTimeUnread: {
    color: COLORS.teal,
    fontFamily: FONTS.bodySemiBold,
  },
  rowBottom: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  rowMessage: {
    flex: 1,
    fontSize: 14.5,
    fontFamily: FONTS.body,
    color: COLORS.mist,
    marginRight: 8,
  },
  rowMessageUnread: {
    color: COLORS.text,
    fontFamily: FONTS.bodyMedium,
  },

  separator: {
    position: 'absolute',
    left: 78,
    right: 0,
    bottom: 0,
    height: 1,
    backgroundColor: 'rgba(255,255,255,0.05)',
  },

  unreadBadge: {
    minWidth: 22,
    height: 22,
    paddingHorizontal: 6,
    borderRadius: 11,
    backgroundColor: COLORS.teal,
    alignItems: 'center',
    justifyContent: 'center',
  },
  unreadText: {
    color: '#0A0C12',
    fontSize: 11,
    fontFamily: FONTS.bodySemiBold,
    lineHeight: 13,
  },

  skeletonWrap: {
    paddingHorizontal: SPACING.sm,
    paddingTop: SPACING.sm,
  },
  skeletonRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: SPACING.sm,
    paddingVertical: 12,
    paddingHorizontal: SPACING.sm,
  },
  skeletonInfo: { flex: 1, minWidth: 0 },
  skeletonTop: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },

  emptyWrap: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 30,
    paddingTop: 60,
    gap: 12,
  },
  emptyIconWrap: {
    width: 84,
    height: 84,
    borderRadius: 42,
    backgroundColor: 'rgba(255,255,255,0.04)',
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 4,
  },
  emptyTitle: {
    fontSize: 18,
    fontFamily: FONTS.displayBold,
    color: '#FFFFFF',
  },
  emptySubtitle: {
    fontSize: 14,
    fontFamily: FONTS.body,
    color: COLORS.mist,
    textAlign: 'center',
    lineHeight: 20,
  },
  emptyBtn: {
    marginTop: SPACING.sm,
    paddingHorizontal: 24,
    paddingVertical: 12,
    borderRadius: RADII.full,
    backgroundColor: COLORS.violet,
  },
  emptyBtnText: {
    color: '#FFFFFF',
    fontSize: 14.5,
    fontFamily: FONTS.bodySemiBold,
  },
});
