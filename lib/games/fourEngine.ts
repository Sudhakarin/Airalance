// lib/games/fourEngine.ts
// Four in a Row: board maths + Computer player (minimax with alpha-beta).
// Board is a flat array of 42 numbers, row 0 = top. 0 empty, 1 = you, 2 = Computer.

export const ROWS = 6;
export const COLS = 7;
export type Level = 'easy' | 'medium' | 'hard';

const ORDER = [3, 2, 4, 1, 5, 0, 6]; // centre first = better pruning

export const WIN: number[][] = [];
for (let r = 0; r < ROWS; r++)
  for (let c = 0; c < COLS; c++)
    ([[0, 1], [1, 0], [1, 1], [1, -1]] as const).forEach(([dr, dc]) => {
      const er = r + 3 * dr;
      const ec = c + 3 * dc;
      if (er < 0 || er >= ROWS || ec < 0 || ec >= COLS) return;
      WIN.push([0, 1, 2, 3].map((k) => (r + k * dr) * COLS + c + k * dc));
    });

export const dropRow = (b: number[], c: number) => {
  for (let r = ROWS - 1; r >= 0; r--) if (!b[r * COLS + c]) return r;
  return -1;
};
export const winAt = (b: number[], p: number) => WIN.find((w) => w.every((i) => b[i] === p));

function evalBoard(b: number[]) {
  let s = 0;
  for (const w of WIN) {
    let me = 0;
    let op = 0;
    for (const i of w) {
      const v = b[i];
      if (v === 2) me++;
      else if (v === 1) op++;
    }
    if (me && op) continue;
    if (me === 3) s += 100;
    else if (me === 2) s += 10;
    if (op === 3) s -= 90;
    else if (op === 2) s -= 8;
  }
  for (let r = 0; r < ROWS; r++) {
    const v = b[r * COLS + 3];
    if (v === 2) s += 6;
    else if (v === 1) s -= 6;
  }
  return s;
}

function search(b: number[], d: number, alpha: number, beta: number, max: boolean): number {
  if (winAt(b, 2)) return 1e6 + d;
  if (winAt(b, 1)) return -1e6 - d;
  const mv = ORDER.filter((c) => !b[c]);
  if (!mv.length) return 0;
  if (d === 0) return evalBoard(b);
  if (max) {
    let v = -1e9;
    for (const c of mv) {
      const r = dropRow(b, c);
      b[r * COLS + c] = 2;
      v = Math.max(v, search(b, d - 1, alpha, beta, false));
      b[r * COLS + c] = 0;
      alpha = Math.max(alpha, v);
      if (alpha >= beta) break;
    }
    return v;
  }
  let v = 1e9;
  for (const c of mv) {
    const r = dropRow(b, c);
    b[r * COLS + c] = 1;
    v = Math.min(v, search(b, d - 1, alpha, beta, true));
    b[r * COLS + c] = 0;
    beta = Math.min(beta, v);
    if (alpha >= beta) break;
  }
  return v;
}

/** column the Computer plays */
export function cpuPick(board: number[], level: Level): number {
  const b = board.slice();
  const mv = ORDER.filter((c) => !b[c]);
  // 1) always take a winning move
  for (const c of mv) {
    const r = dropRow(b, c);
    b[r * COLS + c] = 2;
    const w = winAt(b, 2);
    b[r * COLS + c] = 0;
    if (w) return c;
  }
  // easier levels sometimes "miss" the block and play randomly
  const slip = level === 'easy' ? 0.35 : level === 'medium' ? 0.08 : 0;
  if (Math.random() < slip) return mv[Math.floor(Math.random() * mv.length)];
  // 2) block your immediate win
  for (const c of mv) {
    const r = dropRow(b, c);
    b[r * COLS + c] = 1;
    const w = winAt(b, 1);
    b[r * COLS + c] = 0;
    if (w) return c;
  }
  // 3) look ahead
  const depth = level === 'easy' ? 2 : level === 'medium' ? 4 : 6;
  let best = -1e9;
  let pick = mv[0];
  for (const c of mv) {
    const r = dropRow(b, c);
    b[r * COLS + c] = 2;
    const v = search(b, depth - 1, -1e9, 1e9, false) + Math.random() * 2;
    b[r * COLS + c] = 0;
    if (v > best) {
      best = v;
      pick = c;
    }
  }
  return pick;
}
