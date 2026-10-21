/* ==========================================================================
   3D LABYRINTH - SAVED PROGRESS (localStorage)
   The same game can be open twice on one device (installed app + browser tab, two tabs,
   a PC tab left open). Each copy holds progress in memory, so a plain overwrite let a stale
   copy roll back levels another copy had cleared. Every save therefore MERGES with what is
   stored: cleared levels, best times/stars and claimed apples only ever grow.
   Pure module (storage is passed in) so it can be unit-tested in Node.
   ========================================================================== */

import { LIVES } from './config.js';

export const PROGRESS_KEY = '3d_labyrinth_progress';

export const freshProgress = () => ({ unlocked: 1, best: {}, lives: LIVES.START, apples: {} });

/** Stored JSON -> clean progress record (null when nothing usable is stored). */
export function parseProgress(json) {
  try {
    const p = JSON.parse(json || 'null');
    if (p && p.unlocked >= 1) {
      // Saves from before lives existed get credit for the levels already cleared
      const lives = Number.isInteger(p.lives) ? p.lives : Math.min(LIVES.MAX, LIVES.START + (p.unlocked - 1) * LIVES.PER_NEW_LEVEL);
      return { unlocked: p.unlocked | 0, best: p.best || {}, lives, apples: p.apples || {} };
    }
  } catch (_) { /* corrupt: treat as nothing stored */ }
  return null;
}

/**
 * Combine two progress records. Achievements never go backwards: highest unlocked level,
 * fastest time and most stars per level, every apple claimed by either. Lives can legitimately
 * go down, so they come from `primary` (the record judged most recent by the caller).
 */
export function mergeProgress(primary, other) {
  if (!other) return primary;
  const best = { ...other.best };
  for (const [n, b] of Object.entries(primary.best)) {
    const o = best[n];
    best[n] = o ? { time: Math.min(o.time, b.time), stars: Math.max(o.stars, b.stars) } : b;
  }
  return {
    unlocked: Math.max(primary.unlocked, other.unlocked),
    best,
    lives: primary.lives,
    apples: { ...other.apples, ...primary.apples }
  };
}

export function loadProgress(storage = globalThis.localStorage) {
  try { return parseProgress(storage.getItem(PROGRESS_KEY)) || freshProgress(); } catch (_) { return freshProgress(); } // storage blocked
}

/** Merge `mine` into what is stored, write it back, and return the merged record to keep in memory. */
export function saveProgress(mine, storage = globalThis.localStorage) {
  try {
    const merged = mergeProgress(mine, parseProgress(storage.getItem(PROGRESS_KEY)));
    storage.setItem(PROGRESS_KEY, JSON.stringify(merged));
    return merged;
  } catch (_) { return mine; } // private mode / storage blocked: keep playing from memory
}
