// app/settings/index.tsx
// Settings — redesigned. Home (search, profile hero, usage summary, grouped rows),
// Time management, Time limit, Verification, Blocked, Tag & mention,
// Invite, Account status, Aira One, Management (admins only).
//
// ✅ Logout ab profile.tsx jaisa: SQLite wipe + cache clear + invalidateUserIdCache
// ✅ Android hardware back sub-screen se Home par jaata hai (app se bahar nahi)
// ✅ Profile pehle cache se (instant/offline), phir fresh fetch
// ✅ Copy link asli copy karta hai (expo-clipboard ho to), warna share sheet
// ✅ Account status: profile ke restriction flags se (columns na ho to sab "ok")
// ✅ Updates screen: kab publish hua, source, update id, channel, runtime, last checked + check/download

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  TouchableOpacity,
  Alert,
  ActivityIndicator,
  Share,
  TextInput,
  Image as RNImage,
  BackHandler,
  Animated,
  Easing,
  Modal,
  Pressable,
  Keyboard,
} from 'react-native';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { LinearGradient } from 'expo-linear-gradient';
import AsyncStorage from '@react-native-async-storage/async-storage';
import * as ImagePicker from 'expo-image-picker';
import * as Updates from 'expo-updates';
import Constants from 'expo-constants';
import {
  COLORS,
  FONTS,
  RADII,
  VERIFIED_USERNAMES,
} from '../../constants/theme';
import { supabase } from '../../lib/supabase';
import { getCurrentUserId, invalidateUserIdCache } from '../../lib/auth';
import { isOnline } from '../../lib/network';
import { dbWipeAll } from '../../lib/db';
import Avatar from '../../components/Avatar';
import VerifiedBadge from '../../components/VerifiedBadge';
import AdminPanel from '../../components/AdminPanel';
import LegalPanel from '../../components/LegalPanel';
import DataAccessPanel from '../../components/DataAccessPanel';
import { fetchAdminRole } from '../../lib/admin';
import type { AdminRole } from '../../lib/admin';

/* ================= TYPES & CONSTANTS ================= */

type Profile = {
  id: string;
  username: string;
  display_name: string;
  avatar_color: string;
  avatar_url: string | null;
  verified: boolean | null;
  bio: string | null;
  bio_link?: string | null;
  mention_privacy?: 'connections' | 'everyone' | null;
  created_at?: string | null;
  // optional restriction flags (columns ho to Account status me dikhte hain)
  messaging_restricted?: boolean | null;
  feature_restricted?: boolean | null;
  shadowbanned?: boolean | null;
  account_locked?: boolean | null;
};

type ScreenId =
  | 'home'
  | 'time'
  | 'timelimit'
  | 'verify'
  | 'blocked'
  | 'mentions'
  | 'invite'
  | 'account'
  | 'updates'
  | 'subscription'
  | 'admin'
  | 'contacts_location'
  | 'terms'
  | 'privacy';

type IconName = keyof typeof Ionicons.glyphMap;
type MentionValue = 'connections' | 'everyone';

const INVITE_URL = 'https://airalance.com';
const INVITE_LABEL = 'Airalance.com';
const VERIFICATION_BUCKET = 'verification-docs';
const USAGE_KEY = (uid: string) => `airalance-usage:${uid}`;
const USAGE_LIMIT_KEY = (uid: string) => `airalance-timelimit:${uid}`;
const PROFILE_CACHE_KEY = (uid: string) => `airalance:profile:me:${uid}`;
const LAST_CHECK_KEY = 'airalance-update-lastcheck';
const ADMIN_ROLE_KEY = (uid: string) => `airalance:admin-role:${uid}`;

const UI = {
  bg: '#000000',
  card: '#121212',
  cardAlt: '#17171A',
  border: '#1F1F23',
  muted: 'rgba(255,255,255,0.55)',
  faint: 'rgba(255,255,255,0.32)',
  amber: '#FFC857',
  green: '#34D399',
};

const AIRA_ONE_FEATURES: { icon: IconName; text: string }[] = [
  { icon: 'language-outline', text: 'Regional Languages' },
  { icon: 'flash-outline', text: 'Priority Access' },
  { icon: 'headset-outline', text: 'Support 24/7' },
  { icon: 'eye-off-outline', text: 'Ads Free in News Feed' },
];

const TIME_PRESETS = [30, 60, 120, 180, 240];

/* ================= HELPERS ================= */

function localDateKey(d: Date) {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

function formatUsageDuration(sec: number) {
  if (sec <= 0) return '0m';
  if (sec < 60) return '<1m';
  const totalMin = Math.round(sec / 60);
  const h = Math.floor(totalMin / 60);
  const m = totalMin % 60;
  if (h === 0) return `${m}m`;
  return m === 0 ? `${h}h` : `${h}h ${m}m`;
}

function isVerifiedUser(p?: Profile | null) {
  if (!p) return false;
  if (p.verified) return true;
  return (VERIFIED_USERNAMES as readonly string[]).includes(
    (p.username || '').toLowerCase()
  );
}

function withAlpha(hex: string, a: number) {
  const h = hex.replace('#', '');
  if (h.length !== 6) return hex;
  const r = parseInt(h.slice(0, 2), 16);
  const g = parseInt(h.slice(2, 4), 16);
  const b = parseInt(h.slice(4, 6), 16);
  return `rgba(${r},${g},${b},${a})`;
}

function withTimeout<T>(p: Promise<T>, ms: number): Promise<T> {
  return new Promise((resolve, reject) => {
    const t = setTimeout(() => reject(new Error('timeout')), ms);
    p.then(
      (v) => {
        clearTimeout(t);
        resolve(v);
      },
      (e) => {
        clearTimeout(t);
        reject(e);
      }
    );
  });
}

async function readCachedProfile(uid: string): Promise<Profile | null> {
  try {
    const raw = await AsyncStorage.getItem(PROFILE_CACHE_KEY(uid));
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    return parsed?.profile ? (parsed.profile as Profile) : null;
  } catch {
    return null;
  }
}

// expo-clipboard install ho to asli copy; warna false (caller share sheet kholega)
async function copyText(text: string): Promise<boolean> {
  try {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const Clipboard = require('expo-clipboard');
    await Clipboard.setStringAsync(text);
    return true;
  } catch {
    return false;
  }
}

function getUpdateTag(): string | null {
  try {
    if (!Updates.isEnabled) return null;
    if (Updates.isEmbeddedLaunch) return 'built-in';
    return (Updates.updateId ?? '').slice(0, 8) || null;
  } catch {
    return null;
  }
}

function getAppVersion(): string {
  return Constants.expoConfig?.version ?? '1.0.0';
}

function timeAgo(d: Date | number | null | undefined): string {
  if (!d) return '—';
  const t = typeof d === 'number' ? d : d.getTime();
  if (!Number.isFinite(t)) return '—';
  const s = Math.max(0, Math.round((Date.now() - t) / 1000));
  if (s < 45) return 'Just now';
  const m = Math.round(s / 60);
  if (m < 60) return `${m} min ago`;
  const h = Math.round(m / 60);
  if (h < 24) return `${h} hr ago`;
  const days = Math.round(h / 24);
  if (days < 30) return `${days} ${days === 1 ? 'day' : 'days'} ago`;
  return new Date(t).toLocaleDateString(undefined, {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
  });
}

function formatDateTime(d: Date | number | null | undefined): string {
  if (!d) return '';
  const date = typeof d === 'number' ? new Date(d) : d;
  if (Number.isNaN(date.getTime())) return '';
  return date.toLocaleString(undefined, {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  });
}

// Home row ka subtitle: kab update hua
function getUpdatedLabel(): string {
  try {
    if (!Updates.isEnabled) return 'Not available in development builds';
    const created = Updates.createdAt;
    if (Updates.isEmbeddedLaunch) {
      return created ? `Built-in version · ${timeAgo(created)}` : 'Built-in version';
    }
    return created ? `Updated ${timeAgo(created)}` : 'Over-the-air update';
  } catch {
    return 'Check for updates';
  }
}

/* ================= HOOKS ================= */

function useUsage(userId: string, pollMs = 15000) {
  const [data, setData] = useState<Record<string, number>>({});
  const [limit, setLimit] = useState<number | null>(null);

  const reload = useCallback(async () => {
    try {
      const [raw, lim] = await Promise.all([
        AsyncStorage.getItem(USAGE_KEY(userId)),
        AsyncStorage.getItem(USAGE_LIMIT_KEY(userId)),
      ]);
      setData(raw ? JSON.parse(raw) : {});
      const n = lim ? Number(lim) : NaN;
      setLimit(Number.isFinite(n) && n > 0 ? n : null);
    } catch {}
  }, [userId]);

  useEffect(() => {
    reload();
    const t = setInterval(reload, pollMs);
    return () => clearInterval(t);
  }, [reload, pollMs]);

  return { data, limit, reload };
}

/* ================= SCREEN ================= */

export default function SettingsScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const [profile, setProfile] = useState<Profile | null>(null);
  const [loading, setLoading] = useState(true);
  const [screen, setScreen] = useState<ScreenId>('home');
  const [logoutOpen, setLogoutOpen] = useState(false);
  const [loggingOut, setLoggingOut] = useState(false);
  // Admin / Management (UI ke liye; asli permission server par check hoti hai)
  const [adminRole, setAdminRole] = useState<AdminRole | null>(null);
  const adminBackRef = useRef<(() => boolean) | null>(null);
  const registerAdminBack = useCallback((fn: (() => boolean) | null) => {
    adminBackRef.current = fn;
  }, []);

  const scrollRef = useRef<ScrollView>(null);
  const screenRef = useRef<ScreenId>('home');
  const dirRef = useRef(1);

  useEffect(() => {
    screenRef.current = screen;
    scrollRef.current?.scrollTo({ y: 0, animated: false });
  }, [screen]);

  const load = useCallback(async () => {
    try {
      const uid = await getCurrentUserId();
      if (!uid) return;

      // cache se turant (offline me bhi chalega), phir fresh
      const cached = await readCachedProfile(uid);
      if (cached) {
        setProfile((prev) => prev ?? cached);
        setLoading(false);
      }

      if (!isOnline()) return;
      const { data, error } = await supabase
        .from('profiles')
        .select('*')
        .eq('id', uid)
        .single();
      if (error) throw error;
      setProfile(data as Profile);
    } catch (err) {
      console.warn('[settings] load profile failed:', err);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  // Admin role: cache se turant, phir server se confirm (network error par cache nahi hatta)
  useEffect(() => {
    const uid = profile?.id;
    if (!uid) return;
    let cancelled = false;
    (async () => {
      try {
        const cached = await AsyncStorage.getItem(ADMIN_ROLE_KEY(uid));
        if (!cancelled && (cached === 'owner' || cached === 'admin' || cached === 'moderator')) {
          setAdminRole(cached);
        }
      } catch {}
      if (!isOnline()) return;
      try {
        const role = await fetchAdminRole();
        if (cancelled) return;
        setAdminRole(role);
        if (role) {
          await AsyncStorage.setItem(ADMIN_ROLE_KEY(uid), role);
        } else {
          await AsyncStorage.removeItem(ADMIN_ROLE_KEY(uid));
          if (screenRef.current === 'admin') setScreen('home');
        }
      } catch {}
    })();
    return () => {
      cancelled = true;
    };
  }, [profile?.id]);

  const open = useCallback((next: ScreenId) => {
    dirRef.current = 1;
    setScreen(next);
  }, []);

  const goBack = useCallback(() => {
    const cur = screenRef.current;
    if (cur === 'home') {
      router.back();
      return;
    }
    // Admin panel ke andar (user detail) ho to pehle wahan se back
    if (cur === 'admin' && adminBackRef.current?.()) return;
    dirRef.current = -1;
    setScreen(cur === 'timelimit' ? 'time' : 'home');
  }, [router]);

  // Android hardware back: sub-screen se pehle Home
  useEffect(() => {
    const sub = BackHandler.addEventListener('hardwareBackPress', () => {
      if (screenRef.current === 'home') return false;
      goBack();
      return true;
    });
    return () => sub.remove();
  }, [goBack]);

  async function doLogout() {
    setLogoutOpen(false);
    setLoggingOut(true);
    const uid = profile?.id;
    if (uid) {
      try {
        await AsyncStorage.multiRemove([
          USAGE_KEY(uid),
          PROFILE_CACHE_KEY(uid),
          ADMIN_ROLE_KEY(uid),
        ]);
      } catch {}
    }
    try {
      await dbWipeAll();
    } catch (err) {
      console.warn('[logout] SQLite wipe failed:', err);
    }
    invalidateUserIdCache();
    try {
      await supabase.auth.signOut();
    } catch (err) {
      console.warn('[logout] signOut failed:', err);
    }
    setLoggingOut(false);
    router.replace('/(auth)/login');
  }

  const titles: Record<ScreenId, string> = {
    home: 'Settings',
    time: 'Time management',
    timelimit: 'Time limit',
    verify: 'Verification',
    blocked: 'Blocked accounts',
    mentions: 'Tag & mention',
    invite: 'Invite friends',
    account: 'Account status',
    updates: 'Updates',
    subscription: 'Aira One',
    admin: 'Management',
    contacts_location: 'Contacts & location',
    terms: 'Terms & Conditions',
    privacy: 'Privacy Policy',
  };

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      <View style={styles.header}>
        <TouchableOpacity style={styles.headerBtn} onPress={goBack} activeOpacity={0.7}>
          <Ionicons name="chevron-back" size={22} color={COLORS.text} />
        </TouchableOpacity>
        <Text style={styles.headerTitle} numberOfLines={1}>
          {titles[screen]}
        </Text>
        <View style={styles.headerBtn} />
      </View>

      {loading ? (
        <View style={styles.centerFill}>
          <ActivityIndicator color={COLORS.violet} />
        </View>
      ) : !profile ? (
        <View style={styles.centerFill}>
          <Ionicons name="alert-circle-outline" size={40} color={UI.faint} />
          <Text style={styles.emptyTitle}>Couldn't load settings</Text>
          <Text style={styles.emptySub}>Check your connection and try again.</Text>
          <TouchableOpacity
            style={styles.retryBtn}
            onPress={() => {
              setLoading(true);
              load();
            }}
            activeOpacity={0.8}
          >
            <Text style={styles.retryBtnText}>Try again</Text>
          </TouchableOpacity>
        </View>
      ) : (
        <ScrollView
          ref={scrollRef}
          contentContainerStyle={[
            styles.scroll,
            { paddingBottom: Math.max(insets.bottom, 12) + 28 },
          ]}
          showsVerticalScrollIndicator={false}
          keyboardShouldPersistTaps="handled"
          keyboardDismissMode="on-drag"
          automaticallyAdjustKeyboardInsets
        >
          <ScreenFade id={screen} dir={dirRef.current}>
            {screen === 'home' && (
              <HomePanel
                profile={profile}
                adminRole={adminRole}
                onOpen={open}
                onLogout={() => setLogoutOpen(true)}
              />
            )}
            {screen === 'time' && (
              <TimeManagementPanel
                userId={profile.id}
                onOpenLimit={() => open('timelimit')}
              />
            )}
            {screen === 'timelimit' && <TimeLimitPanel userId={profile.id} />}
            {screen === 'verify' && (
              <VerificationPanel profile={profile} verified={isVerifiedUser(profile)} />
            )}
            {screen === 'blocked' && <BlockedPanel myId={profile.id} />}
            {screen === 'mentions' && (
              <MentionPrivacyPanel
                profile={profile}
                onSaved={(v) =>
                  setProfile((prev) => (prev ? { ...prev, mention_privacy: v } : prev))
                }
              />
            )}
            {screen === 'invite' && <InvitePanel username={profile.username} />}
            {screen === 'account' && <AccountStatusPanel profile={profile} />}
            {screen === 'updates' && <UpdatesPanel />}
            {screen === 'subscription' && <SubscriptionPanel />}
            {screen === 'contacts_location' && <DataAccessPanel onOpenLegal={(k) => open(k)} />}
            {screen === 'terms' && <LegalPanel kind="terms" />}
            {screen === 'privacy' && <LegalPanel kind="privacy" />}
            {screen === 'admin' && adminRole && (
              <AdminPanel myId={profile.id} role={adminRole} registerBack={registerAdminBack} />
            )}
          </ScreenFade>
        </ScrollView>
      )}

      <ConfirmDialog
        visible={logoutOpen}
        icon="log-out-outline"
        title="Log out?"
        message="You will need to sign in again to access your chats and status."
        confirmLabel="Log out"
        danger
        onConfirm={doLogout}
        onCancel={() => setLogoutOpen(false)}
      />

      {loggingOut && (
        <View style={styles.busyOverlay} pointerEvents="auto">
          <ActivityIndicator color="#fff" />
          <Text style={styles.busyText}>Logging out…</Text>
        </View>
      )}
    </SafeAreaView>
  );
}

function ScreenFade({
  id,
  dir,
  children,
}: {
  id: string;
  dir: number;
  children: React.ReactNode;
}) {
  const v = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    v.setValue(0);
    Animated.timing(v, {
      toValue: 1,
      duration: 220,
      easing: Easing.out(Easing.cubic),
      useNativeDriver: true,
    }).start();
  }, [id, v]);
  return (
    <Animated.View
      style={{
        opacity: v,
        transform: [
          { translateX: v.interpolate({ inputRange: [0, 1], outputRange: [dir * 18, 0] }) },
        ],
      }}
    >
      {children}
    </Animated.View>
  );
}

