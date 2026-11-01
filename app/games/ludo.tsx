// app/games/ludo.tsx
// Ludo — you vs Computer (or you + 3 Computers). Pick your colour first.
// v4: Ludo-King style — colourful game table, 3D pawns, 3D dice beside the
// active player, classic white-track board, symmetric yards, no clipped
// numbers. Game logic / engine usage is unchanged.

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
import Svg, {
  Rect,
  Circle,
  Ellipse,
  Polygon,
  Path,
  Defs,
  LinearGradient as SvgLG,
  RadialGradient as SvgRG,
  Stop,
} from 'react-native-svg';
import { LinearGradient } from 'expo-linear-gradient';
import { useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { COLORS, FONTS } from '../../constants/theme';
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
/* Palette + theme                                                     */
/* ------------------------------------------------------------------ */
type Pal = { main: string; dark: string; light: string };
const PAL: Record<string, Pal> = {
  red: { main: '#E8302F', dark: '#A81B1B', light: '#FFD6D3' },
  green: { main: '#22A559', dark: '#146B38', light: '#D2F2DF' },
  yellow: { main: '#FFC21A', dark: '#C48F00', light: '#FFF0BF' },
  blue: { main: '#2D82F0', dark: '#1B55B0', light: '#D3E5FF' },
};
const pal = (c: LColor): Pal =>
  PAL[c] ?? { main: HEX[c], dark: HEX[c], light: '#FFFFFF' };

const GRID = '#5A5A68';
const TABLE = ['#2E56D6', '#5A2FCB', '#341A87'] as const;
const GOLD = '#FFD84D';

// board slots: which corner each colour owns (matches the yards)
const TOP_ROW: LColor[] = ['red', 'green'];
const BOTTOM_ROW: LColor[] = ['blue', 'yellow'];

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
  const C = 7.5 * U;
  return (
    <Svg width={S} height={S}>
      <Defs>
        {COL.map((c) => (
          <SvgLG key={'g' + c} id={'yg' + c} x1="0" y1="0" x2="1" y2="1">
            <Stop offset="0" stopColor={pal(c).main} />
            <Stop offset="1" stopColor={pal(c).dark} stopOpacity={0.9} />
          </SvgLG>
        ))}
      </Defs>
      <Rect width={S} height={S} fill="#FFFFFF" />

      {/* yards */}
      {COL.map((c) => {
        const [x0, y0] = YARD[c];
        return (
          <Rect
            key={'y' + c}
            x={x0 * U}
            y={y0 * U}
            width={6 * U}
            height={6 * U}
            fill={`url(#yg${c})`}
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
            fill="#FFFFFF"
          />
        );
      })}
      {/* token pads */}
      {COL.map((c) => {
        const [x0, y0] = YARD[c];
        const p = pal(c);
        return SLOTS.map(([dx, dy], i) => (
          <Circle
            key={'s' + c + i}
            cx={(x0 + dx) * U}
            cy={(y0 + dy) * U}
            r={U * 0.66}
            fill={p.main}
            stroke={p.dark}
            strokeWidth={2}
          />
        ));
      })}
      {COL.map((c) => {
        const [x0, y0] = YARD[c];
        return SLOTS.map(([dx, dy], i) => (
          <Circle
            key={'sr' + c + i}
            cx={(x0 + dx) * U}
            cy={(y0 + dy) * U}
            r={U * 0.5}
            fill="none"
            stroke="#FFFFFF"
            strokeOpacity={0.4}
            strokeWidth={1.5}
          />
        ));
      })}

      {/* track */}
      {PATH.map(([r, c], i) => {
        const sc = startOf(i);
        return (
          <Rect
            key={'p' + i}
            x={c * U}
            y={r * U}
            width={U}
            height={U}
            fill={sc ? pal(sc).main : '#FFFFFF'}
            stroke={GRID}
            strokeWidth={0.8}
          />
        );
      })}

      {/* home lanes */}
      {COL.map((c) =>
        LANE[c].map(([r, cc], i) => (
          <Rect
            key={'l' + c + i}
            x={cc * U}
            y={r * U}
            width={U}
            height={U}
            fill={pal(c).main}
            stroke={GRID}
            strokeWidth={0.8}
          />
        ))
      )}

      {/* safe stars (start cells get an arrow instead) */}
      {PATH.map(([r, c], i) =>
        SAFE.has(i) && !startOf(i) ? (
          <Path
            key={'st' + i}
            d={STAR}
            fill="#8E8E9E"
            transform={`translate(${c * U + U * 0.16} ${r * U + U * 0.16}) scale(${(U * 0.68) / 24})`}
          />
        ) : null
      )}

      {/* arrow on each start cell */}
      {COL.map((c) => {
        const [r, cc] = PATH[START[c]];
        return (
          <Polygon
            key={'sa' + c}
            points={ARROW}
            fill="rgba(255,255,255,0.97)"
            transform={`translate(${(cc + 0.5) * U} ${(r + 0.5) * U}) rotate(${DEG[c]}) scale(${U})`}
          />
        );
      })}

      {/* chevrons along home lanes */}
      {COL.map((c) =>
        LANE[c].map(([r, cc], i) => (
          <Polygon
            key={'la' + c + i}
            points={ARROW}
            fill="rgba(255,255,255,0.6)"
            transform={`translate(${(cc + 0.5) * U} ${(r + 0.5) * U}) rotate(${DEG[c]}) scale(${U * 0.58})`}
          />
        ))
      )}

      {/* centre home */}
      <Polygon points={`${6 * U},${6 * U} ${9 * U},${6 * U} ${C},${C}`} fill={pal('green').main} stroke={GRID} strokeWidth={0.8} />
      <Polygon points={`${9 * U},${6 * U} ${9 * U},${9 * U} ${C},${C}`} fill={pal('yellow').main} stroke={GRID} strokeWidth={0.8} />
      <Polygon points={`${6 * U},${9 * U} ${9 * U},${9 * U} ${C},${C}`} fill={pal('blue').main} stroke={GRID} strokeWidth={0.8} />
      <Polygon points={`${6 * U},${6 * U} ${6 * U},${9 * U} ${C},${C}`} fill={pal('red').main} stroke={GRID} strokeWidth={0.8} />

      {/* active player's yard highlight */}
      {activeColor
        ? (() => {
            const [x0, y0] = YARD[activeColor];
            return (
              <Rect
                x={x0 * U + 1.5}
                y={y0 * U + 1.5}
                width={6 * U - 3}
                height={6 * U - 3}
                fill="none"
                stroke="#FFFFFF"
                strokeWidth={3}
              />
            );
          })()
        : null}
    </Svg>
  );
});

