// app/(tabs)/home.tsx
// Home screen — category chips + featured carousel + Top Stories + AsyncStorage cache

import { useEffect, useState, useCallback, useMemo, memo, useRef } from 'react';
import {
  View,
  Text,
  StyleSheet,
  FlatList,
  TouchableOpacity,
  RefreshControl,
  ScrollView,
  Dimensions,
  NativeSyntheticEvent,
  NativeScrollEvent,
} from 'react-native';
import { Image } from 'expo-image';
import { LinearGradient } from 'expo-linear-gradient';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { COLORS, FONTS, RADII, SPACING } from '../../constants/theme';
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

type IconName = keyof typeof Ionicons.glyphMap;

const CATEGORIES = ['For you', 'World', 'India', 'Business', 'Education', 'Awareness'];

const CATEGORY_ICONS: Record<string, IconName> = {
  'For you': 'home',
  World: 'globe-outline',
  India: 'flag-outline',
  Business: 'bar-chart',
  Education: 'school',
  Awareness: 'megaphone-outline',
};

const CATEGORY_GRADIENTS: Record<string, [string, string]> = {
  World: ['#4F8DFF', '#2F6BFF'],
  India: ['#FF9933', '#138808'],
  Business: ['#7C5CFF', '#5B3FE0'],
  Education: ['#22D3B8', '#16A98C'],
  Awareness: ['#F4607A', '#D66BE0'],
};

const DEFAULT_GRADIENT: [string, string] = ['#7C5CFF', '#5B3FE0'];

const BG = COLORS.ink900;
const SIDE = 18;
const GAP = 12;
const SCREEN_W = Dimensions.get('window').width;
const CARD_W = SCREEN_W - SIDE * 2;
const SNAP = CARD_W + GAP;
const TOP_LIMIT = 6;

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

// ---------- Helpers ----------
function timeAgo(iso: string): string {
  const ts = new Date(iso).getTime();
  if (!ts) return '';
  const s = Math.max(0, (Date.now() - ts) / 1000);
  const m = Math.floor(s / 60);
  if (m < 1) return 'just now';
  if (m < 60) return `${m} min ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h} hr ago`;
  const d = Math.floor(h / 24);
  return `${d} d ago`;
}

function initials(name: string): string {
  const letters = (name ?? '')
    .split(/\s+/)
    .filter(Boolean)
    .map((w) => w[0].toUpperCase())
    .join('');
  return letters.slice(0, 3) || 'N';
}

// ---------- Article image (photo or gradient fallback) ----------
function ArticleImage({
  article,
  style,
  emojiSize,
}: {
  article: NewsArticle;
  style: any;
  emojiSize: number;
}) {
  if (article.image_url) {
    return (
      <Image
        source={{ uri: article.image_url }}
        style={style}
        contentFit="cover"
        cachePolicy="memory-disk"
        transition={120}
        recyclingKey={article.id}
      />
    );
  }
  return (
    <LinearGradient
      colors={CATEGORY_GRADIENTS[article.category] ?? DEFAULT_GRADIENT}
      start={{ x: 0, y: 0 }}
      end={{ x: 1, y: 1 }}
      style={[style, styles.center]}
    >
      <Text style={{ fontSize: emojiSize, opacity: 0.9 }}>{article.emoji ?? '📰'}</Text>
    </LinearGradient>
  );
}

// ---------- Top Stories row ----------
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
        activeOpacity={0.8}
      >
        <ArticleImage article={article} style={styles.articleThumb} emojiSize={30} />
        <Text style={styles.articleTitle} numberOfLines={3}>
          {article.title}
        </Text>
        <View style={styles.articleRight}>
          <Text style={styles.articleTime}>{timeAgo(article.created_at)}</Text>
          <Ionicons name="ellipsis-vertical" size={16} color={COLORS.mist} />
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
    <View style={{ paddingHorizontal: SIDE }}>
      <SkeletonBlock
        width="100%"
        height={250}
        borderRadius={RADII.xxl}
        style={{ marginBottom: SPACING.xl }}
      />
      <SkeletonBlock
        width={160}
        height={18}
        borderRadius={6}
        style={{ marginBottom: SPACING.md }}
      />
      {[0, 1, 2].map((i) => (
        <SkeletonBlock
          key={i}
          width="100%"
          height={84}
          borderRadius={RADII.lg}
          style={{ marginBottom: 10 }}
        />
      ))}
    </View>
  );
}

