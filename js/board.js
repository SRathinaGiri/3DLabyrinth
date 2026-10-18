/* ==========================================================================
   3D LABYRINTH - BOARD SCENE BUILDER (THREE.js meshes for a level)
   Everything lives under boardGroup, which tilts with the input; physics
   coordinates are board-local so meshes map 1:1 onto physics positions.
   ========================================================================== */

import { BOARD, BALL_COLORS, DEFAULT_LOOK } from './config.js';
import { boardLook, ballMaterial, makeEnvironment } from './materials.js';

export class BoardView {
  constructor(scene, renderer) {
    this.scene = scene;
    this.env = makeEnvironment(renderer);
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

    // Headlamp for the Inside view: tall corridor walls shade the floor, so light it from the camera
    this.lamp = new THREE.PointLight(0xfff4e0, 0, 9, 1.6);
    scene.add(this.lamp);

    this.stars = this.makeStars();
    scene.add(this.stars);

    this.ballGeo = new THREE.SphereGeometry(BOARD.BALL_R, 32, 20);
    this.ballMeshes = [];
    this.disposables = [];
    this.sliderMeshes = [];
    this.goalRing = null;
    this.beacon = null;
    this.elapsed = 0;
    this.wallScale = 1; // >1 in the Inside view: corridors tower over the chase camera
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

  build(level, look = DEFAULT_LOOK, ballCount = BALL_COLORS.length, apples = []) {
    this.clear();
    // Walls, caps and gates live in one group so the Inside view can raise them in one scale
    this.wallGroup = new THREE.Group();
    this.wallGroup.scale.y = this.wallScale;
    this.boardGroup.add(this.wallGroup);
    this.level = level;
    const L = boardLook(look.board, level.n, this.env);
    this.track(L.floor, L.side, L.wall, L.cap, L.base, ...L.textures);
    this.scene.background = new THREE.Color(L.bg);
    this.stars.visible = L.stars;
    this.sun.color.setHex(L.sun[0]); this.sun.intensity = L.sun[1];
    this.hemi.color.setHex(L.hemi[0]); this.hemi.groundColor.setHex(L.hemi[1]); this.hemi.intensity = L.hemi[2];
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
    // Align texture seams with cell boundaries (ExtrudeGeometry UVs are world x / -z)
    const k = L.cellsPerTile, tile = L.floor.map;
    tile.repeat.set(1 / (CELL * k), 1 / (CELL * k));
    tile.offset.set((level.cols / (2 * k)) % 1, (level.rows / (2 * k)) % 1);
    const floor = new THREE.Mesh(floorGeo, [L.floor, L.side]);
    floor.receiveShadow = true;
    this.boardGroup.add(floor);

    // Pits under every hole (inside faces only) so falling balls visibly drop into depth
    const pitMat = this.track(new THREE.MeshStandardMaterial({ color: L.glowPits ? 0x1a0510 : 0x05070d, emissive: L.glowPits ? 0x5a0a1e : 0x000000, roughness: 1, side: THREE.BackSide }));
    const goalPitMat = this.track(new THREE.MeshStandardMaterial({ color: 0x063b2a, emissive: 0x0a7a50, emissiveIntensity: 0.6, side: THREE.BackSide }));
    const pitBottomMat = this.track(new THREE.MeshStandardMaterial({ color: 0x020308, roughness: 1 }));
    const goalBottomMat = this.track(new THREE.MeshStandardMaterial({ color: 0x0d5c3d, emissive: 0x16c47f, emissiveIntensity: 0.7 }));
    const redRimMat = this.track(new THREE.MeshBasicMaterial({ color: L.rim }));
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
    const walls = new THREE.InstancedMesh(unit, L.wall, level.walls.length);
    const caps = new THREE.InstancedMesh(unit, L.cap, level.walls.length);
    const m = new THREE.Matrix4(), q = new THREE.Quaternion(), s = new THREE.Vector3(), p = new THREE.Vector3();
    level.walls.forEach((w, i) => {
      const sx = w.maxX - w.minX, sz = w.maxZ - w.minZ;
      p.set((w.minX + w.maxX) / 2, WALL_H / 2, (w.minZ + w.maxZ) / 2); s.set(sx, WALL_H, sz);
      walls.setMatrixAt(i, m.compose(p, q, s));
      p.y = WALL_H + 0.02; s.set(sx + 0.01, 0.04, sz + 0.01);
      caps.setMatrixAt(i, m.compose(p, q, s));
    });
    walls.castShadow = true; walls.receiveShadow = !L.wall.transparent;
    this.wallGroup.add(walls, caps);

    // Base plate under the pits: gives the board a solid silhouette against the stars
    const base = new THREE.Mesh(this.track(new THREE.BoxGeometry(W + 1.2, 0.25, H + 1.2)), L.base);
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
      this.wallGroup.add(mesh);
      this.sliderMeshes.push(mesh);
    }

    // Balls
    // Goal beacon: a soft light column, shown in the Inside view so you can find the goal from ball level
    const beamMat = this.track(new THREE.MeshBasicMaterial({ color: 0x34ff9a, transparent: true, opacity: 0, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide }));
    this.beacon = new THREE.Mesh(this.track(new THREE.CylinderGeometry(0.32, 0.55, 14, 24, 1, true)), beamMat);
    this.beacon.position.set(level.goal.x, 7, level.goal.z);
    this.beacon.visible = false;
    this.boardGroup.add(this.beacon);

    // Bonus apples (one mesh per physics apple; claimed ones stay hidden)
    this.appleMeshes = apples.map(a => {
      const grp = new THREE.Group();
      const body = new THREE.Mesh(this.track(new THREE.SphereGeometry(0.26, 24, 16)), this.track(new THREE.MeshStandardMaterial({ color: 0xe0242c, roughness: 0.3, emissive: 0x4a0000, envMap: this.env, envMapIntensity: 0.6 })));
      body.scale.set(1, 0.88, 1);
      const stem = new THREE.Mesh(this.track(new THREE.CylinderGeometry(0.025, 0.03, 0.16, 6)), this.track(new THREE.MeshStandardMaterial({ color: 0x5b3a1a })));
      stem.position.y = 0.27;
      const leaf = new THREE.Mesh(this.track(new THREE.SphereGeometry(0.09, 10, 6)), this.track(new THREE.MeshStandardMaterial({ color: 0x3ccf4e, emissive: 0x0a3a10 })));
      leaf.scale.set(1.4, 0.3, 0.7); leaf.position.set(0.09, 0.3, 0); leaf.rotation.z = -0.5;
      const glow = new THREE.Mesh(this.track(new THREE.SphereGeometry(0.46, 20, 12)), this.track(new THREE.MeshBasicMaterial({ color: 0xff6a5a, transparent: true, opacity: 0.14, depthWrite: false, blending: THREE.AdditiveBlending })));
      grp.add(body, stem, leaf, glow);
      grp.position.set(a.x, 0.5, a.z);
      grp.scale.setScalar(1.25);
      body.castShadow = true;
      grp.visible = !a.taken;
      this.boardGroup.add(grp);
      return grp;
    });

    BALL_COLORS.slice(0, ballCount).forEach(color => {
      const mat = ballMaterial(look.ball, color, this.env);
      this.track(mat, ...(mat.map ? [mat.map] : []));
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

  /** Ease walls toward the target height (1 = normal, INSIDE_VIEW.WALL_SCALE = towering). */
  setWallTarget(target, dt) {
    this.wallScale += (target - this.wallScale) * Math.min(1, 4 * dt);
    if (Math.abs(target - this.wallScale) < 0.002) this.wallScale = target;
    if (this.wallGroup) this.wallGroup.scale.y = this.wallScale;
    if (this.beacon) {
      const k = Math.max(0, Math.min(1, (this.wallScale - 1) / 1.5));
      this.beacon.visible = k > 0.01;
      this.beacon.material.opacity = k * (0.22 + Math.sin(this.elapsed * 3) * 0.06);
    }
    this.lamp.intensity = Math.max(0, Math.min(1, (this.wallScale - 1) / 1.5)) * 1.1;
  }

  setHeadlamp(eye, look) {
    this.lamp.position.copy(eye).lerp(look, 0.25);
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
    physics.apples.forEach((a, i) => {
      const m = this.appleMeshes && this.appleMeshes[i];
      if (!m) return;
      m.visible = !a.taken;
      m.rotation.y += dt * 1.6;
      m.position.y = 0.5 + Math.sin(this.elapsed * 2.4 + i) * 0.08; // gentle bob catches the eye
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
