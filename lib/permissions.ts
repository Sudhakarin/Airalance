// lib/permissions.ts
// Central permission flow for Airalance.
//  - Creates Android notification channels (MUST exist before the Android 13+ prompt)
//  - Asks notifications → mic → camera → nearby devices → phone, one at a time
//  - If a permission is permanently blocked, offers "Open Settings"
//  - One-time guide for permissions that have NO dialog (full-screen intent,
//    battery "Unrestricted", display over other apps)
// Pure JS (PermissionsAndroid + expo-notifications) → works with OTA update.

import {
  Platform,
  PermissionsAndroid,
  Alert,
  Linking,
  AppState,
} from 'react-native';
import * as Notifications from 'expo-notifications';
import AsyncStorage from '@react-native-async-storage/async-storage';

export type PermState = 'granted' | 'denied' | 'blocked' | 'n/a';

export interface PermissionReport {
  notifications: PermState;
  microphone: PermState;
  camera: PermState;
  bluetooth: PermState;
  phone: PermState;
}

type AndroidPerm = Parameters<typeof PermissionsAndroid.request>[0];

const KEY_SPECIAL_PROMPTED = 'perm:special-prompted:v1';
const KEY_BLOCKED_ALERT_AT = 'perm:blocked-alert-at';
const BLOCKED_ALERT_GAP_MS = 24 * 60 * 60 * 1000; // max 1 alert / day

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

// Resolves when the first permission flow finishes (CallKeep setup waits on this
// so its own phone-account dialog never overlaps with ours)
let settleResolve: () => void = () => {};
const settled = new Promise<void>((r) => {
  settleResolve = r;
});
export function whenPermissionFlowSettled(timeoutMs = 45000): Promise<void> {
  return Promise.race([settled, sleep(timeoutMs)]);
}

// ============================================================
// Android notification channels
// ============================================================
let channelsReady = false;

export async function setupNotificationChannels(): Promise<void> {
  if (Platform.OS !== 'android' || channelsReady) return;
  try {
    await Notifications.setNotificationChannelAsync('default', {
      name: 'Notifications',
      importance: Notifications.AndroidImportance.MAX,
      vibrationPattern: [0, 250, 250, 250],
      lightColor: '#7C5CFF',
      sound: 'default',
    });

    await Notifications.setNotificationChannelAsync('calls', {
      name: 'Incoming calls',
      importance: Notifications.AndroidImportance.MAX,
      vibrationPattern: [0, 1000, 1000, 1000],
      lightColor: '#22C55E',
      sound: 'ringtone',
      bypassDnd: true,
      lockscreenVisibility: Notifications.AndroidNotificationVisibility.PUBLIC,
      audioAttributes: {
        usage: Notifications.AndroidAudioUsage.VOICE_COMMUNICATION,
        contentType: Notifications.AndroidAudioContentType.SPEECH,
      },
    });

    await Notifications.setNotificationChannelAsync('com.airalance.app.call', {
      name: 'Incoming calls (ring)',
      importance: Notifications.AndroidImportance.MAX,
      vibrationPattern: [0, 1000, 1000, 1000],
      lightColor: '#22C55E',
      sound: 'ringtone',
      bypassDnd: true,
      lockscreenVisibility: Notifications.AndroidNotificationVisibility.PUBLIC,
      audioAttributes: {
        usage: Notifications.AndroidAudioUsage.VOICE_COMMUNICATION,
        contentType: Notifications.AndroidAudioContentType.SPEECH,
      },
    });

    channelsReady = true;
  } catch (e) {
    console.warn('[perm] Channel setup failed:', e);
  }
}

// ============================================================
// Notifications
// ============================================================
export async function getNotificationStatus(): Promise<PermState> {
  if (Platform.OS === 'web') return 'n/a';
  const cur = await Notifications.getPermissionsAsync();
  if (cur.granted || cur.status === 'granted') return 'granted';
  return cur.canAskAgain ? 'denied' : 'blocked';
}

