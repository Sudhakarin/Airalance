// components/CallSetupModal.tsx
// Small black popup + blurred background (same style as the app's other dialogs).
// Rendered by CallProvider; opened the first time the user taps call.

import { useCallback, useEffect, useRef, useState } from 'react';
import {
  Modal,
  View,
  Text,
  Pressable,
  TouchableOpacity,
  StyleSheet,
  Platform,
  AppState,
} from 'react-native';
import { BlurView } from 'expo-blur';
import { Ionicons } from '@expo/vector-icons';
import { COLORS, FONTS } from '../constants/theme';
import {
  isBatteryUnrestricted,
  openBatterySettings,
  openOverlaySettings,
  openFullScreenSettings,
} from '../lib/callSetup';

type Key = 'battery' | 'overlay' | 'fullscreen';

interface Props {
  visible: boolean;
  onClose: () => void;
}

export default function CallSetupModal({ visible, onClose }: Props) {
  const showFullScreen = Platform.OS === 'android' && Number(Platform.Version) >= 34;
  const [done, setDone] = useState<Record<Key, boolean>>({
    battery: false,
    overlay: false,
    fullscreen: false,
  });
  const openedRef = useRef<Set<Key>>(new Set());

  const refresh = useCallback(async () => {
    const battery = await isBatteryUnrestricted();
    setDone((d) => {
      const next = { ...d };
      if (battery === true) next.battery = true;
      // can't verify these two — mark as done once the user came back from Settings
      openedRef.current.forEach((k) => {
        if (k !== 'battery') next[k] = true;
      });
      return next;
    });
  }, []);

  useEffect(() => {
    if (!visible) return;
    refresh();
    const sub = AppState.addEventListener('change', (st) => {
      if (st === 'active') refresh();
    });
    return () => sub.remove();
  }, [visible, refresh]);

  const open = (key: Key) => {
    openedRef.current.add(key);
    if (key === 'battery') openBatterySettings();
    else if (key === 'overlay') openOverlaySettings();
    else openFullScreenSettings();
  };

  const rows: { key: Key; icon: any; title: string; sub: string }[] = [
    {
      key: 'battery',
      icon: 'battery-charging-outline',
      title: 'Battery: Unrestricted',
      sub: 'Lets calls arrive when the app is closed',
    },
    {
      key: 'overlay',
      icon: 'layers-outline',
      title: 'Display over other apps',
      sub: 'Shows the call screen on top of anything',
    },
  ];
  if (showFullScreen) {
    rows.push({
      key: 'fullscreen',
      icon: 'scan-outline',
      title: 'Full-screen notifications',
      sub: 'Opens the call on your locked screen',
    });
  }

  return (
    <Modal
      visible={visible}
      transparent
      animationType="fade"
      onRequestClose={onClose}
      statusBarTranslucent
    >
      <BlurView
        intensity={50}
        tint="dark"
        experimentalBlurMethod="dimezisBlurView"
        style={styles.blurBackdrop}
      >
        <Pressable style={styles.backdropPress} onPress={onClose}>
          <Pressable style={styles.dialogCard} onPress={(e) => e.stopPropagation()}>
            <View style={styles.dialogIconWrap}>
              <Ionicons name="call" size={22} color={'#22C55E'} />
            </View>
            <Text style={styles.dialogTitle}>Allow for calls</Text>
            <Text style={styles.dialogSub}>
              Turn these on so calls ring on your lock screen, like WhatsApp.
            </Text>

            {rows.map((r) => (
              <View key={r.key} style={styles.row}>
                <View style={styles.rowIcon}>
                  <Ionicons name={r.icon} size={18} color="#FFFFFF" />
                </View>
                <View style={styles.rowText}>
                  <Text style={styles.rowTitle}>{r.title}</Text>
                  <Text style={styles.rowSub}>{r.sub}</Text>
                </View>
                <TouchableOpacity
                  activeOpacity={0.75}
                  onPress={() => open(r.key)}
                  style={[styles.openBtn, done[r.key] && styles.openBtnDone]}
                >
                  <Text
                    style={[styles.openText, done[r.key] && styles.openTextDone]}
                  >
                    {done[r.key] ? 'Done ✓' : 'Open'}
                  </Text>
                </TouchableOpacity>
              </View>
            ))}

            <View style={styles.dialogButtons}>
              <TouchableOpacity
                style={styles.btnSecondary}
                onPress={onClose}
                activeOpacity={0.75}
              >
                <Text style={styles.btnSecondaryText}>Not now</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={styles.btnPrimary}
                onPress={onClose}
                activeOpacity={0.75}
              >
                <Text style={styles.btnPrimaryText}>Continue</Text>
              </TouchableOpacity>
            </View>
          </Pressable>
        </Pressable>
      </BlurView>
    </Modal>
  );
}

