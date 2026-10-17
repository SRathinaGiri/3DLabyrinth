/* ==========================================================================
   3D LABYRINTH - PROCEDURAL MATERIALS (board surfaces, balls, reflections)
   Every texture is drawn on a canvas at runtime: no image files, fully offline.
   ========================================================================== */

const NEON_PALETTES = [
  { floor: '#0b1530', line: 'rgba(0,240,255,0.16)', wall: 0x1e293b, edge: 0x00f0ff, bg: 0x020617 },
  { floor: '#1a0b2e', line: 'rgba(236,72,153,0.18)', wall: 0x2a1740, edge: 0xec4899, bg: 0x07020f },
  { floor: '#06231d', line: 'rgba(52,211,153,0.18)', wall: 0x123129, edge: 0x34d399, bg: 0x010a07 },
  { floor: '#2a1606', line: 'rgba(245,158,11,0.20)', wall: 0x3a2412, edge: 0xf59e0b, bg: 0x0a0501 }
];
export function paletteForLevel(n) { return NEON_PALETTES[Math.floor((n - 1) / 5) % NEON_PALETTES.length]; }

function canvas(w, h) {
  const cv = document.createElement('canvas');
  cv.width = w; cv.height = h;
  return [cv, cv.getContext('2d')];
}

function toTexture(cv, repeat = true) {
  const tex = new THREE.CanvasTexture(cv);
  if (repeat) tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  tex.anisotropy = 4;
  return tex;
}

