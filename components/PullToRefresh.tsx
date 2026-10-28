// components/PullToRefresh.tsx
// Custom pull-to-refresh (replaces the default Android RefreshControl loader)

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
} from 'react-native-reanimated';
import { Gesture } from 'react-native-gesture-handler';
import Svg, { Circle, Path } from 'react-native-svg';
import { COLORS, FONTS } from '../constants/theme';
import { hapticSelection, hapticSuccess } from '../lib/haptics';

export const PULL_THRESHOLD = 76; // px of pull needed to trigger refresh
const MAX_PULL = 130; // max visual pull
const MIN_SPIN_MS = 700; // spinner stays at least this long (no flicker on fast loads)

const R = 16;
const C = 2 * Math.PI * R; // ring circumference
const CHECK_LEN = 25; // length of the check-mark path

const AnimatedCircle = Animated.createAnimatedComponent(Circle);
const AnimatedPath = Animated.createAnimatedComponent(Path);

type Phase = 'idle' | 'pulling' | 'armed' | 'refreshing' | 'success';

export function usePullToRefresh(onRefresh: () => Promise<unknown> | void) {
  const pull = useSharedValue(0);
  const arc = useSharedValue(0); // 0..1 ring fill
  const rot = useSharedValue(0); // degrees
  const ok = useSharedValue(0); // success state 0..1
  const chk = useSharedValue(CHECK_LEN); // check-mark draw offset
  const bump = useSharedValue(0); // small scale bump when armed

  const phase = useRef<Phase>('idle');
  const scrollY = useRef(0);
  const startY = useRef(0);
  const timers = useRef<ReturnType<typeof setTimeout>[]>([]);
  const refreshRef = useRef(onRefresh);
  refreshRef.current = onRefresh;

  const labelRef = useRef('Pull to refresh');
  const listeners = useRef(new Set<(t: string) => void>());

  const setLabel = useCallback((t: string) => {
    labelRef.current = t;
    listeners.current.forEach((fn) => fn(t));
  }, []);

  const subscribeLabel = useCallback((fn: (t: string) => void) => {
    listeners.current.add(fn);
    fn(labelRef.current);
    return () => {
      listeners.current.delete(fn);
    };
  }, []);

  const later = useCallback((fn: () => void, ms: number) => {
    timers.current.push(setTimeout(fn, ms));
  }, []);

  useEffect(() => {
    const list = timers.current;
    return () => list.forEach(clearTimeout);
  }, []);

  const reset = useCallback(() => {
    phase.current = 'idle';
    cancelAnimation(rot);
    cancelAnimation(arc);
    rot.value = 0;
    arc.value = 0;
    ok.value = 0;
    chk.value = CHECK_LEN;
    bump.value = 0;
    setLabel('Pull to refresh');
  }, [arc, bump, chk, ok, rot, setLabel]);

  const collapse = useCallback(() => {
    pull.value = withTiming(0, {
      duration: 320,
      easing: Easing.out(Easing.cubic),
    });
    later(reset, 340);
  }, [later, pull, reset]);

  const finish = useCallback(() => {
    if (phase.current !== 'refreshing') return;
    phase.current = 'success';
    cancelAnimation(rot);
    cancelAnimation(arc);
    ok.value = withTiming(1, { duration: 200 });
    chk.value = withTiming(0, {
      duration: 320,
      easing: Easing.out(Easing.cubic),
    });
    setLabel("You're up to date");
    hapticSuccess();
    later(collapse, 950);
  }, [arc, chk, collapse, later, ok, rot, setLabel]);

  const startRefresh = useCallback(() => {
    phase.current = 'refreshing';
    setLabel('Refreshing…');
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
  }, [arc, finish, later, pull, rot, setLabel]);

  const gesture = useMemo(() => {
    const native = Gesture.Native();
    const pan = Gesture.Pan()
      .runOnJS(true)
      .manualActivation(true)
      .onTouchesDown((e) => {
        startY.current = e.allTouches[0]?.absoluteY ?? 0;
      })
      .onTouchesMove((e, mgr) => {
        const t = e.allTouches[0];
        if (!t) return;
        if (phase.current === 'refreshing' || phase.current === 'success') {
          mgr.fail();
          return;
        }
        if (scrollY.current > 1) {
          startY.current = t.absoluteY;
          return;
        }
        const dy = t.absoluteY - startY.current;
        if (dy > 8) mgr.activate();
        else if (dy < -8) mgr.fail();
      })
      .onUpdate((e) => {
        const dy = e.absoluteY - startY.current;
        const v = Math.max(0, Math.min(MAX_PULL, dy * 0.5));
        const armed = v >= PULL_THRESHOLD;

        if (armed && phase.current !== 'armed') {
          phase.current = 'armed';
          setLabel('Release to refresh');
          hapticSelection();
          bump.value = withSequence(
            withTiming(1, { duration: 90 }),
            withTiming(0, { duration: 160 })
          );
        } else if (!armed && phase.current !== 'pulling') {
          phase.current = 'pulling';
          setLabel('Pull to refresh');
        }

        pull.value = v;
        arc.value = armed ? 1 : Math.min(1, v / PULL_THRESHOLD) * 0.8;
        rot.value = v * 3;
      })
      .onFinalize(() => {
        if (phase.current === 'armed') {
          startRefresh();
        } else if (phase.current === 'pulling') {
          phase.current = 'idle';
          collapse();
        }
      });

    return Gesture.Simultaneous(pan, native);
  }, [arc, bump, collapse, pull, rot, setLabel, startRefresh]);

  const onScroll = useCallback((e: NativeSyntheticEvent<NativeScrollEvent>) => {
    scrollY.current = e.nativeEvent.contentOffset.y;
  }, []);

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
    subscribeLabel,
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
  const { pull, arc, rot, ok, chk, bump, subscribeLabel } = ctrl;
  const [label, setLabel] = useState('Pull to refresh');

  useEffect(() => subscribeLabel(setLabel), [subscribeLabel]);

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
              <Circle
                cx={22}
                cy={22}
                r={R}
                fill="none"
                stroke="rgba(255,255,255,0.12)"
                strokeWidth={3}
              />
              <AnimatedCircle
                animatedProps={arcProps}
                cx={22}
                cy={22}
                r={R}
                fill="none"
                stroke={COLORS.violetLight}
                strokeWidth={3}
                strokeLinecap="round"
                strokeDasharray={C}
                rotation={-90}
                origin="22, 22"
              />
            </Svg>
          </Animated.View>

          <Animated.View style={[StyleSheet.absoluteFill, okStyle]}>
            <Svg width={44} height={44} viewBox="0 0 44 44">
              <Circle cx={22} cy={22} r={19} fill={COLORS.violet} />
              <AnimatedPath
                animatedProps={chkProps}
                d="M14 23 l6 6 l11 -12"
                fill="none"
                stroke="#FFFFFF"
                strokeWidth={3}
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeDasharray={CHECK_LEN}
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
