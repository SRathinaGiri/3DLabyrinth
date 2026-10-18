/* ==========================================================================
   3D LABYRINTH - UI MANAGER (menus, modals, settings persistence)
   ========================================================================== */

import { BOARD_SURFACES, BALL_TYPES, PHYS, LIVES, APPLE, surfacePhysics, timePace } from './config.js';
import { buildLevel } from './maze.js';

const SETTINGS_KEY = '3d_labyrinth_settings';
const VIEW_LABEL = { AUTO: '🎥 View: Auto', OVERVIEW: '🗺️ View: Whole board', FOLLOW: '🎯 View: Follow balls', INSIDE: '🧍 View: Inside · 1 ball' };

const $ = id => document.getElementById(id);

function fmtTime(t) {
  const s = Math.round(t);
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}

export class UIManager {
  constructor(app) {
    this.app = app;
    this.modals = ['pauseScreen']; // only the settings sheet; game messages are 3D panels
    this.bindButtons();
    this.bindStereo();
    this.bindControlSettings();
    this.buildLookPickers();
    this.loadSettings();
    this.setupInstall();
  }

  /* ---------- Install as an app ---------- */
  /**
   * Chrome/Edge/Android fire beforeinstallprompt once the PWA is installable: keep it and offer
   * our own button + banner. iOS never fires it, so there we show the Add-to-Home-Screen steps.
   */
  setupInstall() {
    const standalone = window.matchMedia('(display-mode: standalone)').matches || navigator.standalone === true;
    if (standalone) return; // already running as the installed app
    const isIOS = /iPad|iPhone|iPod/.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
    let deferred = null;
    const dismissedKey = '3d_labyrinth_install_dismissed';
    const show = () => {
      if ($('installBtn')) $('installBtn').style.display = 'inline-flex';
      let dismissed = false;
      try { dismissed = localStorage.getItem(dismissedKey) === '1'; } catch (_) { /* storage blocked */ }
      if (!dismissed) $('installBanner').classList.remove('hidden');
    };
    const hide = () => {
      if ($('installBtn')) $('installBtn').style.display = 'none';
      $('installBanner').classList.add('hidden');
    };
    const install = async () => {
      if (deferred) {
        deferred.prompt();
        const { outcome } = await deferred.userChoice;
        deferred = null;
        if (outcome === 'accepted') hide();
      } else if (isIOS) {
        $('iosInstallHelp').classList.remove('hidden');
      }
    };
    window.addEventListener('beforeinstallprompt', e => { e.preventDefault(); deferred = e; show(); });
    window.addEventListener('appinstalled', hide);
    this.on('installBtn', install);
    this.on('installBannerBtn', install);
    this.on('closeInstallBtn', () => {
      $('installBanner').classList.add('hidden');
      try { localStorage.setItem(dismissedKey, '1'); } catch (_) { /* storage blocked */ }
    });
    this.on('closeIosHelpBtn', () => $('iosInstallHelp').classList.add('hidden'));
    if (isIOS) show();
  }

  on(id, fn) {
    const el = $(id);
    if (el) el.addEventListener('click', e => { e.preventDefault(); this.app.audio.ensureContext(); fn(e); });
  }

  bindButtons() {
    const a = this.app;
    this.on('playBtn', () => a.startLevel(a.progress.unlocked));
    this.on('gamePauseBtn', () => a.togglePause());
    this.on('gameStopBtn', () => a.stopGame());
    this.on('gameRestartBtn', () => a.handleAction('restart'));
    this.on('gameCalibrateBtn', () => a.calibrate());
    this.on('resumeBtn', () => a.togglePause());
    this.on('settingsBackBtn', () => this.hideModals()); // back to the 3D pause panel
    this.on('resetProgressBtn', () => {
      if (!confirm('Reset all level progress and best times?')) return;
      a.progress = { unlocked: 1, best: {}, lives: LIVES.START, apples: {} };
      try { localStorage.removeItem('3d_labyrinth_progress'); } catch (_) { /* storage blocked */ }
      this.renderLevelGrid();
    });
    ['audioToggle', 'gameAudioBtn'].forEach(id => this.on(id, () => this.toggleMute()));
    ['gyroToggle', 'gameGyroBtn'].forEach(id => this.on(id, () => this.toggleGyro()));
    ['viewModeBtn', 'gameViewBtn'].forEach(id => this.on(id, () => this.setViewMode(a.cycleViewMode())));
    this.on('helpBtn', () => { $('infoDrawer').classList.remove('hidden'); });
    this.on('closeInfoBtn', () => { $('infoDrawer').classList.add('hidden'); });
  }

