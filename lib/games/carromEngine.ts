// lib/games/carromEngine.ts
// Pure carrom physics + computer shot planner. Coordinates are on a 600 x 600 board.

export const W = 600;
export const CR = 13.5; // coin radius
export const SR = 17.5; // striker radius
export const PR = 24; // pocket capture radius
export const DAMP = 1.5; // velocity decay per second
export const POCK: [number, number][] = [[20, 20], [580, 20], [20, 580], [580, 580]];
export const BASE = { user: 505, cpu: 95 };

export type CType = 'w' | 'b' | 'q';
export type Body = { x: number; y: number; vx: number; vy: number; r: number; m: number; t: CType | 's' };
export type Coin = Body & { t: CType };
export type Striker = Body & { t: 's'; gone: boolean };
export type Sink = { x: number; y: number; tx: number; ty: number; t: CType | 's'; age: number };
export type World = { coins: Coin[]; st: Striker; sinking: Sink[] };
export type Events = {
  hit: (intensity: number) => void;
  wall: (intensity: number) => void;
  pocket: (t: CType | 's') => void;
};

export const clamp = (v: number, a: number, b: number) => Math.max(a, Math.min(b, v));
const rnd = (a: number, b: number) => a + Math.random() * (b - a);

export function newStriker(): Striker {
  return { x: 300, y: BASE.user, vx: 0, vy: 0, r: SR, m: 1.8, t: 's', gone: false };
}

/** Standard-ish start: queen in the middle, 6 inner + 12 outer coins alternating colour. */
export function layout(): Coin[] {
  const coins: Coin[] = [{ x: 300, y: 300, vx: 0, vy: 0, r: CR, m: 1, t: 'q' }];
  for (let k = 0; k < 6; k++) {
    const a = (k * Math.PI) / 3 + Math.PI / 2;
    const R = 2 * CR + 1;
    coins.push({ x: 300 + Math.cos(a) * R, y: 300 + Math.sin(a) * R, vx: 0, vy: 0, r: CR, m: 1, t: k % 2 ? 'b' : 'w' });
  }
  for (let j = 0; j < 12; j++) {
    const a = (j * Math.PI) / 6 + Math.PI / 2;
    const R = j % 2 ? 2 * Math.sqrt(3) * CR + 2 : 4 * CR + 2;
    coins.push({ x: 300 + Math.cos(a) * R, y: 300 + Math.sin(a) * R, vx: 0, vy: 0, r: CR, m: 1, t: j % 2 ? 'b' : 'w' });
  }
  return coins;
}

/** free spot near the centre to put a returned coin */
export function spawnSpot(coins: Coin[]): [number, number] {
  const cand: [number, number][] = [[300, 300]];
  for (let r = 28; r < 110; r += 28)
    for (let k = 0; k < 8; k++) cand.push([300 + Math.cos((k * Math.PI) / 4) * r, 300 + Math.sin((k * Math.PI) / 4) * r]);
  return cand.find(([x, y]) => !coins.some((c) => Math.hypot(c.x - x, c.y - y) < 2 * CR + 1)) || [300, 300];
}

function collide(a: Body, b: Body, ev: Events) {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const d = Math.hypot(dx, dy);
  const min = a.r + b.r;
  if (d >= min || d === 0) return;
  const nx = dx / d;
  const ny = dy / d;
  const ov = min - d;
  const tm = a.m + b.m;
  a.x -= nx * ov * (b.m / tm);
  a.y -= ny * ov * (b.m / tm);
  b.x += nx * ov * (a.m / tm);
  b.y += ny * ov * (a.m / tm);
  const vr = (b.vx - a.vx) * nx + (b.vy - a.vy) * ny;
  if (vr < 0) {
    const j = (-(1 + 0.9) * vr) / (1 / a.m + 1 / b.m);
    a.vx -= (j * nx) / a.m;
    a.vy -= (j * ny) / a.m;
    b.vx += (j * nx) / b.m;
    b.vy += (j * ny) / b.m;
    ev.hit(-vr / 900);
  }
}

export function stepPhys(w: World, h: number, ev: Events) {
  const all: Body[] = w.st.gone ? [...w.coins] : [...w.coins, w.st];
  const f = Math.exp(-DAMP * h);
  for (const b of all) {
    b.x += b.vx * h;
    b.y += b.vy * h;
    b.vx *= f;
    b.vy *= f;
    if (Math.hypot(b.vx, b.vy) < 7) b.vx = b.vy = 0;
    const r = b.r;
    const e = 0.8;
    if (b.x < r) {
      b.x = r;
      if (b.vx < 0) { ev.wall(-b.vx / 900); b.vx = -b.vx * e; }
    }
    if (b.x > W - r) {
      b.x = W - r;
      if (b.vx > 0) { ev.wall(b.vx / 900); b.vx = -b.vx * e; }
    }
    if (b.y < r) {
      b.y = r;
      if (b.vy < 0) { ev.wall(-b.vy / 900); b.vy = -b.vy * e; }
    }
    if (b.y > W - r) {
      b.y = W - r;
      if (b.vy > 0) { ev.wall(b.vy / 900); b.vy = -b.vy * e; }
    }
  }
  for (let i = 0; i < all.length; i++) for (let j = i + 1; j < all.length; j++) collide(all[i], all[j], ev);
  for (const p of POCK) {
    for (let i = w.coins.length - 1; i >= 0; i--) {
      const c = w.coins[i];
      if (Math.hypot(c.x - p[0], c.y - p[1]) < PR) {
        w.coins.splice(i, 1);
        w.sinking.push({ x: c.x, y: c.y, tx: p[0], ty: p[1], t: c.t, age: 0 });
        ev.pocket(c.t);
      }
    }
    if (!w.st.gone && Math.hypot(w.st.x - p[0], w.st.y - p[1]) < PR) {
      w.st.gone = true;
      w.st.vx = w.st.vy = 0;
      w.sinking.push({ x: w.st.x, y: w.st.y, tx: p[0], ty: p[1], t: 's', age: 0 });
      ev.pocket('s');
    }
  }
}

