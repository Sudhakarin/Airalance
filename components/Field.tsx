// components/Field.tsx
// Reusable field wrapper — label + icon + children

import React from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { COLORS, FONTS, SPACING } from '../constants/theme';

type Props = {
  label: string;
  icon?: React.ReactNode;
  right?: React.ReactNode;
  children: React.ReactNode;
};

export default function Field({ label, icon, right, children }: Props) {
  return (
    <View style={styles.wrap}>
      <View style={styles.header}>
        <Text style={styles.label}>{label}</Text>
        {right}
      </View>
      <View style={styles.inputWrap}>
        {icon && <View style={styles.iconWrap}>{icon}</View>}
        {children}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: {
    marginBottom: SPACING.md,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 5,
  },
  label: {
    fontSize: 11.5,
    fontFamily: FONTS.bodyMedium,
    color: COLORS.mistLight,
  },
  inputWrap: {
    position: 'relative',
  },
  iconWrap: {
    position: 'absolute',
    left: 14,
    top: 0,
    bottom: 0,
    justifyContent: 'center',
    zIndex: 1,
  },
});
