// app/(tabs)/home.tsx
// Home screen — welcome + news feed with categories + live section + skeleton

import { useEffect, useState, useCallback, useRef } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  TouchableOpacity,
  Image,
  ActivityIndicator,
  RefreshControl,
  Animated,
} from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
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

// ===== Skeleton component (pulse/shimmer effect) =====
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
  const opacity = useRef(new Animated.Value(0.3)).current;

  useEffect(() => {
    const loop = Animated.loop(
      Animated.sequence([
        Animated.timing(opacity, {
          toValue: 1,
          duration: 700,
          useNativeDriver: true,
        }),
        Animated.timing(opacity, {
          toValue: 0.3,
          duration: 700,
          useNativeDriver: true,
        }),
      ])
    );
    loop.start();
    return () => loop.stop();
  }, [opacity]);

  return (
    <Animated.View
      style={[
        {
          width,
          height,
          borderRadius,
          backgroundColor: 'rgba(255,255,255,0.08)',
          opacity,
        },
        style,
      ]}
    />
  );
}

function HomeSkeleton() {
  return (
    <View>
      {/* Featured card skeleton */}
      <SkeletonBlock
        width="100%"
        height={230}
        borderRadius={RADII.xl}
        style={{ marginBottom: SPACING.lg }}
      />

      {/* Live section skeleton */}
      <View style={{ marginBottom: SPACING.lg }}>
        <View
          style={{
            flexDirection: 'row',
            alignItems: 'center',
            gap: 10,
            marginBottom: SPACING.sm,
            paddingHorizontal: 4,
          }}
        >
          <SkeletonBlock width={10} height={10} borderRadius={5} />
          <SkeletonBlock width={50} height={16} borderRadius={6} />
        </View>
        <SkeletonBlock
          width="100%"
          height={200}
          borderRadius={RADII.xl}
        />
      </View>

      {/* Articles list skeleton — 4 rows */}
      {[0, 1, 2, 3].map((i) => (
        <View
          key={i}
          style={{
            flexDirection: 'row',
            alignItems: 'center',
            gap: SPACING.md,
            paddingVertical: SPACING.md,
            paddingHorizontal: 4,
          }}
        >
          <SkeletonBlock width={80} height={80} borderRadius={RADII.lg} />
          <View style={{ flex: 1, gap: 8 }}>
            <SkeletonBlock width={60} height={12} borderRadius={4} />
            <SkeletonBlock width="90%" height={16} borderRadius={5} />
            <SkeletonBlock width="70%" height={16} borderRadius={5} />
            <SkeletonBlock width={110} height={12} borderRadius={4} />
          </View>
        </View>
      ))}
    </View>
  );
}

