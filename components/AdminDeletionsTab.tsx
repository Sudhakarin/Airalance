// components/AdminDeletionsTab.tsx — Account deletion requests (admin / owner)
import { useCallback, useEffect, useState } from 'react';
import { View, Text, TouchableOpacity, ActivityIndicator, Alert, StyleSheet } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { supabase } from '../lib/supabase';

type Status = 'pending' | 'completed' | 'failed' | 'cancelled';
type Row = {
  id: number;
  user_id: string;
  email: string | null;
  username: string | null;
  full_name: string | null;
  phone: string | null;
  reason: string | null;
  details: string | null;
  status: Status;
  error: string | null;
  requested_at: string;
  scheduled_for: string;
  processed_at: string | null;
};

const PAGE = 30;
const FILTERS: { id: Status; label: string }[] = [
  { id: 'pending', label: 'Pending' },
  { id: 'completed', label: 'Deleted' },
  { id: 'failed', label: 'Failed' },
  { id: 'cancelled', label: 'Cancelled' },
];
const C = { card: '#121212', alt: '#17171A', line: '#1F1F23', text: '#FFFFFF', sub: 'rgba(255,255,255,0.6)', red: '#FF6B6B', amber: '#FFC857', green: '#34D399', violet: '#7C5CFF' };

function timeLeft(iso: string) {
  const ms = new Date(iso).getTime() - Date.now();
  if (ms <= 0) return 'due now';
  const h = Math.floor(ms / 3600000);
  const m = Math.floor((ms % 3600000) / 60000);
  return `${h}h ${m}m left`;
}

