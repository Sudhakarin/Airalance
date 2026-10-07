// lib/webrtc.ts
// WebRTC core helpers — peer connection, media streams, ICE servers, audio routing
// ✅ Web-safe: react-native-webrtc is native-only

import { Platform } from 'react-native';

let RNWebRTC: any = null;
if (Platform.OS !== 'web') {
  try {
    RNWebRTC = require('react-native-webrtc');
  } catch (err) {
    console.warn('[webrtc] react-native-webrtc not available:', err);
  }
}

// ✅ InCallManager for proper audio routing (speaker/earpiece switch)
let InCallManager: any = null;
if (Platform.OS !== 'web') {
  try {
    const ICM = require('react-native-incall-manager');
    InCallManager = ICM?.default ?? ICM;
  } catch (err) {
    console.warn('[webrtc] incall-manager not available:', err);
  }
}

const RTCPeerConnection = RNWebRTC?.RTCPeerConnection;
const RTCIceCandidate = RNWebRTC?.RTCIceCandidate;
const RTCSessionDescription = RNWebRTC?.RTCSessionDescription;
const mediaDevices = RNWebRTC?.mediaDevices;
const MediaStream: any = RNWebRTC?.MediaStream;

// ============================================================
// ICE Servers — STUN (public) + TURN (free relay for NAT)
// ============================================================

const ICE_SERVERS = [
  { urls: 'stun:stun.l.google.com:19302' },
  { urls: 'stun:stun1.l.google.com:19302' },
  { urls: 'stun:stun2.l.google.com:19302' },
  {
    urls: 'turn:openrelay.metered.ca:80',
    username: 'openrelayproject',
    credential: 'openrelayproject',
  },
  {
    urls: 'turn:openrelay.metered.ca:443',
    username: 'openrelayproject',
    credential: 'openrelayproject',
  },
  {
    urls: 'turn:openrelay.metered.ca:443?transport=tcp',
    username: 'openrelayproject',
    credential: 'openrelayproject',
  },
];

export const peerConstraints = {
  iceServers: ICE_SERVERS,
  iceCandidatePoolSize: 10,
  iceTransportPolicy: 'all' as const,
};

// ============================================================
// Media stream helpers
// ============================================================

export async function getLocalStream(video: boolean): Promise<any> {
  if (!mediaDevices) {
    throw new Error('WebRTC not supported on this platform');
  }
  const stream = await mediaDevices.getUserMedia({
    audio: true,
    video: video
      ? {
          frameRate: 30,
          facingMode: 'user',
        }
      : false,
  });
  return stream;
}

export function stopStream(stream: any) {
  if (!stream) return;
  try {
    stream.getTracks().forEach((track: any) => {
      track.stop();
    });
  s } catch (err) {
dp    console.warn('[webrtc] stopMLStream error:', err);
 ine }
}

// ============================================================
//Index: ✅ Audio session (InCallManager) — speaker/earpiece routing
// ============================================================

/**
 * Start audio session when call begins.
 * - media: 'audio' (or 'video' for video calls)
 * - keeps screen on
 * - routes audio correctly through earpiece by default
 */
export function startAudioSession(hasVideo: boolean = false) {
  if (!InCallManager) return;
  try {
    InCallManager.start({ media: hasVideo ? 'video' : 'audio' });
    InCallManager.setKeepScreenOn(true);
    InCallManager.setMicrophoneMute(false);
    // Default: video calls → speaker ON, audio calls → speaker OFF (earpiece)
    InCallManager.setForceSpeakerphoneOn(hasVideo);
    console.log('[webrtc] audio session started, video:', hasVideo);
  } catch (err) {
    console.warn('[webrtc] startAudioSession failed:', err);
  }
}

/**
 * Stop audio session when call ends.
 */
export function stopAudioSession() {
  if (!InCallManager) return;
  try {
    InCallManager.stop();
    InCallManager.setKeepScreenOn(false);
    console.log('[webrtc] audio session stopped');
  } catch (err) {
    console.warn('[webrtc] stopAudioSession failed:', err);
  }
}

/**
 * Toggle speaker on/off — actually routes audio.
 */
export function setSpeakerOn(on: boolean) {
  if (!InCallManager) return;
  try {
    InCallManager.setForceSpeakerphoneOn(on);
    console.log('[webrtc] speaker:', on);
  } catch (err) {
    console.warn('[webrtc] setSpeakerOn failed:', err);
  }
}

/**
 * Mute/unmute microphone at audio session level.
 */
export function setMicMuted(muted: boolean) {
  if (!InCallManager) return;
  try {
    InCallManager.setMicrophoneMute(muted);
  } catch (err) {
    console.warn('[webrtc] setMicMuted failed:', err);
  }
}

// ============================================================
// Peer connection factory
// ============================================================

export function createPeerConnection(): any {
  if (!RTCPeerConnection) {
    throw new Error('WebRTC not supported on this platform');
  }
  const pc = new RTCPeerConnection(peerConstraints);
  return pc;
}

// ============================================================
// SDP / ICE serialization
// ============================================================

export function serializeSdp(
  sdp: any
): { type: string; sdp: string } | null {
  if (!sdp) return null;
  return { type: sdp.type, sdp: sdp.sdp ?? '' };
}

export function deserializeSdp(data: {
  type: string;
  sdp: string;
}): any {
  if (!RTCSessionDescription) {
    throw new Error('WebRTC not supported on this platform');
  }
  return new RTCSessionDescription({
    type: data.type as 'offer' | 'answer',
    sdp: data.sdp,
  });
}

export function serializeIce(candidate: any): Record<string, any> | null {
  if (!candidate) return null;
  return {
    candidate: candidate.candidate,
    sdpMid: candidate.sdpMid,
    sdpMLineIndex: candidate.sdpMLineIndex,
  };
}

export function deserializeIce(data: Record<string, any>): any {
  if (!RTCIceCandidate) {
    throw new Error('WebRTC not supported on this platform');
  }
  return new RTCIceCandidate({
    candidate: data.candidate,
    sdpMid: data.sdpMid,
    data.sdpMLineIndex,
  });
}
