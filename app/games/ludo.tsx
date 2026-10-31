// app/games/ludo.tsx
// Ludo — you vs Computer (or you + 3 Computers). Pick your colour first.
// v2: numbered tokens, arrows on start cells, destination markers, legend + help.

import { useEffect, useReducer, useRef, useState, memo } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  ScrollView,
  Animated,
  Easing,
  Modal,
  useWindowDimensions,
} from 'react-native';
import Svg, { Rect, Circle, Polygon, Path } from 'react-native-svg';
import { useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { COLORS, FONTS, RADII } from '../../constants/theme';
import {
  GameScreen,
  GameHeader,
  PrimaryButton,
  ResultModal,
  useToast,
  G as GC,
} from '../../components/games/GameShell';
import { initSfx, unloadSfx, play, haptic } from '../../lib/games/sfx';
import {
  COL,
  HEX,
  NAME,
  OPP,
  PATH,
  LANE,
  START,
  SAFE,
  YARD,
  SLOTS,
  DEG,
  PIPS,
  LColor,
  LToken,
  coords,
  absPos,
  movable,
  aiPick,
} from '../../lib/games/ludoEngine';

type Player = { color: LColor; human: boolean; name: string };
type Phase = 'idle' | 'roll' | 'rolling' | 'pick' | 'moving';
type Game = {
  gid: number;
  active: boolean;
  players: Player[];
  turn: number;
  phase: Phase;
  dice: number;
  sixes: number;
  tokens: LToken[];
  can: string[];
  sent: string[];
  moving: string | null;
};

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));
const key = (t: LToken) => t.color + t.idx;
const STAR = 'M12 2.5l2.9 6.2 6.6.8-4.9 4.6 1.3 6.7L12 17.5 6.1 20.8l1.3-6.7L2.5 9.5l6.6-.8z';
// unit-size right-pointing arrow centred on (0,0); rotate + scale it where used
const ARROW = '-0.28,-0.18 0.04,-0.18 0.04,-0.32 0.34,0 0.04,0.32 0.04,0.18 -0.28,0.18';

/* ------------------------------------------------------------------ */
/* Static board (one SVG)                                              */
/* ------------------------------------------------------------------ */
const BoardSvg = memo(function BoardSvg({
  S,
  activeColor,
}: {
  S: number;
  activeColor: LColor | null;
}) {
  const U = S / 15;
  const startOf = (i: number) => COL.find((c) => START[c] === i);
  return (
    <Svg width={S} height={S}>
      <Rect width={S} height={S} fill="#0d0d11" />
      {COL.map((c) => {
        const [x0, y0] = YARD[c];
        const on = activeColor === c;
        return (
          <Rect
            key={'y' + c}
            x={x0 * U}
            y={y0 * U}
            width={6 * U}
            height={6 * U}
            fill={HEX[c]}
            stroke={on ? '#FFFFFF' : 'none'}
            strokeWidth={on ? 3 : 0}
          />
        );
      })}
      {COL.map((c) => {
        const [x0, y0] = YARD[c];
        return (
          <Rect
            key={'yi' + c}
            x={(x0 + 0.9) * U}
            y={(y0 + 0.9) * U}
            width={4.2 * U}
            height={4.2 * U}
            rx={U * 0.8}
            fill="#0b0b0f"
          />
        );
      })}
      {COL.map((c) => {
        const [x0, y0] = YARD[c];
        return SLOTS.map(([dx, dy], i) => (
          <Circle
            key={'s' + c + i}
            cx={(x0 + dx) * U}
            cy={(y0 + dy) * U}
            r={U * 0.62}
            fill={HEX[c]}
            fillOpacity={0.18}
            stroke={HEX[c]}
            strokeOpacity={0.75}
            strokeWidth={2}
          />
        ));
      })}
      {PATH.map(([r, c], i) => {
        const sc = startOf(i);
        return (
          <Rect
            key={'p' + i}
            x={c * U}
            y={r * U}
            width={U}
            height={U}
            fill={sc ? HEX[sc] : '#16161b'}
            stroke={sc ? 'rgba(0,0,0,0.25)' : '#23232a'}
            strokeWidth={0.6}
          />
        );
      })}
      {COL.map((c) =>
        LANE[c].map(([r, cc], i) => (
          <Rect
            key={'l' + c + i}
            x={cc * U}
            y={r * U}
            width={U}
            height={U}
            fill={HEX[c]}
            fillOpacity={0.78}
            stroke="rgba(0,0,0,0.25)"
            strokeWidth={0.6}
          />
        ))
      )}
      {/* safe stars (start cells get an arrow instead) */}
      {PATH.map(([r, c], i) =>
        SAFE.has(i) && !startOf(i) ? (
          <Path
            key={'st' + i}
            d={STAR}
            fill="rgba(255,255,255,0.55)"
            transform={`translate(${c * U + U * 0.18} ${r * U + U * 0.18}) scale(${(U * 0.64) / 24})`}
          />
        ) : null
      )}
      {/* arrow on each start cell = where tokens enter and which way they run */}
      {COL.map((c) => {
        const [r, cc] = PATH[START[c]];
        return (
          <Polygon
            key={'sa' + c}
            points={ARROW}
            fill="rgba(255,255,255,0.95)"
            transform={`translate(${(cc + 0.5) * U} ${(r + 0.5) * U}) rotate(${DEG[c]}) scale(${U})`}
          />
        );
      })}
      {/* small chevrons along the coloured home lane point to the centre */}
      {COL.map((c) =>
        LANE[c].map(([r, cc], i) => (
          <Polygon
            key={'la' + c + i}
            points={ARROW}
            fill="rgba(255,255,255,0.4)"
            transform={`translate(${(cc + 0.5) * U} ${(r + 0.5) * U}) rotate(${DEG[c]}) scale(${U * 0.62})`}
          />
        ))
      )}
      {/* centre home triangles */}
      <Polygon points={`${6 * U},${6 * U} ${9 * U},${6 * U} ${7.5 * U},${7.5 * U}`} fill={HEX.green} />
      <Polygon points={`${9 * U},${6 * U} ${9 * U},${9 * U} ${7.5 * U},${7.5 * U}`} fill={HEX.yellow} />
      <Polygon points={`${6 * U},${9 * U} ${9 * U},${9 * U} ${7.5 * U},${7.5 * U}`} fill={HEX.blue} />
      <Polygon points={`${6 * U},${6 * U} ${6 * U},${9 * U} ${7.5 * U},${7.5 * U}`} fill={HEX.red} />
      <Circle cx={7.5 * U} cy={7.5 * U} r={U * 0.34} fill="#0d0d11" stroke="rgba(255,255,255,0.3)" strokeWidth={2} />
    </Svg>
  );
});

