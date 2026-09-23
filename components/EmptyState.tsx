// components/EmptyState.tsx
// Reusable empty state component

import { View, Text, StyleSheet } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { COLORS, FONTS, SPACING } from '../constants/theme';

type Props = {
  icon?: any;
  title: string;
  subtitle?: string;
};

export default function EmptyState({
  icon = 'chatbubbles-outline',
  title,
  subtitle,
}: Props) {
  return (
    <View style={styles.wrap}>
      <View style={styles.iconWrap}>
        <Ionicons name={icon} size={42} color={COLORS.mist} />
      </View>
      <Text style={styles.title}>{title}</Text>
      {subtitle && <Text style={styles.subtitle}>{subtitle}</Text>}
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: {
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 60,
    paddingHorizontal: 40,
    gap: 10,
  },
  iconWrap: {
    width: 88,
    height: 88,
    borderRadius: 44,
    backgroundColor: 'rgba(255,255,255,0.04)',
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 4,
  },
  title: {
    fontSize: 17,
    fontFamily: FONTS.displayBold,
    color: '#FFFFFF',
    textAlign: 'center',
  },
  subtitle: {
    fontSize: 13,
    fontFamily: FONTS.body,
    color: COLORS.mist,
    textAlign: 'center',
    lineHeight: 18,
  },
});
