// components/MessageBubble.tsx
// Optimized: memoized, voice message support, expo-image with caching

import { memo, useCallback, useMemo } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  ActivityIndicator,
  Platform,
} from 'react-native';
import { Image } from 'expo-image';
import { Ionicons } from '@expo/vector-icons';
import { LinearGradient } from 'expo-linear-gradient';
import { useAudioPlayer, useAudioPlayerStatus } from 'expo-audio';
import { COLORS, FONTS, GRADIENTS, SPACING } from '../constants/theme';

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

type Props = {
  message: Message;
  isMine: boolean;
  prevMessage?: Message;
  nextMessage?: Message;
  myId: string;
};

// ---------- Pure helpers (outside component) ----------
function formatTime(iso: string) {
  const d = new Date(iso);
  const h = d.getHours().toString().padStart(2, '0');
  const m = d.getMinutes().toString().padStart(2, '0');
  return `${h}:${m}`;
}

function dayLabel(iso: string) {
  const d = new Date(iso);
  const now = new Date();
  const startOf = (x: Date) =>
    new Date(x.getFullYear(), x.getMonth(), x.getDate()).getTime();
  const diffDays = Math.round((startOf(now) - startOf(d)) / 86400000);
  if (diffDays === 0) return 'Today';
  if (diffDays === 1) return 'Yesterday';
  if (diffDays < 7) return d.toLocaleDateString([], { weekday: 'long' });
  return d.toLocaleDateString([], { day: 'numeric', month: 'short' });
}

function formatDuration(total: number) {
  const s = Math.max(0, Math.floor(total));
  const m = Math.floor(s / 60).toString().padStart(2, '0');
  const sec = (s % 60).toString().padStart(2, '0');
  return `${m}:${sec}`;
}

// ---------- Voice bubble (own component so it only re-renders when its message changes) ----------
function VoiceBubble({
  url,
  duration,
  isMine,
}: {
  url: string;
  duration: number;
  isMine: boolean;
}) {
  const player = useAudioPlayer(url);
  const status = useAudioPlayerStatus(player);

  const progress =
    status.duration && status.duration > 0
      ? Math.min(1, status.currentTime / status.duration)
      : 0;

  const toggle = useCallback(() => {
    if (status.playing) {
      player.pause();
    } else {
      if (status.didJustFinish || status.currentTime >= (status.duration || 0)) {
        player.seekTo(0);
      }
      player.play();
    }
  }, [player, status.playing, status.didJustFinish, status.currentTime, status.duration]);

  const shownDuration =
    status.playing || status.currentTime > 0
      ? Math.floor(status.currentTime || 0)
      : duration;

  return (
    <View style={[styles.voiceWrap, isMine && styles.voiceWrapMine]}>
      <TouchableOpacity
        onPress={toggle}
        activeOpacity={0.75}
        style={[
          styles.voicePlayBtn,
          isMine ? styles.voicePlayBtnMine : styles.voicePlayBtnOther,
        ]}
      >
        <Ionicons
          name={status.playing ? 'pause' : 'play'}
          size={16}
          color={isMine ? '#FFFFFF' : COLORS.violet}
        />
      </TouchableOpacity>

      <View style={styles.voiceBarWrap}>
        <View
          style={[
            styles.voiceBarBg,
            isMine && styles.voiceBarBgMine,
          ]}
        >
          <View
            style={[
              styles.voiceBarFill,
              { width: `${progress * 100}%` },
              isMine ? styles.voiceBarFillMine : styles.voiceBarFillOther,
            ]}
          />
        </View>
      </View>

      <Text
        style={[
          styles.voiceDuration,
          isMine && styles.voiceDurationMine,
        ]}
      >
        {formatDuration(shownDuration)}
      </Text>
    </View>
  );
}