/* ------------------------------------------------------------------ */
/* One animated token                                                  */
/* ------------------------------------------------------------------ */
/* pulsing ring that shows where the chosen token will land */
function DestMark({ x, y, U, color, capture }: { x: number; y: number; U: number; color: string; capture: boolean }) {
  const v = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    const l = Animated.loop(
      Animated.sequence([
        Animated.timing(v, { toValue: 1, duration: 600, useNativeDriver: true }),
        Animated.timing(v, { toValue: 0, duration: 600, useNativeDriver: true }),
      ])
    );
    l.start();
    return () => l.stop();
  }, [v]);
  const size = U * 0.92;
  return (
    <Animated.View
      pointerEvents="none"
      style={{
        position: 'absolute',
        left: x * U - size / 2,
        top: y * U - size / 2,
        width: size,
        height: size,
        borderRadius: size / 2,
        borderWidth: 3,
        borderStyle: 'dashed',
        borderColor: capture ? '#FF4D5A' : '#FFFFFF',
        backgroundColor: capture ? 'rgba(255,77,90,0.25)' : color + '55',
        zIndex: 8,
        opacity: v.interpolate({ inputRange: [0, 1], outputRange: [0.55, 1] }),
        transform: [{ scale: v.interpolate({ inputRange: [0, 1], outputRange: [0.88, 1.08] }) }],
      }}
    />
  );
}

