// app/games/blitz.tsx
// Block Blitz — drag the 3 pieces onto the 8x8 board, fill rows / columns to clear them.
// Combos multiply your score. Best score is saved on the phone (AsyncStorage).

import { useEffect, useMemo, useReducer, useRef, useState, memo } from 'react';
import {
  View,
  Text,
  StyleSheet,
  Animated,
  PanResponder,
  useWindowDimensions,
} from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { useRouter } from 'expo-router';
import { COLORS, FONTS } from '../../constants/theme';
import {
  GameScreen,
  GameHeader,
  ResultModal,
  useToast,
  G as GC,
} from '../../components/games/GameShell';
import { initSfx, unloadSfx, play, haptic } from '../../lib/games/sfx';
import {
  N,
  BLOCK_COLORS,
  BGrid,
  Piece,
  Shape,
  emptyGrid,
  fits,
  anywhere,
  genTray,
  fullLines,
  lineCells,
  isEmpty,
} from '../../lib/games/blitzEngine';

const BEST_KEY = 'airalance_blitz_best_v1';
const LIFT = 58; // ghost floats above the finger so it stays visible
const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));
const LABELS = ['', '', 'DOUBLE!', 'TRIPLE!', 'AMAZING!', 'INCREDIBLE!'];

type Mode = 'empty' | 'filled' | 'preview' | 'flash';

/* ---------------- one board cell ---------------- */
const Cell = memo(function Cell({
  size,
  col,
  mode,
  glow,
  tint,
}: {
  size: number;
  col: number;
  mode: Mode;
  glow: boolean;
  tint: boolean;
}) {
  if (mode === 'empty') {
    return (
      <View
        style={{
          width: size,
          height: size,
          padding: 1,
        }}
      >
        <View
          style={{
            flex: 1,
            borderRadius: size * 0.16,
            backgroundColor: tint ? '#1a1a21' : '#141418',
            borderWidth: glow ? 2 : 0,
            borderColor: 'rgba(255,255,255,0.7)',
          }}
        />
      </View>
    );
  }
  const [light, dark] = BLOCK_COLORS[Math.max(0, col)];
  const flash = mode === 'flash';
  return (
    <View style={{ width: size, height: size, padding: 1 }}>
      <View
        style={{
          flex: 1,
          borderRadius: size * 0.18,
          backgroundColor: flash ? '#FFFFFF' : light,
          borderTopWidth: 2,
          borderLeftWidth: 2,
          borderBottomWidth: 3,
          borderRightWidth: 3,
          borderTopColor: 'rgba(255,255,255,0.45)',
          borderLeftColor: 'rgba(255,255,255,0.3)',
          borderBottomColor: flash ? '#E7E3FF' : dark,
          borderRightColor: flash ? '#E7E3FF' : dark,
          opacity: mode === 'preview' ? 0.55 : 1,
          ...(glow ? { borderWidth: 2, borderColor: '#fff' } : null),
        }}
      />
    </View>
  );
});

/* ---------------- a small piece (tray) or the dragged ghost ---------------- */
function PieceView({ sh, col, size }: { sh: Shape; col: number; size: number }) {
  return (
    <View style={{ width: sh.w * size, height: sh.h * size }}>
      {sh.cs.map(([r, c]) => (
        <View key={r * 10 + c} style={{ position: 'absolute', left: c * size, top: r * size }}>
          <Cell size={size} col={col} mode="filled" glow={false} tint={false} />
        </View>
      ))}
    </View>
  );
}

type Drag = { i: number; gx: number; gy: number; ok: boolean } | null;

