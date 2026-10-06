// app/call/[id].tsx
// Voice/Video call screen — wired to CallContext (real WebRTC)
// ✅ Web-safe: RTCView is native-only
// ✅ Redesigned: pulse rings, glass control bar, swipe-to-answer,
//    edge-snapping PiP, timer chip, E2E hint, proper ended state

import { useEffect, useState, useRef } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  Platform,
  PanResponder,
  Animated,
  Dimensions,
  Easing,
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

const PIP_W = 112;
const PIP_H = 158;
const PIP_MARGIN = 14;
const PIP_BORDER = 2;
const TOP_OFFSET = 110;

/* ---------- Animated "Calling…" dots ---------- */
function TypingDots() {
  const a = useRef(new Animated.Value(0.25)).current;
  const b = useRef(new Animated.Value(0.25)).current;
  const c = useRef(new Animated.Value(0.25)).current;

  useEffect(() => {
    const make = (v: Animated.Value, delay: number) =>
      Animated.loop(
        Animated.sequence([
          Animated.delay(delay),
          Animated.timing(v, { toValue: 1, duration: 300, useNativeDriver: true }),
          Animated.timing(v, { toValue: 0.25, duration: 300, useNativeDriver: true }),
          Animated.delay(900 - delay), // keeps total period 1500ms → always in sync
        ])
      );
    const l1 = make(a, 0);
    const l2 = make(b, 250);
    const l3 = make(c, 500);
    l1.start();
    l2.start();
    l3.start();
    return () => {
      l1.stop();
      l2.stop();
      l3.stop();
    };
  }, [a, b, c]);

  return (
    <View style={styles.dotsRow}>
      {[a, b, c].map((v, i) => (
        <Animated.View key={i} style={[styles.dot, { opacity: v }]} />
      ))}
    </View>
  );
}

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
  // Derived flags
  // ============================================================
  const isVideoCall = (currentCall?.call_type ?? params.type) === 'video';
  const isIncoming = params.role === 'receiver';

  const showControlBar =
    callState === 'calling' ||
    callState === 'connecting' ||
    callState === 'active' ||
    (callState === 'ringing' && !isIncoming); // ✅ caller can cancel while ringing

  const showVideo =
    isVideoCall && (callState === 'active' || callState === 'connecting');
  const showRemoteVideo = showVideo && !!remoteStream && !!RTCView;
  const showLocalVideo =
    showVideo && !!localStream && isVideoEnabled && !!RTCView;

  // ============================================================
  // Draggable + edge-snapping PiP
  // ============================================================
  const pipX = useRef(
    new Animated.Value(SCREEN_W - PIP_W - PIP_MARGIN)
  ).current;
  const pipY = useRef(new Animated.Value(TOP_OFFSET)).current;
  const pipScale = useRef(new Animated.Value(1)).current;
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
        Animated.spring(pipScale, {
          toValue: 1.06,
          useNativeDriver: false,
          friction: 7,
        }).start();
      },
      onPanResponderMove: (_, g) => {
        pipX.setValue(g.dx);
        pipY.setValue(g.dy);
      },
      onPanResponderRelease: (_, g) => {
        pipX.flattenOffset();
        pipY.flattenOffset();
        Animated.spring(pipScale, {
          toValue: 1,
          useNativeDriver: false,
          friction: 7,
        }).start();

        const rawX = lastPipPos.x + g.dx;
        const rawY = Math.max(
          TOP_OFFSET,
          Math.min(SCREEN_H - PIP_H - 170, lastPipPos.y + g.dy)
        );

        // ✅ Snap to nearest horizontal edge
        const snapX =
          rawX + PIP_W / 2 < SCREEN_W / 2
            ? PIP_MARGIN
            : SCREEN_W - PIP_W - PIP_MARGIN;

        lastPipPos.x = snapX;
        lastPipPos.y = rawY;

        Animated.spring(pipX, {
          toValue: snapX,
          useNativeDriver: false,
          friction: 8,
        }).start();
        Animated.spring(pipY, {
          toValue: rawY,
          useNativeDriver: false,
          friction: 8,
        }).start();
      },
    })
  ).current;

  // ============================================================
  // Timers (unchanged logic)
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

  // ============================================================
  // Animations
  // ============================================================
  // Ripple rings behind avatar (incoming + outgoing)
  const pulseA = useRef(new Animated.Value(0)).current;
  const pulseB = useRef(new Animated.Value(0)).current;

  const isRipple =
    callState === 'ringing' ||
    callState === 'calling' ||
    callState === 'connecting';

  useEffect(() => {
    if (!isRipple) {
      pulseA.setValue(0);
      pulseB.setValue(0);
      return;
    }
    const make = (v: Animated.Value, delay: number) =>
      Animated.loop(
        Animated.sequence([
          Animated.delay(delay),
          Animated.timing(v, {
            toValue: 1,
            duration: 1800 - delay,
            easing: Easing.out(Easing.cubic),
            useNativeDriver: true,
          }),
          Animated.timing(v, { toValue: 0, duration: 0, useNativeDriver: true }),
        ])
      );
    const l1 = make(pulseA, 0);
    const l2 = make(pulseB, 900);
    l1.start();
    l2.start();
    return () => {
      l1.stop();
      l2.stop();
    };
  }, [isRipple, pulseA, pulseB]);

  const ringAScale = pulseA.interpolate({
    inputRange: [0, 1],
    outputRange: [1, 1.8],
  });
  const ringAOpacity = pulseA.interpolate({
    inputRange: [0, 1],
    outputRange: [0.4, 0],
  });
  const ringBScale = pulseB.interpolate({
    inputRange: [0, 1],
    outputRange: [1, 1.8],
  });
  const ringBOpacity = pulseB.interpolate({
    inputRange: [0, 1],
    outputRange: [0.4, 0],
  });

  // Breathing avatar when connected
  const breath = useRef(new Animated.Value(1)).current;
  useEffect(() => {
    if (callState === 'active') {
      const l = Animated.loop(
        Animated.sequence([
          Animated.timing(breath, {
            toValue: 1.03,
            duration: 1100,
            easing: Easing.inOut(Easing.ease),
            useNativeDriver: true,
          }),
          Animated.timing(breath, {
            toValue: 1,
            duration: 1100,
            easing: Easing.inOut(Easing.ease),
            useNativeDriver: true,
          }),
        ])
      );
      l.start();
      return () => l.stop();
    }
    breath.setValue(1);
  }, [callState, breath]);

  // Live dot blink (timer chip + video pill)
  const liveDot = useRef(new Animated.Value(1)).current;
  useEffect(() => {
    if (callState === 'active') {
      const l = Animated.loop(
        Animated.sequence([
          Animated.timing(liveDot, { toValue: 0.25, duration: 700, useNativeDriver: true }),
          Animated.timing(liveDot, { toValue: 1, duration: 700, useNativeDriver: true }),
        ])
      );
      l.start();
      return () => l.stop();
    }
    liveDot.setValue(1);
  }, [callState, liveDot]);

  // Controls entrance (slide-up + fade)
  const controlsIn = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    if (callState === 'idle' || callState === 'ended') {
      controlsIn.setValue(0);
      return;
    }
    const anim = Animated.timing(controlsIn, {
      toValue: 1,
      duration: 350,
      delay: 120,
      useNativeDriver: true,
    });
    anim.start();
    return () => anim.stop();
  }, [callState, controlsIn]);

  const controlsSlide = controlsIn.interpolate({
    inputRange: [0, 1],
    outputRange: [26, 0],
  });

  // Accept button glow halo (incoming only)
  const acceptGlow = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    if (callState === 'ringing' && isIncoming) {
      const l = Animated.loop(
        Animated.sequence([
          Animated.timing(acceptGlow, {
            toValue: 1,
            duration: 1400,
            easing: Easing.out(Easing.ease),
            useNativeDriver: true,
          }),
          Animated.timing(acceptGlow, { toValue: 0, duration: 0, useNativeDriver: true }),
        ])
      );
      l.start();
      return () => l.stop();
    }
    acceptGlow.setValue(0);
  }, [callState, isIncoming, acceptGlow]);

  const haloScale = acceptGlow.interpolate({
    inputRange: [0, 1],
    outputRange: [1, 1.5],
  });
  const haloOpacity = acceptGlow.interpolate({
    inputRange: [0, 1],
    outputRange: [0.45, 0],
  });

  // Swipe-up to answer (tap still works)
  const acceptLift = useRef(new Animated.Value(0)).current;
  const acceptLiftY = Animated.multiply(acceptLift, -1);
  const acceptPan = useRef(
    PanResponder.create({
      onStartShouldSetPanResponder: () => false, // tap → onPress
      onMoveShouldSetPanResponder: (_, g) =>
        g.dy < -8 && Math.abs(g.dy) > Math.abs(g.dx), // upward drag
      onPanResponderMove: (_, g) => {
        acceptLift.setValue(Math.min(120, Math.max(0, -g.dy)));
      },
      onPanResponderRelease: (_, g) => {
        if (g.dy < -70) {
          hapticSuccess();
          acceptIncomingCall();
        }
        Animated.spring(acceptLift, {
          toValue: 0,
          useNativeDriver: true,
          friction: 5,
        }).start();
      },
      onPanResponderTerminate: () => {
        Animated.spring(acceptLift, {
          toValue: 0,
          useNativeDriver: true,
          friction: 5,
        }).start();
      },
    })
  ).current;

  // ============================================================
  // Helpers
  // ============================================================
  function formatElapsed(s: number) {
    const m = Math.floor(s / 60).toString().padStart(2, '0');
    const sec = (s % 60).toString().padStart(2, '0');
    return `${m}:${sec}`;
  }

  function statusText() {
    switch (callState) {
      case 'calling':
        return 'Calling';
      case 'ringing':
        return isIncoming
          ? `Incoming ${isVideoCall ? 'video' : 'voice'} call`
          : 'Ringing';
      case 'connecting':
        return 'Connecting';
      case 'ended':
        return 'Call ended';
      default:
        return '';
    }
  }

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
  function handleDone() {
    hapticMedium();
    if (router.canGoBack()) {
      router.back();
    } else {
      router.replace('/(tabs)/chats');
    }
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
            colors={['rgba(0,0,0,0.65)', 'transparent']}
            style={styles.topOverlay}
            pointerEvents="none"
          />
          <LinearGradient
            colors={['transparent', 'rgba(0,0,0,0.9)']}
            style={styles.bottomOverlay}
            pointerEvents="none"
          />
        </>
      )}

      <SafeAreaView style={styles.safe} edges={['top', 'bottom']}>
        {/* ============================================ */}
        {/* BRAND HEADER */}
        {/* ============================================ */}
        <View style={styles.brandHeader} pointerEvents="box-none">
          <Text style={styles.brandText}>Airalance!</Text>
        </View>

        {/* ============================================ */}
        {/* VIDEO — top info pill */}
        {/* ============================================ */}
        {showRemoteVideo && (
          <View style={styles.topBar} pointerEvents="box-none">
            <View style={styles.topPill}>
              {callState === 'active' ? (
                <>
                  <Animated.View style={[styles.pillLiveDot, { opacity: liveDot }]} />
                  <Text style={styles.topPillName} numberOfLines={1}>
                    {name}
                  </Text>
                  <View style={styles.topPillDivider} />
                  <Text style={styles.topPillTime}>{formatElapsed(elapsed)}</Text>
                </>
              ) : (
                <Text style={styles.topPillName} numberOfLines={1}>
                  {name} · {statusText()}
                </Text>
              )}
            </View>
          </View>
        )}

        {/* ============================================ */}
        {/* BODY */}
        {/* ============================================ */}
        {callState === 'ended' ? (
          <View style={styles.body}>
            <View style={styles.avatarStage}>
              <View style={[styles.avatarRing, styles.avatarRingDim]}>
                <Avatar
                  name={name}
                  color={avatarColor}
                  avatarUrl={avatarUrl}
                  size={104}
                />
              </View>
            </View>
            <Text style={styles.name} numberOfLines={1}>
              {name}
            </Text>
            <Text style={styles.endedText}>
              Call ended{elapsed > 0 ? ` · ${formatElapsed(elapsed)}` : ''}
            </Text>
            <TouchableOpacity
              style={styles.doneBtn}
              onPress={handleDone}
              activeOpacity={0.85}
            >
              <Text style={styles.doneBtnText}>Done</Text>
            </TouchableOpacity>
          </View>
        ) : showRemoteVideo ? (
          <View style={{ flex: 1 }} />
        ) : (
          <View style={styles.body}>
            <View style={styles.avatarStage}>
              {/* Pulsing ripple rings */}
              {isRipple && (
                <>
                  <Animated.View
                    style={[
                      styles.pulseRing,
                      { transform: [{ scale: ringAScale }], opacity: ringAOpacity },
                    ]}
                  />
                  <Animated.View
                    style={[
                      styles.pulseRing,
                      styles.pulseRingTeal,
                      { transform: [{ scale: ringBScale }], opacity: ringBOpacity },
                    ]}
                  />
                </>
              )}
              {/* Breathing avatar */}
              <Animated.View style={{ transform: [{ scale: breath }] }}>
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
                    size={116}
                  />
                </View>
              </Animated.View>
            </View>

            <Text style={styles.name} numberOfLines={1}>
              {name}
            </Text>

            {/* Timer chip (active) / Status row (other states) */}
            {callState === 'active' ? (
              <View style={styles.timerChip}>
                <Animated.View style={[styles.liveDot, { opacity: liveDot }]} />
                <Text style={styles.timerText}>{formatElapsed(elapsed)}</Text>
              </View>
            ) : (
              <View style={styles.statusRow}>
                {callState === 'ringing' && isIncoming && (
                  <Ionicons
                    name={isVideoCall ? 'videocam' : 'call'}
                    size={14}
                    color={COLORS.mist}
                  />
                )}
                <Text style={styles.statusText}>{statusText()}</Text>
                {(callState === 'calling' ||
                  callState === 'connecting' ||
                  (callState === 'ringing' && !isIncoming)) && <TypingDots />}
              </View>
            )}
          </View>
        )}

        {/* ============================================ */}
        {/* DRAGGABLE + SNAP PiP */}
        {/* ============================================ */}
        {showLocalVideo && RTCView && (
          <Animated.View
            style={[
              styles.localPip,
              {
                left: pipX,
                top: pipY,
                transform: [{ scale: pipScale }],
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
          <View style={styles.bottomArea}>
            {/* E2E trust hint */}
            <View style={styles.secureRow}>
              <Ionicons name="lock-closed" size={11} color="rgba(255,255,255,0.45)" />
              <Text style={styles.secureText}>End-to-end encrypted</Text>
            </View>

            {/* INCOMING — Decline + Accept (swipe-up supported) */}
            {callState === 'ringing' && isIncoming ? (
              <View style={styles.incomingRow}>
                <View style={styles.incomingCol}>
                  <TouchableOpacity
                    style={[styles.bigBtn, styles.rejectBtn]}
                    onPress={handleReject}
                    activeOpacity={0.85}
                  >
                    <Ionicons name="close" size={30} color="#FFFFFF" />
                  </TouchableOpacity>
                  <Text style={styles.btnLabel}>Decline</Text>
                </View>

                <Animated.View
                  style={[
                    styles.incomingCol,
                    { transform: [{ translateY: acceptLiftY }] },
                  ]}
                  {...acceptPan.panHandlers}
                >
                  <View style={styles.haloAnchor}>
                    <Animated.View
                      style={[
                        styles.acceptHalo,
                        { transform: [{ scale: haloScale }], opacity: haloOpacity },
                      ]}
                    />
                    <TouchableOpacity
                      style={[styles.bigBtn, styles.acceptBtn]}
                      onPress={handleAccept}
                      activeOpacity={0.85}
                    >
                      <Ionicons name="call" size={28} color="#FFFFFF" />
                    </TouchableOpacity>
                  </View>
                  <Text style={styles.btnLabel}>Accept</Text>
                </Animated.View>
              </View>
            ) : showControlBar ? (
              /* GLASS CONTROL BAR — mute / end / speaker (+ video) */
              <Animated.View
                style={[
                  styles.controlBar,
                  { opacity: controlsIn, transform: [{ translateY: controlsSlide }] },
                ]}
              >
                {isVideoCall && (
                  <TouchableOpacity
                    style={[styles.circleBtn, !isVideoEnabled && styles.circleBtnSolid]}
                    onPress={handleVideo}
                    activeOpacity={0.85}
                  >
                    <Ionicons
                      name={isVideoEnabled ? 'videocam' : 'videocam-off'}
                      size={22}
                      color={isVideoEnabled ? '#FFFFFF' : '#0B0D14'}
                    />
                  </TouchableOpacity>
                )}

                <TouchableOpacity
                  style={[styles.circleBtn, isMuted && styles.circleBtnSolid]}
                  onPress={handleMute}
                  activeOpacity={0.85}
                >
                  <Ionicons
                    name={isMuted ? 'mic-off' : 'mic'}
                    size={22}
                    color={isMuted ? '#0B0D14' : '#FFFFFF'}
                  />
                </TouchableOpacity>

                {/* End call — center, bigger, red glow */}
                <TouchableOpacity
                  style={styles.endBtn}
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

                <TouchableOpacity
                  style={[styles.circleBtn, isSpeakerOn && styles.circleBtnTeal]}
                  onPress={handleSpeaker}
                  activeOpacity={0.85}
                >
                  <Ionicons
                    name={isSpeakerOn ? 'volume-high' : 'volume-medium'}
                    size={22}
                    color="#FFFFFF"
                  />
                </TouchableOpacity>
              </Animated.View>
            ) : null}
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
    top: -220,
    left: -110,
    width: 520,
    height: 520,
    borderRadius: 260,
    backgroundColor: 'rgba(124,92,255,0.20)',
  },
  glowBottom: {
    position: 'absolute',
    bottom: -220,
    right: -110,
    width: 480,
    height: 480,
    borderRadius: 240,
    backgroundColor: 'rgba(34,211,184,0.10)',
  },

  topOverlay: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    height: 130,
    zIndex: 1,
  },
  bottomOverlay: {
    position: 'absolute',
    bottom: 0,
    left: 0,
    right: 0,
    height: 240,
    zIndex: 1,
  },

  brandHeader: {
    paddingTop: 8,
    paddingBottom: 4,
    alignItems: 'center',
    zIndex: 5,
  },
  brandText: {
    fontSize: 18,
    fontFamily: FONTS.displayBold,
    color: 'rgba(255,255,255,0.9)',
    letterSpacing: -0.4,
  },

  topBar: {
    paddingHorizontal: 16,
    paddingTop: 6,
    alignItems: 'center',
    zIndex: 5,
  },
  topPill: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: 'rgba(0,0,0,0.55)',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.12)',
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderRadius: 999,
    maxWidth: '88%',
  },
  pillLiveDot: {
    width: 7,
    height: 7,
    borderRadius: 4,
    backgroundColor: '#2DD4BF',
    marginRight: 9,
  },
  topPillName: {
    fontSize: 14,
    fontFamily: FONTS.bodySemiBold,
    color: '#FFFFFF',
    flexShrink: 1,
  },
  topPillDivider: {
    width: 1,
    height: 13,
    backgroundColor: 'rgba(255,255,255,0.3)',
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

  avatarStage: {
    marginBottom: 26,
    alignItems: 'center',
    justifyContent: 'center',
  },
  pulseRing: {
    position: 'absolute',
    width: 140,
    height: 140,
    borderRadius: 70,
    borderWidth: 2,
    borderColor: 'rgba(124,92,255,0.5)',
    backgroundColor: 'rgba(124,92,255,0.05)',
  },
  pulseRingTeal: {
    borderColor: 'rgba(45,212,191,0.45)',
    backgroundColor: 'rgba(45,212,191,0.04)',
  },
  avatarRing: {
    padding: 6,
    borderRadius: 999,
    borderWidth: 2,
    borderColor: 'rgba(124,92,255,0.55)',
    shadowColor: COLORS.violet,
    shadowOffset: { width: 0, height: 0 },
    shadowOpacity: 0.45,
    shadowRadius: 26,
    elevation: 12,
  },
  avatarRingConnected: {
    borderColor: 'rgba(45,212,191,0.75)',
    shadowColor: COLORS.teal,
    shadowOpacity: 0.55,
  },
  avatarRingDim: {
    borderColor: 'rgba(255,255,255,0.14)',
    shadowOpacity: 0,
  },

  name: {
    fontSize: 25,
    fontFamily: FONTS.displayBold,
    color: '#FFFFFF',
    textAlign: 'center',
    letterSpacing: -0.3,
  },
  statusRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginTop: 14,
  },
  statusText: {
    fontSize: 15,
    fontFamily: FONTS.bodyMedium,
    color: COLORS.mist,
    letterSpacing: 0.2,
  },
  dotsRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    marginLeft: 2,
  },
  dot: {
    width: 5,
    height: 5,
    borderRadius: 3,
    backgroundColor: COLORS.mist,
  },

  timerChip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginTop: 16,
    backgroundColor: 'rgba(45,212,191,0.10)',
    borderWidth: 1,
    borderColor: 'rgba(45,212,191,0.35)',
    paddingHorizontal: 14,
    paddingVertical: 7,
    borderRadius: 999,
  },
  liveDot: {
    width: 7,
    height: 7,
    borderRadius: 4,
    backgroundColor: '#2DD4BF',
  },
  timerText: {
    fontSize: 15,
    fontFamily: FONTS.bodySemiBold,
    color: '#2DD4BF',
    letterSpacing: 1.5,
  },

  endedText: {
    fontSize: 15,
    fontFamily: FONTS.bodyMedium,
    color: 'rgba(255,255,255,0.6)',
    marginTop: 12,
  },
  doneBtn: {
    marginTop: 28,
    backgroundColor: 'rgba(255,255,255,0.10)',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.18)',
    paddingVertical: 12,
    paddingHorizontal: 40,
    borderRadius: 999,
  },
  doneBtnText: {
    fontSize: 15,
    fontFamily: FONTS.bodySemiBold,
    color: '#FFFFFF',
  },

  localPip: {
    position: 'absolute',
    width: PIP_W,
    height: PIP_H,
    borderRadius: 18,
    backgroundColor: '#000000',
    borderWidth: 2,
    borderColor: 'rgba(255,255,255,0.35)',
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
    borderRadius: 14,
    overflow: 'hidden',
    backgroundColor: '#000000',
  },
  localPipVideo: {
    flex: 1,
    width: '100%',
    height: '100%',
  },

  bottomArea: {
    alignItems: 'center',
    paddingBottom: 22,
    paddingTop: 10,
    zIndex: 5,
  },
  secureRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    marginBottom: 14,
  },
  secureText: {
    fontSize: 11,
    fontFamily: FONTS.bodyMedium,
    color: 'rgba(255,255,255,0.45)',
    letterSpacing: 0.3,
  },

  incomingRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 78,
  },
  incomingCol: {
    alignItems: 'center',
    gap: 10,
  },
  haloAnchor: {
    width: 72,
    height: 72,
    alignItems: 'center',
    justifyContent: 'center',
  },
  acceptHalo: {
    position: 'absolute',
    width: 72,
    height: 72,
    borderRadius: 36,
    backgroundColor: '#22C55E',
  },

  bigBtn: {
    width: 72,
    height: 72,
    borderRadius: 36,
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

  controlBar: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 14,
    backgroundColor: 'rgba(255,255,255,0.10)',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.14)',
    borderRadius: 999,
    paddingHorizontal: 18,
    paddingVertical: 12,
  },
  circleBtn: {
    width: 54,
    height: 54,
    borderRadius: 27,
    backgroundColor: 'rgba(255,255,255,0.14)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  circleBtnSolid: {
    backgroundColor: '#FFFFFF',
  },
  circleBtnTeal: {
    backgroundColor: 'rgba(45,212,191,0.85)',
  },
  endBtn: {
    width: 64,
    height: 64,
    borderRadius: 32,
    backgroundColor: COLORS.danger,
    alignItems: 'center',
    justifyContent: 'center',
    marginHorizontal: 4,
    shadowColor: COLORS.danger,
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.55,
    shadowRadius: 14,
    elevation: 10,
  },
});