export default function HomeScreen() {
  const router = useRouter();
  const [articles, setArticles] = useState<NewsArticle[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [selectedCategory, setSelectedCategory] = useState('For you');
  const [notifCount, setNotifCount] = useState(0);

  const fetchNews = useCallback(async () => {
    try {
      const { data, error } = await supabase
        .from('news_articles')
        .select('*')
        .order('created_at', { ascending: false })
        .limit(20);

      if (error) {
        console.warn('News fetch error:', error.message);
        setArticles([]);
      } else {
        setArticles((data ?? []) as NewsArticle[]);
      }
    } catch (err) {
      console.warn('News fetch crashed:', err);
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

  const fetchNotificationCount = useCallback(async () => {
    const { data: auth } = await supabase.auth.getUser();
    if (!auth.user) return;
    const { count } = await supabase
      .from('app_notifications')
      .select('id', { count: 'exact', head: true })
      .eq('user_id', auth.user.id)
      .eq('read', false);
    setNotifCount(count ?? 0);
  }, []);

  useEffect(() => {
    fetchNews();
    fetchNotificationCount();
  }, [fetchNews, fetchNotificationCount]);

  async function onRefresh() {
    setRefreshing(true);
    await Promise.all([fetchNews(), fetchNotificationCount()]);
  }

  const filteredArticles =
    selectedCategory === 'For you'
      ? articles
      : articles.filter(
          (a) => a.category?.toLowerCase() === selectedCategory.toLowerCase()
        );

  const featured =
    filteredArticles.find((a) => a.is_featured) ?? filteredArticles[0];
  const rest = filteredArticles.filter((a) => a.id !== featured?.id);

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      <View style={styles.glowTop} />

      {/* Header */}
      <View style={styles.header}>
        <Text style={styles.brandText}>Airalance!</Text>

        <TouchableOpacity
          style={styles.bellBtn}
          onPress={() => router.push('/notifications')}
          activeOpacity={0.7}
        >
          <Ionicons name="notifications-outline" size={24} color="#FFFFFF" />
          {notifCount > 0 && (
            <View style={styles.badge}>
              <Text style={styles.badgeText}>
                {notifCount > 9 ? '9+' : notifCount}
              </Text>
            </View>
          )}
        </TouchableOpacity>
      </View>

      <ScrollView
        contentContainerStyle={styles.scroll}
        showsVerticalScrollIndicator={false}
        refreshControl={
          <RefreshControl
            refreshing={refreshing}
            onRefresh={onRefresh}
            tintColor={COLORS.violet}
            colors={[COLORS.violet]}
          />
        }
      >
        {/* Welcome Card */}
        <View style={styles.welcomeCard}>
          <View style={styles.welcomeIcon}>
            <LinearGradient
              colors={['#9C82FF', '#22D3B8']}
              start={{ x: 0, y: 0 }}
              end={{ x: 1, y: 1 }}
              style={styles.welcomeIconGradient}
            >
              <Ionicons name="chatbubble" size={34} color="#FFFFFF" />
            </LinearGradient>
          </View>
          <Text style={styles.welcomeTitle}>Welcome to Airalance!</Text>
          <Text style={styles.welcomeSubtitle}>
            Let's connect. Real conversations, real time.
          </Text>
          <TouchableOpacity
            style={styles.welcomeBtn}
            onPress={() => router.push('/(tabs)/search')}
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

        {/* News Section */}
        <View style={styles.newsSection}>
          <View style={styles.newsHeader}>
            <Text style={styles.newsTitle}>News for you</Text>
          </View>

          {/* Categories */}
          <ScrollView
            horizontal
            showsHorizontalScrollIndicator={false}
            contentContainerStyle={styles.categoriesRow}
          >
            {CATEGORIES.map((cat) => {
              const isActive = selectedCategory === cat;
              return (
                <TouchableOpacity
                  key={cat}
                  onPress={() => setSelectedCategory(cat)}
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
                      <Text style={styles.categoryTextActive}>{cat}</Text>
                    </LinearGradient>
                  ) : (
                    <View style={styles.categoryPillInactive}>
                      <Text style={styles.categoryTextInactive}>{cat}</Text>
                    </View>
                  )}
                </TouchableOpacity>
              );
            })}
          </ScrollView>

          {/* Loading → Skeleton */}
          {loading ? (
            <HomeSkeleton />
          ) : filteredArticles.length === 0 ? (
            <View style={styles.emptyWrap}>
              <Ionicons name="newspaper-outline" size={50} color={COLORS.mist} />
              <Text style={styles.emptyText}>
                No {selectedCategory === 'For you' ? 'news' : selectedCategory} articles yet.
              </Text>
              <Text style={styles.emptySubtext}>Check back soon.</Text>
            </View>
          ) : (
            <>
              {/* Featured Article */}
              {featured && (
                <TouchableOpacity
                  style={styles.featuredCard}
                  onPress={() => router.push(`/news/${featured.id}`)}
                  activeOpacity={0.9}
                >
                  {featured.image_url ? (
                    <Image
                      source={{ uri: featured.image_url }}
                      style={styles.featuredImage}
                      resizeMode="cover"
                    />
                  ) : (
                    <LinearGradient
                      colors={
                        CATEGORY_GRADIENTS[featured.category] ?? [
                          '#7C5CFF',
                          '#5B3FE0',
                        ]
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
                    <Text style={styles.featuredTitle} numberOfLines={3}>
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

              {/* Live Section */}
              <View style={styles.liveSection}>
                <View style={styles.liveHeader}>
                  <View style={styles.livePulse} />
                  <View style={styles.livePulseInner} />
                  <Text style={styles.liveTitle}>Live</Text>
                </View>
                <View style={styles.liveBox}>
                  <Ionicons name="radio-outline" size={50} color={COLORS.mist} />
                  <Text style={styles.liveText}>
                    Live stream will appear here
                  </Text>
                </View>
              </View>

              {/* Rest of Articles */}
              <View style={styles.listSection}>
                {rest.map((article) => (
                  <TouchableOpacity
                    key={article.id}
                    style={styles.articleRow}
                    onPress={() => router.push(`/news/${article.id}`)}
                    activeOpacity={0.75}
                  >
                    {article.image_url ? (
                      <Image
                        source={{ uri: article.image_url }}
                        style={styles.articleThumb}
                        resizeMode="cover"
                      />
                    ) : (
                      <LinearGradient
                        colors={
                          CATEGORY_GRADIENTS[article.category] ?? [
                            '#7C5CFF',
                            '#5B3FE0',
                          ]
                        }
                        start={{ x: 0, y: 0 }}
                        end={{ x: 1, y: 1 }}
                        style={styles.articleThumb}
                      >
                        <Text style={styles.articleEmoji}>
                          {article.emoji ?? '📰'}
                        </Text>
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
                ))}
              </View>
            </>
          )}
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: '#000000' },
  scroll: { paddingBottom: 48 },

  glowTop: {
    position: 'absolute',
    top: -200,
    left: -100,
    width: 500,
    height: 500,
    borderRadius: 250,
    backgroundColor: 'rgba(124, 92, 255, 0.12)',
  },

  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 24,
    paddingTop: 18,
    paddingBottom: 18,
  },
  // Brand — 34px (was 28)
  brandText: {
    fontSize: 34,
    fontFamily: FONTS.displayBold,
    color: '#FFFFFF',
    letterSpacing: -0.5,
  },
  // Bell button — 46 (was 42)
  bellBtn: {
    width: 46,
    height: 46,
    borderRadius: 23,
    backgroundColor: 'rgba(255,255,255,0.05)',
    alignItems: 'center',
    justifyContent: 'center',
    position: 'relative',
  },
  badge: {
    position: 'absolute',
    top: 3,
    right: 3,
    minWidth: 20,
    height: 20,
    borderRadius: 10,
    backgroundColor: '#EF4444',
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 4,
    borderWidth: 2,
    borderColor: '#000000',
  },
  badgeText: {
    color: '#FFFFFF',
    fontSize: 10,
    fontFamily: FONTS.bodySemiBold,
    lineHeight: 13,
  },

  welcomeCard: {
    alignItems: 'center',
    paddingHorizontal: SPACING.xl,
    paddingTop: SPACING.xl,
    paddingBottom: SPACING.xl,
  },
  welcomeIcon: {
    marginBottom: SPACING.lg,
    borderRadius: 28,
    overflow: 'hidden',
    ...SHADOWS.card,
  },
  // Welcome icon — bigger
  welcomeIconGradient: {
    width: 96,
    height: 96,
    borderRadius: 28,
    alignItems: 'center',
    justifyContent: 'center',
  },
  // Welcome title — 28px (was 22)
  welcomeTitle: {
    fontSize: 28,
    fontFamily: FONTS.displayBold,
    color: '#FFFFFF',
    textAlign: 'center',
  },
  // Welcome subtitle — 16px (was 13)
  welcomeSubtitle: {
    marginTop: 8,
    fontSize: 16,
    fontFamily: FONTS.body,
    color: COLORS.mist,
    textAlign: 'center',
    paddingHorizontal: 20,
    lineHeight: 22,
  },
  welcomeBtn: {
    marginTop: SPACING.xl,
    borderRadius: RADII.full,
    overflow: 'hidden',
    ...SHADOWS.buttonViolet,
  },
  welcomeBtnGradient: {
    paddingVertical: 15,
    paddingHorizontal: 30,
  },
  // Welcome button — 16px (was 14)
  welcomeBtnText: {
    color: '#FFFFFF',
    fontSize: 16,
    fontFamily: FONTS.bodySemiBold,
  },

  newsSection: { paddingHorizontal: 24, marginTop: SPACING.md },
  newsHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 4,
    marginBottom: SPACING.md,
  },
  // News title — 20px (was 16)
  newsTitle: {
    fontSize: 20,
    fontFamily: FONTS.displayBold,
    color: '#FFFFFF',
  },

  categoriesRow: { gap: 10, paddingRight: SPACING.lg, paddingBottom: SPACING.md },
  categoryWrap: { marginRight: 8 },
  categoryPill: {
    paddingHorizontal: 18,
    paddingVertical: 9,
    borderRadius: RADII.full,
  },
  categoryPillInactive: {
    paddingHorizontal: 18,
    paddingVertical: 9,
    borderRadius: RADII.full,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.1)',
    backgroundColor: 'rgba(255,255,255,0.03)',
  },
  // Category text — 14px (was 12)
  categoryTextActive: {
    color: '#FFFFFF',
    fontSize: 14,
    fontFamily: FONTS.bodySemiBold,
  },
  categoryTextInactive: {
    color: COLORS.mist,
    fontSize: 14,
    fontFamily: FONTS.bodySemiBold,
  },

  emptyWrap: { paddingVertical: 70, alignItems: 'center', gap: 12 },
  // Empty text — 17px (was 14)
  emptyText: {
    color: COLORS.text,
    fontSize: 17,
    fontFamily: FONTS.bodyMedium,
    textAlign: 'center',
  },
  // Empty subtext — 14.5px (was 12)
  emptySubtext: {
    color: COLORS.mist,
    fontSize: 14.5,
    fontFamily: FONTS.body,
  },

  // Featured card — bigger
  featuredCard: {
    height: 230,
    borderRadius: RADII.xl,
    overflow: 'hidden',
    marginBottom: SPACING.lg,
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
  // Featured emoji — bigger
  featuredEmoji: { fontSize: 68, opacity: 0.85 },
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
    padding: SPACING.lg,
  },
  featuredBadge: {
    alignSelf: 'flex-start',
    paddingHorizontal: 12,
    paddingVertical: 5,
    borderRadius: RADII.full,
    backgroundColor: 'rgba(255,255,255,0.18)',
    marginBottom: 10,
  },
  // Featured badge — 11px (was 9)
  featuredBadgeText: {
    color: '#FFFFFF',
    fontSize: 11,
    fontFamily: FONTS.bodySemiBold,
    letterSpacing: 0.5,
  },
  // Featured title — 18px (was 15)
  featuredTitle: {
    color: '#FFFFFF',
    fontSize: 18,
    fontFamily: FONTS.displayBold,
    lineHeight: 24,
  },
  featuredMeta: { marginTop: 8 },
  // Featured meta — 13.5px (was 11)
  featuredMetaText: {
    color: 'rgba(255,255,255,0.75)',
    fontSize: 13.5,
    fontFamily: FONTS.body,
  },

  liveSection: { marginBottom: SPACING.lg },
  liveHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    marginBottom: SPACING.md,
    paddingHorizontal: 4,
  },
  livePulse: {
    width: 10,
    height: 10,
    borderRadius: 5,
    backgroundColor: COLORS.danger,
    opacity: 0.3,
    position: 'absolute',
  },
  livePulseInner: {
    width: 10,
    height: 10,
    borderRadius: 5,
    backgroundColor: COLORS.danger,
  },
  // Live title — 19px (was 15)
  liveTitle: {
    color: '#FFFFFF',
    fontSize: 19,
    fontFamily: FONTS.displayBold,
  },
  // Live box — taller
  liveBox: {
    height: 200,
    borderRadius: RADII.xl,
    backgroundColor: 'rgba(0,0,0,0.5)',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.08)',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 10,
  },
  // Live text — 15px (was 12)
  liveText: {
    color: COLORS.mist,
    fontSize: 15,
    fontFamily: FONTS.body,
  },

  listSection: { gap: 6 },
  articleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: SPACING.md,
    paddingVertical: SPACING.md,
    paddingHorizontal: 4,
    borderRadius: RADII.lg,
  },
  // Article thumb — 80 (was 70)
  articleThumb: {
    width: 84,
    height: 84,
    borderRadius: RADII.lg,
    alignItems: 'center',
    justifyContent: 'center',
  },
  // Article emoji — bigger
  articleEmoji: { fontSize: 34, opacity: 0.9 },
  articleInfo: { flex: 1 },
  // Article category — 11.5px (was 9.5)
  articleCategory: {
    color: COLORS.teal,
    fontSize: 11.5,
    fontFamily: FONTS.bodySemiBold,
    letterSpacing: 0.6,
    marginBottom: 4,
  },
  // Article title — 16px (was 13.5)
  articleTitle: {
    color: '#FFFFFF',
    fontSize: 16,
    fontFamily: FONTS.bodySemiBold,
    lineHeight: 21,
  },
  // Article meta — 13px (was 11)
  articleMeta: {
    marginTop: 5,
    color: COLORS.mist,
    fontSize: 13,
    fontFamily: FONTS.body,
  },
});
