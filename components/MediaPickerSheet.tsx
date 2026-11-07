// components/MediaPickerSheet.tsx
// In-app gallery (WhatsApp / Instagram style) — photos + videos,
// multi-select, album switcher, camera tile, send bar.
// Uses only expo-media-library / expo-image-picker (already in your app),
// so it ships via OTA — no new native build needed.

import { useCallback, useEffect, useMemo, useRef, useState, memo } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  FlatList,
  Modal,
  Pressable,
  ActivityIndicator,
  Alert,
  Linking,
  Image as RNImage,
  useWindowDimensions,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { LinearGradient } from 'expo-linear-gradient';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import * as MediaLibrary from 'expo-media-library';
import { COLORS, FONTS, GRADIENTS } from '../constants/theme';
import { hapticLight } from '../lib/haptics';

export type PickedMedia = {
  uri: string;
  type: 'image' | 'video';
  width: number;
  height: number;
  /** seconds (0 for photos) */
  duration: number;
};

type Props = {
  visible: boolean;
  recipientName?: string;
  maxSelect?: number;
  onClose: () => void;
  onConfirm: (items: PickedMedia[]) => void;
  /** Camera tile tapped — parent closes this sheet and opens the in-app camera */
  onOpenCamera: () => void;
};

const COLS = 3;
const GAP = 2;
const PAGE = 60;
const CAMERA_ID = '__camera__';

function fmtDuration(sec: number) {
  const s = Math.max(0, Math.round(sec || 0));
  const m = Math.floor(s / 60);
  return `${m}:${String(s % 60).padStart(2, '0')}`;
}

type CellProps = {
  item: MediaLibrary.Asset | { id: typeof CAMERA_ID };
  size: number;
  order: number; // 0 = not selected
  onPress: (a: MediaLibrary.Asset) => void;
  onCamera: () => void;
};

const Cell = memo(function Cell({ item, size, order, onPress, onCamera }: CellProps) {
  if (item.id === CAMERA_ID) {
    return (
      <TouchableOpacity
        activeOpacity={0.8}
        onPress={onCamera}
        style={[styles.cell, styles.cameraCell, { width: size, height: size }]}
      >
        <Ionicons name="camera" size={30} color="#FFFFFF" />
        <Text style={styles.cameraText}>Camera</Text>
      </TouchableOpacity>
    );
  }
  const a = item as MediaLibrary.Asset;
  const selected = order > 0;
  return (
    <Pressable
      onPress={() => onPress(a)}
      style={[styles.cell, { width: size, height: size }]}
    >
      <RNImage
        source={{ uri: a.uri }}
        style={[StyleSheet.absoluteFill, selected && { opacity: 0.55 }]}
        resizeMode="cover"
      />
      {a.mediaType === 'video' && (
        <View style={styles.videoBadge}>
          <Ionicons name="videocam" size={13} color="#FFFFFF" />
          <Text style={styles.videoBadgeText}>{fmtDuration(a.duration)}</Text>
        </View>
      )}
      <View style={[styles.check, selected && styles.checkOn]}>
        {selected && <Text style={styles.checkText}>{order}</Text>}
      </View>
      {selected && <View style={styles.selectedRing} pointerEvents="none" />}
    </Pressable>
  );
});

