// app/games/four.tsx
// Four in a Row — you (A, purple) vs Computer (B, amber). Drop discs, connect four.
// Win streak + record are saved on the phone (AsyncStorage).

import { useEffect, useReducer, useRef, useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  Animated,
  Easing,
  useWindowDimensions,
  ScrollView,
} from 'react-native';
import Svg, { Path, Circle } from 'react-native-svg';
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
import { ROWS, COLS, Level, dropRow, winAt, cpuPick } from '../../lib/games/fourEngine';

const ME = '#A855F7';
const CPU = '#F5B83D';
const KEY = 'airalance_four_stats_v1';
const LKEY = 'airalance_four_level_v1';
const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

type Stats = { w: number; l: number; d: number; streak: number; best: number };
const ZERO: Stats = { w: 0, l: 0, d: 0, streak: 0, best: 0 };

type Game = {
  gid: number;
  board: number[];
  turn: 1 | 2;
  busy: boolean;
  over: boolean;
  win: number[];
  last: number;
  first: 1 | 2;
};

/* ---------------- one falling disc ---------------- */
function Disc({
  p,
  row,
  cell,
  win,
  last,
}: {
  p: number;
  row: number;
  cell: number;
  win: boolean;
  last: boolean;
}) {
  const size = cell * 0.82;
  const fall = useRef(new Animated.Value(-(row + 1) * cell - cell * 0.4)).current;
  const pulse = useRef(new Animated.Value(1)).current;
  useEffect(() => {
    Animated.timing(fall, {
      toValue: 0,
      duration: 260 + row * 45,
      easing: Easing.out(Easing.bounce),
      useNativeDriver: true,
    }).start();
  }, [fall, row]);
  useEffect(() => {
    if (!win) {
      pulse.setValue(1);
      return;
    }
    const l = Animated.loop(
      Animated.sequence([
        Animated.timing(pulse, { toValue: 1.14, duration: 380, useNativeDriver: true }),
        Animated.timing(pulse, { toValue: 0.96, duration: 380, useNativeDriver: true }),
      ])
    );
    l.start();
    return () => l.stop();
  }, [win, pulse]);
  const c = p === 1 ? ME : CPU;
  return (
    <Animated.View
      pointerEvents="none"
      style={{
        position: 'absolute',
        left: (cell - size) / 2,
        top: row * cell + (cell - size) / 2,
        width: size,
        height: size,
        borderRadius: size / 2,
        backgroundColor: c,
        borderWidth: win ? 3 : 0,
        borderColor: '#fff',
        alignItems: 'center',
        justifyContent: 'center',
        shadowColor: c,
        shadowOpacity: win ? 0.95 : 0.35,
        shadowRadius: win ? 12 : 4,
        shadowOffset: { width: 0, height: 2 },
        elevation: win ? 8 : 3,
        transform: [{ translateY: fall }, { scale: pulse }],
      }}
    >
      <View
        style={{
          position: 'absolute',
          top: '12%',
          left: '16%',
          width: '34%',
          height: '26%',
          borderRadius: 99,
          backgroundColor: 'rgba(255,255,255,0.38)',
        }}
      />
      <View
        style={{
          width: '58%',
          height: '58%',
          borderRadius: 99,
          borderWidth: 2,
          borderColor: 'rgba(0,0,0,0.18)',
          alignItems: 'center',
          justifyContent: 'center',
        }}
      >
        {last && !win && <View style={styles.lastDot} />}
      </View>
    </Animated.View>
  );
}