function Token({
  color,
  label,
  x,
  y,
  scale,
  U,
  can,
  sent,
  top,
  onPress,
}: {
  color: LColor;
  label: number;
  x: number;
  y: number;
  scale: number;
  U: number;
  can: boolean;
  sent: boolean;
  top: boolean;
  onPress: () => void;
}) {
  const size = U * 0.86;
  const pos = useRef(new Animated.ValueXY({ x: x * U - size / 2, y: y * U - size / 2 })).current;
  const sc = useRef(new Animated.Value(scale)).current;
  const hop = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    Animated.parallel([
      Animated.timing(pos, {
        toValue: { x: x * U - size / 2, y: y * U - size / 2 },
        duration: sent ? 600 : 150,
        easing: sent ? Easing.bezier(0.3, 0.1, 0.3, 1) : Easing.linear,
        useNativeDriver: true,
      }),
      Animated.timing(sc, { toValue: scale, duration: 180, useNativeDriver: true }),
    ]).start();
  }, [x, y, U, scale, sent, size, pos, sc]);

  useEffect(() => {
    if (!can) {
      hop.setValue(0);
      return;
    }
    const loop = Animated.loop(
      Animated.sequence([
        Animated.timing(hop, { toValue: -size * 0.28, duration: 340, useNativeDriver: true }),
        Animated.timing(hop, { toValue: 0, duration: 340, useNativeDriver: true }),
      ])
    );
    loop.start();
    return () => loop.stop();
  }, [can, hop, size]);

  return (
    <Animated.View
      pointerEvents={can ? 'auto' : 'none'}
      style={{
        position: 'absolute',
        left: 0,
        top: 0,
        width: size,
        height: size,
        zIndex: can ? 12 : top ? 20 : 5,
        transform: [
          { translateX: pos.x },
          { translateY: Animated.add(pos.y, hop) },
          { scale: sc },
        ],
      }}
    >
      <TouchableOpacity
        activeOpacity={0.8}
        onPress={onPress}
        hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
        style={[
          styles.tk,
          {
            backgroundColor: HEX[color],
            borderColor: can ? '#FFFFFF' : 'rgba(0,0,0,0.5)',
            borderWidth: can ? 3 : 2,
          },
        ]}
      >
        <View style={styles.tkGloss} />
        <View style={styles.tkRing}>
          <Text style={[styles.tkNum, { fontSize: size * 0.4 }]}>{label}</Text>
        </View>
      </TouchableOpacity>
    </Animated.View>
  );
}

/* ------------------------------------------------------------------ */
/* Dice                                                                */
/* ------------------------------------------------------------------ */
function Dice({
  face,
  ready,
  rolling,
  color,
  onPress,
}: {
  face: number;
  ready: boolean;
  rolling: boolean;
  color: string;
  onPress: () => void;
}) {
  const bob = useRef(new Animated.Value(0)).current;
  const shake = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    if (!ready) {
      bob.setValue(0);
      return;
    }
    const l = Animated.loop(
      Animated.sequence([
        Animated.timing(bob, { toValue: -5, duration: 500, useNativeDriver: true }),
        Animated.timing(bob, { toValue: 0, duration: 500, useNativeDriver: true }),
      ])
    );
    l.start();
    return () => l.stop();
  }, [ready, bob]);
  useEffect(() => {
    if (!rolling) {
      shake.setValue(0);
      return;
    }
    const l = Animated.loop(
      Animated.sequence([
        Animated.timing(shake, { toValue: 1, duration: 60, useNativeDriver: true }),
        Animated.timing(shake, { toValue: -1, duration: 60, useNativeDriver: true }),
      ])
    );
    l.start();
    return () => l.stop();
  }, [rolling, shake]);
  const pips = face ? PIPS[face] : [];
  return (
    <TouchableOpacity activeOpacity={0.9} onPress={onPress}>
      <Animated.View
        style={[
          styles.dice,
          { borderColor: color },
          ready && { shadowColor: color, shadowOpacity: 0.9, shadowRadius: 14, elevation: 10 },
          {
            transform: [
              { translateY: bob },
              { rotate: shake.interpolate({ inputRange: [-1, 1], outputRange: ['-12deg', '12deg'] }) },
            ],
          },
        ]}
      >
        {Array.from({ length: 9 }).map((_, i) => (
          <View key={i} style={styles.pipCell}>
            <View style={[styles.pip, pips.includes(i) && styles.pipOn]} />
          </View>
        ))}
      </Animated.View>
    </TouchableOpacity>
  );
}