export default function MediaPickerSheet({
  visible,
  recipientName,
  maxSelect = 10,
  onClose,
  onConfirm,
  onOpenCamera,
}: Props) {
  const insets = useSafeAreaInsets();
  const { width } = useWindowDimensions();
  const size = Math.floor((width - GAP * (COLS - 1)) / COLS);

  const [perm, setPerm] = useState<'checking' | 'granted' | 'denied'>('checking');
  const [assets, setAssets] = useState<MediaLibrary.Asset[]>([]);
  const [albums, setAlbums] = useState<MediaLibrary.Album[]>([]);
  const [album, setAlbum] = useState<MediaLibrary.Album | null>(null); // null = Recents
  const [albumMenu, setAlbumMenu] = useState(false);
  const [selected, setSelected] = useState<MediaLibrary.Asset[]>([]);
  const [loading, setLoading] = useState(false);
  const [resolving, setResolving] = useState(false);

  const cursorRef = useRef<string | undefined>(undefined);
  const hasNextRef = useRef(true);
  const loadingRef = useRef(false);
  const albumIdRef = useRef<string | undefined>(undefined);

  const loadPage = useCallback(async (reset: boolean) => {
    if (loadingRef.current) return;
    if (!reset && !hasNextRef.current) return;
    loadingRef.current = true;
    setLoading(true);
    try {
      const page = await MediaLibrary.getAssetsAsync({
        first: PAGE,
        after: reset ? undefined : cursorRef.current,
        album: albumIdRef.current,
        mediaType: [MediaLibrary.MediaType.photo, MediaLibrary.MediaType.video],
        sortBy: [[MediaLibrary.SortBy.creationTime, false]],
      });
      cursorRef.current = page.endCursor;
      hasNextRef.current = page.hasNextPage;
      setAssets((prev) => (reset ? page.assets : [...prev, ...page.assets]));
    } catch (err) {
      console.warn('[picker] load error:', err);
    } finally {
      loadingRef.current = false;
      setLoading(false);
    }
  }, []);

  // open -> ask permission -> first page + albums
  useEffect(() => {
    if (!visible) return;
    let alive = true;
    setSelected([]);
    setAlbum(null);
    setAlbumMenu(false);
    albumIdRef.current = undefined;
    (async () => {
      const p = await MediaLibrary.requestPermissionsAsync();
      if (!alive) return;
      if (!p.granted) {
        setPerm('denied');
        return;
      }
      setPerm('granted');
      hasNextRef.current = true;
      await loadPage(true);
      try {
        const list = await MediaLibrary.getAlbumsAsync({ includeSmartAlbums: true });
        if (alive) {
          setAlbums(
            list
              .filter((a) => a.assetCount > 0)
              .sort((a, b) => b.assetCount - a.assetCount)
          );
        }
      } catch {}
    })();
    return () => {
      alive = false;
    };
  }, [visible, loadPage]);

  const pickAlbum = useCallback(
    (a: MediaLibrary.Album | null) => {
      hapticLight();
      setAlbum(a);
      setAlbumMenu(false);
      albumIdRef.current = a?.id;
      hasNextRef.current = true;
      cursorRef.current = undefined;
      setAssets([]);
      loadPage(true);
    },
    [loadPage]
  );

  const toggle = useCallback(
    (a: MediaLibrary.Asset) => {
      hapticLight();
      setSelected((prev) => {
        if (prev.some((x) => x.id === a.id)) return prev.filter((x) => x.id !== a.id);
        if (prev.length >= maxSelect) {
          Alert.alert('Limit', `You can select up to ${maxSelect} items.`);
          return prev;
        }
        return [...prev, a];
      });
    },
    [maxSelect]
  );

  const orderMap = useMemo(() => {
    const m = new Map<string, number>();
    selected.forEach((a, i) => m.set(a.id, i + 1));
    return m;
  }, [selected]);

  const confirm = useCallback(async () => {
    if (!selected.length || resolving) return;
    setResolving(true);
    try {
      const out: PickedMedia[] = [];
      for (const a of selected) {
        // ph:// (iOS) / content:// (Android) -> real local file we can upload
        const info = await MediaLibrary.getAssetInfoAsync(a, {
          shouldDownloadFromNetwork: true,
        });
        out.push({
          uri: info.localUri ?? info.uri ?? a.uri,
          type: a.mediaType === 'video' ? 'video' : 'image',
          width: a.width,
          height: a.height,
          duration: a.duration ?? 0,
        });
      }
      onConfirm(out);
    } catch (err) {
      console.warn('[picker] resolve error:', err);
      Alert.alert('Error', 'Could not read the selected media. Please try again.');
    } finally {
      setResolving(false);
    }
  }, [selected, resolving, onConfirm]);

  const data = useMemo(
    () => [{ id: CAMERA_ID } as { id: typeof CAMERA_ID }, ...assets] as any[],
    [assets]
  );

  const renderItem = useCallback(
    ({ item }: { item: any }) => (
      <Cell
        item={item}
        size={size}
        order={orderMap.get(item.id) ?? 0}
        onPress={toggle}
        onCamera={onOpenCamera}
      />
    ),
    [size, orderMap, toggle, onOpenCamera]
  );

  return (
    <Modal
      visible={visible}
      transparent
      animationType="slide"
      onRequestClose={onClose}
      statusBarTranslucent
    >
      <View style={styles.backdrop}>
        <Pressable style={{ flex: 0.12 }} onPress={onClose} />
        <View style={[styles.sheet, { paddingBottom: insets.bottom }]}>
          <View style={styles.handle} />

          <View style={styles.header}>
            <TouchableOpacity onPress={onClose} hitSlop={10} style={styles.headerBtn}>
              <Ionicons name="close" size={24} color="#FFFFFF" />
            </TouchableOpacity>
            <TouchableOpacity
              style={styles.albumBtn}
              activeOpacity={0.7}
              onPress={() => setAlbumMenu((v) => !v)}
            >
              <Text style={styles.albumTitle} numberOfLines={1}>
                {album?.title ?? 'Recents'}
              </Text>
              <Ionicons
                name={albumMenu ? 'chevron-up' : 'chevron-down'}
                size={16}
                color="#FFFFFF"
              />
            </TouchableOpacity>
            <Text style={styles.headerHint}>
              {selected.length > 0 ? `${selected.length} selected` : 'Tap to select'}
            </Text>
          </View>

          {perm === 'denied' ? (
            <View style={styles.center}>
              <Ionicons name="images-outline" size={44} color={COLORS.mist} />
              <Text style={styles.deniedText}>
                Allow access to photos & videos to pick from your gallery.
              </Text>
              <TouchableOpacity style={styles.settingsBtn} onPress={() => Linking.openSettings()}>
                <Text style={styles.settingsBtnText}>Open settings</Text>
              </TouchableOpacity>
            </View>
          ) : perm === 'checking' ? (
            <View style={styles.center}>
              <ActivityIndicator color={COLORS.mist} />
            </View>
          ) : (
            <View style={{ flex: 1 }}>
              <FlatList
                data={data}
                keyExtractor={(i) => i.id}
                numColumns={COLS}
                renderItem={renderItem}
                columnWrapperStyle={{ gap: GAP }}
                ItemSeparatorComponent={() => <View style={{ height: GAP }} />}
                onEndReached={() => loadPage(false)}
                onEndReachedThreshold={0.6}
                initialNumToRender={24}
                windowSize={7}
                removeClippedSubviews
                contentContainerStyle={{ paddingBottom: selected.length ? 90 : 16 }}
                ListFooterComponent={
                  loading ? <ActivityIndicator style={{ margin: 16 }} color={COLORS.mist} /> : null
                }
              />

              {albumMenu && (
                <View style={styles.albumMenu}>
                  <FlatList
                    data={[null, ...albums] as (MediaLibrary.Album | null)[]}
                    keyExtractor={(a) => a?.id ?? 'recents'}
                    renderItem={({ item }) => (
                      <TouchableOpacity style={styles.albumRow} onPress={() => pickAlbum(item)}>
                        <Text style={styles.albumRowText} numberOfLines={1}>
                          {item?.title ?? 'Recents'}
                        </Text>
                        {item && <Text style={styles.albumCount}>{item.assetCount}</Text>}
                      </TouchableOpacity>
                    )}
                  />
                </View>
              )}

              {selected.length > 0 && (
                <View style={[styles.sendBar, { bottom: 10 }]}>
                  <View style={styles.toPill}>
                    <Text style={styles.toText} numberOfLines={1}>
                      {recipientName ?? 'Send'}
                    </Text>
                  </View>
                  <TouchableOpacity
                    activeOpacity={0.85}
                    onPress={confirm}
                    disabled={resolving}
                    style={styles.sendBtn}
                  >
                    <LinearGradient
                      colors={GRADIENTS.violet}
                      start={{ x: 0, y: 0 }}
                      end={{ x: 1, y: 1 }}
                      style={styles.sendBtnInner}
                    >
                      {resolving ? (
                        <ActivityIndicator size="small" color="#FFFFFF" />
                      ) : (
                        <Ionicons name="send" size={20} color="#FFFFFF" />
                      )}
                    </LinearGradient>
                    {!resolving && (
                      <View style={styles.sendCount}>
                        <Text style={styles.sendCountText}>{selected.length}</Text>
                      </View>
                    )}
                  </TouchableOpacity>
                </View>
              )}
            </View>
          )}
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: { flex: 1, backgroundColor: 'rgba(0,0,0,0.5)' },
  sheet: {
    flex: 0.88,
    backgroundColor: '#0B0D14',
    borderTopLeftRadius: 20,
    borderTopRightRadius: 20,
    overflow: 'hidden',
  },
  handle: {
    alignSelf: 'center',
    width: 38,
    height: 4,
    borderRadius: 2,
    backgroundColor: 'rgba(255,255,255,0.25)',
    marginTop: 8,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 10,
    height: 52,
  },
  headerBtn: { width: 36, height: 36, alignItems: 'center', justifyContent: 'center' },
  albumBtn: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    marginLeft: 4,
  },
  albumTitle: {
    color: '#FFFFFF',
    fontSize: 17,
    fontFamily: FONTS.displayBold,
    maxWidth: '75%',
  },
  headerHint: { color: COLORS.mist, fontSize: 12.5, fontFamily: FONTS.body },

  cell: { backgroundColor: '#171A24', overflow: 'hidden' },
  cameraCell: { alignItems: 'center', justifyContent: 'center', gap: 4 },
  cameraText: { color: '#FFFFFF', fontSize: 12, fontFamily: FONTS.bodyMedium },
  videoBadge: {
    position: 'absolute',
    left: 5,
    bottom: 5,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 3,
    paddingHorizontal: 5,
    paddingVertical: 2,
    borderRadius: 8,
    backgroundColor: 'rgba(0,0,0,0.55)',
  },
  videoBadgeText: { color: '#FFFFFF', fontSize: 11, fontFamily: FONTS.bodyMedium },
  check: {
    position: 'absolute',
    top: 6,
    right: 6,
    width: 22,
    height: 22,
    borderRadius: 11,
    borderWidth: 2,
    borderColor: '#FFFFFF',
    backgroundColor: 'rgba(0,0,0,0.25)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  checkOn: { backgroundColor: COLORS.violet, borderColor: COLORS.violet },
  checkText: { color: '#FFFFFF', fontSize: 12, fontFamily: FONTS.bodySemiBold },
  selectedRing: {
    ...StyleSheet.absoluteFillObject,
    borderWidth: 3,
    borderColor: COLORS.violet,
  },

  center: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: 14, padding: 30 },
  deniedText: { color: COLORS.mistLight, fontSize: 14, textAlign: 'center', fontFamily: FONTS.body },
  settingsBtn: {
    paddingHorizontal: 18,
    paddingVertical: 10,
    borderRadius: 18,
    backgroundColor: COLORS.violet,
  },
  settingsBtnText: { color: '#FFFFFF', fontFamily: FONTS.bodySemiBold, fontSize: 14 },

  albumMenu: {
    position: 'absolute',
    top: 0,
    left: 10,
    width: 240,
    maxHeight: 320,
    backgroundColor: '#171A24',
    borderRadius: 14,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.09)',
    overflow: 'hidden',
  },
  albumRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 14,
    paddingVertical: 12,
  },
  albumRowText: { flex: 1, color: '#FFFFFF', fontSize: 15, fontFamily: FONTS.bodyMedium },
  albumCount: { color: COLORS.mist, fontSize: 12, marginLeft: 8, fontFamily: FONTS.body },

  sendBar: {
    position: 'absolute',
    left: 12,
    right: 12,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  toPill: {
    maxWidth: '70%',
    paddingHorizontal: 16,
    height: 44,
    borderRadius: 22,
    justifyContent: 'center',
    backgroundColor: 'rgba(23,26,36,0.96)',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.1)',
  },
  toText: { color: '#FFFFFF', fontSize: 14.5, fontFamily: FONTS.bodyMedium },
  sendBtn: { width: 52, height: 52 },
  sendBtnInner: {
    width: 52,
    height: 52,
    borderRadius: 26,
    alignItems: 'center',
    justifyContent: 'center',
  },
  sendCount: {
    position: 'absolute',
    top: -4,
    right: -4,
    minWidth: 20,
    height: 20,
    borderRadius: 10,
    paddingHorizontal: 5,
    backgroundColor: '#FFFFFF',
    alignItems: 'center',
    justifyContent: 'center',
  },
  sendCountText: { color: '#0A0C12', fontSize: 11.5, fontFamily: FONTS.bodySemiBold },
});