/* ---------------- screen ---------------- */
export default function FourScreen() {
  const router = useRouter();
  const { width } = useWindowDimensions();
  const S = Math.min(width - 28, 420);
  const cell = S / COLS;
  const BH = cell * ROWS;

  const [level, setLevel] = useState<Level>('medium');
  const [stats, setStats] = useState<Stats>(ZERO);
  const [msg, setMsg] = useState('Your turn — tap a column');
  const [result, setResult] = useState<null | { win: boolean; title: string; sub: string }>(null);
  const [, bump] = useReducer((x: number) => x + 1, 0);
  const { toast, toastNode } = useToast();
  const statsRef = useRef<Stats>(ZERO);
  const levelRef = useRef<Level>('medium');

  const g = useRef<Game>({
    gid: 0,
    board: Array(ROWS * COLS).fill(0),
    turn: 1,
    busy: false,
    over: false,
    win: [],
    last: -1,
    first: 1,
  }).current;

  useEffect(() => {
    initSfx();
    (async () => {
      try {
        const raw = await AsyncStorage.getItem(KEY);
        if (raw) {
          const s = { ...ZERO, ...JSON.parse(raw) } as Stats;
          statsRef.current = s;
          setStats(s);
        }
        const lv = await AsyncStorage.getItem(LKEY);
        if (lv === 'easy' || lv === 'medium' || lv === 'hard') {
          levelRef.current = lv;
          setLevel(lv);
        }
      } catch {}
    })();
    newGame(true);
    return () => {
      g.gid++;
      unloadSfx();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function saveStats(s: Stats) {
    statsRef.current = s;
    setStats(s);
    AsyncStorage.setItem(KEY, JSON.stringify(s)).catch(() => {});
  }

  function newGame(firstEver = false) {
    g.gid++;
    g.board = Array(ROWS * COLS).fill(0);
    g.over = false;
    g.win = [];
    g.last = -1;
    g.busy = false;
    if (!firstEver) g.first = g.first === 1 ? 2 : 1;
    g.turn = g.first;
    setResult(null);
    bump();
    if (g.turn === 2) {
      setMsg('Computer starts…');
      cpuTurn(g.gid);
    } else {
      setMsg('Your turn — tap a column');
    }
  }

  async function cpuTurn(gid: number) {
    g.busy = true;
    bump();
    await sleep(650);
    if (gid !== g.gid) return;
    const c = cpuPick(g.board, levelRef.current);
    await drop(gid, c, 2);
  }

  async function drop(gid: number, c: number, p: 1 | 2) {
    const r = dropRow(g.board, c);
    if (r < 0) return;
    g.busy = true;
    g.board[r * COLS + c] = p;
    g.last = r * COLS + c;
    bump();
    play('drop');
    await sleep(120 + r * 45);
    if (gid !== g.gid) return;
    play('c4land');
    haptic(p === 1 ? 'light' : 'medium');
    await sleep(220);
    if (gid !== g.gid) return;

    const w = winAt(g.board, p);
    if (w) {
      g.win = w;
      g.over = true;
      g.busy = false;
      bump();
      finish(p === 1 ? 'win' : 'lose');
      return;
    }
    if (g.board.every((v) => v)) {
      g.over = true;
      g.busy = false;
      bump();
      finish('draw');
      return;
    }
    g.turn = p === 1 ? 2 : 1;
    if (g.turn === 2) {
      setMsg('Computer is thinking…');
      cpuTurn(gid);
    } else {
      g.busy = false;
      setMsg('Your turn — tap a column');
      bump();
    }
  }

  function finish(kind: 'win' | 'lose' | 'draw') {
    const s = { ...statsRef.current };
    if (kind === 'win') {
      s.w++;
      s.streak++;
      s.best = Math.max(s.best, s.streak);
      play('win');
      haptic('success');
      setMsg('Four in a row — you win!');
    } else if (kind === 'lose') {
      s.l++;
      s.streak = 0;
      play('lose');
      haptic('error');
      setMsg('Computer connected four');
    } else {
      s.d++;
      play('error');
      setMsg("It's a draw");
    }
    saveStats(s);
    const gid = g.gid;
    setTimeout(() => {
      if (gid !== g.gid) return;
      setResult({
        win: kind === 'win',
        title: kind === 'win' ? 'You win!' : kind === 'lose' ? 'Computer wins' : 'Draw',
        sub:
          kind === 'win'
            ? s.streak > 1
              ? `${s.streak} wins in a row. Keep the streak alive!`
              : 'Nice four-in-a-row. Can you do it again?'
            : kind === 'lose'
            ? 'It blocked and connected four. Rematch?'
            : 'Board is full. Nobody connected four.',
      });
    }, 1100);
  }

  function tapCol(c: number) {
    if (g.busy || g.over || g.turn !== 1) return;
    if (dropRow(g.board, c) < 0) {
      play('error');
      haptic('error');
      toast('That column is full');
      return;
    }
    drop(g.gid, c, 1);
  }

  function setLv(l: Level) {
    play('tap');
    levelRef.current = l;
    setLevel(l);
    AsyncStorage.setItem(LKEY, l).catch(() => {});
    toast(`Computer level: ${l}`);
  }

  const youTurn = g.turn === 1 && !g.over;
  const cpuTurnNow = g.turn === 2 && !g.over;

  return (
    <GameScreen>
      <GameHeader
        title="Four in a Row"
        onBack={() => {
          g.gid++;
          router.back();
        }}
        onRestart={() => newGame()}
      />
      <ScrollView
        contentContainerStyle={{ paddingBottom: 24 }}
        showsVerticalScrollIndicator={false}
        scrollEnabled={false}
      >
        {/* players */}
        <View style={styles.prow}>
          <View style={[styles.chip, youTurn && { borderColor: ME, shadowColor: ME, shadowOpacity: 0.8, shadowRadius: 10, elevation: 6 }]}>
            <View style={[styles.av, { backgroundColor: ME }]}>
              <Text style={styles.avText}>A</Text>
            </View>
            <View>
              <Text style={styles.pn}>You</Text>
              <Text style={styles.pm}>{stats.w} wins</Text>
            </View>
          </View>
          <View style={[styles.chip, cpuTurnNow && { borderColor: CPU, shadowColor: CPU, shadowOpacity: 0.8, shadowRadius: 10, elevation: 6 }]}>
            <View style={[styles.av, { backgroundColor: CPU }]}>
              <Text style={styles.avText}>B</Text>
            </View>
            <View>
              <Text style={styles.pn}>Computer</Text>
              <Text style={styles.pm}>{stats.l} wins</Text>
            </View>
          </View>
        </View>

        {/* streak */}
        <View style={styles.streakRow}>
          <Text style={styles.streakText}>
            {stats.streak > 0 ? `Win streak ${stats.streak}` : 'No streak yet'} · Best {stats.best} · Draws {stats.d}
          </Text>
        </View>

        {/* board */}
        <View style={{ alignItems: 'center', marginTop: 6 }}>
          <LinearGradient
            colors={['#4c2fa8', '#2b1d55']}
            start={{ x: 0, y: 0 }}
            end={{ x: 1, y: 1 }}
            style={{ width: S + 12, borderRadius: 22, padding: 6, borderWidth: 1, borderColor: '#5b3fc4' }}
          >
            <View style={{ width: S, height: BH, backgroundColor: '#130c2b', borderRadius: 14, overflow: 'hidden' }}>
              {/* discs sit behind the frame */}
              {g.board.map((v, i) =>
                v ? (
                  <View key={i} style={{ position: 'absolute', left: (i % COLS) * cell, top: 0, width: cell, height: BH }}>
                    <Disc
                      p={v}
                      row={Math.floor(i / COLS)}
                      cell={cell}
                      win={g.win.includes(i)}
                      last={g.last === i}
                    />
                  </View>
                ) : null
              )}
              {/* frame with round holes */}
              <View pointerEvents="none" style={StyleSheet.absoluteFill}>
                <Svg width={S} height={BH}>
                  <Path d={framePath(S, BH, cell)} fill="#3a2790" fillRule="evenodd" />
                  {Array.from({ length: ROWS * COLS }).map((_, i) => (
                    <Circle
                      key={i}
                      cx={(i % COLS) * cell + cell / 2}
                      cy={Math.floor(i / COLS) * cell + cell / 2}
                      r={cell * 0.41}
                      fill="none"
                      stroke="rgba(0,0,0,0.35)"
                      strokeWidth={2}
                    />
                  ))}
                </Svg>
              </View>
              {/* tap columns */}
              <View style={[StyleSheet.absoluteFill, { flexDirection: 'row' }]}>
                {Array.from({ length: COLS }).map((_, c) => (
                  <TouchableOpacity
                    key={c}
                    style={{ flex: 1 }}
                    activeOpacity={0.6}
                    onPress={() => tapCol(c)}
                  />
                ))}
              </View>
            </View>
          </LinearGradient>
        </View>

        {/* status */}
        <View style={styles.status}>
          <View style={[styles.dot, { backgroundColor: g.over ? '#8B8B99' : youTurn ? ME : CPU }]} />
          <Text style={styles.statusText}>{msg}</Text>
        </View>

        {/* level */}
        <View style={{ paddingHorizontal: 18, marginTop: 6 }}>
          <Text style={styles.h4}>Computer level</Text>
          <View style={styles.seg}>
            {(['easy', 'medium', 'hard'] as Level[]).map((l) => (
              <TouchableOpacity
                key={l}
                activeOpacity={0.85}
                style={[styles.segBtn, level === l && styles.segOn]}
                onPress={() => setLv(l)}
              >
                <Text style={[styles.segText, level === l && { color: '#fff' }]}>
                  {l[0].toUpperCase() + l.slice(1)}
                </Text>
              </TouchableOpacity>
            ))}
          </View>
        </View>
      </ScrollView>

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

/** outer rectangle + one circular hole per cell (even-odd fill) */
function framePath(W: number, H: number, cell: number) {
  const r = cell * 0.41;
  let d = `M0 0H${W}V${H}H0Z`;
  for (let row = 0; row < ROWS; row++)
    for (let c = 0; c < COLS; c++) {
      const cx = c * cell + cell / 2;
      const cy = row * cell + cell / 2;
      d += `M${cx - r} ${cy}A${r} ${r} 0 1 0 ${cx + r} ${cy}A${r} ${r} 0 1 0 ${cx - r} ${cy}Z`;
    }
  return d;
}

const styles = StyleSheet.create({
  prow: { flexDirection: 'row', gap: 10, paddingHorizontal: 14, paddingBottom: 8 },
  chip: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    paddingHorizontal: 12,
    paddingVertical: 9,
    borderRadius: 16,
    backgroundColor: GC.card,
    borderWidth: 1,
    borderColor: GC.line,
  },
  av: { width: 32, height: 32, borderRadius: 16, alignItems: 'center', justifyContent: 'center' },
  avText: { color: '#fff', fontSize: 14, fontFamily: FONTS.displayBold },
  pn: { color: '#fff', fontSize: 13, fontFamily: FONTS.bodySemiBold },
  pm: { color: COLORS.mist, fontSize: 11, fontFamily: FONTS.body, marginTop: 1 },
  streakRow: { alignItems: 'center', paddingBottom: 6 },
  streakText: { color: COLORS.mist, fontSize: 11.5, fontFamily: FONTS.body },
  lastDot: { width: 7, height: 7, borderRadius: 4, backgroundColor: 'rgba(255,255,255,0.9)' },
  status: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    paddingTop: 14,
    paddingBottom: 6,
  },
  dot: { width: 10, height: 10, borderRadius: 5 },
  statusText: { color: '#fff', fontSize: 14, fontFamily: FONTS.bodySemiBold },
  h4: { fontSize: 12.5, fontFamily: FONTS.bodySemiBold, color: COLORS.mistLight, marginBottom: 8, letterSpacing: 0.2 },
  seg: { flexDirection: 'row', backgroundColor: GC.card, borderWidth: 1, borderColor: GC.line, borderRadius: 14, padding: 3, gap: 3 },
  segBtn: { flex: 1, height: 38, borderRadius: 11, alignItems: 'center', justifyContent: 'center' },
  segOn: { backgroundColor: '#7C3AED' },
  segText: { fontSize: 13, fontFamily: FONTS.bodySemiBold, color: COLORS.mistLight },
});
