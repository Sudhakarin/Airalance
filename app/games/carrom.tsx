// app/games/carrom.tsx
// Carrom — you (white) vs Computer (black). Slide the striker, drag back, release.
// Pocket all 9 of your coins first. Queen gives a bonus coin. Pocketing an opponent coin counts for them.

import { useEffect, useMemo, useReducer, useRef, memo } from 'react';
import {
  View,
  Text,
  StyleSheet,
  PanResponder,
  useWindowDimensions,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import Svg, {
  Defs,
  LinearGradient,
  RadialGradient,
  Stop,
  Rect,
  Circle,
  Line,
  Text as SvgText,
} from 'react-native-svg';
import { useRouter } from 'expo-router';
import { COLORS, FONTS } from '../../constants/theme';
import {
  GameScreen,
  GameHeader,
  ResultModal,
  useToast,
  G as GC,
} from '../../components/games/GameShell';
import { initSfx, unloadSfx, play } from '../../lib/games/sfx';
import {
  W,
  CR,
  SR,
  PR,
  POCK,
  BASE,
  Coin,
  World,
  Events,
  layout,
  newStriker,
  spawnSpot,
  stepPhys,
  isMoving,
  strikerOverlaps,
  ray,
  cpuPlan,
  shotSpeed,
  clamp,
} from '../../lib/games/carromEngine';

type Phase = 'idle' | 'ready' | 'cpu' | 'moving' | 'resolving' | 'over';
type Who = 'user' | 'cpu';
const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

/* ------------------------------------------------------------------ */
/* Static board                                                        */
/* ------------------------------------------------------------------ */
const BoardLayer = memo(function BoardLayer({ S }: { S: number }) {
  const lines: JSX.Element[] = [];
  [BASE.user, BASE.cpu].forEach((y) => {
    [-6, 6].forEach((o) =>
      lines.push(<Line key={`b${y}${o}`} x1={110} y1={y + o} x2={490} y2={y + o} stroke="rgba(167,139,250,0.5)" strokeWidth={1.6} />)
    );
    [110, 490].forEach((x) => {
      lines.push(<Circle key={`bd${y}${x}`} cx={x} cy={y} r={6} fill="rgba(244,63,122,0.8)" />);
      lines.push(<Circle key={`bo${y}${x}`} cx={x} cy={y} r={10} fill="none" stroke="rgba(167,139,250,0.5)" strokeWidth={1.6} />);
    });
  });
  const diag: JSX.Element[] = [];
  POCK.forEach(([px, py], i) => {
    const dx = px < 300 ? 1 : -1;
    const dy = py < 300 ? 1 : -1;
    diag.push(
      <Line key={`d${i}`} x1={px + dx * 34} y1={py + dy * 34} x2={px + dx * 96} y2={py + dy * 96} stroke="rgba(167,139,250,0.35)" strokeWidth={1.4} />,
      <Circle key={`dc${i}`} cx={px + dx * 104} cy={py + dy * 104} r={9} fill="none" stroke="rgba(167,139,250,0.35)" strokeWidth={1.4} />
    );
  });
  const spokes: JSX.Element[] = [];
  for (let i = 0; i < 8; i++) {
    const a = (i * Math.PI) / 4 + Math.PI / 8;
    spokes.push(
      <Line key={`sp${i}`} x1={300 + Math.cos(a) * 30} y1={300 + Math.sin(a) * 30} x2={300 + Math.cos(a) * 78} y2={300 + Math.sin(a) * 78} stroke="rgba(167,139,250,0.28)" strokeWidth={1.2} />
    );
  }
  return (
    <Svg width={S} height={S} viewBox={`0 0 ${W} ${W}`}>
      <Defs>
        <LinearGradient id="bg" x1="0" y1="0" x2="1" y2="1">
          <Stop offset="0" stopColor="#1b1626" />
          <Stop offset="1" stopColor="#110e19" />
        </LinearGradient>
        <RadialGradient id="glow" cx="50%" cy="50%" r="50%">
          <Stop offset="0" stopColor="#8B5CF6" stopOpacity={0.22} />
          <Stop offset="1" stopColor="#8B5CF6" stopOpacity={0} />
        </RadialGradient>
        <RadialGradient id="pk" cx="50%" cy="50%" r="50%">
          <Stop offset="0" stopColor="#000" />
          <Stop offset="0.75" stopColor="#06060a" />
          <Stop offset="1" stopColor="#241b38" />
        </RadialGradient>
      </Defs>
      <Rect width={W} height={W} fill="url(#bg)" />
      <Rect width={W} height={W} fill="url(#glow)" />
      <Circle cx={300} cy={300} r={82} fill="none" stroke="rgba(167,139,250,0.45)" strokeWidth={2} />
      <Circle cx={300} cy={300} r={26} fill="none" stroke="rgba(167,139,250,0.45)" strokeWidth={2} />
      {spokes}
      {lines}
      <Line x1={96} y1={110} x2={96} y2={490} stroke="rgba(167,139,250,0.5)" strokeWidth={1.6} />
      <Line x1={504} y1={110} x2={504} y2={490} stroke="rgba(167,139,250,0.5)" strokeWidth={1.6} />
      {diag}
      {POCK.map(([px, py], i) => (
        <Circle key={`p${i}`} cx={px} cy={py} r={PR + 8} fill="rgba(124,58,237,0.25)" />
      ))}
      {POCK.map(([px, py], i) => (
        <Circle key={`pp${i}`} cx={px} cy={py} r={PR + 3} fill="url(#pk)" stroke="rgba(167,139,250,0.55)" strokeWidth={2} />
      ))}
    </Svg>
  );
});

/* ------------------------------------------------------------------ */
/* Coin / striker drawing                                              */
/* ------------------------------------------------------------------ */
const RIM: Record<string, string> = { w: '#9a8fd0', b: '#5b5478', q: '#9d174d', s: '#ddd0ff' };
const RING: Record<string, string> = {
  w: 'rgba(124,58,237,0.55)',
  b: 'rgba(167,139,250,0.5)',
  q: 'rgba(255,255,255,0.7)',
  s: 'rgba(255,255,255,0.65)',
};
function CoinGfx({ x, y, r, t, k = 1 }: { x: number; y: number; r: number; t: string; k?: number }) {
  const rr = r * k;
  if (rr < 0.5) return null;
  return (
    <>
      <Circle cx={x + 2} cy={y + 3.2} r={rr} fill="rgba(0,0,0,0.5)" />
      <Circle cx={x} cy={y} r={rr} fill={`url(#g${t})`} stroke={RIM[t]} strokeWidth={1.6} />
      <Circle cx={x} cy={y} r={rr * 0.62} fill="none" stroke={RING[t]} strokeWidth={1.3} />
      {t === 's' && <Circle cx={x} cy={y} r={rr * 0.22} fill="rgba(255,255,255,0.7)" />}
    </>
  );
}
const CoinDefs = () => (
  <Defs>
    <RadialGradient id="gw" cx="50%" cy="50%" r="60%" fx="35%" fy="30%">
      <Stop offset="0" stopColor="#ffffff" />
      <Stop offset="1" stopColor="#cdc5f0" />
    </RadialGradient>
    <RadialGradient id="gb" cx="50%" cy="50%" r="60%" fx="35%" fy="30%">
      <Stop offset="0" stopColor="#4a4660" />
      <Stop offset="0.5" stopColor="#16141f" />
      <Stop offset="1" stopColor="#08070c" />
    </RadialGradient>
    <RadialGradient id="gq" cx="50%" cy="50%" r="60%" fx="35%" fy="30%">
      <Stop offset="0" stopColor="#ffb3cc" />
      <Stop offset="1" stopColor="#e11d6a" />
    </RadialGradient>
    <RadialGradient id="gs" cx="50%" cy="50%" r="60%" fx="35%" fy="30%">
      <Stop offset="0" stopColor="#f3eaff" />
      <Stop offset="0.45" stopColor="#a77bff" />
      <Stop offset="1" stopColor="#5b21b6" />
    </RadialGradient>
  </Defs>
);

/* ------------------------------------------------------------------ */
/* Striker slider                                                      */
/* ------------------------------------------------------------------ */
function StrikerSlider({
  value,
  onChange,
  disabled,
}: {
  value: number;
  onChange: (v: number) => void;
  disabled: boolean;
}) {
  const wRef = useRef(1);
  const dis = useRef(disabled);
  dis.current = disabled;
  const cb = useRef(onChange);
  cb.current = onChange;
  const pan = useMemo(() =>
    PanResponder.create({
      onStartShouldSetPanResponder: () => !dis.current,
      onMoveShouldSetPanResponder: () => !dis.current,
      onPanResponderTerminationRequest: () => false,
      onPanResponderGrant: (e) => cb.current(110 + clamp(e.nativeEvent.locationX / wRef.current, 0, 1) * 380),
      onPanResponderMove: (e) => cb.current(110 + clamp(e.nativeEvent.locationX / wRef.current, 0, 1) * 380),
    }), []);
  const pct = (value - 110) / 380;
  return (
    <View
      style={[styles.sliderHit, disabled && { opacity: 0.35 }]}
      onLayout={(e) => (wRef.current = e.nativeEvent.layout.width)}
      {...pan.panHandlers}
    >
      <View pointerEvents="none" style={styles.track}>
        <View style={[styles.trackFill, { width: `${pct * 100}%` }]} />
      </View>
      <View pointerEvents="none" style={[styles.thumb, { left: `${pct * 100}%` }]} />
    </View>
  );
}

/* ------------------------------------------------------------------ */
/* Screen                                                              */
/* ------------------------------------------------------------------ */
export default function CarromScreen() {
  const router = useRouter();
  const { width, height } = useWindowDimensions();
  const insets = useSafeAreaInsets();
  // fit the board on one screen (no scrolling, so drags never fight a ScrollView)
  const S = Math.floor(Math.max(220, Math.min(width - 42, 440, height - insets.top - insets.bottom - 300)));
  const k = W / S;
  const kRef = useRef(k);
  kRef.current = k;

  const [, bump] = useReducer((x: number) => x + 1, 0);
  const { toast, toastNode } = useToast();
  const toastRef = useRef(toast);
  toastRef.current = toast;
  const resRef = useRef<null | { win: boolean; title: string; sub: string }>(null);

  const g = useRef({
    gid: 0,
    world: { coins: layout(), st: newStriker(), sinking: [] } as World,
    phase: 'idle' as Phase,
    turn: 'user' as Who,
    sx: 300,
    aim: null as null | { px: number; py: number; gx: number; gy: number },
    cpuAim: null as null | { dx: number; dy: number },
    shot: null as null | { by: Who; pocketed: string[]; foul: boolean },
    pocketed: { user: 0, cpu: 0 },
    status: 'Your turn',
    movingT: 0,
  }).current;

  const events: Events = {
    hit: (i) => play('hit', clamp(i, 0.1, 1)),
    wall: (i) => play('wall', clamp(i, 0.1, 1)),
    pocket: (t) => {
      play('pocket');
      if (g.shot) {
        if (t === 's') g.shot.foul = true;
        else g.shot.pocketed.push(t);
      }
    },
  };
  const evRef = useRef(events);
  evRef.current = events;

  const setStatus = (t: string) => (g.status = t);

  /* ---------- flow ---------- */
  function newGame() {
    g.gid++;
    g.world = { coins: layout(), st: newStriker(), sinking: [] };
    g.pocketed = { user: 0, cpu: 0 };
    g.turn = 'user';
    g.shot = null;
    g.aim = null;
    g.cpuAim = null;
    resRef.current = null;
    setupShot();
  }

  function setupShot() {
    const st = g.world.st;
    st.gone = false;
    st.vx = st.vy = 0;
    st.y = BASE[g.turn];
    st.x = g.turn === 'user' ? g.sx : 300;
    if (g.turn === 'user') {
      g.phase = 'ready';
      setStatus('Your turn — place the striker, pull back and release');
    } else {
      g.phase = 'cpu';
      setStatus('Computer is aiming…');
      cpuTurn(g.gid);
    }
    bump();
  }

  function fire(dx: number, dy: number, power: number) {
    const st = g.world.st;
    const sp = shotSpeed(power);
    st.vx = dx * sp;
    st.vy = dy * sp;
    g.shot = { by: g.turn, pocketed: [], foul: false };
    g.phase = 'moving';
    g.movingT = 0;
    play('strike', 0.4 + power * 0.6);
    setStatus(g.turn === 'user' ? '…' : 'Computer shoots');
    bump();
  }

  async function cpuTurn(gid: number) {
    await sleep(900);
    if (gid !== g.gid) return;
    const plan = cpuPlan(g.world);
    const st = g.world.st;
    const x0 = st.x;
    const t0 = Date.now();
    await new Promise<void>((res) => {
      const tick = () => {
        if (gid !== g.gid) return res();
        const kk = clamp((Date.now() - t0) / 650, 0, 1);
        const e = kk < 0.5 ? 2 * kk * kk : 1 - Math.pow(-2 * kk + 2, 2) / 2;
        st.x = x0 + (plan.x - x0) * e;
        if (kk < 1) requestAnimationFrame(tick);
        else res();
      };
      tick();
    });
    if (gid !== g.gid) return;
    g.cpuAim = { dx: plan.dx, dy: plan.dy };
    play('tap');
    bump();
    await sleep(750);
    if (gid !== g.gid) return;
    g.cpuAim = null;
    fire(plan.dx, plan.dy, plan.power);
  }

  function resolve() {
    const sh = g.shot;
    if (!sh) return;
    g.phase = 'resolving';
    const by = sh.by;
    const opp: Who = by === 'user' ? 'cpu' : 'user';
    const mine = by === 'user' ? 'w' : 'b';
    const theirs = by === 'user' ? 'b' : 'w';
    const w = g.world;
    let extra = false;
    let queen = false;
    let gifted = false;
    sh.pocketed.forEach((t) => {
      if (t === mine) {
        g.pocketed[by]++;
        extra = true;
      } else if (t === theirs) {
        g.pocketed[opp]++;
        gifted = true;
      } else if (t === 'q') {
        extra = true;
        queen = true;
        const c = w.coins.find((c) => c.t === mine);
        if (c) {
          w.coins.splice(w.coins.indexOf(c), 1);
          w.sinking.push({ x: c.x, y: c.y, tx: POCK[0][0], ty: POCK[0][1], t: c.t, age: 0 });
        }
        g.pocketed[by]++;
      }
    });
    if (queen) play('queen');
    if (sh.foul) {
      extra = false;
      if (g.pocketed[by] > 0) {
        g.pocketed[by]--;
        const [x, y] = spawnSpot(w.coins);
        w.coins.push({ x, y, vx: 0, vy: 0, r: CR, m: 1, t: mine });
      }
      toastRef.current('Foul — striker pocketed, one coin returned');
      play('error');
    } else if (queen) {
      toastRef.current((by === 'user' ? 'You' : 'Computer') + ' pocketed the queen — bonus coin!');
    } else if (gifted && !extra) {
      toastRef.current('Opponent coin pocketed — it counts for them');
    }
    const wLeft = w.coins.filter((c) => c.t === 'w').length;
    const bLeft = w.coins.filter((c) => c.t === 'b').length;
    if (wLeft === 0 || bLeft === 0) {
      const userWin = wLeft === 0 && (bLeft > 0 || by === 'user');
      g.phase = 'over';
      setStatus(userWin ? 'You cleared all your coins!' : 'Computer cleared its coins');
      play(userWin ? 'win' : 'lose');
      const gid = g.gid;
      bump();
      setTimeout(() => {
        if (gid !== g.gid) return;
        resRef.current = {
          win: userWin,
          title: userWin ? 'You won!' : 'Computer wins',
          sub: userWin ? 'All your white coins are pocketed.' : 'All black coins went down first. Want a rematch?',
        };
        bump();
      }, 650);
      return;
    }
    g.turn = extra ? by : opp;
    g.shot = null;
    if (extra && by === 'user') toastRef.current('Nice! Shoot again');
    const gid = g.gid;
    setTimeout(() => {
      if (gid === g.gid && g.phase === 'resolving') setupShot();
    }, extra ? 350 : 650);
    bump();
  }

  /* ---------- loop ---------- */
  useEffect(() => {
    initSfx();
    newGame();
    let raf = 0;
    let last = Date.now();
    const loop = () => {
      raf = requestAnimationFrame(loop);
      const now = Date.now();
      const dt = Math.min(0.033, (now - last) / 1000 || 0);
      last = now;
      const w = g.world;
      let dirty = false;
      if (g.phase === 'moving') {
        g.movingT += dt;
        const n = Math.max(1, Math.ceil(dt / (1 / 240)));
        const h = dt / n;
        for (let i = 0; i < n; i++) stepPhys(w, h, evRef.current);
        if (g.movingT > 14) {
          w.coins.forEach((c) => (c.vx = c.vy = 0));
          w.st.vx = w.st.vy = 0;
        }
        dirty = true;
      }
      if (w.sinking.length) {
        w.sinking.forEach((s) => (s.age += dt));
        w.sinking = w.sinking.filter((s) => s.age < 0.3);
        dirty = true;
      }
      if (g.phase === 'moving' && !isMoving(w) && w.sinking.length === 0) resolve();
      if (g.aim || g.cpuAim || g.phase === 'cpu') dirty = true;
      if (dirty) bump();
    };
    raf = requestAnimationFrame(loop);
    return () => {
      cancelAnimationFrame(raf);
      g.gid++;
      unloadSfx();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  /* ---------- touch: pull back anywhere on the board and release ---------- */
  const pan = useMemo(() =>
    PanResponder.create({
      onStartShouldSetPanResponder: () => g.phase === 'ready',
      onMoveShouldSetPanResponder: () => g.phase === 'ready',
      onPanResponderTerminationRequest: () => false,
      onPanResponderGrant: (e) => {
        const gx = e.nativeEvent.locationX;
        const gy = e.nativeEvent.locationY;
        g.aim = { gx, gy, px: gx * kRef.current, py: gy * kRef.current };
      },
      onPanResponderMove: (_e, gs) => {
        if (!g.aim) return;
        g.aim.px = (g.aim.gx + gs.dx) * kRef.current;
        g.aim.py = (g.aim.gy + gs.dy) * kRef.current;
      },
      onPanResponderRelease: () => {
        const a = g.aim;
        g.aim = null;
        if (!a || g.phase !== 'ready') return;
        const st = g.world.st;
        const vx = st.x - a.px;
        const vy = st.y - a.py;
        const L = Math.hypot(vx, vy);
        if (L < 18) return;
        if (vy > -L * 0.1) {
          toastRef.current('Pull the striker back (downwards) to shoot up');
          play('error');
          return;
        }
        if (strikerOverlaps(g.world)) {
          toastRef.current('Striker overlaps a coin — slide it');
          play('error');
          return;
        }
        fire(vx / L, vy / L, clamp((L - 10) / 150, 0.05, 1));
      },
      onPanResponderTerminate: () => {
        g.aim = null;
      },
    }), []); // eslint-disable-line react-hooks/exhaustive-deps

  const onSlide = (v: number) => {
    g.sx = v;
    if (g.phase === 'ready') {
      g.world.st.x = v;
      bump();
    }
  };

  /* ---------- aim overlay ---------- */
  const w = g.world;
  const st = w.st;
  function aimShapes(dx: number, dy: number, alpha: number) {
    const r = ray(w, st.x, st.y, dx, dy);
    const ex = st.x + dx * r.t;
    const ey = st.y + dy * r.t;
    const out = [
      <Line key="al" x1={st.x} y1={st.y} x2={ex} y2={ey} stroke={`rgba(233,221,255,${alpha})`} strokeWidth={2.2} strokeDasharray="7 7" />,
      <Circle key="ag" cx={ex} cy={ey} r={SR} fill="none" stroke={`rgba(233,221,255,${alpha * 0.8})`} strokeWidth={1.6} />,
    ];
    if (r.c) {
      const cx = r.c.x - ex;
      const cy = r.c.y - ey;
      const l = Math.hypot(cx, cy) || 1;
      out.push(
        <Line key="ac" x1={r.c.x} y1={r.c.y} x2={r.c.x + (cx / l) * 70} y2={r.c.y + (cy / l) * 70} stroke="rgba(244,63,122,0.85)" strokeWidth={2.4} />
      );
    }
    return out;
  }

  let aimLayer: JSX.Element[] | null = null;
  if (g.phase === 'ready' && g.aim) {
    const vx = st.x - g.aim.px;
    const vy = st.y - g.aim.py;
    const L = Math.hypot(vx, vy);
    if (L >= 12) {
      const ux = vx / L;
      const uy = vy / L;
      const pw = clamp((L - 10) / 150, 0, 1);
      const len = Math.min(L, 160);
      aimLayer = [
        ...aimShapes(ux, uy, 0.85),
        <Line key="pull" x1={st.x - ux * SR} y1={st.y - uy * SR} x2={st.x - ux * len} y2={st.y - uy * len} stroke={pw > 0.8 ? 'rgba(244,63,122,0.9)' : 'rgba(168,85,247,0.85)'} strokeWidth={7} strokeLinecap="round" />,
        <SvgText key="pct" x={st.x - ux * (len + 24)} y={st.y - uy * (len + 24) + 5} fill="#fff" fontSize={15} fontWeight="600" textAnchor="middle">
          {Math.round(pw * 100)}%
        </SvgText>,
      ];
    }
  } else if (g.phase === 'cpu' && g.cpuAim) {
    aimLayer = aimShapes(g.cpuAim.dx, g.cpuAim.dy, 0.6);
  }
  const bad = g.phase === 'ready' && strikerOverlaps(w);

  const chip = (who: Who, label: string, color: string, letter: string) => {
    const n = g.pocketed[who];
    const active = g.turn === who && g.phase !== 'over';
    return (
      <View style={[styles.pchip, active && { borderColor: color, shadowColor: color, shadowOpacity: 0.8, shadowRadius: 10, elevation: 6 }]}>
        <View style={[styles.pav, { backgroundColor: color }]}>
          <Text style={[styles.pavText, who === 'user' && { color: '#2a1b5c' }]}>{letter}</Text>
        </View>
        <View style={{ flex: 1, minWidth: 0 }}>
          <Text style={styles.pn} numberOfLines={1}>{label}</Text>
          <View style={styles.tray}>
            {Array.from({ length: 9 }).map((_, i) => (
              <View key={i} style={[styles.dot, i < n && { backgroundColor: color }]} />
            ))}
          </View>
          <Text style={styles.pm}>{n}/9 pocketed</Text>
        </View>
      </View>
    );
  };

  const restart = () => {
    newGame();
  };
  const res = resRef.current;

  return (
    <GameScreen>
      <GameHeader
        title="Carrom"
        onBack={() => {
          g.gid++;
          router.back();
        }}
        onRestart={restart}
      />
      <View style={{ flex: 1 }}>
        <View style={styles.prow}>
          {chip('user', 'You · White', '#E6E0FF', 'A')}
          {chip('cpu', 'Computer · Black', '#6B6585', 'B')}
        </View>

        <View style={styles.frame}>
          <View style={{ width: S, height: S, borderRadius: 11, overflow: 'hidden' }}>
            <BoardLayer S={S} />
            <Svg width={S} height={S} viewBox={`0 0 ${W} ${W}`} style={StyleSheet.absoluteFill}>
              <CoinDefs />
              {w.coins.map((c, i) => (
                <CoinGfx key={i} x={c.x} y={c.y} r={c.r} t={c.t} />
              ))}
              {w.sinking.map((s, i) => {
                const kk = clamp(s.age / 0.3, 0, 1);
                return <CoinGfx key={'s' + i} x={s.x + (s.tx - s.x) * kk} y={s.y + (s.ty - s.y) * kk} r={s.t === 's' ? SR : CR} t={s.t} k={1 - kk} />;
              })}
              {g.phase === 'ready' && (
                <Circle cx={st.x} cy={st.y} r={SR + 7} fill="none" stroke={bad ? 'rgba(239,68,68,0.9)' : 'rgba(168,85,247,0.6)'} strokeWidth={2} />
              )}
              {aimLayer}
              {!st.gone && g.phase !== 'over' && <CoinGfx x={st.x} y={st.y} r={SR} t="s" />}
            </Svg>
            <View style={StyleSheet.absoluteFill} {...pan.panHandlers} />
          </View>
        </View>

        <View style={styles.slideRow}>
          <Text style={styles.slideLbl}>Striker</Text>
          <StrikerSlider value={g.sx} onChange={onSlide} disabled={g.phase !== 'ready'} />
        </View>
        <Text style={styles.status}>{g.status}</Text>
        <Text style={styles.hint}>Slide to place the striker, then drag back anywhere on the board and release to shoot.</Text>
      </View>

      {toastNode}
      <ResultModal
        visible={!!res}
        win={!!res?.win}
        title={res?.title ?? ''}
        sub={res?.sub}
        primary="Play again"
        onPrimary={restart}
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
  prow: { flexDirection: 'row', gap: 8, paddingHorizontal: 12, paddingBottom: 8 },
  pchip: {
    flex: 1,
    minWidth: 0,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingHorizontal: 10,
    paddingVertical: 8,
    borderRadius: 16,
    backgroundColor: GC.card,
    borderWidth: 1,
    borderColor: GC.line,
  },
  pav: { width: 30, height: 30, borderRadius: 15, alignItems: 'center', justifyContent: 'center' },
  pavText: { color: '#fff', fontSize: 13, fontFamily: FONTS.displayBold },
  pn: { color: '#fff', fontSize: 12.5, fontFamily: FONTS.bodySemiBold },
  pm: { color: COLORS.mist, fontSize: 11, fontFamily: FONTS.body, marginTop: 2 },
  tray: { flexDirection: 'row', gap: 3, marginTop: 4 },
  dot: { width: 6, height: 6, borderRadius: 3, backgroundColor: 'rgba(255,255,255,0.12)' },
  frame: {
    alignSelf: 'center',
    marginTop: 4,
    padding: 9,
    borderRadius: 20,
    backgroundColor: '#211a2c',
    borderWidth: 1,
    borderColor: '#2c2c36',
  },
  slideRow: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingHorizontal: 22, paddingTop: 14 },
  slideLbl: { color: COLORS.mistLight, fontSize: 12, fontFamily: FONTS.body },
  sliderHit: { flex: 1, height: 36, justifyContent: 'center' },
  track: { height: 6, borderRadius: 3, backgroundColor: '#26262d', overflow: 'hidden' },
  trackFill: { height: '100%', backgroundColor: '#8B5CF6' },
  thumb: {
    position: 'absolute',
    marginLeft: -11,
    width: 22,
    height: 22,
    borderRadius: 11,
    backgroundColor: '#fff',
    borderWidth: 3,
    borderColor: '#8B5CF6',
  },
  status: { textAlign: 'center', color: '#fff', fontSize: 13.5, fontFamily: FONTS.bodySemiBold, paddingHorizontal: 18, paddingTop: 8, minHeight: 34 },
  hint: { textAlign: 'center', color: COLORS.mist, fontSize: 12, fontFamily: FONTS.body, paddingHorizontal: 22, paddingTop: 2 },
});
