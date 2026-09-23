// app/(tabs)/search.tsx
// Search screen — find users by username + suggestions

import { useEffect, useState, useCallback, useRef } from 'react';
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
  const [suggestions, setSuggestions] = useState<Profile[]>([]);
  const [searching, setSearching] = useState(false);
  const [loadingSuggestions, setLoadingSuggestions] = useState(true);
  const [myId, setMyId] = useState<string | null>(null);
  const searchSeq = useRef(0);

  // Get current user
  useEffect(() => {
    supabase.auth.getUser().then(({ data }) => {
      if (data.user) setMyId(data.user.id);
    });
  }, []);

  // Load suggestions (featured users)
  useEffect(() => {
    if (!myId) return;

    async function loadSuggestions() {
      try {
        const { data, error } = await supabase
          .from('profiles')
          .select('*')
          .neq('id', myId)
          .order('created_at', { ascending: false })
          .limit(5);

        if (error) throw error;

        // Prioritize certain usernames
        const priority = ['sudhakarin', 'airalance'];
        const sorted = [...(data ?? [])].sort((a, b) => {
          const ai = priority.indexOf((a.username || '').toLowerCase());
          const bi = priority.indexOf((b.username || '').toLowerCase());
          return (ai === -1 ? 999 : ai) - (bi === -1 ? 999 : bi);
        });
        setSuggestions(sorted as Profile[]);
      } catch (err) {
        console.warn('Suggestions error:', err);
      } finally {
        setLoadingSuggestions(false);
      }
    }

    loadSuggestions();
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

        if (seq !== searchSeq.current) return; // stale

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
    // TODO: connect popup (next files)
    router.push(`/profile/${p.id}`);
  }

  const showResults = query.trim().length >= 2;

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      <View style={styles.glowTop} />

      {/* Header */}
      <View style={styles.header}>
        <Text style={styles.headerTitle}>Search</Text>
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
            placeholder="Search by username or name…"
            placeholderTextColor={COLORS.mist}
            autoCapitalize="none"
            autoCorrect={false}
            returnKeyType="search"
          />
          {query.length > 0 && (
            <TouchableOpacity onPress={() => setQuery('')} activeOpacity={0.7}>
              <Ionicons
                name="close-circle"
                size={18}
                color={COLORS.mist}
              />
            </TouchableOpacity>
          )}
        </View>
      </View>

      {/* Body */}
      <FlatList
        data={showResults ? results : suggestions}
        keyExtractor={(item) => item.id}
        contentContainerStyle={styles.listContent}
        keyboardShouldPersistTaps="handled"
        ListHeaderComponent={
          <>
            {!showResults && (
              <View style={styles.suggestHeader}>
                <Ionicons
                  name="sparkles-outline"
                  size={16}
                  color={COLORS.violetLight}
                />
                <Text style={styles.suggestTitle}>
                  Suggestions for you
                </Text>
              </View>
            )}
            {showResults && searching && results.length === 0 && (
              <View style={styles.searchingWrap}>
                <ActivityIndicator color={COLORS.violet} size="small" />
              </View>
            )}
            {showResults && !searching && results.length === 0 && (
              <View style={styles.emptyWrap}>
                <Ionicons
                  name="person-outline"
                  size={36}
                  color={COLORS.mist}
                />
                <Text style={styles.emptyText}>No users found</Text>
                <Text style={styles.emptySub}>
                  Try a different username or name
                </Text>
              </View>
            )}
            {!showResults && loadingSuggestions && (
              <View style={styles.searchingWrap}>
                <ActivityIndicator color={COLORS.violet} size="small" />
              </View>
            )}
          </>
        }
        ListEmptyComponent={
          !showResults && !loadingSuggestions ? (
            <View style={styles.emptyWrap}>
              <Ionicons
                name="people-outline"
                size={36}
                color={COLORS.mist}
              />
              <Text style={styles.emptyText}>
                Start typing to search
              </Text>
              <Text style={styles.emptySub}>
                Find friends by username or full name
              </Text>
            </View>
          ) : null
        }
        renderItem={({ item }) => (
          <TouchableOpacity
            style={styles.row}
            onPress={() => openProfile(item)}
            activeOpacity={0.7}
          >
            <Avatar
              name={item.display_name}
              color={item.avatar_color}
              avatarUrl={item.avatar_url}
              size={48}
            />

            <View style={styles.rowInfo}>
              <View style={styles.rowNameWrap}>
                <Text style={styles.rowName} numberOfLines={1}>
                  {item.display_name}
                </Text>
                {item.verified && (
                  <Ionicons
                    name="checkmark-circle"
                    size={14}
                    color={COLORS.violetLight}
                    style={{ marginLeft: 4 }}
                  />
                )}
              </View>
              <Text style={styles.rowUsername} numberOfLines={1}>
                @{item.username}
              </Text>
              {item.bio ? (
                <Text
                  style={styles.rowBio}
                  numberOfLines={1}
                  ellipsizeMode="tail"
                >
                  {item.bio}
                </Text>
              ) : null}
            </View>

            {!showResults && (
              <TouchableOpacity
                style={styles.connectBtn}
                onPress={() => openConnect(item)}
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
            )}

            {showResults && (
              <Ionicons
                name="chevron-forward"
                size={18}
                color={COLORS.mist}
              />
            )}
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
    backgroundColor: 'rgba(124, 92, 255, 0.10)',
  },

  // Header
  header: {
    paddingHorizontal: SPACING.lg,
    paddingVertical: SPACING.md,
  },
  headerTitle: {
    fontSize: 28,
    fontFamily: FONTS.displayBold,
    color: '#FFFFFF',
    letterSpacing: -0.3,
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
    height: 46,
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
    paddingHorizontal: SPACING.sm,
    paddingTop: SPACING.sm,
    paddingBottom: SPACING.md,
  },
  suggestTitle: {
    fontSize: 13,
    fontFamily: FONTS.bodySemiBold,
    color: COLORS.mistLight,
    letterSpacing: 0.2,
  },

  // Row
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: SPACING.md,
    paddingVertical: SPACING.sm + 2,
    paddingHorizontal: SPACING.sm,
    borderRadius: RADII.lg,
  },
  rowInfo: {
    flex: 1,
    minWidth: 0,
  },
  rowNameWrap: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  rowName: {
    fontSize: 15,
    fontFamily: FONTS.bodySemiBold,
    color: '#FFFFFF',
    flexShrink: 1,
  },
  rowUsername: {
    fontSize: 13,
    fontFamily: FONTS.body,
    color: COLORS.mist,
    marginTop: 1,
  },
  rowBio: {
    fontSize: 12,
    fontFamily: FONTS.body,
    color: COLORS.mist,
    marginTop: 3,
    opacity: 0.75,
  },

  // Connect button
  connectBtn: {
    borderRadius: RADII.full,
    overflow: 'hidden',
  },
  connectBtnGradient: {
    paddingHorizontal: 16,
    paddingVertical: 8,
  },
  connectBtnText: {
    color: '#FFFFFF',
    fontSize: 12,
    fontFamily: FONTS.bodySemiBold,
    letterSpacing: 0.3,
  },

  // Searching / loading
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