// Seeded so a given level always looks the same (and both eyes match, which stereo needs anyway)
function rng(seed) {
  let a = seed >>> 0;
  return () => { a = (a + 0x6D2B79F5) >>> 0; let t = Math.imul(a ^ (a >>> 15), a | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}

/* ------------------------------- Floor textures ------------------------------- */

function neonTile(pal) {
  const [cv, g] = canvas(128, 128), r = rng(7);
  g.fillStyle = pal.floor; g.fillRect(0, 0, 128, 128);
  for (let i = 0; i < 260; i++) { g.fillStyle = `rgba(255,255,255,${r() * 0.05})`; g.fillRect(r() * 128, r() * 128, 2, 2); }
  g.strokeStyle = pal.line; g.lineWidth = 3; g.strokeRect(6, 6, 116, 116);
  g.fillStyle = pal.line; g.beginPath(); g.arc(64, 64, 4, 0, Math.PI * 2); g.fill();
  return toTexture(cv);
}

/** Oak planks with grain; tone 0 = light floor, 1 = dark walnut walls. */
function woodPlanks(tone = 0, seed = 11) {
  const [cv, g] = canvas(512, 512), r = rng(seed);
  const bases = tone ? ['#5a3519', '#4d2c14', '#63391b', '#55321a'] : ['#c08a55', '#b57d49', '#c9945e', '#ad7442'];
  const plankW = 64;
  for (let x = 0; x < 512; x += plankW) {
    // Each plank column is split into 1-2 boards with staggered end joints
    const joint = 80 + r() * 350;
    for (const [y0, y1] of [[0, joint], [joint, 512]]) {
      g.fillStyle = bases[Math.floor(r() * bases.length)];
      g.fillRect(x, y0, plankW, y1 - y0);
      // grain: wavy darker lines running along the plank
      for (let k = 0; k < 14; k++) {
        const gx = x + 4 + r() * (plankW - 8), amp = 1 + r() * 3, freq = 0.01 + r() * 0.03, ph = r() * 6;
        g.strokeStyle = `rgba(${tone ? '20,8,2' : '90,50,20'},${0.15 + r() * 0.25})`;
        g.lineWidth = 0.6 + r() * 1.4;
        g.beginPath();
        for (let y = y0; y <= y1; y += 6) g.lineTo(gx + Math.sin(y * freq + ph) * amp, y);
        g.stroke();
      }
      // occasional knot
      if (r() < 0.35) {
        const kx = x + 12 + r() * (plankW - 24), ky = y0 + 20 + r() * Math.max(1, y1 - y0 - 40);
        const grad = g.createRadialGradient(kx, ky, 1, kx, ky, 9);
        grad.addColorStop(0, 'rgba(40,18,5,0.8)'); grad.addColorStop(1, 'rgba(40,18,5,0)');
        g.fillStyle = grad; g.beginPath(); g.ellipse(kx, ky, 6, 11, 0, 0, Math.PI * 2); g.fill();
      }
      g.fillStyle = 'rgba(25,12,4,0.7)'; g.fillRect(x, y0, plankW, 2); // end joint
    }
    g.fillStyle = 'rgba(25,12,4,0.75)'; g.fillRect(x, 0, 2, 512); // plank seam
  }
  return toTexture(cv);
}

function glassTile() {
  const [cv, g] = canvas(128, 128);
  g.fillStyle = '#ffffff'; g.fillRect(0, 0, 128, 128);
  g.strokeStyle = 'rgba(120,200,255,0.9)'; g.lineWidth = 2; g.strokeRect(1, 1, 126, 126);
  g.strokeStyle = 'rgba(160,220,255,0.35)'; g.lineWidth = 1;
  for (let i = 16; i < 128; i += 16) { g.beginPath(); g.moveTo(i, 0); g.lineTo(i, 128); g.moveTo(0, i); g.lineTo(128, i); g.stroke(); }
  return toTexture(cv);
}

/** Polished marble slabs; dark = green-black marble for walls. */
function marbleSlab(dark = false, seed = 5) {
  const [cv, g] = canvas(512, 512), r = rng(seed);
  g.fillStyle = dark ? '#16241e' : '#e2ddd3'; g.fillRect(0, 0, 512, 512);
  // soft clouding
  for (let i = 0; i < 60; i++) {
    const x = r() * 512, y = r() * 512, rad = 20 + r() * 70;
    const grad = g.createRadialGradient(x, y, 0, x, y, rad);
    const c = dark ? '40,70,58' : '170,164,152';
    grad.addColorStop(0, `rgba(${c},0.25)`); grad.addColorStop(1, `rgba(${c},0)`);
    g.fillStyle = grad; g.fillRect(x - rad, y - rad, rad * 2, rad * 2);
  }
  // veins: random walks with a soft glow
  g.lineCap = 'round';
  for (let v = 0; v < (dark ? 9 : 14); v++) {
    let x = r() * 512, y = r() * 512, ang = r() * Math.PI * 2;
    g.strokeStyle = dark ? `rgba(210,230,215,${0.25 + r() * 0.35})` : `rgba(85,85,95,${0.45 + r() * 0.45})`;
    g.lineWidth = 0.6 + r() * 1.8;
    g.shadowColor = g.strokeStyle; g.shadowBlur = 4;
    g.beginPath(); g.moveTo(x, y);
    for (let s = 0; s < 70; s++) { ang += (r() - 0.5) * 0.6; x += Math.cos(ang) * 8; y += Math.sin(ang) * 8; g.lineTo(x, y); }
    g.stroke();
  }
  g.shadowBlur = 0;
  if (!dark) { // slab seams every 128 px = one cell
    g.strokeStyle = 'rgba(150,145,135,0.45)'; g.lineWidth = 1.5;
    for (let i = 0; i <= 512; i += 128) { g.beginPath(); g.moveTo(i, 0); g.lineTo(i, 512); g.moveTo(0, i); g.lineTo(512, i); g.stroke(); }
  }
  return toTexture(cv);
}

/* ---------------------------- Reflection environment ---------------------------- */

/** Studio-style environment so steel balls, glass and marble have something to reflect. */
export function makeEnvironment(renderer) {
  const [cv, g] = canvas(1024, 512);
  const sky = g.createLinearGradient(0, 0, 0, 512);
  sky.addColorStop(0, '#dfeeff'); sky.addColorStop(0.45, '#8a9bb3'); sky.addColorStop(0.55, '#3a4250'); sky.addColorStop(1, '#0d0f14');
  g.fillStyle = sky; g.fillRect(0, 0, 1024, 512);
  // softbox lights give the crisp highlights that sell "metal"
  g.fillStyle = 'rgba(255,255,255,0.95)';
  g.fillRect(140, 60, 160, 70); g.fillRect(620, 40, 220, 60);
  g.fillStyle = 'rgba(255,214,160,0.8)'; g.fillRect(420, 150, 120, 40);
  g.fillStyle = 'rgba(120,220,255,0.6)'; g.fillRect(880, 170, 90, 50);
  const tex = new THREE.CanvasTexture(cv);
  tex.mapping = THREE.EquirectangularReflectionMapping;
  const pmrem = new THREE.PMREMGenerator(renderer);
  const env = pmrem.fromEquirectangular(tex).texture;
  tex.dispose(); pmrem.dispose();
  return env;
}

/* ------------------------------- Board looks ------------------------------- */

/**
 * Build the material set for a board surface.
 * cellsPerTile: how many maze cells one floor texture repeat spans.
 */
export function boardLook(kind, levelN, env) {
  const pal = paletteForLevel(levelN);
  const std = o => new THREE.MeshStandardMaterial(o);
  switch (kind) {
    case 'wood': {
      const floorTex = woodPlanks(0, 11 + levelN), wallTex = woodPlanks(1, 3);
      wallTex.repeat.set(0.5, 0.5);
      return {
        bg: 0x120a05, stars: false, sun: [0xffe2b8, 1.0], hemi: [0xffe9cc, 0x2a1608, 0.6],
        floor: std({ map: floorTex, roughness: 0.72, metalness: 0 }), cellsPerTile: 4,
        side: std({ color: 0x5a3519, roughness: 0.8 }),
        wall: std({ map: wallTex, color: 0xb88a60, roughness: 0.65 }),
        cap: std({ color: 0xe0ad74, roughness: 0.55 }),
        base: std({ color: 0x2b170a, roughness: 0.7 }),
        rim: 0xc0392b, textures: [floorTex, wallTex]
      };
    }
    case 'glass': {
      const floorTex = glassTile();
      return {
        bg: pal.bg, stars: true, sun: [0xffffff, 0.9], hemi: [0xbfe8ff, 0x0a1a2a, 0.7],
        floor: std({ map: floorTex, color: 0xbfefff, transparent: true, opacity: 0.32, roughness: 0.04, metalness: 0.1, envMap: env, envMapIntensity: 1.2, depthWrite: false }),
        cellsPerTile: 1,
        side: std({ color: 0x9fe3ff, transparent: true, opacity: 0.45, roughness: 0.05, envMap: env }),
        wall: std({ color: 0x9fe3ff, emissive: pal.edge, emissiveIntensity: 0.08, transparent: true, opacity: 0.42, roughness: 0.03, metalness: 0.1, envMap: env, envMapIntensity: 1.4 }),
        cap: new THREE.MeshBasicMaterial({ color: pal.edge }),
        base: std({ color: 0x0b1726, roughness: 0.15, metalness: 0.8, envMap: env }),
        rim: 0xff3b5c, glowPits: true, textures: [floorTex]
      };
    }
    case 'marble': {
      const floorTex = marbleSlab(false, 5 + levelN), wallTex = marbleSlab(true, 9);
      wallTex.repeat.set(0.4, 0.4);
      return {
        bg: 0x0b0d14, stars: true, sun: [0xfff6e8, 0.85], hemi: [0xf0f4ff, 0x15151a, 0.45],
        floor: std({ map: floorTex, color: 0xc9c4bb, roughness: 0.22, metalness: 0, envMap: env, envMapIntensity: 0.2 }), cellsPerTile: 4,
        side: std({ color: 0xcfcac0, roughness: 0.3 }),
        wall: std({ map: wallTex, roughness: 0.22, metalness: 0.05, envMap: env, envMapIntensity: 0.6 }),
        cap: std({ color: 0xd4af37, roughness: 0.22, metalness: 1, envMap: env, envMapIntensity: 1.2 }),
        base: std({ color: 0x1a1a1d, roughness: 0.3, metalness: 0.3 }),
        rim: 0xe0303a, textures: [floorTex, wallTex]
      };
    }
    default: {
      const floorTex = neonTile(pal);
      return {
        bg: pal.bg, stars: true, sun: [0xffffff, 0.9], hemi: [0xbfd8ff, 0x10121a, 0.55],
        floor: std({ map: floorTex, roughness: 0.85, metalness: 0.05 }), cellsPerTile: 1,
        side: std({ color: 0x0f172a, roughness: 0.9 }),
        wall: std({ color: pal.wall, roughness: 0.55, metalness: 0.2 }),
        cap: new THREE.MeshBasicMaterial({ color: pal.edge }),
        base: std({ color: 0x0b1020, roughness: 0.6, metalness: 0.4 }),
        rim: 0xff3b5c, textures: [floorTex]
      };
    }
  }
}

/* ---------------------------------- Balls ---------------------------------- */

function hex(c) { return '#' + c.toString(16).padStart(6, '0'); }

/** Plastic: two-tone with a white band and dot, so you can see it roll. */
function plasticSkin(color) {
  const [cv, g] = canvas(256, 128);
  g.fillStyle = hex(color); g.fillRect(0, 0, 256, 128);
  g.fillStyle = '#ffffff'; g.fillRect(0, 54, 256, 20);
  g.beginPath(); g.arc(64, 30, 12, 0, Math.PI * 2); g.arc(192, 98, 12, 0, Math.PI * 2); g.fill();
  return toTexture(cv, false);
}

/** Rubber: matte with a darker swirl seam like a bouncy ball. */
function rubberSkin(color) {
  const [cv, g] = canvas(256, 128);
  const c = new THREE.Color(color);
  g.fillStyle = hex(color); g.fillRect(0, 0, 256, 128);
  g.strokeStyle = `rgb(${c.r * 120 | 0},${c.g * 120 | 0},${c.b * 120 | 0})`;
  g.lineWidth = 7;
  g.beginPath();
  for (let x = 0; x <= 256; x += 4) g.lineTo(x, 64 + Math.sin(x / 256 * Math.PI * 4) * 30);
  g.stroke();
  const r = rng(color);
  for (let i = 0; i < 400; i++) { g.fillStyle = `rgba(0,0,0,${r() * 0.12})`; g.fillRect(r() * 256, r() * 128, 2, 2); }
  return toTexture(cv, false);
}

export function ballMaterial(kind, color, env) {
  switch (kind) {
    case 'metal': {
      // Tinted chrome: still colour-coded, but reads clearly as heavy polished steel
      const tint = new THREE.Color(0xe8e8e8).lerp(new THREE.Color(color), 0.45);
      return new THREE.MeshStandardMaterial({ color: tint, metalness: 1, roughness: 0.12, envMap: env, envMapIntensity: 1.3 });
    }
    case 'rubber':
      return new THREE.MeshStandardMaterial({ map: rubberSkin(color), roughness: 0.88, metalness: 0 });
    default:
      return new THREE.MeshStandardMaterial({ map: plasticSkin(color), roughness: 0.22, metalness: 0, envMap: env, envMapIntensity: 0.5 });
  }
}