// ---------- Category chip ----------
const CategoryPill = memo(function CategoryPill({
  label,
  isActive,
  onPress,
}: {
  label: string;
  isActive: boolean;
  onPress: (label: string) => void;
}) {
  const icon = CATEGORY_ICONS[label] ?? 'newspaper-outline';
  return (
    <TouchableOpacity
      onPress={() => onPress(label)}
      activeOpacity={0.8}
      style={isActive ? styles.pillGlow : undefined}
    >
      {isActive ? (
        <LinearGradient
          colors={['#8A6BFF', '#6B4CF0']}
          start={{ x: 0, y: 0 }}
          end={{ x: 1, y: 1 }}
          style={styles.pill}
        >
          <Ionicons name={icon} size={18} color="#FFFFFF" />
          <Text style={styles.pillTextActive}>{label}</Text>
        </LinearGradient>
      ) : (
        <View style={[styles.pill, styles.pillInactive]}>
          <Ionicons name={icon} size={18} color={COLORS.mistLight} />
          <Text style={styles.pillTextInactive}>{label}</Text>
        </View>
      )}
    </TouchableOpacity>
  );
});

// ---------- Featured card ----------
const FeaturedCard = memo(function FeaturedCard({
  article,
  onOpen,
}: {
  article: NewsArticle;
  onOpen: (id: string) => void;
}) {
  const description = article.body?.[0] ?? '';
  return (
    <TouchableOpacity
      style={styles.featuredCard}
      onPress={() => onOpen(article.id)}
      activeOpacity={0.92}
    >
      <ArticleImage article={article} style={styles.featuredImage} emojiSize={60} />

      <LinearGradient
        colors={['rgba(10,12,18,0)', 'rgba(10,12,18,0.7)', 'rgba(10,12,18,0.96)']}
        locations={[0, 0.5, 1]}
        style={styles.featuredOverlay}
      />

      <View style={styles.featuredBadge}>
        <Ionicons name="star" size={12} color="#FFFFFF" />
        <Text style={styles.featuredBadgeText}>Featured</Text>
      </View>
      <View style={styles.featuredTime}>
        <Text style={styles.featuredTimeText}>{timeAgo(article.created_at)}</Text>
      </View>

      <View style={styles.featuredContent}>
        <Text style={styles.featuredTitle} numberOfLines={3}>
          {article.title}
        </Text>
        {description ? (
          <Text style={styles.featuredDesc} numberOfLines={2}>
            {description}
          </Text>
        ) : null}

        <View style={styles.featuredFooter}>
          <View style={styles.sourceAvatar}>
            <Text style={styles.sourceAvatarText}>{initials(article.source)}</Text>
          </View>
          <Text style={styles.sourceName} numberOfLines={1}>
            {article.source}
          </Text>
          <Ionicons name="checkmark-circle" size={16} color={COLORS.violetLight} />
          <View style={styles.readTime}>
            <Ionicons name="document-text" size={14} color={COLORS.mist} />
            <Text style={styles.readTimeText} numberOfLines={1}>
              {article.read_time}
            </Text>
          </View>
          <View style={{ flex: 1 }} />
          <View style={styles.readMoreBtn}>
            <Text style={styles.readMoreText}>Read more</Text>
            <Ionicons name="arrow-forward" size={14} color="#FFFFFF" />
          </View>
        </View>
      </View>
    </TouchableOpacity>
  );
});

// ---------- Featured carousel ----------
const FeaturedCarousel = memo(function FeaturedCarousel({
  items,
  onOpen,
}: {
  items: NewsArticle[];
  onOpen: (id: string) => void;
}) {
  const [index, setIndex] = useState(0);

  const onScrollEnd = useCallback(
    (e: NativeSyntheticEvent<NativeScrollEvent>) => {
      const i = Math.round(e.nativeEvent.contentOffset.x / SNAP);
      setIndex(Math.max(0, Math.min(items.length - 1, i)));
    },
    [items.length]
  );

  return (
    <View>
      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        snapToInterval={SNAP}
        decelerationRate="fast"
        onMomentumScrollEnd={onScrollEnd}
        contentContainerStyle={{ paddingHorizontal: SIDE, gap: GAP }}
      >
        {items.map((item) => (
          <FeaturedCard key={item.id} article={item} onOpen={onOpen} />
        ))}
      </ScrollView>

      {items.length > 1 && (
        <View style={styles.dotsRow}>
          {items.map((item, i) => (
            <View key={item.id} style={[styles.dot, i === index && styles.dotActive]} />
          ))}
        </View>
      )}
    </View>
  );
});

// ---------- List header ----------
type HeaderProps = {
  loading: boolean;
  selectedCategory: string;
  onSelectCategory: (cat: string) => void;
  featuredList: NewsArticle[];
  onOpenArticle: (id: string) => void;
  filteredLength: number;
  restLength: number;
  showAll: boolean;
  onToggleAll: () => void;
};