/* ================= HOME ================= */

type HomeItem = {
  id: string;
  screen: ScreenId;
  icon: IconName;
  tint: string;
  title: string;
  subtitle: string;
  keywords: string;
  value?: string;
};

function HomePanel({
  profile,
  adminRole,
  onOpen,
  onLogout,
}: {
  profile: Profile;
  adminRole: AdminRole | null;
  onOpen: (s: ScreenId) => void;
  onLogout: () => void;
}) {
  const verified = isVerifiedUser(profile);
  const { data, limit } = useUsage(profile.id);
  const [query, setQuery] = useState('');

  const todaySecs = data[localDateKey(new Date())] ?? 0;
  const limitSecs = limit ? limit * 60 : 0;
  const ratio = limitSecs > 0 ? Math.min(todaySecs / limitSecs, 1) : 0;
  const barColor = ratio >= 1 ? COLORS.danger : ratio >= 0.8 ? UI.amber : COLORS.violet;

  const joined = profile.created_at
    ? new Date(profile.created_at).toLocaleDateString(undefined, {
        month: 'short',
        year: 'numeric',
      })
    : null;

  const updateTag = getUpdateTag();

  const items: Record<string, HomeItem> = {
    time: {
      id: 'time',
      screen: 'time',
      icon: 'time-outline',
      tint: '#6EA8FF',
      title: 'Time management',
      subtitle: 'See how much time you spend',
      keywords: 'screen time usage limit daily average',
      value: formatUsageDuration(todaySecs),
    },
    mentions: {
      id: 'mentions',
      screen: 'mentions',
      icon: 'at-outline',
      tint: '#B79CFF',
      title: 'Tag & mention',
      subtitle:
        profile.mention_privacy === 'everyone'
          ? 'Anyone can tag you'
          : 'Only connections can tag you',
      keywords: 'privacy tag mention who can',
    },
    blocked: {
      id: 'blocked',
      screen: 'blocked',
      icon: 'ban-outline',
      tint: '#FF8A8A',
      title: 'Blocked',
      subtitle: "Accounts you've blocked",
      keywords: 'block unblock privacy safety',
    },
    verify: {
      id: 'verify',
      screen: 'verify',
      icon: 'checkmark-circle-outline',
      tint: '#3EE0C4',
      title: 'Request verification',
      subtitle: verified ? 'Your account is verified' : 'Apply for the verified badge',
      keywords: 'verify verified badge selfie document',
    },
    account: {
      id: 'account',
      screen: 'account',
      icon: 'shield-checkmark-outline',
      tint: '#4ADE9A',
      title: 'Account status',
      subtitle: "Check your account's standing",
      keywords: 'restrictions shadowban locked messaging standing',
    },
    invite: {
      id: 'invite',
      screen: 'invite',
      icon: 'person-add-outline',
      tint: UI.amber,
      title: 'Invite friends',
      subtitle: 'Share Airalance with your friends',
      keywords: 'share link invite friends',
    },
    contacts_location: {
      id: 'contacts_location',
      screen: 'contacts_location',
      icon: 'people-circle-outline',
      tint: '#6EA8FF',
      title: 'Contacts & location',
      subtitle: 'Find friends and get local news',
      keywords: 'contacts location friends news permission data privacy',
    },
    terms: {
      id: 'terms',
      screen: 'terms',
      icon: 'document-text-outline',
      tint: '#B79CFF',
      title: 'Terms & Conditions',
      subtitle: 'The rules for using Airalance',
      keywords: 'terms conditions rules legal agreement',
    },
    privacy: {
      id: 'privacy',
      screen: 'privacy',
      icon: 'lock-closed-outline',
      tint: '#4ADE9A',
      title: 'Privacy Policy',
      subtitle: 'How we handle your data',
      keywords: 'privacy policy data legal',
    },
    updates: {
      id: 'updates',
      screen: 'updates',
      icon: 'cloud-download-outline',
      tint: '#6EA8FF',
      title: 'Updates',
      subtitle: getUpdatedLabel(),
      keywords: 'update ota version latest new build changelog check',
      value: `v${getAppVersion()}`,
    },
  };

  if (adminRole) {
    items.admin = {
      id: 'admin',
      screen: 'admin',
      icon: 'shield-checkmark',
      tint: '#F4607A',
      title: 'Management',
      subtitle: 'Users, verification & moderation',
      keywords: 'admin management users ban verify requests moderation staff team',
      value: adminRole.charAt(0).toUpperCase() + adminRole.slice(1),
    };
  }

  function renderItem(it: HomeItem) {
    return (
      <SettingsRow
        icon={it.icon}
        tint={it.tint}
        title={it.title}
        subtitle={it.subtitle}
        value={it.value}
        onPress={() => onOpen(it.screen)}
      />
    );
  }

  function renderGroup(ids: string[]) {
    return (
      <SettingsGroup>
        {ids.map((id, i) => (
          <View key={id}>
            {i > 0 && <Divider />}
            {renderItem(items[id])}
          </View>
        ))}
      </SettingsGroup>
    );
  }

  const q = query.trim().toLowerCase();
  const results = q
    ? Object.values(items).filter((it) =>
        `${it.title} ${it.subtitle} ${it.keywords}`.toLowerCase().includes(q)
      )
    : [];

  return (
    <View>
      <View style={styles.searchWrap}>
        <Ionicons name="search" size={17} color={UI.faint} />
        <TextInput
          style={styles.searchInput}
          value={query}
          onChangeText={setQuery}
          placeholder="Search settings"
          placeholderTextColor={UI.faint}
          returnKeyType="search"
          autoCorrect={false}
          underlineColorAndroid="transparent"
        />
        {query.length > 0 && (
          <TouchableOpacity onPress={() => setQuery('')} hitSlop={10}>
            <Ionicons name="close-circle" size={17} color={UI.faint} />
          </TouchableOpacity>
        )}
      </View>

      {q ? (
        results.length > 0 ? (
          <View style={{ marginTop: 14 }}>
            <SettingsGroup>
              {results.map((it, i) => (
                <View key={it.id}>
                  {i > 0 && <Divider />}
                  {renderItem(it)}
                </View>
              ))}
            </SettingsGroup>
          </View>
        ) : (
          <View style={styles.noResults}>
            <Ionicons name="search-outline" size={34} color={UI.faint} />
            <Text style={styles.emptyTitle}>No results</Text>
            <Text style={styles.emptySub}>Nothing matches "{query.trim()}".</Text>
          </View>
        )
      ) : (
        <>
          <LinearGradient
            colors={['rgba(124,92,255,0.30)', 'rgba(244,96,122,0.10)', 'rgba(18,18,18,0)']}
            start={{ x: 0, y: 0 }}
            end={{ x: 1, y: 1 }}
            style={styles.hero}
          >
            <View style={styles.heroAvatarRing}>
              <Avatar
                name={profile.display_name}
                color={profile.avatar_color}
                avatarUrl={profile.avatar_url}
                size={62}
              />
            </View>
            <View style={styles.heroInfo}>
              <View style={styles.nameRow}>
                <Text style={styles.heroName} numberOfLines={1}>
                  {profile.display_name}
                </Text>
                {verified && (
                  <View style={{ marginLeft: 4 }}>
                    <VerifiedBadge size={16} />
                  </View>
                )}
              </View>
              <Text style={styles.heroUsername} numberOfLines={1}>
                @{profile.username}
              </Text>
              <View style={styles.chipRow}>
                <View
                  style={[
                    styles.chip,
                    verified && { backgroundColor: 'rgba(62,224,196,0.14)' },
                  ]}
                >
                  <Ionicons
                    name={verified ? 'checkmark-circle' : 'ellipse-outline'}
                    size={12}
                    color={verified ? '#3EE0C4' : UI.muted}
                  />
                  <Text style={[styles.chipText, verified && { color: '#3EE0C4' }]}>
                    {verified ? 'Verified' : 'Not verified'}
                  </Text>
                </View>
                {joined && (
                  <View style={styles.chip}>
                    <Ionicons name="calendar-outline" size={12} color={UI.muted} />
                    <Text style={styles.chipText}>Joined {joined}</Text>
                  </View>
                )}
              </View>
            </View>
          </LinearGradient>

          <TouchableOpacity
            style={styles.usageCard}
            onPress={() => onOpen('time')}
            activeOpacity={0.85}
          >
            <View style={styles.usageTop}>
              <View style={[styles.rowIcon, { backgroundColor: withAlpha('#6EA8FF', 0.16) }]}>
                <Ionicons name="hourglass-outline" size={19} color="#6EA8FF" />
              </View>
              <View style={{ flex: 1 }}>
                <Text style={styles.usageLabel}>Today on Airalance</Text>
                <Text style={styles.usageValue}>
                  {formatUsageDuration(todaySecs)}
                  {limitSecs > 0 && (
                    <Text style={styles.usageOf}> of {formatUsageDuration(limitSecs)}</Text>
                  )}
                </Text>
              </View>
              <Ionicons name="chevron-forward" size={18} color={UI.faint} />
            </View>
            {limitSecs > 0 ? (
              <View style={styles.progressTrack}>
                <View
                  style={[
                    styles.progressFill,
                    { width: `${Math.max(ratio * 100, 2)}%`, backgroundColor: barColor },
                  ]}
                />
              </View>
            ) : (
              <Text style={styles.usageHint}>No daily limit set</Text>
            )}
          </TouchableOpacity>

          {adminRole && (
            <>
              <SectionTitle>Management</SectionTitle>
              {renderGroup(['admin'])}
            </>
          )}

          <SectionTitle>How you use Airalance</SectionTitle>
          {renderGroup(['time'])}

          <SectionTitle>Privacy & safety</SectionTitle>
          {renderGroup(['mentions', 'blocked', 'contacts_location'])}

          <SectionTitle>Account</SectionTitle>
          {renderGroup(['verify', 'account', 'invite'])}

          <SectionTitle>Subscription</SectionTitle>
          <TouchableOpacity
            style={styles.premiumCard}
            activeOpacity={0.85}
            onPress={() => onOpen('subscription')}
          >
            <LinearGradient
              colors={['rgba(167,139,250,0.26)', 'rgba(244,96,122,0.12)']}
              start={{ x: 0, y: 0 }}
              end={{ x: 1, y: 1 }}
              style={styles.premiumCardInner}
            >
              <View style={styles.premiumIcon}>
                <Ionicons name="sparkles" size={20} color="#FFFFFF" />
              </View>
              <View style={{ flex: 1 }}>
                <Text style={styles.premiumTitle}>Aira One</Text>
                <Text style={styles.premiumSub}>Coming soon · $2 / month</Text>
              </View>
              <Ionicons name="chevron-forward" size={18} color="rgba(255,255,255,0.5)" />
            </LinearGradient>
          </TouchableOpacity>

          <SectionTitle>Legal</SectionTitle>
          {renderGroup(['terms', 'privacy'])}

          <SectionTitle>About</SectionTitle>
          {renderGroup(['updates'])}

          <TouchableOpacity style={styles.logoutBtn} onPress={onLogout} activeOpacity={0.85}>
            <Ionicons name="log-out-outline" size={18} color={COLORS.danger} />
            <Text style={styles.logoutText}>Log out</Text>
          </TouchableOpacity>

          <Text style={styles.footer}>
            Airalance v{getAppVersion()}
            {updateTag ? ` · ${updateTag}` : ''}
          </Text>
        </>
      )}
    </View>
  );
}

