// app/(tabs)/search.tsx
// Search screen — find users by username + suggestions (only @airalance)

import { useEffect, useState, useRef } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TextInput,
  TouchableOpacity,
  FlatList,
  ActivityIndicator,
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

export default function SearchScreen() {
  const router = useRouter();
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<Profile[]>([]);
  const [suggestion, setSuggestion] = useState<Profile | null>(null);
  const [searching, setSearching] = useState(false);
  const [loadingSuggestion, setLoadingSuggestion] = useState(true);
  const [myId, setMyId] = useState<string | null>(null);
  const searchSeq = useRef(0);

  // Get current user
  useEffect(() => {
    supabase.auth.getUser().then(({ data }) => {
      if (data.user) setMyId(data.user.id);
    });
  }, []);

  // Load Airalance suggestion only
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

  // Debounced search
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
      <View style={styles.glowTop} />
      <View style={styles.glowBottom} />

      {/* Header — brand + bell */}
      <View style={styles.header}>
        <Text style={styles.headerBrand}>Airalance!</Text>
        <TouchableOpacity
          style={styles.bellBtn}
          activeOpacity={0.7}
          onPress={() => router.push('/notifications')}
        >
          <Ionicons name="notifications-outline" size={22} color="#FFFFFF" />
          <View style={styles.badge}>
            <Text style={styles.badgeText}>9+</Text>
          </View>
        </TouchableOpacity>
      </View>

      {/* Search input */}
      <View style={styles.searchWrap}>
        <View style={styles.searchBox}>
          <Ionicons
            name="search"
            size={18}
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
          />
          {query.length > 0 && (
            <TouchableOpacity onPress={() => setQuery('')} activeOpacity={0.7}>
              <Ionicons name="close-circle" size={18} color={COLORS.mist} />
            </TouchableOpacity>
          )}
        </View>
      </View>

      {/* Body */}
      <FlatList
        data={showResults ? results : []}
        keyExtractor={(item) => item.id}
        contentContainerStyle={styles.listContent}
        keyboardShouldPersistTaps="handled"
        ListHeaderComponent={
          <>
            {/* Suggestions — only Airalance */}
            {!showResults && (
              <View>
                <View style={styles.suggestHeader}>
                  <Ionicons
                    name="sparkles-outline"
                    size={16}
                    color={COLORS.violetLight}
                  />
                  <Text style={styles.suggestTitle}>Suggestions for you</Text>
                </View>

                {loadingSuggestion ? (
                  <View style={styles.glassCard}>
                    <View style={styles.skeletonRow}>
                      <View style={styles.skeletonAvatar} />
                      <View style={{ flex: 1, gap: 8 }}>
                        <View style={styles.skeletonName} />
                        <View style={styles.skeletonUsername} />
                      </View>
                    </View>
                  </View>
                ) : suggestion ? (
                  <View style={styles.glassCard}>
                    <TouchableOpacity
                      style={styles.suggestionRow}
                      onPress={() => openProfile(suggestion)}
                      activeOpacity={0.7}
                    >
                      <Avatar
                        name={suggestion.display_name}
                        color={suggestion.avatar_color}
                        avatarUrl={suggestion.avatar_url}
                        size={48}
                      />

                      <View style={styles.suggestionInfo}>
                        <View style={styles.suggestionNameWrap}>
                          <Text style={styles.suggestionName} numberOfLines={1}>
                            {suggestion.display_name}
                          </Text>
                          {suggestion.verified && <VerifiedBadge size={14} />}
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

            {/* Search results */}
            {showResults && searching && results.length === 0 && (
              <View style={styles.searchingWrap}>
                <ActivityIndicator color={COLORS.violet} size="small" />
              </View>
            )}
            {showResults && !searching && results.length === 0 && (
              <View style={styles.emptyWrap}>
                <Ionicons name="person-outline" size={36} color={COLORS.mist} />
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
              size={48}
            />

            <View style={styles.resultInfo}>
              <View style={styles.resultNameWrap}>
                <Text style={styles.resultName} numberOfLines={1}>
                  {item.display_name}
                </Text>
                {item.verified && <VerifiedBadge size={14} />}
              </View>
              <Text style={styles.resultUsername} numberOfLines={1}>
                @{item.username}
              </Text>
              {item.bio ? (
                <Text
                  style={styles.resultBio}
                  numberOfLines={1}
                  ellipsizeMode="tail"
                >
                  {item.bio}
                </Text>
              ) : null}
            </View>

            <Ionicons name="chevron-forward" size={18} color={COLORS.mist} />
          </TouchableOpacity>
        )}
      />
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: COLORS.ink900 },

  glowTop: {
    position: 'absolute',
    top: -200,
    left: -100,
    width: 500,
    height: 500,
    borderRadius: 250,
    backgroundColor: 'rgba(124, 92, 255, 0.12)',
  },
  glowBottom: {
    position: 'absolute',
    bottom: -200,
    right: -100,
    width: 460,
    height: 460,
    borderRadius: 230,
    backgroundColor: 'rgba(34, 211, 184, 0.06)',
  },

  // Header
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: SPACING.lg,
    paddingTop: SPACING.sm,
    paddingBottom: SPACING.md,
  },
  headerBrand: {
    fontSize: 28,
    fontFamily: FONTS.displayBold,
    color: '#FFFFFF',
    letterSpacing: -0.5,
  },
  bellBtn: {
    width: 42,
    height: 42,
    borderRadius: 21,
    backgroundColor: 'rgba(255,255,255,0.05)',
    alignItems: 'center',
    justifyContent: 'center',
    position: 'relative',
  },
  badge: {
    position: 'absolute',
    top: 4,
    right: 4,
    minWidth: 18,
    height: 18,
    borderRadius: 9,
    backgroundColor: '#EF4444',
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 4,
    borderWidth: 2,
    borderColor: COLORS.ink900,
  },
  badgeText: {
    color: '#FFFFFF',
    fontSize: 9,
    fontFamily: FONTS.bodySemiBold,
    lineHeight: 12,
  },

  // Search box
  searchWrap: {
    paddingHorizontal: SPACING.lg,
    paddingBottom: SPACING.md,
  },
  searchBox: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: 'rgba(255,255,255,0.05)',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.08)',
    borderRadius: RADII.lg,
    paddingHorizontal: 14,
    height: 48,
  },
  searchInput: {
    flex: 1,
    fontSize: 15,
    fontFamily: FONTS.body,
    color: '#FFFFFF',
    paddingVertical: 0,
  },

  // List
  listContent: {
    paddingHorizontal: SPACING.md,
    paddingBottom: SPACING.xxl,
    flexGrow: 1,
  },

  // Suggestions header
  suggestHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: 4,
    paddingTop: SPACING.sm,
    paddingBottom: SPACING.md,
  },
  suggestTitle: {
    fontSize: 13,
    fontFamily: FONTS.bodySemiBold,
    color: COLORS.mistLight,
    letterSpacing: 0.2,
  },

  // Glass card (suggestion)
  glassCard: {
    backgroundColor: 'rgba(255,255,255,0.04)',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.08)',
    borderRadius: RADII.xl,
    paddingVertical: SPACING.sm,
    paddingHorizontal: SPACING.sm,
    // Glass effect
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.2,
    shadowRadius: 12,
    elevation: 4,
  },
  suggestionRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: SPACING.md,
    paddingVertical: 8,
    paddingHorizontal: 8,
  },
  suggestionInfo: {
    flex: 1,
    minWidth: 0,
  },
  suggestionNameWrap: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  suggestionName: {
    fontSize: 15.5,
    fontFamily: FONTS.bodySemiBold,
    color: '#FFFFFF',
    flexShrink: 1,
  },
  suggestionUsername: {
    fontSize: 13,
    fontFamily: FONTS.body,
    color: COLORS.mist,
    marginTop: 2,
  },
  connectBtn: {
    borderRadius: RADII.full,
    overflow: 'hidden',
  },
  connectBtnGradient: {
    paddingHorizontal: 18,
    paddingVertical: 9,
  },
  connectBtnText: {
    color: '#FFFFFF',
    fontSize: 12.5,
    fontFamily: FONTS.bodySemiBold,
    letterSpacing: 0.3,
  },

  // Skeleton
  skeletonRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: SPACING.md,
    paddingVertical: 8,
    paddingHorizontal: 8,
  },
  skeletonAvatar: {
    width: 48,
    height: 48,
    borderRadius: 24,
    backgroundColor: 'rgba(255,255,255,0.08)',
  },
  skeletonName: {
    height: 14,
    width: '50%',
    borderRadius: 6,
    backgroundColor: 'rgba(255,255,255,0.08)',
  },
  skeletonUsername: {
    height: 12,
    width: '30%',
    borderRadius: 6,
    backgroundColor: 'rgba(255,255,255,0.05)',
  },

  // Result row
  resultRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: SPACING.md,
    paddingVertical: SPACING.sm + 2,
    paddingHorizontal: SPACING.sm,
    borderRadius: RADII.lg,
  },
  resultInfo: {
    flex: 1,
    minWidth: 0,
  },
  resultNameWrap: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  resultName: {
    fontSize: 15,
    fontFamily: FONTS.bodySemiBold,
    color: '#FFFFFF',
    flexShrink: 1,
  },
  resultUsername: {
    fontSize: 13,
    fontFamily: FONTS.body,
    color: COLORS.mist,
    marginTop: 1,
  },
  resultBio: {
    fontSize: 12,
    fontFamily: FONTS.body,
    color: COLORS.mist,
    marginTop: 3,
    opacity: 0.75,
  },

  // Loading
  searchingWrap: {
    paddingVertical: SPACING.xl,
    alignItems: 'center',
  },

  // Empty
  emptyWrap: {
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 40,
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
    fontSize: 12,
    fontFamily: FONTS.body,
    color: COLORS.mist,
    textAlign: 'center',
  },
});
