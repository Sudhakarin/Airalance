// components/Avatar.tsx
// Optimized: memoized, expo-image with cache, memoized computed styles
// Fallback: WhatsApp-style person silhouette icon (no initials)
// ✅ previewOnHold — Instagram-style DP peek (hold = big DP + blurred bg, release = close)
//    The overlay itself is drawn by <AvatarPreviewHost /> (mounted once on the screen).

import { memo, useCallback, useEffect, useMemo, useRef } from 'react';
import { View, StyleSheet, Pressable } from 'react-native';
import { Image } from 'expo-image';
import { Ionicons } from '@expo/vector-icons';
import { hapticMedium } from '../lib/haptics';
import { showAvatarPreview, hideAvatarPreview } from './AvatarPreviewHost';

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
  const shownRef = useRef(false);

  const openPreview = useCallback(() => {
    if (shownRef.current) return;
    shownRef.current = true;
    hapticMedium();
    showAvatarPreview({ name, color, avatarUrl: avatarUrl ?? null });
  }, [name, color, avatarUrl]);

  const closePreview = useCallback(() => {
    if (!shownRef.current) return;
    shownRef.current = false;
    hideAvatarPreview();
  }, []);

  // If the avatar unmounts while held, make sure the overlay closes
  useEffect(
    () => () => {
      if (shownRef.current) {
        shownRef.current = false;
        hideAvatarPreview();
      }
    },
    []
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
    <Pressable
      onPress={onPress}
      onLongPress={openPreview}
      onPressOut={closePreview}
      delayLongPress={250}
      pressRetentionOffset={{ top: 300, bottom: 300, left: 300, right: 300 }}
    >
      {avatarContent}
    </Pressable>
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
});
