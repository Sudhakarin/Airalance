// components/MessageBubble.tsx
// Double-tap heart reaction + reaction pills + haptics + entrance animation
// + swipe-to-reply + voice waveform + delivery ticks + WhatsApp-style call bubbles

import { memo, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  Animated,
  Easing,
} from 'react-native';
import { Swipeable } from 'react-native-gesture-handler';
import { Image } from 'expo-image';
import { Ionicons } from '@expo/vector-icons';
import { LinearGradient } from 'expo-linear-gradient';
import { useAudioPlayer, useAudioPlayerStatus } from 'expo-audio';
import { COLORS, FONTS, GRADIENTS, SPACING } from '../constants/theme';
import { hapticMedium } from '../lib/haptics';

type Message = {
  id: string;
  conversation_id: string;
  sender_id: string;
  content: string;
  created_at: string;
  read_at: string | null;
  delivered_at?: string | null;
  message_type: 'text' | 'image' | 'voice' | 'call';
  media_url: string | null;
  media_duration: number | null;
  reply_to_id: string | null;
  is_deleted: boolean | null;
};

type Reaction = {
  id: string;
  message_id: string;
  user_id: string;
  emoji: string;
};

type Props = {
  message: Message;
  isMine: boolean;
  prevMessage?: Message;
  nextMessage?: Message;
  myId: string;
  onLongPress?: (msg: Message) => void;
  onDoubleTap?: (msg: Message) => void;
  onSwipeReply?: (msg: Message) => void;
  onImagePress?: (msg: Message) => void;
  replyMessage?: Message | null;
  reactions?: Reaction[];
  animate?: boolean;
};

const DOUBLE_TAP_MS = 300;
const WAVE_BAR_COUNT = 32;
const SWIPE_ICON_SIZE = 36;

// ---------- Pure helpers ----------
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

