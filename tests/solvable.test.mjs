// Headless autopilot: proves each level is physically solvable (holes leave a lane, gates can be passed).
// Steers one ball at a time along the solution path with a PD controller limited to the level's max tilt.
// Run: node --test tests/
import test from 'node:test';
import assert from 'node:assert/strict';
import { buildLevel, cellCenter, openNeighbours } from '../js/maze.js';
import { BOARD } from '../js/config.js';
import { PhysicsWorld } from '../js/physics.js';
import { PHYS, surfacePhysics } from '../js/config.js';

const DEG = Math.PI / 180;

/** Shortest cell route between two cells (BFS through open walls). */
function routeCells(L, from, to) {
  const key = (c, r) => r * L.cols + c, parent = new Map([[key(from.c, from.r), null]]), q = [from];
  for (let i = 0; i < q.length; i++) {
    for (const nb of openNeighbours(L.cells, L.cols, L.rows, q[i].c, q[i].r)) {
      if (!parent.has(key(nb.c, nb.r))) { parent.set(key(nb.c, nb.r), q[i]); q.push(nb); }
    }
  }
  const out = [];
  for (let c = to; c; c = parent.get(key(c.c, c.r))) out.unshift({ c: c.c, r: c.r });
  return out;
}

/** target 'goal': bring every ball home. target 'apple': one ball detours to the bonus apple. */
function solve(n, board = 'neon', ball = 'plastic', maxSeconds = 2400, target = 'goal') {
  const L = buildLevel(n);
  const surf = surfacePhysics(board, ball);
  const w = new PhysicsWorld(L, surf);
  const forApple = target === 'apple';
  const tCell = forApple ? { c: L.apples[0].c, r: L.apples[0].r } : L.finish;
  let route = forApple ? routeCells(L, L.start, tCell) : L.path;
  let pts = route.map(q => cellCenter(L, q.c, q.r));
  if (!forApple) pts.push({ x: L.goal.x, z: L.goal.z });
  // Distance-to-target map, so a ball knocked into a side branch can route back
  const key = (c, r) => r * L.cols + c;
  const toGoal = new Map([[key(tCell.c, tCell.r), 0]]);
  const bq = [tCell];
  for (let i = 0; i < bq.length; i++) {
    const q = bq[i];
    for (const nb of openNeighbours(L.cells, L.cols, L.rows, q.c, q.r)) {
      if (!toGoal.has(key(nb.c, nb.r))) { toGoal.set(key(nb.c, nb.r), toGoal.get(key(q.c, q.r)) + 1); bq.push(nb); }
    }
  }
  let pathIdx = new Map(route.map((q, i) => [key(q.c, q.r), i]));
  // Re-plan from wherever the ball ended up (knocked into a branch, respawned...), keeping gate timing
  const replan = from => {
    route = routeCells(L, from, tCell);
    pts = route.map(q => cellCenter(L, q.c, q.r));
    if (!forApple) pts.push({ x: L.goal.x, z: L.goal.z });
    pathIdx = new Map(route.map((q, i) => [key(q.c, q.r), i]));
    idx = Math.min(1, pts.length - 1);
    committed = null;
  };
  const cellOf = b => ({
    c: Math.max(0, Math.min(L.cols - 1, Math.floor((b.x + L.cols * BOARD.CELL / 2) / BOARD.CELL))),
    r: Math.max(0, Math.min(L.rows - 1, Math.floor((b.z + L.rows * BOARD.CELL / 2) / BOARD.CELL)))
  });
  const maxTilt = L.params.maxTiltDeg * DEG, g = PHYS.G * PHYS.ROLL_FACTOR * surf.accel, dt = 1 / 60;
  // Park balls 2 and 3 off-board (captured) so the bot steers one at a time
  const queue = [...w.balls];
  for (const b of queue.slice(1)) b.state = 'wait';
  let active = queue.shift(), idx = 0, t = 0, committed = null;
  const lim = v => Math.max(-maxTilt, Math.min(maxTilt, Math.asin(Math.max(-1, Math.min(1, v / g)))));
  const steer = (ex, ez) => {
    const tx = lim(6 * (ex - active.x) - 3.2 * active.vx), tz = lim(-(6 * (ez - active.z) - 3.2 * active.vz));
    w.step(dt, g * Math.sin(tx), -g * Math.sin(tz));
  };
  while (t < maxSeconds) {
    if (forApple && w.apples[0].taken) return { ok: true, t, falls: w.falls };
    if (active.state === 'captured') {
      if (!queue.length) return { ok: true, t, falls: w.falls };
      active = queue.shift(); active.state = 'roll'; w.placeAtStart(active, active.id, true); idx = 0;
    }
    if (active.state === 'roll') {
      // advance waypoint when close; never skip ahead past walls
      // Waypoint = cell centre, nudged away from any offset hole in that cell
      const aimFor = i => {
        const q = pts[i], h = w.holes.find(h => h.kind !== 'side' && Math.hypot(h.x - q.x, h.z - q.z) < 0.7);
        return h ? { x: q.x + (q.x - h.x) * 0.8, z: q.z + (q.z - h.z) * 0.8 } : q;
      };
      while (idx < pts.length - 1 && Math.hypot(aimFor(idx).x - active.x, aimFor(idx).z - active.z) < 0.35) idx++;
      // Knocked off course? Re-acquire from the cell the ball is actually in
      const bc = cellOf(active), pi = pathIdx.get(key(bc.c, bc.r));
      if (pi === undefined) { replan(bc); continue; }
      if (pi !== idx && pi !== idx - 1 && !committed) idx = Math.min(pi + 1, pts.length - 1);
      const tgt = pts[idx];
      const gate = w.sliders.find(s => Math.hypot(s.x - tgt.x, s.z - tgt.z) < 0.1);
      let ex = aimFor(idx).x, ez = aimFor(idx).z;
      if (gate) {
        // Gate cell: wait in the lane just before the gate, dash when the gate swings to the far side
        const across = gate.moveAxis, along = across === 'x' ? 'z' : 'x';
        const prev = pts[idx - 1], next = pts[idx + 1];
        const dirA = Math.sign(next[along] - prev[along]);
        const pos = { x: active.x, z: active.z };
        if ((pos[along] - gate[along]) * dirA > 0.6) { idx++; committed = null; continue; }
        const off = across === 'x' ? gate.cx - gate.x : gate.cz - gate.z;
        const opening = off > 0.25 && (across === 'x' ? gate.vx : gate.vz) > 0;
        const waitPt = { [across]: gate[across] - 0.45, [along]: gate[along] - dirA * 0.75 };
        const ready = Math.hypot(pos.x - waitPt.x, pos.z - waitPt.z) < 0.15 && Math.hypot(active.vx, active.vz) < 0.4;
        if (committed !== gate && ready && opening) committed = gate;
        if (committed === gate && (pos[along] - gate[along]) * dirA < -1.0) committed = null; // bounced back
        const aim = committed === gate ? { [across]: gate[across] - 0.45, [along]: gate[along] + dirA * 1.0 } : waitPt;
        ex = aim.x; ez = aim.z;
      }
      steer(ex, ez);
    } else {
      if (active.state === 'respawn' || active.state === 'falling') idx = 0;
      w.step(dt, 0, 0);
    }
    t += dt;
  }
  return { ok: false, t, falls: w.falls, idx, of: pts.length, ball: active.id, at: [active.x.toFixed(2), active.z.toFixed(2), active.state], cap: w.captured };
}

