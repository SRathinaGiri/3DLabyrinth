/* ==========================================================================
   3D LABYRINTH - BALL PHYSICS (board-local 2D plane + simple vertical drop)
   Circles vs AABB walls / kinematic sliders, circle vs circle, holes, goal.
   Pure module (no THREE / DOM) so it can be unit-tested in Node.
   ========================================================================== */

import { BOARD, PHYS, BALL_COUNT } from './config.js';

const R = BOARD.BALL_R;
// Triangle formation inside the start cell
const START_OFFSETS = [[-0.42, 0.3], [0.42, 0.3], [0, -0.38]];

const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);

export class PhysicsWorld {
  constructor(level) {
    this.level = level;
    this.walls = level.walls;
    this.holes = level.holes;
    this.goal = level.goal;
    this.sliders = level.sliders.map(s => ({ ...s, box: { minX: 0, maxX: 0, minZ: 0, maxZ: 0 }, vx: 0, vz: 0 }));
    this.time = 0;
    this.balls = [];
    for (let i = 0; i < BALL_COUNT; i++) {
      this.balls.push({ id: i, x: 0, z: 0, y: R, vx: 0, vz: 0, vy: 0, state: 'roll', timer: 0, slot: -1, fx: 0, fz: 0 });
      this.placeAtStart(this.balls[i], i, true);
    }
    this.captured = 0;
    this.falls = 0;
    this.updateSliders(0);
  }

  placeAtStart(b, slotHint = 0, force = false) {
    const sp = this.level.startPos;
    for (let k = 0; k < START_OFFSETS.length; k++) {
      const [ox, oz] = START_OFFSETS[(slotHint + k) % START_OFFSETS.length];
      const x = sp.x + ox, z = sp.z + oz;
      const free = force || this.balls.every(o => o === b || o.state !== 'roll' || (o.x - x) ** 2 + (o.z - z) ** 2 > (2 * R + 0.02) ** 2);
      if (free) {
        Object.assign(b, { x, z, y: R, vx: 0, vz: 0, vy: 0, state: 'roll', timer: 0 });
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
        if (b.state === 'roll') this.integrate(b, h, ax, az, events);
        else this.animateOffBoard(b, h, events);
      }
      maxBall = Math.max(maxBall, this.collideBalls());
      for (const b of this.balls) {
        if (b.state !== 'roll') continue;
        for (const sl of this.sliders) collideBox(b, sl.box, sl.vx, sl.vz, PHYS.WALL_RESTITUTION);
        // Walls last: a static wall always wins over a pushing slider
        for (const w of this.walls) maxWall = Math.max(maxWall, collideBox(b, w, 0, 0, PHYS.WALL_RESTITUTION));
      }
    }
    if (maxWall > 0.6 && events.wallHit) events.wallHit(maxWall);
    if (maxBall > 0.6 && events.ballHit) events.ballHit(maxBall);
  }

  integrate(b, h, ax, az, events) {
    let fx = ax, fz = az;
    // Holes: rim pull, then drop once the centre is well over the edge
    for (const hole of this.holes) {
      const dx = hole.x - b.x, dz = hole.z - b.z, d = Math.hypot(dx, dz);
      if (d < hole.r_) {
        if (d < hole.r_ - R * PHYS.FALL_MARGIN) {
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
    const damp = Math.max(0, 1 - PHYS.DAMPING * h);
    b.vx *= damp; b.vz *= damp;
    const sp = Math.hypot(b.vx, b.vz);
    if (sp > PHYS.MAX_SPEED) { b.vx *= PHYS.MAX_SPEED / sp; b.vz *= PHYS.MAX_SPEED / sp; }
    b.x += b.vx * h; b.z += b.vz * h;
  }

  animateOffBoard(b, h, events) {
    if (b.state === 'falling') {
      b.vy -= 30 * h; b.y += b.vy * h;
      b.x += (b.fx - b.x) * Math.min(1, 10 * h);
      b.z += (b.fz - b.z) * Math.min(1, 10 * h);
      if (b.y < -BOARD.PIT_DEPTH) { b.state = 'respawn'; b.timer = PHYS.RESPAWN_DELAY; }
    } else if (b.state === 'respawn') {
      b.timer -= h;
      if (b.timer <= 0 && this.placeAtStart(b, b.id) && events.respawn) events.respawn(b);
    } else if (b.state === 'captured') {
      // Stack captured balls down the goal pit so all three stay visible-ish
      const targetY = -R - b.slot * 2 * R * 0.98;
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
          const j = (1 + PHYS.BALL_RESTITUTION) * vrel / 2;
          a.vx -= j * nx; a.vz -= j * nz; b.vx += j * nx; b.vz += j * nz;
          maxImpact = Math.max(maxImpact, vrel);
        }
      }
    }
    return maxImpact;
  }

  get allHome() { return this.captured >= this.balls.length; }
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