/* ================= TIME MANAGEMENT ================= */

const CHART_H = 140;

function TimeManagementPanel({
  userId,
  onOpenLimit,
}: {
  userId: string;
  onOpenLimit: () => void;
}) {
  const { data, limit } = useUsage(userId);
  const [selected, setSelected] = useState(6);

  const days = useMemo(() => {
    const today = new Date();
    today.setHours(12, 0, 0, 0);
    const out: { key: string; date: Date; secs: number }[] = [];
    for (let i = 6; i >= 0; i--) {
      const d = new Date(today);
      d.setDate(today.getDate() - i);
      const key = localDateKey(d);
      out.push({ key, date: d, secs: data[key] ?? 0 });
    }
    return out;
  }, [data]);

  const firstIdx = days.findIndex((d) => d.secs > 0);
  const total = days.reduce((a, d) => a + d.secs, 0);
  const avg = firstIdx === -1 ? 0 : total / (7 - firstIdx);
  const limitSecs = limit ? limit * 60 : 0;
  const yMax = Math.max(...days.map((d) => d.secs), limitSecs, 900);
  const sel = days[selected];
  const best = days.reduce((a, b) => (b.secs > a.secs ? b : a), days[0]);

  const selLabel =
    selected === 6
      ? 'Today'
      : sel.date.toLocaleDateString(undefined, {
          weekday: 'long',
          day: 'numeric',
          month: 'short',
        });

  let deltaText = '';
  if (avg > 0 && sel.secs > 0) {
    const p = Math.round(((sel.secs - avg) / avg) * 100);
    deltaText =
      p === 0 ? 'Same as your average' : `${Math.abs(p)}% ${p > 0 ? 'more' : 'less'} than average`;
  }

  return (
    <View>
      <View style={styles.timeCard}>
        <Text style={styles.timeCardLabel}>Daily average</Text>
        <Text style={styles.timeCardValue}>{formatUsageDuration(avg)}</Text>

        <View style={styles.chartWrap}>
          {limitSecs > 0 && (
            <View
              pointerEvents="none"
              style={[styles.limitLine, { bottom: (limitSecs / yMax) * CHART_H }]}
            >
              <Text style={styles.limitLineText}>Limit {formatUsageDuration(limitSecs)}</Text>
            </View>
          )}
          <View style={styles.chart}>
            {days.map((d, i) => {
              const isSel = i === selected;
              const h = d.secs > 0 ? Math.max(5, (d.secs / yMax) * CHART_H) : 3;
              return (
                <TouchableOpacity
                  key={d.key}
                  onPress={() => setSelected(i)}
                  activeOpacity={0.7}
                  style={styles.chartCol}
                >
                  <View
                    style={[
                      styles.chartBar,
                      {
                        height: h,
                        backgroundColor: isSel ? COLORS.violet : 'rgba(124,92,255,0.35)',
                      },
                    ]}
                  />
                </TouchableOpacity>
              );
            })}
          </View>
        </View>

        <View style={styles.chartLabels}>
          {days.map((d, i) => (
            <Text
              key={d.key}
              style={[styles.chartLabel, i === selected && styles.chartLabelActive]}
            >
              {d.date.toLocaleDateString(undefined, { weekday: 'short' })}
            </Text>
          ))}
        </View>

        <View style={styles.selDay}>
          <View style={{ flex: 1 }}>
            <Text style={styles.selDayLabel}>{selLabel}</Text>
            {!!deltaText && <Text style={styles.selDayDelta}>{deltaText}</Text>}
          </View>
          <Text style={styles.selDayValue}>{formatUsageDuration(sel.secs)}</Text>
        </View>
      </View>

      <View style={styles.statRow}>
        <View style={styles.statBox}>
          <Text style={styles.statBoxLabel}>This week</Text>
          <Text style={styles.statBoxValue}>{formatUsageDuration(total)}</Text>
        </View>
        <View style={styles.statBox}>
          <Text style={styles.statBoxLabel}>Most active</Text>
          <Text style={styles.statBoxValue}>
            {best.secs > 0
              ? best.date.toLocaleDateString(undefined, { weekday: 'short' })
              : '—'}
          </Text>
        </View>
      </View>

      <SectionTitle>Limits</SectionTitle>
      <SettingsGroup>
        <SettingsRow
          icon="timer-outline"
          tint="#6EA8FF"
          title="Time limit"
          subtitle="Get a reminder when you reach your daily limit"
          value={limit ? formatUsageDuration(limit * 60) : 'Off'}
          onPress={onOpenLimit}
        />
      </SettingsGroup>

      <Text style={styles.footnote}>
        Time is counted while Airalance is open on this device.
      </Text>
    </View>
  );
}

/* ================= TIME LIMIT ================= */

function LimitSpinner({
  value,
  unit,
  onUp,
  onDown,
}: {
  value: number;
  unit: string;
  onUp: () => void;
  onDown: () => void;
}) {
  return (
    <View style={styles.spinCol}>
      <TouchableOpacity style={styles.spinBtn} onPress={onUp} activeOpacity={0.7}>
        <Ionicons name="chevron-up" size={20} color="#fff" />
      </TouchableOpacity>
      <Text style={styles.spinValue}>{String(value).padStart(2, '0')}</Text>
      <TouchableOpacity style={styles.spinBtn} onPress={onDown} activeOpacity={0.7}>
        <Ionicons name="chevron-down" size={20} color="#fff" />
      </TouchableOpacity>
      <Text style={styles.spinUnit}>{unit}</Text>
    </View>
  );
}

function TimeLimitPanel({ userId }: { userId: string }) {
  const [savedLimit, setSavedLimit] = useState<number | null>(null);
  const [hours, setHours] = useState(1);
  const [mins, setMins] = useState(0);
  const [flash, setFlash] = useState<'saved' | 'removed' | null>(null);

  useEffect(() => {
    (async () => {
      try {
        const raw = await AsyncStorage.getItem(USAGE_LIMIT_KEY(userId));
        const n = raw ? Number(raw) : null;
        if (n && n > 0) {
          setSavedLimit(n);
          setHours(Math.min(23, Math.floor(n / 60)));
          setMins(n % 60);
        }
      } catch {}
    })();
  }, [userId]);

  useEffect(() => {
    if (!flash) return;
    const t = setTimeout(() => setFlash(null), 1800);
    return () => clearTimeout(t);
  }, [flash]);

  const totalMinutes = hours * 60 + mins;
  const dirty = totalMinutes > 0 && totalMinutes !== savedLimit;

  function applyPreset(m: number) {
    setHours(Math.floor(m / 60));
    setMins(m % 60);
  }

  async function save() {
    if (!dirty) return;
    try {
      await AsyncStorage.setItem(USAGE_LIMIT_KEY(userId), String(totalMinutes));
      setSavedLimit(totalMinutes);
      setFlash('saved');
    } catch {
      Alert.alert('Error', 'Could not save your time limit. Try again.');
    }
  }

  async function remove() {
    try {
      await AsyncStorage.removeItem(USAGE_LIMIT_KEY(userId));
      setSavedLimit(null);
      setHours(1);
      setMins(0);
      setFlash('removed');
    } catch {
      Alert.alert('Error', 'Could not remove the limit. Try again.');
    }
  }

  return (
    <View>
      <View style={styles.introIcon}>
        <Ionicons name="timer-outline" size={26} color="#6EA8FF" />
      </View>
      <Text style={styles.bigTitle}>Make your time count</Text>
      <Text style={styles.bigSub}>
        Screen time isn't only about how long you spend. It's about what matters to you
        when you're online.
      </Text>

      <View style={styles.presetRow}>
        {TIME_PRESETS.map((m) => {
          const on = totalMinutes === m;
          return (
            <TouchableOpacity
              key={m}
              style={[styles.presetChip, on && styles.presetChipOn]}
              onPress={() => applyPreset(m)}
              activeOpacity={0.8}
            >
              <Text style={[styles.presetText, on && styles.presetTextOn]}>
                {formatUsageDuration(m * 60)}
              </Text>
            </TouchableOpacity>
          );
        })}
      </View>

      <View style={styles.spinRow}>
        <LimitSpinner
          value={hours}
          unit="hours"
          onUp={() => setHours((h) => Math.min(23, h + 1))}
          onDown={() => setHours((h) => Math.max(0, h - 1))}
        />
        <Text style={styles.spinColon}>:</Text>
        <LimitSpinner
          value={mins}
          unit="min"
          onUp={() => setMins((m) => (m + 5) % 60)}
          onDown={() => setMins((m) => (m - 5 + 60) % 60)}
        />
      </View>

      <Text style={styles.footnote}>
        You'll see a reminder when you reach this time each day.
      </Text>

      <TouchableOpacity
        style={[styles.primaryBtn, !dirty && flash !== 'saved' && { opacity: 0.45 }]}
        onPress={save}
        disabled={!dirty}
        activeOpacity={0.85}
      >
        {flash === 'saved' ? (
          <View style={styles.btnRow}>
            <Ionicons name="checkmark" size={16} color="#fff" />
            <Text style={styles.primaryBtnText}>Saved</Text>
          </View>
        ) : (
          <Text style={styles.primaryBtnText}>Save time limit</Text>
        )}
      </TouchableOpacity>

      {savedLimit !== null ? (
        <TouchableOpacity style={styles.dangerLink} onPress={remove} activeOpacity={0.7}>
          <Text style={styles.dangerLinkText}>Remove limit</Text>
        </TouchableOpacity>
      ) : (
        flash === 'removed' && <Text style={styles.flashText}>Limit removed</Text>
      )}
    </View>
  );
}

