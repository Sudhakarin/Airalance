// app/status/create.tsx
// Create a new status — text, image, or video

import { useState } from 'react';
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
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import * as ImagePicker from 'expo-image-picker';
import { COLORS, FONTS, RADII, SPACING, CONSTANTS } from '../../constants/theme';
import { supabase } from '../../lib/supabase';

const STATUS_COLORS = [
  '#7C5CFF',
  '#22D3B8',
  '#EF4444',
  '#F59E0B',
  '#3B82F6',
  '#EC4899',
  '#111827',
];

export default function CreateStatusScreen() {
  const router = useRouter();
  const [text, setText] = useState('');
  const [color, setColor] = useState(STATUS_COLORS[0]);
  const [uploading, setUploading] = useState(false);

  // Post text status
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
      router.replace('/(tabs)/status');
    } catch (err: any) {
      Alert.alert('Failed', err?.message ?? 'Please try again.');
    } finally {
      setUploading(false);
    }
  }

  // Pick + upload image/video
  async function pickMedia() {
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

    const asset = result.assets[0];
    const isVideo = asset.type === 'video';

    if (
      !isVideo &&
      asset.fileSize &&
      asset.fileSize > CONSTANTS.MAX_IMAGE_BYTES
    ) {
      Alert.alert('Image too large', 'Maximum 8 MB.');
      return;
    }

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
          contentType: asset.mimeType ?? (isVideo ? 'video/mp4' : 'image/jpeg'),
        });

      if (uploadError) throw uploadError;

      const { data: urlData } = supabase.storage
        .from(CONSTANTS.STATUS_MEDIA_BUCKET)
        .getPublicUrl(path);

      const { error } = await supabase.from('statuses').insert({
        user_id: authData.user.id,
        media_url: urlData.publicUrl,
        media_type: isVideo ? 'video' : 'image',
      });

      if (error) throw error;
      router.replace('/(tabs)/status');
    } catch (err: any) {
      Alert.alert('Upload failed', err?.message ?? 'Please try again.');
    } finally {
      setUploading(false);
    }
  }

  return (
    <SafeAreaView style={[styles.safe, { backgroundColor: color }]}>
      <KeyboardAvoidingView
        style={{ flex: 1 }}
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      >
        {/* Header */}
        <View style={styles.header}>
          <TouchableOpacity
            onPress={() => router.back()}
            style={styles.headerBtn}
            activeOpacity={0.7}
          >
            <Ionicons name="close" size={26} color="#FFFFFF" />
          </TouchableOpacity>
          <Text style={styles.headerTitle}>New status</Text>
          <TouchableOpacity
            style={styles.headerBtn}
            onPress={pickMedia}
            disabled={uploading}
            activeOpacity={0.7}
          >
            <Ionicons name="image-outline" size={24} color="#FFFFFF" />
          </TouchableOpacity>
        </View>

        {/* Text input */}
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

        {/* Color picker + Post */}
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

const styles = StyleSheet.create({
  safe: { flex: 1 },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: SPACING.md,
    paddingVertical: SPACING.md,
  },
  headerBtn: {
    width: 40,
    height: 40,
    borderRadius: 20,
    alignItems: 'center',
    justifyContent: 'center',
  },
  headerTitle: {
    color: '#FFFFFF',
    fontSize: 15,
    fontFamily: FONTS.bodySemiBold,
  },
  body: {
    flexGrow: 1,
    alignItems: 'center',
    justifyContent: 'center',
    padding: SPACING.xxl,
  },
  textInput: {
    color: '#FFFFFF',
    fontSize: 28,
    fontFamily: FONTS.displayBold,
    textAlign: 'center',
    minHeight: 120,
    width: '100%',
    lineHeight: 36,
  },
  footer: {
    paddingHorizontal: SPACING.md,
    paddingBottom: SPACING.xl,
    gap: SPACING.md,
  },
  colorRow: {
    gap: 10,
    paddingHorizontal: 4,
    paddingVertical: 8,
  },
  colorDot: {
    width: 34,
    height: 34,
    borderRadius: 17,
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
    paddingVertical: 14,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.3)',
  },
  postBtnDisabled: {
    opacity: 0.5,
  },
  postBtnText: {
    color: '#FFFFFF',
    fontSize: 15,
    fontFamily: FONTS.bodySemiBold,
  },
});
