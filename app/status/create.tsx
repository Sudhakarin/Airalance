// app/status/create.tsx
// Create a new status — chooser + photo/video editor + music picker

import { useState, useRef, useMemo, useEffect } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TextInput,
  TouchableOpacity,
  ActivityIndicator,
  Alert,
  KeyboardAvoidingView,
  Platform,
  ScrollView,
  Image as RNImage,
  PanResponder,
  Modal,
  Pressable,
} from 'react-native';
import { Image } from 'expo-image';
import { useVideoPlayer, VideoView } from 'expo-video';
import {
  SafeAreaView,
  useSafeAreaInsets,
} from 'react-native-safe-area-context';
import { useRouter, useLocalSearchParams } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { LinearGradient } from 'expo-linear-gradient';
import * as ImagePicker from 'expo-image-picker';
import * as ImageManipulator from 'expo-image-manipulator';
import Svg, { Path } from 'react-native-svg';
import { captureRef } from 'react-native-view-shot';
import { BlurView } from 'expo-blur';
import { COLORS, FONTS, SPACING, CONSTANTS, GRADIENTS } from '../../constants/theme';
import { supabase } from '../../lib/supabase';
import {
  hapticLight,
  hapticSuccess,
  hapticError,
} from '../../lib/haptics';
import { MusicTrack } from '../../lib/music';
import ManualCropModal from '../../components/ManualCropModal';
import MusicPicker from '../../components/MusicPicker';

const STATUS_COLORS = [
  '#7C5CFF',
  '#22D3B8',
  '#EF4444',
  '#F59E0B',
  '#3B82F6',
  '#EC4899',
  '#111827',
];

const DRAW_COLORS = [
  '#FFFFFF',
  '#000000',
  '#EF4444',
  '#F59E0B',
  '#22D3B8',
  '#7C5CFF',
];
const TEXT_COLORS = [
  '#FFFFFF',
  '#000000',
  '#F59E0B',
  '#EF4444',
  '#22D3B8',
  '#7C5CFF',
];

type Mode = 'chooser' | 'text' | 'editor';

type PickedAsset = {
  uri: string;
  type: 'image' | 'video';
  mimeType?: string;
  fileSize?: number;
};

type TextOverlay = {
  id: string;
  text: string;
  color: string;
  x: number;
  y: number;
};

type Stroke = {
  id: string;
  color: string;
  points: { x: number; y: number }[];
};

function pointsToPath(points: { x: number; y: number }[]): string {
  if (points.length === 0) return '';
  let d = `M ${points[0].x} ${points[0].y}`;
  for (let i = 1; i < points.length; i++) {
    d += ` L ${points[i].x} ${points[i].y}`;
  }
  return d;
}

// ============================================================
// Video preview
// ============================================================
function VideoPreview({ uri }: { uri: string }) {
  const player = useVideoPlayer(uri, (p) => {
    p.loop = true;
    p.muted = false;
    p.play();
  });

  return (
    <VideoView
      player={player}
      style={styles.editorMedia}
      contentFit="cover"
      nativeControls={false}
    />
  );
}

