/* ==========================================================================
   3D LABYRINTH - IN-SCENE HUD
   Drawn into canvas textures on planes parented to the camera and placed on
   the stereo focal plane (zero parallax), so it reads in every mode: both SBS
   halves, anaglyph, smart glasses and WebXR.
   ========================================================================== */

import { BOARD } from './config.js';

const MAP_PX = 512;

function makePanel(w, h) {
  const canvas = document.createElement('canvas');
  canvas.width = w; canvas.height = h;
  const tex = new THREE.CanvasTexture(canvas);
  tex.minFilter = THREE.LinearFilter;
  const mat = new THREE.MeshBasicMaterial({ map: tex, transparent: true, depthTest: false, depthWrite: false });
  const mesh = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), mat);
  mesh.renderOrder = 999;
  mesh.frustumCulled = false;
  return { canvas, ctx: canvas.getContext('2d'), tex, mesh, key: '' };
}

function roundRect(g, x, y, w, h, r) {
  g.beginPath();
  g.moveTo(x + r, y); g.arcTo(x + w, y, x + w, y + h, r); g.arcTo(x + w, y + h, x, y + h, r);
  g.arcTo(x, y + h, x, y, r); g.arcTo(x, y, x + w, y, r); g.closePath();
}

const BALL_CSS = ['#ffc93c', '#00f0ff', '#ff4fa3'];

export class HUD3D {
  constructor(camera) {
    this.camera = camera;
    this.bar = makePanel(1024, 128);
    this.banner = makePanel(1024, 512);
    this.banner.mesh.visible = false;
    this.dialog = makePanel(1024, 640);
    this.dialog.mesh.visible = false;
    this.dialog.mesh.renderOrder = 1000;
    this.dialogSpec = null;  // { title, color, big, lines, buttons:[{id,label}], focus }
    this.dialogNdc = { hw: 1, hh: 1 };
    // Minimap (Inside view): static maze layer drawn once per level, composited heading-up each update
    this.map = makePanel(MAP_PX, MAP_PX);
    this.map.mesh.visible = false;
    this.mapLayer = null;
    this.mapTimer = 0;
    // 🗺 toggle icon (Inside view): a tappable 3D button, so it works in every stereo mode
    this.mapBtn = makePanel(128, 128);
    this.mapBtn.mesh.visible = false;
    this.mapBtnNdc = { x: 0, y: 0, hw: 0, hh: 0 };
    this.mapBtnOn = null;
    camera.add(this.bar.mesh, this.banner.mesh, this.dialog.mesh, this.map.mesh, this.mapBtn.mesh);
    this.distance = 10;
    this.bannerTimer = 0;
  }

  /** Fit panels to the eye frustum at the given distance (the focal plane). */
  layout(distance, fovDeg, aspect) {
    this.distance = distance;
    const viewH = 2 * distance * Math.tan((fovDeg * Math.PI / 180) / 2);
    const viewW = viewH * aspect;
    const barW = Math.min(viewW * 0.96, viewH * 1.25), barH = barW / 8;
    this.bar.mesh.scale.set(barW, barH, 1);
    this.bar.mesh.position.set(0, viewH / 2 - barH / 2 - viewH * 0.015, -distance);
    const bW = Math.min(viewW * 0.86, viewH * 1.1);
    this.banner.mesh.scale.set(bW, bW / 2, 1);
    this.banner.mesh.position.set(0, 0, -distance);
    // Map toggle icon top-right under the status bar; minimap just below it
    const mS = Math.min(viewW * 0.4, viewH * 0.34), margin = viewH * 0.02;
    const iS = Math.max(mS * 0.24, viewH * 0.075);
    const iX = viewW / 2 - iS / 2 - margin, iY = viewH / 2 - barH - viewH * 0.03 - iS / 2;
    this.mapBtn.mesh.scale.set(iS, iS, 1);
    this.mapBtn.mesh.position.set(iX, iY, -distance * 0.997);
    this.mapBtnNdc = { x: iX / (viewW / 2), y: iY / (viewH / 2), hw: iS / viewW, hh: iS / viewH };
    this.map.mesh.scale.set(mS, mS, 1);
    this.map.mesh.position.set(viewW / 2 - mS / 2 - margin, iY - iS / 2 - viewH * 0.015 - mS / 2, -distance * 0.998);

    const dW = Math.min(viewW * 0.94, viewH * 1.2), dH = dW * 0.625;
    this.dialog.mesh.scale.set(dW, dH, 1);
    this.dialog.mesh.position.set(0, -viewH * 0.02, -distance * 0.999);
    // Panel extent in NDC (identical for both eyes: it sits on the zero-parallax plane)
    this.dialogNdc = { hw: dW / viewW, hh: dH / viewH, cy: (-viewH * 0.02) / (viewH / 2) };
  }

