// app/call/[id].tsx
// Voice/Video call screen — wired to CallContext (real WebRTC)
// ✅ Web-safe: RTCView is native-only
// ✅ Draggable PiP + WhatsApp-style UI
// ✅ Fixed video overflow + proper button alignment + brand header

import { useEffect, useState, useRef } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  ActivityIndicator,
  Platform,
  PanResponder,
  Animated,
  Dimensions,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { LinearGradient } from 'expo-linear-gradient';
import { useCall } from '../../contexts/CallContext';
import Avatar from '../../components/Avatar';
import { COLORS, FONTS, SPACING } from '../../constants/theme';
import { hapticMedium, hapticSuccess, hapticError } from '../../lib/haptics';

let RTCView: any = null;
if (Platform.OS !== 'web') {
  try {
    RTCView = require('react-native-webrtc').RTCView;
  } catch (err) {
    console.warn('[call] RTCView not available:', err);
  }
}

const { width: SCREEN_W, height: SCREEN_H } = Dimensions.get('window');

const PIP_W = 110;
const PIP_H = 164;
const PIP_MARGIN = 14;
const PIP_BORDER = 2;
const TOP_OFFSET = 88;

export default function CallScreen() {
  const router = useRouter();
  const params = useLocalSearchParams<{
    id: string;
    role?: string;
    type?: string;
  }>();

  const {
    callState,
    currentCall,
    localStream,
    remoteStream,
    isMuted,
    isSpeakerOn,
    isVideoEnabled,
    remoteUserInfo,
    acceptIncomingCall,
    rejectIncomingCall,
    endCurrentCall,
    toggleMute,
    toggleSpeaker,
    toggleVideo,
  } = useCall();

  const [elapsed, setElapsed] = useState(0);
  const closeTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const cachedRemoteInfoRef = useRef<{
    name: string;
    avatar: string | null;
  } | null>(null);

  useEffect(() => {
    if (remoteUserInfo) {
      cachedRemoteInfoRef.current = {
        name: remoteUserInfo.name,
        avatar: remoteUserInfo.avatar,
      };
    }
  }, [remoteUserInfo]);

  const remoteInfo = remoteUserInfo ?? cachedRemoteInfoRef.current;
  const name = remoteInfo?.name ?? 'Unknown';
  const avatarUrl = remoteInfo?.avatar ?? null;
  const avatarColor = COLORS.violet;

  // ============================================================
  // Draggable PiP
  // ============================================================
  const pipX = useRef(
    new Animated.Value(SCREEN_W - PIP_W - PIP_MARGIN)
  ).current;
  const pipY = useRef(new Animated.Value(TOP_OFFSET)).current;
  const lastPipPos = useRef({
    x: SCREEN_W - PIP_W - PIP_MARGIN,
    y: TOP_OFFSET,
  }).current;

  const panResponder = useRef(
    PanResponder.create({
      onStartShouldSetPanResponder: () => true,
      onMoveShouldSetPanResponder: (_, g) =>
        Math.abs(g.dx) > 3 || Math.abs(g.dy) > 3,
      onPanResponderGrant: () => {
        pipX.setOffset(lastPipPos.x);
        pipY.setOffset(lastPipPos.y);
        pipX.setValue(0);
        pipY.setValue(0);
      },
      onPanResponderMove: (_, g) => {
        pipX.setValue(g.dx);
        pipY.setValue(g.dy);
      },
      onPanResponderRelease: (_, g) => {
        pipX.flattenOffset();
        pipY.flattenOffset();

        const nextX = Math.max(
          PIP_MARGIN,
          Math.min(SCREEN_W - PIP_W - PIP_MARGIN, lastPipPos.x + g.dx)
        );
        const nextY = Math.max(
          TOP_OFFSET,
          Math.min(SCREEN_H - PIP_H - 160, lastPipPos.y + g.dy)
        );

        lastPipPos.x = nextX;
        lastPipPos.y = nextY;

        Animated.spring(pipX, {
          toValue: nextX,
          useNativeDriver: false,
          friction: 7,
        }).start();
        Animated.spring(pipY, {
          toValue: nextY,
          useNativeDriver: false,
          friction: 7,
        }).start();
      },
    })
  ).current;

  useEffect(() => {
    if (callState === 'active') {
      const interval = setInterval(() => setElapsed((e) => e + 1), 1000);
      return () => clearInterval(interval);
    }
    if (
      callState === 'idle' ||
      callState === 'calling' ||
      callState === 'ringing'
    ) {
      setElapsed(0);
    }
  }, [callState]);

  useEffect(() => {
    if (callState === 'idle') {
      if (closeTimerRef.current) clearTimeout(closeTimerRef.current);
      closeTimerRef.current = setTimeout(() => {
        if (router.canGoBack()) {
          router.back();
        } else {
          router.replace('/(tabs)/chats');
        }
      }, 200);
    }
    return () => {
      if (closeTimerRef.current) clearTimeout(closeTimerRef.current);
    };
  }, [callState, router]);

  const isVideoCall = (currentCall?.call_type ?? params.type) === 'video';
  const isIncoming = params.role === 'receiver';

  function formatElapsed(s: number) {
    const m = Math.floor(s / 60).toString().padStart(2, '0');
    const sec = (s % 60).toString().padStart(2, '0');
    return `${m}:${sec}`;
  }

  function getStatusText() {
    switch (callState) {
      case 'calling':
        return 'Calling…';
      case 'ringing':
        return `Incoming ${isVideoCall ? 'video' : 'voice'} call`;
      case 'connecting':
        return 'Connecting…';
      case 'active':
        return formatElapsed(elapsed);
      case 'ended':
        return 'Call ended';
      default:
        return '';
    }
  }

  const showVideo =
    isVideoCall && (callState === 'active' || callState === 'connecting');
  const showRemoteVideo = showVideo && !!remoteStream && !!RTCView;
  const showLocalVideo = showVideo && !!localStream && isVideoEnabled && !!RTCView;

  function handleMute() {
    hapticMedium();
    toggleMute();
  }
  function handleSpeaker() {
    hapticMedium();
    toggleSpeaker();
  }
  function handleVideo() {
    hapticMedium();
    toggleVideo();
  }
  function handleAccept() {
    hapticSuccess();
    acceptIncomingCall();
  }
  function handleReject() {
    hapticError();
    rejectIncomingCall();
  }
  function handleEnd() {
    hapticError();
    endCurrentCall();
  }

  if (callState === 'idle') {
    return <View style={styles.container} />;
  }

  return (
    <View style={styles.container}>
      {/* Background — remote video OR gradient */}
      {showRemoteVideo && RTCView ? (
        <View style={StyleSheet.absoluteFill}>
          <RTCView
            streamURL={(remoteStream as any).toURL()}
            style={StyleSheet.absoluteFill}
            objectFit="cover"
            zOrder={0}
          />
        </View>
      ) : (
        <>
          <View style={styles.glowTop} />
          <View style={styles.glowBottom} />
        </>
      )}

      {showRemoteVideo && (
        <>
          <LinearGradient
            colors={['rgba(0,0,0,0.6)', 'transparent']}
            style={styles.topOverlay}
            pointerEvents="none"
          />
          <LinearGradient
            colors={['transparent', 'rgba(0,0,0,0.85)']}
            style={styles.bottomOverlay}
            pointerEvents="none"
          />
        </>
      )}

      <SafeAreaView style={styles.safe} edges={['top', 'bottom']}>
        {/* ============================================ */}
        {/* BRAND HEADER — "Airalance!" at top */}
        {/* ============================================ */}
        <View style={styles.brandHeader} pointerEvents="box-none">
          <Text style={styles.brandText}>Airalance!</Text>
        </View>

        {/* ============================================ */}
        {/* TOP BAR — WhatsApp style pill (video call) */}
        {/* ============================================ */}
        {showRemoteVideo && (
          <View style={styles.topBar} pointerEvents="box-none">
            <View style={styles.topPill}>
              <Text style={styles.topPillName} numberOfLines={1}>
                {name}
              </Text>
              <View style={styles.topPillDivider} />
              <Text style={styles.topPillTime}>{getStatusText()}</Text>
            </View>
          </View>
        )}

        {/* ============================================ */}
        {/* BODY */}
        {/* ============================================ */}
        {callState === 'ended' ? (
          <View style={styles.body}>
            <View style={styles.avatarWrap}>
              <View style={styles.avatarRing}>
                <Avatar
                  name={name}
                  color={avatarColor}
                  avatarUrl={avatarUrl}
                  size={110}
                />
              </View>
            </View>
            <Text style={styles.name} numberOfLines={1}>
              {name}
            </Text>
            <Text style={styles.endedText}>
              Call ended{elapsed > 0 ? ` · ${formatElapsed(elapsed)}` : ''}
            </Text>
          </View>
        ) : showRemoteVideo ? (
          <View style={{ flex: 1 }} />
        ) : (
          <View style={styles.body}>
            <View style={styles.avatarWrap}>
              <View
                style={[
                  styles.avatarRing,
                  callState === 'active' && styles.avatarRingConnected,
                ]}
              >
                <Avatar
                  name={name}
                  color={avatarColor}
                  avatarUrl={avatarUrl}
                  size={110}
                />
              </View>
            </View>

            <Text style={styles.name} numberOfLines={1}>
              {name}
            </Text>

            <Text
              style={[
                styles.status,
                callState === 'active' && styles.statusActive,
              ]}
            >
              {getStatusText()}
            </Text>

            {callState === 'connecting' && (
              <ActivityIndicator
                color={COLORS.teal}
                style={{ marginTop: 16 }}
              />
            )}
          </View>
        )}

        {/* ============================================ */}
        {/* DRAGGABLE LOCAL PiP */}
        {/* ============================================ */}
        {showLocalVideo && RTCView && (
          <Animated.View
            style={[
              styles.localPip,
              {
                left: pipX,
                top: pipY,
              },
            ]}
            {...panResponder.panHandlers}
          >
            <View style={styles.localPipInner}>
              <RTCView
                streamURL={(localStream as any).toURL()}
                style={styles.localPipVideo}
                objectFit="cover"
                zOrder={1}
                mirror
              />
            </View>
          </Animated.View>
        )}

        {/* ============================================ */}
        {/* BOTTOM CONTROLS — Fixed alignment */}
        {/* ============================================ */}
        {callState !== 'ended' && (
          <View style={styles.controls}>
            {/* INCOMING — Accept + Reject */}
            {callState === 'ringing' && isIncoming && (
              <View style={styles.incomingRow}>
                <View style={styles.incomingCol}>
                  <TouchableOpacity
                    style={[styles.bigBtn, styles.rejectBtn]}
                    onPress={handleReject}
                    activeOpacity={0.85}
                  >
                    <Ionicons
                      name="call"
                      size={28}
                      color="#FFFFFF"
                      style={{ transform: [{ rotate: '135deg' }] }}
                    />
                  </TouchableOpacity>
                  <Text style={styles.btnLabel}>Decline</Text>
                </View>

                <View style={styles.incomingCol}>
                  <TouchableOpacity
                    style={[styles.bigBtn, styles.acceptBtn]}
                    onPress={handleAccept}
                    activeOpacity={0.85}
                  >
                    <Ionicons name="call" size={28} color="#FFFFFF" />
                  </TouchableOpacity>
                  <Text style={styles.btnLabel}>Accept</Text>
                </View>
              </View>
            )}

            {/* ACTIVE ROW */}
            {(callState === 'calling' ||
              callState === 'connecting' ||
              callState === 'active') && (
              <View style={styles.activeRow}>
                {/* ============ VIDEO CALL — 4 buttons ============ */}
                {isVideoCall ? (
                  <>
                    {/* Video toggle */}
                    <TouchableOpacity
                      style={[
                        styles.circleBtn,
                        !isVideoEnabled && styles.circleBtnActive,
                      ]}
                      onPress={handleVideo}
                      activeOpacity={0.85}
                    >
                      <Ionicons
                        name={isVideoEnabled ? 'videocam' : 'videocam-off'}
                        size={22}
                        color="#FFFFFF"
                      />
                    </TouchableOpacity>

                    {/* Mute */}
                    <TouchableOpacity
                      style={[
                        styles.circleBtn,
                        isMuted && styles.circleBtnActive,
                      ]}
                      onPress={handleMute}
                      activeOpacity={0.85}
                    >
                      <Ionicons
                        name={isMuted ? 'mic-off' : 'mic'}
                        size={22}
                        color="#FFFFFF"
                      />
                    </TouchableOpacity>

                    {/* End call — CENTER, bigger, red */}
                    <TouchableOpacity
                      style={[styles.circleBtn, styles.endBtn]}
                      onPress={handleEnd}
                      activeOpacity={0.85}
                    >
                      <Ionicons
                        name="call"
                        size={26}
                        color="#FFFFFF"
                        style={{ transform: [{ rotate: '135deg' }] }}
                      />
                    </TouchableOpacity>

                    {/* Speaker */}
                    <TouchableOpacity
                      style={[
                        styles.circleBtn,
                        isSpeakerOn && styles.circleBtnTeal,
                      ]}
                      onPress={handleSpeaker}
                      activeOpacity={0.85}
                    >
                      <Ionicons
                        name={isSpeakerOn ? 'volume-high' : 'volume-medium'}
                        size={22}
                        color="#FFFFFF"
                      />
                    </TouchableOpacity>
                  </>
                ) : (
                  <>
                    {/* ============ AUDIO CALL — 3 buttons ============ */}
                    {/* Mute */}
                    <TouchableOpacity
                      style={[
                        styles.circleBtn,
                        isMuted && styles.circleBtnActive,
                      ]}
                      onPress={handleMute}
                      activeOpacity={0.85}
                    >
                      <Ionicons
                        name={isMuted ? 'mic-off' : 'mic'}
                        size={22}
                        color="#FFFFFF"
                      />
                    </TouchableOpacity>

                    {/* End call — CENTER, bigger, red */}
                    <TouchableOpacity
                      style={[styles.circleBtn, styles.endBtn]}
                      onPress={handleEnd}
                      activeOpacity={0.85}
                    >
                      <Ionicons
                        name="call"
                        size={26}
                        color="#FFFFFF"
                        style={{ transform: [{ rotate: '135deg' }] }}
                      />
                    </TouchableOpacity>

                    {/* Speaker */}
                    <TouchableOpacity
                      style={[
                        styles.circleBtn,
                        isSpeakerOn && styles.circleBtnTeal,
                      ]}
                      onPress={handleSpeaker}
                      activeOpacity={0.85}
                    >
                      <Ionicons
                        name={isSpeakerOn ? 'volume-high' : 'volume-medium'}
                        size={22}
                        color="#FFFFFF"
                      />
                    </TouchableOpacity>
                  </>
                )}
              </View>
            )}
          </View>
        )}
      </SafeAreaView>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#07080D',
  },
  safe: { flex: 1 },

  glowTop: {
    position: 'absolute',
    top: -200,
    left: -100,
    width: 500,
    height: 500,
    borderRadius: 250,
    backgroundColor: 'rgba(124,92,255,0.22)',
  },
  glowBottom: {
    position: 'absolute',
    bottom: -200,
    right: -100,
    width: 460,
    height: 460,
    borderRadius: 230,
    backgroundColor: 'rgba(34,211,184,0.10)',
  },

  topOverlay: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    height: 120,
    zIndex: 1,
  },
  bottomOverlay: {
    position: 'absolute',
    bottom: 0,
    left: 0,
    right: 0,
    height: 220,
    zIndex: 1,
  },

  // ✅ Brand header
  brandHeader: {
    paddingTop: 8,
    paddingBottom: 4,
    alignItems: 'center',
    zIndex: 5,
  },
  brandText: {
    fontSize: 20,
    fontFamily: FONTS.displayBold,
    color: '#FFFFFF',
    letterSpacing: -0.5,
  },

  topBar: {
    paddingHorizontal: 16,
    paddingTop: 4,
    alignItems: 'center',
    zIndex: 5,
  },
  topPill: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: 'rgba(0,0,0,0.55)',
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderRadius: 999,
    maxWidth: '85%',
  },
  topPillName: {
    fontSize: 14,
    fontFamily: FONTS.bodySemiBold,
    color: '#FFFFFF',
    flexShrink: 1,
  },
  topPillDivider: {
    width: 1,
    height: 14,
    backgroundColor: 'rgba(255,255,255,0.35)',
    marginHorizontal: 10,
  },
  topPillTime: {
    fontSize: 13,
    fontFamily: FONTS.bodyMedium,
    color: '#FFFFFF',
  },

  body: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: SPACING.lg,
    zIndex: 2,
  },
  avatarWrap: {
    marginBottom: 28,
  },
  avatarRing: {
    padding: 6,
    borderRadius: 999,
    borderWidth: 2,
    borderColor: 'rgba(124,92,255,0.5)',
    shadowColor: COLORS.violet,
    shadowOffset: { width: 0, height: 0 },
    shadowOpacity: 0.4,
    shadowRadius: 24,
    elevation: 12,
  },
  avatarRingConnected: {
    borderColor: 'rgba(34,211,184,0.7)',
    shadowColor: COLORS.teal,
    shadowOpacity: 0.5,
  },
  name: {
    fontSize: 24,
    fontFamily: FONTS.displayBold,
    color: '#FFFFFF',
    textAlign: 'center',
    letterSpacing: -0.3,
  },
  status: {
    fontSize: 15,
    fontFamily: FONTS.bodyMedium,
    color: COLORS.mist,
    marginTop: 12,
    letterSpacing: 0.2,
  },
  statusActive: {
    color: COLORS.teal,
    fontSize: 16,
    fontFamily: FONTS.bodySemiBold,
    letterSpacing: 1,
  },
  endedText: {
    fontSize: 15,
    fontFamily: FONTS.bodyMedium,
    color: 'rgba(255,255,255,0.65)',
    marginTop: 12,
  },

  localPip: {
    position: 'absolute',
    width: PIP_W,
    height: PIP_H,
    borderRadius: 16,
    backgroundColor: '#000000',
    borderWidth: 2,
    borderColor: 'rgba(255,255,255,0.30)',
    zIndex: 10,
    elevation: 10,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 6 },
    shadowOpacity: 0.5,
    shadowRadius: 12,
    padding: PIP_BORDER,
  },
  localPipInner: {
    flex: 1,
    borderRadius: 12,
    overflow: 'hidden',
    backgroundColor: '#000000',
  },
  localPipVideo: {
    flex: 1,
    width: '100%',
    height: '100%',
  },

  controls: {
    alignItems: 'center',
    justifyContent: 'center',
    paddingBottom: 28,
    paddingTop: 16,
    zIndex: 5,
  },
  incomingRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 60,
  },
  incomingCol: {
    alignItems: 'center',
    gap: 10,
  },

  // ✅ Fixed: proper centering for audio (3) and video (4) buttons
  activeRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 24,
    paddingHorizontal: 20,
  },

  bigBtn: {
    width: 68,
    height: 68,
    borderRadius: 34,
    alignItems: 'center',
    justifyContent: 'center',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 6 },
    shadowOpacity: 0.4,
    shadowRadius: 12,
    elevation: 8,
  },
  rejectBtn: {
    backgroundColor: COLORS.danger,
  },
  acceptBtn: {
    backgroundColor: '#22C55E',
  },
  btnLabel: {
    fontSize: 12.5,
    fontFamily: FONTS.bodyMedium,
    color: 'rgba(255,255,255,0.85)',
  },

  circleBtn: {
    width: 56,
    height: 56,
    borderRadius: 28,
    backgroundColor: 'rgba(255,255,255,0.18)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  circleBtnActive: {
    backgroundColor: 'rgba(255,255,255,0.35)',
  },
  circleBtnTeal: {
    backgroundColor: 'rgba(34,211,184,0.35)',
  },
  endBtn: {
    backgroundColor: COLORS.danger,
    width: 64,
    height: 64,
    borderRadius: 32,
    shadowColor: COLORS.danger,
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.5,
    shadowRadius: 12,
    elevation: 10,
  },
});