/* ------------------------------------------------------------------ */
/* Screen                                                              */
/* ------------------------------------------------------------------ */
export default function LudoScreen() {
  const router = useRouter();
  const { width } = useWindowDimensions();
  const S = Math.min(width - 24, 440);
  const U = S / 15;

  const [stage, setStage] = useState<'setup' | 'play'>('setup');
  const [sel, setSel] = useState<LColor>('red');
  const [mode, setMode] = useState<2 | 4>(2);
  const [face, setFace] = useState(0);
  const [stat, setStat] = useState({ a: '', b: '' });
  const [result, setResult] = useState<null | { win: boolean; title: string; sub: string }>(null);
  const [help, setHelp] = useState(false);
  const [, bump] = useReducer((x: number) => x + 1, 0);
  const { toast, toastNode } = useToast();

  const g = useRef<Game>({
    gid: 0,
    active: false,
    players: [],
    turn: 0,
    phase: 'idle',
    dice: 0,
    sixes: 0,
    tokens: [],
    can: [],
    sent: [],
    moving: null,
  }).current;

  useEffect(() => {
    initSfx();
    return () => {
      g.gid++;
      g.active = false;
      unloadSfx();
    };
  }, [g]);

  const say = (a: string, b = '') => setStat({ a, b });

  /* ---------------- game flow ---------------- */
  function start() {
    g.gid++;
    const cols = (mode === 2 ? [sel, OPP[sel]] : [...COL]).sort(
      (a, b) => COL.indexOf(a) - COL.indexOf(b)
    );
    let cpu = 0;
    g.players = cols.map((c) =>
      c === sel
        ? { color: c, human: true, name: 'You' }
        : { color: c, human: false, name: mode === 2 ? 'Computer' : 'Computer ' + ++cpu }
    );
    g.tokens = cols.flatMap((c) => [0, 1, 2, 3].map((i) => ({ color: c, idx: i, pos: -1 })));
    g.turn = g.players.findIndex((p) => p.human);
    g.sixes = 0;
    g.active = true;
    g.phase = 'idle';
    g.dice = 0;
    g.can = [];
    g.sent = [];
    g.moving = null;
    setResult(null);
    setFace(0);
    setStage('play');
    bump();
    beginTurn(g.gid);
  }

  async function beginTurn(gid: number) {
    if (!g.active || gid !== g.gid) return;
    const p = g.players[g.turn];
    g.phase = 'roll';
    bump();
    if (p.human) {
      say('Your turn', 'Tap the dice to roll');
    } else {
      say(p.name + ' is rolling…', NAME[p.color]);
      await sleep(750);
      if (gid !== g.gid) return;
      roll(gid);
    }
  }

  async function roll(gid: number) {
    const p = g.players[g.turn];
    if (g.phase !== 'roll') return;
    g.phase = 'rolling';
    bump();
    play('dice');
    const v = 1 + Math.floor(Math.random() * 6);
    for (let i = 0; i < 8; i++) {
      setFace(1 + Math.floor(Math.random() * 6));
      await sleep(80);
      if (gid !== g.gid) return;
    }
    setFace(v);
    g.dice = v;
    play('land');
    await sleep(250);
    if (gid !== g.gid) return;
    if (v === 6) g.sixes++;
    if (g.sixes >= 3) {
      say(p.name + ' rolled three 6s', 'Turn skipped');
      toast('Three 6s in a row — turn skipped');
      play('error');
      await sleep(1300);
      if (gid !== g.gid) return;
      return nextTurn(gid);
    }
    const mv = movable(g.tokens, p.color, v);
    if (!mv.length) {
      say(`${p.name} rolled ${v}`, 'No move possible');
      bump();
      await sleep(1100);
      if (gid !== g.gid) return;
      return nextTurn(gid);
    }
    const same = mv.every((t) => t.pos === -1);
    if (mv.length === 1 || same) {
      say(`${p.name} rolled ${v}`, p.human ? 'Moving…' : '');
      await sleep(p.human ? 420 : 650);
      if (gid !== g.gid) return;
      return doMove(gid, mv[0], v);
    }
    if (p.human) {
      g.phase = 'pick';
      g.can = mv.map(key);
      say(`You rolled ${v}`, 'Tap a glowing token to move');
      bump();
    } else {
      say(`${p.name} rolled ${v}`, '');
      await sleep(700);
      if (gid !== g.gid) return;
      doMove(gid, aiPick(g.tokens, p.color, mv, v), v);
    }
  }

  function onToken(t: LToken) {
    if (g.phase !== 'pick' || !g.can.includes(key(t))) return;
    g.can = [];
    doMove(g.gid, t, g.dice);
  }

  async function doMove(gid: number, t: LToken, v: number) {
    const p = g.players[g.turn];
    g.phase = 'moving';
    g.can = [];
    g.moving = key(t);
    bump();
    if (t.pos === -1) {
      t.pos = 0;
      bump();
      play('out');
      await sleep(380);
    } else {
      for (let i = 1; i <= v; i++) {
        t.pos++;
        bump();
        play('step');
        await sleep(165);
        if (gid !== g.gid) return;
      }
    }
    if (gid !== g.gid) return;
    g.moving = null;

    let captured = false;
    if (t.pos <= 50) {
      const abs = absPos(t);
      if (!SAFE.has(abs)) {
        const vic = g.tokens.filter(
          (o) => o.color !== t.color && o.pos >= 0 && o.pos <= 50 && absPos(o) === abs
        );
        if (vic.length) {
          g.sent = vic.map(key);
          vic.forEach((o) => (o.pos = -1));
          captured = true;
          bump();
          play('capture');
          haptic('medium');
          toast(`${p.human ? 'You' : p.name} captured a token!`);
          await sleep(700);
          g.sent = [];
        }
      }
    }
    if (gid !== g.gid) return;
    const reachedHome = t.pos === 56;
    if (reachedHome) {
      play('home');
      haptic('success');
      toast('Token reached home!');
      bump();
      await sleep(500);
    }
    bump();
    if (g.tokens.filter((k) => k.color === p.color && k.pos === 56).length === 4) {
      return finish(p);
    }
    if (gid !== g.gid) return;
    if (v === 6 || captured || reachedHome) {
      if (v !== 6) g.sixes = 0;
      say(p.human ? 'Roll again!' : p.name + ' rolls again', 'Bonus turn');
      await sleep(500);
      if (gid !== g.gid) return;
      return beginTurn(gid);
    }
    nextTurn(gid);
  }

  function nextTurn(gid: number) {
    g.sixes = 0;
    g.turn = (g.turn + 1) % g.players.length;
    beginTurn(gid);
  }

  function finish(p: Player) {
    g.active = false;
    g.phase = 'idle';
    bump();
    const win = p.human;
    say(win ? 'You won!' : p.name + ' won', 'Game over');
    play(win ? 'win' : 'lose');
    haptic(win ? 'success' : 'error');
    const gid = g.gid;
    setTimeout(() => {
      if (gid !== g.gid) return;
      setResult({
        win,
        title: win ? 'You won!' : 'Computer wins',
        sub: win
          ? 'All four tokens reached home. Nicely played.'
          : `${p.name} got all four tokens home first. Try again?`,
      });
    }, 700);
  }

  /* ---------------- render helpers ---------------- */
  const cur = g.players[g.turn];
  const ready = stage === 'play' && g.active && g.phase === 'roll' && !!cur?.human;
  const rolling = g.phase === 'rolling';

  const groups: Record<string, LToken[]> = {};
  g.tokens.forEach((t) => {
    const [x, y] = coords(t);
    const k = t.pos === -1 ? 'b' + key(t) : x.toFixed(2) + ',' + y.toFixed(2);
    (groups[k] = groups[k] || []).push(t);
  });
  const place = (t: LToken) => {
    const [x, y] = coords(t);
    const grp = groups[t.pos === -1 ? 'b' + key(t) : x.toFixed(2) + ',' + y.toFixed(2)];
    let ox = 0;
    let oy = 0;
    let s = 1;
    if (grp.length > 1 && t.pos !== -1) {
      const i = grp.indexOf(t);
      const a = (i / grp.length) * Math.PI * 2 - 0.8;
      ox = Math.cos(a) * 0.2;
      oy = Math.sin(a) * 0.2;
      s = grp.length > 2 ? 0.7 : 0.8;
    }
    if (t.pos === 56) s *= 0.62;
    return { x: x + ox, y: y + oy, s };
  };

  // where each glowing token would land (human's pick phase)
  const dests =
    g.phase === 'pick'
      ? g.tokens
          .filter((t) => g.can.includes(key(t)))
          .map((t) => {
            const np = t.pos === -1 ? 0 : t.pos + g.dice;
            const [dx, dy] = coords({ ...t, pos: np });
            const abs = np <= 50 ? (START[t.color] + np) % 52 : -1;
            const capture =
              np <= 50 &&
              !SAFE.has(abs) &&
              g.tokens.some((o) => o.color !== t.color && o.pos >= 0 && o.pos <= 50 && absPos(o) === abs);
            return { k: key(t), x: dx, y: dy, color: HEX[t.color], capture };
          })
      : [];

  const goBack = () => {
    g.gid++;
    g.active = false;
    router.back();
  };

  /* ---------------- setup screen ---------------- */
  if (stage === 'setup') {
    const opp = OPP[sel];
    const others = COL.filter((c) => c !== sel);
    return (
      <GameScreen>
        <GameHeader title="Ludo" onBack={() => router.back()} />
        <ScrollView contentContainerStyle={styles.setup} showsVerticalScrollIndicator={false}>
          <View>
            <Text style={styles.h4}>Choose your colour</Text>
            <View style={styles.ctiles}>
              {COL.map((c) => {
                const on = c === sel;
                return (
                  <TouchableOpacity
                    key={c}
                    activeOpacity={0.85}
                    style={[styles.ctile, on && { borderColor: HEX[c], shadowColor: HEX[c], shadowOpacity: 0.7, shadowRadius: 12, elevation: 6 }]}
                    onPress={() => {
                      play('select');
                      setSel(c);
                    }}
                  >
                    <View style={[styles.tkp, { backgroundColor: HEX[c] }]}>
                      <View style={styles.tkpRing} />
                    </View>
                    <Text style={[styles.ctileText, on && { color: '#fff' }]}>{NAME[c]}</Text>
                    {on && (
                      <View style={[styles.ck, { backgroundColor: HEX[c] }]}>
                        <Ionicons name="checkmark" size={12} color="#fff" />
                      </View>
                    )}
                  </TouchableOpacity>
                );
              })}
            </View>
          </View>

          <View>
            <Text style={styles.h4}>Players</Text>
            <View style={styles.seg}>
              {([2, 4] as const).map((m) => (
                <TouchableOpacity
                  key={m}
                  activeOpacity={0.85}
                  style={[styles.segBtn, mode === m && styles.segOn]}
                  onPress={() => {
                    play('tap');
                    setMode(m);
                  }}
                >
                  <Text style={[styles.segText, mode === m && { color: '#fff' }]}>
                    {m === 2 ? 'You vs Computer' : 'You + 3 Computers'}
                  </Text>
                </TouchableOpacity>
              ))}
            </View>
          </View>

          <View style={styles.vs}>
            <View style={styles.side}>
              <View style={[styles.pav, { backgroundColor: HEX[sel], width: 44, height: 44, borderRadius: 22 }]}>
                <Text style={[styles.pavText, { fontSize: 17 }]}>A</Text>
              </View>
              <Text style={styles.sideName}>You</Text>
              <Text style={styles.sideSub}>{NAME[sel]}</Text>
            </View>
            {mode === 2 ? (
              <>
                <Text style={styles.vsText}>VS</Text>
                <View style={styles.side}>
                  <View style={[styles.pav, { backgroundColor: HEX[opp], width: 44, height: 44, borderRadius: 22 }]}>
                    <Text style={[styles.pavText, { fontSize: 17 }]}>B</Text>
                  </View>
                  <Text style={styles.sideName}>Computer</Text>
                  <Text style={styles.sideSub}>{NAME[opp]}</Text>
                </View>
              </>
            ) : (
              others.map((c, i) => (
                <View key={c} style={styles.side}>
                  <View style={[styles.pav, { backgroundColor: HEX[c], width: 44, height: 44, borderRadius: 22 }]}>
                    <Text style={[styles.pavText, { fontSize: 17 }]}>{i + 2}</Text>
                  </View>
                  <Text style={styles.sideName}>CPU {i + 1}</Text>
                  <Text style={styles.sideSub}>{NAME[c]}</Text>
                </View>
              ))
            )}
          </View>

          <View style={{ gap: 4 }}>
            {[
              'Roll a 6 to bring a token out of the yard.',
              'A 6, a capture or reaching home gives another roll.',
              'Star cells and start cells are safe from capture.',
              'Get all 4 tokens home first to win.',
            ].map((r) => (
              <Text key={r} style={styles.rule}>
                •  {r}
              </Text>
            ))}
          </View>

          <PrimaryButton
            label="Start game"
            icon="play"
            onPress={() => {
              play('select');
              start();
            }}
          />
        </ScrollView>
      </GameScreen>
    );
  }

  /* ---------------- play screen ---------------- */
  return (
    <GameScreen>
      <GameHeader
        title="Ludo"
        onBack={goBack}
        onRestart={() => {
          start();
        }}
        onHelp={() => setHelp(true)}
      />
      <ScrollView contentContainerStyle={{ paddingBottom: 24 }} showsVerticalScrollIndicator={false}>
        <View style={styles.prow}>
          {g.players.map((p, i) => {
            const home = g.tokens.filter((t) => t.color === p.color && t.pos === 56).length;
            const active = i === g.turn && g.active;
            const compact = g.players.length > 2;
            return (
              <View
                key={p.color}
                style={[
                  styles.pchip,
                  compact && !active && { flex: 0, paddingHorizontal: 6 },
                  active && { borderColor: HEX[p.color], shadowColor: HEX[p.color], shadowOpacity: 0.8, shadowRadius: 10, elevation: 6 },
                ]}
              >
                <View style={[styles.pav, { backgroundColor: HEX[p.color] }]}>
                  <Text style={styles.pavText}>
                    {p.human ? 'A' : g.players.length === 2 ? 'B' : i + 1}
                  </Text>
                </View>
                {(!compact || active) && (
                  <View style={{ flex: 1, minWidth: 0 }}>
                    <Text style={styles.pn} numberOfLines={1}>
                      {p.name}
                    </Text>
                    <View style={styles.pdots}>
                      {[0, 1, 2, 3].map((k) => (
                        <View
                          key={k}
                          style={[
                            styles.pdot,
                            { borderColor: HEX[p.color] },
                            k < home && { backgroundColor: HEX[p.color] },
                          ]}
                        />
                      ))}
                      <Text style={styles.pm}>{home}/4 home</Text>
                    </View>
                  </View>
                )}
              </View>
            );
          })}
        </View>

        <View style={{ alignItems: 'center' }}>
          <View style={{ width: S, height: S, borderRadius: 16, overflow: 'hidden', borderWidth: 1, borderColor: GC.line }}>
            <BoardSvg S={S} activeColor={g.active && g.phase !== 'moving' && g.phase !== 'rolling' ? cur?.color ?? null : null} />
            {dests.map((d) => (
              <DestMark key={'d' + d.k} x={d.x} y={d.y} U={U} color={d.color} capture={d.capture} />
            ))}
            {g.tokens.map((t) => {
              const k = key(t);
              const pl = place(t);
              return (
                <Token
                  key={k}
                  color={t.color}
                  label={t.idx + 1}
                  x={pl.x}
                  y={pl.y}
                  scale={pl.s}
                  U={U}
                  can={g.can.includes(k)}
                  sent={g.sent.includes(k)}
                  top={g.moving === k}
                  onPress={() => onToken(t)}
                />
              );
            })}
          </View>
        </View>

        <View style={styles.dicebar}>
          <Dice
            face={face}
            ready={ready}
            rolling={rolling}
            color={cur ? HEX[cur.color] : '#8B5CF6'}
            onPress={() => {
              if (g.phase === 'roll' && cur?.human) roll(g.gid);
            }}
          />
          <View style={{ flex: 1, minWidth: 0 }}>
            <Text style={styles.statA}>{stat.a}</Text>
            <Text style={styles.statB}>{stat.b}</Text>
          </View>
        </View>

        {/* legend: what the symbols on the board mean */}
        <View style={styles.legend}>
          <View style={styles.lg}>
            <Text style={styles.lgStar}>★</Text>
            <Text style={styles.lgText}>Safe cell</Text>
          </View>
          <View style={styles.lg}>
            <Text style={styles.lgArrow}>➤</Text>
            <Text style={styles.lgText}>Start cell</Text>
          </View>
          <View style={styles.lg}>
            <View style={styles.lgRing} />
            <Text style={styles.lgText}>Lands here</Text>
          </View>
          <View style={styles.lg}>
            <View style={[styles.lgRing, { borderColor: '#FF4D5A', backgroundColor: 'rgba(255,77,90,0.25)' }]} />
            <Text style={styles.lgText}>Capture</Text>
          </View>
        </View>
      </ScrollView>

      <Modal visible={help} transparent animationType="fade" statusBarTranslucent onRequestClose={() => setHelp(false)}>
        <View style={styles.hOverlay}>
          <View style={styles.hCard}>
            <Text style={styles.hTitle}>How to play</Text>
            {[
              ['Roll', 'Tap the dice on your turn. Goti are numbered 1–4.'],
              ['Leave the yard', 'You need a 6 to bring a goti onto your start cell (the arrow).'],
              ['Move', 'Glowing goti can move. Tap one; the dashed ring shows where it lands.'],
              ['Capture', 'Land on an opponent (red ring) to send it back to its yard. Stars and start cells are safe.'],
              ['Extra roll', 'A 6, a capture or reaching home gives another roll. Three 6s in a row lose the turn.'],
              ['Win', 'Take all 4 goti around the board and into the centre. You need the exact number for the last step.'],
            ].map(([a, b]) => (
              <View key={a} style={{ marginBottom: 9 }}>
                <Text style={styles.hHead}>{a}</Text>
                <Text style={styles.hBody}>{b}</Text>
              </View>
            ))}
            <PrimaryButton label="Got it" onPress={() => setHelp(false)} />
          </View>
        </View>
      </Modal>

      {toastNode}
      <ResultModal
        visible={!!result}
        win={!!result?.win}
        title={result?.title ?? ''}
        sub={result?.sub}
        primary="Play again"
        onPrimary={() => start()}
        secondary="Change colour"
        onSecondary={() => {
          g.gid++;
          setResult(null);
          setStage('setup');
        }}
      />
    </GameScreen>
  );
}

