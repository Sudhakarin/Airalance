// app/status/create.tsx
// Create a new status — chooser + photo editor with text overlay + drawing

import { useState, useEffect, useRef, useMemo } from 'react';
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
  Dimensions,
  Modal,
  Pressable,
} from 'react-native';
import { Image } from 'expo-image';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { LinearGradient } from 'expo-linear-gradient';
import * as ImagePicker from 'expo-image-picker';
import Svg, { Path } from 'react-native-svg';
import { captureRef } from 'react-native-view-shot';
import { BlurView } from 'expo-blur';
import { COLORS, FONTS, RADII, SPACING, CONSTANTS } from '../../constants/theme';
import { supabase } from '../../lib/supabase';
import {
  hapticLight,
  hapticMedium,
  hapticSuccess,
  hapticError,
} from '../../lib/haptics';

const STATUS_COLORS = [
  '#7C5CFF',
  '#22D3B8',
  '#EF4444',
  '#F59E0B',
  '#3B82F6',
  '#EC4899',
  '#111827',
];

const DRAW_COLORS = ['#FFFFFF', '#000000', '#EF4444', '#F59E0B', '#22D3B8', '#7C5CFF'];
const TEXT_COLORS = ['#FFFFFF', '#000000', '#F59E0B', '#EF4444', '#22D3B8', '#7C5CFF'];

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
  x: number; // offset from center (px)
  y: number;
};

type Stroke = {
  id: string;
  color: string;
  points: { x: number; y: number }[];
};

const { width: SCREEN_W, height: SCREEN_H } = Dimensions.get('window');

function pointsToPath(points: { x: number; y: number }[]): string {
  if (points.length === 0) return '';
  let d = `M ${points[0].x} ${points[0].y}`;
  for (let i = 1; i < points.length; i++) {
    d += ` L ${points[i].x} ${points[i].y}`;
  }
  return d;
}

