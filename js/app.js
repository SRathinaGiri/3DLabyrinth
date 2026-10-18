/* ==========================================================================
   3D LABYRINTH - MAIN APPLICATION (game loop, camera, level lifecycle)
   ========================================================================== */

import { VERSION, BOARD, PHYS, LIVES, DEFAULT_LOOK, BALL_COUNT, EXPLORER_BALL_COUNT, INSIDE_VIEW, surfacePhysics, timePace } from './config.js';
import { buildLevel } from './maze.js';
import { PhysicsWorld } from './physics.js';
import { StereoRenderEngine } from './renderer.js';
import { BoardView } from './board.js';
import { ControlsHandler } from './controls.js';
import { HUD3D } from './hud3d.js';
import { soundEngine } from './audio.js';
import { UIManager } from './ui.js';

const DEG = Math.PI / 180;
const PROGRESS_KEY = '3d_labyrinth_progress';
const CAM_PITCH = 60 * DEG;       // camera elevation above the board plane
const STEREO_RATIO = 0.035;       // eye separation as a fraction of viewing distance at Depth = 1.0
const MIN_CELL_PX = 34;           // AUTO view switches to follow-cam when cells would render smaller than this
const COUNTDOWN = 3;

function loadProgress() {
  try {
    const p = JSON.parse(localStorage.getItem(PROGRESS_KEY) || 'null');
    if (p && p.unlocked >= 1) {
      // Saves from before lives existed get credit for the levels already cleared
      const lives = Number.isInteger(p.lives) ? p.lives : Math.min(LIVES.MAX, LIVES.START + (p.unlocked - 1) * LIVES.PER_NEW_LEVEL);
      return { unlocked: p.unlocked | 0, best: p.best || {}, lives };
    }
  } catch (_) { /* corrupt or blocked storage: start fresh */ }
  return { unlocked: 1, best: {}, lives: LIVES.START };
}

