// components/AvatarPreviewHost.tsx
// Instagram-style DP peek overlay.
// Rendered in the SAME window as the screen (no Modal), so:
//   ✅ the finger-hold on the avatar is never interrupted (release = close)
//   ✅ the BlurView can really blur the screen behind it (esp. on Android)
// Avatar.tsx calls showAvatarPreview() / hideAvatarPreview(); this host draws it.
// Mount <AvatarPreviewHost /> ONCE per screen (as the last child) — or once in app/_layout.tsx.

import { useEffect, useMemo, useRef, useState } from 'react';
import { View, StyleSheet, Animated } from 'react-native';
import { Image } from 'expo-image';
import { BlurView } from 'expo-blur';
import { Ionicons } from '@expo/vector-icons';

export type AvatarPreviewData = {
  name: string;
  color: string;
  avatarUrl?: string | null;
};

type Listener = (data: AvatarPreviewData | null) => void;
const listeners = new Set<Listener>();

export function showAvatarPreview(data: AvatarPreviewData) {
  listeners.forEach((l) => l(data));
}

export function hideAvatarPreview() {
  listeners.forEach((l) => l(null));
}

export default function AvatarPreviewHost() {
  const [data, setData] = useState<AvatarPreviewData | null>(null);
  const [visible, setVisible] = useState(false);
  const anim = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    const listener: Listener = (d) => {
      anim.stopAnimation();
      if (d) {
        setData(d);
        setVisible(true);
        Animated.spring(anim, {
          toValue: 1,
          friction: 8,
          tension: 90,
          useNativeDriver: true,
        }).start();
      } else {
        Animated.timing(anim, {
          toValue: 0,
          duration: 140,
          useNativeDriver: true,
        }).start(({ finished }) => {
          if (finished) setVisible(false);
        });
      }
    };
    listeners.add(listener);
    return () => {
      listeners.delete(listener);
    };
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

  if (!visible || !data) return null;

  return (
    <View style={styles.overlay} pointerEvents="none">
      <Animated.View style={[StyleSheet.absoluteFill, { opacity: fade }]}>
        <BlurView
          intensity={80}
          tint="dark"
          experimentalBlurMethod="dimezisBlurView"
          style={StyleSheet.absoluteFill}
        />
        <View style={styles.dim} />
      </Animated.View>

      <View style={styles.center}>
        <Animated.View
          style={[styles.card, { opacity: fade, transform: [{ scale }] }]}
        >
          {data.avatarUrl ? (
            <Image
              source={{ uri: data.avatarUrl }}
              style={styles.image}
              contentFit="cover"
              cachePolicy="memory-disk"
              transition={120}
            />
          ) : (
            <View style={[styles.fallback, { backgroundColor: data.color }]}>
              <Ionicons
                name="person"
                size={150}
                color="rgba(255,255,255,0.95)"
              />
            </View>
          )}
        </Animated.View>

        {!!data.name && (
          <Animated.Text
            style={[styles.name, { opacity: fade }]}
            numberOfLines={1}
          >
            {data.name}
          </Animated.Text>
        )}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  overlay: {
    ...StyleSheet.absoluteFillObject,
    zIndex: 999,
    elevation: 999,
  },
  dim: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: 'rgba(0,0,0,0.45)',
  },
  center: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 24,
  },
  card: {
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
  image: { width: '100%', height: '100%' },
  fallback: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  name: {
    marginTop: 16,
    fontSize: 17,
    fontWeight: '600',
    color: '#FFFFFF',
  },
});
