// app/(tabs)/chats.tsx
// Chats list — SQLite-backed (offline-first) + SMART INCREMENTAL SYNC
// ✅ FIX: delayed skeleton (250ms) — kills cold-start flash jump
// ✅ FIX: skeletonWrap padding matches real list (no 8px jump)

import { useEffect, useState, useCallback, useRef, useMemo, memo } from 'react';
import {
  View,
  Text,
  StyleSheet,
  FlatList,
  TouchableOpacity,
  Modal,
  Pressable,
  TextInput,
  Alert,
  Platform,
  KeyboardAvoidingView,
  useWindowDimensions,
} from 'react-native';
import { BlurView } from 'expo-blur';
import { Gesture, GestureDetector } from 'react-native-gesture-handler';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { useFocusEffect } from '@react-navigation/native';
import { Ionicons } from '@expo/vector-icons';
import { COLORS, FONTS, RADII, SPACING } from '../../constants/theme';
import { supabase } from '../../lib/supabase';
import { getCurrentUserId } from '../../lib/auth';
import { subscribeNetwork, isOnline } from '../../lib/network';
import Avatar from '../../components/Avatar';
import VerifiedBadge from '../../components/VerifiedBadge';
import {
  dbGetConversations,
  dbUpsertConversation,
  dbUpsertConversations,
  dbDeleteConversation,
  dbClearAllConversations,
  DBConversation,
} from '../../lib/db';
import {
  hashPin,
  loadStoredPinHash,
  savePinHash,
  setSessionUnlocked,
} from '../../lib/pin';
import {
  hapticMedium,
  hapticHeavy,
  hapticSuccess,
  hapticError,
  hapticSelection,
} from '../../lib/haptics';

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

const ROW_HEIGHT = 78;
const LOCKED_H = 56;
const PULL_OPEN_DISTANCE = 70;

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

function dbRowToConversation(row: DBConversation): Conversation {
  return {
    id: row.id,
    is_group: row.is_group === 1,
    name: row.name,
    other_profile: row.other_user_id
      ? {
          id: row.other_user_id,
          username: row.other_username ?? '',
          display_name: row.other_display_name ?? 'Unknown',
          avatar_color: row.other_avatar_color ?? COLORS.violet,
          avatar_url: row.other_avatar_url,
          verified: row.other_verified === 1,
        }
      : null,
    last_message: row.last_message ?? '',
    last_at: row.last_at ?? '',
    unread_count: row.unread_count ?? 0,
    is_muted: row.is_muted === 1,
    is_locked: row.is_locked === 1,
  };
}

function conversationToDbRow(c: Conversation) {
  return {
    id: c.id,
    is_group: c.is_group ? 1 : 0,
    name: c.name,
    other_user_id: c.other_profile?.id ?? null,
    other_username: c.other_profile?.username ?? null,
    other_display_name: c.other_profile?.display_name ?? null,
    other_avatar_color: c.other_profile?.avatar_color ?? null,
    other_avatar_url: c.other_profile?.avatar_url ?? null,
    other_verified: c.other_profile?.verified ? 1 : 0,
    last_message: c.last_message,
    last_at: c.last_at,
    unread_count: c.unread_count,
    is_muted: c.is_muted ? 1 : 0,
    is_locked: c.is_locked ? 1 : 0,
  };
}

async function persistConversations(list: Conversation[]) {
  try {
    await dbUpsertConversations(list.map(conversationToDbRow));
  } catch (err) {
    console.warn('[chats] persistConversations error:', err);
  }
}

async function patchDbConversation(id: string, patch: Partial<DBConversation>) {
  try {
    await dbUpsertConversation({ id, ...patch });
  } catch (err) {
    console.warn('[chats] patchDbConversation error:', err);
  }
}

function getCallPreview(rawContent: string): string {
  try {
    const parsed = JSON.parse(rawContent || '{}');
    const glyph = parsed.call_type === 'video' ? '📹' : '📞';
    const st = parsed.status as string;
    if (st === 'missed') return `${glyph} Missed call`;
    if (st === 'declined') return `${glyph} Declined call`;
    if (st === 'cancelled') return `${glyph} Cancelled call`;
    if (st === 'answered') {
      const dur = Number(parsed.duration_seconds) || 0;
      if (dur >= 60) {
        const m = Math.floor(dur / 60);
        const s = dur % 60;
        return `${glyph} Call · ${m}:${s.toString().padStart(2, '0')}`;
      }
      return `${glyph} Call · ${dur}s`;
    }
    return `${glyph} Call`;
  } catch {
    return '📞 Call';
  }
}