export default function CreateStatusScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const params = useLocalSearchParams<{ mode?: string }>();

  const [mode, setMode] = useState<Mode>(() =>
    params.mode === 'text' ? 'text' : 'chooser'
  );

  const [initializing, setInitializing] = useState(params.mode === 'camera');

  const [text, setText] = useState('');
  const [color, setColor] = useState(STATUS_COLORS[0]);

  const [asset, setAsset] = useState<PickedAsset | null>(null);
  const [caption, setCaption] = useState('');
  const [rotation, setRotation] = useState(0);

  const [overlays, setOverlays] = useState<TextOverlay[]>([]);
  const [textModal, setTextModal] = useState<{
    id: string | null;
    text: string;
    color: string;
  } | null>(null);

  const [drawMode, setDrawMode] = useState(false);
  const [drawColor, setDrawColor] = useState(DRAW_COLORS[0]);
  const [strokes, setStrokes] = useState<Stroke[]>([]);
  const [currentStroke, setCurrentStroke] = useState<Stroke | null>(null);

  const [uploading, setUploading] = useState(false);
  const [showManualCrop, setShowManualCrop] = useState(false);

  // ✅ Music state
  const [showMusicPicker, setShowMusicPicker] = useState(false);
  const [musicTrack, setMusicTrack] = useState<MusicTrack | null>(null);
  const [musicStart, setMusicStart] = useState(0);
  const [musicDuration, setMusicDuration] = useState(15);

  const captionRef = useRef<TextInput>(null);
  const editorRef = useRef<View>(null);
  const originalAssetUri = useRef<string | null>(null);

  const isVideo = asset?.type === 'video';

  // ============================================================
  // Handle mode from param
  // ============================================================
  useEffect(() => {
    if (params.mode === 'camera') {
      (async () => {
        const success = await pickPhoto();
        if (success) {
          setInitializing(false);
        } else {
          safeGoBack();
        }
      })();
    } else if (params.mode === 'music') {
      // ✅ Auto-open music picker, stay on chooser
      setShowMusicPicker(true);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function safeGoBack() {
    try {
      if (router.canGoBack()) router.back();
      else router.replace('/(tabs)/status');
    } catch {
      try {
        router.replace('/(tabs)/status');
      } catch {}
    }
  }

  // ============================================================
  // PICK / CAMERA
  // ============================================================
  async function pickPhoto(): Promise<boolean> {
    hapticLight();
    const perm = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (!perm.granted) {
      Alert.alert('Permission needed', 'Please allow photos access.');
      return false;
    }
    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ImagePicker.MediaTypeOptions.All,
      quality: 0.85,
      allowsEditing: true,
      videoMaxDuration: 60,
    });
    if (result.canceled || !result.assets?.[0]) return false;

    const a = result.assets[0];
    const isVid = a.type === 'video';
    if (!isVid && a.fileSize && a.fileSize > CONSTANTS.MAX_IMAGE_BYTES) {
      hapticError();
      Alert.alert('Image too large', 'Maximum 8 MB.');
      return false;
    }
    resetEditor({
      uri: a.uri,
      type: isVid ? 'video' : 'image',
      mimeType: a.mimeType,
      fileSize: a.fileSize,
    });
    return true;
  }

  function resetEditor(a: PickedAsset) {
    originalAssetUri.current = a.uri;
    setAsset(a);
    setRotation(0);
    setCaption('');
    setOverlays([]);
    setStrokes([]);
    setDrawMode(false);
    setCurrentStroke(null);
    hapticSuccess();
    setMode('editor');
  }

  // ============================================================
  // POST TEXT STATUS
  // ============================================================
  async function postTextStatus() {
    if (!text.trim()) return;
    setUploading(true);
    try {
      const { data: authData } = await supabase.auth.getUser();
      if (!authData.user) throw new Error('Not logged in');

      const payload: Record<string, any> = {
        user_id: authData.user.id,
        text_content: text.trim(),
        bg_color: color,
        media_type: 'text',
      };

      if (musicTrack) {
        payload.music_url = musicTrack.streamUrl;
        payload.music_title = musicTrack.title;
        payload.music_artist = musicTrack.artist;
        payload.music_artwork = musicTrack.artwork;
        payload.music_start_sec = musicStart;
        payload.music_duration_sec = musicDuration;
      }

      const { error } = await supabase.from('statuses').insert(payload);
      if (error) throw error;
      hapticSuccess();
      goBackToStatus();
    } catch (err: any) {
      hapticError();
      Alert.alert('Failed', err?.message ?? 'Please try again.');
    } finally {
      setUploading(false);
    }
  }

  // ============================================================
  // POST MEDIA STATUS
  // ============================================================
  async function postMediaStatus() {
    if (!asset) return;
    setUploading(true);
    try {
      const { data: authData } = await supabase.auth.getUser();
      if (!authData.user) throw new Error('Not logged in');

      let uploadUri = asset.uri;
      let uploadExt: string;
      let uploadMime: string;

      if (asset.type === 'video') {
        uploadExt = (asset.uri.split('.').pop() ?? 'mp4')
          .toLowerCase()
          .slice(0, 5);
        uploadMime = asset.mimeType ?? 'video/mp4';
      } else {
        uploadExt = (asset.uri.split('.').pop() ?? 'jpg')
          .toLowerCase()
          .slice(0, 5);
        uploadMime = asset.mimeType ?? 'image/jpeg';

        if (overlays.length > 0 || strokes.length > 0 || rotation !== 0) {
          try {
            const captured = await captureRef(editorRef, {
              format: 'jpg',
              quality: 0.85,
              result: 'tmpfile',
            });
            uploadUri = captured;
            uploadExt = 'jpg';
            uploadMime = 'image/jpeg';
          } catch (captureErr) {
            console.warn('Capture failed, using original:', captureErr);
          }
        }
      }

      const response = await fetch(uploadUri);
      const arrayBuffer = await response.arrayBuffer();
      const path = `${authData.user.id}/${Date.now()}.${uploadExt}`;

      const { error: uploadError } = await supabase.storage
        .from(CONSTANTS.STATUS_MEDIA_BUCKET)
        .upload(path, arrayBuffer, { contentType: uploadMime });
      if (uploadError) throw uploadError;

      const { data: urlData } = supabase.storage
        .from(CONSTANTS.STATUS_MEDIA_BUCKET)
        .getPublicUrl(path);

      const payload: Record<string, any> = {
        user_id: authData.user.id,
        media_url: urlData.publicUrl,
        media_type: asset.type,
        text_content: caption.trim() || null,
      };

      if (musicTrack) {
        payload.music_url = musicTrack.streamUrl;
        payload.music_title = musicTrack.title;
        payload.music_artist = musicTrack.artist;
        payload.music_artwork = musicTrack.artwork;
        payload.music_start_sec = musicStart;
        payload.music_duration_sec = musicDuration;
      }

      const { error } = await supabase.from('statuses').insert(payload);
      if (error) throw error;

      hapticSuccess();
      goBackToStatus();
    } catch (err: any) {
      console.warn('Post media error:', err);
      hapticError();
      Alert.alert('Upload failed', err?.message ?? 'Please try again.');
    } finally {
      setUploading(false);
    }
  }

  function goBackToStatus() {
    setAsset(null);
    setOverlays([]);
    setStrokes([]);
    setCurrentStroke(null);
    setCaption('');
    setRotation(0);
    setDrawMode(false);
    setText('');
    setMusicTrack(null);
    setMusicStart(0);
    setMusicDuration(15);
    setMode('chooser');
    if (router.canGoBack()) {
      router.back();
    } else {
      router.replace('/(tabs)/status');
    }
  }

  // ============================================================
  // TEXT OVERLAY
  // ============================================================
  function openNewTextOverlay() {
    hapticLight();
    setTextModal({ id: null, text: '', color: '#FFFFFF' });
  }

  function openEditTextOverlay(o: TextOverlay) {
    hapticLight();
    setTextModal({ id: o.id, text: o.text, color: o.color });
  }

  function saveTextOverlay() {
    if (!textModal) return;
    const t = textModal.text.trim();
    if (!t) {
      if (textModal.id) {
        setOverlays((prev) => prev.filter((o) => o.id !== textModal.id));
      }
      setTextModal(null);
      return;
    }
    if (textModal.id) {
      setOverlays((prev) =>
        prev.map((o) =>
          o.id === textModal.id
            ? { ...o, text: t, color: textModal.color }
            : o
        )
      );
    } else {
      const id = `o-${Date.now()}`;
      setOverlays((prev) => [
        ...prev,
        { id, text: t, color: textModal.color, x: 0, y: 0 },
      ]);
    }
    hapticSuccess();
    setTextModal(null);
  }

  function deleteTextOverlay() {
    if (!textModal?.id) return;
    setOverlays((prev) => prev.filter((o) => o.id !== textModal.id));
    hapticLight();
    setTextModal(null);
  }

  function updateOverlayPosition(id: string, x: number, y: number) {
    setOverlays((prev) =>
      prev.map((o) => (o.id === id ? { ...o, x, y } : o))
    );
  }

  // ============================================================
  // DRAWING
  // ============================================================
  const drawPanResponder = useMemo(
    () =>
      PanResponder.create({
        onStartShouldSetPanResponder: () => drawMode,
        onMoveShouldSetPanResponder: () => drawMode,
        onPanResponderGrant: (e) => {
          if (!drawMode) return;
          const { locationX, locationY } = e.nativeEvent;
          setCurrentStroke({
            id: `s-${Date.now()}`,
            color: drawColor,
            points: [{ x: locationX, y: locationY }],
          });
        },
        onPanResponderMove: (e) => {
          if (!drawMode) return;
          const { locationX, locationY } = e.nativeEvent;
          setCurrentStroke((prev) =>
            prev
              ? {
                  ...prev,
                  points: [
                    ...prev.points,
                    { x: locationX, y: locationY },
                  ],
                }
              : null
          );
        },
        onPanResponderRelease: () => {
          if (!drawMode) return;
          setCurrentStroke((prev) => {
            if (prev && prev.points.length > 1) {
              setStrokes((s) => [...s, prev]);
            }
            return null;
          });
        },
        onPanResponderTerminate: () => setCurrentStroke(null),
      }),
    [drawMode, drawColor]
  );

  function undoStroke() {
    hapticLight();
    setStrokes((prev) => prev.slice(0, -1));
  }
  function clearStrokes() {
    hapticLight();
    setStrokes([]);
  }

  // ============================================================
  // CROP
  // ============================================================
  async function applyManualCrop(crop: {
    originX: number;
    originY: number;
    width: number;
    height: number;
  }) {
    if (!asset) return;
    setShowManualCrop(false);
    hapticLight();
    try {
      const sourceUri = originalAssetUri.current ?? asset.uri;
      const result = await ImageManipulator.manipulateAsync(
        sourceUri,
        [
          {
            crop: {
              originX: crop.originX,
              originY: crop.originY,
              width: crop.width,
              height: crop.height,
            },
          },
        ],
        {
          format: ImageManipulator.SaveFormat.JPEG,
          compress: 0.9,
        }
      );
      setAsset((prev) => (prev ? { ...prev, uri: result.uri } : null));
      hapticSuccess();
    } catch (err) {
      console.warn('Manual crop error:', err);
      hapticError();
      Alert.alert('Crop failed', 'Please try again.');
    }
  }

  // ============================================================
  // MISC
  // ============================================================
  function handleRotate() {
    hapticLight();
    setRotation((r) => (r + 90) % 360);
  }
  function handleMention() {
    hapticLight();
    setCaption((c) => (c + ' @').slice(0, 200));
    captionRef.current?.focus();
  }

  function openMusicPicker() {
    hapticLight();
    setShowMusicPicker(true);
  }

  function handleMusicSelect(
    track: MusicTrack,
    startSec: number,
    durationSec: number
  ) {
    setMusicTrack(track);
    setMusicStart(startSec);
    setMusicDuration(durationSec);
    setShowMusicPicker(false);
    hapticSuccess();
  }

  function clearMusic() {
    hapticLight();
    setMusicTrack(null);
    setMusicStart(0);
    setMusicDuration(15);
  }

  // ============================================================
  // RENDER
  // ============================================================

  if (initializing) {
    return (
      <View style={styles.loadingWrap}>
        <ActivityIndicator color={COLORS.violet} />
      </View>
    );
  }

  // ---- CHOOSER ----
  if (mode === 'chooser') {
    return (
      <SafeAreaView style={styles.safeDark} edges={['top', 'bottom']}>
        <View style={styles.chooserHeader}>
          <TouchableOpacity
            onPress={() => router.back()}
            style={styles.headerBtn}
            activeOpacity={0.7}
          >
            <Ionicons name="close" size={24} color="#FFFFFF" />
          </TouchableOpacity>
        </View>

        <View style={styles.chooserBody}>
          <Text style={styles.chooserHeading}>Share a moment</Text>
          <Text style={styles.chooserSub}>
            Choose how you want to post your status
          </Text>

          {/* ✅ Music chip on chooser (if selected) */}
          {musicTrack && (
            <View style={styles.chooserMusicChip}>
              <View style={styles.musicChip}>
                <Image
                  source={{ uri: musicTrack.artwork }}
                  style={styles.musicChipArt}
                  contentFit="cover"
                  cachePolicy="memory-disk"
                />
                <View style={styles.musicChipText}>
                  <Text style={styles.musicChipTitle} numberOfLines={1}>
                    {musicTrack.title}
                  </Text>
                  <Text style={styles.musicChipArtist} numberOfLines={1}>
                    {musicTrack.artist}
                  </Text>
                </View>
                <TouchableOpacity
                  onPress={clearMusic}
                  style={styles.musicChipClose}
                  hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
                >
                  <Ionicons name="close" size={16} color="#FFFFFF" />
                </TouchableOpacity>
              </View>
            </View>
          )}
        </View>

        <View style={styles.chooserBottom}>
          <ChooserCircle
            icon="text"
            label="Text"
            onPress={() => {
              hapticLight();
              setMode('text');
            }}
          />
          <ChooserCircle
            icon="musical-notes"
            label="Music"
            onPress={openMusicPicker}
            active={!!musicTrack}
          />
          <ChooserCircle
            icon="camera"
            label="Camera"
            onPress={pickPhoto}
          />
        </View>

        <MusicPicker
          visible={showMusicPicker}
          onClose={() => setShowMusicPicker(false)}
          onSelect={handleMusicSelect}
        />
      </SafeAreaView>
    );
  }

  // ---- TEXT MODE ----
  if (mode === 'text') {
    return (
      <SafeAreaView
        style={[styles.safe, { backgroundColor: color }]}
        edges={['top', 'bottom']}
      >
        <KeyboardAvoidingView
          style={{ flex: 1 }}
          behavior={Platform.OS === 'ios' ? 'padding' : undefined}
        >
          <View style={styles.header}>
            <TouchableOpacity
              onPress={() => setMode('chooser')}
              style={styles.headerBtn}
              activeOpacity={0.7}
            >
              <Ionicons name="chevron-back" size={24} color="#FFFFFF" />
            </TouchableOpacity>
            <Text style={styles.headerTitle}>Text status</Text>
            <TouchableOpacity
              onPress={openMusicPicker}
              style={styles.headerBtn}
              activeOpacity={0.7}
            >
              <Ionicons
                name="musical-notes"
                size={22}
                color={musicTrack ? COLORS.violetLight : '#FFFFFF'}
              />
            </TouchableOpacity>
          </View>

          <ScrollView
            contentContainerStyle={styles.body}
            keyboardShouldPersistTaps="handled"
          >
            <TextInput
              style={styles.textInput}
              value={text}
              onChangeText={(t) => setText(t.slice(0, 200))}
              placeholder="Type a status…"
              placeholderTextColor="rgba(255,255,255,0.6)"
              multiline
              autoFocus
            />
          </ScrollView>

          {musicTrack && (
            <View style={styles.musicChipWrap}>
              <View style={styles.musicChip}>
                <Image
                  source={{ uri: musicTrack.artwork }}
                  style={styles.musicChipArt}
                  contentFit="cover"
                  cachePolicy="memory-disk"
                />
                <View style={styles.musicChipText}>
                  <Text style={styles.musicChipTitle} numberOfLines={1}>
                    {musicTrack.title}
                  </Text>
                  <Text style={styles.musicChipArtist} numberOfLines={1}>
                    {musicTrack.artist}
                  </Text>
                </View>
                <TouchableOpacity
                  onPress={clearMusic}
                  style={styles.musicChipClose}
                  hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
                >
                  <Ionicons name="close" size={16} color="#FFFFFF" />
                </TouchableOpacity>
              </View>
            </View>
          )}

          <View style={styles.footer}>
            <ScrollView
              horizontal
              showsHorizontalScrollIndicator={false}
              contentContainerStyle={styles.colorRow}
            >
              {STATUS_COLORS.map((c) => (
                <TouchableOpacity
                  key={c}
                  style={[
                    styles.colorDot,
                    { backgroundColor: c },
                    color === c && styles.colorDotActive,
                  ]}
                  onPress={() => setColor(c)}
                  activeOpacity={0.8}
                />
              ))}
            </ScrollView>

            <TouchableOpacity
              style={[
                styles.postBtn,
                (!text.trim() || uploading) && styles.postBtnDisabled,
              ]}
              onPress={postTextStatus}
              disabled={!text.trim() || uploading}
              activeOpacity={0.85}
            >
              {uploading ? (
                <ActivityIndicator color="#FFFFFF" />
              ) : (
                <Text style={styles.postBtnText}>Post</Text>
              )}
            </TouchableOpacity>
          </View>
        </KeyboardAvoidingView>

        <MusicPicker
          visible={showMusicPicker}
          onClose={() => setShowMusicPicker(false)}
          onSelect={handleMusicSelect}
        />
      </SafeAreaView>
    );
  }

  // ---- EDITOR MODE ----
  return (
    <View style={styles.editorSafe}>
      <SafeAreaView style={styles.editorTopSafe} edges={['top']}>
        <View style={styles.editorTopBar}>
          <TouchableOpacity
            onPress={() => {
              hapticLight();
              setMode('chooser');
              setAsset(null);
              setOverlays([]);
              setStrokes([]);
              setCaption('');
              setRotation(0);
              setDrawMode(false);
            }}
            style={styles.editorTopBtn}
            activeOpacity={0.7}
          >
            <Ionicons name="close" size={22} color="#FFFFFF" />
          </TouchableOpacity>

          <View style={styles.editorTopRight}>
            {!isVideo && (
              <>
                <TouchableOpacity
                  onPress={openNewTextOverlay}
                  style={styles.editorTopBtn}
                  activeOpacity={0.7}
                >
                  <Ionicons name="text" size={20} color="#FFFFFF" />
                </TouchableOpacity>

                <TouchableOpacity
                  onPress={() => {
                    hapticLight();
                    setShowManualCrop(true);
                  }}
                  style={styles.editorTopBtn}
                  activeOpacity={0.7}
                >
                  <Ionicons name="crop-outline" size={20} color="#FFFFFF" />
                </TouchableOpacity>

                <TouchableOpacity
                  onPress={handleRotate}
                  style={styles.editorTopBtn}
                  activeOpacity={0.7}
                >
                  <Ionicons name="refresh" size={20} color="#FFFFFF" />
                </TouchableOpacity>

                <TouchableOpacity
                  onPress={() => {
                    hapticLight();
                    setDrawMode((d) => !d);
                  }}
                  style={[
                    styles.editorTopBtn,
                    drawMode && styles.editorTopBtnActive,
                  ]}
                  activeOpacity={0.7}
                >
                  <Ionicons name="pencil" size={20} color="#FFFFFF" />
                </TouchableOpacity>
              </>
            )}

            <TouchableOpacity
              onPress={openMusicPicker}
              style={[
                styles.editorTopBtn,
                musicTrack && styles.editorTopBtnActive,
              ]}
              activeOpacity={0.7}
            >
              <Ionicons name="musical-notes" size={20} color="#FFFFFF" />
            </TouchableOpacity>
          </View>
        </View>

        {drawMode && !isVideo && (
          <View style={styles.drawToolbar}>
            <ScrollView
              horizontal
              showsHorizontalScrollIndicator={false}
              contentContainerStyle={styles.drawColorRow}
            >
              {DRAW_COLORS.map((c) => (
                <TouchableOpacity
                  key={c}
                  onPress={() => {
                    hapticLight();
                    setDrawColor(c);
                  }}
                  style={[
                    styles.drawColorDot,
                    { backgroundColor: c },
                    drawColor === c && styles.drawColorDotActive,
                  ]}
                  activeOpacity={0.8}
                />
              ))}
            </ScrollView>
            <TouchableOpacity
              onPress={undoStroke}
              style={styles.drawToolBtn}
              activeOpacity={0.7}
              disabled={strokes.length === 0}
            >
              <Ionicons
                name="arrow-undo"
                size={18}
                color={
                  strokes.length === 0
                    ? 'rgba(255,255,255,0.3)'
                    : '#FFFFFF'
                }
              />
            </TouchableOpacity>
            <TouchableOpacity
              onPress={clearStrokes}
              style={styles.drawToolBtn}
              activeOpacity={0.7}
              disabled={strokes.length === 0}
            >
              <Ionicons
                name="trash-outline"
                size={18}
                color={
                  strokes.length === 0
                    ? 'rgba(255,255,255,0.3)'
                    : '#FFFFFF'
                }
              />
            </TouchableOpacity>
          </View>
        )}
      </SafeAreaView>

      <View ref={editorRef} style={styles.captureArea} collapsable={false}>
        <View style={styles.editorMediaWrap}>
          {asset?.type === 'video' ? (
            <VideoPreview uri={asset.uri} />
          ) : (
            <Image
              source={{ uri: asset?.uri }}
              style={[
                styles.editorMedia,
                { transform: [{ rotate: `${rotation}deg` }] },
              ]}
              contentFit="cover"
              cachePolicy="memory-disk"
            />
          )}
        </View>

        {!isVideo &&
          overlays.map((o) => (
            <DraggableOverlay
              key={o.id}
              overlay={o}
              onUpdate={updateOverlayPosition}
              onTap={() => openEditTextOverlay(o)}
            />
          ))}

        {!isVideo && (
          <View
            style={StyleSheet.absoluteFill}
            pointerEvents={drawMode ? 'auto' : 'none'}
            {...drawPanResponder.panHandlers}
          >
            <Svg style={StyleSheet.absoluteFill}>
              {strokes.map((s) => (
                <Path
                  key={s.id}
                  d={pointsToPath(s.points)}
                  stroke={s.color}
                  strokeWidth={5}
                  fill="none"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                />
              ))}
              {currentStroke && (
                <Path
                  d={pointsToPath(currentStroke.points)}
                  stroke={currentStroke.color}
                  strokeWidth={5}
                  fill="none"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                />
              )}
            </Svg>
          </View>
        )}

        {musicTrack && (
          <View style={styles.musicChipOverlay} pointerEvents="box-none">
            <View style={styles.musicChip}>
              <Image
                source={{ uri: musicTrack.artwork }}
                style={styles.musicChipArt}
                contentFit="cover"
                cachePolicy="memory-disk"
              />
              <View style={styles.musicChipText}>
                <Text style={styles.musicChipTitle} numberOfLines={1}>
                  {musicTrack.title}
                </Text>
                <Text style={styles.musicChipArtist} numberOfLines={1}>
                  {musicTrack.artist}
                </Text>
              </View>
              <TouchableOpacity
                onPress={clearMusic}
                style={styles.musicChipClose}
                hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
              >
                <Ionicons name="close" size={16} color="#FFFFFF" />
              </TouchableOpacity>
            </View>
          </View>
        )}
      </View>

      <SafeAreaView style={styles.editorBottomSafe} edges={['bottom']}>
        <KeyboardAvoidingView
          behavior={Platform.OS === 'ios' ? 'padding' : undefined}
        >
          <View style={styles.editorBottomBar}>
            <View style={styles.captionBox}>
              <TextInput
                ref={captionRef}
                style={styles.captionInput}
                value={caption}
                onChangeText={(t) => setCaption(t.slice(0, 200))}
                placeholder="Add a caption…"
                placeholderTextColor="rgba(255,255,255,0.55)"
                multiline
                maxLength={200}
              />
              <TouchableOpacity
                onPress={handleMention}
                style={styles.mentionBtn}
                activeOpacity={0.7}
                hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
              >
                <Ionicons name="at" size={16} color="#FFFFFF" />
              </TouchableOpacity>
            </View>

            <TouchableOpacity
              onPress={postMediaStatus}
              disabled={uploading}
              activeOpacity={0.85}
              style={styles.sendBtnWrap}
            >
              <LinearGradient
                colors={GRADIENTS.violet as any}
                start={{ x: 0, y: 0 }}
                end={{ x: 1, y: 1 }}
                style={styles.sendBtn}
              >
                {uploading ? (
                  <ActivityIndicator size="small" color="#FFFFFF" />
                ) : (
                  <Ionicons name="send" size={16} color="#FFFFFF" />
                )}
              </LinearGradient>
            </TouchableOpacity>
          </View>
        </KeyboardAvoidingView>
      </SafeAreaView>

      {asset && !isVideo && (
        <ManualCropModal
          visible={showManualCrop}
          imageUri={originalAssetUri.current ?? asset.uri}
          onCancel={() => setShowManualCrop(false)}
          onApply={applyManualCrop}
        />
      )}

      <Modal
        visible={!!textModal && !isVideo}
        transparent
        animationType="fade"
        onRequestClose={() => setTextModal(null)}
        statusBarTranslucent
      >
        <BlurView
          intensity={50}
          tint="dark"
          experimentalBlurMethod="dimezisBlurView"
          style={styles.textModalBackdrop}
        >
          <Pressable
            style={styles.textModalPress}
            onPress={() => setTextModal(null)}
          >
            <Pressable
              style={styles.textModalCard}
              onPress={(e) => e.stopPropagation()}
            >
              <Text style={styles.textModalTitle}>
                {textModal?.id ? 'Edit text' : 'Add text'}
              </Text>
              <TextInput
                style={[
                  styles.textModalInput,
                  { color: textModal?.color ?? '#FFFFFF' },
                ]}
                value={textModal?.text ?? ''}
                onChangeText={(t) =>
                  setTextModal((prev) =>
                    prev ? { ...prev, text: t } : null
                  )
                }
                placeholder="Type something…"
                placeholderTextColor="rgba(255,255,255,0.4)"
                multiline
                maxLength={100}
                autoFocus
              />
              <View style={styles.textColorRow}>
                {TEXT_COLORS.map((c) => (
                  <TouchableOpacity
                    key={c}
                    onPress={() =>
                      setTextModal((prev) =>
                        prev ? { ...prev, color: c } : null
                      )
                    }
                    style={[
                      styles.textColorDot,
                      { backgroundColor: c },
                      textModal?.color === c && styles.textColorDotActive,
                    ]}
                    activeOpacity={0.8}
                  />
                ))}
              </View>
              <View style={styles.textModalBtns}>
                {textModal?.id && (
                  <TouchableOpacity
                    onPress={deleteTextOverlay}
                    style={styles.textModalBtnDanger}
                    activeOpacity={0.75}
                  >
                    <Ionicons
                      name="trash-outline"
                      size={18}
                      color="#FFFFFF"
                    />
                  </TouchableOpacity>
                )}
                <TouchableOpacity
                  onPress={saveTextOverlay}
                  style={styles.textModalBtnPrimary}
                  activeOpacity={0.75}
                >
                  <Text style={styles.textModalBtnPrimaryText}>Done</Text>
                </TouchableOpacity>
              </View>
            </Pressable>
          </Pressable>
        </BlurView>
      </Modal>

      <MusicPicker
        visible={showMusicPicker}
        onClose={() => setShowMusicPicker(false)}
        onSelect={handleMusicSelect}
      />
    </View>
  );
}

