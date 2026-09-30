// app/(tabs)/home.tsx
// Home screen — welcome + news feed + AsyncStorage cache

import { useEffect, useState, useCallback, useMemo, memo, useRef } from 'react';
import {
  View,
  Text,
  StyleSheet,
  FlatList,
  TouchableOpacity,
  RefreshControl,
  ScrollView,
} from 'react-native';
import { Image } from 'expo-image';
import { LinearGradient } from 'expo-linear-gradient';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import Svg, {
  Defs,
  LinearGradient as SvgGradient,
  Stop,
  Path,
  Circle,
} from 'react-native-svg';
import AsyncStorage from '@react-native-async-storage/async-storage';
import {
  COLORS,
  FONTS,
  RADII,
  SPACING,
  SHADOWS,
} from '../../constants/theme';
import { supabase } from '../../lib/supabase';

type NewsArticle = {
  id: string;
  category: string;
  emoji: string;
  thumb_gradient: string;
  image_url?: string | null;
  source_url?: string | null;
  title: string;
  source: string;
  read_time: string;
  body: string[];
  is_featured: boolean;
  created_at: string;
};

const CATEGORIES = ['For you', 'World', 'India', 'Business', 'Education', 'Awareness'];

const CATEGORY_GRADIENTS: Record<string, [string, string]> = {
  World: ['#4F8DFF', '#2F6BFF'],
  India: ['#FF9933', '#138808'],
  Business: ['#7C5CFF', '#5B3FE0'],
  Education: ['#22D3B8', '#16A98C'],
  Awareness: ['#F4607A', '#D66BE0'],
};

const NEWS_CACHE_KEY = 'airalance:news:feed';
const NEWS_CACHE_TTL_MS = 1000 * 60 * 60 * 24; // 24 hours

type NewsCache = {
  t: number;
  articles: NewsArticle[];
};

async function readNewsCache(): Promise<NewsArticle[] | null> {
  try {
    const raw = await AsyncStorage.getItem(NEWS_CACHE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as NewsCache;
    if (!parsed?.articles || !Array.isArray(parsed.articles)) return null;
    if (Date.now() - (parsed.t ?? 0) > NEWS_CACHE_TTL_MS) return null;
    return parsed.articles;
  } catch {
    return null;
  }
}

async function writeNewsCache(articles: NewsArticle[]) {
  try {
    const payload: NewsCache = { t: Date.now(), articles };
    await AsyncStorage.setItem(NEWS_CACHE_KEY, JSON.stringify(payload));
  } catch {}
}

// ---------- Memoized article row ----------
const ArticleRow = memo(
  function ArticleRow({
    article,
    onPress,
  }: {
    article: NewsArticle;
    onPress: (id: string) => void;
  }) {
    return (
      <TouchableOpacity
        style={styles.articleRow}
        onPress={() => onPress(article.id)}
        activeOpacity={0.75}
      >
        {article.image_url ? (
          <Image
            source={{ uri: article.image_url }}
            style={styles.articleThumb}
            contentFit="cover"
            cachePolicy="memory-disk"
            transition={120}
            recyclingKey={article.id}
          />
        ) : (
          <LinearGradient
            colors={CATEGORY_GRADIENTS[article.category] ?? ['#7C5CFF', '#5B3FE0']}
            start={{ x: 0, y: 0 }}
            end={{ x: 1, y: 1 }}
            style={styles.articleThumb}
          >
            <Text style={styles.articleEmoji}>{article.emoji ?? '📰'}</Text>
          </LinearGradient>
        )}

        <View style={styles.articleInfo}>
          <Text style={styles.articleCategory}>
            {article.category?.toUpperCase()}
          </Text>
          <Text style={styles.articleTitle} numberOfLines={3}>
            {article.title}
          </Text>
          <Text style={styles.articleMeta}>
            {article.source} · {article.read_time}
          </Text>
        </View>
      </TouchableOpacity>
    );
  },
  (prev, next) => prev.article.id === next.article.id
);

// ---------- Skeleton ----------
function SkeletonBlock({
  width,
  height,
  borderRadius = 8,
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
        { width, height, borderRadius, backgroundColor: 'rgba(255,255,255,0.08)' },
        style,
      ]}
    />
  );
}

