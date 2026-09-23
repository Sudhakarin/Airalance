// app/(tabs)/chats.tsx
// Chats list — shows all conversations with last message + unread count + skeleton

import { useEffect, useState, useCallback, useRef } from 'react';
import {
  View,
  Text,
  StyleSheet,
  FlatList,
  TouchableOpacity,
  RefreshControl,
  Animated,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter, useFocusEffect } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { COLORS, FONTS, RADII, SPACING } from '../../constants/theme';
import { supabase } from '../../lib/supabase';
import Avatar from '../../components/Avatar';
import VerifiedBadge from '../../components/VerifiedBadge';

type Conversation = {
  id: string;
  is_group: boolean;
  name: string | null;
  other_profile: {
    id: string;
    username: string;
    display_name: string;
    avatar_color: string;
    avatar_url: string | null;
    verified: boolean | null;
    last_seen?: string | null;
  } | null;
  last_message: string;
  last_at: string;
  unread_count: number;
};

// ===== Skeleton component (pulse effect) =====
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
  const opacity = useRef(new Animated.Value(0.3)).current;

  useEffect(() => {
    const loop = Animated.loop(
      Animated.sequence([
        Animated.timing(opacity, {
          toValue: 1,
          duration: 700,
          useNativeDriver: true,
        }),
        Animated.timing(opacity, {
          toValue: 0.3,
          duration: 700,
          useNativeDriver: true,
        }),
      ])
    );
    loop.start();
    return () => loop.stop();
  }, [opacity]);

  return (
    <Animated.View
      style={[
        {
          width,
          height,
          borderRadius,
          backgroundColor: 'rgba(255,255,255,0.08)',
          opacity,
        },
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
          {/* Avatar circle */}
          <SkeletonBlock width={64} height={64} borderRadius={32} />

          {/* Text placeholders */}
          <View style={styles.skeletonInfo}>
            <View style={gresstyles.skeletonTop}>
              <SkeletonBlock
                width={`${45 + ((i * 13) % 25)}%`}
                height={16}
                borderRadius={5}
              />
              <SkeletonBlock width={36} height={12} borderRadius={4} />
            </View>
            <SkeletonBlock
              width={`${55 + ((i * 17) % 30)}%`}
              height={14}
              borderRadius={4}
              style={{ marginTop: 10 }}
            />
          </View>
        </View>
      ))}
    </View>
  );
}

