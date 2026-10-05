// lib/webrtc.ts
// WebRTC core helpers — peer connection, media streams, ICE servers

import {
  RTCPeerConnection,
  RTCIceCandidate,
  RTCSessionDescription,
  mediaDevices,
  MediaStream,
} from 'react-native-webrtc';

// ============================================================
// ICE Servers — STUN (public) + TURN (free relay for NAT)
// ============================================================

const ICE_SERVERS = [
  // Google STUN servers (free, for peer discovery)
  { urls: 'stun:stun.l.google.com:19302' },
  { urls: 'stun:stun1.l.google.com:19302' },
  { urls: 'stun:stun2.l.google.com:19302' },

  // Free TURN (openrelay.metered.ca) — for symmetric NAT users
  // ⚠️ Free tier: limited bandwidth. Production me apna TURN host karo.
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

// ============================================================
// Peer connection config
// ============================================================

export const peerConstraints = {
  iceServers: ICE_SERVERS,
  iceCandidatePoolSize: 10,
  iceTransportPolicy: 'all' as const,
};

// ============================================================
// Media stream helpers
// ============================================================

export async function getLocalStream(
  video: boolean
): Promise<MediaStream> {
  const stream = await mediaDevices.getUserMedia({
    audio: true,
    video: video
      ? {
          frameRate: 30,
          facingMode: 'user',
        }
      : false,
  });
  return stream as MediaStream;
}

export function stopStream(stream: MediaStream | null) {
  if (!stream) return;
  try {
    stream.getTracks().forEach((track) => {
      track.stop();
    });
  } catch (err) {
    console.warn('[webrtc] stopStream error:', err);
  }
}

// ============================================================
// Peer connection factory
// ============================================================

export function createPeerConnection(): RTCPeerConnection {
  const pc = new RTCPeerConnection(peerConstraints);
  return pc as RTCPeerConnection;
}

// ============================================================
// SDP / ICE serialization
// ============================================================

export function serializeSdp(
  sdp: RTCSessionDescription | null
): { type: string; sdp: string } | null {
  if (!sdp) return null;
  return { type: sdp.type, sdp: sdp.sdp ?? '' };
}

export function deserializeSdp(data: {
  type: string;
  sdp: string;
}): RTCSessionDescription {
  return new RTCSessionDescription({
    type: data.type as 'offer' | 'answer',
    sdp: data.sdp,
  });
}

export function serializeIce(
  candidate: RTCIceCandidate | null
): Record<string, any> | null {
  if (!candidate) return null;
  return {
    candidate: candidate.candidate,
    sdpMid: candidate.sdpMid,
    sdpMLineIndex: candidate.sdpMLineIndex,
  };
}

export function deserializeIce(data: Record<string, any>): RTCIceCandidate {
  return new RTCIceCandidate({
    candidate: data.candidate,
    sdpMid: data.sdpMid,
    sdpMLineIndex: data.sdpMLineIndex,
  });
}