export const isMoving = (w: World) =>
  w.coins.some((c) => c.vx || c.vy) || (!w.st.gone && (w.st.vx || w.st.vy));

export const strikerOverlaps = (w: World) =>
  w.coins.some((c) => Math.hypot(c.x - w.st.x, c.y - w.st.y) < SR + CR - 0.5);

/** first thing the striker would touch along a direction */
export function ray(w: World, px: number, py: number, dx: number, dy: number) {
  let best: { t: number; c: Coin | null } = { t: 1e9, c: null };
  for (const c of w.coins) {
    const fx = px - c.x;
    const fy = py - c.y;
    const R = SR + c.r;
    const b = fx * dx + fy * dy;
    const cc = fx * fx + fy * fy - R * R;
    const disc = b * b - cc;
    if (disc < 0) continue;
    const t = -b - Math.sqrt(disc);
    if (t > 0 && t < best.t) best = { t, c };
  }
  let tw = 1e9;
  if (dx > 0) tw = Math.min(tw, (W - SR - px) / dx);
  if (dx < 0) tw = Math.min(tw, (SR - px) / dx);
  if (dy > 0) tw = Math.min(tw, (W - SR - py) / dy);
  if (dy < 0) tw = Math.min(tw, (SR - py) / dy);
  if (tw < best.t) best = { t: tw, c: null };
  return best;
}

function distSeg(px: number, py: number, ax: number, ay: number, bx: number, by: number) {
  const abx = bx - ax;
  const aby = by - ay;
  const t = clamp(((px - ax) * abx + (py - ay) * aby) / (abx * abx + aby * aby || 1), 0, 1);
  return Math.hypot(px - (ax + abx * t), py - (ay + aby * t));
}

/** Computer: try striker positions x coin x pocket, keep the cleanest shot, add a little human error. */
export function cpuPlan(w: World) {
  const y = BASE.cpu;
  const coins = w.coins;
  const own = coins.filter((c) => c.t === 'b' || c.t === 'q');
  let best: { score: number; x: number; vx: number; vy: number; dist: number } | null = null;
  for (let x = 112; x <= 488; x += 12) {
    if (coins.some((c) => Math.hypot(c.x - x, c.y - y) < SR + CR + 2)) continue;
    for (const c of own)
      for (const p of POCK) {
        const dx = p[0] - c.x;
        const dy = p[1] - c.y;
        const dl = Math.hypot(dx, dy);
        const ux = dx / dl;
        const uy = dy / dl;
        const gx = c.x - ux * (CR + SR);
        const gy = c.y - uy * (CR + SR);
        if (gx < SR || gx > W - SR || gy < SR || gy > W - SR) continue;
        const ax = gx - x;
        const ay = gy - y;
        const al = Math.hypot(ax, ay);
        const vx = ax / al;
        const vy = ay / al;
        if (vy < 0.05) continue;
        const cut = vx * ux + vy * uy;
        if (cut < 0.4) continue;
        let bad = false;
        for (const o of coins) {
          if (o === c) continue;
          if (distSeg(o.x, o.y, x, y, gx, gy) < CR + SR - 1 || distSeg(o.x, o.y, c.x, c.y, p[0], p[1]) < CR * 2 - 1) {
            bad = true;
            break;
          }
        }
        if (bad) continue;
        const score = cut * 2 - (al + dl) / 1100 + (c.t === 'q' ? 0.25 : 0) + Math.random() * 0.2;
        if (!best || score > best.score) best = { score, x, vx, vy, dist: al + dl };
      }
  }
  if (!best) {
    let x = 300;
    for (let i = 0; i < 30; i++) {
      const tx = rnd(120, 480);
      if (!coins.some((c) => Math.hypot(c.x - tx, c.y - y) < SR + CR + 2)) {
        x = tx;
        break;
      }
    }
    const pool = own.length ? own : coins;
    const tgt = pool[Math.floor(Math.random() * pool.length)];
    const ax = tgt.x - x;
    const ay = tgt.y - y;
    const al = Math.hypot(ax, ay) || 1;
    best = { score: 0, x, vx: ax / al, vy: ay / al, dist: al + 100 };
  }
  const ang = Math.atan2(best.vy, best.vx) + rnd(-0.022, 0.022);
  const v0 = clamp(best.dist * DAMP * 1.35 + 260, 380, 2100);
  return { x: best.x, dx: Math.cos(ang), dy: Math.sin(ang), power: clamp((v0 - 380) / 1750, 0.05, 1) };
}

export const shotSpeed = (power: number) => 380 + power * 1750;