// ============================================================
// Chooser circle button — supports active state
// ============================================================
function ChooserCircle({
  icon,
  label,
  onPress,
  active,
}: {
  icon: any;
  label: string;
  onPress: () => void;
  active?: boolean;
}) {
  return (
    <TouchableOpacity
      onPress={onPress}
      activeOpacity={0.8}
      style={styles.chooserBtnWrap}
    >
      <View
        style={[
          styles.chooserBtnCircle,
          active && styles.chooserBtnCircleActive,
        ]}
      >
        <Ionicons name={icon} size={26} color="#FFFFFF" />
      </View>
      <Text style={styles.chooserBtnLabel}>{label}</Text>
    </TouchableOpacity>
  );
}

// ============================================================
// Draggable text overlay
// ============================================================
function DraggableOverlay({
  overlay,
  onUpdate,
  onTap,
}: {
  overlay: TextOverlay;
  onUpdate: (id: string, x: number, y: number) => void;
  onTap: () => void;
}) {
  const [pos, setPos] = useState({ x: overlay.x, y: overlay.y });
  const posRef = useRef(pos);
  posRef.current = pos;

  const startRef = useRef({ x: 0, y: 0 });

  const panResponder = useMemo(
    () =>
      PanResponder.create({
        onStartShouldSetPanResponder: () => true,
        onMoveShouldSetPanResponder: (_, g) =>
          Math.abs(g.dx) > 3 || Math.abs(g.dy) > 3,
        onPanResponderGrant: () => {
          startRef.current = { ...posRef.current };
        },
        onPanResponderMove: (_, g) => {
          setPos({
            x: startRef.current.x + g.dx,
            y: startRef.current.y + g.dy,
          });
        },
        onPanResponderRelease: (_, g) => {
          if (Math.abs(g.dx) < 5 && Math.abs(g.dy) < 5) {
            onTap();
          } else {
            onUpdate(
              overlay.id,
              startRef.current.x + g.dx,
              startRef.current.y + g.dy
            );
          }
        },
      }),
    [overlay.id, onUpdate, onTap]
  );

  return (
    <View
      style={[
        styles.overlayWrap,
        { transform: [{ translateX: pos.x }, { translateY: pos.y }] },
      ]}
      {...panResponder.panHandlers}
    >
      <Text style={[styles.overlayText, { color: overlay.color }]}>
        {overlay.text}
      </Text>
    </View>
  );
}