function HomeSkeleton() {
  return (
    <View>
      <SkeletonBlock
        width="100%"
        height={160}
        borderRadius={RADII.xl}
        style={{ marginBottom: SPACING.md }}
      />
      <View style={{ marginBottom: SPACING.md }}>
        <View
          style={{
            flexDirection: 'row',
            alignItems: 'center',
            gap: 8,
            marginBottom: SPACING.sm,
            paddingHorizontal: 4,
          }}
        >
          <SkeletonBlock width={8} height={8} borderRadius={4} />
          <SkeletonBlock width={40} height={14} borderRadius={6} />
        </View>
        <SkeletonBlock width="100%" height={140} borderRadius={RADII.xl} />
      </View>
      {[0, 1, 2, 3].map((i) => (
        <View
          key={i}
          style={{
            flexDirection: 'row',
            alignItems: 'center',
            gap: SPACING.sm,
            paddingVertical: SPACING.sm,
            paddingHorizontal: 4,
          }}
        >
          <SkeletonBlock width={64} height={64} borderRadius={RADII.lg} />
          <View style={{ flex: 1, gap: 6 }}>
            <SkeletonBlock width={50} height={10} borderRadius={4} />
            <SkeletonBlock width="90%" height={13} borderRadius={5} />
            <SkeletonBlock width="70%" height={13} borderRadius={5} />
            <SkeletonBlock width={100} height={10} borderRadius={4} />
          </View>
        </View>
      ))}
    </View>
  );
}

// ---------- Memoized category pill ----------
const CategoryPill = memo(function CategoryPill({
  label,
  isActive,
  onPress,
}: {
  label: string;
  isActive: boolean;
  onPress: (label: string) => void;
}) {
  return (
    <TouchableOpacity
      onPress={() => onPress(label)}
      activeOpacity={0.8}
      style={styles.categoryWrap}
    >
      {isActive ? (
        <LinearGradient
          colors={['#9C82FF', '#7C5CFF']}
          start={{ x: 0, y: 0 }}
          end={{ x: 1, y: 1 }}
          style={styles.categoryPill}
        >
          <Text style={styles.categoryTextActive}>{label}</Text>
        </LinearGradient>
      ) : (
        <View style={styles.categoryPillInactive}>
          <Text style={styles.categoryTextInactive}>{label}</Text>
        </View>
      )}
    </TouchableOpacity>
  );
});

// ---------- Airalance logo (drawn in code, no image file) ----------
function AiralanceLogo({ width = 108 }: { width?: number }) {
  const height = (width * 270) / 440;
  return (
    <Svg width={width} height={height} viewBox="60 80 440 270">
      <Defs>
        <SvgGradient
          id="alLoop"
          gradientUnits="userSpaceOnUse"
          x1="81"
          y1="0"
          x2="477"
          y2="0"
        >
          <Stop offset="0" stopColor="#FFB300" />
          <Stop offset="0.5" stopColor="#FF3D6E" />
          <Stop offset="1" stopColor="#E600A8" />
        </SvgGradient>
        <SvgGradient id="alHeadL" x1="0" y1="0" x2="1" y2="1">
          <Stop offset="0" stopColor="#FFB300" />
          <Stop offset="1" stopColor="#FF7A1A" />
        </SvgGradient>
        <SvgGradient id="alHeadR" x1="0" y1="0" x2="1" y2="1">
          <Stop offset="0" stopColor="#FF2E7E" />
          <Stop offset="1" stopColor="#E600A8" />
        </SvgGradient>
      </Defs>
      <Path
        d="M 279 250 C 320 205 350 190 385 190 C 430 190 455 220 455 255 C 455 295 425 320 385 320 C 350 320 320 300 279 250 C 238 200 208 190 173 190 C 128 190 103 220 103 255 C 103 295 133 320 173 320 C 208 320 238 300 279 250 Z"
        fill="none"
        stroke="url(#alLoop)"
        strokeWidth={44}
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <Circle cx={172} cy={125} r={34} fill="url(#alHeadL)" />
      <Circle cx={388} cy={123} r={36} fill="url(#alHeadR)" />
    </Svg>
  );
}

