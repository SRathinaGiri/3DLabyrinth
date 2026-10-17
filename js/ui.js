/* ==========================================================================
   3D LABYRINTH - UI MANAGER (menus, modals, settings persistence)
   ========================================================================== */

const SETTINGS_KEY = '3d_labyrinth_settings';
const VIEW_LABEL = { AUTO: '🎥 View: Auto', OVERVIEW: '🗺️ View: Whole board', FOLLOW: '🎯 View: Follow balls' };

const $ = id => document.getElementById(id);

function fmtTime(t) {
  const s = Math.round(t);
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}

export class UIManager {
  constructor(app) {
    this.app = app;
    this.modals = ['pauseScreen', 'completeScreen', 'failedScreen'];
    this.bindButtons();
    this.bindStereo();
    this.bindControlSettings();
    this.loadSettings();
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
    this.on('pauseRestartBtn', () => a.handleAction('restart'));
    this.on('pauseMenuBtn', () => a.stopGame());
    this.on('nextBtn', () => { this.hideModals(); a.startLevel(a.level.n + 1); });
    this.on('replayBtn', () => { this.hideModals(); a.startLevel(a.level.n); });
    this.on('completeMenuBtn', () => a.stopGame());
    this.on('retryBtn', () => { this.hideModals(); a.startLevel(a.level.n); });
    this.on('failedMenuBtn', () => a.stopGame());
    this.on('resetProgressBtn', () => {
      if (!confirm('Reset all level progress and best times?')) return;
      a.progress = { unlocked: 1, best: {} };
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

  setViewMode(mode) {
    this.app.viewMode = mode;
    if ($('viewModeBtn')) $('viewModeBtn').textContent = VIEW_LABEL[mode];
    if ($('gameViewBtn')) $('gameViewBtn').title = VIEW_LABEL[mode];
    this.saveSettings();
  }

  renderLevelGrid() {
    const grid = $('levelGrid');
    const p = this.app.progress;
    if ($('playBtn')) $('playBtn').textContent = p.unlocked > 1 ? `▶ Continue · Level ${p.unlocked}` : '▶ Play Level 1';
    if (!grid) return;
    grid.innerHTML = '';
    for (let n = 1; n <= p.unlocked; n++) {
      const b = document.createElement('button');
      b.className = 'level-btn' + (n === p.unlocked ? ' current' : '');
      const best = p.best[n];
      b.innerHTML = `<span class="lv">${n}</span><span class="st">${best ? '★'.repeat(best.stars) + '☆'.repeat(3 - best.stars) : '···'}</span>`;
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

  showComplete({ n, time, falls, stars, isBest }) {
    $('completeTitle').textContent = `Level ${n} cleared!`;
    $('completeStars').textContent = '★'.repeat(stars) + '☆'.repeat(3 - stars);
    $('completeStats').textContent = `Time ${fmtTime(time)}${isBest ? ' (best!)' : ''} · Falls ${falls}`;
    this.showModal('completeScreen');
    setTimeout(() => $('nextBtn') && $('nextBtn').focus(), 50);
  }

  showFailed({ n, captured }) {
    $('failedStats').textContent = `Level ${n} · ${captured}/3 balls reached the goal`;
    this.showModal('failedScreen');
    setTimeout(() => $('retryBtn') && $('retryBtn').focus(), 50);
  }

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
      invertY: a.controls.invertY
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
    if (s.muted && !a.audio.muted) a.audio.toggleMute();
    this.syncMute();
    a.controls.gyroWanted = s.gyroWanted !== false; // default ON
    this.syncGyro(false);
    this.setViewMode(s.viewMode || 'AUTO');
    this.loading = false;
  }
}
