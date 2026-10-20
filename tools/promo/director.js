/* Promo-video director: injected into index.html by capture.py.
   Stops the real-time loop and steps the game on a virtual 30 fps clock, so every frame is
   rendered at full quality however slow the capture machine is. An autopilot (same steering as
   tests/solvable.test.mjs) plays; the shot list switches views/stereo modes and adds captions. */
(() => {
  const FPS = 30, DEG = Math.PI / 180, CELL = 2.0;
  let KP = 6, KD = 2.8; // PD steering gains (bot in tests uses 6 / 3.2: careful)
  const app = window.app;
  app.renderer.renderer.setAnimationLoop(null);
  app.audio.muted = true;

  let vt = 1000, frame = 0, shotIdx = -1, shotFrame = 0;
  const bot = { x: 0, y: 0, ball: null, tgt: null, committed: null };
  app.controls.update = () => { app.controls.set(bot.x, bot.y, 'gyro'); return app.controls.tilt; };

  // ---------- caption + end-card overlay (plain DOM over the canvas) ----------
  const css = document.createElement('style');
  css.textContent = `
    #promoCap{position:fixed;left:2%;top:50%;transform:translateY(-50%);text-align:left;z-index:9999;padding:.45em 1.1em;
      font:700 30px/1.2 system-ui,Segoe UI,sans-serif;color:#fff;background:rgba(2,6,23,.72);border:2px solid #00f0ff;
      border-radius:14px;text-shadow:0 2px 6px #000;white-space:nowrap;max-width:21%;white-space:normal;opacity:0;transition:none}
    #promoCap small{display:block;font-weight:500;font-size:18px;color:#9fe9ff;margin-top:6px}
    #promoEnd{position:fixed;inset:0;z-index:10000;display:none;flex-direction:column;align-items:center;justify-content:center;
      gap:18px;background:radial-gradient(circle at 50% 40%,#0b2a4a,#020617 70%);color:#fff;font-family:system-ui,Segoe UI,sans-serif;text-align:center}
    #promoEnd h1{margin:0;font-size:84px;letter-spacing:2px;background:linear-gradient(90deg,#ffc93c,#00f0ff,#ff4fa3);
      -webkit-background-clip:text;color:transparent}
    #promoEnd .l{font-size:30px;color:#cfe9ff}
    #promoEnd .u{margin-top:14px;font-size:34px;font-weight:700;color:#34ff9a}
    #promoEnd .s{font-size:22px;color:#8aa4c0}`;
  document.head.appendChild(css);
  const cap = document.createElement('div'); cap.id = 'promoCap'; document.body.appendChild(cap);
  const end = document.createElement('div'); end.id = 'promoEnd'; document.body.appendChild(end);

  // ---------- autopilot: steer the ball nearest the goal, others tag along ----------
  const key = (c, r) => r * app.level.cols + c;
  const cellOf = b => ({
    c: Math.max(0, Math.min(app.level.cols - 1, Math.floor((b.x + app.level.cols * CELL / 2) / CELL))),
    r: Math.max(0, Math.min(app.level.rows - 1, Math.floor((b.z + app.level.rows * CELL / 2) / CELL)))
  });
  const centre = (c, r) => ({ x: c * CELL + CELL / 2 - app.level.cols * CELL / 2, z: r * CELL + CELL / 2 - app.level.rows * CELL / 2 });
  const OPEN = [[0, -1, 1], [1, 0, 2], [0, 1, 4], [-1, 0, 8]]; // N E S W wall bits (maze.js DIRS)
  const nextCell = (c, r) => {
    const L = app.level, d = L.toGoal[key(c, r)];
    for (const [dc, dr, bit] of OPEN) {
      if (L.cells[key(c, r)] & bit) continue;
      const nc = c + dc, nr = r + dr;
      if (nc >= 0 && nr >= 0 && nc < L.cols && nr < L.rows && L.toGoal[key(nc, nr)] === d - 1) return { c: nc, r: nr };
    }
    return null;
  };
  const aimAt = (c, r) => {
    const L = app.level;
    if (c === L.finish.c && r === L.finish.r) return { x: L.goal.x, z: L.goal.z };
    const q = centre(c, r), h = app.physics.holes.find(h => h.kind !== 'side' && Math.hypot(h.x - q.x, h.z - q.z) < 0.7);
    return h ? { x: q.x + (q.x - h.x) * 0.8, z: q.z + (q.z - h.z) * 0.8 } : q;
  };

  function steer() {
    const P = app.physics, L = app.level;
    const rolling = P.balls.filter(b => b.state === 'roll');
    if (!rolling.length || app.state !== 'PLAYING') { bot.x = bot.y = 0; return; }
    const d = b => { const q = cellOf(b); return L.toGoal[key(q.c, q.r)] + Math.hypot(b.x - L.goal.x, b.z - L.goal.z) * 0.01; };
    if (!rolling.includes(bot.ball)) { bot.ball = rolling.reduce((a, b) => (d(b) < d(a) ? b : a)); bot.tgt = null; bot.committed = null; }
    const b = bot.ball, here = cellOf(b);
    // target cell: next step to the goal; advance once close to it, re-plan if knocked elsewhere
    if (!bot.tgt || (bot.tgt.c !== here.c || bot.tgt.r !== here.r) && L.toGoal[key(here.c, here.r)] !== L.toGoal[key(bot.tgt.c, bot.tgt.r)] + 1) {
      bot.tgt = nextCell(here.c, here.r) || here;
    }
    let aim = aimAt(bot.tgt.c, bot.tgt.r);
    if (Math.hypot(aim.x - b.x, aim.z - b.z) < 0.35) { bot.tgt = nextCell(bot.tgt.c, bot.tgt.r) || bot.tgt; aim = aimAt(bot.tgt.c, bot.tgt.r); }
    const gate = P.sliders.find(s => s.c === bot.tgt.c && s.r === bot.tgt.r);
    // Straight corridor ahead with nothing in it: aim further down it so the run looks fluid, not careful
    if (!gate) {
      const busy = q => P.sliders.some(s => s.c === q.c && s.r === q.r) || P.holes.some(h => h.c === q.c && h.r === q.r);
      let q = bot.tgt, dc = q.c - here.c, dr = q.r - here.r;
      for (let k = 0; k < 2 && !busy(q) && (dc || dr); k++) {
        const n = nextCell(q.c, q.r);
        if (!n || n.c - q.c !== dc || n.r - q.r !== dr || busy(n)) break;
        q = n;
      }
      if (q !== bot.tgt) aim = aimAt(q.c, q.r);
    }
    if (gate) {
      // wait in the lane before the gate, dash when it swings to the far side
      const across = gate.moveAxis, along = across === 'x' ? 'z' : 'x';
      const prev = centre(here.c, here.r), after = nextCell(gate.c, gate.r), nx = after ? aimAt(after.c, after.r) : aim;
      const dirA = Math.sign(nx[along] - prev[along]) || 1;
      const pos = { x: b.x, z: b.z };
      const off = across === 'x' ? gate.cx - gate.x : gate.cz - gate.z;
      const opening = off > 0.25 && (across === 'x' ? gate.vx : gate.vz) > 0;
      const waitPt = { [across]: gate[across] - 0.45, [along]: gate[along] - dirA * 0.75 };
      const ready = Math.hypot(pos.x - waitPt.x, pos.z - waitPt.z) < 0.2 && Math.hypot(b.vx, b.vz) < 0.5;
      if (bot.committed !== gate && ready && opening) bot.committed = gate;
      if (bot.committed === gate && (pos[along] - gate[along]) * dirA < -1.0) bot.committed = null;
      aim = bot.committed === gate ? { [across]: gate[across] - 0.45, [along]: gate[along] + dirA * 1.0 } : waitPt;
    }
    const maxTilt = L.params.maxTiltDeg * DEG, g = 26 * (5 / 7) * P.surf.accel;
    const lim = v => Math.max(-maxTilt, Math.min(maxTilt, Math.asin(Math.max(-1, Math.min(1, v / g)))));
    const X = lim(KP * (aim.x - b.x) - KD * b.vx) / maxTilt, Y = lim(-(KP * (aim.z - b.z) - KD * b.vz)) / maxTilt;
    if (app.viewMode === 'INSIDE') {
      // updatePlay rotates input to camera-relative; that rotation is its own inverse
      const fx = Math.sin(app.inside.yaw), fz = -Math.cos(app.inside.yaw);
      bot.x = -fz * X - fx * Y; bot.y = fx * X - fz * Y;
    } else { bot.x = X; bot.y = Y; }
  }

  // ---------- shot list ----------
  const go = (n, view, look) => {
    if (look) Object.assign(app.look, look);
    app.ui.setViewMode(view, true);
    app.startLevel(n);
    clearInterval(app.countdownTimer); // skip the real-time 3-2-1
    app.state = 'PLAYING';
    bot.ball = null;
    const L = app.level;
    app.hud.showBanner(`LEVEL ${n}`, `${L.cols}×${L.rows}` + (L.holes.length ? ' · holes' : '') + (L.params.sliders ? ' · gates' : ''), '#00f0ff', 1.3);
  };
  const stereo = m => app.renderer.setMode(m);
  const caption = (t, s = '') => { cap.innerHTML = t + (s ? `<small>${s}</small>` : ''); cap.style.opacity = t ? 1 : 0; };

  // Fast-forward off camera (physics only, no rendering) until `done()` or `max` frames
  const warm = (done, max) => {
    for (let i = 0; i < max && app.state === 'PLAYING' && !done(); i++) {
      steer(); app.controls.update(); app.updatePlay(1 / FPS);
    }
    app.hud.hideBanner();
  };
  const nearHome = () => app.physics.captured >= 2 &&
    app.physics.balls.some(b => b.state === 'roll' && app.level.toGoal[key(cellOf(b).c, cellOf(b).r)] <= 2);

  const shots = [
    { s: 5.0, cap: ['Tilt to guide three balls home', 'phone gyro · touch · keys · gamepad'], enter() { app.guideOn = false; stereo('2d'); go(6, 'AUTO', { board: 'neon', ball: 'plastic' }); } },
    { s: 2.8, cap: ['Cross-eye 3D', 'also Parallel'], enter() { stereo('cross'); } },
    { s: 2.8, cap: ['Red / cyan anaglyph', ''], enter() { stereo('anaglyph'); } },
    { s: 2.8, cap: ['Smart glasses', 'side-by-side 3D · RayNeo · XREAL'], enter() { stereo('hsbs'); } },
    { s: 4.0, cap: ['Optional route guide', 'green = goal · red = dead end'], enter() { stereo('2d'); app.toggleGuide(); } },
    { s: 4.5, cap: ["Ball's-eye view", 'wood board · steel ball'], enter() { if (app.guideOn) app.toggleGuide(); go(8, 'INSIDE', { board: 'wood', ball: 'metal' }); warm(() => false, 60); } },
    { s: 5.5, cap: ['Bring them all home', 'endless levels · lives · bonus apples'], enter() { go(5, 'AUTO', { board: 'marble', ball: 'rubber' }); warm(nearHome, 9000); } },
    { s: 4.5, endCard: true, enter() {
      caption('');
      end.innerHTML = `<h1>3D LABYRINTH</h1>
        <div class="l">Phone · PC · Smart glasses · Quest VR</div>
        <div class="l">Use your phone as the controller</div>
        <div class="s">Free · plays in the browser · installable · no ads, no tracking</div>
        <div class="u">srathinagiri.github.io/3DLabyrinth</div>`;
      end.style.display = 'flex';
    } }
  ];
  const totalFrames = shots.reduce((n, s) => n + Math.round(s.s * FPS), 0);

  window.__director = {
    totalFrames,
    shotStarts: shots.reduce((a, s) => (a.push((a.at(-1) || 0) + Math.round(s.s * FPS)), a), [0]).slice(0, -1),
    /** Advance one frame; returns false when the film is over. */
    step() {
      if (frame >= totalFrames) return false;
      if (shotIdx < 0 || shotFrame >= Math.round(shots[shotIdx].s * FPS)) {
        shotIdx++; shotFrame = 0;
        const s = shots[shotIdx];
        s.enter();
        if (s.cap) caption(...s.cap);
      }
      if (!shots[shotIdx].endCard) {
        steer();
        vt += 1000 / FPS;
        app.animate(vt);
      }
      frame++; shotFrame++;
      return true;
    },
    /** Tuning aid: play level n for `frames` and report progress (used to pick the hero level). */
    trial(n, frames, view = 'AUTO', kp = KP, kd = KD) {
      KP = kp; KD = kd; go(n, view);
      const d0 = app.level.toGoal[key(app.level.start.c, app.level.start.r)];
      let best = d0;
      for (let i = 0; i < frames && app.state === 'PLAYING'; i++) {
        steer(); vt += 1000 / FPS; app.animate(vt);
        for (const b of app.physics.balls) if (b.state === 'roll') { const q = cellOf(b); best = Math.min(best, app.level.toGoal[key(q.c, q.r)]); }
      }
      return { n, d0, best, home: app.physics.captured, falls: app.physics.falls, state: app.state, gates: app.level.params.sliders, holes: app.level.holes.length };
    },
    status() { return { frame, shot: shotIdx, state: app.state, home: app.physics && app.physics.captured, falls: app.physics && app.physics.falls }; }
  };
})();
