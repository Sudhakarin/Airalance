// app/chat/[id].tsx
// Chat screen — SQLite offline-first + offline auth + network auto-reload + delivery ticks

import { useEffect, useState, useRef, useCallback, memo } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TextInput,
  TouchableOpacity,
  FlatList,
  KeyboardAvoidingView,
  Platform,
  ActivityIndicator,
  Alert,
  Modal,
  Pressable,
  Animated,
  ScrollView,
  useWindowDimensions,
} from 'react-native';
import { Image } from 'expo-image';
import { BlurView } from 'expo-blur';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { LinearGradient } from 'expo-linear-gradient';
import * as ImagePicker from 'expo-image-picker';
import * as Clipboard from 'expo-clipboard';
import {
  useAudioRecorder,
  useAudioRecorderState,
  RecordingPresets,
  AudioModule,
  setAudioModeAsync,
} from 'expo-audio';
import {
  COLORS,
  FONTS,
  RADII,
  SPACING,
  GRADIENTS,
  CONSTANTS,
} from '../../constants/theme';
import { supabase } from '../../lib/supabase';
import { getCurrentUserId } from '../../lib/auth';
import { subscribeNetwork, isOnline } from '../../lib/network';
import Avatar from '../../components/Avatar';
import MessageBubble from '../../components/MessageBubble';
import VerifiedBadge from '../../components/VerifiedBadge';
import TypingDots from '../../components/TypingDots';
import {
  dbGetMessages,
  dbUpsertMessage,
  dbDeleteMessage,
  dbGetPendingMessages,
  dbGetConversation,
  dbUpsertConversation,
  getDB,
  DBMessage,
} from '../../lib/db';
import {
  hashPin,
  loadStoredPinHash,
  isSessionUnlocked,
  setSessionUnlocked,
} from '../../lib/pin';
import {
  hapticLight,
  hapticMedium,
  hapticHeavy,
  hapticSuccess,
  hapticError,
} from '../../lib/haptics';
import { playSend, playReceive } from '../../lib/sounds';

type Message = {
  id: string;
  conversation_id: string;
  sender_id: string;
  content: string;
  created_at: string;
  read_at: string | null;
  delivered_at?: string | null;
  message_type: 'text' | 'image' | 'voice';
  media_url: string | null;
  media_duration: number | null;
  reply_to_id: string | null;
  is_deleted: boolean | null;
  local_status?: 'synced' | 'pending' | 'failed';
};

type OtherProfile = {
  id: string;
  username: string;
  display_name: string;
  avatar_color: string;
  avatar_url: string | null;
  verified: boolean | null;
  last_seen: string | null;
};

type Reaction = {
  id: string;
  message_id: string;
  user_id: string;
  emoji: string;
};

const PAGE_SIZE = 10;
const MESSAGES_SQLITE_LIMIT = 100;

// ============================================================
// SQLite <-> Message conversions
// ============================================================
function dbRowToMessage(row: DBMessage): Message {
  return {
    id: row.id,
    conversation_id: row.conversation_id,
    sender_id: row.sender_id,
    content: row.content ?? '',
    created_at: row.created_at,
    read_at: row.read_at,
    delivered_at: row.delivered_at,
    message_type: (row.message_type as any) ?? 'text',
    media_url: row.media_url,
    media_duration: row.media_duration,
    reply_to_id: row.reply_to_id,
    is_deleted: row.is_deleted === 1,
    local_status: (row.local_status as any) ?? 'synced',
  };
}

function messageToDbRow(m: Message) {
  return {
    id: m.id,
    conversation_id: m.conversation_id,
    sender_id: m.sender_id,
    content: m.content,
    message_type: m.message_type,
    media_url: m.media_url,
    media_duration: m.media_duration,
    reply_to_id: m.reply_to_id,
    is_deleted: m.is_deleted ? 1 : 0,
    is_edited: 0,
    is_pinned: 0,
    reaction: null,
    read_at: m.read_at,
    delivered_at: m.delivered_at ?? null,
    created_at: m.created_at,
    local_status: m.local_status ?? 'synced',
  };
}

async function persistMessages(list: Message[]) {
  try {
    for (const m of list) {
      await dbUpsertMessage(messageToDbRow(m));
    }
  } catch (err) {
    console.warn('[chat] persistMessages error:', err);
  }
}

async function patchMessageInDb(id: string, patch: Partial<DBMessage>) {
  try {
    const db = await getDB();
    const existing = await db.getFirstAsync<DBMessage>(
      `SELECT * FROM messages WHERE id = ?`,
      [id]
    );
    if (!existing) return;
    await db.runAsync(
      `UPDATE messages SET
        content = COALESCE(?, content),
        is_deleted = COALESCE(?, is_deleted),
        read_at = COALESCE(?, read_at),
        delivered_at = COALESCE(?, delivered_at),
        local_status = COALESCE(?, local_status)
       WHERE id = ?`,
      [
        patch.content ?? null,
        patch.is_deleted ?? null,
        patch.read_at ?? null,
        patch.delivered_at ?? null,
        patch.local_status ?? null,
        id,
      ]
    );
  } catch (err) {
    console.warn('[chat] patchMessageInDb error:', err);
  }
}

// ---------- Memoized row ----------
const MessageRow = memo(function MessageRow({
  item,
  isMine,
  prevMessage,
  nextMessage,
  myId,
  onLongPress,
  onDoubleTap,
  onSwipeReply,
  onImagePress,
  replyMessage,
  reactions,
  animate,
}: {
  item: Message;
  isMine: boolean;
  prevMessage?: Message;
  nextMessage?: Message;
  myId: string;
  onLongPress: (msg: Message) => void;
  onDoubleTap: (msg: Message) => void;
  onSwipeReply: (msg: Message) => void;
  onImagePress: (msg: Message) => void;
  replyMessage?: Message | null;
  reactions: Reaction[];
  animate?: boolean;
}) {
  return (
    <MessageBubble
      message={item}
      isMine={isMine}
      prevMessage={prevMessage}
      nextMessage={nextMessage}
      myId={myId}
      onLongPress={onLongPress}
      onDoubleTap={onDoubleTap}
      onSwipeReply={onSwipeReply}
      onImagePress={onImagePress}
      replyMessage={replyMessage}
      reactions={reactions}
      animate={animate}
    />
  );
});