class GameApp {
  constructor() {
    this.version = VERSION;
    this.state = 'MENU'; // MENU, COUNTDOWN, PLAYING, PAUSED, COMPLETE, FAILED
    this.viewMode = 'AUTO'; // AUTO, OVERVIEW, FOLLOW
    this.depth = 1.0;
    this.focusOffset = 0;
    this.progress = loadProgress();
    this.look = { ...DEFAULT_LOOK }; // board surface + ball type, chosen in the menu
    this.explorer = false;           // Explorer mode: a single ball (made for the Inside view)
    this.focusBall = 0;              // ball the Inside camera follows
    this.inside = { dir: [0, -1], yaw: 0, pend: null, pendT: 0, back: INSIDE_VIEW.CAM_BACK };

    this.scene = new THREE.Scene();
    const canvas = document.getElementById('gameCanvas');
    this.renderer = new StereoRenderEngine(canvas);
    this.scene.add(this.renderer.cameraGroup);
    this.board = new BoardView(this.scene, this.renderer.renderer);
    this.controls = new ControlsHandler();
    this.hud = new HUD3D(this.renderer.mainCamera);
    this.audio = soundEngine;

    this.tilt = { x: 0, z: 0 };
    this.cam = { target: new THREE.Vector3(), dist: 20, ready: false, follow: false };
    this.elapsed = 0;
    this.lastTick = -1;
    this.renderer.onBeforeEyes = aspect => this.hud.layout(this.renderer.focalLength, this.renderer.fov, aspect);

    this.ui = new UIManager(this);
    this.controls.bindDragJoystick(document.getElementById('viewportFrame'), document.getElementById('joystick'));
    this.controls.onAction = a => this.handleAction(a);
    this.bindDialogPointer();

    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'hidden' && (this.state === 'PLAYING' || this.state === 'COUNTDOWN')) this.togglePause();
    });
    window.addEventListener('resize', () => this.renderer.handleResize());
    window.addEventListener('orientationchange', () => setTimeout(() => this.renderer.handleResize(), 250));

    this.setupWebXR();
    this.registerServiceWorker();
    this.ui.showMenuPage();
    this.animate = this.animate.bind(this);
    this.renderer.renderer.setAnimationLoop(this.animate);
    console.log(`[3D Labyrinth v${VERSION}] ready`);
  }

  /* ------------------------------ Level lifecycle ------------------------------ */
  loadLevel(n) {
    this.level = buildLevel(n);
    const surf = surfacePhysics(this.look.board, this.look.ball);
    this.level.timeLimit = Math.round(this.level.timeLimit * timePace(surf));
    this.physics = new PhysicsWorld(this.level, surf, this.explorer ? EXPLORER_BALL_COUNT : BALL_COUNT);
    // A falling ball spends a life (if any) and hops past the hole instead of restarting
    this.physics.onFallSave = () => this.state === 'PLAYING' && this.spendLives(1);
    this.board.build(this.level, this.look, this.physics.balls.length);
    // Inside camera starts facing down the first corridor of the solution path
    const [p0, p1] = this.level.path;
    this.inside.dir = p1 ? [Math.sign(p1.c - p0.c), Math.sign(p1.r - p0.r)] : [0, -1];
    this.inside.yaw = Math.atan2(this.inside.dir[0], -this.inside.dir[1]);
    this.inside.pend = null;
    this.focusBall = 0;
    this.audio.setMaterials(this.look.board, this.look.ball);
    this.tilt.x = this.tilt.z = 0;
    this.elapsed = 0;
    this.lastTick = -1;
    this.cam.ready = false;
  }

  /** Call from a user gesture: it may trigger the iOS motion-permission prompt. */
  startLevel(n) {
    this.audio.ensureContext();
    if (this.controls.gyroWanted && !this.controls.gyroEnabled) {
      this.controls.enableGyro().then(on => this.ui.syncGyro(on));
    }
    clearInterval(this.countdownTimer);
    this.closeDialog();
    this.loadLevel(n);
    this.ui.showGamePage();
    this.renderer.handleResize();
    this.controls.resetManual();
    this.controls.requestWakeLock();
    this.audio.startMusic();

    this.state = 'COUNTDOWN';
    let c = COUNTDOWN;
    const p = this.level.params;
    const sub = `${this.level.cols}×${this.level.rows}` + (this.level.timeLimit ? ` · ${this.level.timeLimit}s` : ' · untimed') +
      (p.sliders ? ' · gates' : '') + (this.level.holes.length ? ' · holes' : '');
    this.hud.showBanner(`LEVEL ${n}`, sub, '#00f0ff');
    this.countdownTimer = setInterval(() => {
      if (this.state === 'PAUSED') return;
      if (this.state !== 'COUNTDOWN') { clearInterval(this.countdownTimer); return; }
      if (c === 1) this.controls.calibrate(); // capture the current hand position as "level"
      if (c > 0) {
        this.hud.showBanner(String(c), this.controls.gyroEnabled ? 'Hold phone steady · calibrating' : 'Get ready', '#ffc93c');
        this.audio.playTick(false);
        c--;
      } else {
        clearInterval(this.countdownTimer);
        this.hud.showBanner('GO!', '', '#34ff9a', 0.7);
        this.state = 'PLAYING';
      }
    }, 800);
  }

  togglePause() {
    if (this.state === 'PLAYING' || this.state === 'COUNTDOWN') {
      this.pausedFrom = this.state;
      this.state = 'PAUSED';
      this.controls.resetManual();
      this.audio.stopMusic();
      this.controls.releaseWakeLock();
      this.openDialog({
        title: 'PAUSED', color: '#00f0ff',
        lines: [`Level ${this.level.n} · ❤ ${this.progress.lives} ${this.progress.lives === 1 ? 'life' : 'lives'}`],
        buttons: [{ id: 'resume', label: '▶ Resume' }, { id: 'restart', label: '↻ Restart' }, { id: 'settings', label: '⚙ 3D' }, { id: 'menu', label: '☰ Menu' }]
      });
    } else if (this.state === 'PAUSED') {
      this.state = this.pausedFrom || 'PLAYING';
      this.closeDialog();
      this.ui.hideModals();
      this.audio.startMusic();
      this.controls.requestWakeLock();
    }
  }

  stopGame() {
    clearInterval(this.countdownTimer);
    this.state = 'MENU';
    this.closeDialog();
    this.audio.stopMusic();
    this.controls.releaseWakeLock();
    this.hud.hideBanner();
    this.ui.showMenuPage();
  }

  saveProgress() {
    try { localStorage.setItem(PROGRESS_KEY, JSON.stringify(this.progress)); } catch (_) { /* private mode */ }
  }

  /** Spend n lives from the shared pool; false (and nothing spent) if there are not enough. */
  spendLives(n) {
    if (this.progress.lives < n) return false;
    this.progress.lives -= n;
    this.saveProgress();
    return true;
  }

  /** rescuedWith = number of lives spent at time-out to bring the remaining balls home. */
  levelComplete(rescuedWith = 0) {
    this.state = 'COMPLETE';
    const n = this.level.n, t = this.elapsed, falls = this.physics.falls, saves = this.physics.saves, tl = this.level.timeLimit;
    // Stars: lives keep you playing but cap the rating
    let stars = falls + saves <= 2 ? 2 : 1;
    if (falls === 0 && saves === 0 && (!tl || t <= tl * 0.66)) stars = 3;
    if (rescuedWith) stars = 1;
    const prev = this.progress.best[n];
    const isBest = !rescuedWith && (!prev || t < prev.time);
    this.progress.best[n] = {
      time: prev ? Math.min(prev.time, t) : t,
      stars: Math.max(stars, prev ? prev.stars : 0)
    };
    const firstClear = n >= this.progress.unlocked;
    if (firstClear) this.progress.lives = Math.min(LIVES.MAX, this.progress.lives + LIVES.PER_NEW_LEVEL);
    this.progress.unlocked = Math.max(this.progress.unlocked, n + 1);
    this.saveProgress();
    this.audio.playLevelComplete();
    this.vibrate([40, 60, 40]);
    this.controls.releaseWakeLock();

    const mm = Math.floor(t / 60), ss = String(Math.floor(t % 60)).padStart(2, '0');
    const lines = [`Time ${mm}:${ss}${isBest ? ' (best!)' : ''} · Falls ${falls}${saves ? ` · Saves ${saves}` : ''}`];
    if (rescuedWith) lines.unshift(`Rescued with ${rescuedWith} ❤`);
    lines.push(`❤ ${this.progress.lives} ${this.progress.lives === 1 ? 'life' : 'lives'}${firstClear ? `  (+${LIVES.PER_NEW_LEVEL} new level)` : ''}`);
    this.openDialog({
      title: rescuedWith ? `LEVEL ${n} RESCUED` : `LEVEL ${n} CLEAR!`,
      color: rescuedWith ? '#ffc93c' : '#34ff9a',
      big: '★'.repeat(stars) + '☆'.repeat(3 - stars),
      lines,
      buttons: [{ id: 'next', label: 'Next ▶' }, { id: 'replay', label: '↻ Replay' }, { id: 'menu', label: '☰ Menu' }]
    });
  }

  levelFailed() {
    this.state = 'FAILED';
    this.audio.playFail();
    this.vibrate(200);
    this.controls.releaseWakeLock();
    const out = this.physics.balls.length - this.physics.captured;
    this.openDialog({
      title: "TIME'S UP", color: '#ff3b5c',
      lines: [`${this.physics.captured}/${this.physics.balls.length} balls home`, `Rescue needs ${out} ❤ · you have ${this.progress.lives}`],
      buttons: [{ id: 'retry', label: '↻ Try again' }, { id: 'menu', label: '☰ Menu' }]
    });
  }

  /* ------------------------------ 3D dialogs ------------------------------ */
  openDialog(spec) {
    this.hud.showDialog(spec);
    this.controls.menuMode = true;
    this.controls.resetManual();
  }

  closeDialog() {
    this.hud.hideDialog();
    this.controls.menuMode = false;
  }

  /** Taps on the canvas while a dialog is open: map to eye-local NDC (works in both SBS halves). */
  bindDialogPointer() {
    const canvas = this.renderer.renderer.domElement;
    const toNdc = e => {
      const r = canvas.getBoundingClientRect();
      let u = (e.clientX - r.left) / r.width;
      const v = (e.clientY - r.top) / r.height;
      if (this.renderer.isDualView) u = (u % 0.5) * 2; // either eye's half maps to the same panel
      return [u * 2 - 1, 1 - v * 2];
    };
    this.controls.blockDrag = e => {
      if (!this.hud.dialogVisible) return false;
      const i = this.hud.hitIndex(...toNdc(e));
      if (i >= 0) { this.hud.setFocus(i); this.dialogAction(this.hud.focusedAction()); }
      return true;
    };
    canvas.addEventListener('pointermove', e => {
      if (e.pointerType === 'mouse' && this.hud.dialogVisible) this.hud.setFocus(this.hud.hitIndex(...toNdc(e)));
    });
  }

  dialogAction(id) {
    this.audio.ensureContext();
    switch (id) {
      case 'resume': this.togglePause(); break;
      case 'restart': case 'retry': case 'replay': this.startLevel(this.level.n); break;
      case 'next': this.startLevel(this.level.n + 1); break;
      case 'menu': this.stopGame(); break;
      case 'settings': this.ui.showModal('pauseScreen'); break; // sliders need a real 2D form
    }
  }

  handleAction(a) {
    const inGame = this.state !== 'MENU';
    const settingsOpen = !document.getElementById('pauseScreen').classList.contains('hidden');
    if (this.hud.dialogVisible && !settingsOpen) {
      if (a === 'focusPrev') return this.hud.moveFocus(-1);
      if (a === 'focusNext') return this.hud.moveFocus(1);
      if (a === 'confirm') return this.dialogAction(this.hud.focusedAction());
    }
    switch (a) {
      case 'pause':
        if (settingsOpen) this.ui.hideModals();
        else if (inGame && this.state !== 'COMPLETE' && this.state !== 'FAILED') this.togglePause();
        break;
      case 'restart': if (inGame) { this.ui.hideModals(); this.startLevel(this.level.n); } break;
      case 'calibrate': this.calibrate(); break;
      case 'view': this.ui.setViewMode(this.cycleViewMode()); break;
      case 'mute': this.ui.toggleMute(); break;
      case 'ball': this.nextFocusBall(); break;
      case 'confirm':
        if (this.state === 'MENU') this.startLevel(this.progress.unlocked);
        break;
    }
  }

  calibrate() {
    this.controls.calibrate();
    if (this.state !== 'MENU') this.hud.showBanner('LEVELLED', 'Current hold = flat', '#00f0ff', 1.0);
  }

  cycleViewMode() {
    const order = ['AUTO', 'OVERVIEW', 'FOLLOW', 'INSIDE'];
    this.viewMode = order[(order.indexOf(this.viewMode) + 1) % order.length];
    return this.viewMode;
  }

  /** Inside view: follow the next ball that is still in play. */
  nextFocusBall() {
    if (!this.physics) return;
    const n = this.physics.balls.length;
    for (let k = 1; k <= n; k++) {
      const i = (this.focusBall + k) % n;
      if (this.physics.balls[i].state !== 'captured') { this.focusBall = i; break; }
    }
    this.inside.pend = null;
  }

  vibrate(p) { if (navigator.vibrate) { try { navigator.vibrate(p); } catch (_) { /* unsupported */ } } }

  /* ------------------------------ Per-frame ------------------------------ */
  updatePlay(dt) {
    const input = this.controls.tilt;
    const active = this.state === 'PLAYING';
    const maxTilt = this.level.params.maxTiltDeg * DEG;
    let ix = input.x, iy = input.y;
    if (this.viewMode === 'INSIDE') {
      // Camera-relative: "forward" rolls the ball the way the camera faces
      const [fx, fz] = this.inside.dir;
      const ax = ix * -fz + iy * fx, az = ix * fx + iy * fz;
      ix = ax; iy = -az;
    }
    const tx = active ? ix * maxTilt : 0, tz = active ? iy * maxTilt : 0;
    const k = Math.min(1, PHYS.TILT_RATE * dt);
    this.tilt.x += (tx - this.tilt.x) * k;
    this.tilt.z += (tz - this.tilt.z) * k;

    if (active) {
      const g = PHYS.G * PHYS.ROLL_FACTOR * this.physics.surf.accel;
      this.physics.step(dt, g * Math.sin(this.tilt.x), -g * Math.sin(this.tilt.z), {
        wallHit: s => { this.audio.playClick(s); if (s > 5) this.vibrate(15); },
        ballHit: s => this.audio.playClick(s, true),
        fall: () => { this.audio.playFall(); this.vibrate(80); },
        save: () => {
          this.audio.playSave(); this.vibrate([30, 40, 30]);
          this.hud.showBanner('❤ SAVED', `Hopped over the hole · ${this.progress.lives} left`, '#ff4f7a', 1.1);
        },
        capture: b => { this.audio.playCapture(b.slot); this.vibrate(30); }
      });
      this.elapsed += dt;
      const tl = this.level.timeLimit;
      if (tl) {
        const left = Math.ceil(tl - this.elapsed);
        if (left <= 10 && left !== this.lastTick && left > 0) { this.lastTick = left; this.audio.playTick(true); }
      }
      if (this.physics.allHome) this.levelComplete();
      else if (tl && this.elapsed >= tl) {
        // Time-out: one life per ball still out rescues the level, if the pool covers them all
        const out = this.physics.balls.length - this.physics.captured;
        if (this.spendLives(out)) this.levelComplete(out);
        else this.levelFailed();
      }
    } else if (this.state === 'COMPLETE' || this.state === 'FAILED') {
      this.physics.step(dt, 0, 0); // let captured balls settle into the goal
    }

    this.board.update(this.physics, this.tilt.x, this.tilt.z, dt);
    this.hud.setStatus({
      level: this.level.n,
      balls: this.physics.balls.map(b => b.state),
      time: this.elapsed,
      timeLimit: this.level.timeLimit,
      falls: this.physics.falls,
      lives: this.progress.lives,
      focus: this.viewMode === 'INSIDE' && this.physics.balls.length > 1 ? this.focusBall : -1,
      source: this.controls.source
    });
  }

  updateCamera(dt) {
    const r = this.renderer, xr = r.renderer.xr.isPresenting;
    if (xr) return;
    const inside = this.viewMode === 'INSIDE';
    this.board.setWallTarget(inside ? INSIDE_VIEW.WALL_SCALE : 1, dt);
    this.physics.hopHeight = PHYS.HOP_HEIGHT + BOARD.WALL_H * (this.board.wallScale - 1); // clear the taller walls
    r.fov += ((inside ? INSIDE_VIEW.FOV : 50) - r.fov) * Math.min(1, 4 * dt);
    if (inside) { this.updateInsideCamera(dt); return; }
    const { W, H } = this.board.extent;
    const aspect = r.eyeAspect();
    const vf = (r.fov / 2) * DEG, hf = Math.atan(Math.tan(vf) * aspect);
    const halfW = W / 2 + 0.8, halfD = H / 2 + 0.8;
    // Vertical fit reserves ~14% of the view for the HUD bar at the top
    const overviewDist = Math.max(halfW / Math.tan(hf), (halfD * Math.sin(CAM_PITCH) + BOARD.WALL_H) / (Math.tan(vf) * 0.86)) * 1.06;

    const pxH = r.renderer.domElement.clientHeight || 500;
    const cellPx = pxH * BOARD.CELL / (2 * overviewDist * Math.tan(vf));
    const follow = this.viewMode === 'FOLLOW' || (this.viewMode === 'AUTO' && cellPx < MIN_CELL_PX);

    // Aim slightly beyond the board centre so the board sits below the HUD bar
    const target = new THREE.Vector3(0, 0, -halfD * 0.12);
    let dist = overviewDist;
    if (follow) {
      const live = this.physics.balls.filter(b => b.state === 'roll');
      const pts = live.length ? live : [this.level.goal];
      let minX = Infinity, maxX = -Infinity, minZ = Infinity, maxZ = -Infinity;
      for (const p of pts) { minX = Math.min(minX, p.x); maxX = Math.max(maxX, p.x); minZ = Math.min(minZ, p.z); maxZ = Math.max(maxZ, p.z); }
      target.set((minX + maxX) / 2, 0, (minZ + maxZ) / 2);
      // Pull back to keep every live ball on screen, never past the overview distance
      const spreadW = (maxX - minX) / 2 + 3.2, spreadD = (maxZ - minZ) / 2 + 3.2;
      dist = Math.min(overviewDist, Math.max(spreadW / Math.tan(hf), spreadD * Math.sin(CAM_PITCH) / Math.tan(vf), 9));
      // Keep the view filled with board instead of empty space when balls hug an edge
      const visW = dist * Math.tan(hf), visD = dist * Math.tan(vf) / Math.sin(CAM_PITCH);
      const clampTo = (v, half, vis) => (vis >= half ? 0 : Math.max(-half + vis, Math.min(half - vis, v)));
      target.x = clampTo(target.x, halfW, visW);
      target.z = clampTo(target.z, halfD, visD * 0.85);
    }
    const k = this.cam.ready ? Math.min(1, 2.5 * dt) : 1;
    this.cam.target.lerp(target, k);
    this.cam.dist += (dist - this.cam.dist) * k;
    this.cam.ready = true;

    const pos = new THREE.Vector3(0, Math.sin(CAM_PITCH), Math.cos(CAM_PITCH)).multiplyScalar(this.cam.dist).add(this.cam.target);
    r.cameraGroup.position.copy(pos);
    const dir = this.cam.target.clone().sub(pos).normalize();
    r.cameraGroup.quaternion.setFromUnitVectors(new THREE.Vector3(0, 0, -1), dir);

    // Stereo follows the viewing distance so depth feels the same on a 5x5 or a 16x16 board
    r.setFocalLength(this.cam.dist * (1 + this.focusOffset));
    r.setEyeDistance(this.depth * this.cam.dist * STEREO_RATIO);
  }

  /** Ball's-eye chase camera. Positions are computed in board space so it rides the tilting board. */
  updateInsideCamera(dt) {
    const r = this.renderer, V = INSIDE_VIEW, ins = this.inside, balls = this.physics.balls;
    let b = balls[this.focusBall];
    if (!b || b.state === 'captured') { this.nextFocusBall(); b = balls[this.focusBall]; }

    // Turn the camera only once the ball has committed to a new corridor direction.
    // A 180° turn waits until the player stops pushing "back", else camera-relative
    // controls would ping-pong (back -> camera flips -> back now means forward).
    const sp = Math.hypot(b.vx, b.vz);
    if (b.state === 'roll' && sp > 1.0 && this.state === 'PLAYING') {
      const cand = Math.abs(b.vx) > Math.abs(b.vz) ? [Math.sign(b.vx), 0] : [0, Math.sign(b.vz)];
      const same = cand[0] === ins.dir[0] && cand[1] === ins.dir[1];
      const reverse = cand[0] === -ins.dir[0] && cand[1] === -ins.dir[1];
      const holdingBack = this.controls.tilt.y < -0.3;
      if (same || (reverse && holdingBack)) ins.pend = null;
      else if (ins.pend && ins.pend[0] === cand[0] && ins.pend[1] === cand[1]) {
        ins.pendT += dt;
        if (ins.pendT > (reverse ? V.TURN_COMMIT * 3 : V.TURN_COMMIT)) { ins.dir = cand; ins.pend = null; }
      } else { ins.pend = cand; ins.pendT = 0; }
    }
    const targetYaw = Math.atan2(ins.dir[0], -ins.dir[1]);
    let dy = targetYaw - ins.yaw;
    dy = Math.atan2(Math.sin(dy), Math.cos(dy)); // shortest way round
    ins.yaw += dy * Math.min(1, V.TURN_RATE * dt);
    const fx = Math.sin(ins.yaw), fz = -Math.cos(ins.yaw);

    // Pull the camera in if a wall sits between it and the ball
    let back = V.CAM_BACK;
    for (let s = 0.35; s <= V.CAM_BACK; s += 0.1) {
      const px = b.x - fx * s, pz = b.z - fz * s, m = 0.2;
      if (this.physics.walls.some(w => px > w.minX - m && px < w.maxX + m && pz > w.minZ - m && pz < w.maxZ + m)) { back = Math.max(0.35, s - 0.1); break; }
    }
    ins.back += (back - ins.back) * Math.min(1, (back < ins.back ? 12 : 3) * dt);

    const by = Math.max(BOARD.BALL_R, b.y);
    // Boxed in by a wall behind? Boom up and look down over the ball instead of crowding it
    const boom = (V.CAM_BACK - ins.back) * 0.9;
    const eye = new THREE.Vector3(b.x - fx * ins.back, V.CAM_HEIGHT + boom + (by - BOARD.BALL_R) * 0.6, b.z - fz * ins.back);
    const look = new THREE.Vector3(b.x + fx * V.LOOK_AHEAD, 0.45 + (by - BOARD.BALL_R) * 0.4, b.z + fz * V.LOOK_AHEAD);
    this.board.boardGroup.updateMatrixWorld();
    eye.applyMatrix4(this.board.boardGroup.matrixWorld);
    look.applyMatrix4(this.board.boardGroup.matrixWorld);
    // World "up" keeps the horizon level, so you see the floor tilt under the ball
    const m = new THREE.Matrix4().lookAt(eye, look, new THREE.Vector3(0, 1, 0));
    r.cameraGroup.position.copy(eye);
    r.cameraGroup.quaternion.setFromRotationMatrix(m);
    this.board.setHeadlamp(eye, look);

    const dist = Math.hypot(ins.back, V.CAM_HEIGHT - BOARD.BALL_R);
    this.cam.dist = dist;
    this.cam.ready = false; // snap back cleanly when leaving the Inside view
    r.setFocalLength(dist * (1 + this.focusOffset));
    r.setEyeDistance(this.depth * dist * STEREO_RATIO);
  }

  animate(timestamp) {
    const now = timestamp || performance.now();
    const dt = Math.min(Math.max(((now - (this.lastTime || now)) / 1000), 0.001), 0.05);
    this.lastTime = now;
    if (this.state === 'MENU' || !this.level) return; // menu has no 3D view: save battery

    const xr = this.renderer.renderer.xr;
    if (xr.isPresenting) {
      const pressed = this.controls.pollXR(xr.getSession());
      if (pressed && !this.xrConfirmHeld) this.handleAction('confirm');
      this.xrConfirmHeld = pressed;
      this.hud.layout(1.4, 70, 1.2);
    }
    this.controls.update(dt); // every frame, so gamepad/XR can drive dialogs while paused
    if (this.hud.dialogVisible) this.pollDialogStick();
    if (this.state !== 'PAUSED') this.updatePlay(dt);
    this.hud.update(dt);
    this.updateCamera(dt);
    this.renderer.render(this.scene);
  }

  /** Gamepad / Quest thumbstick flicks move dialog focus (edge-triggered). */
  pollDialogStick() {
    const x = this.controls.source === 'pad' || this.controls.source === 'vr' ? this.controls.tilt.x : 0;
    const dir = x > 0.6 ? 1 : x < -0.6 ? -1 : 0;
    if (dir && dir !== this.stickDir) this.hud.moveFocus(dir);
    this.stickDir = dir;
  }

  /* ------------------------------ WebXR ------------------------------ */
  setupWebXR() {
    if (!navigator.xr) return;
    navigator.xr.isSessionSupported('immersive-vr').then(ok => {
      if (!ok) return;
      const btn = document.getElementById('webxrBtn');
      if (btn) btn.style.display = 'inline-flex';
      btn && btn.addEventListener('click', async () => {
        try {
          const session = await navigator.xr.requestSession('immersive-vr', { optionalFeatures: ['local-floor'] });
          this.renderer.renderer.xr.setReferenceSpaceType('local-floor');
          await this.renderer.renderer.xr.setSession(session);
          session.addEventListener('select', () => this.handleAction('confirm')); // trigger = OK
          if (this.state === 'MENU') this.startLevel(this.progress.unlocked);
          const fit = () => {
            const { W, H } = this.board.extent;
            const s = 1.0 / Math.max(W, H); // board ~1 m across on a virtual table
            this.board.world.scale.setScalar(s);
            this.board.world.position.set(0, 0.85, -0.7);
          };
          fit();
          this.renderer.cameraGroup.position.set(0, 0, 0);
          this.renderer.cameraGroup.quaternion.identity();
          this.xrFit = setInterval(fit, 500); // re-fit when the level (board size) changes
          session.addEventListener('end', () => {
            clearInterval(this.xrFit);
            this.board.world.scale.setScalar(1);
            this.board.world.position.set(0, 0, 0);
          });
        } catch (err) {
          console.warn('[WebXR] session failed:', err);
          alert('Could not start VR: ' + err.message);
        }
      });
    }).catch(() => {});
  }

  /* ------------------------------ PWA ------------------------------ */
  registerServiceWorker() {
    if (!('serviceWorker' in navigator) || location.protocol === 'file:') return;
    let refreshing = false;
    navigator.serviceWorker.addEventListener('controllerchange', () => {
      if (!refreshing && this.state !== 'PLAYING') { refreshing = true; location.reload(); }
    });
    window.addEventListener('load', () => {
      navigator.serviceWorker.register(`./sw.js?v=${VERSION}`).then(reg => {
        if (reg.waiting && navigator.serviceWorker.controller) this.ui.showUpdatePrompt(reg.waiting);
        reg.addEventListener('updatefound', () => {
          const w = reg.installing;
          w && w.addEventListener('statechange', () => {
            if (w.state === 'installed' && navigator.serviceWorker.controller) this.ui.showUpdatePrompt(w);
          });
        });
      }).catch(err => console.warn('[SW] registration failed:', err));
    });
  }
}

document.addEventListener('DOMContentLoaded', () => { window.app = new GameApp(); });
