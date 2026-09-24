// components/OtpBoxes.tsx
// 6-box OTP input — auto-advance, paste support

import { useRef } from 'react';
import {
  View,
  TextInput,
  StyleSheet,
  NativeSyntheticEvent,
  TextInputKeyPressEventData,
} from 'react-native';
import { COLORS, FONTS, RADII } from '../constants/theme';

type Props = {
  value: string;
  onChange: (v: string) => void;
  autoFocus?: boolean;
};

export default function OtpBoxes({ value, onChange, autoFocus }: Props) {
  const refs = useRef<(TextInput | null)[]>([]);
  const digits = Array.from({ length: 6 }, (_, i) => value[i] ?? '');

  function setDigit(i: number, d: string) {
    const clean = d.replace(/\D/g, '').slice(-1);
    const next = digits.slice();
    next[i] = clean;
    onChange(next.join(''));
    if (clean && i < 5) {
      refs.current[i + 1]?.focus();
    }
  }

  function handleKeyPress(
    i: number,
    e: NativeSyntheticEvent<TextInputKeyPressEventData>
  ) {
    if (e.nativeEvent.key === 'Backspace' && !digits[i] && i > 0) {
      refs.current[i - 1]?.focus();
    }
  }

  return (
    <View style={styles.row}>
      {digits.map((d, i) => (
        <TextInput
          key={i}
          ref={(el) => {
            refs.current[i] = el;
          }}
          value={d}
          autoFocus={autoFocus && i === 0}
          keyboardType="number-pad"
          maxLength={1}
          onChangeText={(t) => setDigit(i, t)}
          onKeyPress={(e) => handleKeyPress(i, e)}
          style={[styles.box, d ? styles.boxFilled : null]}
          selectionColor={COLORS.violetLight}
        />
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    gap: 6,
  },
  box: {
    flex: 1,
    height: 50,
    borderRadius: RADII.lg,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.10)',
    backgroundColor: COLORS.ink800,
    textAlign: 'center',
    fontSize: 18,
    fontFamily: FONTS.bodySemiBold,
    color: '#FFFFFF',
  },
  boxFilled: {
    borderColor: 'rgba(124,92,255,0.5)',
    backgroundColor: 'rgba(124,92,255,0.08)',
  },
});