export default function ChatsScreen() {
  const router = useRouter();
  const [conversations, setConversations] = useState<Conversation[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [myId, setMyId] = useState<string | null>(null);

  useEffect(() => {
    supabase.auth.getUser().then(({ data }) => {
      if (data.user) setMyId(data.user.id);
    });
  }, []);

  const loadConversations = useCallback(async () => {
    if (!myId) return;

    try {
      const { data: participantRows, error: pError } = await supabase
        .from('conversation_participants')
        .select('conversation_id')
        .eq('user_id', myId);

      if (pError) throw pError;

      const convoIds = (participantRows ?? []).map((r) => r.conversation_id);
      if (convoIds.length === 0) {
        setConversations([]);
        setLoading(false);
        setRefreshing(false);
        return;
      }

      const { data: convos } = await supabase
        .from('conversations')
        .select('id, is_group, name')
        .in('id', convoIds);

      const { data: otherParticipants } = await supabase
        .from('conversation_participants')
        .select('conversation_id, user_id, profiles(*)')
        .in('conversation_id', convoIds)
        .neq('user_id', myId);

      const { data: lastMessages } = await supabase
        .from('messages')
        .select('conversation_id, content, message_type, created_at, is_deleted')
        .in('conversation_id', convoIds)
        .order('created_at', { ascending: false });

      const { data: unreadRows } = await supabase
        .from('messages')
        .select('id, conversation_id')
        .in('conversation_id', convoIds)
        .neq('sender_id', myId)
        .is('read_at', null);

      const unreadCounts: Record<string, number> = {};
      (unreadRows ?? []).forEach((m: any) => {
        unreadCounts[m.conversation_id] =
          (unreadCounts[m.conversation_id] || 0) + 1;
      });

      const rows: Conversation[] = (convos ?? []).map((c) => {
        const other = (otherParticipants ?? []).find(
          (p: any) => p.conversation_id === c.id
        );
        const last = (lastMessages ?? []).find(
          (m: any) => m.conversation_id === c.id
        );

        let preview = 'Say hello 👋';
        if (last) {
          if (last.is_deleted) preview = 'This message was deleted';
          else if (last.message_type === 'image') preview = '📷 Photo';
          else if (last.message_type === 'voice') preview = '🎤 Voice message';
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
      setLoading(false);
      setRefreshing(false);
    }
  }, [myId]);

  useEffect(() => {
    loadConversations();
  }, [loadConversations]);

  useFocusEffect(
    useCallback(() => {
      if (myId) loadConversations();
    }, [myId, loadConversations])
  );

  useEffect(() => {
    if (!myId) return;

    const channel = supabase
      .channel('chats-list-realtime')
      .on(
        'postgres_changes',
        { event: 'INSERT', schema: 'public', table: 'messages' },
        () => loadConversations()
      )
      .on(
        'post_changes',
        { event: 'UPDATE', schema: 'public', table: 'messages' },
        () => loadConversations()
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [myId, loadConversations]);

  async function onRefresh() {
    setRefreshing(true);
    await loadConversations();
  }

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

  function openChat(convoId: string) {
    router.push(`/chat/${convoId}`);
  }

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      <View style={styles.glowTop} />

      <View style={styles.header}>
        <Text style={styles.headerTitle}>Chats</Text>
        <TouchableOpacity
          onPress={() => router.push('/(tabs)/search')}
          style={styles.headerBtn}
          activeOpacity={0.7}
        >
          <Ionicons name="create-outline" size={24} color={COLORS.text} />
        </TouchableOpacity>
      </View>

      {/* Skeleton — jab tak load ho raha ho aur list khaali ho */}
      {loading && conversations.length === 0 ? (
        <ChatListSkeleton />
      ) : (
        <FlatList
          data={conversations}
          keyExtractor={(item) => item.id}
          contentContainerStyle={styles.listContent}
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
                  size={52}
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
          renderItem={({ item, index }) => {
            const displayName = item.is_group
              ? item.name ?? 'Group'
              : item.other_profile?.display_name ?? 'Unknown';
            const color = item.other_profile?.avatar_color ?? COLORS.violet;
            const hasUnread = item.unread_count > 0;

            return (
              <View>
                <TouchableOpacity
                  style={styles.row}
                  onPress={() => openChat(item.id)}
                  activeOpacity={0.6}
                >
                  <Avatar
                    name={displayName}
                    color={color}
                    avatarUrl={item.other_profile?.avatar_url ?? null}
                    size={64}
                  />

                  <View style={styles.rowInfo}>
                    <View style={styles.rowTop}>
                      <View style={styles.rowNameWrap}>
                        <Text style={styles.rowName} numberOfLines={1}>
                          {displayName}
                        </Text>
                        {item.other_profile?.verified && (
                          <VerifiedBadge size={16} />
                        )}
                      </View>
                      <Text
                        style={[
                          styles.rowTime,
                          hasUnread && styles.rowTimeUnread,
                        ]}
                      >
                        {formatTime(item.last_at)}
                      </Text>
                    </View>

                    <View style={styles.rowBottom}>
                      <Text
                        style={[
                          styles.rowMessage,
                          hasUnread && styles.rowMessageUnread,
                        ]}
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

                {index < conversations.length - 1 && (
                  <View style={styles.separator} />
                )}
              </View>
            );
          }}
        />
      )}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: '#000000' },

  glowTop: {
    position: 'absolute',
    top: -200,
    left: -100,
    width: 500,
    height: 500,
    borderRadius: 250,
    backgroundColor: 'rgba(124, 92, 255, 0.08)',
  },

  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 24,
    paddingVertical: 18,
  },
  headerTitle: {
    fontSize: 34,
    fontFamily: FONTS.displayBold,
    color: '#FFFFFF',
    letterSpacing: -0.5,
  },
  headerBtn: {
    width: 46,
    height: 46,
    borderRadius: 23,
    backgroundColor: 'rgba(255,255,255,0.05)',
    alignItems: 'center',
    justifyContent: 'center',
  },

  listContent: {
    paddingHorizontal: SPACING.md,
    paddingBottom: SPACING.xxl,
    flexGrow: 1,
  },

  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: SPACING.md,
    paddingVertical: 16,
    paddingHorizontal: SPACING.sm,
  },
  rowInfo: { flex: 1, minWidth: 0 },
  rowTop: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 6,
  },
  rowNameWrap: {
    flexDirection: 'row',
    alignItems: 'center',
    flex: 1,
    minWidth: 0,
  },
  // Row name — 18.5px (was 15.5)
  rowName: {
    fontSize: 18.5,
    fontFamily: FONTS.bodySemiBold,
    color: '#FFFFFF',
    flexShrink: 1,
  },
  // Row time — 13px (was 11)
  rowTime: {
    fontSize: 13,
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
  // Row message — 15.5px (was 13)
  rowMessage: {
    flex: 1,
    fontSize: 15.5,
    fontFamily: FONTS.body,
    color: COLORS.mist,
    marginRight: 10,
  },
  rowMessageUnread: {
    color: COLORS.text,
    fontFamily: FONTS.bodyMedium,
  },

  separator: {
    height: 1,
    backgroundColor: 'rgba(255,255,255,0.05)',
    marginLeft: 96,
    marginRight: 0,
  },

  // Unread badge — bigger
  unreadBadge: {
    minWidth: 26,
    height: 26,
    paddingHorizontal: 8,
    borderRadius: 13,
    backgroundColor: COLORS.teal,
    alignItems: 'center',
    justifyContent: 'center',
  },
  unreadText: {
    color: '#0A0C12',
    fontSize: 13,
    fontFamily: FONTS.bodySemiBold,
    lineHeight: 16,
  },

  // ===== Skeleton =====
  skeletonWrap: {
    paddingHorizontal: SPACING.md,
    paddingTop: SPACING.sm,
  },
  skeletonRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: SPACING.md,
    paddingVertical: 16,
    paddingHorizontal: SPACING.sm,
  },
  skeletonInfo: {
    flex: 1,
    minWidth: 0,
  },
  skeletonTop: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },

  emptyWrap: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 40,
    paddingTop: 80,
    gap: 14,
  },
  emptyIconWrap: {
    width: 100,
    height: 100,
    borderRadius: 50,
    backgroundColor: 'rgba(255,255,255,0.04)',
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 6,
  },
  emptyTitle: {
    fontSize: 20,
    fontFamily: FONTS.displayBold,
    color: '#FFFFFF',
  },
  emptySubtitle: {
    fontSize: 15,
    fontFamily: FONTS.body,
    color: COLORS.mist,
    textAlign: 'center',
    lineHeight: 21,
  },
  emptyBtn: {
    marginTop: SPACING.md,
    paddingHorizontal: 28,
    paddingVertical: 14,
    borderRadius: RADII.full,
    backgroundColor: COLORS.violet,
  },
  emptyBtnText: {
    color: '#FFFFFF',
    fontSize: 15.5,
    fontFamily: FONTS.bodySemiBold,
  },
});