// ---------- Main component ----------
function MessageBubbleBase({
  message,
  isMine,
  prevMessage,
  nextMessage,
}: Props) {
  // Memoize day labels (heavy computation, doesn't change per render)
  const currentDay = useMemo(
    () => dayLabel(message.created_at),
    [message.created_at]
  );

  const showDayDivider = useMemo(() => {
    if (!prevMessage) return true;
    return dayLabel(prevMessage.created_at) !== currentDay;
  }, [prevMessage, currentDay]);

  const grouped = useMemo(() => {
    if (!prevMessage) return false;
    if (prevMessage.sender_id !== message.sender_id) return false;
    const gap =
      new Date(message.created_at).getTime() -
      new Date(prevMessage.created_at).getTime();
    if (gap >= 2 * 60 * 1000) return false;
    return dayLabel(prevMessage.created_at) === currentDay;
  }, [prevMessage, message.sender_id, message.created_at, currentDay]);

  const nextIsSameSender = useMemo(() => {
    if (!nextMessage) return false;
    if (nextMessage.sender_id !== message.sender_id) return false;
    const gap =
      new Date(nextMessage.created_at).getTime() -
      new Date(message.created_at).getTime();
    if (gap >= 2 * 60 * 1000) return false;
    return dayLabel(nextMessage.created_at) === currentDay;
  }, [nextMessage, message.sender_id, message.created_at, currentDay]);

  const isImage = message.message_type === 'image' && !!message.media_url;
  const isVoice = message.message_type === 'voice' && !!message.media_url;
  const isDeleted = !!message.is_deleted;

  return (
    <>
      {showDayDivider && (
        <View style={styles.dayDividerWrap}>
          <View style={styles.dayDivider}>
            <Text style={styles.dayDividerText}>{currentDay}</Text>
          </View>
        </View>
      )}

      <View
        style={[
          styles.row,
          isMine ? styles.rowMine : styles.rowOther,
          grouped ? styles.rowGrouped : styles.rowSpaced,
        ]}
      >
        <View
          style={[
            styles.bubbleWrap,
            { alignItems: isMine ? 'flex-end' : 'flex-start' },
          ]}
        >
          {isDeleted ? (
            <View
              style={[
                styles.bubble,
                isMine ? styles.bubbleMinePlain : styles.bubbleOther,
                nextIsSameSender &&
                  (isMine
                    ? styles.bubbleMineTightBottom
                    : styles.bubbleOtherTightBottom),
              ]}
            >
              <Text style={styles.deletedText}>This message was deleted</Text>
            </View>
          ) : isImage ? (
            <View style={styles.imageWrap}>
              <Image
                source={{ uri: message.media_url! }}
                style={styles.image}
                contentFit="cover"
                cachePolicy="memory-disk"
                transition={150}
                recyclingKey={message.id}
              />
            </View>
          ) : isVoice ? (
            <View
              style={[
                styles.bubble,
                isMine ? styles.bubbleMinePlain : styles.bubbleOther,
                nextIsSameSender &&
                  (isMine
                    ? styles.bubbleMineTightBottom
                    : styles.bubbleOtherTightBottom),
              ]}
            >
              <VoiceBubble
                url={message.media_url!}
                duration={message.media_duration ?? 0}
                isMine={isMine}
              />
            </View>
          ) : isMine ? (
            <LinearGradient
              colors={GRADIENTS.bubbleMine as any}
              start={{ x: 0, y: 0 }}
              end={{ x: 1, y: 1 }}
              style={[
                styles.bubble,
                styles.bubbleMine,
                nextIsSameSender && styles.bubbleMineTightBottom,
              ]}
            >
              <Text style={styles.text}>{message.content}</Text>
            </LinearGradient>
          ) : (
            <View
              style={[
                styles.bubble,
                styles.bubbleOther,
                nextIsSameSender && styles.bubbleOtherTightBottom,
              ]}
            >
              <Text style={styles.text}>{message.content}</Text>
            </View>
          )}

          <View style={styles.metaRow}>
            <Text style={styles.time}>{formatTime(message.created_at)}</Text>
            {isMine && (
              <Ionicons
                name={message.read_at ? 'checkmark-done' : 'checkmark'}
                size={14}
                color={message.read_at ? '#7DD3FC' : 'rgba(255,255,255,0.55)'}
                style={{ marginLeft: 4 }}
              />
            )}
          </View>
        </View>
      </View>
    </>
  );
}

