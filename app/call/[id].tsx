// app/call/[id].tsx
// Voice/Video call screen — wired to CallContext (real WebRTC)
// ✅ Web-safe: RTCView is native-only
// ✅ Pulse rings, glass control bar, swipe-to-answer, edge-snapping PiP
// ✅ BLACK-SCREEN FIX: notification tap se aaye call ka self-bootstrap fallback

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
  Vibration,
  ActivityIndicator,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { LinearGradient } from 'expo-linear-gradient';
import { useCall } from '../../contexts/CallContext';
import Avatar from '../../components/Avatar';
import { COLORS, FONTS, SPACING } from '../../constants/theme';
import { hapticMedium, hapticSuccess, hapticError } from '../../lib/haptics';
import { supabase } from '../../lib/supabase';

let RTCView: any = null;
let RTCPeerConnection: any = null;
let RTCSessionDescription: any = null;
let RTCIceCandidate: any = null;
let mediaDevices: any = null;
if (Platform.OS !== 'web') {
  try {
    const WebRTC = require('react-native-webrtc');
    RTCView = WebRTC.RTCView;
    RTCPeerConnection = WebRTC.RTCPeerConnection;
    RTCSessionDescription = WebRTC.RTCSessionDescription;
    RTCIceCandidate = WebRTC.RTCIceCandidate;
    mediaDevices = WebRTC.mediaDevices;
  } catch (err) {
    console.warn('[call] react-native-webrtc not available:', err);
  }
}

let InCallManager: any = null;
if (Platform.OS !== 'web') {
  try {
    InCallManager = require('react-native-incall-manager').default;
  } catch {}
}

const RTC_CONFIG = {
  iceServers: [
    { urls: 'stun:stun.l.google.com:19302' },
    { urls: 'stun:stun1.l.google.com:19302' },
  ],
};

const FB_RING_TIMEOUT_MS = 45_000;

const { width: SCREEN_W, height: SCREEN_H } = Dimensions.get('window');

