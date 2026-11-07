// components/InAppCamera.tsx
// WhatsApp-style in-app camera: stays inside your app (no system camera app,
// so Android can't kill/restart the app). Photo + video (max 60s), flip, flash.
// Needs: npx expo install expo-camera

import { useEffect, useRef, useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  Modal,
  Alert,
  Linking,
  ActivityIndicator,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { COLORS, FONTS } from '../constants/theme';
import { hapticLight, hapticMedium } from '../lib/haptics';
import type { PickedMedia } from './MediaPickerSheet';

// expo-camera is loaded safely: if the installed APK was built WITHOUT the
// native module, require() throws -> we fall back to the system camera
// instead of crashing the app (so OTA updates stay safe on old builds).
let Cam: any = null;
try {
  Cam = require('expo-camera');
} catch {
  Cam = null;
}
export const IN_APP_CAMERA_AVAILABLE = !!Cam?.CameraView;

type Props = {
  visible: boolean;
  onClose: () => void;
  onCapture: (item: PickedMedia) => void;
};

const MAX_VIDEO_SECONDS = 60;

function fmt(sec: number) {
  const s = Math.max(0, Math.round(sec));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}

export default function InAppCamera(props: Props) {
  if (!IN_APP_CAMERA_AVAILABLE) return null;
  return <CameraInner {...props} />;
}

function CameraInner({ visible, onClose, onCapture }: Props) {
  const { CameraView, useCameraPermissions, useMicrophonePermissions } = Cam;
  const camRef = useRef<any>(null);
  const [camPerm, requestCam] = useCameraPermissions();
  const [micPerm, requestMic] = useMicrophonePermissions();

  const [facing, setFacing] = useState<'back' | 'front'>('back');
  const [flash, setFlash] = useState<'off' | 'on'>('off');
  const [mode, setMode] = useState<'picture' | 'video'>('picture');
  const [ready, setReady] = useState(false);
  const [busy, setBusy] = useState(false);
  const [recording, setRecording] = useState(false);
  const [secs, setSecs] = useState(0);

  const startedAt = useRef(0);
  const timer = useRef<ReturnType<typeof setInterval> | null>(null);

  useEffect(() => {
    if (!visible) return;
    setReady(false);
    setMode('picture');
    setFlash('off');
    setRecording(false);
    setSecs(0);
    if (camPerm && !camPerm.granted && camPerm.canAskAgain) requestCam();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [visible]);

  useEffect(() => {
    return () => {
      if (timer.current) clearInterval(timer.current);
    };
  }, []);

  function stopTimer() {
    if (timer.current) clearInterval(timer.current);
    timer.current = null;
  }

  async function takePhoto() {
    if (busy || !ready) return;
    setBusy(true);
    try {
      hapticMedium();
      const pic = await camRef.current?.takePictureAsync({ quality: 1 });
      if (!pic?.uri) return;
      onCapture({
        uri: pic.uri,
        type: 'image',
        width: pic.width,
        height: pic.height,
        duration: 0,
      });
    } catch (err) {
      console.warn('[camera] photo error:', err);
      Alert.alert('Camera', 'Could not take the photo. Please try again.');
    } finally {
      setBusy(false);
    }
  }

  async function toggleRecord() {
    if (recording) {
      camRef.current?.stopRecording();
      return;
    }
    if (!ready) return;
    if (!micPerm?.granted) {
      const r = await requestMic();
      if (!r.granted) {
        Alert.alert('Permission needed', 'Please allow microphone access to record video.');
        return;
      }
    }
    try {
      hapticMedium();
      setRecording(true);
      setSecs(0);
      startedAt.current = Date.now();
      timer.current = setInterval(() => {
        setSecs(Math.floor((Date.now() - startedAt.current) / 1000));
      }, 250);

      const vid = await camRef.current?.recordAsync({ maxDuration: MAX_VIDEO_SECONDS });

      stopTimer();
      setRecording(false);
      const elapsed = (Date.now() - startedAt.current) / 1000;
      if (vid?.uri && elapsed > 0.8) {
        onCapture({
          uri: vid.uri,
          type: 'video',
          width: 1080,
          height: 1920,
          duration: Math.min(elapsed, MAX_VIDEO_SECONDS),
        });
      }
    } catch (err) {
      console.warn('[camera] record error:', err);
      stopTimer();
      setRecording(false);
      Alert.alert('Camera', 'Could not record the video. Please try again.');
    }
  }

  function close() {
    if (recording) camRef.current?.stopRecording();
    stopTimer();
    onClose();
  }

  const granted = !!camPerm?.granted;

  return (
    <Modal
      visible={visible}
      animationType="slide"
      onRequestClose={close}
      statusBarTranslucent
    >
      <View style={styles.root}>
        {!camPerm ? (
          <View style={styles.center}>
            <ActivityIndicator color="#FFFFFF" />
          </View>
        ) : !granted ? (
          <View style={styles.center}>
            <Ionicons name="camera-outline" size={46} color={COLORS.mist} />
            <Text style={styles.deniedText}>Allow camera access to take photos and videos.</Text>
            <TouchableOpacity
              style={styles.permBtn}
              onPress={() => (camPerm.canAskAgain ? requestCam() : Linking.openSettings())}
            >
              <Text style={styles.permBtnText}>
                {camPerm.canAskAgain ? 'Allow camera' : 'Open settings'}
              </Text>
            </TouchableOpacity>
          </View>
        ) : (
          <CameraView
            ref={camRef}
            style={StyleSheet.absoluteFill}
            facing={facing}
            mode={mode}
            flash={flash}
            enableTorch={mode === 'video' && flash === 'on'}
            onCameraReady={() => setReady(true)}
          />
        )}

        <SafeAreaView style={styles.top} edges={['top']} pointerEvents="box-none">
          <TouchableOpacity style={styles.roundBtn} onPress={close} hitSlop={10}>
            <Ionicons name="close" size={24} color="#FFFFFF" />
          </TouchableOpacity>
          {recording ? (
            <View style={styles.timerPill}>
              <View style={styles.dot} />
              <Text style={styles.timerText}>{fmt(secs)}</Text>
            </View>
          ) : (
            <View />
          )}
          <TouchableOpacity
            style={styles.roundBtn}
            onPress={() => {
              hapticLight();
              setFlash((f) => (f === 'on' ? 'off' : 'on'));
            }}
            hitSlop={10}
          >
            <Ionicons
              name={flash === 'on' ? 'flash' : 'flash-off'}
              size={22}
              color="#FFFFFF"
            />
          </TouchableOpacity>
        </SafeAreaView>

        {granted && (
          <SafeAreaView style={styles.bottom} edges={['bottom']} pointerEvents="box-none">
            {!recording && (
              <View style={styles.modeRow}>
                <TouchableOpacity onPress={() => setMode('picture')} hitSlop={8}>
                  <Text style={[styles.modeText, mode === 'picture' && styles.modeOn]}>Photo</Text>
                </TouchableOpacity>
                <TouchableOpacity onPress={() => setMode('video')} hitSlop={8}>
                  <Text style={[styles.modeText, mode === 'video' && styles.modeOn]}>Video</Text>
                </TouchableOpacity>
              </View>
            )}
            <View style={styles.controls}>
              <View style={styles.side} />
              <TouchableOpacity
                activeOpacity={0.8}
                onPress={mode === 'picture' ? takePhoto : toggleRecord}
                style={[styles.shutterRing, recording && styles.shutterRingRec]}
              >
                {busy ? (
                  <ActivityIndicator color="#0A0C12" />
                ) : (
                  <View
                    style={[
                      styles.shutterCore,
                      mode === 'video' && styles.shutterCoreVideo,
                      recording && styles.shutterCoreRec,
                    ]}
                  />
                )}
              </TouchableOpacity>
              <View style={styles.side}>
                {!recording && (
                  <TouchableOpacity
                    style={styles.roundBtn}
                    onPress={() => {
                      hapticLight();
                      setFacing((f) => (f === 'back' ? 'front' : 'back'));
                    }}
                    hitSlop={10}
                  >
                    <Ionicons name="camera-reverse-outline" size={26} color="#FFFFFF" />
                  </TouchableOpacity>
                )}
              </View>
            </View>
          </SafeAreaView>
        )}
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: '#000' },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: 14, padding: 30 },
  deniedText: { color: COLORS.mistLight, fontSize: 14, textAlign: 'center', fontFamily: FONTS.body },
  permBtn: {
    paddingHorizontal: 18,
    paddingVertical: 10,
    borderRadius: 18,
    backgroundColor: COLORS.violet,
  },
  permBtnText: { color: '#FFFFFF', fontFamily: FONTS.bodySemiBold, fontSize: 14 },

  top: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 14,
    paddingTop: 8,
  },
  roundBtn: {
    width: 42,
    height: 42,
    borderRadius: 21,
    backgroundColor: 'rgba(0,0,0,0.4)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  timerPill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 14,
    backgroundColor: 'rgba(0,0,0,0.5)',
  },
  dot: { width: 8, height: 8, borderRadius: 4, backgroundColor: COLORS.danger },
  timerText: { color: '#FFFFFF', fontSize: 14, fontFamily: FONTS.bodyMedium },

  bottom: { position: 'absolute', left: 0, right: 0, bottom: 0, paddingBottom: 14 },
  modeRow: { flexDirection: 'row', justifyContent: 'center', gap: 28, marginBottom: 14 },
  modeText: { color: 'rgba(255,255,255,0.6)', fontSize: 15, fontFamily: FONTS.bodyMedium },
  modeOn: { color: '#FFFFFF', fontFamily: FONTS.bodySemiBold },
  controls: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 30,
  },
  side: { width: 52, alignItems: 'center' },
  shutterRing: {
    width: 78,
    height: 78,
    borderRadius: 39,
    borderWidth: 4,
    borderColor: '#FFFFFF',
    alignItems: 'center',
    justifyContent: 'center',
  },
  shutterRingRec: { borderColor: COLORS.danger },
  shutterCore: { width: 62, height: 62, borderRadius: 31, backgroundColor: '#FFFFFF' },
  shutterCoreVideo: { backgroundColor: COLORS.danger },
  shutterCoreRec: { width: 30, height: 30, borderRadius: 7, backgroundColor: COLORS.danger },
});
