// components/Avatar.tsx
// Optimized: memoized, expo-image with cache, memoized computed styles
// Fallback: WhatsApp-style person silhouette icon (no initials)

import { memo, useMemo } from 'react';
import { View, StyleSheet } from 'react-native';
import { Image } from 'expo-image';
import { Ionicons } from '@expo/vector-icons';

type AvatarProps = {
  name: string;
  color: string;
  size?: number;
  avatarUrl?: string | null;
  online?: boolean;
};

function AvatarBase({
  name,
  color,
  size = 40,
  avatarUrl,
  online = false,
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

  return (
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
}

// Only re-render if name / url / size / color / online actually changed
function areEqual(prev: AvatarProps, next: AvatarProps) {
  return (
    prev.name === next.name &&
    prev.color === next.color &&
    prev.size === next.size &&
    prev.avatarUrl === next.avatarUrl &&
    prev.online === next.online
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
