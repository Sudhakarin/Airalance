// components/DataAccessPanel.tsx
// Settings → Contacts & location
//  • Find friends: contacts ke encrypted fingerprints se pata chalta hai kaun Airalance par hai
//  • Local news: approximate location (city/region/country) personalised news ke liye
// Dono opt-in hain; kabhi bhi band karke data delete kar sakte ho.

import { useCallback, useEffect, useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  Switch,
  ActivityIndicator,
  Alert,
  Linking,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import { COLORS, FONTS, RADII } from '../constants/theme';
import { isOnline } from '../lib/network';
import Avatar from './Avatar';
import VerifiedBadge from './VerifiedBadge';
import {
  contactsAvailable,
  isContactSyncEnabled,
  enableContactSync,
  resyncContacts,
  fetchContactMatches,
  disableContactSync,
  getLocalContactNames,
} from '../lib/contactsSync';
import type { ContactMatch } from '../lib/contactsSync';
import {
  locationAvailable,
  getCachedLocation,
  enableLocation,
  refreshLocation,
  disableLocation,
} from '../lib/userLocation';
import type { UserLocation } from '../lib/userLocation';

type IconName = keyof typeof Ionicons.glyphMap;
const VIOLET = '#7C5CFF';

function Row({
  icon,
  tint,
  title,
  subtitle,
  right,
  onPress,
}: {
  icon: IconName;
  tint: string;
  title: string;
  subtitle?: string;
  right?: React.ReactNode;
  onPress?: () => void;
}) {
  const inner = (
    <>
      <View style={[styles.rowIcon, { backgroundColor: `${tint}29` }]}>
        <Ionicons name={icon} size={19} color={tint} />
      </View>
      <View style={{ flex: 1, minWidth: 0 }}>
        <Text style={styles.rowTitle}>{title}</Text>
        {!!subtitle && <Text style={styles.rowSub}>{subtitle}</Text>}
      </View>
      {right}
    </>
  );
  if (!onPress) return <View style={styles.row}>{inner}</View>;
  return (
    <TouchableOpacity style={styles.row} onPress={onPress} activeOpacity={0.7}>
      {inner}
    </TouchableOpacity>
  );
}

function openSettingsAlert(what: string) {
  Alert.alert(
    `${what} is turned off`,
    `Allow it in your phone settings to use this feature.`,
    [
      { text: 'Not now', style: 'cancel' },
      { text: 'Open settings', onPress: () => Linking.openSettings().catch(() => {}) },
    ]
  );
}

export default function DataAccessPanel({
  onOpenLegal,
}: {
  onOpenLegal: (k: 'terms' | 'privacy') => void;
}) {
  const router = useRouter();
  const [contactsOn, setContactsOn] = useState(false);
  const [matches, setMatches] = useState<ContactMatch[] | null>(null);
  const [names, setNames] = useState<Record<string, string>>({});
  const [loc, setLoc] = useState<UserLocation | null>(null);
  const [busy, setBusy] = useState<'contacts' | 'location' | null>(null);
  const [ready, setReady] = useState(false);

  const loadMatches = useCallback(async () => {
    try {
      setNames(await getLocalContactNames());
      setMatches(await fetchContactMatches());
    } catch {
      setMatches([]);
    }
  }, []);

  useEffect(() => {
    let alive = true;
    (async () => {
      const on = await isContactSyncEnabled();
      const l = await getCachedLocation();
      if (!alive) return;
      setContactsOn(on);
      setLoc(l);
      setReady(true);
      if (on && isOnline()) loadMatches();
    })();
    return () => {
      alive = false;
    };
  }, [loadMatches]);

  function needOnline(): boolean {
    if (isOnline()) return true;
    Alert.alert('Offline', 'Connect to the internet to change this.');
    return false;
  }

  /* ---------- contacts ---------- */
  function turnOnContacts() {
    if (!needOnline()) return;
    if (!contactsAvailable()) {
      Alert.alert(
        'Update needed',
        'Please update Airalance to the latest version to use Find friends.'
      );
      return;
    }
    Alert.alert(
      'Find friends from contacts',
      'Airalance will read the emails and phone numbers in your contacts and turn each into an encrypted fingerprint on your phone. Only those fingerprints are uploaded, never names or readable numbers. You can turn this off and delete them anytime.',
      [
        { text: 'Not now', style: 'cancel' },
        {
          text: 'Allow',
          onPress: async () => {
            setBusy('contacts');
            const r = await enableContactSync();
            setBusy(null);
            if (r.ok) {
              setContactsOn(true);
              loadMatches();
            } else if (r.reason === 'blocked') {
              openSettingsAlert('Contacts permission');
            } else if (r.reason === 'denied') {
              Alert.alert('Permission needed', 'Contacts permission was not allowed.');
            } else if (r.reason === 'unavailable') {
              Alert.alert('Update needed', 'Please update Airalance to use Find friends.');
            } else {
              Alert.alert('Something went wrong', 'Could not read your contacts. Try again.');
            }
          },
        },
      ]
    );
  }

  function turnOffContacts() {
    if (!needOnline()) return;
    Alert.alert(
      'Turn off Find friends?',
      'We will delete the contact fingerprints we hold for you.',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Turn off and delete',
          style: 'destructive',
          onPress: async () => {
            setBusy('contacts');
            try {
              await disableContactSync();
              setContactsOn(false);
              setMatches(null);
            } catch {
              Alert.alert('Something went wrong', 'Could not delete. Try again.');
            } finally {
              setBusy(null);
            }
          },
        },
      ]
    );
  }

  async function syncAgain() {
    if (!needOnline()) return;
    setBusy('contacts');
    try {
      await resyncContacts();
      await loadMatches();
    } catch {
      Alert.alert('Something went wrong', 'Could not sync contacts. Try again.');
    } finally {
      setBusy(null);
    }
  }

  /* ---------- location ---------- */
  function turnOnLocation() {
    if (!needOnline()) return;
    if (!locationAvailable()) {
      Alert.alert(
        'Update needed',
        'Please update Airalance to the latest version to use Local news.'
      );
      return;
    }
    Alert.alert(
      'Local news',
      'Airalance will use your location to find your area and show news from your city and neighbourhood. We save only your area (city, locality and postal code), never your exact coordinates.',
      [
        { text: 'Not now', style: 'cancel' },
        {
          text: 'Allow',
          onPress: async () => {
            setBusy('location');
            const r = await enableLocation();
            setBusy(null);
            if (r.ok) setLoc(r.location);
            else if (r.reason === 'blocked') openSettingsAlert('Location permission');
            else if (r.reason === 'denied')
              Alert.alert('Permission needed', 'Location permission was not allowed.');
            else if (r.reason === 'unavailable')
              Alert.alert('Update needed', 'Please update Airalance to use Local news.');
            else Alert.alert('Something went wrong', 'Could not get your location. Try again.');
          },
        },
      ]
    );
  }

  async function turnOffLocation() {
    if (!needOnline()) return;
    setBusy('location');
    try {
      await disableLocation();
      setLoc(null);
    } catch {
      Alert.alert('Something went wrong', 'Could not turn off. Try again.');
    } finally {
      setBusy(null);
    }
  }

  async function updateLocation() {
    if (!needOnline()) return;
    setBusy('location');
    try {
      const l = await refreshLocation();
      if (l) setLoc(l);
    } catch {
      Alert.alert('Something went wrong', 'Could not update your location.');
    } finally {
      setBusy(null);
    }
  }

  const place =
    loc && [loc.district, loc.city, loc.region, loc.country].filter(Boolean).join(', ');

  if (!ready) {
    return (
      <View style={{ paddingTop: 40, alignItems: 'center' }}>
        <ActivityIndicator color={COLORS.violet} />
      </View>
    );
  }

  return (
    <View>
      <View style={styles.hero}>
        <View style={[styles.heroIcon, { backgroundColor: `${VIOLET}33` }]}>
          <Ionicons name="shield-checkmark" size={24} color="#FFFFFF" />
        </View>
        <View style={{ flex: 1 }}>
          <Text style={styles.heroTitle}>Your data, your choice</Text>
          <Text style={styles.heroSub}>Both are optional. Turn off anytime and we delete what we hold.</Text>
        </View>
      </View>

      <Text style={styles.sectionLabel}>Find friends</Text>
      <View style={styles.group}>
        <Row
          icon="people-outline"
          tint="#6EA8FF"
          title="Contacts"
          subtitle={
            contactsOn
              ? 'On · only encrypted fingerprints are stored'
              : 'See which of your contacts are on Airalance'
          }
          right={
            busy === 'contacts' ? (
              <ActivityIndicator size="small" color={COLORS.violet} />
            ) : (
              <Switch
                value={contactsOn}
                onValueChange={(v) => (v ? turnOnContacts() : turnOffContacts())}
                trackColor={{ false: '#2A2A2E', true: VIOLET }}
                thumbColor="#FFFFFF"
              />
            )
          }
        />
        {contactsOn && (
          <>
            <View style={styles.sep} />
            <Row
              icon="sync-outline"
              tint="#4ADE9A"
              title="Sync again"
              subtitle="Refresh your contacts"
              onPress={syncAgain}
              right={<Ionicons name="chevron-forward" size={18} color="rgba(255,255,255,0.32)" />}
            />
          </>
        )}
      </View>

      {contactsOn && (
        <>
          <Text style={styles.sectionLabel}>
            Contacts on Airalance{matches ? ` (${matches.length})` : ''}
          </Text>
          {matches === null ? (
            <ActivityIndicator color={COLORS.violet} style={{ marginTop: 10 }} />
          ) : matches.length === 0 ? (
            <View style={styles.emptyCard}>
              <Text style={styles.emptyTitle}>No one yet</Text>
              <Text style={styles.emptySub}>
                When people from your contacts join Airalance, they will show up here.
              </Text>
            </View>
          ) : (
            <View style={styles.group}>
              {matches.map((m, i) => (
                <View key={m.id}>
                  {i > 0 && <View style={styles.sepFull} />}
                  <TouchableOpacity
                    style={styles.matchRow}
                    onPress={() => router.push(`/profile/${m.id}`)}
                    activeOpacity={0.7}
                  >
                    <Avatar
                      name={m.display_name}
                      color={m.avatar_color}
                      avatarUrl={m.avatar_url}
                      size={42}
                    />
                    <View style={{ flex: 1, minWidth: 0 }}>
                      <View style={{ flexDirection: 'row', alignItems: 'center' }}>
                        <Text style={styles.rowTitle} numberOfLines={1}>
                          {m.display_name || m.username}
                        </Text>
                        {m.verified && (
                          <View style={{ marginLeft: 3 }}>
                            <VerifiedBadge size={14} />
                          </View>
                        )}
                      </View>
                      <Text style={styles.rowSub} numberOfLines={1}>
                        {m.matched_hash && names[m.matched_hash]
                          ? `Saved as “${names[m.matched_hash]}” · @${m.username}`
                          : `@${m.username}`}
                      </Text>
                    </View>
                    <View style={styles.viewBtn}>
                      <Text style={styles.viewBtnText}>View</Text>
                    </View>
                  </TouchableOpacity>
                </View>
              ))}
            </View>
          )}
        </>
      )}

      <Text style={styles.sectionLabel}>Local news</Text>
      <View style={styles.group}>
        <Row
          icon="location-outline"
          tint="#FFC857"
          title="Location"
          subtitle={
            loc
              ? place || 'On'
              : 'Show news that is relevant to your area'
          }
          right={
            busy === 'location' ? (
              <ActivityIndicator size="small" color={COLORS.violet} />
            ) : (
              <Switch
                value={!!loc}
                onValueChange={(v) => (v ? turnOnLocation() : turnOffLocation())}
                trackColor={{ false: '#2A2A2E', true: VIOLET }}
                thumbColor="#FFFFFF"
              />
            )
          }
        />
        {!!loc && (
          <>
            <View style={styles.sep} />
            <Row
              icon="refresh-outline"
              tint="#4ADE9A"
              title="Update location"
              subtitle="Only your area (city, locality, postal code) is saved"
              onPress={updateLocation}
              right={<Ionicons name="chevron-forward" size={18} color="rgba(255,255,255,0.32)" />}
            />
          </>
        )}
      </View>

      <Text style={styles.sectionLabel}>Learn more</Text>
      <View style={styles.group}>
        <Row
          icon="lock-closed-outline"
          tint="#4ADE9A"
          title="Privacy Policy"
          onPress={() => onOpenLegal('privacy')}
          right={<Ionicons name="chevron-forward" size={18} color="rgba(255,255,255,0.32)" />}
        />
        <View style={styles.sep} />
        <Row
          icon="document-text-outline"
          tint="#B79CFF"
          title="Terms & Conditions"
          onPress={() => onOpenLegal('terms')}
          right={<Ionicons name="chevron-forward" size={18} color="rgba(255,255,255,0.32)" />}
        />
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  hero: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 14,
    padding: 16,
    marginTop: 8,
    borderRadius: RADII.xl,
    backgroundColor: '#121212',
    borderWidth: 1,
    borderColor: '#1F1F23',
  },
  heroIcon: { width: 48, height: 48, borderRadius: 15, alignItems: 'center', justifyContent: 'center' },
  heroTitle: { fontSize: 17, fontFamily: FONTS.displayBold, color: '#FFFFFF' },
  heroSub: { fontSize: 12.5, fontFamily: FONTS.body, color: 'rgba(255,255,255,0.55)', marginTop: 2, lineHeight: 17 },
  sectionLabel: {
    fontSize: 12,
    fontFamily: FONTS.bodySemiBold,
    color: 'rgba(255,255,255,0.55)',
    textTransform: 'uppercase',
    letterSpacing: 0.8,
    marginTop: 22,
    marginBottom: 8,
    marginLeft: 6,
  },
  group: {
    backgroundColor: '#121212',
    borderRadius: RADII.xl,
    borderWidth: 1,
    borderColor: '#1F1F23',
    overflow: 'hidden',
  },
  sep: { height: 1, backgroundColor: '#1F1F23', marginLeft: 62 },
  sepFull: { height: 1, backgroundColor: '#1F1F23', marginLeft: 16 },
  row: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingHorizontal: 14, paddingVertical: 12 },
  rowIcon: { width: 36, height: 36, borderRadius: 11, alignItems: 'center', justifyContent: 'center' },
  rowTitle: { fontSize: 15, fontFamily: FONTS.bodySemiBold, color: '#FFFFFF', flexShrink: 1 },
  rowSub: { fontSize: 12.5, fontFamily: FONTS.body, color: 'rgba(255,255,255,0.55)', marginTop: 2, lineHeight: 17 },
  matchRow: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingHorizontal: 14, paddingVertical: 11 },
  viewBtn: {
    height: 32,
    paddingHorizontal: 14,
    borderRadius: 16,
    backgroundColor: 'rgba(124,92,255,0.22)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  viewBtnText: { fontSize: 13, fontFamily: FONTS.bodySemiBold, color: '#FFFFFF' },
  emptyCard: {
    padding: 20,
    borderRadius: RADII.xl,
    backgroundColor: '#121212',
    borderWidth: 1,
    borderColor: '#1F1F23',
    alignItems: 'center',
  },
  emptyTitle: { fontSize: 15, fontFamily: FONTS.bodySemiBold, color: '#FFFFFF' },
  emptySub: { fontSize: 12.5, fontFamily: FONTS.body, color: 'rgba(255,255,255,0.55)', marginTop: 4, textAlign: 'center', lineHeight: 17 },
});
