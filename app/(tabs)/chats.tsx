// app/(tabs)/chats.tsx
// Chats list — long press actions, mute, lock, block, WhatsApp-style

import { useEffect, useState, useCallback, useRef, memo } from 'react';
import {
  View,
  Text,
  StyleSheet,
  FlatList,
  TouchableOpacity,
  RefreshControl,
  Modal,
  Pressable,
  TextInput,
  Alert,
  Platform,
  KeyboardAvoidingView,
} from 'react-native';
import { BlurView } from 'expo-blur';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import AsyncStorage from '@react-native-async-storage/async-storage';
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
  is_muted?: boolean;
  is_locked?: boolean;
};

type ChatSetting = {
  conversation_id: string;
  is_muted: boolean;
  is_locked: boolean;
};

const ROW_HEIGHT = 78;

function pinKey(userId: string) {
  return `chat_lock_pin:${userId}`;
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

// ---------- Chat Row ----------
const ChatRow = memo(
  function ChatRow({
    item,
    onPress,
    onLongPress,
    showSeparator,
    locked = false,
  }: {
    item: Conversation;
    onPress: (id: string) => void;
    onLongPress: (convo: Conversation) => void;
    showSeparator: boolean;
    locked?: boolean;
  }) {
    const displayName = locked
      ? 'Locked chat'
      : item.is_group
      ? item.name ?? 'Group'
      : item.other_profile?.display_name ?? 'Unknown';
    const color = locked
      ? '#3A3F4C'
      : item.other_profile?.avatar_color ?? COLORS.violet;
    const hasUnread = item.unread_count > 0;
    const showUnread = hasUnread && !item.is_muted;

    return (
      <View style={styles.rowContainer}>
        <TouchableOpacity
          style={styles.row}
          onPress={() => onPress(item.id)}
          onLongPress={() => onLongPress(item)}
          delayLongPress={350}
          activeOpacity={0.6}
        >
          {locked ? (
            <View style={styles.lockedAvatar}>
              <Ionicons name="lock-closed" size={22} color="#FFFFFF" />
            </View>
          ) : (
            <Avatar
              name={displayName}
              color={color}
              avatarUrl={item.other_profile?.avatar_url ?? null}
              size={54}
            />
          )}

          <View style={styles.rowInfo}>
            <View style={styles.rowTop}>
              <View style={styles.rowNameWrap}>
                <Text style={styles.rowName} numberOfLines={1}>
                  {displayName}
                </Text>
                {!locked && item.other_profile?.verified && (
                  <VerifiedBadge size={14} />
                )}
                {!locked && item.is_muted && (
                  <Ionicons
                    name="volume-mute"
                    size={14}
                    color={COLORS.mist}
                    style={{ marginLeft: 6 }}
                  />
                )}
              </View>
              <Text
                style={[
                  styles.rowTime,
                  showUnread && styles.rowTimeUnread,
                ]}
              >
                {formatTime(item.last_at)}
              </Text>
            </View>

            <View style={styles.rowBottom}>
              <Text
                style={[
                  styles.rowMessage,
                  showUnread && styles.rowMessageUnread,
                ]}
                numberOfLines={1}
              >
                {locked ? 'Tap to unlock' : item.last_message}
              </Text>
              {showUnread && (
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
    prev.item.is_muted === next.item.is_muted &&
    prev.item.other_profile?.display_name ===
      next.item.other_profile?.display_name &&
    prev.item.other_profile?.avatar_url ===
      next.item.other_profile?.avatar_url &&
    prev.item.other_profile?.avatar_color ===
      next.item.other_profile?.avatar_color &&
    prev.item.other_profile?.verified === next.item.other_profile?.verified &&
    prev.showSeparator === next.showSeparator &&
    prev.locked === next.locked
);

// ---------- Screen ----------
export default function ChatsScreen() {
  const router = useRouter();
  const [conversations, setConversations] = useState<Conversation[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [myId, setMyId] = useState<string | null>(null);

  // Action / modal states
  const [actionSheetConvo, setActionSheetConvo] = useState<Conversation | null>(
    null
  );
  const [deleteConfirmConvo, setDeleteConfirmConvo] =
    useState<Conversation | null>(null);
  const [blockConfirmConvo, setBlockConfirmConvo] =
    useState<Conversation | null>(null);

  // Lock / PIN
  const [pinSetupConvo, setPinSetupConvo] = useState<Conversation | null>(null);
  const [pinInput1, setPinInput1] = useState('');
  const [pinInput2, setPinInput2] = useState('');
  const [pinError, setPinError] = useState('');
  const [pinModalVisible, setPinModalVisible] = useState(false);
  const [pinVerifyInput, setPinVerifyInput] = useState('');
  const [pinVerifyError, setPinVerifyError] = useState('');
  const [storedPin, setStoredPin] = useState<string | null>(null);

  // Locked chats view (session only)
  const [lockedViewOpen, setLockedViewOpen] = useState(false);

  const realtimeTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const isLoadingRef = useRef(false);

  useEffect(() => {
    supabase.auth.getUser().then(({ data }) => {
      if (data.user) setMyId(data.user.id);
    });
  }, []);

  useEffect(() => {
    if (!myId) return;
    (async () => {
      try {
        const saved = await AsyncStorage.getItem(pinKey(myId));
        setStoredPin(saved);
      } catch {}
    })();
  }, [myId]);

  // ---------- Load conversations ----------
  const loadConversations = useCallback(async () => {
    if (!myId) return;
    if (isLoadingRef.current) return;
    isLoadingRef.current = true;

    try {
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

      const [convosRes, othersRes, unreadRes, lastMsgRes, settingsRes] =
        await Promise.all([
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

          supabase
            .from('messages')
            .select('conversation_id, content, message_type, created_at, is_deleted')
            .in('conversation_id', convoIds)
            .order('created_at', { ascending: false })
            .limit(Math.max(convoIds.length * 2, 40)),

          supabase
            .from('chat_settings')
            .select('conversation_id, is_muted, is_locked')
            .eq('user_id', myId)
            .in('conversation_id', convoIds),
        ]);

      const convos = convosRes.data ?? [];
      const otherParticipants = othersRes.data ?? [];
      const unreadRows = unreadRes.data ?? [];
      const lastMessages = lastMsgRes.data ?? [];
      const settings = (settingsRes.data ?? []) as ChatSetting[];

      const settingsMap: Record<string, ChatSetting> = {};
      for (const s of settings) settingsMap[s.conversation_id] = s;

      const unreadCounts: Record<string, number> = {};
      for (const m of unreadRows as any[]) {
        unreadCounts[m.conversation_id] =
          (unreadCounts[m.conversation_id] || 0) + 1;
      }

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
        const setting = settingsMap[c.id];

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
          is_muted: setting?.is_muted ?? false,
          is_locked: setting?.is_locked ?? false,
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

  // ---------- Realtime ----------
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
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'chat_settings' },
        scheduleReload
      )
      .subscribe();

    return () => {
      if (realtimeTimeoutRef.current) clearTimeout(realtimeTimeoutRef.current);
      supabase.removeChannel(channel);
    };
  }, [myId, loadConversations]);

  // ---------- Derived lists ----------
  const unlockedConversations = conversations.filter((c) => !c.is_locked);
  const lockedConversations = conversations.filter((c) => c.is_locked);

  // ---------- Handlers ----------
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

  const openLockedChat = useCallback(
    (convoId: string) => {
      setLockedViewOpen(false);
      router.push(`/chat/${convoId}`);
    },
    [router]
  );

  async function deleteConversation(convoId: string) {
    setDeleteConfirmConvo(null);
    setConversations((prev) => prev.filter((c) => c.id !== convoId));

    try {
      await supabase
        .from('conversation_participants')
        .delete()
        .eq('conversation_id', convoId)
        .eq('user_id', myId);
      await supabase
        .from('chat_settings')
        .delete()
        .eq('conversation_id', convoId)
        .eq('user_id', myId);
    } catch (err) {
      console.warn('Delete failed:', err);
      Alert.alert('Delete failed', 'Please try again.');
      loadConversations();
    }
  }

  async function toggleMute(convo: Conversation) {
    if (!myId) return;
    setActionSheetConvo(null);
    const nextMuted = !convo.is_muted;

    setConversations((prev) =>
      prev.map((c) =>
        c.id === convo.id ? { ...c, is_muted: nextMuted } : c
      )
    );

    try {
      const { error } = await supabase.from('chat_settings').upsert(
        {
          user_id: myId,
          conversation_id: convo.id,
          is_muted: nextMuted,
          is_locked: convo.is_locked ?? false,
        },
        { onConflict: 'user_id,conversation_id' }
      );
      if (error) throw error;
    } catch (err) {
      console.warn('Mute failed:', err);
      setConversations((prev) =>
        prev.map((c) =>
          c.id === convo.id ? { ...c, is_muted: !nextMuted } : c
        )
      );
      Alert.alert('Failed', 'Could not update mute.');
    }
  }

  function startLockFlow(convo: Conversation) {
    setActionSheetConvo(null);
    if (convo.is_locked) {
      unlockChat(convo);
      return;
    }
    if (!storedPin) {
      setPinSetupConvo(convo);
      setPinInput1('');
      setPinInput2('');
      setPinError('');
      return;
    }
    applyLock(convo.id, true);
  }

  async function applyLock(convoId: string, lock: boolean) {
    if (!myId) return;
    try {
      const convo = conversations.find((c) => c.id === convoId);
      const { error } = await supabase.from('chat_settings').upsert(
        {
          user_id: myId,
          conversation_id: convoId,
          is_locked: lock,
          is_muted: convo?.is_muted ?? false,
        },
        { onConflict: 'user_id,conversation_id' }
      );
      if (error) throw error;
      setConversations((prev) =>
        prev.map((c) => (c.id === convoId ? { ...c, is_locked: lock } : c))
      );
    } catch (err) {
      console.warn('Lock failed:', err);
      Alert.alert('Failed', 'Could not update lock.');
    }
  }

  async function unlockChat(convo: Conversation) {
    await applyLock(convo.id, false);
  }

  async function confirmPinSetup() {
    if (!pinSetupConvo || !myId) return;
    if (pinInput1.length !== 4) {
      setPinError('PIN must be 4 digits');
      return;
    }
    if (pinInput1 !== pinInput2) {
      setPinError('PINs do not match');
      return;
    }
    try {
      await AsyncStorage.setItem(pinKey(myId), pinInput1);
      setStoredPin(pinInput1);
      const targetId = pinSetupConvo.id;
      setPinSetupConvo(null);
      setPinInput1('');
      setPinInput2('');
      setPinError('');
      await applyLock(targetId, true);
    } catch (err) {
      setPinError('Could not save PIN');
    }
  }

  function openLockedSection() {
    if (lockedConversations.length === 0) return;
    setPinVerifyInput('');
    setPinVerifyError('');
    setPinModalVisible(true);
  }

  function confirmPinVerify() {
    if (!storedPin) {
      setPinModalVisible(false);
      return;
    }
    if (pinVerifyInput === storedPin) {
      setPinModalVisible(false);
      setPinVerifyInput('');
      setPinVerifyError('');
      setLockedViewOpen(true);
    } else {
      setPinVerifyError('Incorrect PIN');
    }
  }

  async function blockUser(convo: Conversation) {
    if (!myId) return;
    const targetUserId = convo.other_profile?.id;
    if (!targetUserId) {
      Alert.alert('Cannot block', 'This is not a 1:1 chat.');
      setBlockConfirmConvo(null);
      return;
    }
    setBlockConfirmConvo(null);
    try {
      await supabase
        .from('blocked_users')
        .insert({ blocker_id: myId, blocked_id: targetUserId });

      await supabase
        .from('conversation_participants')
        .delete()
        .eq('conversation_id', convo.id)
        .eq('user_id', myId);

      await supabase
        .from('chat_settings')
        .delete()
        .eq('conversation_id', convo.id)
        .eq('user_id', myId);

      setConversations((prev) => prev.filter((c) => c.id !== convo.id));
      Alert.alert('Blocked', `@${convo.other_profile?.username} has been blocked.`);
    } catch (err) {
      console.warn('Block failed:', err);
      Alert.alert('Failed', 'Could not block.');
      loadConversations();
    }
  }

  // ---------- Rendering ----------
  const renderItem = useCallback(
    ({ item, index }: { item: Conversation; index: number }) => (
      <ChatRow
        item={item}
        onPress={openChat}
        onLongPress={setActionSheetConvo}
        showSeparator={index < unlockedConversations.length - 1}
      />
    ),
    [openChat, unlockedConversations.length]
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

  const listHeader = useCallback(() => {
    if (lockedConversations.length === 0) return null;
    return (
      <TouchableOpacity
        style={styles.lockedFolder}
        onPress={openLockedSection}
        activeOpacity={0.75}
      >
        <View style={styles.lockedFolderIcon}>
          <Ionicons name="lock-closed" size={22} color="#FFFFFF" />
        </View>
        <View style={{ flex: 1, minWidth: 0 }}>
          <Text style={styles.lockedFolderTitle}>Locked chats</Text>
          <Text style={styles.lockedFolderSub}>
            {lockedConversations.length}{' '}
            {lockedConversations.length === 1 ? 'chat' : 'chats'} · Tap to unlock
          </Text>
        </View>
        <Ionicons
          name="chevron-forward"
          size={18}
          color="rgba(255,255,255,0.4)"
        />
      </TouchableOpacity>
    );
  }, [lockedConversations.length]);

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
          data={unlockedConversations}
          keyExtractor={keyExtractor}
          renderItem={renderItem}
          getItemLayout={getItemLayout}
          ListHeaderComponent={listHeader}
          contentContainerStyle={styles.listContent}
          initialNumToRender={12}
          maxToRenderPerBatch={10}
          windowSize={7}
          updateCellsBatchingPeriod={50}
          removeClippedSubviews={true}
          keyboardShouldPersistTaps="handled"
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

      {/* ========== ACTION MENU (long press, centered + blur) ========== */}
      <Modal
        visible={!!actionSheetConvo}
        transparent
        animationType="fade"
        onRequestClose={() => setActionSheetConvo(null)}
        statusBarTranslucent
      >
        <BlurView intensity={40} tint="dark" style={styles.blurBackdrop}>
          <Pressable
            style={styles.backdropPress}
            onPress={() => setActionSheetConvo(null)}
          >
            <Pressable
              style={styles.dialogCard}
              onPress={(e) => e.stopPropagation()}
            >
              {actionSheetConvo && (
                <View style={styles.dialogHeader}>
                  <Avatar
                    name={
                      actionSheetConvo.other_profile?.display_name ?? 'Unknown'
                    }
                    color={
                      actionSheetConvo.other_profile?.avatar_color ??
                      COLORS.violet
                    }
                    avatarUrl={
                      actionSheetConvo.other_profile?.avatar_url ?? null
                    }
                    size={48}
                  />
                  <View style={{ flex: 1, minWidth: 0 }}>
                    <Text style={styles.dialogHeaderName} numberOfLines={1}>
                      {actionSheetConvo.other_profile?.display_name ?? 'Chat'}
                    </Text>
                    <Text style={styles.dialogHeaderSub}>
                      @{actionSheetConvo.other_profile?.username}
                    </Text>
                  </View>
                </View>
              )}

              <ActionRow
                icon="trash-outline"
                label="Delete"
                danger
                onPress={() =>
                  actionSheetConvo &&
                  (setDeleteConfirmConvo(actionSheetConvo),
                  setActionSheetConvo(null))
                }
              />
              <ActionRow
                icon={
                  actionSheetConvo?.is_muted
                    ? 'volume-high-outline'
                    : 'volume-mute-outline'
                }
                label={actionSheetConvo?.is_muted ? 'Unmute' : 'Mute'}
                onPress={() => actionSheetConvo && toggleMute(actionSheetConvo)}
              />
              <ActionRow
                icon={
                  actionSheetConvo?.is_locked
                    ? 'lock-open-outline'
                    : 'lock-closed-outline'
                }
                label={
                  actionSheetConvo?.is_locked ? 'Unlock chat' : 'Lock chat'
                }
                onPress={() =>
                  actionSheetConvo && startLockFlow(actionSheetConvo)
                }
              />
              <ActionRow
                icon="ban-outline"
                label="Block"
                danger
                onPress={() =>
                  actionSheetConvo &&
                  (setBlockConfirmConvo(actionSheetConvo),
                  setActionSheetConvo(null))
                }
              />
            </Pressable>
          </Pressable>
        </BlurView>
      </Modal>

      {/* ========== DELETE CONFIRM ========== */}
      <Modal
        visible={!!deleteConfirmConvo}
        transparent
        animationType="fade"
        onRequestClose={() => setDeleteConfirmConvo(null)}
        statusBarTranslucent
      >
        <BlurView intensity={40} tint="dark" style={styles.blurBackdrop}>
          <Pressable
            style={styles.backdropPress}
            onPress={() => setDeleteConfirmConvo(null)}
          >
            <Pressable
              style={styles.dialogCard}
              onPress={(e) => e.stopPropagation()}
            >
              <View style={styles.dialogIconWrap}>
                <Ionicons
                  name="trash-outline"
                  size={26}
                  color={COLORS.danger}
                />
              </View>
              <Text style={styles.dialogTitle}>Delete this chat?</Text>
              <Text style={styles.dialogSub}>
                This will remove the chat from your list. The other person will
                still see the conversation.
              </Text>
              <View style={styles.dialogButtons}>
                <TouchableOpacity
                  style={styles.dialogBtnSecondary}
                  onPress={() => setDeleteConfirmConvo(null)}
                  activeOpacity={0.75}
                >
                  <Text style={styles.dialogBtnSecondaryText}>Cancel</Text>
                </TouchableOpacity>
                <TouchableOpacity
                  style={styles.dialogBtnDanger}
                  onPress={() =>
                    deleteConfirmConvo &&
                    deleteConversation(deleteConfirmConvo.id)
                  }
                  activeOpacity={0.75}
                >
                  <Text style={styles.dialogBtnPrimaryText}>Delete</Text>
                </TouchableOpacity>
              </View>
            </Pressable>
          </Pressable>
        </BlurView>
      </Modal>

      {/* ========== BLOCK CONFIRM ========== */}
      <Modal
        visible={!!blockConfirmConvo}
        transparent
        animationType="fade"
        onRequestClose={() => setBlockConfirmConvo(null)}
        statusBarTranslucent
      >
        <BlurView intensity={40} tint="dark" style={styles.blurBackdrop}>
          <Pressable
            style={styles.backdropPress}
            onPress={() => setBlockConfirmConvo(null)}
          >
            <Pressable
              style={styles.dialogCard}
              onPress={(e) => e.stopPropagation()}
            >
              <View style={[styles.dialogIconWrap, { backgroundColor: 'rgba(239,68,68,0.15)' }]}>
                <Ionicons name="ban" size={26} color={COLORS.danger} />
              </View>
              <Text style={styles.dialogTitle}>
                Block @{blockConfirmConvo?.other_profile?.username}?
              </Text>
              <Text style={styles.dialogSub}>
                They won't be able to message you. This chat will be removed.
              </Text>
              <View style={styles.dialogButtons}>
                <TouchableOpacity
                  style={styles.dialogBtnSecondary}
                  onPress={() => setBlockConfirmConvo(null)}
                  activeOpacity={0.75}
                >
                  <Text style={styles.dialogBtnSecondaryText}>Cancel</Text>
                </TouchableOpacity>
                <TouchableOpacity
                  style={styles.dialogBtnDanger}
                  onPress={() =>
                    blockConfirmConvo && blockUser(blockConfirmConvo)
                  }
                  activeOpacity={0.75}
                >
                  <Text style={styles.dialogBtnPrimaryText}>Block</Text>
                </TouchableOpacity>
              </View>
            </Pressable>
          </Pressable>
        </BlurView>
      </Modal>

      {/* ========== PIN SETUP (centered + blur + keyboard safe) ========== */}
      <Modal
        visible={!!pinSetupConvo}
        transparent
        animationType="fade"
        onRequestClose={() => setPinSetupConvo(null)}
        statusBarTranslucent
      >
        <BlurView intensity={40} tint="dark" style={styles.blurBackdrop}>
          <KeyboardAvoidingView
            behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
            style={styles.keyboardAvoid}
          >
            <Pressable
              style={styles.backdropPress}
              onPress={() => setPinSetupConvo(null)}
            >
              <Pressable
                style={styles.dialogCard}
                onPress={(e) => e.stopPropagation()}
              >
                <View style={styles.dialogIconWrap}>
                  <Ionicons
                    name="lock-closed"
                    size={26}
                    color={COLORS.violetLight}
                  />
                </View>
                <Text style={styles.dialogTitle}>Set a chat lock PIN</Text>
                <Text style={styles.dialogSub}>
                  Enter a 4-digit PIN. You'll need it every time you open
                  locked chats.
                </Text>

                <TextInput
                  style={styles.pinInput}
                  value={pinInput1}
                  onChangeText={(t) =>
                    setPinInput1(t.replace(/\D/g, '').slice(0, 4))
                  }
                  placeholder="Enter 4-digit PIN"
                  placeholderTextColor="rgba(255,255,255,0.3)"
                  keyboardType="number-pad"
                  secureTextEntry
                  maxLength={4}
                />

                <TextInput
                  style={styles.pinInput}
                  value={pinInput2}
                  onChangeText={(t) =>
                    setPinInput2(t.replace(/\D/g, '').slice(0, 4))
                  }
                  placeholder="Confirm PIN"
                  placeholderTextColor="rgba(255,255,255,0.3)"
                  keyboardType="number-pad"
                  secureTextEntry
                  maxLength={4}
                />

                {!!pinError && (
                  <Text style={styles.pinError}>{pinError}</Text>
                )}

                <View style={styles.dialogButtons}>
                  <TouchableOpacity
                    style={styles.dialogBtnSecondary}
                    onPress={() => setPinSetupConvo(null)}
                    activeOpacity={0.75}
                  >
                    <Text style={styles.dialogBtnSecondaryText}>Cancel</Text>
                  </TouchableOpacity>
                  <TouchableOpacity
                    style={styles.dialogBtnPrimary}
                    onPress={confirmPinSetup}
                    activeOpacity={0.75}
                  >
                    <Text style={styles.dialogBtnPrimaryText}>Save & Lock</Text>
                  </TouchableOpacity>
                </View>
              </Pressable>
            </Pressable>
          </KeyboardAvoidingView>
        </BlurView>
      </Modal>

      {/* ========== PIN VERIFY (centered + blur + keyboard safe) ========== */}
      <Modal
        visible={pinModalVisible}
        transparent
        animationType="fade"
        onRequestClose={() => setPinModalVisible(false)}
        statusBarTranslucent
      >
        <BlurView intensity={40} tint="dark" style={styles.blurBackdrop}>
          <KeyboardAvoidingView
            behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
            style={styles.keyboardAvoid}
          >
            <Pressable
              style={styles.backdropPress}
              onPress={() => setPinModalVisible(false)}
            >
              <Pressable
                style={styles.dialogCard}
                onPress={(e) => e.stopPropagation()}
              >
                <View style={styles.dialogIconWrap}>
                  <Ionicons
                    name="lock-closed"
                    size={26}
                    color={COLORS.violetLight}
                  />
                </View>
                <Text style={styles.dialogTitle}>Enter your PIN</Text>
                <Text style={styles.dialogSub}>
                  Unlock to view your locked chats.
                </Text>

                <TextInput
                  style={styles.pinInput}
                  value={pinVerifyInput}
                  onChangeText={(t) =>
                    setPinVerifyInput(t.replace(/\D/g, '').slice(0, 4))
                  }
                  placeholder="4-digit PIN"
                  placeholderTextColor="rgba(255,255,255,0.3)"
                  keyboardType="number-pad"
                  secureTextEntry
                  maxLength={4}
                  autoFocus
                />

                {!!pinVerifyError && (
                  <Text style={styles.pinError}>{pinVerifyError}</Text>
                )}

                <View style={styles.dialogButtons}>
                  <TouchableOpacity
                    style={styles.dialogBtnSecondary}
                    onPress={() => setPinModalVisible(false)}
                    activeOpacity={0.75}
                  >
                    <Text style={styles.dialogBtnSecondaryText}>Cancel</Text>
                  </TouchableOpacity>
                  <TouchableOpacity
                    style={styles.dialogBtnPrimary}
                    onPress={confirmPinVerify}
                    activeOpacity={0.75}
                  >
                    <Text style={styles.dialogBtnPrimaryText}>Unlock</Text>
                  </TouchableOpacity>
                </View>
              </Pressable>
            </Pressable>
          </KeyboardAvoidingView>
        </BlurView>
      </Modal>

      {/* ========== LOCKED CHATS VIEW (session only) ========== */}
      <Modal
        visible={lockedViewOpen}
        transparent={false}
        animationType="slide"
        onRequestClose={() => setLockedViewOpen(false)}
      >
        <SafeAreaView style={styles.lockedViewSafe} edges={['top', 'bottom']}>
          <View style={styles.lockedViewHeader}>
            <TouchableOpacity
              style={styles.lockedViewClose}
              onPress={() => setLockedViewOpen(false)}
              activeOpacity={0.7}
            >
              <Ionicons name="close" size={24} color="#FFFFFF" />
            </TouchableOpacity>
            <Text style={styles.lockedViewTitle}>Locked chats</Text>
            <View style={{ width: 40 }} />
          </View>

          <FlatList
            data={lockedConversations}
            keyExtractor={keyExtractor}
            contentContainerStyle={styles.listContent}
            renderItem={({ item, index }) => (
              <ChatRow
                item={item}
                onPress={openLockedChat}
                onLongPress={setActionSheetConvo}
                showSeparator={index < lockedConversations.length - 1}
              />
            )}
            ListEmptyComponent={
              <View style={styles.emptyWrap}>
                <Text style={styles.emptyTitle}>No locked chats</Text>
              </View>
            }
          />
        </SafeAreaView>
      </Modal>
    </SafeAreaView>
  );
}

// ---------- ActionRow ----------
function ActionRow({
  icon,
  label,
  onPress,
  danger,
}: {
  icon: any;
  label: string;
  onPress: () => void;
  danger?: boolean;
}) {
  return (
    <TouchableOpacity
      style={styles.actionRow}
      onPress={onPress}
      activeOpacity={0.7}
    >
      <Ionicons
        name={icon}
        size={22}
        color={danger ? COLORS.danger : '#FFFFFF'}
      />
      <Text
        style={[styles.actionLabel, danger && { color: COLORS.danger }]}
      >
        {label}
      </Text>
    </TouchableOpacity>
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

  lockedFolder: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    paddingHorizontal: 12,
    paddingVertical: 12,
    marginBottom: 6,
    borderRadius: 14,
    backgroundColor: 'rgba(124,92,255,0.08)',
    borderWidth: 1,
    borderColor: 'rgba(124,92,255,0.22)',
  },
  lockedFolderIcon: {
    width: 48,
    height: 48,
    borderRadius: 24,
    backgroundColor: '#2A2D3A',
    alignItems: 'center',
    justifyContent: 'center',
  },
  lockedFolderTitle: {
    fontSize: 15.5,
    fontFamily: FONTS.bodySemiBold,
    color: '#FFFFFF',
  },
  lockedFolderSub: {
    fontSize: 12.5,
    fontFamily: FONTS.body,
    color: COLORS.mist,
    marginTop: 2,
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
  lockedAvatar: {
    width: 54,
    height: 54,
    borderRadius: 27,
    backgroundColor: '#2A2D3A',
    alignItems: 'center',
    justifyContent: 'center',
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

  // ---------- Modal: blur backdrop + centered dialog ----------
  blurBackdrop: {
    flex: 1,
  },
  keyboardAvoid: {
    flex: 1,
  },
  backdropPress: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 24,
  },
  dialogCard: {
    width: '100%',
    maxWidth: 380,
    backgroundColor: 'rgba(20,22,30,0.96)',
    borderRadius: 24,
    paddingTop: 22,
    paddingBottom: 16,
    paddingHorizontal: 12,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.09)',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 12 },
    shadowOpacity: 0.5,
    shadowRadius: 24,
    elevation: 16,
  },
  dialogHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    paddingHorizontal: 14,
    paddingBottom: 14,
    marginBottom: 6,
    borderBottomWidth: 1,
    borderBottomColor: 'rgba(255,255,255,0.06)',
  },
  dialogHeaderName: {
    fontSize: 16,
    fontFamily: FONTS.bodySemiBold,
    color: '#FFFFFF',
  },
  dialogHeaderSub: {
    fontSize: 12.5,
    fontFamily: FONTS.body,
    color: COLORS.mist,
    marginTop: 2,
  },
  dialogIconWrap: {
    width: 60,
    height: 60,
    borderRadius: 30,
    backgroundColor: 'rgba(124,92,255,0.15)',
    alignItems: 'center',
    justifyContent: 'center',
    alignSelf: 'center',
    marginBottom: 14,
  },
  dialogTitle: {
    fontSize: 17,
    fontFamily: FONTS.displayBold,
    color: '#FFFFFF',
    textAlign: 'center',
    marginBottom: 6,
    paddingHorizontal: 8,
  },
  dialogSub: {
    fontSize: 13.5,
    fontFamily: FONTS.body,
    color: COLORS.mistLight,
    textAlign: 'center',
    lineHeight: 19,
    marginBottom: 18,
    paddingHorizontal: 8,
  },
  dialogButtons: {
    flexDirection: 'row',
    gap: 10,
    paddingHorizontal: 8,
    marginTop: 4,
  },
  dialogBtnSecondary: {
    flex: 1,
    paddingVertical: 13,
    borderRadius: 14,
    backgroundColor: 'rgba(255,255,255,0.06)',
    alignItems: 'center',
  },
  dialogBtnSecondaryText: {
    fontSize: 14.5,
    fontFamily: FONTS.bodySemiBold,
    color: COLORS.mistLight,
  },
  dialogBtnDanger: {
    flex: 1,
    paddingVertical: 13,
    borderRadius: 14,
    backgroundColor: COLORS.danger,
    alignItems: 'center',
  },
  dialogBtnPrimary: {
    flex: 1,
    paddingVertical: 13,
    borderRadius: 14,
    backgroundColor: COLORS.violet,
    alignItems: 'center',
  },
  dialogBtnPrimaryText: {
    fontSize: 14.5,
    fontFamily: FONTS.bodySemiBold,
    color: '#FFFFFF',
  },

  // ---------- Action rows ----------
  actionRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 16,
    paddingHorizontal: 14,
    paddingVertical: 14,
    borderRadius: 12,
  },
  actionLabel: {
    fontSize: 16,
    fontFamily: FONTS.bodyMedium,
    color: '#FFFFFF',
  },

  // ---------- PIN inputs ----------
  pinInput: {
    backgroundColor: 'rgba(255,255,255,0.05)',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.1)',
    borderRadius: 14,
    paddingHorizontal: 16,
    paddingVertical: 14,
    fontSize: 18,
    fontFamily: FONTS.bodySemiBold,
    color: '#FFFFFF',
    textAlign: 'center',
    letterSpacing: 8,
    marginBottom: 10,
    marginHorizontal: 8,
  },
  pinError: {
    fontSize: 13,
    fontFamily: FONTS.bodyMedium,
    color: COLORS.danger,
    textAlign: 'center',
    marginBottom: 8,
  },

  // ---------- Locked view ----------
  lockedViewSafe: {
    flex: 1,
    backgroundColor: '#000000',
  },
  lockedViewHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 14,
    paddingVertical: 12,
    borderBottomWidth: 1,
    borderBottomColor: 'rgba(255,255,255,0.06)',
  },
  lockedViewClose: {
    width: 40,
    height: 40,
    borderRadius: 20,
    alignItems: 'center',
    justifyContent: 'center',
  },
  lockedViewTitle: {
    fontSize: 18,
    fontFamily: FONTS.displayBold,
    color: '#FFFFFF',
  },
});
