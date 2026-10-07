// components/DobPicker.tsx
// Premium 3-wheel scroll DOB picker (iOS/WhatsApp style)
// Wheels: Day | Month | Year, centered highlight band, haptic feedback

import { useEffect, useMemo, useRef, useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  Modal,
  TouchableOpacity,
  FlatList,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { LinearGradient } from 'expo-linear-gradient';
import { COLORS, FONTS, GRADIENTS } from '../constants/theme';
import { hapticLight, hapticMedium } from '../lib/haptics';

const ITEM_HEIGHT = 52;
const VISIBLE_ITEMS = 5;
const WHEEL_HEIGHT = ITEM_HEIGHT * VISIBLE_ITEMS;
const PADDING = (WHEEL_HEIGHT - ITEM_HEIGHT) / 2;

const MONTHS_SHORT = [
  'Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun',
  'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec',
];

function daysInMonth(month: number, year: number) {
  return new Date(year, month + 1, 0).getDate();
}

export function formatDob(d: Date): string {
  const dd = String(d.getDate()).padStart(2, '0');
  const mmm = MONTHS_SHORT[d.getMonth()];
  const yyyy = d.getFullYear();
  return `${dd} ${mmm} ${yyyy}`;
}

export function calcAge(dob: Date): number {
  const today = new Date();
  let age = today.getFullYear() - dob.getFullYear();
  const m = today.getMonth() - dob.getMonth();
  if (m < 0 || (m === 0 && today.getDate() < dob.getDate())) age--;
  return age;
}

type Props = {
  visible: boolean;
  value: Date | null;
  onClose: () => void;
  onConfirm: (date: Date) => void;
  minAge?: number;
  maxAge?: number;
};

export default function DobPicker({
  visible,
  value,
  onClose,
  onConfirm,
  minAge = 13,
  maxAge = 120,
}: Props) {
  const years = useMemo(() => {
    const now = new Date();
    const maxY = now.getFullYear() - minAge;
    const minY = now.getFullYear() - maxAge;
    const arr: number[] = [];
    for (let y = maxY; y >= minY; y--) arr.push(y);
    return arr;
  }, [minAge, maxAge]);

  const defaultDate = useMemo(() => {
    const now = new Date();
    const y = now.getFullYear() - 20;
    return new Date(y, 0, 1);
  }, []);

  return (
    <Modal
      visible={visible}
      transparent
      animationType="fade"
      onRequestClose={onClose}
      statusBarTranslucent
    >
      <View style={styles.backdrop}>
        <SafeAreaView style={styles.card} edges={['top', 'bottom']}>
          {visible && (
            <WheelContent
              initialDate={value ?? defaultDate}
              years={years}
              onCancel={onClose}
              onConfirm={onConfirm}
              minAge={minAge}
            />
          )}
        </SafeAreaView>
      </View>
    </Modal>
  );
}

// ─────────────────────────────────────────────────────────
// Inner content — mounts fresh every time modal opens
// ─────────────────────────────────────────────────────────
function WheelContent({
  initialDate,
  years,
  onCancel,
  onConfirm,
  minAge,
}: {
  initialDate: Date;
  years: number[];
  onCancel: () => void;
  onConfirm: (d: Date) => void;
  minAge: number;
}) {
  const [day, setDay] = useState(initialDate.getDate());
  const [month, setMonth] = useState(initialDate.getMonth());
  const [year, setYear] = useState(initialDate.getFullYear());

  const totalDays = daysInMonth(month, year);
  const days = useMemo(() => {
    const arr: number[] = [];
    for (let d = 1; d <= totalDays; d++) arr.push(d);
    return arr;
  }, [totalDays]);

  // Clamp day if month/year changes
  useEffect(() => {
    if (day > totalDays) setDay(totalDays);
  }, [totalDays, day]);

  function handleDone() {
    const dob = new Date(year, month, day);
    // Final sanity — age must be >= minAge
    const today = new Date();
    let age = today.getFullYear() - dob.getFullYear();
    const m = today.getMonth() - dob.getMonth();
    if (m < 0 || (m === 0 && today.getDate() < dob.getDate())) age--;
    if (age < minAge) {
      // Still allow — signup screen will validate. But show gentle haptic.
      hapticMedium();
    }
    onConfirm(dob);
  }

  return (
    <>
      <View style={styles.headerRow}>
        <TouchableOpacity
          onPress={onCancel}
          style={styles.headerBtn}
          activeOpacity={0.7}
        >
          <Text style={styles.headerBtnText}>Cancel</Text>
        </TouchableOpacity>
        <Text style={styles.headerTitle}>Date of birth</Text>
        <TouchableOpacity
          onPress={handleDone}
          style={styles.headerBtn}
          activeOpacity={0.7}
        >
          <Text style={[styles.headerBtnText, styles.headerBtnDone]}>Done</Text>
        </TouchableOpacity>
      </View>

      <Text style={styles.helperText}>
        We use this to personalize your experience
      </Text>

      <View style={styles.wheelsRow}>
        {/* Center highlight band */}
        <View pointerEvents="none" style={styles.highlightBand} />

        {/* Day wheel */}
        <View style={styles.wheelCol}>
          <Wheel
            data={days}
            initialIndex={Math.max(0, days.indexOf(day))}
            selectedIndex={day - 1}
            onSelect={(idx) => setDay(idx + 1)}
            getLabel={(d) => String(d)}
          />
        </View>

        {/* Month wheel */}
        <View style={[styles.wheelCol, styles.wheelColWide]}>
          <Wheel
            data={[0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11]}
            initialIndex={month}
            selectedIndex={month}
            onSelect={(idx) => setMonth(idx)}
            getLabel={(m) => MONTHS_SHORT[m]}
          />
        </View>

        {/* Year wheel */}
        <View style={styles.wheelCol}>
          <Wheel
            data={years}
            initialIndex={Math.max(0, years.indexOf(year))}
            selectedIndex={years.indexOf(year)}
            onSelect={(idx) => setYear(years[idx])}
            getLabel={(y) => String(y)}
          />
        </View>
      </View>
    </>
  );
}

// ─────────────────────────────────────────────────────────
// Wheel — scrollable snap list
// ─────────────────────────────────────────────────────────
function Wheel<T>({
  data,
  initialIndex,
  selectedIndex,
  onSelect,
  getLabel,
}: {
  data: T[];
  initialIndex: number;
  selectedIndex: number;
  onSelect: (idx: number) => void;
  getLabel: (item: T) => string;
}) {
  const ref = useRef<FlatList<T>>(null);

  useEffect(() => {
    const t = setTimeout(() => {
      if (initialIndex >= 0) {
        ref.current?.scrollToOffset({
          offset: initialIndex * ITEM_HEIGHT,
          animated: false,
        });
      }
    }, 60);
    return () => clearTimeout(t);
  }, []);

  return (
    <FlatList
      ref={ref}
      data={data}
      keyExtractor={(_, i) => String(i)}
      showsVerticalScrollIndicator={false}
      snapToInterval={ITEM_HEIGHT}
      decelerationRate="fast"
      bounces={false}
      overScrollMode="never"
      contentContainerStyle={{ paddingVertical: PADDING }}
      onMomentumScrollEnd={(e) => {
        const y = e.nativeEvent.contentOffset.y;
        const idx = Math.round(y / ITEM_HEIGHT);
        if (idx >= 0 && idx < data.length) {
          onSelect(idx);
          hapticLight();
        }
      }}
      getItemLayout={(_, index) => ({
        length: ITEM_HEIGHT,
        offset: ITEM_HEIGHT * index,
        index,
      })}
      renderItem={({ item, index }) => {
        const active = index === selectedIndex;
        return (
          <View style={styles.wheelItem}>
            <Text
              style={[
                styles.wheelItemText,
                active && styles.wheelItemTextActive,
              ]}
            >
              {getLabel(item)}
            </Text>
          </View>
        );
      }}
    />
  );
}

const styles = StyleSheet.create({
  backdrop: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.75)',
    justifyContent: 'flex-end',
  },
  card: {
    backgroundColor: '#0F1219',
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
    paddingBottom: 8,
    borderTopWidth: 1,
    borderColor: 'rgba(255,255,255,0.08)',
  },
  headerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 12,
    paddingTop: 16,
    paddingBottom: 8,
    borderBottomWidth: 1,
    borderBottomColor: 'rgba(255,255,255,0.05)',
  },
  headerBtn: { paddingHorizontal: 12, paddingVertical: 6 },
  headerBtnText: {
    fontSize: 15,
    fontFamily: FONTS.bodyMedium,
    color: COLORS.mist,
  },
  headerBtnDone: {
    color: COLORS.violetLight,
    fontFamily: FONTS.bodySemiBold,
  },
  headerTitle: {
    fontSize: 16,
    fontFamily: FONTS.bodySemiBold,
    color: '#FFFFFF',
  },
  helperText: {
    fontSize: 12.5,
    fontFamily: FONTS.body,
    color: COLORS.mist,
    textAlign: 'center',
    paddingTop: 8,
    paddingBottom: 4,
  },
  wheelsRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    height: WHEEL_HEIGHT + 16,
    paddingHorizontal: 12,
    position: 'relative',
  },
  highlightBand: {
    position: 'absolute',
    left: 12,
    right: 12,
    top: (WHEEL_HEIGHT + 16 - ITEM_HEIGHT) / 2,
    height: ITEM_HEIGHT,
    borderRadius: 14,
    backgroundColor: 'rgba(124,92,255,0.12)',
    borderWidth: 1,
    borderColor: 'rgba(124,92,255,0.30)',
  },
  wheelCol: {
    flex: 1,
    height: WHEEL_HEIGHT,
    alignItems: 'center',
  },
  wheelColWide: { flex: 1.4 },
  wheelItem: {
    height: ITEM_HEIGHT,
    alignItems: 'center',
    justifyContent: 'center',
  },
  wheelItemText: {
    fontSize: 18,
    fontFamily: FONTS.body,
    color: 'rgba(255,255,255,0.35)',
  },
  wheelItemTextActive: {
    fontSize: 22,
    fontFamily: FONTS.bodySemiBold,
    color: '#FFFFFF',
  },
});
