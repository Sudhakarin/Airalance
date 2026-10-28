// lib/network.ts
// Global network status tracker (online/offline) with pub/sub
// ✅ FIX: initial NetInfo.fetch() now notifies listeners too (same path as the event listener)

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

// Single place that updates `online` and notifies listeners (only on change)
function apply(state: NetInfoState) {
  const next = computeOnline(state);
  if (next === online) return;
  online = next;
  listeners.forEach((fn) => {
    try {
      fn(online);
    } catch {}
  });
}

export function initNetwork() {
  if (initialized) return;
  initialized = true;

  // Initial fetch
  NetInfo.fetch()
    .then(apply)
    .catch(() => {});

  // Subscribe
  unsubscribeNetInfo = NetInfo.addEventListener(apply);
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