const ListHeader = memo(function ListHeader({
  loading,
  selectedCategory,
  onSelectCategory,
  featuredList,
  onOpenArticle,
  filteredLength,
  restLength,
  showAll,
  onToggleAll,
}: HeaderProps) {
  return (
    <>
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
          <FeaturedCarousel
            key={selectedCategory}
            items={featuredList}
            onOpen={onOpenArticle}
          />

          {restLength > 0 && (
            <View style={styles.sectionHeader}>
              <Text style={styles.sectionTitle}>Top Stories for You</Text>
              {restLength > TOP_LIMIT && (
                <TouchableOpacity
                  onPress={onToggleAll}
                  activeOpacity={0.7}
                  style={styles.seeAll}
                >
                  <Text style={styles.seeAllText}>{showAll ? 'Show less' : 'See all'}</Text>
                  <Ionicons
                    name={showAll ? 'arrow-up' : 'arrow-forward'}
                    size={16}
                    color={COLORS.violetLight}
                  />
                </TouchableOpacity>
              )}
            </View>
          )}
        </>
      )}
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
  const [showAll, setShowAll] = useState(false);

  const cacheShownRef = useRef(false);

  // Cache-first: show cached news instantly
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
        // keep showing stale cache
      } else {
        const list = (data ?? []) as NewsArticle[];
        setArticles(list);
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

  // Carousel: featured articles (max 5), else latest 3
  const featuredList = useMemo(() => {
    const feat = filteredArticles.filter((a) => a.is_featured).slice(0, 5);
    return feat.length > 0 ? feat : filteredArticles.slice(0, 3);
  }, [filteredArticles]);

  const rest = useMemo(() => {
    const ids = new Set(featuredList.map((a) => a.id));
    return filteredArticles.filter((a) => !ids.has(a.id));
  }, [filteredArticles, featuredList]);

  const visibleRest = useMemo(
    () => (showAll ? rest : rest.slice(0, TOP_LIMIT)),
    [rest, showAll]
  );

  const openArticle = useCallback(
    (id: string) => router.push(`/news/${id}`),
    [router]
  );

  const onSelectCategory = useCallback((cat: string) => {
    setSelectedCategory(cat);
    setShowAll(false);
  }, []);

  const onToggleAll = useCallback(() => setShowAll((v) => !v), []);

  const renderItem = useCallback(
    ({ item }: { item: NewsArticle }) => (
      <ArticleRow article={item} onPress={openArticle} />
    ),
    [openArticle]
  );

  const keyExtractor = useCallback((item: NewsArticle) => item.id, []);
  const renderSeparator = useCallback(() => <View style={{ height: 10 }} />, []);

  const listHeader = useMemo(
    () => (
      <ListHeader
        loading={loading}
        selectedCategory={selectedCategory}
        onSelectCategory={onSelectCategory}
        featuredList={featuredList}
        onOpenArticle={openArticle}
        filteredLength={filteredArticles.length}
        restLength={rest.length}
        showAll={showAll}
        onToggleAll={onToggleAll}
      />
    ),
    [
      loading,
      selectedCategory,
      onSelectCategory,
      featuredList,
      openArticle,
      filteredArticles.length,
      rest.length,
      showAll,
      onToggleAll,
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
              <Text style={styles.badgeText}>{notifCount > 9 ? '9+' : notifCount}</Text>
            </View>
          )}
        </TouchableOpacity>
      </View>

      <FlatList
        data={loading && articles.length === 0 ? [] : visibleRest}
        keyExtractor={keyExtractor}
        renderItem={renderItem}
        ItemSeparatorComponent={renderSeparator}
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

// ---------- Styles ----------
const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: BG },
  scroll: { paddingBottom: 40 },
  center: { alignItems: 'center', justifyContent: 'center' },

  // Top bar
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: SIDE,
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
  },
  badge: {
    position: 'absolute',
    top: 1,
    right: 1,
    minWidth: 15,
    height: 15,
    borderRadius: 8,
    backgroundColor: COLORS.danger,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 3,
    borderWidth: 2,
    borderColor: BG,
  },
  badgeText: {
    color: '#FFFFFF',
    fontSize: 8,
    fontFamily: FONTS.bodySemiBold,
    lineHeight: 10,
  },

  // Category chips
  categoriesRow: {
    paddingHorizontal: SIDE,
    paddingTop: 6,
    paddingBottom: 16,
    gap: 10,
  },
  pillGlow: {
    borderRadius: RADII.full,
    shadowColor: COLORS.violet,
    shadowOffset: { width: 0, height: 0 },
    shadowOpacity: 0.55,
    shadowRadius: 12,
  },
  pill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingHorizontal: 16,
    height: 44,
    borderRadius: RADII.full,
  },
  pillInactive: {
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.1)',
    backgroundColor: 'rgba(255,255,255,0.04)',
  },
  pillTextActive: {
    color: '#FFFFFF',
    fontSize: 14,
    fontFamily: FONTS.bodySemiBold,
  },
  pillTextInactive: {
    color: COLORS.mistLight,
    fontSize: 14,
    fontFamily: FONTS.bodySemiBold,
  },

  // Empty
  emptyWrap: { paddingVertical: 40, alignItems: 'center', gap: 8 },
  emptyText: {
    color: COLORS.text,
    fontSize: 13.5,
    fontFamily: FONTS.bodyMedium,
    textAlign: 'center',
  },
  emptySubtext: { color: COLORS.mist, fontSize: 12, fontFamily: FONTS.body },

  // Featured card
  featuredCard: {
    width: CARD_W,
    height: 250,
    borderRadius: RADII.xxl,
    overflow: 'hidden',
    backgroundColor: COLORS.ink800,
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
  },
  featuredOverlay: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 0,
    height: '85%',
  },
  featuredBadge: {
    position: 'absolute',
    top: 12,
    left: 12,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    paddingHorizontal: 11,
    paddingVertical: 6,
    borderRadius: RADII.full,
    backgroundColor: COLORS.violet,
  },
  featuredBadgeText: {
    color: '#FFFFFF',
    fontSize: 12,
    fontFamily: FONTS.bodySemiBold,
  },
  featuredTime: {
    position: 'absolute',
    top: 12,
    right: 12,
    paddingHorizontal: 11,
    paddingVertical: 6,
    borderRadius: RADII.full,
    backgroundColor: 'rgba(0,0,0,0.45)',
  },
  featuredTimeText: {
    color: COLORS.mistLight,
    fontSize: 11.5,
    fontFamily: FONTS.bodyMedium,
  },
  featuredContent: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 0,
    paddingHorizontal: 14,
    paddingBottom: 12,
  },
  featuredTitle: {
    color: '#FFFFFF',
    fontSize: 20,
    lineHeight: 25,
    fontFamily: FONTS.displayBold,
  },
  featuredDesc: {
    marginTop: 6,
    color: COLORS.mistLight,
    fontSize: 12.5,
    lineHeight: 17,
    fontFamily: FONTS.body,
  },
  featuredFooter: {
    marginTop: 10,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  sourceAvatar: {
    width: 30,
    height: 30,
    borderRadius: 15,
    backgroundColor: 'rgba(255,255,255,0.08)',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.25)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  sourceAvatarText: {
    color: '#FFFFFF',
    fontSize: 9,
    fontFamily: FONTS.displayBold,
  },
  sourceName: {
    color: '#FFFFFF',
    fontSize: 12,
    fontFamily: FONTS.bodySemiBold,
    maxWidth: 90,
  },
  readTime: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    marginLeft: 6,
  },
  readTimeText: {
    color: COLORS.mist,
    fontSize: 11,
    fontFamily: FONTS.body,
    maxWidth: 70,
  },
  readMoreBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: RADII.full,
    borderWidth: 1,
    borderColor: COLORS.violet,
    backgroundColor: 'rgba(124,92,255,0.12)',
  },
  readMoreText: {
    color: '#FFFFFF',
    fontSize: 12,
    fontFamily: FONTS.bodySemiBold,
  },

  // Carousel dots
  dotsRow: {
    flexDirection: 'row',
    justifyContent: 'center',
    gap: 8,
    marginTop: 14,
  },
  dot: {
    width: 8,
    height: 8,
    borderRadius: 4,
    backgroundColor: 'rgba(255,255,255,0.18)',
  },
  dotActive: { backgroundColor: COLORS.violet },

  // Section header
  sectionHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: SIDE,
    marginTop: 22,
    marginBottom: 12,
  },
  sectionTitle: {
    color: '#FFFFFF',
    fontSize: 18,
    fontFamily: FONTS.displayBold,
  },
  seeAll: { flexDirection: 'row', alignItems: 'center', gap: 5 },
  seeAllText: {
    color: COLORS.violetLight,
    fontSize: 14,
    fontFamily: FONTS.bodySemiBold,
  },

  // Top Stories row
  articleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginHorizontal: SIDE,
    height: 88,
    borderRadius: RADII.lg,
    overflow: 'hidden',
    backgroundColor: 'rgba(255,255,255,0.04)',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.07)',
  },
  articleThumb: {
    width: 104,
    height: '100%',
  },
  articleTitle: {
    flex: 1,
    paddingHorizontal: 12,
    color: '#FFFFFF',
    fontSize: 14.5,
    lineHeight: 19,
    fontFamily: FONTS.bodySemiBold,
  },
  articleRight: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    paddingRight: 10,
  },
  articleTime: {
    color: COLORS.mist,
    fontSize: 11,
    fontFamily: FONTS.body,
  },
});
