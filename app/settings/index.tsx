// app/settings/index.tsx
// Settings screen — profile, privacy, account options, appearance, verification

import { useEffect, useState, useCallback, useMemo } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  TouchableOpacity,
  Alert,
  ActivityIndicator,
  Share,
  Linking,
  TextInput,
  Modal,
  Image as RNImage,
  Platform,
  KeyboardAvoidingView,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { LinearGradient } from 'expo-linear-gradient';
import AsyncStorage from '@react-native-async-storage/async-storage';
import * as ImagePicker from 'expo-image-picker';
import { COLORS, FONTS, RADII, SPACING } from '../../constants/theme';
import { supabase } from '../../lib/supabase';
import Avatar from '../../components/Avatar';
import VerifiedBadge from '../../components/VerifiedBadge';

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
  | 'subscription'
  | 'appearance';

const INVITE_URL = 'https://airalance.com';
const INVITE_LABEL = 'Airalance.com';
const VERIFICATION_BUCKET = 'verification-docs';
const CHAT_THEME_KEY = (uid: string) => `airalance-chat-theme:${uid}`;
const USAGE_KEY = (uid: string) => `airalance-usage:${uid}`;
const USAGE_LIMIT_KEY = (uid: string) => `airalance-timelimit:${uid}`;

const CHAT_THEMES = [
  { id: 'default', name: 'Default', bg: '#0A0C12', bubble: '#7C5CFF', incoming: '#171A24', accent: '#7C5CFF' },
  { id: 'ocean',   name: 'Ocean',   bg: '#0C2140', bubble: '#2F6BFF', incoming: '#14284A', accent: '#4F8DFF' },
  { id: 'forest',  name: 'Forest',  bg: '#0B2B22', bubble: '#0F9E69', incoming: '#12332A', accent: '#1FBF83' },
  { id: 'sunset',  name: 'Sunset',  bg: '#3A1430', bubble: '#E63E69', incoming: '#36192F', accent: '#F2664F' },
  { id: 'midnight',name: 'Midnight',bg: '#0A0B10', bubble: '#2C303C', incoming: '#14151B', accent: '#8B93A7' },
];

const AIRA_ONE_FEATURES = ['Regional Languages', 'Priority Access', 'Support 24/7', 'Ads Free in News Feed'];
const ACCOUNT_STATUS_ITEMS = [
  { id: 'messaging', title: 'Messaging restrictions', ok: true },
  { id: 'features', title: 'Feature restrictions', ok: true },
  { id: 'shadowban', title: 'Shadowban', ok: true },
  { id: 'locked', title: 'Account locked', ok: true },
];

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
  return ['sudhakarin', 'tanushree2251', 'airalance', 'shikhamishra', 'manjumishra']
    .includes((p.username || '').toLowerCase());
}

export default function SettingsScreen() {
  const router = useRouter();
  const [profile, setProfile] = useState<Profile | null>(null);
  const [loading, setLoading] = useState(true);
  const [screen, setScreen] = useState<ScreenId>('home');

  const [chatThemeId, setChatThemeId] = useState('default');

  useEffect(() => {
    async function load() {
      const { data: authData } = await supabase.auth.getUser();
      if (!authData.user) { setLoading(false); return; }
      const { data } = await supabase.from('profiles').select('*').eq('id', authData.user.id).single();
      setProfile(data as Profile);

      // Load saved chat theme
      try {
        const saved = await AsyncStorage.getItem(CHAT_THEME_KEY(authData.user.id));
        if (saved) setChatThemeId(saved);
      } catch {}

      setLoading(false);
    }
    load();
  }, []);

  async function handleLogout() {
    Alert.alert('Log out', 'Are you sure you want to log out?', [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Log out', style: 'destructive',
        onPress: async () => {
          if (profile?.id) {
            try {
              await AsyncStorage.removeItem(USAGE_KEY(profile.id));
              await AsyncStorage.removeItem(CHAT_THEME_KEY(profile.id));
            } catch {}
          }
          await supabase.auth.signOut();
          router.replace('/(auth)/login');
        },
      },
    ]);
  }

  async function changeChatTheme(id: string) {
    if (!profile?.id) return;
    setChatThemeId(id);
    try { await AsyncStorage.setItem(CHAT_THEME_KEY(profile.id), id); } catch {}
  }

  const titles: Record<ScreenId, string> = {
    home: 'Settings',
    time: 'Time management',
    timelimit: 'Time limit',
    verify: 'Request verification',
    blocked: 'Blocked',
    mentions: 'Tag & mention',
    invite: 'Invite friends',
    account: 'Account status',
    subscription: 'Aira One',
    appearance: 'Appearance',
  };

  function goBack() {
    if (screen === 'home') router.back();
    else if (screen === 'timelimit') setScreen('time');
    else setScreen('home');
  }

  if (loading) {
    return (
      <SafeAreaView style={styles.safe} edges={['top']}>
        <View style={styles.loadingWrap}>
          <ActivityIndicator color={COLORS.violet} />
        </View>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      <View style={styles.header}>
        <TouchableOpacity style={styles.headerBtn} onPress={goBack} activeOpacity={0.7}>
          <Ionicons name="chevron-back" size={24} color={COLORS.text} />
        </TouchableOpacity>
        <Text style={styles.headerTitle}>{titles[screen]}</Text>
        <View style={{ width: 40 }} />
      </View>

      <ScrollView
        contentContainerStyle={styles.scroll}
        showsVerticalScrollIndicator={false}
        keyboardShouldPersistTaps="handled"
      >
        {screen === 'home' && profile && (
          <HomePanel
            profile={profile}
            onOpen={setScreen}
            onLogout={handleLogout}
          />
        )}

        {screen === 'time' && profile && (
          <TimeManagementPanel
            userId={profile.id}
            onOpenLimit={() => setScreen('timelimit')}
          />
        )}

        {screen === 'timelimit' && profile && <TimeLimitPanel userId={profile.id} />}

        {screen === 'verify' && profile && (
          <VerificationPanel
            profile={profile}
            verified={isVerifiedUser(profile)}
          />
        )}

        {screen === 'blocked' && profile && <BlockedPanel myId={profile.id} />}

        {screen === 'mentions' && profile && (
          <MentionPrivacyPanel
            profile={profile}
            onSaved={(v) => setProfile((prev) => (prev ? { ...prev, mention_privacy: v } : prev))}
          />
        )}

        {screen === 'invite' && profile && <InvitePanel username={profile.username} />}

        {screen === 'account' && profile && <AccountStatusPanel profile={profile} />}

        {screen === 'subscription' && <SubscriptionPanel />}

        {screen === 'appearance' && (
          <AppearancePanel chatThemeId={chatThemeId} onChange={changeChatTheme} />
        )}
      </ScrollView>
    </SafeAreaView>
  );
}

