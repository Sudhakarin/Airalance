// components/StatusRing.tsx
// Instagram-style gradient ring around avatars with status
// ✅ Constant size regardless of hasStatus (no layout shift)
// ✅ FIX: ring is drawn with SVG (full gradient disk) and covered by the inner circle,
//    so Android no longer breaks the ring into arcs / shows a square box.

import { View, StyleSheet } from 'react-native';
import Svg, { Defs, LinearGradient, Stop, Circle } from 'react-native-svg';
import { COLORS, GRADIENTS } from '../constants/theme';

type StatusRingProps = {
  hasStatus: boolean;
  viewed: boolean;
  children: React.ReactNode;
};

const RING = 3.5; // visible gradient thickness
const GAP = 2.5; // dark gap between ring and avatar

export default function StatusRing({
  hasStatus,
  viewed,
  children,
}: StatusRingProps) {
  const colors: string[] = (
    viewed ? GRADIENTS.statusRingViewed : GRADIENTS.statusRing
  ) as any;

  const gradId = viewed ? 'statusRingViewed' : 'statusRingActive';

  return (
    <View style={styles.wrap}>
      {/* gradient disk — only when there is a status. Same size either way. */}
      {hasStatus && (
        <Svg
          style={StyleSheet.absoluteFill}
          width="100%"
          height="100%"
          viewBox="0 0 100 100"
        >
          <Defs>
            <LinearGradient id={gradId} x1="0" y1="0" x2="1" y2="1">
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
          <Circle cx="50" cy="50" r="50" fill={`url(#${gradId})`} />
        </Svg>
      )}

      {/* inner circle covers the middle of the disk → leaves a perfect ring */}
      <View style={[styles.gap, !hasStatus && styles.gapTransparent]}>
        <View style={styles.clip}>{children}</View>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: {
    padding: RING,
    borderRadius: 999,
  },
  gap: {
    padding: GAP,
    borderRadius: 999,
    backgroundColor: COLORS.ink900,
  },
  gapTransparent: {
    backgroundColor: 'transparent',
  },
  clip: {
    borderRadius: 999,
    overflow: 'hidden',
  },
});
