// app/status/create.tsx
// Create a new status — chooser (text/music/camera) + photo editor

import { useState, useEffect, useRef } from 'react';
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
} from 'react-native';
import { Image } from 'expo-image';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { LinearGradient } from 'expo-linear-gradient';
import * as ImagePicker from 'expo-image-picker';
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

type Mode = 'chooser' | 'text' | 'editor';

type PickedAsset = {
  uri: string;
  type: 'image' | 'video';
  mimeType?: string;
  fileSize?: number;
};

export default function CreateStatusScreen() {
  const router = useRouter();

  // ---- Mode ----
  const [mode, setMode] = useState<Mode>('chooser');

  // ---- Text mode ----
  const [text, setText] = useState('');
  const [color, setColor] = useState(STATUS_COLORS[0]);

  // ---- Editor mode ----
  const [asset, setAsset] = useState<PickedAsset | null>(null);
  const [caption, setCaption] = useState('');
  const [rotation, setRotation] = useState(0); // 0, 90, 180, 270

  // ---- Shared ----
  const [uploading, setUploading] = useState(false);
  const captionRef = useRef<TextInput>(null);
  const autoPickedRef = useRef(false);

  // ---- Auto-open photo picker on mount (WhatsApp-style) ----
  useEffect(() => {
    if (autoPickedRef.current) return;
    autoPickedRef.current = true;

    const t = setTimeout(() => {
      pickPhoto();
    }, 350);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ============================================================
  // PICK PHOTO
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
      allowsEditing: false,
    });

    if (result.canceled || !result.assets?.[0]) {
      // User cancelled — stay on chooser
      return;
    }

    const a = result.assets[0];
    const isVideo = a.type === 'video';

    if (
      !isVideo &&
      a.fileSize &&
      a.fileSize > CONSTANTS.MAX_IMAGE_BYTES
    ) {
      hapticError();
      Alert.alert('Image too large', 'Maximum 8 MB.');
      return;
    }

    setAsset({
      uri: a.uri,
      type: isVideo ? 'video' : 'image',
      mimeType: a.mimeType,
      fileSize: a.fileSize,
    });
    setRotation(0);
    setCaption('');
    hapticSuccess();
    setMode('editor');
  }

  // ============================================================
  // OPEN CAMERA
  // ============================================================
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

    setAsset({
      uri: a.uri,
      type: isVideo ? 'video' : 'image',
      mimeType: a.mimeType,
      fileSize: a.fileSize,
    });
    setRotation(0);
    setCaption('');
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
  // POST MEDIA STATUS (from editor)
  // ============================================================
  async function postMediaStatus() {
    if (!asset) return;
    setUploading(true);
    try {
      const { data: authData } = await supabase.auth.getUser();
      if (!authData.user) throw new Error('Not logged in');

      const response = await fetch(asset.uri);
      const arrayBuffer = await response.arrayBuffer();
      const ext = (asset.uri.split('.').pop() ?? 'jpg')
        .toLowerCase()
        .slice(0, 5);
      const path = `${authData.user.id}/${Date.now()}.${ext}`;

      const { error: uploadError } = await supabase.storage
        .from(CONSTANTS.STATUS_MEDIA_BUCKET)
        .upload(path, arrayBuffer, {
          contentType:
            asset.mimeType ??
            (asset.type === 'video' ? 'video/mp4' : 'image/jpeg'),
        });

      if (uploadError) throw uploadError;

      const { data: urlData } = supabase.storage
        .from(CONSTANTS.STATUS_MEDIA_BUCKET)
        .getPublicUrl(path);

      const { error } = await supabase.from('statuses').insert({
        user_id: authData.user.id,
        media_url: urlData.publicUrl,
        media_type: asset.type,
        text_content: caption.trim() || null,
      });

      if (error) throw error;
      hapticSuccess();
      router.replace('/(tabs)/status');
    } catch (err: any) {
      hapticError();
      Alert.alert('Upload failed', err?.message ?? 'Please try again.');
    } finally {
      setUploading(false);
    }
  }

  // ============================================================
  // ROTATE — cycles 0 → 90 → 180 → 270 → 0
  // ============================================================
  function handleRotate() {
    hapticLight();
    setRotation((r) => (r + 90) % 360);
  }

  // ============================================================
  // MENTION — append @ to caption
  // ============================================================
  function handleMention() {
    hapticLight();
    setCaption((c) => (c + ' @').slice(0, 200));
    captionRef.current?.focus();
  }

  // ============================================================
  // MUSIC — placeholder
  // ============================================================
  function handleMusic() {
    hapticLight();
    Alert.alert('Coming soon', 'Music in status will be available soon.');
  }

  // ============================================================
  // DRAW — placeholder
  // ============================================================
  function handleDraw() {
    hapticLight();
    Alert.alert('Coming soon', 'Drawing tool will be available soon.');
  }

  // ============================================================
  // TEXT OVERLAY — placeholder
  // ============================================================
  function handleTextOverlay() {
    hapticLight();
    Alert.alert('Coming soon', 'Text overlay on photo will be available soon.');
  }

  // ============================================================
  // RENDER
  // ============================================================

  // ---------- CHOOSER ----------
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

  // ---------- TEXT ----------
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

  // ---------- EDITOR (photo picked) ----------
  return (
    <View style={styles.editorSafe}>
      {/* Fullscreen photo (with rotation) */}
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

      {/* Top bar overlay */}
      <SafeAreaView style={styles.editorTopSafe} edges={['top']}>
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
              onPress={handleTextOverlay}
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
              onPress={handleDraw}
              style={styles.editorTopBtn}
              activeOpacity={0.7}
            >
              <Ionicons name="pencil" size={20} color="#FFFFFF" />
            </TouchableOpacity>
          </View>
        </View>
      </SafeAreaView>

      {/* Bottom bar */}
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

const styles = StyleSheet.create({
  // ---- Common ----
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

  // ---- Chooser ----
  chooserWrap: {
    flex: 1,
    paddingHorizontal: 20,
    paddingTop: 20,
  },
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
  chooserOptions: {
    gap: 12,
  },
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

  // ---- Text mode ----
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
  colorRow: {
    gap: 8,
    paddingHorizontal: 4,
    paddingVertical: 6,
  },
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

  // ---- Editor mode ----
  editorSafe: {
    flex: 1,
    backgroundColor: '#000000',
  },
  editorMediaWrap: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  editorMedia: {
    width: '100%',
    height: '100%',
  },

  editorTopSafe: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
  },
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
  editorTopRight: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },

  editorBottomSafe: {
    position: 'absolute',
    bottom: 0,
    left: 0,
    right: 0,
  },
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
});
