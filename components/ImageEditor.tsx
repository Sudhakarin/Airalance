// components/ImageEditor.tsx
// WhatsApp-style pre-send image editor: crop (free + ratios) / rotate / draw / text / caption.
// What you see after "Done" is exactly what gets uploaded (crop is applied to real pixels).
//
// Needs:  npx expo install expo-image-manipulator react-native-svg react-native-view-shot

import { useEffect, useMemo, useRef, useState } from 'react';
import {
  View,
  Text,
  Modal,
  TouchableOpacity,
  TextInput,
  StyleSheet,
  PanResponder,
  Image as RNImage,
  ActivityIndicator,
  KeyboardAvoidingView,
  Platform,
  LayoutChangeEvent,
  Alert,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import * as ImageManipulator from 'expo-image-manipulator';
import Svg, { Path } from 'react-native-svg';
import { captureRef } from 'react-native-view-shot';
import { FONTS } from '../constants/theme';

export type EditedImage = {
  uri: string;
  width: number;
  height: number;
  caption: string;
};

type Props = {
  visible: boolean;
  uri: string | null;
  recipientName?: string;
  onClose: () => void;
  onSend: (img: EditedImage) => void;
};

type Pt = { x: number; y: number }; // normalized 0..1
type Stroke = { color: string; pts: Pt[] };
type TextItem = { id: string; text: string; color: string; x: number; y: number };
type Rect = { x: number; y: number; w: number; h: number };
type Cur = { uri: string; w: number; h: number };
type Tool = null | 'draw' | 'text' | 'crop';

const PALETTE = ['#FFFFFF', '#FF3B30', '#FFD60A', '#34C759', '#0A84FF', '#BF5AF2', '#000000'];
const RATIOS: { label: string; v: number }[] = [
  { label: 'Free', v: 0 },
  { label: '1:1', v: 1 },
  { label: '4:3', v: 4 / 3 },
  { label: '16:9', v: 16 / 9 },
  { label: '3:4', v: 3 / 4 },
];
const MAX_SIDE = 2048;
const MIN_CROP = 56;
const ACCENT = '#7C5CFF';
const HANDLES = ['tl', 'tr', 'bl', 'br', 't', 'b', 'l', 'r'] as const;

const clamp = (v: number, a: number, b: number) => Math.max(a, Math.min(b, v));

function fullRect(d: { w: number; h: number }, ratio: number): Rect {
  let w = d.w;
  let h = d.h;
  if (ratio) {
    if (d.w / d.h > ratio) w = d.h * ratio;
    else h = d.w / ratio;
  }
  return { x: (d.w - w) / 2, y: (d.h - h) / 2, w, h };
}

function resizeRect(
  m: string,
  o: Rect,
  dx: number,
  dy: number,
  d: { w: number; h: number },
  ratio: number
): Rect {
  if (m === 'mv') {
    return {
      ...o,
      x: clamp(o.x + dx, 0, d.w - o.w),
      y: clamp(o.y + dy, 0, d.h - o.h),
    };
  }
  let l = o.x;
  let t = o.y;
  let r = o.x + o.w;
  let b = o.y + o.h;
  if (m.includes('l')) l = clamp(o.x + dx, 0, r - MIN_CROP);
  if (m.includes('r')) r = clamp(r + dx, l + MIN_CROP, d.w);
  if (m.includes('t')) t = clamp(o.y + dy, 0, b - MIN_CROP);
  if (m.includes('b')) b = clamp(b + dy, t + MIN_CROP, d.h);
  if (ratio && m.length === 2) {
    let w = r - l;
    let h = w / ratio;
    const top = m.includes('t');
    const maxH = top ? b : d.h - t;
    if (h > maxH) {
      h = maxH;
      w = h * ratio;
    }
    if (m.includes('l')) l = r - w;
    else r = l + w;
    if (top) t = b - h;
    else b = t + h;
  }
  return { x: l, y: t, w: r - l, h: b - t };
}

export default function ImageEditor({
  visible,
  uri,
  recipientName,
  onClose,
  onSend,
}: Props) {
  const [cur, setCur] = useState<Cur | null>(null);
  const [strokes, setStrokes] = useState<Stroke[]>([]);
  const [texts, setTexts] = useState<TextItem[]>([]);
  const [ops, setOps] = useState<('s' | 't')[]>([]);
  const [live, setLive] = useState<Stroke | null>(null);
  const [tool, setTool] = useState<Tool>(null);
  const [color, setColor] = useState('#FF3B30');
  const [textDraft, setTextDraft] = useState('');
  const [caption, setCaption] = useState('');
  const [busy, setBusy] = useState(false);
  const [stage, setStage] = useState({ w: 0, h: 0 });
  const [ratio, setRatio] = useState(0);
  const [crop, setCrop] = useState<Rect>({ x: 0, y: 0, w: 0, h: 0 });

  const shotRef = useRef<View>(null);

  // ---- displayed (fit) size of the current image ----
  const disp = useMemo(() => {
    if (!cur || !stage.w || !stage.h) return { w: 0, h: 0 };
    const k = Math.min(stage.w / cur.w, stage.h / cur.h);
    return { w: Math.round(cur.w * k), h: Math.round(cur.h * k) };
  }, [cur, stage]);

  // refs so PanResponders always see fresh values
  const toolRef = useRef<Tool>(null);
  const dispRef = useRef(disp);
  const colorRef = useRef(color);
  const textRef = useRef(textDraft);
  const cropRef = useRef(crop);
  const ratioRef = useRef(ratio);
  toolRef.current = tool;
  dispRef.current = disp;
  colorRef.current = color;
  textRef.current = textDraft;
  cropRef.current = crop;
  ratioRef.current = ratio;

  // ---- load + normalize picked image (fix EXIF rotation, cap size) ----
  useEffect(() => {
    if (!visible || !uri) return;
    let alive = true;
    setCur(null);
    setStrokes([]);
    setTexts([]);
    setOps([]);
    setTool(null);
    setCaption('');
    setTextDraft('');
    setRatio(0);
    (async () => {
      try {
        const info = await new Promise<{ w: number; h: number }>((res, rej) =>
          RNImage.getSize(uri, (w, h) => res({ w, h }), rej)
        );
        const big = Math.max(info.w, info.h) > MAX_SIDE;
        const actions: ImageManipulator.Action[] = big
          ? [
              info.w >= info.h
                ? { resize: { width: MAX_SIDE } }
                : { resize: { height: MAX_SIDE } },
            ]
          : [];
        const out = await ImageManipulator.manipulateAsync(uri, actions, {
          compress: 1,
          format: ImageManipulator.SaveFormat.JPEG,
        });
        if (alive) setCur({ uri: out.uri, w: out.width, h: out.height });
      } catch (e) {
        console.warn('[ImageEditor] load error', e);
        if (alive) {
          Alert.alert('Error', 'Could not open this photo.');
          onClose();
        }
      }
    })();
    return () => {
      alive = false;
    };
  }, [visible, uri]);

  // ---- draw / text gestures ----
  const curStroke = useRef<Stroke | null>(null);
  const startPt = useRef<Pt>({ x: 0, y: 0 });
  const moved = useRef(false);

  const canvasPR = useRef(
    PanResponder.create({
      onStartShouldSetPanResponder: () =>
        toolRef.current === 'draw' || toolRef.current === 'text',
      onMoveShouldSetPanResponder: () => toolRef.current === 'draw',
      onPanResponderGrant: (e) => {
        const d = dispRef.current;
        const p = {
          x: clamp(e.nativeEvent.locationX / d.w, 0, 1),
          y: clamp(e.nativeEvent.locationY / d.h, 0, 1),
        };
        startPt.current = p;
        moved.current = false;
        if (toolRef.current === 'draw') {
          curStroke.current = { color: colorRef.current, pts: [p] };
          setLive({ ...curStroke.current });
        }
      },
      onPanResponderMove: (e) => {
        if (toolRef.current !== 'draw' || !curStroke.current) return;
        const d = dispRef.current;
        moved.current = true;
        curStroke.current.pts.push({
          x: clamp(e.nativeEvent.locationX / d.w, 0, 1),
          y: clamp(e.nativeEvent.locationY / d.h, 0, 1),
        });
        setLive({
          color: curStroke.current.color,
          pts: [...curStroke.current.pts],
        });
      },
      onPanResponderRelease: () => {
        if (toolRef.current === 'draw' && curStroke.current) {
          const s = curStroke.current;
          curStroke.current = null;
          setLive(null);
          setStrokes((a) => [...a, s]);
          setOps((o) => [...o, 's']);
        } else if (toolRef.current === 'text') {
          const t = textRef.current.trim();
          if (!t) return;
          const p = startPt.current;
          setTexts((a) => [
            ...a,
            { id: String(Date.now()), text: t, color: colorRef.current, x: p.x, y: p.y },
          ]);
          setOps((o) => [...o, 't']);
          setTextDraft('');
        }
      },
      onPanResponderTerminate: () => {
        curStroke.current = null;
        setLive(null);
      },
    })
  ).current;

  function undo() {
    const last = ops[ops.length - 1];
    if (!last) return;
    setOps((o) => o.slice(0, -1));
    if (last === 's') setStrokes((a) => a.slice(0, -1));
    else setTexts((a) => a.slice(0, -1));
  }

  // ---- crop handles ----
  const dragStart = useRef<Rect>({ x: 0, y: 0, w: 0, h: 0 });
  const prs = useRef<Record<string, any>>({});
  if (!prs.current.mv) {
    for (const m of ['mv', ...HANDLES]) {
      prs.current[m] = PanResponder.create({
        onStartShouldSetPanResponder: () => true,
        onPanResponderGrant: () => {
          dragStart.current = { ...cropRef.current };
        },
        onPanResponderMove: (_e, g) => {
          setCrop(
            resizeRect(m, dragStart.current, g.dx, g.dy, dispRef.current, ratioRef.current)
          );
        },
      });
    }
  }

  function enterCrop() {
    setTool('crop');
    setRatio(0);
    setCrop(fullRect(disp, 0));
  }
  function pickRatio(v: number) {
    setRatio(v);
    setCrop(fullRect(disp, v));
  }

  // ---- bake drawings/text into pixels ----
  async function bake(): Promise<Cur> {
    if (!cur) throw new Error('no image');
    if (strokes.length === 0 && texts.length === 0) return cur;
    const out = await captureRef(shotRef, {
      format: 'jpg',
      quality: 1,
      result: 'tmpfile',
      width: cur.w,
      height: cur.h,
    });
    return { uri: out, w: cur.w, h: cur.h };
  }

  async function applyCrop() {
    if (!cur) return;
    setBusy(true);
    try {
      const base = await bake();
      const k = base.w / disp.w;
      const originX = clamp(Math.round(crop.x * k), 0, base.w - 1);
      const originY = clamp(Math.round(crop.y * k), 0, base.h - 1);
      const width = clamp(Math.round(crop.w * k), 1, base.w - originX);
      const height = clamp(Math.round(crop.h * k), 1, base.h - originY);
      const out = await ImageManipulator.manipulateAsync(
        base.uri,
        [{ crop: { originX, originY, width, height } }],
        { compress: 1, format: ImageManipulator.SaveFormat.JPEG }
      );
      setCur({ uri: out.uri, w: out.width, h: out.height });
      setStrokes([]);
      setTexts([]);
      setOps([]);
      setTool(null);
    } catch (e) {
      console.warn('[ImageEditor] crop error', e);
      Alert.alert('Crop failed', 'Please try again.');
    } finally {
      setBusy(false);
    }
  }

  async function rotate() {
    if (!cur) return;
    setBusy(true);
    try {
      const base = await bake();
      const out = await ImageManipulator.manipulateAsync(base.uri, [{ rotate: 90 }], {
        compress: 1,
        format: ImageManipulator.SaveFormat.JPEG,
      });
      setCur({ uri: out.uri, w: out.width, h: out.height });
      setStrokes([]);
      setTexts([]);
      setOps([]);
      setRatio(0);
      setTimeout(() => {}, 0);
    } catch (e) {
      console.warn('[ImageEditor] rotate error', e);
    } finally {
      setBusy(false);
    }
  }

  // after crop frame is open and image rotated, reset the frame once new disp is known
  useEffect(() => {
    if (tool === 'crop' && disp.w) setCrop(fullRect(disp, ratioRef.current));
  }, [disp.w, disp.h]);

  async function send() {
    if (!cur || busy) return;
    setBusy(true);
    try {
      const base = await bake();
      // final compress pass (keeps exact cropped dimensions)
      const out = await ImageManipulator.manipulateAsync(base.uri, [], {
        compress: 0.8,
        format: ImageManipulator.SaveFormat.JPEG,
      });
      onSend({ uri: out.uri, width: out.width, height: out.height, caption: caption.trim() });
    } catch (e) {
      console.warn('[ImageEditor] send error', e);
      Alert.alert('Error', 'Could not prepare the photo.');
    } finally {
      setBusy(false);
    }
  }

  function onStageLayout(e: LayoutChangeEvent) {
    const { width, height } = e.nativeEvent.layout;
    setStage({ w: Math.max(0, width - 16), h: Math.max(0, height - 16) });
  }

  const cropping = tool === 'crop';
  const fs = Math.max(14, disp.w / 11);

  function pathD(pts: Pt[]) {
    if (pts.length === 1) {
      const p = pts[0];
      return `M ${p.x * disp.w} ${p.y * disp.h} l 0.01 0`;
    }
    return pts.map((p, i) => `${i ? 'L' : 'M'} ${p.x * disp.w} ${p.y * disp.h}`).join(' ');
  }

  return (
    <Modal visible={visible} animationType="fade" onRequestClose={onClose} statusBarTranslucent>
      <SafeAreaView style={s.root} edges={['top', 'bottom']}>
        {/* ---------- top bars ---------- */}
        {cropping ? (
          <View style={s.top}>
            <TouchableOpacity style={s.textBtn} onPress={() => setTool(null)}>
              <Text style={s.textBtnT}>Cancel</Text>
            </TouchableOpacity>
            <View style={{ flex: 1 }} />
            <TouchableOpacity style={s.round} onPress={rotate} disabled={busy}>
              <Ionicons name="refresh" size={22} color="#fff" />
            </TouchableOpacity>
            <TouchableOpacity style={s.textBtn} onPress={() => pickRatio(0)}>
              <Text style={s.textBtnT}>Reset</Text>
            </TouchableOpacity>
            <View style={{ flex: 1 }} />
            <TouchableOpacity style={s.textBtn} onPress={applyCrop} disabled={busy}>
              <Text style={[s.textBtnT, { color: '#00D4B4' }]}>Done</Text>
            </TouchableOpacity>
          </View>
        ) : (
          <View style={s.top}>
            <TouchableOpacity style={s.round} onPress={onClose}>
              <Ionicons name="close" size={24} color="#fff" />
            </TouchableOpacity>
            <View style={{ flex: 1 }} />
            {ops.length > 0 && (
              <TouchableOpacity style={s.round} onPress={undo}>
                <Ionicons name="arrow-undo" size={22} color="#fff" />
              </TouchableOpacity>
            )}
            <TouchableOpacity style={s.round} onPress={enterCrop} disabled={!cur}>
              <Ionicons name="crop" size={22} color="#fff" />
            </TouchableOpacity>
            <TouchableOpacity
              style={[s.round, tool === 'text' && s.roundOn]}
              onPress={() => setTool(tool === 'text' ? null : 'text')}
            >
              <Ionicons name="text" size={22} color="#fff" />
            </TouchableOpacity>
            <TouchableOpacity
              style={[s.round, tool === 'draw' && s.roundOn]}
              onPress={() => setTool(tool === 'draw' ? null : 'draw')}
            >
              <Ionicons name="pencil" size={20} color="#fff" />
            </TouchableOpacity>
          </View>
        )}

        {/* ---------- stage ---------- */}
        <View style={s.stage} onLayout={onStageLayout}>
          {!cur || !disp.w ? (
            <ActivityIndicator color="#fff" />
          ) : (
            <View style={{ width: disp.w, height: disp.h }}>
              <View
                ref={shotRef}
                collapsable={false}
                style={{ width: disp.w, height: disp.h, overflow: 'hidden' }}
              >
                <RNImage
                  source={{ uri: cur.uri }}
                  style={{ width: disp.w, height: disp.h }}
                  resizeMode="stretch"
                />
                <Svg width={disp.w} height={disp.h} style={StyleSheet.absoluteFill} pointerEvents="none">
                  {strokes.map((st, i) => (
                    <Path
                      key={i}
                      d={pathD(st.pts)}
                      stroke={st.color}
                      strokeWidth={disp.w / 70}
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      fill="none"
                    />
                  ))}
                  {live && (
                    <Path
                      d={pathD(live.pts)}
                      stroke={live.color}
                      strokeWidth={disp.w / 70}
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      fill="none"
                    />
                  )}
                </Svg>
                {texts.map((t) => (
                  <Text
                    key={t.id}
                    pointerEvents="none"
                    style={{
                      position: 'absolute',
                      left: t.x * disp.w - disp.w / 2,
                      width: disp.w,
                      top: t.y * disp.h - fs * 0.7,
                      textAlign: 'center',
                      color: t.color,
                      fontSize: fs,
                      fontFamily: FONTS.bodySemiBold,
                      textShadowColor: t.color === '#000000' ? '#fff' : '#000',
                      textShadowRadius: 4,
                      textShadowOffset: { width: 0, height: 0 },
                    }}
                  >
                    {t.text}
                  </Text>
                ))}
              </View>

              {/* touch layer for draw / text */}
              {!cropping && (tool === 'draw' || tool === 'text') && (
                <View style={StyleSheet.absoluteFill} {...canvasPR.panHandlers} />
              )}

              {/* crop overlay */}
              {cropping && (
                <View style={StyleSheet.absoluteFill} pointerEvents="box-none">
                  <View style={[s.dim, { left: 0, top: 0, right: 0, height: crop.y }]} />
                  <View style={[s.dim, { left: 0, top: crop.y + crop.h, right: 0, bottom: 0 }]} />
                  <View style={[s.dim, { left: 0, top: crop.y, width: crop.x, height: crop.h }]} />
                  <View
                    style={[s.dim, { left: crop.x + crop.w, top: crop.y, right: 0, height: crop.h }]}
                  />
                  <View
                    style={{
                      position: 'absolute',
                      left: crop.x,
                      top: crop.y,
                      width: crop.w,
                      height: crop.h,
                      borderWidth: 1.5,
                      borderColor: '#fff',
                    }}
                    {...prs.current.mv.panHandlers}
                  >
                    <View style={[s.gridV, { left: '33.3%' }]} pointerEvents="none" />
                    <View style={[s.gridV, { left: '66.6%' }]} pointerEvents="none" />
                    <View style={[s.gridH, { top: '33.3%' }]} pointerEvents="none" />
                    <View style={[s.gridH, { top: '66.6%' }]} pointerEvents="none" />
                    {HANDLES.map((h) => (
                      <View
                        key={h}
                        style={handleStyle(h)}
                        {...prs.current[h].panHandlers}
                      >
                        <View style={handleBar(h)} />
                        {h.length === 2 && <View style={handleBar(h, true)} />}
                      </View>
                    ))}
                  </View>
                </View>
              )}
            </View>
          )}
          {busy && (
            <View style={s.busy}>
              <ActivityIndicator color="#fff" />
            </View>
          )}
        </View>

        {/* ---------- bottom ---------- */}
        {cropping ? (
          <View style={s.ratioRow}>
            {RATIOS.map((r) => (
              <TouchableOpacity
                key={r.label}
                style={[s.chip, Math.abs(ratio - r.v) < 0.001 && s.chipOn]}
                onPress={() => pickRatio(r.v)}
              >
                <Text style={s.chipT}>{r.label}</Text>
              </TouchableOpacity>
            ))}
          </View>
        ) : (
          <KeyboardAvoidingView
            behavior={Platform.OS === 'ios' ? 'padding' : undefined}
            style={s.bottom}
          >
            {(tool === 'draw' || tool === 'text') && (
              <View style={s.palette}>
                {PALETTE.map((c) => (
                  <TouchableOpacity
                    key={c}
                    onPress={() => setColor(c)}
                    style={[
                      s.swatch,
                      { backgroundColor: c },
                      color === c && { borderColor: '#fff', transform: [{ scale: 1.15 }] },
                    ]}
                  />
                ))}
              </View>
            )}
            {tool === 'text' && (
              <>
                <View style={s.capPill}>
                  <TextInput
                    style={s.capInput}
                    placeholder="Type text, then tap on the photo"
                    placeholderTextColor="#8A8F9E"
                    value={textDraft}
                    onChangeText={setTextDraft}
                  />
                </View>
              </>
            )}
            {tool !== 'text' && (
              <View style={s.capPill}>
                <TextInput
                  style={s.capInput}
                  placeholder="Add a caption…"
                  placeholderTextColor="#8A8F9E"
                  value={caption}
                  onChangeText={setCaption}
                  multiline
                />
              </View>
            )}
            <View style={s.sendRow}>
              <View style={s.toChip}>
                <Text style={s.toChipT} numberOfLines={1}>
                  {recipientName || 'Send'}
                </Text>
              </View>
              <TouchableOpacity style={s.send} onPress={send} disabled={!cur || busy} activeOpacity={0.8}>
                <Ionicons name="send" size={20} color="#fff" style={{ marginLeft: 2 }} />
              </TouchableOpacity>
            </View>
          </KeyboardAvoidingView>
        )}
      </SafeAreaView>
    </Modal>
  );
}

// ---- crop handle visuals (44px hit area, white L / bar) ----
function handleStyle(h: string): any {
  const S = 44;
  const base: any = { position: 'absolute', width: S, height: S };
  const off = -S / 2;
  if (h === 'tl') return { ...base, left: off, top: off };
  if (h === 'tr') return { ...base, right: off, top: off };
  if (h === 'bl') return { ...base, left: off, bottom: off };
  if (h === 'br') return { ...base, right: off, bottom: off };
  if (h === 't') return { ...base, left: '50%', marginLeft: off, top: off };
  if (h === 'b') return { ...base, left: '50%', marginLeft: off, bottom: off };
  if (h === 'l') return { ...base, top: '50%', marginTop: off, left: off };
  return { ...base, top: '50%', marginTop: off, right: off };
}
function handleBar(h: string, vertical = false): any {
  const T = 5;
  const L = 24;
  const c = 22; // center of 44 box
  const b: any = { position: 'absolute', backgroundColor: '#fff', borderRadius: 1 };
  if (h.length === 2) {
    const right = h.includes('r');
    const bottom = h.includes('b');
    // horizontal arm
    if (!vertical)
      return { ...b, width: L, height: T, [right ? 'right' : 'left']: c - T / 2 + 0, [bottom ? 'bottom' : 'top']: c - T / 2 };
    return { ...b, width: T, height: L, [right ? 'right' : 'left']: c - T / 2, [bottom ? 'bottom' : 'top']: c - T / 2 };
  }
  if (h === 't' || h === 'b') return { ...b, width: 28, height: T, left: 8, top: c - T / 2 };
  return { ...b, width: T, height: 28, top: 8, left: c - T / 2 };
}

const s = StyleSheet.create({
  root: { flex: 1, backgroundColor: '#0A0A0A' },
  top: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingHorizontal: 10,
    paddingVertical: 8,
  },
  round: {
    width: 44,
    height: 44,
    borderRadius: 22,
    backgroundColor: '#1D1F24',
    alignItems: 'center',
    justifyContent: 'center',
  },
  roundOn: { backgroundColor: ACCENT },
  textBtn: { paddingHorizontal: 10, paddingVertical: 10 },
  textBtnT: { color: '#fff', fontSize: 16, fontFamily: FONTS.bodySemiBold },
  stage: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  dim: { position: 'absolute', backgroundColor: 'rgba(0,0,0,0.65)' },
  gridV: { position: 'absolute', top: 0, bottom: 0, width: 1, backgroundColor: 'rgba(255,255,255,0.35)' },
  gridH: { position: 'absolute', left: 0, right: 0, height: 1, backgroundColor: 'rgba(255,255,255,0.35)' },
  busy: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: 'rgba(0,0,0,0.35)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  ratioRow: {
    flexDirection: 'row',
    justifyContent: 'center',
    gap: 8,
    paddingVertical: 14,
  },
  chip: { paddingHorizontal: 14, paddingVertical: 8, borderRadius: 18, backgroundColor: '#1D1F24' },
  chipOn: { backgroundColor: ACCENT },
  chipT: { color: '#fff', fontSize: 13, fontFamily: FONTS.bodySemiBold },
  bottom: { paddingHorizontal: 10, paddingBottom: 8, gap: 10 },
  palette: { flexDirection: 'row', justifyContent: 'center', gap: 12 },
  swatch: { width: 28, height: 28, borderRadius: 14, borderWidth: 3, borderColor: 'rgba(255,255,255,0.25)' },
  capPill: {
    backgroundColor: '#1D1F24',
    borderRadius: 26,
    paddingHorizontal: 16,
    minHeight: 48,
    justifyContent: 'center',
  },
  capInput: {
    color: '#fff',
    fontSize: 16,
    fontFamily: FONTS.body,
    maxHeight: 100,
    paddingVertical: 10,
  },
  sendRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  toChip: { backgroundColor: '#1D1F24', borderRadius: 12, paddingHorizontal: 12, paddingVertical: 8, maxWidth: '70%' },
  toChipT: { color: '#fff', fontSize: 14, fontFamily: FONTS.bodyMedium },
  send: {
    width: 50,
    height: 50,
    borderRadius: 25,
    backgroundColor: ACCENT,
    alignItems: 'center',
    justifyContent: 'center',
  },
});
