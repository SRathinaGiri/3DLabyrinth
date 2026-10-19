/* ==========================================================================
   3D LABYRINTH - BALL PHYSICS (board-local 2D plane + simple vertical drop)
   Circles vs AABB walls / kinematic sliders, circle vs circle, holes, goal.
   Pure module (no THREE / DOM) so it can be unit-tested in Node.
   ========================================================================== */

import { BOARD, PHYS, BALL_COUNT, APPLE, CORRIDOR_HALF, surfacePhysics } from './config.js';
import { hopTarget, N, E, S, W } from './maze.js';

const R = BOARD.BALL_R;
// Triangle formation inside the start cell
const START_OFFSETS = [[-0.42, 0.3], [0.42, 0.3], [0, -0.38]];
const SOLO_OFFSETS = [[0, 0]];

const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);

export class PhysicsWorld {
  constructor(level, surface = surfacePhysics(), ballCount = BALL_COUNT) {
    this.level = level;
    this.surf = surface; // grip / bounce for the chosen board + ball materials
    this.walls = level.walls;
    this.cells = level.cells;
    this.holes = level.holes;
    this.goal = level.goal;
    this.sliders = level.sliders.map(s => ({ ...s, box: { minX: 0, maxX: 0, minZ: 0, maxZ: 0 }, vx: 0, vz: 0 }));
    this.time = 0;
    this.balls = [];
    this.offsets = ballCount === 1 ? SOLO_OFFSETS : START_OFFSETS;
    this.hopHeight = PHYS.HOP_HEIGHT; // raised by the app when walls are drawn tall
    for (let i = 0; i < ballCount; i++) {
      this.balls.push({ id: i, x: 0, z: 0, y: R, vx: 0, vz: 0, vy: 0, state: 'roll', timer: 0, slot: -1, fx: 0, fz: 0 });
      this.placeAtStart(this.balls[i], i, true);
    }
    this.captured = 0;
    this.falls = 0;
    this.saves = 0;
    this.onFallSave = null; // (ball, hole) => true to spend a life and hop the ball past the hole
    this.apples = (level.apples || []).map(a => ({ ...a, taken: false })); // app marks already-claimed ones taken
    this.updateSliders(0);
  }

  placeAtStart(b, slotHint = 0, force = false) {
    const sp = this.level.startPos;
    const offs = this.offsets;
    for (let k = 0; k < offs.length; k++) {
      const [ox, oz] = offs[(slotHint + k) % offs.length];
      const x = sp.x + ox, z = sp.z + oz;
      const free = force || this.balls.every(o => o === b || o.state !== 'roll' || (o.x - x) ** 2 + (o.z - z) ** 2 > (2 * R + 0.02) ** 2);
      if (free) {
        Object.assign(b, { x, z, px: x, pz: z, y: R, vx: 0, vz: 0, vy: 0, state: 'roll', timer: 0 }); // teleport: reset tunnel guard
        return true;
      }
    }
    return false; // start cell crowded: try again next frame
  }

  updateSliders(t) {
    const half = BOARD.SLIDER_ACROSS / 2, thin = BOARD.SLIDER_ALONG / 2;
    for (const s of this.sliders) {
      const off = s.amp * Math.sin(s.omega * t + s.phase);
      const vel = s.amp * s.omega * Math.cos(s.omega * t + s.phase);
      if (s.moveAxis === 'x') {
        s.cx = s.x + off; s.cz = s.z; s.vx = vel; s.vz = 0;
        Object.assign(s.box, { minX: s.cx - half, maxX: s.cx + half, minZ: s.cz - thin, maxZ: s.cz + thin });
      } else {
        s.cx = s.x; s.cz = s.z + off; s.vx = 0; s.vz = vel;
        Object.assign(s.box, { minX: s.cx - thin, maxX: s.cx + thin, minZ: s.cz - half, maxZ: s.cz + half });
      }
    }
  }

