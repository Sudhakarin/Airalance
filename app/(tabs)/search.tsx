// app/(tabs)/search.tsx
// Search screen — find users by username + suggestions (only @airalance) + skeleton
// ✅ FIX: insets from hook (uses initialWindowMetrics) — no first-frame header jump
// ✅ FIX: Dynamic notification count + DeviceEventEmitter sync (fixes hardcoded 9+)
// ✅ FIX: subscribeNetwork listener — auto-refresh when internet reconnects
// ✅ FIX: reconnect uses retryTick (no more editing the TextInput value)
// ✅ FIX: myId from cached getCurrentUserId (works offline on cold start)
// ✅ FIX: search query sanitized (commas/brackets no longer break the filter)
// ✅ FIX: fetchNotificationCount wrapped in try/catch
// ✅ NEW: Games section under Suggestions — Ludo, Carrom, Arrow Puzzle (app/games/*)

import { useEffect, useState, useCallback, useRef } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TextInput,
  TouchableOpacity,
  FlatList,
  DeviceEventEmitter,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { LinearGradient } from 'expo-linear-gradient';
import {
  COLORS,
  FONTS,
  RADII,
  SPACING,
  GRADIENTS,
} from '../../constants/theme';
import { supabase } from '../../lib/supabase';
import { getCurrentUserId } from '../../lib/auth';
import { subscribeNetwork } from '../../lib/network';
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
  status: string | null;
};


/* ---------------- Games ---------------- */
type GameItem = {
  key: string;
  title: string;
  sub: string;
  route: '/games/ludo' | '/games/carrom' | '/games/arrow';
};

const GAMES: GameItem[] = [
  { key: 'ludo', title: 'Ludo', sub: 'Pick your colour · 2 or 4 players', route: '/games/ludo' },
  { key: 'carrom', title: 'Carrom', sub: 'Aim, flick, pocket · vs Computer', route: '/games/carrom' },
  { key: 'arrow', title: 'Arrow Puzzle', sub: 'Slide arrows out · race the Computer', route: '/games/arrow' },
];

function GameTile({ id }: { id: string }) {
  if (id === 'ludo') {
    const c = ['#F0454F', '#2FBF71', '#3B82F6', '#F5B83D'];
    return (
      <View style={[styles.gameTile, { backgroundColor: '#0d0d11', padding: 5, flexDirection: 'row', flexWrap: 'wrap', gap: 4 }]}>
        {c.map((col) => (
          <View key={col} style={{ width: 16, height: 16, borderRadius: 4, backgroundColor: col, alignItems: 'center', justifyContent: 'center' }}>
            <View style={{ width: 7, height: 7, borderRadius: 4, backgroundColor: '#0d0d11' }} />
          </View>
        ))}
      </View>
    );
  }
  if (id === 'carrom') {
    return (
      <View style={[styles.gameTile, { backgroundColor: '#1a1426', alignItems: 'center', justifyContent: 'center' }]}>
        <View style={{ width: 28, height: 28, borderRadius: 14, borderWidth: 1.5, borderColor: '#7C3AED', alignItems: 'center', justifyContent: 'center' }}>
          <View style={{ width: 10, height: 10, borderRadius: 5, backgroundColor: '#F43F7A' }} />
        </View>
        <View style={{ position: 'absolute', top: 6, left: 20, width: 7, height: 7, borderRadius: 4, backgroundColor: '#f4f1ff' }} />
        <View style={{ position: 'absolute', bottom: 8, left: 9, width: 7, height: 7, borderRadius: 4, backgroundColor: '#f4f1ff' }} />
        <View style={{ position: 'absolute', bottom: 8, right: 9, width: 7, height: 7, borderRadius: 4, backgroundColor: '#08080b', borderWidth: 1, borderColor: '#4b4568' }} />
        <View style={{ position: 'absolute', top: -4, left: -4, width: 12, height: 12, borderRadius: 6, backgroundColor: '#000' }} />
        <View style={{ position: 'absolute', bottom: -4, right: -4, width: 12, height: 12, borderRadius: 6, backgroundColor: '#000' }} />
      </View>
    );
  }
  return (
    <LinearGradient colors={['#2a2050', '#1a1433']} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} style={[styles.gameTile, { alignItems: 'center', justifyContent: 'center' }]}>
      <Ionicons name="arrow-forward" size={26} color="#E9DDFF" />
    </LinearGradient>
  );
}

