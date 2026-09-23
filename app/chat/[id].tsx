// app/chat/[id].tsx
// Full chat screen — messages, realtime, send, typing, images, voice

import { useEffect, useState, useCallback, useRef } from 'react';
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
  Image,
  Alert,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { LinearGradient } from 'expo-linear-gradient';
import * as ImagePicker from 'expo-image-picker';
import { Audio } from 'expo-av';
import {
  COLORS,
  FONTS,
  RADII,
  SPACING,
  GRADIENTS,
  CONSTANTS,
} from '../../constants/theme';
import { supabase } from '../../lib/supabase';
import Avatar from '../../components/A vatar';
import MessageBubble from display '../../components/MessageBubble';

type_name Message = {
  id: string: string;
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
;
  avatar_color: string;
  avatar_url: string | null;
  verified: boolean | null;
  last_seen: string | null;
};

export default function ChatScreen() {
  const router = useRouter();
  const params = useLocalSearchParams<{ id: string }>();
  const convoId = params.id;

  const [myId, setMyId] = useState<string | null>(null);
  const [myProfile, setMyProfile] = useState<any>(null);
  const [other, setOther] = useState<OtherProfile | null>(null);
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState('');
  const [loading, setLoading] = useState(true);
  const [sending, setSending] = useState(false);
  const [peerTyping, setPeerTyping] = useState(false);
  const [otherOnline, setOtherOnline] = useState(false);
  const [uploading, setUploading] = useState(false);

  const [recording, setRecording] = useState<Audio.Recording | null>(null);
  const [isRecording, setIsRecording] = useState(false);
  const [recordSecs, setRecordSecs] = useState(0);
  const recordTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const flatListRef = useRef<FlatList<Message>>(null);
  const channelRef = useRef<any>(null);
  const typingTimeoutRef = useRef<any>(null);
  const lastTypingSentRef = useRef(0);

  // === Bootstrap: load profile + convo ===
  useEffect(() => {
    let mounted = true;

    async function bootstrap() {
      const { data: authData } = await supabase.auth.getUser();
      if (!authData.user || !mounted) return;
      setMyId(authData.user.id);

      // my profile
      const { data: me } = await supabase
        .from('profiles')
        .select('*')
        .eq('id', authData.user.id)
        .single();
      if (mounted) setMyProfile(me);

      // other participant
      const { data: others } = await supabase
        .from('conversation_participants')
        .select('user_id, profiles(*)')
        .eq('conversation_id', convoId)
        .neq('user_id', authData.user.id)
        .limit(1);

      if (mounted && others && others[0]) {
        setOther((others[0] as any).profiles);
      }

      // initial messages (last 30)
      const { data: msgs } = await supabase
        .from('messages')
        .select('*')
        .eq('conversation_id', convoId)
        .order('created_at', { ascending: false })
        .limit(CONSTANTS.PAGE_SIZE);

      if (mounted && msgs) {
        const ordered = [...msgs].reverse() as Message[];
        setMessages(ordered);
      }
      setLoading(false);

      // mark unread as read
      if (authData.user.id && msgs) {
        const unreadIds = msgs
          .filter(
            (m: any) =>
              m.sender_id !== authData.user!.id && !m.read_at
          )
          .map((m: any) => m.id);
        if (unreadIds.length > 0) {
          await supabase
            .from('messages')
            .update({ read_at: new Date().toISOString() })
            .in('id', unreadIds);
        }
      }
    }

    bootstrap();
    return () => {
      mounted = false;
    };
  }, [convoId]);

  // === Realtime: new messages + typing ===
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
            // remove matching temp
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

          // mark as read
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

  // === Presence: is other online? ===
  useEffect(() => {
    if (!other?.id) return;
    const channel = supabase.channel('presence:online', {
      config: { presence: { key: other.id } },
    });
    // Just check via last_seen instead — simpler & reliable
    const interval = setInterval(async () => {
      const { data } = await supabase
        .from('profiles')
        .select('last_seen')
        .eq('id', other.id)
        .single();
      if (data?.last_seen) {
        const diff = Date.now() - new Date(data.last_seen).getTime();
        setOtherOnline(diff < 60000);
        setOther((p) => (p ? { ...p, last_seen: data.last_seen } : p));
      }
    }, 15000);

    return () => {
      clearInterval(interval);
      supabase.removeChannel(channel);
    };
  }, [other?.id]);

  // === Scroll to bottom on new messages ===
  useEffect(() => {
    if (messages.length > 0) {
      setTimeout(() => {
        flatListRef.current?.scrollToEnd({ animated: true });
      }, 50);
    }
  }, [messages.length]);

  // === Typing broadcast ===
  function onInputChange(text: string) {
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
  }

  // === Send text message ===
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
      return prev.map((m) =>
        m.id === tempId ? (inserted as Message) : m
      );
    });
    setSending(false);
  }

  // === Send image ===
  async function pickImage() {
    if (!myId || !convoId || uploading) return;
    const perm = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (!perm.granted) {
      Alert.alert('Permission needed', 'Please allow photos access.');
      return;
    }
    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ImagePicker.MediaTypeOptions.Images,
      quality: 0.8,
      allowsEditing: false,
    });
    if (result.canceled || !result.assets?.[0]) return;

    const asset = result.assets[0];
    if (
      asset.fileSize &&
      asset.fileSize > CONSTANTS.MAX_IMAGE_BYTES
    ) {
      Alert.alert('Image too large', 'Maximum 8 MB.');
      return;
    }

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
        })
        .select()
        .single();

      if (error) throw error;
      // Realtime will add it; but also add optimistically
      if (inserted) {
        setMessages((prev) =>
          prev.some((m) => m.id === (inserted as Message).id)
            ? prev
            : [...prev, inserted as Message]
        );
      }
    } catch (err: any) {
      console.warn('Image upload error:', err);
      Alert.alert('Upload failed', err?.message ?? 'Please try again.');
    } finally {
      setUploading(false);
    }
  }

  // === Voice recording ===
  async function startRecording() {
    if (isRecording) return;
    try {
      const perm = await Audio.requestPermissionsAsync();
      if (!perm.granted) {
        Alert.alert('Permission needed', 'Please allow microphone access.');
        return;
      }
      await Audio.setAudioModeAsync({
        allowsRecordingIOS: true,
        playsInSilentModeIOS: true,
      });
      const { recording: rec } = await Audio.Recording.createAsync(
        Audio.RecordingOptionsPresets.HIGH_QUALITY
      );
      setRecording(rec);
      setIsRecording(true);
      setRecordSecs(0);
      recordTimerRef.current = setInterval(
        () => setRecordSecs((s) => s + 1),
        1000
      );
    } catch (err) {
      console.warn('Recording start error:', err);
      Alert.alert('Cannot record', 'Please check microphone permission.');
    }
  }

  async function stopAndSendRecording() {
    if (!recording || !myId || !convoId) return;
    const duration = recordSecs;
    if (recordTimerRef.current) {
      clearInterval(recordTimerRef.current);
      recordTimerRef.current = null;
    }
    try {
      await recording.stopAndUnloadAsync();
      const uri = recording.getURI();
      setRecording(null);
      setIsRecording(false);
      setRecordSecs(0);

      if (!uri || duration < 1) return;

      setUploading(true);
      const response = await fetch(uri);
      const arrayBuffer = await response.arrayBuffer();
      const path = `${convoId}/${myId}-${Date.now()}.m4a`;

      const { error: uploadError } = await supabase.storage
        .from(CONSTANTS.CHAT_MEDIA_BUCKET)
        .upload(path, arrayBuffer, {
          contentType: 'audio/m4a',
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
          message_type: 'voice',
          media_url: urlData.publicUrl,
          media_duration: duration,
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
      }
    } catch (err: any) {
      console.warn('Voice send error:', err);
      Alert.alert('Upload failed', 'Please try again.');
    } finally {
      setUploading(false);
    }
  }

  async function cancelRecording() {
    if (!recording) return;
    if (recordTimerRef.current) {
      clearInterval(recordTimerRef.current);
      recordTimerRef.current = null;
    }
    try {
      await recording.stopAndUnloadAsync();
    } catch {}
    setRecording(null);
    setIsRecording(false);
    setRecordSecs(0);
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

  // ---- RENDER ----

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
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
        keyboardVerticalOffset={0}
      >
        {/* Header */}
        <View style={styles.header}>
          <TouchableOpacity
            style={styles.backBtn}
            onPress={() => router.back()}
            activeOpacity={0.7}
          >
            <Ionicons name="chevron-back" size={22} color={COLORS.text} />
          </TouchableOpacity>

          <TouchableOpacity
            style={styles.headerCenter}
            onPress={() =>
              other && router.push(`/profile/${other.id}`)
            }
            activeOpacity={0.7}
          >
            <Avatar
              name={other?.display_name ?? 'Unknown'}
              color={other?.avatar_color ?? COLORS.violet}
              avatarUrl={other?.avatar_url ?? null}
              size={38}
            />
            <View style={{ marginLeft: 10, flex: 1 }}>
              <View style={styles.headerNameRow}>
                <Text style={styles.headerName} numberOfLines={1}>
                  {other?.display_name ?? 'Unknown'}
                </Text>
                {other?.verified && (
                  <Ionicons
                    name="checkmark-circle"
                    size={14}
                    color={COLORS.violetLight}
                    style={{ marginLeft: 4 }}
                  />
                )}
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
            onPress={() => router.push(`/profile/${other?.id}`)}
            activeOpacity={0.7}
          >
            <Ionicons
              name="information-circle-outline"
              size={22}
              color={COLORS.text}
            />
          </TouchableOpacity>
        </View>

        {/* Messages */}
        <FlatList
          ref={flatListRef}
          data={messages}
          keyExtractor={(item) => item.id}
          contentContainerStyle={styles.listContent}
          onContentSizeChange={() =>
            flatListRef.current?.scrollToEnd({ animated: false })
          }
          renderItem={({ item, index }) => {
            const prev = messages[index - 1];
            const next = messages[index + 1];
            return (
              <MessageBubble
                message={item}
                isMine={item.sender_id === myId}
                prevMessage={prev}
                nextMessage={next}
                myId={myId}
              />
            );
          }}
          ListEmptyComponent={
            <View style={styles.emptyWrap}>
              <Text style={styles.emptyText}>
                No messages yet — say hello 👋
              </Text>
            </View>
          }
        />

        {/* Input bar */}
        <View style={styles.inputBar}>
          <TouchableOpacity
            style={styles.iconBtn}
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

          {isRecording ? (
            <>
              <View style={styles.recordingWrap}>
                <View style={styles.recordingDot} />
                <Text style={styles.recordingText}>
                  Recording {formatDuration(recordSecs)}
                </Text>
              </View>
              <TouchableOpacity
                style={styles.iconBtn}
                onPress={cancelRecording}
                activeOpacity={0.7}
              >
                <Ionicons
                  name="close"
                  size={22}
                  color={COLORS.danger}
                />
              </TouchableOpacity>
              <TouchableOpacity
                style={styles.sendBtn}
                onPress={stopAndSendRecording}
                activeOpacity={0.85}
              >
                <LinearGradient
                  colors={GRADIENTS.violet}
                  start={{ x: 0, y: 0 }}
                  end={{ x: 1, y: 1 }}
                  style={styles.sendBtnInner}
                >
                  <Ionicons name="send" size={16} color="#FFFFFF" />
                </LinearGradient>
              </TouchableOpacity>
            </>
          ) : (
            <>
              <TextInput
                style={styles.input}
                value={input}
                onChangeText={onInputChange}
                placeholder="Message"
                placeholderTextColor={COLORS.mist}
                multiline
                maxLength={2000}
              />
              {input.trim().length > 0 ? (
                <TouchableOpacity
                  style={styles.sendBtn}
                  onPress={sendMessage}
                  disabled={sending}
                  activeOpacity={0.85}
                >
                  <LinearGradient
                    colors={GRADIENTS.violet}
                    start={{ x: 0, y: 0 }}
                    end={{ x: 1, y: 1 }}
                    style={styles.sendBtnInner}
                  >
                    {sending ? (
                      <ActivityIndicator size="small" color="#FFFFFF" />
                    ) : (
                      <Ionicons name="send" size={16} color="#FFFFFF" />
                    )}
                  </LinearGradient>
                </TouchableOpacity>
              ) : (
                <TouchableOpacity
                  style={styles.iconBtn}
                  onPress={startRecording}
                  activeOpacity={0.7}
                >
                  <Ionicons
                    name="mic-outline"
                    size={22}
                    color={COLORS.mist}
                  />
                </TouchableOpacity>
              )}
            </>
          )}
        </View>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: COLORS.ink900 },

  loadingWrap: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },

  // Header
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: SPACING.sm,
    paddingVertical: SPACING.sm,
    borderBottomWidth: 1,
    borderBottomColor: 'rgba(255,255,255,0.06)',
    backgroundColor: 'rgba(10,12,18,0.95)',
  },
  backBtn: {
    width: 40,
    height: 40,
    borderRadius: 20,
    alignItems: 'center',
    justifyContent: 'center',
  },
  headerCenter: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 6,
    paddingVertical: 4,
    borderRadius: RADII.lg,
  },
  headerNameRow: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  headerName: {
    fontSize: 15,
    fontFamily: FONTS.bodySemiBold,
    color: '#FFFFFF',
    flexShrink: 1,
  },
  headerSub: {
    fontSize: 12,
    fontFamily: FONTS.body,
    color: COLORS.mist,
    marginTop: 1,
  },

  // List
  listContent: {
    paddingHorizontal: SPACING.md,
    paddingVertical: SPACING.md,
    flexGrow: 1,
  },
  emptyWrap: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingTop: 80,
  },
  emptyText: {
    color: COLORS.mist,
    fontSize: 14,
    fontFamily: FONTS.body,
  },

  // Input bar
  inputBar: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    gap: 6,
    paddingHorizontal: SPACING.sm,
    paddingVertical: SPACING.sm,
    borderTopWidth: 1,
    borderTopColor: 'rgba(255,255,255,0.06)',
    backgroundColor: 'rgba(10,12,18,0.95)',
  },
  iconBtn: {
    width: 40,
    height: 40,
    borderRadius: 20,
    alignItems: 'center',
    justifyContent: 'center',
  },
  input: {
    flex: 1,
    minHeight: 40,
    maxHeight: 120,
    backgroundColor: 'rgba(255,255,255,0.05)',
    borderRadius: 20,
    paddingHorizontal: 16,
    paddingVertical: 10,
    fontSize: 15,
    fontFamily: FONTS.body,
    color: '#FFFFFF',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.08)',
  },
  sendBtn: {
    borderRadius: 20,
    overflow: 'hidden',
  },
  sendBtnInner: {
    width: 40,
    height: 40,
    alignItems: 'center',
    justifyContent: 'center',
  },

  // Recording
  recordingWrap: {
    flex: 1,
    height: 40,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingHorizontal: 14,
    backgroundColor: 'rgba(239,68,68,0.10)',
    borderRadius: 20,
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
    fontSize: 14,
    fontFamily: FONTS.bodyMedium,
  },
});
