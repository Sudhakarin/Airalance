// components/ManualCropModal.tsx
// Manual crop modal — drag corners to resize, drag frame to move

import { useEffect, useState, useRef, useMemo } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  Modal,
  Image as RNImage,
  PanResponder,
  ScrollView,
} from 'react-native';
import { Image } from 'expo-image';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { COLORS, FONTS } from '../constants/theme';
import { hapticLight } from '../lib/haptics';

type Crop = {
  originX: number;
  originY: number;
  width: number;
  height: number;
};

type Props = {
  visible: boolean;
  imageUri: string;
  onCancel: () => void;
  onApply: (crop: Crop) => void;
};

const MIN_SIZE = 60;

// Aspect-ratio presets (like WhatsApp)
const RATIOS: { key: string; label: string; r: number | null }[] = [
  { key: 'free', label: 'Free', r: null },
  { key: '1:1', label: 'Square', r: 1 },
  { key: '4:5', label: '4:5', r: 4 / 5 },
  { key: '9:16', label: '9:16', r: 9 / 16 },
  { key: '16:9', label: '16:9', r: 16 / 9 },
];

export default function ManualCropModal({
  visible,
  imageUri,
  onCancel,
  onApply,
}: Props) {
  const [imageSize, setImageSize] = useState({ w: 0, h: 0 });
  const [containerSize, setContainerSize] = useState({ w: 0, h: 0 });
  const [displayRect, setDisplayRect] = useState({ x: 0, y: 0, w: 0, h: 0 });
  const [cropRect, setCropRect] = useState({ x: 0, y: 0, w: 0, h: 0 });

  const cropRef = useRef(cropRect);
  cropRef.current = cropRect;
  const displayRef = useRef(displayRect);
  displayRef.current = displayRect;
  const startCropRef = useRef({ x: 0, y: 0, w: 0, h: 0 });
  const ratioRef = useRef<number | null>(null);
  const [ratioKey, setRatioKey] = useState('free');

  // Load image dimensions
  useEffect(() => {
    if (!visible || !imageUri) return;
    RNImage.getSize(
      imageUri,
      (w, h) => setImageSize({ w, h }),
      (err) => console.warn('getSize error:', err)
    );
  }, [visible, imageUri]);

  // Recompute display rect + reset crop
  useEffect(() => {
    if (!containerSize.w || !imageSize.w) return;
    const cAspect = containerSize.w / containerSize.h;
    const iAspect = imageSize.w / imageSize.h;
    let dw, dh;
    if (iAspect > cAspect) {
      dw = containerSize.w;
      dh = dw / iAspect;
    } else {
      dh = containerSize.h;
      dw = dh * iAspect;
    }
    const dx = (containerSize.w - dw) / 2;
    const dy = (containerSize.h - dh) / 2;
    setDisplayRect({ x: dx, y: dy, w: dw, h: dh });
    setCropRect({ x: 0, y: 0, w: dw, h: dh });
    ratioRef.current = null;
    setRatioKey('free');
  }, [containerSize, imageSize]);

  // Whole-frame drag
  const movePan = useMemo(
    () =>
      PanResponder.create({
        onStartShouldSetPanResponder: () => true,
        onMoveShouldSetPanResponder: () => true,
        onPanResponderGrant: () => {
          startCropRef.current = { ...cropRef.current };
        },
        onPanResponderMove: (_, g) => {
          const s = startCropRef.current;
          const d = displayRef.current;
          let nx = s.x + g.dx;
          let ny = s.y + g.dy;
          if (nx < 0) nx = 0;
          if (ny < 0) ny = 0;
          if (nx + s.w > d.w) nx = d.w - s.w;
          if (ny + s.h > d.h) ny = d.h - s.h;
          setCropRect({ x: nx, y: ny, w: s.w, h: s.h });
        },
      }),
    []
  );

  // Corner drag generator
  const makeCornerPan = (corner: 'tl' | 'tr' | 'bl' | 'br') =>
    PanResponder.create({
      onStartShouldSetPanResponder: () => true,
      onMoveShouldSetPanResponder: () => true,
      onPanResponderGrant: () => {
        startCropRef.current = { ...cropRef.current };
      },
      onPanResponderMove: (_, g) => {
        const s = startCropRef.current;
        const d = displayRef.current;

        // Locked aspect ratio → opposite corner stays fixed
        const r = ratioRef.current;
        if (r) {
          const right = s.x + s.w;
          const bottom = s.y + s.h;
          let w: number;
          let maxW: number;
          if (corner === 'br') {
            w = s.w + g.dx;
            maxW = Math.min(d.w - s.x, (d.h - s.y) * r);
          } else if (corner === 'tr') {
            w = s.w + g.dx;
            maxW = Math.min(d.w - s.x, bottom * r);
          } else if (corner === 'bl') {
            w = s.w - g.dx;
            maxW = Math.min(right, (d.h - s.y) * r);
          } else {
            w = s.w - g.dx;
            maxW = Math.min(right, bottom * r);
          }
          const minW = Math.max(MIN_SIZE, MIN_SIZE * r);
          w = Math.max(minW, Math.min(maxW, w));
          const h = w / r;
          setCropRect({
            x: corner === 'tl' || corner === 'bl' ? right - w : s.x,
            y: corner === 'tl' || corner === 'tr' ? bottom - h : s.y,
            w,
            h,
          });
          return;
        }

        let nx = s.x;
        let ny = s.y;
        let nw = s.w;
        let nh = s.h;

        if (corner === 'tl') {
          const rightEdge = s.x + s.w;
          const bottomEdge = s.y + s.h;
          nx = Math.max(0, s.x + g.dx);
          ny = Math.max(0, s.y + g.dy);
          nw = Math.max(MIN_SIZE, rightEdge - nx);
          nh = Math.max(MIN_SIZE, bottomEdge - ny);
        } else if (corner === 'tr') {
          const bottomEdge = s.y + s.h;
          ny = Math.max(0, s.y + g.dy);
          nw = Math.max(MIN_SIZE, Math.min(d.w - s.x, s.w + g.dx));
          nh = Math.max(MIN_SIZE, bottomEdge - ny);
        } else if (corner === 'bl') {
          const rightEdge = s.x + s.w;
          nx = Math.max(0, s.x + g.dx);
          nw = Math.max(MIN_SIZE, rightEdge - nx);
          nh = Math.max(MIN_SIZE, Math.min(d.h - s.y, s.h + g.dy));
        } else {
          nw = Math.max(MIN_SIZE, Math.min(d.w - s.x, s.w + g.dx));
          nh = Math.max(MIN_SIZE, Math.min(d.h - s.y, s.h + g.dy));
        }

        setCropRect({ x: nx, y: ny, w: nw, h: nh });
      },
    });

  const tlPan = useMemo(() => makeCornerPan('tl'), []);
  const trPan = useMemo(() => makeCornerPan('tr'), []);
  const blPan = useMemo(() => makeCornerPan('bl'), []);
  const brPan = useMemo(() => makeCornerPan('br'), []);

  // Apply — map display coords → image coords
  const handleApply = () => {
    hapticLight();
    if (!displayRect.w || !imageSize.w) return;
    const sx = imageSize.w / displayRect.w;
    const sy = imageSize.h / displayRect.h;
    onApply({
      originX: Math.max(0, Math.round(cropRect.x * sx)),
      originY: Math.max(0, Math.round(cropRect.y * sy)),
      width: Math.max(1, Math.round(cropRect.w * sx)),
      height: Math.max(1, Math.round(cropRect.h * sy)),
    });
  };

  const handleReset = () => {
    hapticLight();
    if (!displayRect.w) return;
    ratioRef.current = null;
    setRatioKey('free');
    setCropRect({ x: 0, y: 0, w: displayRect.w, h: displayRect.h });
  };

  const applyRatio = (key: string, r: number | null) => {
    hapticLight();
    setRatioKey(key);
    ratioRef.current = r;
    const d = displayRef.current;
    if (!r || !d.w) return;
    const w = Math.min(d.w, d.h * r);
    const h = w / r;
    setCropRect({ x: (d.w - w) / 2, y: (d.h - h) / 2, w, h });
  };

  return (
    <Modal
      visible={visible}
      animationType="slide"
      onRequestClose={onCancel}
      statusBarTranslucent
    >
      <View style={styles.root}>
        <SafeAreaView style={{ flex: 1 }} edges={['top', 'bottom']}>
          {/* Header */}
          <View style={styles.header}>
            <TouchableOpacity
              style={styles.headerBtn}
              onPress={onCancel}
              activeOpacity={0.7}
            >
              <Ionicons name="close" size={22} color="#FFFFFF" />
            </TouchableOpacity>
            <Text style={styles.headerTitle}>Crop</Text>
            <TouchableOpacity
              style={styles.headerDone}
              onPress={handleApply}
              activeOpacity={0.7}
            >
              <Text style={styles.headerDoneText}>Done</Text>
            </TouchableOpacity>
          </View>

          {/* Image + crop overlay */}
          <View
            style={styles.container}
            onLayout={(e) => {
              const { width, height } = e.nativeEvent.layout;
              setContainerSize({ w: width, h: height });
            }}
          >
            {displayRect.w > 0 && (
              <>
                {/* Image */}
                <Image
                  source={{ uri: imageUri }}
                  style={{
                    position: 'absolute',
                    left: displayRect.x,
                    top: displayRect.y,
                    width: displayRect.w,
                    height: displayRect.h,
                  }}
                  contentFit="fill"
                />

                {/* Dim overlays (4 pieces around crop) */}
                <View
                  style={[
                    styles.dim,
                    {
                      left: displayRect.x,
                      top: displayRect.y,
                      width: displayRect.w,
                      height: cropRect.y,
                    },
                  ]}
                />
                <View
                  style={[
                    styles.dim,
                    {
                      left: displayRect.x,
                      top: displayRect.y + cropRect.y + cropRect.h,
                      width: displayRect.w,
                      height:
                        displayRect.h - cropRect.y - cropRect.h > 0
                          ? displayRect.h - cropRect.y - cropRect.h
                          : 0,
                    },
                  ]}
                />
                <View
                  style={[
                    styles.dim,
                    {
                      left: displayRect.x,
                      top: displayRect.y + cropRect.y,
                      width: cropRect.x,
                      height: cropRect.h,
                    },
                  ]}
                />
                <View
                  style={[
                    styles.dim,
                    {
                      left: displayRect.x + cropRect.x + cropRect.w,
                      top: displayRect.y + cropRect.y,
                      width:
                        displayRect.w - cropRect.x - cropRect.w > 0
                          ? displayRect.w - cropRect.x - cropRect.w
                          : 0,
                      height: cropRect.h,
                    },
                  ]}
                />

                {/* Crop frame (drag to move) */}
                <View
                  style={[
                    styles.frame,
                    {
                      left: displayRect.x + cropRect.x,
                      top: displayRect.y + cropRect.y,
                      width: cropRect.w,
                      height: cropRect.h,
                    },
                  ]}
                  {...movePan.panHandlers}
                >
                  <View style={styles.grid} pointerEvents="none">
                    <View style={[styles.gridV, { left: '33.33%' }]} />
                    <View style={[styles.gridV, { left: '66.66%' }]} />
                    <View style={[styles.gridH, { top: '33.33%' }]} />
                    <View style={[styles.gridH, { top: '66.66%' }]} />
                  </View>
                </View>

                {/* Corner handles */}
                <View
                  style={[
                    styles.corner,
                    {
                      left: displayRect.x + cropRect.x - 16,
                      top: displayRect.y + cropRect.y - 16,
                    },
                  ]}
                  {...tlPan.panHandlers}
                >
                  <View style={[styles.cornerLine, styles.cornerTL]} />
                </View>
                <View
                  style={[
                    styles.corner,
                    {
                      left:
                        displayRect.x + cropRect.x + cropRect.w - 16,
                      top: displayRect.y + cropRect.y - 16,
                    },
                  ]}
                  {...trPan.panHandlers}
                >
                  <View style={[styles.cornerLine, styles.cornerTR]} />
                </View>
                <View
                  style={[
                    styles.corner,
                    {
                      left: displayRect.x + cropRect.x - 16,
                      top:
                        displayRect.y + cropRect.y + cropRect.h - 16,
                    },
                  ]}
                  {...blPan.panHandlers}
                >
                  <View style={[styles.cornerLine, styles.cornerBL]} />
                </View>
                <View
                  style={[
                    styles.corner,
                    {
                      left:
                        displayRect.x + cropRect.x + cropRect.w - 16,
                      top:
                        displayRect.y + cropRect.y + cropRect.h - 16,
                    },
                  ]}
                  {...brPan.panHandlers}
                >
                  <View style={[styles.cornerLine, styles.cornerBR]} />
                </View>
              </>
            )}
          </View>

          {/* Bottom action */}
          <View style={styles.bottom}>
            <ScrollView
              horizontal
              showsHorizontalScrollIndicator={false}
              contentContainerStyle={styles.ratioRow}
              style={styles.ratioScroll}
            >
              {RATIOS.map((o) => (
                <TouchableOpacity
                  key={o.key}
                  onPress={() => applyRatio(o.key, o.r)}
                  activeOpacity={0.75}
                  style={[
                    styles.ratioChip,
                    ratioKey === o.key && styles.ratioChipActive,
                  ]}
                >
                  <Text
                    style={[
                      styles.ratioText,
                      ratioKey === o.key && styles.ratioTextActive,
                    ]}
                  >
                    {o.label}
                  </Text>
                </TouchableOpacity>
              ))}
            </ScrollView>
            <TouchableOpacity
              style={styles.resetBtn}
              onPress={handleReset}
              activeOpacity={0.7}
            >
              <Ionicons name="refresh-outline" size={18} color="#FFFFFF" />
              <Text style={styles.resetText}>Reset</Text>
            </TouchableOpacity>
          </View>
        </SafeAreaView>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: '#000' },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 14,
    paddingVertical: 10,
  },
  headerBtn: {
    width: 40,
    height: 40,
    alignItems: 'center',
    justifyContent: 'center',
  },
  headerTitle: {
    fontSize: 15,
    fontFamily: FONTS.displayBold,
    color: '#FFFFFF',
  },
  headerDone: { paddingHorizontal: 12, paddingVertical: 8 },
  headerDoneText: {
    fontSize: 15,
    fontFamily: FONTS.bodySemiBold,
    color: COLORS.violetLight,
  },

  container: { flex: 1, position: 'relative', overflow: 'hidden' },

  dim: {
    position: 'absolute',
    backgroundColor: 'rgba(0,0,0,0.65)',
  },

  frame: {
    position: 'absolute',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.9)',
  },
  grid: { ...StyleSheet.absoluteFillObject },
  gridV: {
    position: 'absolute',
    top: 0,
    bottom: 0,
    width: 1,
    backgroundColor: 'rgba(255,255,255,0.25)',
  },
  gridH: {
    position: 'absolute',
    left: 0,
    right: 0,
    height: 1,
    backgroundColor: 'rgba(255,255,255,0.25)',
  },

  corner: {
    position: 'absolute',
    width: 32,
    height: 32,
    alignItems: 'center',
    justifyContent: 'center',
  },
  cornerLine: {
    width: 20,
    height: 20,
    borderColor: '#FFFFFF',
  },
  cornerTL: { borderTopWidth: 3, borderLeftWidth: 3 },
  cornerTR: { borderTopWidth: 3, borderRightWidth: 3 },
  cornerBL: { borderBottomWidth: 3, borderLeftWidth: 3 },
  cornerBR: { borderBottomWidth: 3, borderRightWidth: 3 },

  bottom: {
    paddingHorizontal: 14,
    paddingVertical: 12,
    alignItems: 'center',
    gap: 12,
  },
  ratioScroll: { flexGrow: 0 },
  ratioRow: { gap: 8, paddingHorizontal: 2 },
  ratioChip: {
    paddingHorizontal: 14,
    paddingVertical: 7,
    borderRadius: 18,
    backgroundColor: 'rgba(255,255,255,0.08)',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.12)',
  },
  ratioChipActive: {
    backgroundColor: 'rgba(124,92,255,0.35)',
    borderColor: 'rgba(124,92,255,0.8)',
  },
  ratioText: {
    fontSize: 13,
    fontFamily: FONTS.bodySemiBold,
    color: 'rgba(255,255,255,0.75)',
  },
  ratioTextActive: { color: '#FFFFFF' },
  resetBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: 16,
    paddingVertical: 8,
    borderRadius: 20,
    backgroundColor: 'rgba(255,255,255,0.1)',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.15)',
  },
  resetText: {
    fontSize: 13.5,
    fontFamily: FONTS.bodySemiBold,
    color: '#FFFFFF',
  },
});