  bindStereo() {
    document.querySelectorAll('.mode-btn').forEach(btn => {
      btn.addEventListener('click', e => {
        e.preventDefault();
        this.setStereoMode(btn.dataset.mode);
        this.saveSettings();
      });
    });
    this.bindSliderPair('.depth-slider', '.depth-val', v => { this.app.depth = v; }, v => v.toFixed(2));
    this.bindSliderPair('.focus-slider', '.focus-val', v => { this.app.focusOffset = v / 100; }, v => `${v > 0 ? '+' : ''}${v.toFixed(0)}%`);
    document.querySelectorAll('.swap-btn').forEach(btn => btn.addEventListener('click', e => {
      e.preventDefault();
      this.app.renderer.swapEyes = !this.app.renderer.swapEyes;
      this.syncSwap();
      this.saveSettings();
    }));
  }

  bindSliderPair(sliderSel, valSel, apply, fmt) {
    const sliders = document.querySelectorAll(sliderSel), vals = document.querySelectorAll(valSel);
    const set = v => {
      sliders.forEach(s => { s.value = v; });
      vals.forEach(el => { el.textContent = fmt(v); });
      apply(v);
    };
    sliders.forEach(s => s.addEventListener('input', () => { set(parseFloat(s.value)); this.saveSettings(); }));
    this[`set_${sliderSel}`] = set;
    return set;
  }

  bindControlSettings() {
    const c = this.app.controls;
    this.bindSliderPair('.sens-slider', '.sens-val', v => { c.gyroSensitivity = v; }, v => `${v.toFixed(0)}°`);
    this.on('invertYBtn', () => { c.invertY = !c.invertY; this.syncInvert(); this.saveSettings(); });
  }

  /* ---------- Board surface & ball type ---------- */
  buildLookPickers() {
    const make = (hostId, table, key) => {
      const host = $(hostId);
      if (!host) return;
      for (const [id, t] of Object.entries(table)) {
        const b = document.createElement('button');
        b.className = 'look-btn';
        b.dataset[key] = id;
        b.setAttribute('role', 'radio');
        b.title = t.desc;
        b.textContent = `${t.icon} ${t.name}`;
        b.addEventListener('click', e => { e.preventDefault(); this.setLook({ [key]: id }); this.saveSettings(); });
        host.appendChild(b);
      }
    };
    make('boardSelector', BOARD_SURFACES, 'board');
    make('ballSelector', BALL_TYPES, 'ball');
  }

