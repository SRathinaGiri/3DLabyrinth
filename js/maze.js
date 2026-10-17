/* ==========================================================================
   3D LABYRINTH - PROCEDURAL LEVEL GENERATOR
   Seeded maze (recursive backtracker) + hurdle placement. Pure module.
   Grid: col 0..cols-1 left->right (+x), row 0..rows-1 far->near (-z -> +z).
   ========================================================================== */

import { BOARD, CORRIDOR_HALF, TIME, levelParams } from './config.js';

export const N = 1, E = 2, S = 4, W = 8;
const DIRS = [
  { bit: N, dc: 0, dr: -1, opp: S },
  { bit: E, dc: 1, dr: 0, opp: W },
  { bit: S, dc: 0, dr: 1, opp: N },
  { bit: W, dc: -1, dr: 0, opp: E }
];

export function mulberry32(seed) {
  let a = seed >>> 0;
  return function () {
    a = (a + 0x6D2B79F5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function shuffle(arr, rng) {
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}

/** Perfect maze: every cell reachable, exactly one route between any two cells. */
export function generateMaze(cols, rows, rng) {
  const cells = new Uint8Array(cols * rows).fill(N | E | S | W);
  const visited = new Uint8Array(cols * rows);
  const stack = [[0, rows - 1]];
  visited[(rows - 1) * cols] = 1;
  while (stack.length) {
    const [c, r] = stack[stack.length - 1];
    const options = DIRS.filter(d => {
      const nc = c + d.dc, nr = r + d.dr;
      return nc >= 0 && nr >= 0 && nc < cols && nr < rows && !visited[nr * cols + nc];
    });
    if (!options.length) { stack.pop(); continue; }
    const d = options[Math.floor(rng() * options.length)];
    const nc = c + d.dc, nr = r + d.dr;
    cells[r * cols + c] &= ~d.bit;
    cells[nr * cols + nc] &= ~d.opp;
    visited[nr * cols + nc] = 1;
    stack.push([nc, nr]);
  }
  return cells;
}

export function openNeighbours(cells, cols, rows, c, r) {
  const out = [];
  for (const d of DIRS) {
    if (cells[r * cols + c] & d.bit) continue;
    const nc = c + d.dc, nr = r + d.dr;
    if (nc >= 0 && nr >= 0 && nc < cols && nr < rows) out.push({ c: nc, r: nr, dir: d });
  }
  return out;
}

function bfs(cells, cols, rows, start) {
  const dist = new Int32Array(cols * rows).fill(-1);
  const parent = new Int32Array(cols * rows).fill(-1);
  const q = [start.r * cols + start.c];
  dist[q[0]] = 0;
  for (let i = 0; i < q.length; i++) {
    const idx = q[i], c = idx % cols, r = (idx / cols) | 0;
    for (const nb of openNeighbours(cells, cols, rows, c, r)) {
      const ni = nb.r * cols + nb.c;
      if (dist[ni] < 0) { dist[ni] = dist[idx] + 1; parent[ni] = idx; q.push(ni); }
    }
  }
  return { dist, parent };
}

export function cellCenter(level, c, r) {
  const { CELL } = BOARD;
  return {
    x: c * CELL + CELL / 2 - (level.cols * CELL) / 2,
    z: r * CELL + CELL / 2 - (level.rows * CELL) / 2
  };
}

/** Wall AABBs (world space), collinear runs merged to keep physics + draw calls low. */
export function computeWalls(cells, cols, rows) {
  const { CELL, WALL_T } = BOARD;
  const ox = (cols * CELL) / 2, oz = (rows * CELL) / 2, t = WALL_T / 2;
  const walls = [];
  // Horizontal lines (constant z), j = 0..rows
  for (let j = 0; j <= rows; j++) {
    let runStart = -1;
    for (let c = 0; c <= cols; c++) {
      const has = c < cols && (j === rows ? (cells[(rows - 1) * cols + c] & S) : (cells[j * cols + c] & N));
      if (has && runStart < 0) runStart = c;
      if (!has && runStart >= 0) {
        walls.push({ minX: runStart * CELL - t - ox, maxX: c * CELL + t - ox, minZ: j * CELL - t - oz, maxZ: j * CELL + t - oz });
        runStart = -1;
      }
    }
  }
  // Vertical lines (constant x), i = 0..cols
  for (let i = 0; i <= cols; i++) {
    let runStart = -1;
    for (let r = 0; r <= rows; r++) {
      const has = r < rows && (i === cols ? (cells[r * cols + cols - 1] & E) : (cells[r * cols + i] & W));
      if (has && runStart < 0) runStart = r;
      if (!has && runStart >= 0) {
        walls.push({ minX: i * CELL - t - ox, maxX: i * CELL + t - ox, minZ: runStart * CELL - t - oz, maxZ: r * CELL + t - oz });
        runStart = -1;
      }
    }
  }
  return walls;
}

/** Build a complete, deterministic level description for level number n. */
export function buildLevel(n) {
  const p = levelParams(n);
  const rng = mulberry32(p.level * 7919 + 104729);
  const { cols, rows } = p;
  const cells = generateMaze(cols, rows, rng);
  const start = { c: 0, r: rows - 1 }; // near-left corner, closest to the camera
  const { dist, parent } = bfs(cells, cols, rows, start);

  let finishIdx = 0;
  for (let i = 0; i < dist.length; i++) if (dist[i] > dist[finishIdx]) finishIdx = i;
  const finish = { c: finishIdx % cols, r: (finishIdx / cols) | 0 };

  const path = [];
  for (let i = finishIdx; i >= 0; i = parent[i]) path.unshift({ c: i % cols, r: (i / cols) | 0 });
  const onPath = new Set(path.map(q => q.r * cols + q.c));

  const level = { n: p.level, params: p, cols, rows, cells, start, finish, path, holes: [], sliders: [] };
  const used = new Set([start.r * cols + start.c, finish.r * cols + finish.c]);
  const key = q => q.r * cols + q.c;
  const blockAround = q => {
    for (let dr = -1; dr <= 1; dr++) for (let dc = -1; dc <= 1; dc++) used.add((q.r + dr) * cols + (q.c + dc));
  };

  // Classify path cells (skip the two cells nearest each end so start/finish stay calm)
  const straight = [], turns = [];
  for (let i = 2; i < path.length - 2; i++) {
    const a = path[i - 1], b = path[i], c = path[i + 1];
    const inDir = { dc: b.c - a.c, dr: b.r - a.r };
    const outDir = { dc: c.c - b.c, dr: c.r - b.r };
    if (inDir.dc === outDir.dc && inDir.dr === outDir.dr) straight.push({ ...b, axis: inDir.dc !== 0 ? 'x' : 'z' });
    else turns.push({ ...b, inDir, outDir });
  }
  shuffle(straight, rng);
  shuffle(turns, rng);

  // 1. Sliders: gate sweeps ACROSS the corridor (perpendicular to travel)
  for (const q of straight) {
    if (level.sliders.length >= p.sliders) break;
    if (used.has(key(q))) continue;
    const ctr = cellCenter(level, q.c, q.r);
    level.sliders.push({
      c: q.c, r: q.r, x: ctr.x, z: ctr.z,
      moveAxis: q.axis === 'z' ? 'x' : 'z',
      amp: CORRIDOR_HALF - BOARD.SLIDER_ACROSS / 2,
      omega: p.sliderSpeed * (0.85 + rng() * 0.3),
      phase: rng() * Math.PI * 2
    });
    blockAround(q);
  }

  // 2. Path holes: offset to one side of a straight corridor, leaving a squeeze lane
  const PATH_OFF = 0.45;
  let placed = 0;
  for (const q of straight) {
    if (placed >= p.pathHoles) break;
    if (used.has(key(q))) continue;
    const ctr = cellCenter(level, q.c, q.r);
    const side = rng() < 0.5 ? -1 : 1;
    const ox = q.axis === 'z' ? side * PATH_OFF : 0;
    const oz = q.axis === 'x' ? side * PATH_OFF : 0;
    level.holes.push({ c: q.c, r: q.r, x: ctr.x + ox, z: ctr.z + oz, r_: BOARD.HOLE_R, kind: 'path' });
    used.add(key(q));
    placed++;
  }

  // 3. Turn holes: in the outer corner a fast ball slams into
  const TURN_OFF = 0.42;
  placed = 0;
  for (const q of turns) {
    if (placed >= p.turnHoles) break;
    if (used.has(key(q))) continue;
    const ctr = cellCenter(level, q.c, q.r);
    // Outer corner lies along the incoming travel direction and against the outgoing one
    const ox = (q.inDir.dc - q.outDir.dc) * TURN_OFF;
    const oz = (q.inDir.dr - q.outDir.dr) * TURN_OFF;
    level.holes.push({ c: q.c, r: q.r, x: ctr.x + ox, z: ctr.z + oz, r_: BOARD.HOLE_R, kind: 'turn' });
    used.add(key(q));
    placed++;
  }

  // 4. Side holes: off-path cells, preferring those one step off the path (overshoot traps)
  const near = [], far = [];
  for (let r = 0; r < rows; r++) for (let c = 0; c < cols; c++) {
    const k = r * cols + c;
    if (onPath.has(k)) continue;
    const adj = openNeighbours(cells, cols, rows, c, r).some(nb => onPath.has(nb.r * cols + nb.c));
    (adj ? near : far).push({ c, r });
  }
  shuffle(near, rng); shuffle(far, rng);
  placed = 0;
  for (const q of [...near, ...far]) {
    if (placed >= p.sideHoles) break;
    if (used.has(key(q))) continue;
    const ctr = cellCenter(level, q.c, q.r);
    level.holes.push({ c: q.c, r: q.r, x: ctr.x, z: ctr.z, r_: BOARD.HOLE_R, kind: 'side' });
    used.add(key(q));
    placed++;
  }

  level.walls = computeWalls(cells, cols, rows);
  level.startPos = cellCenter(level, start.c, start.r);
  level.goal = { ...cellCenter(level, finish.c, finish.r), r_: BOARD.GOAL_R };
  level.timeLimit = p.timeFactor > 0
    ? Math.round((path.length * TIME.PER_CELL + TIME.BASE + level.sliders.length * TIME.PER_SLIDER) * p.timeFactor)
    : 0;
  return level;
}