export default function CreateStatusScreen() {
  const router = useRouter();

  const [mode, setMode] = useState<Mode>('chooser');

  const [text, setText] = useState('');
  const [color, setColor] = useState(STATUS_COLORS[0]);

  const [asset, setAsset] = useState<PickedAsset | null>(null);
  const [caption, setCaption] = useState('');
  const [rotation, setRotation] = useState(0);

  // Text overlays
  const [overlays, setOverlays] = useState<TextOverlay[]>([]);
  const [textModal, setTextModal] = useState<{
    id: string | null;
    text: string;
    color: string;
  } | null>(null);

  // Drawing
  const [drawMode, setDrawMode] = useState(false);
  const [drawColor, setDrawColor] = useState(DRAW_COLORS[0]);
  const [strokes, setStrokes] = useState<Stroke[]>([]);
  const [currentStroke, setCurrentStroke] = useState<Stroke | null>(null);

  const [uploading, setUploading] = useState(false);

  const captionRef = useRef<TextInput>(null);
  const editorRef = useRef<View>(null);
  const autoPickedRef = useRef(false);

  // Auto-open picker on mount
  useEffect(() => {
    if (autoPickedRef.current) return;
    autoPickedRef.current = true;
    const t = setTimeout(() => pickPhoto(), 350);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ============================================================
  // PICK / CAMERA
  // ============================================================
  async function pickPhoto() {
    hapticLight();
    const perm = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (!perm.granted) {
      Alert.alert('Permission needed', 'Please allow photos access.');
      return;
    }
    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ImagePicker.MediaTypeOptions.All,
      quality: 0.85,
    });
    if (result.canceled || !result.assets?.[0]) return;

    const a = result.assets[0];
    const isVideo = a.type === 'video';
    if (!isVideo && a.fileSize && a.fileSize > CONSTANTS.MAX_IMAGE_BYTES) {
      hapticError();
      Alert.alert('Image too large', 'Maximum 8 MB.');
      return;
    }
    resetEditor({
      uri: a.uri,
      type: isVideo ? 'video' : 'image',
      mimeType: a.mimeType,
      fileSize: a.fileSize,
    });
  }

  async function openCamera() {
    hapticLight();
    const perm = await ImagePicker.requestCameraPermissionsAsync();
    if (!perm.granted) {
      Alert.alert('Permission needed', 'Please allow camera access.');
      return;
    }
    const result = await ImagePicker.launchCameraAsync({
      mediaTypes: ImagePicker.MediaTypeOptions.All,
      quality: 0.85,
    });
    if (result.canceled || !result.assets?.[0]) return;
    const a = result.assets[0];
    const isVideo = a.type === 'video';
    resetEditor({
      uri: a.uri,
      type: isVideo ? 'video' : 'image',
      mimeType: a.mimeType,
      fileSize: a.fileSize,
    });
  }

  function resetEditor(a: PickedAsset) {
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
      const { error } = await supabase.from('statuses').insert({
        user_id: authData.user.id,
        text_content: text.trim(),
        bg_color: color,
        media_type: 'text',
      });
      if (error) throw error;
      hapticSuccess();
      router.replace('/(tabs)/status');
    } catch (err: any) {
      hapticError();
      Alert.alert('Failed', err?.message ?? 'Please try again.');
    } finally {
      setUploading(false);
    }
  }

  // ============================================================
  // POST MEDIA STATUS (capture composite)
  // ============================================================
  async function postMediaStatus() {
    if (!asset) return;
    setUploading(true);
    try {
      const { data: authData } = await supabase.auth.getUser();
      if (!authData.user) throw new Error('Not logged in');

      // Capture composite if overlays/drawings exist
      let uploadUri = asset.uri;
      let uploadExt = (asset.uri.split('.').pop() ?? 'jpg').toLowerCase().slice(0, 5);
      let uploadMime = asset.mimeType ?? 'image/jpeg';

      if (overlays.length > 0 || strokes.length > 0 || rotation !== 0) {
        const captured = await captureRef(editorRef, {
          format: 'jpg',
          quality: 0.9,
        });
        uploadUri = captured;
        uploadExt = 'jpg';
        uploadMime = 'image/jpeg';
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

      const { error } = await supabase.from('statuses').insert({
        user_id: authData.user.id,
        media_url: urlData.publicUrl,
        media_type: 'image',
        text_content: caption.trim() || null,
      });
      if (error) throw error;

      hapticSuccess();
      router.replace('/(tabs)/status');
    } catch (err: any) {
      console.warn('Post media error:', err);
      hapticError();
      Alert.alert('Upload failed', err?.message ?? 'Please try again.');
    } finally {
      setUploading(false);
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
          o.id === textModal.id ? { ...o, text: t, color: textModal.color } : o
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
              ? { ...prev, points: [...prev.points, { x: locationX, y: locationY }] }
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
        onPanResponderTerminate: () => {
          setCurrentStroke(null);
        },
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
  function handleMusic() {
    hapticLight();
    Alert.alert('Coming soon', 'Music in status will be available soon.');
  }

  // ============================================================
  // RENDER
  // ============================================================

  // ---- CHOOSER ----
  if (mode === 'chooser') {
    return (
      <SafeAreaView style={styles.safeDark} edges={['top', 'bottom']}>
        <View style={styles.header}>
          <TouchableOpacity
            onPress={() => router.back()}
            style={styles.headerBtn}
            activeOpacity={0.7}
          >
            <Ionicons name="close" size={24} color="#FFFFFF" />
          </TouchableOpacity>
          <Text style={styles.headerTitle}>New status</Text>
          <View style={styles.headerBtn} />
        </View>

        <View style={styles.chooserWrap}>
          <Text style={styles.chooserHeading}>Share a moment</Text>
          <Text style={styles.chooserSub}>
            Choose how you want to post your status
          </Text>

          <View style={styles.chooserOptions}>
            <ChooserOption
              icon="text"
              label="Text"
              sub="Write a message"
              gradient={['#7C5CFF', '#9C82FF']}
              onPress={() => {
                hapticLight();
                setMode('text');
              }}
            />
            <ChooserOption
              icon="musical-notes"
              label="Music"
              sub="Add a soundtrack"
              gradient={['#EC4899', '#F472B6']}
              onPress={handleMusic}
            />
            <ChooserOption
              icon="camera"
              label="Camera"
              sub="Take or pick a photo"
              gradient={['#22D3B8', '#14B8A6']}
              onPress={pickPhoto}
            />
          </View>
        </View>
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
            <View style={styles.headerBtn} />
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
      </SafeAreaView>
    );
  }

  // ---- EDITOR MODE ----
  return (
    <View style={styles.editorSafe}>
      {/* CAPTURABLE AREA: photo + overlays + strokes */}
      <View ref={editorRef} style={styles.captureArea} collapsable={false}>
        <View style={styles.editorMediaWrap}>
          {asset?.type === 'video' ? (
            <RNImage
              source={{ uri: asset.uri }}
              style={[
                styles.editorMedia,
                { transform: [{ rotate: `${rotation}deg` }] },
              ]}
              resizeMode="contain"
            />
          ) : (
            <Image
              source={{ uri: asset?.uri }}
              style={[
                styles.editorMedia,
                { transform: [{ rotate: `${rotation}deg` }] },
              ]}
              contentFit="contain"
              cachePolicy="memory-disk"
            />
          )}
        </View>

        {/* Text overlays */}
        {overlays.map((o) => (
          <DraggableOverlay
            key={o.id}
            overlay={o}
            onUpdate={updateOverlayPosition}
            onTap={() => openEditTextOverlay(o)}
          />
        ))}

        {/* Drawing layer */}
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
      </View>

      {/* TOP BAR — outside capture, so it doesn't appear in final image */}
      <SafeAreaView style={styles.editorTopSafe} edges={['top']} pointerEvents="box-none">
        <View style={styles.editorTopBar}>
          <TouchableOpacity
            onPress={() => {
              hapticLight();
              setMode('chooser');
              setAsset(null);
            }}
            style={styles.editorTopBtn}
            activeOpacity={0.7}
          >
            <Ionicons name="close" size={22} color="#FFFFFF" />
          </TouchableOpacity>

          <View style={styles.editorTopRight}>
            <TouchableOpacity
              onPress={openNewTextOverlay}
              style={styles.editorTopBtn}
              activeOpacity={0.7}
            >
              <Ionicons name="text" size={20} color="#FFFFFF" />
            </TouchableOpacity>
            <TouchableOpacity
              onPress={handleRotate}
              style={styles.editorTopBtn}
              activeOpacity={0.7}
            >
              <Ionicons name="refresh" size={20} color="#FFFFFF" />
            </TouchableOpacity>
            <TouchableOpacity
              onPress={handleMusic}
              style={styles.editorTopBtn}
              activeOpacity={0.7}
            >
              <Ionicons name="musical-notes" size={20} color="#FFFFFF" />
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
              <Ionicons
                name="pencil"
                size={20}
                color={drawMode ? COLORS.violetLight : '#FFFFFF'}
              />
            </TouchableOpacity>
          </View>
        </View>

        {/* Draw toolbar when draw mode is on */}
        {drawMode && (
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
                color={strokes.length === 0 ? 'rgba(255,255,255,0.3)' : '#FFFFFF'}
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
                color={strokes.length === 0 ? 'rgba(255,255,255,0.3)' : '#FFFFFF'}
              />
            </TouchableOpacity>
          </View>
        )}
      </SafeAreaView>

      {/* BOTTOM BAR — outside capture */}
      <SafeAreaView
        style={styles.editorBottomSafe}
        edges={['bottom']}
        pointerEvents="box-none"
      >
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
                placeholderTextColor="rgba(255,255,255,0.6)"
                multiline
                maxLength={200}
              />
              <TouchableOpacity
                onPress={handleMention}
                style={styles.mentionBtn}
                activeOpacity={0.7}
                hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
              >
                <Ionicons name="at" size={20} color="#FFFFFF" />
              </TouchableOpacity>
            </View>

            <TouchableOpacity
              onPress={postMediaStatus}
              disabled={uploading}
              activeOpacity={0.85}
              style={styles.sendBtn}
            >
              {uploading ? (
                <ActivityIndicator size="small" color="#FFFFFF" />
              ) : (
                <Ionicons name="send" size={20} color="#FFFFFF" />
              )}
            </TouchableOpacity>
          </View>
        </KeyboardAvoidingView>
      </SafeAreaView>

      {/* TEXT INPUT MODAL */}
      <Modal
        visible={!!textModal}
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
          <Pressable style={styles.textModalPress} onPress={() => setTextModal(null)}>
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
                  setTextModal((prev) => (prev ? { ...prev, text: t } : null))
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
                    <Ionicons name="trash-outline" size={18} color="#FFFFFF" />
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
    </View>
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
        {
          transform: [{ translateX: pos.x }, { translateY: pos.y }],
        },
      ]}
      {...panResponder.panHandlers}
    >
      <Text
        style={[
          styles.overlayText,
          { color: overlay.color },
        ]}
      >
        {overlay.text}
      </Text>
    </View>
  );
}

