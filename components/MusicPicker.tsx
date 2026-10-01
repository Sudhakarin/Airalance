// components/MusicPicker.tsx
// Instagram-style music picker — search + preview + 15/30s trim

import { useEffect, useRef, useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  Modal,
  TextInput,
  TouchableOpacity,
  FlatList,
  ActivityIndicator,
  Pressable,
  PanResponder,
  SafeAreaView,
  KeyboardAvoidingView,
  Platform,
} from 'react-native';
import { Image } from 'expo-image';
import { Ionicons } from '@expo/vector-icons';
import { LinearGradient } from 'expo-linear-gradient';
import { useAudioPlayer } from 'expo-audio';
import {
  COLORS,
  FONTS,
  RADII,
  SPACING,
  GRADIENTS,
} from '../constants/theme';
import { hapticLight, hapticSuccess } from '../lib/haptics';
import { searchMusic, MusicTrack } from '../lib/music';

type Props = {
  visible: boolean;
  onClose: () => void;
  onSelect: (
    track: MusicTrack,
    startSec: number,
    durationSec: number
  ) => void;
};

export default function MusicPicker({ visible, onClose, onSelect }: Props) {
  const [stage, setStage] = useState<'search' | 'trim'>('search');
  const [selectedTrack, setSelectedTrack] = useState<MusicTrack | null>(null);

  useEffect(() => {
    if (visible) {
      setStage('search');
      setSelectedTrack(null);
    }
  }, [visible]);

  return (
    <Modal
      visible={visible}
      animationType="slide"
      onRequestClose={onClose}
      statusBarTranslucent
      presentationStyle="fullScreen"
    >
      <SafeAreaView style={styles.safe} edges={['top', 'bottom']}>
        {stage === 'search' ? (
          <SearchStage
            onClose={onClose}
            onPick={(t) => {
              setSelectedTrack(t);
              setStage('trim');
            }}
          />
        ) : selectedTrack ? (
          <TrimStage
            track={selectedTrack}
            onBack={() => setStage('search')}
            onConfirm={(startSec, durationSec) => {
              hapticSuccess();
              onSelect(selectedTrack, startSec, durationSec);
            }}
          />
        ) : null}
      </SafeAreaView>
    </Modal>
  );
}

