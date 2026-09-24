// app/status/[userId].tsx
// Full-screen status viewer — Instagram-story style with progress bar, swipe down, tap zones

import { useEffect, useState, useRef, useCallback } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  Image,
  Dimensions,
  ActivityIndicator,
  Pressable,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { LinearGradient } from 'expo-linear-gradient';
import { COLORS, FONTS, SPACING } from '../../constants/theme';
import { supabase } from '../../lib/supabase';
import Avatar from '../../components/Avatar';
import VerifiedBadge from '../../components/VerifiedBadge';

const { width: SCREEN_W, height: SCREEN_H } = Dimensions.get('window');
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
  const params = useLocalSearchParams<{ userId: string }>();
  const userId = params.userId;

  const [statuses, setStatuses] = useState<Status[]>([]);
  const [index, setIndex] = useState(0);
  const [loading, setLoading] = useState(true);
  const [myId, setMyId] = useState<string | null>(null);
  const [progress, setProgress] = useState(0);
  const [paused, setPaused] = useState(false);

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

  useEffect(() => {
    if (loading || statuses.length === 0) return;
    const current = statuses[index];
    if (!current) return;

    markViewed(current.id);

    elapsedRef.current = 0;
    frameStartRef.current = performance.now();
    setProgress(0);
    setPaused(false);
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
  }, [index, statuses, loading, markViewed]);

  function advance(dir: 1 | -1) {
    const next = index + dir;
    if (next < 0) return;
    if (next >= statuses.length) {
      router.back();
      return;
    }
    setIndex(next);
  }

  function pause() {
    setPaused(true);
    pausedRef.current = true;
  }
  function resume() {
    setPaused(false);
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
          <TouchableOpacity
            style={styles.emptyBtn}
            onPress={() => router.back()}
          >
            <Text style={styles.emptyBtnText}>Go back</Text>
          </TouchableOpacity>
        </View>
      </SafeAreaView>
    );
  }

  const current = statuses[index];
  const profile = current.profile;
  const isMine = current.user_id === myId;

  return (
    <View style={styles.container}>
      {current.media_type === 'video' && current.media_url ? (
        <View style={styles.mediaWrap}>
          <Image
            source={{ uri: current.media_url }}
            style={styles.media}
            resizeMode="contain"
          />
        </View>
      ) : current.media_url ? (
        <Image
          source={{ uri: current.media_url }}
          style={styles.media}
          resizeMode="contain"
        />
      ) : (
        <LinearGradient
          colors={[current.bg_color ?? COLORS.violet, '#0A0C12']}
          style={styles.textBg}
        >
          <Text style={styles.textContent}>{current.text_content}</Text>
        </LinearGradient>
      )}

      <LinearGradient
        colors={['rgba(0,0,0,0.75)', 'transparent']}
        style={styles.topGradient}
      />
      <LinearGradient
        colors={['transparent', 'rgba(0,0,0,0.75)']}
        style={styles.bottomGradient}
      />

      <SafeAreaView style={styles.topArea} edges={['top']}>
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
                await supabase
                  .from('statuses')
                  .delete()
                  .eq('id', current.id);
                router.back();
              }}
              activeOpacity={0.7}
            >
              <Ionicons name="trash-outline" size={19} color="#FFFFFF" />
            </TouchableOpacity>
          )}
          <TouchableOpacity
            style={styles.headerIconBtn}
            onPress={() => router.back()}
            activeOpacity={0.7}
          >
            <Ionicons name="close" size={22} color="#FFFFFF" />
          </TouchableOpacity>
        </View>
      </SafeAreaView>

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

      {!isMine && (
        <SafeAreaView style={styles.bottomArea} edges={['bottom']}>
          <View style={styles.replyBar}>
            <Text style={styles.replyPlaceholder}>Reply to status…</Text>
          </View>
        </SafeAreaView>
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

  media: {
    width: SCREEN_W,
    height: SCREEN_H,
  },
  mediaWrap: {
    width: SCREEN_W,
    height: SCREEN_H,
    alignItems: 'center',
    justifyContent: 'center',
  },
  textBg: {
    flex: 1,
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

  topGradient: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    height: 180,
  },
  bottomGradient: {
    position: 'absolute',
    bottom: 0,
    left: 0,
    right: 0,
    height: 180,
  },

  topArea: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
  },
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

  tapLeft: {
    position: 'absolute',
    top: 100,
    bottom: 100,
    left: 0,
    width: '30%',
  },
  tapRight: {
    position: 'absolute',
    top: 100,
    bottom: 100,
    right: 0,
    width: '30%',
  },

  bottomArea: {
    position: 'absolute',
    bottom: 0,
    left: 0,
    right: 0,
    padding: SPACING.sm,
  },
  replyBar: {
    borderRadius: 999,
    borderWidth: 1.5,
    borderColor: 'rgba(255,255,255,0.5)',
    paddingVertical: 10,
    paddingHorizontal: 18,
  },
  replyPlaceholder: {
    color: 'rgba(255,255,255,0.75)',
    fontSize: 13.5,
    fontFamily: FONTS.body,
  },
});