/* ------------------------------------------------------------------ */
/* 3D pawn                                                             */
/* ------------------------------------------------------------------ */
// width = size, height = size * 1.2.  Footprint (base) sits at y≈0.83 of height.
function Pawn({ color, size }: { color: LColor; size: number }) {
  const p = pal(color);
  return (
    <Svg width={size} height={size * 1.2} viewBox="0 0 100 120">
      <Defs>
        <SvgLG id={'pb' + color} x1="0" y1="0" x2="1" y2="0">
          <Stop offset="0" stopColor={p.dark} />
          <Stop offset="0.38" stopColor={p.main} />
          <Stop offset="0.62" stopColor={p.main} />
          <Stop offset="1" stopColor={p.dark} />
        </SvgLG>
        <SvgRG id={'ph' + color} cx="0.38" cy="0.3" rx="0.8" ry="0.8" fx="0.38" fy="0.3">
          <Stop offset="0" stopColor="#FFFFFF" stopOpacity={0.95} />
          <Stop offset="0.3" stopColor={p.main} />
          <Stop offset="1" stopColor={p.dark} />
        </SvgRG>
      </Defs>
      <Ellipse cx="50" cy="106" rx="33" ry="8" fill="#000000" fillOpacity={0.32} />
      <Path
        d="M17 98 C17 80 36 76 41 58 L59 58 C64 76 83 80 83 98 A33 10 0 0 1 17 98 Z"
        fill={`url(#pb${color})`}
        stroke={p.dark}
        strokeWidth={2.5}
        strokeLinejoin="round"
      />
      <Ellipse cx="50" cy="58" rx="15" ry="5.5" fill={p.main} stroke={p.dark} strokeWidth={2.5} />
      <Circle cx="50" cy="36" r="25" fill={`url(#ph${color})`} stroke={p.dark} strokeWidth={2.5} />
      <Ellipse cx="41" cy="25" rx="9" ry="5.5" fill="#FFFFFF" fillOpacity={0.65} transform="rotate(-30 41 25)" />
      <Path
        d="M28 92 C27 84 34 80 38 72"
        stroke="#FFFFFF"
        strokeOpacity={0.4}
        strokeWidth={4}
        strokeLinecap="round"
        fill="none"
      />
    </Svg>
  );
}

/* ------------------------------------------------------------------ */
/* Landing marker                                                      */
/* ------------------------------------------------------------------ */
function DestMark({
  x,
  y,
  U,
  color,
  capture,
}: {
  x: number;
  y: number;
  U: number;
  color: string;
  capture: boolean;
}) {
  const v = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    const l = Animated.loop(
      Animated.sequence([
        Animated.timing(v, { toValue: 1, duration: 650, useNativeDriver: true }),
        Animated.timing(v, { toValue: 0, duration: 650, useNativeDriver: true }),
      ])
    );
    l.start();
    return () => l.stop();
  }, [v]);
  const size = U * 0.96;
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
        borderColor: capture ? '#FF2D3A' : '#14141C',
        backgroundColor: capture ? 'rgba(255,45,58,0.4)' : color + '66',
        zIndex: 8,
        opacity: v.interpolate({ inputRange: [0, 1], outputRange: [0.65, 1] }),
        transform: [{ scale: v.interpolate({ inputRange: [0, 1], outputRange: [0.88, 1.1] }) }],
      }}
    />
  );
}

