// app/call/[id].tsx
// Voice/Video call screen — wired to CallContext (real WebRTC)
// ✅ Web-safe: RTCView is native-only (loaded conditionally)

import { useEffect, useState, useRef } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  ActivityIndicator,
  Platform,
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

  // Duration timer when active
  useEffect(() => {
    if (callState !== 'active') {
      setElapsed(0);
      return;
    }
    const interval = setInterval(() => setElapsed((e) => e + 1), 1000);
    return () => clearInterval(interval);
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
      }, 300);
    }
    return () => {
      if (closeTimerRef.current) clearTimeout(closeTimerRef.current);
    };
  }, [callState, router]);

  const isVideoCall = (currentCall?.call_type ?? params.type) === 'video';
  const isIncoming = params.role === 'receiver';
  const name = remoteUserInfo?.name ?? 'Unknown';
  const avatarUrl = remoteUserInfo?.avatar ?? null;
  const avatarColor = COLORS.violet;

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

  return (
    <View style={styles.container}>
      {/* Remote video background (video calls) */}
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

      <SafeAreaView style={styles.safe} edges={['top', 'bottom']}>
        {/* Center — avatar + name (hidden when remote video playing) */}
        {!showRemoteVideo && (
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
                  size={100}
                />
              </View>
            </View>

            <View style={styles.nameRow}>
              <Text style={styles.name} numberOfLines={1}>
                {name}
              </Text>
            </View>

            <Text style={styles.status}>{getStatusText()}</Text>

            {callState === 'connecting' && (
              <ActivityIndicator
                color={COLORS.teal}
                style={{ marginTop: 12 }}
              />
            )}
          </View>
        )}

        {/* Video call top bar */}
        {showRemoteVideo && (
          <View style={styles.videoTopBar}>
            <Text style={styles.videoName} numberOfLines={1}>
              {name}
            </Text>
            <Text style={styles.videoStatus}>{getStatusText()}</Text>
          </View>
        )}

        {/* Local video PiP (top-right) */}
        {showLocalVideo && RTCView && (
          <View style={styles.localPip}>
            <RTCView
              streamURL={(localStream as any).toURL()}
              style={styles.localPipInner}
              objectFit="cover"
              zOrder={1}
              mirror
            />
          </View>
        )}

        {/* Bottom controls */}
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

          {/* CALLING / CONNECTING / ACTIVE — control row */}
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
                  name={isMuted ? 'mic-off-outline' : 'mic-outline'}
                  size={22}
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
                  size={24}
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
                    name={isVideoEnabled ? 'videocam-outline' : 'videocam-off-outline'}
                    size={22}
                    color={isVideoEnabled ? '#FFFFFF' : COLORS.danger}
                  />
                </TouchableOpacity>
              ) : (
                <TouchableOpacity
                  style={styles.iconBtn}
                  onPress={handleSpeaker}
                  activeOpacity={0.85}
                >
                  <Ionicons
                    name={isSpeakerOn ? 'volume-high-outline' : 'volume-medium-outline'}
                    size={22}
                    color={isSpeakerOn ? COLORS.teal : '#FFFFFF'}
                  />
                </TouchableOpacity>
              )}
            </View>
          )}

          {/* ENDED */}
          {callState === 'ended' && (
            <View style={styles.endedWrap}>
              <Text style={styles.endedText}>Call ended</Text>
            </View>
          )}
        </View>
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

  body: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: SPACING.lg,
  },
  avatarWrap: {
    marginBottom: SPACING.lg,
  },
  avatarRing: {
    padding: 5,
    borderRadius: 999,
    borderWidth: 2,
    borderColor: 'rgba(124,92,255,0.4)',
  },
  avatarRingConnected: {
    borderColor: 'rgba(34,211,184,0.6)',
  },
  nameRow: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  name: {
    fontSize: 20,
    fontFamily: FONTS.displayBold,
    color: '#FFFFFF',
  },
  status: {
    fontSize: 14,
    fontFamily: FONTS.bodyMedium,
    color: COLORS.teal,
    marginTop: SPACING.md,
  },

  // Video call top bar
  videoTopBar: {
    paddingHorizontal: 20,
    paddingVertical: 16,
    alignItems: 'center',
  },
  videoName: {
    fontSize: 20,
    fontFamily: FONTS.displayBold,
    color: '#FFFFFF',
    textAlign: 'center',
  },
  videoStatus: {
    fontSize: 14,
    fontFamily: FONTS.body,
    color: 'rgba(255,255,255,0.85)',
    marginTop: 4,
  },

  // Local PiP
  localPip: {
    position: 'absolute',
    top: 80,
    right: 16,
    width: 100,
    height: 148,
    borderRadius: 14,
    overflow: 'hidden',
    backgroundColor: '#1A1D2A',
    borderWidth: 1.5,
    borderColor: 'rgba(255,255,255,0.18)',
    zIndex: 5,
    elevation: 8,
  },
  localPipInner: {
    width: '100%',
    height: '100%',
  },

  // Controls
  controls: {
    alignItems: 'center',
    justifyContent: 'center',
    paddingBottom: SPACING.xl,
    paddingTop: SPACING.md,
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
    gap: 20,
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
    color: 'rgba(255,255,255,0.7)',
  },

  iconBtn: {
    width: 54,
    height: 54,
    borderRadius: 27,
    backgroundColor: 'rgba(255,255,255,0.08)',
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.10)',
  },
  hangupBtn: {
    width: 60,
    height: 60,
    borderRadius: 30,
    backgroundColor: COLORS.danger,
    alignItems: 'center',
    justifyContent: 'center',
    shadowColor: COLORS.danger,
    shadowOffset: { width: 0, height: 8 },
    shadowOpacity: 0.5,
    shadowRadius: 16,
    elevation: 10,
  },

  endedWrap: {
    alignItems: 'center',
    paddingVertical: 20,
  },
  endedText: {
    fontSize: 16,
    fontFamily: FONTS.bodyMedium,
    color: 'rgba(255,255,255,0.7)',
  },
});
