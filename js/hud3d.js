/* ==========================================================================
   3D LABYRINTH - IN-SCENE HUD
   Drawn into canvas textures on planes parented to the camera and placed on
   the stereo focal plane (zero parallax), so it reads in every mode: both SBS
   halves, anaglyph, smart glasses and WebXR.
   ========================================================================== */

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
    camera.add(this.bar.mesh, this.banner.mesh);
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
  }

  setStatus({ level, captured, total, balls, time, timeLimit, falls, source }) {
    const remaining = timeLimit ? Math.max(0, timeLimit - time) : time;
    const t = Math.ceil(remaining);
    const key = `${level}|${balls.join('')}|${t}|${falls}|${source}`;
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
      const x = 230 + i * 70, y = H / 2;
      g.beginPath(); g.arc(x, y, 24, 0, Math.PI * 2);
      if (st === 'captured') { g.fillStyle = BALL_CSS[i]; g.fill(); }
      else { g.lineWidth = 6; g.strokeStyle = st === 'roll' ? BALL_CSS[i] : 'rgba(148,163,184,0.4)'; g.stroke(); }
    });

    g.textAlign = 'center';
    const mm = Math.floor(t / 60), ss = String(t % 60).padStart(2, '0');
    const urgent = timeLimit && remaining <= 10;
    g.fillStyle = urgent ? '#ff3b5c' : '#e2e8f0';
    g.fillText(`${timeLimit ? '⏳' : '⏱'} ${mm}:${ss}`, 610, H / 2 + 2);

    g.textAlign = 'right';
    g.fillStyle = falls ? '#fca5a5' : '#94a3b8';
    g.fillText(`⬇${falls}`, 880, H / 2 + 2);
    g.font = '700 40px system-ui, sans-serif';
    g.fillStyle = '#64748b';
    g.fillText({ gyro: '📱', touch: '👆', keys: '⌨', pad: '🎮', vr: '🥽' }[source] || '', 990, H / 2 + 2);
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

  setVisible(v) { this.bar.mesh.visible = v; if (!v) this.hideBanner(); }

  update(dt) {
    if (this.bannerTimer > 0) {
      this.bannerTimer -= dt;
      if (this.bannerTimer <= 0) this.hideBanner();
    }
  }
}