/* ---------------- screen ---------------- */
export default function BlitzScreen() {
  const router = useRouter();
  const { width } = useWindowDimensions();
  const S = Math.min(width - 28, 400);
  const cell = Math.floor(S / N);
  const BS = cell * N;

  const [best, setBest] = useState(0);
  const [pop, setPop] = useState<{ a: string; b: string }>({ a: '', b: '' });
  const [result, setResult] = useState<null | { win: boolean; title: string; sub: string }>(null);
  const [, bump] = useReducer((x: number) => x + 1, 0);
  const { toast, toastNode } = useToast();
  const popV = useRef(new Animated.Value(0)).current;
  const ghost = useRef(new Animated.ValueXY({ x: -999, y: -999 })).current;

  const boardRef = useRef<View>(null);
  const overlayRef = useRef<View>(null);
  const origin = useRef({ bx: 0, by: 0, ox: 0, oy: 0 });
  const bestRef = useRef(0);
  const cellRef = useRef(cell);
  cellRef.current = cell;

  const g = useRef({
    gid: 0,
    grid: emptyGrid() as BGrid,
    tray: [] as Piece[],
    score: 0,
    combo: 0,
    busy: false,
    over: false,
    drag: null as Drag,
    flash: new Set<number>(),
  }).current;

  /* ---------- lifecycle ---------- */
  useEffect(() => {
    initSfx();
    AsyncStorage.getItem(BEST_KEY)
      .then((v) => {
        const n = v ? parseInt(v, 10) || 0 : 0;
        bestRef.current = n;
        setBest(n);
      })
      .catch(() => {});
    newGame();
    toast('Drag a piece onto the board', 2400);
    return () => {
      g.gid++;
      unloadSfx();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function newGame() {
    g.gid++;
    g.grid = emptyGrid();
    g.tray = genTray(g.grid);
    g.score = 0;
    g.combo = 0;
    g.busy = false;
    g.over = false;
    g.drag = null;
    g.flash = new Set();
    ghost.setValue({ x: -999, y: -999 });
    setResult(null);
    bump();
  }

  function popText(a: string, b = '') {
    setPop({ a, b });
    popV.stopAnimation();
    popV.setValue(0);
    Animated.timing(popV, { toValue: 1, duration: 950, useNativeDriver: true }).start();
  }

  /* ---------- placing ---------- */
  async function placePiece(i: number, gx: number, gy: number) {
    const gid = g.gid;
    const p = g.tray[i];
    g.busy = true;
    p.sh.cs.forEach(([r, c]) => (g.grid[gy + r][gx + c] = p.col));
    p.used = true;
    let pts = p.sh.cs.length;
    play('place');
    haptic('light');

    const { rows, cols } = fullLines(g.grid);
    const lines = rows.length + cols.length;
    bump();

    if (lines > 0) {
      g.combo++;
      const bonus = lines * lines * 10 * g.combo;
      pts += bonus;
      const cells = lineCells(rows, cols);
      g.flash = cells;
      bump();
      play(lines >= 2 ? 'clear2' : 'clear');
      haptic(lines >= 2 ? 'success' : 'medium');
      if (g.combo >= 2) play('combo');
      await sleep(300);
      if (gid !== g.gid) return;
      cells.forEach((k) => (g.grid[Math.floor(k / N)][k % N] = -1));
      g.flash = new Set();
      let label = LABELS[Math.min(lines, 5)] || '';
      if (g.combo >= 2) label = (label ? label + ' ' : '') + `COMBO x${g.combo}`;
      if (isEmpty(g.grid)) {
        pts += 200;
        label = 'PERFECT CLEAR!';
        play('win');
      }
      popText('+' + pts, label);
    } else {
      g.combo = 0;
    }

    g.score += pts;
    if (g.score > bestRef.current) {
      bestRef.current = g.score;
      setBest(g.score);
      AsyncStorage.setItem(BEST_KEY, String(g.score)).catch(() => {});
    }

    if (g.tray.every((t) => t.used)) g.tray = genTray(g.grid);
    g.busy = false;
    bump();

    if (!g.tray.some((t) => !t.used && anywhere(g.grid, t.sh))) {
      g.over = true;
      bump();
      const newBest = g.score > 0 && g.score >= bestRef.current;
      play(newBest ? 'win' : 'lose');
      haptic(newBest ? 'success' : 'error');
      setTimeout(() => {
        if (gid !== g.gid) return;
        setResult({
          win: newBest,
          title: newBest ? 'New best!' : 'No more moves',
          sub: `Score ${g.score}  ·  Best ${bestRef.current}`,
        });
      }, 700);
    }
  }

  /* ---------- drag handling ---------- */
  function measureOrigins() {
    boardRef.current?.measureInWindow((x, y) => {
      origin.current.bx = x;
      origin.current.by = y;
    });
    overlayRef.current?.measureInWindow((x, y) => {
      origin.current.ox = x;
      origin.current.oy = y;
    });
  }

  function moveDrag(i: number, fx: number, fy: number) {
    const sh = g.tray[i].sh;
    const c = cellRef.current;
    const w = sh.w * c;
    const h = sh.h * c;
    const { bx, by, ox, oy } = origin.current;
    ghost.setValue({ x: fx - ox - w / 2, y: fy - LIFT - oy - h / 2 });
    const gx = Math.round((fx - w / 2 - bx) / c);
    const gy = Math.round((fy - LIFT - h / 2 - by) / c);
    const ok = fits(g.grid, sh, gx, gy);
    const d = g.drag;
    if (!d || d.gx !== gx || d.gy !== gy || d.ok !== ok) {
      g.drag = { i, gx, gy, ok };
      bump();
    }
  }

  const pans = useMemo(
    () =>
      [0, 1, 2].map((i) =>
        PanResponder.create({
          onStartShouldSetPanResponder: () => !g.over && !g.busy && !!g.tray[i] && !g.tray[i].used,
          onPanResponderGrant: (e) => {
            measureOrigins();
            play('pick');
            haptic('light');
            g.drag = { i, gx: -99, gy: -99, ok: false };
            // measure is async; first move re-computes with real origin
            moveDrag(i, e.nativeEvent.pageX, e.nativeEvent.pageY);
          },
          onPanResponderMove: (_e, gs) => {
            if (g.drag) moveDrag(i, gs.moveX, gs.moveY);
          },
          onPanResponderRelease: () => finishDrag(i),
          onPanResponderTerminate: () => finishDrag(i, true),
        })
      ),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    []
  );

  function finishDrag(i: number, cancel = false) {
    const d = g.drag;
    g.drag = null;
    ghost.setValue({ x: -999, y: -999 });
    if (!d || cancel) {
      bump();
      return;
    }
    if (d.ok) {
      placePiece(i, d.gx, d.gy);
    } else {
      if (d.gx > -90) {
        play('error');
        haptic('error');
      }
      bump();
    }
  }

  /* ---------- render prep ---------- */
  const d = g.drag;
  const preview = new Set<number>();
  const glow = new Set<number>();
  if (d && d.ok) {
    const p = g.tray[d.i];
    p.sh.cs.forEach(([r, c]) => preview.add((d.gy + r) * N + d.gx + c));
    // would this placement complete any rows / columns?
    const tmp = g.grid.map((r) => r.slice());
    p.sh.cs.forEach(([r, c]) => (tmp[d.gy + r][d.gx + c] = p.col));
    const f = fullLines(tmp);
    lineCells(f.rows, f.cols).forEach((k) => glow.add(k));
  }
  const dragPiece = d ? g.tray[d.i] : null;
  const tcell = Math.floor(cell * 0.5);

  return (
    <GameScreen>
      <GameHeader
        title="Block Blitz"
        onBack={() => {
          g.gid++;
          router.back();
        }}
        onRestart={() => newGame()}
      />

      {/* score row */}
      <View style={styles.srow}>
        <View style={styles.scard}>
          <Text style={styles.slabel}>SCORE</Text>
          <Text style={styles.sval}>{g.score}</Text>
        </View>
        {g.combo >= 2 ? (
          <LinearGradient
            colors={['#A855F7', '#7C3AED']}
            start={{ x: 0, y: 0 }}
            end={{ x: 1, y: 1 }}
            style={styles.combo}
          >
            <Text style={styles.comboText}>COMBO x{g.combo}</Text>
          </LinearGradient>
        ) : (
          <View style={{ width: 8 }} />
        )}
        <View style={[styles.scard, { alignItems: 'flex-end' }]}>
          <Text style={styles.slabel}>BEST</Text>
          <Text style={[styles.sval, { color: '#F5B83D' }]}>{best}</Text>
        </View>
      </View>

      {/* board */}
      <View style={{ alignItems: 'center', marginTop: 4 }}>
        <View
          ref={boardRef}
          onLayout={() => requestAnimationFrame(measureOrigins)}
          style={{
            width: BS + 12,
            height: BS + 12,
            padding: 6,
            borderRadius: 18,
            backgroundColor: GC.card,
            borderWidth: 1,
            borderColor: GC.line2,
          }}
        >
          <View style={{ width: BS, height: BS, flexDirection: 'row', flexWrap: 'wrap' }}>
            {Array.from({ length: N * N }).map((_, k) => {
              const r = Math.floor(k / N);
              const c = k % N;
              const v = g.grid[r][c];
              const tint = (r < 4) === (c < 4);
              let mode: Mode = 'empty';
              let col = v;
              if (g.flash.has(k)) mode = 'flash';
              else if (v >= 0) mode = 'filled';
              else if (preview.has(k) && dragPiece) {
                mode = 'preview';
                col = dragPiece.col;
              }
              return (
                <Cell
                  key={k}
                  size={cell}
                  col={col}
                  mode={mode}
                  glow={glow.has(k)}
                  tint={tint}
                />
              );
            })}
          </View>
          <Animated.View
            pointerEvents="none"
            style={[
              styles.pop,
              {
                opacity: popV.interpolate({ inputRange: [0, 0.12, 0.7, 1], outputRange: [0, 1, 1, 0] }),
                transform: [
                  { translateY: popV.interpolate({ inputRange: [0, 1], outputRange: [10, -40] }) },
                  { scale: popV.interpolate({ inputRange: [0, 0.2, 1], outputRange: [0.6, 1.15, 1] }) },
                ],
              },
            ]}
          >
            <Text style={styles.popA}>{pop.a}</Text>
            {!!pop.b && <Text style={styles.popB}>{pop.b}</Text>}
          </Animated.View>
        </View>
      </View>

      {/* tray */}
      <View style={styles.tray}>
        {g.tray.map((p, i) => {
          const hidden = p.used || (d && d.i === i);
          const stuck = !p.used && !anywhere(g.grid, p.sh);
          return (
            <View key={i} style={styles.slot} {...pans[i].panHandlers}>
              {!p.used && (
                <View style={{ opacity: hidden ? 0.15 : stuck ? 0.35 : 1 }}>
                  <PieceView sh={p.sh} col={p.col} size={tcell} />
                </View>
              )}
            </View>
          );
        })}
      </View>

      <Text style={styles.hint}>Fill a full row or column to clear it · chain clears for combos</Text>

      {/* floating piece while dragging */}
      <View
        ref={overlayRef}
        pointerEvents="none"
        style={StyleSheet.absoluteFill}
        onLayout={() => requestAnimationFrame(measureOrigins)}
      >
        {dragPiece && (
          <Animated.View
            style={{
              position: 'absolute',
              left: 0,
              top: 0,
              transform: [{ translateX: ghost.x }, { translateY: ghost.y }],
            }}
          >
            <PieceView sh={dragPiece.sh} col={dragPiece.col} size={cell} />
          </Animated.View>
        )}
      </View>

      {toastNode}
      <ResultModal
        visible={!!result}
        win={!!result?.win}
        title={result?.title ?? ''}
        sub={result?.sub}
        primary="Play again"
        onPrimary={() => newGame()}
        secondary="Back to games"
        onSecondary={() => {
          g.gid++;
          setResult(null);
          router.back();
        }}
      />
    </GameScreen>
  );
}

const styles = StyleSheet.create({
  srow: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingHorizontal: 14, paddingBottom: 10 },
  scard: {
    flex: 1,
    backgroundColor: GC.card,
    borderWidth: 1,
    borderColor: GC.line,
    borderRadius: 16,
    paddingHorizontal: 14,
    paddingVertical: 8,
  },
  slabel: { color: COLORS.mist, fontSize: 10.5, fontFamily: FONTS.bodySemiBold, letterSpacing: 1 },
  sval: { color: '#fff', fontSize: 24, fontFamily: FONTS.displayBold, marginTop: 1 },
  combo: { paddingHorizontal: 12, paddingVertical: 8, borderRadius: 999 },
  comboText: { color: '#fff', fontSize: 12, fontFamily: FONTS.displayBold, letterSpacing: 0.5 },
  pop: {
    position: 'absolute',
    left: 0,
    right: 0,
    top: '38%',
    alignItems: 'center',
  },
  popA: {
    color: '#fff',
    fontSize: 34,
    fontFamily: FONTS.displayBold,
    textShadowColor: 'rgba(124,58,237,0.95)',
    textShadowRadius: 14,
    textShadowOffset: { width: 0, height: 0 },
  },
  popB: {
    color: '#F5B83D',
    fontSize: 16,
    fontFamily: FONTS.displayBold,
    letterSpacing: 1,
    marginTop: 2,
    textShadowColor: 'rgba(0,0,0,0.8)',
    textShadowRadius: 6,
    textShadowOffset: { width: 0, height: 1 },
  },
  tray: {
    flexDirection: 'row',
    gap: 10,
    paddingHorizontal: 14,
    marginTop: 16,
  },
  slot: {
    flex: 1,
    height: 130,
    borderRadius: 18,
    backgroundColor: GC.card,
    borderWidth: 1,
    borderColor: GC.line,
    alignItems: 'center',
    justifyContent: 'center',
  },
  hint: {
    textAlign: 'center',
    color: COLORS.mist,
    fontSize: 11.5,
    fontFamily: FONTS.body,
    marginTop: 14,
    paddingHorizontal: 20,
  },
});