const PIP_W = 112;
const PIP_H = 158;
const PIP_MARGIN = 14;
const PIP_BORDER = 2;
const TOP_OFFSET = 110;

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
          Animated.delay(900 - delay),
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

  type FbCall = {
    callId: string;
    callType: 'audio' | 'video';
    callerName: string;
    callerAvatar: string | null;
    offer: any;
  };

  const [fb, setFb] = useState<FbCall | null>(null);
  const [fbPhase, setFbPhase] = useState<
    'loading' | 'ringing' | 'connecting' | 'active' | 'ended'
  >('loading');
  const [fbRemoteStream, setFbRemoteStream] = useState<any>(null);
  const [fbLocalStream, setFbLocalStream] = useState<any>(null);
  const [fbMuted, setFbMuted] = useState(false);
  const [fbSpeaker, setFbSpeaker] = useState(false);
  const [fbVideoEnabled, setFbVideoEnabled] = useState(true);
  const [fbElapsed, setFbElapsed] = useState(0);

  const fbRef = useRef<FbCall | null>(null);
  const fbPhaseRef = useRef(fbPhase);
  const callStateRef = useRef(callState);
  const myIdRef = useRef<string | null>(null);
  const fbPcRef = useRef<any>(null);
  const fbLocalRef = useRef<any>(null);
  const fbRingTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const fbTickRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const fbChannelRef = useRef<any>(null);
  const fbEndedRef = useRef(false);
  const fbConnectedRef = useRef(false);
  const fbPendingIceRef = useRef<any[]>([]);
  const bootstrappedForRef = useRef<string | null>(null);
  const aliveRef = useRef(true);

  useEffect(() => { fbRef.current = fb; }, [fb]);
  useEffect(() => { fbPhaseRef.current = fbPhase; }, [fbPhase]);
  useEffect(() => { callStateRef.current = callState; }, [callState]);
  useEffect(() => {
    aliveRef.current = true;
    return () => { aliveRef.current = false; };
  }, []);

  const fbCleanupMedia = () => {
    Vibration.cancel();
    if (fbRingTimerRef.current) {
      clearTimeout(fbRingTimerRef.current);
      fbRingTimerRef.current = null;
    }
    if (fbTickRef.current) {
      clearInterval(fbTickRef.current);
      fbTickRef.current = null;
    }
    try { fbLocalRef.current?.getTracks?.().forEach((t: any) => t.stop()); } catch {}
    fbLocalRef.current = null;
    try { fbPcRef.current?.close?.(); } catch {}
    fbPcRef.current = null;
    if (fbChannelRef.current) {
      try { supabase.removeChannel(fbChannelRef.current); } catch {}
      fbChannelRef.current = null;
    }
  };

  const fbEnd = (status: 'ended' | 'declined' | 'missed' | null) => {
    if (fbEndedRef.current) return;
    fbEndedRef.current = true;
    fbCleanupMedia();
    const cur = fbRef.current;
    if (status && cur) {
      supabase.from('calls').update({ status }).eq('id', cur.callId).then(
        () => {},
        () => {}
      );
    }
    if (aliveRef.current) setFbPhase('ended');
  };

  const fbAddIce = async (candidate: any) => {
    const pc = fbPcRef.current;
    if (!pc || !candidate) return;
    try {
      if (pc.remoteDescription?.type) {
        await pc.addIceCandidate(new RTCIceCandidate(candidate));
      } else {
        fbPendingIceRef.current.push(candidate);
      }
    } catch {}
  };

  const createFbPc = (stream: any, callId: string) => {
    const pc: any = new RTCPeerConnection(RTC_CONFIG);
    stream.getTracks().forEach((t: any) => pc.addTrack(t, stream));

    pc.ontrack = (e: any) => {
      const s = e.streams?.[0] ?? e.stream;
      if (s) {
        setFbRemoteStream(s);
        if (!fbConnectedRef.current) {
          fbConnectedRef.current = true;
          if (fbTickRef.current) {
            clearInterval(fbTickRef.current);
            fbTickRef.current = null;
          }
          if (aliveRef.current) {
            setFbPhase('active');
            fbTickRef.current = setInterval(
              () => setFbElapsed((x) => x + 1),
              1000
            );
          }
        }
      }
    };
    pc.onicecandidate = (e: any) => {
      if (e.candidate && myIdRef.current) {
        supabase
          .from('call_signals')
          .insert({
            call_id: callId,
            sender_id: myIdRef.current,
            kind: 'candidate',
            payload: e.candidate,
          })
          .then(() => {}, () => {});
      }
    };
    pc.onconnectionstatechange = () => {
      if (pc.connectionState === 'failed' || pc.connectionState === 'closed') {
        fbEnd(null);
      }
    };
    fbPcRef.current = pc;
    return pc;
  };

  const bootstrapFallback = async (callId: string) => {
    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) {
        setFbPhase('ended');
        return;
      }
      myIdRef.current = user.id;

      const { data: row } = await supabase
        .from('calls')
        .select('*')
        .eq('id', callId)
        .maybeSingle();

      if (
        !row ||
        ['ended', 'declined', 'missed'].includes(row.status) ||
        row.receiver_id !== user.id
      ) {
        setFbPhase('ended');
        return;
      }

      const rawType = row.call_type ?? row.type ?? params.type ?? 'audio';
      const isVideo = rawType === 'video';

      const { data: prof } = await supabase
        .from('profiles')
        .select('id, username, full_name, avatar_url')
        .eq('id', row.caller_id)
        .maybeSingle();

      setFb({
        callId,
        callType: isVideo ? 'video' : 'audio',
        callerName: prof?.full_name || prof?.username || 'Unknown',
        callerAvatar: prof?.avatar_url ?? null,
        offer: row.offer,
      });
      setFbVideoEnabled(isVideo);
      setFbPhase('ringing');

      Vibration.vibrate([0, 1000, 1000], true);
      fbRingTimerRef.current = setTimeout(
        () => fbEnd('missed'),
        FB_RING_TIMEOUT_MS
      );
    } catch (e) {
      console.warn('[call] fallback bootstrap failed:', e);
      setFbPhase('ended');
    }
  };

  useEffect(() => {
    const id = params.id ? String(params.id) : '';
    if (!id || params.role !== 'receiver') return;
    if (Platform.OS === 'web') return;

    const t = setTimeout(() => {
      if (callStateRef.current !== 'idle') return;
      if (bootstrappedForRef.current === id) return;
      bootstrappedForRef.current = id;
      void bootstrapFallback(id);
    }, 700);

    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [params.id, params.role]);

  useEffect(() => {
    if (!fb || !myIdRef.current) return;
    if (fbPhase === 'ended') return;

    const ch = supabase
      .channel(`fb-call-${fb.callId}`)
      .on(
        'postgres_changes' as any,
        {
          event: 'UPDATE',
          schema: 'public',
          table: 'calls',
          filter: `id=eq.${fb.callId}`,
        },
        (msg: any) => {
          const row = msg.new;
          if (['declined', 'ended', 'missed'].includes(row.status)) {
            fbEnd(null);
          }
        }
      )
      .on(
        'postgres_changes' as any,
        {
          event: 'INSERT',
          schema: 'public',
          table: 'call_signals',
          filter: `call_id=eq.${fb.callId}`,
        },
        (msg: any) => {
          const sig = msg.new;
          if (sig.sender_id === myIdRef.current) return;
          const cand = sig.payload?.candidate ?? sig.payload;
          if (cand?.candidate) void fbAddIce(cand);
        }
      )
      .subscribe();

    fbChannelRef.current = ch;
    return () => {
      try { supabase.removeChannel(ch); } catch {}
      if (fbChannelRef.current === ch) fbChannelRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fb, fbPhase === 'ended']);

  const fbAccept = async () => {
    const cur = fbRef.current;
    if (!cur || fbPhaseRef.current !== 'ringing') return;
    fbPhaseRef.current = 'connecting';
    Vibration.cancel();
    if (fbRingTimerRef.current) {
      clearTimeout(fbRingTimerRef.current);
      fbRingTimerRef.current = null;
    }
    setFbPhase('connecting');

    try {
      if (typeof RTCPeerConnection !== 'function') {
        throw new Error('WebRTC unavailable');
      }

      let offer = cur.offer;
      for (let i = 0; i < 10 && !offer?.sdp; i++) {
        await new Promise((r) => setTimeout(r, 500));
        const { data } = await supabase
          .from('calls')
          .select('offer, status')
          .eq('id', cur.callId)
          .maybeSingle();
        if (
          data?.status &&
          ['ended', 'declined', 'missed'].includes(data.status)
        ) {
          throw new Error('call already ended');
        }
        offer = data?.offer ?? offer;
      }
      if (!offer?.sdp) throw new Error('offer missing');

      await supabase
        .from('calls')
        .update({ status: 'accepted' })
        .eq('id', cur.callId);

      const stream = await mediaDevices.getUserMedia({
        audio: true,
        video: cur.callType === 'video' ? { facingMode: 'user' } : false,
      });
      fbLocalRef.current = stream;
      setFbLocalStream(stream);

      const pc = createFbPc(stream, cur.callId);
      await pc.setRemoteDescription(new RTCSessionDescription(offer));

      try {
        const { data: sigs } = await supabase
          .from('call_signals')
          .select('*')
          .eq('call_id', cur.callId)
          .order('created_at', { ascending: true });
        for (const s of sigs ?? []) {
          if (s.sender_id === myIdRef.current) continue;
          const cand = s.payload?.candidate ?? s.payload;
          if (cand?.candidate) await fbAddIce(cand);
        }
      } catch {}

      const pending = fbPendingIceRef.current;
      fbPendingIceRef.current = [];
      for (const c of pending) {
        try {
          await pc.addIceCandidate(new RTCIceCandidate(c));
        } catch {}
      }

      const answer = await pc.createAnswer();
      await pc.setLocalDescription(answer);
      await supabase
        .from('calls')
        .update({ answer: { type: answer.type, sdp: answer.sdp } })
        .eq('id', cur.callId);
    } catch (e: any) {
      console.warn('[call] fallback accept failed:', e?.message ?? e);
      fbEnd('ended');
    }
  };

  const fbToggleMute = () => {
    const s = fbLocalRef.current;
    if (!s) return;
    const next = !fbMuted;
    s.getAudioTracks?.().forEach((t: any) => {
      t.enabled = !next;
    });
    setFbMuted(next);
  };

  const fbToggleSpeaker = () => {
    const next = !fbSpeaker;
    setFbSpeaker(next);
    try { InCallManager?.setForceSpeakerphoneOn?.(next); } catch {}
  };

  const fbToggleVideo = () => {
    const s = fbLocalRef.current;
    if (!s) return;
    const next = !fbVideoEnabled;
    s.getVideoTracks?.().forEach((t: any) => {
      t.enabled = next;
    });
    setFbVideoEnabled(next);
  };

  useEffect(() => {
    if (fb && fbPhase === 'ended') {
      const t = setTimeout(() => {
        if (router.canGoBack()) {
          router.back();
        } else {
          router.replace('/(tabs)/chats');
        }
      }, 2500);
      return () => clearTimeout(t);
    }
  }, [fb, fbPhase, router]);

  useEffect(() => {
    return () => {
      const wasRinging = fbPhaseRef.current === 'ringing';
      const cur = fbRef.current;
      fbCleanupMedia();
      if (cur && wasRinging && !fbEndedRef.current) {
        supabase
          .from('calls')
          .update({ status: 'missed' })
          .eq('id', cur.callId)
          .then(
            () => {},
            () => {}
          );
      }
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const FB_TO_STATE: Record<string, string> = {
    loading: 'connecting',
    ringing: 'ringing',
    connecting: 'connecting',
    active: 'active',
    ended: 'ended',
  };
  const effState = fb ? FB_TO_STATE[fbPhase] : callState;

  const name = fb ? fb.callerName : remoteInfo?.name ?? 'Unknown';
  const avatarUrl = fb ? fb.callerAvatar : remoteInfo?.avatar ?? null;
  const avatarColor = COLORS.violet;

  const remoteStreamEff = fb ? fbRemoteStream : remoteStream;
  const localStreamEff = fb ? fbLocalStream : localStream;
  const isMutedEff = fb ? fbMuted : isMuted;
  const isSpeakerEff = fb ? fbSpeaker : isSpeakerOn;
  const isVideoEnabledEff = fb ? fbVideoEnabled : isVideoEnabled;
  const elapsedEff = fb ? fbElapsed : elapsed;

  const isVideoCall = fb
    ? fb.callType === 'video'
    : (currentCall?.call_type ?? params.type) === 'video';
  const isIncoming = params.role === 'receiver';

  const showControlBar =
    effState === 'calling' ||
    effState === 'connecting' ||
    effState === 'active' ||
    (effState === 'ringing' && !isIncoming);

  const showVideo =
    isVideoCall && (effState === 'active' || effState === 'connecting');
  const showRemoteVideo = showVideo && !!remoteStreamEff && !!RTCView;
  const showLocalVideo =
    showVideo && !!localStreamEff && isVideoEnabledEff && !!RTCView;

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

  useEffect(() => {
    if (!fb && callState === 'active') {
      const interval = setInterval(() => setElapsed((e) => e + 1), 1000);
      return () => clearInterval(interval);
    }
    if (
      !fb &&
      (callState === 'idle' ||
        callState === 'calling' ||
        callState === 'ringing')
    ) {
      setElapsed(0);
    }
  }, [callState, fb]);

  useEffect(() => {
    if (callState === 'idle') {
      if (params.id && params.role === 'receiver') return;
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
  }, [callState, params.id, params.role, router]);

  const pulseA = useRef(new Animated.Value(0)).current;
  const pulseB = useRef(new Animated.Value(0)).current;

  const isRipple =
    effState === 'ringing' ||
    effState === 'calling' ||
    effState === 'connecting';

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
          Animated.timing(v, {
            toValue: 0,
            duration: 0,
            useNativeDriver: true,
          }),
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

  const breath = useRef(new Animated.Value(1)).current;
  useEffect(() => {
    if (effState === 'active') {
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
  }, [effState, breath]);

  const liveDot = useRef(new Animated.Value(1)).current;
  useEffect(() => {
    if (effState === 'active') {
      const l = Animated.loop(
        Animated.sequence([
          Animated.timing(liveDot, {
            toValue: 0.25,
            duration: 700,
            useNativeDriver: true,
          }),
          Animated.timing(liveDot, {
            toValue: 1,
            duration: 700,
            useNativeDriver: true,
          }),
        ])
      );
      l.start();
      return () => l.stop();
    }
    liveDot.setValue(1);
  }, [effState, liveDot]);

  const controlsIn = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    if (effState === 'idle' || effState === 'ended') {
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
  }, [effState, controlsIn]);

  const controlsSlide = controlsIn.interpolate({
    inputRange: [0, 1],
    outputRange: [26, 0],
  });

  const acceptGlow = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    if (effState === 'ringing' && isIncoming) {
      const l = Animated.loop(
        Animated.sequence([
          Animated.timing(acceptGlow, {
            toValue: 1,
            duration: 1400,
            easing: Easing.out(Easing.ease),
            useNativeDriver: true,
          }),
          Animated.timing(acceptGlow, {
            toValue: 0,
            duration: 0,
            useNativeDriver: true,
          }),
        ])
      );
      l.start();
      return () => l.stop();
    }
    acceptGlow.setValue(0);
  }, [effState, isIncoming, acceptGlow]);

  const haloScale = acceptGlow.interpolate({
    inputRange: [0, 1],
    outputRange: [1, 1.5],
  });
  const haloOpacity = acceptGlow.interpolate({
    inputRange: [0, 1],
    outputRange: [0.45, 0],
  });

  const acceptPressRef = useRef<() => void>(() => {});
  const acceptLift = useRef(new Animated.Value(0)).current;
  const acceptLiftY = Animated.multiply(acceptLift, -1);
  const acceptPan = useRef(
    PanResponder.create({
      onStartShouldSetPanResponder: () => false,
      onMoveShouldSetPanResponder: (_, g) =>
        g.dy < -8 && Math.abs(g.dy) > Math.abs(g.dx),
      onPanResponderMove: (_, g) => {
        acceptLift.setValue(Math.min(120, Math.max(0, -g.dy)));
      },
      onPanResponderRelease: (_, g) => {
        if (g.dy < -70) {
          hapticSuccess();
          acceptPressRef.current();
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

  acceptPressRef.current = () => {
    if (fb) void fbAccept();
    else acceptIncomingCall();
  };

  function formatElapsed(s: number) {
    const m = Math.floor(s / 60)
      .toString()
      .padStart(2, '0');
    const sec = (s % 60).toString().padStart(2, '0');
    return `${m}:${sec}`;
  }

  function statusText() {
    switch (effState) {
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
    if (fb) fbToggleMute();
    else toggleMute();
  }
  function handleSpeaker() {
    hapticMedium();
    if (fb) fbToggleSpeaker();
    else toggleSpeaker();
  }
  function handleVideo() {
    hapticMedium();
    if (fb) fbToggleVideo();
    else toggleVideo();
  }
  function handleAccept() {
    hapticSuccess();
    acceptPressRef.current();
  }
  function handleReject() {
    hapticError();
    if (fb) fbEnd('declined');
    else rejectIncomingCall();
  }
  function handleEnd() {
    hapticError();
    if (fb) fbEnd('ended');
    else endCurrentCall();
  }
  function handleDone() {
    hapticMedium();
    if (router.canGoBack()) {
      router.back();
    } else {
      router.replace('/(tabs)/chats');
    }
  }

  if (callState === 'idle' && !fb) {
    const waitingBootstrap = !!params.id && params.role === 'receiver';
    return (
      <View style={styles.container}>
        {waitingBootstrap && (
          <View style={styles.bootstrapLoading}>
            <ActivityIndicator color={COLORS.violet} size="large" />
            <Text style={styles.bootstrapText}>Connecting…</Text>
          </View>
        )}
      </View>
    );
  }

  return (
    <View style={styles.container}>
      {showRemoteVideo && RTCView ? (
        <View style={StyleSheet.absoluteFill}>
          <RTCView
            streamURL={(remoteStreamEff as any).toURL()}
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
        <View style={styles.brandHeader} pointerEvents="box-none">
          <Text style={styles.brandText}>Airalance!</Text>
        </View>

        {showRemoteVideo && (
          <View style={styles.topBar} pointerEvents="box-none">
            <View style={styles.topPill}>
              {effState === 'active' ? (
                <>
                  <Animated.View
                    style={[styles.pillLiveDot, { opacity: liveDot }]}
                  />
                  <Text style={styles.topPillName} numberOfLines={1}>
                    {name}
                  </Text>
                  <View style={styles.topPillDivider} />
                  <Text style={styles.topPillTime}>
                    {formatElapsed(elapsedEff)}
                  </Text>
                </>
              ) : (
                <Text style={styles.topPillName} numberOfLines={1}>
                  {name} · {statusText()}
                </Text>
              )}
            </View>
          </View>
        )}

        {effState === 'ended' ? (
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
              Call ended
              {elapsedEff > 0 ? ` · ${formatElapsed(elapsedEff)}` : ''}
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
              {isRipple && (
                <>
                  <Animated.View
                    style={[
                      styles.pulseRing,
                      {
                        transform: [{ scale: ringAScale }],
                        opacity: ringAOpacity,
                      },
                    ]}
                  />
                  <Animated.View
                    style={[
                      styles.pulseRing,
                      styles.pulseRingTeal,
                      {
                        transform: [{ scale: ringBScale }],
                        opacity: ringBOpacity,
                      },
                    ]}
                  />
                </>
              )}
              <Animated.View style={{ transform: [{ scale: breath }] }}>
                <View
                  style={[
                    styles.avatarRing,
                    effState === 'active' && styles.avatarRingConnected,
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

            {effState === 'active' ? (
              <View style={styles.timerChip}>
                <Animated.View style={[styles.liveDot, { opacity: liveDot }]} />
                <Text style={styles.timerText}>
                  {formatElapsed(elapsedEff)}
                </Text>
              </View>
            ) : (
              <View style={styles.statusRow}>
                {effState === 'ringing' && isIncoming && (
                  <Ionicons
                    name={isVideoCall ? 'videocam' : 'call'}
                    size={14}
                    color={COLORS.mist}
                  />
                )}
                <Text style={styles.statusText}>{statusText()}</Text>
                {(effState === 'calling' ||
                  effState === 'connecting' ||
                  (effState === 'ringing' && !isIncoming)) && <TypingDots />}
              </View>
            )}
          </View>
        )}

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
                streamURL={(localStreamEff as any).toURL()}
                style={styles.localPipVideo}
                objectFit="cover"
                zOrder={1}
                mirror
              />
            </View>
          </Animated.View>
        )}

        {effState !== 'ended' && (
          <View style={styles.bottomArea}>
            <View style={styles.secureRow}>
              <Ionicons
                name="lock-closed"
                size={11}
                color="rgba(255,255,255,0.45)"
              />
              <Text style={styles.secureText}>End-to-end encrypted</Text>
            </View>

            {effState === 'ringing' && isIncoming ? (
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
                        {
                          transform: [{ scale: haloScale }],
                          opacity: haloOpacity,
                        },
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
              <Animated.View
                style={[
                  styles.controlBar,
                  {
                    opacity: controlsIn,
                    transform: [{ translateY: controlsSlide }],
                  },
                ]}
              >
                {isVideoCall && (
                  <TouchableOpacity
                    style={[
                      styles.circleBtn,
                      !isVideoEnabledEff && styles.circleBtnSolid,
                    ]}
                    onPress={handleVideo}
                    activeOpacity={0.85}
                  >
                    <Ionicons
                      name={isVideoEnabledEff ? 'videocam' : 'videocam-off'}
                      size={22}
                      color={isVideoEnabledEff ? '#FFFFFF' : '#0B0D14'}
                    />
                  </TouchableOpacity>
                )}

                <TouchableOpacity
                  style={[
                    styles.circleBtn,
                    isMutedEff && styles.circleBtnSolid,
                  ]}
                  onPress={handleMute}
                  activeOpacity={0.85}
                >
                  <Ionicons
                    name={isMutedEff ? 'mic-off' : 'mic'}
                    size={22}
                    color={isMutedEff ? '#0B0D14' : '#FFFFFF'}
                  />
                </TouchableOpacity>

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
                  style={[
                    styles.circleBtn,
                    isSpeakerEff && styles.circleBtnTeal,
                  ]}
                  onPress={handleSpeaker}
                  activeOpacity={0.85}
                >
                  <Ionicons
                    name={isSpeakerEff ? 'volume-high' : 'volume-medium'}
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

  bootstrapLoading: {
    ...StyleSheet.absoluteFillObject,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 14,
  },
  bootstrapText: {
    fontSize: 14,
    fontFamily: FONTS.bodyMedium,
    color: 'rgba(255,255,255,0.6)',
  },

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