const styles = StyleSheet.create({
  setup: { padding: 18, gap: 18, paddingBottom: 30 },
  h4: { fontSize: 13, fontFamily: FONTS.bodySemiBold, color: COLORS.mistLight, marginBottom: 10, letterSpacing: 0.2 },
  ctiles: { flexDirection: 'row', gap: 10 },
  ctile: {
    flex: 1,
    aspectRatio: 0.86,
    borderRadius: 18,
    backgroundColor: GC.card,
    borderWidth: 1.5,
    borderColor: GC.line,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
  },
  tkp: {
    width: 34,
    height: 34,
    borderRadius: 17,
    borderWidth: 2,
    borderColor: 'rgba(0,0,0,0.4)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  tkpRing: { width: 16, height: 16, borderRadius: 8, borderWidth: 2, borderColor: 'rgba(255,255,255,0.55)' },
  ctileText: { fontSize: 12, fontFamily: FONTS.bodySemiBold, color: COLORS.mistLight },
  ck: {
    position: 'absolute',
    top: -7,
    right: -7,
    width: 20,
    height: 20,
    borderRadius: 10,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 2,
    borderColor: '#000',
  },
  seg: { flexDirection: 'row', backgroundColor: GC.card, borderWidth: 1, borderColor: GC.line, borderRadius: 14, padding: 3, gap: 3 },
  segBtn: { flex: 1, height: 38, borderRadius: 11, alignItems: 'center', justifyContent: 'center' },
  segOn: { backgroundColor: '#7C3AED' },
  segText: { fontSize: 13, fontFamily: FONTS.bodySemiBold, color: COLORS.mistLight },
  vs: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 14,
    backgroundColor: GC.card,
    borderWidth: 1,
    borderColor: GC.line,
    borderRadius: 20,
    padding: 14,
  },
  side: { alignItems: 'center', gap: 5 },
  sideName: { fontSize: 12.5, fontFamily: FONTS.bodySemiBold, color: '#fff' },
  sideSub: { fontSize: 11, fontFamily: FONTS.body, color: COLORS.mist },
  vsText: { fontSize: 13, fontFamily: FONTS.displayBold, color: COLORS.mist },
  rule: { fontSize: 12, lineHeight: 19, fontFamily: FONTS.body, color: COLORS.mist },

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
  pm: { color: COLORS.mist, fontSize: 10.5, fontFamily: FONTS.body, marginLeft: 3 },
  pdots: { flexDirection: 'row', alignItems: 'center', gap: 3, marginTop: 3 },
  pdot: { width: 7, height: 7, borderRadius: 4, borderWidth: 1.5 },

  legend: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    justifyContent: 'center',
    gap: 14,
    paddingHorizontal: 16,
    paddingTop: 14,
  },
  lg: { flexDirection: 'row', alignItems: 'center', gap: 5 },
  lgText: { color: COLORS.mist, fontSize: 11, fontFamily: FONTS.body },
  lgStar: { color: 'rgba(255,255,255,0.7)', fontSize: 13 },
  lgArrow: { color: '#fff', fontSize: 12 },
  lgRing: {
    width: 14,
    height: 14,
    borderRadius: 7,
    borderWidth: 2,
    borderStyle: 'dashed',
    borderColor: '#fff',
    backgroundColor: 'rgba(255,255,255,0.15)',
  },
  hOverlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.78)', alignItems: 'center', justifyContent: 'center' },
  hCard: {
    width: '88%',
    maxWidth: 360,
    backgroundColor: GC.card,
    borderWidth: 1,
    borderColor: GC.line2,
    borderRadius: 24,
    padding: 20,
  },
  hTitle: { color: '#fff', fontSize: 20, fontFamily: FONTS.displayBold, marginBottom: 12 },
  hHead: { color: '#fff', fontSize: 13, fontFamily: FONTS.bodySemiBold },
  hBody: { color: COLORS.mistLight, fontSize: 12.5, lineHeight: 18, fontFamily: FONTS.body, marginTop: 1 },

  tk: {
    flex: 1,
    borderRadius: 999,
    alignItems: 'center',
    justifyContent: 'center',
    shadowColor: '#000',
    shadowOpacity: 0.7,
    shadowRadius: 3,
    shadowOffset: { width: 0, height: 2 },
    elevation: 4,
  },
  tkGloss: {
    position: 'absolute',
    top: '12%',
    left: '16%',
    width: '34%',
    height: '28%',
    borderRadius: 999,
    backgroundColor: 'rgba(255,255,255,0.45)',
  },
  tkRing: {
    width: '62%',
    height: '62%',
    borderRadius: 999,
    borderWidth: 2,
    borderColor: 'rgba(255,255,255,0.65)',
    backgroundColor: 'rgba(0,0,0,0.18)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  tkNum: { color: '#fff', fontFamily: FONTS.displayBold, includeFontPadding: false, textAlign: 'center' },

  dicebar: { flexDirection: 'row', alignItems: 'center', gap: 16, paddingHorizontal: 20, paddingTop: 14 },
  dice: {
    width: 68,
    height: 68,
    borderRadius: 17,
    backgroundColor: '#ECE8FA',
    borderWidth: 3,
    flexDirection: 'row',
    flexWrap: 'wrap',
    padding: 8,
  },
  pipCell: { width: '33.33%', height: '33.33%', alignItems: 'center', justifyContent: 'center' },
  pip: { width: 9, height: 9, borderRadius: 5, backgroundColor: 'transparent' },
  pipOn: { backgroundColor: '#1b1233' },
  statA: { color: '#fff', fontSize: 14.5, fontFamily: FONTS.bodySemiBold },
  statB: { color: COLORS.mist, fontSize: 12, fontFamily: FONTS.body, marginTop: 3 },
});