// ---------- List header component ----------
type HeaderProps = {
  loading: boolean;
  selectedCategory: string;
  onSelectCategory: (cat: string) => void;
  onStartConversation: () => void;
  featured: NewsArticle | null;
  onOpenArticle: (id: string) => void;
  filteredLength: number;
};

const ListHeader = memo(function ListHeader({
  loading,
  selectedCategory,
  onSelectCategory,
  onStartConversation,
  featured,
  onOpenArticle,
  filteredLength,
}: HeaderProps) {
  return (
    <>
      <View style={styles.welcomeCard}>
        <View style={styles.welcomeLogoWrap}>
          <AiralanceLogo width={78} />
        </View>
        <Text style={styles.welcomeTitle}>Welcome to Airalance!</Text>
        <Text style={styles.welcomeSubtitle}>
          Let's connect. Real conversations, real time.
        </Text>
        <TouchableOpacity
          style={styles.welcomeBtn}
          onPress={onStartConversation}
          activeOpacity={0.85}
        >
          <LinearGradient
            colors={['#9C82FF', '#7C5CFF']}
            start={{ x: 0, y: 0 }}
            end={{ x: 1, y: 1 }}
            style={styles.welcomeBtnGradient}
          >
            <Text style={styles.welcomeBtnText}>Start a conversation</Text>
          </LinearGradient>
        </TouchableOpacity>
      </View>

      <View style={styles.newsSection}>
        <View style={styles.newsHeader}>
          <Text style={styles.newsTitle}>News for you</Text>
        </View>

        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          contentContainerStyle={styles.categoriesRow}
        >
          {CATEGORIES.map((cat) => (
            <CategoryPill
              key={cat}
              label={cat}
              isActive={selectedCategory === cat}
              onPress={onSelectCategory}
            />
          ))}
        </ScrollView>

        {loading ? (
          <HomeSkeleton />
        ) : filteredLength === 0 ? (
          <View style={styles.emptyWrap}>
            <Ionicons name="newspaper-outline" size={40} color={COLORS.mist} />
            <Text style={styles.emptyText}>
              No {selectedCategory === 'For you' ? 'news' : selectedCategory} articles yet.
            </Text>
            <Text style={styles.emptySubtext}>Check back soon.</Text>
          </View>
        ) : (
          <>
            {featured && (
              <TouchableOpacity
                style={styles.featuredCard}
                onPress={() => onOpenArticle(featured.id)}
                activeOpacity={0.9}
              >
                {featured.image_url ? (
                  <Image
                    source={{ uri: featured.image_url }}
                    style={styles.featuredImage}
                    contentFit="cover"
                    cachePolicy="memory-disk"
                    transition={120}
                    recyclingKey={featured.id}
                  />
                ) : (
                  <LinearGradient
                    colors={
                      CATEGORY_GRADIENTS[featured.category] ?? ['#7C5CFF', '#5B3FE0']
                    }
                    start={{ x: 0, y: 0 }}
                    end={{ x: 1, y: 1 }}
                    style={styles.featuredImage}
                  >
                    <Text style={styles.featuredEmoji}>
                      {featured.emoji ?? '📰'}
                    </Text>
                  </LinearGradient>
                )}

                <LinearGradient
                  colors={['transparent', 'rgba(10,12,18,0.95)']}
                  style={styles.featuredOverlay}
                />

                <View style={styles.featuredContent}>
                  <View style={styles.featuredBadge}>
                    <Text style={styles.featuredBadgeText}>
                      FEATURED · {featured.category}
                    </Text>
                  </View>
                  <Text style={styles.featuredTitle} numberOfLines={2}>
                    {featured.title}
                  </Text>
                  <View style={styles.featuredMeta}>
                    <Text style={styles.featuredMetaText}>
                      {featured.source} · {featured.read_time}
                    </Text>
                  </View>
                </View>
              </TouchableOpacity>
            )}

            <View style={styles.liveSection}>
              <View style={styles.liveHeader}>
                <View style={styles.livePulse} />
                <View style={styles.livePulseInner} />
                <Text style={styles.liveTitle}>Live</Text>
              </View>
              <View style={styles.liveBox}>
                <Ionicons name="radio-outline" size={38} color={COLORS.mist} />
                <Text style={styles.liveText}>
                  Live stream will appear here
                </Text>
              </View>
            </View>
          </>
        )}
      </View>
    </>
  );
});