/* ================= HOME ================= */

function HomePanel({
  profile,
  onOpen,
  onLogout,
}: {
  profile: Profile;
  onOpen: (s: ScreenId) => void;
  onLogout: () => void;
}) {
  const verified = isVerifiedUser(profile);

  return (
    <>
      <View style={styles.userCard}>
        <Avatar name={profile.display_name} color={profile.avatar_color} avatarUrl={profile.avatar_url} size={58} />
        <View style={styles.userInfo}>
          <View style={styles.userNameRow}>
            <Text style={styles.userName} numberOfLines={1}>{profile.display_name}</Text>
            {verified && <VerifiedBadge size={16} />}
          </View>
          <Text style={styles.userUsername}>@{profile.username}</Text>
        </View>
      </View>

      <SectionTitle>How you use Airalance</SectionTitle>
      <SettingsGroup>
        <SettingsRow
          icon="time-outline" tint="#6EA8FF"
          title="Time management" subtitle="See how much time you spend"
          onPress={() => onOpen('time')}
        />
        <Divider />
        <SettingsRow
          icon="color-palette-outline" tint="#FFB067"
          title="Appearance" subtitle="Chat theme and wallpaper"
          onPress={() => onOpen('appearance')}
        />
      </SettingsGroup>

      <SectionTitle>Privacy</SectionTitle>
      <SettingsGroup>
        <SettingsRow
          icon="at-outline" tint="#B79CFF"
          title="Tag & mention"
          subtitle={
            profile.mention_privacy === 'everyone'
              ? 'Anyone can tag you'
              : 'Only connections can tag you'
          }
          onPress={() => onOpen('mentions')}
        />
        <Divider />
        <SettingsRow
          icon="ban-outline" tint="#FF8A8A"
          title="Blocked" subtitle="Accounts you've blocked"
          onPress={() => onOpen('blocked')}
        />
      </SettingsGroup>

      <SectionTitle>Account</SectionTitle>
      <SettingsGroup>
        <SettingsRow
          icon="checkmark-circle-outline" tint="#3EE0C4"
          title="Request verification"
          subtitle={verified ? 'Your account is verified' : 'Apply for the verified badge'}
          onPress={() => onOpen('verify')}
        />
        <Divider />
        <SettingsRow
          icon="shield-checkmark-outline" tint="#4ADE9A"
          title="Account status" subtitle="Check your account's standing"
          onPress={() => onOpen('account')}
        />
        <Divider />
        <SettingsRow
          icon="person-add-outline" tint="#FFC857"
          title="Invite friends" subtitle="Share Airalance with your friends"
          onPress={() => onOpen('invite')}
        />
      </SettingsGroup>

      <SectionTitle>Subscription</SectionTitle>
      <TouchableOpacity style={styles.premiumCard} activeOpacity={0.85} onPress={() => onOpen('subscription')}>
        <LinearGradient
          colors={['rgba(167,139,250,0.22)', 'rgba(244,96,122,0.10)']}
          start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }}
          style={styles.premiumCardInner}
        >
          <View style={styles.premiumIcon}>
            <Ionicons name="sparkles" size={20} color="#FFFFFF" />
          </View>
          <View style={{ flex: 1 }}>
            <Text style={styles.premiumTitle}>Aira One</Text>
            <Text style={styles.premiumSub}>Unsubscribed</Text>
          </View>
          <Ionicons name="chevron-forward" size={18} color="rgba(255,255,255,0.5)" />
        </LinearGradient>
      </TouchableOpacity>

      <TouchableOpacity style={styles.logoutBtn} onPress={onLogout} activeOpacity={0.85}>
        <Text style={styles.logoutText}>Log out</Text>
      </TouchableOpacity>

      <Text style={styles.version}>Airalance v1.0.0</Text>
    </>
  );
}

/* ================= TIME MANAGEMENT ================= */

function TimeManagementPanel({ userId, onOpenLimit }: { userId: string; onOpenLimit: () => void }) {
  const [data, setData] = useState<Record<string, number>>({});
  const [limit, setLimit] = useState<number | null>(null);
  const [selected, setSelected] = useState(6);

  useEffect(() => {
    let mounted = true;
    async function load() {
      try {
        const raw = await AsyncStorage.getItem(USAGE_KEY(userId));
        const parsed = raw ? JSON.parse(raw) : {};
        if (mounted) setData(parsed);
        const lim = await AsyncStorage.getItem(USAGE_LIMIT_KEY(userId));
        if (mounted) setLimit(lim ? Number(lim) : null);
      } catch {}
    }
    load();
    const interval = setInterval(load, 15000);
    return () => { mounted = false; clearInterval(interval); };
  }, [userId]);

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
  const yMax = Math.max(...days.map((d) => d.secs), 900);
  const sel = days[selected];
  const selLabel = selected === 6
    ? 'Today'
    : sel.date.toLocaleDateString(undefined, { weekday: 'long', day: 'numeric', month: 'short' });

  return (
    <View>
      <View style={styles.timeCard}>
        <Text style={styles.timeCardLabel}>Daily average</Text>
        <Text style={styles.timeCardValue}>{formatUsageDuration(avg)}</Text>

        <View style={styles.chart}>
          {days.map((d, i) => {
            const pct = yMax > 0 ? (d.secs / yMax) * 100 : 0;
            const isSel = i === selected;
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
                      height: d.secs > 0 ? `${Math.max(pct, 3)}%` : 3,
                      backgroundColor: isSel ? COLORS.violet : 'rgba(124,92,255,0.4)',
                    },
                  ]}
                />
              </TouchableOpacity>
            );
          })}
        </View>
        <View style={styles.chartLabels}>
          {days.map((d, i) => (
            <Text key={d.key} style={[styles.chartLabel, i === selected && styles.chartLabelActive]}>
              {d.date.toLocaleDateString(undefined, { weekday: 'short' })}
            </Text>
          ))}
        </View>

        <View style={styles.selDayRow}>
          <Text style={styles.selDayLabel}>{selLabel}</Text>
          <Text style={styles.selDayValue}>{formatUsageDuration(sel.secs)}</Text>
        </View>
      </View>

      <SectionTitle>Limits</SectionTitle>
      <SettingsGroup>
        <SettingsRow
          icon="timer-outline" tint="#6EA8FF"
          title="Time Limit"
          subtitle="Get a reminder when you reach your daily limit"
          value={limit ? formatUsageDuration(limit * 60) : 'Off'}
          onPress={onOpenLimit}
        />
      </SettingsGroup>

      <Text style={styles.footnote}>Time is counted while Airalance is open on this device.</Text>
    </View>
  );
}

/* ================= TIME LIMIT ================= */

