// app/games/arrow.tsx
// Arrow Puzzle — tap an arrow to slide it off the board. Blocked arrows cost a heart.
// "Race Computer" mode: the Computer clears its own copy of the board at the same time.

import { useEffect, useMemo, useReducer, useRef, useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  ScrollView,
  Animated,
  Easing,
  Vibration,
  useWindowDimensions,
} from 'react-native';
import { useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { LinearGradient } from 'expo-linear-gradient';
import { COLORS, FONTS, GRADIENTS } from '../../constants/theme';
import {
  GameScreen,
  GameHeader,
  GhostButton,
  ResultModal,
  useToast,
  G as GC,
} from '../../components/games/GameShell';
import { initSfx, unloadSfx, play } from '../../lib/games/sfx';
import {
  DIR,
  Grid,
  generate,
  levelSize,
  levelDensity,
  cpuInterval,
  blockers,
  exitSteps,
} from '../../lib/games/arrowEngine';

type Status = 'on' | 'fly';

/* ------------------------------------------------------------------ */
/* One arrow tile                                                      */
/* ------------------------------------------------------------------ */
function ArrowTile({
  dir,
  status,
  steps,
  cell,
  gap,
  badTick,
  hintTick,
  onPress,
}: {
  dir: number;
  status: Status;
  steps: number;
  cell: number;
  gap: number;
  badTick: number;
  hintTick: number;
  onPress: () => void;
}) {
  const fly = useRef(new Animated.Value(0)).current;
  const shake = useRef(new Animated.Value(0)).current;
  const pulse = useRef(new Animated.Value(0)).current;
  const [bad, setBad] = useState(false);

  useEffect(() => {
    if (status === 'fly') {
      Animated.timing(fly, {
        toValue: 1,
        duration: 420,
        easing: Easing.in(Easing.quad),
        useNativeDriver: true,
      }).start();
    }
  }, [status, fly]);

  useEffect(() => {
    if (!badTick) return;
    setBad(true);
    shake.setValue(0);
    Animated.sequence([
      Animated.timing(shake, { toValue: 1, duration: 60, useNativeDriver: true }),
      Animated.timing(shake, { toValue: -1, duration: 90, useNativeDriver: true }),
      Animated.timing(shake, { toValue: 0.6, duration: 80, useNativeDriver: true }),
      Animated.timing(shake, { toValue: 0, duration: 70, useNativeDriver: true }),
    ]).start();
    const t = setTimeout(() => setBad(false), 600);
    return () => clearTimeout(t);
  }, [badTick, shake]);

  useEffect(() => {
    if (!hintTick) return;
    pulse.setValue(0);
    Animated.loop(
      Animated.sequence([
        Animated.timing(pulse, { toValue: 1, duration: 260, useNativeDriver: true }),
        Animated.timing(pulse, { toValue: 0, duration: 260, useNativeDriver: true }),
      ]),
      { iterations: 3 }
    ).start();
  }, [hintTick, pulse]);

  const dist = (cell + gap) * steps;
  return (
    <Animated.View
      pointerEvents={status === 'fly' ? 'none' : 'auto'}
      style={[
        StyleSheet.absoluteFill,
        {
          zIndex: status === 'fly' ? 5 : 2,
          opacity: fly.interpolate({ inputRange: [0, 0.7, 1], outputRange: [1, 1, 0] }),
          transform: [
            { translateX: Animated.add(fly.interpolate({ inputRange: [0, 1], outputRange: [0, DIR[dir][0] * dist] }), shake.interpolate({ inputRange: [-1, 1], outputRange: [-5, 5] })) },
            { translateY: fly.interpolate({ inputRange: [0, 1], outputRange: [0, DIR[dir][1] * dist] }) },
            { scale: pulse.interpolate({ inputRange: [0, 1], outputRange: [1, 1.1] }) },
          ],
        },
      ]}
    >
      <TouchableOpacity activeOpacity={0.8} onPress={onPress} style={{ flex: 1 }}>
        <LinearGradient
          colors={bad ? ['#4a1620', '#2a0d14'] : ['#2a2050', '#1a1433']}
          start={{ x: 0, y: 0 }}
          end={{ x: 1, y: 1 }}
          style={[styles.arw, { borderColor: bad ? '#EF4444' : hintTick ? '#FFFFFF' : '#3b2d70' }]}
        >
          <View style={{ transform: [{ rotate: `${dir * 90}deg` }] }}>
            <Ionicons name="arrow-up" size={Math.max(16, cell * 0.56)} color={bad ? '#fecaca' : '#E9DDFF'} />
          </View>
        </LinearGradient>
      </TouchableOpacity>
    </Animated.View>
  );
}

/* ------------------------------------------------------------------ */
/* Screen                                                              */
/* ------------------------------------------------------------------ */
export default function ArrowScreen() {
  const router = useRouter();
  const { width } = useWindowDimensions();
  const { toast, toastNode } = useToast();
  const [, bump] = useReducer((x: number) => x + 1, 0);

  const [level, setLevel] = useState(1);
  const [race, setRace] = useState(true);
  const [result, setResult] = useState<null | { win: boolean; title: string; sub: string }>(null);
  const [secs, setSecs] = useState(0);
  const [hints, setHints] = useState(3);
  const [lives, setLives] = useState(3);

  const n = levelSize(level);
  const boardW = Math.min(width - 24, 440) - 20; // inside the card padding
  const gap = n >= 8 ? 4 : n >= 6 ? 5 : 6;
  const cell = (boardW - gap * (n - 1)) / n;

  // mutable game state (rendering reads it, logic writes it)
  const g = useRef({
    gid: 0,
    grid: [] as Grid,
    dirs: [] as number[],
    status: [] as (Status | undefined)[],
    bad: [] as number[],
    hint: [] as number[],
    total: 0,
    youLeft: 0,
    cpuLeft: 0,
    over: false,
    t0: 0,
    livesNow: 3,
  }).current;
  const cpuTm = useRef<ReturnType<typeof setTimeout> | null>(null);
  const tick = useRef<ReturnType<typeof setInterval> | null>(null);

  function stopTimers() {
    if (cpuTm.current) clearTimeout(cpuTm.current);
    if (tick.current) clearInterval(tick.current);
    cpuTm.current = null;
    tick.current = null;
  }

  function begin(lv: number, raceOn: boolean) {
    stopTimers();
    g.gid++;
    const gid = g.gid;
    const size = levelSize(lv);
    g.grid = generate(size, levelDensity(lv));
    g.dirs = [...g.grid];
    g.status = g.grid.map((d) => (d >= 0 ? 'on' : undefined));
    g.bad = g.grid.map(() => 0);
    g.hint = g.grid.map(() => 0);
    g.total = g.grid.filter((d) => d >= 0).length;
    g.youLeft = g.cpuLeft = g.total;
    g.over = false;
    g.livesNow = 3;
    g.t0 = Date.now();
    setLives(3);
    setHints(3);
    setSecs(0);
    setResult(null);
    bump();
    tick.current = setInterval(() => setSecs(Math.floor((Date.now() - g.t0) / 1000)), 500);
    if (raceOn) {
      const base = cpuInterval(lv);
      const step = () => {
        cpuTm.current = setTimeout(() => {
          if (gid !== g.gid || g.over) return;
          g.cpuLeft--;
          bump();
          if (g.cpuLeft <= 0) return lose('The Computer cleared its board first.');
          step();
        }, base * (0.8 + Math.random() * 0.45));
      };
      step();
    }
  }

  useEffect(() => {
    initSfx();
    begin(1, true);
    return () => {
      g.gid++;
      g.over = true;
      stopTimers();
      unloadSfx();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function win() {
    g.over = true;
    stopTimers();
    const s = Math.floor((Date.now() - g.t0) / 1000);
    play('win');
    const gid = g.gid;
    setTimeout(() => {
      if (gid !== g.gid) return;
      setResult({
        win: true,
        title: `Level ${level} clear`,
        sub: `Finished in ${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')} with ${g.livesNow} heart${g.livesNow === 1 ? '' : 's'} left.`,
      });
    }, 550);
  }
  function lose(msg: string) {
    g.over = true;
    stopTimers();
    play('lose');
    const gid = g.gid;
    setTimeout(() => {
      if (gid !== g.gid) return;
      setResult({ win: false, title: 'Level failed', sub: msg });
    }, 450);
  }

  function tap(i: number) {
    if (g.over || g.grid[i] < 0) return;
    const bl = blockers(g.grid, n, i);
    if (!bl.length) {
      g.grid[i] = -1;
      g.status[i] = 'fly';
      g.youLeft--;
      play('whoosh');
      bump();
      if (g.youLeft === 0) win();
    } else {
      g.livesNow--;
      setLives(g.livesNow);
      [i, ...bl].forEach((k) => (g.bad[k] = (g.bad[k] || 0) + 1));
      play('error');
      Vibration.vibrate(40);
      bump();
      if (g.livesNow <= 0) lose('You ran out of hearts.');
      else toast('Blocked by another arrow');
    }
  }

  function hint() {
    if (g.over) return;
    if (hints <= 0) {
      toast('No hints left');
      play('error');
      return;
    }
    const free = g.grid.map((d, i) => (d >= 0 && !blockers(g.grid, n, i).length ? i : -1)).filter((i) => i >= 0);
    if (!free.length) return;
    setHints(hints - 1);
    const i = free[Math.floor(Math.random() * free.length)];
    g.hint[i] = (g.hint[i] || 0) + 1;
    play('hint');
    bump();
  }

  const youPct = g.total ? ((g.total - g.youLeft) / g.total) * 100 : 0;
  const cpuPct = g.total ? ((g.total - g.cpuLeft) / g.total) * 100 : 0;
  const mm = Math.floor(secs / 60);
  const ss = String(secs % 60).padStart(2, '0');

  const cells = useMemo(() => Array.from({ length: n * n }, (_, i) => i), [n]);

  return (
    <GameScreen>
      <GameHeader
        title="Arrow Puzzle"
        onBack={() => {
          g.gid++;
          g.over = true;
          router.back();
        }}
        onRestart={() => begin(level, race)}
      />
      <ScrollView contentContainerStyle={{ paddingBottom: 24 }} showsVerticalScrollIndicator={false}>
        <View style={{ paddingHorizontal: 14, paddingBottom: 10 }}>
          <View style={styles.seg}>
            {[true, false].map((r) => (
              <TouchableOpacity
                key={String(r)}
                activeOpacity={0.85}
                style={[styles.segBtn, race === r && styles.segOn]}
                onPress={() => {
                  play('tap');
                  setRace(r);
                  begin(level, r);
                }}
              >
                <Text style={[styles.segText, race === r && { color: '#fff' }]}>
                  {r ? 'Race Computer' : 'Solo'}
                </Text>
              </TouchableOpacity>
            ))}
          </View>
        </View>

        <View style={styles.stats}>
          <View style={styles.chip}>
            <Text style={styles.chipText}>Level {level}</Text>
          </View>
          <View style={styles.chip}>
            <Ionicons name="time-outline" size={14} color="#fff" />
            <Text style={styles.chipText}>
              {mm}:{ss}
            </Text>
          </View>
          <View style={[styles.chip, { marginLeft: 'auto', gap: 3 }]}>
            {[0, 1, 2].map((i) => (
              <Ionicons key={i} name="heart" size={16} color="#EF4444" style={{ opacity: i < lives ? 1 : 0.18 }} />
            ))}
          </View>
        </View>

        {race && (
          <View style={styles.race}>
            <View style={styles.rb}>
              <Text style={styles.rbName}>You</Text>
              <View style={styles.bar}>
                <LinearGradient colors={GRADIENTS.violet} start={{ x: 0, y: 0 }} end={{ x: 1, y: 0 }} style={[styles.barFill, { width: `${youPct}%` }]} />
              </View>
              <Text style={styles.rbNum}>{g.youLeft}</Text>
            </View>
            <View style={styles.rb}>
              <Text style={styles.rbName}>Computer</Text>
              <View style={styles.bar}>
                <View style={[styles.barFill, { width: `${cpuPct}%`, backgroundColor: '#94A3B8' }]} />
              </View>
              <Text style={styles.rbNum}>{g.cpuLeft}</Text>
            </View>
          </View>
        )}

        <View style={{ alignItems: 'center' }}>
          <View style={styles.pboard}>
            <View style={{ width: boardW, height: boardW, flexDirection: 'row', flexWrap: 'wrap', gap }}>
              {cells.map((i) => {
                const st = g.status[i];
                const d = st ? g.dirs[i] : -1;
                return (
                  <View key={i} style={[styles.pc, { width: cell, height: cell }]}>
                    {st && d >= 0 && (
                      <ArrowTile
                        dir={d}
                        status={st}
                        steps={exitSteps(n, i, d)}
                        cell={cell}
                        gap={gap}
                        badTick={g.bad[i] || 0}
                        hintTick={g.hint[i] || 0}
                        onPress={() => tap(i)}
                      />
                    )}
                  </View>
                );
              })}
            </View>
          </View>
        </View>

        <View style={{ paddingHorizontal: 14, paddingTop: 14 }}>
          <GhostButton label={`Hint · ${hints}`} icon="bulb-outline" onPress={hint} />
        </View>
        <Text style={styles.hintText}>
          Tap an arrow to slide it off the board. If another arrow is in its way, you lose a heart.
        </Text>
      </ScrollView>

      {toastNode}
      <ResultModal
        visible={!!result}
        win={!!result?.win}
        title={result?.title ?? ''}
        sub={result?.sub}
        primary={result?.win ? 'Next level' : 'Try again'}
        onPrimary={() => {
          if (result?.win) {
            const next = level + 1;
            setLevel(next);
            begin(next, race);
          } else {
            begin(level, race);
          }
        }}
        secondary="Back to games"
        onSecondary={() => {
          g.gid++;
          router.back();
        }}
      />
    </GameScreen>
  );
}

const styles = StyleSheet.create({
  seg: { flexDirection: 'row', backgroundColor: GC.card, borderWidth: 1, borderColor: GC.line, borderRadius: 14, padding: 3, gap: 3 },
  segBtn: { flex: 1, height: 38, borderRadius: 11, alignItems: 'center', justifyContent: 'center' },
  segOn: { backgroundColor: '#7C3AED' },
  segText: { fontSize: 13, fontFamily: FONTS.bodySemiBold, color: COLORS.mistLight },
  stats: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingHorizontal: 14, paddingBottom: 8 },
  chip: { flexDirection: 'row', alignItems: 'center', gap: 6, backgroundColor: GC.card, borderWidth: 1, borderColor: GC.line, borderRadius: 999, paddingHorizontal: 12, paddingVertical: 6 },
  chipText: { color: '#fff', fontSize: 12.5, fontFamily: FONTS.bodySemiBold },
  race: { gap: 7, paddingHorizontal: 16, paddingBottom: 10 },
  rb: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  rbName: { width: 64, color: COLORS.mistLight, fontSize: 11.5, fontFamily: FONTS.bodySemiBold },
  rbNum: { width: 32, textAlign: 'right', color: COLORS.mist, fontSize: 11.5, fontFamily: FONTS.body },
  bar: { flex: 1, height: 8, borderRadius: 4, backgroundColor: '#1a1a20', overflow: 'hidden' },
  barFill: { height: '100%', borderRadius: 4 },
  pboard: { backgroundColor: GC.card, borderWidth: 1, borderColor: GC.line, borderRadius: 20, padding: 10, overflow: 'hidden' },
  pc: { borderRadius: 10, backgroundColor: '#0c0c10', borderWidth: 1, borderColor: '#1a1a20' },
  arw: { flex: 1, borderRadius: 10, borderWidth: 1, alignItems: 'center', justifyContent: 'center' },
  hintText: { textAlign: 'center', color: COLORS.mist, fontSize: 12, fontFamily: FONTS.body, paddingHorizontal: 22, paddingTop: 12 },
});