// ---------- Custom comparator: only re-render if THIS message changed ----------
function areEqual(prev: Props, next: Props) {
  if (prev.message !== next.message) return false;
  if (prev.isMine !== next.isMine) return false;
  if (prev.prevMessage?.id !== next.prevMessage?.id) return false;
  if (prev.nextMessage?.id !== next.nextMessage?.id) return false;
  if (prev.prevMessage?.created_at !== next.prevMessage?.created_at) return false;
  if (prev.nextMessage?.created_at !== next.nextMessage?.created_at) return false;
  if (prev.nextMessage?.sender_id !== next.nextMessage?.sender_id) return false;
  return true;
}

const MessageBubble = memo(MessageBubbleBase, areEqual);
export default MessageBubble;

// ---------- Styles ----------
const styles = StyleSheet.create({
  dayDividerWrap: { alignItems: 'center', marginVertical: SPACING.md },
  dayDivider: {
    paddingHorizontal: 12,
    paddingVertical: 5,
    borderRadius: 999,
    backgroundColor: 'rgba(255,255,255,0.06)',
  },
  dayDividerText: {
    fontSize: 11,
    fontFamily: FONTS.bodySemiBold,
    color: COLORS.mist,
    letterSpacing: 0.5,
    textTransform: 'uppercase',
  },

  row: { flexDirection: 'row' },
  rowMine: { justifyContent: 'flex-end' },
  rowOther: { justifyContent: 'flex-start' },
  rowGrouped: { marginTop: 6 },
  rowSpaced: { marginTop: 16 },

  bubbleWrap: { position: 'relative', maxWidth: '80%' },

  bubble: { paddingHorizontal: 14, paddingVertical: 9, borderRadius: 20 },

  bubbleMine: {
    borderBottomRightRadius: 4,
    shadowColor: '#7C5CFF',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.35,
    shadowRadius: 12,
    elevation: 4,
  },
  bubbleMinePlain: {
    borderBottomRightRadius: 4,
    backgroundColor: '#2A2D3A',
  },
  bubbleMineTightBottom: { borderBottomRightRadius: 6 },
  bubbleOther: {
    backgroundColor: '#171A24',
    borderBottomLeftRadius: 4,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.06)',
  },
  bubbleOtherTightBottom: { borderBottomLeftRadius: 6 },

  text: {
    color: '#FFFFFF',
    fontSize: 16.5,
    fontFamily: FONTS.bodyMedium,
    lineHeight: 23,
  },
  deletedText: {
    color: COLORS.mist,
    fontSize: 13,
    fontFamily: FONTS.body,
    fontStyle: 'italic',
  },

  metaRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginTop: 4,
    marginHorizontal: 4,
  },
  time: {
    fontSize: 11.5,
    fontFamily: FONTS.body,
    color: 'rgba(255,255,255,0.55)',
  },

  // ---------- Image ----------
  imageWrap: {
    borderRadius: 18,
    overflow: 'hidden',
    backgroundColor: 'rgba(255,255,255,0.03)',
  },
  image: { width: 220, height: 220, borderRadius: 16 },

  // ---------- Voice ----------
  voiceWrap: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    minWidth: 180,
    paddingVertical: 2,
  },
  voiceWrapMine: {},
  voicePlayBtn: {
    width: 34,
    height: 34,
    borderRadius: 17,
    alignItems: 'center',
    justifyContent: 'center',
  },
  voicePlayBtnMine: { backgroundColor: 'rgba(255,255,255,0.22)' },
  voicePlayBtnOther: { backgroundColor: 'rgba(124,92,255,0.15)' },
  voiceBarWrap: { flex: 1, minWidth: 80 },
  voiceBarBg: {
    height: 4,
    borderRadius: 2,
    backgroundColor: 'rgba(255,255,255,0.18)',
    overflow: 'hidden',
  },
  voiceBarBgMine: { backgroundColor: 'rgba(255,255,255,0.28)' },
  voiceBarFill: { height: '100%', borderRadius: 2 },
  voiceBarFillMine: { backgroundColor: '#FFFFFF' },
  voiceBarFillOther: { backgroundColor: COLORS.violet },
  voiceDuration: {
    fontSize: 12,
    fontFamily: FONTS.body,
    color: 'rgba(255,255,255,0.75)',
    minWidth: 38,
    textAlign: 'right',
  },
  voiceDurationMine: { color: 'rgba(255,255,255,0.9)' },
});
