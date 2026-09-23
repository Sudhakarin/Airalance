// components/StatusRing.tsx
// Instagram-style gradient ring around avatars with status

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
  // No status — just return the child
  if (!hasStatus) {
    return <>{children}</>;
  }

  // Viewed vs unviewed gradient
  const gradient = viewed
    ? GRADIENTS.statusRingViewed
    : GRADIENTS.statusRing;

  return (
    <View style={styles.wrap}>
      <LinearGradient
        colors={gradient as any}
        start={{ x: 0, y: 0 }}
        end={{ x: 1, y: 1 }}
        style={styles.gradient}
      >
        <View style={styles.innerBg}>{children}</View>
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
});
