// lib/games/arrowEngine.ts
// Arrow puzzle board generation. Boards are always solvable:
// arrows are given a removal order, and each arrow only ever points along a line where
// every arrow in its way is removed earlier.

export const DIR: [number, number][] = [[0, -1], [1, 0], [0, 1], [-1, 0]]; // up, right, down, left

export type Grid = number[]; // -1 empty, else direction 0..3

const ri = (n: number) => Math.floor(Math.random() * n);

export function levelSize(level: number) {
  return Math.min(5 + Math.floor((level - 1) / 2), 9);
}
export function levelDensity(level: number) {
  return Math.max(0.66, Math.min(0.8, 0.66 + level * 0.015));
}
/** ms the Computer needs per arrow on this level */
export function cpuInterval(level: number) {
  return Math.max(1250, Math.min(3000, 3000 - level * 190));
}

export function generate(n: number, density: number): Grid {
  for (let tries = 0; tries < 400; tries++) {
    const cells: number[] = [];
    for (let i = 0; i < n * n; i++) if (Math.random() < density) cells.push(i);
    if (cells.length < 6) continue;
    for (let i = cells.length - 1; i > 0; i--) {
      const j = ri(i + 1);
      [cells[i], cells[j]] = [cells[j], cells[i]];
    }
    const order = new Map<number, number>(cells.map((c, i) => [c, i]));
    const g: Grid = Array(n * n).fill(-1);
    cells.forEach((c, idx) => {
      const x = c % n;
      const y = Math.floor(c / n);
      const valid: number[] = [];
      const withB: number[] = [];
      for (let d = 0; d < 4; d++) {
        let cx = x + DIR[d][0];
        let cy = y + DIR[d][1];
        let ok = true;
        let bl = 0;
        while (cx >= 0 && cx < n && cy >= 0 && cy < n) {
          const o = order.get(cy * n + cx);
          if (o !== undefined) {
            if (o > idx) {
              ok = false;
              break;
            }
            bl++;
          }
          cx += DIR[d][0];
          cy += DIR[d][1];
        }
        if (ok) {
          valid.push(d);
          if (bl) withB.push(d);
        }
      }
      if (!valid.length) {
        order.delete(c);
        return;
      }
      const pool = withB.length && Math.random() < 0.75 ? withB : valid;
      g[c] = pool[ri(pool.length)];
    });
    if (g.filter((v) => v >= 0).length >= Math.max(6, Math.floor(n * n * 0.45))) return g;
  }
  return Array(n * n)
    .fill(-1)
    .map((_, i) => (i % n === 0 ? 1 : -1));
}

/** cells in the line the arrow at i would slide through */
export function pathCells(grid: Grid, n: number, i: number): number[] {
  const d = grid[i];
  const out: number[] = [];
  let cx = (i % n) + DIR[d][0];
  let cy = Math.floor(i / n) + DIR[d][1];
  while (cx >= 0 && cx < n && cy >= 0 && cy < n) {
    out.push(cy * n + cx);
    cx += DIR[d][0];
    cy += DIR[d][1];
  }
  return out;
}

export const blockers = (grid: Grid, n: number, i: number) =>
  pathCells(grid, n, i).filter((c) => grid[c] >= 0);

/** how many cells the arrow travels to be fully off the board */
export function exitSteps(n: number, i: number, d: number) {
  const x = i % n;
  const y = Math.floor(i / n);
  return (d === 1 ? n - x : d === 3 ? x + 1 : d === 2 ? n - y : y + 1) + 1;
}