function TimeLimitPanel({ userId }: { userId: string }) {
  const [savedLimit, setSavedLimit] = useState<number | null>(null);
  const [hours, setHours] = useState(1);
  const [mins, setMins] = useState(0);
  const [justSaved, setJustSaved] = useState(false);

  useEffect(() => {
    (async () => {
      try {
        const raw = await AsyncStorage.getItem(USAGE_LIMIT_KEY(userId));
        const n = raw ? Number(raw) : null;
        if (n && n > 0) {
          setSavedLimit(n);
          setHours(Math.floor(n / 60));
          setMins(n % 60);
        }
      } catch {}
    })();
  }, [userId]);

  useEffect(() => {
    if (!justSaved) return;
    const t = setTimeout(() => setJustSaved(false), 1800);
    return () => clearTimeout(t);
  }, [justSaved]);

  const totalMinutes = hours * 60 + mins;
  const dirty = totalMinutes > 0 && totalMinutes !== savedLimit;

  async function save() {
    if (!dirty) return;
    await AsyncStorage.setItem(USAGE_LIMIT_KEY(userId), String(totalMinutes));
    setSavedLimit(totalMinutes);
    setJustSaved(true);
  }

  async function remove() {
    await AsyncStorage.removeItem(USAGE_LIMIT_KEY(userId));
    setSavedLimit(null);
    setHours(1);
    setMins(0);
  }

  return (
    <View>
      <Text style={styles.bigTitle}>Make your time count</Text>
      <Text style={styles.bigSub}>
        Screen time isn&apos;t only about how long you spend. It&apos;s about what matters to you when you&apos;re online.
      </Text>

      <View style={styles.hoursRow}>
        <View style={styles.hoursCol}>
          <TouchableOpacity style={styles.spinBtn} onPress={() => setHours((h) => Math.min(23, h + 1))}>
            <Ionicons name="chevron-up" size={22} color="#fff" />
          </TouchableOpacity>
          <Text style={styles.hoursValue}>{String(hours).padStart(2, '0')}</Text>
          <TouchableOpacity style={styles.spinBtn} onPress={() => setHours((h) => Math.max(0, h - 1))}>
            <Ionicons name="chevron-down" size={22} color="#fff" />
          </TouchableOpacity>
          <Text style={styles.hoursLabel}>hours</Text>
        </View>

        <View style={styles.hoursCol}>
          <TouchableOpacity style={styles.spinBtn} onPress={() => setMins((m) => (m + 5) % 60)}>
            <Ionicons name="chevron-up" size={22} color="#fff" />
          </TouchableOpacity>
          <Text style={styles.hoursValue}>{String(mins).padStart(2, '0')}</Text>
          <TouchableOpacity style={styles.spinBtn} onPress={() => setMins((m) => (m - 5 + 60) % 60)}>
            <Ionicons name="chevron-down" size={22} color="#fff" />
          </TouchableOpacity>
          <Text style={styles.hoursLabel}>min</Text>
        </View>
      </View>

      <Text style={styles.footnote}>
        You&apos;ll see a reminder when you reach this time each day.
      </Text>

      <TouchableOpacity
        style={[styles.primaryBtn, (!dirty && !justSaved) && { opacity: 0.5 }]}
        onPress={save}
        disabled={!dirty}
        activeOpacity={0.85}
      >
        {justSaved ? (
          <View style={styles.btnRow}>
            <Ionicons name="checkmark" size={16} color="#fff" />
            <Text style={styles.primaryBtnText}>Saved</Text>
          </View>
        ) : (
          <Text style={styles.primaryBtnText}>Save time limit</Text>
        )}
      </TouchableOpacity>

      {savedLimit !== null && (
        <TouchableOpacity style={styles.dangerLink} onPress={remove} activeOpacity={0.7}>
          <Text style={styles.dangerLinkText}>Remove limit</Text>
        </TouchableOpacity>
      )}
    </View>
  );
}

/* ================= VERIFICATION ================= */

function VerificationPanel({ profile, verified }: { profile: Profile; verified: boolean }) {
  const [requestStatus, setRequestStatus] = useState<'loading' | 'none' | 'pending' | 'rejected'>('loading');
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
    return () => { cancelled = true; };
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
  const canSubmit =
    name.trim().length >= 2 &&
    Number.isInteger(ageNum) && ageNum >= 13 && ageNum <= 120 &&
    nationality.trim().length >= 2 &&
    !!selfieUri;

  async function submit() {
    if (!canSubmit || !selfieUri || submitting) return;
    setSubmitting(true);
    try {
      const path = `${profile.id}/verification-${Date.now()}.jpg`;
      const arrayBuffer = await fetch(selfieUri).then((r) => r.arrayBuffer());
      const { error: uploadError } = await supabase.storage
        .from(VERIFICATION_BUCKET)
        .upload(path, arrayBuffer, { cacheControl: '3600', upsert: false, contentType: 'image/jpeg' });
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
        <Text style={styles.centerTitle}>You&apos;re verified</Text>
        <Text style={styles.centerSub}>Your account already has the verified badge.</Text>
      </View>
    );
  }

  if (requestStatus === 'loading') {
    return (
      <View style={{ gap: 12 }}>
        {[0, 1, 2, 3].map((i) => <View key={i} style={styles.skeletonRow} />)}
      </View>
    );
  }

  if (requestStatus === 'pending') {
    return (
      <View style={styles.centerCard}>
        <View style={styles.pillIcon}>
          <Ionicons name="time-outline" size={24} color={COLORS.violet} />
        </View>
        <Text style={styles.centerTitle}>Request submitted</Text>
        <Text style={styles.centerSub}>Your verification request is under review.</Text>
      </View>
    );
  }

  return (
    <View style={{ gap: 16 }}>
      <View style={styles.infoCard}>
        <View style={[styles.rowIcon, { backgroundColor: '#3EE0C4' }]}>
          <Ionicons name="badge-outline" size={20} color="#fff" />
        </View>
        <View style={{ flex: 1, marginLeft: 12 }}>
          <Text style={styles.rowTitle}>Get verified</Text>
          <Text style={styles.rowSubtitle}>Fill in details and add a selfie with your ID.</Text>
        </View>
      </View>

      {requestStatus === 'rejected' && (
        <View style={styles.rejectBanner}>
          <Text style={styles.rejectText}>Your last request wasn&apos;t approved. You can submit a new one.</Text>
        </View>
      )}

      <FieldLabel text="Full name" />
      <TextInput style={styles.field} value={name} onChangeText={setName} placeholder="Your full name" placeholderTextColor="rgba(255,255,255,0.3)" />

      <FieldLabel text="Age" />
      <TextInput
        style={styles.field}
        value={age}
        onChangeText={(v) => setAge(v.replace(/\D/g, '').slice(0, 3))}
        placeholder="Your age"
        placeholderTextColor="rgba(255,255,255,0.3)"
        keyboardType="number-pad"
      />

      <FieldLabel text="Selfie with document" />
      {selfieUri ? (
        <View style={styles.selfieWrap}>
          <RNImage source={{ uri: selfieUri }} style={styles.selfieImg} />
          <TouchableOpacity style={styles.selfieChange} onPress={pickSelfie}>
            <Text style={styles.selfieChangeText}>Change photo</Text>
          </TouchableOpacity>
        </View>
      ) : (
        <TouchableOpacity style={styles.selfiePick} onPress={pickSelfie} activeOpacity={0.85}>
          <Ionicons name="camera-outline" size={26} color={COLORS.violet} />
          <Text style={styles.selfiePickTitle}>Add a selfie holding your document</Text>
          <Text style={styles.selfiePickSub}>Your face and the document must both be clearly visible.</Text>
        </TouchableOpacity>
      )}

      <FieldLabel text="Nationality" />
      <TextInput style={styles.field} value={nationality} onChangeText={setNationality} placeholder="Your nationality" placeholderTextColor="rgba(255,255,255,0.3)" />

      <FieldLabel text="About (optional)" />
      <TextInput
        style={[styles.field, styles.fieldMultiline]}
        value={about}
        onChangeText={setAbout}
        placeholder="Tell us why your account should be verified"
        placeholderTextColor="rgba(255,255,255,0.3)"
        multiline
        maxLength={500}
      />

      <FieldLabel text="Links (optional)" />
      <TextInput
        style={[styles.field, styles.fieldMultiline]}
        value={links}
        onChangeText={setLinks}
        placeholder="Website or social profiles, one per line"
        placeholderTextColor="rgba(255,255,255,0.3)"
        multiline
        maxLength={500}
      />

      {canSubmit && (
        <TouchableOpacity style={styles.primaryBtn} onPress={submit} disabled={submitting} activeOpacity={0.85}>
          {submitting ? (
            <ActivityIndicator color="#fff" />
          ) : (
            <Text style={styles.primaryBtnText}>Submit request</Text>
          )}
        </TouchableOpacity>
      )}
    </View>
  );
}