  setLook(change) {
    const look = this.app.look;
    Object.assign(look, change);
    if (!BOARD_SURFACES[look.board]) look.board = 'neon';
    if (!BALL_TYPES[look.ball]) look.ball = 'plastic';
    document.querySelectorAll('.look-btn').forEach(b => {
      const on = b.dataset.board ? b.dataset.board === look.board : b.dataset.ball === look.ball;
      b.classList.toggle('active', on);
      b.setAttribute('aria-checked', on);
    });
    // 1-5 meters on log scales spanning the extremes of the material table
    const s = surfacePhysics(look.board, look.ball);
    const meter = (v, lo, hi) => {
      const n = Math.max(1, Math.min(5, Math.round(1 + 4 * (Math.log(v) - Math.log(lo)) / (Math.log(hi) - Math.log(lo)))));
      return `<span class="meter">${'●'.repeat(n)}<span class="off">${'●'.repeat(5 - n)}</span></span>`;
    };
    const grip = s.damping / PHYS.DAMPING, speed = s.accel * s.maxSpeed / PHYS.MAX_SPEED / Math.sqrt(grip);
    const pace = timePace(s);
    const stats = $('lookStats');
    if (stats) stats.innerHTML =
      `<span>Grip</span>${meter(grip, 0.22, 2.72)}` +
      `<span>Bounce</span>${meter(s.wallRestitution, 0.19, 0.92)}` +
      `<span>Speed</span>${meter(speed, 0.5, 3.4)}` +
      `<span class="desc">${BOARD_SURFACES[look.board].icon} ${BOARD_SURFACES[look.board].desc}. ` +
      `${BALL_TYPES[look.ball].icon} ${BALL_TYPES[look.ball].desc}.` +
      (pace > 1.01 ? ` Timer +${Math.round((pace - 1) * 100)}% for this slower pairing.` : '') + '</span>';
  }

  setStereoMode(mode) {
    document.querySelectorAll('.mode-btn').forEach(b => b.classList.toggle('active', b.dataset.mode === mode));
    this.app.renderer.setMode(mode);
  }

  syncSwap() { document.querySelectorAll('.swap-btn').forEach(b => b.classList.toggle('active', this.app.renderer.swapEyes)); }
  syncInvert() { const b = $('invertYBtn'); if (b) { b.classList.toggle('active', this.app.controls.invertY); b.textContent = `↕️ Invert tilt: ${this.app.controls.invertY ? 'ON' : 'OFF'}`; } }

  toggleMute() {
    const m = this.app.audio.toggleMute();
    if (!m && this.app.state !== 'MENU') this.app.audio.startMusic();
    this.syncMute();
    this.saveSettings();
  }

  syncMute() {
    const m = this.app.audio.muted;
    if ($('audioToggle')) $('audioToggle').textContent = m ? '🔇 Muted' : '🔊 Sound';
    if ($('gameAudioBtn')) { $('gameAudioBtn').textContent = m ? '🔇' : '🔊'; $('gameAudioBtn').classList.toggle('active', m); }
  }

  async toggleGyro() {
    const c = this.app.controls;
    if (c.gyroEnabled) { c.disableGyro(); c.gyroWanted = false; this.syncGyro(false); }
    else {
      c.gyroWanted = true;
      const ok = await c.enableGyro();
      if (!ok) alert('Motion sensor not available or permission denied. Use drag gesture, arrow keys or a gamepad.');
      this.syncGyro(ok);
    }
    this.saveSettings();
  }

  syncGyro(on) {
    const want = this.app.controls.gyroWanted;
    const label = on ? 'Gyro: ON' : (want ? 'Gyro: AUTO' : 'Gyro: OFF');
    if ($('gyroBadge')) $('gyroBadge').textContent = label;
    $('gyroToggle') && $('gyroToggle').classList.toggle('active', on || want);
    $('gameGyroBtn') && $('gameGyroBtn').classList.toggle('active', on);
  }

  /** silent = apply without asking the game to restart (used when cancelling a switch). */
  setViewMode(mode, silent = false) {
    const prev = this.app.viewMode;
    this.app.viewMode = mode;
    if ($('viewModeBtn')) $('viewModeBtn').textContent = VIEW_LABEL[mode];
    if ($('gameViewBtn')) { $('gameViewBtn').title = VIEW_LABEL[mode]; $('gameViewBtn').textContent = mode === 'INSIDE' ? '🧍' : '🎥'; }
    this.saveSettings();
    if (!silent && !this.loading && prev !== mode) this.app.viewChanged(prev);
  }