// Timer fairness: the limit must leave an expert room to bring THREE balls home. The bot is a careful
// single-ball benchmark (no falls, waits at gates); requiring limit >= 2.3x its per-ball time keeps
// late levels winnable even though balls split up at every gate.
const MIN_TIMER_RATIO = 2.3;

test('autopilot clears levels 1-40, and every timer is fair', () => {
  const report = [];
  for (let n = 1; n <= 40; n++) {
    const r = solve(n);
    const limit = buildLevel(n).timeLimit, perBall = r.t / 3;
    report.push(`L${n}:${r.ok ? `${perBall.toFixed(0)}s/ball` : `FAIL@${r.idx}/${r.of}`}${limit ? ` limit${limit}(${(limit / perBall).toFixed(1)}x)` : ''}`);
    assert.ok(r.ok, `level ${n} not solved: ${JSON.stringify(r)}`);
    if (limit) assert.ok(limit >= MIN_TIMER_RATIO * perBall, `level ${n} timer too tight: ${limit}s vs ${perBall.toFixed(0)}s per careful ball`);
  }
  console.log(report.join(' '));
});

// Extreme material pairings must stay beatable: slick+heavy (glass/steel), grippy+bouncy (wood/rubber), bounciest (marble/rubber)
for (const [board, ball] of [['glass', 'metal'], ['wood', 'rubber'], ['marble', 'rubber'], ['glass', 'plastic']]) {
  test(`autopilot clears levels 1-12 on ${board} with ${ball} balls`, () => {
    const report = [];
    for (let n = 1; n <= 12; n++) {
      const r = solve(n, board, ball);
      report.push(`L${n}:${r.ok ? `${r.t.toFixed(0)}s/${r.falls}f` : 'FAIL'}`);
      assert.ok(r.ok, `${board}/${ball} level ${n} not solved: ${JSON.stringify(r)}`);
    }
    console.log(`${board}/${ball} ` + report.join(' '));
  });
}

test('bonus apple is reachable past its guard (levels 4-25)', () => {
  const report = [];
  for (let n = 4; n <= 25; n++) {
    const L = buildLevel(n);
    if (!L.apples.length) continue;
    const r = solve(n, 'neon', 'plastic', 900, 'apple');
    report.push(`L${n}:${L.apples[0].guard}:${r.ok ? `${r.t.toFixed(0)}s` : 'FAIL'}`);
    assert.ok(r.ok, `level ${n} apple (${L.apples[0].guard}) not reached: ${JSON.stringify(r)}`);
  }
  console.log(report.join(' '));
});