  /* ---------------- Minimap (Inside view) ---------------- */
  /** Pre-render the maze top-down (north up) for this level. */
  setMap(level) {
    const cv = document.createElement('canvas');
    cv.width = cv.height = MAP_PX;
    const g = cv.getContext('2d'), { CELL } = BOARD;
    const pad = 40, scale = (MAP_PX - pad * 2) / (Math.max(level.cols, level.rows) * CELL);
    const W = level.cols * CELL, H = level.rows * CELL;
    const ox = (MAP_PX - W * scale) / 2, oz = (MAP_PX - H * scale) / 2;
    this.mapXf = { scale, ox, oz, W, H };
    const X = x => ox + (x + W / 2) * scale, Z = z => oz + (z + H / 2) * scale;

    g.fillStyle = 'rgba(15,23,42,0.9)';
    g.fillRect(ox, oz, W * scale, H * scale);
    g.fillStyle = '#7dd3fc';
    for (const w of level.walls) g.fillRect(X(w.minX), Z(w.minZ), Math.max(2, (w.maxX - w.minX) * scale), Math.max(2, (w.maxZ - w.minZ) * scale));
    for (const h of level.holes) {
      g.fillStyle = '#ff3b5c';
      g.beginPath(); g.arc(X(h.x), Z(h.z), Math.max(3, h.r_ * scale), 0, Math.PI * 2); g.fill();
    }
    g.fillStyle = '#ff7a1a';
    for (const sl of level.sliders) g.fillRect(X(sl.x) - CELL * scale * 0.3, Z(sl.z) - CELL * scale * 0.3, CELL * scale * 0.6, CELL * scale * 0.6);
    g.strokeStyle = '#3b82f6'; g.lineWidth = 4;
    g.beginPath(); g.arc(X(level.startPos.x), Z(level.startPos.z), CELL * scale * 0.38, 0, Math.PI * 2); g.stroke();
    g.fillStyle = '#34ff9a';
    g.beginPath(); g.arc(X(level.goal.x), Z(level.goal.z), Math.max(5, level.goal.r_ * scale * 1.2), 0, Math.PI * 2); g.fill();
    this.mapLayer = cv;
    this.mapTimer = 0;
  }

  setMapVisible(v) { this.map.mesh.visible = v && !!this.mapLayer; }

  /** Show the 🗺 toggle (inside view) and draw it lit when the map is on. */
  setMapButton(visible, on) {
    this.mapBtn.mesh.visible = visible;
    if (!visible || on === this.mapBtnOn) return;
    this.mapBtnOn = on;
    const g = this.mapBtn.ctx;
    g.clearRect(0, 0, 128, 128);
    g.fillStyle = on ? 'rgba(0,240,255,0.28)' : 'rgba(2,6,23,0.7)';
    roundRect(g, 6, 6, 116, 116, 26); g.fill();
    g.strokeStyle = on ? '#00f0ff' : 'rgba(148,163,184,0.6)'; g.lineWidth = 6; g.stroke();
    // Folded-map glyph drawn as vectors: emoji rendering on canvas varies across headsets/glasses
    const col = on ? '#e0fbff' : 'rgba(203,213,225,0.6)';
    g.lineJoin = 'round'; g.lineWidth = 6; g.strokeStyle = col;
    g.beginPath();
    g.moveTo(26, 38); g.lineTo(50, 28); g.lineTo(78, 38); g.lineTo(102, 28);
    g.lineTo(102, 90); g.lineTo(78, 100); g.lineTo(50, 90); g.lineTo(26, 100); g.closePath();
    g.stroke();
    g.beginPath(); g.moveTo(50, 28); g.lineTo(50, 90); g.moveTo(78, 38); g.lineTo(78, 100); g.stroke();
    g.fillStyle = on ? '#ffc93c' : 'rgba(255,201,60,0.5)';
    g.beginPath(); g.arc(64, 60, 9, 0, Math.PI * 2); g.fill();
    this.mapBtn.tex.needsUpdate = true;
  }

  /** Eye-local NDC point over the 🗺 icon? */
  hitMapButton(ndcX, ndcY) {
    if (!this.mapBtn.mesh.visible) return false;
    const b = this.mapBtnNdc, pad = 1.25; // slightly generous target for fingers
    return Math.abs(ndcX - b.x) <= b.hw * pad && Math.abs(ndcY - b.y) <= b.hh * pad;
  }

