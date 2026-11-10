// components/AppDialogHost.tsx
// Poori app ke Alert.alert() popups ko app ki UI ke hisaab se dikhata hai
// (Android/iOS ke default system dialog ki jagah).
//
// Setup: app/_layout.tsx me ek baar  <AppDialogHost />  lagao.
// Koi bhi screen ka Alert.alert(...) apne aap isi theme me dikhega — kuch badalna nahi.
// Host mount hone se pehle aaya alert native hi dikhta hai (kuch gum nahi hota).

import { useCallback, useEffect, useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  Modal,
  Pressable,
  TouchableOpacity,
  Alert,
} from 'react-native';
import type { AlertButton, AlertOptions } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { COLORS, FONTS } from '../constants/theme';

type Req = {
  title: string;
  message?: string;
  buttons: AlertButton[];
  options?: AlertOptions;
};

let listener: ((r: Req) => void) | null = null;
const nativeAlert = Alert.alert.bind(Alert);

// Global patch: Alert.alert -> themed dialog
(Alert as any).alert = (
  title: string,
  message?: string,
  buttons?: AlertButton[],
  options?: AlertOptions
) => {
  if (!listener) {
    nativeAlert(title, message, buttons, options);
    return;
  }
  listener({
    title: String(title ?? ''),
    message: message ? String(message) : undefined,
    buttons: buttons && buttons.length ? buttons : [{ text: 'OK' }],
    options,
  });
};

type Tone = { icon: keyof typeof Ionicons.glyphMap; color: string; bg: string };

function toneFor(r: Req): Tone {
  const t = `${r.title} ${r.message ?? ''}`.toLowerCase();
  if (r.buttons.some((b) => b.style === 'destructive')) {
    return { icon: 'warning-outline', color: '#F87171', bg: '#EF4444' };
  }
  if (/(error|failed|couldn.?t|could not|can.?t|cannot|unable|offline|denied|not allowed|unavailable|invalid|wrong)/.test(t)) {
    return { icon: 'alert-circle-outline', color: '#F87171', bg: '#EF4444' };
  }
  if (/(copied|saved|success|done|sent|updated|unblocked)/.test(t)) {
    return { icon: 'checkmark-circle-outline', color: '#34D399', bg: '#34D399' };
  }
  return { icon: 'information-circle-outline', color: '#9D86FF', bg: '#7C5CFF' };
}

function btnColors(b: AlertButton): { bg: string; fg: string } {
  if (b.style === 'destructive') return { bg: '#EF4444', fg: '#FFFFFF' };
  if (b.style === 'cancel') return { bg: 'rgba(255,255,255,0.08)', fg: COLORS.mistLight };
  return { bg: '#7C5CFF', fg: '#FFFFFF' };
}

export default function AppDialogHost() {
  const [queue, setQueue] = useState<Req[]>([]);

  useEffect(() => {
    listener = (r) => setQueue((q) => [...q, r]);
    return () => {
      listener = null;
    };
  }, []);

  const cur = queue[0] ?? null;
  const close = useCallback(() => setQueue((q) => q.slice(1)), []);

  const press = useCallback(
    (b: AlertButton) => {
      close();
      try {
        b.onPress?.();
      } catch (err) {
        console.warn('[dialog] button handler error:', err);
      }
    },
    [close]
  );

  const dismiss = useCallback(() => {
    if (!cur) return;
    const cancelBtn = cur.buttons.find((b) => b.style === 'cancel');
    if (cur.options?.cancelable === true) {
      close();
      cur.options.onDismiss?.();
    } else if (cancelBtn) {
      press(cancelBtn);
    }
    // sirf OK/destructive wale alert ko bahar tap karke band nahi karte
  }, [cur, close, press]);

  if (!cur) return null;
  const tone = toneFor(cur);
  const stacked = cur.buttons.length > 2;

  return (
    <Modal visible transparent animationType="fade" statusBarTranslucent onRequestClose={dismiss}>
      <Pressable style={styles.backdrop} onPress={dismiss}>
        <Pressable style={styles.card} onPress={(e) => e.stopPropagation()}>
          <View style={[styles.iconWrap, { backgroundColor: `${tone.bg}26` }]}>
            <Ionicons name={tone.icon} size={24} color={tone.color} />
          </View>
          {!!cur.title && <Text style={styles.title}>{cur.title}</Text>}
          {!!cur.message && <Text style={styles.message}>{cur.message}</Text>}

          <View style={[styles.buttons, stacked && { flexDirection: 'column' }]}>
            {cur.buttons.map((b, i) => {
              const c = btnColors(b);
              return (
                <TouchableOpacity
                  key={`${b.text}-${i}`}
                  style={[styles.btn, { backgroundColor: c.bg }]}
                  onPress={() => press(b)}
                  activeOpacity={0.8}
                >
                  <Text style={[styles.btnText, { color: c.fg }]} numberOfLines={1}>
                    {b.text ?? 'OK'}
                  </Text>
                </TouchableOpacity>
              );
            })}
          </View>
        </Pressable>
      </Pressable>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.62)',
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 24,
  },
  card: {
    width: '100%',
    maxWidth: 330,
    backgroundColor: '#14161E',
    borderRadius: 20,
    paddingTop: 22,
    paddingBottom: 14,
    paddingHorizontal: 12,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.09)',
  },
  iconWrap: {
    width: 52,
    height: 52,
    borderRadius: 26,
    alignItems: 'center',
    justifyContent: 'center',
    alignSelf: 'center',
    marginBottom: 12,
  },
  title: {
    fontSize: 17,
    fontFamily: FONTS.displayBold,
    color: '#FFFFFF',
    textAlign: 'center',
    marginBottom: 6,
    paddingHorizontal: 6,
  },
  message: {
    fontSize: 13.5,
    fontFamily: FONTS.body,
    color: COLORS.mistLight,
    textAlign: 'center',
    lineHeight: 19,
    marginBottom: 16,
    paddingHorizontal: 10,
  },
  buttons: { flexDirection: 'row', gap: 10, paddingHorizontal: 6, marginTop: 2 },
  btn: { flex: 1, paddingVertical: 12, borderRadius: 12, alignItems: 'center' },
  btnText: { fontSize: 14, fontFamily: FONTS.bodySemiBold },
});
