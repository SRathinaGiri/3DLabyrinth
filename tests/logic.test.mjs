// Run: node --test tests/
import test from 'node:test';
import assert from 'node:assert/strict';
import { buildLevel, openNeighbours, cellCenter } from '../js/maze.js';
import { PhysicsWorld, collideBox } from '../js/physics.js';
import { BOARD, CORRIDOR_HALF, PHYS, levelParams } from '../js/config.js';

const LEVELS = Array.from({ length: 60 }, (_, i) => i + 1);

test('every level is a perfect maze (all cells reachable, no loops)', () => {
  for (const n of LEVELS) {
    const L = buildLevel(n);
    const seen = new Set([0]);
    const q = [{ c: 0, r: 0 }];
    let edges = 0;
    while (q.length) {
      const { c, r } = q.pop();
      for (const nb of openNeighbours(L.cells, L.cols, L.rows, c, r)) {
        edges++;
        const k = nb.r * L.cols + nb.c;
        if (!seen.has(k)) { seen.add(k); q.push(nb); }
      }
    }
    assert.equal(seen.size, L.cols * L.rows, `level ${n} unreachable cells`);
    assert.equal(edges / 2, L.cols * L.rows - 1, `level ${n} has loops`);
  }
});

test('levels are deterministic', () => {
  const a = buildLevel(9), b = buildLevel(9);
  assert.deepEqual([...a.cells], [...b.cells]);
  assert.deepEqual(a.holes, b.holes);
});

test('path runs start -> finish through open walls', () => {
  for (const n of LEVELS) {
    const L = buildLevel(n);
    assert.deepEqual(L.path[0], L.start);
    assert.deepEqual(L.path.at(-1), L.finish);
    for (let i = 1; i < L.path.length; i++) {
      const ok = openNeighbours(L.cells, L.cols, L.rows, L.path[i - 1].c, L.path[i - 1].r)
        .some(nb => nb.c === L.path[i].c && nb.r === L.path[i].r);
      assert.ok(ok, `level ${n} path step ${i} goes through a wall`);
    }
  }
});

test('hurdles never sit on start/finish and never share a cell', () => {
  for (const n of LEVELS) {
    const L = buildLevel(n);
    const keys = [...L.holes, ...L.sliders].map(h => `${h.c},${h.r}`);
    assert.equal(new Set(keys).size, keys.length, `level ${n} duplicate hurdle cell`);
    assert.ok(!keys.includes(`${L.start.c},${L.start.r}`));
    assert.ok(!keys.includes(`${L.finish.c},${L.finish.r}`));
  }
});

test('path holes always leave a lane wide enough for a ball', () => {
  const fallR = BOARD.HOLE_R - BOARD.BALL_R * PHYS.FALL_MARGIN;
  for (const n of LEVELS) {
    const L = buildLevel(n);
    for (const h of L.holes.filter(h => h.kind !== 'side')) {
      const ctr = cellCenter(L, h.c, h.r);
      const off = Math.hypot(h.x - ctr.x, h.z - ctr.z);
      // Hole fully inside the cell interior
      assert.ok(Math.abs(h.x - ctr.x) + h.r_ <= CORRIDOR_HALF + 1e-9, `level ${n} hole cuts into wall`);
      assert.ok(Math.abs(h.z - ctr.z) + h.r_ <= CORRIDOR_HALF + 1e-9, `level ${n} hole cuts into wall`);
      // Cell centre itself is safe ground
      assert.ok(off > fallR, `level ${n} ${h.kind} hole swallows the corridor centre`);
    }
  }
});

test('difficulty grows: bigger boards, more hurdles, timers from level 3', () => {
  assert.equal(levelParams(1).timeFactor, 0);
  assert.ok(levelParams(3).timeFactor > 0);
  const hurdles = n => { const L = buildLevel(n); return L.holes.length + L.sliders.length; };
  assert.ok(hurdles(20) > hurdles(5));
  assert.ok(buildLevel(20).cols > buildLevel(1).cols);
});

test('ball never passes through a wall under max tilt', () => {
  const L = buildLevel(6);
  const w = new PhysicsWorld(L);
  const a = PHYS.G * PHYS.ROLL_FACTOR * Math.sin(16 * Math.PI / 180);
  const dirs = [[a, 0], [0, a], [-a, 0], [0, -a], [a, a], [-a, -a]];
  for (const [ax, az] of dirs) {
    for (let f = 0; f < 240; f++) {
      w.step(1 / 60, ax, az);
      for (const b of w.balls) {
        if (b.state !== 'roll') continue;
        for (const wall of L.walls) {
          const cx = Math.max(wall.minX, Math.min(b.x, wall.maxX));
          const cz = Math.max(wall.minZ, Math.min(b.z, wall.maxZ));
          assert.ok(Math.hypot(b.x - cx, b.z - cz) > BOARD.BALL_R - 0.02, 'ball inside wall');
        }
      }
    }
  }
});

test('ball over a hole falls and respawns at start', () => {
  const L = buildLevel(3);
  assert.ok(L.holes.length > 0);
  const w = new PhysicsWorld(L);
  const b = w.balls[0];
  Object.assign(b, { x: L.holes[0].x, z: L.holes[0].z, vx: 0, vz: 0 });
  let fell = 0, back = 0;
  for (let f = 0; f < 120; f++) w.step(1 / 60, 0, 0, { fall: () => fell++, respawn: () => back++ });
  assert.equal(fell, 1);
  assert.equal(back, 1);
  assert.equal(b.state, 'roll');
  assert.ok(Math.hypot(b.x - L.startPos.x, b.z - L.startPos.z) < 1);
});

test('three balls dropped on the goal complete the level', () => {
  const L = buildLevel(1);
  const w = new PhysicsWorld(L);
  w.balls.forEach((b, i) => Object.assign(b, { x: L.goal.x + (i - 1) * 0.05, z: L.goal.z }));
  w.step(1 / 60, 0, 0);
  for (let f = 0; f < 60; f++) w.step(1 / 60, 0, 0);
  assert.ok(w.allHome);
});

test('collideBox pushes a ball out and reflects velocity', () => {
  const b = { x: 0.25, z: 0, vx: -2, vz: 0 };
  const hit = collideBox(b, { minX: -1, maxX: 0, minZ: -1, maxZ: 1 }, 0, 0, 0.5);
  assert.ok(hit > 0);
  assert.ok(b.x >= BOARD.BALL_R - 1e-9);
  assert.ok(b.vx > 0);
});