/* ================= VERIFICATION ================= */

function VerificationPanel({
  profile,
  verified,
}: {
  profile: Profile;
  verified: boolean;
}) {
  const [requestStatus, setRequestStatus] = useState<
    'loading' | 'none' | 'pending' | 'rejected'
  >('loading');
  const [name, setName] = useState(profile.display_name ?? '');
  const [age, setAge] = useState('');
  const [nationality, setNationality] = useState('');
  const [about, setAbout] = useState('');
  const [links, setLinks] = useState('');
  const [selfieUri, setSelfieUri] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    if (verified) return;
    let cancelled = false;
    (async () => {
      const { data, error } = await supabase
        .from('verification_requests')
        .select('status')
        .eq('user_id', profile.id)
        .order('created_at', { ascending: false })
        .limit(1)
        .maybeSingle();
      if (cancelled) return;
      const s = !error ? (data as any)?.status : undefined;
      setRequestStatus(s === 'pending' ? 'pending' : s === 'rejected' ? 'rejected' : 'none');
    })();
    return () => {
      cancelled = true;
    };
  }, [profile.id, verified]);

  async function pickSelfie() {
    const perm = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (!perm.granted) {
      Alert.alert('Permission needed', 'Please allow photo access to upload your selfie.');
      return;
    }
    const res = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ImagePicker.MediaTypeOptions.Images,
      quality: 0.85,
    });
    if (!res.canceled && res.assets[0]) setSelfieUri(res.assets[0].uri);
  }

  const ageNum = Number(age);
  const nameOk = name.trim().length >= 2;
  const ageOk = Number.isInteger(ageNum) && ageNum >= 13 && ageNum <= 120;
  const natOk = nationality.trim().length >= 2;
  const selfieOk = !!selfieUri;
  const canSubmit = nameOk && ageOk && natOk && selfieOk;

  const missing = !nameOk
    ? 'Enter your full name'
    : !ageOk
    ? 'Enter a valid age (13+)'
    : !natOk
    ? 'Enter your nationality'
    : !selfieOk
    ? 'Add a selfie with your document'
    : '';

  async function submit() {
    if (!canSubmit || !selfieUri || submitting) return;
    if (!isOnline()) {
      Alert.alert('Offline', 'Connect to the internet to submit your request.');
      return;
    }
    Keyboard.dismiss();
    setSubmitting(true);
    try {
      const path = `${profile.id}/verification-${Date.now()}.jpg`;
      const arrayBuffer = await fetch(selfieUri).then((r) => r.arrayBuffer());
      const { error: uploadError } = await supabase.storage
        .from(VERIFICATION_BUCKET)
        .upload(path, arrayBuffer, {
          cacheControl: '3600',
          upsert: false,
          contentType: 'image/jpeg',
        });
      if (uploadError) throw uploadError;

      const { error: insertError } = await supabase.from('verification_requests').insert({
        user_id: profile.id,
        full_name: name.trim(),
        age: ageNum,
        nationality: nationality.trim(),
        about: about.trim() || null,
        links: links.trim() || null,
        selfie_path: path,
        status: 'pending',
      });
      if (insertError) throw insertError;
      setRequestStatus('pending');
    } catch (err: any) {
      Alert.alert('Error', err?.message ?? 'Something went wrong. Please try again.');
    } finally {
      setSubmitting(false);
    }
  }

  if (verified) {
    return (
      <View style={styles.centerCard}>
        <VerifiedBadge size={44} />
        <Text style={styles.centerTitle}>You're verified</Text>
        <Text style={styles.centerSub}>Your account already has the verified badge.</Text>
      </View>
    );
  }

  if (requestStatus === 'loading') {
    return (
      <View style={{ gap: 12 }}>
        {[0, 1, 2, 3].map((i) => (
          <View key={i} style={styles.skeletonRow} />
        ))}
      </View>
    );
  }

  if (requestStatus === 'pending') {
    return (
      <View style={styles.centerCard}>
        <View style={styles.pillIcon}>
          <Ionicons name="time-outline" size={26} color={COLORS.violet} />
        </View>
        <Text style={styles.centerTitle}>Request submitted</Text>
        <Text style={styles.centerSub}>
          Your verification request is under review. We'll update your badge once it's done.
        </Text>
      </View>
    );
  }

  return (
    <View style={{ gap: 14 }}>
      <View style={styles.infoCard}>
        <View style={[styles.rowIcon, { backgroundColor: withAlpha('#3EE0C4', 0.16) }]}>
          <Ionicons name="ribbon-outline" size={20} color="#3EE0C4" />
        </View>
        <View style={{ flex: 1 }}>
          <Text style={styles.rowTitle}>Get verified</Text>
          <Text style={styles.rowSubtitle}>
            Fill in your details and add a selfie holding your ID.
          </Text>
        </View>
      </View>

      {requestStatus === 'rejected' && (
        <View style={styles.rejectBanner}>
          <Ionicons name="alert-circle-outline" size={18} color="#F87171" />
          <Text style={styles.rejectText}>
            Your last request wasn't approved. You can submit a new one.
          </Text>
        </View>
      )}

      <View style={styles.formCard}>
        <FieldLabel text="Full name" />
        <TextInput
          style={styles.field}
          value={name}
          onChangeText={setName}
          placeholder="Your full name"
          placeholderTextColor={UI.faint}
          underlineColorAndroid="transparent"
        />
        <FieldLabel text="Age" />
        <TextInput
          style={styles.field}
          value={age}
          onChangeText={(v) => setAge(v.replace(/\D/g, '').slice(0, 3))}
          placeholder="Your age"
          placeholderTextColor={UI.faint}
          keyboardType="number-pad"
          underlineColorAndroid="transparent"
        />
        <FieldLabel text="Nationality" />
        <TextInput
          style={styles.field}
          value={nationality}
          onChangeText={setNationality}
          placeholder="Your nationality"
          placeholderTextColor={UI.faint}
          underlineColorAndroid="transparent"
        />
      </View>

      <View style={styles.formCard}>
        <FieldLabel text="Selfie with document" />
        {selfieUri ? (
          <View style={styles.selfieWrap}>
            <RNImage source={{ uri: selfieUri }} style={styles.selfieImg} />
            <TouchableOpacity style={styles.selfieChange} onPress={pickSelfie} activeOpacity={0.8}>
              <Ionicons name="swap-horizontal" size={14} color="#fff" />
              <Text style={styles.selfieChangeText}>Change photo</Text>
            </TouchableOpacity>
          </View>
        ) : (
          <TouchableOpacity style={styles.selfiePick} onPress={pickSelfie} activeOpacity={0.85}>
            <Ionicons name="camera-outline" size={26} color={COLORS.violet} />
            <Text style={styles.selfiePickTitle}>Add a selfie holding your document</Text>
            <Text style={styles.selfiePickSub}>
              Your face and the document must both be clearly visible.
            </Text>
          </TouchableOpacity>
        )}
      </View>

      <View style={styles.formCard}>
        <View style={styles.labelRow}>
          <FieldLabel text="About (optional)" />
          <Text style={styles.counter}>{about.length}/500</Text>
        </View>
        <TextInput
          style={[styles.field, styles.fieldMultiline]}
          value={about}
          onChangeText={setAbout}
          placeholder="Tell us why your account should be verified"
          placeholderTextColor={UI.faint}
          multiline
          maxLength={500}
          textAlignVertical="top"
          underlineColorAndroid="transparent"
        />
        <View style={styles.labelRow}>
          <FieldLabel text="Links (optional)" />
          <Text style={styles.counter}>{links.length}/500</Text>
        </View>
        <TextInput
          style={[styles.field, styles.fieldMultiline]}
          value={links}
          onChangeText={setLinks}
          placeholder="Website or social profiles, one per line"
          placeholderTextColor={UI.faint}
          multiline
          maxLength={500}
          autoCapitalize="none"
          textAlignVertical="top"
          underlineColorAndroid="transparent"
        />
      </View>

      {!canSubmit && !!missing && <Text style={styles.hint}>{missing}</Text>}

      <TouchableOpacity
        style={[styles.primaryBtn, (!canSubmit || submitting) && { opacity: 0.45 }]}
        onPress={submit}
        disabled={!canSubmit || submitting}
        activeOpacity={0.85}
      >
        {submitting ? (
          <ActivityIndicator color="#fff" />
        ) : (
          <Text style={styles.primaryBtnText}>Submit request</Text>
        )}
      </TouchableOpacity>
    </View>
  );
}

/* ================= BLOCKED ================= */

