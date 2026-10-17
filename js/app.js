/* ==========================================================================
   3D LABYRINTH - MAIN APPLICATION (game loop, camera, level lifecycle)
   ========================================================================== */

import { VERSION, BOARD, PHYS, DEFAULT_LOOK, surfacePhysics, timePace } from './config.js';
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
    if (p && p.unlocked >= 1) return { unlocked: p.unlocked | 0, best: p.best || {} };
  } catch (_) { /* corrupt or blocked storage: start fresh */ }
  return { unlocked: 1, best: {} };
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
    this.physics = new PhysicsWorld(this.level, surf);
    this.board.build(this.level, this.look);
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
      this.ui.showModal('pauseScreen');
    } else if (this.state === 'PAUSED') {
      this.state = this.pausedFrom || 'PLAYING';
      this.ui.hideModals();
      this.audio.startMusic();
      this.controls.requestWakeLock();
    }
  }

  stopGame() {
    clearInterval(this.countdownTimer);
    this.state = 'MENU';
    this.audio.stopMusic();
    this.controls.releaseWakeLock();
    this.hud.hideBanner();
    this.ui.showMenuPage();
  }

  levelComplete() {
    this.state = 'COMPLETE';
    const n = this.level.n, t = this.elapsed, falls = this.physics.falls, tl = this.level.timeLimit;
    let stars = 1;
    if (falls <= 2) stars = 2;
    if (falls === 0 && (!tl || t <= tl * 0.66)) stars = 3;
    const prev = this.progress.best[n];
    const isBest = !prev || t < prev.time;
    this.progress.best[n] = {
      time: prev ? Math.min(prev.time, t) : t,
      stars: Math.max(stars, prev ? prev.stars : 0)
    };
    this.progress.unlocked = Math.max(this.progress.unlocked, n + 1);
    try { localStorage.setItem(PROGRESS_KEY, JSON.stringify(this.progress)); } catch (_) { /* private mode */ }
    this.audio.playLevelComplete();
    this.vibrate([40, 60, 40]);
    this.controls.releaseWakeLock();
    this.hud.showBanner('CLEAR!', '★'.repeat(stars) + '☆'.repeat(3 - stars), '#34ff9a');
    setTimeout(() => {
      if (this.state === 'COMPLETE') this.ui.showComplete({ n, time: t, falls, stars, isBest });
    }, 900);
  }

  levelFailed() {
    this.state = 'FAILED';
    this.audio.playFail();
    this.vibrate(200);
    this.controls.releaseWakeLock();
    this.hud.showBanner("TIME'S UP", `${this.physics.captured}/3 balls home`, '#ff3b5c');
    setTimeout(() => {
      if (this.state === 'FAILED') this.ui.showFailed({ n: this.level.n, captured: this.physics.captured });
    }, 900);
  }

  handleAction(a) {
    const inGame = this.state !== 'MENU';
    switch (a) {
      case 'pause': if (inGame) this.togglePause(); break;
      case 'restart': if (inGame) { this.ui.hideModals(); this.startLevel(this.level.n); } break;
      case 'calibrate': this.calibrate(); break;
      case 'view': this.ui.setViewMode(this.cycleViewMode()); break;
      case 'mute': this.ui.toggleMute(); break;
      case 'confirm':
        if (this.state === 'MENU') this.startLevel(this.progress.unlocked);
        else if (this.state === 'COMPLETE') { this.ui.hideModals(); this.startLevel(this.level.n + 1); }
        else if (this.state === 'FAILED') { this.ui.hideModals(); this.startLevel(this.level.n); }
        else if (this.state === 'PAUSED') this.togglePause();
        break;
    }
  }

  calibrate() {
    this.controls.calibrate();
    if (this.state !== 'MENU') this.hud.showBanner('LEVELLED', 'Current hold = flat', '#00f0ff', 1.0);
  }

  cycleViewMode() {
    const order = ['AUTO', 'OVERVIEW', 'FOLLOW'];
    this.viewMode = order[(order.indexOf(this.viewMode) + 1) % order.length];
    return this.viewMode;
  }

  vibrate(p) { if (navigator.vibrate) { try { navigator.vibrate(p); } catch (_) { /* unsupported */ } } }

  /* ------------------------------ Per-frame ------------------------------ */
  updatePlay(dt) {
    const input = this.controls.update(dt);
    const active = this.state === 'PLAYING';
    const maxTilt = this.level.params.maxTiltDeg * DEG;
    const tx = active ? input.x * maxTilt : 0, tz = active ? input.y * maxTilt : 0;
    const k = Math.min(1, PHYS.TILT_RATE * dt);
    this.tilt.x += (tx - this.tilt.x) * k;
    this.tilt.z += (tz - this.tilt.z) * k;

    if (active) {
      const g = PHYS.G * PHYS.ROLL_FACTOR * this.physics.surf.accel;
      this.physics.step(dt, g * Math.sin(this.tilt.x), -g * Math.sin(this.tilt.z), {
        wallHit: s => { this.audio.playClick(s); if (s > 5) this.vibrate(15); },
        ballHit: s => this.audio.playClick(s, true),
        fall: () => { this.audio.playFall(); this.vibrate(80); },
        capture: b => { this.audio.playCapture(b.slot); this.vibrate(30); }
      });
      this.elapsed += dt;
      const tl = this.level.timeLimit;
      if (tl) {
        const left = Math.ceil(tl - this.elapsed);
        if (left <= 10 && left !== this.lastTick && left > 0) { this.lastTick = left; this.audio.playTick(true); }
      }
      if (this.physics.allHome) this.levelComplete();
      else if (tl && this.elapsed >= tl) this.levelFailed();
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
      source: this.controls.source
    });
  }

  updateCamera(dt) {
    const r = this.renderer, xr = r.renderer.xr.isPresenting;
    if (xr) return;
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
    if (this.state !== 'PAUSED') this.updatePlay(dt);
    this.hud.update(dt);
    this.updateCamera(dt);
    this.renderer.render(this.scene);
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