  /**
   * Advance the world. ax/az = board-plane acceleration from tilt.
   * events: { wallHit(speed), ballHit(speed), fall(ball), capture(ball), respawn(ball) }
   */
  step(dt, ax, az, events = {}) {
    const n = PHYS.SUBSTEPS, h = dt / n;
    let maxWall = 0, maxBall = 0;
    for (let s = 0; s < n; s++) {
      this.time += h;
      this.updateSliders(this.time);
      for (const b of this.balls) {
        if (b.state === 'roll') { b.px = b.x; b.pz = b.z; this.integrate(b, h, ax, az, events); }
        else this.animateOffBoard(b, h, events);
      }
      maxBall = Math.max(maxBall, this.collideBalls());
      for (const b of this.balls) {
        if (b.state !== 'roll') continue;
        for (const sl of this.sliders) collideSlider(b, sl, this.surf.wallRestitution);
        // Walls last: a static wall always wins over a pushing slider
        for (const w of this.walls) maxWall = Math.max(maxWall, collideBox(b, w, 0, 0, this.surf.wallRestitution));
        this.keepOnOpenSide(b);
      }
    }
    if (maxWall > 0.6 && events.wallHit) events.wallHit(maxWall);
    if (maxBall > 0.6 && events.ballHit) events.ballHit(maxBall);
  }

  integrate(b, h, ax, az, events) {
    let fx = ax, fz = az;
    for (const a of this.apples) {
      if (!a.taken && Math.hypot(a.x - b.x, a.z - b.z) < APPLE.PICK_R) {
        a.taken = true;
        if (events.apple) events.apple(b, a);
      }
    }
    // Holes: rim pull, then drop once the centre is well over the edge
    for (const hole of this.holes) {
      const dx = hole.x - b.x, dz = hole.z - b.z, d = Math.hypot(dx, dz);
      if (d < hole.r_) {
        if (d < hole.r_ - R * PHYS.FALL_MARGIN) {
          if (this.onFallSave && this.onFallSave(b, hole)) {
            const to = hopTarget(this.level, hole);
            Object.assign(b, { state: 'hop', hx0: b.x, hz0: b.z, hx1: to.x, hz1: to.z, timer: 0, vx: 0, vz: 0 });
            this.saves++;
            if (events.save) events.save(b);
            return;
          }
          b.state = 'falling'; b.fx = hole.x; b.fz = hole.z; b.vy = 0;
          this.falls++;
          if (events.fall) events.fall(b);
          return;
        }
        const k = PHYS.HOLE_PULL * (1 - d / hole.r_) / Math.max(d, 1e-4);
        fx += dx * k; fz += dz * k;
      }
    }
    const g = this.goal, gdx = g.x - b.x, gdz = g.z - b.z, gd = Math.hypot(gdx, gdz);
    if (gd < g.r_) {
      if (gd < g.r_ - R * PHYS.FALL_MARGIN) {
        b.state = 'captured'; b.slot = this.captured++; b.fx = g.x; b.fz = g.z; b.vy = 0;
        if (events.capture) events.capture(b);
        return;
      }
      const k = PHYS.HOLE_PULL * (1 - gd / g.r_) / Math.max(gd, 1e-4);
      fx += gdx * k; fz += gdz * k;
    }

    b.vx += fx * h; b.vz += fz * h;
    const damp = Math.max(0, 1 - this.surf.damping * h);
    b.vx *= damp; b.vz *= damp;
    const sp = Math.hypot(b.vx, b.vz);
    const vmax = this.surf.maxSpeed;
    if (sp > vmax) { b.vx *= vmax / sp; b.vz *= vmax / sp; }
    b.x += b.vx * h; b.z += b.vz * h;
  }