function previewFromMessage(msg: {
  content?: string | null;
  message_type?: string | null;
  is_deleted?: boolean | null;
}): string {
  if (!msg) return '';
  if (msg.is_deleted) return 'This message was deleted';
  if (msg.message_type === 'image') return '📷 Photo';
  if (msg.message_type === 'voice') return '🎤 Voice message';
  if (msg.message_type === 'call') return getCallPreview(msg.content ?? '');
  if (msg.content?.startsWith('[STATUS_REPLY]'))
    return '↩️ Replied to your status';
  return msg.content || '';
}

function sortConversations(list: Conversation[]): Conversation[] {
  return [...list].sort((a, b) => {
    const at = a.last_at || '';
    const bt = b.last_at || '';
    if (!at && !bt) return 0;
    if (!at) return 1;
    if (!bt) return -1;
    if (at === bt) return 0;
    return at < bt ? 1 : -1;
  });
}

function mergeIntoState(
  prev: Conversation[],
  updates: Conversation[]
): Conversation[] {
  const map = new Map<string, Conversation>();

  for (const c of prev) map.set(c.id, c);

  for (const u of updates) {
    const existing = map.get(u.id);
    if (existing) {
      map.set(u.id, {
        ...existing,
        last_message: u.last_message || existing.last_message,
        last_at: u.last_at || existing.last_at,
        unread_count:
          typeof u.unread_count === 'number'
            ? u.unread_count
            : existing.unread_count,
        is_muted:
          typeof u.is_muted === 'boolean' ? u.is_muted : existing.is_muted,
        is_locked:
          typeof u.is_locked === 'boolean' ? u.is_locked : existing.is_locked,
        other_profile: u.other_profile || existing.other_profile,
        name: u.name || existing.name,
        is_group:
          typeof u.is_group === 'boolean' ? u.is_group : existing.is_group,
      });
    } else {
      map.set(u.id, u);
    }
  }

  return sortConversations(Array.from(map.values()));
}

