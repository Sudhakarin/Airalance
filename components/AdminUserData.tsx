// components/AdminUserData.tsx
// User detail screen me "Account" group ke neeche lagao:
//   {rank >= 2 && <AdminUserData userId={p.id} />}
// Data tabhi dikhta hai jab user ne consent diya ho. Har "Reveal" audit log me jaata hai.

import { useCallback, useEffect, useState } from 'react';
import { View, Text, TouchableOpacity, ActivityIndicator, Linking, Alert, TextInput } from 'react-native';
import {
  adminUserDataStatus,
  adminGetUserLocation,
  adminListUserContacts,
} from '../lib/adminUserData';
import type { UserDataStatus, PreciseLocation, ContactDetail } from '../lib/adminUserData';

const C = { card: '#121212', line: '#1F1F23', text: '#FFFFFF', sub: 'rgba(255,255,255,0.6)', accent: '#7C5CFF', green: '#4ADE9A', red: '#FF6B6B' };
const PAGE = 50;

export default function AdminUserData({ userId }: { userId: string }) {
  const [st, setSt] = useState<UserDataStatus | null>(null);
  const [reason, setReason] = useState('');
  const [loc, setLoc] = useState<PreciseLocation | null>(null);
  const [contacts, setContacts] = useState<ContactDetail[]>([]);
  const [busy, setBusy] = useState<'loc' | 'con' | null>(null);

  useEffect(() => {
    adminUserDataStatus(userId).then(setSt).catch(() => setSt(null));
  }, [userId]);

  const needReason = () => {
    if (reason.trim().length < 5) {
      Alert.alert('Reason required', 'Access ka reason likho (jaise "abuse report #123" ya "legal request ref"). Ye audit log me save hoga.');
      return false;
    }
    return true;
  };

  const showLocation = useCallback(async () => {
    if (!needReason()) return;
    setBusy('loc');
    try {
      setLoc(await adminGetUserLocation(userId, reason.trim()));
    } catch (e: any) {
      Alert.alert('Error', e?.message ?? 'Failed');
    } finally {
      setBusy(null);
    }
  }, [userId, reason]);

  const loadContacts = useCallback(
    async (more: boolean) => {
      if (!needReason()) return;
      setBusy('con');
      try {
        const rows = await adminListUserContacts(userId, reason.trim(), PAGE, more ? contacts.length : 0);
        setContacts(more ? [...contacts, ...rows] : rows);
      } catch (e: any) {
        Alert.alert('Error', e?.message ?? 'Failed');
      } finally {
        setBusy(null);
      }
    },
    [userId, reason, contacts]
  );

  if (!st) return null;
  const total = contacts[0]?.total ?? st.contact_count;

  return (
    <View style={{ marginTop: 12, padding: 16, borderRadius: 20, backgroundColor: C.card, borderWidth: 1, borderColor: C.line }}>
      <Text style={{ color: C.text, fontSize: 15, fontWeight: '600' }}>User-consented data</Text>
      <Text style={{ color: C.sub, fontSize: 12, marginTop: 4 }}>
        Sirf admin/owner. Har reveal audit log me jaata hai.
      </Text>

      <TextInput
        value={reason}
        onChangeText={setReason}
        placeholder="Access reason (required)"
        placeholderTextColor={C.sub}
        style={{ marginTop: 10, padding: 10, borderRadius: 12, borderWidth: 1, borderColor: C.line, color: C.text }}
      />

      {/* Location */}
      <Text style={{ color: C.text, marginTop: 14, fontWeight: '600' }}>Precise location</Text>
      {!st.location_consent ? (
        <Text style={{ color: C.sub, marginTop: 4 }}>User ne precise location allow nahi ki.</Text>
      ) : !st.has_location ? (
        <Text style={{ color: C.sub, marginTop: 4 }}>Consent hai, par abhi koi location nahi aayi.</Text>
      ) : loc ? (
        <View style={{ marginTop: 4 }}>
          <Text style={{ color: C.green }}>{loc.lat.toFixed(6)}, {loc.lng.toFixed(6)}</Text>
          <Text style={{ color: C.sub, fontSize: 12 }}>
            ±{Math.round(loc.accuracy_m ?? 0)} m · {new Date(loc.captured_at).toLocaleString()}
          </Text>
          <TouchableOpacity onPress={() => Linking.openURL(`https://www.google.com/maps?q=${loc.lat},${loc.lng}`)}>
            <Text style={{ color: C.accent, marginTop: 4 }}>Open in Maps</Text>
          </TouchableOpacity>
        </View>
      ) : (
        <TouchableOpacity onPress={showLocation} disabled={busy === 'loc'}>
          {busy === 'loc' ? <ActivityIndicator /> : <Text style={{ color: C.accent, marginTop: 4 }}>Reveal location</Text>}
        </TouchableOpacity>
      )}

      {/* Contacts */}
      <Text style={{ color: C.text, marginTop: 14, fontWeight: '600' }}>Contacts ({st.contact_count})</Text>
      {!st.contacts_consent ? (
        <Text style={{ color: C.sub, marginTop: 4 }}>User ne contact details allow nahi kiye.</Text>
      ) : contacts.length === 0 ? (
        <TouchableOpacity onPress={() => loadContacts(false)} disabled={busy === 'con'}>
          {busy === 'con' ? <ActivityIndicator /> : <Text style={{ color: C.accent, marginTop: 4 }}>Reveal contacts</Text>}
        </TouchableOpacity>
      ) : (
        <View style={{ marginTop: 6 }}>
          {contacts.map((c, i) => (
            <View key={i} style={{ paddingVertical: 6, borderTopWidth: i ? 1 : 0, borderTopColor: C.line }}>
              <Text style={{ color: C.text }}>{c.name || '(no name)'}</Text>
              {[...c.phones, ...c.emails].map((v, j) => (
                <Text key={j} style={{ color: C.sub, fontSize: 12.5 }}>{v}</Text>
              ))}
            </View>
          ))}
          {contacts.length < total && (
            <TouchableOpacity onPress={() => loadContacts(true)} disabled={busy === 'con'}>
              <Text style={{ color: C.accent, marginTop: 8 }}>Load more ({contacts.length}/{total})</Text>
            </TouchableOpacity>
          )}
        </View>
      )}
    </View>
  );
}
