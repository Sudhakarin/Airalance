// lib/games/ludoEngine.ts
// Pure Ludo rules + board geometry + computer player. No React in here.

export type LColor = 'red' | 'green' | 'yellow' | 'blue';
export const COL: LColor[] = ['red', 'green', 'yellow', 'blue'];
export const HEX: Record<LColor, string> = {
  red: '#F0454F',
  green: '#2FBF71',
  yellow: '#F5B83D',
  blue: '#3B82F6',
};
export const NAME: Record<LColor, string> = {
  red: 'Red',
  green: 'Green',
  yellow: 'Yellow',
  blue: 'Blue',
};
export const OPP: Record<LColor, LColor> = {
  red: 'yellow',
  yellow: 'red',
  green: 'blue',
  blue: 'green',
};
export const START: Record<LColor, number> = { red: 0, green: 13, yellow: 26, blue: 39 };
export const SAFE = new Set([0, 8, 13, 21, 26, 34, 39, 47]);
export const LANE: Record<LColor, [number, number][]> = {
  red: [[7, 1], [7, 2], [7, 3], [7, 4], [7, 5]],
  green: [[1, 7], [2, 7], [3, 7], [4, 7], [5, 7]],
  yellow: [[7, 13], [7, 12], [7, 11], [7, 10], [7, 9]],
  blue: [[13, 7], [12, 7], [11, 7], [10, 7], [9, 7]],
};
export const HOMEPT: Record<LColor, [number, number]> = {
  red: [6.75, 7.5],
  green: [7.5, 6.75],
  yellow: [8.25, 7.5],
  blue: [7.5, 8.25],
};
// yard top-left corner in cells: [x0, y0]
export const YARD: Record<LColor, [number, number]> = {
  red: [0, 0],
  green: [9, 0],
  yellow: [9, 9],
  blue: [0, 9],
};
export const SLOTS: [number, number][] = [[2, 2], [4, 2], [2, 4], [4, 4]];

/** 52 cells of the outer track as [row, col], clockwise starting at red's start. */
export const PATH: [number, number][] = (() => {
  const P: [number, number][] = [];
  const a = (r: number, c: number) => P.push([r, c]);
  for (let c = 1; c <= 5; c++) a(6, c);
  for (let r = 5; r >= 0; r--) a(r, 6);
  a(0, 7);
  a(0, 8);
  for (let r = 1; r <= 5; r++) a(r, 8);
  for (let c = 9; c <= 14; c++) a(6, c);
  a(7, 14);
  a(8, 14);
  for (let c = 13; c >= 9; c--) a(8, c);
  for (let r = 9; r <= 14; r++) a(r, 8);
  a(14, 7);
  a(14, 6);
  for (let r = 13; r >= 9; r--) a(r, 6);
  for (let c = 5; c >= 0; c--) a(8, c);
  a(7, 0);
  a(6, 0);
  return P;
})();

export type LToken = { color: LColor; idx: number; pos: number }; // pos -1 = yard, 0..50 track, 51..55 lane, 56 home

/** centre of the token in cell units [x, y] */
export function coords(t: LToken): [number, number] {
  if (t.pos === -1) {
    const [x0, y0] = YARD[t.color];
    const o = SLOTS[t.idx];
    return [x0 + o[0], y0 + o[1]];
  }
  if (t.pos <= 50) {
    const [r, c] = PATH[(START[t.color] + t.pos) % 52];
    return [c + 0.5, r + 0.5];
  }
  if (t.pos <= 55) {
    const [r, c] = LANE[t.color][t.pos - 51];
    return [c + 0.5, r + 0.5];
  }
  return HOMEPT[t.color];
}

export const absPos = (t: LToken) => (START[t.color] + t.pos) % 52;

export function movable(tokens: LToken[], color: LColor, v: number) {
  return tokens.filter(
    (t) => t.color === color && (t.pos === -1 ? v === 6 : t.pos + v <= 56)
  );
}

export const PIPS: Record<number, number[]> = {
  1: [4],
  2: [0, 8],
  3: [0, 4, 8],
  4: [0, 2, 6, 8],
  5: [0, 2, 4, 6, 8],
  6: [0, 2, 3, 5, 6, 8],
};

/** Computer decision: capture > home > leave yard > safe cell, avoids danger. */
export function aiPick(tokens: LToken[], color: LColor, mv: LToken[], v: number): LToken {
  const opp = tokens.filter((o) => o.color !== color && o.pos >= 0 && o.pos <= 50);
  const outCount = tokens.filter((t) => t.color === color && t.pos >= 0 && t.pos < 56).length;
  const threatened = (abs: number) =>
    !SAFE.has(abs) &&
    opp.some((o) => {
      const dist = (abs - absPos(o) + 52) % 52;
      return dist >= 1 && dist <= 6;
    });
  let best = mv[0];
  let bs = -1e9;
  for (const t of mv) {
    let s = Math.random() * 6;
    if (t.pos === -1) {
      s += outCount === 0 ? 90 : 48;
    } else {
      const np = t.pos + v;
      s += np * 0.35;
      if (np === 56) s += 110;
      else if (np > 50) s += 42;
      if (t.pos <= 50 && threatened(absPos(t))) s += 26;
      if (np <= 50) {
        const na = (START[color] + np) % 52;
        if (SAFE.has(na)) s += 24;
        const vic = opp.filter((o) => absPos(o) === na);
        if (vic.length && !SAFE.has(na)) s += 95 + vic[0].pos * 0.6;
        if (threatened(na)) s -= 34;
      }
    }
    if (s > bs) {
      bs = s;
      best = t;
    }
  }
  return best;
}
