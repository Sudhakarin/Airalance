// app/(tabs)/home.tsx
// Home screen — welcome + news feed with categories + live section

import { useEffect, useState, useCallback } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  TouchableOpacity,
  Image,
  ActivityIndicator,
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

      {/* Header — brand left, bell right */}
      <View style={styles.header}>
        <Text style={styles.brandText}>
          Aira
          <Text style={styles.brandGradient}>Think!</Text>
        </Text>

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
        {/* Welcome Card */}
        <View style={styles.welcomeCard}>
          <View style={styles.welcomeIcon}>
            <LinearGradient
              colors={['#9C82FF', '#22D3B8']}
              start={{ x: 0, y: 0 }}
              end={{ x: 1, y: 1 }}
              style={styles.welcomeIconGradient}
            >
              <Ionicons name="chatbubble" size={28} color="#FFFFFF" />
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

          {/* Loading */}
          {loading ? (
            <View style={styles.loadingWrap}>
              <ActivityIndicator color={COLORS.violet} />
              <Text style={styles.loadingText}>Loading news…</Text>
            </View>
          ) : filteredArticles.length === 0 ? (
            <View style={styles.emptyWrap}>
              <Ionicons name="newspaper-outline" size={42} color={COLORS.mist} />
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
                  <Ionicons name="radio-outline" size={42} color={COLORS.mist} />
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

        {/* Footer */}
        <Text style={styles.footer}>
          Copyright © 2026 by AiraThink! · All rights reserved.
        </Text>
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: COLORS.ink900 },
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

  // Header
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: SPACING.lg,
    paddingTop: SPACING.sm,
    paddingBottom: SPACING.md,
  },
  brandText: {
    fontSize: 26,
    fontFamily: FONTS.displayBold,
    color: '#FFFFFF',
    letterSpacing: -0.3,
  },
  brandGradient: {
    color: COLORS.violetLight,
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

  // Welcome card
  welcomeCard: {
    alignItems: 'center',
    paddingHorizontal: SPACING.xl,
    paddingTop: SPACING.xl,
    paddingBottom: SPACING.xl,
  },
  welcomeIcon: {
    marginBottom: SPACING.lg,
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
    fontSize: 22,
    fontFamily: FONTS.displayBold,
    color: '#FFFFFF',
    textAlign: 'center',
  },
  welcomeSubtitle: {
    marginTop: 6,
    fontSize: 13,
    fontFamily: FONTS.body,
    color: COLORS.mist,
    textAlign: 'center',
    paddingHorizontal: 20,
  },
  welcomeBtn: {
    marginTop: SPACING.xl,
    borderRadius: RADII.full,
    overflow: 'hidden',
    ...SHADOWS.buttonViolet,
  },
  welcomeBtnGradient: {
    paddingVertical: 12,
    paddingHorizontal: 24,
  },
  welcomeBtnText: {
    color: '#FFFFFF',
    fontSize: 14,
    fontFamily: FONTS.bodySemiBold,
  },

  // News
  newsSection: { paddingHorizontal: SPACING.lg, marginTop: SPACING.md },
  newsHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 4,
    marginBottom: SPACING.md,
  },
  newsTitle: {
    fontSize: 16,
    fontFamily: FONTS.displayBold,
    color: '#FFFFFF',
  },

  // Categories
  categoriesRow: { gap: 8, paddingRight: SPACING.lg, paddingBottom: SPACING.md },
  categoryWrap: { marginRight: 8 },
  categoryPill: {
    paddingHorizontal: 14,
    paddingVertical: 7,
    borderRadius: RADII.full,
  },
  categoryPillInactive: {
    paddingHorizontal: 14,
    paddingVertical: 7,
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

  // Loading / empty
  loadingWrap: { paddingVertical: 60, alignItems: 'center', gap: 12 },
  loadingText: { color: COLORS.mist, fontSize: 13, fontFamily: FONTS.body },
  emptyWrap: { paddingVertical: 60, alignItems: 'center', gap: 10 },
  emptyText: {
    color: COLORS.text,
    fontSize: 14,
    fontFamily: FONTS.bodyMedium,
    textAlign: 'center',
  },
  emptySubtext: { color: COLORS.mist, fontSize: 12, fontFamily: FONTS.body },

  // Featured
  featuredCard: {
    height: 200,
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
    padding: SPACING.lg,
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
    fontSize: 9,
    fontFamily: FONTS.bodySemiBold,
    letterSpacing: 0.5,
  },
  featuredTitle: {
    color: '#FFFFFF',
    fontSize: 15,
    fontFamily: FONTS.displayBold,
    lineHeight: 20,
  },
  featuredMeta: { marginTop: 6 },
  featuredMetaText: {
    color: 'rgba(255,255,255,0.75)',
    fontSize: 11,
    fontFamily: FONTS.body,
  },

  // Live
  liveSection: { marginBottom: SPACING.lg },
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
    fontSize: 15,
    fontFamily: FONTS.displayBold,
  },
  liveBox: {
    height: 180,
    borderRadius: RADII.xl,
    backgroundColor: 'rgba(0,0,0,0.5)',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.08)',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
  },
  liveText: { color: COLORS.mist, fontSize: 12, fontFamily: FONTS.body },

  // Article list
  listSection: { gap: 4 },
  articleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: SPACING.md,
    paddingVertical: SPACING.sm,
    paddingHorizontal: 4,
    borderRadius: RADII.lg,
  },
  articleThumb: {
    width: 70,
    height: 70,
    borderRadius: RADII.lg,
    alignItems: 'center',
    justifyContent: 'center',
  },
  articleEmoji: { fontSize: 28, opacity: 0.9 },
  articleInfo: { flex: 1 },
  articleCategory: {
    color: COLORS.teal,
    fontSize: 9.5,
    fontFamily: FONTS.bodySemiBold,
    letterSpacing: 0.6,
    marginBottom: 3,
  },
  articleTitle: {
    color: '#FFFFFF',
    fontSize: 13.5,
    fontFamily: FONTS.bodySemiBold,
    lineHeight: 18,
  },
  articleMeta: {
    marginTop: 4,
    color: COLORS.mist,
    fontSize: 11,
    fontFamily: FONTS.body,
  },

  footer: {
    marginTop: SPACING.xxl,
    textAlign: 'center',
    color: COLORS.mist,
    fontSize: 10,
    fontFamily: FONTS.body,
    opacity: 0.5,
  },
});