function SkeletonBlock({
  width,
  height,
  borderRadius = 6,
  style,
}: {
  width: number | string;
  height: number;
  borderRadius?: number;
  style?: any;
}) {
  return (
    <View
      style={[
        {
          width,
          height,
          borderRadius,
          backgroundColor: 'rgba(255,255,255,0.08)',
        },
        style,
      ]}
    />
  );
}

function SearchResultsSkeleton({ count = 5 }: { count?: number }) {
  return (
    <View>
      {Array.from({ length: count }).map((_, i) => (
        <View key={i} style={styles.skeletonResultRow}>
          <SkeletonBlock width={46} height={46} borderRadius={23} />
          <View style={styles.skeletonResultInfo}>
            <SkeletonBlock
              width={`${45 + ((i * 15) % 30)}%`}
              height={13}
              borderRadius={5}
            />
            <SkeletonBlock
              width={`${30 + ((i * 11) % 25)}%`}
              height={10}
              borderRadius={4}
              style={{ marginTop: 5 }}
            />
          </View>
        </View>
      ))}
    </View>
  );
}

export default function SearchScreen() {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<Profile[]>([]);
  const [suggestion, setSuggestion] = useState<Profile | null>(null);
  const [searching, setSearching] = useState(false);
  const [loadingSuggestion, setLoadingSuggestion] = useState(true);
  const [myId, setMyId] = useState<string | null>(null);

  const [notifCount, setNotifCount] = useState(0);
  const [retryTick, setRetryTick] = useState(0); // ✅ bumps when internet comes back
  const searchSeq = useRef(0);

  // ✅ FIX: cached user id — works offline on cold start
  useEffect(() => {
    let mounted = true;
    getCurrentUserId()
      .then((id) => {
        if (mounted && id) setMyId(id);
      })
      .catch(() => {});
    return () => {
      mounted = false;
    };
  }, []);

  const fetchNotificationCount = useCallback(async () => {
    try {
      const {
        data: { session },
      } = await supabase.auth.getSession();
      if (!session?.user) return;
      const { count } = await supabase
        .from('app_notifications')
        .select('id', { count: 'exact', head: true })
        .eq('user_id', session.user.id)
        .eq('read', false);
      setNotifCount(count ?? 0);
    } catch (err) {
      console.warn('Notif count failed:', err);
    }
  }, []);

  useEffect(() => {
    fetchNotificationCount();
    const sub = DeviceEventEmitter.addListener('REFRESH_NOTIF_COUNT', () => {
      fetchNotificationCount();
    });
    return () => sub.remove();
  }, [fetchNotificationCount]);

  // ✅ FIX: Auto-reconnect — no TextInput hack, just bump retryTick
  useEffect(() => {
    const unsub = subscribeNetwork((online) => {
      if (!online) return;
      fetchNotificationCount();
      setRetryTick((t) => t + 1);
    });
    return unsub;
  }, [fetchNotificationCount]);

  useEffect(() => {
    if (!myId) return;

    async function loadSuggestion() {
      try {
        const { data, error } = await supabase
          .from('profiles')
          .select('*')
          .eq('username', 'airalance')
          .maybeSingle();

        if (error) throw error;
        setSuggestion((data as Profile) ?? null);
      } catch (err) {
        console.warn('Suggestion error:', err);
      } finally {
        setLoadingSuggestion(false);
      }
    }

    loadSuggestion();
  }, [myId, retryTick]);

  useEffect(() => {
    if (!myId) return;

    const trimmed = query.trim();
    if (trimmed.length < 2) {
      setResults([]);
      setSearching(false);
      return;
    }

    // ✅ FIX: remove chars that break PostgREST .or() filter
    const safe = trimmed.replace(/[,()%\\]/g, '');
    if (safe.length < 2) {
      setResults([]);
      setSearching(false);
      return;
    }

    const seq = ++searchSeq.current;
    setSearching(true);

    const timer = setTimeout(async () => {
      try {
        const { data, error } = await supabase
          .from('profiles')
          .select('*')
          .or(`username.ilike.%${safe}%,display_name.ilike.%${safe}%`)
          .neq('id', myId)
          .limit(15);

        if (seq !== searchSeq.current) return;

        if (error) {
          console.warn('Search error:', error.message);
          setResults([]);
        } else if (data) {
          setResults(data as Profile[]);
        }
      } catch (err) {
        console.warn('Search error:', err);
        if (seq === searchSeq.current) setResults([]);
      } finally {
        if (seq === searchSeq.current) setSearching(false);
      }
    }, 350);

    return () => clearTimeout(timer);
  }, [query, myId, retryTick]);

  function openProfile(p: Profile) {
    router.push(`/profile/${p.id}`);
  }

  function openConnect(p: Profile) {
    router.push(`/profile/${p.id}`);
  }

  const showResults = query.trim().length >= 2;

  return (
    <View style={[styles.safe, { paddingTop: insets.top }]}>
      <View style={styles.header}>
        <Text style={styles.headerBrand}>Airalance!</Text>
        <TouchableOpacity
          style={styles.bellBtn}
          activeOpacity={0.7}
          onPress={() => router.push('/notifications')}
        >
          <Ionicons name="notifications-outline" size={19} color="#FFFFFF" />

          {notifCount > 0 && (
            <View style={styles.badge}>
              <Text style={styles.badgeText}>
                {notifCount > 9 ? '9+' : notifCount}
              </Text>
            </View>
          )}
        </TouchableOpacity>
      </View>

      <View style={styles.searchWrap}>
        <View style={styles.searchBox}>
          <Ionicons
            name="search"
            size={17}
            color={COLORS.mist}
            style={{ marginRight: 8 }}
          />
          <TextInput
            style={styles.searchInput}
            value={query}
            onChangeText={setQuery}
            placeholder="Search by username…"
            placeholderTextColor={COLORS.mist}
            autoCapitalize="none"
            autoCorrect={false}
            returnKeyType="search"
            underlineColorAndroid="transparent"
          />
          {query.length > 0 && (
            <TouchableOpacity onPress={() => setQuery('')} activeOpacity={0.7}>
              <Ionicons name="close-circle" size={17} color={COLORS.mist} />
            </TouchableOpacity>
          )}
        </View>
      </View>

      <FlatList
        data={showResults && !searching ? results : []}
        keyExtractor={(item) => item.id}
        contentContainerStyle={styles.listContent}
        keyboardShouldPersistTaps="handled"
        ListHeaderComponent={
          <>
            {!showResults && (
              <View>
                <View style={styles.suggestHeader}>
                  <Ionicons
                    name="sparkles-outline"
                    size={15}
                    color={COLORS.violetLight}
                  />
                  <Text style={styles.suggestTitle}>Suggestions for you</Text>
                </View>

                {loadingSuggestion ? (
                  <View style={styles.matteCard}>
                    <View style={styles.skeletonRow}>
                      <View style={styles.skeletonAvatar} />
                      <View style={{ flex: 1, gap: 6 }}>
                        <View style={styles.skeletonName} />
                        <View style={styles.skeletonUsername} />
                      </View>
                    </View>
                  </View>
                ) : suggestion ? (
                  <View style={styles.matteCard}>
                    <TouchableOpacity
                      style={styles.suggestionRow}
                      onPress={() => openProfile(suggestion)}
                      activeOpacity={0.7}
                    >
                      <Avatar
                        name={suggestion.display_name}
                        color={suggestion.avatar_color}
                        avatarUrl={suggestion.avatar_url}
                        size={42}
                      />

                      <View style={styles.suggestionInfo}>
                        <View style={styles.suggestionNameWrap}>
                          <Text style={styles.suggestionName} numberOfLines={1}>
                            {suggestion.display_name}
                          </Text>
                          {suggestion.verified && <VerifiedBadge size={13} />}
                        </View>
                        <Text style={styles.suggestionUsername} numberOfLines={1}>
                          @{suggestion.username}
                        </Text>
                      </View>

                      <TouchableOpacity
                        style={styles.connectBtn}
                        onPress={() => openConnect(suggestion)}
                        activeOpacity={0.85}
                      >
                        <LinearGradient
                          colors={GRADIENTS.violet}
                          start={{ x: 0, y: 0 }}
                          end={{ x: 1, y: 1 }}
                          style={styles.connectBtnGradient}
                        >
                          <Text style={styles.connectBtnText}>Connect</Text>
                        </LinearGradient>
                      </TouchableOpacity>
                    </TouchableOpacity>
                  </View>
                ) : null}

                <View style={[styles.suggestHeader, { paddingTop: 16 }]}>
                  <Ionicons
                    name="game-controller-outline"
                    size={15}
                    color={COLORS.violetLight}
                  />
                  <Text style={styles.suggestTitle}>Games</Text>
                  <Text style={styles.gamesHint}>Play vs Computer</Text>
                </View>

                <View style={styles.matteCard}>
                  {GAMES.map((game, i) => (
                    <TouchableOpacity
                      key={game.key}
                      style={[styles.suggestionRow, i > 0 && styles.gameDivider]}
                      onPress={() => router.push(game.route)}
                      activeOpacity={0.7}
                    >
                      <GameTile id={game.key} />
                      <View style={styles.suggestionInfo}>
                        <Text style={styles.suggestionName} numberOfLines={1}>
                          {game.title}
                        </Text>
                        <Text style={styles.suggestionUsername} numberOfLines={1}>
                          {game.sub}
                        </Text>
                      </View>
                      <View style={styles.connectBtn}>
                        <LinearGradient
                          colors={GRADIENTS.violet}
                          start={{ x: 0, y: 0 }}
                          end={{ x: 1, y: 1 }}
                          style={styles.connectBtnGradient}
                        >
                          <Text style={styles.connectBtnText}>Play</Text>
                        </LinearGradient>
                      </View>
                    </TouchableOpacity>
                  ))}
                  <View style={[styles.suggestionRow, styles.gameDivider, { opacity: 0.55 }]}>
                    <View style={[styles.gameTile, styles.gameTileSoon]}>
                      <Ionicons name="sparkles-outline" size={20} color={COLORS.mist} />
                    </View>
                    <View style={styles.suggestionInfo}>
                      <Text style={styles.suggestionName}>More games</Text>
                      <Text style={styles.suggestionUsername}>Coming soon</Text>
                    </View>
                  </View>
                </View>
              </View>
            )}

            {showResults && searching && <SearchResultsSkeleton count={5} />}
            {showResults && !searching && results.length === 0 && (
              <View style={styles.emptyWrap}>
                <Ionicons name="person-outline" size={34} color={COLORS.mist} />
                <Text style={styles.emptyText}>No users found</Text>
                <Text style={styles.emptySub}>
                  Try a different username or name
                </Text>
              </View>
            )}
          </>
        }
        renderItem={({ item }) => (
          <TouchableOpacity
            style={styles.resultRow}
            onPress={() => openProfile(item)}
            activeOpacity={0.7}
          >
            <Avatar
              name={item.display_name}
              color={item.avatar_color}
              avatarUrl={item.avatar_url}
              size={46}
            />

            <View style={styles.resultInfo}>
              <View style={styles.resultNameWrap}>
                <Text style={styles.resultName} numberOfLines={1}>
                  {item.display_name}
                </Text>
                {item.verified && <VerifiedBadge size={13} />}
              </View>
              <Text style={styles.resultUsername} numberOfLines={1}>
                @{item.username}
              </Text>
            </View>

            <Ionicons name="chevron-forward" size={16} color={COLORS.mist} />
          </TouchableOpacity>
        )}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: '#000000' },

  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 18,
    paddingTop: 8,
    paddingBottom: 8,
  },
  headerBrand: {
    fontSize: 22,
    fontFamily: FONTS.displayBold,
    color: '#FFFFFF',
    letterSpacing: -0.5,
  },
  bellBtn: {
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: 'rgba(255,255,255,0.05)',
    alignItems: 'center',
    justifyContent: 'center',
    position: 'relative',
  },
  badge: {
    position: 'absolute',
    top: 1,
    right: 1,
    minWidth: 15,
    height: 15,
    borderRadius: 8,
    backgroundColor: '#EF4444',
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 3,
    borderWidth: 2,
    borderColor: '#000000',
  },
  badgeText: {
    color: '#FFFFFF',
    fontSize: 8,
    fontFamily: FONTS.bodySemiBold,
    lineHeight: 10,
  },

  searchWrap: {
    paddingHorizontal: 18,
    paddingBottom: SPACING.sm,
  },
  searchBox: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#121212',
    borderWidth: 1,
    borderColor: '#1F1F23',
    borderRadius: RADII.lg,
    paddingHorizontal: 13,
    height: 44,
  },
  searchInput: {
    flex: 1,
    fontSize: 14.5,
    fontFamily: FONTS.body,
    color: '#FFFFFF',
    paddingVertical: 0,
    borderWidth: 0,
    borderColor: 'transparent',
    backgroundColor: 'transparent',
    outlineStyle: 'none',
    outlineWidth: 0,
    outlineColor: 'transparent',
    boxShadow: 'none',
  } as any,

  listContent: {
    paddingHorizontal: SPACING.sm,
    paddingBottom: SPACING.lg,
    flexGrow: 1,
  },

  suggestHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: 10,
    paddingTop: SPACING.sm,
    paddingBottom: SPACING.sm,
  },
  suggestTitle: {
    fontSize: 13,
    fontFamily: FONTS.bodySemiBold,
    color: COLORS.mistLight,
    letterSpacing: 0.2,
  },

  matteCard: {
    backgroundColor: '#121212',
    borderWidth: 1,
    borderColor: '#1F1F23',
    borderRadius: RADII.xl,
    paddingVertical: 4,
    paddingHorizontal: 6,
    marginHorizontal: 10,
    marginBottom: 4,
  },
  suggestionRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    paddingVertical: 4,
    paddingHorizontal: 4,
  },
  suggestionInfo: { flex: 1, minWidth: 0 },
  suggestionNameWrap: { flexDirection: 'row', alignItems: 'center' },
  suggestionName: {
    fontSize: 14.5,
    fontFamily: FONTS.bodySemiBold,
    color: '#FFFFFF',
    flexShrink: 1,
  },
  suggestionUsername: {
    fontSize: 12,
    fontFamily: FONTS.body,
    color: COLORS.mist,
    marginTop: 1,
  },
  connectBtn: {
    borderRadius: RADII.full,
    overflow: 'hidden',
  },
  connectBtnGradient: {
    paddingHorizontal: 12,
    paddingVertical: 6,
  },
  connectBtnText: {
    color: '#FFFFFF',
    fontSize: 12.5,
    fontFamily: FONTS.bodySemiBold,
    letterSpacing: 0.3,
  },

  gameTile: {
    width: 46,
    height: 46,
    borderRadius: 14,
    overflow: 'hidden',
  },
  gameTileSoon: {
    backgroundColor: '#17171c',
    borderWidth: 1,
    borderStyle: 'dashed',
    borderColor: '#2A2A31',
    alignItems: 'center',
    justifyContent: 'center',
  },
  gameDivider: {
    borderTopWidth: 1,
    borderTopColor: '#1F1F23',
  },
  gamesHint: {
    marginLeft: 'auto',
    fontSize: 12,
    fontFamily: FONTS.body,
    color: COLORS.mist,
  },

  skeletonRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    paddingVertical: 4,
    paddingHorizontal: 4,
  },
  skeletonAvatar: {
    width: 42,
    height: 42,
    borderRadius: 21,
    backgroundColor: 'rgba(255,255,255,0.08)',
  },
  skeletonName: {
    height: 13,
    width: '50%',
    borderRadius: 6,
    backgroundColor: 'rgba(255,255,255,0.08)',
  },
  skeletonUsername: {
    height: 10,
    width: '30%',
    borderRadius: 6,
    backgroundColor: 'rgba(255,255,255,0.05)',
  },

  skeletonResultRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: SPACING.sm,
    paddingVertical: SPACING.sm,
    paddingHorizontal: SPACING.sm,
  },
  skeletonResultInfo: {
    flex: 1,
    minWidth: 0,
  },

  resultRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: SPACING.sm,
    paddingVertical: SPACING.sm,
    paddingHorizontal: SPACING.sm,
    borderRadius: RADII.lg,
  },
  resultInfo: { flex: 1, minWidth: 0 },
  resultNameWrap: { flexDirection: 'row', alignItems: 'center' },
  resultName: {
    fontSize: 15,
    fontFamily: FONTS.bodySemiBold,
    color: '#FFFFFF',
    flexShrink: 1,
  },
  resultUsername: {
    fontSize: 12.5,
    fontFamily: FONTS.body,
    color: COLORS.mist,
    marginTop: 2,
  },

  emptyWrap: {
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 30,
    paddingTop: 60,
    gap: 10,
  },
  emptyText: {
    fontSize: 15,
    fontFamily: FONTS.bodySemiBold,
    color: COLORS.text,
    marginTop: 6,
  },
  emptySub: {
    fontSize: 12.5,
    fontFamily: FONTS.body,
    color: COLORS.mist,
    textAlign: 'center',
  },
});
