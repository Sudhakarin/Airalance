// components/Avatar.tsx
// Reusable avatar component with initials fallback + online indicator

import { View, Text, Image, StyleSheet } from 'react-native';
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

export default function Avatar({
  name,
  color,
  size = 40,
  avatarUrl,
  online = false,
}: AvatarProps) {
  const indicatorSize = Math.round(size * 0.3);

  return (
    <View style={{ width: size, height: size }}>
      {avatarUrl ? (
        <Image
          source={{ uri: avatarUrl }}
          style={{
            width: size,
            height: size,
            borderRadius: size / 2,
          }}
          resizeMode="cover"
        />
      ) : (
        <View
          style={[
            styles.fallback,
            {
              width: size,
              height: size,
              borderRadius: size / 2,
              backgroundColor: color,
            },
          ]}
        >
          <Text
            style={[
              styles.initials,
              { fontSize: Math.max(10, size * 0.32) },
            ]}
          >
            {getInitials(name)}
          </Text>
        </View>
      )}

      {online && (
        <View
          style={[
            styles.onlineDot,
            {
              width: indicatorSize,
              height: indicatorSize,
              borderRadius: indicatorSize / 2,
            },
          ]}
        />
      )}
    </View>
  );
}

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