// ============================================================
// Chooser option card
// ============================================================
function ChooserOption({
  icon,
  label,
  sub,
  gradient,
  onPress,
}: {
  icon: any;
  label: string;
  sub: string;
  gradient: [string, string];
  onPress: () => void;
}) {
  return (
    <TouchableOpacity
      onPress={onPress}
      activeOpacity={0.85}
      style={styles.chooserCard}
    >
      <LinearGradient
        colors={gradient}
        start={{ x: 0, y: 0 }}
        end={{ x: 1, y: 1 }}
        style={styles.chooserIconWrap}
      >
        <Ionicons name={icon} size={22} color="#FFFFFF" />
      </LinearGradient>
      <View style={{ flex: 1 }}>
        <Text style={styles.chooserLabel}>{label}</Text>
        <Text style={styles.chooserLabelSub}>{sub}</Text>
      </View>
      <Ionicons name="chevron-forward" size={18} color="rgba(255,255,255,0.4)" />
    </TouchableOpacity>
  );
}

// ============================================================
// STYLES
// ============================================================
const styles = StyleSheet.create({
  safe: { flex: 1 },
  safeDark: { flex: 1, backgroundColor: '#0A0C12' },

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

  chooserWrap: { flex: 1, paddingHorizontal: 20, paddingTop: 20 },
  chooserHeading: {
    fontSize: 26,
    fontFamily: FONTS.displayBold,
    color: '#FFFFFF',
    letterSpacing: -0.5,
  },
  chooserSub: {
    fontSize: 14,
    fontFamily: FONTS.body,
    color: COLORS.mist,
    marginTop: 6,
    marginBottom: 28,
  },
  chooserOptions: { gap: 12 },
  chooserCard: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 14,
    padding: 14,
    borderRadius: 18,
    backgroundColor: '#121212',
    borderWidth: 1,
    borderColor: '#1F1F23',
  },
  chooserIconWrap: {
    width: 46,
    height: 46,
    borderRadius: 14,
    alignItems: 'center',
    justifyContent: 'center',
  },
  chooserLabel: {
    fontSize: 16,
    fontFamily: FONTS.bodySemiBold,
    color: '#FFFFFF',
  },
  chooserLabelSub: {
    fontSize: 12.5,
    fontFamily: FONTS.body,
    color: COLORS.mist,
    marginTop: 2,
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

  // ---- Editor ----
  editorSafe: { flex: 1, backgroundColor: '#000000' },
  captureArea: { flex: 1, position: 'relative' },
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

  editorTopSafe: { position: 'absolute', top: 0, left: 0, right: 0 },
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
    backgroundColor: 'rgba(124,92,255,0.35)',
    borderWidth: 1,
    borderColor: COLORS.violetLight,
  },
  editorTopRight: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },

  drawToolbar: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingHorizontal: 14,
    paddingVertical: 10,
    backgroundColor: 'rgba(0,0,0,0.5)',
    marginTop: 4,
    marginHorizontal: 14,
    borderRadius: 24,
  },
  drawColorRow: { gap: 8, paddingHorizontal: 2 },
  drawColorDot: {
    width: 26,
    height: 26,
    borderRadius: 13,
    borderWidth: 2,
    borderColor: 'rgba(255,255,255,0.15)',
  },
  drawColorDotActive: {
    borderColor: '#FFFFFF',
    transform: [{ scale: 1.15 }],
  },
  drawToolBtn: {
    width: 36,
    height: 36,
    borderRadius: 18,
    alignItems: 'center',
    justifyContent: 'center',
  },

  editorBottomSafe: { position: 'absolute', bottom: 0, left: 0, right: 0 },
  editorBottomBar: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    gap: 10,
    paddingHorizontal: 14,
    paddingTop: 10,
    paddingBottom: 14,
  },
  captionBox: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: 'rgba(20,20,20,0.75)',
    borderRadius: 28,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.12)',
    paddingLeft: 16,
    paddingRight: 6,
    minHeight: 48,
    maxHeight: 110,
  },
  captionInput: {
    flex: 1,
    fontSize: 15,
    fontFamily: FONTS.body,
    color: '#FFFFFF',
    paddingVertical: 12,
    includeFontPadding: false,
  } as any,
  mentionBtn: {
    width: 38,
    height: 38,
    borderRadius: 19,
    alignItems: 'center',
    justifyContent: 'center',
  },
  sendBtn: {
    width: 48,
    height: 48,
    borderRadius: 24,
    backgroundColor: COLORS.teal,
    alignItems: 'center',
    justifyContent: 'center',
    shadowColor: COLORS.teal,
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.4,
    shadowRadius: 12,
    elevation: 8,
  },

  // ---- Text modal ----
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
