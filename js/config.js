/* ==========================================================================
   3D LABYRINTH - GAME CONSTANTS & DIFFICULTY CURVE
   Every tunable lives here so balancing never means hunting through modules.
   Pure module (no THREE / DOM) so it can be unit-tested in Node.
   ========================================================================== */

export const VERSION = '1.0.0';

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
  RESPAWN_DELAY: 0.7     // seconds a fallen ball waits before reappearing at start
};

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
