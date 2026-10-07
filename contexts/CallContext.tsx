// contexts/CallContext.tsx
// Global WebRTC call state — incoming/outgoing/active call management
// ✅ Web-safe: react-native-webrtc is native-only
// ✅ Phase 2: CallKeep native UI
// ✅ Speaker toggle via react-native-incall-manager
// ✅ Vibration on incoming call (foreground + background)
// ✅ Phase 12: WhatsApp-style call log insertion (caller side only)
// ✅ Phase 13: Remote-end auto-dismiss on receiver side
// ✅ Phase 14: conversationId passed from chat for reliable call log insert

import React, {
  createContext,
  useContext,
  useEffect,
  useRef,
  useState,
  useCallback,
  ReactNode,
} from 'react';
import { Platform, Vibration } from 'react-native';
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
  insertCallLog,
  getCall,
  Call,
  CallType,
  CallLogStatus,
} from '../lib/call';
import {
  createPeerConnection,
  getLocalStream,
  stopStream,
  serializeSdp,
  deserializeSdp,
  serializeIce,
  deserializeIce,
  startAudioSession,
  stopAudioSession,
  setSpeakerOn,
  setMicMuted,
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
    receiverInfo: { name: string; avatar: string | null },
    conversationId?: string
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
const DISCONNECT_GRACE_MS = 8000;
const REMOTE_END_UI_MS = 1200;

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
  const disconnectGraceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const iceCandidateQueueRef = useRef<any[]>([]);
  const remoteDescSetRef = useRef(false);
  const myIdRef = useRef<string | null>(null);
  const audioSessionStartedRef = useRef(false);

  // ✅ Call log bookkeeping
  const loggedCallIdsRef = useRef<Set<string>>(new Set());
  const activeSinceRef = useRef<number | null>(null);
  const activeCallRef = useRef<Call | null>(null);

  // ✅ Phase 13: Track whether we (as receiver) already handled an end event
  const remoteEndHandledRef = useRef<string | null>(null);

  // ✅ Phase 14: Remember which conversation this call belongs to
  const conversationIdRef = useRef<string | null>(null);

  // ============================================================
  // Shared: safe return to previous screen
  // ============================================================
  const safeBack = useCallback(() => {
    try {
      router.back();
    } catch {
      // ignore
    }
  }, [router]);

  // ============================================================
  // Call log helper — only caller inserts (dedup on device)
  // ============================================================
  const logCallOnce = useCallback(
    async (call: Call | null, status: CallLogStatus) => {
      if (!call) return;
      if (call.caller_id !== myIdRef.current) return;
      if (loggedCallIdsRef.current.has(call.id)) return;
      loggedCallIdsRef.current.add(call.id);

      let duration: number | null = null;
      if (status === 'answered') {
        if (activeSinceRef.current) {
          duration = Math.max(
            0,
            Math.round((Date.now() - activeSinceRef.current) / 1000)
          );
        } else if (call.accepted_at) {
          duration = Math.max(
            0,
            Math.round(
              (Date.now() - new Date(call.accepted_at).getTime()) / 1000
            )
          );
        } else {
          duration = 0;
        }
      }

      try {
        await insertCallLog({
          callId: call.id,
          conversationId: conversationIdRef.current,
          callerId: call.caller_id,
          receiverId: call.receiver_id,
          callType: call.call_type,
          status,
          durationSeconds: duration,
        });
      } catch (e) {
        console.warn('[call] logCallOnce failed:', e);
      }
    },
    []
  );

  const logByCallId = useCallback(
    async (callId: string | null, status: CallLogStatus) => {
      if (!callId) return;
      if (loggedCallIdsRef.current.has(callId)) return;
      try {
        const c = await getCall(callId);
        if (!c) return;
        await logCallOnce(c, status);
      } catch (e) {
        console.warn('[call] logByCallId failed:', e);
      }
    },
    [logCallOnce]
  );

  const cleanup = useCallback(() => {
    try {
      Vibration.cancel();
    } catch {}

    if (ringTimeoutRef.current) {
      clearTimeout(ringTimeoutRef.current);
      ringTimeoutRef.current = null;
    }
    if (disconnectGraceRef.current) {
      clearTimeout(disconnectGraceRef.current);
      disconnectGraceRef.current = null;
    }
    if (unsubCallRef.current) {
      try {
        unsubCallRef.current();
      } catch {}
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
    if (audioSessionStartedRef.current) {
      stopAudioSession();
      audioSessionStartedRef.current = false;
    }
    iceCandidateQueueRef.current = [];
    remoteDescSetRef.current = false;
    callIdRef.current = null;
    activeSinceRef.current = null;
    activeCallRef.current = null;
    remoteEndHandledRef.current = null;
    conversationIdRef.current = null;
    setLocalStream(null);
    setRemoteStream(null);
    setIsMuted(false);
    setIsSpeakerOn(false);
    setIsVideoEnabled(false);
  }, []);

  // ============================================================
  // Receiver-side: dismiss / end when remote (caller) acts
  // ============================================================
  const handleRemoteTermination = useCallback(
    (updated: Call): boolean => {
      const terminalStatuses: Call['status'][] = [
        'cancelled',
        'ended',
        'rejected',
        'missed',
      ];
      if (!terminalStatuses.includes(updated.status)) return false;

      const key = `${updated.id}:${updated.status}`;
      if (remoteEndHandledRef.current === key) return true;
      remoteEndHandledRef.current = key;

      if (updated.status === 'cancelled') {
        console.log('[call] remote cancelled while ringing — dismissing');
        hapticError();
        cleanup();
        setCallState('idle');
        setCurrentCall(null);
        setRemoteUserInfo(null);
        safeBack();
        return true;
      }

      if (updated.status === 'rejected' || updated.status === 'missed') {
        console.log('[call] remote rejected/missed — ending');
        hapticError();
        setCallState('ended');
        setTimeout(() => {
          cleanup();
          setCallState('idle');
          setCurrentCall(null);
          setRemoteUserInfo(null);
          safeBack();
        }, REMOTE_END_UI_MS);
        return true;
      }

      if (updated.status === 'ended') {
        console.log('[call] remote ended call — closing');
        hapticError();
        setCallState('ended');
        setTimeout(() => {
          cleanup();
          setCallState('idle');
          setCurrentCall(null);
          setRemoteUserInfo(null);
          safeBack();
        }, REMOTE_END_UI_MS);
        return true;
      }

      return false;
    },
    [cleanup, safeBack]
  );

  // Setup CallKeep
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
        try {
          Vibration.cancel();
        } catch {}
      },
      onEndCall: (callId) => {
        console.log('[call] user ended via CallKeep:', callId);
        if (callIdRef.current === callId) {
          const c = activeCallRef.current;
          if (c) {
            const status: CallLogStatus =
              c.status === 'accepted' || callState === 'active'
                ? 'answered'
                : 'cancelled';
            logCallOnce(c, status);
          } else {
            logByCallId(callId, 'cancelled');
          }

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

  // Init — get my user id
  useEffect(() => {
    (async () => {
      const uid = await getCurrentUserId();
      myIdRef.current = uid;
    })();
  }, []);

  // ============================================================
  // Subscribe to incoming calls + watch that call for remote end
  // ============================================================
  useEffect(() => {
    let unsub: (() => void) | null = null;

    (async () => {
      const uid = await getCurrentUserId();
      if (!uid) return;
      myIdRef.current = uid;

      unsub = subscribeToIncomingCalls(uid, async (incomingCall) => {
        if (callState !== 'idle') return;

        const age =
          Date.now() - new Date(incomingCall.created_at).getTime();
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
        activeCallRef.current = incomingCall;
        callIdRef.current = incomingCall.id;
        setCallState('ringing');
        hapticMedium();

        try {
          Vibration.vibrate([0, 1000, 1000], true);
        } catch {}

        displayIncomingCall(
          incomingCall.id,
          profile?.display_name ?? 'Unknown',
          incomingCall.call_type === 'video'
        );

        router.push(
          `/call/${incomingCall.id}?role=receiver&type=${incomingCall.call_type}`
        );

        // Watch this call for remote updates (cancel / end)
        if (unsubCallRef.current) {
          try {
            unsubCallRef.current();
          } catch {}
          unsubCallRef.current = null;
        }

        unsubCallRef.current = subscribeToCall(
          incomingCall.id,
          async (updated) => {
            if (updated.status === 'cancelled') {
              handleRemoteTermination(updated);
              return;
            }
            if (updated.status === 'ended') {
              handleRemoteTermination(updated);
              return;
            }
            if (updated.status === 'missed') {
              handleRemoteTermination(updated);
              return;
            }
          }
        );
      });
    })();

    return () => {
      if (unsub) unsub();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Setup peer connection
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

      const handleDisconnected = () => {
        console.log('[call] connection disconnected — starting grace timer');
        if (disconnectGraceRef.current) {
          clearTimeout(disconnectGraceRef.current);
        }
        disconnectGraceRef.current = setTimeout(() => {
          const currentPc = pcRef.current;
          if (!currentPc) return;
          const state = currentPc.connectionState;
          console.log('[call] grace expired, current state:', state);
          if (state !== 'connected') {
            if (callIdRef.current) {
              logByCallId(callIdRef.current, 'answered');
              apiEndCall(callIdRef.current, myIdRef.current ?? '').catch(
                () => {}
              );
            }
            setCallState('ended');
            setTimeout(() => {
              cleanup();
              setCallState('idle');
              setCurrentCall(null);
              setRemoteUserInfo(null);
            }, 1500);
          }
        }, DISCONNECT_GRACE_MS);
      };

      const handleFailed = () => {
        console.log('[call] connection failed — ending');
        if (callIdRef.current) {
          logByCallId(callIdRef.current, 'answered');
          apiEndCall(callIdRef.current, myIdRef.current ?? '').catch(() => {});
        }
        setCallState('ended');
        setTimeout(() => {
          cleanup();
          setCallState('idle');
          setCurrentCall(null);
          setRemoteUserInfo(null);
        }, 1500);
      };

      const handleConnected = () => {
        console.log('[call] connection connected');
        try {
          Vibration.cancel();
        } catch {}

        if (!activeSinceRef.current) {
          activeSinceRef.current = Date.now();
        }

        if (disconnectGraceRef.current) {
          clearTimeout(disconnectGraceRef.current);
          disconnectGraceRef.current = null;
        }
        setCallState('active');
      };

      pc.addEventListener('connectionstatechange', () => {
        const state = pc.connectionState;
        console.log('[call] connectionState:', state);
        if (state === 'connected') {
          handleConnected();
        } else if (state === 'failed' || state === 'closed') {
          handleFailed();
        } else if (state === 'disconnected') {
          handleDisconnected();
        }
      });

      pc.addEventListener('iceconnectionstatechange', () => {
        const iceState = pc.iceConnectionState;
        console.log('[call] iceConnectionState:', iceState);
        if (iceState === 'failed') {
          handleFailed();
        } else if (iceState === 'disconnected') {
          handleDisconnected();
        } else if (iceState === 'connected' || iceState === 'completed') {
          handleConnected();
        }
      });

      const signalChannel = supabase
        .channel(`call-signal:${callId}`)
        .on(
          'broadcast',
          { event: 'ice-candidate' },
          async ({ payload }: any) => {
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
          }
        )
        .subscribe();

      if (!audioSessionStartedRef.current) {
        startAudioSession(callType === 'video');
        audioSessionStartedRef.current = true;
        setIsSpeakerOn(callType === 'video');
      }

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
    [cleanup, logByCallId]
  );

  const startCall = useCallback(
    async (
      receiverId: string,
      callType: CallType,
      receiverInfo: { name: string; avatar: string | null },
      conversationId?: string
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

      // ✅ Phase 14: remember conversation for call log
      conversationIdRef.current = conversationId ?? null;

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
        activeCallRef.current = call;
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
            logCallOnce(call, 'declined');
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
            const finalStatus: CallLogStatus = updated.accepted_at
              ? 'answered'
              : 'cancelled';
            logCallOnce(
              {
                ...call,
                accepted_at: updated.accepted_at ?? call.accepted_at,
              },
              finalStatus
            );
            setCallState('ended');
            setTimeout(() => {
              cleanup();
              setCallState('idle');
              setCurrentCall(null);
              setRemoteUserInfo(null);
            }, 1500);
          } else if (updated.status === 'missed') {
            hapticError();
            logCallOnce(call, 'missed');
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
          logCallOnce(call, 'missed');
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
    [callState, cleanup, router, setupPeerConnection, logCallOnce]
  );

  const acceptIncomingCall = useCallback(async () => {
    if (callState !== 'ringing' || !currentCall) return;

    try {
      Vibration.cancel();
    } catch {}

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

  const endCurrentCall = useCallback(async () => {
    const myId = myIdRef.current;
    const call = currentCall;
    if (!call) return;

    const wasRinging = call.status === 'ringing';
    const isCaller = call.caller_id === myId;

    try {
      if (wasRinging && isCaller) {
        await apiCancelCall(call.id, myId ?? '');
      } else {
        await apiEndCall(call.id, myId ?? '');
      }
    } catch (err) {
      console.warn('[call] end error:', err);
    }

    if (isCaller) {
      if (wasRinging) {
        logCallOnce(call, 'cancelled');
      } else {
        logCallOnce(call, 'answered');
      }
    }

    cleanup();
    setCallState('idle');
    setCurrentCall(null);
    setRemoteUserInfo(null);
    router.back();
  }, [currentCall, cleanup, router, logCallOnce]);

  const toggleMute = useCallback(() => {
    const stream = localStreamRef.current;
    if (!stream) return;
    const audioTrack = stream.getAudioTracks()[0];
    if (audioTrack) {
      audioTrack.enabled = !audioTrack.enabled;
      const muted = !audioTrack.enabled;
      setIsMuted(muted);
      setMicMuted(muted);
    }
  }, []);

  const toggleSpeaker = useCallback(() => {
    setIsSpeakerOn((prev) => {
      const next = !prev;
      setSpeakerOn(next);
      return next;
    });
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

export function useCall(): CallContextValue {
  const ctx = useContext(CallContext);
  if (!ctx) {
    throw new Error('useCall must be used within CallProvider');
  }
  return ctx;
}
