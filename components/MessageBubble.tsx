// components/MessageBubble.tsx
// Individual message bubble with read ticks, images, voice, deleted state

import { useState } from 'react';
import {
  View,
  Text,
  Image,
  TouchableOpacity,
  StyleSheet,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { Audio } from 'expo-av';
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

function formatDuration(totalSeconds: number) {
  const s = Math.max(0, Math.floor(totalSeconds));
  const m = Math.floor(s / 60).toString().padStart(2, '0');
  const sec = (s % 60).toString().padStart(2, '0');
  return `${m}:${sec}`;
}

function dayLabel(iso: string) {
  const d = new Date(iso);
  const now = new Date();
  const startOf = (x: Date) =>
    new Date(x.getFullYear(), x.getMonth(), x.getDate()).getTime();
  const diffDays = Math.round(
    (startOf(now) - startOf(d)) / 86400000
  );
  if (diffDays === 0) return 'Today';
  if (diffDays === 1) return 'Yesterday';
  if (diffDays < 7)
    return d.toLocaleDateString([], { weekday: 'long' });
  return d.toLocaleDateString([], {
    day: 'numeric',
    month: 'short',
  });
}

export default function MessageBubble({
  message,
  isMine,
  prevMessage,
  nextMessage,
  myId,
}: Props) {
  const [voicePlaying, setVoicePlaying] = useState(false);
  const [sound, setSound] = useState<Audio.Sound | null>(null);
  const [progress, setProgress] = useState(0);

  // Group consecutive messages
  const sameSenderAsPrev =
    prevMessage && prevMessage.sender_id === message.sender_id;
  const sameSenderAsNext =
    nextMessage && nextMessage.sender_id === message.sender_id;
  const sameDayAsPrev =
    prevMessage &&
    dayLabel(prevMessage.created_at) === dayLabel(message.created_at);

  const showDayDivider =
    !prevMessage ||
    dayLabel(prevMessage.created_at) !== dayLabel(message.created_at);

  const grouped = sameSenderAsPrev && sameDayAsPrev;

  const isImage = message.message_type === 'image' && message.media_url;
  const isVoice = message.message_type === 'voice' && message.media_url;
  const isDeleted = !!message.is_deleted;

  // Voice play toggle
  async function toggleVoice() {
    if (!message.media_url) return;
    try {
      if (sound && voicePlaying) {
        await sound.pauseAsync();
        setVoicePlaying(false);
        return;
      }
      if (sound) {
        await sound.playAsync();
        setVoicePlaying(true);
        return;
      }
      const { sound: newSound } = await Audio.Sound.createAsync(
        { uri: message.media_url },
        { shouldPlay: true }
      );
      setSound(newSound);
      setVoicePlaying(true);
      newSound.setOnPlaybackStatusUpdate((status: any) => {
        if (status.isLoaded) {
          if (status.durationMillis) {
            setProgress(status.positionMillis / status.durationMillis);
          }
          if (status.didJustFinish) {
            setVoicePlaying(false);
            setProgress(0);
            newSound.unloadAsync();
            setSound(null);
          }
        }
      });
    } catch (e) {
      console.warn('Voice play error:', e);
    }
  }

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
          grouped ? { marginTop: 2 } : { marginTop: 10 },
        ]}
      >
        <View
          style={[
            styles.bubbleWrap,
            { maxWidth: '80%' },
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
                  grouped && styles.bubbleMineGrouped,
                  nextMessage &&
                    nextMessage.sender_id === message.sender_id &&
                    styles.bubbleMineTightBottom,
                ]}
              >
                {isDeleted ? (
                  <Text style={styles.deletedText}>
                    This message was deleted
                  </Text>
                ) : isVoice ? (
                  <TouchableOpacity
                    style={styles.voiceRow}
                    onPress={toggleVoice}
                    activeOpacity={0.8}
                  >
                    <Ionicons
                      name={voicePlaying ? 'pause' : 'play'}
                      size={16}
                      color="#FFFFFF"
                    />
                    <View style={styles.voiceBar}>
                      <View
                        style={[
                          styles.voiceBarFill,
                          { width: `${progress * 100}%` },
                        ]}
                      />
                    </View>
                    <Text style={styles.voiceTime}>
                      {formatDuration(message.media_duration ?? 0)}
                    </Text>
                  </TouchableOpacity>
                ) : (
                  <Text style={styles.text}>{message.content}</Text>
                )}
                <View style={styles.metaRow}>
                  <Text style={styles.time}>
                    {formatTime(message.created_at)}
                  </Text>
                  {isMine && (
                    <Ionicons
                      name={
                        message.read_at
                          ? 'checkmark-done'
                          : 'checkmark'
                      }
                      size={14}
                      color={
                        message.read_at ? '#7DD3FC' : 'rgba(255,255,255,0.7)'
                      }
                      style={{ marginLeft: 4 }}
                    />
                  )}
                </View>
              </LinearGradient>
            )
          ) : (
            <View
              style={[
                styles.bubble,
                styles.bubbleOther,
                grouped && styles.bubbleOtherGrouped,
                nextMessage &&
                  nextMessage.sender_id === message.sender_id &&
                  styles.bubbleOtherTightBottom,
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
              ) : isVoice ? (
                <TouchableOpacity
                  style={styles.voiceRow}
                  onPress={toggleVoice}
                  activeOpacity={0.8}
                >
                  <Ionicons
                    name={voicePlaying ? 'pause' : 'play'}
                    size={16}
                    color={COLORS.text}
                  />
                  <View style={styles.voiceBar}>
                    <View
                      style={[
                        styles.voiceBarFillOther,
                        { width: `${progress * 100}%` },
                      ]}
                    />
                  </View>
                  <Text
                    style={[styles.voiceTime, { color: COLORS.mist }]}
                  >
                    {formatDuration(message.media_duration ?? 0)}
                  </Text>
                </TouchableOpacity>
              ) : (
                <Text style={styles.text}>{message.content}</Text>
              )}
              <View style={styles.metaRow}>
                <Text style={styles.time}>
                  {formatTime(message.created_at)}
                </Text>
              </View>
            </View>
          )}

          {/* Image time overlay */}
          {isImage && (
            <View style={styles.imageTimeWrap}>
              <Text style={styles.imageTime}>
                {formatTime(message.created_at)}
              </Text>
              {isMine && (
                <Ionicons
                  name={message.read_at ? 'checkmark-done' : 'checkmark'}
                  size={14}
                  color={message.read_at ? '#7DD3FC' : '#FFFFFF'}
                  style={{ marginLeft: 4 }}
                />
              )}
            </View>
          )}
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
  bubbleMineGrouped: {},
  bubbleMineTightBottom: { borderBottomRightRadius: 6 },
  bubbleOther: {
    backgroundColor: '#171A24',
    borderBottomLeftRadius: 4,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.06)',
  },
  bubbleOtherGrouped: {},
  bubbleOtherTightBottom: { borderBottomLeftRadius: 6 },

  text: {
    color: '#FFFFFF',
    fontSize: 15,
    fontFamily: FONTS.body,
    lineHeight: 20,
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
    justifyContent: 'flex-end',
    marginTop: 2,
  },
  time: {
    fontSize: 10,
    fontFamily: FONTS.body,
    color: 'rgba(255,255,255,0.65)',
  },

  // Image
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
  imageTimeWrap: {
    position: 'absolute',
    bottom: 8,
    right: 10,
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 999,
    backgroundColor: 'rgba(0,0,0,0.45)',
  },
  imageTime: {
    fontSize: 10,
    color: '#FFFFFF',
    fontFamily: FONTS.body,
  },

  // Voice
  voiceRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    minWidth: 180,
  },
  voiceBar: {
    flex: 1,
    height: 4,
    borderRadius: 999,
    backgroundColor: 'rgba(255,255,255,0.25)',
    overflow: 'hidden',
  },
  voiceBarFill: {
    height: 4,
    backgroundColor: '#FFFFFF',
    borderRadius: 999,
  },
  voiceBarFillOther: {
    height: 4,
    backgroundColor: COLORS.violetLight,
    borderRadius: 999,
  },
  voiceTime: {
    fontSize: 11,
    fontFamily: FONTS.body,
    color: 'rgba(255,255,255,0.85)',
    minWidth: 34,
    textAlign: 'right',
  },
});
