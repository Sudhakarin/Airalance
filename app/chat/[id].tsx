// app/chat/[id].tsx
// Chat screen — messages, realtime, send, typing, images, voice (expo-audio)

import { useEffect, useState, useRef } from 'react';
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

export default function ChatScreen() {
  const router = useRouter();
  const params = useLocalSearchParams<{ id: string }>();
  const convoId = params.id;

  const [myId, setMyId] = useState<string | null>(null);
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

  // === Voice recording ===
  const audioRecorder = useAudioRecorder(RecordingPresets.HIGH_QUALITY);
  const recorderState = useAudioRecorderState(audioRecorder, 100);
  const [isRecording, setIsRecording] = useState(false);

  // === Bootstrap ===
  useEffect(() => {
    let mounted = true;

    async function bootstrap() {
      const { data: authData } = await supabase.auth.getUser();
      if (!authData.user || !mounted) return;
      setMyId(authData.user.id);

      const { data: others } = await supabase
        .from('conversation_participants')
        .select('user_id, profiles(*)')
        .eq('conversation_id', convoId)
        .neq('user_id', authData.user.id)
        .limit(1);

      if (mounted && others && others[0]) {
        setOther((others[0] as any).profiles);
      }

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

      if (authData.user.id && msgs) {
        const unreadIds = msgs
          .filter(
            (m: any) => m.sender_id !== authData.user!.id && !m.read_at
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

  // === Realtime ===
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

  // === Online status ===
  useEffect(() => {
    if (!other?.id) return;
    const check = async () => {
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
    };
    check();
    const interval = setInterval(check, 15000);
    return () => clearInterval(interval);
  }, [other?.id]);

  // === Scroll to bottom ===
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

  // === Send text ===
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

  const recordSeconds = Math.floor((recorderState.durationMillis ?? 0) / 1000);

  // === Render ===
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
            onPress={() => other && router.push(`/profile/${other.id}`)}
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
                {other?.verified && <VerifiedBadge size={14} />}
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

        {/* Composer */}
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
                <Ionicons name="close" size={20} color={COLORS.danger} />
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
                  <Ionicons name="send" size={16} color="#FFFFFF" />
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
                  <Ionicons name="image-outline" size={22} color={COLORS.mist} />
                )}
              </TouchableOpacity>

              <TextInput
                style={[styles.composerInput, { fontSize: 20, lineHeight: 25 }]}
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
                      <Ionicons name="send" size={16} color="#FFFFFF" />
                    )}
                  </LinearGradient>
                </TouchableOpacity>
              ) : (
                <TouchableOpacity
                  style={styles.composerIconBtn}
                  onPress={startRecording}
                  activeOpacity={0.7}
                >
                  <Ionicons name="mic-outline" size={22} color={COLORS.mist} />
                </TouchableOpacity>
              )}
            </View>
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

  // === Messages list ===
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

  // === Input bar ===
  inputBar: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 10,
    paddingTop: 8,
    paddingBottom: Platform.OS === 'ios' ? 14 : 10,
    borderTopWidth: 1,
    borderTopColor: 'rgba(255,255,255,0.06)',
    backgroundColor: '#0B0D14',
  },

  // === Composer pill ===
  composerPill: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#171A24',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.08)',
    borderRadius: 26,
    paddingHorizontal: 4,
    paddingVertical: 4,
    minHeight: 52,
  },
  composerIconBtn: {
    width: 44,
    height: 44,
    borderRadius: 22,
    alignItems: 'center',
    justifyContent: 'center',
  },
  // ✅ FIXED: text bada + composer ke hisaab se sahi line height
  composerInput: {
    flex: 1,
    minHeight: 44,
    maxHeight: 100,
    paddingHorizontal: 8,
    paddingVertical: 8,
    fontSize: 19,
    lineHeight: 24,
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
    width: 42,
    height: 42,
    borderRadius: 21,
    overflow: 'hidden',
  },
  composerSendBtnInner: {
    width: 42,
    height: 42,
    alignItems: 'center',
    justifyContent: 'center',
  },

  // === Recording mode ===
  recordingWrap: {
    flex: 1,
    height: 52,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    paddingHorizontal: 16,
    backgroundColor: 'rgba(239,68,68,0.10)',
    borderRadius: 26,
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
  recordingIconBtn: {
    width: 42,
    height: 42,
    borderRadius: 21,
    alignItems: 'center',
    justifyContent: 'center',
    marginLeft: 6,
  },
  recordingSendBtn: {
    width: 42,
    height: 42,
    borderRadius: 21,
    overflow: 'hidden',
    marginLeft: 6,
  },
  recordingSendBtnInner: {
    width: 42,
    height: 42,
    alignItems: 'center',
    justifyContent: 'center',
  },
});
