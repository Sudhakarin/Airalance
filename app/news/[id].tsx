// app/news/[id].tsx
// Article reader — full-screen news article

import { useEffect, useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  TouchableOpacity,
  Image,
  ActivityIndicator,
  Dimensions,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { LinearGradient } from 'expo-linear-gradient';
import { COLORS, FONTS, RADII, SPACING } from '../../constants/theme';
import { supabase } from '../../lib/supabase';

const { width: SCREEN_W } = Dimensions.get('window');

type NewsArticle = {
  id: string;
  category: string;
  emoji: string;
  thumb_gradient: string;
  image_url: string | null;
  source_url: string | null;
  title: string;
  source: string;
  read_time: string;
  body: string[];
  is_featured: boolean;
  created_at: string;
};

export default function ArticleReaderScreen() {
  const router = useRouter();
  const params = useLocalSearchParams<{ id: string }>();
  const articleId = params.id;

  const [article, setArticle] = useState<NewsArticle | null>(null);
  const [loading, setLoading] = useState(true);
  const [progress, setProgress] = useState(0);

  useEffect(() => {
    let mounted = true;
    async function load() {
      try {
        const { data, error } = await supabase
          .from('news_articles')
          .select('*')
          .eq('id', articleId)
          .single();
        if (error) throw error;
        if (mounted) setArticle(data as NewsArticle);
      } catch (err) {
        console.warn('Load article error:', err);
      } finally {
        if (mounted) setLoading(false);
      }
    }
    load();
    return () => {
      mounted = false;
    };
  }, [articleId]);

  function onScroll(e: any) {
    const { contentOffset, contentSize, layoutMeasurement } = e.nativeEvent;
    const max = contentSize.height - layoutMeasurement.height;
    const pct = max > 0 ? (contentOffset.y / max) * 100 : 0;
    setProgress(Math.min(100, Math.max(0, pct)));
  }

  if (loading) {
    return (
      <SafeAreaView style={styles.safe} edges={['top']}>
        <View style={styles.loadingWrap}>
          <ActivityIndicator color={COLORS.violet} />
        </View>
      </SafeAreaView>
    );
  }

  if (!article) {
    return (
      <SafeAreaView style={styles.safe} edges={['top']}>
        <View style={styles.emptyWrap}>
          <Text style={styles.emptyText}>Article not found</Text>
          <TouchableOpacity
            style={styles.backBtn2}
            onPress={() => router.back()}
          >
            <Text style={styles.backBtn2Text}>Go back</Text>
          </TouchableOpacity>
        </View>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      {/* Progress bar */}
      <View style={styles.progressBar}>
        <View
          style={[styles.progressFill, { width: `${progress}%` }]}
        />
      </View>

      {/* Header */}
      <View style={styles.header}>
        <TouchableOpacity
          style={styles.headerBtn}
          onPress={() => router.back()}
          activeOpacity={0.7}
        >
          <Ionicons name="chevron-back" size={22} color={COLORS.text} />
        </TouchableOpacity>
        <View style={styles.headerCenter}>
          <Text style={styles.headerSource} numberOfLines={1}>
            {article.source}
          </Text>
          <Text style={styles.headerTime} numberOfLines={1}>
            {article.read_time}
          </Text>
        </View>
        <TouchableOpacity
          style={styles.headerBtn}
          onPress={() => {}}
          activeOpacity={0.7}
        >
          <Ionicons name="share-outline" size={20} color={COLORS.text} />
        </TouchableOpacity>
      </View>

      {/* Content */}
      <ScrollView
        contentContainerStyle={styles.scroll}
        showsVerticalScrollIndicator={false}
        onScroll={onScroll}
        scrollEventThrottle={16}
      >
        <View style={styles.articleWrap}>
          {/* Category pill */}
          <View style={styles.categoryPill}>
            <Text style={styles.categoryText}>{article.category}</Text>
          </View>

          {/* Title */}
          <Text style={styles.title}>{article.title}</Text>

          {/* Meta */}
          <View style={styles.metaRow}>
            <Text style={styles.metaText}>{article.source}</Text>
            <Text style={styles.metaDot}>·</Text>
            <Text style={styles.metaText}>{article.read_time}</Text>
            <Text style={styles.metaDot}>·</Text>
            <Text style={styles.metaText}>
              {new Date(article.created_at).toLocaleDateString()}
            </Text>
          </View>

          {/* Image */}
          {article.image_url ? (
            <Image
              source={{ uri: article.image_url }}
              style={styles.heroImage}
              resizeMode="cover"
            />
          ) : (
            <LinearGradient
              colors={[COLORS.violet, COLORS.violetDark]}
              start={{ x: 0, y: 0 }}
              end={{ x: 1, y: 1 }}
              style={styles.heroImage}
            >
              <Text style={styles.heroEmoji}>
                {article.emoji ?? '📰'}
              </Text>
            </LinearGradient>
          )}

          {/* Body */}
          <View style={styles.body}>
            {(article.body ?? []).map((para, i) => (
              <Text key={i} style={styles.paragraph}>
                {para}
              </Text>
            ))}
          </View>

          {/* Source link */}
          {article.source_url && (
            <TouchableOpacity
              style={styles.sourceBtn}
              activeOpacity={0.85}
              onPress={() => {}}
            >
              <LinearGradient
                colors={[COLORS.violetLight, COLORS.violet]}
                start={{ x: 0, y: 0 }}
                end={{ x: 1, y: 1 }}
                style={styles.sourceBtnInner}
              >
                <Text style={styles.sourceBtnText}>
                  Read full story on {article.source}
                </Text>
                <Ionicons
                  name="arrow-forward"
                  size={16}
                  color="#FFFFFF"
                />
              </LinearGradient>
            </TouchableOpacity>
          )}
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: COLORS.ink900 },
  loadingWrap: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  emptyWrap: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 16,
  },
  emptyText: {
    color: COLORS.mist,
    fontSize: 15,
    fontFamily: FONTS.body,
  },
  backBtn2: {
    paddingHorizontal: 24,
    paddingVertical: 12,
    borderRadius: 999,
    backgroundColor: COLORS.violet,
  },
  backBtn2Text: {
    color: '#FFFFFF',
    fontSize: 14,
    fontFamily: FONTS.bodySemiBold,
  },

  progressBar: {
    height: 2,
    backgroundColor: 'rgba(255,255,255,0.08)',
  },
  progressFill: {
    height: '100%',
    backgroundColor: COLORS.violetLight,
  },

  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: SPACING.sm,
    paddingVertical: SPACING.sm,
    gap: 8,
  },
  headerBtn: {
    width: 40,
    height: 40,
    borderRadius: 20,
    alignItems: 'center',
    justifyContent: 'center',
  },
  headerCenter: {
    flex: 1,
    alignItems: 'center',
  },
  headerSource: {
    color: COLORS.text,
    fontSize: 13,
    fontFamily: FONTS.bodySemiBold,
  },
  headerTime: {
    color: COLORS.mist,
    fontSize: 11,
    fontFamily: FONTS.body,
    marginTop: 1,
  },

  scroll: { paddingBottom: SPACING.xxl },
  articleWrap: {
    paddingHorizontal: SPACING.lg,
    paddingTop: SPACING.md,
  },
  categoryPill: {
    alignSelf: 'flex-start',
    paddingHorizontal: 12,
    paddingVertical: 5,
    borderRadius: 999,
    backgroundColor: 'rgba(124,92,255,0.18)',
  },
  categoryText: {
    color: COLORS.violetLight,
    fontSize: 11,
    fontFamily: FONTS.bodySemiBold,
    letterSpacing: 0.4,
    textTransform: 'uppercase',
  },
  title: {
    marginTop: SPACING.md,
    color: '#FFFFFF',
    fontSize: 24,
    fontFamily: FONTS.displayBold,
    lineHeight: 30,
  },
  metaRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginTop: SPACING.sm,
    gap: 6,
    flexWrap: 'wrap',
  },
  metaText: {
    color: COLORS.mist,
    fontSize: 12,
    fontFamily: FONTS.body,
  },
  metaDot: {
    color: COLORS.mist,
    fontSize: 12,
  },
  heroImage: {
    width: '100%',
    height: SCREEN_W * 0.55,
    borderRadius: RADII.xl,
    marginTop: SPACING.lg,
    alignItems: 'center',
    justifyContent: 'center',
  },
  heroEmoji: {
    fontSize: 72,
    opacity: 0.9,
  },
  body: {
    marginTop: SPACING.xl,
    gap: SPACING.md,
  },
  paragraph: {
    color: 'rgba(255,255,255,0.85)',
    fontSize: 15,
    fontFamily: FONTS.body,
    lineHeight: 23,
  },
  sourceBtn: {
    marginTop: SPACING.xl,
    borderRadius: 999,
    overflow: 'hidden',
  },
  sourceBtnInner: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    paddingVertical: 14,
    paddingHorizontal: 20,
  },
  sourceBtnText: {
    color: '#FFFFFF',
    fontSize: 14,
    fontFamily: FONTS.bodySemiBold,
  },
});