// ============================================================
// Search Stage
// ============================================================
function SearchStage({
  onClose,
  onPick,
}: {
  onClose: () => void;
  onPick: (t: MusicTrack) => void;
}) {
  const [query, setQuery] = useState('');
  const [tracks, setTracks] = useState<MusicTrack[]>([]);
  const [loading, setLoading] = useState(false);
  const [playingId, setPlayingId] = useState<string | null>(null);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const previewPlayer = useAudioPlayer();

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      try {
        previewPlayer.pause();
      } catch {}
    };
  }, [previewPlayer]);

  // Debounced search
  useEffect(() => {
    if (debounceRef.current) clearTimeout(debounceRef.current);
    if (!query.trim()) {
      setTracks([]);
      setLoading(false);
      return;
    }
    setLoading(true);
    debounceRef.current = setTimeout(async () => {
      const list = await searchMusic(query);
      setTracks(list);
      setLoading(false);
    }, 400);
    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
    };
  }, [query]);

  function togglePreview(track: MusicTrack) {
    hapticLight();
    if (playingId === track.id) {
      try {
        previewPlayer.pause();
      } catch {}
      setPlayingId(null);
      return;
    }
    try {
      previewPlayer.replace(track.streamUrl);
      previewPlayer.seekTo(0);
      previewPlayer.play();
      setPlayingId(track.id);
    } catch (err) {
      console.warn('preview play failed:', err);
    }
  }

  function handlePick(track: MusicTrack) {
    try {
      previewPlayer.pause();
    } catch {}
    setPlayingId(null);
    onPick(track);
  }

  return (
    <KeyboardAvoidingView
      style={{ flex: 1 }}
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
    >
      {/* Header */}
      <View style={styles.header}>
        <TouchableOpacity
          onPress={() => {
            try {
              previewPlayer.pause();
            } catch {}
            onClose();
          }}
          style={styles.headerBtn}
          activeOpacity={0.7}
        >
          <Ionicons name="close" size={22} color="#FFFFFF" />
        </TouchableOpacity>

        <View style={styles.searchBox}>
          <Ionicons name="search" size={16} color={COLORS.mist} />
          <TextInput
            style={styles.searchInput}
            value={query}
            onChangeText={setQuery}
            placeholder="Search songs, artists…"
            placeholderTextColor="rgba(255,255,255,0.35)"
            autoFocus
            autoCorrect={false}
            returnKeyType="search"
          />
          {query.length > 0 && (
            <TouchableOpacity
              onPress={() => setQuery('')}
              hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
            >
              <Ionicons
                name="close-circle"
                size={16}
                color={COLORS.mist}
              />
            </TouchableOpacity>
          )}
        </View>
      </View>

      {/* Body */}
      {loading && (
        <View style={styles.centerBox}>
          <ActivityIndicator color={COLORS.violet} />
        </View>
      )}

      {!loading && query.length > 0 && tracks.length === 0 && (
        <View style={styles.centerBox}>
          <Ionicons
            name="musical-notes-outline"
            size={40}
            color={COLORS.mist}
          />
          <Text style={styles.emptyText}>No results. Try another name.</Text>
        </View>
      )}

      {!loading && query.length === 0 && (
        <View style={styles.centerBox}>
          <Ionicons name="search" size={40} color={COLORS.mist} />
          <Text style={styles.emptyText}>
            Search for a song to add to your status
          </Text>
        </View>
      )}

      {!loading && tracks.length > 0 && (
        <FlatList
          data={tracks}
          keyExtractor={(item) => item.id}
          contentContainerStyle={styles.listContent}
          keyboardShouldPersistTaps="handled"
          initialNumToRender={10}
          maxToRenderPerBatch={8}
          windowSize={5}
          renderItem={({ item }) => {
            const isPlaying = playingId === item.id;
            return (
              <View style={styles.row}>
                <TouchableOpacity
                  style={styles.artWrap}
                  onPress={() => togglePreview(item)}
                  activeOpacity={0.85}
                >
                  <Image
                    source={{ uri: item.artwork }}
                    style={styles.art}
                    contentFit="cover"
                    cachePolicy="memory-disk"
                  />
                  <View style={styles.artOverlay}>
                    <Ionicons
                      name={isPlaying ? 'pause' : 'play'}
                      size={16}
                      color="#FFFFFF"
                    />
                  </View>
                </TouchableOpacity>

                <TouchableOpacity
                  style={styles.infoWrap}
                  onPress={() => handlePick(item)}
                  activeOpacity={0.75}
                >
                  <Text style={styles.trackTitle} numberOfLines={1}>
                    {item.title}
                  </Text>
                  <Text style={styles.trackArtist} numberOfLines={1}>
                    {item.artist}
                  </Text>
                </TouchableOpacity>

                <TouchableOpacity
                  style={styles.useBtn}
                  onPress={() => handlePick(item)}
                  activeOpacity={0.85}
                >
                  <LinearGradient
                    colors={GRADIENTS.violet as any}
                    start={{ x: 0, y: 0 }}
                    end={{ x: 1, y: 1 }}
                    style={styles.useBtnInner}
                  >
                    <Text style={styles.useBtnText}>Use</Text>
                  </LinearGradient>
                </TouchableOpacity>
              </View>
            );
          }}
        />
      )}
    </KeyboardAvoidingView>
  );
}

// ============================================================
// Trim Stage (Instagram-style)
// ============================================================
const TRIM_BAR_HEIGHT = 56;