  /** Redraw ~12x/s: maze rotated so the camera's forward direction points up, ball at its true spot. */
  updateMap(ball, dir, dt) {
    if (!this.map.mesh.visible || !this.mapLayer) return;
    this.mapTimer -= dt;
    if (this.mapTimer > 0) return;
    this.mapTimer = 1 / 12;
    const g = this.map.ctx, S = MAP_PX, c = S / 2, { scale, ox, oz, W, H } = this.mapXf;
    g.clearRect(0, 0, S, S);
    g.fillStyle = 'rgba(2,6,23,0.72)';
    roundRect(g, 4, 4, S - 8, S - 8, 40); g.fill();
    g.strokeStyle = 'rgba(0,240,255,0.55)'; g.lineWidth = 5; g.stroke();
    g.save();
    roundRect(g, 10, 10, S - 20, S - 20, 34); g.clip();
    // Heading-up: rotate so dir (board x,z) maps to screen up. 90-degree steps keep the square map inside the panel.
    g.translate(c, c);
    g.rotate(-Math.PI / 2 - Math.atan2(dir[1], dir[0]));
    g.translate(-c, -c);
    g.drawImage(this.mapLayer, 0, 0);
    const bx = ox + (ball.x + W / 2) * scale, bz = oz + (ball.z + H / 2) * scale;
    // View cone
    const ang = Math.atan2(dir[1], dir[0]), len = 95;
    const grad = g.createRadialGradient(bx, bz, 4, bx, bz, len);
    grad.addColorStop(0, 'rgba(255,201,60,0.55)'); grad.addColorStop(1, 'rgba(255,201,60,0)');
    g.fillStyle = grad;
    g.beginPath(); g.moveTo(bx, bz); g.arc(bx, bz, len, ang - 0.6, ang + 0.6); g.closePath(); g.fill();
    // Ball
    g.fillStyle = '#ffc93c'; g.strokeStyle = '#ffffff'; g.lineWidth = 3;
    g.beginPath(); g.arc(bx, bz, Math.max(11, BOARD.BALL_R * scale * 1.8), 0, Math.PI * 2); g.fill(); g.stroke();
    g.restore();
    this.map.tex.needsUpdate = true;
  }

  /* ---------------- 3D dialogs (level clear, time's up, pause...) ---------------- */
  get dialogVisible() { return this.dialog.mesh.visible; }

  showDialog(spec) {
    this.dialogSpec = { focus: 0, lines: [], ...spec };
    this.dialog.mesh.visible = true;
    this.hideBanner();
    this.drawDialog();
  }

  hideDialog() { this.dialog.mesh.visible = false; this.dialogSpec = null; }

  moveFocus(delta) {
    const d = this.dialogSpec;
    if (!d) return;
    d.focus = (d.focus + delta + d.buttons.length) % d.buttons.length;
    this.drawDialog();
  }

  setFocus(i) {
    if (!this.dialogSpec || i < 0 || i === this.dialogSpec.focus) return;
    this.dialogSpec.focus = i;
    this.drawDialog();
  }

  focusedAction() { const d = this.dialogSpec; return d ? d.buttons[d.focus].id : null; }

  /** Map an eye-local NDC point to a dialog button index (-1 = none). */
  hitIndex(ndcX, ndcY) {
    const d = this.dialogSpec;
    if (!d) return -1;
    const { hw, hh, cy } = this.dialogNdc;
    const u = (ndcX / hw + 1) / 2, v = (1 - (ndcY - cy) / hh) / 2;
    if (u < 0 || u > 1 || v < 0 || v > 1) return -1;
    const px = u * 1024, py = v * 640;
    return d.buttons.findIndex(b => px >= b.x && px <= b.x + b.w && py >= b.y && py <= b.y + b.h);
  }

  drawDialog() {
    const d = this.dialogSpec, g = this.dialog.ctx, W = 1024, H = 640;
    g.clearRect(0, 0, W, H);
    g.fillStyle = 'rgba(2,6,23,0.88)';
    roundRect(g, 8, 8, W - 16, H - 16, 44); g.fill();
    g.strokeStyle = d.color || '#00f0ff'; g.lineWidth = 6; g.stroke();
    g.textAlign = 'center'; g.textBaseline = 'middle';
    g.fillStyle = d.color || '#00f0ff';
    g.font = `900 ${d.title.length > 14 ? 74 : 92}px system-ui, sans-serif`;
    g.fillText(d.title, W / 2, 100);
    let y = 190;
    if (d.big) {
      g.fillStyle = '#ffc93c'; g.font = '900 96px system-ui, sans-serif';
      g.fillText(d.big, W / 2, y + 10); y += 100;
    }
    g.fillStyle = '#e2e8f0'; g.font = '600 42px system-ui, sans-serif';
    for (const line of d.lines) { g.fillText(line, W / 2, y); y += 56; }

    const n = d.buttons.length, gap = 26, bw = (W - 80 - gap * (n - 1)) / n, bh = 104, by = H - bh - 44;
    d.buttons.forEach((b, i) => {
      Object.assign(b, { x: 40 + i * (bw + gap), y: by, w: bw, h: bh });
      roundRect(g, b.x, b.y, b.w, b.h, 26);
      g.fillStyle = i === 0 ? (d.color || '#00f0ff') : 'rgba(255,255,255,0.12)';
      g.fill();
      if (i === d.focus) { g.strokeStyle = '#ffffff'; g.lineWidth = 8; g.stroke(); }
      g.fillStyle = i === 0 ? '#020617' : '#f8fafc';
      let size = 46;
      do { g.font = `800 ${size}px system-ui, sans-serif`; size -= 2; } while (size > 22 && g.measureText(b.label).width > b.w - 28);
      g.fillText(b.label, b.x + b.w / 2, b.y + b.h / 2 + 2);
    });
    this.dialog.tex.needsUpdate = true;
  }