// WhatsApp-style call duration: "45 sec" / "44 min" / "2 hr 15 min"
function formatCallDuration(total: number) {
  const s = Math.max(0, Math.floor(total));
  if (s < 60) return `${s} sec`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m} min`;
  const h = Math.floor(m / 60);
  const rm = m % 60;
  return rm > 0 ? `${h} hr ${rm} min` : `${h} hr`;
}

function replyPreviewText(msg: Message): string {
  if (msg.is_deleted) return 'This message was deleted';
  if (msg.message_type === 'image') return '📷 Photo';
  if (msg.message_type === 'voice') return '🎤 Voice message';
  if (msg.message_type === 'call') return '📞 Call';
  return msg.content || '';
}

function generateWaveform(seed: string, count = WAVE_BAR_COUNT): number[] {
  let hash = 0;
  for (let i = 0; i < seed.length; i++) {
    hash = (hash << 5) - hash + seed.charCodeAt(i);
    hash |= 0;
  }
  const bars: number[] = [];
  let state = Math.abs(hash) || 1;
  for (let i = 0; i < count; i++) {
    state = (state * 9301 + 49297) % 233280;
    const r = state / 233280;
    const shaped = 0.25 + Math.pow(r, 0.7) * 0.75;
    bars.push(shaped);
  }
  return bars;
}

// ============================================================
// ✅ Delivery ticks — WhatsApp-style 3 states
// ============================================================
function DeliveryTicks({ message }: { message: Message }) {
  const isRead = !!message.read_at;
  const isDelivered = !!message.delivered_at || isRead;

  if (isRead) {
    return (
      <Ionicons
        name="checkmark-done"
        size={15}
        color="#7DD3FC"
        style={{ marginLeft: 4 }}
      />
    );
  }

  if (isDelivered) {
    return (
      <Ionicons
        name="checkmark-done"
        size={15}
        color="rgba(255,255,255,0.65)"
        style={{ marginLeft: 4 }}
      />
    );
  }

  return (
    <Ionicons
      name="checkmark"
      size={14}
      color="rgba(255,255,255,0.55)"
      style={{ marginLeft: 4 }}
    />
  );
}

// ============================================================
// ✅ Call bubble — WhatsApp-style, premium version
// ============================================================
type CallStatus = 'answered' | 'missed' | 'declined' | 'cancelled';

function CallBubble({
  callType,
  status,
  durationSeconds,
  isMine,
  time,
}: {
  callType: 'audio' | 'video';
  status: CallStatus;
  durationSeconds: number;
  isMine: boolean;
  time: string;
}) {
  const isMissed = status === 'missed';
  const isDeclined = status === 'declined';
  const isCancelled = status === 'cancelled';
  const isAnswered = status === 'answered';

  // ---------- Icon color (matches status) ----------
  let iconColor = '#FFFFFF';
  let iconBg = 'rgba(255,255,255,0.22)';

  if (!isMine) {
    if (isMissed) {
      iconColor = '#EF4444';
      iconBg = 'rgba(239,68,68,0.16)';
    } else if (isDeclined) {
      iconColor = '#F97316';
      iconBg = 'rgba(249,115,22,0.16)';
    } else if (isCancelled) {
      iconColor = COLORS.mist;
      iconBg = 'rgba(139,143,163,0.18)';
    } else {
      iconColor = COLORS.teal;
      iconBg = 'rgba(34,211,184,0.16)';
    }
  }

  // ---------- Title ----------
  const baseTitle = callType === 'video' ? 'Video call' : 'Voice call';
  let title = baseTitle;
  if (isMissed && !isMine) title = `Missed ${baseTitle.toLowerCase()}`;
  else if (isDeclined && !isMine) title = `Declined ${baseTitle.toLowerCase()}`;

  // ---------- Subtitle ----------
  let subtitle = '';
  if (isAnswered) subtitle = formatCallDuration(durationSeconds);
  else if (isMissed) subtitle = isMine ? 'No answer' : 'Tap to call back';
  else if (isDeclined) subtitle = isMine ? 'Declined' : 'You declined';
  else if (isCancelled) subtitle = 'Cancelled';

  // ---------- Direction arrow ----------
  // Outgoing → ↗ badge. Incoming missed → ↙ badge. Incoming answered/declined → no badge.
  const showArrow = isMine || (isMissed && !isMine);
  const arrowName: any = isMine ? 'arrow-up' : 'arrow-down';

  // ---------- Icon glyph ----------
  const glyphName: any = callType === 'video' ? 'videocam' : 'call';

  return (
    <View
      style={[
        styles.callBubble,
        isMine ? styles.callBubbleMine : styles.callBubbleOther,
      ]}
    >
      {/* Icon circle with optional direction arrow badge */}
      <View style={styles.callIconSlot}>
        <View style={[styles.callIconCircle, { backgroundColor: iconBg }]}>
          <Ionicons name={glyphName} size={20} color={iconColor} />
        </View>
        {showArrow && (
          <View style={[styles.callArrowBadge, { backgroundColor: iconBg }]}>
            <Ionicons name={arrowName} size={9} color={iconColor} />
          </View>
        )}
      </View>

      {/* Text column */}
      <View style={styles.callTextCol}>
        <Text style={styles.callTitle} numberOfLines={1}>
          {title}
        </Text>
        <View style={styles.callSubRow}>
          <Text
            style={[
              styles.callSubtitle,
              isMine && styles.callSubtitleMine,
            ]}
            numberOfLines={1}
          >
            {subtitle}
          </Text>
          <Text
            style={[styles.callTime, isMine && styles.callTimeMine]}
            numberOfLines={1}
          >
            {time}
          </Text>
        </View>
      </View>
    </View>
  );
}

// ---------- Voice bubble with waveform ----------
function VoiceBubble({
  url,
  duration,
  isMine,
  messageId,
}: {
  url: string;
  duration: number;
  isMine: boolean;
  messageId: string;
}) {
  const player = useAudioPlayer(url);
  const status = useAudioPlayerStatus(player);

  const progress =
    status.duration && status.duration > 0
      ? Math.min(1, status.currentTime / status.duration)
      : 0;

  const bars = useMemo(
    () => generateWaveform(messageId, WAVE_BAR_COUNT),
    [messageId]
  );

  const activeCount = Math.round(progress * bars.length);

  const toggle = useCallback(() => {
    if (status.playing) {
      player.pause();
    } else {
      if (
        status.duration &&
        status.duration > 0 &&
        status.currentTime >= status.duration - 0.15
      ) {
        player.seekTo(0);
      }
      player.play();
    }
  }, [player, status.playing, status.currentTime, status.duration]);

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

      <View style={styles.waveWrap}>
        {bars.map((h, i) => {
          const active = i < activeCount;
          const barHeight = 4 + h * 18;
          return (
            <View
              key={i}
              style={[
                styles.waveBar,
                {
                  height: barHeight,
                  backgroundColor: isMine
                    ? active
                      ? '#FFFFFF'
                      : 'rgba(255,255,255,0.35)'
                    : active
                    ? COLORS.violet
                    : 'rgba(124,92,255,0.28)',
                },
              ]}
            />
          );
        })}
      </View>

      <Text
        style={[styles.voiceDuration, isMine && styles.voiceDurationMine]}
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
  myId,
  onLongPress,
  onDoubleTap,
  onSwipeReply,
  onImagePress,
  replyMessage,
  reactions,
  animate = false,
}: Props) {
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

  const isCall = message.message_type === 'call';
  const isImage = message.message_type === 'image' && !!message.media_url;
  const isVoice = message.message_type === 'voice' && !!message.media_url;
  const isDeleted = !!message.is_deleted;

  // ✅ Parse call log content JSON
  const callData = useMemo(() => {
    if (message.message_type !== 'call') return null;
    try {
      const parsed = JSON.parse(message.content || '{}');
      const ct = parsed.call_type === 'video' ? 'video' : 'audio';
      const st = ['answered', 'missed', 'declined', 'cancelled'].includes(
        parsed.status
      )
        ? (parsed.status as CallStatus)
        : ('answered' as CallStatus);
      const dur =
        typeof parsed.duration_seconds === 'number'
          ? parsed.duration_seconds
          : 0;
      return { callType: ct as 'audio' | 'video', status: st, duration: dur };
    } catch {
      return null;
    }
  }, [message.message_type, message.content]);

  const hasReply =
    !!replyMessage &&
    !!message.reply_to_id &&
    !isDeleted &&
    replyMessage.id === message.reply_to_id;

  const replyName = replyMessage
    ? replyMessage.sender_id === myId
      ? 'You'
      : 'Them'
    : '';

  const enterAnim = useRef(new Animated.Value(animate ? 0 : 1)).current;
  const hasAnimatedRef = useRef(!animate);

  useEffect(() => {
    if (animate && !hasAnimatedRef.current) {
      hasAnimatedRef.current = true;
      Animated.timing(enterAnim, {
        toValue: 1,
        duration: 220,
        useNativeDriver: true,
        easing: Easing.out(Easing.cubic),
      }).start();
    }
  }, [animate, enterAnim]);

  const enterStyle = useMemo(
    () => ({
      opacity: enterAnim,
      transform: [
        {
          translateY: enterAnim.interpolate({
            inputRange: [0, 1],
            outputRange: [10, 0],
          }),
        },
        {
          scale: enterAnim.interpolate({
            inputRange: [0, 1],
            outputRange: [0.97, 1],
          }),
        },
      ],
    }),
    [enterAnim]
  );

  const swipeableRef = useRef<any>(null);

  const [bubbleCenterY, setBubbleCenterY] = useState<number | null>(null);

  const handleBubbleLayout = useCallback((e: any) => {
    const { y, height } = e.nativeEvent.layout;
    const center = y + height / 2;
    setBubbleCenterY((prev) =>
      prev !== null && Math.abs(prev - center) < 0.5 ? prev : center
    );
  }, []);

  const renderLeftActions = useCallback(
    () => (
      <View style={styles.swipeLeftAction}>
        <View
          style={[
            styles.swipeReplyIcon,
            {
              marginTop:
                bubbleCenterY !== null
                  ? Math.max(0, bubbleCenterY - SWIPE_ICON_SIZE / 2)
                  : 0,
            },
          ]}
        >
          <Ionicons name="arrow-undo" size={18} color={COLORS.violetLight} />
        </View>
      </View>
    ),
    [bubbleCenterY]
  );

  const handleSwipeOpen = useCallback(() => {
    if (isDeleted || isCall) return;
    hapticMedium();
    onSwipeReply?.(message);
    swipeableRef.current?.close();
  }, [isDeleted, isCall, onSwipeReply, message]);

  const lastTapRef = useRef<number>(0);
  const imageTapTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const clearImageTapTimer = useCallback(() => {
    if (imageTapTimerRef.current) {
      clearTimeout(imageTapTimerRef.current);
      imageTapTimerRef.current = null;
    }
  }, []);

  useEffect(() => clearImageTapTimer, [clearImageTapTimer]);

  const handlePress = useCallback(() => {
    if (isDeleted) return;
    // Call messages: tap does nothing (no reaction, no image open)
    if (isCall) return;
    const now = Date.now();
    if (now - lastTapRef.current < DOUBLE_TAP_MS) {
      lastTapRef.current = 0;
      clearImageTapTimer();
      hapticMedium();
      onDoubleTap?.(message);
    } else {
      lastTapRef.current = now;
      if (isImage && onImagePress) {
        clearImageTapTimer();
        imageTapTimerRef.current = setTimeout(() => {
          imageTapTimerRef.current = null;
          lastTapRef.current = 0;
          onImagePress(message);
        }, DOUBLE_TAP_MS);
      }
    }
  }, [
    isDeleted,
    isCall,
    isImage,
    onDoubleTap,
    onImagePress,
    message,
    clearImageTapTimer,
  ]);

  const handleLongPress = useCallback(() => {
    lastTapRef.current = 0;
    clearImageTapTimer();
    hapticMedium();
    onLongPress?.(message);
  }, [onLongPress, message, clearImageTapTimer]);

  const groupedReactions = useMemo(() => {
    if (!reactions || reactions.length === 0) return [];
    const map: Record<string, { count: number; mine: boolean }> = {};
    for (const r of reactions) {
      if (!map[r.emoji]) map[r.emoji] = { count: 0, mine: false };
      map[r.emoji].count += 1;
      if (r.user_id === myId) map[r.emoji].mine = true;
    }
    return Object.entries(map).map(([emoji, info]) => ({
      emoji,
      count: info.count,
      mine: info.mine,
    }));
  }, [reactions, myId]);

  return (
    <>
      {showDayDivider && (
        <View style={styles.dayDividerWrap}>
          <View style={styles.dayDivider}>
            <Text style={styles.dayDividerText}>{currentDay}</Text>
          </View>
        </View>
      )}

      <Swipeable
        ref={swipeableRef}
        renderLeftActions={renderLeftActions}
        onSwipeableWillOpen={handleSwipeOpen}
        leftThreshold={60}
        overshootLeft={false}
        friction={2}
        enabled={!isDeleted && !isCall}
        containerStyle={[
          styles.swipeContainer,
          grouped ? styles.rowGrouped : styles.rowSpaced,
        ]}
      >
        <Animated.View
          style={[
            styles.row,
            isMine ? styles.rowMine : styles.rowOther,
            enterStyle,
          ]}
        >
          <TouchableOpacity
            activeOpacity={0.92}
            onPress={handlePress}
            onLongPress={handleLongPress}
            delayLongPress={350}
            style={[
              styles.bubbleWrap,
              { alignItems: isMine ? 'flex-end' : 'flex-start' },
              isCall && styles.bubbleWrapCall,
            ]}
          >
            {hasReply && replyMessage && (
              <View
                style={[
                  styles.quotedWrap,
                  isMine ? styles.quotedWrapMine : styles.quotedWrapOther,
                ]}
              >
                <View style={styles.quotedBar} />
                <View style={{ flex: 1, minWidth: 0 }}>
                  <Text style={styles.quotedName} numberOfLines={1}>
                    {replyName}
                  </Text>
                  <Text
                    style={[
                      styles.quotedText,
                      isMine && styles.quotedTextMine,
                    ]}
                    numberOfLines={1}
                  >
                    {replyPreviewText(replyMessage)}
                  </Text>
                </View>
              </View>
            )}

            <View
              style={{ position: 'relative' }}
              onLayout={handleBubbleLayout}
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
                  <Text style={styles.deletedText}>
                    This message was deleted
                  </Text>
                </View>
              ) : isCall && callData ? (
                /* ✅ WhatsApp-style call bubble */
                <CallBubble
                  callType={callData.callType}
                  status={callData.status}
                  durationSeconds={callData.duration}
                  isMine={isMine}
                  time={formatTime(message.created_at)}
                />
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
                    messageId={message.id}
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
            </View>

            {/* ✅ Meta row (time + ticks) — hidden for call bubbles
                because time is already inside the call bubble */}
            {!isCall && (
              <View style={styles.metaRow}>
                <Text style={styles.time}>
                  {formatTime(message.created_at)}
                </Text>
                {isMine && <DeliveryTicks message={message} />}
              </View>
            )}

            {!isCall && groupedReactions.length > 0 && (
              <View style={styles.reactionsRow}>
                {groupedReactions.map((r) => (
                  <View
                    key={r.emoji}
                    style={[
                      styles.reactionPill,
                      r.mine && styles.reactionPillMine,
                    ]}
                  >
                    <Text style={styles.reactionEmoji}>{r.emoji}</Text>
                    {r.count > 1 && (
                      <Text style={styles.reactionCount}>{r.count}</Text>
                    )}
                  </View>
                ))}
              </View>
            )}
          </TouchableOpacity>
        </Animated.View>
      </Swipeable>
    </>
  );
}

function areEqual(prev: Props, next: Props) {
  if (prev.message !== next.message) return falseply;
  if (prevMessage.isMine !== next.is?.Mine) return false;
  if (previd.animate !== next.animate) return false);
  if (prev.prevMessage return?.id !== next.prevMessage?. falseid) return false;
  if (;
prev.nextMessage?.id !== next.next Message?.id) return false;
  if ( ifprev.prevMessage?.created_at !== next.prev (Message?.created_at)
    return false;
prev  if (prev.nextMessage?.created.re_at !== next.nextMessage?.created_at)
ply    return false;
  if (prevMessage.nextMessage?.sender_id !== next.nextMessage?.sender_id) return false?.;
  if (prev.replyMessage?.idcontent !== next.re !== next.replyMessage?.content) return false;
  if (prev.replyMessage?.is_deleted !== next.replyMessage?.is_deleted)
    return false;

  const pr = prev.reactions ?? [];
  const nr = next.reactions ?? [];
  if (pr.length !== nr.length) return false;
  for (let i = 0; i < pr.length; i++) {
    if (pr[i].id !== nr[i].id) return false;
    if (pr[i].emoji !== nr[i].emoji) return false;
    if (pr[i].user_id !== nr[i].user_id) return false;
  }
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

  swipeContainer: {
    backgroundColor: 'transparent',
  },

  swipeLeftAction: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'flex-start',
    justifyContent: 'flex-start',
    paddingLeft: 16,
    paddingRight: 8,
  },
  swipeReplyIcon: {
    width: SWIPE_ICON_SIZE,
    height: SWIPE_ICON_SIZE,
    borderRadius: SWIPE_ICON_SIZE / 2,
    backgroundColor: 'rgba(124,92,255,0.18)',
    borderWidth: 1,
    borderColor: 'rgba(124,92,255,0.35)',
    alignItems: 'center',
    justifyContent: 'center',
  },

  row: { flexDirection: 'row' },
  rowMine: { justifyContent: 'flex-end' },
  rowOther: { justifyContent: 'flex-start' },
  rowGrouped: { marginTop: 6 },
  rowSpaced: { marginTop: 16 },

  bubbleWrap: { position: 'relative', maxWidth: '80%' },
  // Call bubble: a bit wider (WhatsApp-style)
  bubbleWrapCall: { maxWidth: '84%', minWidth: 240 },

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

  reactionsRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 4,
    marginTop: 4,
    marginHorizontal: 4,
  },
  reactionPill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 3,
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 12,
    backgroundColor: 'rgba(255,255,255,0.10)',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.08)',
  },
  reactionPillMine: {
    backgroundColor: 'rgba(124,92,255,0.25)',
    borderColor: 'rgba(124,92,255,0.5)',
  },
  reactionEmoji: { fontSize: 13 },
  reactionCount: {
    fontSize: 11,
    fontFamily: FONTS.bodySemiBold,
    color: 'rgba(255,255,255,0.85)',
  },

  quotedWrap: {
    flexDirection: 'row',
    alignItems: 'stretch',
    gap: 8,
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 10,
    marginBottom: 6,
    minWidth: 160,
  },
  quotedWrapMine: { backgroundColor: 'rgba(255,255,255,0.14)' },
  quotedWrapOther: { backgroundColor: 'rgba(124,92,255,0.14)' },
  quotedBar: {
    width: 3,
    borderRadius: 2,
    backgroundColor: COLORS.violetLight,
  },
  quotedName: {
    fontSize: 11.5,
    fontFamily: FONTS.bodySemiBold,
    color: COLORS.violetLight,
    marginBottom: 1,
  },
  quotedText: {
    fontSize: 12.5,
    fontFamily: FONTS.body,
    color: COLORS.mistLight,
  },
  quotedTextMine: { color: 'rgba(255,255,255,0.85)' },

  imageWrap: {
    borderRadius: 18,
    overflow: 'hidden',
    backgroundColor: 'rgba(255,255,255,0.03)',
  },
  image: { width: 220, height: 220, borderRadius: 16 },

  voiceWrap: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    minWidth: 200,
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

  waveWrap: {
    flex: 1,
    minWidth: 100,
    height: 24,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 2,
    overflow: 'hidden',
  },
  waveBar: {
    flex: 1,
    minWidth: 1,
    borderRadius: 1.5,
  },

  voiceDuration: {
    fontSize: 12,
    fontFamily: FONTS.body,
    color: 'rgba(255,255,255,0.75)',
    minWidth: 38,
    textAlign: 'right',
  },
  voiceDurationMine: { color: 'rgba(255,255,255,0.9)' },

  // ============================================================
  // ✅ Call bubble styles
  // ============================================================
  callBubble: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    paddingHorizontal: 12,
    paddingVertical: 10,
    borderRadius: 18,
    minWidth: 240,
  },
  callBubbleMine: {
    // violet gradient handled by parent container? No — we use solid here
    // to keep icon contrast perfect. Use gradient-ish violet.
    backgroundColor: '#5B44C9',
    borderBottomRightRadius: 4,
    shadowColor: '#7C5CFF',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.35,
    shadowRadius: 12,
    elevation: 4,
  },
  callBubbleOther: {
    backgroundColor: '#171A24',
    borderBottomLeftRadius: 4,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.06)',
  },

  callIconSlot: {
    width: 46,
    height: 46,
    alignItems: 'center',
    justifyContent: 'center',
    position: 'relative',
  },
  callIconCircle: {
    width: 42,
    height: 42,
    borderRadius: 21,
    alignItems: 'center',
    justifyContent: 'center',
  },
  callArrowBadge: {
    position: 'absolute',
    bottom: 0,
    right: 0,
    width: 16,
    height: 16,
    borderRadius: 8,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 2,
    borderColor: '#171A24',
  },

  callTextCol: {
    flex: 1,
    minWidth: 0,
  },
  callTitle: {
    fontSize: 15.5,
    fontFamily: FONTS.bodySemiBold,
    color: '#FFFFFF',
    marginBottom: 3,
  },
  callSubRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 8,
  },
  callSubtitle: {
    fontSize: 13,
    fontFamily: FONTS.body,
    color: COLORS.mistLight,
    flexShrink: 1,
  },
  callSubtitleMine: {
    color: 'rgba(255,255,255,0.9)',
  },
  callTime: {
    fontSize: 11.5,
    fontFamily: FONTS.body,
    color: 'rgba(255,255,255,0.55)',
  },
  callTimeMine: {
    color: 'rgba(255,255,255,0.75)',
  },
});