function TrimStage({
  track,
  onBack,
  onConfirm,
}: {
  track: MusicTrack;
  onBack: () => void;
  onConfirm: (startSec: number, durationSec: number) => void;
}) {
  const [clipLen, setClipLen] = useState<15 | 30>(15);
  const [start, setStart] = useState(0);
  const [isPlaying, setIsPlaying] = useState(false);
  const [barWidth, setBarWidth] = useState(0);
  const [audioDuration, setAudioDuration] = useState(30);

  const player = useAudioPlayer();

  const startRef = useRef(start);
  const clipRef = useRef<number>(clipLen);
  startRef.current = start;
  clipRef.current = clipLen;

  // Load track
  useEffect(() => {
    try {
      player.replace(track.streamUrl);
      player.seekTo(0);
    } catch {}
    return () => {
      try {
        player.pause();
      } catch {}
    };
  }, [track.streamUrl, player]);

  // Poll duration
  useEffect(() => {
    const t = setInterval(() => {
      try {
        const d = player.duration;
        if (d && isFinite(d) && d > 0.5) setAudioDuration(d);
      } catch {}
    }, 300);
    return () => clearInterval(t);
  }, [player]);

  // Loop within window
  useEffect(() => {
    if (!isPlaying) return;
    const t = setInterval(() => {
      try {
        const cur = player.currentTime ?? 0;
        if (cur >= startRef.current + clipRef.current - 0.05) {
          player.seekTo(startRef.current);
        }
      } catch {}
    }, 80);
    return () => clearInterval(t);
  }, [isPlaying, player]);

  function togglePlay() {
    hapticLight();
    if (isPlaying) {
      try {
        player.pause();
      } catch {}
      setIsPlaying(false);
    } else {
      try {
        player.seekTo(start);
        player.play();
      } catch {}
      setIsPlaying(true);
    }
  }

  const maxStart = Math.max(0, audioDuration - clipLen);
  const windowPct =
    audioDuration > 0 ? Math.min(100, (clipLen / audioDuration) * 100) : 0;
  const leftPct =
    audioDuration > 0 ? (start / audioDuration) * 100 : 0;

  function seekToPx(px: number) {
    if (barWidth <= 0 || audioDuration <= 0) return;
    const ratio = Math.max(0, Math.min(1, px / barWidth));
    // center the window on touch
    const rawStart = ratio * audioDuration - clipLen / 2;
    const newStart = Math.max(0, Math.min(maxStart, rawStart));
    setStart(newStart);
    if (isPlaying) {
      try {
        player.seekTo(newStart);
      } catch {}
    }
  }

  const panResponder = useRef(
    PanResponder.create({
      onStartShouldSetPanResponder: () => true,
      onMoveShouldSetPanResponder: () => true,
      onPanResponderGrant: (e) => seekToPxRef.current(e.nativeEvent.locationX),
      onPanResponderMove: (e) => seekToPxRef.current(e.nativeEvent.locationX),
    })
  ).current;

  // Hold the latest seek fn in a ref so PanResponder stays stable
  const seekToPxRef = useRef(seekToPx);
  seekToPxRef.current = seekToPx;

  // When clipLen changes, clamp start
  useEffect(() => {
    setStart((s) => Math.min(s, Math.max(0, audioDuration - clipLen)));
    if (isPlaying) {
      try {
        player.seekTo(Math.min(start, Math.max(0, audioDuration - clipLen)));
      } catch {}
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [clipLen, audioDuration]);

  return (
    <View style={{ flex: 1 }}>
      {/* Header */}
      <View style={styles.header}>
        <TouchableOpacity
          onPress={() => {
            try {
              player.pause();
            } catch {}
            onBack();
          }}
          style={styles.headerBtn}
          activeOpacity={0.7}
        >
          <Ionicons name="chevron-back" size={22} color="#FFFFFF" />
        </TouchableOpacity>
        <View style={{ flex: 1, minWidth: 0 }}>
          <Text style={styles.headerTitle} numberOfLines={1}>
            {track.title}
          </Text>
          <Text style={styles.headerSub} numberOfLines={1}>
            {track.artist}
          </Text>
        </View>
        <TouchableOpacity
          onPress={() => {
            try {
              player.pause();
            } catch {}
            onConfirm(start, clipLen);
          }}
          style={styles.doneBtn}
          activeOpacity={0.85}
        >
          <LinearGradient
            colors={GRADIENTS.violet as any}
            start={{ x: 0, y: 0 }}
            end={{ x: 1, y: 1 }}
            style={styles.doneBtnInner}
          >
            <Text style={styles.doneBtnText}>Done</Text>
          </LinearGradient>
        </TouchableOpacity>
      </View>

      {/* Body */}
      <View style={styles.trimBody}>
        <Image
          source={{ uri: track.artwork }}
          style={styles.trimArt}
          contentFit="cover"
          cachePolicy="memory-disk"
          transition={150}
        />

        <TouchableOpacity
          onPress={togglePlay}
          style={styles.playBtn}
          activeOpacity={0.85}
        >
          <Ionicons
            name={isPlaying ? 'pause' : 'play'}
            size={22}
            color="#0A0C12"
            style={{ marginLeft: isPlaying ? 0 : 3 }}
          />
        </TouchableOpacity>

        <View style={styles.trimSection}>
          <Text style={styles.trimHint}>
            Drag to pick your {clipLen}-second part
          </Text>

          <View
            style={styles.trimTrack}
            onLayout={(e) => setBarWidth(e.nativeEvent.layout.width)}
            {...panResponder.panHandlers}
          >
            {/* Tick marks */}
            <View style={styles.tickRow}>
              {Array.from({ length: 40 }).map((_, i) => (
                <View key={i} style={styles.tick} />
              ))}
            </View>

            {/* Selected window */}
            {barWidth > 0 && (
              <View
                style={[
                  styles.trimWindow,
                  {
                    left: `${leftPct}%`,
                    width: `${windowPct}%`,
                  },
                ]}
                pointerEvents="none"
              >
                <View style={styles.trimHandleLeft} />
                <View style={styles.trimHandleRight} />
              </View>
            )}
          </View>

          <View style={styles.trimMeta}>
            <Text style={styles.trimMetaText}>
              {formatSec(start)}
            </Text>
            <Text style={styles.trimMetaText}>
              {formatSec(start + clipLen)}
            </Text>
          </View>
        </View>

        <View style={styles.clipRow}>
          {[15, 30].map((len) => (
            <TouchableOpacity
              key={len}
              onPress={() => {
                hapticLight();
                setClipLen(len as 15 | 30);
              }}
              style={[
                styles.clipBtn,
                clipLen === len && styles.clipBtnActive,
              ]}
              activeOpacity={0.85}
            >
              <Text
                style={[
                  styles.clipBtnText,
                  clipLen === len && styles.clipBtnTextActive,
                ]}
              >
                {len}s
              </Text>
            </TouchableOpacity>
          ))}
        </View>
      </View>
    </View>
  );
}

function formatSec(s: number) {
  const total = Math.max(0, Math.round(s));
  const m = Math.floor(total / 60);
  const sec = total % 60;
  return `${m}:${sec.toString().padStart(2, '0')}`;
}

// ============================================================
// STYLES
// ============================================================
const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: '#0A0C12' },

  header: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    paddingHorizontal: 14,
    paddingVertical: 10,
    borderBottomWidth: 1,
    borderBottomColor: 'rgba(255,255,255,0.06)',
  },
  headerBtn: {
    width: 38,
    height: 38,
    borderRadius: 19,
    backgroundColor: 'rgba(255,255,255,0.05)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  headerTitle: {
    fontSize: 14.5,
    fontFamily: FONTS.bodySemiBold,
    color: '#FFFFFF',
  },
  headerSub: {
    fontSize: 12,
    fontFamily: FONTS.body,
    color: COLORS.mist,
    marginTop: 1,
  },

  searchBox: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    backgroundColor: 'rgba(255,255,255,0.05)',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.08)',
    borderRadius: 999,
    paddingHorizontal: 14,
    height: 40,
  },
  searchInput: {
    flex: 1,
    fontSize: 14,
    fontFamily: FONTS.body,
    color: '#FFFFFF',
    paddingVertical: 0,
  } as any,

  centerBox: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 30,
    gap: 10,
  },
  emptyText: {
    fontSize: 13.5,
    fontFamily: FONTS.body,
    color: COLORS.mist,
    textAlign: 'center',
  },

  listContent: {
    paddingHorizontal: 12,
    paddingVertical: 8,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    paddingVertical: 8,
    paddingHorizontal: 4,
  },
  artWrap: {
    width: 48,
    height: 48,
    borderRadius: 10,
    overflow: 'hidden',
    position: 'relative',
  },
  art: { width: '100%', height: '100%' },
  artOverlay: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: 'rgba(0,0,0,0.35)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  infoWrap: { flex: 1, minWidth: 0 },
  trackTitle: {
    fontSize: 14.5,
    fontFamily: FONTS.bodySemiBold,
    color: '#FFFFFF',
  },
  trackArtist: {
    fontSize: 12.5,
    fontFamily: FONTS.body,
    color: COLORS.mist,
    marginTop: 2,
  },
  useBtn: {
    borderRadius: 999,
    overflow: 'hidden',
  },
  useBtnInner: {
    paddingHorizontal: 16,
    paddingVertical: 7,
  },
  useBtnText: {
    fontSize: 12.5,
    fontFamily: FONTS.bodySemiBold,
    color: '#FFFFFF',
  },

  // ---- Trim ----
  doneBtn: {
    borderRadius: 999,
    overflow: 'hidden',
  },
  doneBtnInner: {
    paddingHorizontal: 16,
    paddingVertical: 8,
  },
  doneBtnText: {
    fontSize: 13,
    fontFamily: FONTS.bodySemiBold,
    color: '#FFFFFF',
  },

  trimBody: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 24,
    gap: 28,
  },
  trimArt: {
    width: 180,
    height: 180,
    borderRadius: 20,
  },
  playBtn: {
    width: 56,
    height: 56,
    borderRadius: 28,
    backgroundColor: '#FFFFFF',
    alignItems: 'center',
    justifyContent: 'center',
  },

  trimSection: {
    width: '100%',
  },
  trimHint: {
    fontSize: 12.5,
    fontFamily: FONTS.body,
    color: COLORS.mist,
    textAlign: 'center',
    marginBottom: 10,
  },
  trimTrack: {
    width: '100%',
    height: TRIM_BAR_HEIGHT,
    borderRadius: TRIM_BAR_HEIGHT / 2,
    backgroundColor: 'rgba(255,255,255,0.06)',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.1)',
    overflow: 'hidden',
    justifyContent: 'center',
    position: 'relative',
  },
  tickRow: {
    ...StyleSheet.absoluteFillObject,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 6,
  },
  tick: {
    width: 1.5,
    height: 14,
    borderRadius: 1,
    backgroundColor: 'rgba(255,255,255,0.12)',
  },
  trimWindow: {
    position: 'absolute',
    top: 0,
    bottom: 0,
    backgroundColor: 'rgba(124,92,255,0.35)',
    borderLeftWidth: 3,
    borderRightWidth: 3,
    borderColor: '#9C82FF',
  },
  trimHandleLeft: {
    position: 'absolute',
    left: -2,
    top: '50%',
    marginTop: -10,
    width: 6,
    height: 20,
    borderRadius: 3,
    backgroundColor: '#FFFFFF',
  },
  trimHandleRight: {
    position: 'absolute',
    right: -2,
    top: '50%',
    marginTop: -10,
    width: 6,
    height: 20,
    borderRadius: 3,
    backgroundColor: '#FFFFFF',
  },
  trimMeta: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginTop: 8,
    paddingHorizontal: 4,
  },
  trimMetaText: {
    fontSize: 11.5,
    fontFamily: FONTS.bodyMedium,
    color: COLORS.mist,
  },

  clipRow: {
    flexDirection: 'row',
    gap: 10,
  },
  clipBtn: {
    paddingHorizontal: 22,
    paddingVertical: 9,
    borderRadius: 999,
    backgroundColor: 'rgba(255,255,255,0.06)',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.1)',
  },
  clipBtnActive: {
    backgroundColor: '#FFFFFF',
    borderColor: '#FFFFFF',
  },
  clipBtnText: {
    fontSize: 13,
    fontFamily: FONTS.bodySemiBold,
    color: '#FFFFFF',
  },
  clipBtnTextActive: {
    color: '#0A0C12',
  },
});
