/* ==========================================================================
   3D LABYRINTH - GAME CONSTANTS & DIFFICULTY CURVE
   Every tunable lives here so balancing never means hunting through modules.
   Pure module (no THREE / DOM) so it can be unit-tested in Node.
   ========================================================================== */

export const VERSION = '1.2.0';

// Board geometry (world units; one maze cell = CELL x CELL)
export const BOARD = {
  CELL: 2.0,
  WALL_T: 0.22,      // wall thickness
  WALL_H: 0.7,       // wall height above floor
  FLOOR_T: 0.3,      // floor slab thickness
  BALL_R: 0.3,
  HOLE_R: 0.42,
  GOAL_R: 0.62,
  PIT_DEPTH: 2.4,
  SLIDER_ACROSS: 0.9, // slider length across the corridor
  SLIDER_ALONG: 0.5   // slider thickness along the corridor
};

// Interior half-width of a corridor (cell centre to wall face)
export const CORRIDOR_HALF = BOARD.CELL / 2 - BOARD.WALL_T / 2;

// Ball physics (tuned by feel, not real-world units)
export const PHYS = {
  G: 26,                 // gravity
  ROLL_FACTOR: 5 / 7,    // solid sphere rolling without slipping: a = 5/7 g sin(theta)
  DAMPING: 0.55,         // linear rolling resistance per second
  WALL_RESTITUTION: 0.45,
  BALL_RESTITUTION: 0.7,
  MAX_SPEED: 11,
  SUBSTEPS: 6,           // keeps max travel per substep far below ball radius (no tunnelling)
  TILT_RATE: 7,          // how fast the board follows the input (1/s)
  HOLE_PULL: 28,         // rim attraction toward a hole centre
  FALL_MARGIN: 0.3,      // ball falls when centre is inside (HOLE_R - BALL_R * FALL_MARGIN)
  RESPAWN_DELAY: 0.7,    // seconds a fallen ball waits before reappearing at start
  HOP_TIME: 0.6,         // a life-saved ball hops over the hole in this many seconds
  HOP_HEIGHT: 1.6
};

// Shared life pool. A life saves a falling ball (it hops past the hole) or, at
// time-out, rescues each ball still out. Earned only on the FIRST clear of a level.
export const LIVES = { START: 0, PER_NEW_LEVEL: 1, MAX: 99 };

/*
 * Board surfaces x ball types. Real physics note: on a frictionless incline a
 * heavy ball does NOT accelerate faster (a = 5/7 g sin(theta) for any mass);
 * what makes steel feel faster is that rolling resistance and bumps barely
 * slow it. So "accel" here is a small gameplay boost; the big differences come
 * from grip (rolling resistance) and bounce (wall restitution).
 *   grip   multiplies PHYS.DAMPING      (higher = balls slow down sooner)
 *   bounce multiplies PHYS.WALL_RESTITUTION
 */
export const BOARD_SURFACES = {
  neon:   { name: 'Neon',   icon: '💠', grip: 1.0, bounce: 1.0,  desc: 'Classic arcade board, balanced grip' },
  wood:   { name: 'Wood',   icon: '🪵', grip: 1.7, bounce: 0.75, desc: 'Grippy and forgiving: balls slow quickly, soft knocks' },
  glass:  { name: 'Glass',  icon: '🧊', grip: 0.4, bounce: 1.2,  desc: 'Slippery: balls glide and keep their momentum' },
  marble: { name: 'Marble', icon: '🏛️', grip: 0.7, bounce: 1.35, desc: 'Polished stone: quick, with springy walls' }
};

export const BALL_TYPES = {
  plastic: { name: 'Plastic', icon: '🟡', accel: 1.0,  grip: 1.0, bounce: 1.0, ballBounce: 0.7,  maxSpeed: 1.0,  desc: 'Light and lively, all-rounder' },
  metal:   { name: 'Steel',   icon: '⚙️', accel: 1.2,  grip: 0.55, bounce: 0.55, ballBounce: 0.45, maxSpeed: 1.3, desc: 'Heavy: fast, carries momentum, dull thuds' },
  rubber:  { name: 'Rubber',  icon: '🔴', accel: 0.85, grip: 1.6, bounce: 1.7, ballBounce: 0.9,  maxSpeed: 0.85, desc: 'Grippy and bouncy: slower but springs off walls' }
};

export const DEFAULT_LOOK = { board: 'neon', ball: 'plastic' };

/** Effective physics for a board/ball pairing. */
export function surfacePhysics(boardId = DEFAULT_LOOK.board, ballId = DEFAULT_LOOK.ball) {
  const s = BOARD_SURFACES[boardId] || BOARD_SURFACES.neon;
  const b = BALL_TYPES[ballId] || BALL_TYPES.plastic;
  return {
    damping: PHYS.DAMPING * s.grip * b.grip,
    wallRestitution: Math.min(0.92, PHYS.WALL_RESTITUTION * s.bounce * b.bounce),
    ballRestitution: b.ballBounce,
    maxSpeed: PHYS.MAX_SPEED * b.maxSpeed,
    accel: b.accel
  };
}

/**
 * Time-limit multiplier for grippy/slow pairings (wood + rubber needs ~1.3x the
 * time per tests/solvable.test.mjs). Slick pairings keep the full limit: they
 * are faster but harder to control, so no time is taken away.
 */
export function timePace(surf) {
  const ratio = surf.damping / PHYS.DAMPING;
  return Math.max(1.0, Math.min(1.4, Math.pow(ratio, 0.3) / surf.accel));
}

export const BALL_COUNT = 3;
export const BALL_COLORS = [0xffc93c, 0x00f0ff, 0xff4fa3];

// Time limit = (pathCells * PER_CELL + BASE + sliders * PER_SLIDER) * timeFactor
// Calibrated against tests/solvable.test.mjs: a cautious one-ball-at-a-time bot needs ~1.1 s/cell per ball.
export const TIME = { PER_CELL: 3.0, BASE: 30, PER_SLIDER: 4 };

/**
 * Difficulty curve. Levels are procedural and endless; each level number is a
 * fixed seed, so "Level 7" is the same maze for everyone, every time.
 */
export function levelParams(n) {
  const L = Math.max(1, Math.floor(n));
  const size = Math.min(5 + Math.floor((L - 1) * 0.7), 16);
  return {
    level: L,
    cols: size,
    rows: size,
    maxTiltDeg: Math.min(9 + L * 0.5, 16),
    // Holes off the solution path (punish overshooting into side branches)
    sideHoles: L < 2 ? 0 : Math.min(1 + Math.floor((L - 2) * 0.8), 18),
    // Holes on straight path corridors, offset to one side (must squeeze past)
    pathHoles: L < 5 ? 0 : Math.min(1 + Math.floor((L - 5) / 2), 8),
    // Holes in the outer corner of path turns (punish taking corners too fast)
    turnHoles: L < 8 ? 0 : Math.min(1 + Math.floor((L - 8) / 2), 8),
    // Sliding gates that sweep across path corridors (timing hurdles)
    sliders: L < 4 ? 0 : Math.min(1 + Math.floor((L - 4) / 3), 6),
    sliderSpeed: 1.2 + Math.min(L * 0.08, 1.6), // rad/s
    // 0 = untimed. Early levels are untimed so first-time players can learn tilt.
    timeFactor: L < 3 ? 0 : Math.max(0.6, 1.05 - L * 0.025)
  };
}
