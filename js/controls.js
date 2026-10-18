/* ==========================================================================
   3D LABYRINTH - ANALOG TILT INPUT
   Sources (highest priority first): touch/mouse drag joystick, keyboard,
   gamepad / WebXR thumbstick, gyroscope. Output: tilt.x, tilt.y in [-1, 1]
   (x>0 = tilt right, y>0 = tilt away from player).
   Gyro mapping & wake-lock logic ported from 3D Tunnel Rush v4.32.0, but
   analog (proportional) instead of 4-way digital.
   ========================================================================== */

const clamp1 = v => Math.max(-1, Math.min(1, v));

export class ControlsHandler {
  constructor() {
    this.tilt = { x: 0, y: 0 };
    this.source = 'none';

    this.keys = { left: false, right: false, up: false, down: false };
    this.keyTilt = { x: 0, y: 0 };

    this.drag = null;            // { id, x0, y0, x, y }
    this.dragRadius = 70;        // px of finger travel for full tilt
    this.joyEl = null;

    this.gyroWanted = true;      // default ON (mobile first)
    this.gyroEnabled = false;
    this.gyroLive = false;       // true once real sensor data arrives (desktop browsers expose the API but never fire)
    this.gyroSensitivity = 20;   // degrees of phone tilt for full board tilt
    this.gyroBase = null;
    this.gyroSamples = [];
    this.gyroRaw = { roll: 0, pitch: 0 };
    this.gyroTilt = { x: 0, y: 0 };
    this.invertY = false;

    this.padTilt = { x: 0, y: 0 };
    this.xrTilt = { x: 0, y: 0 };

    this.wakeLock = null;
    this.wakeLockRequested = false;

    this.onAction = null;        // (name) => void : 'pause','restart','calibrate','view','mute','confirm','focusPrev','focusNext'
    this.menuMode = false;       // a 3D dialog is open: arrows move focus instead of tilting
    this.blockDrag = null;       // (pointerEvent) => true when the app consumed the press (dialog tap)
    this.padConfirmHeld = false;
    this.handleOrientation = this.handleOrientation.bind(this);
    this.initKeyboard();
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'visible' && this.wakeLockRequested) this.requestWakeLock();
    });
  }

  get gyroAvailable() { return typeof window !== 'undefined' && 'DeviceOrientationEvent' in window; }

  /* ---------- Wake lock (keeps the phone screen on while tilting) ---------- */
  async requestWakeLock() {
    this.wakeLockRequested = true;
    if (!('wakeLock' in navigator) || this.wakeLock) return;
    try {
      this.wakeLock = await navigator.wakeLock.request('screen');
      this.wakeLock.addEventListener('release', () => { this.wakeLock = null; });
    } catch (err) { console.warn('[Controls] Wake lock failed:', err.message); }
  }

  async releaseWakeLock() {
    this.wakeLockRequested = false;
    if (this.wakeLock) { try { await this.wakeLock.release(); } catch (_) { /* already released */ } this.wakeLock = null; }
  }

  /* ---------- Gyroscope ---------- */
  /** Must be called from a user gesture (iOS permission prompt). Resolves to enabled state. */
  async enableGyro() {
    if (!this.gyroAvailable) return false;
    if (this.gyroEnabled) return true;
    if (typeof DeviceOrientationEvent.requestPermission === 'function') {
      try {
        const res = await DeviceOrientationEvent.requestPermission();
        if (res !== 'granted') { this.gyroWanted = false; return false; }
      } catch (err) {
        console.warn('[Controls] Gyro permission error:', err.message);
        return false;
      }
    }
    window.addEventListener('deviceorientation', this.handleOrientation, true);
    this.gyroEnabled = true;
    this.calibrate();
    return true;
  }

  disableGyro() {
    window.removeEventListener('deviceorientation', this.handleOrientation, true);
    this.gyroEnabled = false;
    this.gyroLive = false;
    this.gyroTilt.x = this.gyroTilt.y = 0;
  }

  /** Treat however the phone is held right now as "level". */
  calibrate() {
    this.gyroBase = null;
    this.gyroSamples = [];
  }

  screenAngle() {
    if (screen.orientation && typeof screen.orientation.angle === 'number') return screen.orientation.angle;
    return typeof window.orientation === 'number' ? window.orientation : 0;
  }

  handleOrientation(e) {
    if (e.beta === null || e.gamma === null) return;
    this.gyroLive = true;
    const beta = e.beta, gamma = e.gamma, a = this.screenAngle();
    let roll, pitch;
    if (a === 90) { roll = beta; pitch = -gamma; }
    else if (a === -90 || a === 270) { roll = -beta; pitch = gamma; }
    else if (a === 180) { roll = -gamma; pitch = -beta; }
    else { roll = gamma; pitch = beta; }
    this.gyroRaw.roll = roll; this.gyroRaw.pitch = pitch;

    if (!this.gyroBase) {
      this.gyroSamples.push({ roll, pitch });
      if (this.gyroSamples.length >= 6) {
        const n = this.gyroSamples.length;
        this.gyroBase = {
          roll: this.gyroSamples.reduce((s, v) => s + v.roll, 0) / n,
          pitch: this.gyroSamples.reduce((s, v) => s + v.pitch, 0) / n
        };
      }
      return;
    }
    const dr = roll - this.gyroBase.roll;
    let dp = pitch - this.gyroBase.pitch;
    if (dp > 180) dp -= 360; else if (dp < -180) dp += 360;
    const dead = 1.2; // degrees: hand tremor shouldn't creep the balls
    const shape = v => (Math.abs(v) < dead ? 0 : (v - Math.sign(v) * dead) / this.gyroSensitivity);
    // Tilting the top edge away (pitch decreases) rolls balls away from the player
    const tx = clamp1(shape(dr)), ty = clamp1(-shape(dp)) * (this.invertY ? -1 : 1);
    // Light low-pass smoothing to remove sensor jitter
    this.gyroTilt.x += (tx - this.gyroTilt.x) * 0.5;
    this.gyroTilt.y += (ty - this.gyroTilt.y) * 0.5;
  }

  /* ---------- Keyboard ---------- */
  initKeyboard() {
    const map = { ArrowLeft: 'left', KeyA: 'left', ArrowRight: 'right', KeyD: 'right', ArrowUp: 'up', KeyW: 'up', ArrowDown: 'down', KeyS: 'down' };
    const actions = { KeyP: 'pause', Escape: 'pause', KeyR: 'restart', KeyC: 'calibrate', KeyV: 'view', KeyM: 'mute', Space: 'confirm', Enter: 'confirm' };
    window.addEventListener('keydown', e => {
      if (e.target && /INPUT|SELECT|TEXTAREA/.test(e.target.tagName) && !map[e.code]) return;
      if (map[e.code] && this.menuMode) {
        e.preventDefault();
        const prev = map[e.code] === 'left' || map[e.code] === 'up';
        if (this.onAction) this.onAction(prev ? 'focusPrev' : 'focusNext');
      } else if (map[e.code]) { e.preventDefault(); this.keys[map[e.code]] = true; }
      else if (actions[e.code] && !e.repeat) {
        if (e.code === 'Space' || e.code === 'Enter') {
          if (e.target && e.target.tagName === 'BUTTON') return; // let the focused button handle it
          e.preventDefault();
        }
        if (this.onAction) this.onAction(actions[e.code]);
      }
    });
    window.addEventListener('keyup', e => { if (map[e.code]) { e.preventDefault(); this.keys[map[e.code]] = false; } });
    window.addEventListener('blur', () => this.resetManual());
  }

  /* ---------- Touch / mouse drag joystick ("hand gesture") ---------- */
  bindDragJoystick(surface, joyEl) {
    this.joyEl = joyEl;
    const ignore = e => e.target.closest && e.target.closest('button, input, .modal-card, .modal-overlay:not(.hidden)');
    surface.addEventListener('pointerdown', e => {
      if (this.drag || ignore(e)) return;
      if (this.blockDrag && this.blockDrag(e)) { e.preventDefault(); return; }
      if (e.pointerType === 'mouse' && e.button !== 0) return;
      this.drag = { id: e.pointerId, x0: e.clientX, y0: e.clientY, x: e.clientX, y: e.clientY };
      try { surface.setPointerCapture(e.pointerId); } catch (_) { /* pointer already gone; drag still works without capture */ }
      this.showJoy();
      this.requestWakeLock();
      e.preventDefault();
    });
    surface.addEventListener('pointermove', e => {
      if (!this.drag || e.pointerId !== this.drag.id) return;
      this.drag.x = e.clientX; this.drag.y = e.clientY;
      this.showJoy();
      e.preventDefault();
    });
    const end = e => {
      if (!this.drag || e.pointerId !== this.drag.id) return;
      this.drag = null;
      this.hideJoy();
    };
    surface.addEventListener('pointerup', end);
    surface.addEventListener('pointercancel', end);
  }

  showJoy() {
    if (!this.joyEl || !this.drag) return;
    const d = this.drag, r = this.dragRadius;
    let dx = d.x - d.x0, dy = d.y - d.y0;
    const len = Math.hypot(dx, dy);
    if (len > r) { dx *= r / len; dy *= r / len; }
    this.joyEl.style.display = 'block';
    this.joyEl.style.left = `${d.x0}px`;
    this.joyEl.style.top = `${d.y0}px`;
    const knob = this.joyEl.firstElementChild;
    if (knob) knob.style.transform = `translate(calc(-50% + ${dx}px), calc(-50% + ${dy}px))`;
  }

  hideJoy() { if (this.joyEl) this.joyEl.style.display = 'none'; }

  /* ---------- Gamepad & WebXR controllers ---------- */
  pollGamepads() {
    this.padTilt.x = this.padTilt.y = 0;
    const pads = navigator.getGamepads ? navigator.getGamepads() : [];
    // A / Cross button acts like Enter (edge-triggered)
    const confirm = [...pads].some(gp => gp && gp.buttons[0] && gp.buttons[0].pressed);
    if (confirm && !this.padConfirmHeld && this.onAction) this.onAction('confirm');
    this.padConfirmHeld = confirm;
    for (const gp of pads) {
      if (!gp || gp.axes.length < 2) continue;
      const x = gp.axes[0], y = gp.axes[1];
      if (Math.hypot(x, y) > 0.15) { this.padTilt.x = clamp1(x); this.padTilt.y = clamp1(-y); return; }
    }
  }

  pollXR(xrSession) {
    this.xrTilt.x = this.xrTilt.y = 0;
    if (!xrSession) return false;
    let confirm = false;
    for (const src of xrSession.inputSources) {
      const gp = src.gamepad;
      if (!gp) continue;
      const ax = gp.axes || [];
      const [x, y] = (ax.length >= 4 && Math.hypot(ax[2], ax[3]) > 0.15) ? [ax[2], ax[3]] : [ax[0] || 0, ax[1] || 0];
      if (Math.hypot(x, y) > 0.15) { this.xrTilt.x = clamp1(x); this.xrTilt.y = clamp1(-y); }
      if (gp.buttons[4] && gp.buttons[4].pressed) confirm = true; // A / X
    }
    return confirm;
  }

  /* ---------- Combine ---------- */
  update(dt) {
    // Keyboard ramps toward full tilt so a tap gives a gentle nudge
    const kx = (this.keys.right ? 1 : 0) - (this.keys.left ? 1 : 0);
    const ky = (this.keys.up ? 1 : 0) - (this.keys.down ? 1 : 0);
    const ramp = Math.min(1, dt * 4);
    this.keyTilt.x += (kx - this.keyTilt.x) * ramp;
    this.keyTilt.y += (ky - this.keyTilt.y) * ramp;
    if (!kx && Math.abs(this.keyTilt.x) < 0.01) this.keyTilt.x = 0;
    if (!ky && Math.abs(this.keyTilt.y) < 0.01) this.keyTilt.y = 0;
    this.pollGamepads();

    if (this.drag) {
      const r = this.dragRadius;
      this.set(clamp1((this.drag.x - this.drag.x0) / r), clamp1(-(this.drag.y - this.drag.y0) / r), 'touch');
    } else if (kx || ky || this.keyTilt.x || this.keyTilt.y) {
      this.set(this.keyTilt.x, this.keyTilt.y, 'keys');
    } else if (this.xrTilt.x || this.xrTilt.y) {
      this.set(this.xrTilt.x, this.xrTilt.y, 'vr');
    } else if (this.padTilt.x || this.padTilt.y) {
      this.set(this.padTilt.x, this.padTilt.y, 'pad');
    } else if (this.gyroEnabled && this.gyroLive && this.gyroBase) {
      this.set(this.gyroTilt.x, this.gyroTilt.y, 'gyro');
    } else {
      this.set(0, 0, this.gyroEnabled && this.gyroLive ? 'gyro' : 'none');
    }
    return this.tilt;
  }

  set(x, y, src) {
    // Clamp to the unit disc so diagonals are not stronger than straight tilts
    const len = Math.hypot(x, y);
    if (len > 1) { x /= len; y /= len; }
    this.tilt.x = x; this.tilt.y = y; this.source = src;
  }

  resetManual() {
    this.keys.left = this.keys.right = this.keys.up = this.keys.down = false;
    this.keyTilt.x = this.keyTilt.y = 0;
    this.drag = null;
    this.hideJoy();
  }
}