const styles = StyleSheet.create({
  blurBackdrop: { flex: 1, backgroundColor: 'rgba(0,0,0,0.35)' },
  backdropPress: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 24,
  },
  dialogCard: {
    width: '100%',
    maxWidth: 320,
    backgroundColor: 'rgba(20,22,30,0.96)',
    borderRadius: 20,
    paddingTop: 16,
    paddingBottom: 10,
    paddingHorizontal: 8,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.09)',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 12 },
    shadowOpacity: 0.5,
    shadowRadius: 24,
    elevation: 16,
  },
  dialogIconWrap: {
    width: 52,
    height: 52,
    borderRadius: 26,
    backgroundColor: 'rgba(34,197,94,0.15)',
    alignItems: 'center',
    justifyContent: 'center',
    alignSelf: 'center',
    marginBottom: 12,
  },
  dialogTitle: {
    fontSize: 16,
    fontFamily: FONTS.displayBold,
    color: '#FFFFFF',
    textAlign: 'center',
    marginBottom: 5,
    paddingHorizontal: 8,
  },
  dialogSub: {
    fontSize: 13,
    fontFamily: FONTS.body,
    color: COLORS.mistLight,
    textAlign: 'center',
    lineHeight: 18,
    marginBottom: 10,
    paddingHorizontal: 8,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    paddingVertical: 10,
    paddingHorizontal: 8,
    borderTopWidth: 1,
    borderTopColor: 'rgba(255,255,255,0.07)',
  },
  rowIcon: {
    width: 34,
    height: 34,
    borderRadius: 11,
    backgroundColor: 'rgba(255,255,255,0.07)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  rowText: { flex: 1 },
  rowTitle: {
    fontSize: 13,
    fontFamily: FONTS.bodySemiBold,
    color: '#FFFFFF',
  },
  rowSub: {
    fontSize: 11.5,
    fontFamily: FONTS.body,
    color: COLORS.mist,
    marginTop: 1,
    lineHeight: 15,
  },
  openBtn: {
    paddingHorizontal: 12,
    paddingVertical: 7,
    borderRadius: 999,
    backgroundColor: '#7C5CFF',
  },
  openBtnDone: { backgroundColor: 'rgba(34,197,94,0.16)' },
  openText: {
    fontSize: 11.5,
    fontFamily: FONTS.bodySemiBold,
    color: '#FFFFFF',
  },
  openTextDone: { color: '#22C55E' },
  dialogButtons: {
    flexDirection: 'row',
    gap: 10,
    paddingHorizontal: 8,
    marginTop: 8,
  },
  btnSecondary: {
    flex: 1,
    paddingVertical: 11,
    borderRadius: 12,
    backgroundColor: 'rgba(255,255,255,0.06)',
    alignItems: 'center',
  },
  btnSecondaryText: {
    fontSize: 14,
    fontFamily: FONTS.bodySemiBold,
    color: COLORS.mistLight,
  },
  btnPrimary: {
    flex: 1,
    paddingVertical: 11,
    borderRadius: 12,
    backgroundColor: '#7C5CFF',
    alignItems: 'center',
  },
  btnPrimaryText: {
    fontSize: 14,
    fontFamily: FONTS.bodySemiBold,
    color: '#FFFFFF',
  },
});
