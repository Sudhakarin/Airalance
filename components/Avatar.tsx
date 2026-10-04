// components/Avatar.tsx
// Optimized: memoized, expo-image with cache, memoized computed styles
// Fallback: WhatsApp-style person silhouette icon (no initials)
// ✅ NEW: previewOnHold — Instagram-style DP peek (hold = big DP + blurred bg, release = close)

import { memo, useCallback, useMemo, useRef, useState } from 'react';
import {
  View,
  StyleSheet,
  Pressable,
  Modal,
  Animated,
} from 'react-native';
import { Image } from 'expo-image';
import { BlurView } from 'expo-blur';
import { Ionicons } from '@expo/vector-icons';
import { hapticMedium } from '../lib/haptics';

type AvatarProps = {
  name: string;
  color: string;
  size?: number;
  avatarUrl?: string | null;
  online?: boolean;
  /** Hold the avatar to peek at the full DP; release to close */
  previewOnHold?: boolean;
  /** Normal tap handler (only used when previewOnHold is true) */
  onPress?: () => void;
};

function AvatarBase({
  name,
  color,
  size = 40,
  avatarUrl,
  online = false,
  previewOnHold = false,
  onPress,
}: AvatarProps) {
  // Memoize container style
  const containerStyle = useMemo(
    () => ({ width: size, height: size }),
    [size]
  );

  // Memoize fallback style
  const fallbackStyle = useMemo(
    () => ({
      width: size,
      height: size,
      borderRadius: size / 2,
      backgroundColor: color,
    }),
    [size, color]
  );

  // Memoize person icon size
  const iconSize = useMemo(() => Math.round(size * 0.58), [size]);

  // Memoize image style
  const imageStyle = useMemo(
    () => ({
      width: size,
      height: size,
      borderRadius: size / 2,
    }),
    [size]
  );

  // Memoize online dot style
  const onlineDotStyle = useMemo(() => {
    const indicatorSize = Math.round(size * 0.3);
    return {
      width: indicatorSize,
      height: indicatorSize,
      borderRadius: indicatorSize / 2,
    };
  }, [size]);

  // ---------- DP preview (hold to peek) ----------
  const [previewOpen, setPreviewOpen] = useState(false);
  const anim = useRef(new Animated.Value(0)).current;
  const shownRef = useRef(false);

  const openPreview = useCallback(() => {
    if (shownRef.current) return;
    shownRef.current = true;
    hapticMedium();
    anim.stopAnimation();
    setPreviewOpen(true);
    Animated.spring(anim, {
      toValue: 1,
      friction: 8,
      tension: 90,
      useNativeDriver: true,
    }).start();
  }, [anim]);

  const closePreview = useCallback(() => {
    if (!shownRef.current) return;
    shownRef.current = false;
    anim.stopAnimation();
    Animated.timing(anim, {
      toValue: 0,
      duration: 140,
      useNativeDriver: true,
    }).start(({ finished }) => {
      if (finished) setPreviewOpen(false);
    });
  }, [anim]);

  const fade = useMemo(
    () =>
      anim.interpolate({
        inputRange: [0, 1],
        outputRange: [0, 1],
        extrapolate: 'clamp',
      }),
    [anim]
  );

  const scale = useMemo(
    () =>
      anim.interpolate({
        inputRange: [0, 1],
        outputRange: [0.6, 1],
      }),
    [anim]
  );

  const avatarContent = (
    <View style={containerStyle}>
      {avatarUrl ? (
        <Image
          source={{ uri: avatarUrl }}
          style={imageStyle}
          contentFit="cover"
          cachePolicy="memory-disk"
          transition={120}
          recyclingKey={avatarUrl}
        />
      ) : (
        <View style={[styles.fallback, fallbackStyle]}>
          <Ionicons
            name="person"
            size={iconSize}
            color="rgba(255,255,255,0.95)"
            style={styles.personIcon}
          />
        </View>
      )}

      {online && <View style={[styles.onlineDot, onlineDotStyle]} />}
    </View>
  );

  // Normal avatar (lists etc.) — exactly as before, no extra wrappers
  if (!previewOnHold) return avatarContent;

  return (
    <>
      <Pressable
        onPress={onPress}
        onLongPress={openPreview}
        onPressOut={closePreview}
        delayLongPress={250}
        pressRetentionOffset={{ top: 300, bottom: 300, left: 300, right: 300 }}
      >
        {avatarContent}
      </Pressable>

      <Modal
        visible={previewOpen}
        transparent
        animationType="none"
        statusBarTranslucent
        onRequestClose={closePreview}
      >
        {/* Safety: if the release event is ever missed, any touch closes it */}
        <View style={StyleSheet.absoluteFill} onTouchStart={closePreview}>
          <Animated.View style={[StyleSheet.absoluteFill, { opacity: fade }]}>
            <BlurView
              intensity={70}
              tint="dark"
              experimentalBlurMethod="dimezisBlurView"
              style={StyleSheet.absoluteFill}
            />
            <View style={styles.dim} />
          </Animated.View>

          <View style={styles.previewCenter} pointerEvents="none">
            <Animated.View
              style={[
                styles.previewCard,
                { opacity: fade, transform: [{ scale }] },
              ]}
            >
              {avatarUrl ? (
                <Image
                  source={{ uri: avatarUrl }}
                  style={styles.previewImage}
                  contentFit="cover"
                  cachePolicy="memory-disk"
                  transition={120}
                />
              ) : (
                <View
                  style={[styles.previewFallback, { backgroundColor: color }]}
                >
                  <Ionicons
                    name="person"
                    size={150}
                    color="rgba(255,255,255,0.95)"
                  />
                </View>
              )}
            </Animated.View>

            {!!name && (
              <Animated.Text
                style={[styles.previewName, { opacity: fade }]}
                numberOfLines={1}
              >
                {name}
              </Animated.Text>
            )}
          </View>
        </View>
      </Modal>
    </>
  );
}

// Only re-render if name / url / size / color / online / preview props actually changed
function areEqual(prev: AvatarProps, next: AvatarProps) {
  return (
    prev.name === next.name &&
    prev.color === next.color &&
    prev.size === next.size &&
    prev.avatarUrl === next.avatarUrl &&
    prev.online === next.online &&
    prev.previewOnHold === next.previewOnHold &&
    prev.onPress === next.onPress
  );
}

const Avatar = memo(AvatarBase, areEqual);
export default Avatar;

const styles = StyleSheet.create({
  fallback: {
    alignItems: 'center',
    justifyContent: 'center',
    overflow: 'hidden',
  },
  personIcon: {
    // Optical centering — Ionicons person glyph sits slightly high
    marginTop: 1,
  },
  onlineDot: {
    position: 'absolute',
    bottom: 0,
    right: 0,
    backgroundColor: '#22D3B8',
    borderWidth: 2,
    borderColor: '#0A0C12',
  },

  // ---------- DP preview ----------
  dim: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: 'rgba(0,0,0,0.45)',
  },
  previewCenter: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 24,
  },
  previewCard: {
    width: '84%',
    maxWidth: 360,
    aspectRatio: 1,
    borderRadius: 28,
    overflow: 'hidden',
    backgroundColor: '#171A24',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 12 },
    shadowOpacity: 0.5,
    shadowRadius: 24,
    elevation: 24,
  },
  previewImage: { width: '100%', height: '100%' },
  previewFallback: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  previewName: {
    marginTop: 16,
    fontSize: 17,
    fontWeight: '600',
    color: '#FFFFFF',
  },
});
