// app/chat/[id].tsx
// Chat screen — messages, realtime, send, typing, images, voice, actions, reactions + cache + pagination

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
} from 'react-native';
import { BlurView } from 'expo-blur';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { LinearGradient } from 'expo-linear-gradient';
import * as ImagePicker from 'expo-image-picker';
import * as Clipboard from 'expo-clipboard';
import AsyncStorage from '@react-native-async-storage/async-storage';
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
import Avatar from '../../components/Avatar';
import MessageBubble from '../../components/MessageBubble';
import VerifiedBadge from '../../components/VerifiedBadge';

type Message = {
  id: string;
  conversation_id: string;
  sender_id: string;
  content: string;
  created_at: string;
  read_at: string | null;
  message_type: 'text' | 'image' | 'voice';
  media_url: string | null;
  media_duration: number | null;
  reply_to_id: string | null;
  is_deleted: boolean | null;
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
const MESSAGES_CACHE_LIMIT = 40;
const CACHE_TTL_MS = 1000 * 60 * 60 * 24 * 7;

function messagesCacheKey(convoId: string) {
  return `airalance:messages:${convoId}`;
}

type MessagesCache = {
  t: number;
  messages: Message[];
  hiddenIds: string[];
};

async function readMessagesCache(convoId: string): Promise<MessagesCache | null> {
  try {
    const raw = await AsyncStorage.getItem(messagesCacheKey(convoId));
    if (!raw) return null;
    const parsed = JSON.parse(raw) as MessagesCache;
    if (!parsed?.messages || !Array.isArray(parsed.messages)) return null;
    if (Date.now() - (parsed.t ?? 0) > CACHE_TTL_MS) return null;
    return parsed;
  } catch {
    return null;
  }
}

async function writeMessagesCache(
  convoId: string,
  messages: Message[],
  hiddenIds: string[]
) {
  try {
    const cleaned = messages
      .filter((m) => !m.id.startsWith('temp-'))
      .slice(-MESSAGES_CACHE_LIMIT);
    const payload: MessagesCache = {
      t: Date.now(),
      messages: cleaned,
      hiddenIds,
    };
    await AsyncStorage.setItem(messagesCacheKey(convoId), JSON.stringify(payload));
  } catch {}
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
  replyMessage,
  reactions,
}: {
  item: Message;
  isMine: boolean;
  prevMessage?: Message;
  nextMessage?: Message;
  myId: string;
  onLongPress: (msg: Message) => void;
  onDoubleTap: (msg: Message) => void;
  replyMessage?: Message | null;
  reactions: Reaction[];
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
      replyMessage={replyMessage}
      reactions={reactions}
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

  // ✅ Pagination state
  const [loadingMore, setLoadingMore] = useState(false);
  const [hasMore, setHasMore] = useState(true);
  const loadingMoreRef = useRef(false);

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

  const audioRecorder = useAudioRecorder(RecordingPresets.HIGH_QUALITY);
  const recorderState = useAudioRecorderState(audioRecorder, 100);
  const [isRecording, setIsRecording] = useState(false);

  const visibleMessages = messages.filter((m) => !hiddenForMeIds.has(m.id));

  useEffect(() => {
    Animated.timing(scrollBtnAnim, {
      toValue: showScrollBtn ? 1 : 0,
      duration: 180,
      useNativeDriver: true,
    }).start();
  }, [showScrollBtn, scrollBtnAnim]);

  useEffect(() => {
    if (!convoId) return;
    let cancelled = false;
    (async () => {
      const cache = await readMessagesCache(convoId);
      if (cancelled || !cache) return;
      if (cache.messages.length > 0) {
        setMessages(cache.messages);
        setHiddenForMeIds(new Set(cache.hiddenIds ?? []));
        setLoading(false);
        prevMsgCountRef.current = cache.messages.length;
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [convoId]);

  useEffect(() => {
    if (!convoId) return;
    if (messages.length === 0 && hiddenForMeIds.size === 0) return;
    const timer = setTimeout(() => {
      writeMessagesCache(convoId, messages, Array.from(hiddenForMeIds));
    }, 400);
    return () => clearTimeout(timer);
  }, [messages, hiddenForMeIds, convoId]);

  useEffect(() => {
    let mounted = true;

    async function bootstrap() {
      const { data: authData } = await supabase.auth.getUser();
      if (!authData.user || !mounted) return;
      const uid = authData.user.id;
      setMyId(uid);

      const [profileRes, otherRes, msgRes, pinsRes, delRes] = await Promise.all([
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
      ]);

      if (!mounted) return;
      if (profileRes.data?.display_name) setMyName(profileRes.data.display_name);
      if (otherRes.data?.[0])
        setOther((otherRes.data[0] as any).profiles as OtherProfile);

      const msgs = msgRes.data;
      if (msgs) {
        const ordered = [...msgs].reverse() as Message[];
        setMessages(ordered);
        prevMsgCountRef.current = ordered.length;
        // ✅ Has more if we got exactly a full page
        setHasMore(msgs.length === PAGE_SIZE);

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

        await writeMessagesCache(convoId, ordered, Array.from(hiddenIds));

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
      setLoading(false);
    }

    bootstrap();
    return () => {
      mounted = false;
    };
  }, [convoId]);

  useEffect(() => {
    initialScrollDoneRef.current = false;
  }, [convoId]);

  // ✅ Auto-scroll to bottom on initial load
  useEffect(() => {
    if (loading) return;
    if (visibleMessages.length === 0) return;
    if (initialScrollDoneRef.current) return;
    const t = setTimeout(() => {
      flatListRef.current?.scrollToEnd({ animated: false });
      initialScrollDoneRef.current = true;
      isNearBottomRef.current = true;
    }, 60);
    return () => clearTimeout(t);
  }, [loading, visibleMessages.length]);

  // ✅ Load older messages (pagination)
  const loadOlderMessages = useCallback(async () => {
    if (!myId || !convoId) return;
    if (loadingMoreRef.current || !hasMore) return;

    // Oldest loaded message (cursor)
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

      // Fetch reactions for older messages
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
  }, [myId, convoId, hasMore, messages]);

  useEffect(() => {
    if (!myId || !convoId) return;

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
  }, [myId, convoId]);

  useEffect(() => {
    if (!other?.id) return;
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
  }, [other?.id]);

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

    // ✅ Trigger load more when near top
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

  function handleReply(msg: Message) {
    setActionSheetMsg(null);
    setReplyingTo(msg);
    setTimeout(() => inputRef.current?.focus(), 150);
  }

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
      Alert.alert('Copied', 'Message copied to clipboard.');
    } catch {
      Alert.alert('Copy failed', 'Please try again.');
    }
  }

  async function handlePin(msg: Message) {
    setActionSheetMsg(null);
    if (!myId || !convoId) return;

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
      setPinnedMessage(msg);
    } catch (err) {
      console.warn('Pin failed:', err);
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
      Alert.alert('Failed', 'Please try again.');
    }
  }

  async function deleteForEveryone(msg: Message) {
    if (!myId) return;
    if (msg.sender_id !== myId) {
      Alert.alert('Cannot delete', 'You can only delete your own messages for everyone.');
      setDeleteConfirmMsg(null);
      return;
    }
    setDeleteConfirmMsg(null);
    try {
      await supabase
        .from('messages')
        .update({ is_deleted: true })
        .eq('id', msg.id);
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
      message_type: 'text',
      media_url: null,
      media_duration: null,
      reply_to_id: replyTarget?.id ?? null,
      is_deleted: false,
    };
    setMessages((prev) => [...prev, optimistic]);

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

    if (error || !inserted) {
      setMessages((prev) => prev.filter((m) => m.id !== tempId));
      setInput(content);
      setReplyingTo(replyTarget);
      Alert.alert('Failed to send', 'Please try again.');
      setSending(false);
      return;
    }

    setMessages((prev) => {
      if (prev.some((m) => m.id === (inserted as Message).id))
        return prev.filter((m) => m.id !== tempId);
      return prev.map((m) => (m.id === tempId ? (inserted as Message) : m));
    });

    requestAnimationFrame(() => {
      flatListRef.current?.scrollToEnd({ animated: true });
    });

    if (other?.id) triggerPushNotification(other.id, content, 'text');
    setSending(false);
  }

  async function pickImage() {
    if (!myId || !convoId || uploading) return;
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
      const ext = (asset.uri.split('.').pop() ?? 'jpg').toLowerCase().slice(0, 5);
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
        setMessages((prev) =>
          prev.some((m) => m.id === (inserted as Message).id)
            ? prev
            : [...prev, inserted as Message]
        );
        setReplyingTo(null);
        if (other?.id) triggerPushNotification(other.id, '', 'image');
      }
    } catch (err: any) {
      console.warn('Image upload error:', err);
      Alert.alert('Upload failed', err?.message ?? 'Please try again.');
    } finally {
      setUploading(false);
    }
  }

  async function startRecording() {
    if (isRecording) return;
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
      setIsRecording(true);
    } catch (err) {
      console.warn('Recording start error:', err);
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
        setMessages((prev) =>
          prev.some((m) => m.id === (inserted as Message).id)
            ? prev
            : [...prev, inserted as Message]
        );
        setReplyingTo(null);
        if (other?.id) triggerPushNotification(other.id, '', 'voice');
      }
    } catch (err: any) {
      console.warn('Voice send error:', err);
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
          replyMessage={replyMsg}
          reactions={reactionsByMsg[item.id] ?? []}
        />
      );
    },
    [
      visibleMessages,
      messages,
      myId,
      handleMessageLongPress,
      handleDoubleTap,
      reactionsByMsg,
    ]
  );

  const recordSeconds = Math.floor((recorderState.durationMillis ?? 0) / 1000);

  if (loading || !myId) {
    return (
      <SafeAreaView style={styles.safe} edges={['top', 'bottom']}>
        <View style={styles.loadingWrap}>
          <ActivityIndicator color={COLORS.violet} />
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
            />
            <View style={{ marginLeft: 12, flex: 1 }}>
              <View style={styles.headerNameRow}>
                <Text style={styles.headerName} numberOfLines={1}>
                  {other?.display_name ?? 'Unknown'}
                </Text>
                {other?.verified && <VerifiedBadge size={15} />}
              </View>
              <Text style={styles.headerSub} numberOfLines={1}>
                {peerTyping ? (
                  <Text style={{ color: COLORS.teal }}>typing…</Text>
                ) : otherOnline ? (
                  <Text style={{ color: COLORS.teal }}>Active now</Text>
                ) : (
                  formatLastSeen(other?.last_seen)
                )}
              </Text>
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
          <FlatList
            ref={flatListRef}
            data={visibleMessages}
            keyExtractor={keyExtractor}
            renderItem={renderItem}
            contentContainerStyle={styles.listContent}
            onScroll={onScroll}
            scrollEventThrottle={100}
            onContentSizeChange={onContentSizeChange}
            initialNumToRender={20}
            maxToRenderPerBatch={12}
            windowSize={11}
            updateCellsBatchingPeriod={50}
            removeClippedSubviews={Platform.OS === 'android'}
            keyboardShouldPersistTaps="handled"
            // ✅ Prevents scroll jump when older messages are prepended
            maintainVisibleContentPosition={{
              minIndexForVisible: 0,
              autoscrollToTopThreshold: 10,
            }}
            onScrollToIndexFailed={(info) => {
              setTimeout(() => {
                flatListRef.current?.scrollToEnd({ animated: true });
              }, 200);
            }}
            // ✅ Loading indicator at top when fetching older messages
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
                  <Ionicons name="image-outline" size={24} color={COLORS.mist} />
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
                  style={styles.composerIconBtn}
                  onPress={startRecording}
                  activeOpacity={0.7}
                >
                  <Ionicons name="mic-outline" size={24} color={COLORS.mist} />
                </TouchableOpacity>
              )}
            </View>
          )}
        </View>
      </KeyboardAvoidingView>

      {/* Action Menu — with Android blur fix */}
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

      {/* Delete Confirm — with Android blur fix */}
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

  // ---------- Loading older messages indicator ----------
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

  // ---------- Scroll-to-bottom button ----------
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
    alignItems: 'center',
    paddingHorizontal: 10,
    paddingTop: 8,
    paddingBottom: Platform.OS === 'ios' ? 12 : 8,
    borderTopWidth: 1,
    borderTopColor: 'rgba(255,255,255,0.06)',
    backgroundColor: '#0B0D14',
  },
  composerPill: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#171A24',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.08)',
    borderRadius: 28,
    paddingHorizontal: 4,
    paddingVertical: 4,
    minHeight: 54,
  },
  composerIconBtn: {
    width: 46,
    height: 46,
    borderRadius: 23,
    alignItems: 'center',
    justifyContent: 'center',
  },
  composerInput: {
    flex: 1,
    minHeight: 46,
    maxHeight: 120,
    paddingHorizontal: 8,
    paddingTop: 10,
    paddingBottom: 10,
    fontSize: 17,
    lineHeight: 22,
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
  },
  composerSendBtnInner: {
    width: 44,
    height: 44,
    alignItems: 'center',
    justifyContent: 'center',
  },

  recordingWrap: {
    flex: 1,
    height: 54,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    paddingHorizontal: 16,
    backgroundColor: 'rgba(239,68,68,0.10)',
    borderRadius: 28,
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

  // ---------- Blur backdrop with Android fallback ----------
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
});