function SkeletonBlock({ width, height, borderRadius = 6, style }: any) {
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

const ChatRow = memo(
  function ChatRow({ item, onPress, onLongPress, showSeparator }: any) {
    const displayName = item.is_group
      ? item.name ?? 'Group'
      : item.other_profile?.display_name ?? 'Unknown';
    const color = item.other_profile?.avatar_color ?? COLORS.violet;
    const hasUnread = item.unread_count > 0;
    const showUnread = hasUnread && !item.is_muted;

    return (
      <View style={styles.rowContainer}>
        <TouchableOpacity
          style={styles.row}
          onPress={() => onPress(item.id)}
          onLongPress={() => {
            hapticMedium();
            onLongPress(item);
          }}
          delayLongPress={350}
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
                {item.is_muted && (
                  <Ionicons
                    name="volume-mute"
                    size={14}
                    color={COLORS.mist}
                    style={{ marginLeft: 6 }}
                  />
                )}
              </View>
              <Text
                style={[styles.rowTime, showUnread && styles.rowTimeUnread]}
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
                {item.last_message}
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
    prev.showSeparator === next.showSeparator
);

export default function ChatsScreen() {
  const router = useRouter();
  const { height: winH } = useWindowDimensions();
  const [conversations, setConversations] = useState<Conversation[]>([]);
  const [loading, setLoading] = useState(true);
  const [myId, setMyId] = useState<string | null>(null);
  const [online, setOnline] = useState(isOnline());

  // ✅ FIX: delayed skeleton — only show if loading > 250ms
  const [showSkeleton, setShowSkeleton] = useState(false);

  // Modals State
  const [actionSheetConvo, setActionSheetConvo] = useState<Conversation | null>(null);
  const [deleteConfirmConvo, setDeleteConfirmConvo] = useState<Conversation | null>(null);
  const [blockConfirmConvo, setBlockConfirmConvo] = useState<Conversation | null>(null);
  const [pinSetupConvo, setPinSetupConvo] = useState<Conversation | null>(null);
  const [pinInput1, setPinInput1] = useState('');
  const [pinInput2, setPinInput2] = useState('');
  const [pinError, setPinError] = useState('');
  const [pinModalVisible, setPinModalVisible] = useState(false);
  const [pinVerifyInput, setPinVerifyInput] = useState('');
  const [pinVerifyError, setPinVerifyError] = useState('');
  const [storedPin, setStoredPin] = useState<string | null>(null);
  const [lockedViewOpen, setLockedViewOpen] = useState(false);

  const realtimeTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const isLoadingRef = useRef(false);
  const cacheShownRef = useRef(false);
  const listRef = useRef<FlatList<Conversation>>(null);
  const didHideRef = useRef(false);
  const scrollYRef = useRef(0);
  const startYRef = useRef(0);
  const hasFocusedOnceRef = useRef(false);
  const nativeGesture = useMemo(() => Gesture.Native(), []);

  // ✅ FIX: delay skeleton visibility — avoids flash on warm start
  useEffect(() => {
    if (!loading || conversations.length > 0) {
      setShowSkeleton(false);
      return;
    }
    const t = setTimeout(() => setShowSkeleton(true), 250);
    return () => clearTimeout(t);
  }, [loading, conversations.length]);

  // Init User ID
  useEffect(() => {
    let mounted = true;
    (async () => {
      const uid = await getCurrentUserId();
      if (mounted && uid) setMyId(uid);
    })();
    return () => {
      mounted = false;
    };
  }, []);

  // Network Listener
  useEffect(() => {
    setOnline(isOnline());
    const unsub = subscribeNetwork(setOnline);
    return unsub;
  }, []);

  // Load PIN Hash
  useEffect(() => {
    if (!myId) return;
    (async () => {
      const hash = await loadStoredPinHash(myId);
      setStoredPin(hash);
    })();
  }, [myId]);

  const syncBackground = useCallback(async () => {
    if (!myId || !isOnline() || isLoadingRef.current) return;

    isLoadingRef.current = true;
    try {
      const { data: participants } = await supabase
        .from('conversation_participants')
        .select('conversation_id')
        .eq('user_id', myId);

      const ids = (participants ?? []).map((p) => p.conversation_id);
      if (ids.length === 0) {
        setConversations([]);
        await dbClearAllConversations();
        return;
      }

      const [convosRes, othersRes, unreadRes, lastMsgRes, settingsRes] =
        await Promise.all([
          supabase
            .from('conversations')
            .select('id, is_group, name')
            .in('id', ids),
          supabase
            .from('conversation_participants')
            .select(
              'conversation_id, user_id, profiles(id, username, display_name, avatar_color, avatar_url, verified)'
            )
            .in('conversation_id', ids)
            .neq('user_id', myId),
          supabase
            .from('messages')
            .select('conversation_id')
            .in('conversation_id', ids)
            .neq('sender_id', myId)
            .is('read_at', null),
          supabase
            .from('messages')
            .select(
              'conversation_id, content, message_type, created_at, is_deleted'
            )
            .in('conversation_id', ids)
            .order('created_at', { ascending: false })
            .limit(Math.max(ids.length * 2, 40)),
          supabase
            .from('chat_settings')
            .select('conversation_id, is_muted, is_locked')
            .eq('user_id', myId)
            .in('conversation_id', ids),
        ]);

      const settingsMap = new Map(
        (settingsRes.data ?? []).map((s) => [s.conversation_id, s])
      );
      const unreadCounts = new Map<string, number>();
      (unreadRes.data ?? []).forEach((m: any) => {
        unreadCounts.set(
          m.conversation_id,
          (unreadCounts.get(m.conversation_id) || 0) + 1
        );
      });

      const lastPerConvo = new Map<string, any>();
      (lastMsgRes.data ?? []).forEach((m: any) => {
        if (!lastPerConvo.has(m.conversation_id))
          lastPerConvo.set(m.conversation_id, m);
      });

      const otherProfiles = new Map<string, any>();
      (othersRes.data ?? []).forEach((p: any) => {
        if (p.profiles) otherProfiles.set(p.conversation_id, p.profiles);
      });

      const updatedRows: Conversation[] = (convosRes.data ?? []).map((c: any) => {
        const last = lastPerConvo.get(c.id);
        const setting = settingsMap.get(c.id);
        const profile = otherProfiles.get(c.id);

        const preview = last ? previewFromMessage(last) : 'Say hello 👋';

        return {
          id: c.id,
          is_group: c.is_group,
          name: c.name,
          other_profile: profile
            ? {
                id: profile.id,
                username: profile.username,
                display_name: profile.display_name,
                avatar_color: profile.avatar_color,
                avatar_url: profile.avatar_url,
                verified: profile.verified,
              }
            : null,
          last_message: preview,
          last_at: last?.created_at ?? '',
          unread_count: unreadCounts.get(c.id) ?? 0,
          is_muted: setting?.is_muted ?? false,
          is_locked: setting?.is_locked ?? false,
        };
      });

      setConversations((prev) => mergeIntoState(prev, updatedRows));
      await persistConversations(updatedRows);
    } catch (err) {
      console.warn('[chats] Sync Error:', err);
    } finally {
      isLoadingRef.current = false;
    }
  }, [myId]);

  // 1. INITIAL LOAD: CACHE FIRST (Instant)
  useEffect(() => {
    if (!myId || cacheShownRef.current) return;
    (async () => {
      try {
        const rows = await dbGetConversations();
        if (rows.length > 0) {
          const cached = rows.map(dbRowToConversation);
          setConversations(sortConversations(cached));
        }
      } catch (err) {
        console.warn('[chats] SQLite read error:', err);
      } finally {
        setLoading(false);
        cacheShownRef.current = true;

        if (isOnline()) {
          syncBackground();
        }
      }
    })();
  }, [myId, syncBackground]);

  // 3. REALTIME UPDATES: TARGETED PATCHING
  useEffect(() => {
    if (!myId || !online) return;

    const channel = supabase
      .channel('chats-list-realtime-v3')
      .on(
        'postgres_changes',
        { event: 'INSERT', schema: 'public', table: 'messages' },
        (payload) => {
          const msg = payload.new as any;
          const cid = msg.conversation_id;

          if (realtimeTimeoutRef.current)
            clearTimeout(realtimeTimeoutRef.current);

          realtimeTimeoutRef.current = setTimeout(() => {
            const preview = previewFromMessage(msg);
            const isFromMe = msg.sender_id === myId;

            setConversations((prev) => {
              const idx = prev.findIndex((c) => c.id === cid);
              if (idx === -1) {
                syncBackground();
                return prev;
              }

              const updated = [...prev];
              const convo = updated[idx];

              updated[idx] = {
                ...convo,
                last_message: preview,
                last_at: msg.created_at,
                unread_count: isFromMe
                  ? convo.unread_count
                  : convo.unread_count + 1,
              };

              return sortConversations(updated);
            });

            dbUpsertConversation({
              id: cid,
              last_message: preview,
              last_at: msg.created_at,
              ...(isFromMe ? {} : { unread_count: 1 }),
            }).catch(console.warn);
          }, 300);
        }
      )
      .on(
        'postgres_changes',
        { event: 'UPDATE', schema: 'public', table: 'messages' },
        () => {
          if (realtimeTimeoutRef.current)
            clearTimeout(realtimeTimeoutRef.current);
          realtimeTimeoutRef.current = setTimeout(syncBackground, 800);
        }
      )
      .on(
        'postgres_changes',
        { event: 'DELETE', schema: 'public', table: 'messages' },
        () => {
          if (realtimeTimeoutRef.current)
            clearTimeout(realtimeTimeoutRef.current);
          realtimeTimeoutRef.current = setTimeout(syncBackground, 800);
        }
      )
      .subscribe();

    return () => {
      if (realtimeTimeoutRef.current) clearTimeout(realtimeTimeoutRef.current);
      supabase.removeChannel(channel);
    };
  }, [myId, online, syncBackground]);

  // 4. FOCUS EFFECT: LIGHT SYNC WHEN RETURNING
  useFocusEffect(
    useCallback(() => {
      if (!hasFocusedOnceRef.current) {
        hasFocusedOnceRef.current = true;
        return;
      }
      if (myId && online) {
        syncBackground();
      }
    }, [myId, online, syncBackground])
  );

  useEffect(() => {
    if (online && myId) {
      syncBackground();
    }
  }, [online, myId, syncBackground]);

  // --- ACTIONS ---
  const unlockedConversations = conversations.filter((c) => !c.is_locked);
  const lockedConversations = conversations.filter((c) => c.is_locked);
  const hasLocked = lockedConversations.length > 0;

  useEffect(() => {
    if (!hasLocked) didHideRef.current = false;
  }, [hasLocked]);

  const hideLockedRow = useCallback((animated = true) => {
    listRef.current?.scrollToOffset({ offset: LOCKED_H, animated });
  }, []);

  const snapLocked = useCallback(
    (y: number) => {
      if (!hasLocked) return;
      if (y > 0 && y < LOCKED_H) {
        listRef.current?.scrollToOffset({
          offset: y < LOCKED_H / 2 ? 0 : LOCKED_H,
          animated: true,
        });
      }
    },
    [hasLocked]
  );

  const openChat = useCallback(
    (convoId: string) => {
      router.push(`/chat/${convoId}`);
    },
    [router]
  );

  const openLockedChat = useCallback(
    (convoId: string) => {
      setLockedViewOpen(false);
      setTimeout(() => router.push(`/chat/${convoId}`), 320);
    },
    [router]
  );

  async function deleteConversation(convoId: string) {
    hapticHeavy();
    setDeleteConfirmConvo(null);
    const next = conversations.filter((c) => c.id !== convoId);
    setConversations(next);
    await persistConversations(next);
    await dbDeleteConversation(convoId);
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
      hapticError();
      Alert.alert('Delete failed', 'Please try again.');
      syncBackground();
    }
  }

  async function toggleMute(convo: Conversation) {
    if (!myId) return;
    setActionSheetConvo(null);
    hapticSelection();
    const nextMuted = !convo.is_muted;
    const next = conversations.map((c) =>
      c.id === convo.id ? { ...c, is_muted: nextMuted } : c
    );
    setConversations(next);
    await persistConversations(next);
    await patchDbConversation(convo.id, { is_muted: nextMuted ? 1 : 0 });
    try {
      await supabase.from('chat_settings').upsert(
        {
          user_id: myId,
          conversation_id: convo.id,
          is_muted: nextMuted,
          is_locked: convo.is_locked ?? false,
        },
        { onConflict: 'user_id,conversation_id' }
      );
    } catch (err) {
      hapticError();
      const revert = conversations.map((c) =>
        c.id === convo.id ? { ...c, is_muted: !nextMuted } : c
      );
      setConversations(revert);
      await persistConversations(revert);
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
      await supabase.from('chat_settings').upsert(
        {
          user_id: myId,
          conversation_id: convoId,
          is_locked: lock,
          is_muted: convo?.is_muted ?? false,
        },
        { onConflict: 'user_id,conversation_id' }
      );
      const next = conversations.map((c) =>
        c.id === convoId ? { ...c, is_locked: lock } : c
      );
      setConversations(next);
      await persistConversations(next);
      await patchDbConversation(convoId, { is_locked: lock ? 1 : 0 });
    } catch (err) {
      hapticError();
      Alert.alert('Failed', 'Could not update lock.');
    }
  }

  async function unlockChat(convo: Conversation) {
    hapticSuccess();
    await applyLock(convo.id, false);
  }

  async function confirmPinSetup() {
    if (!pinSetupConvo || !myId) return;
    if (pinInput1.length !== 4) {
      hapticError();
      setPinError('PIN must be 4 digits');
      return;
    }
    if (pinInput1 !== pinInput2) {
      hapticError();
      setPinError('PINs do not match');
      return;
    }
    try {
      const hash = await savePinHash(myId, pinInput1);
      setStoredPin(hash);
      setSessionUnlocked(true);
      hapticSuccess();
      const targetId = pinSetupConvo.id;
      setPinSetupConvo(null);
      await applyLock(targetId, true);
    } catch (err) {
      hapticError();
      setPinError('Could not save PIN');
    }
  }

  function openLockedSection() {
    if (lockedConversations.length === 0) return;
    setPinVerifyInput('');
    setPinVerifyError('');
    setPinModalVisible(true);
  }

  async function confirmPinVerify() {
    if (!storedPin) {
      hapticSuccess();
      setSessionUnlocked(true);
      setPinModalVisible(false);
      hideLockedRow();
      setTimeout(() => setLockedViewOpen(true), 220);
      return;
    }
    if (pinVerifyInput.length !== 4) {
      hapticError();
      setPinVerifyError('Enter 4-digit PIN');
      return;
    }
    try {
      const inputHash = await hashPin(pinVerifyInput);
      if (inputHash === storedPin) {
        hapticSuccess();
        setSessionUnlocked(true);
        setPinModalVisible(false);
        hideLockedRow();
        setTimeout(() => setLockedViewOpen(true), 220);
      } else {
        hapticError();
        setPinVerifyError('Incorrect PIN');
      }
    } catch {
      hapticError();
      setPinVerifyError('Verification failed');
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
    hapticHe nativeavy();
    setBlockConfirmConvo(nullGesture);
    try {
      await supabase
       );

 .from('blocked_users')
        .insert({  blocker_id: myId, blocked_id: targetUserId return });
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
      const next = conversations.filter((c) => c.id !== convo.id);
      setConversations(next);
      await persistConversations(next);
      await dbDeleteConversation(convo.id);
      Alert.alert(
        'Blocked',
        `@${convo.other_profile?.username} has been blocked.`
      );
    } catch (err) {
      hapticError();
      Alert.alert('Failed', 'Could not block.');
      syncBackground();
    }
  }

  const renderItem = useCallback(
    ({ item, index }: any) => (
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
      offset: ROW_HEIGHT * index + (hasLocked ? LOCKED_H : 0),
      index,
    }),
    [hasLocked]
  );

  const pullGesture = Gesture.Pan()
    .runOnJS(true)
    .activeOffsetY([-1000, 15])
    .failOffsetX([-25, 25])
    .onBegin(() => {
      startYRef.current = scrollYRef.current;
    })
    .onEnd((e) => {
      if (!hasLocked) return;
      if (startYRef.current > LOCKED_H + 1) return;
      if (scrollYRef.current > 1) return;
      const overPull = e.translationY - startYRef.current;
      if (overPull > PULL_OPEN_DISTANCE) {
        hapticMedium();
        openLockedSection();
      }
    });

  const listGesture = Gesture.Simultaneous(pullGesture, (
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

      {!online && (
        <View style={styles.offlineBanner}>
          <Ionicons name="cloud-offline-outline" size={14} color="#FFFFFF" />
          <Text style={styles.offlineBannerText}>
            You're offline — showing cached chats
          </Text>
        </View>
      )}

      {/* ✅ FIX: skeleton only shows after 250ms — no warm-start flash */}
      {showSkeleton ? (
        <ChatListSkeleton />
      ) : (
        <GestureDetector gesture={listGesture}>
          <FlatList
            ref={listRef}
            data={unlockedConversations}
            keyExtractor={keyExtractor}
            renderItem={renderItem}
            getItemLayout={getItemLayout}
            contentContainerStyle={[
              styles.listContent,
              hasLocked && { minHeight: winH },
            ]}
            initialNumToRender={12}
            maxToRenderPerBatch={10}
            windowSize={7}
            updateCellsBatchingPeriod={50}
            removeClippedSubviews={true}
            keyboardShouldPersistTaps="handled"
            scrollEventThrottle={16}
            onScroll={(e) => {
              scrollYRef.current = e.nativeEvent.contentOffset.y;
            }}
            onScrollEndDrag={(e) => {
              const v = e.nativeEvent.velocity?.y ?? 0;
              if (Math.abs(v) < 0.1) snapLocked(e.nativeEvent.contentOffset.y);
            }}
            onMomentumScrollEnd={(e) =>
              snapLocked(e.nativeEvent.contentOffset.y)
            }
            onContentSizeChange={() => {
              if (hasLocked && !didHideRef.current) {
                didHideRef.current = true;
                if (scrollYRef.current < LOCKED_H) hideLockedRow(false);
              }
            }}
            ListHeaderComponent={
              hasLocked ? (
                <TouchableOpacity
                  style={styles.lockedRow}
                  onPress={openLockedSection}
                  activeOpacity={0.7}
                >
                  <View style={styles.lockedRowIconWrap}>
                    <Ionicons
                      name="lock-closed-outline"
                      size={24}
                      color="#FFFFFF"
                    />
                  </View>
                  <Text style={styles.lockedRowText}>Locked chats</Text>
                  <Text style={styles.lockedRowCount}>
                    {lockedConversations.length}
                  </Text>
                  <Ionicons
                    name="chevron-forward"
                    size={18}
                    color={COLORS.mist}
                  />
                </TouchableOpacity>
              ) : null
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
        </GestureDetector>
      )}

      {/* ACTION MENU */}
      <Modal
        visible={!!actionSheetConvo}
        transparent
        animationType="fade"
        onRequestClose={() => setActionSheetConvo(null)}
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
                    size={40}
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

      {/* DELETE CONFIRM */}
      <Modal
        visible={!!deleteConfirmConvo}
        transparent
        animationType="fade"
        onRequestClose={() => setDeleteConfirmConvo(null)}
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
            onPress={() => setDeleteConfirmConvo(null)}
          >
            <Pressable
              style={styles.dialogCard}
              onPress={(e) => e.stopPropagation()}
            >
              <View
                style={[
                  styles.dialogIconWrap,
                  { backgroundColor: 'rgba(239,68,68,0.15)' },
                ]}
              >
                <Ionicons
                  name="trash-outline"
                  size={20}
                  color={COLORS.danger}
                />
              </View>
              <Text style={styles.dialogTitle}>Delete this chat?</Text>
              <Text style={styles.dialogSub}>
                This will remove the chat from your list.
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

      {/* BLOCK CONFIRM */}
      <Modal
        visible={!!blockConfirmConvo}
        transparent
        animationType="fade"
        onRequestClose={() => setBlockConfirmConvo(null)}
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
            onPress={() => setBlockConfirmConvo(null)}
          >
            <Pressable
              style={styles.dialogCard}
              onPress={(e) => e.stopPropagation()}
            >
              <View
                style={[
                  styles.dialogIconWrap,
                  { backgroundColor: 'rgba(239,68,68,0.15)' },
                ]}
              >
                <Ionicons name="ban" size={20} color={COLORS.danger} />
              </View>
              <Text style={styles.dialogTitle}>
                Block @{blockConfirmConvo?.other_profile?.username}?
              </Text>
              <Text style={styles.dialogSub}>
                They won't be able to message you.
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

      {/* PIN SETUP */}
      <Modal
        visible={!!pinSetupConvo}
        transparent
        animationType="fade"
        onRequestClose={() => setPinSetupConvo(null)}
        statusBarTranslucent
      >
        <BlurView
          intensity={50}
          tint="dark"
          experimentalBlurMethod="dimezisBlurView"
          style={styles.blurBackdrop}
        >
          <KeyboardAvoidingView
            behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
            style={styles.keyboardAvoid}
          >
            <Pressable
              style={styles.backdropPress}
              onPress={() => setPinSetupConvo(null)}
            >
              <Pressable
                style={styles.pinDialogCard}
                onPress={(e) => e.stopPropagation()}
              >
                <View style={styles.pinDialogIconWrap}>
                  <Ionicons
                    name="lock-closed"
                    size={18}
                    color={COLORS.violetLight}
                  />
                </View>
                <Text style={styles.pinDialogTitle}>Set a chat lock PIN</Text>
                <Text style={styles.pinDialogSub}>Enter a 4-digit PIN.</Text>
                <TextInput
                  style={styles.pinInput}
                  value={pinInput1}
                  onChangeText={(t) =>
                    setPinInput1(t.replace(/\D/g, '').slice(0, 4))
                  }
                  placeholder="Enter PIN"
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
                {!!pinError && <Text style={styles.pinError}>{pinError}</Text>}
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

      {/* PIN VERIFY */}
      <Modal
        visible={pinModalVisible}
        transparent
        animationType="fade"
        onRequestClose={() => setPinModalVisible(false)}
        statusBarTranslucent
      >
        <BlurView
          intensity={50}
          tint="dark"
          experimentalBlurMethod="dimezisBlurView"
          style={styles.blurBackdrop}
        >
          <KeyboardAvoidingView
            behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
            style={styles.keyboardAvoid}
          >
            <Pressable
              style={styles.backdropPress}
              onPress={() => setPinModalVisible(false)}
            >
              <Pressable
                style={styles.pinDialogCard}
                onPress={(e) => e.stopPropagation()}
              >
                <View style={styles.pinDialogIconWrap}>
                  <Ionicons
                    name="lock-closed"
                    size={18}
                    color={COLORS.violetLight}
                  />
                </View>
                <Text style={styles.pinDialogTitle}>Enter your PIN</Text>
                <Text style={styles.pinDialogSub}>
                  Unlock to view locked chats.
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

      {/* LOCKED CHATS VIEW */}
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

function ActionRow({ icon, label, onPress, danger }: any) {
  return (
    <TouchableOpacity
      style={styles.actionRow}
      onPress={onPress}
      activeOpacity={0.7}
    >
      <Ionicons
        name={icon}
        size={20}
        color={danger ? COLORS.danger : '#FFFFFF'}
      />
      <Text style={[styles.actionLabel, danger && { color: COLORS.danger }]}>
        {label}
      </Text>
    </TouchableOpacity>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: '#000000' },
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
  lockedRow: {
    height: LOCKED_H,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    paddingHorizontal: SPACING.sm * 2,
    borderBottomWidth: 1,
    borderBottomColor: 'rgba(255,255,255,0.05)',
  },
  lockedRowIconWrap: {
    width: 24,
    height: 24,
    alignItems: 'center',
    justifyContent: 'center',
  },
  lockedRowText: {
    flex: 1,
    fontSize: 16,
    fontFamily: FONTS.bodySemiBold,
    color: '#FFFFFF',
  },
  lockedRowCount: {
    fontSize: 13.5,
    fontFamily: FONTS.bodyMedium,
    color: COLORS.mist,
    marginRight: 2,
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
  // ✅ FIX: paddingTop removed to match real FlatList contentContainer
  skeletonWrap: {
    paddingHorizontal: SPACING.sm,
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
  blurBackdrop: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.35)',
  },
  keyboardAvoid: { flex: 1 },
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
    paddingTop: 16,
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
  dialogHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    paddingHorizontal: 12,
    paddingBottom: 10,
    marginBottom: 4,
    borderBottomWidth: 1,
    borderBottomColor: 'rgba(255,255,255,0.06)',
  },
  dialogHeaderName: {
    fontSize: 15,
    fontFamily: FONTS.bodySemiBold,
    color: '#FFFFFF',
  },
  dialogHeaderSub: {
    fontSize: 11.5,
    fontFamily: FONTS.body,
    color: COLORS.mist,
    marginTop: 2,
  },
  dialogIconWrap: {
    width: 52,
    height: 52,
    borderRadius: 26,
    backgroundColor: 'rgba(124,92,255,0.15)',
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
    paddingHorizontal: 8,
  },
  dialogSub: {
    fontSize: 13,
    fontFamily: FONTS.body,
    color: COLORS.mistLight,
    textAlign: 'center',
    lineHeight: 18,
    marginBottom: 14,
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
  dialogBtnDanger: {
    flex: 1,
    paddingVertical: 11,
    borderRadius: 12,
    backgroundColor: COLORS.danger,
    alignItems: 'center',
  },
  dialogBtnPrimary: {
    flex: 1,
    paddingVertical: 11,
    borderRadius: 12,
    backgroundColor: COLORS.violet,
    alignItems: 'center',
  },
  dialogBtnPrimaryText: {
    fontSize: 14,
    fontFamily: FONTS.bodySemiBold,
    color: '#FFFFFF',
  },
  pinDialogCard: {
    width: '100%',
    maxWidth: 280,
    backgroundColor: 'rgba(20,22,30,0.96)',
    borderRadius: 18,
    paddingTop: 16,
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
  pinDialogIconWrap: {
    width: 44,
    height: 44,
    borderRadius: 22,
    backgroundColor: 'rgba(124,92,255,0.15)',
    alignItems: 'center',
    justifyContent: 'center',
    alignSelf: 'center',
    marginBottom: 10,
  },
  pinDialogTitle: {
    fontSize: 15,
    fontFamily: FONTS.displayBold,
    color: '#FFFFFF',
    textAlign: 'center',
    marginBottom: 4,
    paddingHorizontal: 8,
  },
  pinDialogSub: {
    fontSize: 12,
    fontFamily: FONTS.body,
    color: COLORS.mistLight,
    textAlign: 'center',
    lineHeight: 16,
    marginBottom: 12,
    paddingHorizontal: 8,
  },
  actionRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    paddingHorizontal: 12,
    paddingVertical: 11,
    borderRadius: 10,
  },
  actionLabel: {
    fontSize: 15,
    fontFamily: FONTS.bodyMedium,
    color: '#FFFFFF',
  },
  pinInput: {
    backgroundColor: 'rgba(255,255,255,0.05)',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.1)',
    borderRadius: 10,
    paddingHorizontal: 12,
    paddingVertical: 10,
    fontSize: 16,
    fontFamily: FONTS.bodySemiBold,
    color: '#FFFFFF',
    textAlign: 'center',
    letterSpacing: 6,
    marginBottom: 8,
    marginHorizontal: 8,
  },
  pinError: {
    fontSize: 12,
    fontFamily: FONTS.bodyMedium,
    color: COLORS.danger,
    textAlign: 'center',
    marginBottom: 6,
  },
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
