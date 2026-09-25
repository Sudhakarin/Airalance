// app/chat/[id].tsx
// Chat screen — messages, realtime, send, typing, images, voice (optimized)

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
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { LinearGradient } from 'expo-linear-gradient';
import * as ImagePicker from 'expo-image-picker';
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

// ---------- Memoized row (only re-renders when its own message changes) ----------
const MessageRow = memo(function MessageRow({
  item,
  isMine,
  prevMessage,
  nextMessage,
  myId,
}: {
  item: Message;
  isMine: boolean;
  prevMessage?: Message;
  nextMessage?: Message;
  myId: string;
}) {
  return (
    <MessageBubble
      message={item}
      isMine={isMine}
      prevMessage={prevMessage}
      nextMessage={nextMessage}
      myId={myId}
    />
  );
});

export default function ChatScreen() {
  const router = useRouter();
  const params = useLocalSearchParams<{ id: string }>();
  const convoId = params.id;

  const [myId, setMyId] = useState<string | null>(null);
  const [myName, setMyName] = useState<string>(''); // cached for push notifications
  const [other, setOther] = useState<OtherProfile | null>(null);
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState('');
  const [loading, setLoading] = useState(true);
  const [sending, setSending] = useState(false);
  const [peerTyping, setPeerTyping] = useState(false);
  const [otherOnline, setOtherOnline] = useState(false);
  const [uploading, setUploading] = useState(false);

  const flatListRef = useRef<FlatList<Message>>(null);
  const channelRef = useRef<any>(null);
  const typingTimeoutRef = useRef<any>(null);
  const lastTypingSentRef = useRef(0);
  const inputRef = useRef<TextInput>(null);
  const prevMsgCountRef = useRef(0);
  const isNearBottomRef = useRef(true);

  const audioRecorder = useAudioRecorder(RecordingPresets.HIGH_QUALITY);
  const recorderState = useAudioRecorderState(audioRecorder, 100);
  const [isRecording, setIsRecording] = useState(false);

  // ---------- Bootstrap (parallel fetches) ----------
  useEffect(() => {
    let mounted = true;

    async function bootstrap() {
      const { data: authData } = await supabase.auth.getUser();
      if (!authData.user || !mounted) return;
      const uid = authData.user.id;
      setMyId(uid);

      // Parallel: fetch my name + other participant + initial messages
      const [profileRes, otherRes, msgRes] = await Promise.all([
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
          .limit(CONSTANTS.PAGE_SIZE),
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

        // Mark all incoming unread as read
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
      }
      setLoading(false);
    }

    bootstrap();
    return () => {
      mounted = false;
    };
  }, [convoId]);

  // ---------- Realtime ----------
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
      .subscribe();

    channelRef.current = channel;

    return () => {
      if (typingTimeoutRef.current) clearTimeout(typingTimeoutRef.current);
      supabase.removeChannel(channel);
      channelRef.current = null;
    };
  }, [myId, convoId]);

  // ---------- Presence polling (only while screen is open) ----------
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
    const interval = setInterval(check, 20000); // 20s instead of 15s
    return () => {
      cancelled = true;
      clearInterval(interval);
    };
  }, [other?.id]);

  // ---------- Smart scroll: only when a NEW message arrives ----------
  useEffect(() => {
    const count = messages.length;
    const prevCount = prevMsgCountRef.current;
    if (count > prevCount && prevCount > 0) {
      // Only auto-scroll if user was near the bottom
      if (isNearBottomRef.current) {
        requestAnimationFrame(() => {
          flatListRef.current?.scrollToEnd({ animated: true });
        });
      }
    } else if (prevCount === 0 && count > 0) {
      // First load — jump to end
      setTimeout(() => {
        flatListRef.current?.scrollToEnd({ animated: false });
      }, 40);
    }
    prevMsgCountRef.current = count;
  }, [messages.length]);

  function onScroll(e: any) {
    const { contentOffset, contentSize, layoutMeasurement } = e.nativeEvent;
    const distanceFromBottom =
      contentSize.height - contentOffset.y - layoutMeasurement.height;
    isNearBottomRef.current = distanceFromBottom < 120;
  }

  // ---------- Web height (kept) ----------
  useEffect(() => {
    if (Platform.OS !== 'web') return;
    const el: any = inputRef.current;
    if (!el || !el.style) return;
    el.style.height = 'auto';
    const next = Math.min(Math.max(el.scrollHeight, 48), 120);
    el.style.height = `${next}px`;
  }, [input, isRecording]);

  // ---------- Push (uses cached myName — no DB hit per message) ----------
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

  // ---------- Input + typing ----------
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

  // ---------- Send text ----------
  async function sendMessage() {
    const content = input.trim();
    if (!content || !myId || !convoId || sending) return;

    setSending(true);
    setInput('');
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
      reply_to_id: null,
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
      })
      .select()
      .single();

    if (error || !inserted) {
      setMessages((prev) => prev.filter((m) => m.id !== tempId));
      setInput(content);
      Alert.alert('Failed to send', 'Please try again.');
      setSending(false);
      return;
    }

    setMessages((prev) => {
      if (prev.some((m) => m.id === (inserted as Message).id))
        return prev.filter((m) => m.id !== tempId);
      return prev.map((m) => (m.id === tempId ? (inserted as Message) : m));
    });

    if (other?.id) triggerPushNotification(other.id, content, 'text');
    setSending(false);
  }

  // ---------- Pick image ----------
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
        if (other?.id) triggerPushNotification(other.id, '', 'image');
      }
    } catch (err: any) {
      console.warn('Image upload error:', err);
      Alert.alert('Upload failed', err?.message ?? 'Please try again.');
    } finally {
      setUploading(false);
    }
  }

  // ---------- Voice ----------
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

  // ---------- Stable callbacks for FlatList ----------
  const keyExtractor = useCallback((item: Message) => item.id, []);

  const renderItem = useCallback(
    ({ item, index }: { item: Message; index: number }) => {
      const prev = messages[index - 1];
      const next = messages[index + 1];
      return (
        <MessageRow
          item={item}
          isMine={item.sender_id === myId}
          prevMessage={prev}
          nextMessage={next}
          myId={myId!}
        />
      );
    },
    [messages, myId]
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

        <FlatList
          ref={flatListRef}
          data={messages}
          keyExtractor={keyExtractor}
          renderItem={renderItem}
          contentContainerStyle={styles.listContent}
          onScroll={onScroll}
          scrollEventThrottle={100}
          // ---------- Performance ----------
          initialNumToRender={20}
          maxToRenderPerBatch={12}
          windowSize={11}
          updateCellsBatchingPeriod={50}
          removeClippedSubviews={Platform.OS === 'android'}
          keyboardShouldPersistTaps="handled"
          // ---------------------------------
          ListEmptyComponent={
            <View style={styles.emptyWrap}>
              <Text style={styles.emptyText}>
                No messages yet — say hello 👋
              </Text>
            </View>
          }
        />

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
    </SafeAreaView>
  );
}

// ---------- Styles (unchanged) ----------
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
});