/* ------------------------------------------------------------------ */
/* One animated token                                                  */
/* ------------------------------------------------------------------ */
function Token({
  color,
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
  x: number;
  y: number;
  scale: number;
  U: number;
  can: boolean;
  sent: boolean;
  top: boolean;
  onPress: () => void;
}) {
  const W = U * 1.0;
  const H = W * 1.2;
  // cell centre maps to pawn y = 0.65 of its height (body middle)
  const tx = (cx: number) => cx * U - W / 2;
  const ty = (cy: number) => cy * U - H * 0.65;
  const pos = useRef(new Animated.ValueXY({ x: tx(x), y: ty(y) })).current;
  const sc = useRef(new Animated.Value(scale)).current;
  const hop = useRef(new Animated.Value(0)).current;
  const glow = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    Animated.parallel([
      Animated.timing(pos, {
        toValue: { x: tx(x), y: ty(y) },
        duration: sent ? 600 : 150,
        easing: sent ? Easing.bezier(0.3, 0.1, 0.3, 1) : Easing.linear,
        useNativeDriver: true,
      }),
      Animated.timing(sc, { toValue: scale, duration: 180, useNativeDriver: true }),
    ]).start();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [x, y, U, scale, sent, pos, sc]);

  useEffect(() => {
    if (!can) {
      hop.setValue(0);
      glow.setValue(0);
      return;
    }
    const loop = Animated.loop(
      Animated.sequence([
        Animated.timing(hop, { toValue: -W * 0.3, duration: 340, useNativeDriver: true }),
        Animated.timing(hop, { toValue: 0, duration: 340, useNativeDriver: true }),
      ])
    );
    const gl = Animated.loop(
      Animated.sequence([
        Animated.timing(glow, { toValue: 1, duration: 680, useNativeDriver: true }),
        Animated.timing(glow, { toValue: 0, duration: 680, useNativeDriver: true }),
      ])
    );
    loop.start();
    gl.start();
    return () => {
      loop.stop();
      gl.stop();
    };
  }, [can, hop, glow, W]);

  const halo = W * 1.7;
  return (
    <Animated.View
      pointerEvents={can ? 'auto' : 'none'}
      style={{
        position: 'absolute',
        left: 0,
        top: 0,
        width: W,
        height: H,
        zIndex: can ? 40 : top ? 50 : 5 + Math.round(y),
        transform: [
          { translateX: pos.x },
          { translateY: pos.y },
          { scale: sc },
        ],
      }}
    >
      {can && (
        <Animated.View
          pointerEvents="none"
          style={{
            position: 'absolute',
            left: (W - halo) / 2,
            top: H * 0.83 - halo / 2,
            width: halo,
            height: halo,
            borderRadius: halo / 2,
            borderWidth: 2.5,
            borderColor: GOLD,
            backgroundColor: 'rgba(255,216,77,0.3)',
            opacity: glow.interpolate({ inputRange: [0, 1], outputRange: [0.55, 1] }),
            transform: [{ scale: glow.interpolate({ inputRange: [0, 1], outputRange: [0.88, 1.08] }) }],
          }}
        />
      )}
      <Animated.View style={{ transform: [{ translateY: hop }] }}>
        <TouchableOpacity
          activeOpacity={0.85}
          onPress={onPress}
          hitSlop={{ top: 12, bottom: 12, left: 12, right: 12 }}
        >
          <Pawn color={color} size={W} />
        </TouchableOpacity>
      </Animated.View>
    </Animated.View>
  );
}

