// app/(auth)/welcome.tsx
// Landing / Welcome screen — shown before login/signup

import { useEffect, useRef } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  ScrollView,
  Animated,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { LinearGradient } from 'expo-linear-gradient';
import { BlurView } from 'expo-blur';
import { COLORS, FONTS } from '../../constants/theme';

export default function WelcomeScreen() {
  const router = useRouter();

  const ring1 = useRef(new Animated.Value(0)).current;
  const ring2 = useRef(new Animated.Value(0)).current;
  const ring3 = useRef(new Animated.Value(0)).current;
  const floatY = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    const animations: Animated.CompositeAnimation[] = [];

    const startRing = (val: Animated.Value, delay: number) => {
      const anim = Animated.loop(
        Animated.timing(val, {
          toValue: 1,
          duration: 2800,
          useNativeDriver: true,
        })
      );
      const t = setTimeout(() => anim.start(), delay);
      animations.push(anim);
      return t;
    };

    const t1 = startRing(ring1, 0);
    const t2 = startRing(ring2, 700);
    const t3 = startRing(ring3, 1400);

    const floatLoop = Animated.loop(
      Animated.sequence([
        Animated.timing(floatY, {
          toValue: -8,
          duration: 2400,
          useNativeDriver: true,
        }),
        Animated.timing(floatY, {
          toValue: 0,
          duration: 2400,
          useNativeDriver: true,
        }),
      ])
    );
    floatLoop.start();

    return () => {
      clearTimeout(t1);
      clearTimeout(t2);
      clearTimeout(t3);
      animations.forEach((a) => a.stop());
      floatLoop.stop();
    };
  }, [ring1, ring2, ring3, floatY]);

  const ringStyle = (val: Animated.Value) => ({
    opacity: val.interpolate({
      inputRange: [0, 0.5, 1],
      outputRange: [0.55, 0.2, 0],
    }),
    transform: [
      {
        scale: val.interpolate({
          inputRange: [0, 1],
          outputRange: [0.6, 1.4],
        }),
      },
    ],
  });

  return (
    <View style={styles.safe}>
      {/* Aurora background */}
      <View style={StyleSheet.absoluteFill} pointerEvents="none">
        <LinearGradient
          colors={['#0A0C12', '#0D1020', '#0A0C12']}
          start={{ x: 0, y: 0 }}
          end={{ x: 1, y: 1 }}
          style={StyleSheet.absoluteFill}
        />
        <View style={styles.glowTop} />
        <View style={styles.glowBottom} />
      </View>

      <SafeAreaView style={styles.safeInner} edges={['top', 'bottom']}>
        <ScrollView
          contentContainerStyle={styles.scroll}
          showsVerticalScrollIndicator={false}
        >
          {/* Nav */}
          <View style={styles.nav}>
            <Text style={styles.navBrand}>Airalance!</Text>
            <View style={styles.navActions}>
              <TouchableOpacity
                onPress={() => router.push('/(auth)/login')}
                activeOpacity={0.7}
                style={styles.navBtnGhost}
              >
                <Text style={styles.navBtnGhostText}>Log in</Text>
              </TouchableOpacity>
              <TouchableOpacity
                onPress={() => router.push('/(auth)/signup')}
                activeOpacity={0.85}
                style={styles.navBtnWhite}
              >
                <Text style={styles.navBtnWhiteText}>Get started</Text>
              </TouchableOpacity>
            </View>
          </View>

          {/* Hero */}
          <View style={styles.hero}>
            <View style={styles.badge}>
              <Ionicons
                name="shield-checkmark"
                size={13}
                color={COLORS.teal}
              />
              <Text style={styles.badgeText}>
                End-to-end encrypted · Real-time
              </Text>
            </View>

            <Text style={styles.title}>Where Privacy</Text>
            <Text style={[styles.title, styles.titleAccent]}>Matters!</Text>

            <Text style={styles.subtitle}>
              Airalance is a calm, quietly premium space to talk. No clutter,
              no noise — just fast, real-time messages wrapped in a design
              that gets out of your way.
            </Text>

            <View style={styles.ctaRow}>
              {/* ✅ Shadow wrapper (no clip) + violet bg kills AA gap */}
              <View style={styles.ctaPrimaryShadowWrap}>
                <TouchableOpacity
                  onPress={() => router.push('/(auth)/signup')}
                  activeOpacity={0.9}
                  style={styles.ctaPrimaryWrap}
                >
                  <LinearGradient
                    colors={['#7C5CFF', '#9C82FF']}
                    start={{ x: 0, y: 0 }}
                    end={{ x: 1, y: 1 }}
                    style={styles.ctaPrimary}
                  >
                    <Text style={styles.ctaPrimaryText}>
                      Create your account
                    </Text>
                  </LinearGradient>
                </TouchableOpacity>
              </View>

              <TouchableOpacity
                onPress={() => router.push('/(auth)/login')}
                activeOpacity={0.85}
                style={styles.ctaSecondary}
              >
                <Text style={styles.ctaSecondaryText}>
                  I already have one
                </Text>
              </TouchableOpacity>
            </View>
          </View>

          {/* Feature cards */}
          <View style={styles.features}>
            <FeatureCard
              icon="shield-checkmark-outline"
              title="Private by design"
              desc="Your messages, your database, your rules."
            />
            <FeatureCard
              icon="flash-outline"
              title="Real-time, always"
              desc="Messages land instantly, no delays."
            />
            <FeatureCard
              icon="chatbubble-ellipses-outline"
              title="Made to feel calm"
              desc="A quiet, distraction-free space to talk."
            />
          </View>

          {/* Animated badge */}
          <View style={styles.badgeSection}>
            <View style={styles.ringsContainer}>
              <Animated.View
                style={[styles.ring, styles.ringViolet, ringStyle(ring1)]}
              />
              <Animated.View
                style={[styles.ring, styles.ringTeal, ringStyle(ring2)]}
              />
              <Animated.View
                style={[styles.ring, styles.ringVioletSoft, ringStyle(ring3)]}
              />
              <Animated.View
                style={[
                  styles.iconBoxWrap,
                  { transform: [{ translateY: floatY }] },
                ]}
              >
                <BlurView
                  intensity={60}
                  tint="dark"
                  experimentalBlurMethod="dimezisBlurView"
                  style={styles.iconBox}
                >
                  <Ionicons
                    name="chatbubble-ellipses"
                    size={36}
                    color={COLORS.violetLight}
                  />
                </BlurView>
              </Animated.View>
            </View>
          </View>

          {/* Footer */}
          <Text style={styles.footer}>
            Copyright © 2026 by AiraThink! · All rights reserved.
          </Text>
        </ScrollView>
      </SafeAreaView>
    </View>
  );
}

