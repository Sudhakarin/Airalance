// components/StatusRing.tsx
// Instagram-style gradient ring around avatars with status
// ✅ Constant size regardless of hasStatus (no layout shift)
// ✅ FIX (ring was a crescent): no more "gradient disk + cover" trick and no
//    padding-dependent absolute positioning. The ring is a plain SVG STROKE circle with
//    explicit pixel size, placed at (0,0) of a root view that has NO padding, so it is
//    always a perfect, centered circle on Android and iOS.
//    Pass `size` (the avatar size) for a correct very first frame; without it the ring
//    size is measured with onLayout.

import { useCallback, useState } from 'react';
import { View, StyleSheet, LayoutChangeEvent } from 'react-native';
import Svg, { Defs, LinearGradient, Stop, Circle } from 'react-native-svg';
import { GRADIENTS } from '../constants/theme';

type StatusRingProps = {
  hasStatus: boolean;
  viewed: boolean;
  /** Avatar size in px (recommended) */
  size?: number;
  children: React.ReactNode;
};

const RING = 3.5; // visible gradient thickness
const GAP = 2.5; // empty gap between ring and avatar

export default function StatusRing({
  hasStatus,
  viewed,
  size,
  children,
}: StatusRingProps) {
  const colors: string[] = (
    viewed ? GRADIENTS.statusRingViewed : GRADIENTS.statusRing
  ) as any;

  const gradId = viewed ? 'statusRingViewed' : 'statusRingActive';

  const [measured, setMeasured] = useState({ w: 0, h: 0 });
  const fixed = size ? size + 2 * (RING + GAP) : 0;
  const w = fixed || measured.w;
  const h = fixed || measured.h;
  const d = Math.min(w, h);

  const onLayout = useCallback((e: LayoutChangeEvent) => {
    const { width, height } = e.nativeEvent.layout;
    setMeasured((prev) =>
      prev.w === width && prev.h === height ? prev : { w: width, h: height }
    );
  }, []);

  return (
    <View style={styles.root} onLayout={fixed ? undefined : onLayout}>
      {/* ring — only when there is a status. Space is reserved either way. */}
      {hasStatus && d > 0 && (
        <Svg
          width={w}
          height={h}
          style={styles.svg}
          pointerEvents="none"
        >
          <Defs>
            <LinearGradient
              id={gradId}
              gradientUnits="userSpaceOnUse"
              x1="0"
              y1="0"
              x2={w}
              y2={h}
            >
              {colors.map((c, i) => (
                <Stop
                  key={i}
                  offset={`${
                    colors.length > 1 ? (i / (colors.length - 1)) * 100 : 0
                  }%`}
                  stopColor={c}
                />
              ))}
            </LinearGradient>
          </Defs>
          <Circle
            cx={w / 2}
            cy={h / 2}
            r={(d - RING) / 2}
            stroke={`url(#${gradId})`}
            strokeWidth={RING}
            fill="none"
          />
        </Svg>
      )}

      <View style={styles.pad}>
        <View style={styles.gap}>
          <View style={styles.clip}>{children}</View>
        </View>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  // NO padding here, so the absolute SVG at (0,0) always matches the full box
  root: {},
  svg: {
    position: 'absolute',
    top: 0,
    left: 0,
  },
  pad: {
    padding: RING,
  },
  gap: {
    padding: GAP,
  },
  clip: {
    borderRadius: 999,
    overflow: 'hidden',
  },
});
