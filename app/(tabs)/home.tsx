// app/(tabs)/home.tsx
// Home screen — welcome + news feed with categories + live section + skeleton

import { useEffect, useState, useCallback } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  TouchableOpacity,
  Image,
  RefreshControl,
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

function HomeSkeleton() {
  return (
    <View>
      <SkeletonBlock
        width="100%"
        height={200}
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
        <SkeletonBlock
          width="100%"
          height={170}
          borderRadius={RADII.xl}
        />
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
          <SkeletonBlock width={74} height={74} borderRadius={RADII.lg} />
          <View style={{ flex: 1, gap: 6 }}>
            <SkeletonBlock width={50} height={10} borderRadius={4} />
            <SkeletonBlock width="90%" height={14} borderRadius={5} />
            <SkeletonBlock width="70%" height={14} borderRadius={5} />
            <SkeletonBlock width={100} height={10} borderRadius={4} />
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

      <View style={styles.header}>
        <Text style={styles.brandText}>Airalance!</Text>

        <TouchableOpacity
          style={styles.bellBtn}
          onPress={() => router.push('/notifications')}
          activeOpacity={0.7}
        >
          <Ionicons name="notifications-outline" size={22} color="#FFFFFF" />
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
        <View style={styles.welcomeCard}>
          <View style={styles.welcomeIcon}>
            <LinearGradient
              colors={['#9C82FF', '#22D3B8']}
              start={{ x: 0, y: 0 }}
              end={{ x: 1, y: 1 }}
              style={styles.welcomeIconGradient}
            >
              <Ionicons name="chatbubble" size={30} color="#FFFFFF" />
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

        <View style={styles.newsSection}>
          <View style={styles.newsHeader}>
            <Text style={styles.newsTitle}>News for you</Text>
          </View>

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

          {loading ? (
            <HomeSkeleton />
          ) : filteredArticles.length === 0 ? (
            <View style={styles.emptyWrap}>
              <Ionicons name="newspaper-outline" size={44} color={COLORS.mist} />
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

              <View style={styles.liveSection}>
                <View style={styles.liveHeader}>
                  <View style={styles.livePulse} />
                  <View style={styles.livePulseInner} />
                  <Text style={styles.liveTitle}>Live</Text>
                </View>
                <View style={styles.liveBox}>
                  <Ionicons name="radio-outline" size={44} color={COLORS.mist} />
                  <Text style={styles.liveText}>
                    Live stream will appear here
                  </Text>
                </View>
              </View>

              <View style={styles.listSection}>
                {rest.map((article, index) => (
                  <View key={article.id}>
                    <TouchableOpacity
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

                    {index < rest.length - 1 && (
                      <View style={styles.articleDivider} />
                    )}
                  </View>
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
  scroll: { paddingBottom: 40 },

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
    paddingHorizontal: 20,
    paddingTop: 14,
    paddingBottom: 14,
  },
  brandText: {
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
    top: 2,
    right: 2,
    minWidth: 18,
    height: 18,
    borderRadius: 9,
    backgroundColor: '#EF4444',
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 4,
    borderWidth: 2,
    borderColor: '#000000',
  },
  badgeText: {
    color: '#FFFFFF',
    fontSize: 9,
    fontFamily: FONTS.bodySemiBold,
    lineHeight: 11,
  },

  welcomeCard: {
    alignItems: 'center',
    paddingHorizontal: SPACING.lg,
    paddingTop: SPACING.lg,
    paddingBottom: SPACING.lg,
  },
  welcomeIcon: {
    marginBottom: SPACING.md,
    borderRadius: 24,
    overflow: 'hidden',
    ...SHADOWS.card,
  },
  welcomeIconGradient: {
    width: 80,
    height: 80,
    borderRadius: 24,
    alignItems: 'center',
    justifyContent: 'center',
  },
  welcomeTitle: {
    fontSize: 24,
    fontFamily: FONTS.displayBold,
    color: '#FFFFFF',
    textAlign: 'center',
  },
  welcomeSubtitle: {
    marginTop: 6,
    fontSize: 14.5,
    fontFamily: FONTS.body,
    color: COLORS.mist,
    textAlign: 'center',
    paddingHorizontal: 16,
    lineHeight: 20,
  },
  welcomeBtn: {
    marginTop: SPACING.lg,
    borderRadius: RADII.full,
    overflow: 'hidden',
    ...SHADOWS.buttonViolet,
  },
  welcomeBtnGradient: {
    paddingVertical: 13,
    paddingHorizontal: 26,
  },
  welcomeBtnText: {
    color: '#FFFFFF',
    fontSize: 15,
    fontFamily: FONTS.bodySemiBold,
  },

  newsSection: { paddingHorizontal: 20, marginTop: SPACING.sm },
  newsHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 4,
    marginBottom: SPACING.sm,
  },
  newsTitle: {
    fontSize: 18,
    fontFamily: FONTS.displayBold,
    color: '#FFFFFF',
  },

  categoriesRow: { gap: 8, paddingRight: SPACING.md, paddingBottom: SPACING.sm },
  categoryWrap: { marginRight: 6 },
  categoryPill: {
    paddingHorizontal: 16,
    paddingVertical: 7,
    borderRadius: RADII.full,
  },
  categoryPillInactive: {
    paddingHorizontal: 16,
    paddingVertical: 7,
    borderRadius: RADII.full,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.1)',
    backgroundColor: 'rgba(255,255,255,0.03)',
  },
  categoryTextActive: {
    color: '#FFFFFF',
    fontSize: 13,
    fontFamily: FONTS.bodySemiBold,
  },
  categoryTextInactive: {
    color: COLORS.mist,
    fontSize: 13,
    fontFamily: FONTS.bodySemiBold,
  },

  emptyWrap: { paddingVertical: 60, alignItems: 'center', gap: 10 },
  emptyText: {
    color: COLORS.text,
    fontSize: 15.5,
    fontFamily: FONTS.bodyMedium,
    textAlign: 'center',
  },
  emptySubtext: {
    color: COLORS.mist,
    fontSize: 13.5,
    fontFamily: FONTS.body,
  },

  featuredCard: {
    height: 200,
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
  featuredEmoji: { fontSize: 56, opacity: 0.85 },
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
    padding: SPACING.md,
  },
  featuredBadge: {
    alignSelf: 'flex-start',
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: RADII.full,
    backgroundColor: 'rgba(255,255,255,0.18)',
    marginBottom: 8,
  },
  featuredBadgeText: {
    color: '#FFFFFF',
    fontSize: 10,
    fontFamily: FONTS.bodySemiBold,
    letterSpacing: 0.5,
  },
  featuredTitle: {
    color: '#FFFFFF',
    fontSize: 16.5,
    fontFamily: FONTS.displayBold,
    lineHeight: 22,
  },
  featuredMeta: { marginTop: 6 },
  featuredMetaText: {
    color: 'rgba(255,255,255,0.75)',
    fontSize: 12.5,
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
    width: 8,
    height: 8,
    borderRadius: 4,
    backgroundColor: COLORS.danger,
    opacity: 0.3,
    position: 'absolute',
  },
  livePulseInner: {
    width: 8,
    height: 8,
    borderRadius: 4,
    backgroundColor: COLORS.danger,
  },
  liveTitle: {
    color: '#FFFFFF',
    fontSize: 17.5,
    fontFamily: FONTS.displayBold,
  },
  liveBox: {
    height: 170,
    borderRadius: RADII.xl,
    backgroundColor: 'rgba(0,0,0,0.5)',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.08)',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
  },
  liveText: {
    color: COLORS.mist,
    fontSize: 14,
    fontFamily: FONTS.body,
  },

  listSection: { gap: 0 },
  articleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: SPACING.sm,
    paddingVertical: SPACING.sm,
    paddingHorizontal: 4,
    borderRadius: RADII.lg,
  },
  articleDivider: {
    height: 1,
    backgroundColor: 'rgba(255,255,255,0.07)',
    marginHorizontal: 4,
    marginVertical: 2,
  },
  articleThumb: {
    width: 74,
    height: 74,
    borderRadius: RADII.lg,
    alignItems: 'center',
    justifyContent: 'center',
  },
  articleEmoji: { fontSize: 30, opacity: 0.9 },
  articleInfo: { flex: 1 },
  articleCategory: {
    color: COLORS.teal,
    fontSize: 10.5,
    fontFamily: FONTS.bodySemiBold,
    letterSpacing: 0.6,
    marginBottom: 3,
  },
  articleTitle: {
    color: '#FFFFFF',
    fontSize: 15,
    fontFamily: FONTS.bodySemiBold,
    lineHeight: 20,
  },
  articleMeta: {
    marginTop: 4,
    color: COLORS.mist,
    fontSize: 12,
    fontFamily: FONTS.body,
  },
});
