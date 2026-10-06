// app/call/[id].tsx
// Voice/Video call screen — wired to CallContext (real WebRTC)
// ✅ Web-safe: RTCView is native-only
// ✅ Draggable PiP + improved voice UI + fixed ended state

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

// ✅ Web-safe: RTCView is native-only
let RTCView: any = null;
if (Platform.OS !== 'web') {
  try {
    RTCView = require('react-native-webrtc').RTCView;
  } catch (err) {
    console.warn('[call] RTCView not available:', err);
  }
}

const { width: SCREEN_W, height: SCREEN_H } = Dimensions.get('window');

const PIP_W = 108;
const PIP_H = 160;
const PIP_MARGIN = 16;
const TOP_OFFSET = 80;

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

  // ============================================================
  // ✅ Local cache for remote info — prevents "Unknown" flash on end
  // ============================================================
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

  // ============================================================
  // ✅ Duration timer — keeps value during 'ended' state
  // ============================================================
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
    // 'ended' state me elapsed preserve rakho
  }, [callState]);

  // Auto-close screen when call goes idle
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
    isVideoCall &&
    (callState === 'active' || callState === 'connecting') &&
    callState !== 'ended';
  const showRemoteVideo =
    showVideo && !!remoteStream && !!RTCView && callState !== 'ended';
  const showLocalVideo =
    showVideo && !!localStream && isVideoEnabled && !!RTCView;

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

  // ✅ Idle pe kuch render mat karo — screen turant close hoga
  if (callState === 'idle') {
    return <View style={styles.container} />;
  }

  return (
    <View style={styles.container}>
      {/* Background — remote video OR gradient */}
      {showRemoteVideo && RTCView ? (
        <RTCView
          streamURL={(remoteStream as any).toURL()}
          style={StyleSheet.absoluteFill}
          objectFit="cover"
          zOrder={0}
        />
      ) : (
        <>
          <View style={styles.glowTop} />
          <View style={styles.glowBottom} />
        </>
      )}

      {/* Video overlays for text readability */}
      {showRemoteVideo && (
        <>
          <LinearGradient
            colors={['rgba(0,0,0,0.65)', 'transparent']}
            style={styles.topOverlay}
            pointerEvents="none"
          />
          <LinearGradient
            colors={['transparent', 'rgba(0,0,0,0.75)']}
            style={styles.bottomOverlay}
            pointerEvents="none"
          />
        </>
      )}

      <SafeAreaView style={styles.safe} edges={['top', 'bottom']}>
        {/* TOP BAR — video call me name + timer */}
        {showRemoteVideo && (
          <View style={styles.topBar}>
            <View style={styles.videoTopInfo}>
              <Text style={styles.videoTopName} numberOfLines={1}>
                {name}
              </Text>
              <Text style={styles.videoTopStatus}>{getStatusText()}</Text>
            </View>
          </View>
        )}

        {/* ============================================ */}
        {/* BODY — 3 states: ended | video call | audio call */}
        {/* ============================================ */}
        {callState === 'ended' ? (
          // ✅ ENDED STATE — avatar + name + duration preserved
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
          // Video call — spacer (video fills background)
          <View style={{ flex: 1 }} />
        ) : (
          // ✅ AUDIO CALL — improved centered layout
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
        {/* DRAGGABLE LOCAL PiP (video calls only) */}
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
        {/* BOTTOM CONTROLS */}
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

            {/* CALLING / CONNECTING / ACTIVE */}
            {(callState === 'calling' ||
              callState === 'connecting' ||
              callState === 'active') && (
              <View style={styles.activeRow}>
                {/* Mute */}
                <TouchableOpacity
                  style={styles.iconBtn}
                  onPress={handleMute}
                  activeOpacity={0.85}
                >
                  <Ionicons
                    name={isMuted ? 'mic-off' : 'mic'}
                    size={24}
                    color={isMuted ? COLORS.danger : '#FFFFFF'}
                  />
                </TouchableOpacity>

                {/* End call */}
                <TouchableOpacity
                  style={styles.hangupBtn}
                  onPress={handleEnd}
                  activeOpacity={0.85}
                >
                  <Ionicons
                    name="call"
                    size={28}
                    color="#FFFFFF"
                    style={{ transform: [{ rotate: '135deg' }] }}
                  />
                </TouchableOpacity>

                {/* Video toggle OR Speaker */}
                {isVideoCall ? (
                  <TouchableOpacity
                    style={styles.iconBtn}
                    onPress={handleVideo}
                    activeOpacity={0.85}
                  >
                    <Ionicons
                      name={isVideoEnabled ? 'videocam' : 'videocam-off'}
                      size={24}
                      color={isVideoEnabled ? '#FFFFFF' : COLORS.danger}
                    />
                  </TouchableOpacity>
                ) : (
                  <TouchableOpacity
                    style={[
                      styles.iconBtn,
                      isSpeakerOn && styles.iconBtnActive,
                    ]}
                    onPress={handleSpeaker}
                    activeOpacity={0.85}
                  >
                    <Ionicons
                      name={isSpeakerOn ? 'volume-high' : 'volume-medium'}
                      size={24}
                      color={isSpeakerOn ? COLORS.teal : '#FFFFFF'}
                    />
                  </TouchableOpacity>
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
    height: 140,
    zIndex: 1,
  },
  bottomOverlay: {
    position: 'absolute',
    bottom: 0,
    left: 0,
    right: 0,
    height: 200,
    zIndex: 1,
  },

  topBar: {
    paddingHorizontal: 20,
    paddingTop: 8,
    zIndex: 5,
  },
  videoTopInfo: {
    alignItems: 'center',
    paddingVertical: 8,
  },
  videoTopName: {
    fontSize: 18,
    fontFamily: FONTS.displayBold,
    color: '#FFFFFF',
    textAlign: 'center',
    textShadowColor: 'rgba(0,0,0,0.75)',
    textShadowOffset: { width: 0, height: 1 },
    textShadowRadius: 3,
  },
  videoTopStatus: {
    fontSize: 14,
    fontFamily: FONTS.bodyMedium,
    color: 'rgba(255,255,255,0.9)',
    marginTop: 4,
    textShadowColor: 'rgba(0,0,0,0.75)',
    textShadowOffset: { width: 0, height: 1 },
    textShadowRadius: 3,
  },

  // Center body — audio & ended
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

  // Draggable local PiP
  localPip: {
    position: 'absolute',
    width: PIP_W,
    height: PIP_H,
    borderRadius: 14,
    overflow: 'hidden',
    backgroundColor: '#000000',
    borderWidth: 2,
    borderColor: 'rgba(255,255,255,0.25)',
    zIndex: 10,
    elevation: 10,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.5,
    shadowRadius: 12,
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

  // Bottom controls
  controls: {
    alignItems: 'center',
    justifyContent: 'center',
    paddingBottom: 24,
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
  activeRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 24,
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

  iconBtn: {
    width: 58,
    height: 58,
    borderRadius: 29,
    backgroundColor: 'rgba(255,255,255,0.15)',
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.20)',
  },
  iconBtnActive: {
    backgroundColor: 'rgba(34,211,184,0.25)',
    borderColor: 'rgba(34,211,184,0.5)',
  },
  hangupBtn: {
    width: 68,
    height: 68,
    borderRadius: 34,
    backgroundColor: COLORS.danger,
    alignItems: 'center',
    justifyContent: 'center',
    shadowColor: COLORS.danger,
    shadowOffset: { width: 0, height: 6 },
    shadowOpacity: 0.5,
    shadowRadius: 14,
    elevation: 10,
  },
});
