// components/StatusRing.tsx
// Instagram-style gradient ring around avatars with status
// ✅ FIX: constant size regardless of hasStatus (no layout shift)

import { View, StyleSheet } from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { COLORS, GRADIENTS } from '../constants/theme';

type StatusRingProps = {
  hasStatus: boolean;
  viewed: boolean;
  children: React.ReactNode;
};

export default function StatusRing({
  hasStatus,
  viewed,
  children,
}: StatusRingProps) {
  // ✅ Always use same wrapper structure → constant size
  const gradientColors = !hasStatus
    ? (['rgba(0,0,0,0)', 'rgba(0,0,0,0)'] as const)
    : ((viewed ? GRADIENTS.statusRingViewed : GRADIENTS.statusRing) as any);

  return (
    <View style={styles.wrap}>
      <LinearGradient
        colors={gradientColors as any}
        start={{ x: 0, y: 0 }}
        end={{ x: 1, y: 1 }}
        style={styles.gradient}
      >
        <View
          style={[
            styles.innerBg,
            !hasStatus && styles.innerBgTransparent,
          ]}
        >
          {children}
        </View>
      </LinearGradient>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: {
    position: 'relative',
  },
  gradient: {
    padding: 3.5,
    borderRadius: 999,
  },
  innerBg: {
    padding: 2.5,
    borderRadius: 999,
    backgroundColor: COLORS.ink900,
  },
  innerBgTransparent: {
    backgroundColor: 'transparent',
  },
});
