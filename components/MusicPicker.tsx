// components/MusicPicker.tsx
// Instagram-style music picker — absolute overlay (no Modal, no keyboard jump)

import { useEffect, useRef, useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TextInput,
  TouchableOpacity,
  FlatList,
  ActivityIndicator,
  Pressable,
  PanResponder,
  Keyboard,
  Dimensions,
  useWindowDimensions,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Image } from 'expo-image';
import { Ionicons } from '@expo/vector-icons';
import { LinearGradient } from 'expo-linear-gradient';
import { BlurView } from 'expo-blur';
import { useAudioPlayer } from 'expo-audio';
import { COLORS, FONTS, GRADIENTS } from '../constants/theme';
import { hapticLight, hapticSuccess } from '../lib/haptics';
import { searchMusic, MusicTrack } from '../lib/music';

const SHEET_HEIGHT_RATIO = 0.88;

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
  const insets = useSafeAreaInsets();
  const { height: winH } = useWindowDimensions();
  const [stage, setStage] = useState<'search' | 'trim'>('search');
  const [selectedTrack, setSelectedTrack] = useState<MusicTrack | null>(null);

  // Keyboard khulne pe window height chhoti ho sakti hai (adjustResize).
  // Isliye hum sabse badi height yaad rakhte hain, taaki sheet ka size/position
  // kabhi na badle.
  const maxHeightRef = useRef(
    Math.max(winH, Dimensions.get('window').height)
  );
  if (winH > maxHeightRef.current) maxHeightRef.current = winH;

  const fullH = maxHeightRef.current;
  const sheetHeight = fullH * SHEET_HEIGHT_RATIO;
  const sheetTop = fullH - sheetHeight; // top se anchored => keyboard se hilega nahi

  useEffect(() => {
    if (visible) {
      setStage('search');
      setSelectedTrack(null);
    }
  }, [visible]);

  if (!visible) return null;

  return (
    <View style={StyleSheet.absoluteFill} pointerEvents="auto">
      {/* Blur backdrop (blurs editor behind) */}
      <BlurView
        intensity={40}
        tint="dark"
        experimentalBlurMethod="dimezisBlurView"
        style={StyleSheet.absoluteFill}
      />
      <View style={styles.backdropTint} />

      {/* Tap outside to close */}
      <Pressable style={StyleSheet.absoluteFill} onPress={onClose} />

      {/* Sheet — top se fixed, keyboard neeche se overlay hota hai */}
      <View
        style={[
          styles.sheet,
          {
            top: sheetTop,
            height: sheetHeight,
            paddingBottom: insets.bottom + 8,
          },
        ]}
      >
        <View style={styles.handle} />
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
            onConfirm={(start, dur) => {
              hapticSuccess();
              onSelect(selectedTrack, start, dur);
              onClose();
            }}
          />
        ) : null}
      </View>
    </View>
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
  const [kb, setKb] = useState(0);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const preview = useAudioPlayer(null);

  // Keyboard height track karo taaki list / empty-state keyboard ke peeche na chhupe
  useEffect(() => {
    const show = Keyboard.addListener('keyboardDidShow', (e) =>
      setKb(e.endCoordinates.height)
    );
    const hide = Keyboard.addListener('keyboardDidHide', () => setKb(0));
    return () => {
      show.remove();
      hide.remove();
    };
  }, []);

  useEffect(() => {
    return () => {
      try {
        preview.pause();
      } catch {}
    };
  }, [preview]);

  useEffect(() => {
    if (debounceRef.current) clearTimeout(debounceRef.current);
    if (!query.trim()) {
      setTracks([]);
      setLoading(false);
      return;
    }
    setLoading(true);
    debounceRef.current = setTimeout(async () => {
      try {
        const list = await searchMusic(query);
        setTracks(list);
      } catch (err) {
        console.warn('search error', err);
        setTracks([]);
      } finally {
        setLoading(false);
      }
    }, 400);
    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
    };
  }, [query]);

  function togglePreview(track: MusicTrack) {
    try {
      hapticLight();
    } catch {}
    if (playingId === track.id) {
      try {
        preview.pause();
      } catch {}
      setPlayingId(null);
      return;
    }
    try {
      preview.replace(track.streamUrl);
      preview.seekTo(0);
      preview.play();
      setPlayingId(track.id);
    } catch (err) {
      console.warn('preview play err', err);
    }
  }

  function handlePick(track: MusicTrack) {
    try {
      preview.pause();
    } catch {}
    setPlayingId(null);
    onPick(track);
  }

  // Keyboard ke upar ka visible area center karne ke liye
  const centerStyle = [styles.centerBox, { paddingBottom: kb }];

  return (
    <View style={{ flex: 1 }}>
      <View style={styles.searchHeader}>
        <TouchableOpacity
          onPress={onClose}
          style={styles.iconBtn}
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
            autoCorrect={false}
            returnKeyType="search"
          />
          {query.length > 0 && (
            <TouchableOpacity
              onPress={() => setQuery('')}
              hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
            >
              <Ionicons name="close-circle" size={16} color={COLORS.mist} />
            </TouchableOpacity>
          )}
        </View>
      </View>

      {loading && (
        <View style={centerStyle}>
          <ActivityIndicator color={COLORS.violet} />
        </View>
      )}

      {!loading && query.length > 0 && tracks.length === 0 && (
        <View style={centerStyle}>
          <Ionicons name="musical-notes-outline" size={36} color={COLORS.mist} />
          <Text style={styles.emptyText}>No results. Try another name.</Text>
        </View>
      )}

      {!loading && query.length === 0 && (
        <View style={centerStyle}>
          <Ionicons name="search" size={36} color={COLORS.mist} />
          <Text style={styles.emptyText}>Search for a song to add</Text>
        </View>
      )}

      {!loading && tracks.length > 0 && (
        <FlatList
          data={tracks}
          keyExtractor={(item) => item.id}
          contentContainerStyle={[
            styles.listContent,
            { paddingBottom: kb + 12 },
          ]}
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
                      size={14}
                      color="#FFFFFF"
                    />
                  </View>
                </TouchableOpacity>

                <TouchableOpacity
                  style={styles.infoWrap}
                  onPress={() => handlePick(item)}
                  activeOpacity={0.7}
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
    </View>
  );
}

// ============================================================
// Trim Stage
// ============================================================
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

  const player = useAudioPlayer(null);

  const startRef = useRef(start);
  const clipRef = useRef<number>(clipLen);
  const isPlayingRef = useRef(isPlaying);
  const barWidthRef = useRef(barWidth);
  const audioDurRef = useRef(audioDuration);

  startRef.current = start;
  clipRef.current = clipLen;
  isPlayingRef.current = isPlaying;
  barWidthRef.current = barWidth;
  audioDurRef.current = audioDuration;

  useEffect(() => {
    let cancelled = false;
    try {
      player.replace(track.streamUrl);
      if (!cancelled) {
        player.seekTo(0);
      }
    } catch (err) {
      console.warn('load track err', err);
    }
    return () => {
      cancelled = true;
      try {
        player.pause();
      } catch {}
    };
  }, [track.streamUrl, player]);

  useEffect(() => {
    const t = setInterval(() => {
      try {
        const d = player.duration;
        if (d && isFinite(d) && d > 0.5) setAudioDuration(d);
      } catch {}
    }, 300);
    return () => clearInterval(t);
  }, [player]);

  useEffect(() => {
    if (!isPlaying) return;
    const t = setInterval(() => {
      try {
        const cur = player.currentTime ?? 0;
        const end = startRef.current + clipRef.current;
        if (cur >= end - 0.05) {
          player.seekTo(startRef.current);
        }
      } catch {}
    }, 80);
    return () => clearInterval(t);
  }, [isPlaying, player]);

  function togglePlay() {
    try {
      hapticLight();
    } catch {}
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

  function seekToX(x: number) {
    const w = barWidthRef.current;
    const dur = audioDurRef.current;
    if (w <= 0 || dur <= 0) return;
    const ratio = Math.max(0, Math.min(1, x / w));
    const rawStart = ratio * dur - clipRef.current / 2;
    const ns = Math.max(0, Math.min(dur - clipRef.current, rawStart));
    setStart(ns);
    if (isPlayingRef.current) {
      try {
        player.seekTo(ns);
      } catch {}
    }
  }

  const seekToXRef = useRef(seekToX);
  seekToXRef.current = seekToX;

  const panResponder = useRef(
    PanResponder.create({
      onStartShouldSetPanResponder: () => true,
      onMoveShouldSetPanResponder: () => true,
      onPanResponderGrant: (e) => seekToXRef.current(e.nativeEvent.locationX),
      onPanResponderMove: (e) => seekToXRef.current(e.nativeEvent.locationX),
    })
  ).current;

  useEffect(() => {
    setStart((s) => Math.min(s, Math.max(0, audioDuration - clipLen)));
  }, [clipLen, audioDuration]);

  const windowPct =
    audioDuration > 0 ? Math.min(100, (clipLen / audioDuration) * 100) : 0;
  const leftPct = audioDuration > 0 ? (start / audioDuration) * 100 : 0;

  return (
    <View style={{ flex: 1 }}>
      <View style={styles.trimHeader}>
        <TouchableOpacity
          onPress={onBack}
          style={styles.iconBtn}
          activeOpacity={0.7}
        >
          <Ionicons name="chevron-back" size={22} color="#FFFFFF" />
        </TouchableOpacity>
        <Text style={styles.trimHeaderTitle}>New song</Text>
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
          <Text style={styles.doneBtnText}>Done</Text>
        </TouchableOpacity>
      </View>

      <View style={styles.trimBody}>
        <Image
          source={{ uri: track.artwork }}
          style={styles.trimArt}
          contentFit="cover"
          cachePolicy="memory-disk"
          transition={150}
        />

        <Text style={styles.trimTitle} numberOfLines={1}>
          {track.title}
        </Text>
        <Text style={styles.trimArtist} numberOfLines={1}>
          {track.artist}
        </Text>

        <View style={styles.timelineRow}>
          <Text style={styles.timeLabel}>{formatSec(start)}</Text>

          <View
            style={styles.timelineBar}
            onLayout={(e) => setBarWidth(e.nativeEvent.layout.width)}
            {...panResponder.panHandlers}
          >
            <View style={styles.timelineTrackLine} />
            <View
              style={[
                styles.timelineWindow,
                { left: `${leftPct}%`, width: `${windowPct}%` },
              ]}
            >
              <View style={styles.timelineKnob} />
            </View>
          </View>

          <TouchableOpacity
            onPress={togglePlay}
            style={styles.playCircle}
            activeOpacity={0.85}
          >
            <Ionicons
              name={isPlaying ? 'pause' : 'play'}
              size={16}
              color="#FFFFFF"
              style={{ marginLeft: isPlaying ? 0 : 2 }}
            />
          </TouchableOpacity>
        </View>

        <View style={styles.clipRow}>
          {[15, 30].map((len) => (
            <TouchableOpacity
              key={len}
              onPress={() => {
                try {
                  hapticLight();
                } catch {}
                setClipLen(len as 15 | 30);
              }}
              style={[styles.clipBtn, clipLen === len && styles.clipBtnActive]}
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
  backdropTint: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: 'rgba(0,0,0,0.3)',
  },

  // NOTE: bottom: 0 hata diya — sheet ab top + height se fixed hai
  sheet: {
    position: 'absolute',
    left: 0,
    right: 0,
    backgroundColor: '#0F1119',
    borderTopLeftRadius: 26,
    borderTopRightRadius: 26,
    paddingTop: 10,
    paddingHorizontal: 8,
    borderTopWidth: 1,
    borderColor: 'rgba(255,255,255,0.08)',
  },
  handle: {
    width: 40,
    height: 4,
    borderRadius: 2,
    backgroundColor: 'rgba(255,255,255,0.25)',
    alignSelf: 'center',
    marginBottom: 6,
  },

  searchHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    paddingHorizontal: 6,
    paddingTop: 6,
    paddingBottom: 12,
  },
  iconBtn: {
    width: 38,
    height: 38,
    borderRadius: 19,
    backgroundColor: 'rgba(255,255,255,0.05)',
    alignItems: 'center',
    justifyContent: 'center',
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
    paddingHorizontal: 4,
    paddingTop: 4,
    paddingBottom: 12,
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
  useBtn: { borderRadius: 999, overflow: 'hidden' },
  useBtnInner: {
    paddingHorizontal: 16,
    paddingVertical: 7,
  },
  useBtnText: {
    fontSize: 12.5,
    fontFamily: FONTS.bodySemiBold,
    color: '#FFFFFF',
  },

  trimHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 6,
    paddingTop: 4,
    paddingBottom: 12,
  },
  trimHeaderTitle: {
    fontSize: 15,
    fontFamily: FONTS.displayBold,
    color: '#FFFFFF',
  },
  doneBtn: {
    paddingHorizontal: 16,
    paddingVertical: 8,
    borderRadius: 999,
    backgroundColor: COLORS.violet,
  },
  doneBtnText: {
    fontSize: 13,
    fontFamily: FONTS.bodySemiBold,
    color: '#FFFFFF',
  },

  trimBody: {
    flex: 1,
    alignItems: 'center',
    paddingHorizontal: 14,
  },
  trimArt: {
    width: 100,
    height: 100,
    borderRadius: 14,
    marginTop: 6,
  },
  trimTitle: {
    fontSize: 16,
    fontFamily: FONTS.displayBold,
    color: '#FFFFFF',
    marginTop: 14,
    textAlign: 'center',
  },
  trimArtist: {
    fontSize: 12.5,
    fontFamily: FONTS.body,
    color: COLORS.mist,
    marginTop: 4,
    textAlign: 'center',
  },

  timelineRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    width: '100%',
    marginTop: 22,
  },
  timeLabel: {
    width: 44,
    fontSize: 12.5,
    fontFamily: FONTS.bodyMedium,
    color: COLORS.mist,
    textAlign: 'center',
  },
  timelineBar: {
    flex: 1,
    height: 32,
    justifyContent: 'center',
    position: 'relative',
  },
  timelineTrackLine: {
    position: 'absolute',
    left: 0,
    right: 0,
    height: 2,
    borderRadius: 1,
    backgroundColor: 'rgba(255,255,255,0.15)',
  },
  timelineWindow: {
    position: 'absolute',
    height: 3,
    borderRadius: 1.5,
    backgroundColor: '#B8A6FF',
    justifyContent: 'center',
  },
  timelineKnob: {
    position: 'absolute',
    right: -6,
    width: 14,
    height: 14,
    borderRadius: 7,
    backgroundColor: '#FFFFFF',
    borderWidth: 2,
    borderColor: '#B8A6FF',
  },
  playCircle: {
    width: 32,
    height: 32,
    borderRadius: 16,
    backgroundColor: 'rgba(255,255,255,0.1)',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.15)',
    alignItems: 'center',
    justifyContent: 'center',
  },

  clipRow: {
    flexDirection: 'row',
    gap: 10,
    marginTop: 22,
    marginBottom: 8,
  },
  clipBtn: {
    paddingHorizontal: 24,
    paddingVertical: 8,
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