function BlockedPanel({ myId }: { myId: string }) {
  const [people, setPeople] = useState<Profile[] | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [failed, setFailed] = useState(false);

  const load = useCallback(async () => {
    setFailed(false);
    try {
      const { data: rows, error } = await supabase
        .from('blocked_users')
        .select('blocked_id')
        .eq('blocker_id', myId);
      if (error) throw error;
      if (!rows || rows.length === 0) {
        setPeople([]);
        return;
      }
      const ids = rows.map((r: any) => r.blocked_id as string);
      const chunks: string[][] = [];
      for (let i = 0; i < ids.length; i += 100) chunks.push(ids.slice(i, i + 100));
      const res = await Promise.all(
        chunks.map((ch) => supabase.from('profiles').select('*').in('id', ch))
      );
      setPeople(res.flatMap((r) => (r.data ?? []) as Profile[]));
    } catch (err) {
      console.warn('[blocked] load failed:', err);
      setFailed(true);
      setPeople((prev) => prev ?? []);
    }
  }, [myId]);

  useEffect(() => {
    load();
  }, [load]);

  async function unblock(target: Profile) {
    if (busyId) return;
    setBusyId(target.id);
    const { error } = await supabase
      .from('blocked_users')
      .delete()
      .eq('blocker_id', myId)
      .eq('blocked_id', target.id);
    setBusyId(null);
    if (error) {
      Alert.alert('Error', 'Could not unblock. Try again.');
      return;
    }
    setPeople((prev) => (prev ?? []).filter((p) => p.id !== target.id));
  }

  if (people === null) {
    return (
      <View style={{ gap: 12 }}>
        {[0, 1, 2].map((i) => (
          <View key={i} style={styles.blockedSkeleton}>
            <View style={styles.blockedSkeletonAvatar} />
            <View style={{ flex: 1, gap: 6 }}>
              <View style={styles.blockedSkeletonLine} />
              <View style={[styles.blockedSkeletonLine, { width: '40%' }]} />
            </View>
          </View>
        ))}
      </View>
    );
  }

  if (failed && people.length === 0) {
    return (
      <View style={styles.centerCard}>
        <View style={styles.pillIcon}>
          <Ionicons name="cloud-offline-outline" size={24} color={UI.muted} />
        </View>
        <Text style={styles.centerTitle}>Couldn't load blocked list</Text>
        <Text style={styles.centerSub}>Check your connection and try again.</Text>
        <TouchableOpacity style={styles.retryBtn} onPress={load} activeOpacity={0.8}>
          <Text style={styles.retryBtnText}>Try again</Text>
        </TouchableOpacity>
      </View>
    );
  }

  if (people.length === 0) {
    return (
      <View style={styles.centerCard}>
        <View style={styles.pillIcon}>
          <Ionicons name="ban-outline" size={24} color={UI.muted} />
        </View>
        <Text style={styles.centerTitle}>No blocked accounts</Text>
        <Text style={styles.centerSub}>People you block will show up here.</Text>
      </View>
    );
  }

  return (
    <View>
      <Text style={styles.listCount}>
        {people.length} blocked {people.length === 1 ? 'account' : 'accounts'}
      </Text>
      <SettingsGroup>
        {people.map((p, i) => (
          <View key={p.id}>
            {i > 0 && <Divider inset={false} />}
            <View style={styles.blockedRow}>
              <Avatar
                name={p.display_name}
                color={p.avatar_color}
                avatarUrl={p.avatar_url}
                size={44}
              />
              <View style={styles.blockedInfo}>
                <View style={styles.nameRow}>
                  <Text style={styles.blockedName} numberOfLines={1}>
                    {p.display_name}
                  </Text>
                  {isVerifiedUser(p) && (
                    <View style={{ marginLeft: 3 }}>
                      <VerifiedBadge size={14} />
                    </View>
                  )}
                </View>
                <Text style={styles.blockedUsername} numberOfLines={1}>
                  @{p.username}
                </Text>
              </View>
              <TouchableOpacity
                style={styles.unblockBtn}
                onPress={() => unblock(p)}
                disabled={busyId === p.id}
                activeOpacity={0.75}
              >
                {busyId === p.id ? (
                  <ActivityIndicator size="small" color="#fff" />
                ) : (
                  <Text style={styles.unblockBtnText}>Unblock</Text>
                )}
              </TouchableOpacity>
            </View>
          </View>
        ))}
      </SettingsGroup>
    </View>
  );
}

/* ================= MENTION PRIVACY ================= */

function MentionPrivacyPanel({
  profile,
  onSaved,
}: {
  profile: Profile;
  onSaved: (v: MentionValue) => void;
}) {
  const [value, setValue] = useState<MentionValue | null>(profile.mention_privacy ?? null);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (value !== null) return;
    (async () => {
      const { data } = await supabase
        .from('profiles')
        .select('mention_privacy')
        .eq('id', profile.id)
        .maybeSingle();
      const v = (data as any)?.mention_privacy;
      setValue(v === 'everyone' ? 'everyone' : 'connections');
    })();
  }, [profile.id, value]);

  async function choose(next: MentionValue) {
    if (saving || next === value) return;
    if (!isOnline()) {
      Alert.alert('Offline', 'Connect to the internet to change this setting.');
      return;
    }
    const prev = value;
    setValue(next);
    setSaving(true);
    const { error } = await supabase
      .from('profiles')
      .update({ mention_privacy: next })
      .eq('id', profile.id);
    setSaving(false);
    if (error) {
      setValue(prev);
      Alert.alert('Error', 'Could not save your choice. Try again.');
      return;
    }
    onSaved(next);
  }

  const options: { id: MentionValue; icon: IconName; title: string; desc: string }[] = [
    {
      id: 'connections',
      icon: 'people-outline',
      title: 'Only connections',
      desc: "Only people you're connected with can tag or mention you.",
    },
    {
      id: 'everyone',
      icon: 'globe-outline',
      title: 'Everyone',
      desc: 'Anyone on Airalance can tag or mention you.',
    },
  ];

  if (value === null) {
    return (
      <View style={{ gap: 12 }}>
        {[0, 1].map((i) => (
          <View key={i} style={styles.skeletonRow} />
        ))}
      </View>
    );
  }

  return (
    <View>
      <Text style={styles.footnoteTop}>Choose who can tag or mention you in their status.</Text>
      <View style={{ gap: 12, marginTop: 14 }}>
        {options.map((o) => {
          const on = value === o.id;
          return (
            <TouchableOpacity
              key={o.id}
              style={[styles.radioCard, on && styles.radioCardOn]}
              onPress={() => choose(o.id)}
              activeOpacity={0.85}
            >
              <View
                style={[
                  styles.rowIcon,
                  { backgroundColor: on ? 'rgba(124,92,255,0.22)' : 'rgba(255,255,255,0.06)' },
                ]}
              >
                <Ionicons name={o.icon} size={20} color={on ? COLORS.violet : UI.muted} />
              </View>
              <View style={{ flex: 1 }}>
                <Text style={styles.radioTitle}>{o.title}</Text>
                <Text style={styles.radioDesc}>{o.desc}</Text>
              </View>
              <View style={[styles.radioCircle, on && styles.radioCircleOn]}>
                {on && <Ionicons name="checkmark" size={14} color="#fff" />}
              </View>
            </TouchableOpacity>
          );
        })}
      </View>
    </View>
  );
}

/* ================= INVITE ================= */

function InvitePanel({ username }: { username: string }) {
  const [copied, setCopied] = useState(false);

  async function shareLink() {
    try {
      await Share.share({
        message: `Hey! I'm using Airalance — a privacy-first messaging app.\n\nJoin me: ${INVITE_URL}\n\nOr find me as @${username}`,
        title: 'Join me on Airalance',
      });
    } catch {}
  }

  async function copyLink() {
    const ok = await copyText(INVITE_URL);
    if (!ok) {
      // clipboard module na ho to share sheet (usme "Copy" option hota hai)
      shareLink();
      return;
    }
    setCopied(true);
    setTimeout(() => setCopied(false), 1800);
  }

  return (
    <View style={styles.inviteCard}>
      <LinearGradient
        colors={['#7C5CFF', '#F4607A']}
        start={{ x: 0, y: 0 }}
        end={{ x: 1, y: 1 }}
        style={styles.inviteIcon}
      >
        <Ionicons name="person-add" size={26} color="#fff" />
      </LinearGradient>
      <Text style={styles.inviteTitle}>Invite your friends</Text>
      <Text style={styles.inviteSub}>Share this link and bring them to Airalance.</Text>

      <TouchableOpacity style={styles.inviteLink} onPress={copyLink} activeOpacity={0.8}>
        <Ionicons name="link-outline" size={16} color={UI.muted} />
        <Text style={styles.inviteLinkText}>{INVITE_LABEL}</Text>
        <Ionicons
          name={copied ? 'checkmark-circle' : 'copy-outline'}
          size={16}
          color={copied ? UI.green : UI.muted}
        />
      </TouchableOpacity>

      <View style={styles.inviteBtns}>
        <TouchableOpacity style={styles.inviteBtnSecondary} onPress={copyLink} activeOpacity={0.85}>
          <Ionicons name={copied ? 'checkmark' : 'copy-outline'} size={16} color="#fff" />
          <Text style={styles.inviteBtnText}>{copied ? 'Copied' : 'Copy link'}</Text>
        </TouchableOpacity>
        <TouchableOpacity style={styles.inviteBtnPrimary} onPress={shareLink} activeOpacity={0.85}>
          <Ionicons name="share-outline" size={16} color="#fff" />
          <Text style={styles.inviteBtnText}>Share</Text>
        </TouchableOpacity>
      </View>
    </View>
  );
}

/* ================= ACCOUNT STATUS ================= */

function AccountStatusPanel({ profile }: { profile: Profile }) {
  const [fresh, setFresh] = useState<Profile>(profile);

  // fresh flags (restrictions) — fail ho to jo hai wahi dikhao
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const { data, error } = await supabase
          .from('profiles')
          .select('*')
          .eq('id', profile.id)
          .maybeSingle();
        if (!cancelled && !error && data) setFresh(data as Profile);
      } catch {}
    })();
    return () => {
      cancelled = true;
    };
  }, [profile.id]);

  const items = [
    { id: 'messaging', title: 'Messaging restrictions', ok: !fresh.messaging_restricted },
    { id: 'features', title: 'Feature restrictions', ok: !fresh.feature_restricted },
    { id: 'shadowban', title: 'Shadowban', ok: !fresh.shadowbanned },
    { id: 'locked', title: 'Account locked', ok: !fresh.account_locked },
  ];
  const allGood = items.every((i) => i.ok);
  const created = fresh.created_at
    ? new Date(fresh.created_at).toLocaleDateString(undefined, {
        day: 'numeric',
        month: 'short',
        year: 'numeric',
      })
    : '—';

  return (
    <View>
      <View style={styles.statusBanner}>
        <View
          style={[
            styles.statusIcon,
            {
              backgroundColor: allGood ? 'rgba(16,185,129,0.15)' : 'rgba(239,68,68,0.15)',
            },
          ]}
        >
          <Ionicons
            name={allGood ? 'shield-checkmark' : 'alert'}
            size={22}
            color={allGood ? UI.green : '#F87171'}
          />
        </View>
        <View style={{ flex: 1 }}>
          <Text style={styles.rowTitle}>
            {allGood ? 'Everything looks good' : 'Account needs attention'}
          </Text>
          <Text style={styles.rowSubtitle}>
            {allGood ? 'Your account is in good standing.' : 'Some features are limited.'}
          </Text>
        </View>
      </View>

      <View style={[styles.group, { marginTop: 16 }]}>
        {items.map((item, i) => (
          <View key={item.id}>
            {i > 0 && <Divider inset={false} />}
            <View style={styles.statusRow}>
              <Text style={styles.statusRowTitle}>{item.title}</Text>
              <View
                style={[
                  styles.statusPill,
                  { backgroundColor: item.ok ? 'rgba(52,211,153,0.12)' : 'rgba(248,113,113,0.14)' },
                ]}
              >
                <Ionicons
                  name={item.ok ? 'checkmark' : 'alert'}
                  size={12}
                  color={item.ok ? UI.green : '#F87171'}
                />
                <Text style={[styles.statusPillText, { color: item.ok ? UI.green : '#F87171' }]}>
                  {item.ok ? 'None' : 'Active'}
                </Text>
              </View>
            </View>
          </View>
        ))}
      </View>

      <View style={[styles.group, { marginTop: 16 }]}>
        <View style={styles.statusRow}>
          <Text style={styles.statusRowTitle}>Username</Text>
          <Text style={styles.statusValue}>@{fresh.username}</Text>
        </View>
        <Divider inset={false} />
        <View style={styles.statusRow}>
          <Text style={styles.statusRowTitle}>Member since</Text>
          <Text style={styles.statusValue}>{created}</Text>
        </View>
      </View>
    </View>
  );
}

/* ================= SUBSCRIPTION ================= */

