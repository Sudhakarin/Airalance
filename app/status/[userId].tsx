// app/status/[userId].tsx
// Full-screen status viewer — photo + separate caption section below + actions

import { useEffect, useState, useRef, useCallback } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  Image,
  ActivityIndicator,
  Pressable,
} from 'react-native';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { LinearGradient } from 'expo-linear-gradient';
import { COLORS, FONTS, SPACING } from '../../constants/theme';
import { supabase } from '../../lib/supabase';
import Avatar from '../../components/Avatar';
import VerifiedBadge from '../../components/VerifiedBadge';

const STATUS_DURATION_MS = 15000;

type Profile = {
  id: string;
  username: string;
  display_name: string;
  avatar_color: string;
  avatar_url: string | null;
  verified: boolean | null;
};

type Status = {
  id: string;
  user_id: string;
  media_url: string | null;
  media_type: 'image' | 'video' | 'text' | null;
  text_content: string | null;
  bg_color: string | null;
  created_at: string;
  expires_at: string;
  profile: Profile | null;
};

export default function StatusViewerScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const params = useLocalSearchParams<{ userId: string }>();
  const userId = params.userId;

  const [statuses, setStatuses] = useState<Status[]>([]);
  const [index, setIndex] = useState(0);
  const [loading, setLoading] = useState(true);
  const [myId, setMyId] = useState<string | null>(null);
  const [progress, setProgress] = useState(0);
  const [liked, setLiked] = useState(false);
  const [likeLoading, setLikeLoading] = useState(false);

  const pausedRef = useRef(false);
  const elapsedRef = useRef(0);
  const frameStartRef = useRef(0);
  const rafRef = useRef<number | null>(null);

  useEffect(() => {
    let mounted = true;
    async function load() {
      const { data: authData } = await supabase.auth.getUser();
      if (mounted) setMyId(authData.user?.id ?? null);

      const { data, error } = await supabase
        .from('statuses')
        .select('*, profile:profiles(*)')
        .eq('user_id', userId)
        .gt('expires_at', new Date().toISOString())
        .order('created_at', { ascending: true });

      if (!mounted) return;
      if (error) {
        console.warn('Load status error:', error);
        setStatuses([]);
      } else {
        setStatuses((data ?? []) as Status[]);
      }
      setLoading(false);
    }
    load();
    return () => {
      mounted = false;
    };
  }, [userId]);

  const markViewed = useCallback(
    async (statusId: string) => {
      if (!myId) return;
      try {
        await supabase
          .from('status_views')
          .upsert(
            { status_id: statusId, viewer_id: myId },
            { onConflict: 'status_id,viewer_id', ignoreDuplicates: true }
          );
      } catch {}
    },
    [myId]
  );

  const checkLiked = useCallback(
    async (statusId: string) => {
      if (!myId) return;
      try {
        const { data } = await supabase
          .from('status_likes')
          .select('status_id')
          .eq('status_id', statusId)
          .eq('user_id', myId)
          .maybeSingle();
        setLiked(!!data);
      } catch {
        setLiked(false);
      }
    },
    [myId]
  );

  async function toggleLike() {
    if (!myId || likeLoading) return;
    const current = statuses[index];
    if (!current) return;

    setLikeLoading(true);
    const wasLiked = liked;
    setLiked(!wasLiked);

    try {
      if (wasLiked) {
        await supabase
          .from('status_likes')
          .delete()
          .eq('status_id', current.id)
          .eq('user_id', myId);
      } else {
        await supabase
          .from('status_likes')
          .insert({ status_id: current.id, user_id: myId });
      }
    } catch (err) {
      console.warn('Toggle like error:', err);
      setLiked(wasLiked);
    } finally {
      setLikeLoading(false);
    }
  }

  useEffect(() => {
    if (loading || statuses.length === 0) return;
    const current = statuses[index];
    if (!current) return;

    markViewed(current.id);
    checkLiked(current.id);

    elapsedRef.current = 0;
    frameStartRef.current = performance.now();
    setProgress(0);
    pausedRef.current = false;

    const tick = (now: number) => {
      if (pausedRef.current) {
        frameStartRef.current = now;
      } else {
        elapsedRef.current += now - frameStartRef.current;
        frameStartRef.current = now;
        const pct = Math.min(
          100,
          (elapsedRef.current / STATUS_DURATION_MS) * 100
        );
        setProgress(pct);
        if (pct >= 100) {
          advance(1);
          return;
        }
      }
      rafRef.current = requestAnimationFrame(tick);
    };
    rafRef.current = requestAnimationFrame(tick);

    return () => {
      if (rafRef.current) cancelAnimationFrame(rafRef.current);
    };
  }, [index, statuses, loading, markViewed, checkLiked]);

  function advance(dir: 1 | -1) {
    const next = index + dir;
    if (next < 0) return;
    if (next >= statuses.length) {
      safeGoBack();
      return;
    }
    setIndex(next);
  }

  function safeGoBack() {
    try {
      if (router.canGoBack()) {
        router.back();
      } else {
        router.replace('/(tabs)/status');
      }
    } catch {
      try {
        router.replace('/(tabs)/status');
      } catch {}
    }
  }

  function pause() {
    pausedRef.current = true;
  }
  function resume() {
    pausedRef.current = false;
  }

  function formatTime(iso: string) {
    const diffMs = Date.now() - new Date(iso).getTime();
    const min = Math.floor(diffMs / 60000);
    if (min < 1) return 'just now';
    if (min < 60) return `${min}m ago`;
    const hr = Math.floor(min / 60);
    if (hr < 24) return `${hr}h ago`;
    return `${Math.floor(hr / 24)}d ago`;
  }

  if (loading) {
    return (
      <View style={styles.loadingWrap}>
        <ActivityIndicator color={COLORS.violet} />
      </View>
    );
  }

  if (statuses.length === 0) {
    return (
      <SafeAreaView style={styles.safe} edges={['top', 'bottom']}>
        <View style={styles.emptyWrap}>
          <Ionicons name="time-outline" size={44} color={COLORS.mist} />
          <Text style={styles.emptyText}>This status has expired</Text>
          <TouchableOpacity style={styles.emptyBtn} onPress={safeGoBack}>
            <Text style={styles.emptyBtnText}>Go back</Text>
          </TouchableOpacity>
        </View>
      </SafeAreaView>
    );
  }

  const current = statuses[index];

  if (!current) {
    safeGoBack();
    return (
      <View style={styles.loadingWrap}>
        <ActivityIndicator color={COLORS.violet} />
      </View>
    );
  }

  const profile = current.profile;
  const isMine = current.user_id === myId;
  const isTextOnly = !current.media_url;
  const hasCaption = !isTextOnly && !!current.text_content;

  return (
    <View style={styles.container}>
      {/* ---------- Header ---------- */}
      <View style={[styles.headerBlock, { paddingTop: insets.top + 6 }]}>
        <View style={styles.progressRow}>
          {statuses.map((s, i) => (
            <View key={s.id} style={styles.progressSegment}>
              <View
                style={[
                  styles.progressFill,
                  {
                    width:
                      i < index
                        ? '100%'
                        : i > index
                        ? '0%'
                        : `${progress}%`,
                  },
                ]}
              />
            </View>
          ))}
        </View>

        <View style={styles.header}>
          <Avatar
            name={profile?.display_name ?? 'Unknown'}
            color={profile?.avatar_color ?? COLORS.violet}
            avatarUrl={profile?.avatar_url ?? null}
            size={34}
          />
          <View style={styles.headerInfo}>
            <View style={styles.headerNameRow}>
              <Text style={styles.headerName} numberOfLines={1}>
                {profile?.display_name ?? 'Unknown'}
              </Text>
              {profile?.verified && <VerifiedBadge size={13} />}
            </View>
            <Text style={styles.headerTime}>
              {formatTime(current.created_at)}
            </Text>
          </View>
          {isMine && (
            <TouchableOpacity
              style={styles.headerIconBtn}
              onPress={async () => {
                try {
                  await supabase
                    .from('statuses')
                    .delete()
                    .eq('id', current.id);
                } catch (err) {
                  console.warn('Delete status error:', err);
                }
                safeGoBack();
              }}
              activeOpacity={0.7}
            >
              <Ionicons name="trash-outline" size={19} color="#FFFFFF" />
            </TouchableOpacity>
          )}
          <TouchableOpacity
            style={styles.headerIconBtn}
            onPress={safeGoBack}
            activeOpacity={0.7}
          >
            <Ionicons name="close" size={22} color="#FFFFFF" />
          </TouchableOpacity>
        </View>
      </View>

      {/* ---------- PHOTO / TEXT content (flex:1) ---------- */}
      <View style={styles.contentArea}>
        {isTextOnly ? (
          <LinearGradient
            colors={[current.bg_color ?? COLORS.violet, '#0A0C12']}
            style={styles.textBg}
          >
            <Text style={styles.textContent}>{current.text_content}</Text>
          </LinearGradient>
        ) : (
          <Image
            source={{ uri: current.media_url! }}
            style={styles.mediaFull}
            resizeMode="cover"
          />
        )}

        {/* Tap zones for navigation */}
        <Pressable
          style={styles.tapLeft}
          onPress={() => advance(-1)}
          onLongPress={pause}
          onPressOut={resume}
        />
        <Pressable
          style={styles.tapRight}
          onPress={() => advance(1)}
          onLongPress={pause}
          onPressOut={resume}
        />
      </View>

      {/* ---------- CAPTION SECTION (separate, below photo) ---------- */}
      {hasCaption && (
        <View style={styles.captionSection}>
          <Text style={styles.captionText}>{current.text_content}</Text>
        </View>
      )}

      {/* ---------- BOTTOM ACTIONS (separate section) ---------- */}
      {!isMine && (
        <View
          style={[
            styles.bottomSection,
            { paddingBottom: insets.bottom + SPACING.sm },
          ]}
        >
          {isTextOnly ? (
            <View style={styles.textOnlyRow}>
              <TouchableOpacity
                style={[styles.heartBtn, liked && styles.heartBtnActive]}
                onPress={toggleLike}
                activeOpacity={0.7}
                disabled={likeLoading}
              >
                <Ionicons
                  name={liked ? 'heart' : 'heart-outline'}
                  size={20}
                  color={liked ? '#EF4444' : '#FFFFFF'}
                />
              </TouchableOpacity>
            </View>
          ) : (
            <View style={styles.bottomRow}>
              <TouchableOpacity
                style={styles.replyBar}
                activeOpacity={0.7}
                onPress={() => {}}
              >
                <Text style={styles.replyPlaceholder}>Reply to status…</Text>
              </TouchableOpacity>

              <TouchableOpacity
                style={[styles.heartBtn, liked && styles.heartBtnActive]}
                onPress={toggleLike}
                activeOpacity={0.7}
                disabled={likeLoading}
              >
                <Ionicons
                  name={liked ? 'heart' : 'heart-outline'}
                  size={20}
                  color={liked ? '#EF4444' : '#FFFFFF'}
                />
              </TouchableOpacity>
            </View>
          )}
        </View>
      )}

      {/* For own statuses: no actions, just bottom padding */}
      {isMine && (
        <View style={{ paddingBottom: insets.bottom + 8 }} />
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#000',
  },
  loadingWrap: {
    flex: 1,
    backgroundColor: '#000',
    alignItems: 'center',
    justifyContent: 'center',
  },
  safe: { flex: 1, backgroundColor: COLORS.ink900 },
  emptyWrap: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 14,
    padding: SPACING.lg,
  },
  emptyText: {
    color: COLORS.mist,
    fontSize: 14,
    fontFamily: FONTS.body,
  },
  emptyBtn: {
    paddingHorizontal: 20,
    paddingVertical: 10,
    borderRadius: 999,
    backgroundColor: COLORS.violet,
  },
  emptyBtnText: {
    color: '#FFFFFF',
    fontSize: 13,
    fontFamily: FONTS.bodySemiBold,
  },

  headerBlock: {
    backgroundColor: '#0A0C12',
    paddingBottom: SPACING.sm,
  },

  // ✅ Content area (photo) — takes remaining space
  contentArea: {
    flex: 1,
    backgroundColor: '#000',
    position: 'relative',
    overflow: 'hidden',
  },
  mediaFull: {
    ...StyleSheet.absoluteFillObject,
    width: '100%',
    height: '100%',
  },

  // Text-only status content
  textBg: {
    flex: 1,
    width: '100%',
    alignItems: 'center',
    justifyContent: 'center',
    padding: SPACING.xl,
  },
  textContent: {
    color: '#FFFFFF',
    fontSize: 24,
    fontFamily: FONTS.displayBold,
    textAlign: 'center',
    lineHeight: 32,
  },

  // ✅ Caption section — separate block below photo
  captionSection: {
    backgroundColor: '#0A0C12',
    paddingHorizontal: 20,
    paddingTop: 14,
    paddingBottom: 14,
    borderTopWidth: 1,
    borderTopColor: 'rgba(255,255,255,0.06)',
  },
  captionText: {
    color: '#FFFFFF',
    fontSize: 14.5,
    fontFamily: FONTS.body,
    textAlign: 'center',
    lineHeight: 21,
  },

  // ✅ Bottom actions section
  bottomSection: {
    backgroundColor: '#0A0C12',
    paddingHorizontal: SPACING.sm,
    paddingTop: 10,
  },
  bottomRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  textOnlyRow: {
    flexDirection: 'row',
    justifyContent: 'flex-end',
  },
  replyBar: {
    flex: 1,
    borderRadius: 999,
    borderWidth: 1.5,
    borderColor: 'rgba(255,255,255,0.5)',
    paddingVertical: 9,
    paddingHorizontal: 18,
  },
  replyPlaceholder: {
    color: 'rgba(255,255,255,0.75)',
    fontSize: 13.5,
    fontFamily: FONTS.body,
  },
  heartBtn: {
    width: 40,
    height: 40,
    borderRadius: 20,
    borderWidth: 1.5,
    borderColor: 'rgba(255,255,255,0.5)',
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(0,0,0,0.3)',
  },
  heartBtnActive: {
    borderColor: '#EF4444',
    backgroundColor: 'rgba(239,68,68,0.15)',
  },

  // Progress bar
  progressRow: {
    flexDirection: 'row',
    gap: 3,
    paddingHorizontal: SPACING.sm,
    paddingTop: SPACING.sm,
  },
  progressSegment: {
    flex: 1,
    height: 2.5,
    borderRadius: 2,
    backgroundColor: 'rgba(255,255,255,0.3)',
    overflow: 'hidden',
  },
  progressFill: {
    height: '100%',
    backgroundColor: '#FFFFFF',
  },

  // Header
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: SPACING.sm,
    paddingHorizontal: SPACING.sm,
    paddingVertical: SPACING.sm,
  },
  headerInfo: {
    flex: 1,
    minWidth: 0,
  },
  headerNameRow: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  headerName: {
    color: '#FFFFFF',
    fontSize: 13.5,
    fontFamily: FONTS.bodySemiBold,
    flexShrink: 1,
  },
  headerTime: {
    color: 'rgba(255,255,255,0.75)',
    fontSize: 11,
    fontFamily: FONTS.body,
    marginTop: 1,
  },
  headerIconBtn: {
    width: 34,
    height: 34,
    borderRadius: 17,
    alignItems: 'center',
    justifyContent: 'center',
  },

  // Tap zones
  tapLeft: {
    position: 'absolute',
    top: 0,
    bottom: 0,
    left: 0,
    width: '30%',
  },
  tapRight: {
    position: 'absolute',
    top: 0,
    bottom: 0,
    right: 0,
    width: '30%',
  },
});
