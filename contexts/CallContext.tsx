// contexts/CallContext.tsx
// Global WebRTC call state — incoming/outgoing/active call management
// ✅ Web-safe: react-native-webrtc is native-only
// ✅ Phase 2: CallKeep native UI for background/locked calls

import React, {
  createContext,
  useContext,
  useEffect,
  useRef,
  useState,
  useCallback,
  ReactNode,
} from 'react';
import { Platform } from 'react-native';
import { useRouter } from 'expo-router';
import { supabase } from '../lib/supabase';
import { getCurrentUserId } from '../lib/auth';
import {
  createCall,
  acceptCall as apiAcceptCall,
  rejectCall as apiRejectCall,
  cancelCall as apiCancelCall,
  endCall as apiEndCall,
  subscribeToCall,
  subscribeToIncomingCalls,
  Call,
  CallType,
} from '../lib/call';
import {
  createPeerConnection,
  getLocalStream,
  stopStream,
  serializeSdp,
  deserializeSdp,
  serializeIce,
  deserializeIce,
} from '../lib/webrtc';
import {
  setupCallKeep,
  displayIncomingCall,
  endCallKeep,
  registerCallKeepEvents,
  setAvailable,
} from '../lib/callkeep';
import { hapticMedium, hapticSuccess, hapticError } from '../lib/haptics';

// ✅ Web-safe: react-native-webrtc is native-only
let RNWebRTC: any = null;
if (Platform.OS !== 'web') {
  try {
    RNWebRTC = require('react-native-webrtc');
  } catch (err) {
    console.warn('[CallContext] react-native-webrtc not available:', err);
  }
}
const MediaStream: any = RNWebRTC?.MediaStream;

// ============================================================
// Types
// ============================================================

export type CallState =
  | 'idle'
  | 'calling'
  | 'ringing'
  | 'connecting'
  | 'active'
  | 'ended';

type CallContextValue = {
  callState: CallState;
  currentCall: Call | null;
  localStream: any | null;
  remoteStream: any | null;
  isMuted: boolean;
  isSpeakerOn: boolean;
  isVideoEnabled: boolean;
  remoteUserInfo: { id: string; name: string; avatar: string | null } | null;

  startCall: (
    receiverId: string,
    callType: CallType,
    receiverInfo: { name: string; avatar: string | null }
  ) => Promise<void>;
  acceptIncomingCall: () => Promise<void>;
  rejectIncomingCall: () => Promise<void>;
  endCurrentCall: () => Promise<void>;
  toggleMute: () => void;
  toggleSpeaker: () => void;
  toggleVideo: () => void;
};

const CallContext = createContext<CallContextValue | null>(null);

const RING_TIMEOUT_MS = 60000;