export default function ChatScreen() {
  const router = useRouter();
  const params = useLocalSearchParams<{ id: string }>();
  const convoId = params.id;

  const [myId, setMyId] = useState<string | null>(null);
  const [myName, setMyName] = useState<string>('');
  const [other, setOther] = useState<OtherProfile | null>(null);
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState('');
  const [loading, setLoading] = useState(true);
  const [sending, setSending] = useState(false);
  const [peerTyping, setPeerTyping] = useState(false);
  const [otherOnline, setOtherOnline] = useState(false);
  const [uploading, setUploading] = useState(false);

  const [online, setOnline] = useState(isOnline());

  const [lockRequired, setLockRequired] = useState(false);
  const [storedPinHash, setStoredPinHash] = useState<string | null>(null);
  const [pinVerifyInput, setPinVerifyInput] = useState('');
  const [pinVerifyError, setPinVerifyError] = useState('');
  const [lockChecked, setLockChecked] = useState(false);

  const [isMutedForConvo, setIsMutedForConvo] = useState(false);

  // ✅ Full-screen photo viewer (tap a photo in chat)
  const [viewerImage, setViewerImage] = useState<Message | null>(null);
  const { width: screenW, height: screenH } = useWindowDimensions();
  const handleImagePress = useCallback((msg: Message) => {
    if (msg.media_url && !msg.is_deleted) setViewerImage(msg);
  }, []);

  const [loadingMore, setLoadingMore] = useState(false);
  const [hasMore, setHasMore] = useState(true);
  const loadingMoreRef = useRef(false);

  const [animatingIds, setAnimatingIds] = useState<Set<string>>(new Set());

  const [showScrollBtn, setShowScrollBtn] = useState(false);
  const [newMessagesCount, setNewMessagesCount] = useState(0);
  const scrollBtnAnim = useRef(new Animated.Value(0)).current;

  const [pinnedMessage, setPinnedMessage] = useState<Message | null>(null);
  const [replyingTo, setReplyingTo] = useState<Message | null>(null);
  const [actionSheetMsg, setActionSheetMsg] = useState<Message | null>(null);
  const [deleteConfirmMsg, setDeleteConfirmMsg] = useState<Message | null>(null);
  const [hiddenForMeIds, setHiddenForMeIds] = useState<Set<string>>(new Set());
  const [reactionsByMsg, setReactionsByMsg] = useState<Record<string, Reaction[]>>({});

  const flatListRef = useRef<FlatList<Message>>(null);
  const channelRef = useRef<any>(null);
  const typingTimeoutRef = useRef<any>(null);
  const lastTypingSentRef = useRef(0);
  const inputRef = useRef<TextInput>(null);
  const prevMsgCountRef = useRef(0);
  const isNearBottomRef = useRef(true);
  const initialScrollDoneRef = useRef(false);
  const cacheShownRef = useRef(false);
  const retryInProgressRef = useRef(false);
  const bootstrapDoneRef = useRef(false);

  const audioRecorder = useAudioRecorder(RecordingPresets.HIGH_QUALITY);
  const recorderState = useAudioRecorderState(audioRecorder, 100);
  const [isRecording, setIsRecording] = useState(false);

  const visibleMessages = messages.filter((m) => !hiddenForMeIds.has(m.id));

  const markAnimating = useCallback((id: string) => {
    setAnimatingIds((prev) => {
      const next = new Set(prev);
      next.add(id);
      if (next.size > 100) {
        const arr = Array.from(next);
        return new Set(arr.slice(-50));
      }
      return next;
    });
  }, []);

  useEffect(() => {
    Animated.timing(scrollBtnAnim, {
      toValue: showScrollBtn ? 1 : 0,
      duration: 180,
      useNativeDriver: true,
    }).start();
  }, [showScrollBtn, scrollBtnAnim]);

  // ✅ Network subscription
  useEffect(() => {
    setOnline(isOnline());
    const unsub = subscribeNetwork((next) => {
      setOnline(next);
    });
    return unsub;
  }, []);

  // ✅ PHASE 3: Show SQLite cache instantly (works offline)
  useEffect(() => {
    if (!convoId || cacheShownRef.current) return;
    (async () => {
      try {
        const rows = await dbGetMessages(convoId, MESSAGES_SQLITE_LIMIT);
        if (rows.length > 0) {
          const ordered = [...rows].reverse().map(dbRowToMessage);
          setMessages(ordered);
          setLoading(false);
          prevMsgCountRef.current = ordered.length;
        }
      } catch (err) {
        console.warn('[chat] SQLite read error:', err);
      }
      cacheShownRef.current = true;
    })();
  }, [convoId]);

  // ✅ PHASE 3: Persist messages to SQLite on change
  useEffect(() => {
    if (!convoId) return;
    if (messages.length === 0) return;
    const timer = setTimeout(() => {
      persistMessages(messages);
    }, 500);
    return () => clearTimeout(timer);
  }, [messages, convoId]);

  // ✅ Bootstrap: works OFFLINE (uses getCurrentUserId from local session)
  useEffect(() => {
    if (!convoId) return;
    if (bootstrapDoneRef.current) return;
    bootstrapDoneRef.current = true;

    let mounted = true;

    async function bootstrap() {
      // ✅ OFFLINE FIX: read user ID from local session (no network)
      const uid = await getCurrentUserId();
      if (!uid || !mounted) {
        setLoading(false);
        setLockChecked(true);
        return;
      }

      // Load PIN hash (local)
      const pinHash = await loadStoredPinHash(uid);
      if (!mounted) return;
      setStoredPinHash(pinHash);
      setMyId(uid);

      // ✅ FIX: Load conversation metadata from SQLite (works OFFLINE)
      try {
        const cachedConvo = await dbGetConversation(convoId);
        if (cachedConvo?.other_user_id && mounted) {
          setOther({
            id: cachedConvo.other_user_id,
            username: cachedConvo.other_username ?? '',
            display_name: cachedConvo.other_display_name ?? '',
            avatar_color: cachedConvo.other_avatar_color ?? COLORS.violet,
            avatar_url: cachedConvo.other_avatar_url,
            verified: cachedConvo.other_verified === 1,
            last_seen: null,
          });
        }
      } catch (err) {
        console.warn('[chat] convo SQLite read error:', err);
      }

      // If offline → skip network, just stop loading (SQLite cache already shown)
      if (!isOnline()) {
        setLockChecked(true);
        setLoading(false);
        return;
      }

      try {
        const [
          profileRes,
          otherRes,
          msgRes,
          pinsRes,
          delRes,
          chatSettingsRes,
        ] = await Promise.all([
          supabase.from('profiles').select('display_name').eq('id', uid).single(),
          supabase
            .from('conversation_participants')
            .select(
              'user_id, profiles(id, username, display_name, avatar_color, avatar_url, verified, last_seen)'
            )
            .eq('conversation_id', convoId)
            .neq('user_id', uid)
            .limit(1),
          supabase
            .from('messages')
            .select('*')
            .eq('conversation_id', convoId)
            .order('created_at', { ascending: false })
            .limit(PAGE_SIZE),
          supabase
            .from('message_pins')
            .select('message_id')
            .eq('conversation_id', convoId)
            .eq('user_id', uid)
            .limit(1),
          supabase
            .from('message_deletions')
            .select('message_id')
            .eq('user_id', uid),
          supabase
            .from('chat_settings')
            .select('is_locked, is_muted')
            .eq('user_id', uid)
            .eq('conversation_id', convoId)
            .maybeSingle(),
        ]);

        if (!mounted) return;

        const chatLocked = chatSettingsRes.data?.is_locked === true;
        setIsMutedForConvo(chatSettingsRes.data?.is_muted === true);
        const needsPin = chatLocked && !isSessionUnlocked();
        setLockRequired(needsPin);
        setLockChecked(true);

        if (needsPin) {
          setLoading(false);
          return;
        }

        if (profileRes.data?.display_name) setMyName(profileRes.data.display_name);
        if (otherRes.data?.[0]) {
          const p = (otherRes.data[0] as any).profiles as OtherProfile;
          setOther(p);
          // ✅ FIX: Persist to SQLite for OFFLINE use next time
          try {
            await dbUpsertConversation({
              id: convoId,
              other_user_id: p.id,
              other_username: p.username,
              other_display_name: p.display_name,
              other_avatar_color: p.avatar_color,
              other_avatar_url: p.avatar_url,
              other_verified: p.verified ? 1 : 0,
            });
          } catch (err) {
            console.warn('[chat] convo SQLite write error:', err);
          }
        }

        const msgs = msgRes.data;
        if (msgs) {
          const ordered = [...msgs].reverse() as Message[];
          setMessages(ordered);
          prevMsgCountRef.current = ordered.length;
          setHasMore(msgs.length === PAGE_SIZE);

          await persistMessages(ordered);

          if (ordered.length > 0) {
            const { data: rx } = await supabase
              .from('message_reactions')
              .select('*')
              .in(
                'message_id',
                ordered.map((m) => m.id)
              );
            const grouped: Record<string, Reaction[]> = {};
            (rx ?? []).forEach((r: Reaction) => {
              grouped[r.message_id] = [...(grouped[r.message_id] ?? []), r];
            });
            if (mounted) setReactionsByMsg(grouped);
          }

          const pinnedId = pinsRes.data?.[0]?.message_id;
          if (pinnedId) {
            const found = ordered.find((m) => m.id === pinnedId);
            if (found) setPinnedMessage(found);
          }

          const hiddenIds = new Set<string>(
            (delRes.data ?? []).map((r: any) => r.message_id)
          );
          setHiddenForMeIds(hiddenIds);

          const unreadIds = msgs
            .filter((m: any) => m.sender_id !== uid && !m.read_at)
            .map((m: any) => m.id);
          if (unreadIds.length > 0) {
            supabase
              .from('messages')
              .update({ read_at: new Date().toISOString() })
              .in('id', unreadIds)
              .then(() => {});
          }
        } else {
          setHasMore(false);
        }
      } catch (err) {
        console.warn('[chat] bootstrap network error:', err);
      } finally {
        if (mounted) setLoading(false);
      }
    }

    bootstrap();
    return () => {
      mounted = false;
    };
  }, [convoId]);

  // ✅ Retry pending messages
  const retryPendingMessages = useCallback(async () => {
    if (!myId || !convoId) return;
    if (lockRequired) return;
    if (retryInProgressRef.current) return;
    if (!isOnline()) return;

    retryInProgressRef.current = true;
    try {
      const pending = await dbGetPendingMessages();
      const forThisConvo = pending.filter(
        (p) => p.conversation_id === convoId
      );
      for (const p of forThisConvo) {
        try {
          const { data: inserted, error } = await supabase
            .from('messages')
            .insert({
              conversation_id: p.conversation_id,
              sender_id: p.sender_id,
              content: p.content,
              message_type: p.message_type,
              media_url: p.media_url,
              reply_to_id: p.reply_to_id,
            })
            .select()
            .single();

          if (error) throw error;
          if (inserted) {
            await dbDeleteMessage(p.id);
            await dbUpsertMessage({
              ...messageToDbRow(inserted as Message),
              local_status: 'synced',
            });
            setMessages((prev) =>
              prev.map((m) =>
                m.id === p.id
                  ? { ...(inserted as Message), local_status: 'synced' }
                  : m
              )
            );
          }
        } catch (err) {
          console.warn('[chat] retry pending failed:', err);
          // ✅ FIX: keep as pending if connection lost, else mark failed
          const stillOnline = isOnline();
          await patchMessageInDb(p.id, {
            local_status: stillOnline ? 'failed' : 'pending',
          });
        }
      }
    } catch (err) {
      console.warn('[chat] offline queue error:', err);
    } finally {
      retryInProgressRef.current = false;
    }
  }, [myId, convoId, lockRequired]);

  useEffect(() => {
    if (!myId || !convoId) return;
    if (lockRequired) return;
    retryPendingMessages();
  }, [myId, convoId, lockRequired, retryPendingMessages]);

  // ✅ Auto-retry when network comes back online
  useEffect(() => {
    if (online) {
      retryPendingMessages();
    }
  }, [online, retryPendingMessages]);

  useEffect(() => {
    initialScrollDoneRef.current = false;
  }, [convoId]);

  useEffect(() => {
    if (loading) return;
    if (lockRequired) return;
    if (visibleMessages.length === 0) return;
    if (initialScrollDoneRef.current) return;
    const t = setTimeout(() => {
      flatListRef.current?.scrollToEnd({ animated: false });
      initialScrollDoneRef.current = true;
      isNearBottomRef.current = true;
    }, 60);
    return () => clearTimeout(t);
  }, [loading, lockRequired, visibleMessages.length]);

  const loadOlderMessages = useCallback(async () => {
    if (!myId || !convoId) return;
    if (lockRequired) return;
    if (!isOnline()) return;
    if (loadingMoreRef.current || !hasMore) return;

    const oldestMsg = messages[0];
    if (!oldestMsg) return;

    loadingMoreRef.current = true;
    setLoadingMore(true);

    try {
      const { data, error } = await supabase
        .from('messages')
        .select('*')
        .eq('conversation_id', convoId)
        .lt('created_at', oldestMsg.created_at)
        .order('created_at', { ascending: false })
        .limit(PAGE_SIZE);

      if (error) throw error;
      if (!data || data.length === 0) {
        setHasMore(false);
        return;
      }

      const older = [...data].reverse() as Message[];
      await persistMessages(older);

      const olderIds = older.map((m) => m.id);
      const { data: rx } = await supabase
        .from('message_reactions')
        .select('*')
        .in('message_id', olderIds);
      if (rx && rx.length > 0) {
        const grouped: Record<string, Reaction[]> = {};
        (rx as Reaction[]).forEach((r) => {
          grouped[r.message_id] = [...(grouped[r.message_id] ?? []), r];
        });
        setReactionsByMsg((prev) => ({ ...prev, ...grouped }));
      }

      setMessages((prev) => {
        const existingIds = new Set(prev.map((m) => m.id));
        const filtered = older.filter((m) => !existingIds.has(m.id));
        return [...filtered, ...prev];
      });

      setHasMore(data.length === PAGE_SIZE);
    } catch (err) {
      console.warn('Load older messages failed:', err);
    } finally {
      loadingMoreRef.current = false;
      setLoadingMore(false);
    }
  }, [myId, convoId, hasMore, messages, lockRequired]);

  // ✅ Realtime — only subscribe when online
  useEffect(() => {
    if (!myId || !convoId) return;
    if (lockRequired) return;
    if (!online) return;

    const channel = supabase
      .channel(`chat:${convoId}`)
      .on(
        'postgres_changes',
        {
          event: 'INSERT',
          schema: 'public',
          table: 'messages',
          filter: `conversation_id=eq.${convoId}`,
        },
        (payload) => {
          const incoming = payload.new as Message;
          setPeerTyping(false);
          if (typingTimeoutRef.current) clearTimeout(typingTimeoutRef.current);

          if (incoming.sender_id !== myId) {
            markAnimating(incoming.id);
            if (!isMutedForConvo) playReceive();

            if (!incoming.delivered_at) {
              const deliveredAt = new Date().toISOString();
              supabase
                .from('messages')
                .update({ delivered_at: deliveredAt })
                .eq('id', incoming.id)
                .then(() => {});
              incoming.delivered_at = deliveredAt;
            }
          }

          persistMessages([incoming]);

          setMessages((prev) => {
            if (prev.some((m) => m.id === incoming.id)) return prev;
            const withoutTemp = prev.filter(
              (m) =>
                !(
                  m.id.startsWith('temp-') &&
                  m.sender_id === incoming.sender_id &&
                  m.content === incoming.content
                )
            );
            return [...withoutTemp, incoming];
          });

          if (!isNearBottomRef.current && incoming.sender_id !== myId) {
            setNewMessagesCount((c) => c + 1);
          }

          if (incoming.sender_id !== myId) {
            supabase
              .from('messages')
              .update({ read_at: new Date().toISOString() })
              .eq('id', incoming.id)
              .then(() => {});
          }
        }
      )
      .on(
        'postgres_changes',
        {
          event: 'UPDATE',
          schema: 'public',
          table: 'messages',
          filter: `conversation_id=eq.${convoId}`,
        },
        (payload) => {
          const updated = payload.new as Message;
          patchMessageInDb(updated.id, {
            content: updated.content,
            is_deleted: updated.is_deleted ? 1 : 0,
            read_at: updated.read_at,
            delivered_at: updated.delivered_at ?? null,
          });
          setMessages((prev) =>
            prev.map((m) => (m.id === updated.id ? updated : m))
          );
          setPinnedMessage((prev) =>
            prev && prev.id === updated.id ? updated : prev
          );
        }
      )
      .on('broadcast', { event: 'typing' }, ({ payload }: any) => {
        if (!payload || payload.userId === myId) return;
        if (typingTimeoutRef.current) clearTimeout(typingTimeoutRef.current);
        if (payload.typing === false) {
          setPeerTyping(false);
          return;
        }
        setPeerTyping(true);
        typingTimeoutRef.current = setTimeout(
          () => setPeerTyping(false),
          CONSTANTS.TYPING_IDLE_MS
        );
      })
      .on(
        'postgres_changes',
        { event: 'INSERT', schema: 'public', table: 'message_reactions' },
        (payload) => {
          const r = payload.new as Reaction;
          setReactionsByMsg((prev) => {
            const list = prev[r.message_id] ?? [];
            if (list.some((x) => x.id === r.id)) return prev;
            return { ...prev, [r.message_id]: [...list, r] };
          });
        }
      )
      .on(
        'postgres_changes',
        { event: 'DELETE', schema: 'public', table: 'message_reactions' },
        (payload) => {
          const r = payload.old as Reaction;
          setReactionsByMsg((prev) => {
            const list = prev[r.message_id] ?? [];
            return {
              ...prev,
              [r.message_id]: list.filter((x) => x.id !== r.id),
            };
          });
        }
      )
      .subscribe();

    channelRef.current = channel;

    return () => {
      if (typingTimeoutRef.current) clearTimeout(typingTimeoutRef.current);
      supabase.removeChannel(channel);
      channelRef.current = null;
    };
  }, [myId, convoId, lockRequired, markAnimating, isMutedForConvo, online]);

  useEffect(() => {
    if (!other?.id) return;
    if (lockRequired) return;
    if (!online) return;
    let cancelled = false;
    const check = async () => {
      const { data } = await supabase
        .from('profiles')
        .select('last_seen')
        .eq('id', other.id)
        .single();
      if (cancelled) return;
      if (data?.last_seen) {
        const diff = Date.now() - new Date(data.last_seen).getTime();
        setOtherOnline(diff < 60000);
      }
    };
    check();
    const interval = setInterval(check, 20000);
    return () => {
      cancelled = true;
      clearInterval(interval);
    };
  }, [other?.id, lockRequired, online]);

  useEffect(() => {
    const count = visibleMessages.length;
    const prevCount = prevMsgCountRef.current;
    if (count > prevCount && prevCount > 0) {
      if (isNearBottomRef.current) {
        requestAnimationFrame(() => {
          flatListRef.current?.scrollToEnd({ animated: true });
        });
      }
    }
    prevMsgCountRef.current = count;
  }, [visibleMessages.length]);

  const onContentSizeChange = useCallback(() => {
    if (initialScrollDoneRef.current) return;
    if (visibleMessages.length === 0) return;
    flatListRef.current?.scrollToEnd({ animated: false });
    initialScrollDoneRef.current = true;
    isNearBottomRef.current = true;
  }, [visibleMessages.length]);

  function onScroll(e: any) {
    const { contentOffset, contentSize, layoutMeasurement } = e.nativeEvent;
    const distanceFromBottom =
      contentSize.height - contentOffset.y - layoutMeasurement.height;
    const nearBottom = distanceFromBottom < 120;
    isNearBottomRef.current = nearBottom;

    const shouldShow = distanceFromBottom > 200;
    if (shouldShow !== showScrollBtn) {
      setShowScrollBtn(shouldShow);
    }

    if (nearBottom && newMessagesCount > 0) {
      setNewMessagesCount(0);
    }

    if (contentOffset.y < 80 && hasMore && !loadingMoreRef.current) {
      loadOlderMessages();
    }
  }

  const handleScrollToBottom = useCallback(() => {
    flatListRef.current?.scrollToEnd({ animated: true });
    setShowScrollBtn(false);
    setNewMessagesCount(0);
    isNearBottomRef.current = true;
  }, []);

  useEffect(() => {
    if (Platform.OS !== 'web') return;
    const el: any = inputRef.current;
    if (!el || !el.style) return;
    el.style.height = 'auto';
    const next = Math.min(Math.max(el.scrollHeight, 48), 120);
    el.style.height = `${next}px`;
  }, [input, isRecording]);

  const triggerPushNotification = useCallback(
    async (
      receiverId: string,
      messageText: string,
      messageType: 'text' | 'image' | 'voice' = 'text'
    ) => {
      if (!myName || !receiverId) return;
      if (!isOnline()) return;
      try {
        let bodyText = messageText;
        if (messageType === 'image') bodyText = '📷 Image';
        if (messageType === 'voice') bodyText = '🎤 Voice message';

        await supabase.functions.invoke('send-push', {
          body: {
            userId: receiverId,
            title: myName,
            body: bodyText,
            data: { screen: 'chat', chatId: convoId },
          },
        });
      } catch (error) {
        console.warn('[push] Failed:', error);
      }
    },
    [myName, convoId]
  );

  const onInputChange = useCallback(
    (text: string) => {
      setInput(text);
      const channel = channelRef.current;
      if (!channel || !myId) return;

      if (text.trim().length === 0) {
        channel.send({
          type: 'broadcast',
          event: 'typing',
          payload: { userId: myId, typing: false },
        });
        lastTypingSentRef.current = 0;
        return;
      }

      const now = Date.now();
      if (now - lastTypingSentRef.current > CONSTANTS.TYPING_THROTTLE_MS) {
        lastTypingSentRef.current = now;
        channel.send({
          type: 'broadcast',
          event: 'typing',
          payload: { userId: myId, typing: true },
        });
      }
    },
    [myId]
  );

  const handleMessageLongPress = useCallback((msg: Message) => {
    if (msg.is_deleted) {
      setDeleteConfirmMsg(msg);
      return;
    }
    setActionSheetMsg(msg);
  }, []);

  const toggleReaction = useCallback(
    async (msg: Message, emoji: string) => {
      if (!myId || msg.is_deleted) return;
      if (!isOnline()) return;
      hapticLight();
      const existing = (reactionsByMsg[msg.id] ?? []).find(
        (r) => r.user_id === myId && r.emoji === emoji
      );

      if (existing) {
        setReactionsByMsg((prev) => ({
          ...prev,
          [msg.id]: (prev[msg.id] ?? []).filter((r) => r.id !== existing.id),
        }));
      } else {
        const tempId = `temp-rx-${Date.now()}`;
        setReactionsByMsg((prev) => ({
          ...prev,
          [msg.id]: [
            ...(prev[msg.id] ?? []),
            {
              id: tempId,
              message_id: msg.id,
              user_id: myId,
              emoji,
            },
          ],
        }));
      }

      try {
        if (existing) {
          await supabase
            .from('message_reactions')
            .delete()
            .eq('message_id', msg.id)
            .eq('user_id', myId)
            .eq('emoji', emoji);
        } else {
          const { data: inserted } = await supabase
            .from('message_reactions')
            .insert({
              message_id: msg.id,
              user_id: myId,
              emoji,
            })
            .select()
            .single();
          if (inserted) {
            setReactionsByMsg((prev) => ({
              ...prev,
              [msg.id]: (prev[msg.id] ?? []).map((r) =>
                r.id.startsWith('temp-rx-') && r.emoji === emoji
                  ? (inserted as Reaction)
                  : r
              ),
            }));
          }
        }
      } catch (err) {
        console.warn('Toggle reaction failed:', err);
        const { data: rx } = await supabase
          .from('message_reactions')
          .select('*')
          .eq('message_id', msg.id);
        setReactionsByMsg((prev) => ({
          ...prev,
          [msg.id]: (rx ?? []) as Reaction[],
        }));
      }
    },
    [myId, reactionsByMsg]
  );

  const handleDoubleTap = useCallback(
    (msg: Message) => {
      toggleReaction(msg, '❤️');
    },
    [toggleReaction]
  );

  const handleReply = useCallback((msg: Message) => {
    setActionSheetMsg(null);
    setReplyingTo(msg);
    setTimeout(() => inputRef.current?.focus(), 150);
  }, []);

  async function handleCopy(msg: Message) {
    setActionSheetMsg(null);
    const textToCopy =
      msg.message_type === 'text' && msg.content ? msg.content : '';
    if (!textToCopy) {
      Alert.alert('Nothing to copy', 'This message has no text.');
      return;
    }
    try {
      await Clipboard.setStringAsync(textToCopy);
      hapticLight();
      Alert.alert('Copied', 'Message copied to clipboard.');
    } catch {
      hapticError();
      Alert.alert('Copy failed', 'Please try again.');
    }
  }

  async function handlePin(msg: Message) {
    setActionSheetMsg(null);
    if (!myId || !convoId) return;
    if (!isOnline()) {
      Alert.alert('Offline', 'Pinning requires internet.');
      return;
    }

    if (pinnedMessage?.id === msg.id) {
      await unpinMessage();
      return;
    }

    try {
      await supabase
        .from('message_pins')
        .delete()
        .eq('conversation_id', convoId)
        .eq('user_id', myId);

      const { error } = await supabase
        .from('message_pins')
        .insert({
          message_id: msg.id,
          conversation_id: convoId,
          user_id: myId,
        });

      if (error) throw error;
      hapticLight();
      setPinnedMessage(msg);
    } catch (err) {
      console.warn('Pin failed:', err);
      hapticError();
      Alert.alert('Pin failed', 'Please try again.');
    }
  }

  async function unpinMessage() {
    if (!myId || !convoId) return;
    try {
      await supabase
        .from('message_pins')
        .delete()
        .eq('conversation_id', convoId)
        .eq('user_id', myId);
      hapticLight();
      setPinnedMessage(null);
    } catch (err) {
      console.warn('Unpin failed:', err);
    }
  }

  function handleDeletePress(msg: Message) {
    setActionSheetMsg(null);
    setDeleteConfirmMsg(msg);
  }

  async function deleteForMe(msg: Message) {
    if (!myId) return;
    hapticHeavy();
    setDeleteConfirmMsg(null);
    try {
      await supabase.from('message_deletions').insert({
        message_id: msg.id,
        user_id: myId,
      });
      setHiddenForMeIds((prev) => {
        const next = new Set(prev);
        next.add(msg.id);
        return next;
      });
      if (pinnedMessage?.id === msg.id) {
        setPinnedMessage(null);
        await supabase
          .from('message_pins')
          .delete()
          .eq('conversation_id', convoId)
          .eq('user_id', myId);
      }
    } catch (err) {
      console.warn('Delete-for-me failed:', err);
      hapticError();
      Alert.alert('Failed', 'Please try again.');
    }
  }

  async function deleteForEveryone(msg: Message) {
    if (!myId) return;
    if (msg.sender_id !== myId) {
      Alert.alert(
        'Cannot delete',
        'You can only delete your own messages for everyone.'
      );
      setDeleteConfirmMsg(null);
      return;
    }
    hapticHeavy();
    setDeleteConfirmMsg(null);
    try {
      await supabase
        .from('messages')
        .update({ is_deleted: true })
        .eq('id', msg.id);

      patchMessageInDb(msg.id, { is_deleted: 1 });

      setMessages((prev) =>
        prev.map((m) => (m.id === msg.id ? { ...m, is_deleted: true } : m))
      );
      if (pinnedMessage?.id === msg.id) {
        setPinnedMessage(null);
        await supabase
          .from('message_pins')
          .delete()
          .eq('conversation_id', convoId)
          .eq('user_id', myId);
      }
    } catch (err) {
      console.warn('Delete-for-everyone failed:', err);
      hapticError();
      Alert.alert('Failed', 'Please try again.');
    }
  }

  function jumpToPinned() {
    if (!pinnedMessage) return;
    const idx = visibleMessages.findIndex((m) => m.id === pinnedMessage.id);
    if (idx < 0) return;
    try {
      flatListRef.current?.scrollToIndex({
        index: idx,
        animated: true,
        viewPosition: 0.5,
      });
    } catch {}
  }

  async function sendMessage() {
    const content = input.trim();
    if (!content || !myId || !convoId || sending) return;

    const replyTarget = replyingTo;
    setSending(true);
    setInput('');
    setReplyingTo(null);

    channelRef.current?.send({
      type: 'broadcast',
      event: 'typing',
      payload: { userId: myId, typing: false },
    });

    const tempId = `temp-${Date.now()}`;
    const optimistic: Message = {
      id: tempId,
      conversation_id: convoId,
      sender_id: myId,
      content,
      created_at: new Date().toISOString(),
      read_at: null,
      delivered_at: null,
      message_type: 'text',
      media_url: null,
      media_duration: null,
      reply_to_id: replyTarget?.id ?? null,
      is_deleted: false,
      local_status: 'pending',
    };

    setMessages((prev) => [...prev, optimistic]);
    markAnimating(tempId);

    try {
      await dbUpsertMessage(messageToDbRow(optimistic));
    } catch (err) {
      console.warn('[chat] SQLite pending save failed:', err);
    }

    // ✅ FIX: If OFFLINE, keep message queued (don't attempt network)
    if (!isOnline()) {
      hapticLight();
      setSending(false);
      requestAnimationFrame(() => {
        flatListRef.current?.scrollToEnd({ animated: true });
      });
      return;
    }

    try {
      const { data: inserted, error } = await supabase
        .from('messages')
        .insert({
          conversation_id: convoId,
          sender_id: myId,
          content,
          message_type: 'text',
          reply_to_id: replyTarget?.id ?? null,
        })
        .select()
        .single();

      if (error || !inserted) throw error || new Error('Insert failed');

      const serverMsg: Message = {
        ...(inserted as Message),
        local_status: 'synced',
      };
      try {
        await dbDeleteMessage(tempId);
        await dbUpsertMessage(messageToDbRow(serverMsg));
      } catch (err) {
        console.warn('[chat] SQLite sync save failed:', err);
      }

      setMessages((prev) => {
        if (prev.some((m) => m.id === serverMsg.id))
          return prev.filter((m) => m.id !== tempId);
        return prev.map((m) => (m.id === tempId ? serverMsg : m));
      });

      requestAnimationFrame(() => {
        flatListRef.current?.scrollToEnd({ animated: true });
      });

      hapticLight();
      playSend();
      if (other?.id) triggerPushNotification(other.id, content, 'text');
    } catch (err) {
      console.warn('Send failed:', err);

      // ✅ FIX: Distinguish network loss vs real failure
      const stillOnline = isOnline();
      const newStatus: 'pending' | 'failed' = stillOnline ? 'failed' : 'pending';

      try {
        await patchMessageInDb(tempId, { local_status: newStatus });
      } catch {}

      setMessages((prev) =>
        prev.map((m) =>
          m.id === tempId ? { ...m, local_status: newStatus } : m
        )
      );

      if (stillOnline) {
        // Real failure while online → restore input + show alert
        setInput(content);
        setReplyingTo(replyTarget);
        hapticError();
        Alert.alert(
          'Failed to send',
          'Message saved. Will retry automatically.'
        );
      } else {
        // Lost connection mid-send → keep queued silently, auto-retry on reconnect
        hapticLight();
      }
    } finally {
      setSending(false);
    }
  }

  async function pickImage() {
    if (!myId || !convoId || uploading) return;
    if (!isOnline()) {
      Alert.alert('Offline', 'Cannot upload photos while offline.');
      return;
    }
    const perm = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (!perm.granted) {
      Alert.alert('Permission needed', 'Please allow photos access.');
      return;
    }
    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ImagePicker.MediaTypeOptions.Images,
      quality: 0.7,
    });
    if (result.canceled || !result.assets?.[0]) return;

    const asset = result.assets[0];
    setUploading(true);
    try {
      const response = await fetch(asset.uri);
      const arrayBuffer = await response.arrayBuffer();
      const ext = (asset.uri.split('.').pop() ?? 'jpg')
        .toLowerCase()
        .slice(0, 5);
      const path = `${convoId}/${myId}-${Date.now()}.${ext}`;

      const { error: uploadError } = await supabase.storage
        .from(CONSTANTS.CHAT_MEDIA_BUCKET)
        .upload(path, arrayBuffer, {
          contentType: asset.mimeType ?? 'image/jpeg',
        });

      if (uploadError) throw uploadError;

      const { data: urlData } = supabase.storage
        .from(CONSTANTS.CHAT_MEDIA_BUCKET)
        .getPublicUrl(path);

      const { data: inserted, error } = await supabase
        .from('messages')
        .insert({
          conversation_id: convoId,
          sender_id: myId,
          content: '',
          message_type: 'image',
          media_url: urlData.publicUrl,
          reply_to_id: replyingTo?.id ?? null,
        })
        .select()
        .single();

      if (error) throw error;
      if (inserted) {
        await persistMessages([inserted as Message]);

        markAnimating((inserted as Message).id);
        setMessages((prev) =>
          prev.some((m) => m.id === (inserted as Message).id)
            ? prev
            : [...prev, inserted as Message]
        );
        setReplyingTo(null);
        hapticSuccess();
        playSend();
        if (other?.id) triggerPushNotification(other.id, '', 'image');
      }
    } catch (err: any) {
      console.warn('Image upload error:', err);
      hapticError();
      Alert.alert('Upload failed', err?.message ?? 'Please try again.');
    } finally {
      setUploading(false);
    }
  }

  async function startRecording() {
    if (isRecording) return;
    if (!isOnline()) {
      Alert.alert('Offline', 'Cannot record voice while offline.');
      return;
    }
    try {
      const perm = await AudioModule.requestRecordingPermissionsAsync();
      if (!perm.granted) {
        Alert.alert('Permission needed', 'Please allow microphone access.');
        return;
      }
      await setAudioModeAsync({
        allowsRecording: true,
        playsInSilentMode: true,
      });
      await audioRecorder.prepareToRecordAsync();
      audioRecorder.record();
      hapticMedium();
      setIsRecording(true);
    } catch (err) {
      console.warn('Recording start error:', err);
      hapticError();
      Alert.alert('Cannot record', 'Please check microphone permission.');
    }
  }

  async function stopAndSendRecording() {
    if (!audioRecorder || !myId || !convoId) return;
    const durationMs = recorderState.durationMillis ?? 0;
    try {
      await audioRecorder.stop();
      const uri = audioRecorder.uri;
      setIsRecording(false);

      if (!uri || durationMs < 1000) return;
      if (!isOnline()) {
        Alert.alert('Offline', 'Cannot send voice while offline.');
        return;
      }

      setUploading(true);
      const response = await fetch(uri);
      const arrayBuffer = await response.arrayBuffer();
      const path = `${convoId}/${myId}-${Date.now()}.m4a`;

      const { error: uploadError } = await supabase.storage
        .from(CONSTANTS.CHAT_MEDIA_BUCKET)
        .upload(path, arrayBuffer, { contentType: 'audio/m4a' });
      if (uploadError) throw uploadError;

      const { data: urlData } = supabase.storage
        .from(CONSTANTS.CHAT_MEDIA_BUCKET)
        .getPublicUrl(path);

      const { data: inserted, error } = await supabase
        .from('messages')
        .insert({
          conversation_id: convoId,
          sender_id: myId,
          content: '',
          message_type: 'voice',
          media_url: urlData.publicUrl,
          media_duration: Math.round(durationMs / 1000),
          reply_to_id: replyingTo?.id ?? null,
        })
        .select()
        .single();

      if (error) throw error;
      if (inserted) {
        await persistMessages([inserted as Message]);

        markAnimating((inserted as Message).id);
        setMessages((prev) =>
          prev.some((m) => m.id === (inserted as Message).id)
            ? prev
            : [...prev, inserted as Message]
        );
        setReplyingTo(null);
        hapticSuccess();
        playSend();
        if (other?.id) triggerPushNotification(other.id, '', 'voice');
      }
    } catch (err: any) {
      console.warn('Voice send error:', err);
      hapticError();
      Alert.alert('Upload failed', 'Please try again.');
    } finally {
      setUploading(false);
    }
  }

  async function cancelRecording() {
    if (!audioRecorder || !isRecording) return;
    try {
      await audioRecorder.stop();
    } catch {}
    hapticLight();
    setIsRecording(false);
  }

  function formatDuration(total: number) {
    const m = Math.floor(total / 60).toString().padStart(2, '0');
    const s = (total % 60).toString().padStart(2, '0');
    return `${m}:${s}`;
  }

  function formatLastSeen(iso: string | null | undefined) {
    if (!iso) return 'Offline';
    const diff = Date.now() - new Date(iso).getTime();
    const min = Math.floor(diff / 60000);
    if (min < 1) return 'Active now';
    if (min < 60) return `Last seen ${min}m ago`;
    const hr = Math.floor(min / 60);
    if (hr < 24) return `Last seen ${hr}h ago`;
    return `Last seen ${Math.floor(hr / 24)}d ago`;
  }

  function getMessagePreview(msg: Message | null | undefined): string {
    if (!msg) return '';
    if (msg.is_deleted) return 'This message was deleted';
    if (msg.message_type === 'image') return '📷 Photo';
    if (msg.message_type === 'voice') return '🎤 Voice message';
    return msg.content || '';
  }

  function getSenderName(msg: Message | null | undefined): string {
    if (!msg) return '';
    return msg.sender_id === myId ? 'You' : other?.display_name ?? 'Them';
  }

  const keyExtractor = useCallback((item: Message) => item.id, []);

  const renderItem = useCallback(
    ({ item, index }: { item: Message; index: number }) => {
      const prev = visibleMessages[index - 1];
      const next = visibleMessages[index + 1];
      const replyMsg = item.reply_to_id
        ? messages.find((m) => m.id === item.reply_to_id) ?? null
        : null;
      return (
        <MessageRow
          item={item}
          isMine={item.sender_id === myId}
          prevMessage={prev}
          nextMessage={next}
          myId={myId!}
          onLongPress={handleMessageLongPress}
          onDoubleTap={handleDoubleTap}
          onSwipeReply={handleReply}
          onImagePress={handleImagePress}
          replyMessage={replyMsg}
          reactions={reactionsByMsg[item.id] ?? []}
          animate={animatingIds.has(item.id)}
        />
      );
    },
    [
      visibleMessages,
      messages,
      myId,
      handleMessageLongPress,
      handleDoubleTap,
      handleReply,
      handleImagePress,
      reactionsByMsg,
      animatingIds,
    ]
  );

  const recordSeconds = Math.floor((recorderState.durationMillis ?? 0) / 1000);

  if (loading || !myId || !lockChecked) {
    return (
      <SafeAreaView style={styles.safe} edges={['top', 'bottom']}>
        <View style={styles.loadingWrap}>
          <ActivityIndicator color={COLORS.violet} />
        </View>
      </SafeAreaView>
    );
  }

  if (lockRequired) {
    const onVerify = async () => {
      if (!storedPinHash) {
        hapticSuccess();
        setSessionUnlocked(true);
        setLockRequired(false);
        return;
      }
      if (pinVerifyInput.length !== 4) {
        hapticError();
        setPinVerifyError('Enter 4-digit PIN');
        return;
      }
      try {
        const inputHash = await hashPin(pinVerifyInput);
        if (inputHash === storedPinHash) {
          hapticSuccess();
          setSessionUnlocked(true);
          setLockRequired(false);
          setPinVerifyInput('');
          setPinVerifyError('');
        } else {
          hapticError();
          setPinVerifyError('Incorrect PIN');
        }
      } catch {
        hapticError();
        setPinVerifyError('Verification failed');
      }
    };

    return (
      <SafeAreaView style={styles.safe} edges={['top', 'bottom']}>
        <View style={styles.lockScreenWrap}>
          <View style={styles.lockScreenIcon}>
            <Ionicons
              name="lock-closed"
              size={28}
              color={COLORS.violetLight}
            />
          </View>
          <Text style={styles.lockScreenTitle}>Chat locked</Text>
          <Text style={styles.lockScreenSub}>
            Enter your PIN to open this conversation.
          </Text>

          <TextInput
            style={styles.lockScreenInput}
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
            <Text style={styles.lockScreenError}>{pinVerifyError}</Text>
          )}

          <View style={styles.lockScreenButtons}>
            <TouchableOpacity
              style={styles.lockScreenBtnSecondary}
              onPress={() => router.back()}
              activeOpacity={0.75}
            >
              <Text style={styles.lockScreenBtnSecondaryText}>Cancel</Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={styles.lockScreenBtnPrimary}
              onPress={onVerify}
              activeOpacity={0.75}
            >
              <Text style={styles.lockScreenBtnPrimaryText}>Unlock</Text>
            </TouchableOpacity>
          </View>
        </View>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.safe} edges={['top', 'bottom']}>
      <KeyboardAvoidingView
        style={{ flex: 1 }}
        behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
        keyboardVerticalOffset={Platform.OS === 'ios' ? 0 : 0}
      >
        {!online && (
          <View style={styles.offlineBanner}>
            <Ionicons name="cloud-offline-outline" size={14} color="#FFFFFF" />
            <Text style={styles.offlineBannerText}>
              No internet — messages will be sent when you're back online
            </Text>
          </View>
        )}

        <View style={styles.header}>
          <TouchableOpacity
            style={styles.backBtn}
            onPress={() => router.back()}
            activeOpacity={0.7}
          >
            <Ionicons name="chevron-back" size={26} color={COLORS.text} />
          </TouchableOpacity>

          <TouchableOpacity
            style={styles.headerCenter}
            onPress={() => other && router.push(`/profile/${other.id}`)}
            activeOpacity={0.7}
          >
            <Avatar
              name={other?.display_name ?? 'Unknown'}
              color={other?.avatar_color ?? COLORS.violet}
              avatarUrl={other?.avatar_url ?? null}
              size={42}
              previewOnHold
              onPress={() => other && router.push(`/profile/${other.id}`)}
            />
            <View style={{ marginLeft: 12, flex: 1 }}>
              <View style={styles.headerNameRow}>
                <Text style={styles.headerName} numberOfLines={1}>
                  {other?.display_name ?? 'Unknown'}
                </Text>
                {other?.verified && <VerifiedBadge size={15} />}
              </View>
              {peerTyping ? (
                <View
                  style={{
                    flexDirection: 'row',
                    alignItems: 'center',
                    gap: 6,
                    marginTop: 1,
                  }}
                >
                  <Text
                    style={[
                      styles.headerSub,
                      { color: COLORS.teal, marginTop: 0 },
                    ]}
                  >
                    typing
                  </Text>
                  <TypingDots />
                </View>
              ) : (
                <Text style={styles.headerSub} numberOfLines={1}>
                  {otherOnline ? (
                    <Text style={{ color: COLORS.teal }}>Active now</Text>
                  ) : (
                    formatLastSeen(other?.last_seen)
                  )}
                </Text>
              )}
            </View>
          </TouchableOpacity>

          <TouchableOpacity
            style={styles.backBtn}
            onPress={() => other && router.push(`/profile/${other.id}`)}
            activeOpacity={0.7}
          >
            <Ionicons
              name="information-circle-outline"
              size={26}
              color={COLORS.text}
            />
          </TouchableOpacity>
        </View>

        {pinnedMessage && !hiddenForMeIds.has(pinnedMessage.id) && (
          <TouchableOpacity
            style={styles.pinBanner}
            onPress={jumpToPinned}
            activeOpacity={0.75}
            onLongPress={unpinMessage}
          >
            <View style={styles.pinBannerIcon}>
              <Ionicons name="pin" size={14} color={COLORS.violetLight} />
            </View>
            <View style={{ flex: 1, minWidth: 0 }}>
              <Text style={styles.pinBannerLabel}>Pinned message</Text>
              <Text style={styles.pinBannerText} numberOfLines={1}>
                {getMessagePreview(pinnedMessage)}
              </Text>
            </View>
            <TouchableOpacity
              onPress={unpinMessage}
              style={styles.pinBannerClose}
              hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
            >
              <Ionicons name="close" size={16} color={COLORS.mist} />
            </TouchableOpacity>
          </TouchableOpacity>
        )}

        <View style={{ flex: 1 }}>
          <Image
            source={require('../../assets/chat-wallpaper.png')}
            style={StyleSheet.absoluteFill}
            contentFit="cover"
            transition={0}
            cachePolicy="memory-disk"
          />
          <View
            style={[
              StyleSheet.absoluteFill,
              { backgroundColor: 'rgba(0,0,0,0.55)' },
            ]}
            pointerEvents="none"
          />

          <FlatList
            ref={flatListRef}
            data={visibleMessages}
            keyExtractor={keyExtractor}
            renderItem={renderItem}
            contentContainerStyle={styles.listContent}
            style={{ backgroundColor: 'transparent' }}
            onScroll={onScroll}
            scrollEventThrottle={100}
            onContentSizeChange={onContentSizeChange}
            initialNumToRender={20}
            maxToRenderPerBatch={12}
            windowSize={11}
            updateCellsBatchingPeriod={50}
            removeClippedSubviews={Platform.OS === 'android'}
            keyboardShouldPersistTaps="handled"
            maintainVisibleContentPosition={{
              minIndexForVisible: 0,
              autoscrollToTopThreshold: 10,
            }}
            onScrollToIndexFailed={(info) => {
              setTimeout(() => {
                flatListRef.current?.scrollToEnd({ animated: true });
              }, 200);
            }}
            ListHeaderComponent={
              loadingMore ? (
                <View style={styles.loadingMoreWrap}>
                  <ActivityIndicator size="small" color={COLORS.mist} />
                  <Text style={styles.loadingMoreText}>Loading older…</Text>
                </View>
              ) : null
            }
            ListEmptyComponent={
              <View style={styles.emptyWrap}>
                <Text style={styles.emptyText}>
                  No messages yet — say hello 👋
                </Text>
              </View>
            }
          />

          {showScrollBtn && (
            <Animated.View
              style={[
                styles.scrollBtnWrap,
                {
                  opacity: scrollBtnAnim,
                  transform: [
                    {
                      translateY: scrollBtnAnim.interpolate({
                        inputRange: [0, 1],
                        outputRange: [20, 0],
                      }),
                    },
                  ],
                },
              ]}
              pointerEvents="box-none"
            >
              <TouchableOpacity
                style={styles.scrollBtn}
                onPress={handleScrollToBottom}
                activeOpacity={0.85}
              >
                <View style={styles.scrollBtnIconWrap}>
                  <Ionicons name="arrow-down" size={18} color="#FFFFFF" />
                </View>
                {newMessagesCount > 0 && (
                  <View style={styles.scrollBadge}>
                    <Text style={styles.scrollBadgeText}>
                      {newMessagesCount > 99 ? '99+' : newMessagesCount}
                    </Text>
                  </View>
                )}
              </TouchableOpacity>
            </Animated.View>
          )}
        </View>

        {replyingTo && (
          <View style={styles.replyPreview}>
            <View style={styles.replyBar} />
            <View style={{ flex: 1, minWidth: 0 }}>
              <Text style={styles.replyName} numberOfLines={1}>
                Reply to {getSenderName(replyingTo)}
              </Text>
              <Text style={styles.replyText} numberOfLines={1}>
                {getMessagePreview(replyingTo)}
              </Text>
            </View>
            <TouchableOpacity
              onPress={() => setReplyingTo(null)}
              style={styles.replyClose}
              hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
            >
              <Ionicons name="close" size={18} color={COLORS.mist} />
            </TouchableOpacity>
          </View>
        )}

        <View style={styles.inputBar}>
          {isRecording ? (
            <>
              <View style={styles.recordingWrap}>
                <View style={styles.recordingDot} />
                <Text style={styles.recordingText}>
                  Recording {formatDuration(recordSeconds)}
                </Text>
              </View>
              <TouchableOpacity
                style={styles.recordingIconBtn}
                onPress={cancelRecording}
                activeOpacity={0.7}
              >
                <Ionicons name="close" size={22} color={COLORS.danger} />
              </TouchableOpacity>
              <TouchableOpacity
                style={styles.recordingSendBtn}
                onPress={stopAndSendRecording}
                activeOpacity={0.85}
              >
                <LinearGradient
                  colors={GRADIENTS.violet}
                  start={{ x: 0, y: 0 }}
                  end={{ x: 1, y: 1 }}
                  style={styles.recordingSendBtnInner}
                >
                  <Ionicons name="send" size={18} color="#FFFFFF" />
                </LinearGradient>
              </TouchableOpacity>
            </>
          ) : (
            <>
              <View style={styles.composerPill}>
                <TouchableOpacity
                  style={styles.composerIconBtn}
                  onPress={pickImage}
                  disabled={uploading}
                  activeOpacity={0.7}
                >
                  {uploading ? (
                    <ActivityIndicator size="small" color={COLORS.mist} />
                  ) : (
                    <Ionicons name="image-outline" size={22} color={COLORS.mist} />
                  )}
                </TouchableOpacity>

                <TextInput
                  ref={inputRef}
                  style={styles.composerInput}
                  {...(Platform.OS === 'web' ? { numberOfLines: 1 } : {})}
                  value={input}
                  onChangeText={onInputChange}
                  placeholder="Message"
                  placeholderTextColor="rgba(139,143,163,0.7)"
                  multiline
                  maxLength={2000}
                  textAlignVertical="center"
                  underlineColorAndroid="transparent"
                  selectionColor={COLORS.violet}
                />
              </View>

              {input.trim().length > 0 ? (
                <TouchableOpacity
                  style={styles.composerSendBtn}
                  onPress={sendMessage}
                  disabled={sending}
                  activeOpacity={0.85}
                >
                  <LinearGradient
                    colors={GRADIENTS.violet}
                    start={{ x: 0, y: 0 }}
                    end={{ x: 1, y: 1 }}
                    style={styles.composerSendBtnInner}
                  >
                    {sending ? (
                      <ActivityIndicator size="small" color="#FFFFFF" />
                    ) : (
                      <Ionicons name="send" size={18} color="#FFFFFF" />
                    )}
                  </LinearGradient>
                </TouchableOpacity>
              ) : (
                <TouchableOpacity
                  style={styles.composerSendBtn}
                  onPress={startRecording}
                  activeOpacity={0.85}
                >
                  <LinearGradient
                    colors={GRADIENTS.violet}
                    start={{ x: 0, y: 0 }}
                    end={{ x: 1, y: 1 }}
                    style={styles.composerSendBtnInner}
                  >
                    <Ionicons name="mic" size={22} color="#FFFFFF" />
                  </LinearGradient>
                </TouchableOpacity>
              )}
            </>
          )}
        </View>
      </KeyboardAvoidingView>

      <Modal
        visible={!!actionSheetMsg}
        transparent
        animationType="fade"
        onRequestClose={() => setActionSheetMsg(null)}
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
            onPress={() => setActionSheetMsg(null)}
          >
            <Pressable
              style={styles.dialogCard}
              onPress={(e) => e.stopPropagation()}
            >
              <ActionRow
                icon="arrow-undo-outline"
                label="Reply"
                onPress={() => actionSheetMsg && handleReply(actionSheetMsg)}
              />
              {actionSheetMsg?.message_type === 'text' && (
                <ActionRow
                  icon="copy-outline"
                  label="Copy"
                  onPress={() => actionSheetMsg && handleCopy(actionSheetMsg)}
                />
              )}
              <ActionRow
                icon="pin-outline"
                label={
                  pinnedMessage?.id === actionSheetMsg?.id ? 'Unpin' : 'Pin'
                }
                onPress={() => actionSheetMsg && handlePin(actionSheetMsg)}
              />
              <ActionRow
                icon="trash-outline"
                label="Delete"
                danger
                onPress={() =>
                  actionSheetMsg && handleDeletePress(actionSheetMsg)
                }
              />
            </Pressable>
          </Pressable>
        </BlurView>
      </Modal>

      <Modal
        visible={!!deleteConfirmMsg}
        transparent
        animationType="fade"
        onRequestClose={() => setDeleteConfirmMsg(null)}
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
            onPress={() => setDeleteConfirmMsg(null)}
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
                  size={22}
                  color={COLORS.danger}
                />
              </View>
              <Text style={styles.dialogTitle}>Delete message?</Text>

              <View style={{ paddingHorizontal: 6, marginTop: 2 }}>
                <TouchableOpacity
                  style={styles.deleteOption}
                  onPress={() =>
                    deleteConfirmMsg && deleteForMe(deleteConfirmMsg)
                  }
                  activeOpacity={0.75}
                >
                  <Ionicons name="person-outline" size={18} color="#FFFFFF" />
                  <Text style={styles.deleteOptionText}>Delete for me</Text>
                </TouchableOpacity>

                {deleteConfirmMsg?.sender_id === myId &&
                  !deleteConfirmMsg?.is_deleted && (
                    <TouchableOpacity
                      style={styles.deleteOption}
                      onPress={() =>
                        deleteConfirmMsg && deleteForEveryone(deleteConfirmMsg)
                      }
                      activeOpacity={0.75}
                    >
                      <Ionicons
                        name="people-outline"
                        size={18}
                        color="#FFFFFF"
                      />
                      <Text style={styles.deleteOptionText}>
                        Delete for everyone
                      </Text>
                    </TouchableOpacity>
                  )}
              </View>

              <View style={styles.dialogButtons}>
                <TouchableOpacity
                  style={styles.dialogBtnSecondary}
                  onPress={() => setDeleteConfirmMsg(null)}
                  activeOpacity={0.75}
                >
                  <Text style={styles.dialogBtnSecondaryText}>Cancel</Text>
                </TouchableOpacity>
              </View>
            </Pressable>
          </Pressable>
        </BlurView>
      </Modal>

      {/* ✅ Full-screen photo viewer */}
      <Modal
        visible={!!viewerImage}
        transparent
        animationType="fade"
        onRequestClose={() => setViewerImage(null)}
        statusBarTranslucent
      >
        <View style={styles.viewerWrap}>
          {viewerImage?.media_url && (
            <ScrollView
              style={{ width: screenW, height: screenH }}
              contentContainerStyle={styles.viewerScrollContent}
              maximumZoomScale={4}
              minimumZoomScale={1}
              bouncesZoom
              centerContent
              showsHorizontalScrollIndicator={false}
              showsVerticalScrollIndicator={false}
            >
              <Image
                source={{ uri: viewerImage.media_url }}
                style={{ width: screenW, height: screenH }}
                contentFit="contain"
                cachePolicy="memory-disk"
                transition={120}
              />
            </ScrollView>
          )}

          <SafeAreaView edges={['top']} style={styles.viewerTopBar}>
            <TouchableOpacity
              style={styles.viewerClose}
              onPress={() => setViewerImage(null)}
              activeOpacity={0.7}
              hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
            >
              <Ionicons name="close" size={28} color="#FFFFFF" />
            </TouchableOpacity>
            <View style={{ flex: 1, marginLeft: 6 }}>
              <Text style={styles.viewerTitle} numberOfLines={1}>
                {getSenderName(viewerImage)}
              </Text>
              {!!viewerImage && (
                <Text style={styles.viewerSub} numberOfLines={1}>
                  {new Date(viewerImage.created_at).toLocaleString([], {
                    day: 'numeric',
                    month: 'short',
                    hour: '2-digit',
                    minute: '2-digit',
                  })}
                </Text>
              )}
            </View>
          </SafeAreaView>
        </View>
      </Modal>
    </SafeAreaView>
  );
}

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
  safe: { flex: 1, backgroundColor: COLORS.ink900 },
  loadingWrap: { flex: 1, alignItems: 'center', justifyContent: 'center' },

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

  lockScreenWrap: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 32,
  },
  lockScreenIcon: {
    width: 64,
    height: 64,
    borderRadius: 32,
    backgroundColor: 'rgba(124,92,255,0.15)',
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 16,
  },
  lockScreenTitle: {
    fontSize: 20,
    fontFamily: FONTS.displayBold,
    color: '#FFFFFF',
    marginBottom: 6,
  },
  lockScreenSub: {
    fontSize: 13.5,
    fontFamily: FONTS.body,
    color: COLORS.mistLight,
    textAlign: 'center',
    lineHeight: 19,
    marginBottom: 22,
  },
  lockScreenInput: {
    width: '100%',
    maxWidth: 260,
    backgroundColor: 'rgba(255,255,255,0.05)',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.1)',
    borderRadius: 12,
    paddingHorizontal: 14,
    paddingVertical: 13,
    fontSize: 18,
    fontFamily: FONTS.bodySemiBold,
    color: '#FFFFFF',
    textAlign: 'center',
    letterSpacing: 8,
    marginBottom: 10,
  },
  lockScreenError: {
    fontSize: 13,
    fontFamily: FONTS.bodyMedium,
    color: COLORS.danger,
    textAlign: 'center',
    marginBottom: 10,
  },
  lockScreenButtons: {
    flexDirection: 'row',
    gap: 10,
    width: '100%',
    maxWidth: 260,
    marginTop: 4,
  },
  lockScreenBtnSecondary: {
    flex: 1,
    paddingVertical: 12,
    borderRadius: 12,
    backgroundColor: 'rgba(255,255,255,0.06)',
    alignItems: 'center',
  },
  lockScreenBtnSecondaryText: {
    fontSize: 14.5,
    fontFamily: FONTS.bodySemiBold,
    color: COLORS.mistLight,
  },
  lockScreenBtnPrimary: {
    flex: 1,
    paddingVertical: 12,
    borderRadius: 12,
    backgroundColor: COLORS.violet,
    alignItems: 'center',
  },
  lockScreenBtnPrimaryText: {
    fontSize: 14.5,
    fontFamily: FONTS.bodySemiBold,
    color: '#FFFFFF',
  },

  header: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: SPACING.sm,
    paddingVertical: 8,
    borderBottomWidth: 1,
    borderBottomColor: 'rgba(255,255,255,0.06)',
    backgroundColor: 'rgba(10,12,18,0.95)',
  },
  backBtn: {
    width: 44,
    height: 44,
    borderRadius: 22,
    alignItems: 'center',
    justifyContent: 'center',
  },
  headerCenter: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 4,
    paddingVertical: 2,
    borderRadius: RADII.lg,
  },
  headerNameRow: { flexDirection: 'row', alignItems: 'center' },
  headerName: {
    fontSize: 18,
    fontFamily: FONTS.bodySemiBold,
    color: '#FFFFFF',
    flexShrink: 1,
  },
  headerSub: {
    fontSize: 13,
    fontFamily: FONTS.body,
    color: COLORS.mist,
    marginTop: 1,
  },

  pinBanner: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    paddingHorizontal: 14,
    paddingVertical: 8,
    backgroundColor: '#171A24',
    borderBottomWidth: 1,
    borderBottomColor: 'rgba(124,92,255,0.25)',
  },
  pinBannerIcon: {
    width: 26,
    height: 26,
    borderRadius: 13,
    backgroundColor: 'rgba(124,92,255,0.18)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  pinBannerLabel: {
    fontSize: 10.5,
    fontFamily: FONTS.bodySemiBold,
    color: COLORS.violetLight,
    letterSpacing: 0.5,
    textTransform: 'uppercase',
    marginBottom: 1,
  },
  pinBannerText: {
    fontSize: 13,
    fontFamily: FONTS.body,
    color: COLORS.mistLight,
  },
  pinBannerClose: {
    width: 26,
    height: 26,
    borderRadius: 13,
    alignItems: 'center',
    justifyContent: 'center',
  },

  loadingMoreWrap: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    paddingVertical: 14,
  },
  loadingMoreText: {
    fontSize: 12.5,
    fontFamily: FONTS.body,
    color: COLORS.mist,
  },

  scrollBtnWrap: {
    position: 'absolute',
    right: 14,
    bottom: 14,
    zIndex: 10,
  },
  scrollBtn: {
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: 'rgba(26,29,39,0.95)',
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.14)',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 3 },
    shadowOpacity: 0.35,
    shadowRadius: 8,
    elevation: 6,
  },
  scrollBtnIconWrap: {
    width: 20,
    height: 20,
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: 1,
  },
  scrollBadge: {
    position: 'absolute',
    top: -5,
    right: -5,
    minWidth: 18,
    height: 18,
    borderRadius: 9,
    backgroundColor: COLORS.teal,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 4,
    borderWidth: 2,
    borderColor: COLORS.ink900,
  },
  scrollBadgeText: {
    color: '#0A0C12',
    fontSize: 9.5,
    fontFamily: FONTS.bodySemiBold,
    lineHeight: 11,
  },

  listContent: {
    paddingHorizontal: SPACING.md,
    paddingVertical: SPACING.sm,
    flexGrow: 1,
  },
  emptyWrap: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingTop: 80,
  },
  emptyText: { color: COLORS.mist, fontSize: 16, fontFamily: FONTS.body },

  replyPreview: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    paddingHorizontal: 12,
    paddingVertical: 8,
    backgroundColor: '#131722',
    borderTopWidth: 1,
    borderTopColor: 'rgba(255,255,255,0.06)',
  },
  replyBar: {
    width: 3,
    height: 32,
    borderRadius: 2,
    backgroundColor: COLORS.violetLight,
  },
  replyName: {
    fontSize: 12,
    fontFamily: FONTS.bodySemiBold,
    color: COLORS.violetLight,
  },
  replyText: {
    fontSize: 13,
    fontFamily: FONTS.body,
    color: COLORS.mistLight,
    marginTop: 1,
  },
  replyClose: {
    width: 26,
    height: 26,
    borderRadius: 13,
    alignItems: 'center',
    justifyContent: 'center',
  },

  inputBar: {
    flexDirection: 'row',
    alignItems: 'flex-end', // buttons stay at the bottom when the input grows (WhatsApp)
    paddingHorizontal: 8,
    paddingTop: 6,
    paddingBottom: Platform.OS === 'ios' ? 10 : 6,
    backgroundColor: '#0B0D14',
  },
  composerPill: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'flex-end',
    backgroundColor: '#171A24',
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: 'rgba(255,255,255,0.08)',
    borderRadius: 22,
    paddingHorizontal: 2,
    paddingVertical: 2,
    minHeight: 44,
  },
  composerIconBtn: {
    width: 40,
    height: 40,
    borderRadius: 20,
    alignItems: 'center',
    justifyContent: 'center',
  },
  composerInput: {
    flex: 1,
    minHeight: 40,
    maxHeight: 120,
    paddingHorizontal: 6,
    paddingTop: 10,
    paddingBottom: 10,
    fontSize: 16,
    lineHeight: 20,
    includeFontPadding: false,
    fontFamily: FONTS.body,
    color: '#FFFFFF',
    borderWidth: 0,
    borderColor: 'transparent',
    backgroundColor: 'transparent',
    textAlignVertical: 'center',
    outlineStyle: 'none',
    outlineWidth: 0,
    outlineColor: 'transparent',
    boxShadow: 'none',
  } as any,
  composerSendBtn: {
    width: 44,
    height: 44,
    borderRadius: 22,
    overflow: 'hidden',
    marginLeft: 6,
  },
  composerSendBtnInner: {
    width: 44,
    height: 44,
    alignItems: 'center',
    justifyContent: 'center',
  },

  recordingWrap: {
    flex: 1,
    height: 44,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    paddingHorizontal: 16,
    backgroundColor: 'rgba(239,68,68,0.10)',
    borderRadius: 22,
    borderWidth: 1,
    borderColor: 'rgba(239,68,68,0.25)',
  },
  recordingDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
    backgroundColor: COLORS.danger,
  },
  recordingText: {
    color: COLORS.danger,
    fontSize: 15,
    fontFamily: FONTS.bodyMedium,
  },
  recordingIconBtn: {
    width: 44,
    height: 44,
    borderRadius: 22,
    alignItems: 'center',
    justifyContent: 'center',
    marginLeft: 6,
  },
  recordingSendBtn: {
    width: 44,
    height: 44,
    borderRadius: 22,
    overflow: 'hidden',
    marginLeft: 6,
  },
  recordingSendBtnInner: {
    width: 44,
    height: 44,
    alignItems: 'center',
    justifyContent: 'center',
  },

  blurBackdrop: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.35)',
  },
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
    paddingTop: 12,
    paddingBottom: 10,
    paddingHorizontal: 6,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.09)',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 12 },
    shadowOpacity: 0.5,
    shadowRadius: 24,
    elevation: 16,
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
    marginBottom: 4,
    paddingHorizontal: 8,
  },
  dialogButtons: {
    flexDirection: 'row',
    gap: 10,
    paddingHorizontal: 6,
    marginTop: 6,
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

  actionRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    paddingHorizontal: 14,
    paddingVertical: 11,
    borderRadius: 10,
  },
  actionLabel: {
    fontSize: 15,
    fontFamily: FONTS.bodyMedium,
    color: '#FFFFFF',
  },

  deleteOption: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    paddingHorizontal: 12,
    paddingVertical: 11,
    borderRadius: 10,
  },
  deleteOptionText: {
    fontSize: 15,
    fontFamily: FONTS.bodyMedium,
    color: '#FFFFFF',
  },
  // ✅ Full-screen photo viewer
  viewerWrap: { flex: 1, backgroundColor: '#000' },
  viewerScrollContent: {
    flexGrow: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  viewerTopBar: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 10,
    paddingBottom: 10,
    backgroundColor: 'rgba(0,0,0,0.5)',
  },
  viewerClose: { padding: 4 },
  viewerTitle: {
    fontSize: 16,
    fontFamily: FONTS.bodySemiBold,
    color: '#FFFFFF',
  },
  viewerSub: {
    fontSize: 12,
    fontFamily: FONTS.body,
    color: 'rgba(255,255,255,0.7)',
    marginTop: 1,
  },
});