// ============================================================
// STYLES
// ============================================================
const styles = StyleSheet.create({
  safe: { flex: 1 },
  safeDark: { flex: 1, backgroundColor: '#0A0C12' },

  loadingWrap: {
    flex: 1,
    backgroundColor: '#000000',
    alignItems: 'center',
    justifyContent: 'center',
  },

  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: SPACING.sm,
    paddingVertical: SPACING.sm,
  },
  headerBtn: {
    width: 38,
    height: 38,
    borderRadius: 19,
    alignItems: 'center',
    justifyContent: 'center',
  },
  headerTitle: {
    color: '#FFFFFF',
    fontSize: 14,
    fontFamily: FONTS.bodySemiBold,
  },

  chooserHeader: {
    paddingHorizontal: SPACING.sm,
    paddingTop: SPACING.sm,
  },
  chooserBody: {
    flex: 1,
    justifyContent: 'center',
    paddingHorizontal: 30,
  },
  chooserHeading: {
    fontSize: 28,
    fontFamily: FONTS.displayBold,
    color: '#FFFFFF',
    letterSpacing: -0.5,
  },
  chooserSub: {
    fontSize: 14,
    fontFamily: FONTS.body,
    color: COLORS.mist,
    marginTop: 8,
    lineHeight: 20,
  },
  chooserMusicChip: {
    marginTop: 20,
    alignItems: 'flex-start',
  },
  chooserBottom: {
    flexDirection: 'row',
    justifyContent: 'center',
    alignItems: 'center',
    gap: 36,
    paddingBottom: 50,
    paddingTop: 20,
  },
  chooserBtnWrap: {
    alignItems: 'center',
    gap: 8,
  },
  chooserBtnCircle: {
    width: 64,
    height: 64,
    borderRadius: 32,
    backgroundColor: '#1A1C23',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.1)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  chooserBtnCircleActive: {
    backgroundColor: 'rgba(124,92,255,0.35)',
    borderColor: 'rgba(124,92,255,0.6)',
  },
  chooserBtnLabel: {
    fontSize: 12.5,
    fontFamily: FONTS.bodySemiBold,
    color: '#FFFFFF',
  },

  body: {
    flexGrow: 1,
    alignItems: 'center',
    justifyContent: 'center',
    padding: SPACING.xl,
  },
  textInput: {
    color: '#FFFFFF',
    fontSize: 24,
    fontFamily: FONTS.displayBold,
    textAlign: 'center',
    minHeight: 100,
    width: '100%',
    lineHeight: 32,
  },
  footer: {
    paddingHorizontal: SPACING.sm,
    paddingBottom: SPACING.lg,
    gap: SPACING.sm,
  },
  colorRow: { gap: 8, paddingHorizontal: 4, paddingVertical: 6 },
  colorDot: {
    width: 30,
    height: 30,
    borderRadius: 15,
    borderWidth: 2,
    borderColor: 'transparent',
  },
  colorDotActive: {
    borderColor: '#FFFFFF',
    transform: [{ scale: 1.1 }],
  },
  postBtn: {
    backgroundColor: 'rgba(255,255,255,0.20)',
    borderRadius: 999,
    paddingVertical: 12,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.3)',
  },
  postBtnDisabled: { opacity: 0.5 },
  postBtnText: {
    color: '#FFFFFF',
    fontSize: 14,
    fontFamily: FONTS.bodySemiBold,
  },

  editorSafe: { flex: 1, backgroundColor: '#000000' },
  editorTopSafe: { backgroundColor: '#000000' },
  editorTopBar: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 14,
    paddingVertical: 10,
  },
  editorTopBtn: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: 'rgba(20,20,20,0.65)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  editorTopBtnActive: {
    backgroundColor: 'rgba(124,92,255,0.55)',
  },
  editorTopRight: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },

  drawToolbar: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingHorizontal: 14,
    paddingVertical: 12,
    backgroundColor: 'rgba(0,0,0,0.5)',
    marginTop: 4,
    marginHorizontal: 14,
    borderRadius: 26,
  },
  drawColorRow: {
    gap: 10,
    paddingHorizontal: 4,
    paddingVertical: 4,
  },
  drawColorDot: {
    width: 24,
    height: 24,
    borderRadius: 12,
    borderWidth: 2,
    borderColor: 'rgba(255,255,255,0.15)',
  },
  drawColorDotActive: {
    borderColor: '#FFFFFF',
    transform: [{ scale: 1.1 }],
  },
  drawToolBtn: {
    width: 36,
    height: 36,
    borderRadius: 18,
    alignItems: 'center',
    justifyContent: 'center',
  },

  captureArea: {
    flex: 1,
    backgroundColor: '#000',
    position: 'relative',
    overflow: 'hidden',
  },
  editorMediaWrap: {
    ...StyleSheet.absoluteFillObject,
    alignItems: 'center',
    justifyContent: 'center',
  },
  editorMedia: {
    width: '100%',
    height: '100%',
  },

  overlayWrap: {
    position: 'absolute',
    left: '50%',
    top: '50%',
    marginLeft: -120,
    marginTop: -20,
    width: 240,
    alignItems: 'center',
  },
  overlayText: {
    fontSize: 28,
    fontFamily: FONTS.displayBold,
    textAlign: 'center',
    textShadowColor: 'rgba(0,0,0,0.5)',
    textShadowOffset: { width: 0, height: 2 },
    textShadowRadius: 6,
  },

  editorBottomSafe: {
    backgroundColor: '#000000',
  },
  editorBottomBar: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    gap: 8,
    paddingHorizontal: 12,
    paddingTop: 8,
    paddingBottom: 12,
  },
  captionBox: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: 'rgba(20,20,20,0.75)',
    borderRadius: 20,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.12)',
    paddingLeft: 14,
    paddingRight: 4,
    minHeight: 40,
    maxHeight: 80,
  },
  captionInput: {
    flex: 1,
    fontSize: 14.5,
    fontFamily: FONTS.body,
    color: '#FFFFFF',
    paddingVertical: 10,
    includeFontPadding: false,
  } as any,
  mentionBtn: {
    width: 32,
    height: 32,
    borderRadius: 16,
    alignItems: 'center',
    justifyContent: 'center',
  },
  sendBtnWrap: {
    width: 40,
    height: 40,
    borderRadius: 20,
    overflow: 'hidden',
    shadowColor: '#7C5CFF',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.4,
    shadowRadius: 12,
    elevation: 8,
  },
  sendBtn: {
    width: 40,
    height: 40,
    alignItems: 'center',
    justifyContent: 'center',
  },

  musicChipWrap: {
    paddingHorizontal: 20,
    paddingBottom: 6,
  },
  musicChipOverlay: {
    position: 'absolute',
    top: 12,
    left: 12,
    right: 12,
  },
  musicChip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    backgroundColor: 'rgba(0,0,0,0.65)',
    borderRadius: 14,
    paddingHorizontal: 8,
    paddingVertical: 7,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.1)',
    alignSelf: 'flex-start',
    maxWidth: '100%',
  },
  musicChipArt: {
    width: 34,
    height: 34,
    borderRadius: 8,
  },
  musicChipText: {
    minWidth: 0,
    maxWidth: 200,
  },
  musicChipTitle: {
    color: '#FFFFFF',
    fontSize: 13,
    fontFamily: FONTS.bodySemiBold,
  },
  musicChipArtist: {
    color: 'rgba(255,255,255,0.7)',
    fontSize: 11,
    fontFamily: FONTS.body,
    marginTop: 1,
  },
  musicChipClose: {
    width: 26,
    height: 26,
    borderRadius: 13,
    backgroundColor: 'rgba(255,255,255,0.12)',
    alignItems: 'center',
    justifyContent: 'center',
  },

  textModalBackdrop: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.35)',
  },
  textModalPress: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 24,
  },
  textModalCard: {
    width: '100%',
    maxWidth: 340,
    backgroundColor: 'rgba(20,22,30,0.96)',
    borderRadius: 20,
    padding: 16,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.09)',
  },
  textModalTitle: {
    fontSize: 15,
    fontFamily: FONTS.displayBold,
    color: '#FFFFFF',
    marginBottom: 12,
  },
  textModalInput: {
    backgroundColor: 'rgba(255,255,255,0.05)',
    borderRadius: 12,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.1)',
    padding: 12,
    fontSize: 18,
    fontFamily: FONTS.bodySemiBold,
    minHeight: 60,
    textAlignVertical: 'top',
  } as any,
  textColorRow: {
    flexDirection: 'row',
    gap: 10,
    marginTop: 14,
    justifyContent: 'center',
  },
  textColorDot: {
    width: 28,
    height: 28,
    borderRadius: 14,
    borderWidth: 2,
    borderColor: 'rgba(255,255,255,0.15)',
  },
  textColorDotActive: {
    borderColor: '#FFFFFF',
    transform: [{ scale: 1.15 }],
  },
  textModalBtns: {
    flexDirection: 'row',
    gap: 10,
    marginTop: 16,
  },
  textModalBtnPrimary: {
    flex: 1,
    paddingVertical: 11,
    borderRadius: 12,
    backgroundColor: COLORS.violet,
    alignItems: 'center',
  },
  textModalBtnPrimaryText: {
    color: '#FFFFFF',
    fontSize: 14,
    fontFamily: FONTS.bodySemiBold,
  },
  textModalBtnDanger: {
    paddingVertical: 11,
    paddingHorizontal: 16,
    borderRadius: 12,
    backgroundColor: COLORS.danger,
    alignItems: 'center',
    justifyContent: 'center',
  },
});
