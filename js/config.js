/* ==========================================================================
   3D LABYRINTH - GAME CONSTANTS & DIFFICULTY CURVE
   Every tunable lives here so balancing never means hunting through modules.
   Pure module (no THREE / DOM) so it can be unit-tested in Node.
   ========================================================================== */

export const VERSION = '1.9.1';

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
  GOAL_PIT_DEPTH: 1.55, // below the floor slab: slab (0.3) + 1.55 = a cup exactly three balls deep, first ball rests on the bottom
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
// START 1: a fresh game shouldn't greet the player with "0 lives" (existing saves keep their own count)
export const LIVES = { START: 1, PER_NEW_LEVEL: 1, MAX: 99 };

// Bonus apple: +1 life, at the dead end of a side branch behind a guard hurdle.
// Each level's apple can be claimed once ever, so replays can't farm lives but a
// player who has run out can go back and collect the apples they skipped.
export const APPLE = { FROM_LEVEL: 4, PICK_R: 0.5, MIN_DEPTH: 2, MAX_DEPTH: 4 };

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

// WebXR (Quest): the board is placed relative to the player's head when VR starts (and on Recenter),
// so it works seated or standing. Sizes in metres.
export const VR = {
  TABLE: { SIZE: 0.8, BELOW_EYES: 0.55, NEAR_EDGE: 0.15 },  // close and low: you look down steeply enough to see over the walls
  WALL_SCALE: 0.6,                                         // walls drawn lower in VR (visual only) so far holes aren't hidden
  FLOOR: { SIZE: 3.2, NEAR_EDGE: 0.4, STAND_EYE: 1.5 },     // giant maze on the floor at your feet
  HUD: { DIST: 1.1, FOV: 30, ASPECT: 1.6 }                  // floating screen: score bar just above eye level, panels straight ahead
};

export const BALL_COUNT = 3;        // every board view (Auto / Whole board / Follow)
export const INSIDE_BALL_COUNT = 1; // the Inside camera follows a single ball: you can't steer what you can't see

// "Inside" chase camera (ball's-eye view). Walls are drawn taller in this view only; physics is unchanged.
export const INSIDE_VIEW = {
  CAM_HEIGHT: 0.95,   // eye height above the floor
  CAM_BACK: 2.3,      // distance behind the ball (shortened if a wall is in the way)
  LOOK_AHEAD: 2.6,
  FOV: 72,
  WALL_SCALE: 3.2,    // visual wall height multiplier, so corridors tower over the camera
  // Car-like turning: the camera eases toward the ball's actual rolling direction,
  // never faster than MAX_TURN, and slower still when the ball is slow (no spinning on the spot).
  MAX_TURN: 1.5,          // rad/s (~86°/s) at full speed
  TURN_EASE: 2.2,         // how eagerly it closes the gap (1/s)
  FULL_TURN_SPEED: 3.0,   // ball speed at which the full turn rate is allowed
  FOLLOW_MIN_SPEED: 0.8,  // below this the heading is too noisy to follow
  REVERSE_ANGLE: 2.1,     // rad (~120°): rolling further back than this = reversing, camera holds
  UTURN_DELAY: 1.2        // s of reversing (while not pushing "back") before a slow U-turn
};
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
    // Floor 0.82 keeps every level >= ~2.4x a careful single-ball run (tests/solvable.test.mjs):
    // three balls split up at every gate, so tighter than that is out of reach even for experts.
    timeFactor: L < 3 ? 0 : Math.max(0.82, 1.05 - L * 0.015)
  };
}
