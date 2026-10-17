/* ==========================================================================
   3D LABYRINTH - BOARD SCENE BUILDER (THREE.js meshes for a level)
   Everything lives under boardGroup, which tilts with the input; physics
   coordinates are board-local so meshes map 1:1 onto physics positions.
   ========================================================================== */

import { BOARD, BALL_COLORS } from './config.js';

const THEMES = [
  { floor: '#0b1530', line: 'rgba(0,240,255,0.16)', wall: 0x1e293b, edge: 0x00f0ff, bg: 0x020617 },
  { floor: '#1a0b2e', line: 'rgba(236,72,153,0.18)', wall: 0x2a1740, edge: 0xec4899, bg: 0x07020f },
  { floor: '#06231d', line: 'rgba(52,211,153,0.18)', wall: 0x123129, edge: 0x34d399, bg: 0x010a07 },
  { floor: '#2a1606', line: 'rgba(245,158,11,0.20)', wall: 0x3a2412, edge: 0xf59e0b, bg: 0x0a0501 }
];

export function themeForLevel(n) { return THEMES[Math.floor((n - 1) / 5) % THEMES.length]; }

function makeTileTexture(theme) {
  const cv = document.createElement('canvas');
  cv.width = cv.height = 128;
  const g = cv.getContext('2d');
  g.fillStyle = theme.floor;
  g.fillRect(0, 0, 128, 128);
  // Fine grain + cell outline: texture gives each eye matching detail to fuse (stronger stereo depth)
  for (let i = 0; i < 260; i++) {
    g.fillStyle = `rgba(255,255,255,${Math.random() * 0.05})`;
    g.fillRect(Math.random() * 128, Math.random() * 128, 2, 2);
  }
  g.strokeStyle = theme.line;
  g.lineWidth = 3;
  g.strokeRect(6, 6, 116, 116);
  g.fillStyle = theme.line;
  g.beginPath(); g.arc(64, 64, 4, 0, Math.PI * 2); g.fill();
  const tex = new THREE.CanvasTexture(cv);
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  tex.anisotropy = 4;
  return tex;
}

export class BoardView {
  constructor(scene) {
    this.scene = scene;
    this.world = new THREE.Group();      // scaled/placed for WebXR, identity otherwise
    this.boardGroup = new THREE.Group(); // tilts
    this.world.add(this.boardGroup);
    scene.add(this.world);

    this.hemi = new THREE.HemisphereLight(0xbfd8ff, 0x10121a, 0.55);
    scene.add(this.hemi);
    this.sun = new THREE.DirectionalLight(0xffffff, 0.9);
    this.sun.castShadow = true;
    this.sun.shadow.mapSize.set(1024, 1024);
    this.sun.shadow.bias = -0.0008;
    this.world.add(this.sun, this.sun.target);

    this.stars = this.makeStars();
    scene.add(this.stars);

    this.ballGeo = new THREE.SphereGeometry(BOARD.BALL_R, 32, 20);
    this.ballMeshes = [];
    this.disposables = [];
    this.sliderMeshes = [];
    this.goalRing = null;
    this.elapsed = 0;
  }