/* ------------------------------------------------------------------ */
/* 3D dice (bottom bar)                                                */
/* ------------------------------------------------------------------ */
function Dice({
  face,
  ready,
  rolling,
  color,
  size,
  onPress,
}: {
  face: number;
  ready: boolean;
  rolling: boolean;
  color: string;
  size: number;
  onPress: () => void;
}) {
  const bob = useRef(new Animated.Value(0)).current;
  const shake = useRef(new Animated.Value(0)).current;
  const spin = useRef(new Animated.Value(0)).current;
  const pulse = useRef(new Animated.Value(0)).current;
  const pop = useRef(new Animated.Value(1)).current;
  const wasRolling = useRef(false);

  // idle bob + glow while it's your turn to roll
  useEffect(() => {
    if (!ready) {
      bob.setValue(0);
      pulse.setValue(0);
      return;
    }
    const l = Animated.loop(
      Animated.sequence([
        Animated.timing(bob, { toValue: -6, duration: 520, easing: Easing.inOut(Easing.quad), useNativeDriver: true }),
        Animated.timing(bob, { toValue: 0, duration: 520, easing: Easing.inOut(Easing.quad), useNativeDriver: true }),
      ])
    );
    const p = Animated.loop(
      Animated.sequence([
        Animated.timing(pulse, { toValue: 1, duration: 700, useNativeDriver: true }),
        Animated.timing(pulse, { toValue: 0, duration: 700, useNativeDriver: true }),
      ])
    );
    l.start();
    p.start();
    return () => {
      l.stop();
      p.stop();
    };
  }, [ready, bob, pulse]);

  // tumble while rolling
  useEffect(() => {
    if (!rolling) {
      shake.setValue(0);
      spin.setValue(0);
      return;
    }
    const sh = Animated.loop(
      Animated.sequence([
        Animated.timing(shake, { toValue: 1, duration: 70, useNativeDriver: true }),
        Animated.timing(shake, { toValue: -1, duration: 70, useNativeDriver: true }),
      ])
    );
    const sp = Animated.loop(
      Animated.timing(spin, { toValue: 1, duration: 480, easing: Easing.linear, useNativeDriver: true })
    );
    sh.start();
    sp.start();
    return () => {
      sh.stop();
      sp.stop();
    };
  }, [rolling, shake, spin]);

  // pop when the result lands
  useEffect(() => {
    if (rolling) {
      wasRolling.current = true;
      return;
    }
    if (wasRolling.current && face > 0) {
      wasRolling.current = false;
      pop.setValue(1.3);
      Animated.spring(pop, { toValue: 1, friction: 4, tension: 160, useNativeDriver: true }).start();
    }
  }, [rolling, face, pop]);

  const pips = face ? PIPS[face] : [];
  const pad = size * 0.14;
  const pip = size * 0.17;
  const halo = size + 26;
  return (
    <TouchableOpacity
      activeOpacity={0.9}
      onPress={onPress}
      style={{ width: size, height: size + 12 }}
    >
      {ready && (
        <Animated.View
          pointerEvents="none"
          style={{
            position: 'absolute',
            left: (size - halo) / 2,
            top: (size - halo) / 2,
            width: halo,
            height: halo,
            borderRadius: halo / 2,
            backgroundColor: color,
            opacity: pulse.interpolate({ inputRange: [0, 1], outputRange: [0.2, 0.55] }),
            transform: [{ scale: pulse.interpolate({ inputRange: [0, 1], outputRange: [0.88, 1.1] }) }],
          }}
        />
      )}

      {/* ground shadow */}
      <Animated.View
        pointerEvents="none"
        style={{
          position: 'absolute',
          bottom: 0,
          left: size * 0.1,
          width: size * 0.8,
          height: 10,
          borderRadius: 5,
          backgroundColor: 'rgba(0,0,0,0.38)',
          transform: [
            { scaleX: bob.interpolate({ inputRange: [-6, 0], outputRange: [0.82, 1] }) },
          ],
        }}
      />

      <Animated.View
        style={[
          styles.dice,
          {
            width: size,
            height: size,
            borderRadius: size * 0.26,
            borderColor: ready ? color : '#D3D7E3',
            transform: [
              { translateY: bob },
              { translateX: shake.interpolate({ inputRange: [-1, 1], outputRange: [-4, 4] }) },
              { rotate: spin.interpolate({ inputRange: [0, 1], outputRange: ['0deg', '360deg'] }) },
              { scale: pop },
            ],
          },
        ]}
      >
        <LinearGradient
          colors={['#FFFFFF', '#E3E7F2']}
          start={{ x: 0, y: 0 }}
          end={{ x: 1, y: 1 }}
          style={StyleSheet.absoluteFill}
        />
        <View
          pointerEvents="none"
          style={{
            position: 'absolute',
            top: size * 0.06,
            left: size * 0.1,
            width: size * 0.42,
            height: size * 0.12,
            borderRadius: size * 0.06,
            backgroundColor: 'rgba(255,255,255,0.95)',
          }}
        />
        {face === 0 ? (
          <View style={styles.diceEmpty}>
            <Ionicons name="dice-outline" size={size * 0.55} color="#A4A8B6" />
          </View>
        ) : (
          <View style={[styles.diceGrid, { padding: pad }]}>
            {Array.from({ length: 9 }).map((_, i) => (
              <View key={i} style={styles.pipCell}>
                {pips.includes(i) && (
                  <View
                    style={{
                      width: pip,
                      height: pip,
                      borderRadius: pip / 2,
                      backgroundColor: '#1B1B24',
                    }}
                  >
                    <View
                      style={{
                        position: 'absolute',
                        top: pip * 0.16,
                        left: pip * 0.2,
                        width: pip * 0.3,
                        height: pip * 0.3,
                        borderRadius: pip,
                        backgroundColor: 'rgba(255,255,255,0.4)',
                      }}
                    />
                  </View>
                )}
              </View>
            ))}
          </View>
        )}
      </Animated.View>
    </TouchableOpacity>
  );
}