  animateOffBoard(b, h, events) {
    if (b.state === 'hop') {
      b.timer = Math.min(1, b.timer + h / PHYS.HOP_TIME);
      const p = b.timer, e = p * p * (3 - 2 * p); // smoothstep glide
      b.x = b.hx0 + (b.hx1 - b.hx0) * e;
      b.z = b.hz0 + (b.hz1 - b.hz0) * e;
      b.y = R + Math.sin(Math.PI * p) * this.hopHeight;
      if (p >= 1) { b.state = 'roll'; b.y = R; b.px = b.x; b.pz = b.z; } // landed: a legal jump, not a tunnel
    } else if (b.state === 'falling') {
      b.vy -= 30 * h; b.y += b.vy * h;
      b.x += (b.fx - b.x) * Math.min(1, 10 * h);
      b.z += (b.fz - b.z) * Math.min(1, 10 * h);
      if (b.y < -BOARD.PIT_DEPTH) { b.state = 'respawn'; b.timer = PHYS.RESPAWN_DELAY; }
    } else if (b.state === 'respawn') {
      b.timer -= h;
      if (b.timer <= 0 && this.placeAtStart(b, b.id) && events.respawn) events.respawn(b);
    } else if (b.state === 'captured') {
      // First ball drops to the bottom of the goal cup, later ones stack on top of it
      const targetY = -(BOARD.FLOOR_T + BOARD.GOAL_PIT_DEPTH) + 0.02 + R + b.slot * (2 * R + 0.002);
      b.vy -= 30 * h; b.y = Math.max(targetY, b.y + b.vy * h);
      if (b.y === targetY) b.vy = 0;
      b.x += (b.fx - b.x) * Math.min(1, 10 * h);
      b.z += (b.fz - b.z) * Math.min(1, 10 * h);
    }
  }

  collideBalls() {
    let maxImpact = 0;
    const bs = this.balls;
    for (let i = 0; i < bs.length; i++) {
      const a = bs[i];
      if (a.state !== 'roll') continue;
      for (let j = i + 1; j < bs.length; j++) {
        const b = bs[j];
        if (b.state !== 'roll') continue;
        let dx = b.x - a.x, dz = b.z - a.z, d = Math.hypot(dx, dz);
        if (d >= 2 * R) continue;
        if (d < 1e-6) { dx = 1; dz = 0; d = 1e-6; }
        const nx = dx / d, nz = dz / d, pen = (2 * R - d) / 2;
        a.x -= nx * pen; a.z -= nz * pen; b.x += nx * pen; b.z += nz * pen;
        const vrel = (a.vx - b.vx) * nx + (a.vz - b.vz) * nz;
        if (vrel > 0) {
          const j = (1 + this.surf.ballRestitution) * vrel / 2;
          a.vx -= j * nx; a.vz -= j * nz; b.vx += j * nx; b.vz += j * nz;
          maxImpact = Math.max(maxImpact, vrel);
        }
      }
    }
    return maxImpact;
  }

  get allHome() { return this.captured >= this.balls.length; }

  cellAt(x, z) {
    const { CELL } = BOARD, L = this.level;
    return { c: Math.floor((x + L.cols * CELL / 2) / CELL), r: Math.floor((z + L.rows * CELL / 2) / CELL) };
  }

  /**
   * Safety net against tunnelling: a ball may only change cell through an open side. If anything
   * (a pinching gate, a hard ball-ball shove) carried it across a wall this substep, put it back
   * where it was and bounce it, instead of letting it appear in the next corridor or the goal.
   */
  keepOnOpenSide(b) {
    const a = this.cellAt(b.px, b.pz), c = this.cellAt(b.x, b.z), L = this.level;
    if (a.c === c.c && a.r === c.r) return;
    const dc = c.c - a.c, dr = c.r - a.r;
    const inside = q => q.c >= 0 && q.r >= 0 && q.c < L.cols && q.r < L.rows;
    let ok = false;
    if (inside(a) && inside(c) && Math.abs(dc) + Math.abs(dr) === 1) {
      const bit = dc === 1 ? E : dc === -1 ? W : dr === 1 ? S : N;
      ok = !(this.cells[a.r * L.cols + a.c] & bit);
    }
    if (ok) return;
    b.x = b.px; b.z = b.pz;
    if (dc) b.vx = -b.vx * 0.5;
    if (dr) b.vz = -b.vz * 0.5;
  }
}

