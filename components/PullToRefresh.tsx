// components/PullToRefresh.tsx
// ✅ FIX: Wrapped startRefresh/collapse calls in onFinalize with runOnJS (prevents UI thread crash)
// ✅ FIX: Removed redundant runOnJS inside JS-thread functions (reset/finish/startRefresh)

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import type { NativeScrollEvent, NativeSyntheticEvent } from 'react-native';
import Animated, {
  Easing,
  cancelAnimation,
  useAnimatedProps,
  useAnimatedStyle,
  useSharedValue,
  withRepeat,
  withSequence,
  withTiming,
  runOnJS,
} from 'react-native-reanimated';
import { Gesture } from 'react-native-gesture-handler';
import Svg, { Circle, Path } from 'react-native-svg';
import { COLORS, FONTS } from '../constants/theme';
import { hapticSelection, hapticSuccess } from '../lib/haptics';

export const PULL_THRESHOLD = 76;
const MAX_PULL = 130;
const MIN_SPIN_MS = 700;

const R = 16;
const C = 2 * Math.PI * R;
const CHECK_LEN = 25;

const AnimatedCircle = Animated.createAnimatedComponent(Circle);
const AnimatedPath = Animated.createAnimatedComponent(Path);

type Phase = 'idle' | 'pulling' | 'armed' | 'refreshing' | 'success';

export function usePullToRefresh(onRefresh: () => Promise<unknown> | void) {
  const pull = useSharedValue(0);
  const arc = useSharedValue(0);
  const rot = useSharedValue(0);
  const ok = useSharedValue(0);
  const chk = useSharedValue(CHECK_LEN);
  const bump = useSharedValue(0);

  const phase = useSharedValue<Phase>('idle');
  const scrollY = useSharedValue(0);
  const startY = useSharedValue(0);
  
  const [label, setLabel] = useState('Pull to refresh');

  const timers = useRef<ReturnType<typeof setTimeout>[]>([]);
  const refreshRef = useRef(onRefresh);
  refreshRef.current = onRefresh;

  const later = useCallback((fn: () => void, ms: number) => {
    timers.current.push(setTimeout(fn, ms));
  }, []);

  useEffect(() => {
    const list = timers.current;
    return () => list.forEach(clearTimeout);
  }, []);

  const reset = useCallback(() => {
    phase.value = 'idle';
    cancelAnimation(rot);
    cancelAnimation(arc);
    rot.value = 0;
    arc.value = 0;
    ok.value = 0;
    chk.value = CHECK_LEN;
    bump.value = 0;
    setLabel('Pull to refresh'); // ✅ Direct setLabel (we're on JS thread)
  }, [arc, bump, chk, ok, rot, phase]);

  const collapse = useCallback(() => {
    pull.value = withTiming(0, {
      duration: 320,
      easing: Easing.out(Easing.cubic),
    });
    later(reset, 340);
  }, [later, pull, reset]);

  const finish = useCallback(() => {
    if (phase.value !== 'refreshing') return;
    phase.value = 'success';
    cancelAnimation(rot);
    cancelAnimation(arc);
    ok.value = withTiming(1, { duration: 200 });
    chk.value = withTiming(0, {
      duration: 320,
      easing: Easing.out(Easing.cubic),
    });
    setLabel("You're up to date"); // ✅ Direct setLabel
    hapticSuccess(); // ✅ Direct haptic
    later(collapse, 950);
  }, [arc, chk, collapse, later, ok, rot, phase]);

  const startRefresh = useCallback(() => {
    phase.value = 'refreshing';
    setLabel('Refreshing…'); // ✅ Direct setLabel
    pull.value = withTiming(PULL_THRESHOLD, { duration: 200 });
    rot.value = 0;
    rot.value = withRepeat(
      withTiming(360, { duration: 900, easing: Easing.linear }),
      -1,
      false
    );
    arc.value = withRepeat(
      withSequence(
        withTiming(0.62, { duration: 700 }),
        withTiming(0.2, { duration: 700 })
      ),
      -1,
      false
    );

    const t0 = Date.now();
    Promise.resolve()
      .then(() => refreshRef.current())
      .catch(() => {})
      .then(() => {
        later(finish, Math.max(0, MIN_SPIN_MS - (Date.now() - t0)));
      });
  }, [arc, finish, later, pull, rot, phase]);

  const gesture = useMemo(() => {
    const native = Gesture.Native();
    const pan = Gesture.Pan()
      .manualActivation(true)
      .onTouchesDown((e) => {
        startY.value = e.allTouches[0]?.absoluteY ?? 0;
      })
      .onTouchesMove((e, mgr) => {
        const t = e.allTouches[0];
        if (!t) return;
        if (phase.value === 'refreshing' || phase.value === 'success') {
          mgr.fail();
          return;
        }
        if (scrollY.value > 1) {
          startY.value = t.absoluteY;
          return;
        }
        const dy = t.absoluteY - startY.value;
        if (dy > 8) mgr.activate();
        else if (dy < -8) mgr.fail();
      })
      .onUpdate((e) => {
        const dy = e.absoluteY - startY.value;
        const v = Math.max(0, Math.min(MAX_PULL, dy * 0.5));
        const armed = v >= PULL_THRESHOLD;

        if (armed && phase.value !== 'armed') {
          phase.value = 'armed';
          runOnJS(setLabel)('Release to refresh');
          runOnJS(hapticSelection)();
          bump.value = withSequence(
            withTiming(1, { duration: 90 }),
            withTiming(0, { duration: 160 })
          );
        } else if (!armed && phase.value !== 'pulling') {
          phase.value = 'pulling';
          runOnJS(setLabel)('Pull to refresh');
        }

        pull.value = v;
        arc.value = armed ? 1 : Math.min(1, v / PULL_THRESHOLD) * 0.8;
        rot.value = v * 3;
      })
      .onFinalize(() => {
        // ✅ FIX: Wrap JS functions with runOnJS from worklet
        if (phase.value === 'armed') {
          runOnJS(startRefresh)();
        } else if (phase.value === 'pulling') {
          phase.value = 'idle';
          runOnJS(collapse)();
        }
      });

    return Gesture.Simultaneous(pan, native);
  }, [arc, bump, collapse, pull, rot, phase, startRefresh, scrollY, startY]);

  const onScroll = useCallback((e: NativeSyntheticEvent<NativeScrollEvent>) => {
    scrollY.value = e.nativeEvent.contentOffset.y;
  }, [scrollY]);

  const scrollProps = useMemo(
    () => ({
      onScroll,
      scrollEventThrottle: 16,
      bounces: false,
      overScrollMode: 'never' as const,
    }),
    [onScroll]
  );

  const listStyle = useAnimatedStyle(() => ({
    transform: [{ translateY: pull.value }],
  }));

  return {
    gesture,
    scrollProps,
    listStyle,
    label,
    pull,
    arc,
    rot,
    ok,
    chk,
    bump,
  };
}

