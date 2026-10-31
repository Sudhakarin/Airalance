// lib/games/blitzEngine.ts
// Block Blitz rules: 8x8 board, 3 pieces at a time, clear full rows / columns.

export const N = 8;
export type Shape = { rows: string[]; cs: [number, number][]; h: number; w: number };
export type Piece = { sh: Shape; col: number; used: boolean };
export type BGrid = number[][]; // -1 empty, else colour index 0..5

/** [light, dark] per colour — used for the bevelled block look */
export const BLOCK_COLORS: [string, string][] = [
  ['#A78BFA', '#6D28D9'],
  ['#F472B6', '#BE185D'],
  ['#FBBF24', '#B45309'],
  ['#34D399', '#047857'],
  ['#60A5FA', '#1D4ED8'],
  ['#F87171', '#B91C1C'],
];

// duplicated entries = more likely to appear (small pieces come up more often)
const RAW: string[][] = [
  ['#'], ['#'], ['##'], ['##'], ['#', '#'], ['#', '#'],
  ['###'], ['###'], ['#', '#', '#'], ['#', '#', '#'],
  ['####'], ['#', '#', '#', '#'], ['#####'], ['#', '#', '#', '#', '#'],
  ['##', '##'], ['##', '##'], ['###', '###', '###'], ['###', '###'], ['##', '##', '##'],
  ['#.', '##'], ['.#', '##'], ['##', '#.'], ['##', '.#'],
  ['#..', '#..', '###'], ['..#', '..#', '###'], ['###', '#..', '#..'], ['###', '..#', '..#'],
  ['###', '.#.'], ['.#.', '###'], ['.##', '##.'], ['##', '.##'], ['#.', '##', '.#'], ['.#', '##', '#.'],
];

export const SHAPES: Shape[] = RAW.map((rows) => {
  const cs: [number, number][] = [];
  rows.forEach((s, r) => [...s].forEach((ch, c) => ch === '#' && cs.push([r, c])));
  return { rows, cs, h: rows.length, w: rows[0].length };
});

export const emptyGrid = (): BGrid => Array.from({ length: N }, () => Array(N).fill(-1));

export function fits(g: BGrid, sh: Shape, gx: number, gy: number) {
  for (const [r, c] of sh.cs) {
    const y = gy + r;
    const x = gx + c;
    if (x < 0 || y < 0 || x >= N || y >= N || g[y][x] >= 0) return false;
  }
  return true;
}

export function anywhere(g: BGrid, sh: Shape) {
  for (let y = 0; y <= N - sh.h; y++) for (let x = 0; x <= N - sh.w; x++) if (fits(g, sh, x, y)) return true;
  return false;
}

/** three random pieces; makes sure at least one of them can still be placed */
export function genTray(g: BGrid): Piece[] {
  let tr: Piece[] = [];
  for (let t = 0; t < 40; t++) {
    tr = [0, 1, 2].map(() => ({
      sh: SHAPES[Math.floor(Math.random() * SHAPES.length)],
      col: Math.floor(Math.random() * 6),
      used: false,
    }));
    if (tr.some((p) => anywhere(g, p.sh))) break;
  }
  return tr;
}

/** rows / columns that are completely filled */
export function fullLines(g: BGrid) {
  const rows: number[] = [];
  const cols: number[] = [];
  for (let r = 0; r < N; r++) if (g[r].every((v) => v >= 0)) rows.push(r);
  for (let c = 0; c < N; c++) if (g.every((row) => row[c] >= 0)) cols.push(c);
  return { rows, cols };
}

export function lineCells(rows: number[], cols: number[]) {
  const set = new Set<number>();
  rows.forEach((r) => {
    for (let c = 0; c < N; c++) set.add(r * N + c);
  });
  cols.forEach((c) => {
    for (let r = 0; r < N; r++) set.add(r * N + c);
  });
  return set;
}

export const isEmpty = (g: BGrid) => g.every((row) => row.every((v) => v < 0));
export const cloneGrid = (g: BGrid): BGrid => g.map((r) => r.slice());
