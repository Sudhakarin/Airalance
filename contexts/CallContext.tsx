// contexts/CallContext.tsx
// Global WebRTC call state — incoming/outgoing/active call management
// ✅ FIX: Reuse single signaling channel (fixes slow network drops)
// ✅ FIX: CallKeep answer now triggers WebRTC accept
// ✅ FIX: Increased timeouts (60s ring, 60s incoming age)
// ✅ FIX: Handled incoming call missed/ended state
// ✅ FIX: CallKeep setup runs ONCE, only after login, and AFTER the permission
//         flow (no more dialog clash / pre-login phone-account alert)
// ✅ FIX: mic/camera checked before starting or accepting a call
//         (denied → "Open Settings" alert instead of silent failure)
// ✅ FIX: answering a VIDEO call from CallKeep no longer opens as audio
// ✅ ACCURACY: every call end (cancel / reject / hang-up / timeout) now reaches the
//    other phone THREE ways: realtime + 1.5s safety poll + instant push signal
// ✅ FIX: hang-up after the call was answered used to be logged/sent as "cancelled"
//    (stale 'ringing' status) — now uses the real call state
// ✅ NEW: Android incoming call = WhatsApp-style notification (lib/callNotification).
//         openIncomingFromPush() opens/answers a call from that notification,
//         caller hang-up sends a cancel push so the notification disappears

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
import {
  cancelCallNotification,
  isCallNotificationAvailable,
} from '../lib/callNotification';
import { onForegroundMessage } from '../lib/fcm';
import { getCallPerson, pickName } from '../lib/callProfile';
import {
  ensureCallPermissions,
  whenPermissionFlowSettled,
} from '../lib/permissions';
import CallSetupModal from '../components/CallSetupModal';
import { shouldShowCallSetup, markCallSetupShown } from '../lib/callSetup';

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
  openIncomingFromPush: (callId: string, autoAnswer: boolean) => Promise<void>;
  rejectIncomingCall: () => Promise<void>;
  endCurrentCall: () => Promise<void>;
  toggleMute: () => void;
  toggleSpeaker: () => void;
  toggleVideo: () => void;
};

const CallContext = createContext<CallContextValue | null>(null);

// ============================================================
// Call status: realtime + safety poll
// Realtime alone can silently fail (table not in publication, flaky network,
// app resumed). A single-row poll every 1.5s makes call end/reject/cancel
// arrive reliably on BOTH phones. pollNow() is also triggered by an FCM signal.
// ============================================================
const CALL_POLL_MS = 1500;
const pollNowHandlers = new Set<() => void>();
// callId -> apply a terminal status coming from the push (works even if DB write/realtime failed)
const forceStatusHandlers = new Map<string, (status: string) => void>();

// ============================================================
// INSTANT call-end signal: Supabase Realtime BROADCAST (websocket, no database).
// ~100ms phone → phone. DB write + push still happen as backups.
// ============================================================
const ctlChannels = new Map<string, any>();

function broadcastCallStatus(callId: string, status: string): Promise<void> {
  const ch = ctlChannels.get(callId);
  if (!ch) return Promise.resolve();
  return Promise.race([
    Promise.resolve(
      ch.send({ type: 'broadcast', event: 'status', payload: { status } })
    )
      .then(() => undefined)
      .catch(() => undefined),
    new Promise<void>((r) => setTimeout(r, 300)),
  ]);
}