export type PullController = ReturnType<typeof usePullToRefresh>;

export function PullIndicator({ ctrl }: { ctrl: PullController }) {
  const { pull, arc, rot, ok, chk, bump, label } = ctrl;

  const wrapStyle = useAnimatedStyle(() => ({ height: pull.value }));

  const innerStyle = useAnimatedStyle(() => {
    const p = Math.min(1, pull.value / PULL_THRESHOLD);
    return {
      opacity: Math.min(1, pull.value / 36),
      transform: [{ scale: (0.55 + 0.45 * p) * (1 + 0.1 * bump.value) }],
    };
  });

  const ringStyle = useAnimatedStyle(() => ({
    opacity: 1 - ok.value,
    transform: [{ rotate: `${rot.value}deg` }],
  }));

  const okStyle = useAnimatedStyle(() => ({
    opacity: ok.value,
    transform: [{ scale: 0.8 + 0.2 * ok.value }],
  }));

  const arcProps = useAnimatedProps(() => ({
    strokeDashoffset: C * (1 - arc.value),
  }));

  const chkProps = useAnimatedProps(() => ({
    strokeDashoffset: chk.value,
  }));

  return (
    <Animated.View pointerEvents="none" style={[styles.wrap, wrapStyle]}>
      <Animated.View style={[styles.inner, innerStyle]}>
        <View style={styles.box}>
          <Animated.View style={[StyleSheet.absoluteFill, ringStyle]}>
            <Svg width={44} height={44} viewBox="0 0 44 44">
              <Circle cx={22} cy={22} r={R} fill="none" stroke="rgba(255,255,255,0.12)" strokeWidth={3} />
              <AnimatedCircle
                animatedProps={arcProps}
                cx={22} cy={22} r={R}
                fill="none" stroke={COLORS.violetLight} strokeWidth={3}
                strokeLinecap="round" strokeDasharray={C} rotation={-90} origin="22, 22"
              />
            </Svg>
          </Animated.View>
          <Animated.View style={[StyleSheet.absoluteFill, okStyle]}>
            <Svg width={44} height={44} viewBox="0 0 44 44">
              <Circle cx={22} cy={22} r={19} fill={COLORS.violet} />
              <AnimatedPath
                animatedProps={chkProps}
                d="M14 23 l6 6 l11 -12"
                fill="none" stroke="#FFFFFF" strokeWidth={3}
                strokeLinecap="round" strokeLinejoin="round" strokeDasharray={CHECK_LEN}
              />
            </Svg>
          </Animated.View>
        </View>
        <Text style={styles.label}>{label}</Text>
      </Animated.View>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  wrap: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    overflow: 'hidden',
    alignItems: 'center',
    justifyContent: 'center',
  },
  inner: { alignItems: 'center', gap: 6 },
  box: { width: 44, height: 44 },
  label: {
    height: 16,
    lineHeight: 16,
    fontSize: 12,
    color: COLORS.mist,
    fontFamily: FONTS.bodyMedium,
  },
});