// ---------- Screen ----------
export default function HomeScreen() {
  const router = useRouter();
  const [articles, setArticles] = useState<NewsArticle[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [selectedCategory, setSelectedCategory] = useState('For you');
  const [notifCount, setNotifCount] = useState(0);

  const cacheShownRef = useRef(false);

  // ✅ Cache-first: show cached news instantly
  useEffect(() => {
    if (cacheShownRef.current) return;
    (async () => {
      const cached = await readNewsCache();
      if (cached && cached.length > 0) {
        setArticles(cached);
        setLoading(false);
      }
      cacheShownRef.current = true;
    })();
  }, []);

  const fetchNews = useCallback(async () => {
    try {
      const { data, error } = await supabase
        .from('news_articles')
        .select('*')
        .order('created_at', { ascending: false })
        .limit(20);

      if (error) {
        console.warn('News fetch error:', error.message);
        // don't wipe cache — keep showing stale
      } else {
        const list = (data ?? []) as NewsArticle[];
        setArticles(list);
        // ✅ Save fresh to cache
        await writeNewsCache(list);
      }
    } catch (err) {
      console.warn('News fetch crashed:', err);
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

  const fetchNotificationCount = useCallback(async () => {
    const { data: { session } } = await supabase.auth.getSession();
    if (!session?.user) return;
    const { count } = await supabase
      .from('app_notifications')
      .select('id', { count: 'exact', head: true })
      .eq('user_id', session.user.id)
      .eq('read', false);
    setNotifCount(count ?? 0);
  }, []);

  useEffect(() => {
    fetchNews();
    fetchNotificationCount();
  }, [fetchNews, fetchNotificationCount]);

  const onRefresh = useCallback(async () => {
    setRefreshing(true);
    await Promise.all([fetchNews(), fetchNotificationCount()]);
  }, [fetchNews, fetchNotificationCount]);

  const filteredArticles = useMemo(() => {
    if (selectedCategory === 'For you') return articles;
    const lower = selectedCategory.toLowerCase();
    return articles.filter((a) => a.category?.toLowerCase() === lower);
  }, [articles, selectedCategory]);

  const featured = useMemo(
    () => filteredArticles.find((a) => a.is_featured) ?? filteredArticles[0] ?? null,
    [filteredArticles]
  );

  const rest = useMemo(
    () => filteredArticles.filter((a) => a.id !== featured?.id),
    [filteredArticles, featured]
  );

  const openArticle = useCallback(
    (id: string) => router.push(`/news/${id}`),
    [router]
  );

  const onSelectCategory = useCallback(
    (cat: string) => setSelectedCategory(cat),
    []
  );

  const onStartConversation = useCallback(
    () => router.push('/(tabs)/search'),
    [router]
  );

  const renderItem = useCallback(
    ({ item, index }: { item: NewsArticle; index: number }) => (
      <>
        <ArticleRow article={item} onPress={openArticle} />
        {index < rest.length - 1 && <View style={styles.articleDivider} />}
      </>
    ),
    [openArticle, rest.length]
  );

  const keyExtractor = useCallback((item: NewsArticle) => item.id, []);

  const listHeader = useMemo(
    () => (
      <ListHeader
        loading={loading}
        selectedCategory={selectedCategory}
        onSelectCategory={onSelectCategory}
        onStartConversation={onStartConversation}
        featured={featured}
        onOpenArticle={openArticle}
        filteredLength={filteredArticles.length}
      />
    ),
    [
      loading,
      selectedCategory,
      onSelectCategory,
      onStartConversation,
      featured,
      openArticle,
      filteredArticles.length,
    ]
  );

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      <View style={styles.header}>
        <Text style={styles.brandText}>Airalance!</Text>
        <TouchableOpacity
          style={styles.bellBtn}
          onPress={() => router.push('/notifications')}
          activeOpacity={0.7}
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

      <FlatList
        data={loading && articles.length === 0 ? [] : rest}
        keyExtractor={keyExtractor}
        renderItem={renderItem}
        ListHeaderComponent={listHeader}
        contentContainerStyle={styles.scroll}
        showsVerticalScrollIndicator={false}
        initialNumToRender={4}
        maxToRenderPerBatch={4}
        windowSize={5}
        updateCellsBatchingPeriod={50}
        removeClippedSubviews={true}
        refreshControl={
          <RefreshControl
            refreshing={refreshing}
            onRefresh={onRefresh}
            tintColor={COLORS.violet}
            colors={[COLORS.violet]}
          />
        }
      />
    </SafeAreaView>
  );
}

// ---------- Styles (unchanged) ----------
const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: '#000000' },
  scroll: { paddingBottom: 40 },

  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 18,
    paddingTop: 8,
    paddingBottom: 8,
  },
  brandText: {
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

  welcomeCard: {
    alignItems: 'center',
    paddingHorizontal: SPACING.lg,
    paddingTop: SPACING.sm,
    paddingBottom: SPACING.md,
  },
  welcomeLogoWrap: {
    width: 116,
    height: 116,
    borderRadius: 58,
    backgroundColor: 'rgba(156,130,255,0.12)',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.08)',
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: SPACING.sm,
  },
  welcomeTitle: {
    fontSize: 19,
    fontFamily: FONTS.displayBold,
    color: '#FFFFFF',
    textAlign: 'center',
  },
  welcomeSubtitle: {
    marginTop: 4,
    fontSize: 12.5,
    fontFamily: FONTS.body,
    color: COLORS.mist,
    textAlign: 'center',
    paddingHorizontal: 16,
    lineHeight: 17,
  },
  welcomeBtn: {
    marginTop: SPACING.md,
    borderRadius: RADII.full,
    overflow: 'hidden',
    ...SHADOWS.buttonViolet,
  },
  welcomeBtnGradient: { paddingVertical: 9, paddingHorizontal: 20 },
  welcomeBtnText: {
    color: '#FFFFFF',
    fontSize: 13,
    fontFamily: FONTS.bodySemiBold,
  },

  newsSection: { paddingHorizontal: 18, marginTop: SPACING.sm },
  newsHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 4,
    marginBottom: SPACING.sm,
  },
  newsTitle: {
    fontSize: 16,
    fontFamily: FONTS.displayBold,
    color: '#FFFFFF',
  },

  categoriesRow: { gap: 6, paddingRight: SPACING.md, paddingBottom: SPACING.sm },
  categoryWrap: { marginRight: 5 },
  categoryPill: {
    paddingHorizontal: 13,
    paddingVertical: 6,
    borderRadius: RADII.full,
  },
  categoryPillInactive: {
    paddingHorizontal: 13,
    paddingVertical: 6,
    borderRadius: RADII.full,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.1)',
    backgroundColor: 'rgba(255,255,255,0.03)',
  },
  categoryTextActive: {
    color: '#FFFFFF',
    fontSize: 12,
    fontFamily: FONTS.bodySemiBold,
  },
  categoryTextInactive: {
    color: COLORS.mist,
    fontSize: 12,
    fontFamily: FONTS.bodySemiBold,
  },

  emptyWrap: { paddingVertical: 40, alignItems: 'center', gap: 8 },
  emptyText: {
    color: COLORS.text,
    fontSize: 13.5,
    fontFamily: FONTS.bodyMedium,
    textAlign: 'center',
  },
  emptySubtext: { color: COLORS.mist, fontSize: 12, fontFamily: FONTS.body },

  featuredCard: {
    height: 150,
    borderRadius: RADII.xl,
    overflow: 'hidden',
    marginBottom: SPACING.md,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.08)',
  },
  featuredImage: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    width: '100%',
    height: '100%',
    alignItems: 'center',
    justifyContent: 'center',
  },
  featuredEmoji: { fontSize: 40, opacity: 0.85 },
  featuredOverlay: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 0,
    height: '80%',
  },
  featuredContent: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 0,
    padding: SPACING.sm + 2,
  },
  featuredBadge: {
    alignSelf: 'flex-start',
    paddingHorizontal: 7,
    paddingVertical: 2,
    borderRadius: RADII.full,
    backgroundColor: 'rgba(255,255,255,0.18)',
    marginBottom: 5,
  },
  featuredBadgeText: {
    color: '#FFFFFF',
    fontSize: 9,
    fontFamily: FONTS.bodySemiBold,
    letterSpacing: 0.5,
  },
  featuredTitle: {
    color: '#FFFFFF',
    fontSize: 13.5,
    fontFamily: FONTS.displayBold,
    lineHeight: 18,
  },
  featuredMeta: { marginTop: 3 },
  featuredMetaText: {
    color: 'rgba(255,255,255,0.75)',
    fontSize: 10.5,
    fontFamily: FONTS.body,
  },

  liveSection: { marginBottom: SPACING.md },
  liveHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginBottom: SPACING.sm,
    paddingHorizontal: 4,
  },
  livePulse: {
    width: 7,
    height: 7,
    borderRadius: 4,
    backgroundColor: COLORS.danger,
    opacity: 0.3,
    position: 'absolute',
  },
  livePulseInner: {
    width: 7,
    height: 7,
    borderRadius: 4,
    backgroundColor: COLORS.danger,
  },
  liveTitle: {
    color: '#FFFFFF',
    fontSize: 15,
    fontFamily: FONTS.displayBold,
  },
  liveBox: {
    height: 130,
    borderRadius: RADII.xl,
    backgroundColor: 'rgba(0,0,0,0.5)',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.08)',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
  },
  liveText: {
    color: COLORS.mist,
    fontSize: 12,
    fontFamily: FONTS.body,
  },

  articleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: SPACING.sm,
    paddingVertical: SPACING.sm,
    paddingHorizontal: 4,
    borderRadius: RADII.lg,
    marginHorizontal: 18,
  },
  articleDivider: {
    height: 1,
    backgroundColor: 'rgba(255,255,255,0.07)',
    marginHorizontal: 22,
    marginVertical: 2,
  },
  articleThumb: {
    width: 64,
    height: 64,
    borderRadius: RADII.lg,
    alignItems: 'center',
    justifyContent: 'center',
  },
  articleEmoji: { fontSize: 24, opacity: 0.9 },
  articleInfo: { flex: 1 },
  articleCategory: {
    color: COLORS.teal,
    fontSize: 9.5,
    fontFamily: FONTS.bodySemiBold,
    letterSpacing: 0.6,
    marginBottom: 2,
  },
  articleTitle: {
    color: '#FFFFFF',
    fontSize: 13.5,
    fontFamily: FONTS.bodySemiBold,
    lineHeight: 18,
  },
  articleMeta: {
    marginTop: 3,
    color: COLORS.mist,
    fontSize: 11,
    fontFamily: FONTS.body,
  },
});
