// components/AdminPanel.tsx
// Management (Admin) panel — Settings ke andar sirf admins ko dikhta hai.
// Overview · Users (search/filter) · User detail (verify, ban, restrict, shadowban, notes)
// · Verification requests · Ban appeals · Audit log · Team (owner only)
// Ban: category + duration (1/7/30 days ya permanent) — banned user login karke popup + appeal dekhta hai
//
// ✅ Saari permissions server par enforce hoti hain (admin.sql). Yahan ka role sirf UI ke liye.
// ✅ Settings ke design (UI colors, rows, groups, dialogs) jaisa hi look.

import { useCallback, useEffect, useRef, useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  TouchableOpacity,
  ActivityIndicator,
  TextInput,
  Switch,
  Modal,
  Pressable,
  Image,
  Share,
  Alert,
  Keyboard,
  KeyboardAvoidingView,
  Platform,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { LinearGradient } from 'expo-linear-gradient';
import { COLORS, FONTS, RADII } from '../constants/theme';
import { isOnline } from '../lib/network';
import Avatar from './Avatar';
import VerifiedBadge from './VerifiedBadge';
import AdminUserData from './AdminUserData';
import {
  roleRank,
  errMsg,
  adminStats,
  adminListUsers,
  adminGetUser,
  adminSetVerified,
  adminSetFlag,
  adminBanUser,
  adminListRequests,
  adminReviewRequest,
  adminListAdmins,
  adminAddAdmin,
  adminRemoveAdmin,
  adminAuditLog,
  adminListAppeals,
  adminReviewAppeal,
  adminSetNote,
  getSelfieUrl,
} from '../lib/admin';
import type {
  AdminRole,
  AdminStats,
  AdminUserRow,
  AdminUserDetail,
  AdminMember,
  AuditEntry,
  RequestStatus,
  UserFilter,
  UserFlag,
  VerificationRequestRow,
  AppealRow,
  AppealStatus,
} from '../lib/admin';

/* ================= CONSTANTS & HELPERS ================= */

type IconName = keyof typeof Ionicons.glyphMap;
type TabId = 'overview' | 'users' | 'requests' | 'appeals' | 'log' | 'team';

const VIOLET = '#7C5CFF';

const UI = {
  bg: '#000000',
  card: '#121212',
  cardAlt: '#17171A',
  border: '#1F1F23',
  muted: 'rgba(255,255,255,0.55)',
  faint: 'rgba(255,255,255,0.32)',
  amber: '#FFC857',
  green: '#34D399',
  red: '#F87171',
  teal: '#3EE0C4',
  blue: '#6EA8FF',
};

const PAGE = 25;

function withAlpha(hex: string, a: number) {
  const h = hex.replace('#', '');
  if (h.length !== 6) return hex;
  const r = parseInt(h.slice(0, 2), 16);
  const g = parseInt(h.slice(2, 4), 16);
  const b = parseInt(h.slice(4, 6), 16);
  return `rgba(${r},${g},${b},${a})`;
}

function timeAgo(iso: string | null | undefined): string {
  if (!iso) return '—';
  const t = new Date(iso).getTime();
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

function formatDate(iso: string | null | undefined): string {
  if (!iso) return '—';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '—';
  return d.toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' });
}

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

async function copyText(text: string, label: string) {
  let ok = false;
  try {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const Clipboard = require('expo-clipboard');
    await Clipboard.setStringAsync(text);
    ok = true;
  } catch {}
  if (ok) {
    Alert.alert('Copied', `${label} copied.`);
  } else {
    try {
      await Share.share({ message: text });
    } catch {}
  }
}

function ensureOnline(): boolean {
  if (isOnline()) return true;
  Alert.alert('Offline', 'Connect to the internet to do this.');
  return false;
}

const ROLE_META: Record<AdminRole, { label: string; color: string }> = {
  owner: { label: 'Owner', color: UI.amber },
  admin: { label: 'Admin', color: VIOLET },
  moderator: { label: 'Moderator', color: UI.blue },
};

function describeAction(a: string): { label: string; icon: IconName; color: string } {
  switch (a) {
    case 'verify':
      return { label: 'Verified account', icon: 'checkmark-circle', color: UI.teal };
    case 'unverify':
      return { label: 'Removed verification', icon: 'close-circle', color: UI.muted };
    case 'ban':
      return { label: 'Banned account', icon: 'ban', color: UI.red };
    case 'unban':
      return { label: 'Unbanned account', icon: 'lock-open', color: UI.green };
    case 'messaging_restricted:on':
      return { label: 'Restricted messaging', icon: 'chatbubble-ellipses', color: UI.amber };
    case 'messaging_restricted:off':
      return { label: 'Lifted messaging restriction', icon: 'chatbubble-ellipses-outline', color: UI.green };
    case 'feature_restricted:on':
      return { label: 'Restricted features', icon: 'construct', color: UI.amber };
    case 'feature_restricted:off':
      return { label: 'Lifted feature restriction', icon: 'construct-outline', color: UI.green };
    case 'shadowbanned:on':
      return { label: 'Shadowbanned', icon: 'eye-off', color: UI.amber };
    case 'shadowbanned:off':
      return { label: 'Removed shadowban', icon: 'eye-outline', color: UI.green };
    case 'request:approved':
      return { label: 'Approved verification', icon: 'shield-checkmark', color: UI.teal };
    case 'request:rejected':
      return { label: 'Rejected verification', icon: 'shield-outline', color: UI.red };
    case 'admin:add':
      return { label: 'Added to admin team', icon: 'person-add', color: VIOLET };
    case 'admin:remove':
      return { label: 'Removed from admin team', icon: 'person-remove', color: UI.red };
    case 'ban:expired':
      return { label: 'Ban expired automatically', icon: 'timer-outline', color: UI.green };
    case 'appeal:submitted':
      return { label: 'Appeal submitted', icon: 'megaphone-outline', color: UI.amber };
    case 'appeal:approved':
      return { label: 'Approved appeal (ban lifted)', icon: 'checkmark-circle', color: UI.green };
    case 'appeal:rejected':
      return { label: 'Rejected appeal', icon: 'close-circle', color: UI.red };
    case 'note:update':
      return { label: 'Updated admin note', icon: 'document-text-outline', color: UI.muted };
    case 'view_precise_location':
      return { label: 'Viewed precise location', icon: 'location-outline', color: UI.amber };
    case 'view_contact_details':
      return { label: 'Viewed contact details', icon: 'people-outline', color: UI.amber };
    case 'export_user_bundle':
      return { label: 'Exported user data (legal request)', icon: 'download-outline', color: UI.amber };
    case 'view_device_info':
      return { label: 'Viewed device & IP info', icon: 'phone-portrait-outline', color: UI.amber };
    default:
      return { label: a, icon: 'ellipse-outline', color: UI.muted };
  }
}

/* ================= SMALL SHARED UI ================= */

function Pill({
  label,
  color,
  icon,
}: {
  label: string;
  color: string;
  icon?: IconName;
}) {
  return (
    <View style={[styles.pill, { backgroundColor: withAlpha(color, 0.14) }]}>
      {!!icon && <Ionicons name={icon} size={11} color={color} />}
      <Text style={[styles.pillText, { color }]}>{label}</Text>
    </View>
  );
}

function SectionLabel({ children }: { children: React.ReactNode }) {
  return <Text style={styles.sectionLabel}>{children}</Text>;
}

function Group({ children }: { children: React.ReactNode }) {
  return <View style={styles.group}>{children}</View>;
}

function Sep() {
  return <View style={styles.sep} />;
}

function EmptyCard({
  icon,
  title,
  sub,
  onRetry,
}: {
  icon: IconName;
  title: string;
  sub?: string;
  onRetry?: () => void;
}) {
  return (
    <View style={styles.centerCard}>
      <View style={styles.pillIcon}>
        <Ionicons name={icon} size={24} color={UI.muted} />
      </View>
      <Text style={styles.centerTitle}>{title}</Text>
      {!!sub && <Text style={styles.centerSub}>{sub}</Text>}
      {onRetry && (
        <TouchableOpacity style={styles.retryBtn} onPress={onRetry} activeOpacity={0.8}>
          <Text style={styles.retryBtnText}>Try again</Text>
        </TouchableOpacity>
      )}
    </View>
  );
}

function SkeletonRows({ n = 4 }: { n?: number }) {
  return (
    <View style={{ gap: 10 }}>
      {Array.from({ length: n }).map((_, i) => (
        <View key={i} style={styles.skelRow}>
          <View style={styles.skelAvatar} />
          <View style={{ flex: 1, gap: 7 }}>
            <View style={styles.skelLine} />
            <View style={[styles.skelLine, { width: '40%' }]} />
          </View>
        </View>
      ))}
    </View>
  );
}

function Chips<T extends string>({
  items,
  value,
  onChange,
}: {
  items: { id: T; label: string }[];
  value: T;
  onChange: (v: T) => void;
}) {
  return (
    <ScrollView
      horizontal
      showsHorizontalScrollIndicator={false}
      style={{ marginHorizontal: -16 }}
      contentContainerStyle={{ paddingHorizontal: 16, gap: 8 }}
      keyboardShouldPersistTaps="handled"
    >
      {items.map((it) => {
        const on = it.id === value;
        return (
          <TouchableOpacity
            key={it.id}
            style={[styles.chip, on && styles.chipOn]}
            onPress={() => onChange(it.id)}
            activeOpacity={0.8}
          >
            <Text style={[styles.chipText, on && styles.chipTextOn]}>{it.label}</Text>
          </TouchableOpacity>
        );
      })}
    </ScrollView>
  );
}

function PromptDialog({
  visible,
  icon,
  tone,
  title,
  message,
  confirmLabel,
  inputPlaceholder,
  onConfirm,
  onCancel,
}: {
  visible: boolean;
  icon: IconName;
  tone: 'danger' | 'success' | 'primary';
  title: string;
  message: string;
  confirmLabel: string;
  inputPlaceholder?: string;
  onConfirm: (text: string) => void;
  onCancel: () => void;
}) {
  const [text, setText] = useState('');
  useEffect(() => {
    if (visible) setText('');
  }, [visible]);
  const color = tone === 'danger' ? COLORS.danger : tone === 'success' ? UI.green : COLORS.violet;
  const wrapBg = tone === 'danger' ? '#EF4444' : tone === 'success' ? '#34D399' : VIOLET;

  return (
    <Modal
      visible={visible}
      transparent
      animationType="fade"
      statusBarTranslucent
      onRequestClose={onCancel}
    >
      <KeyboardAvoidingView
        style={{ flex: 1 }}
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      >
        <Pressable
          style={styles.dialogBackdrop}
          onPress={() => {
            Keyboard.dismiss();
            onCancel();
          }}
        >
          <Pressable style={styles.dialogCard} onPress={(e) => e.stopPropagation()}>
            <View style={[styles.dialogIconWrap, { backgroundColor: withAlpha(wrapBg, 0.15) }]}>
              <Ionicons name={icon} size={22} color={color} />
            </View>
            <Text style={styles.dialogTitle}>{title}</Text>
            <Text style={styles.dialogSub}>{message}</Text>
            {inputPlaceholder !== undefined && (
              <TextInput
                style={styles.dialogInput}
                value={text}
                onChangeText={setText}
                placeholder={inputPlaceholder}
                placeholderTextColor={UI.faint}
                multiline
                maxLength={300}
                underlineColorAndroid="transparent"
              />
            )}
            <View style={styles.dialogButtons}>
              <TouchableOpacity style={styles.dialogBtnSecondary} onPress={onCancel} activeOpacity={0.75}>
                <Text style={styles.dialogBtnSecondaryText}>Cancel</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={[styles.dialogBtn, { backgroundColor: color }]}
                onPress={() => {
                  Keyboard.dismiss();
                  onConfirm(text.trim());
                }}
                activeOpacity={0.75}
              >
                <Text style={styles.dialogBtnText}>{confirmLabel}</Text>
              </TouchableOpacity>
            </View>
          </Pressable>
        </Pressable>
      </KeyboardAvoidingView>
    </Modal>
  );
}

const BAN_CATEGORIES = ['Spam', 'Harassment', 'Fake account', 'Scam or fraud', 'Other'];
const BAN_DURATIONS: { label: string; days: number | null }[] = [
  { label: '1 day', days: 1 },
  { label: '7 days', days: 7 },
  { label: '30 days', days: 30 },
  { label: 'Permanent', days: null },
];

function BanDialog({
  visible,
  username,
  onConfirm,
  onCancel,
}: {
  visible: boolean;
  username: string;
  onConfirm: (o: { reason: string; category: string; days: number | null }) => void;
  onCancel: () => void;
}) {
  const [cat, setCat] = useState(BAN_CATEGORIES[0]);
  const [days, setDays] = useState<number | null>(null);
  const [reason, setReason] = useState('');
  useEffect(() => {
    if (visible) {
      setCat(BAN_CATEGORIES[0]);
      setDays(null);
      setReason('');
    }
  }, [visible]);

  return (
    <Modal visible={visible} transparent animationType="fade" statusBarTranslucent onRequestClose={onCancel}>
      <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
        <Pressable
          style={styles.dialogBackdrop}
          onPress={() => {
            Keyboard.dismiss();
            onCancel();
          }}
        >
          <Pressable style={styles.dialogCard} onPress={(e) => e.stopPropagation()}>
            <View style={[styles.dialogIconWrap, { backgroundColor: withAlpha('#EF4444', 0.15) }]}>
              <Ionicons name="ban-outline" size={22} color={COLORS.danger} />
            </View>
            <Text style={styles.dialogTitle}>Ban @{username}?</Text>
            <Text style={styles.dialogSub}>
              They can still log in, but will only see a ban notice with Logout and Appeal.
            </Text>

            <Text style={styles.dLabel}>Category</Text>
            <View style={styles.dChipWrap}>
              {BAN_CATEGORIES.map((c) => (
                <TouchableOpacity
                  key={c}
                  style={[styles.dChip, cat === c && styles.dChipOn]}
                  onPress={() => setCat(c)}
                  activeOpacity={0.8}
                >
                  <Text style={[styles.dChipText, cat === c && { color: '#FFFFFF' }]}>{c}</Text>
                </TouchableOpacity>
              ))}
            </View>

            <Text style={styles.dLabel}>Duration</Text>
            <View style={styles.dChipWrap}>
              {BAN_DURATIONS.map((d) => (
                <TouchableOpacity
                  key={d.label}
                  style={[styles.dChip, days === d.days && styles.dChipOn]}
                  onPress={() => setDays(d.days)}
                  activeOpacity={0.8}
                >
                  <Text style={[styles.dChipText, days === d.days && { color: '#FFFFFF' }]}>{d.label}</Text>
                </TouchableOpacity>
              ))}
            </View>

            <TextInput
              style={styles.dialogInput}
              value={reason}
              onChangeText={setReason}
              placeholder="Reason shown to the user (optional)"
              placeholderTextColor={UI.faint}
              multiline
              maxLength={300}
              underlineColorAndroid="transparent"
            />

            <View style={styles.dialogButtons}>
              <TouchableOpacity style={styles.dialogBtnSecondary} onPress={onCancel} activeOpacity={0.75}>
                <Text style={styles.dialogBtnSecondaryText}>Cancel</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={[styles.dialogBtn, { backgroundColor: COLORS.danger }]}
                onPress={() => {
                  Keyboard.dismiss();
                  onConfirm({ reason: reason.trim(), category: cat, days });
                }}
                activeOpacity={0.75}
              >
                <Text style={styles.dialogBtnText}>Ban</Text>
              </TouchableOpacity>
            </View>
          </Pressable>
        </Pressable>
      </KeyboardAvoidingView>
    </Modal>
  );
}

const PERM_ORDER = ['notifications', 'camera', 'microphone', 'photos', 'contacts', 'location'];
const PERM_META: Record<string, { label: string; icon: IconName }> = {
  notifications: { label: 'Notifications', icon: 'notifications-outline' },
  camera: { label: 'Camera', icon: 'camera-outline' },
  microphone: { label: 'Microphone', icon: 'mic-outline' },
  photos: { label: 'Photos and media', icon: 'images-outline' },
  contacts: { label: 'Contacts', icon: 'people-outline' },
  location: { label: 'Location', icon: 'location-outline' },
};

function permInfo(
  status?: string,
  canAsk?: boolean | null
): { label: string; color: string } {
  switch (status) {
    case 'granted':
      return { label: 'Allowed', color: UI.green };
    case 'limited':
      return { label: 'Limited', color: UI.blue };
    case 'denied':
      return {
        label: canAsk === false ? 'Denied (blocked)' : 'Denied',
        color: UI.red,
      };
    case 'undetermined':
      return { label: 'Not asked yet', color: UI.amber };
    default:
      return { label: 'No data', color: '#8A8F9C' };
  }
}

function StatusPills({ u }: { u: Pick<AdminUserRow, 'account_locked' | 'shadowbanned' | 'messaging_restricted' | 'feature_restricted' | 'admin_role'> }) {
  const restricted = u.messaging_restricted || u.feature_restricted;
  if (!u.account_locked && !u.shadowbanned && !restricted && !u.admin_role) return null;
  return (
    <View style={styles.pillRow}>
      {u.admin_role && (
        <Pill label={ROLE_META[u.admin_role].label} color={ROLE_META[u.admin_role].color} icon="shield" />
      )}
      {u.account_locked && <Pill label="Banned" color={UI.red} icon="ban" />}
      {u.shadowbanned && <Pill label="Shadowbanned" color={UI.amber} icon="eye-off" />}
      {restricted && <Pill label="Restricted" color={UI.amber} icon="alert-circle" />}
    </View>
  );
}

/* ================= ROOT ================= */

type Props = {
  myId: string;
  role: AdminRole;
  /** Settings ka back button pehle yahan puchta hai: true = maine handle kar liya */
  registerBack: (fn: (() => boolean) | null) => void;
};

export default function AdminPanel({ myId, role, registerBack }: Props) {
  const rank = roleRank(role);

  const [tab, setTab] = useState<TabId>('overview');
  const [visited, setVisited] = useState<TabId[]>(['overview']);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const selectedRef = useRef<string | null>(null);

  const [stats, setStats] = useState<AdminStats | null>(null);
  const [statsError, setStatsError] = useState<string | null>(null);
  const [patches, setPatches] = useState<Record<string, Partial<AdminUserRow>>>({});
  const [filterReq, setFilterReq] = useState<{ filter: UserFilter; nonce: number } | null>(null);

  useEffect(() => {
    selectedRef.current = selectedId;
  }, [selectedId]);

  useEffect(() => {
    registerBack(() => {
      if (selectedRef.current) {
        setSelectedId(null);
        return true;
      }
      return false;
    });
    return () => registerBack(null);
  }, [registerBack]);

  const loadStats = useCallback(async () => {
    try {
      setStats(await adminStats());
      setStatsError(null);
    } catch (e) {
      setStatsError(errMsg(e));
    }
  }, []);

  useEffect(() => {
    loadStats();
  }, [loadStats]);

  const goTab = useCallback((t: TabId) => {
    setTab(t);
    setVisited((v) => (v.includes(t) ? v : [...v, t]));
  }, []);

  const openUsersWith = useCallback(
    (f: UserFilter) => {
      setFilterReq({ filter: f, nonce: Date.now() });
      goTab('users');
    },
    [goTab]
  );

  const onPatch = useCallback((id: string, p: Partial<AdminUserRow>) => {
    setPatches((prev) => ({ ...prev, [id]: { ...prev[id], ...p } }));
  }, []);

  const closeDetail = useCallback(() => {
    setSelectedId(null);
    loadStats();
  }, [loadStats]);

  const tabs: { id: TabId; label: string; icon: IconName }[] = [
    { id: 'overview', label: 'Overview', icon: 'grid-outline' },
    { id: 'users', label: 'Users', icon: 'people-outline' },
  ];
  if (rank >= 2) {
    tabs.push({ id: 'requests', label: 'Requests', icon: 'shield-checkmark-outline' });
    tabs.push({ id: 'appeals', label: 'Appeals', icon: 'megaphone-outline' });
    tabs.push({ id: 'log', label: 'Activity', icon: 'time-outline' });
  }
  if (rank >= 3) tabs.push({ id: 'team', label: 'Team', icon: 'key-outline' });

  const pending = stats?.pending ?? 0;
  const badgeFor = (id: TabId) =>
    id === 'requests' ? pending : id === 'appeals' ? stats?.appeals ?? 0 : 0;

  return (
    <View>
      {selectedId && (
        <UserDetail
          key={selectedId}
          userId={selectedId}
          myId={myId}
          myRole={role}
          onClose={closeDetail}
          onPatch={onPatch}
        />
      )}

      <View style={selectedId ? styles.hidden : undefined}>
        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          style={{ marginHorizontal: -16 }}
          contentContainerStyle={styles.tabBar}
        >
          {tabs.map((t) => {
            const on = t.id === tab;
            return (
              <TouchableOpacity
                key={t.id}
                style={[styles.tab, on && styles.tabOn]}
                onPress={() => goTab(t.id)}
                activeOpacity={0.8}
              >
                <Ionicons name={t.icon} size={15} color={on ? '#FFFFFF' : UI.muted} />
                <Text style={[styles.tabText, on && styles.tabTextOn]}>{t.label}</Text>
                {badgeFor(t.id) > 0 && (
                  <View style={styles.tabBadge}>
                    <Text style={styles.tabBadgeText}>{badgeFor(t.id) > 99 ? '99+' : badgeFor(t.id)}</Text>
                  </View>
                )}
              </TouchableOpacity>
            );
          })}
        </ScrollView>

        {visited.includes('overview') && (
          <View style={tab !== 'overview' ? styles.hidden : undefined}>
            <OverviewTab
              role={role}
              stats={stats}
              error={statsError}
              onRetry={loadStats}
              onOpenUsers={openUsersWith}
              onOpenRequests={() => goTab('requests')}
              onOpenAppeals={() => goTab('appeals')}
            />
          </View>
        )}
        {visited.includes('users') && (
          <View style={tab !== 'users' ? styles.hidden : undefined}>
            <UsersTab patches={patches} externalFilter={filterReq} onOpen={setSelectedId} />
          </View>
        )}
        {rank >= 2 && visited.includes('requests') && (
          <View style={tab !== 'requests' ? styles.hidden : undefined}>
            <RequestsTab onOpenUser={setSelectedId} onChanged={loadStats} />
          </View>
        )}
        {rank >= 2 && visited.includes('appeals') && (
          <View style={tab !== 'appeals' ? styles.hidden : undefined}>
            <AppealsTab onOpenUser={setSelectedId} onChanged={loadStats} />
          </View>
        )}
        {rank >= 2 && visited.includes('log') && (
          <View style={tab !== 'log' ? styles.hidden : undefined}>
            <LogTab onOpenUser={setSelectedId} />
          </View>
        )}
        {rank >= 3 && visited.includes('team') && (
          <View style={tab !== 'team' ? styles.hidden : undefined}>
            <TeamTab myId={myId} onChanged={loadStats} />
          </View>
        )}
      </View>
    </View>
  );
}

/* ================= OVERVIEW ================= */

function OverviewTab({
  role,
  stats,
  error,
  onRetry,
  onOpenUsers,
  onOpenRequests,
  onOpenAppeals,
}: {
  role: AdminRole;
  stats: AdminStats | null;
  error: string | null;
  onRetry: () => void;
  onOpenUsers: (f: UserFilter) => void;
  onOpenRequests: () => void;
  onOpenAppeals: () => void;
}) {
  const rank = roleRank(role);
  const meta = ROLE_META[role];

  const days = ['S', 'M', 'T', 'W', 'T', 'F', 'S'];
  const labels = Array.from({ length: 7 }).map((_, i) => {
    const d = new Date();
    d.setDate(d.getDate() - (6 - i));
    return days[d.getDay()];
  });

  const cards: { key: string; label: string; value: number; icon: IconName; tint: string; filter?: UserFilter }[] = stats
    ? [
        { key: 'total', label: 'Total users', value: stats.total, icon: 'people', tint: VIOLET, filter: 'all' },
        { key: 'week', label: 'New this week', value: stats.week, icon: 'trending-up', tint: UI.blue },
        { key: 'verified', label: 'Verified', value: stats.verified, icon: 'checkmark-circle', tint: UI.teal, filter: 'verified' },
        { key: 'banned', label: 'Banned', value: stats.banned, icon: 'ban', tint: UI.red, filter: 'banned' },
        { key: 'restricted', label: 'Restricted', value: stats.restricted, icon: 'alert-circle', tint: UI.amber, filter: 'restricted' },
        { key: 'shadow', label: 'Shadowbanned', value: stats.shadowbanned, icon: 'eye-off', tint: '#B79CFF', filter: 'shadowbanned' },
      ]
    : [];

  const max = stats ? Math.max(1, ...stats.signups) : 1;

  return (
    <View>
      <LinearGradient
        colors={['rgba(124,92,255,0.30)', 'rgba(244,96,122,0.10)', 'rgba(18,18,18,0)']}
        start={{ x: 0, y: 0 }}
        end={{ x: 1, y: 1 }}
        style={styles.hero}
      >
        <View style={[styles.heroIcon, { backgroundColor: withAlpha(VIOLET, 0.55) }]}>
          <Ionicons name="shield-checkmark" size={24} color="#FFFFFF" />
        </View>
        <View style={{ flex: 1 }}>
          <Text style={styles.heroTitle}>Management</Text>
          <Text style={styles.heroSub}>Moderate users and keep Airalance safe</Text>
        </View>
        <Pill label={meta.label} color={meta.color} />
      </LinearGradient>

      {!stats && !error && (
        <View style={{ marginTop: 14 }}>
          <SkeletonRows n={3} />
        </View>
      )}

      {!stats && !!error && (
        <View style={{ marginTop: 14 }}>
          <EmptyCard icon="cloud-offline-outline" title="Couldn't load overview" sub={error} onRetry={onRetry} />
        </View>
      )}

      {!!stats && (
        <>
          {rank >= 2 && stats.pending > 0 && (
            <TouchableOpacity style={styles.alertCard} onPress={onOpenRequests} activeOpacity={0.85}>
              <View style={[styles.rowIcon, { backgroundColor: withAlpha(UI.amber, 0.16) }]}>
                <Ionicons name="shield-checkmark-outline" size={19} color={UI.amber} />
              </View>
              <View style={{ flex: 1 }}>
                <Text style={styles.rowTitle}>
                  {stats.pending} verification {stats.pending === 1 ? 'request' : 'requests'} waiting
                </Text>
                <Text style={styles.rowSub}>Review selfies and approve or reject</Text>
              </View>
              <Ionicons name="chevron-forward" size={18} color={UI.faint} />
            </TouchableOpacity>
          )}

          {rank >= 2 && stats.appeals > 0 && (
            <TouchableOpacity
              style={[styles.alertCard, { backgroundColor: 'rgba(239,68,68,0.08)', borderColor: 'rgba(239,68,68,0.3)' }]}
              onPress={onOpenAppeals}
              activeOpacity={0.85}
            >
              <View style={[styles.rowIcon, { backgroundColor: withAlpha(UI.red, 0.16) }]}>
                <Ionicons name="megaphone-outline" size={19} color={UI.red} />
              </View>
              <View style={{ flex: 1 }}>
                <Text style={styles.rowTitle}>
                  {stats.appeals} ban {stats.appeals === 1 ? 'appeal' : 'appeals'} waiting
                </Text>
                <Text style={styles.rowSub}>Decide whether to lift or keep the ban</Text>
              </View>
              <Ionicons name="chevron-forward" size={18} color={UI.faint} />
            </TouchableOpacity>
          )}

          <View style={styles.statGrid}>
            {cards.map((c) => (
              <TouchableOpacity
                key={c.key}
                style={styles.statCard}
                activeOpacity={c.filter ? 0.8 : 1}
                onPress={() => c.filter && onOpenUsers(c.filter)}
              >
                <View style={[styles.statIcon, { backgroundColor: withAlpha(c.tint, 0.16) }]}>
                  <Ionicons name={c.icon} size={17} color={c.tint} />
                </View>
                <Text style={styles.statValue}>{c.value.toLocaleString()}</Text>
                <Text style={styles.statLabel}>{c.label}</Text>
              </TouchableOpacity>
            ))}
          </View>

          <View style={styles.chartCard}>
            <View style={styles.chartHead}>
              <View style={{ flex: 1 }}>
                <Text style={styles.rowTitle}>New signups</Text>
                <Text style={styles.rowSub}>Last 7 days</Text>
              </View>
              <View style={{ alignItems: 'flex-end' }}>
                <Text style={styles.chartTotal}>+{stats.week}</Text>
                <Text style={styles.rowSub}>{stats.today} today</Text>
              </View>
            </View>
            <View style={styles.chartRow}>
              {stats.signups.map((v, i) => {
                const last = i === stats.signups.length - 1;
                return (
                  <View key={i} style={styles.chartCol}>
                    <Text style={styles.chartVal}>{v}</Text>
                    <View
                      style={[
                        styles.chartBar,
                        {
                          height: Math.max(4, (v / max) * 84),
                          backgroundColor: last ? VIOLET : withAlpha(VIOLET, 0.35),
                        },
                      ]}
                    />
                    <Text style={[styles.chartLabel, last && { color: '#FFFFFF' }]}>{labels[i]}</Text>
                  </View>
                );
              })}
            </View>
          </View>

          <SectionLabel>Quick actions</SectionLabel>
          <Group>
            <QuickRow icon="people-outline" tint={VIOLET} title="Browse all users" onPress={() => onOpenUsers('all')} />
            <Sep />
            <QuickRow icon="search-outline" tint={UI.blue} title="Find banned accounts" onPress={() => onOpenUsers('banned')} />
            <Sep />
            <QuickRow icon="shield-outline" tint={UI.amber} title="Team & staff accounts" onPress={() => onOpenUsers('admins')} />
          </Group>
        </>
      )}
    </View>
  );
}

function QuickRow({
  icon,
  tint,
  title,
  onPress,
}: {
  icon: IconName;
  tint: string;
  title: string;
  onPress: () => void;
}) {
  return (
    <TouchableOpacity style={styles.row} onPress={onPress} activeOpacity={0.7}>
      <View style={[styles.rowIcon, { backgroundColor: withAlpha(tint, 0.16) }]}>
        <Ionicons name={icon} size={19} color={tint} />
      </View>
      <Text style={[styles.rowTitle, { flex: 1 }]}>{title}</Text>
      <Ionicons name="chevron-forward" size={18} color={UI.faint} />
    </TouchableOpacity>
  );
}

/* ================= USERS ================= */

const USER_FILTERS: { id: UserFilter; label: string }[] = [
  { id: 'all', label: 'All' },
  { id: 'verified', label: 'Verified' },
  { id: 'unverified', label: 'Not verified' },
  { id: 'banned', label: 'Banned' },
  { id: 'restricted', label: 'Restricted' },
  { id: 'shadowbanned', label: 'Shadowbanned' },
  { id: 'admins', label: 'Staff' },
];

function UsersTab({
  patches,
  externalFilter,
  onOpen,
}: {
  patches: Record<string, Partial<AdminUserRow>>;
  externalFilter: { filter: UserFilter; nonce: number } | null;
  onOpen: (id: string) => void;
}) {
  const [query, setQuery] = useState('');
  const [debounced, setDebounced] = useState('');
  const [filter, setFilter] = useState<UserFilter>('all');
  const [rows, setRows] = useState<AdminUserRow[] | null>(null);
  const [hasMore, setHasMore] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const reqId = useRef(0);
  const countRef = useRef(0);

  useEffect(() => {
    countRef.current = rows?.length ?? 0;
  }, [rows]);

  useEffect(() => {
    const t = setTimeout(() => setDebounced(query), 350);
    return () => clearTimeout(t);
  }, [query]);

  useEffect(() => {
    if (externalFilter) {
      setFilter(externalFilter.filter);
      setQuery('');
      setDebounced('');
    }
  }, [externalFilter]);

  const load = useCallback(
    async (reset: boolean) => {
      const id = ++reqId.current;
      if (reset) {
        setRows(null);
        setError(null);
      } else {
        setLoadingMore(true);
      }
      try {
        const offset = reset ? 0 : countRef.current;
        const data = await adminListUsers(debounced, filter, PAGE, offset);
        if (id !== reqId.current) return;
        setRows((prev) => (reset ? data : [...(prev ?? []), ...data]));
        setHasMore(data.length === PAGE);
      } catch (e) {
        if (id !== reqId.current) return;
        setError(errMsg(e));
        if (reset) setRows([]);
      } finally {
        if (id === reqId.current) setLoadingMore(false);
      }
    },
    [debounced, filter]
  );

  useEffect(() => {
    load(true);
  }, [load]);

  return (
    <View>
      <View style={styles.searchWrap}>
        <Ionicons name="search" size={17} color={UI.faint} />
        <TextInput
          style={styles.searchInput}
          value={query}
          onChangeText={setQuery}
          placeholder="Search name, @username or email"
          placeholderTextColor={UI.faint}
          autoCapitalize="none"
          autoCorrect={false}
          returnKeyType="search"
          underlineColorAndroid="transparent"
        />
        {query.length > 0 && (
          <TouchableOpacity onPress={() => setQuery('')} hitSlop={10}>
            <Ionicons name="close-circle" size={17} color={UI.faint} />
          </TouchableOpacity>
        )}
      </View>

      <View style={{ marginTop: 12 }}>
        <Chips items={USER_FILTERS} value={filter} onChange={setFilter} />
      </View>

      <View style={{ marginTop: 14 }}>
        {rows === null ? (
          <SkeletonRows />
        ) : error && rows.length === 0 ? (
          <EmptyCard icon="cloud-offline-outline" title="Couldn't load users" sub={error} onRetry={() => load(true)} />
        ) : rows.length === 0 ? (
          <EmptyCard
            icon="people-outline"
            title="No users found"
            sub={debounced ? `Nothing matches "${debounced}".` : 'Nobody in this list yet.'}
          />
        ) : (
          <>
            <Text style={styles.listCount}>
              {rows.length}
              {hasMore ? '+' : ''} {rows.length === 1 ? 'user' : 'users'}
            </Text>
            <Group>
              {rows.map((r, i) => {
                const u = { ...r, ...patches[r.id] } as AdminUserRow;
                return (
                  <View key={r.id}>
                    {i > 0 && <View style={styles.sepFull} />}
                    <TouchableOpacity style={styles.userRow} onPress={() => onOpen(r.id)} activeOpacity={0.7}>
                      <Avatar name={u.display_name} color={u.avatar_color} avatarUrl={u.avatar_url} size={44} />
                      <View style={styles.userInfo}>
                        <View style={styles.nameRow}>
                          <Text style={styles.userName} numberOfLines={1}>
                            {u.display_name || u.username}
                          </Text>
                          {u.verified && (
                            <View style={{ marginLeft: 3 }}>
                              <VerifiedBadge size={14} />
                            </View>
                          )}
                        </View>
                        <Text style={styles.userSub} numberOfLines={1}>
                          @{u.username}
                          {u.email ? ` · ${u.email}` : ''}
                        </Text>
                        <StatusPills u={u} />
                      </View>
                      <Ionicons name="chevron-forward" size={18} color={UI.faint} />
                    </TouchableOpacity>
                  </View>
                );
              })}
            </Group>
            {hasMore && (
              <TouchableOpacity
                style={styles.moreBtn}
                onPress={() => load(false)}
                disabled={loadingMore}
                activeOpacity={0.8}
              >
                {loadingMore ? (
                  <ActivityIndicator size="small" color="#fff" />
                ) : (
                  <Text style={styles.moreBtnText}>Load more</Text>
                )}
              </TouchableOpacity>
            )}
          </>
        )}
      </View>
    </View>
  );
}

/* ================= USER DETAIL ================= */

function ToggleRow({
  icon,
  tint,
  title,
  subtitle,
  value,
  disabled,
  busy,
  onChange,
}: {
  icon: IconName;
  tint: string;
  title: string;
  subtitle: string;
  value: boolean;
  disabled?: boolean;
  busy?: boolean;
  onChange: (v: boolean) => void;
}) {
  return (
    <View style={[styles.row, disabled && { opacity: 0.45 }]}>
      <View style={[styles.rowIcon, { backgroundColor: withAlpha(tint, 0.16) }]}>
        <Ionicons name={icon} size={19} color={tint} />
      </View>
      <View style={styles.rowBody}>
        <Text style={styles.rowTitle}>{title}</Text>
        <Text style={styles.rowSub} numberOfLines={2}>
          {subtitle}
        </Text>
      </View>
      {busy ? (
        <ActivityIndicator size="small" color={COLORS.violet} />
      ) : (
        <Switch
          value={value}
          onValueChange={onChange}
          disabled={disabled}
          trackColor={{ false: '#2A2A2E', true: VIOLET }}
          thumbColor="#FFFFFF"
        />
      )}
    </View>
  );
}

function InfoLine({
  label,
  value,
  onPress,
}: {
  label: string;
  value: string;
  onPress?: () => void;
}) {
  const inner = (
    <>
      <Text style={styles.infoLabel}>{label}</Text>
      <Text style={styles.infoValue} numberOfLines={1}>
        {value}
      </Text>
      {onPress && <Ionicons name="copy-outline" size={15} color={UI.faint} style={{ marginLeft: 8 }} />}
    </>
  );
  if (!onPress) return <View style={styles.infoRow}>{inner}</View>;
  return (
    <TouchableOpacity style={styles.infoRow} onPress={onPress} activeOpacity={0.7}>
      {inner}
    </TouchableOpacity>
  );
}

function UserDetail({
  userId,
  myId,
  myRole,
  onClose,
  onPatch,
}: {
  userId: string;
  myId: string;
  myRole: AdminRole;
  onClose: () => void;
  onPatch: (id: string, p: Partial<AdminUserRow>) => void;
}) {
  const [d, setD] = useState<AdminUserDetail | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [dlg, setDlg] = useState<'ban' | 'unban' | null>(null);
  const [note, setNote] = useState('');
  const [noteSaving, setNoteSaving] = useState(false);
  const [noteSaved, setNoteSaved] = useState(false);
  const noteInit = useRef(false);

  const rank = roleRank(myRole);

  const load = useCallback(async () => {
    setErr(null);
    try {
      setD(await adminGetUser(userId));
    } catch (e) {
      setErr(errMsg(e));
    }
  }, [userId]);

  useEffect(() => {
    load();
  }, [load]);

  useEffect(() => {
    if (d && !noteInit.current) {
      noteInit.current = true;
      setNote(d.note ?? '');
    }
  }, [d]);

  async function refreshSilently() {
    try {
      setD(await adminGetUser(userId));
    } catch {}
  }

  if (!d) {
    return (
      <View>
        <BackRow label="Users" onPress={onClose} />
        {err ? (
          <EmptyCard icon="alert-circle-outline" title="Couldn't load user" sub={err} onRetry={load} />
        ) : (
          <SkeletonRows n={3} />
        )}
      </View>
    );
  }

  const p = d.profile;
  const isSelf = userId === myId;
  const targetRank = roleRank(d.admin_role);
  const locked = isSelf || (targetRank > 0 && rank <= targetRank);
  const canRestrict = rank >= 1 && !locked;
  const canBan = rank >= 2 && !locked;
  const canVerify = rank >= 2;
  const banned = !!p.account_locked;

  async function toggleFlag(flag: UserFlag, value: boolean) {
    if (busy || !ensureOnline()) return;
    const prev = !!p[flag];
    setBusy(flag);
    setD((cur) => (cur ? { ...cur, profile: { ...cur.profile, [flag]: value } as AdminUserDetail['profile'] } : cur));
    try {
      await adminSetFlag(userId, flag, value);
      onPatch(userId, { [flag]: value } as Partial<AdminUserRow>);
      await refreshSilently();
    } catch (e) {
      setD((cur) => (cur ? { ...cur, profile: { ...cur.profile, [flag]: prev } as AdminUserDetail['profile'] } : cur));
      Alert.alert('Error', errMsg(e));
    } finally {
      setBusy(null);
    }
  }

  async function toggleVerified(value: boolean) {
    if (busy || !ensureOnline()) return;
    const prev = !!p.verified;
    setBusy('verified');
    setD((cur) => (cur ? { ...cur, profile: { ...cur.profile, verified: value } } : cur));
    try {
      await adminSetVerified(userId, value);
      onPatch(userId, { verified: value });
      await refreshSilently();
    } catch (e) {
      setD((cur) => (cur ? { ...cur, profile: { ...cur.profile, verified: prev } } : cur));
      Alert.alert('Error', errMsg(e));
    } finally {
      setBusy(null);
    }
  }

  async function doBan(
    ban: boolean,
    opts: { reason?: string; category?: string; days?: number | null } = {}
  ) {
    setDlg(null);
    if (busy || !ensureOnline()) return;
    setBusy('ban');
    try {
      await adminBanUser(userId, ban, opts);
      onPatch(userId, { account_locked: ban, ban_reason: ban ? opts.reason || null : null });
      await refreshSilently();
    } catch (e) {
      Alert.alert('Error', errMsg(e));
    } finally {
      setBusy(null);
    }
  }

  async function saveNote() {
    if (noteSaving || !ensureOnline()) return;
    setNoteSaving(true);
    try {
      await adminSetNote(userId, note.trim());
      setNoteSaved(true);
    } catch (e) {
      Alert.alert('Error', errMsg(e));
    } finally {
      setNoteSaving(false);
    }
  }

  return (
    <View>
      <BackRow label="Users" onPress={onClose} />

      <LinearGradient
        colors={
          banned
            ? ['rgba(239,68,68,0.25)', 'rgba(18,18,18,0)']
            : ['rgba(124,92,255,0.30)', 'rgba(244,96,122,0.10)', 'rgba(18,18,18,0)']
        }
        start={{ x: 0, y: 0 }}
        end={{ x: 1, y: 1 }}
        style={styles.hero}
      >
        <View style={styles.heroAvatarRing}>
          <Avatar name={p.display_name} color={p.avatar_color} avatarUrl={p.avatar_url} size={62} />
        </View>
        <View style={{ flex: 1, minWidth: 0 }}>
          <View style={styles.nameRow}>
            <Text style={styles.heroName} numberOfLines={1}>
              {p.display_name || p.username}
            </Text>
            {!!p.verified && (
              <View style={{ marginLeft: 4 }}>
                <VerifiedBadge size={16} />
              </View>
            )}
          </View>
          <Text style={styles.heroUsername} numberOfLines={1}>
            @{p.username}
          </Text>
          <StatusPills
            u={{
              account_locked: banned,
              shadowbanned: !!p.shadowbanned,
              messaging_restricted: !!p.messaging_restricted,
              feature_restricted: !!p.feature_restricted,
              admin_role: d.admin_role,
            }}
          />
        </View>
      </LinearGradient>

      {banned && (
        <View style={styles.banCard}>
          <Ionicons name="ban" size={18} color={UI.red} />
          <View style={{ flex: 1 }}>
            <Text style={[styles.rowTitle, { color: UI.red }]}>This account is banned</Text>
            <Text style={styles.rowSub}>
              {p.ban_category ? `${p.ban_category} · ` : ''}
              {p.ban_reason ? `Reason: ${p.ban_reason}` : 'No reason recorded.'}
              {p.banned_at ? `\nSince ${formatDateTime(p.banned_at)}` : ''}
              {`\n${p.ban_until ? `Ends ${formatDateTime(p.ban_until)}` : 'Permanent'}`}
            </Text>
          </View>
        </View>
      )}

      <SectionLabel>Account</SectionLabel>
      <Group>
        <InfoLine
          label="Email"
          value={d.email ?? '—'}
          onPress={d.email ? () => copyText(d.email as string, 'Email') : undefined}
        />
        <View style={styles.sepFull} />
        <InfoLine label="User ID" value={p.id} onPress={() => copyText(p.id, 'User ID')} />
        <View style={styles.sepFull} />
        <InfoLine label="Joined" value={formatDate(p.created_at)} />
        <View style={styles.sepFull} />
        <InfoLine label="Last sign-in" value={d.last_sign_in_at ? timeAgo(d.last_sign_in_at) : '—'} />
        <View style={styles.sepFull} />
        <InfoLine
          label="Area"
          value={
            [p.location_district, p.location_city, p.location_region, p.location_country].filter(Boolean).join(', ') || '—'
          }
        />
        <View style={styles.sepFull} />
        <InfoLine
          label="Contacts"
          value={(d.contacts_count ?? 0) > 0 ? `${d.contacts_count} encrypted` : '—'}
        />
      </Group>

      {rank >= 2 && <AdminUserData userId={p.id} canExport={rank >= 3} />}

      {locked && (
        <View style={styles.noteCard}>
          <Ionicons name="lock-closed-outline" size={15} color={UI.muted} />
          <Text style={styles.noteText}>
            {isSelf
              ? 'This is your own account — moderation actions are disabled.'
              : 'This person has an equal or higher staff role, so you can’t change their status.'}
          </Text>
        </View>
      )}

      <SectionLabel>Moderation</SectionLabel>
      <Group>
        <ToggleRow
          icon="checkmark-circle-outline"
          tint={UI.teal}
          title="Verified badge"
          subtitle={canVerify ? 'Show the blue verified badge' : 'Admins only'}
          value={!!p.verified}
          disabled={!canVerify}
          busy={busy === 'verified'}
          onChange={toggleVerified}
        />
        <Sep />
        <ToggleRow
          icon="chatbubble-ellipses-outline"
          tint={UI.amber}
          title="Restrict messaging"
          subtitle="Can’t send new messages"
          value={!!p.messaging_restricted}
          disabled={!canRestrict}
          busy={busy === 'messaging_restricted'}
          onChange={(v) => toggleFlag('messaging_restricted', v)}
        />
        <Sep />
        <ToggleRow
          icon="construct-outline"
          tint={UI.amber}
          title="Restrict features"
          subtitle="Limits posting, status and more"
          value={!!p.feature_restricted}
          disabled={!canRestrict}
          busy={busy === 'feature_restricted'}
          onChange={(v) => toggleFlag('feature_restricted', v)}
        />
        <Sep />
        <ToggleRow
          icon="eye-off-outline"
          tint="#B79CFF"
          title="Shadowban"
          subtitle="Content hidden from others silently"
          value={!!p.shadowbanned}
          disabled={!canRestrict}
          busy={busy === 'shadowbanned'}
          onChange={(v) => toggleFlag('shadowbanned', v)}
        />
      </Group>

      {rank >= 2 && (
        <TouchableOpacity
          style={[
            styles.banBtn,
            banned && styles.unbanBtn,
            !canBan && { opacity: 0.45 },
          ]}
          disabled={!canBan || busy === 'ban'}
          onPress={() => setDlg(banned ? 'unban' : 'ban')}
          activeOpacity={0.85}
        >
          {busy === 'ban' ? (
            <ActivityIndicator size="small" color="#fff" />
          ) : (
            <>
              <Ionicons
                name={banned ? 'lock-open-outline' : 'ban-outline'}
                size={18}
                color={banned ? UI.green : COLORS.danger}
              />
              <Text style={[styles.banBtnText, banned && { color: UI.green }]}>
                {banned ? 'Unban account' : 'Ban account'}
              </Text>
            </>
          )}
        </TouchableOpacity>
      )}

      <SectionLabel>Permissions</SectionLabel>
      <Group>
        {PERM_ORDER.map((key, i) => {
          const row = (d.permissions ?? []).find((x) => x.permission === key);
          const meta = PERM_META[key];
          const info = permInfo(row?.status, row?.can_ask_again);
          return (
            <View key={key}>
              {i > 0 && <View style={styles.sep} />}
              <View style={styles.row}>
                <View style={[styles.rowIcon, { backgroundColor: withAlpha(info.color, 0.16) }]}>
                  <Ionicons name={meta.icon} size={19} color={info.color} />
                </View>
                <View style={styles.rowBody}>
                  <Text style={styles.rowTitle}>{meta.label}</Text>
                  <Text style={styles.rowSub}>
                    {row ? `Changed ${timeAgo(row.changed_at)}` : 'Not reported yet'}
                  </Text>
                </View>
                <Pill label={info.label} color={info.color} />
              </View>
            </View>
          );
        })}
      </Group>
      <Text style={styles.permFoot}>
        {(d.permissions ?? []).length > 0
          ? `${(d.permissions[0].platform ?? 'unknown').toString()} · app v${d.permissions[0].app_version ?? '?'} · last reported ${timeAgo(
              d.permissions
                .map((x) => x.updated_at)
                .sort()
                .slice(-1)[0]
            )}`
          : 'Shows up after this user opens the latest app version.'}
      </Text>

      <SectionLabel>Admin note</SectionLabel>
      <View style={styles.noteBox}>
        <TextInput
          style={styles.noteInput}
          value={note}
          onChangeText={(t) => {
            setNote(t);
            setNoteSaved(false);
          }}
          placeholder="Private note — only staff can see this"
          placeholderTextColor={UI.faint}
          multiline
          maxLength={500}
          underlineColorAndroid="transparent"
        />
        <View style={styles.noteFoot}>
          <Text style={styles.rowSub}>{note.length}/500</Text>
          <TouchableOpacity style={styles.noteSave} onPress={saveNote} disabled={noteSaving} activeOpacity={0.8}>
            {noteSaving ? (
              <ActivityIndicator size="small" color="#fff" />
            ) : (
              <Text style={styles.noteSaveText}>{noteSaved ? 'Saved' : 'Save note'}</Text>
            )}
          </TouchableOpacity>
        </View>
      </View>

      {d.appeals.length > 0 && (
        <>
          <SectionLabel>Ban appeals</SectionLabel>
          <Group>
            {d.appeals.map((a, i) => {
              const color = a.status === 'approved' ? UI.green : a.status === 'rejected' ? UI.red : UI.amber;
              return (
                <View key={a.id}>
                  {i > 0 && <View style={styles.sepFull} />}
                  <View style={[styles.histRow, { alignItems: 'flex-start' }]}>
                    <View style={{ flex: 1 }}>
                      <Text style={styles.rowTitle}>{formatDate(a.created_at)}</Text>
                      <Text style={styles.appealMsg} numberOfLines={4}>
                        {a.message}
                      </Text>
                      {!!a.review_note && <Text style={styles.rowSub}>Note: {a.review_note}</Text>}
                    </View>
                    <Pill label={a.status.charAt(0).toUpperCase() + a.status.slice(1)} color={color} />
                  </View>
                </View>
              );
            })}
          </Group>
        </>
      )}

      {d.requests.length > 0 && (
        <>
          <SectionLabel>Verification history</SectionLabel>
          <Group>
            {d.requests.map((r, i) => {
              const color = r.status === 'approved' ? UI.green : r.status === 'rejected' ? UI.red : UI.amber;
              return (
                <View key={r.id}>
                  {i > 0 && <View style={styles.sepFull} />}
                  <View style={styles.histRow}>
                    <View style={{ flex: 1 }}>
                      <Text style={styles.rowTitle}>{formatDate(r.created_at)}</Text>
                      {!!r.review_note && <Text style={styles.rowSub}>{r.review_note}</Text>}
                    </View>
                    <Pill label={r.status.charAt(0).toUpperCase() + r.status.slice(1)} color={color} />
                  </View>
                </View>
              );
            })}
          </Group>
        </>
      )}

      {d.log.length > 0 && (
        <>
          <SectionLabel>Recent actions</SectionLabel>
          <Group>
            {d.log.map((l, i) => {
              const m = describeAction(l.action);
              const reason = l.details?.reason || l.details?.note;
              return (
                <View key={`${l.created_at}-${i}`}>
                  {i > 0 && <View style={styles.sepFull} />}
                  <View style={styles.logRow}>
                    <View style={[styles.logIcon, { backgroundColor: withAlpha(m.color.startsWith('#') ? m.color : '#FFFFFF', 0.14) }]}>
                      <Ionicons name={m.icon} size={15} color={m.color} />
                    </View>
                    <View style={{ flex: 1 }}>
                      <Text style={styles.logTitle}>{m.label}</Text>
                      <Text style={styles.rowSub}>
                        {l.admin_username ? `by @${l.admin_username} · ` : ''}
                        {timeAgo(l.created_at)}
                      </Text>
                      {!!reason && <Text style={styles.logReason}>“{String(reason)}”</Text>}
                    </View>
                  </View>
                </View>
              );
            })}
          </Group>
        </>
      )}

      <BanDialog
        visible={dlg === 'ban'}
        username={p.username}
        onConfirm={(o) => doBan(true, o)}
        onCancel={() => setDlg(null)}
      />
      <PromptDialog
        visible={dlg === 'unban'}
        icon="lock-open-outline"
        tone="success"
        title={`Unban @${p.username}?`}
        message="The ban notice will go away and they can use Airalance again."
        confirmLabel="Unban"
        onConfirm={() => doBan(false)}
        onCancel={() => setDlg(null)}
      />
    </View>
  );
}

function BackRow({ label, onPress }: { label: string; onPress: () => void }) {
  return (
    <TouchableOpacity style={styles.backRow} onPress={onPress} activeOpacity={0.7} hitSlop={8}>
      <Ionicons name="chevron-back" size={18} color={UI.muted} />
      <Text style={styles.backText}>{label}</Text>
    </TouchableOpacity>
  );
}

/* ================= VERIFICATION REQUESTS ================= */

const REQ_FILTERS: { id: RequestStatus; label: string }[] = [
  { id: 'pending', label: 'Pending' },
  { id: 'approved', label: 'Approved' },
  { id: 'rejected', label: 'Rejected' },
  { id: 'all', label: 'All' },
];

function RequestsTab({
  onOpenUser,
  onChanged,
}: {
  onOpenUser: (id: string) => void;
  onChanged: () => void;
}) {
  const [status, setStatus] = useState<RequestStatus>('pending');
  const [rows, setRows] = useState<VerificationRequestRow[] | null>(null);
  const [hasMore, setHasMore] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [dlg, setDlg] = useState<{ req: VerificationRequestRow; approve: boolean } | null>(null);
  const reqId = useRef(0);
  const countRef = useRef(0);

  useEffect(() => {
    countRef.current = rows?.length ?? 0;
  }, [rows]);

  const load = useCallback(
    async (reset: boolean) => {
      const id = ++reqId.current;
      if (reset) {
        setRows(null);
        setError(null);
      } else {
        setLoadingMore(true);
      }
      try {
        const offset = reset ? 0 : countRef.current;
        const data = await adminListRequests(status, PAGE, offset);
        if (id !== reqId.current) return;
        setRows((prev) => (reset ? data : [...(prev ?? []), ...data]));
        setHasMore(data.length === PAGE);
      } catch (e) {
        if (id !== reqId.current) return;
        setError(errMsg(e));
        if (reset) setRows([]);
      } finally {
        if (id === reqId.current) setLoadingMore(false);
      }
    },
    [status]
  );

  useEffect(() => {
    load(true);
  }, [load]);

  async function review(req: VerificationRequestRow, approve: boolean, note: string) {
    setDlg(null);
    if (busyId || !ensureOnline()) return;
    setBusyId(req.id);
    try {
      await adminReviewRequest(req.id, approve, note);
      setRows((prev) =>
        (prev ?? [])
          .map((r) =>
            r.id === req.id
              ? {
                  ...r,
                  status: approve ? 'approved' : 'rejected',
                  review_note: note || null,
                  reviewed_at: new Date().toISOString(),
                  verified: approve ? true : r.verified,
                }
              : r
          )
          .filter((r) => status === 'all' || r.status === status)
      );
      onChanged();
    } catch (e) {
      Alert.alert('Error', errMsg(e));
    } finally {
      setBusyId(null);
    }
  }

  return (
    <View>
      <Chips items={REQ_FILTERS} value={status} onChange={setStatus} />

      <View style={{ marginTop: 14 }}>
        {rows === null ? (
          <SkeletonRows n={3} />
        ) : error && rows.length === 0 ? (
          <EmptyCard icon="cloud-offline-outline" title="Couldn't load requests" sub={error} onRetry={() => load(true)} />
        ) : rows.length === 0 ? (
          <EmptyCard
            icon="shield-checkmark-outline"
            title={status === 'pending' ? 'All caught up' : 'No requests'}
            sub={status === 'pending' ? 'No verification requests are waiting.' : 'Nothing here yet.'}
          />
        ) : (
          <View style={{ gap: 12 }}>
            {rows.map((r) => (
              <RequestCard
                key={r.id}
                r={r}
                busy={busyId === r.id}
                onOpenUser={() => onOpenUser(r.user_id)}
                onApprove={() => setDlg({ req: r, approve: true })}
                onReject={() => setDlg({ req: r, approve: false })}
              />
            ))}
            {hasMore && (
              <TouchableOpacity style={styles.moreBtn} onPress={() => load(false)} disabled={loadingMore} activeOpacity={0.8}>
                {loadingMore ? <ActivityIndicator size="small" color="#fff" /> : <Text style={styles.moreBtnText}>Load more</Text>}
              </TouchableOpacity>
            )}
          </View>
        )}
      </View>

      <PromptDialog
        visible={!!dlg}
        icon={dlg?.approve ? 'shield-checkmark-outline' : 'close-circle-outline'}
        tone={dlg?.approve ? 'success' : 'danger'}
        title={dlg?.approve ? 'Approve verification?' : 'Reject request?'}
        message={
          dlg?.approve
            ? `@${dlg?.req.username ?? 'user'} will get the verified badge.`
            : `@${dlg?.req.username ?? 'user'} can apply again later.`
        }
        confirmLabel={dlg?.approve ? 'Approve' : 'Reject'}
        inputPlaceholder={dlg?.approve ? 'Note (optional)' : 'Reason (optional)'}
        onConfirm={(t) => dlg && review(dlg.req, dlg.approve, t)}
        onCancel={() => setDlg(null)}
      />
    </View>
  );
}

function RequestCard({
  r,
  busy,
  onOpenUser,
  onApprove,
  onReject,
}: {
  r: VerificationRequestRow;
  busy: boolean;
  onOpenUser: () => void;
  onApprove: () => void;
  onReject: () => void;
}) {
  const [selfie, setSelfie] = useState<string | null>(null);
  const [selfieLoading, setSelfieLoading] = useState(false);
  const [selfieFailed, setSelfieFailed] = useState(false);
  const [zoom, setZoom] = useState(false);

  async function showSelfie() {
    if (!r.selfie_path || selfieLoading) return;
    setSelfieLoading(true);
    setSelfieFailed(false);
    const url = await getSelfieUrl(r.selfie_path);
    setSelfieLoading(false);
    if (url) setSelfie(url);
    else setSelfieFailed(true);
  }

  const color = r.status === 'approved' ? UI.green : r.status === 'rejected' ? UI.red : UI.amber;

  return (
    <View style={styles.reqCard}>
      <TouchableOpacity style={styles.reqHead} onPress={onOpenUser} activeOpacity={0.75}>
        <Avatar
          name={r.display_name ?? r.username ?? '?'}
          color={r.avatar_color ?? '#7C5CFF'}
          avatarUrl={r.avatar_url}
          size={44}
        />
        <View style={{ flex: 1, minWidth: 0 }}>
          <View style={styles.nameRow}>
            <Text style={styles.userName} numberOfLines={1}>
              {r.display_name || r.username || 'Unknown'}
            </Text>
            {r.verified && (
              <View style={{ marginLeft: 3 }}>
                <VerifiedBadge size={14} />
              </View>
            )}
          </View>
          <Text style={styles.userSub} numberOfLines={1}>
            @{r.username ?? '—'} · {timeAgo(r.created_at)}
          </Text>
        </View>
        <Pill label={r.status.charAt(0).toUpperCase() + r.status.slice(1)} color={color} />
      </TouchableOpacity>

      <View style={styles.reqBody}>
        <ReqField label="Full name" value={r.full_name} />
        <ReqField label="Age" value={r.age != null ? String(r.age) : null} />
        <ReqField label="Nationality" value={r.nationality} />
        <ReqField label="Email" value={r.email} />
        {!!r.about && <ReqField label="About" value={r.about} multiline />}
        {!!r.links && <ReqField label="Links" value={r.links} multiline />}
        {!!r.review_note && <ReqField label="Review note" value={r.review_note} multiline />}
      </View>

      {!!r.selfie_path && (
        <View style={{ paddingHorizontal: 14, paddingBottom: 12 }}>
          {selfie ? (
            <TouchableOpacity activeOpacity={0.9} onPress={() => setZoom(true)} style={styles.selfieWrap}>
              <Image source={{ uri: selfie }} style={styles.selfieImg} resizeMode="cover" />
              <View style={styles.selfieHint}>
                <Ionicons name="expand-outline" size={13} color="#fff" />
                <Text style={styles.selfieHintText}>Tap to enlarge</Text>
              </View>
            </TouchableOpacity>
          ) : (
            <TouchableOpacity style={styles.selfieBtn} onPress={showSelfie} activeOpacity={0.8} disabled={selfieLoading}>
              {selfieLoading ? (
                <ActivityIndicator size="small" color="#fff" />
              ) : (
                <>
                  <Ionicons name="image-outline" size={17} color="#FFFFFF" />
                  <Text style={styles.selfieBtnText}>{selfieFailed ? 'Retry — couldn’t load selfie' : 'View selfie with document'}</Text>
                </>
              )}
            </TouchableOpacity>
          )}
        </View>
      )}

      {r.status === 'pending' && (
        <View style={styles.reqActions}>
          <TouchableOpacity style={styles.rejectBtn} onPress={onReject} disabled={busy} activeOpacity={0.8}>
            <Ionicons name="close" size={17} color={COLORS.danger} />
            <Text style={styles.rejectText}>Reject</Text>
          </TouchableOpacity>
          <TouchableOpacity style={styles.approveBtn} onPress={onApprove} disabled={busy} activeOpacity={0.8}>
            {busy ? (
              <ActivityIndicator size="small" color="#fff" />
            ) : (
              <>
                <Ionicons name="checkmark" size={17} color="#FFFFFF" />
                <Text style={styles.approveText}>Approve</Text>
              </>
            )}
          </TouchableOpacity>
        </View>
      )}

      <Modal visible={zoom} transparent animationType="fade" statusBarTranslucent onRequestClose={() => setZoom(false)}>
        <Pressable style={styles.zoomBackdrop} onPress={() => setZoom(false)}>
          {!!selfie && <Image source={{ uri: selfie }} style={styles.zoomImg} resizeMode="contain" />}
          <View style={styles.zoomClose}>
            <Ionicons name="close" size={22} color="#fff" />
          </View>
        </Pressable>
      </Modal>
    </View>
  );
}

function ReqField({ label, value, multiline }: { label: string; value: string | null; multiline?: boolean }) {
  return (
    <View style={[styles.reqField, multiline && { flexDirection: 'column', alignItems: 'flex-start', gap: 3 }]}>
      <Text style={styles.reqLabel}>{label}</Text>
      <Text style={[styles.reqValue, multiline && { textAlign: 'left' }]} selectable>
        {value || '—'}
      </Text>
    </View>
  );
}

/* ================= BAN APPEALS ================= */

const APPEAL_FILTERS: { id: AppealStatus; label: string }[] = [
  { id: 'pending', label: 'Pending' },
  { id: 'approved', label: 'Lifted' },
  { id: 'rejected', label: 'Kept' },
  { id: 'all', label: 'All' },
];

function AppealsTab({
  onOpenUser,
  onChanged,
}: {
  onOpenUser: (id: string) => void;
  onChanged: () => void;
}) {
  const [status, setStatus] = useState<AppealStatus>('pending');
  const [rows, setRows] = useState<AppealRow[] | null>(null);
  const [hasMore, setHasMore] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [dlg, setDlg] = useState<{ a: AppealRow; approve: boolean } | null>(null);
  const reqId = useRef(0);
  const countRef = useRef(0);

  useEffect(() => {
    countRef.current = rows?.length ?? 0;
  }, [rows]);

  const load = useCallback(
    async (reset: boolean) => {
      const id = ++reqId.current;
      if (reset) {
        setRows(null);
        setError(null);
      } else {
        setLoadingMore(true);
      }
      try {
        const offset = reset ? 0 : countRef.current;
        const data = await adminListAppeals(status, PAGE, offset);
        if (id !== reqId.current) return;
        setRows((prev) => (reset ? data : [...(prev ?? []), ...data]));
        setHasMore(data.length === PAGE);
      } catch (e) {
        if (id !== reqId.current) return;
        setError(errMsg(e));
        if (reset) setRows([]);
      } finally {
        if (id === reqId.current) setLoadingMore(false);
      }
    },
    [status]
  );

  useEffect(() => {
    load(true);
  }, [load]);

  async function review(a: AppealRow, approve: boolean, note: string) {
    setDlg(null);
    if (busyId || !ensureOnline()) return;
    setBusyId(a.id);
    try {
      await adminReviewAppeal(a.id, approve, note);
      setRows((prev) =>
        (prev ?? [])
          .map((r) =>
            r.id === a.id
              ? {
                  ...r,
                  status: approve ? 'approved' : 'rejected',
                  review_note: note || null,
                  reviewed_at: new Date().toISOString(),
                  still_banned: approve ? false : r.still_banned,
                }
              : r
          )
          .filter((r) => status === 'all' || r.status === status)
      );
      onChanged();
    } catch (e) {
      Alert.alert('Error', errMsg(e));
    } finally {
      setBusyId(null);
    }
  }

  return (
    <View>
      <Chips items={APPEAL_FILTERS} value={status} onChange={setStatus} />

      <View style={{ marginTop: 14 }}>
        {rows === null ? (
          <SkeletonRows n={3} />
        ) : error && rows.length === 0 ? (
          <EmptyCard icon="cloud-offline-outline" title="Couldn't load appeals" sub={error} onRetry={() => load(true)} />
        ) : rows.length === 0 ? (
          <EmptyCard
            icon="megaphone-outline"
            title={status === 'pending' ? 'No appeals waiting' : 'No appeals'}
            sub={status === 'pending' ? 'Banned users’ appeals will show up here.' : 'Nothing here yet.'}
          />
        ) : (
          <View style={{ gap: 12 }}>
            {rows.map((a) => {
              const color = a.status === 'approved' ? UI.green : a.status === 'rejected' ? UI.red : UI.amber;
              return (
                <View key={a.id} style={styles.reqCard}>
                  <TouchableOpacity style={styles.reqHead} onPress={() => onOpenUser(a.user_id)} activeOpacity={0.75}>
                    <Avatar
                      name={a.display_name ?? a.username ?? '?'}
                      color={a.avatar_color ?? '#7C5CFF'}
                      avatarUrl={a.avatar_url}
                      size={44}
                    />
                    <View style={{ flex: 1, minWidth: 0 }}>
                      <Text style={styles.userName} numberOfLines={1}>
                        {a.display_name || a.username || 'Unknown'}
                      </Text>
                      <Text style={styles.userSub} numberOfLines={1}>
                        @{a.username ?? '—'} · {timeAgo(a.created_at)}
                      </Text>
                    </View>
                    <Pill
                      label={a.status === 'approved' ? 'Lifted' : a.status === 'rejected' ? 'Kept' : 'Pending'}
                      color={color}
                    />
                  </TouchableOpacity>

                  <View style={styles.reqBody}>
                    <ReqField label="Ban category" value={a.ban_category} />
                    <ReqField label="Ban reason" value={a.ban_reason} multiline />
                    <ReqField label="Ban ends" value={a.ban_until ? formatDateTime(a.ban_until) : 'Permanent'} />
                    <ReqField label="Email" value={a.email} />
                  </View>

                  <View style={{ paddingHorizontal: 14, paddingBottom: 12 }}>
                    <Text style={styles.reqLabel}>Appeal message</Text>
                    <View style={styles.appealBox}>
                      <Text style={styles.appealMsgFull} selectable>
                        {a.message}
                      </Text>
                    </View>
                    {!!a.review_note && (
                      <Text style={[styles.rowSub, { marginTop: 8 }]}>Review note: {a.review_note}</Text>
                    )}
                  </View>

                  {a.status === 'pending' && (
                    <View style={styles.reqActions}>
                      <TouchableOpacity
                        style={styles.rejectBtn}
                        onPress={() => setDlg({ a, approve: false })}
                        disabled={busyId === a.id}
                        activeOpacity={0.8}
                      >
                        <Ionicons name="ban-outline" size={16} color={COLORS.danger} />
                        <Text style={styles.rejectText}>Keep ban</Text>
                      </TouchableOpacity>
                      <TouchableOpacity
                        style={styles.approveBtn}
                        onPress={() => setDlg({ a, approve: true })}
                        disabled={busyId === a.id}
                        activeOpacity={0.8}
                      >
                        {busyId === a.id ? (
                          <ActivityIndicator size="small" color="#fff" />
                        ) : (
                          <>
                            <Ionicons name="lock-open-outline" size={16} color="#FFFFFF" />
                            <Text style={styles.approveText}>Lift ban</Text>
                          </>
                        )}
                      </TouchableOpacity>
                    </View>
                  )}
                </View>
              );
            })}
            {hasMore && (
              <TouchableOpacity style={styles.moreBtn} onPress={() => load(false)} disabled={loadingMore} activeOpacity={0.8}>
                {loadingMore ? <ActivityIndicator size="small" color="#fff" /> : <Text style={styles.moreBtnText}>Load more</Text>}
              </TouchableOpacity>
            )}
          </View>
        )}
      </View>

      <PromptDialog
        visible={!!dlg}
        icon={dlg?.approve ? 'lock-open-outline' : 'ban-outline'}
        tone={dlg?.approve ? 'success' : 'danger'}
        title={dlg?.approve ? 'Lift this ban?' : 'Keep the ban?'}
        message={
          dlg?.approve
            ? `@${dlg?.a.username ?? 'user'} will be unbanned right away.`
            : `@${dlg?.a.username ?? 'user'} will see your note and can appeal again after 24 hours.`
        }
        confirmLabel={dlg?.approve ? 'Lift ban' : 'Keep ban'}
        inputPlaceholder={dlg?.approve ? 'Note (optional)' : 'Note shown to the user (optional)'}
        onConfirm={(t) => dlg && review(dlg.a, dlg.approve, t)}
        onCancel={() => setDlg(null)}
      />
    </View>
  );
}

/* ================= ACTIVITY LOG ================= */

function LogTab({ onOpenUser }: { onOpenUser: (id: string) => void }) {
  const [rows, setRows] = useState<AuditEntry[] | null>(null);
  const [hasMore, setHasMore] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const countRef = useRef(0);

  useEffect(() => {
    countRef.current = rows?.length ?? 0;
  }, [rows]);

  const load = useCallback(async (reset: boolean) => {
    if (reset) {
      setRows(null);
      setError(null);
    } else {
      setLoadingMore(true);
    }
    try {
      const data = await adminAuditLog(PAGE, reset ? 0 : countRef.current);
      setRows((prev) => (reset ? data : [...(prev ?? []), ...data]));
      setHasMore(data.length === PAGE);
    } catch (e) {
      setError(errMsg(e));
      if (reset) setRows([]);
    } finally {
      setLoadingMore(false);
    }
  }, []);

  useEffect(() => {
    load(true);
  }, [load]);

  if (rows === null) return <SkeletonRows n={4} />;
  if (error && rows.length === 0)
    return <EmptyCard icon="cloud-offline-outline" title="Couldn't load activity" sub={error} onRetry={() => load(true)} />;
  if (rows.length === 0)
    return <EmptyCard icon="time-outline" title="No activity yet" sub="Admin actions will be logged here." />;

  return (
    <View>
      <Text style={styles.listCount}>Recent admin actions</Text>
      <Group>
        {rows.map((l, i) => {
          const m = describeAction(l.action);
          const reason = l.details?.reason || l.details?.note;
          const tint = m.color.startsWith('#') ? m.color : '#FFFFFF';
          return (
            <View key={l.id}>
              {i > 0 && <View style={styles.sepFull} />}
              <TouchableOpacity
                style={styles.logRow}
                activeOpacity={l.target_id ? 0.7 : 1}
                onPress={() => l.target_id && onOpenUser(l.target_id)}
              >
                <View style={[styles.logIcon, { backgroundColor: withAlpha(tint, 0.14) }]}>
                  <Ionicons name={m.icon} size={15} color={m.color} />
                </View>
                <View style={{ flex: 1 }}>
                  <Text style={styles.logTitle}>
                    {m.label}
                    {l.target_username ? ` · @${l.target_username}` : ''}
                  </Text>
                  <Text style={styles.rowSub}>
                    {l.admin_username ? `by @${l.admin_username} · ` : ''}
                    {timeAgo(l.created_at)}
                  </Text>
                  {!!reason && <Text style={styles.logReason}>“{String(reason)}”</Text>}
                </View>
              </TouchableOpacity>
            </View>
          );
        })}
      </Group>
      {hasMore && (
        <TouchableOpacity style={styles.moreBtn} onPress={() => load(false)} disabled={loadingMore} activeOpacity={0.8}>
          {loadingMore ? <ActivityIndicator size="small" color="#fff" /> : <Text style={styles.moreBtnText}>Load more</Text>}
        </TouchableOpacity>
      )}
    </View>
  );
}

/* ================= TEAM (owner only) ================= */

function TeamTab({ myId, onChanged }: { myId: string; onChanged: () => void }) {
  const [members, setMembers] = useState<AdminMember[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [identifier, setIdentifier] = useState('');
  const [newRole, setNewRole] = useState<'admin' | 'moderator'>('admin');
  const [adding, setAdding] = useState(false);
  const [removeTarget, setRemoveTarget] = useState<AdminMember | null>(null);

  const load = useCallback(async () => {
    setError(null);
    try {
      setMembers(await adminListAdmins());
    } catch (e) {
      setError(errMsg(e));
      setMembers((prev) => prev ?? []);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  async function add() {
    const v = identifier.trim();
    if (!v || adding || !ensureOnline()) return;
    Keyboard.dismiss();
    setAdding(true);
    try {
      await adminAddAdmin(v, newRole);
      setIdentifier('');
      await load();
      onChanged();
    } catch (e) {
      Alert.alert('Couldn’t add', errMsg(e));
    } finally {
      setAdding(false);
    }
  }

  async function remove(m: AdminMember) {
    setRemoveTarget(null);
    if (!ensureOnline()) return;
    try {
      await adminRemoveAdmin(m.user_id);
      setMembers((prev) => (prev ?? []).filter((x) => x.user_id !== m.user_id));
      onChanged();
    } catch (e) {
      Alert.alert('Error', errMsg(e));
    }
  }

  return (
    <View>
      <View style={styles.addCard}>
        <Text style={styles.rowTitle}>Give someone access</Text>
        <Text style={[styles.rowSub, { marginBottom: 12 }]}>
          Enter their email or @username. They need an Airalance account.
        </Text>
        <View style={styles.addInputWrap}>
          <Ionicons name="person-add-outline" size={17} color={UI.faint} />
          <TextInput
            style={styles.searchInput}
            value={identifier}
            onChangeText={setIdentifier}
            placeholder="email or @username"
            placeholderTextColor={UI.faint}
            autoCapitalize="none"
            autoCorrect={false}
            keyboardType="email-address"
            returnKeyType="done"
            onSubmitEditing={add}
            underlineColorAndroid="transparent"
          />
        </View>

        <View style={styles.roleRow}>
          {(['admin', 'moderator'] as const).map((r) => {
            const on = newRole === r;
            return (
              <TouchableOpacity
                key={r}
                style={[styles.roleOpt, on && { borderColor: VIOLET, backgroundColor: 'rgba(124,92,255,0.10)' }]}
                onPress={() => setNewRole(r)}
                activeOpacity={0.8}
              >
                <Text style={[styles.roleOptTitle, on && { color: '#FFFFFF' }]}>{ROLE_META[r].label}</Text>
                <Text style={styles.roleOptSub}>
                  {r === 'admin' ? 'Verify, ban, review requests' : 'Restrict & shadowban only'}
                </Text>
              </TouchableOpacity>
            );
          })}
        </View>

        <TouchableOpacity
          style={[styles.addBtn, (!identifier.trim() || adding) && { opacity: 0.5 }]}
          onPress={add}
          disabled={!identifier.trim() || adding}
          activeOpacity={0.85}
        >
          {adding ? <ActivityIndicator size="small" color="#fff" /> : <Text style={styles.addBtnText}>Add to team</Text>}
        </TouchableOpacity>
      </View>

      <SectionLabel>Staff</SectionLabel>
      {members === null ? (
        <SkeletonRows n={2} />
      ) : error && members.length === 0 ? (
        <EmptyCard icon="cloud-offline-outline" title="Couldn't load team" sub={error} onRetry={load} />
      ) : (
        <Group>
          {members.map((m, i) => {
            const meta = ROLE_META[m.role];
            const removable = m.role !== 'owner' && m.user_id !== myId;
            return (
              <View key={m.user_id}>
                {i > 0 && <View style={styles.sepFull} />}
                <View style={styles.userRow}>
                  <Avatar
                    name={m.display_name ?? m.username ?? '?'}
                    color={m.avatar_color ?? '#7C5CFF'}
                    avatarUrl={m.avatar_url}
                    size={44}
                  />
                  <View style={styles.userInfo}>
                    <Text style={styles.userName} numberOfLines={1}>
                      {m.display_name || m.username || 'Unknown'}
                    </Text>
                    <Text style={styles.userSub} numberOfLines={1}>
                      {m.username ? `@${m.username}` : ''}
                      {m.email ? ` · ${m.email}` : ''}
                    </Text>
                    <View style={styles.pillRow}>
                      <Pill label={meta.label} color={meta.color} icon="shield" />
                    </View>
                  </View>
                  {removable && (
                    <TouchableOpacity style={styles.removeBtn} onPress={() => setRemoveTarget(m)} activeOpacity={0.75}>
                      <Text style={styles.removeBtnText}>Remove</Text>
                    </TouchableOpacity>
                  )}
                </View>
              </View>
            );
          })}
        </Group>
      )}

      <PromptDialog
        visible={!!removeTarget}
        icon="person-remove-outline"
        tone="danger"
        title="Remove from team?"
        message={`@${removeTarget?.username ?? 'user'} will lose access to Management immediately.`}
        confirmLabel="Remove"
        onConfirm={() => removeTarget && remove(removeTarget)}
        onCancel={() => setRemoveTarget(null)}
      />
    </View>
  );
}

/* ================= STYLES ================= */

const styles = StyleSheet.create({
  hidden: { display: 'none' },

  // tabs
  tabBar: { paddingHorizontal: 16, gap: 8, paddingBottom: 4 },
  tab: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: 14,
    height: 38,
    borderRadius: 999,
    backgroundColor: UI.card,
    borderWidth: 1,
    borderColor: UI.border,
  },
  tabOn: { backgroundColor: VIOLET, borderColor: VIOLET },
  tabText: { fontSize: 13.5, fontFamily: FONTS.bodySemiBold, color: UI.muted },
  tabTextOn: { color: '#FFFFFF' },
  tabBadge: {
    minWidth: 18,
    height: 18,
    paddingHorizontal: 5,
    borderRadius: 9,
    backgroundColor: UI.amber,
    alignItems: 'center',
    justifyContent: 'center',
  },
  tabBadgeText: { fontSize: 10.5, fontFamily: FONTS.bodySemiBold, color: '#000000' },

  // shared
  sectionLabel: {
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
  sep: { height: 1, backgroundColor: UI.border, marginLeft: 62 },
  sepFull: { height: 1, backgroundColor: UI.border, marginLeft: 16 },
  row: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingHorizontal: 14, paddingVertical: 12 },
  rowIcon: { width: 36, height: 36, borderRadius: 11, alignItems: 'center', justifyContent: 'center' },
  rowBody: { flex: 1, minWidth: 0 },
  rowTitle: { fontSize: 15, fontFamily: FONTS.bodySemiBold, color: '#FFFFFF' },
  rowSub: { fontSize: 12.5, fontFamily: FONTS.body, color: UI.muted, marginTop: 2, lineHeight: 17 },
  nameRow: { flexDirection: 'row', alignItems: 'center' },
  listCount: { fontSize: 12.5, fontFamily: FONTS.body, color: UI.muted, marginBottom: 10, marginLeft: 6 },

  pill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 999,
  },
  pillText: { fontSize: 11, fontFamily: FONTS.bodySemiBold },
  pillRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 6, marginTop: 7 },

  chip: {
    paddingHorizontal: 14,
    height: 34,
    borderRadius: 999,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: UI.card,
    borderWidth: 1,
    borderColor: UI.border,
  },
  chipOn: { backgroundColor: 'rgba(124,92,255,0.18)', borderColor: VIOLET },
  chipText: { fontSize: 13, fontFamily: FONTS.bodyMedium, color: UI.muted },
  chipTextOn: { color: '#FFFFFF', fontFamily: FONTS.bodySemiBold },

  centerCard: {
    alignItems: 'center',
    padding: 26,
    borderRadius: RADII.xl,
    backgroundColor: UI.card,
    borderWidth: 1,
    borderColor: UI.border,
  },
  pillIcon: {
    width: 52,
    height: 52,
    borderRadius: 26,
    backgroundColor: 'rgba(255,255,255,0.06)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  centerTitle: { fontSize: 16, fontFamily: FONTS.displayBold, color: '#FFFFFF', marginTop: 12, textAlign: 'center' },
  centerSub: { fontSize: 13, fontFamily: FONTS.body, color: UI.muted, marginTop: 6, textAlign: 'center', lineHeight: 18 },
  retryBtn: {
    marginTop: 14,
    paddingHorizontal: 22,
    paddingVertical: 10,
    borderRadius: RADII.full,
    backgroundColor: 'rgba(255,255,255,0.08)',
  },
  retryBtnText: { color: '#FFFFFF', fontSize: 13.5, fontFamily: FONTS.bodySemiBold },

  skelRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    padding: 12,
    borderRadius: 14,
    backgroundColor: UI.card,
  },
  skelAvatar: { width: 44, height: 44, borderRadius: 22, backgroundColor: 'rgba(255,255,255,0.07)' },
  skelLine: { height: 12, width: '60%', borderRadius: 6, backgroundColor: 'rgba(255,255,255,0.07)' },

  moreBtn: {
    marginTop: 12,
    height: 44,
    borderRadius: RADII.full,
    backgroundColor: 'rgba(255,255,255,0.08)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  moreBtnText: { color: '#FFFFFF', fontSize: 13.5, fontFamily: FONTS.bodySemiBold },

  // overview
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
  heroIcon: { width: 48, height: 48, borderRadius: 15, alignItems: 'center', justifyContent: 'center' },
  heroTitle: { fontSize: 19, fontFamily: FONTS.displayBold, color: '#FFFFFF' },
  heroSub: { fontSize: 12.5, fontFamily: FONTS.body, color: 'rgba(255,255,255,0.65)', marginTop: 2 },
  heroAvatarRing: {
    padding: 3,
    borderRadius: 40,
    borderWidth: 2,
    borderColor: 'rgba(124,92,255,0.7)',
  },
  heroName: { fontSize: 18, fontFamily: FONTS.displayBold, color: '#FFFFFF', flexShrink: 1 },
  heroUsername: { fontSize: 13.5, fontFamily: FONTS.body, color: UI.muted, marginTop: 2 },

  alertCard: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    marginTop: 12,
    padding: 14,
    borderRadius: RADII.xl,
    backgroundColor: 'rgba(255,200,87,0.08)',
    borderWidth: 1,
    borderColor: 'rgba(255,200,87,0.28)',
  },

  statGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 12, marginTop: 12 },
  statCard: {
    width: '47.8%',
    flexGrow: 1,
    padding: 14,
    borderRadius: RADII.xl,
    backgroundColor: UI.card,
    borderWidth: 1,
    borderColor: UI.border,
  },
  statIcon: { width: 32, height: 32, borderRadius: 10, alignItems: 'center', justifyContent: 'center' },
  statValue: { fontSize: 26, fontFamily: FONTS.displayBold, color: '#FFFFFF', marginTop: 10, letterSpacing: -0.5 },
  statLabel: { fontSize: 12.5, fontFamily: FONTS.body, color: UI.muted, marginTop: 1 },

  chartCard: {
    marginTop: 12,
    padding: 16,
    borderRadius: RADII.xl,
    backgroundColor: UI.card,
    borderWidth: 1,
    borderColor: UI.border,
  },
  chartHead: { flexDirection: 'row', alignItems: 'center' },
  chartTotal: { fontSize: 20, fontFamily: FONTS.displayBold, color: '#FFFFFF' },
  chartRow: { flexDirection: 'row', alignItems: 'flex-end', gap: 8, marginTop: 14, height: 128 },
  chartCol: { flex: 1, alignItems: 'center', justifyContent: 'flex-end', gap: 5 },
  chartBar: { width: '100%', borderRadius: 6 },
  chartVal: { fontSize: 10.5, fontFamily: FONTS.bodyMedium, color: UI.muted },
  chartLabel: { fontSize: 11, fontFamily: FONTS.body, color: UI.faint },

  // search
  searchWrap: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    height: 42,
    marginTop: 14,
    paddingHorizontal: 14,
    borderRadius: 14,
    backgroundColor: UI.card,
    borderWidth: 1,
    borderColor: UI.border,
  },
  searchInput: { flex: 1, fontSize: 14.5, fontFamily: FONTS.body, color: '#FFFFFF', paddingVertical: 0 },

  // users
  userRow: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingHorizontal: 14, paddingVertical: 12 },
  userInfo: { flex: 1, minWidth: 0 },
  userName: { fontSize: 14.5, fontFamily: FONTS.bodySemiBold, color: '#FFFFFF', flexShrink: 1 },
  userSub: { fontSize: 12.5, fontFamily: FONTS.body, color: UI.muted, marginTop: 2 },

  // detail
  backRow: { flexDirection: 'row', alignItems: 'center', gap: 2, alignSelf: 'flex-start', marginTop: 6, paddingVertical: 4 },
  backText: { fontSize: 14, fontFamily: FONTS.bodyMedium, color: UI.muted },
  banCard: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 10,
    marginTop: 12,
    padding: 14,
    borderRadius: RADII.xl,
    backgroundColor: 'rgba(239,68,68,0.08)',
    borderWidth: 1,
    borderColor: 'rgba(239,68,68,0.3)',
  },
  noteCard: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginTop: 12,
    padding: 12,
    borderRadius: 12,
    backgroundColor: UI.cardAlt,
  },
  noteText: { flex: 1, fontSize: 12.5, fontFamily: FONTS.body, color: UI.muted, lineHeight: 17 },
  infoRow: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 16, paddingVertical: 13 },
  infoLabel: { fontSize: 14.5, fontFamily: FONTS.bodyMedium, color: '#FFFFFF', width: 104 },
  infoValue: { flex: 1, fontSize: 13.5, fontFamily: FONTS.body, color: UI.muted, textAlign: 'right' },
  banBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    marginTop: 16,
    paddingVertical: 14,
    borderRadius: RADII.full,
    borderWidth: 1,
    borderColor: 'rgba(239,68,68,0.35)',
    backgroundColor: 'rgba(239,68,68,0.08)',
  },
  unbanBtn: { borderColor: 'rgba(52,211,153,0.35)', backgroundColor: 'rgba(52,211,153,0.08)' },
  banBtnText: { fontSize: 14.5, fontFamily: FONTS.bodySemiBold, color: COLORS.danger },
  histRow: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingHorizontal: 16, paddingVertical: 12 },
  logRow: { flexDirection: 'row', alignItems: 'flex-start', gap: 12, paddingHorizontal: 14, paddingVertical: 12 },
  logIcon: { width: 30, height: 30, borderRadius: 10, alignItems: 'center', justifyContent: 'center', marginTop: 1 },
  logTitle: { fontSize: 14, fontFamily: FONTS.bodySemiBold, color: '#FFFFFF' },
  logReason: { fontSize: 12.5, fontFamily: FONTS.body, color: 'rgba(255,255,255,0.75)', marginTop: 4, fontStyle: 'italic' },

  // requests
  reqCard: {
    borderRadius: RADII.xl,
    backgroundColor: UI.card,
    borderWidth: 1,
    borderColor: UI.border,
    overflow: 'hidden',
  },
  reqHead: { flexDirection: 'row', alignItems: 'center', gap: 12, padding: 14 },
  reqBody: { paddingHorizontal: 14, paddingBottom: 8, gap: 2 },
  reqField: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 12, paddingVertical: 6 },
  reqLabel: { fontSize: 12.5, fontFamily: FONTS.body, color: UI.muted },
  reqValue: { flexShrink: 1, fontSize: 13.5, fontFamily: FONTS.bodyMedium, color: '#FFFFFF', textAlign: 'right' },
  selfieBtn: {
    height: 46,
    borderRadius: 12,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    backgroundColor: UI.cardAlt,
    borderWidth: 1,
    borderColor: UI.border,
  },
  selfieBtnText: { color: '#FFFFFF', fontSize: 13.5, fontFamily: FONTS.bodySemiBold },
  selfieWrap: { borderRadius: 14, overflow: 'hidden' },
  selfieImg: { width: '100%', height: 220, backgroundColor: UI.cardAlt },
  selfieHint: {
    position: 'absolute',
    right: 10,
    bottom: 10,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 999,
    backgroundColor: 'rgba(0,0,0,0.65)',
  },
  selfieHintText: { color: '#FFFFFF', fontSize: 11.5, fontFamily: FONTS.bodySemiBold },
  reqActions: { flexDirection: 'row', gap: 10, padding: 14, paddingTop: 4 },
  rejectBtn: {
    flex: 1,
    height: 44,
    borderRadius: RADII.full,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    borderWidth: 1,
    borderColor: 'rgba(239,68,68,0.35)',
    backgroundColor: 'rgba(239,68,68,0.08)',
  },
  rejectText: { fontSize: 14, fontFamily: FONTS.bodySemiBold, color: COLORS.danger },
  approveBtn: {
    flex: 1,
    height: 44,
    borderRadius: RADII.full,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    backgroundColor: '#10B981',
  },
  approveText: { fontSize: 14, fontFamily: FONTS.bodySemiBold, color: '#FFFFFF' },
  zoomBackdrop: { flex: 1, backgroundColor: 'rgba(0,0,0,0.94)', alignItems: 'center', justifyContent: 'center' },
  zoomImg: { width: '100%', height: '82%' },
  zoomClose: {
    position: 'absolute',
    top: 48,
    right: 18,
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: 'rgba(255,255,255,0.14)',
    alignItems: 'center',
    justifyContent: 'center',
  },

  // team
  addCard: {
    marginTop: 14,
    padding: 16,
    borderRadius: RADII.xl,
    backgroundColor: UI.card,
    borderWidth: 1,
    borderColor: UI.border,
  },
  addInputWrap: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    height: 46,
    paddingHorizontal: 14,
    borderRadius: 12,
    backgroundColor: UI.cardAlt,
    borderWidth: 1,
    borderColor: UI.border,
  },
  roleRow: { flexDirection: 'row', gap: 10, marginTop: 12 },
  roleOpt: {
    flex: 1,
    padding: 12,
    borderRadius: 14,
    borderWidth: 1.5,
    borderColor: UI.border,
    backgroundColor: UI.cardAlt,
  },
  roleOptTitle: { fontSize: 14, fontFamily: FONTS.bodySemiBold, color: UI.muted },
  roleOptSub: { fontSize: 11.5, fontFamily: FONTS.body, color: UI.muted, marginTop: 3, lineHeight: 15 },
  addBtn: {
    marginTop: 14,
    height: 46,
    borderRadius: RADII.full,
    backgroundColor: VIOLET,
    alignItems: 'center',
    justifyContent: 'center',
  },
  addBtnText: { color: '#FFFFFF', fontSize: 14.5, fontFamily: FONTS.bodySemiBold },
  removeBtn: {
    height: 34,
    paddingHorizontal: 14,
    borderRadius: 10,
    backgroundColor: '#2E2E2E',
    alignItems: 'center',
    justifyContent: 'center',
  },
  removeBtnText: { color: '#FFFFFF', fontSize: 13, fontFamily: FONTS.bodySemiBold },

  // notes / appeals / ban dialog
  noteBox: {
    borderRadius: RADII.xl,
    backgroundColor: UI.card,
    borderWidth: 1,
    borderColor: UI.border,
    padding: 12,
  },
  noteInput: {
    minHeight: 64,
    maxHeight: 140,
    color: '#FFFFFF',
    fontSize: 14,
    fontFamily: FONTS.body,
    lineHeight: 20,
    textAlignVertical: 'top',
    paddingTop: 2,
  },
  noteFoot: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginTop: 8 },
  noteSave: {
    minWidth: 92,
    height: 34,
    paddingHorizontal: 14,
    borderRadius: 10,
    backgroundColor: '#2E2E2E',
    alignItems: 'center',
    justifyContent: 'center',
  },
  noteSaveText: { color: '#FFFFFF', fontSize: 13, fontFamily: FONTS.bodySemiBold },
  appealMsg: { fontSize: 13, fontFamily: FONTS.body, color: 'rgba(255,255,255,0.8)', marginTop: 4, lineHeight: 18 },
  appealBox: {
    marginTop: 6,
    padding: 12,
    borderRadius: 12,
    backgroundColor: UI.cardAlt,
    borderWidth: 1,
    borderColor: UI.border,
  },
  appealMsgFull: { fontSize: 13.5, fontFamily: FONTS.body, color: '#FFFFFF', lineHeight: 19 },
  dLabel: {
    fontSize: 11.5,
    fontFamily: FONTS.bodySemiBold,
    color: UI.muted,
    marginLeft: 8,
    marginBottom: 7,
    textTransform: 'uppercase',
    letterSpacing: 0.6,
  },
  dChipWrap: { flexDirection: 'row', flexWrap: 'wrap', gap: 7, paddingHorizontal: 6, marginBottom: 14 },
  dChip: {
    paddingHorizontal: 12,
    height: 32,
    borderRadius: 999,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(255,255,255,0.06)',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.09)',
  },
  dChipOn: { backgroundColor: 'rgba(239,68,68,0.28)', borderColor: 'rgba(239,68,68,0.7)' },
  dChipText: { fontSize: 12.5, fontFamily: FONTS.bodyMedium, color: UI.muted },

  permFoot: { fontSize: 12, fontFamily: FONTS.body, color: UI.faint, marginTop: 8, marginLeft: 6 },

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
    marginBottom: 14,
    paddingHorizontal: 10,
  },
  dialogInput: {
    minHeight: 70,
    maxHeight: 120,
    marginHorizontal: 6,
    marginBottom: 14,
    paddingHorizontal: 12,
    paddingTop: 10,
    paddingBottom: 10,
    borderRadius: 12,
    backgroundColor: 'rgba(255,255,255,0.06)',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.09)',
    color: '#FFFFFF',
    fontSize: 14,
    fontFamily: FONTS.body,
    textAlignVertical: 'top',
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