function SubscriptionPanel() {
  function subscribe() {
    Alert.alert('Aira One', 'Checkout coming soon. Stay tuned!', [{ text: 'OK' }]);
  }

  return (
    <View>
      <LinearGradient
        colors={['rgba(124,92,255,0.30)', 'rgba(244,96,122,0.14)']}
        start={{ x: 0, y: 0 }}
        end={{ x: 1, y: 1 }}
        style={styles.subHero}
      >
        <View style={styles.premiumIconBig}>
          <Ionicons name="sparkles" size={26} color="#fff" />
        </View>
        <View style={{ flex: 1 }}>
          <Text style={styles.subHeroTitle}>Aira One</Text>
          <Text style={styles.subHeroSub}>Coming soon</Text>
        </View>
        <View style={styles.soonPill}>
          <Text style={styles.soonPillText}>Soon</Text>
        </View>
      </LinearGradient>

      <SectionTitle>Features</SectionTitle>
      <SettingsGroup>
        {AIRA_ONE_FEATURES.map((f, i) => (
          <View key={f.text}>
            {i > 0 && <Divider />}
            <View style={styles.featureRow}>
              <View style={styles.featureIcon}>
                <Ionicons name={f.icon} size={17} color="#B79CFF" />
              </View>
              <Text style={styles.featureText}>{f.text}</Text>
              <Ionicons name="checkmark-circle" size={18} color="#B79CFF" />
            </View>
          </View>
        ))}
      </SettingsGroup>

      <SectionTitle>Cost</SectionTitle>
      <View style={styles.costCard}>
        <Text style={styles.costValue}>$2</Text>
        <Text style={styles.costUnit}>per month</Text>
      </View>

      <TouchableOpacity
        style={[styles.primaryBtn, { marginTop: 22 }]}
        onPress={subscribe}
        activeOpacity={0.85}
      >
        <Text style={styles.primaryBtnText}>Subscribe now</Text>
      </TouchableOpacity>
    </View>
  );
}

/* ================= UPDATES ================= */

type UpdPhase =
  | 'idle'
  | 'checking'
  | 'uptodate'
  | 'downloading'
  | 'restarting'
  | 'error'
  | 'unavailable';

function InfoRow({
  label,
  value,
  sub,
  onPress,
}: {
  label: string;
  value: string;
  sub?: string;
  onPress?: () => void;
}) {
  const body = (
    <View style={styles.statusRow}>
      <Text style={styles.statusRowTitle}>{label}</Text>
      <View style={styles.infoValueWrap}>
        <Text style={styles.statusValueLight} numberOfLines={1}>
          {value}
        </Text>
        {!!sub && (
          <Text style={styles.infoSub} numberOfLines={1}>
            {sub}
          </Text>
        )}
      </View>
    </View>
  );
  if (!onPress) return body;
  return (
    <TouchableOpacity onPress={onPress} activeOpacity={0.7}>
      {body}
    </TouchableOpacity>
  );
}

function UpdatesPanel() {
  const { currentlyRunning, availableUpdate, downloadedUpdate, isUpdateAvailable, isUpdatePending } =
    Updates.useUpdates();
  const enabled = !__DEV__ && Updates.isEnabled;

  const [phase, setPhase] = useState<UpdPhase>('idle');
  const [lastCheck, setLastCheck] = useState<number | null>(null);
  const [copied, setCopied] = useState(false);
  const [, setTick] = useState(0);
  const busy = useRef(false);

  // "x min ago" fresh rahe
  useEffect(() => {
    const t = setInterval(() => setTick((n) => n + 1), 30000);
    return () => clearInterval(t);
  }, []);

  useEffect(() => {
    (async () => {
      try {
        const raw = await AsyncStorage.getItem(LAST_CHECK_KEY);
        const n = raw ? Number(raw) : NaN;
        if (Number.isFinite(n)) setLastCheck(n);
      } catch {}
    })();
  }, []);

  const settle = (p: UpdPhase, ms = 3000) => {
    setPhase(p);
    setTimeout(() => setPhase((cur) => (cur === p ? 'idle' : cur)), ms);
  };

  async function check() {
    if (busy.current) return;
    if (!enabled) {
      settle('unavailable');
      return;
    }
    if (!isOnline()) {
      Alert.alert('Offline', 'Connect to the internet to check for updates.');
      return;
    }
    busy.current = true;
    try {
      setPhase('checking');
      const res = await withTimeout(Updates.checkForUpdateAsync(), 8000);
      const now = Date.now();
      setLastCheck(now);
      AsyncStorage.setItem(LAST_CHECK_KEY, String(now)).catch(() => {});
      if (res.isAvailable) setPhase('idle');
      else settle('uptodate');
    } catch (err) {
      console.warn('[updates] check failed:', err);
      settle('error');
    } finally {
      busy.current = false;
    }
  }

  async function install() {
    if (busy.current || !enabled) return;
    busy.current = true;
    try {
      if (!isUpdatePending) {
        setPhase('downloading');
        await withTimeout(Updates.fetchUpdateAsync(), 90000);
      }
      setPhase('restarting');
      await new Promise((r) => setTimeout(r, 600));
      await Updates.reloadAsync();
    } catch (err) {
      console.warn('[updates] install failed:', err);
      settle('error');
    } finally {
      busy.current = false;
    }
  }

  async function copyId() {
    const id = currentlyRunning.updateId;
    if (!id) return;
    const ok = await copyText(id);
    if (ok) {
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    }
  }

  const embedded = !!currentlyRunning.isEmbeddedLaunch;
  const created = currentlyRunning.createdAt ?? null;
  const incoming = downloadedUpdate ?? availableUpdate ?? null;
  const working = ['checking', 'downloading', 'restarting'].includes(phase);

  let tone: 'ok' | 'new' | 'off' = 'ok';
  let title = "You're up to date";
  let sub = created
    ? `Latest update published ${timeAgo(created)}`
    : 'You have the latest version.';
  if (!enabled) {
    tone = 'off';
    title = 'Updates are off';
    sub = 'Update checks run only in installed (release) builds.';
  } else if (isUpdatePending || isUpdateAvailable) {
    tone = 'new';
    title = isUpdatePending ? 'Update ready' : 'Update available';
    sub = incoming?.createdAt
      ? `Published ${timeAgo(incoming.createdAt)}`
      : 'A new version is waiting for you.';
  }
  if (phase === 'error') sub = "Couldn't reach the update server. Try again.";
  if (phase === 'checking') sub = 'Checking for updates…';
  if (phase === 'downloading') sub = 'Downloading update…';
  if (phase === 'restarting') sub = 'Restarting…';

  const toneColor = tone === 'new' ? UI.amber : tone === 'off' ? '#9CA3AF' : UI.green;
  const toneIcon: IconName =
    tone === 'new' ? 'arrow-down-circle' : tone === 'off' ? 'information-circle' : 'checkmark-circle';

  const canInstall = enabled && (isUpdateAvailable || isUpdatePending);
  const btnLabel = isUpdatePending
    ? 'Restart to update'
    : canInstall
    ? 'Download & restart'
    : 'Check for updates';

  return (
    <View>
      <View style={styles.statusBanner}>
        <View style={[styles.statusIcon, { backgroundColor: withAlpha(toneColor, 0.15) }]}>
          <Ionicons name={toneIcon} size={24} color={toneColor} />
        </View>
        <View style={{ flex: 1 }}>
          <Text style={styles.rowTitle}>{title}</Text>
          <Text style={styles.rowSubtitle}>{sub}</Text>
        </View>
      </View>

      {tone === 'new' && incoming && (
        <>
          <SectionTitle>Latest available</SectionTitle>
          <View style={styles.group}>
            <InfoRow
              label="Published"
              value={timeAgo(incoming.createdAt)}
              sub={formatDateTime(incoming.createdAt)}
            />
            <Divider inset={false} />
            <InfoRow label="Update ID" value={(incoming.updateId ?? '').slice(0, 8) || '—'} />
          </View>
        </>
      )}

      <SectionTitle>Installed on this device</SectionTitle>
      <View style={styles.group}>
        <InfoRow label="App version" value={`v${getAppVersion()}`} />
        <Divider inset={false} />
        <InfoRow
          label={embedded ? 'Build created' : 'Last updated'}
          value={timeAgo(created)}
          sub={formatDateTime(created)}
        />
        <Divider inset={false} />
        <InfoRow
          label="Source"
          value={embedded ? 'Built-in' : 'Over-the-air'}
          sub={embedded ? 'Came with the installed app' : 'Downloaded after install'}
        />
        <Divider inset={false} />
        <InfoRow
          label="Update ID"
          value={
            copied ? 'Copied' : (currentlyRunning.updateId ?? '').slice(0, 8) || '—'
          }
          onPress={currentlyRunning.updateId ? copyId : undefined}
        />
        <Divider inset={false} />
        <InfoRow label="Channel" value={currentlyRunning.channel ?? '—'} />
        <Divider inset={false} />
        <InfoRow label="Runtime" value={currentlyRunning.runtimeVersion ?? '—'} />
        <Divider inset={false} />
        <InfoRow
          label="Last checked"
          value={lastCheck ? timeAgo(lastCheck) : 'Never'}
          sub={lastCheck ? formatDateTime(lastCheck) : undefined}
        />
      </View>

      <TouchableOpacity
        style={[styles.primaryBtn, (working || !enabled) && { opacity: 0.5 }]}
        onPress={canInstall ? install : check}
        disabled={working || !enabled}
        activeOpacity={0.85}
      >
        {working ? (
          <ActivityIndicator color="#fff" />
        ) : (
          <Text style={styles.primaryBtnText}>{btnLabel}</Text>
        )}
      </TouchableOpacity>

      <Text style={styles.footnote}>
        Updates download automatically when you open Airalance. You can also check manually here.
      </Text>
    </View>
  );
}

/* ================= SHARED ================= */

function SectionTitle({ children }: { children: React.ReactNode }) {
  return <Text style={styles.sectionTitle}>{children}</Text>;
}

function SettingsGroup({ children }: { children: React.ReactNode }) {
  return <View style={styles.group}>{children}</View>;
}

function Divider({ inset = true }: { inset?: boolean }) {
  return <View style={[styles.divider, !inset && { marginLeft: 16 }]} />;
}

function FieldLabel({ text }: { text: string }) {
  return <Text style={styles.fieldLabel}>{text}</Text>;
}

function SettingsRow({
  icon,
  tint,
  title,
  subtitle,
  value,
  onPress,
  loading,
}: {
  icon: IconName;
  tint: string;
  title: string;
  subtitle?: string;
  value?: string;
  onPress?: () => void;
  loading?: boolean;
}) {
  const content = (
    <>
      <View style={[styles.rowIcon, { backgroundColor: withAlpha(tint, 0.16) }]}>
        <Ionicons name={icon} size={19} color={tint} />
      </View>
      <View style={styles.rowBody}>
        <Text style={styles.rowTitle}>{title}</Text>
        {!!subtitle && (
          <Text style={styles.rowSubtitle} numberOfLines={2}>
            {subtitle}
          </Text>
        )}
      </View>
      {!!value && (
        <Text style={styles.rowValue} numberOfLines={1}>
          {value}
        </Text>
      )}
      {loading ? (
        <ActivityIndicator size="small" color={COLORS.violet} />
      ) : onPress ? (
        <Ionicons name="chevron-forward" size={18} color={UI.faint} />
      ) : null}
    </>
  );
  if (!onPress) return <View style={styles.row}>{content}</View>;
  return (
    <TouchableOpacity style={styles.row} onPress={onPress} activeOpacity={0.7} disabled={loading}>
      {content}
    </TouchableOpacity>
  );
}

function ConfirmDialog({
  visible,
  icon,
  title,
  message,
  confirmLabel,
  cancelLabel = 'Cancel',
  danger,
  onConfirm,
  onCancel,
}: {
  visible: boolean;
  icon: IconName;
  title: string;
  message: string;
  confirmLabel: string;
  cancelLabel?: string;
  danger?: boolean;
  onConfirm: () => void;
  onCancel: () => void;
}) {
  const color = danger ? COLORS.danger : COLORS.violet;
  return (
    <Modal
      visible={visible}
      transparent
      animationType="fade"
      statusBarTranslucent
      onRequestClose={onCancel}
    >
      <Pressable style={styles.dialogBackdrop} onPress={onCancel}>
        <Pressable style={styles.dialogCard} onPress={(e) => e.stopPropagation()}>
          <View style={[styles.dialogIconWrap, { backgroundColor: withAlpha('#EF4444', danger ? 0.15 : 0) }]}>
            <Ionicons name={icon} size={22} color={color} />
          </View>
          <Text style={styles.dialogTitle}>{title}</Text>
          <Text style={styles.dialogSub}>{message}</Text>
          <View style={styles.dialogButtons}>
            <TouchableOpacity style={styles.dialogBtnSecondary} onPress={onCancel} activeOpacity={0.75}>
              <Text style={styles.dialogBtnSecondaryText}>{cancelLabel}</Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={[styles.dialogBtn, { backgroundColor: color }]}
              onPress={onConfirm}
              activeOpacity={0.75}
            >
              <Text style={styles.dialogBtnText}>{confirmLabel}</Text>
            </TouchableOpacity>
          </View>
        </Pressable>
      </Pressable>
    </Modal>
  );
}