function subscribeCallWithPoll(
  callId: string,
  handler: (c: Call) => void | Promise<void>
): () => void {
  let lastKey = 'ringing:0';
  let stopped = false;
  let busy = false;
  const keyOf = (c: Call) => `${c.status}:${c.answer ? 1 : 0}`;

  const unsub = subscribeToCall(callId, (updated) => {
    lastKey = keyOf(updated);
    handler(updated);
  });

  const poll = async () => {
    if (stopped || busy) return;
    busy = true;
    try {
      const row = await getCall(callId);
      if (!stopped && row && keyOf(row) !== lastKey) {
        lastKey = keyOf(row);
        await handler(row);
      }
    } catch {
    } finally {
      busy = false;
    }
  };

  const timer = setInterval(poll, CALL_POLL_MS);
  pollNowHandlers.add(poll);

  // Join the instant-signal channel for this call
  let ctl: any = null;
  try {
    ctl = supabase.channel(`callctl:${callId}`, {
      config: { broadcast: { self: false } },
    });
    ctl
      .on('broadcast', { event: 'status' }, (msg: any) => {
        const st = msg?.payload?.status;
        if (st) forceStatusHandlers.get(callId)?.(String(st));
      })
      .subscribe();
    ctlChannels.set(callId, ctl);
  } catch {}
  forceStatusHandlers.set(callId, (status: string) => {
    if (stopped) return;
    if (!['rejected', 'cancelled', 'ended', 'missed'].includes(status)) return;
    if (lastKey.startsWith(status + ':')) return; // already handled
    lastKey = `${status}:0`;
    handler({
      id: callId,
      status,
      ended_at: new Date().toISOString(),
    } as unknown as Call);
  });

  return () => {
    stopped = true;
    clearInterval(timer);
    pollNowHandlers.delete(poll);
    forceStatusHandlers.delete(callId);
    ctlChannels.delete(callId);
    if (ctl) {
      try {
        supabase.removeChannel(ctl);
      } catch {}
    }
    try {
      unsub();
    } catch {}
  };
}

