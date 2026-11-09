// components/BanGuard.tsx
// Banned user login kar sakta hai, par poori app par ek popup aata hai:
// ban ki info + 2 buttons: Logout aur Appeal.
//
// Use: app/_layout.tsx me ek line  →  <BanGuard />   (navigator ke saath, kahin bhi)
//
// ✅ Cache se turant (offline me bhi), phir server se confirm
// ✅ Auth change, app foreground aur har 30s (jab banned ho) par re-check
//    → appeal approve hote hi popup apne aap hat jata hai
// ✅ Temporary ban khatam hone par server khud unban kar deta hai

import { useCallback, useEffect, useRef, useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  TouchableOpacity,
  ActivityIndicator,
  TextInput,
  Modal,
  AppState,
  KeyboardAvoidingView,
  Platform,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { useRouter } from 'expo-router';
import { COLORS, FONTS, RADII } from '../constants/theme';
import { supabase } from '../lib/supabase';
import { getCurrentUserId, invalidateUserIdCache } from '../lib/auth';
import { isOnline } from '../lib/network';
import { dbWipeAll } from '../lib/db';
import { fetchMyBanStatus, submitBanAppeal } from '../lib/ban';
import type { BanStatus } from '../lib/ban';

const BAN_CACHE_KEY = (uid: string) => `airalance:ban:${uid}`;
const VIOLET = '#7C5CFF';
const RED = '#F87171';
const AMBER = '#FFC857';
const MUTED = 'rgba(255,255,255,0.55)';
const MIN_LEN = 10;
const MAX_LEN = 1000;

function formatDateTime(iso: string | null | undefined): string {
  if (!iso) return '—';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '—';
  return d.toLocaleString(undefined, {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  });
}

function timeLeft(iso: string | null | undefined): string {
  if (!iso) return '';
  const ms = new Date(iso).getTime() - Date.now();
  if (!Number.isFinite(ms) || ms <= 0) return 'ending soon';
  const mins = Math.round(ms / 60000);
  if (mins < 60) return `${mins} min left`;
  const hrs = Math.round(mins / 60);
  if (hrs < 48) return `${hrs} hr left`;
  return `${Math.round(hrs / 24)} days left`;
}

function InfoRow({ label, value, last }: { label: string; value: string; last?: boolean }) {
  return (
    <View style={[styles.infoRow, !last && styles.infoRowBorder]}>
      <Text style={styles.infoLabel}>{label}</Text>
      <Text style={styles.infoValue}>{value}</Text>
    </View>
  );
}

export default function BanGuard() {
  const router = useRouter();
  const [status, setStatus] = useState<BanStatus | null>(null);
  const [mode, setMode] = useState<'info' | 'form'>('info');
  const [message, setMessage] = useState('');
  const [formError, setFormError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [loggingOut, setLoggingOut] = useState(false);
  const uidRef = useRef<string | null>(null);

  const check = useCallback(async (knownUid?: string | null) => {
    try {
      const uid = knownUid ?? (await getCurrentUserId());
      uidRef.current = uid;
      if (!uid) {
        setStatus(null);
        return;
      }
      try {
        const raw = await AsyncStorage.getItem(BAN_CACHE_KEY(uid));
        if (raw) {
          const cached = JSON.parse(raw) as BanStatus;
          if (cached?.banned) setStatus((prev) => prev ?? cached);
        }
      } catch {}

      if (!isOnline()) return;
      const s = await fetchMyBanStatus();
      if (uidRef.current !== uid) return;
      if (s.banned) {
        setStatus(s);
        await AsyncStorage.setItem(BAN_CACHE_KEY(uid), JSON.stringify(s));
      } else {
        setStatus(null);
        setMode('info');
        await AsyncStorage.removeItem(BAN_CACHE_KEY(uid));
      }
    } catch (err) {
      console.warn('[ban] check failed:', err);
    }
  }, []);

  useEffect(() => {
    check();
  }, [check]);

  // login / logout / token refresh
  useEffect(() => {
    const { data } = supabase.auth.onAuthStateChange((_event: string, session: any) => {
      const id: string | null = session?.user?.id ?? null;
      if (!id) {
        uidRef.current = null;
        setStatus(null);
        setMode('info');
        return;
      }
      // supabase callback ke andar await nahi — next tick par
      setTimeout(() => check(id), 0);
    });
    return () => data?.subscription?.unsubscribe();
  }, [check]);

  // app foreground
  useEffect(() => {
    const sub = AppState.addEventListener('change', (st: string) => {
      if (st === 'active') check();
    });
    return () => sub.remove();
  }, [check]);

  // banned ho to har 30s (appeal approve hone par popup hat jaye)
  const banned = !!status?.banned;
  useEffect(() => {
    if (!banned) return;
    const t = setInterval(() => check(), 30000);
    return () => clearInterval(t);
  }, [banned, check]);

  async function logout() {
    if (loggingOut) return;
    setLoggingOut(true);
    const uid = uidRef.current;
    if (uid) {
      try {
        await AsyncStorage.multiRemove([
          `airalance-usage:${uid}`,
          `airalance:profile:me:${uid}`,
          `airalance:admin-role:${uid}`,
          BAN_CACHE_KEY(uid),
        ]);
      } catch {}
    }
    try {
      await dbWipeAll();
    } catch (err) {
      console.warn('[ban] SQLite wipe failed:', err);
    }
    invalidateUserIdCache();
    try {
      await supabase.auth.signOut();
    } catch (err) {
      console.warn('[ban] signOut failed:', err);
    }
    setStatus(null);
    setMode('info');
    setMessage('');
    setLoggingOut(false);
    router.replace('/(auth)/login');
  }

  async function sendAppeal() {
    if (submitting) return;
    const m = message.trim();
    if (m.length < MIN_LEN) {
      setFormError(`Write at least ${MIN_LEN} characters so we can understand.`);
      return;
    }
    if (!isOnline()) {
      setFormError('You’re offline. Connect to the internet and try again.');
      return;
    }
    setSubmitting(true);
    setFormError(null);
    try {
      await submitBanAppeal(m);
      setMessage('');
      setMode('info');
      await check();
    } catch (e: any) {
      const raw = String(e?.message ?? '');
      setFormError(raw ? raw.charAt(0).toUpperCase() + raw.slice(1) : 'Something went wrong. Try again.');
    } finally {
      setSubmitting(false);
    }
  }

  if (!status?.banned) return null;

  const temp = !!status.ban_until;
  const pending = status.appeal_status === 'pending';
  const rejected = status.appeal_status === 'rejected';
  const canAppeal = !!status.can_appeal;
  const appealLabel = pending ? 'Appeal sent' : canAppeal ? 'Appeal' : 'Appeal in 24h';
  const reason = status.reason?.trim() || 'Violation of community guidelines';

  return (
    <Modal
      visible
      transparent
      animationType="fade"
      statusBarTranslucent
      onRequestClose={() => {}}
    >
      <KeyboardAvoidingView
        style={{ flex: 1 }}
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      >
        <View style={styles.backdrop}>
          <View style={styles.card}>
            <ScrollView
              showsVerticalScrollIndicator={false}
              keyboardShouldPersistTaps="handled"
              contentContainerStyle={styles.cardContent}
            >
              <View style={styles.iconWrap}>
                <Ionicons name={temp ? 'time' : 'ban'} size={28} color={RED} />
              </View>

              {mode === 'info' ? (
                <>
                  <Text style={styles.title}>{temp ? 'Account suspended' : 'Account banned'}</Text>
                  <Text style={styles.sub}>
                    {status.username ? `@${status.username} ` : 'Your account '}
                    {temp
                      ? `is suspended until ${formatDateTime(status.ban_until)}.`
                      : 'has been permanently banned from Airalance.'}
                  </Text>

                  <View style={styles.infoCard}>
                    <InfoRow label="Reason" value={reason} />
                    {!!status.category && <InfoRow label="Category" value={status.category} />}
                    <InfoRow label="Banned on" value={formatDateTime(status.banned_at)} />
                    <InfoRow
                      label="Duration"
                      value={temp ? `Until ${formatDateTime(status.ban_until)} · ${timeLeft(status.ban_until)}` : 'Permanent'}
                    />
                    <InfoRow label="Reference ID" value={status.ref ?? '—'} last />
                  </View>

                  {pending && (
                    <View style={[styles.notice, { borderColor: 'rgba(255,200,87,0.3)', backgroundColor: 'rgba(255,200,87,0.08)' }]}>
                      <Ionicons name="hourglass-outline" size={18} color={AMBER} />
                      <View style={{ flex: 1 }}>
                        <Text style={[styles.noticeTitle, { color: AMBER }]}>Appeal under review</Text>
                        <Text style={styles.noticeText}>
                          We’ll look at it soon. This screen updates as soon as there’s a decision.
                        </Text>
                      </View>
                    </View>
                  )}

                  {rejected && (
                    <View style={[styles.notice, { borderColor: 'rgba(239,68,68,0.3)', backgroundColor: 'rgba(239,68,68,0.08)' }]}>
                      <Ionicons name="close-circle-outline" size={18} color={RED} />
                      <View style={{ flex: 1 }}>
                        <Text style={[styles.noticeTitle, { color: RED }]}>Appeal declined</Text>
                        <Text style={styles.noticeText}>
                          {status.appeal_note ? status.appeal_note : 'Our team reviewed your appeal and kept the ban.'}
                        </Text>
                      </View>
                    </View>
                  )}

                  {!pending && !rejected && (
                    <Text style={styles.hint}>
                      Think this was a mistake? Send an appeal and our team will review it.
                    </Text>
                  )}

                  <View style={styles.buttons}>
                    <TouchableOpacity
                      style={styles.btnSecondary}
                      onPress={logout}
                      disabled={loggingOut}
                      activeOpacity={0.8}
                    >
                      {loggingOut ? (
                        <ActivityIndicator size="small" color="#fff" />
                      ) : (
                        <>
                          <Ionicons name="log-out-outline" size={17} color="#FFFFFF" />
                          <Text style={styles.btnSecondaryText}>Logout</Text>
                        </>
                      )}
                    </TouchableOpacity>
                    <TouchableOpacity
                      style={[styles.btnPrimary, !canAppeal && styles.btnDisabled]}
                      onPress={() => {
                        setFormError(null);
                        setMode('form');
                      }}
                      disabled={!canAppeal}
                      activeOpacity={0.85}
                    >
                      <Ionicons name={pending ? 'checkmark' : 'megaphone-outline'} size={17} color="#FFFFFF" />
                      <Text style={styles.btnPrimaryText}>{appealLabel}</Text>
                    </TouchableOpacity>
                  </View>
                </>
              ) : (
                <>
                  <Text style={styles.title}>Appeal your ban</Text>
                  <Text style={styles.sub}>
                    Tell us why this should be reviewed. Be honest and specific — you can appeal once every 24 hours.
                  </Text>

                  <TextInput
                    style={styles.input}
                    value={message}
                    onChangeText={(t) => {
                      setMessage(t);
                      if (formError) setFormError(null);
                    }}
                    placeholder="Explain what happened and why the ban should be lifted"
                    placeholderTextColor="rgba(255,255,255,0.32)"
                    multiline
                    maxLength={MAX_LEN}
                    textAlignVertical="top"
                    underlineColorAndroid="transparent"
                  />
                  <View style={styles.counterRow}>
                    <Text style={styles.formError}>{formError ?? ' '}</Text>
                    <Text style={styles.counter}>
                      {message.length}/{MAX_LEN}
                    </Text>
                  </View>

                  <View style={styles.buttons}>
                    <TouchableOpacity
                      style={styles.btnSecondary}
                      onPress={() => {
                        setMode('info');
                        setFormError(null);
                      }}
                      disabled={submitting}
                      activeOpacity={0.8}
                    >
                      <Text style={styles.btnSecondaryText}>Back</Text>
                    </TouchableOpacity>
                    <TouchableOpacity
                      style={styles.btnPrimary}
                      onPress={sendAppeal}
                      disabled={submitting}
                      activeOpacity={0.85}
                    >
                      {submitting ? (
                        <ActivityIndicator size="small" color="#fff" />
                      ) : (
                        <Text style={styles.btnPrimaryText}>Submit appeal</Text>
                      )}
                    </TouchableOpacity>
                  </View>
                </>
              )}
            </ScrollView>
          </View>
        </View>
      </KeyboardAvoidingView>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.9)',
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 20,
  },
  card: {
    width: '100%',
    maxWidth: 380,
    maxHeight: '90%',
    backgroundColor: '#14161E',
    borderRadius: 24,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.09)',
  },
  cardContent: { padding: 20 },
  iconWrap: {
    width: 60,
    height: 60,
    borderRadius: 30,
    alignSelf: 'center',
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(239,68,68,0.15)',
    marginBottom: 14,
  },
  title: { fontSize: 20, fontFamily: FONTS.displayBold, color: '#FFFFFF', textAlign: 'center' },
  sub: {
    fontSize: 13.5,
    fontFamily: FONTS.body,
    color: COLORS.mistLight,
    textAlign: 'center',
    lineHeight: 19,
    marginTop: 8,
    marginBottom: 16,
  },
  infoCard: {
    borderRadius: 16,
    backgroundColor: '#17171A',
    borderWidth: 1,
    borderColor: '#1F1F23',
    overflow: 'hidden',
  },
  infoRow: { paddingHorizontal: 14, paddingVertical: 11 },
  infoRowBorder: { borderBottomWidth: 1, borderBottomColor: '#1F1F23' },
  infoLabel: { fontSize: 11.5, fontFamily: FONTS.bodyMedium, color: MUTED, marginBottom: 3 },
  infoValue: { fontSize: 14, fontFamily: FONTS.bodySemiBold, color: '#FFFFFF', lineHeight: 19 },
  notice: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 10,
    marginTop: 12,
    padding: 12,
    borderRadius: 14,
    borderWidth: 1,
  },
  noticeTitle: { fontSize: 13.5, fontFamily: FONTS.bodySemiBold },
  noticeText: { fontSize: 12.5, fontFamily: FONTS.body, color: 'rgba(255,255,255,0.75)', marginTop: 2, lineHeight: 17 },
  hint: { fontSize: 12.5, fontFamily: FONTS.body, color: MUTED, textAlign: 'center', marginTop: 14, lineHeight: 17 },
  buttons: { flexDirection: 'row', gap: 10, marginTop: 18 },
  btnSecondary: {
    flex: 1,
    height: 46,
    borderRadius: RADII.full,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    backgroundColor: 'rgba(255,255,255,0.09)',
  },
  btnSecondaryText: { color: '#FFFFFF', fontSize: 14.5, fontFamily: FONTS.bodySemiBold },
  btnPrimary: {
    flex: 1,
    height: 46,
    borderRadius: RADII.full,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    backgroundColor: VIOLET,
  },
  btnPrimaryText: { color: '#FFFFFF', fontSize: 14.5, fontFamily: FONTS.bodySemiBold },
  btnDisabled: { opacity: 0.45 },
  input: {
    minHeight: 130,
    maxHeight: 200,
    padding: 14,
    borderRadius: 14,
    backgroundColor: 'rgba(255,255,255,0.06)',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.09)',
    color: '#FFFFFF',
    fontSize: 14.5,
    fontFamily: FONTS.body,
    lineHeight: 20,
  },
  counterRow: { flexDirection: 'row', justifyContent: 'space-between', marginTop: 8, paddingHorizontal: 2 },
  formError: { flex: 1, fontSize: 12.5, fontFamily: FONTS.body, color: RED, paddingRight: 10 },
  counter: { fontSize: 12, fontFamily: FONTS.body, color: 'rgba(255,255,255,0.32)' },
});