  setStatus({ level, balls, time, timeLimit, falls, lives, source }) {
    const remaining = timeLimit ? Math.max(0, timeLimit - time) : time;
    const t = Math.ceil(remaining);
    const key = `${level}|${balls.join('')}|${t}|${falls}|${lives}|${source}`;
    if (key === this.bar.key) return;
    this.bar.key = key;
    const g = this.bar.ctx, W = 1024, H = 128;
    g.clearRect(0, 0, W, H);
    g.fillStyle = 'rgba(2,6,23,0.72)';
    roundRect(g, 4, 8, W - 8, H - 16, 36); g.fill();
    g.strokeStyle = 'rgba(0,240,255,0.55)'; g.lineWidth = 3; g.stroke();
    g.font = '800 54px system-ui, sans-serif';
    g.textBaseline = 'middle';
    g.fillStyle = '#e2e8f0';
    g.textAlign = 'left';
    g.fillText(`L${level}`, 34, H / 2 + 2);

    // Ball tray: filled = home, ring = still in play, dim = in a hole
    balls.forEach((st, i) => {
      const x = 190 + i * 64, y = H / 2;
      g.beginPath(); g.arc(x, y, 24, 0, Math.PI * 2);
      if (st === 'captured') { g.fillStyle = BALL_CSS[i]; g.fill(); }
      else { g.lineWidth = 6; g.strokeStyle = st === 'roll' || st === 'hop' ? BALL_CSS[i] : 'rgba(148,163,184,0.4)'; g.stroke(); }
    });

    g.textAlign = 'center';
    const mm = Math.floor(t / 60), ss = String(t % 60).padStart(2, '0');
    const urgent = timeLimit && remaining <= 10;
    g.fillStyle = urgent ? '#ff3b5c' : '#e2e8f0';
    g.fillText(`${timeLimit ? '⏳' : '⏱'} ${mm}:${ss}`, 540, H / 2 + 2);

    g.textAlign = 'right';
    g.fillStyle = falls ? '#fca5a5' : '#94a3b8';
    g.fillText(`⬇${falls}`, 790, H / 2 + 2);
    g.fillStyle = lives ? '#ff4f7a' : '#64748b';
    g.fillText(`❤${lives}`, 925, H / 2 + 2);
    g.font = '700 40px system-ui, sans-serif';
    g.fillStyle = '#64748b';
    g.fillText({ gyro: '📱', touch: '👆', keys: '⌨', pad: '🎮', vr: '🥽' }[source] || '', 1000, H / 2 + 2);
    this.bar.tex.needsUpdate = true;
  }

  showBanner(title, sub = '', color = '#00f0ff', seconds = 0) {
    const key = `${title}|${sub}|${color}`;
    this.banner.mesh.visible = true;
    this.bannerTimer = seconds;
    if (key === this.banner.key) return;
    this.banner.key = key;
    const g = this.banner.ctx, W = 1024, H = 512;
    g.clearRect(0, 0, W, H);
    g.fillStyle = 'rgba(2,6,23,0.6)';
    roundRect(g, 40, 90, W - 80, H - 180, 48); g.fill();
    g.strokeStyle = color; g.lineWidth = 5; g.stroke();
    g.textAlign = 'center'; g.textBaseline = 'middle';
    g.fillStyle = color;
    g.font = `900 ${title.length > 8 ? 96 : 150}px system-ui, sans-serif`;
    g.fillText(title, W / 2, sub ? H / 2 - 30 : H / 2);
    if (sub) {
      g.fillStyle = '#e2e8f0';
      g.font = '600 46px system-ui, sans-serif';
      g.fillText(sub, W / 2, H / 2 + 80);
    }
    this.banner.tex.needsUpdate = true;
  }

  hideBanner() { this.banner.mesh.visible = false; this.bannerTimer = 0; }

  setVisible(v) { this.bar.mesh.visible = v; if (!v) { this.hideBanner(); this.hideDialog(); this.setMapVisible(false); this.setMapButton(false); } }

  update(dt) {
    if (this.bannerTimer > 0) {
      this.bannerTimer -= dt;
      if (this.bannerTimer <= 0) this.hideBanner();
    }
  }
}
