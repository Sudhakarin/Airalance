// components/MessageBubble.tsx
// Message bubble — text + image with proper spacing

import { View, Text, Image, StyleSheet } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { LinearGradient } from 'expo-linear-gradient';
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

export default function MessageBubble({
  message,
  isMine,
  prevMessage,
  nextMessage,
}: Props) {
  const sameSenderAsPrev =
    !!prevMessage && prevMessage.sender_id === message.sender_id;
  const sameDayAsPrev =
    !!prevMessage &&
    dayLabel(prevMessage.created_at) === dayLabel(message.created_at);

  const timeGapMs = prevMessage
    ? new Date(message.created_at).getTime() -
      new Date(prevMessage.created_at).getTime()
    : Infinity;
  const withinTimeGap = timeGapMs < 2 * 60 * 1000;

  const showDayDivider =
    !prevMessage ||
    dayLabel(prevMessage.created_at) !== dayLabel(message.created_at);

  const grouped = sameSenderAsPrev && sameDayAsPrev && withinTimeGap;

  const nextIsSameSender =
    !!nextMessage &&
    nextMessage.sender_id === message.sender_id &&
    dayLabel(nextMessage.created_at) === dayLabel(message.created_at) &&
    new Date(nextMessage.created_at).getTime() -
      new Date(message.created_at).getTime() <
      2 * 60 * 1000;

  const isImage = message.message_type === 'image' && !!message.media_url;
  const isDeleted = !!message.is_deleted;

  return (
    <>
      {showDayDivider && (
        <View style={styles.dayDividerWrap}>
          <View style={styles.dayDivider}>
            <Text style={styles.dayDividerText}>
              {dayLabel(message.created_at)}
            </Text>
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
            { maxWidth: '80%', alignItems: isMine ? 'flex-end' : 'flex-start' },
          ]}
        >
          {isMine ? (
            isImage ? (
              <View style={styles.imageWrapMine}>
                <Image
                  source={{ uri: message.media_url! }}
                  style={styles.image}
                  resizeMode="cover"
                />
              </View>
            ) : (
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
                {isDeleted ? (
                  <Text style={styles.deletedText}>
                    This message was deleted
                  </Text>
                ) : (
                  <Text style={styles.text}>{message.content}</Text>
                )}
              </LinearGradient>
            )
          ) : (
            <View
              style={[
                styles.bubble,
                styles.bubbleOther,
                isImage && !isDeleted && styles.bubbleOtherImage,
                nextIsSameSender && styles.bubbleOtherTightBottom,
              ]}
            >
              {isDeleted ? (
                <Text style={styles.deletedText}>
                  This message was deleted
                </Text>
              ) : isImage ? (
                <Image
                  source={{ uri: message.media_url! }}
                  style={styles.image}
                  resizeMode="cover"
                />
              ) : (
                <Text style={styles.text}>{message.content}</Text>
              )}
            </View>
          )}

          {/* ✅ Time ab bubble ke NICHE */}
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

const styles = StyleSheet.create({
  dayDividerWrap: {
    alignItems: 'center',
    marginVertical: SPACING.md,
  },
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

  // ✅ FIXED: har bubble ke beech visible gap — grouped messages bhi ab chipakte nahi
  rowGrouped: { marginTop: 6 },
  rowSpaced: { marginTop: 16 },

  bubbleWrap: { position: 'relative' },

  bubble: {
    paddingHorizontal: 14,
    paddingVertical: 9,
    borderRadius: 20,
  },
  bubbleMine: {
    borderBottomRightRadius: 4,
    shadowColor: '#7C5CFF',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.35,
    shadowRadius: 12,
    elevation: 4,
  },
  bubbleMineTightBottom: { borderBottomRightRadius: 6 },
  bubbleOther: {
    backgroundColor: '#171A24',
    borderBottomLeftRadius: 4,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.06)',
  },
  bubbleOtherTightBottom: { borderBottomLeftRadius: 6 },
  bubbleOtherImage: { padding: 3, borderRadius: 18 },

  // ✅ FIXED: message font thoda mota (Medium weight) + size 15 -> 16
  text: {
    color: '#FFFFFF',
    fontSize: 16,
    fontFamily: FONTS.bodyMedium,
    lineHeight: 22,
  },
  deletedText: {
    color: COLORS.mist,
    fontSize: 13,
    fontFamily: FONTS.body,
    fontStyle: 'italic',
  },

  // time bubble ke niche — mine: right side, other: left side (bubbleWrap alignItems se)
  metaRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginTop: 4,
    marginHorizontal: 4,
  },
  time: {
    fontSize: 11,
    fontFamily: FONTS.body,
    color: 'rgba(255,255,255,0.55)',
  },

  imageWrapMine: {
    borderRadius: 18,
    overflow: 'hidden',
    padding: 3,
    backgroundColor: 'rgba(124,92,255,0.15)',
  },
  image: {
    width: 220,
    height: 220,
    borderRadius: 16,
  },
});
