// lib/webrtc.ts
// WebRTC core helpers — peer connection, media streams, ICE servers, audio routing

import { Platform } from 'react-native';

let RNWebRTC: any = null;
if (Platform.OS !== 'web') {
  try {
    RNWebRTC = require('react-native-webrtc');
  } catch (err) {
    console.warn('[webrtc] react-native-webrtc not available:', err);
  }
}

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

export async function getLocalStream(video: boolean): Promise<any> {
  if (!mediaDevices) {
    throw new Error('WebRTC not supported on this platform');
  }
  const stream = await mediaDevices.getUserMedia({
    audio: true,
    video: video ? { frameRate: 30, facingMode: 'user' } : false,
  });
  return stream;
}

export function stopStream(stream: any) {
  if (!stream) return;
  try {
    stream.getTracks().forEach((track: any) => {
      track.stop();
    });
  } catch (err) {
    console.warn('[webrtc] stopStream error:', err);
  }
}

export function startAudioSession(hasVideo: boolean = false) {
  if (!InCallManager) return;
  try {
    InCallManager.start({ media: hasVideo ? 'video' : 'audio' });
    InCallManager.setKeepScreenOn(true);
    InCallManager.setMicrophoneMute(false);
    InCallManager.setForceSpeakerphoneOn(hasVideo);
    console.log('[webrtc] audio session started, video:', hasVideo);
  } catch (err) {
    console.warn('[webrtc] startAudioSession failed:', err);
  }
}

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

export function setSpeakerOn(on: boolean) {
  if (!InCallManager) return;
  try {
    InCallManager.setForceSpeakerphoneOn(on);
    console.log('[webrtc] speaker:', on);
  } catch (err) {
    console.warn('[webrtc] setSpeakerOn failed:', err);
  }
}

export function setMicMuted(muted: boolean) {
  if (!InCallManager) return;
  try {
    InCallManager.setMicrophoneMute(muted);
  } catch (err) {
    console.warn('[webrtc] setMicMuted failed:', err);
  }
}

export function createPeerConnection(): any {
  if (!RTCPeerConnection) {
    throw new Error('WebRTC not supported on this platform');
  }
  const pc = new RTCPeerConnection(peerConstraints);
  return pc;
}

export function serializeSdp(sdp: any): { type: string; sdp: string } | null {
  if (!sdp) return null;
  return { type: sdp.type, sdp: sdp.sdp ?? '' };
}

export function deserializeSdp(data: { type: string; sdp: string }): any {
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
    sdpMLineIndex: data.sdpMLineIndex,
  });
}