/* ================= STYLES ================= */

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: UI.bg },
  scroll: { paddingHorizontal: 16, paddingTop: 4 },
  centerFill: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: 8, paddingBottom: 80 },

  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 14,
    paddingVertical: 10,
  },
  headerBtn: {
    width: 38,
    height: 38,
    borderRadius: 19,
    alignItems: 'center',
    justifyContent: 'center',
  },
  headerTitle: {
    flex: 1,
    textAlign: 'center',
    fontSize: 18,
    fontFamily: FONTS.displayBold,
    color: '#FFFFFF',
    letterSpacing: -0.2,
  },

  emptyTitle: { fontSize: 15.5, fontFamily: FONTS.bodySemiBold, color: '#FFFFFF', marginTop: 4 },
  emptySub: { fontSize: 13, fontFamily: FONTS.body, color: UI.muted, textAlign: 'center' },
  retryBtn: {
    marginTop: 8,
    paddingHorizontal: 22,
    paddingVertical: 10,
    borderRadius: RADII.full,
    backgroundColor: 'rgba(255,255,255,0.08)',
  },
  retryBtnText: { color: '#FFFFFF', fontSize: 13.5, fontFamily: FONTS.bodySemiBold },
  busyOverlay: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: 'rgba(0,0,0,0.65)',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 10,
  },
  busyText: { color: '#FFFFFF', fontSize: 13.5, fontFamily: FONTS.bodyMedium },

  // search
  searchWrap: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    height: 42,
    paddingHorizontal: 14,
    borderRadius: 14,
    backgroundColor: UI.card,
    borderWidth: 1,
    borderColor: UI.border,
  },
  searchInput: {
    flex: 1,
    fontSize: 14.5,
    fontFamily: FONTS.body,
    color: '#FFFFFF',
    paddingVertical: 0,
  },
  noResults: { alignItems: 'center', gap: 6, paddingTop: 60 },

  // hero
  hero: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 14,
    padding: 16,
    marginTop: 14,
    borderRadius: RADII.xl,
    backgroundColor: UI.card,
    borderWidth: 1,
    borderColor: UI.border,
    overflow: 'hidden',
  },
  heroAvatarRing: {
    padding: 3,
    borderRadius: 40,
    borderWidth: 2,
    borderColor: 'rgba(124,92,255,0.7)',
  },
  heroInfo: { flex: 1, minWidth: 0 },
  nameRow: { flexDirection: 'row', alignItems: 'center' },
  heroName: {
    fontSize: 18,
    fontFamily: FONTS.displayBold,
    color: '#FFFFFF',
    flexShrink: 1,
    includeFontPadding: false,
  } as any,
  heroUsername: { fontSize: 13.5, fontFamily: FONTS.body, color: UI.muted, marginTop: 2 },
  chipRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 6, marginTop: 10 },
  chip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    paddingHorizontal: 9,
    paddingVertical: 4,
    borderRadius: 999,
    backgroundColor: 'rgba(255,255,255,0.07)',
  },
  chipText: { fontSize: 11.5, fontFamily: FONTS.bodyMedium, color: UI.muted },

  // usage summary
  usageCard: {
    marginTop: 12,
    padding: 14,
    borderRadius: RADII.xl,
    backgroundColor: UI.card,
    borderWidth: 1,
    borderColor: UI.border,
  },
  usageTop: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  usageLabel: { fontSize: 12, fontFamily: FONTS.body, color: UI.muted },
  usageValue: { fontSize: 18, fontFamily: FONTS.displayBold, color: '#FFFFFF', marginTop: 1 },
  usageOf: { fontSize: 13, fontFamily: FONTS.body, color: UI.muted },
  progressTrack: {
    height: 6,
    borderRadius: 3,
    backgroundColor: 'rgba(255,255,255,0.08)',
    marginTop: 12,
    overflow: 'hidden',
  },
  progressFill: { height: 6, borderRadius: 3 },
  usageHint: { fontSize: 12, fontFamily: FONTS.body, color: UI.faint, marginTop: 10 },

  // sections / rows
  sectionTitle: {
    fontSize: 12,
    fontFamily: FONTS.bodySemiBold,
    color: UI.muted,
    textTransform: 'uppercase',
    letterSpacing: 0.8,
    marginTop: 22,
    marginBottom: 8,
    marginLeft: 6,
  },
  group: {
    backgroundColor: UI.card,
    borderRadius: RADII.xl,
    borderWidth: 1,
    borderColor: UI.border,
    overflow: 'hidden',
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    paddingHorizontal: 14,
    paddingVertical: 12,
  },
  rowIcon: {
    width: 36,
    height: 36,
    borderRadius: 11,
    alignItems: 'center',
    justifyContent: 'center',
  },
  rowBody: { flex: 1, minWidth: 0 },
  rowTitle: { fontSize: 15, fontFamily: FONTS.bodySemiBold, color: '#FFFFFF' },
  rowSubtitle: { fontSize: 12.5, fontFamily: FONTS.body, color: UI.muted, marginTop: 2, lineHeight: 17 },
  rowValue: { fontSize: 13.5, fontFamily: FONTS.bodyMedium, color: UI.muted, maxWidth: 110 },
  divider: { height: 1, backgroundColor: UI.border, marginLeft: 62 },

  // premium
  premiumCard: {
    borderRadius: RADII.xl,
    overflow: 'hidden',
    borderWidth: 1,
    borderColor: 'rgba(167,139,250,0.28)',
  },
  premiumCardInner: { flexDirection: 'row', alignItems: 'center', gap: 12, padding: 14 },
  premiumIcon: {
    width: 40,
    height: 40,
    borderRadius: 12,
    backgroundColor: 'rgba(124,92,255,0.55)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  premiumTitle: { fontSize: 16, fontFamily: FONTS.displayBold, color: '#FFFFFF' },
  premiumSub: { fontSize: 12.5, fontFamily: FONTS.body, color: 'rgba(255,255,255,0.65)', marginTop: 2 },

  logoutBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    marginTop: 26,
    paddingVertical: 14,
    borderRadius: RADII.full,
    borderWidth: 1,
    borderColor: 'rgba(239,68,68,0.35)',
    backgroundColor: 'rgba(239,68,68,0.08)',
  },
  logoutText: { fontSize: 14.5, fontFamily: FONTS.bodySemiBold, color: COLORS.danger },
  footer: {
    textAlign: 'center',
    marginTop: 16,
    fontSize: 12,
    fontFamily: FONTS.body,
    color: UI.faint,
  },

  // time management
  timeCard: {
    marginTop: 8,
    padding: 18,
    borderRadius: RADII.xl,
    backgroundColor: UI.card,
    borderWidth: 1,
    borderColor: UI.border,
  },
  timeCardLabel: { fontSize: 13, fontFamily: FONTS.body, color: UI.muted },
  timeCardValue: {
    fontSize: 34,
    fontFamily: FONTS.displayBold,
    color: '#FFFFFF',
    marginTop: 2,
    letterSpacing: -0.5,
  },
  chartWrap: { marginTop: 18, height: CHART_H, justifyContent: 'flex-end' },
  chart: { flexDirection: 'row', alignItems: 'flex-end', height: CHART_H, gap: 8 },
  chartCol: { flex: 1, height: CHART_H, justifyContent: 'flex-end' },
  chartBar: { width: '100%', borderRadius: 6 },
  limitLine: {
    position: 'absolute',
    left: 0,
    right: 0,
    height: 1,
    backgroundColor: 'rgba(255,200,87,0.55)',
    zIndex: 2,
  },
  limitLineText: {
    position: 'absolute',
    right: 0,
    bottom: 3,
    fontSize: 10,
    fontFamily: FONTS.bodyMedium,
    color: UI.amber,
  },
  chartLabels: { flexDirection: 'row', gap: 8, marginTop: 8 },
  chartLabel: {
    flex: 1,
    textAlign: 'center',
    fontSize: 11,
    fontFamily: FONTS.body,
    color: UI.faint,
  },
  chartLabelActive: { color: '#FFFFFF', fontFamily: FONTS.bodySemiBold },
  selDay: {
    flexDirection: 'row',
    alignItems: 'center',
    marginTop: 16,
    paddingTop: 14,
    borderTopWidth: 1,
    borderTopColor: UI.border,
  },
  selDayLabel: { fontSize: 14, fontFamily: FONTS.bodySemiBold, color: '#FFFFFF' },
  selDayDelta: { fontSize: 12, fontFamily: FONTS.body, color: UI.muted, marginTop: 2 },
  selDayValue: { fontSize: 18, fontFamily: FONTS.displayBold, color: '#FFFFFF' },
  statRow: { flexDirection: 'row', gap: 12, marginTop: 12 },
  statBox: {
    flex: 1,
    padding: 14,
    borderRadius: RADII.xl,
    backgroundColor: UI.card,
    borderWidth: 1,
    borderColor: UI.border,
  },
  statBoxLabel: { fontSize: 12, fontFamily: FONTS.body, color: UI.muted },
  statBoxValue: { fontSize: 18, fontFamily: FONTS.displayBold, color: '#FFFFFF', marginTop: 4 },
  footnote: {
    fontSize: 12.5,
    fontFamily: FONTS.body,
    color: UI.muted,
    textAlign: 'center',
    marginTop: 14,
    lineHeight: 18,
    paddingHorizontal: 10,
  },
  footnoteTop: { fontSize: 13.5, fontFamily: FONTS.body, color: UI.muted, lineHeight: 19, marginTop: 6 },

  // time limit
  introIcon: {
    width: 56,
    height: 56,
    borderRadius: 18,
    backgroundColor: 'rgba(110,168,255,0.14)',
    alignItems: 'center',
    justifyContent: 'center',
    alignSelf: 'center',
    marginTop: 12,
  },
  bigTitle: {
    fontSize: 22,
    fontFamily: FONTS.displayBold,
    color: '#FFFFFF',
    textAlign: 'center',
    marginTop: 14,
    letterSpacing: -0.3,
  },
  bigSub: {
    fontSize: 13.5,
    fontFamily: FONTS.body,
    color: UI.muted,
    textAlign: 'center',
    lineHeight: 20,
    marginTop: 8,
    paddingHorizontal: 12,
  },
  presetRow: { flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'center', gap: 8, marginTop: 22 },
  presetChip: {
    paddingHorizontal: 16,
    paddingVertical: 8,
    borderRadius: 999,
    backgroundColor: UI.card,
    borderWidth: 1,
    borderColor: UI.border,
  },
  presetChipOn: { backgroundColor: 'rgba(124,92,255,0.22)', borderColor: COLORS.violet },
  presetText: { fontSize: 13.5, fontFamily: FONTS.bodySemiBold, color: UI.muted },
  presetTextOn: { color: '#FFFFFF' },
  spinRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 14,
    marginTop: 22,
    paddingVertical: 14,
    borderRadius: RADII.xl,
    backgroundColor: UI.card,
    borderWidth: 1,
    borderColor: UI.border,
  },
  spinCol: { alignItems: 'center', gap: 6, minWidth: 90 },
  spinBtn: {
    width: 40,
    height: 34,
    borderRadius: 12,
    backgroundColor: 'rgba(255,255,255,0.07)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  spinValue: {
    fontSize: 44,
    fontFamily: FONTS.displayBold,
    color: '#FFFFFF',
    letterSpacing: -1,
    includeFontPadding: false,
  } as any,
  spinUnit: { fontSize: 12, fontFamily: FONTS.body, color: UI.muted },
  spinColon: { fontSize: 38, fontFamily: FONTS.displayBold, color: UI.faint, marginBottom: 18 },

  primaryBtn: {
    marginTop: 16,
    height: 50,
    borderRadius: RADII.full,
    backgroundColor: COLORS.violet,
    alignItems: 'center',
    justifyContent: 'center',
  },
  primaryBtnText: { color: '#FFFFFF', fontSize: 15, fontFamily: FONTS.bodySemiBold, letterSpacing: 0.2 },
  btnRow: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  dangerLink: { alignItems: 'center', paddingVertical: 14 },
  dangerLinkText: { color: COLORS.danger, fontSize: 14, fontFamily: FONTS.bodySemiBold },
  flashText: { textAlign: 'center', color: UI.muted, fontSize: 13, fontFamily: FONTS.body, marginTop: 14 },

  // generic cards
  centerCard: {
    alignItems: 'center',
    gap: 8,
    marginTop: 24,
    padding: 28,
    borderRadius: RADII.xl,
    backgroundColor: UI.card,
    borderWidth: 1,
    borderColor: UI.border,
  },
  centerTitle: { fontSize: 17, fontFamily: FONTS.displayBold, color: '#FFFFFF', marginTop: 6 },
  centerSub: { fontSize: 13.5, fontFamily: FONTS.body, color: UI.muted, textAlign: 'center', lineHeight: 19 },
  pillIcon: {
    width: 54,
    height: 54,
    borderRadius: 27,
    backgroundColor: 'rgba(255,255,255,0.06)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  skeletonRow: { height: 56, borderRadius: 14, backgroundColor: 'rgba(255,255,255,0.06)' },
  infoCard: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    marginTop: 8,
    padding: 14,
    borderRadius: RADII.xl,
    backgroundColor: UI.card,
    borderWidth: 1,
    borderColor: UI.border,
  },

  // verification form
  rejectBanner: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    padding: 12,
    borderRadius: 14,
    backgroundColor: 'rgba(239,68,68,0.10)',
    borderWidth: 1,
    borderColor: 'rgba(239,68,68,0.25)',
  },
  rejectText: { flex: 1, color: '#FCA5A5', fontSize: 13, fontFamily: FONTS.body, lineHeight: 18 },
  formCard: {
    padding: 14,
    borderRadius: RADII.xl,
    backgroundColor: UI.card,
    borderWidth: 1,
    borderColor: UI.border,
  },
  fieldLabel: {
    fontSize: 12.5,
    fontFamily: FONTS.bodySemiBold,
    color: UI.muted,
    marginBottom: 6,
    marginTop: 4,
  },
  field: {
    minHeight: 46,
    paddingHorizontal: 14,
    paddingVertical: 10,
    borderRadius: 12,
    backgroundColor: UI.cardAlt,
    borderWidth: 1,
    borderColor: UI.border,
    color: '#FFFFFF',
    fontSize: 14.5,
    fontFamily: FONTS.body,
    marginBottom: 10,
  },
  fieldMultiline: { minHeight: 84, paddingTop: 12 },
  labelRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  counter: { fontSize: 11, fontFamily: FONTS.body, color: UI.faint },
  hint: { textAlign: 'center', fontSize: 12.5, fontFamily: FONTS.body, color: UI.amber },
  selfiePick: {
    alignItems: 'center',
    gap: 6,
    paddingVertical: 24,
    paddingHorizontal: 16,
    borderRadius: 14,
    borderWidth: 1.5,
    borderStyle: 'dashed',
    borderColor: 'rgba(124,92,255,0.5)',
    backgroundColor: 'rgba(124,92,255,0.06)',
  },
  selfiePickTitle: { fontSize: 14, fontFamily: FONTS.bodySemiBold, color: '#FFFFFF', textAlign: 'center' },
  selfiePickSub: { fontSize: 12, fontFamily: FONTS.body, color: UI.muted, textAlign: 'center' },
  selfieWrap: { borderRadius: 14, overflow: 'hidden' },
  selfieImg: { width: '100%', height: 220, backgroundColor: UI.cardAlt },
  selfieChange: {
    position: 'absolute',
    right: 10,
    bottom: 10,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: 12,
    paddingVertical: 7,
    borderRadius: 999,
    backgroundColor: 'rgba(0,0,0,0.65)',
  },
  selfieChangeText: { color: '#FFFFFF', fontSize: 12.5, fontFamily: FONTS.bodySemiBold },

  // blocked
  listCount: { fontSize: 12.5, fontFamily: FONTS.body, color: UI.muted, marginTop: 6, marginBottom: 10, marginLeft: 6 },
  blockedSkeleton: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    padding: 12,
    borderRadius: 14,
    backgroundColor: UI.card,
  },
  blockedSkeletonAvatar: { width: 44, height: 44, borderRadius: 22, backgroundColor: 'rgba(255,255,255,0.07)' },
  blockedSkeletonLine: { height: 12, width: '60%', borderRadius: 6, backgroundColor: 'rgba(255,255,255,0.07)' },
  blockedRow: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingHorizontal: 14, paddingVertical: 10 },
  blockedInfo: { flex: 1, minWidth: 0 },
  blockedName: { fontSize: 14.5, fontFamily: FONTS.bodySemiBold, color: '#FFFFFF', flexShrink: 1 },
  blockedUsername: { fontSize: 12.5, fontFamily: FONTS.body, color: UI.muted, marginTop: 2 },
  unblockBtn: {
    minWidth: 82,
    height: 34,
    paddingHorizontal: 14,
    borderRadius: 10,
    backgroundColor: '#2E2E2E',
    alignItems: 'center',
    justifyContent: 'center',
  },
  unblockBtnText: { color: '#FFFFFF', fontSize: 13, fontFamily: FONTS.bodySemiBold },

  // mentions
  radioCard: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    padding: 14,
    borderRadius: RADII.xl,
    backgroundColor: UI.card,
    borderWidth: 1.5,
    borderColor: UI.border,
  },
  radioCardOn: { borderColor: COLORS.violet, backgroundColor: 'rgba(124,92,255,0.08)' },
  radioTitle: { fontSize: 15, fontFamily: FONTS.bodySemiBold, color: '#FFFFFF' },
  radioDesc: { fontSize: 12.5, fontFamily: FONTS.body, color: UI.muted, marginTop: 3, lineHeight: 17 },
  radioCircle: {
    width: 24,
    height: 24,
    borderRadius: 12,
    borderWidth: 1.5,
    borderColor: 'rgba(255,255,255,0.25)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  radioCircleOn: { backgroundColor: COLORS.violet, borderColor: COLORS.violet },

  // invite
  inviteCard: {
    alignItems: 'center',
    marginTop: 12,
    padding: 22,
    borderRadius: RADII.xl,
    backgroundColor: UI.card,
    borderWidth: 1,
    borderColor: UI.border,
  },
  inviteIcon: {
    width: 62,
    height: 62,
    borderRadius: 20,
    alignItems: 'center',
    justifyContent: 'center',
  },
  inviteTitle: { fontSize: 20, fontFamily: FONTS.displayBold, color: '#FFFFFF', marginTop: 14 },
  inviteSub: { fontSize: 13.5, fontFamily: FONTS.body, color: UI.muted, textAlign: 'center', marginTop: 6 },
  inviteLink: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginTop: 18,
    width: '100%',
    paddingHorizontal: 14,
    height: 46,
    borderRadius: 12,
    backgroundColor: UI.cardAlt,
    borderWidth: 1,
    borderColor: UI.border,
  },
  inviteLinkText: { flex: 1, fontSize: 14.5, fontFamily: FONTS.bodySemiBold, color: '#FFFFFF' },
  inviteBtns: { flexDirection: 'row', gap: 12, marginTop: 12, width: '100%' },
  inviteBtnSecondary: {
    flex: 1,
    height: 46,
    borderRadius: RADII.full,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    backgroundColor: 'rgba(255,255,255,0.09)',
  },
  inviteBtnPrimary: {
    flex: 1,
    height: 46,
    borderRadius: RADII.full,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    backgroundColor: COLORS.violet,
  },
  inviteBtnText: { color: '#FFFFFF', fontSize: 14, fontFamily: FONTS.bodySemiBold },

  // account status
  statusBanner: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    marginTop: 8,
    padding: 14,
    borderRadius: RADII.xl,
    backgroundColor: UI.card,
    borderWidth: 1,
    borderColor: UI.border,
  },
  statusIcon: { width: 44, height: 44, borderRadius: 14, alignItems: 'center', justifyContent: 'center' },
  statusRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    paddingVertical: 14,
  },
  statusRowTitle: { fontSize: 14.5, fontFamily: FONTS.bodyMedium, color: '#FFFFFF' },
  statusValue: { fontSize: 14, fontFamily: FONTS.body, color: UI.muted },
  statusValueLight: { fontSize: 14, fontFamily: FONTS.bodySemiBold, color: '#FFFFFF', textAlign: 'right' },
  infoValueWrap: { alignItems: 'flex-end', flexShrink: 1, marginLeft: 12 },
  infoSub: { fontSize: 11.5, fontFamily: FONTS.body, color: UI.muted, marginTop: 2, textAlign: 'right' },
  statusPill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 999,
  },
  statusPillText: { fontSize: 12, fontFamily: FONTS.bodySemiBold },

  // subscription
  subHero: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 14,
    marginTop: 8,
    padding: 18,
    borderRadius: RADII.xl,
    borderWidth: 1,
    borderColor: 'rgba(167,139,250,0.3)',
    overflow: 'hidden',
  },
  premiumIconBig: {
    width: 52,
    height: 52,
    borderRadius: 16,
    backgroundColor: 'rgba(124,92,255,0.6)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  subHeroTitle: { fontSize: 22, fontFamily: FONTS.displayBold, color: '#FFFFFF' },
  subHeroSub: { fontSize: 13, fontFamily: FONTS.body, color: 'rgba(255,255,255,0.7)', marginTop: 2 },
  soonPill: { paddingHorizontal: 10, paddingVertical: 4, borderRadius: 999, backgroundColor: 'rgba(255,255,255,0.14)' },
  soonPillText: { fontSize: 11.5, fontFamily: FONTS.bodySemiBold, color: '#FFFFFF' },
  featureRow: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingHorizontal: 14, paddingVertical: 13 },
  featureIcon: {
    width: 32,
    height: 32,
    borderRadius: 10,
    backgroundColor: 'rgba(183,156,255,0.14)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  featureText: { flex: 1, fontSize: 14.5, fontFamily: FONTS.bodyMedium, color: '#FFFFFF' },
  costCard: {
    flexDirection: 'row',
    alignItems: 'baseline',
    justifyContent: 'center',
    gap: 8,
    paddingVertical: 20,
    borderRadius: RADII.xl,
    backgroundColor: UI.card,
    borderWidth: 1,
    borderColor: UI.border,
  },
  costValue: { fontSize: 38, fontFamily: FONTS.displayBold, color: '#FFFFFF', letterSpacing: -1 },
  costUnit: { fontSize: 14, fontFamily: FONTS.body, color: UI.muted },

  // dialog
  dialogBackdrop: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.6)',
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 24,
  },
  dialogCard: {
    width: '100%',
    maxWidth: 330,
    backgroundColor: '#14161E',
    borderRadius: 20,
    paddingTop: 22,
    paddingBottom: 14,
    paddingHorizontal: 12,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.09)',
  },
  dialogIconWrap: {
    width: 52,
    height: 52,
    borderRadius: 26,
    alignItems: 'center',
    justifyContent: 'center',
    alignSelf: 'center',
    marginBottom: 12,
  },
  dialogTitle: { fontSize: 17, fontFamily: FONTS.displayBold, color: '#FFFFFF', textAlign: 'center', marginBottom: 6 },
  dialogSub: {
    fontSize: 13.5,
    fontFamily: FONTS.body,
    color: COLORS.mistLight,
    textAlign: 'center',
    lineHeight: 19,
    marginBottom: 16,
    paddingHorizontal: 10,
  },
  dialogButtons: { flexDirection: 'row', gap: 10, paddingHorizontal: 6 },
  dialogBtnSecondary: {
    flex: 1,
    paddingVertical: 12,
    borderRadius: 12,
    backgroundColor: 'rgba(255,255,255,0.07)',
    alignItems: 'center',
  },
  dialogBtnSecondaryText: { fontSize: 14, fontFamily: FONTS.bodySemiBold, color: COLORS.mistLight },
  dialogBtn: { flex: 1, paddingVertical: 12, borderRadius: 12, alignItems: 'center' },
  dialogBtnText: { fontSize: 14, fontFamily: FONTS.bodySemiBold, color: '#FFFFFF' },
});
