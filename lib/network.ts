// lib/network.ts
// Global network status tracker (online/offline) with pub/sub

import NetInfo, { NetInfoState } from '@react-native-community/netinfo';

type Listener = (online: boolean) => void;

let online = true;
let initialized = false;
const listeners = new Set<Listener>();
let unsubscribeNetInfo: (() => void) | null = null;

function computeOnline(state: NetInfoState): boolean {
  // isConnected must be true, and isInternetReachable must not be false
  if (!state.isConnected) return false;
  if (state.isInternetReachable === false) return false;
  return true;
}

export function initNetwork() {
  if (initialized) return;
  initialized = true;

  // Initial fetch
  NetInfo.fetch()
    .then((state) => {
      online = computeOnline(state);
    })
    .catch(() => {});

  // Subscribe
  unsubscribeNetInfo = NetInfo.addEventListener((state) => {
    const nextOnline = computeOnline(state);
    if (nextOnline !== online) {
      online = nextOnline;
      listeners.forEach((fn) => {
        try {
          fn(online);
        } catch {}
      });
    }
  });
}

export function isOnline(): boolean {
  return online;
}

export function subscribeNetwork(fn: Listener): () => void {
  listeners.add(fn);
  return () => {
    listeners.delete(fn);
  };
}

export function stopNetwork() {
  if (unsubscribeNetInfo) {
    try {
      unsubscribeNetInfo();
    } catch {}
    unsubscribeNetInfo = null;
  }
  listeners.clear();
  initialized = false;
}