export function CallProvider({ children }: { children: ReactNode }) {
  const router = useRouter();

  const [callState, setCallState] = useState<CallState>('idle');
  const [currentCall, setCurrentCall] = useState<Call | null>(null);
  const [localStream, setLocalStream] = useState<any>(null);
  const [remoteStream, setRemoteStream] = useState<any>(null);
  const [isMuted, setIsMuted] = useState(false);
  const [isSpeakerOn, setIsSpeakerOn] = useState(false);
  const [isVideoEnabled, setIsVideoEnabled] = useState(false);
  const [remoteUserInfo, setRemoteUserInfo] = useState<{
    id: string;
    name: string;
    avatar: string | null;
  } | null>(null);

  const pcRef = useRef<any>(null);
  const localStreamRef = useRef<any>(null);
  const callIdRef = useRef<string | null>(null);
  const unsubCallRef = useRef<(() => void) | null>(null);
  const ringTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const iceCandidateQueueRef = useRef<any[]>([]);
  const remoteDescSetRef = useRef(false);
  const myIdRef = useRef<string | null>(null);

  // ------------------------------------------------------------
  // Setup CallKeep
  // ------------------------------------------------------------
  useEffect(() => {
    if (Platform.OS === 'web') return;

    (async () => {
      const ok = await setupCallKeep();
      if (ok) {
        setAvailable();
        console.log('[call] CallKeep ready');
      }
    })();

    const unregister = registerCallKeepEvents({
      onAnswerCall: (callId) => {
        console.log('[call] user answered via CallKeep:', callId);
      },
      onEndCall: (callId) => {
        console.log('[call] user ended via CallKeep:', callId);
        if (callIdRef.current === callId) {
          cleanup();
          setCallState('idle');
          setCurrentCall(null);
          setRemoteUserInfo(null);
        }
      },
    });

    return unregister;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ------------------------------------------------------------
  // Cleanup
  // ------------------------------------------------------------
  const cleanup = useCallback(() => {
    if (ringTimeoutRef.current) {
      clearTimeout(ringTimeoutRef.current);
      ringTimeoutRef.current = null;
    }
    if (unsubCallRef.current) {
      unsubCallRef.current();
      unsubCallRef.current = null;
    }
    if (pcRef.current) {
      try {
        pcRef.current.close();
      } catch {}
      pcRef.current = null;
    }
    if (localStreamRef.current) {
      stopStream(localStreamRef.current);
      localStreamRef.current = null;
    }
    if (callIdRef.current) {
      try {
        endCallKeep(callIdRef.current);
      } catch {}
    }
    iceCandidateQueueRef.current = [];
    remoteDescSetRef.current = false;
    callIdRef.current = null;
    setLocalStream(null);
    setRemoteStream(null);
    setIsMuted(false);
    setIsSpeakerOn(false);
    setIsVideoEnabled(false);
  }, []);

  // ------------------------------------------------------------
  // Init — get my user id
  // ------------------------------------------------------------
  useEffect(() => {
    (async () => {
      const uid = await getCurrentUserId();
      myIdRef.current = uid;
    })();
  }, []);

  // ------------------------------------------------------------
  // Subscribe to incoming calls
  // ------------------------------------------------------------
  useEffect(() => {
    let unsub: (() => void) | null = null;

    (async () => {
      const uid = await getCurrentUserId();
      if (!uid) return;
      myIdRef.current = uid;

      unsub = subscribeToIncomingCalls(uid, async (incomingCall) => {
        if (callState !== 'idle') return;

        const age = Date.now() - new Date(incomingCall.created_at).getTime();
        if (age > 30000) return;

        const { data: profile } = await supabase
          .from('profiles')
          .select('id, display_name, avatar_url')
          .eq('id', incomingCall.caller_id)
          .single();

        setRemoteUserInfo({
          id: incomingCall.caller_id,
          name: profile?.display_name ?? 'Unknown',
          avatar: profile?.avatar_url ?? null,
        });

        setCurrentCall(incomingCall);
        callIdRef.current = incomingCall.id;
        setCallState('ringing');
        hapticMedium();

        displayIncomingCall(
          incomingCall.id,
          profile?.display_name ?? 'Unknown',
          incomingCall.call_type === 'video'
        );

        router.push(
          `/call/${incomingCall.id}?role=receiver&type=${incomingCall.call_type}`
        );
      });
    })();

    return () => {
      if (unsub) unsub();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ------------------------------------------------------------
  // Setup peer connection
  // ------------------------------------------------------------
  const setupPeerConnection = useCallback(
    async (
      callId: string,
      isCaller: boolean,
      callType: CallType,
      initialOffer?: any
    ) => {
      if (Platform.OS === 'web') {
        throw new Error('Calls are not supported on web');
      }

      const pc = createPeerConnection();
      pcRef.current = pc;

      const stream = await getLocalStream(callType === 'video');
      localStreamRef.current = stream;
      setLocalStream(stream);

      stream.getTracks().forEach((track: any) => {
        pc.addTrack(track, stream);
      });

      const remote = new MediaStream();
      setRemoteStream(remote);

      pc.addEventListener('track', (event: any) => {
        if (event.streams && event.streams[0]) {
          setRemoteStream(event.streams[0]);
        } else if (event.track) {
          remote.addTrack(event.track);
        }
      });

      pc.addEventListener('icecandidate', async (event: any) => {
        if (!event.candidate) return;
        try {
          const channel = supabase.channel(`call-signal:${callId}`);
          await channel.send({
            type: 'broadcast',
            event: 'ice-candidate',
            payload: {
              from: myIdRef.current,
              candidate: serializeIce(event.candidate),
            },
          });
        } catch (err) {
          console.warn('[call] ICE send error:', err);
        }
      });

      pc.addEventListener('connectionstatechange', () => {
        const state = pc.connectionState;
        if (state === 'connected') {
          setCallState('active');
        } else if (
          state === 'failed' ||
          state === 'disconnected' ||
          state === 'closed'
        ) {
          if (callIdRef.current) {
            apiEndCall(callIdRef.current, myIdRef.current ?? '').catch(() => {});
          }
          setCallState('ended');
          setTimeout(() => {
            cleanup();
            setCallState('idle');
            setCurrentCall(null);
            setRemoteUserInfo(null);
          }, 1500);
        }
      });

      const signalChannel = supabase
        .channel(`call-signal:${callId}`)
        .on('broadcast', { event: 'ice-candidate' }, async ({ payload }: any) => {
          if (!payload || payload.from === myIdRef.current) return;
          const candidate = deserializeIce(payload.candidate);
          if (pc.remoteDescription) {
            try {
              await pc.addIceCandidate(candidate);
            } catch (err) {
              console.warn('[call] addIceCandidate error:', err);
            }
          } else {
            iceCandidateQueueRef.current.push(candidate);
          }
        })
        .subscribe();

      if (isCaller) {
        const offer = await pc.createOffer({});
        await pc.setLocalDescription(offer);
        const sdp = serializeSdp(pc.localDescription);
        return { pc, sdp };
      } else if (initialOffer) {
        await pc.setRemoteDescription(deserializeSdp(initialOffer));
        remoteDescSetRef.current = true;

        for (const c of iceCandidateQueueRef.current) {
          try {
            await pc.addIceCandidate(c);
          } catch {}
        }
        iceCandidateQueueRef.current = [];

        const answer = await pc.createAnswer();
        await pc.setLocalDescription(answer);
        const sdp = serializeSdp(pc.localDescription);
        return { pc, sdp };
      }

      return { pc, sdp: null };
    },
    [cleanup]
  );

  // ------------------------------------------------------------
  // Start outgoing call
  // ------------------------------------------------------------
  const startCall = useCallback(
    async (
      receiverId: string,
      callType: CallType,
      receiverInfo: { name: string; avatar: string | null }
    ) => {
      if (callState !== 'idle') return;
      if (Platform.OS === 'web') {
        hapticError();
        console.warn('[call] Calls not supported on web');
        return;
      }
      const myId = myIdRef.current ?? (await getCurrentUserId());
      if (!myId) return;
      myIdRef.current = myId;

      setRemoteUserInfo({
        id: receiverId,
        name: receiverInfo.name,
        avatar: receiverInfo.avatar,
      });

      try {
        setCallState('calling');

        const tempCallId = `pending-${Date.now()}`;
        const { sdp } = await setupPeerConnection(tempCallId, true, callType);

        if (!sdp) throw new Error('No SDP generated');

        const call = await createCall(myId, receiverId, callType, sdp);
        callIdRef.current = call.id;
        setCurrentCall(call);
        setIsVideoEnabled(callType === 'video');

        try {
          const { data: myProfile } = await supabase
            .from('profiles')
            .select('display_name')
            .eq('id', myId)
            .single();

          await supabase.functions.invoke('send-push', {
            body: {
              userId: receiverId,
              title: myProfile?.display_name ?? 'Airalance',
              body: `Incoming ${callType} call`,
              data: {
                screen: 'call',
                callId: call.id,
                callerId: myId,
                callType,
              },
            },
          });
        } catch (err) {
          console.warn('[call] push send failed:', err);
        }

        unsubCallRef.current = subscribeToCall(call.id, async (updated) => {
          if (updated.status === 'accepted' && updated.answer) {
            const pc = pcRef.current;
            if (pc && !pc.remoteDescription) {
              await pc.setRemoteDescription(deserializeSdp(updated.answer));
              remoteDescSetRef.current = true;

              for (const c of iceCandidateQueueRef.current) {
                try {
                  await pc.addIceCandidate(c);
                } catch {}
              }
              iceCandidateQueueRef.current = [];
            }
            setCallState('connecting');
          } else if (updated.status === 'rejected') {
            hapticError();
            setCallState('ended');
            setTimeout(() => {
              cleanup();
              setCallState('idle');
              setCurrentCall(null);
              setRemoteUserInfo(null);
            }, 1500);
          } else if (
            updated.status === 'ended' ||
            updated.status === 'cancelled'
          ) {
            setCallState('ended');
            setTimeout(() => {
              cleanup();
              setCallState('idle');
              setCurrentCall(null);
              setRemoteUserInfo(null);
            }, 1500);
          } else if (updated.status === 'missed') {
            hapticError();
            setCallState('ended');
            setTimeout(() => {
              cleanup();
              setCallState('idle');
              setCurrentCall(null);
              setRemoteUserInfo(null);
            }, 1500);
          }
        });

        ringTimeoutRef.current = setTimeout(async () => {
          try {
            await apiCancelCall(call.id, myId);
          } catch {}
          cleanup();
          setCallState('idle');
          setCurrentCall(null);
          setRemoteUserInfo(null);
        }, RING_TIMEOUT_MS);

        router.push(`/call/${call.id}?role=caller&type=${callType}`);
      } catch (err) {
        console.warn('[call] startCall error:', err);
        hapticError();
        cleanup();
        setCallState('idle');
        setCurrentCall(null);
        setRemoteUserInfo(null);
      }
    },
    [callState, cleanup, router, setupPeerConnection]
  );

  // ------------------------------------------------------------
  // Accept incoming call
  // ------------------------------------------------------------
  const acceptIncomingCall = useCallback(async () => {
    if (callState !== 'ringing' || !currentCall) return;

    if (ringTimeoutRef.current) {
      clearTimeout(ringTimeoutRef.current);
      ringTimeoutRef.current = null;
    }

    try {
      setCallState('connecting');

      const { sdp } = await setupPeerConnection(
        currentCall.id,
        false,
        currentCall.call_type,
        currentCall.offer
      );

      if (!sdp) throw new Error('No answer SDP');

      await apiAcceptCall(currentCall.id, sdp);
      setIsVideoEnabled(currentCall.call_type === 'video');
      hapticSuccess();
    } catch (err) {
      console.warn('[call] accept error:', err);
      hapticError();
      try {
        await apiRejectCall(currentCall.id);
      } catch {}
      cleanup();
      setCallState('idle');
      setCurrentCall(null);
      setRemoteUserInfo(null);
      router.back();
    }
  }, [callState, currentCall, cleanup, router, setupPeerConnection]);

  // ------------------------------------------------------------
  // Reject incoming call
  // ------------------------------------------------------------
  const rejectIncomingCall = useCallback(async () => {
    if (!currentCall) return;
    try {
      await apiRejectCall(currentCall.id);
    } catch {}
    cleanup();
    setCallState('idle');
    setCurrentCall(null);
    setRemoteUserInfo(null);
    router.back();
  }, [currentCall, cleanup, router]);

  // ------------------------------------------------------------
  // End current call
  // ------------------------------------------------------------
  const endCurrentCall = useCallback(async () => {
    const myId = myIdRef.current;
    const call = currentCall;
    if (!call) return;

    try {
      if (call.status === 'ringing' && call.caller_id === myId) {
        await apiCancelCall(call.id, myId);
      } else {
        await apiEndCall(call.id, myId ?? '');
      }
    } catch (err) {
      console.warn('[call] end error:', err);
    }

    cleanup();
    setCallState('idle');
    setCurrentCall(null);
    setRemoteUserInfo(null);
    router.back();
  }, [currentCall, cleanup, router]);

  // ------------------------------------------------------------
  // Toggle controls
  // ------------------------------------------------------------
  const toggleMute = useCallback(() => {
    const stream = localStreamRef.current;
    if (!stream) return;
    const audioTrack = stream.getAudioTracks()[0];
    if (audioTrack) {
      audioTrack.enabled = !audioTrack.enabled;
      setIsMuted(!audioTrack.enabled);
    }
  }, []);

  const toggleSpeaker = useCallback(() => {
    setIsSpeakerOn((prev) => !prev);
  }, []);

  const toggleVideo = useCallback(() => {
    const stream = localStreamRef.current;
    if (!stream) return;
    const videoTrack = stream.getVideoTracks()[0];
    if (videoTrack) {
      videoTrack.enabled = !videoTrack.enabled;
      setIsVideoEnabled(videoTrack.enabled);
    }
  }, []);

  // ------------------------------------------------------------
  // Cleanup on unmount
  // ------------------------------------------------------------
  useEffect(() => {
    return () => {
      cleanup();
    };
  }, [cleanup]);

  const value: CallContextValue = {
    callState,
    currentCall,
    localStream,
    remoteStream,
    isMuted,
    isSpeakerOn,
    isVideoEnabled,
    remoteUserInfo,
    startCall,
    acceptIncomingCall,
    rejectIncomingCall,
    endCurrentCall,
    toggleMute,
    toggleSpeaker,
    toggleVideo,
  };

  return (
    <CallContext.Provider value={value}>
      {children}
    </CallContext.Provider>
  );
}

// ============================================================
// Hook
// ============================================================

export function useCall(): CallContextValue {
  const ctx = useContext(CallContext);
  if (!ctx) {
    throw new Error('useCall must be used within CallProvider');
  }
  return ctx;
}