const RING_TIMEOUT_MS = 45000; // WhatsApp-like: unanswered call stops after 45s
const DISCONNECT_GRACE_MS = 15000; // ✅ FIX: 8s -> 15s
const REMOTE_END_UI_MS = 1200;
const INCOMING_AGE_MAX_MS = 60000; // ✅ FIX: 30s -> 60s (push delay ke liye)

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
  const callStateRef = useRef<CallState>('idle');
  callStateRef.current = callState;
  const pendingAutoAnswerRef = useRef<string | null>(null);

  // "Allow for calls" popup — only on the FIRST tap of the call button
  const [setupVisible, setSetupVisible] = useState(false);
  const setupResolveRef = useRef<(() => void) | null>(null);
  const requestCallSetupIfNeeded = useCallback(async () => {
    if (!(await shouldShowCallSetup())) return;
    await markCallSetupShown();
    await new Promise<void>((resolve) => {
      setupResolveRef.current = resolve;
      setSetupVisible(true);
    });
  }, []);
  const closeCallSetup = useCallback(() => {
    setSetupVisible(false);
    const r = setupResolveRef.current;
    setupResolveRef.current = null;
    r?.();
  }, []);
  const openingCallIdRef = useRef<string | null>(null);

  // ✅ FIX: Reusable signaling channel to prevent rate limits
  const signalChannelRef = useRef<any>(null);

  const loggedCallIdsRef = useRef<Set<string>>(new Set());
  const activeSinceRef = useRef<number | null>(null);
  const activeCallRef = useRef<Call | null>(null);
  const remoteEndHandledRef = useRef<string | null>(null);
  const conversationIdRef = useRef<string | null>(null);

  const safeBack = useCallback(() => {
    try {
      router.back();
    } catch {}
  }, [router]);

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

    // First call finished (caller OR receiver) → one-time "Allow for calls" popup.
    // Receivers never press the call button, so this is how they get it.
    if (callIdRef.current) {
      setTimeout(() => {
        requestCallSetupIfNeeded().catch(() => {});
      }, 1500);
    }

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
    
    // ✅ FIX: Cleanup signaling channel
    if (signalChannelRef.current) {
      try {
        supabase.removeChannel(signalChannelRef.current);
      } catch {}
      signalChannelRef.current = null;
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
      cancelCallNotification(callIdRef.current).catch(() => {});
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
        hapticError();
        cleanup();
        setCallState('idle');
        setCurrentCall(null);
        setRemoteUserInfo(null);
        safeBack();
        return true;
      }

      if (
        updated.status === 'rejected' ||
        updated.status === 'missed' ||
        updated.status === 'ended'
      ) {
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

  // Instant "call ended" signal via push while the app is open
  useEffect(() => {
    if (Platform.OS === 'web') return;
    let unsub: any;
    try {
      unsub = onForegroundMessage((data: any) => {
        if (data?.screen === 'call_cancel') {
          if (data?.callId && data?.status) {
            forceStatusHandlers.get(String(data.callId))?.(String(data.status));
          }
          pollNowHandlers.forEach((fn) => fn());
        }
      });
    } catch {}
    return () => {
      try {
        if (typeof unsub === 'function') unsub();
      } catch {}
    };
  }, []);

  // Setup CallKeep — once, after login, after the permission flow finished
  const callKeepSetupRef = useRef(false);
  useEffect(() => {
    if (Platform.OS === 'web') return;
    let cancelled = false;

    const trySetup = async () => {
      if (callKeepSetupRef.current) return;
      const uid = await getCurrentUserId();
      if (!uid || cancelled || callKeepSetupRef.current) return;
      callKeepSetupRef.current = true;

      await whenPermissionFlowSettled();
      if (cancelled) {
        callKeepSetupRef.current = false;
        return;
      }

      try {
        const ok = await setupCallKeep();
        if (ok) {
          setAvailable();
          console.log('[call] CallKeep ready');
        }
      } catch (err) {
        console.warn('[call] CallKeep setup failed:', err);
      }
    };

    trySetup();
    const { data: authSub } = supabase.auth.onAuthStateChange(
      (_event, session) => {
        if (session?.user) trySetup();
      }
    );

    return () => {
      cancelled = true;
      authSub.subscription.unsubscribe();
    };
  }, []);

  // CallKeep native UI events (answer / end)
  useEffect(() => {
    if (Platform.OS === 'web') return;

    const unregister = registerCallKeepEvents({
      onAnswerCall: (callId) => {
        console.log('[call] user answered via CallKeep:', callId);
        try {
          Vibration.cancel();
        } catch {}
        
        // ✅ FIX: Auto-accept call if answered from CallKeep native UI
        if (callIdRef.current === callId && callState === 'ringing') {
           setCallState('connecting');
           // The actual API accept happens in the UI screen once mounted
           // but we push it just in case
           const answeredType =
            activeCallRef.current?.call_type === 'video' ? 'video' : 'audio';
           router.push(`/call/${callId}?role=receiver&type=${answeredType}`);
        }
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
  }, [callState, cleanup, logByCallId, logCallOnce, router]);

  useEffect(() => {
    (async () => {
      const uid = await getCurrentUserId();
      myIdRef.current = uid;
    })();
  }, []);

  useEffect(() => {
    let unsub: (() => void) | null = null;

    (async () => {
      const uid = await getCurrentUserId();
      if (!uid) return;
      myIdRef.current = uid;

      unsub = subscribeToIncomingCalls(uid, async (incomingCall) => {
        if (callState !== 'idle') return;

        const age = Date.now() - new Date(incomingCall.created_at).getTime();
        
        // ✅ FIX: Increased age limit for slow networks
        if (age > INCOMING_AGE_MAX_MS) return;

        const person = await getCallPerson(incomingCall.caller_id);

        setRemoteUserInfo({
          id: incomingCall.caller_id,
          name: person.name,
          avatar: person.avatar,
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
          person.name,
          incomingCall.call_type === 'video'
        );

        router.push(
          `/call/${incomingCall.id}?role=receiver&type=${incomingCall.call_type}`
        );

        if (unsubCallRef.current) {
          try {
            unsubCallRef.current();
          } catch {}
          unsubCallRef.current = null;
        }

        unsubCallRef.current = subscribeCallWithPoll(
          incomingCall.id,
          async (updated) => {
            handleRemoteTermination(updated);
          }
        );
      });
    })();

    return () => {
      if (unsub) unsub();
    };
  }, [callState, handleRemoteTermination, router]);

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

      // ✅ FIX: Initialize signaling channel ONCE
      const signalChannel = supabase.channel(`call-signal:${callId}`);
      signalChannelRef.current = signalChannel;

      signalChannel
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
          // ✅ FIX: Use the reusable signal channel instead of creating a new one
          if (signalChannelRef.current) {
            await signalChannelRef.current.send({
              type: 'broadcast',
              event: 'ice-candidate',
              payload: {
                from: myIdRef.current,
                candidate: serializeIce(event.candidate),
              },
            });
          }
        } catch (err) {
          console.warn('[call] ICE send error:', err);
        }
      });

      const handleDisconnected = () => {
        if (disconnectGraceRef.current) {
          clearTimeout(disconnectGraceRef.current);
        }
        disconnectGraceRef.current = setTimeout(() => {
          const currentPc = pcRef.current;
          if (!currentPc) return;
          const state = currentPc.connectionState;
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
            }, 600);
          }
        }, DISCONNECT_GRACE_MS);
      };

      const handleFailed = () => {
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
        }, 600);
      };

      const handleConnected = () => {
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
        if (iceState === 'failed') {
          handleFailed();
        } else if (iceState === 'disconnected') {
          handleDisconnected();
        } else if (iceState === 'connected' || iceState === 'completed') {
          handleConnected();
        }
      });

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

  // Tell the receiver's phone to remove the ringing notification
  const sendCancelPush = useCallback(
    (receiverId: string, callId: string, status: string) => {
    supabase.functions
      .invoke('send-push', {
        body: {
          userId: receiverId,
          title: 'Call update',
          body: 'Call update',
          data: { screen: 'call_cancel', callId, status },
        },
      })
      .catch(() => {});
  }, []);

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
        return;
      }
      const myId = myIdRef.current ?? (await getCurrentUserId());
      if (!myId) return;
      myIdRef.current = myId;

      // First call ever → show the "Allow for calls" popup, then continue
      await requestCallSetupIfNeeded();

      // ✅ mic (+ camera for video) must be allowed before we start
      const permOk = await ensureCallPermissions(callType === 'video');
      if (!permOk) {
        hapticError();
        return;
      }

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

        // Re-tag the signal channel with the real call ID
        if (signalChannelRef.current) {
           supabase.removeChannel(signalChannelRef.current);
        }
        const realChannel = supabase.channel(`call-signal:${call.id}`);
        signalChannelRef.current = realChannel;
        realChannel.on('broadcast', { event: 'ice-candidate' }, async ({ payload }: any) => {
            if (!payload || payload.from === myIdRef.current) return;
            const candidate = deserializeIce(payload.candidate);
            if (pcRef.current?.remoteDescription) {
              try { await pcRef.current.addIceCandidate(candidate); } catch (err) {}
            } else {
              iceCandidateQueueRef.current.push(candidate);
            }
        }).subscribe();

        try {
          const { data: myProfile } = await supabase
            .from('profiles')
            .select('username, display_name, avatar_url')
            .eq('id', myId)
            .single();

          await supabase.functions.invoke('send-push', {
            body: {
              userId: receiverId,
              title: pickName(myProfile, 'Airalance'),
              body: `Incoming ${callType} call`,
              data: {
                screen: 'call',
                callId: call.id,
                callerId: myId,
                callType,
                callerName: pickName(myProfile, ''),
                callerAvatar: myProfile?.avatar_url ?? '',
              },
            },
          });
        } catch (err) {
          console.warn('[call] push send failed:', err);
        }

        unsubCallRef.current = subscribeCallWithPoll(call.id, async (updated) => {
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
            }, 600);
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
            }, 600);
          } else if (updated.status === 'missed') {
            hapticError();
            logCallOnce(call, 'missed');
            setCallState('ended');
            setTimeout(() => {
              cleanup();
              setCallState('idle');
              setCurrentCall(null);
              setRemoteUserInfo(null);
            }, 600);
          }
        });

        ringTimeoutRef.current = setTimeout(async () => {
          await broadcastCallStatus(call.id, 'cancelled');
          sendCancelPush(receiverId, call.id, 'cancelled');
          apiCancelCall(call.id, myId).catch(() => {});
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

    cancelCallNotification(currentCall.id).catch(() => {});
    try {
      Vibration.cancel();
    } catch {}

    if (ringTimeoutRef.current) {
      clearTimeout(ringTimeoutRef.current);
      ringTimeoutRef.current = null;
    }

    try {
      const permOk = await ensureCallPermissions(
        currentCall.call_type === 'video'
      );
      if (!permOk) throw new Error('Mic/camera permission not granted');

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

  // ---- Present a ringing call that arrived via push (notification) ----
  const presentIncomingCall = useCallback(
    async (incomingCall: Call) => {
      const person = await getCallPerson(incomingCall.caller_id);

      setRemoteUserInfo({
        id: incomingCall.caller_id,
        name: person.name,
        avatar: person.avatar,
      });

      setCurrentCall(incomingCall);
      activeCallRef.current = incomingCall;
      callIdRef.current = incomingCall.id;
      setCallState('ringing');
      hapticMedium();

      // The call screen has no ringtone of its own, so the notification keeps
      // ringing (loops) until answered / declined / cancelled — those paths
      // all call cancelCallNotification(). Stop it right away only when the
      // user already tapped "Answer". Without notifee, fall back to vibration.
      if (pendingAutoAnswerRef.current === incomingCall.id) {
        cancelCallNotification(incomingCall.id).catch(() => {});
      } else if (!isCallNotificationAvailable()) {
        try {
          Vibration.vibrate([0, 1000, 1000], true);
        } catch {}
      }

      router.push(
        `/call/${incomingCall.id}?role=receiver&type=${incomingCall.call_type}`
      );

      if (unsubCallRef.current) {
        try {
          unsubCallRef.current();
        } catch {}
        unsubCallRef.current = null;
      }
      unsubCallRef.current = subscribeCallWithPoll(incomingCall.id, async (updated) => {
        handleRemoteTermination(updated);
      });
    },
    [router, handleRemoteTermination]
  );

  // Called by IncomingCallBridge (notification tap / Answer / lock-screen launch)
  const openIncomingFromPush = useCallback(
    async (callId: string, autoAnswer: boolean) => {
      if (!callId || Platform.OS === 'web') return;

      if (callIdRef.current === callId) {
        if (autoAnswer && callStateRef.current === 'ringing') {
          pendingAutoAnswerRef.current = callId;
        }
        return;
      }
      if (callStateRef.current !== 'idle') return;
      if (openingCallIdRef.current === callId) return;
      openingCallIdRef.current = callId;

      try {
        const uid = myIdRef.current ?? (await getCurrentUserId());
        if (!uid) return;
        myIdRef.current = uid;

        const call = await getCall(callId);
        if (!call || call.receiver_id !== uid) return;

        const age = Date.now() - new Date(call.created_at).getTime();
        if (call.status !== 'ringing' || age > INCOMING_AGE_MAX_MS * 2) {
          cancelCallNotification(callId).catch(() => {});
          return;
        }

        if (autoAnswer) pendingAutoAnswerRef.current = callId;
        await presentIncomingCall(call);
      } catch (err) {
        console.warn('[call] openIncomingFromPush failed:', err);
      } finally {
        openingCallIdRef.current = null;
      }
    },
    [presentIncomingCall]
  );

  // "Answer" tapped on the notification → accept as soon as state is ringing
  useEffect(() => {
    if (callState !== 'ringing' || !currentCall) return;
    if (pendingAutoAnswerRef.current !== currentCall.id) return;
    pendingAutoAnswerRef.current = null;
    acceptIncomingCall();
  }, [callState, currentCall, acceptIncomingCall]);

  const rejectIncomingCall = useCallback(async () => {
    if (!currentCall) return;
    cancelCallNotification(currentCall.id).catch(() => {});
    // Tell the caller FIRST (instant broadcast; push + DB are backups)
    await broadcastCallStatus(currentCall.id, 'rejected');
    sendCancelPush(currentCall.caller_id, currentCall.id, 'rejected');
    apiRejectCall(currentCall.id).catch(() => {});
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

    // Real state (call.status in memory can still say 'ringing' after it was answered)
    const wasRinging =
      callStateRef.current === 'calling' || callStateRef.current === 'ringing';
    const isCaller = call.caller_id === myId;

    // 1) Tell the other phone FIRST (instant broadcast; push is the backup)
    const endStatus = wasRinging && isCaller ? 'cancelled' : 'ended';
    const otherId = isCaller ? call.receiver_id : call.caller_id;
    await broadcastCallStatus(call.id, endStatus);
    sendCancelPush(otherId, call.id, endStatus);

    // 2) Database write runs in the background — our screen doesn't wait for it
    (wasRinging && isCaller
      ? apiCancelCall(call.id, myId ?? '')
      : apiEndCall(call.id, myId ?? '')
    ).catch((err) => console.warn('[call] end error:', err));

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
    openIncomingFromPush,
    rejectIncomingCall,
    endCurrentCall,
    toggleMute,
    toggleSpeaker,
    toggleVideo,
  };

  return (
    <CallContext.Provider value={value}>
      {children}
      <CallSetupModal visible={setupVisible} onClose={closeCallSetup} />
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