function FeatureCard({
  icon,
  title,
  desc,
}: {
  icon: any;
  title: string;
  desc: string;
}) {
  return (
    <View style={styles.featureCard}>
      <View style={styles.featureIcon}>
        <Ionicons name={icon} size={20} color={COLORS.violetLight} />
      </View>
      <View style={{ flex: 1 }}>
        <Text style={styles.featureTitle}>{title}</Text>
        <Text style={styles.featureDesc}>{desc}</Text>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: '#0A0C12' },
  safeInner: { flex: 1 },

  glowTop: {
    position: 'absolute',
    top: -200,
    left: '50%',
    marginLeft: -200,
    width: 400,
    height: 400,
    borderRadius: 200,
    backgroundColor: 'rgba(124,92,255,0.18)',
  },
  glowBottom: {
    position: 'absolute',
    bottom: -140,
    right: -140,
    width: 320,
    height: 320,
    borderRadius: 160,
    backgroundColor: 'rgba(34,211,184,0.10)',
  },

  scroll: {
    paddingHorizontal: 20,
    paddingBottom: 32,
  },

  // ---------- Nav ----------
  nav: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: 8,
    marginBottom: 8,
  },
  navBrand: {
    fontSize: 22,
    fontFamily: FONTS.displayBold,
    color: '#FFFFFF',
    letterSpacing: -0.5,
  },
  navActions: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  navBtnGhost: {
    paddingHorizontal: 12,
    paddingVertical: 8,
  },
  navBtnGhostText: {
    fontSize: 14,
    fontFamily: FONTS.bodyMedium,
    color: 'rgba(255,255,255,0.75)',
  },
  navBtnWhite: {
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderRadius: 999,
    backgroundColor: '#FFFFFF',
  },
  navBtnWhiteText: {
    fontSize: 13,
    fontFamily: FONTS.bodySemiBold,
    color: '#0A0C12',
  },

  // ---------- Hero ----------
  hero: {
    alignItems: 'center',
    marginTop: 28,
  },
  badge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: 14,
    paddingVertical: 7,
    borderRadius: 999,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.10)',
    backgroundColor: 'rgba(255,255,255,0.04)',
    marginBottom: 22,
  },
  badgeText: {
    fontSize: 11.5,
    fontFamily: FONTS.bodyMedium,
    color: 'rgba(255,255,255,0.75)',
    letterSpacing: 0.2,
  },
  title: {
    fontSize: 42,
    fontFamily: FONTS.displayBold,
    color: '#FFFFFF',
    textAlign: 'center',
    lineHeight: 46,
    letterSpacing: -1,
  },
  titleAccent: {
    color: '#B8A6FF',
    textShadowColor: 'rgba(124,92,255,0.55)',
    textShadowOffset: { width: 0, height: 0 },
    textShadowRadius: 18,
  },
  subtitle: {
    fontSize: 14.5,
    fontFamily: FONTS.body,
    color: COLORS.mist,
    textAlign: 'center',
    lineHeight: 21,
    marginTop: 16,
    maxWidth: 340,
  },
  ctaRow: {
    flexDirection: 'row',
    gap: 10,
    marginTop: 26,
    width: '100%',
  },
  // ✅ Shadow wrapper (no clip) + violet bg kills AA gap
  ctaPrimaryShadowWrap: {
    flex: 1.15,
    borderRadius: 999,
    backgroundColor: '#7C5CFF',
    shadowColor: '#7C5CFF',
    shadowOffset: { width: 0, height: 6 },
    shadowOpacity: 0.35,
    shadowRadius: 14,
    elevation: 6,
  },
  // ✅ Inner wrap for pill clip
  ctaPrimaryWrap: {
    borderRadius: 999,
    overflow: 'hidden',
  },
  ctaPrimary: {
    paddingVertical: 12,
    alignItems: 'center',
    justifyContent: 'center',
  },
  ctaPrimaryText: {
    color: '#FFFFFF',
    fontSize: 13.5,
    fontFamily: FONTS.bodySemiBold,
  },
  ctaSecondary: {
    flex: 1,
    paddingVertical: 12,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: 999,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.12)',
    backgroundColor: 'rgba(255,255,255,0.04)',
  },
  ctaSecondaryText: {
    color: '#FFFFFF',
    fontSize: 13.5,
    fontFamily: FONTS.bodySemiBold,
  },

  // ---------- Features ----------
  features: {
    marginTop: 34,
    gap: 10,
  },
  featureCard: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 12,
    padding: 14,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.06)',
    backgroundColor: 'rgba(255,255,255,0.03)',
  },
  featureIcon: {
    width: 38,
    height: 38,
    borderRadius: 12,
    backgroundColor: 'rgba(124,92,255,0.15)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  featureTitle: {
    fontSize: 14,
    fontFamily: FONTS.bodySemiBold,
    color: '#FFFFFF',
    marginBottom: 3,
  },
  featureDesc: {
    fontSize: 12.5,
    fontFamily: FONTS.body,
    color: COLORS.mist,
    lineHeight: 17,
  },

  // ---------- Animated badge ----------
  badgeSection: {
    alignItems: 'center',
    marginTop: 40,
  },
  ringsContainer: {
    width: 220,
    height: 220,
    alignItems: 'center',
    justifyContent: 'center',
  },
  ring: {
    position: 'absolute',
    width: 200,
    height: 200,
    borderRadius: 100,
    borderWidth: 1,
  },
  ringViolet: {
    borderColor: 'rgba(124,92,255,0.55)',
  },
  ringTeal: {
    borderColor: 'rgba(34,211,184,0.45)',
  },
  ringVioletSoft: {
    borderColor: 'rgba(124,92,255,0.35)',
  },
  iconBoxWrap: {
    width: 96,
    height: 96,
    borderRadius: 24,
    shadowColor: '#7C5CFF',
    shadowOffset: { width: 0, height: 12 },
    shadowOpacity: 0.5,
    shadowRadius: 24,
    elevation: 12,
  },
  iconBox: {
    width: 96,
    height: 96,
    borderRadius: 24,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(124,92,255,0.10)',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.12)',
    overflow: 'hidden',
  },

  // ---------- Footer ----------
  footer: {
    textAlign: 'center',
    fontSize: 11,
    fontFamily: FONTS.body,
    color: 'rgba(139,143,163,0.6)',
    marginTop: 32,
    letterSpacing: 0.2,
  },
});
