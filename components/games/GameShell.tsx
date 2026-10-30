// components/games/GameShell.tsx
// Shared chrome for every game: header, toast, result popup, buttons.

import { ReactNode, useCallback, useEffect, useRef, useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  Animated,
  Modal,
  Easing,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { LinearGradient } from 'expo-linear-gradient';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { COLORS, FONTS, RADII, GRADIENTS } from '../../constants/theme';
import { isMuted, setMuted, play } from '../../lib/games/sfx';

export const G = {
  bg: '#000000',
  card: '#121212',
  line: '#1F1F23',
  line2: '#2A2A31',
};

/* ---------------- Header ---------------- */
export function GameHeader({
  title,
  onBack,
  onRestart,
}: {
  title: string;
  onBack: () => void;
  onRestart?: () => void;
}) {
  const [muted, setM] = useState(isMuted());
  return (
    <View style={s.head}>
      <TouchableOpacity style={s.ibtn} onPress={onBack} activeOpacity={0.7}>
        <Ionicons name="chevron-back" size={20} color="#fff" />
      </TouchableOpacity>
      <Text style={s.title}>{title}</Text>
      <TouchableOpacity
        style={s.ibtn}
        activeOpacity={0.7}
        onPress={() => {
          const next = !muted;
          setMuted(next);
          setM(next);
          if (!next) play('tap');
        }}
      >
        <Ionicons
          name={muted ? 'volume-mute' : 'volume-high'}
          size={19}
          color="#fff"
        />
      </TouchableOpacity>
      {onRestart && (
        <TouchableOpacity
          style={s.ibtn}
          activeOpacity={0.7}
          onPress={() => {
            play('tap');
            onRestart();
          }}
        >
          <Ionicons name="refresh" size={19} color="#fff" />
        </TouchableOpacity>
      )}
    </View>
  );
}

/* ---------------- Buttons ---------------- */
export function PrimaryButton({
  label,
  onPress,
  icon,
}: {
  label: string;
  onPress: () => void;
  icon?: keyof typeof Ionicons.glyphMap;
}) {
  return (
    <TouchableOpacity activeOpacity={0.85} onPress={onPress} style={s.btnWrap}>
      <LinearGradient
        colors={GRADIENTS.violet}
        start={{ x: 0, y: 0 }}
        end={{ x: 1, y: 1 }}
        style={s.btn}
      >
        {icon && <Ionicons name={icon} size={18} color="#fff" />}
        <Text style={s.btnText}>{label}</Text>
      </LinearGradient>
    </TouchableOpacity>
  );
}

export function GhostButton({
  label,
  onPress,
  icon,
}: {
  label: string;
  onPress: () => void;
  icon?: keyof typeof Ionicons.glyphMap;
}) {
  return (
    <TouchableOpacity
      activeOpacity={0.8}
      onPress={onPress}
      style={[s.btn, s.ghost]}
    >
      {icon && <Ionicons name={icon} size={18} color="#fff" />}
      <Text style={s.btnText}>{label}</Text>
    </TouchableOpacity>
  );
}

/* ---------------- Toast ---------------- */
export function useToast() {
  const [msg, setMsg] = useState('');
  const op = useRef(new Animated.Value(0)).current;
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const show = useCallback(
    (m: string, ms = 1600) => {
      setMsg(m);
      Animated.timing(op, {
        toValue: 1,
        duration: 160,
        useNativeDriver: true,
      }).start();
      if (timer.current) clearTimeout(timer.current);
      timer.current = setTimeout(() => {
        Animated.timing(op, {
          toValue: 0,
          duration: 220,
          useNativeDriver: true,
        }).start();
      }, ms);
    },
    [op]
  );
  useEffect(
    () => () => {
      if (timer.current) clearTimeout(timer.current);
    },
    []
  );
  const node = (
    <Animated.View pointerEvents="none" style={[s.toast, { opacity: op }]}>
      <Text style={s.toastText} numberOfLines={1}>
        {msg}
      </Text>
    </Animated.View>
  );
  return { toast: show, toastNode: node };
}

/* ---------------- Result popup ---------------- */
export function ResultModal({
  visible,
  win,
  title,
  sub,
  primary,
  onPrimary,
  secondary,
  onSecondary,
}: {
  visible: boolean;
  win: boolean;
  title: string;
  sub?: string;
  primary: string;
  onPrimary: () => void;
  secondary?: string;
  onSecondary?: () => void;
}) {
  const sc = useRef(new Animated.Value(0.85)).current;
  useEffect(() => {
    if (visible) {
      sc.setValue(0.85);
      Animated.spring(sc, {
        toValue: 1,
        friction: 6,
        useNativeDriver: true,
      }).start();
    }
  }, [visible, sc]);
  return (
    <Modal visible={visible} transparent animationType="fade" statusBarTranslucent>
      <View style={s.overlay}>
        {win && <Confetti />}
        <Animated.View style={[s.rcard, { transform: [{ scale: sc }] }]}>
          <LinearGradient
            colors={GRADIENTS.violet}
            start={{ x: 0, y: 0 }}
            end={{ x: 1, y: 1 }}
            style={s.ric}
          >
            <Ionicons name={win ? 'trophy' : 'close'} size={30} color="#fff" />
          </LinearGradient>
          <Text style={s.rtitle}>{title}</Text>
          {!!sub && <Text style={s.rsub}>{sub}</Text>}
          <PrimaryButton label={primary} onPress={onPrimary} />
          {secondary && onSecondary && (
            <GhostButton label={secondary} onPress={onSecondary} />
          )}
        </Animated.View>
      </View>
    </Modal>
  );
}

/* ---------------- Confetti (Animated, no extra deps) ---------------- */
const CONF = ['#A855F7', '#7C3AED', '#F0454F', '#2FBF71', '#F5B83D', '#3B82F6', '#FFFFFF'];
function Confetti() {
  const pieces = useRef(
    Array.from({ length: 36 }, (_, i) => ({
      x: Math.random(),
      delay: Math.random() * 500,
      dur: 1800 + Math.random() * 1400,
      size: 7 + Math.random() * 7,
      rot: Math.random() * 360,
      c: CONF[i % CONF.length],
      v: new Animated.Value(0),
    }))
  ).current;
  useEffect(() => {
    pieces.forEach((p) =>
      Animated.timing(p.v, {
        toValue: 1,
        duration: p.dur,
        delay: p.delay,
        easing: Easing.in(Easing.quad),
        useNativeDriver: true,
      }).start()
    );
  }, [pieces]);
  return (
    <View pointerEvents="none" style={StyleSheet.absoluteFill}>
      {pieces.map((p, i) => (
        <Animated.View
          key={i}
          style={{
            position: 'absolute',
            left: `${p.x * 100}%`,
            top: -20,
            width: p.size,
            height: p.size * 0.5,
            backgroundColor: p.c,
            transform: [
              { translateY: p.v.interpolate({ inputRange: [0, 1], outputRange: [0, 900] }) },
              { rotate: p.v.interpolate({ inputRange: [0, 1], outputRange: [`${p.rot}deg`, `${p.rot + 540}deg`] }) },
            ],
            opacity: p.v.interpolate({ inputRange: [0, 0.8, 1], outputRange: [1, 1, 0] }),
          }}
        />
      ))}
    </View>
  );
}

/* ---------------- Screen wrapper ---------------- */
export function GameScreen({ children }: { children: ReactNode }) {
  const insets = useSafeAreaInsets();
  return (
    <View style={[s.screen, { paddingTop: insets.top, paddingBottom: insets.bottom }]}>
      {children}
    </View>
  );
}

const s = StyleSheet.create({
  screen: { flex: 1, backgroundColor: G.bg },
  head: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingHorizontal: 14,
    paddingTop: 8,
    paddingBottom: 8,
  },
  title: {
    flex: 1,
    fontSize: 18,
    fontFamily: FONTS.displayBold,
    color: '#FFFFFF',
    letterSpacing: -0.2,
  },
  ibtn: {
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: 'rgba(255,255,255,0.06)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  btnWrap: { borderRadius: RADII.full, overflow: 'hidden' },
  btn: {
    height: 50,
    borderRadius: RADII.full,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
  },
  ghost: {
    backgroundColor: G.card,
    borderWidth: 1,
    borderColor: G.line2,
  },
  btnText: {
    color: '#FFFFFF',
    fontSize: 15,
    fontFamily: FONTS.bodySemiBold,
    letterSpacing: 0.2,
  },
  toast: {
    position: 'absolute',
    alignSelf: 'center',
    bottom: 40,
    maxWidth: '90%',
    backgroundColor: 'rgba(30,30,38,0.97)',
    borderWidth: 1,
    borderColor: G.line2,
    paddingHorizontal: 15,
    paddingVertical: 9,
    borderRadius: 999,
  },
  toastText: { color: '#fff', fontSize: 12.5, fontFamily: FONTS.body },
  overlay: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.78)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  rcard: {
    width: '82%',
    maxWidth: 320,
    backgroundColor: G.card,
    borderWidth: 1,
    borderColor: G.line2,
    borderRadius: 26,
    padding: 24,
    gap: 10,
    alignItems: 'stretch',
  },
  ric: {
    width: 64,
    height: 64,
    borderRadius: 32,
    alignItems: 'center',
    justifyContent: 'center',
    alignSelf: 'center',
    marginBottom: 4,
  },
  rtitle: {
    textAlign: 'center',
    fontSize: 24,
    fontFamily: FONTS.displayBold,
    color: '#fff',
  },
  rsub: {
    textAlign: 'center',
    fontSize: 13.5,
    lineHeight: 20,
    color: COLORS.mistLight,
    fontFamily: FONTS.body,
    marginBottom: 6,
  },
});
