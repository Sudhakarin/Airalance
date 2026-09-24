// app/(tabs)/search.tsx
// Search screen — find users by username + suggestions (only @airalance) + skeleton

import { useEffect, useState, useRef } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TextInput,
  TouchableOpacity,
  FlatList,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
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
  const router = useRouter();
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<Profile[]>([]);
  const [suggestion, setSuggestion] = useState<Profile | null>(null);
  const [searching, setSearching] = useState(false);
  const [loadingSuggestion, setLoadingSuggestion] = useState(true);
  const [myId, setMyId] = useState<string | null>(null);
  const searchSeq = useRef(0);

  useEffect(() => {
    supabase.auth.getUser().then(({ data }) => {
      if (data.user) setMyId(data.user.id);
    });
  }, []);

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
  }, [myId]);

  useEffect(() => {
    if (!myId) return;

    const trimmed = query.trim();
    if (trimmed.length < 2) {
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
          .or(
            `username.ilike.%${trimmed}%,display_name.ilike.%${trimmed}%`
          )
          .neq('id', myId)
          .limit(15);

        if (seq !== searchSeq.current) return;

        if (!error && data) setResults(data as Profile[]);
      } catch (err) {
        console.warn('Search error:', err);
      } finally {
        if (seq === searchSeq.current) setSearching(false);
      }
    }, 350);

    return () => clearTimeout(timer);
  }, [query, myId]);

  function openProfile(p: Profile) {
    router.push(`/profile/${p.id}`);
  }

  function openConnect(p: Profile) {
    router.push(`/profile/${p.id}`);
  }

  const showResults = query.trim().length >= 2;

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      <View style={styles.header}>
        <Text style={styles.headerBrand}>Airalance!</Text>
        <TouchableOpacity
          style={styles.bellBtn}
          activeOpacity={0.7}
          onPress={() => router.push('/notifications')}
        >
          <Ionicons name="notifications-outline" size={19} color="#FFFFFF" />
          <View style={styles.badge}>
            <Text style={styles.badgeText}>9+</Text>
          </View>
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
    </SafeAreaView>
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
    paddingHorizontal: 4,
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