/* ------------------------------------------------------------------ */
/* Player panel (avatar + name + progress)                             */
/* ------------------------------------------------------------------ */
function PlayerPanel({
  player,
  right,
  active,
  home,
}: {
  player: Player;
  right: boolean;
  active: boolean;
  home: number;
}) {
  const pc = pal(player.color);
  const label = /\d/.test(player.name) ? player.name.replace('Computer', 'CPU') : player.name;
  return (
    <View
      style={[
        styles.panel,
        { flexDirection: right ? 'row-reverse' : 'row' },
        active && { borderColor: pc.main, backgroundColor: 'rgba(255,255,255,0.2)' },
      ]}
    >
      <View
        style={[
          styles.avatar,
          { backgroundColor: pc.main, borderColor: active ? GOLD : '#FFFFFF' },
          active && { transform: [{ scale: 1.06 }] },
        ]}
      >
        <Ionicons name={player.human ? 'person' : 'hardware-chip'} size={21} color="#FFFFFF" />
      </View>
      <View style={[styles.ptext, { alignItems: right ? 'flex-end' : 'flex-start' }]}>
        <Text style={styles.pname} numberOfLines={1}>
          {label}
        </Text>
        <View style={styles.pdots}>
          {[0, 1, 2, 3].map((k) => (
            <View
              key={k}
              style={[
                styles.pdot,
                { borderColor: pc.main },
                k < home && { backgroundColor: pc.main },
              ]}
            />
          ))}
        </View>
        <Text style={styles.pcount}>{home}/4 home</Text>
      </View>
    </View>
  );
}

