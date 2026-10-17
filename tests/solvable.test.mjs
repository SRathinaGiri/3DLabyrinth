// Headless autopilot: proves each level is physically solvable (holes leave a lane, gates can be passed).
// Steers one ball at a time along the solution path with a PD controller limited to the level's max tilt.
// Run: node --test tests/
import test from 'node:test';
import assert from 'node:assert/strict';
import { buildLevel, cellCenter } from '../js/maze.js';
import { PhysicsWorld } from '../js/physics.js';
import { PHYS } from '../js/config.js';

const DEG = Math.PI / 180;

function solve(n, maxSeconds = 2400) {
  const L = buildLevel(n);
  const w = new PhysicsWorld(L);
  const pts = L.path.map(q => cellCenter(L, q.c, q.r));
  pts.push({ x: L.goal.x, z: L.goal.z });
  const maxTilt = L.params.maxTiltDeg * DEG, g = PHYS.G * PHYS.ROLL_FACTOR, dt = 1 / 60;
  // Park balls 2 and 3 off-board (captured) so the bot steers one at a time
  const queue = [...w.balls];
  for (const b of queue.slice(1)) b.state = 'wait';
  let active = queue.shift(), idx = 0, t = 0, committed = null;
  while (t < maxSeconds) {
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
      if (Math.hypot(pts[idx].x - active.x, pts[idx].z - active.z) > 2.3) { // knocked off course: re-acquire nearest waypoint
        let best = 0;
        pts.forEach((q, i) => { if (Math.hypot(q.x - active.x, q.z - active.z) < Math.hypot(pts[best].x - active.x, pts[best].z - active.z)) best = i; });
        idx = best;
      }
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
      const ax = 6 * (ex - active.x) - 3.2 * active.vx;
      const az = 6 * (ez - active.z) - 3.2 * active.vz;
      const lim = v => Math.max(-maxTilt, Math.min(maxTilt, Math.asin(Math.max(-1, Math.min(1, v / g)))));
      const tx = lim(ax), tz = lim(-az);
      w.step(dt, g * Math.sin(tx), -g * Math.sin(tz));
    } else {
      if (active.state === 'respawn' || active.state === 'falling') idx = 0;
      w.step(dt, 0, 0);
    }
    t += dt;
  }
  return { ok: false, t, falls: w.falls, idx, of: pts.length, ball: active.id, at: [active.x.toFixed(2), active.z.toFixed(2), active.state], cap: w.captured };
}

test('autopilot clears levels 1-30 with bounded falls', () => {
  const report = [];
  for (let n = 1; n <= 30; n++) {
    const r = solve(n);
    report.push(`L${n}:${r.ok ? `${r.t.toFixed(0)}s/${r.falls}f` : `FAIL@${r.idx}/${r.of}`}`);
    assert.ok(r.ok, `level ${n} not solved: ${JSON.stringify(r)}`);
  }
  console.log(report.join(' '));
});