async function ensureNotifications(): Promise<PermState> {
  const cur = await getNotificationStatus();
  if (cur === 'granted' || cur === 'blocked') return cur;

  // Android 13+: channel must exist before the dialog can show
  await setupNotificationChannels();

  const res = await Notifications.requestPermissionsAsync({
    ios: { allowAlert: true, allowBadge: true, allowSound: true },
  });
  if (res.granted || res.status === 'granted') return 'granted';
  return res.canAskAgain ? 'denied' : 'blocked';
}

// ============================================================
// Android runtime permissions (mic, camera, nearby devices, phone)
// ============================================================
async function requestGroup(perms: string[]): Promise<PermState> {
  if (perms.length === 0) return 'n/a';
  try {
    const res = await PermissionsAndroid.requestMultiple(
      perms as AndroidPerm[]
    );
    const values = Object.values(res);
    if (values.every((v) => v === PermissionsAndroid.RESULTS.GRANTED)) {
      return 'granted';
    }
    if (values.some((v) => v === PermissionsAndroid.RESULTS.NEVER_ASK_AGAIN)) {
      return 'blocked';
    }
    return 'denied';
  } catch (e) {
    console.warn('[perm] requestGroup failed:', e);
    return 'denied';
  }
}

async function ensureAndroidRuntime(): Promise<
  Pick<PermissionReport, 'microphone' | 'camera' | 'bluetooth' | 'phone'>
> {
  const P = PermissionsAndroid.PERMISSIONS as Record<string, string>;
  const api = Number(Platform.Version);

  const microphone = await requestGroup([P.RECORD_AUDIO]);
  await sleep(350);

  const camera = await requestGroup([P.CAMERA]);
  await sleep(350);

  // Android 12+ "Nearby devices" — needed for Bluetooth headset during calls
  const bluetooth = await requestGroup(api >= 31 ? [P.BLUETOOTH_CONNECT] : []);
  await sleep(350);

  const phone = await requestGroup(
    api >= 26
      ? [
          P.READ_PHONE_STATE,
          P.CALL_PHONE,
          P.ANSWER_PHONE_CALLS,
          P.READ_PHONE_NUMBERS,
        ]
      : [P.READ_PHONE_STATE, P.CALL_PHONE]
  );

  return { microphone, camera, bluetooth, phone };
}

// iOS: mic dialog via expo-audio (camera dialog appears on first video call)
async function ensureIosMic(): Promise<PermState> {
  try {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const audio = require('expo-audio');
    const req =
      audio.requestRecordingPermissionsAsync ??
      audio.AudioModule?.requestRecordingPermissionsAsync;
    if (!req) return 'n/a';
    const res = await req();
    if (res?.granted) return 'granted';
    return res?.canAskAgain === false ? 'blocked' : 'denied';
  } catch (e) {
    console.warn('[perm] iOS mic request failed:', e);
    return 'n/a';
  }
}

// ============================================================
// Alerts (blocked permissions → Settings, special permissions guide)
// ============================================================
function confirmAlert(
  title: string,
  message: string,
  okLabel: string
): Promise<boolean> {
  return new Promise((resolve) => {
    Alert.alert(
      title,
      message,
      [
        { text: 'Later', style: 'cancel', onPress: () => resolve(false) },
        { text: okLabel, onPress: () => resolve(true) },
      ],
      { cancelable: true, onDismiss: () => resolve(false) }
    );
  });
}

async function maybeShowBlockedAlert(report: PermissionReport) {
  const labels: Record<keyof PermissionReport, string> = {
    notifications: 'Notifications',
    microphone: 'Microphone',
    camera: 'Camera',
    bluetooth: 'Nearby devices',
    phone: 'Phone',
  };

  const blocked = (Object.keys(report) as (keyof PermissionReport)[])
    .filter((k) => report[k] === 'blocked')
    .map((k) => labels[k]);

  if (blocked.length === 0) return false;

  try {
    const last = Number((await AsyncStorage.getItem(KEY_BLOCKED_ALERT_AT)) || 0);
    if (Date.now() - last < BLOCKED_ALERT_GAP_MS) return true;
    await AsyncStorage.setItem(KEY_BLOCKED_ALERT_AT, String(Date.now()));
  } catch {}

  const go = await confirmAlert(
    'Permission needed',
    `Airalance can't ring or notify you for calls and messages without: ${blocked.join(
      ', '
    )}.\n\nOpen Settings → Permissions and turn them on.`,
    'Open Settings'
  );
  if (go) Linking.openSettings().catch(() => {});
  return true;
}

