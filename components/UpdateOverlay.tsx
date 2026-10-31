// components/UpdateOverlay.tsx
// Full-screen update screen: Airalance wordmark on top, ripple + typing-dots
// animation in the middle, progress bar + percentage below.
// NOTE: expo-updates real byte-progress nahi deta, isliye percentage
// smooth simulated hai (download complete hote hi 100% ho jata hai).

import { useEffect, useRef, useState } from 'react';
import { Animated, Easing, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import type { OTAStatus } from '../lib/useOTAUpdate';

const ACCENT = '#7C5CFF';
const BG = '#0A0C12';

export default function UpdateOverlay({ status }: { status: OTAStatus }) {
  const insets = useSafeAreaInsets();
  const visible = status === 'downloading' || status === 'restarting';
  const [pct, setPct] = useState(0);

  const bar = useRef(new Animated.Value(0)).current;
  const rings = useRef([0, 1, 2].map(() => new Animated.Value(0))).current;
  const dots = useRef([0, 1, 2].map(() => new Animated.Value(0))).current;
  const fade = useRef(new Animated.Value(0)).current;

  // Fade in + start looping animations only while visible
  useEffect(() => {
    if (!visible) return;

    Animated.timing(fade, {
      toValue: 1,
      duration: 250,
      useNativeDriver: true,
    }).start();

    const anims: Animated.CompositeAnimation[] = [];

    rings.forEach((v, i) => {
      v.setValue(0);
      const a = Animated.sequence([
        Animated.delay(i * 800),
        Animated.loop(
          Animated.timing(v, {
            toValue: 1,
            duration: 2400,
            easing: Easing.out(Easing.quad),
            useNativeDriver: true,
          })
        ),
      ]);
      anims.push(a);
      a.start();
    });

    dots.forEach((v, i) => {
      v.setValue(0);
      const a = Animated.sequence([
        Animated.delay(i * 160),
        Animated.loop(
          Animated.sequence([
            Animated.timing(v, {
              toValue: 1,
              duration: 320,
              easing: Easing.out(Easing.quad),
              useNativeDriver: true,
            }),
            Animated.timing(v, {
              toValue: 0,
              duration: 320,
              easing: Easing.in(Easing.quad),
              useNativeDriver: true,
            }),
            Animated.delay(480),
          ])
        ),
      ]);
      anims.push(a);
      a.start();
    });

    return () => anims.forEach((a) => a.stop());
  }, [visible, rings, dots, fade]);

  // Simulated progress while downloading
  useEffect(() => {
    if (status !== 'downloading') return;
    setPct(0);
    const id = setInterval(() => {
      setPct((p) => Math.min(92, p + Math.max(0.4, (92 - p) * 0.06)));
    }, 150);
    return () => clearInterval(id);
  }, [status]);

  // Jump to 100 on restart
  useEffect(() => {
    if (status === 'restarting') setPct(100);
  }, [status]);

  // Smooth bar animation
  useEffect(() => {
    Animated.timing(bar, {
      toValue: pct,
      duration: 250,
      easing: Easing.out(Easing.quad),
      useNativeDriver: false,
    }).start();
  }, [pct, bar]);

  if (!visible) return null;

  const width = bar.interpolate({
    inputRange: [0, 100],
    outputRange: ['0%', '100%'],
  });

  return (
    <Animated.View
      style={[styles.overlay, { opacity: fade }]}
      pointerEvents="auto"
    >
      <Text style={[styles.brand, { top: insets.top + 28 }]}>Airalance</Text>

      <View style={styles.center}>
        <View style={styles.stage}>
          {rings.map((v, i) => (
            <Animated.View
              key={i}
              style={[
                styles.ring,
                {
                  opacity: v.interpolate({
                    inputRange: [0, 1],
                    outputRange: [0.55, 0],
                  }),
                  transform: [
                    {
                      scale: v.interpolate({
                        inputRange: [0, 1],
                        outputRange: [1, 2.5],
                      }),
                    },
                  ],
                },
              ]}
            />
          ))}
          <View style={styles.core}>
            {dots.map((v, i) => (
              <Animated.View
                key={i}
                style={[
                  styles.dot,
                  {
                    opacity: v.interpolate({
                      inputRange: [0, 1],
                      outputRange: [0.55, 1],
                    }),
                    transform: [
                      {
                        translateY: v.interpolate({
                          inputRange: [0, 1],
                          outputRange: [0, -9],
                        }),
                      },
                    ],
                  },
                ]}
              />
            ))}
          </View>
        </View>

        <Text style={styles.title}>
          {status === 'restarting' ? 'Update ready' : 'Updating Airalance'}
        </Text>
        <Text style={styles.subtitle}>
          {status === 'restarting'
            ? 'Restarting app...'
            : 'Downloading the latest version. Please wait.'}
        </Text>

        <View style={styles.track}>
          <Animated.View style={[styles.fill, { width }]} />
        </View>
        <Text style={styles.percent}>{Math.round(pct)}%</Text>
      </View>

      <Text style={[styles.footer, { bottom: insets.bottom + 28 }]}>
        Keep the app open while it updates
      </Text>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  overlay: {
    ...StyleSheet.absoluteFillObject,
    zIndex: 9999,
    elevation: 9999,
    backgroundColor: BG,
  },
  brand: {
    position: 'absolute',
    left: 0,
    right: 0,
    textAlign: 'center',
    color: '#FFFFFF',
    fontSize: 26,
    fontWeight: '700',
    letterSpacing: 1.5,
  },
  center: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 32,
  },
  stage: {
    width: 240,
    height: 240,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 24,
  },
  ring: {
    position: 'absolute',
    width: 96,
    height: 96,
    borderRadius: 48,
    borderWidth: 2,
    borderColor: ACCENT,
  },
  core: {
    width: 96,
    height: 96,
    borderRadius: 48,
    backgroundColor: ACCENT,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 7,
  },
  dot: {
    width: 11,
    height: 11,
    borderRadius: 6,
    backgroundColor: '#FFFFFF',
  },
  title: {
    color: '#FFFFFF',
    fontSize: 22,
    fontWeight: '700',
    marginBottom: 8,
  },
  subtitle: {
    color: '#9CA3AF',
    fontSize: 14,
    textAlign: 'center',
    marginBottom: 32,
  },
  track: {
    width: '100%',
    maxWidth: 320,
    height: 8,
    borderRadius: 4,
    backgroundColor: '#1B1F2B',
    overflow: 'hidden',
  },
  fill: {
    height: '100%',
    borderRadius: 4,
    backgroundColor: ACCENT,
  },
  percent: {
    color: '#FFFFFF',
    fontSize: 16,
    fontWeight: '600',
    marginTop: 14,
  },
  footer: {
    position: 'absolute',
    left: 0,
    right: 0,
    textAlign: 'center',
    color: '#6B7280',
    fontSize: 12,
  },
});