  renderLevelGrid() {
    const grid = $('levelGrid');
    const p = this.app.progress;
    if ($('playBtn')) $('playBtn').textContent = p.unlocked > 1 ? `▶ Continue · Level ${p.unlocked}` : '▶ Play Level 1';
    if ($('livesInfo')) $('livesInfo').textContent = `❤ ${p.lives} ${p.lives === 1 ? 'life' : 'lives'} · +1 for each new level cleared`;
    if (!grid) return;
    grid.innerHTML = '';
    for (let n = 1; n <= p.unlocked; n++) {
      const b = document.createElement('button');
      b.className = 'level-btn' + (n === p.unlocked ? ' current' : '');
      const best = p.best[n];
      // 🍎 = this level still has an unclaimed bonus life
      const apple = n >= APPLE.FROM_LEVEL && !p.apples[n] && buildLevel(n).apples.length > 0;
      b.innerHTML = `<span class="lv">${n}${apple ? '<span class="ap">🍎</span>' : ''}</span><span class="st">${best ? '★'.repeat(best.stars) + '☆'.repeat(3 - best.stars) : '···'}</span>`;
      if (apple) b.title += ' · bonus apple waiting';
      b.title = best ? `Level ${n} · best ${fmtTime(best.time)}` : `Level ${n}`;
      b.addEventListener('click', e => { e.preventDefault(); this.app.startLevel(n); });
      grid.appendChild(b);
    }
  }

  showMenuPage() {
    $('gamePage').classList.add('hidden');
    $('menuPage').classList.remove('hidden');
    this.hideModals();
    this.renderLevelGrid();
  }

  showGamePage() {
    $('menuPage').classList.add('hidden');
    $('gamePage').classList.remove('hidden');
    this.hideModals();
  }

  showModal(id) { this.hideModals(); $(id).classList.remove('hidden'); }
  hideModals() { this.modals.forEach(id => $(id) && $(id).classList.add('hidden')); }

  showUpdatePrompt(worker) {
    const banner = $('updateBanner');
    banner.classList.remove('hidden');
    $('installUpdateBtn').onclick = () => { $('installUpdateBtn').textContent = '⏳ Updating...'; worker.postMessage({ type: 'SKIP_WAITING' }); };
    $('closeUpdateBtn').onclick = () => banner.classList.add('hidden');
  }

  saveSettings() {
    if (this.loading) return;
    const a = this.app;
    const s = {
      mode: a.renderer.mode,
      depth: a.depth,
      focus: Math.round(a.focusOffset * 100),
      swapEyes: a.renderer.swapEyes,
      viewMode: a.viewMode,
      muted: a.audio.muted,
      gyroWanted: a.controls.gyroWanted,
      gyroSensitivity: a.controls.gyroSensitivity,
      invertY: a.controls.invertY,
      mapOn: a.mapOn,
      board: a.look.board,
      ball: a.look.ball
    };
    try { localStorage.setItem(SETTINGS_KEY, JSON.stringify(s)); } catch (_) { /* storage blocked */ }
  }

  loadSettings() {
    this.loading = true;
    let s = {};
    try { s = JSON.parse(localStorage.getItem(SETTINGS_KEY) || '{}') || {}; } catch (_) { s = {}; }
    const a = this.app;
    this.setStereoMode(s.mode || '2d');
    this['set_.depth-slider'](typeof s.depth === 'number' ? s.depth : 1.0);
    this['set_.focus-slider'](typeof s.focus === 'number' ? s.focus : 0);
    this['set_.sens-slider'](typeof s.gyroSensitivity === 'number' ? s.gyroSensitivity : 20);
    a.renderer.swapEyes = !!s.swapEyes; this.syncSwap();
    a.controls.invertY = !!s.invertY; this.syncInvert();
    a.mapOn = s.mapOn !== false; // default on
    if (s.muted && !a.audio.muted) a.audio.toggleMute();
    this.syncMute();
    a.controls.gyroWanted = s.gyroWanted !== false; // default ON
    this.syncGyro(false);
    this.setViewMode(s.viewMode || 'AUTO');
    this.setLook({ board: s.board || 'neon', ball: s.ball || 'plastic' });
    this.loading = false;
  }
}