export default function AdminDeletionsTab({ onOpenUser }: { onOpenUser: (id: string) => void }) {
  const [status, setStatus] = useState<Status>('pending');
  const [rows, setRows] = useState<Row[] | null>(null);
  const [hasMore, setHasMore] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<number | null>(null);

  const load = useCallback(
    async (offset = 0) => {
      if (offset === 0) {
        setRows(null);
        setError(null);
      }
      const { data, error: err } = await supabase.rpc('admin_list_deletion_requests', {
        p_status: status,
        p_limit: PAGE,
        p_offset: offset,
      });
      if (err) {
        setError(err.message || 'Could not load');
        if (offset === 0) setRows([]);
        return;
      }
      const list = (data ?? []) as Row[];
      setRows((prev) => (offset === 0 ? list : [...(prev ?? []), ...list]));
      setHasMore(list.length === PAGE);
    },
    [status]
  );

  useEffect(() => {
    load(0);
  }, [load]);

  function cancel(r: Row) {
    Alert.alert(
      'Cancel deletion?',
      `${r.full_name || r.username || 'This user'}'s account will NOT be deleted.`,
      [
        { text: 'Keep request', style: 'cancel' },
        {
          text: 'Cancel deletion',
          style: 'destructive',
          onPress: async () => {
            setBusyId(r.id);
            const { error: e } = await supabase.rpc('admin_cancel_deletion', { p_id: r.id, p_note: null });
            setBusyId(null);
            if (e) return Alert.alert('Error', e.message || 'Failed');
            setRows((prev) => (prev ?? []).filter((x) => x.id !== r.id));
          },
        },
      ]
    );
  }

  return (
    <View style={{ paddingTop: 8 }}>
      <View style={s.filters}>
        {FILTERS.map((f) => (
          <TouchableOpacity
            key={f.id}
            style={[s.fchip, status === f.id && s.fchipOn]}
            onPress={() => setStatus(f.id)}
            activeOpacity={0.8}
          >
            <Text style={[s.fchipText, status === f.id && { color: C.text }]}>{f.label}</Text>
          </TouchableOpacity>
        ))}
      </View>

      {rows === null ? (
        <ActivityIndicator style={{ marginTop: 30 }} color={C.violet} />
      ) : error ? (
        <View style={s.empty}>
          <Text style={s.emptyText}>{error}</Text>
          <TouchableOpacity onPress={() => load(0)}>
            <Text style={{ color: C.violet, marginTop: 8 }}>Retry</Text>
          </TouchableOpacity>
        </View>
      ) : rows.length === 0 ? (
        <View style={s.empty}>
          <Ionicons name="trash-outline" size={26} color={C.sub} />
          <Text style={s.emptyText}>No {status} deletion requests</Text>
        </View>
      ) : (
        <>
          {rows.map((r) => (
            <View key={r.id} style={s.card}>
              <View style={s.rowTop}>
                <Text style={s.name} numberOfLines={1}>{r.full_name || '(no name)'}</Text>
                {r.status === 'pending' ? (
                  <Text style={[s.pill, { color: C.amber }]}>{timeLeft(r.scheduled_for)}</Text>
                ) : (
                  <Text style={[s.pill, { color: r.status === 'completed' ? C.green : r.status === 'failed' ? C.red : C.sub }]}>
                    {r.status}
                  </Text>
                )}
              </View>
              <Text style={s.sub}>@{r.username ?? '—'} · {r.email ?? '—'}</Text>
              {!!r.phone && <Text style={s.sub}>{r.phone}</Text>}
              {!!r.reason && <Text style={s.reason}>Reason: {r.reason}</Text>}
              {!!r.details && <Text style={s.details}>“{r.details}”</Text>}
              <Text style={s.meta}>
                Requested {new Date(r.requested_at).toLocaleString()}
                {r.processed_at ? ` · Processed ${new Date(r.processed_at).toLocaleString()}` : ''}
              </Text>
              {!!r.error && <Text style={[s.meta, { color: C.red }]}>Error: {r.error}</Text>}

              {(r.status === 'pending' || r.status === 'failed') && (
                <View style={s.actions}>
                  <TouchableOpacity onPress={() => onOpenUser(r.user_id)}>
                    <Text style={{ color: C.violet, fontSize: 13 }}>Open user</Text>
                  </TouchableOpacity>
                  {r.status === 'pending' && (
                    <TouchableOpacity onPress={() => cancel(r)} disabled={busyId === r.id}>
                      {busyId === r.id ? <ActivityIndicator /> : <Text style={{ color: C.red, fontSize: 13 }}>Cancel deletion</Text>}
                    </TouchableOpacity>
                  )}
                </View>
              )}
            </View>
          ))}
          {hasMore && (
            <TouchableOpacity onPress={() => load(rows.length)} style={{ alignItems: 'center', padding: 14 }}>
              <Text style={{ color: C.violet }}>Load more</Text>
            </TouchableOpacity>
          )}
        </>
      )}
    </View>
  );
}

const s = StyleSheet.create({
  filters: { flexDirection: 'row', gap: 8, marginBottom: 12, flexWrap: 'wrap' },
  fchip: { paddingHorizontal: 12, paddingVertical: 7, borderRadius: 999, borderWidth: 1, borderColor: C.line, backgroundColor: C.alt },
  fchipOn: { borderColor: C.violet, backgroundColor: 'rgba(124,92,255,0.18)' },
  fchipText: { fontSize: 12.5, color: C.sub },
  card: { padding: 14, borderRadius: 16, backgroundColor: C.card, borderWidth: 1, borderColor: C.line, marginBottom: 10 },
  rowTop: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', gap: 8 },
  name: { flex: 1, fontSize: 15, fontWeight: '600', color: C.text },
  pill: { fontSize: 12, fontWeight: '600' },
  sub: { fontSize: 12.5, color: C.sub, marginTop: 3 },
  reason: { fontSize: 13, color: C.text, marginTop: 8 },
  details: { fontSize: 12.5, color: C.sub, marginTop: 4, fontStyle: 'italic' },
  meta: { fontSize: 11.5, color: C.sub, marginTop: 8 },
  actions: { flexDirection: 'row', justifyContent: 'space-between', marginTop: 12, paddingTop: 10, borderTopWidth: 1, borderTopColor: C.line },
  empty: { alignItems: 'center', paddingVertical: 40, gap: 8 },
  emptyText: { color: C.sub, fontSize: 13 },
});