/**
 * Ball vs a sliding gate. Gates sweep ACROSS a corridor, so a ball caught between the gate and the
 * corridor wall must not be pushed sideways (into the wall: that is how balls used to tunnel into
 * the next cell). If the sideways push would leave the corridor, or the gate already overlaps the
 * ball's centre, kick the ball back ALONG the corridor, out of the face it came in from.
 */
export function collideSlider(b, sl, e) {
  const across = sl.moveAxis, along = across === 'x' ? 'z' : 'x';
  const vAcross = across === 'x' ? 'vx' : 'vz', vAlong = across === 'x' ? 'vz' : 'vx';
  const box = sl.box;
  const cx = clamp(b.x, box.minX, box.maxX), cz = clamp(b.z, box.minZ, box.maxZ);
  if ((b.x - cx) ** 2 + (b.z - cz) ** 2 >= R * R) return 0;
  const limit = CORRIDOR_HALF - R + 0.005; // furthest the ball's centre may sit from the corridor axis
  const trial = { x: b.x, z: b.z, vx: b.vx, vz: b.vz };
  const hit = collideBox(trial, box, sl.vx, sl.vz, e);
  const centreWasInside = b.x > box.minX && b.x < box.maxX && b.z > box.minZ && b.z < box.maxZ;
  if (!centreWasInside && Math.abs(trial[across] - sl[across]) <= limit) {
    Object.assign(b, trial); // ordinary contact: keep the normal response
    return hit;
  }
  // Pinched: eject along the corridor on the side the ball came from
  const gateAlong = across === 'x' ? sl.cz : sl.cx;
  const thin = BOARD.SLIDER_ALONG / 2;
  let dir = Math.sign(b[along] - gateAlong);
  if (!dir) dir = Math.sign((across === 'x' ? b.pz : b.px) - gateAlong) || -Math.sign(b[vAlong]) || 1;
  b[along] = gateAlong + dir * (thin + R + 0.002);
  b[across] = clamp(b[across], sl[across] - limit, sl[across] + limit);
  if (b[vAlong] * dir < 0.6) b[vAlong] = dir * Math.max(0.6, Math.abs(b[vAlong]) * e); // knocked back where it came from
  b[vAcross] *= 0.3;
  return Math.abs(sl.vx + sl.vz);
}

/** Circle (ball) vs AABB with optional box velocity. Returns impact speed (0 if none). */
export function collideBox(b, box, bvx, bvz, e) {
  const cx = clamp(b.x, box.minX, box.maxX), cz = clamp(b.z, box.minZ, box.maxZ);
  const dx = b.x - cx, dz = b.z - cz, d2 = dx * dx + dz * dz;
  if (d2 >= R * R) return 0;
  let nx, nz, pen;
  if (d2 > 1e-12) {
    const d = Math.sqrt(d2);
    nx = dx / d; nz = dz / d; pen = R - d;
  } else {
    // Centre inside the box (deep push by a slider): exit along the shallowest side
    const l = b.x - box.minX, r = box.maxX - b.x, t = b.z - box.minZ, bo = box.maxZ - b.z;
    const m = Math.min(l, r, t, bo);
    if (m === l) { nx = -1; nz = 0; } else if (m === r) { nx = 1; nz = 0; } else if (m === t) { nx = 0; nz = -1; } else { nx = 0; nz = 1; }
    pen = m + R;
  }
  b.x += nx * pen; b.z += nz * pen;
  const vn = (b.vx - bvx) * nx + (b.vz - bvz) * nz;
  if (vn < 0) {
    b.vx -= (1 + e) * vn * nx; b.vz -= (1 + e) * vn * nz;
    return -vn;
  }
  return 0;
}
