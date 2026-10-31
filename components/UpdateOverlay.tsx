// components/UpdateOverlay.tsx
// Premium full-screen update screen:
// glow background, AIRALANCE wordmark, rotating-ring orb with download icon,
// glass card with gradient + shimmer progress bar and percentage.
// NOTE: expo-updates real byte-progress nahi deta, isliye percentage
// smooth simulated hai (download complete hote hi 100% ho jata hai).

import { useEffect, useRef, useState } from 'react';
import { Animated, Easing, StyleSheet, Text, View } from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { Ionicons } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import type { OTAStatus } from '../lib/useOTAUpdate';

const BG_COLORS = ['#0D0F1A', '#07080D', '#07080D'] as const;
const ORB_COLORS = ['#A78BFF', '#6C4DF5', '#3B7BFF'] as const;
const BAR_COLORS = ['#7C5CFF', '#4F8BFF'] as const;
const ACCENT = '#7C5CFF';

export default function UpdateOverlay({ status }: { status: OTAStatus }) {
  const insets = useSafeAreaInsets();
  const visible = status === 'downloading' || status === 'restarting';
  const done = status === 'restarting';
  const [pct, setPct] = useState(0);
  const [trackW, setTrackW] = useState(0);

  const bar = useRef(new Animated.Value(0)).current;
  const fade = useRef(new Animated.Value(0)).current;
  const rise = useRef(new Animated.Value(28)).current;
  const spin = useRef(new Animated.Value(0)).current;
  const pulse = useRef(new Animated.Value(0)).current;
  const breathe = useRef(new Animated.Value(0)).current;
  const arrow = useRef(new Animated.Value(0)).current;
  const shimmer = useRef(new Animated.Value(0)).current;
  const pop = useRef(new Animated.Value(0)).current;

  // Entrance + looping animations (only while visible)
  useEffect(() => {
    if (!visible) return;

    Animated.parallel([
      Animated.timing(fade, {
        toValue: 1,
        duration: 300,
        useNativeDriver: true,
      }),
      Animated.timing(rise, {
        toValue: 0,
        duration: 450,
        easing: Easing.out(Easing.cubic),
        useNativeDriver: true,
      }),
    ]).start();

    const loops = [
      Animated.loop(
        Animated.timing(spin, {
          toValue: 1,
          duration: 1800,
          easing: Easing.linear,
          useNativeDriver: true,
        })
      ),
      Animated.loop(
        Animated.timing(pulse, {
          toValue: 1,
          duration: 2200,
          easing: Easing.out(Easing.quad),
          useNativeDriver: true,
        })
      ),
      Animated.loop(
        Animated.sequence([
          Animated.timing(breathe, {
            toValue: 1,
            duration: 1400,
            easing: Easing.inOut(Easing.sin),
            useNativeDriver: true,
          }),
          Animated.timing(breathe, {
            toValue: 0,
            duration: 1400,
            easing: Easing.inOut(Easing.sin),
            useNativeDriver: true,
          }),
        ])
      ),
      Animated.loop(
        Animated.sequence([
          Animated.timing(arrow, {
            toValue: 1,
            duration: 650,
            easing: Easing.inOut(Easing.quad),
            useNativeDriver: true,
          }),
          Animated.timing(arrow, {
            toValue: 0,
            duration: 650,
            easing: Easing.inOut(Easing.quad),
            useNativeDriver: true,
          }),
        ])
      ),
      Animated.loop(
        Animated.sequence([
          Animated.timing(shimmer, {
            toValue: 1,
            duration: 1300,
            easing: Easing.inOut(Easing.quad),
            useNativeDriver: true,
          }),
          Animated.delay(350),
        ])
      ),
    ];

    spin.setValue(0);
    pulse.setValue(0);
    shimmer.setValue(0);
    loops.forEach((l) => l.start());
    return () => loops.forEach((l) => l.stop());
  }, [visible, fade, rise, spin, pulse, breathe, arrow, shimmer]);

  // Check icon pop on done
  useEffect(() => {
    if (!done) {
      pop.setValue(0);
      return;
    }
    Animated.spring(pop, {
      toValue: 1,
      friction: 5,
      tension: 140,
      useNativeDriver: true,
    }).start();
  }, [done, pop]);

  // Simulated progress while downloading
  useEffect(() => {
    if (status !== 'downloading') return;
    setPct(0);
    const id = setInterval(() => {
      setPct((p) => Math.min(92, p + Math.max(0.4, (92 - p) * 0.06)));
    }, 150);
    return () => clearInterval(id);
  }, [status]);

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

  const barWidth = bar.interpolate({
    inputRange: [0, 100],
    outputRange: ['0%', '100%'],
  });
  const spinDeg = spin.interpolate({
    inputRange: [0, 1],
    outputRange: ['0deg', '360deg'],
  });
  const spinBackDeg = spin.interpolate({
    inputRange: [0, 1],
    outputRange: ['360deg', '0deg'],
  });

  return (
    <Animated.View
      style={[styles.overlay, { opacity: fade }]}
      pointerEvents="auto"
    >
      <LinearGradient colors={BG_COLORS} style={StyleSheet.absoluteFill} />

      {/* soft glow blobs */}
      <View style={[styles.glow, styles.glowTop]} />
      <View style={[styles.glow, styles.glowBottom]} />

      <View
        style={[
          styles.content,
          {
            paddingTop: insets.top + 26,
            paddingBottom: insets.bottom + 22,
          },
        ]}
      >
        {/* Brand */}
        <View style={styles.brandWrap}>
          <Text style={styles.brand}>AIRALANCE</Text>
          <LinearGradient
            colors={BAR_COLORS}
            start={{ x: 0, y: 0 }}
            end={{ x: 1, y: 0 }}
            style={styles.brandLine}
          />
        </View>

        {/* Orb */}
        <View style={styles.stageWrap}>
          <View style={styles.stage}>
            <View style={styles.halo1} />
            <View style={styles.halo2} />

            <Animated.View
              style={[
                styles.pulseRing,
                {
                  opacity: pulse.interpolate({
                    inputRange: [0, 1],
                    outputRange: [0.5, 0],
                  }),
                  transform: [
                    {
                      scale: pulse.interpolate({
                        inputRange: [0, 1],
                        outputRange: [1, 2.1],
                      }),
                    },
                  ],
                },
              ]}
            />

            <Animated.View
              style={[
                styles.ringOuter,
                { transform: [{ rotate: spinBackDeg }] },
              ]}
            />
            <Animated.View
              style={[styles.ringInner, { transform: [{ rotate: spinDeg }] }]}
            />

            <Animated.View
              style={{
                transform: [
                  {
                    scale: breathe.interpolate({
                      inputRange: [0, 1],
                      outputRange: [1, 1.06],
                    }),
                  },
                ],
              }}
            >
              <LinearGradient
                colors={ORB_COLORS}
                start={{ x: 0.1, y: 0 }}
                end={{ x: 0.9, y: 1 }}
                style={styles.orb}
              >
                {done ? (
                  <Animated.View
                    style={{
                      transform: [
                        {
                          scale: pop.interpolate({
                            inputRange: [0, 1],
                            outputRange: [0.3, 1],
                          }),
                        },
                      ],
                    }}
                  >
                    <Ionicons name="checkmark" size={46} color="#FFFFFF" />
                  </Animated.View>
                ) : (
                  <Animated.View
                    style={{
                      opacity: arrow.interpolate({
                        inputRange: [0, 1],
                        outputRange: [0.75, 1],
                      }),
                      transform: [
                        {
                          translateY: arrow.interpolate({
                            inputRange: [0, 1],
                            outputRange: [-4, 5],
                          }),
                        },
                      ],
                    }}
                  >
                    <Ionicons name="arrow-down" size={42} color="#FFFFFF" />
                  </Animated.View>
                )}
              </LinearGradient>
            </Animated.View>
          </View>
        </View>

        {/* Glass card */}
        <Animated.View
          style={[styles.card, { transform: [{ translateY: rise }] }]}
        >
          <Text style={styles.title}>
            {done ? 'Update ready' : 'Updating Airalance'}
          </Text>
          <Text style={styles.subtitle}>
            {done
              ? 'Restarting app...'
              : 'Getting the latest features and fixes for you.'}
          </Text>

          <View
            style={styles.track}
            onLayout={(e) => setTrackW(e.nativeEvent.layout.width)}
          >
            <Animated.View style={[styles.fillWrap, { width: barWidth }]}>
              <LinearGradient
                colors={BAR_COLORS}
                start={{ x: 0, y: 0 }}
                end={{ x: 1, y: 0 }}
                style={StyleSheet.absoluteFill}
              />
              {trackW > 0 && (
                <Animated.View
                  style={[
                    styles.shimmer,
                    {
                      transform: [
                        {
                          translateX: shimmer.interpolate({
                            inputRange: [0, 1],
                            outputRange: [-70, trackW],
                          }),
                        },
                      ],
                    },
                  ]}
                >
                  <LinearGradient
                    colors={[
                      'rgba(255,255,255,0)',
                      'rgba(255,255,255,0.45)',
                      'rgba(255,255,255,0)',
                    ]}
                    start={{ x: 0, y: 0 }}
                    end={{ x: 1, y: 0 }}
                    style={StyleSheet.absoluteFill}
                  />
                </Animated.View>
              )}
            </Animated.View>
          </View>

          <View style={styles.row}>
            <Text style={styles.rowLabel}>
              {done ? 'Restarting' : 'Downloading'}
            </Text>
            <Text style={styles.percent}>{Math.round(pct)}%</Text>
          </View>
        </Animated.View>

        <Text style={styles.footer}>Keep the app open while it updates</Text>
      </View>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  overlay: {
    ...StyleSheet.absoluteFillObject,
    zIndex: 9999,
    elevation: 9999,
    backgroundColor: '#07080D',
    overflow: 'hidden',
  },
  content: {
    flex: 1,
    paddingHorizontal: 24,
  },

  glow: {
    position: 'absolute',
    borderRadius: 999,
    backgroundColor: ACCENT,
  },
  glowTop: {
    width: 360,
    height: 360,
    top: -140,
    right: -120,
    opacity: 0.1,
  },
  glowBottom: {
    width: 300,
    height: 300,
    bottom: -120,
    left: -110,
    backgroundColor: '#3B7BFF',
    opacity: 0.09,
  },

  brandWrap: { alignItems: 'center' },
  brand: {
    color: '#FFFFFF',
    fontSize: 20,
    fontWeight: '700',
    letterSpacing: 6,
    marginLeft: 6,
  },
  brandLine: {
    width: 36,
    height: 3,
    borderRadius: 2,
    marginTop: 10,
  },

  stageWrap: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  stage: {
    width: 260,
    height: 260,
    alignItems: 'center',
    justifyContent: 'center',
  },
  halo1: {
    position: 'absolute',
    width: 230,
    height: 230,
    borderRadius: 115,
    backgroundColor: ACCENT,
    opacity: 0.07,
  },
  halo2: {
    position: 'absolute',
    width: 180,
    height: 180,
    borderRadius: 90,
    backgroundColor: ACCENT,
    opacity: 0.09,
  },
  pulseRing: {
    position: 'absolute',
    width: 112,
    height: 112,
    borderRadius: 56,
    borderWidth: 2,
    borderColor: '#8C70FF',
  },
  ringOuter: {
    position: 'absolute',
    width: 170,
    height: 170,
    borderRadius: 85,
    borderWidth: 2,
    borderColor: 'rgba(79,139,255,0.12)',
    borderRightColor: '#4F8BFF',
  },
  ringInner: {
    position: 'absolute',
    width: 142,
    height: 142,
    borderRadius: 71,
    borderWidth: 3,
    borderColor: 'rgba(124,92,255,0.14)',
    borderTopColor: '#A78BFF',
  },
  orb: {
    width: 112,
    height: 112,
    borderRadius: 56,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.25)',
  },

  card: {
    backgroundColor: 'rgba(255,255,255,0.045)',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.09)',
    borderRadius: 24,
    paddingHorizontal: 22,
    paddingVertical: 22,
  },
  title: {
    color: '#FFFFFF',
    fontSize: 20,
    fontWeight: '700',
    textAlign: 'center',
  },
  subtitle: {
    color: '#9CA3AF',
    fontSize: 13.5,
    textAlign: 'center',
    marginTop: 6,
    marginBottom: 22,
  },
  track: {
    height: 10,
    borderRadius: 5,
    backgroundColor: 'rgba(255,255,255,0.08)',
    overflow: 'hidden',
  },
  fillWrap: {
    height: '100%',
    borderRadius: 5,
    overflow: 'hidden',
  },
  shimmer: {
    position: 'absolute',
    top: 0,
    bottom: 0,
    width: 70,
  },
  row: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'baseline',
    marginTop: 14,
  },
  rowLabel: { color: '#9CA3AF', fontSize: 13 },
  percent: { color: '#FFFFFF', fontSize: 22, fontWeight: '700' },

  footer: {
    color: '#6B7280',
    fontSize: 12,
    textAlign: 'center',
    marginTop: 18,
  },
});