export default function LudoScreen() {
  const router = useRouter();
  const { width } = useWindowDimensions();
  const S = Math.min(width - 56, 420);
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
    if (t.pos === 56) {
      const hg = g.tokens.filter((o) => o.color === t.color && o.pos === 56);
      const off = (hg.indexOf(t) - (hg.length - 1) / 2) * 0.36;
      const vertical = t.color === 'red' || t.color === 'yellow';
      return { x: x + (vertical ? 0 : off), y: y + (vertical ? off : 0), s: 0.5 };
    }
    const grp = groups[t.pos === -1 ? 'b' + key(t) : x.toFixed(2) + ',' + y.toFixed(2)];
    if (t.pos !== -1 && grp.length > 1) {
      const off = (grp.indexOf(t) - (grp.length - 1) / 2) * 0.3;
      return { x: x + off, y, s: grp.length > 2 ? 0.72 : 0.82 };
    }
    return { x, y, s: 1 };
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
            return { k: key(t), x: dx, y: dy, color: pal(t.color).main, capture };
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
    const Avatar = ({ c, human, size = 46 }: { c: LColor; human: boolean; size?: number }) => (
      <View
        style={[
          styles.sAvatar,
          { width: size, height: size, borderRadius: size / 2, backgroundColor: pal(c).main },
        ]}
      >
        <Ionicons name={human ? 'person' : 'hardware-chip'} size={size * 0.46} color="#fff" />
      </View>
    );
    return (
      <GameScreen>
        <GameHeader title="Ludo" onBack={() => router.back()} />
        <ScrollView contentContainerStyle={styles.setup} showsVerticalScrollIndicator={false}>
          <LinearGradient
            colors={TABLE}
            start={{ x: 0, y: 0 }}
            end={{ x: 1, y: 1 }}
            style={styles.hero}
          >
            <View style={{ flex: 1 }}>
              <Text style={styles.heroTitle}>Classic Ludo</Text>
              <Text style={styles.heroSub}>Roll the dice, race your four tokens home.</Text>
            </View>
            <View style={styles.heroPawns}>
              {COL.map((c, i) => (
                <View key={c} style={{ marginLeft: i === 0 ? 0 : -14, zIndex: 4 - i }}>
                  <Pawn color={c} size={34} />
                </View>
              ))}
            </View>
          </LinearGradient>

          <View>
            <Text style={styles.h4}>Choose your colour</Text>
            <View style={styles.ctiles}>
              {COL.map((c) => {
                const on = c === sel;
                const p = pal(c);
                return (
                  <TouchableOpacity
                    key={c}
                    activeOpacity={0.85}
                    style={[
                      styles.ctile,
                      on && { borderColor: p.main, backgroundColor: p.main + '26' },
                    ]}
                    onPress={() => {
                      play('select');
                      setSel(c);
                    }}
                  >
                    <Pawn color={c} size={40} />
                    <Text style={[styles.ctileText, on && { color: '#fff' }]}>{NAME[c]}</Text>
                    {on && (
                      <View style={[styles.ck, { backgroundColor: p.main }]}>
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
              <Avatar c={sel} human />
              <Text style={styles.sideName}>You</Text>
              <Text style={styles.sideSub}>{NAME[sel]}</Text>
            </View>
            {mode === 2 ? (
              <>
                <View style={styles.vsBadge}>
                  <Text style={styles.vsText}>VS</Text>
                </View>
                <View style={styles.side}>
                  <Avatar c={opp} human={false} />
                  <Text style={styles.sideName}>Computer</Text>
                  <Text style={styles.sideSub}>{NAME[opp]}</Text>
                </View>
              </>
            ) : (
              others.map((c, i) => (
                <View key={c} style={styles.side}>
                  <Avatar c={c} human={false} size={42} />
                  <Text style={styles.sideName}>CPU {i + 1}</Text>
                  <Text style={styles.sideSub}>{NAME[c]}</Text>
                </View>
              ))
            )}
          </View>

          <View style={styles.rules}>
            {(
              [
                ['dice-outline', 'Roll a 6 to bring a token out of the yard.'],
                ['refresh-circle-outline', 'A 6, a capture or reaching home gives another roll.'],
                ['shield-checkmark-outline', 'Star cells and start cells are safe from capture.'],
                ['trophy-outline', 'Get all 4 tokens home first to win.'],
              ] as const
            ).map(([ic, r]) => (
              <View key={r} style={styles.ruleRow}>
                <View style={styles.ruleIc}>
                  <Ionicons name={ic} size={16} color="#C4B5FD" />
                </View>
                <Text style={styles.rule}>{r}</Text>
              </View>
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
  const curColor = cur ? pal(cur.color).main : '#8B5CF6';
  const onCurColor = cur?.color === 'yellow' ? '#1B1B24' : '#FFFFFF';
  const doRoll = () => {
    if (g.phase === 'roll' && cur?.human) roll(g.gid);
  };
  const slot = (c: LColor, right: boolean) => {
    const p = g.players.find((x) => x.color === c);
    if (!p) return <View style={{ flex: 1 }} />;
    const active = g.active && g.players.indexOf(p) === g.turn;
    const home = g.tokens.filter((t) => t.color === c && t.pos === 56).length;
    return (
      <View style={{ flex: 1 }}>
        <PlayerPanel player={p} right={right} active={active} home={home} />
      </View>
    );
  };

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
      <ScrollView contentContainerStyle={{ paddingBottom: 28 }} showsVerticalScrollIndicator={false}>
        <LinearGradient
          colors={TABLE}
          start={{ x: 0, y: 0 }}
          end={{ x: 1, y: 1 }}
          style={styles.arena}
        >
          {/* top corners */}
          <View style={styles.prow}>
            {slot(TOP_ROW[0], false)}
            {slot(TOP_ROW[1], true)}
          </View>

          {/* board */}
          <View style={styles.frame}>
            <View style={{ width: S, height: S }}>
              <View style={[StyleSheet.absoluteFill, styles.boardClip]}>
                <BoardSvg
                  S={S}
                  activeColor={
                    g.active && g.phase !== 'moving' && g.phase !== 'rolling' ? cur?.color ?? null : null
                  }
                />
              </View>
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

          {/* bottom corners */}
          <View style={styles.prow}>
            {slot(BOTTOM_ROW[0], false)}
            {slot(BOTTOM_ROW[1], true)}
          </View>

          {/* dice bar */}
          <View style={styles.dicebar}>
            <Dice
              face={face}
              ready={ready}
              rolling={rolling}
              color={curColor}
              size={78}
              onPress={doRoll}
            />
            <View style={{ flex: 1, minWidth: 0 }}>
              <View style={styles.whoRow}>
                <View style={[styles.statusDot, { backgroundColor: curColor }]} />
                <Text style={styles.statA} numberOfLines={1}>
                  {stat.a}
                </Text>
              </View>
              <Text style={styles.statB} numberOfLines={2}>
                {stat.b}
              </Text>
              {ready && (
                <TouchableOpacity
                  activeOpacity={0.85}
                  style={[styles.rollBtn, { backgroundColor: curColor }]}
                  onPress={doRoll}
                >
                  <Ionicons name="dice" size={16} color={onCurColor} />
                  <Text style={[styles.rollText, { color: onCurColor }]}>Tap to roll</Text>
                </TouchableOpacity>
              )}
            </View>
          </View>
        </LinearGradient>
      </ScrollView>

      {/* help */}
      <Modal visible={help} transparent animationType="fade" statusBarTranslucent onRequestClose={() => setHelp(false)}>
        <View style={styles.hOverlay}>
          <View style={styles.hCard}>
            <Text style={styles.hTitle}>How to play</Text>
            {(
              [
                ['dice-outline', 'Roll', 'Tap the dice beside your name on your turn.'],
                ['exit-outline', 'Leave the yard', 'You need a 6 to bring a token onto your start cell (the arrow).'],
                ['navigate-outline', 'Move', 'Glowing tokens can move. Tap one; the ring shows where it lands.'],
                ['flash-outline', 'Capture', 'Land on an opponent (red ring) to send it back. Stars and start cells are safe.'],
                ['refresh-circle-outline', 'Extra roll', 'A 6, a capture or reaching home gives another roll. Three 6s in a row lose the turn.'],
                ['trophy-outline', 'Win', 'Bring all 4 tokens into the centre. The last step needs the exact number.'],
              ] as const
            ).map(([ic, a, b]) => (
              <View key={a} style={styles.hRow}>
                <View style={styles.hIc}>
                  <Ionicons name={ic} size={17} color="#C4B5FD" />
                </View>
                <View style={{ flex: 1 }}>
                  <Text style={styles.hHead}>{a}</Text>
                  <Text style={styles.hBody}>{b}</Text>
                </View>
              </View>
            ))}
            <View style={styles.hLegend}>
              <View style={styles.lg}>
                <Ionicons name="star" size={14} color="#8E8E9E" />
                <Text style={styles.lgText}>Safe</Text>
              </View>
              <View style={styles.lg}>
                <Ionicons name="arrow-forward-circle" size={15} color="#fff" />
                <Text style={styles.lgText}>Start</Text>
              </View>
              <View style={styles.lg}>
                <View style={[styles.lgRing, { borderColor: '#14141C' }]} />
                <Text style={styles.lgText}>Lands here</Text>
              </View>
              <View style={styles.lg}>
                <View style={[styles.lgRing, { borderColor: '#FF2D3A', backgroundColor: 'rgba(255,45,58,0.4)' }]} />
                <Text style={styles.lgText}>Capture</Text>
              </View>
            </View>
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
  /* setup */
  setup: { padding: 16, gap: 18, paddingBottom: 32 },
  hero: {
    flexDirection: 'row',
    alignItems: 'center',
    borderRadius: 22,
    paddingVertical: 18,
    paddingHorizontal: 18,
    gap: 10,
  },
  heroTitle: { color: '#fff', fontSize: 22, fontFamily: FONTS.displayBold },
  heroSub: { color: 'rgba(255,255,255,0.78)', fontSize: 12.5, lineHeight: 18, fontFamily: FONTS.body, marginTop: 4 },
  heroPawns: { flexDirection: 'row', alignItems: 'flex-end' },
  h4: { fontSize: 13, fontFamily: FONTS.bodySemiBold, color: COLORS.mistLight, marginBottom: 10, letterSpacing: 0.3 },
  ctiles: { flexDirection: 'row', gap: 10 },
  ctile: {
    flex: 1,
    aspectRatio: 0.82,
    borderRadius: 18,
    backgroundColor: GC.card,
    borderWidth: 1.5,
    borderColor: GC.line,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
  },
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
  segBtn: { flex: 1, height: 40, borderRadius: 11, alignItems: 'center', justifyContent: 'center' },
  segOn: { backgroundColor: '#7C3AED' },
  segText: { fontSize: 13, fontFamily: FONTS.bodySemiBold, color: COLORS.mistLight },
  vs: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 16,
    backgroundColor: GC.card,
    borderWidth: 1,
    borderColor: GC.line,
    borderRadius: 20,
    paddingVertical: 16,
    paddingHorizontal: 14,
  },
  side: { alignItems: 'center', gap: 5 },
  sAvatar: { alignItems: 'center', justifyContent: 'center', borderWidth: 3, borderColor: '#FFFFFF' },
  sideName: { fontSize: 12.5, fontFamily: FONTS.bodySemiBold, color: '#fff' },
  sideSub: { fontSize: 11, fontFamily: FONTS.body, color: COLORS.mist },
  vsBadge: {
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: 'rgba(255,255,255,0.06)',
    borderWidth: 1,
    borderColor: GC.line,
    alignItems: 'center',
    justifyContent: 'center',
  },
  vsText: { fontSize: 12, fontFamily: FONTS.displayBold, color: COLORS.mistLight },
  rules: {
    gap: 10,
    backgroundColor: GC.card,
    borderWidth: 1,
    borderColor: GC.line,
    borderRadius: 18,
    padding: 14,
  },
  ruleRow: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  ruleIc: {
    width: 30,
    height: 30,
    borderRadius: 10,
    backgroundColor: 'rgba(124,58,237,0.16)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  rule: { flex: 1, fontSize: 12.5, lineHeight: 18, fontFamily: FONTS.body, color: COLORS.mistLight },

  /* game table */
  arena: {
    marginHorizontal: 12,
    marginTop: 4,
    borderRadius: 26,
    padding: 10,
    gap: 8,
  },
  prow: { flexDirection: 'row', gap: 8 },
  panel: {
    alignItems: 'center',
    gap: 9,
    paddingHorizontal: 8,
    paddingVertical: 8,
    borderRadius: 18,
    backgroundColor: 'rgba(255,255,255,0.1)',
    borderWidth: 1.5,
    borderColor: 'rgba(255,255,255,0.16)',
  },
  avatar: {
    width: 46,
    height: 46,
    borderRadius: 23,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 3,
  },
  ptext: { flex: 1, minWidth: 0, justifyContent: 'center' },
  pname: { color: '#FFFFFF', fontSize: 13, fontFamily: FONTS.bodySemiBold },
  pdots: { flexDirection: 'row', gap: 3, marginTop: 5 },
  pdot: { width: 8, height: 8, borderRadius: 4, borderWidth: 1.5 },
  pcount: { color: 'rgba(255,255,255,0.65)', fontSize: 10.5, fontFamily: FONTS.body, marginTop: 3 },

  frame: {
    alignSelf: 'center',
    padding: 6,
    borderRadius: 18,
    backgroundColor: '#16183A',
    borderWidth: 2,
    borderColor: GOLD,
    shadowColor: '#000',
    shadowOpacity: 0.4,
    shadowRadius: 10,
    shadowOffset: { width: 0, height: 5 },
    elevation: 8,
  },
  boardClip: { borderRadius: 10, overflow: 'hidden' },

  /* dice */
  dice: {
    overflow: 'hidden',
    backgroundColor: '#FFFFFF',
    borderWidth: 1.5,
    borderBottomWidth: 5,
    borderBottomColor: '#A9AEC2',
    borderRightWidth: 3,
    borderRightColor: '#BFC4D6',
    shadowColor: '#000',
    shadowOpacity: 0.35,
    shadowRadius: 6,
    shadowOffset: { width: 0, height: 4 },
    elevation: 6,
  },
  diceGrid: { flex: 1, flexDirection: 'row', flexWrap: 'wrap' },
  diceEmpty: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  pipCell: { width: '33.33%', height: '33.33%', alignItems: 'center', justifyContent: 'center' },

  /* dice bar */
  dicebar: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 16,
    paddingVertical: 14,
    paddingHorizontal: 16,
    borderRadius: 22,
    backgroundColor: 'rgba(0,0,0,0.3)',
  },
  whoRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  statusDot: { width: 10, height: 10, borderRadius: 5 },
  statA: { flex: 1, color: '#FFFFFF', fontSize: 15, fontFamily: FONTS.bodySemiBold },
  statB: { color: 'rgba(255,255,255,0.72)', fontSize: 12.5, lineHeight: 17, fontFamily: FONTS.body, marginTop: 3 },
  rollBtn: {
    alignSelf: 'flex-start',
    flexDirection: 'row',
    alignItems: 'center',
    gap: 7,
    marginTop: 10,
    paddingVertical: 8,
    paddingHorizontal: 14,
    borderRadius: 999,
  },
  rollText: { fontSize: 13, fontFamily: FONTS.bodySemiBold },

  /* help */
  hOverlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.78)', alignItems: 'center', justifyContent: 'center' },
  hCard: {
    width: '90%',
    maxWidth: 380,
    backgroundColor: GC.card,
    borderWidth: 1,
    borderColor: GC.line2,
    borderRadius: 24,
    padding: 20,
  },
  hTitle: { color: '#fff', fontSize: 20, fontFamily: FONTS.displayBold, marginBottom: 14 },
  hRow: { flexDirection: 'row', gap: 12, marginBottom: 12 },
  hIc: {
    width: 32,
    height: 32,
    borderRadius: 10,
    backgroundColor: 'rgba(124,58,237,0.16)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  hHead: { color: '#fff', fontSize: 13, fontFamily: FONTS.bodySemiBold },
  hBody: { color: COLORS.mistLight, fontSize: 12.5, lineHeight: 18, fontFamily: FONTS.body, marginTop: 1 },
  hLegend: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    justifyContent: 'center',
    gap: 14,
    marginTop: 2,
    marginBottom: 16,
    paddingVertical: 10,
    borderRadius: 12,
    backgroundColor: 'rgba(255,255,255,0.04)',
  },
  lg: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  lgText: { color: COLORS.mist, fontSize: 11, fontFamily: FONTS.body },
  lgRing: { width: 14, height: 14, borderRadius: 7, borderWidth: 2.5, backgroundColor: 'rgba(255,255,255,0.12)' },
});