async function maybeShowSpecialGuide() {
  if (Platform.OS !== 'android') return;
  try {
    if (await AsyncStorage.getItem(KEY_SPECIAL_PROMPTED)) return;
    await AsyncStorage.setItem(KEY_SPECIAL_PROMPTED, '1');
  } catch {}

  const api = Number(Platform.Version);
  const steps: string[] = [];
  if (api >= 34) steps.push('• Notifications → Full-screen notifications: ON');
  steps.push('• Battery: Unrestricted');
  steps.push('• Display over other apps: ON');

  const go = await confirmAlert(
    'Make incoming calls ring reliably',
    `So calls ring even when your phone is locked or the app is closed, open Settings and check:\n\n${steps.join(
      '\n'
    )}`,
    'Open Settings'
  );
  if (go) Linking.openSettings().catch(() => {});
}

// ============================================================
// Orchestrator
// ============================================================
// Called right before a call starts / is accepted: mic (+ camera for video)
export async function ensureCallPermissions(video: boolean): Promise<boolean> {
  if (Platform.OS === 'web') return false;

  let ok = false;
  if (Platform.OS === 'android') {
    const P = PermissionsAndroid.PERMISSIONS;
    const perms = video ? [P.RECORD_AUDIO, P.CAMERA] : [P.RECORD_AUDIO];
    try {
      const res = await PermissionsAndroid.requestMultiple(perms);
      ok = Object.values(res).every(
        (v) => v === PermissionsAndroid.RESULTS.GRANTED
      );
    } catch {
      ok = false;
    }
  } else {
    // iOS: mic dialog via expo-audio; camera dialog is shown by WebRTC itself
    const mic = await ensureIosMic();
    ok = mic === 'granted' || mic === 'n/a';
  }

  if (ok) return true;

  const go = await confirmAlert(
    video ? 'Microphone & camera needed' : 'Microphone needed',
    video
      ? 'Allow microphone and camera in Settings to make or receive video calls.'
      : 'Allow microphone in Settings to make or receive calls.',
    'Open Settings'
  );
  if (go) Linking.openSettings().catch(() => {});
  return false;
}

function waitForActive(timeoutMs = 10000): Promise<void> {
  if (AppState.currentState === 'active') return Promise.resolve();
  return new Promise((resolve) => {
    const t = setTimeout(done, timeoutMs);
    const sub = AppState.addEventListener('change', (s) => {
      if (s === 'active') done();
    });
    function done() {
      clearTimeout(t);
      sub.remove();
      resolve();
    }
  });
}

let running: Promise<PermissionReport> | null = null;

export function runPermissionFlow(): Promise<PermissionReport> {
  if (running) return running;

  running = (async () => {
    const report: PermissionReport = {
      notifications: 'n/a',
      microphone: 'n/a',
      camera: 'n/a',
      bluetooth: 'n/a',
      phone: 'n/a',
    };
    if (Platform.OS === 'web') return report;

    // Dialogs only show when the app is in the foreground
    await waitForActive();

    try {
      report.notifications = await ensureNotifications();
    } catch (e) {
      console.warn('[perm] notifications failed:', e);
    }

    await sleep(400);

    try {
      if (Platform.OS === 'android') {
        Object.assign(report, await ensureAndroidRuntime());
      } else {
        report.microphone = await ensureIosMic();
      }
    } catch (e) {
      console.warn('[perm] runtime perms failed:', e);
    }

    try {
      const shown = await maybeShowBlockedAlert(report);
      if (!shown) await maybeShowSpecialGuide();
    } catch (e) {
      console.warn('[perm] alert flow failed:', e);
    }

    console.log('[perm] report:', JSON.stringify(report));
    return report;
  })().finally(() => {
    running = null;
    settleResolve();
  });

  return running;
}