/* ================= BLOCKED ================= */

function BlockedPanel({ myId }: { myId: string }) {
  const [people, setPeople] = useState<Profile[] | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const { data: rows, error } = await supabase
        .from('blocked_users').select('blocked_id').eq('blocker_id', myId);
      if (cancelled) return;
      if (error || !rows || rows.length === 0) { setPeople([]); return; }
      const ids = rows.map((r: any) => r.blocked_id);
      const { data: profs } = await supabase.from('profiles').select('*').in('id', ids);
      if (!cancelled) setPeople((profs ?? []) as Profile[]);
    })();
    return () => { cancelled = true; };
  }, [myId]);

  async function unblock(target: Profile) {
    if (busyId) return;
    setBusyId(target.id);
    const { error } = await supabase
      .from('blocked_users').delete()
      .eq('blocker_id', myId).eq('blocked_id', target.id);
    setBusyId(null);
    if (error) { Alert.alert('Error', 'Could not unblock. Try again.'); return; }
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

  if (people.length === 0) {
    return (
      <View style={styles.centerCard}>
        <View style={styles.pillIcon}>
          <Ionicons name="ban-outline" size={24} color="rgba(255,255,255,0.6)" />
        </View>
        <Text style={styles.centerTitle}>No blocked accounts</Text>
        <Text style={styles.centerSub}>People you block will show up here.</Text>
      </View>
    );
  }

  return (
    <View>
      {people.map((p) => (
        <View key={p.id} style={styles.blockedRow}>
          <Avatar name={p.display_name} color={p.avatar_color} avatarUrl={p.avatar_url} size={44} />
          <View style={styles.blockedInfo}>
            <View style={styles.userNameRow}>
              <Text style={styles.blockedName} numberOfLines={1}>{p.display_name}</Text>
              {isVerifiedUser(p) && <VerifiedBadge size={14} />}
            </View>
            <Text style={styles.blockedUsername} numberOfLines={1}>@{p.username}</Text>
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
      ))}
    </View>
  );
}

/* ================= MENTION PRIVACY ================= */