  makeStars() {
    const n = 600, pos = new Float32Array(n * 3);
    for (let i = 0; i < n; i++) {
      const r = 80 + Math.random() * 80, th = Math.random() * Math.PI * 2, ph = Math.acos(Math.random() * 2 - 1);
      pos[i * 3] = r * Math.sin(ph) * Math.cos(th);
      pos[i * 3 + 1] = -Math.abs(r * Math.cos(ph)) * 0.6 - 10;
      pos[i * 3 + 2] = r * Math.sin(ph) * Math.sin(th);
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    return new THREE.Points(g, new THREE.PointsMaterial({ color: 0x8fb4ff, size: 0.5, sizeAttenuation: true }));
  }

  clear() {
    for (const o of [...this.boardGroup.children]) this.boardGroup.remove(o);
    for (const d of this.disposables) d.dispose();
    this.disposables = [];
    this.ballMeshes = [];
    this.sliderMeshes = [];
  }

  track(...items) { this.disposables.push(...items); return items[0]; }

  build(level) {
    this.clear();
    this.level = level;
    const theme = themeForLevel(level.n);
    this.scene.background = new THREE.Color(theme.bg);
    const { CELL, WALL_T, WALL_H, FLOOR_T, HOLE_R, GOAL_R, PIT_DEPTH, BALL_R } = BOARD;
    const W = level.cols * CELL, H = level.rows * CELL;

    // Floor slab with real holes cut out (ExtrudeGeometry keeps hole rims visible in stereo)
    const shape = new THREE.Shape();
    const pad = WALL_T / 2;
    shape.moveTo(-W / 2 - pad, -H / 2 - pad);
    shape.lineTo(W / 2 + pad, -H / 2 - pad);
    shape.lineTo(W / 2 + pad, H / 2 + pad);
    shape.lineTo(-W / 2 - pad, H / 2 + pad);
    shape.lineTo(-W / 2 - pad, -H / 2 - pad);
    const holeList = [...level.holes.map(h => ({ x: h.x, z: h.z, r: HOLE_R, goal: false })),
      { x: level.goal.x, z: level.goal.z, r: GOAL_R, goal: true }];
    for (const h of holeList) {
      const p = new THREE.Path();
      p.absarc(h.x, -h.z, h.r, 0, Math.PI * 2, true); // shape y = -world z after rotateX(-90deg)
      shape.holes.push(p);
    }
    const floorGeo = this.track(new THREE.ExtrudeGeometry(shape, { depth: FLOOR_T, bevelEnabled: false, curveSegments: 28 }));
    floorGeo.rotateX(-Math.PI / 2);
    floorGeo.translate(0, -FLOOR_T, 0);
    const tile = this.track(makeTileTexture(theme));
    tile.repeat.set(1 / CELL, 1 / CELL);
    tile.offset.set((level.cols / 2) % 1, (level.rows / 2) % 1);
    const floorMat = this.track(new THREE.MeshStandardMaterial({ map: tile, roughness: 0.85, metalness: 0.05 }));
    const sideMat = this.track(new THREE.MeshStandardMaterial({ color: 0x0f172a, roughness: 0.9 }));
    const floor = new THREE.Mesh(floorGeo, [floorMat, sideMat]);
    floor.receiveShadow = true;
    this.boardGroup.add(floor);

    // Pits under every hole (inside faces only) so falling balls visibly drop into depth
    const pitMat = this.track(new THREE.MeshStandardMaterial({ color: 0x05070d, roughness: 1, side: THREE.BackSide }));
    const goalPitMat = this.track(new THREE.MeshStandardMaterial({ color: 0x063b2a, emissive: 0x0a7a50, emissiveIntensity: 0.6, side: THREE.BackSide }));
    const pitBottomMat = this.track(new THREE.MeshStandardMaterial({ color: 0x020308, roughness: 1 }));
    const goalBottomMat = this.track(new THREE.MeshStandardMaterial({ color: 0x0d5c3d, emissive: 0x16c47f, emissiveIntensity: 0.7 }));
    const redRimMat = this.track(new THREE.MeshBasicMaterial({ color: 0xff3b5c }));
    for (const h of holeList) {
      const pit = new THREE.Mesh(this.track(new THREE.CylinderGeometry(h.r, h.r * 0.9, PIT_DEPTH, 28, 1, true)), h.goal ? goalPitMat : pitMat);
      pit.position.set(h.x, -FLOOR_T - PIT_DEPTH / 2 + 0.01, h.z);
      this.boardGroup.add(pit);
      const bottom = new THREE.Mesh(this.track(new THREE.CircleGeometry(h.r * 0.9, 24)), h.goal ? goalBottomMat : pitBottomMat);
      bottom.rotation.x = -Math.PI / 2;
      bottom.position.set(h.x, -FLOOR_T - PIT_DEPTH + 0.02, h.z);
      this.boardGroup.add(bottom);
      const ring = new THREE.Mesh(this.track(new THREE.RingGeometry(h.r, h.r + 0.07, 32)),
        h.goal ? this.track(new THREE.MeshBasicMaterial({ color: 0x34ff9a })) : redRimMat);
      ring.rotation.x = -Math.PI / 2;
      ring.position.set(h.x, 0.005, h.z);
      this.boardGroup.add(ring);
      if (h.goal) this.goalRing = ring;
    }

    // Start pad
    const sp = level.startPos;
    const startRing = new THREE.Mesh(this.track(new THREE.RingGeometry(0.75, 0.82, 40)), this.track(new THREE.MeshBasicMaterial({ color: 0x3b82f6 })));
    startRing.rotation.x = -Math.PI / 2;
    startRing.position.set(sp.x, 0.005, sp.z);
    this.boardGroup.add(startRing);

    // Walls: one instanced body + one instanced glowing cap strip
    const unit = this.track(new THREE.BoxGeometry(1, 1, 1));
    const wallMat = this.track(new THREE.MeshStandardMaterial({ color: theme.wall, roughness: 0.55, metalness: 0.2 }));
    const capMat = this.track(new THREE.MeshBasicMaterial({ color: theme.edge }));
    const walls = new THREE.InstancedMesh(unit, wallMat, level.walls.length);
    const caps = new THREE.InstancedMesh(unit, capMat, level.walls.length);
    const m = new THREE.Matrix4(), q = new THREE.Quaternion(), s = new THREE.Vector3(), p = new THREE.Vector3();
    level.walls.forEach((w, i) => {
      const sx = w.maxX - w.minX, sz = w.maxZ - w.minZ;
      p.set((w.minX + w.maxX) / 2, WALL_H / 2, (w.minZ + w.maxZ) / 2); s.set(sx, WALL_H, sz);
      walls.setMatrixAt(i, m.compose(p, q, s));
      p.y = WALL_H + 0.02; s.set(sx + 0.01, 0.04, sz + 0.01);
      caps.setMatrixAt(i, m.compose(p, q, s));
    });
    walls.castShadow = true; walls.receiveShadow = true;
    this.boardGroup.add(walls, caps);

    // Base plate under the pits: gives the board a solid silhouette against the stars
    const base = new THREE.Mesh(this.track(new THREE.BoxGeometry(W + 1.2, 0.25, H + 1.2)), this.track(new THREE.MeshStandardMaterial({ color: 0x0b1020, roughness: 0.6, metalness: 0.4 })));
    base.position.y = -FLOOR_T - PIT_DEPTH - 0.15;
    this.boardGroup.add(base);

    // Sliding gates
    const sliderMat = this.track(new THREE.MeshStandardMaterial({ color: 0xff7a1a, emissive: 0xff4d00, emissiveIntensity: 0.45, roughness: 0.4 }));
    for (const sl of level.sliders) {
      const across = BOARD.SLIDER_ACROSS, along = BOARD.SLIDER_ALONG, hgt = WALL_H * 0.85;
      const geo = this.track(sl.moveAxis === 'x' ? new THREE.BoxGeometry(across, hgt, along) : new THREE.BoxGeometry(along, hgt, across));
      const mesh = new THREE.Mesh(geo, sliderMat);
      mesh.position.set(sl.x, hgt / 2, sl.z);
      mesh.castShadow = true;
      this.boardGroup.add(mesh);
      this.sliderMeshes.push(mesh);
    }

    // Balls
    BALL_COLORS.forEach(color => {
      const mat = this.track(new THREE.MeshStandardMaterial({ color, roughness: 0.18, metalness: 0.35, emissive: color, emissiveIntensity: 0.18 }));
      const ball = new THREE.Mesh(this.ballGeo, mat);
      ball.castShadow = true;
      this.boardGroup.add(ball);
      this.ballMeshes.push(ball);
    });
    this.ballY = BALL_R;

    // Light + shadow frustum sized to the board
    const ext = Math.max(W, H) / 2 + 2;
    this.sun.position.set(-ext * 0.5, ext * 1.6, ext * 0.8);
    this.sun.target.position.set(0, 0, 0);
    Object.assign(this.sun.shadow.camera, { left: -ext, right: ext, top: ext, bottom: -ext, near: 1, far: ext * 5 });
    this.sun.shadow.camera.updateProjectionMatrix();
    this.extent = { W, H };
  }

  /** Sync meshes to physics + visual tilt. */
  update(physics, tiltX, tiltZ, dt) {
    this.elapsed += dt;
    // Board-local frame: +x right, -z away. Positive tiltX lowers the right edge, positive tiltZ lowers the far edge.
    this.boardGroup.rotation.set(-tiltZ, 0, -tiltX, 'XYZ');
    const axis = new THREE.Vector3(), rot = new THREE.Quaternion();
    physics.balls.forEach((b, i) => {
      const mesh = this.ballMeshes[i];
      const dx = b.x - mesh.position.x, dz = b.z - mesh.position.z, dist = Math.hypot(dx, dz);
      if (dist > 1e-5 && dist < 1 && b.state === 'roll') {
        // Rolling without slipping: rotate about the axis perpendicular to travel by dist / r
        axis.set(dz, 0, -dx).normalize();
        rot.setFromAxisAngle(axis, dist / BOARD.BALL_R);
        mesh.quaternion.premultiply(rot);
      }
      mesh.position.set(b.x, b.y, b.z);
      mesh.visible = b.state !== 'respawn';
    });
    physics.sliders.forEach((s, i) => {
      const mesh = this.sliderMeshes[i];
      if (mesh) { mesh.position.x = s.cx; mesh.position.z = s.cz; }
    });
    if (this.goalRing) {
      const k = 1 + Math.sin(this.elapsed * 4) * 0.06;
      this.goalRing.scale.set(k, k, 1);
    }
    this.stars.rotation.y += dt * 0.01;
  }
}
