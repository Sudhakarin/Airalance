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
                  <Text