function MentionPrivacyPanel({
  profile,
  onSaved,
}: {
  profile: Profile;
  onSaved: (v: 'connections' | 'everyone') => void;
}) {
  const [value, setValue] = useState<'connections' | 'everyone' | null>(
    profile.mention_privacy ?? null
  );
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (value !== null) return;
    (async () => {
      const { data } = await supabase
        .from('profiles').select('mention_privacy').eq('id', profile.id).maybeSingle();
      const v = (data as any)?.mention_privacy;
      setValue(v === 'everyone' ? 'everyone' : 'connections');
    })();
  }, [profile.id, value]);

  async function choose(next: 'connections' | 'everyone') {
    if (saving || next === value) return;
    const prev = value;
    setValue(next);
    setSaving(true);
    const { error } = await supabase
      .from('profiles').update({ mention_privacy: next }).eq('id', profile.id);
    setSaving(false);
    if (error) {
      setValue(prev);
      Alert.alert('Error', 'Could not save your choice. Try again.');
      return;
    }
    onSaved(next);
  }

  const options: { id: 'connections' | 'everyone'; title: string; desc: string }[] = [
    { id: 'connections', title: 'Only connections', desc: "Only people you're connected with can tag or mention you." },
    { id: 'everyone', title: 'Everyone', desc: 'Anyone on Airalance can tag or mention you.' },
  ];

  if (value === null) {
    return (
      <View style={{ gap: 12 }}>
        {[0, 1].map((i) => <View key={i} style={styles.skeletonRow} />)}
      </View>
    );
  }

  return (
    <View>
      <Text style={styles.footnote}>Choose who can tag or mention you in their status.</Text>
      <View style={{ gap: 12, marginTop: 12 }}>
        {options.map((o) => {
          const on = value === o.id;
          return (
            <TouchableOpacity
              key={o.id}
              style={[styles.radioCard, on && styles.radioCardOn]}
              onPress={() => choose(o.id)}
              activeOpacity={0.85}
            >
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
    // RN doesn't have clipboard in core; Share is the reliable fallback.
    // If @react-native-clipboard/clipboard is installed, use it here.
    setCopied(true);
    setTimeout(() => setCopied(false), 1800);
    shareLink();
  }

  return (
    <View style={styles.inviteCard}>
      <View style={styles.inviteIcon}>
        <Ionicons name="person-add" size={26} color="#fff" />
      </View>
      <Text style={styles.inviteTitle}>Invite your friends</Text>
      <Text style={styles.inviteSub}>Share this link and bring them to Airalance.</Text>

      <View style={styles.inviteLink}>
        <Text style={styles.inviteLinkText}>{INVITE_LABEL}</Text>
      </View>

      <View style={{ flexDirection: 'row', gap: 12, marginTop: 12, width: '100%' }}>
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
  const allGood = ACCOUNT_STATUS_ITEMS.every((i) => i.ok);
  const created = profile.created_at
    ? new Date(profile.created_at).toLocaleDateString()
    : '—';

  return (
    <View>
      <View style={styles.statusBanner}>
        <View style={[styles.statusIcon, { backgroundColor: allGood ? 'rgba(16,185,129,0.15)' : 'rgba(239,68,68,0.15)' }]}>
          <Ionicons
            name={allGood ? 'shield-checkmark' : 'alert'}
            size={20}
            color={allGood ? '#34D399' : '#F87171'}
          />
        </View>
        <View style={{ flex: 1, marginLeft: 12 }}>
          <Text style={styles.rowTitle}>{allGood ? 'Everything looks good' : 'Account needs attention'}</Text>
          <Text style={styles.rowSubtitle}>
            {allGood ? 'Your account is in good standing.' : 'Some features are limited.'}
          </Text>
        </View>
      </View>

      <View style={[styles.group, { marginTop: 16 }]}>
        {ACCOUNT_STATUS_ITEMS.map((item, i) => (
          <View key={item.id}>
            {i > 0 && <Divider />}
            <View style={styles.statusRow}>
              <Text style={styles.statusRowTitle}>{item.title}</Text>
              <View style={[styles.statusTick, {
                borderColor: item.ok ? '#34D399' : '#F87171',
              }]}>
                <Ionicons name={item.ok ? 'checkmark' : 'alert'} size={13} color={item.ok ? '#34D399' : '#F87171'} />
              </View>
            </View>
          </View>
        ))}
      </View>

      <View style={styles.infoBlock}>
        <Text style={styles.infoBlockRow}>Username: @{profile.username}</Text>
        <Text style={styles.infoBlockRow}>Member since: {created}</Text>
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
        colors={['rgba(124,92,255,0.28)', 'rgba(244,96,122,0.14)']}
        start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }}
        style={styles.subHero}
      >
        <View style={styles.premiumIconBig}>
          <Ionicons name="sparkles" size={26} color="#fff" />
        </View>
        <View style={{ flex: 1, marginLeft: 14 }}>
          <Text style={styles.subHeroTitle}>Aira One</Text>
          <Text style={styles.subHeroSub}>Unsubscribed</Text>
        </View>
      </LinearGradient>

      <SectionTitle>Features</SectionTitle>
      <SettingsGroup>
        {AIRA_ONE_FEATURES.map((f, i) => (
          <View key={f}>
            {i > 0 && <Divider />}
            <View style={styles.featureRow}>
              <View style={styles.featureCheck}>
                <Ionicons name="checkmark" size={14} color={COLORS.violetLight ?? '#9C82FF'} />
              </View>
              <Text style={styles.featureText}>{f}</Text>
            </View>
          </View>
        ))}
      </SettingsGroup>

      <SectionTitle>Cost</SectionTitle>
      <View style={styles.costCard}>
        <Text style={styles.costValue}>$2</Text>
        <Text style={styles.costUnit}>per month</Text>
      </View>

      <TouchableOpacity style={[styles.primaryBtn, { marginTop: 24 }]} onPress={subscribe} activeOpacity={0.85}>
        <Text style={styles.primaryBtnText}>Subscribe Now</Text>
      </TouchableOpacity>
    </View>
  );
}

/* ================= APPEARANCE ================= */

function AppearancePanel({
  chatThemeId,
  onChange,
}: {
  chatThemeId: string;
  onChange: (id: string) => void;
}) {
  const theme = CHAT_THEMES.find((t) => t.id === chatThemeId) ?? CHAT_THEMES[0];

  return (
    <View>
      <View style={[styles.themePreview, { backgroundColor: theme.bg }]}>
        <View style={[styles.themeHeader, { backgroundColor: theme.bg, borderBottomColor: 'rgba(255,255,255,0.08)' }]}>
          <View style={[styles.themeAvatar, { backgroundColor: theme.bubble }]} />
          <View style={{ marginLeft: 10 }}>
            <Text style={styles.themeHeaderName}>Aira</Text>
            <Text style={styles.themeHeaderSub}>Active now</Text>
          </View>
        </View>

        <View style={styles.themeBody}>
          <View style={[styles.themeBubble, { backgroundColor: theme.incoming, alignSelf: 'flex-start' }]}>
            <Text style={styles.themeBubbleText}>Hey! Are we still on for tonight?</Text>
          </View>
          <View style={[styles.themeBubble, { backgroundColor: theme.bubble, alignSelf: 'flex-end' }]}>
            <Text style={styles.themeBubbleText}>Yes! See you at 8 🎉</Text>
          </View>
          <View style={[styles.themeBubble, { backgroundColor: theme.incoming, alignSelf: 'flex-start' }]}>
            <Text style={styles.themeBubbleText}>Perfect, can&apos;t wait 😄</Text>
          </View>
        </View>

        <View style={[styles.themeComposer, { borderTopColor: 'rgba(255,255,255,0.08)' }]}>
          <View style={styles.themeInput} />
          <View style={[styles.themeSendBtn, { backgroundColor: theme.bubble }]}>
            <Ionicons name="send" size={14} color="#fff" />
          </View>
        </View>
      </View>

      <SectionTitle>Chat theme</SectionTitle>
      <View style={styles.themeGridCard}>
        <View style={styles.themeGrid}>
          {CHAT_THEMES.map((t) => {
            const selected = t.id === theme.id;
            return (
              <TouchableOpacity
                key={t.id}
                style={styles.themeThumbWrap}
                onPress={() => onChange(t.id)}
                activeOpacity={0.85}
              >
                <View
                  style={[
                    styles.themeThumb,
                    { backgroundColor: t.bg },
                    selected && styles.themeThumbSelected,
                  ]}
                >
                  <View style={[styles.themeMiniBubble, { backgroundColor: t.incoming, left: 8, top: 12 }]} />
                  <View style={[styles.themeMiniBubble, { backgroundColor: t.bubble, right: 8, top: '44%' }]} />
                  <View style={[styles.themeMiniBubble, { backgroundColor: t.incoming, left: 8, top: '64%' }]} />
                  {selected && (
                    <View style={styles.themeCheck}>
                      <Ionicons name="checkmark" size={12} color="#fff" />
                    </View>
                  )}
                </View>
                <Text style={[styles.themeName, selected && styles.themeNameActive]}>{t.name}</Text>
              </TouchableOpacity>
            );
          })}
        </View>
      </View>

      <Text style={styles.footnote}>The chat bubble, wallpaper, header and message bar will all change.</Text>
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

function Divider() {
  return <View style={styles.divider} />;
}

function FieldLabel({ text }: { text: string }) {
  return <Text style={styles.fieldLabel}>{text}</Text>;
}

function SettingsRow({
  icon, tint, title, subtitle, value, onPress,
}: {
  icon: any;
  tint: string;
  title: string;
  subtitle?: string;
  value?: string;
  onPress: () => void;
}) {
  return (
    <TouchableOpacity style={styles.row} onPress={onPress} activeOpacity={0.7}>
      <View style={[styles.rowIcon, { backgroundColor: tint }]}>
        <Ionicons name={icon} size={20} color="#FFFFFF" />
      </View>
      <View style={{ flex: 1, minWidth: 0 }}>
        <Text style={styles.rowTitle}>{title}</Text>
        {subtitle && (
          <Text style={styles.rowSubtitle} numberOfLines={1}>{subtitle}</Text>
        )}
      </View>
      {value && <Text style={styles.rowValue}>{value}</Text>}
      <Ionicons name="chevron-forward" size={18} color="rgba(255,255,255,0.3)" />
    </TouchableOpacity>
  );
}

/* ================= STYLES ================= */

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: '#000000' },
  scroll: { paddingBottom: SPACING.xl, paddingHorizontal: 16 },
  loadingWrap: { flex: 1, alignItems: 'center', justifyContent: 'center' },

  header: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    paddingHorizontal: 14, paddingVertical: 12,
  },
  headerBtn: { width: 40, height: 40, borderRadius: 20, alignItems: 'center', justifyContent: 'center' },
  headerTitle: { fontSize: 20, fontFamily: FONTS.displayBold, color: '#FFFFFF' },

  // User card
  userCard: {
    flexDirection: 'row', alignItems: 'center', gap: 12, padding: 16,
    borderRadius: RADII.xl, backgroundColor: '#121212',
    borderWidth: 1, borderColor: '#1F1F23', marginTop: 12,
  },
  userInfo: { flex: 1, minWidth: 0 },
  userNameRow: { flexDirection: 'row', alignItems: 'center' },
  userName: { fontSize: 17, fontFamily: FONTS.bodySemiBold, color: '#FFFFFF', flexShrink: 1 },
  userUsername: { fontSize: 14, fontFamily: FONTS.body, color: COLORS.mist, marginTop: 2 },

  // Section / groups
  sectionTitle: {
    fontSize: 12.5, fontFamily: FONTS.bodySemiBold, color: COLORS.mist,
    textTransform: 'uppercase', letterSpacing: 0.8,
    marginTop: SPACING.lg, marginBottom: SPACING.sm, paddingHorizontal: 4, opacity: 0.75,
  },
  group: {
    backgroundColor: '#121212', borderRadius: RADII.xl,
    borderWidth: 1, borderColor: '#1F1F23', overflow: 'hidden',
  },
  row: {
    flexDirection: 'row', alignItems: 'center', gap: 12,
    paddingHorizontal: 16, paddingVertical: 16,
  },
  rowIcon: {
    width: 40, height: 40, borderRadius: 10,
    alignItems: 'center', justifyContent: 'center',
  },
  rowTitle: { fontSize: 16, fontFamily: FONTS.bodyMedium, color: '#FFFFFF' },
  rowSubtitle: { fontSize: 13, fontFamily: FONTS.body, color: COLORS.mist, marginTop: 2 },
  rowValue: { fontSize: 13, color: COLORS.mist, marginRight: 6 },
  divider: { height: 1, backgroundColor: '#1F1F23', marginLeft: 68 },

  // Premium
  premiumCard: {
    borderRadius: RADII.xl, overflow: 'hidden',
    borderWidth: 1.5, borderColor: 'rgba(167,139,250,0.4)',
  },
  premiumCardInner: { flexDirection: 'row', alignItems: 'center', gap: 12, padding: 16 },
  premiumIcon: {
    width: 46, height: 46, borderRadius: 12,
    backgroundColor: 'rgba(244,96,122,0.6)',
    alignItems: 'center', justifyContent: 'center',
  },
  premiumIconBig: {
    width: 60, height: 60, borderRadius: 16,
    backgroundColor: 'rgba(244,96,122,0.65)',
    alignItems: 'center', justifyContent: 'center',
  },
  premiumTitle: { fontSize: 18, fontFamily: FONTS.displayBold, color: '#FFFFFF' },
  premiumSub: { fontSize: 13, fontFamily: FONTS.body, color: COLORS.mist, marginTop: 2 },

  // Logout
  logoutBtn: {
    marginTop: SPACING.lg, paddingVertical: 16,
    borderRadius: RADII.xl, borderWidth: 1,
    borderColor: 'rgba(239,68,68,0.3)',
    backgroundColor: 'rgba(239,68,68,0.08)',
    alignItems: 'center', justifyContent: 'center',
  },
  logoutText: { color: COLORS.danger, fontSize: 16, fontFamily: FONTS.bodySemiBold },

  version: {
    textAlign: 'center', color: COLORS.mist, fontSize: 12,
    fontFamily: FONTS.body, marginTop: SPACING.lg, opacity: 0.5,
  },

  // Time management
  timeCard: {
    marginTop: 12, padding: 20, borderRadius: RADII.xl,
    backgroundColor: 'rgba(124,92,255,0.10)',
    borderWidth: 1, borderColor: 'rgba(124,92,255,0.25)',
  },
  timeCardLabel: { fontSize: 11, letterSpacing: 1, textTransform: 'uppercase', color: COLORS.mist, fontFamily: FONTS.bodySemiBold },
  timeCardValue: { fontSize: 42, fontFamily: FONTS.displayBold, color: '#fff', marginTop: 4 },
  chart: {
    flexDirection: 'row', alignItems: 'flex-end', gap: 8,
    height: 150, marginTop: 28,
  },
  chartCol: { flex: 1, height: '100%', justifyContent: 'flex-end' },
  chartBar: { width: '100%', borderRadius: 6, minHeight: 3 },
  chartLabels: { flexDirection: 'row', gap: 8, marginTop: 8 },
  chartLabel: { flex: 1, textAlign: 'center', fontSize: 11, color: 'rgba(255,255,255,0.45)' },
  chartLabelActive: { color: '#fff', fontFamily: FONTS.bodySemiBold },
  selDayRow: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    backgroundColor: 'rgba(255,255,255,0.07)', paddingHorizontal: 14, paddingVertical: 12,
    borderRadius: 12, marginTop: 16,
  },
  selDayLabel: { fontSize: 14, color: COLORS.mist, fontFamily: FONTS.body },
  selDayValue: { fontSize: 18, color: '#fff', fontFamily: FONTS.displayBold },

  footnote: { marginTop: 16, fontSize: 12, color: 'rgba(255,255,255,0.45)', lineHeight: 18 },

  // Time limit
  bigTitle: { fontSize: 24, fontFamily: FONTS.displayBold, color: '#fff', marginTop: 12, lineHeight: 30 },
  bigSub: { fontSize: 15, color: COLORS.mist, marginTop: 8, lineHeight: 22 },
  hoursRow: {
    flexDirection: 'row', justifyContent: 'center', alignItems: 'center',
    marginTop: 24, gap: 24,
  },
  hoursCol: { alignItems: 'center', gap: 6 },
  hoursValue: { fontSize: 44, fontFamily: FONTS.displayBold, color: '#fff', minWidth: 80, textAlign: 'center' },
  hoursLabel: { fontSize: 12, color: COLORS.mist, letterSpacing: 1 },
  spinBtn: {
    width: 44, height: 44, borderRadius: 22,
    backgroundColor: 'rgba(255,255,255,0.08)',
    alignItems: 'center', justifyContent: 'center',
  },

  // Buttons
  primaryBtn: {
    marginTop: 20, paddingVertical: 16, borderRadius: RADII.xl,
    backgroundColor: COLORS.violet, alignItems: 'center', justifyContent: 'center',
  },
  primaryBtnText: { color: '#fff', fontSize: 15, fontFamily: FONTS.bodySemiBold },
  btnRow: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  dangerLink: { marginTop: 10, paddingVertical: 12, alignItems: 'center' },
  dangerLinkText: { color: COLORS.danger, fontSize: 14, fontFamily: FONTS.bodySemiBold },

  // Verification
  infoCard: {
    flexDirection: 'row', alignItems: 'center', padding: 14,
    backgroundColor: '#121212', borderRadius: RADII.xl,
    borderWidth: 1, borderColor: '#1F1F23',
  },
  rejectBanner: {
    backgroundColor: 'rgba(239,68,68,0.10)', padding: 12, borderRadius: 12,
    borderWidth: 1, borderColor: 'rgba(239,68,68,0.25)',
  },
  rejectText: { color: '#FCA5A5', fontSize: 13 },
  fieldLabel: { fontSize: 12, color: COLORS.mist, fontFamily: FONTS.bodySemiBold, marginBottom: 6 },
  field: {
    backgroundColor: 'rgba(255,255,255,0.05)',
    borderWidth: 1, borderColor: 'rgba(255,255,255,0.1)',
    borderRadius: 12, paddingHorizontal: 14, paddingVertical: 12,
    color: '#fff', fontSize: 15, fontFamily: FONTS.body,
  },
  fieldMultiline: { minHeight: 88, textAlignVertical: 'top' },
  selfieWrap: { borderRadius: 16, overflow: 'hidden', position: 'relative' },
  selfieImg: { width: '100%', height: 240, resizeMode: 'cover' },
  selfieChange: {
    position: 'absolute', bottom: 10, right: 10,
    backgroundColor: 'rgba(0,0,0,0.65)', paddingHorizontal: 12, paddingVertical: 8, borderRadius: 20,
  },
  selfieChangeText: { color: '#fff', fontSize: 12, fontFamily: FONTS.bodySemiBold },
  selfiePick: {
    borderWidth: 1, borderStyle: 'dashed', borderColor: 'rgba(255,255,255,0.2)',
    backgroundColor: 'rgba(255,255,255,0.03)', padding: 24, borderRadius: 16,
    alignItems: 'center', gap: 8,
  },
  selfiePickTitle: { fontSize: 14, color: '#fff', fontFamily: FONTS.bodySemiBold, textAlign: 'center' },
  selfiePickSub: { fontSize: 12, color: COLORS.mist, textAlign: 'center' },

  // Center card
  centerCard: {
    alignItems: 'center', padding: 32, marginTop: 12,
    backgroundColor: 'rgba(255,255,255,0.04)', borderRadius: RADII.xl,
    borderWidth: 1, borderColor: 'rgba(255,255,255,0.06)',
  },
  centerTitle: { fontSize: 17, color: '#fff', fontFamily: FONTS.displayBold, marginTop: 12 },
  centerSub: { fontSize: 13, color: COLORS.mist, marginTop: 4, textAlign: 'center' },
  pillIcon: {
    width: 52, height: 52, borderRadius: 26,
    backgroundColor: 'rgba(124,92,255,0.15)',
    alignItems: 'center', justifyContent: 'center',
  },

  // Skeleton
  skeletonRow: { height: 48, borderRadius: 12, backgroundColor: 'rgba(255,255,255,0.06)' },

  // Blocked
  blockedRow: {
    flexDirection: 'row', alignItems: 'center', paddingVertical: 12, gap: 12,
  },
  blockedInfo: { flex: 1, minWidth: 0 },
  blockedName: { fontSize: 15, fontFamily: FONTS.bodySemiBold, color: '#fff', flexShrink: 1 },
  blockedUsername: { fontSize: 12, color: COLORS.mist, marginTop: 2 },
  unblockBtn: {
    backgroundColor: 'rgba(255,255,255,0.08)',
    borderWidth: 1, borderColor: 'rgba(255,255,255,0.10)',
    paddingHorizontal: 16, paddingVertical: 8, borderRadius: 20,
    minWidth: 90, alignItems: 'center',
  },
  unblockBtnText: { color: '#fff', fontSize: 12.5, fontFamily: FONTS.bodySemiBold },
  blockedSkeleton: {
    flexDirection: 'row', alignItems: 'center', paddingVertical: 12, gap: 12,
  },
  blockedSkeletonAvatar: { width: 44, height: 44, borderRadius: 22, backgroundColor: 'rgba(255,255,255,0.06)' },
  blockedSkeletonLine: { height: 12, borderRadius: 6, backgroundColor: 'rgba(255,255,255,0.06)', width: '60%' },

  // Radio
  radioCard: {
    flexDirection: 'row', alignItems: 'center',
    padding: 16, borderRadius: RADII.xl,
    backgroundColor: 'rgba(255,255,255,0.04)',
    borderWidth: 1, borderColor: 'rgba(255,255,255,0.06)',
  },
  radioCardOn: {
    backgroundColor: 'rgba(124,92,255,0.10)',
    borderColor: 'rgba(124,92,255,0.5)',
  },
  radioTitle: { fontSize: 15, fontFamily: FONTS.bodySemiBold, color: '#fff' },
  radioDesc: { fontSize: 12, color: COLORS.mist, marginTop: 4 },
  radioCircle: {
    width: 24, height: 24, borderRadius: 12,
    borderWidth: 2, borderColor: 'rgba(255,255,255,0.25)',
    alignItems: 'center', justifyContent: 'center',
  },
  radioCircleOn: { backgroundColor: COLORS.violet, borderColor: COLORS.violet },

  // Invite
  inviteCard: {
    alignItems: 'center', padding: 32, marginTop: 12,
    backgroundColor: 'rgba(255,255,255,0.04)', borderRadius: RADII.xl,
    borderWidth: 1, borderColor: 'rgba(255,255,255,0.06)',
  },
  inviteIcon: {
    width: 64, height: 64, borderRadius: 20,
    backgroundColor: COLORS.violet,
    alignItems: 'center', justifyContent: 'center',
  },
  inviteTitle: { fontSize: 18, fontFamily: FONTS.displayBold, color: '#fff', marginTop: 16 },
  inviteSub: { fontSize: 13, color: COLORS.mist, marginTop: 4, textAlign: 'center' },
  inviteLink: {
    marginTop: 20, paddingHorizontal: 20, paddingVertical: 14,
    backgroundColor: 'rgba(255,255,255,0.05)',
    borderRadius: 12, borderWidth: 1, borderColor: 'rgba(255,255,255,0.10)',
  },
  inviteLinkText: { fontSize: 15, fontFamily: FONTS.bodySemiBold, color: '#fff' },
  inviteBtnSecondary: {
    flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6,
    paddingVertical: 12, borderRadius: 20,
    backgroundColor: 'rgba(255,255,255,0.08)',
    borderWidth: 1, borderColor: 'rgba(255,255,255,0.10)',
  },
  inviteBtnPrimary: {
    flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6,
    paddingVertical: 12, borderRadius: 20,
    backgroundColor: COLORS.violet,
  },
  inviteBtnText: { color: '#fff', fontSize: 14, fontFamily: FONTS.bodySemiBold },

  // Account status
  statusBanner: {
    flexDirection: 'row', alignItems: 'center',
    padding: 16, backgroundColor: 'rgba(255,255,255,0.04)',
    borderRadius: RADII.xl, borderWidth: 1, borderColor: 'rgba(255,255,255,0.06)',
    marginTop: 12,
  },
  statusIcon: {
    width: 40, height: 40, borderRadius: 20,
    alignItems: 'center', justifyContent: 'center',
  },
  statusRow: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    paddingHorizontal: 16, paddingVertical: 16,
  },
  statusRowTitle: { fontSize: 15, fontFamily: FONTS.bodyMedium, color: '#fff' },
  statusTick: {
    width: 24, height: 24, borderRadius: 12, borderWidth: 2,
    alignItems: 'center', justifyContent: 'center',
  },
  infoBlock: {
    marginTop: 16, padding: 16, borderRadius: RADII.xl,
    backgroundColor: 'rgba(255,255,255,0.04)',
    borderWidth: 1, borderColor: 'rgba(255,255,255,0.06)',
  },
  infoBlockRow: { fontSize: 13, color: COLORS.mist, marginVertical: 2 },

  // Subscription
  subHero: {
    flexDirection: 'row', alignItems: 'center',
    padding: 20, borderRadius: RADII.xl, marginTop: 12,
  },
  subHeroTitle: { fontSize: 22, fontFamily: FONTS.displayBold, color: '#fff' },
  subHeroSub: { fontSize: 13, color: COLORS.mist, marginTop: 2 },
  featureRow: {
    flexDirection: 'row', alignItems: 'center', gap: 12,
    paddingHorizontal: 16, paddingVertical: 14,
  },
  featureCheck: {
    width: 24, height: 24, borderRadius: 12,
    backgroundColor: 'rgba(124,92,255,0.20)',
    alignItems: 'center', justifyContent: 'center',
  },
  featureText: { fontSize: 15, fontFamily: FONTS.bodyMedium, color: '#fff' },
  costCard: {
    padding: 20, borderRadius: RADII.xl,
    backgroundColor: '#121212', borderWidth: 1, borderColor: '#1F1F23',
    flexDirection: 'row', alignItems: 'baseline', gap: 8,
  },
  costValue: { fontSize: 32, fontFamily: FONTS.displayBold, color: '#fff' },
  costUnit: { fontSize: 14, color: COLORS.mist, fontFamily: FONTS.body },

  // Appearance
  themePreview: {
    height: 320, borderRadius: RADII.xl, overflow: 'hidden',
    marginTop: 12, borderWidth: 1, borderColor: 'rgba(255,255,255,0.08)',
  },
  themeHeader: {
    flexDirection: 'row', alignItems: 'center',
    paddingHorizontal: 14, paddingVertical: 12, borderBottomWidth: 1,
  },
  themeAvatar: { width: 32, height: 32, borderRadius: 16 },
  themeHeaderName: { fontSize: 13, fontFamily: FONTS.bodySemiBold, color: '#fff' },
  themeHeaderSub: { fontSize: 11, color: 'rgba(255,255,255,0.6)' },
  themeBody: { flex: 1, padding: 14, justifyContent: 'flex-end', gap: 8 },
  themeBubble: { maxWidth: '78%', paddingHorizontal: 14, paddingVertical: 8, borderRadius: 16 },
  themeBubbleText: { fontSize: 13.5, color: '#fff' },
  themeComposer: {
    flexDirection: 'row', alignItems: 'center', gap: 10,
    paddingHorizontal: 12, paddingVertical: 10, borderTopWidth: 1,
  },
  themeInput: {
    flex: 1, height: 34, borderRadius: 17,
    backgroundColor: 'rgba(255,255,255,0.09)',
    borderWidth: 1, borderColor: 'rgba(255,255,255,0.14)',
  },
  themeSendBtn: {
    width: 32, height: 32, borderRadius: 16,
    alignItems: 'center', justifyContent: 'center',
  },
  themeGridCard: {
    padding: 16, backgroundColor: '#121212',
    borderRadius: RADII.xl, borderWidth: 1, borderColor: '#1F1F23',
  },
  themeGrid: {
    flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'space-between',
    rowGap: 16,
  },
  themeThumbWrap: { width: '31%', alignItems: 'center', gap: 8 },
  themeThumb: {
    width: '100%', aspectRatio: 3 / 4,
    borderRadius: 16, overflow: 'hidden', position: 'relative',
    borderWidth: 1, borderColor: 'rgba(255,255,255,0.10)',
  },
  themeThumbSelected: { borderWidth: 2, borderColor: COLORS.violetLight ?? '#9C82FF' },
  themeMiniBubble: { position: 'absolute', width: 44, height: 16, borderRadius: 8 },
  themeCheck: {
    position: 'absolute', bottom: 8, right: 8,
    width: 20, height: 20, borderRadius: 10,
    backgroundColor: COLORS.violetLight ?? '#9C82FF',
    alignItems: 'center', justifyContent: 'center',
  },
  themeName: { fontSize: 12, color: COLORS.mist, fontFamily: FONTS.bodyMedium },
  themeNameActive: { color: '#fff', fontFamily: FONTS.bodySemiBold },
});
