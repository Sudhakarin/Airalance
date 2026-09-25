// components/Avatar.tsx
// Optimized: memoized, expo-image with cache, memoized computed styles

import { memo, useMemo } from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { Image } from 'expo-image';
import { FONTS } from '../constants/theme';

type AvatarProps = {
  name: string;
  color: string;
  size?: number;
  avatarUrl?: string | null;
  online?: boolean;
};

function getInitials(name: string): string {
  if (!name) return '?';
  const parts = name.trim().split(' ');
  if (parts.length === 1) {
    return parts[0].slice(0, 2).toUpperCase();
  }
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
}

function AvatarBase({
  name,
  color,
  size = 40,
  avatarUrl,
  online = false,
}: AvatarProps) {
  // Memoize initials — only recompute if name changes
  const initials = useMemo(() => getInitials(name), [name]);

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

  // Memoize initials text style
  const initialsStyle = useMemo(
    () => ({ fontSize: Math.max(10, size * 0.32) }),
    [size]
  );

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
          <Text style={[styles.initials, initialsStyle]}>{initials}</Text>
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
  },
  initials: {
    color: '#FFFFFF',
    fontFamily: FONTS.displayBold,
    letterSpacing: 0.5,
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
