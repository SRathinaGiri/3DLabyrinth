/* ==========================================================================
   3D LABYRINTH - STEREOSCOPIC 3D RENDER ENGINE
   Ported from 3D Tunnel Rush v4.32.0: 2D, Parallel, Cross-Eye, Anaglyph,
   Smart-Glasses HSBS and WebXR. Changes: 2D/Anaglyph fill the free area
   (portrait phones) instead of a forced square; eye separation / focal plane
   are driven per-frame by the app so depth stays consistent across board sizes.
   ========================================================================== */

export const STEREO_MODES = ['2d', 'parallel', 'cross', 'anaglyph', 'hsbs'];

export class StereoRenderEngine {
  constructor(canvasElement) {
    this.canvas = canvasElement;
    this.renderer = new THREE.WebGLRenderer({
      canvas: this.canvas,
      antialias: true,
      alpha: false,
      powerPreference: 'high-performance'
    });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.renderer.setSize(500, 500, false);
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    this.renderer.xr.enabled = true;

    this.mode = '2d';
    this.eyeDistance = 0.8;
    this.focalLength = 20.0;
    this.swapEyes = false;
    this.fov = 50;

    this.cameraGroup = new THREE.Group();
    this.mainCamera = new THREE.PerspectiveCamera(this.fov, 1, 0.1, 400);
    this.cameraL = new THREE.PerspectiveCamera(this.fov, 1, 0.1, 400);
    this.cameraR = new THREE.PerspectiveCamera(this.fov, 1, 0.1, 400);
    this.cameraGroup.add(this.mainCamera, this.cameraL, this.cameraR);

    this.onModeChange = null;
    this.onBeforeEyes = null; // (eyeAspect) => void, lets the HUD fit the eye frustum

    const rtOpts = { minFilter: THREE.LinearFilter, magFilter: THREE.LinearFilter, format: THREE.RGBAFormat };
    this.renderTargetL = new THREE.WebGLRenderTarget(500, 500, rtOpts);
    this.renderTargetR = new THREE.WebGLRenderTarget(500, 500, rtOpts);

    this.anaglyphMaterial = new THREE.ShaderMaterial({
      uniforms: { mapLeft: { value: null }, mapRight: { value: null } },
      vertexShader: `
        varying vec2 vUv;
        void main() { vUv = uv; gl_Position = vec4(position, 1.0); }
      `,
      fragmentShader: `
        uniform sampler2D mapLeft;
        uniform sampler2D mapRight;
        varying vec2 vUv;
        void main() {
          vec4 colorL = texture2D(mapLeft, vUv);
          vec4 colorR = texture2D(mapRight, vUv);
          gl_FragColor = vec4(colorL.r, colorR.g, colorR.b, 1.0);
        }
      `,
      depthTest: false,
      depthWrite: false
    });
    this.anaglyphScene = new THREE.Scene();
    this.anaglyphCamera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
    this.anaglyphScene.add(new THREE.Mesh(new THREE.PlaneGeometry(2, 2), this.anaglyphMaterial));
  }

  get isDualView() { return this.mode === 'parallel' || this.mode === 'cross' || this.mode === 'hsbs'; }

  setMode(newMode) {
    if (!STEREO_MODES.includes(newMode)) return;
    this.mode = newMode;
    const frame = document.getElementById('viewportFrame');
    const divider = document.getElementById('sbsDivider');
    if (frame) {
      frame.classList.toggle('mode-dual', this.isDualView);
      frame.classList.toggle('mode-single', !this.isDualView);
    }
    if (divider) divider.style.display = this.isDualView ? 'block' : 'none';
    this.handleResize();
    if (this.onModeChange) this.onModeChange(newMode);
  }

  setEyeDistance(val) { this.eyeDistance = parseFloat(val); }
  setFocalLength(val) { this.focalLength = parseFloat(val); }

  /** Aspect of a single eye image for the current mode and canvas size. */
  eyeAspect() {
    const size = this.renderer.getSize(new THREE.Vector2());
    if (this.mode === 'hsbs') return 16 / 9; // optics stretch each half back to 16:9
    if (this.mode === 'parallel' || this.mode === 'cross') return (size.x / 2) / size.y;
    return size.x / size.y;
  }

  render(scene) {
    if (this.renderer.xr.isPresenting) {
      this.renderer.setScissorTest(false);
      this.renderer.render(scene, this.mainCamera);
      return;
    }

    const size = this.renderer.getSize(new THREE.Vector2());
    const width = size.x, height = size.y;
    const halfEye = this.eyeDistance / 2.0;
    const eyeAspect = this.eyeAspect();

    this.mainCamera.aspect = eyeAspect;
    this.mainCamera.fov = this.fov;
    this.mainCamera.updateProjectionMatrix();
    this.mainCamera.updateMatrixWorld(true);
    if (this.onBeforeEyes) this.onBeforeEyes(eyeAspect);

    for (const [cam, sign] of [[this.cameraL, -1], [this.cameraR, 1]]) {
      cam.aspect = eyeAspect;
      cam.fov = this.fov;
      cam.position.copy(this.mainCamera.position);
      cam.quaternion.copy(this.mainCamera.quaternion);
      cam.translateX(sign * halfEye);
      cam.updateMatrixWorld(true);
      cam.updateProjectionMatrix();
    }

    // Off-axis (asymmetric frustum) stereo: shift each projection so both eyes converge on the focal plane
    const focal = Math.max(0.001, this.focalLength);
    const shift = (this.mainCamera.projectionMatrix.elements[0] * halfEye) / focal;
    this.cameraL.projectionMatrix.elements[8] += shift;
    this.cameraR.projectionMatrix.elements[8] -= shift;
    this.cameraL.projectionMatrixInverse.copy(this.cameraL.projectionMatrix).invert();
    this.cameraR.projectionMatrixInverse.copy(this.cameraR.projectionMatrix).invert();

    const leftCam = this.swapEyes ? this.cameraR : this.cameraL;
    const rightCam = this.swapEyes ? this.cameraL : this.cameraR;

    this.renderer.setScissorTest(true);
    if (this.mode === '2d') {
      this.renderer.setViewport(0, 0, width, height);
      this.renderer.setScissor(0, 0, width, height);
      this.renderer.render(scene, this.mainCamera);
    } else if (this.isDualView) {
      const halfWidth = Math.floor(width / 2);
      const leftX = this.mode === 'cross' ? halfWidth : 0;
      const rightX = this.mode === 'cross' ? 0 : halfWidth;
      this.renderer.setViewport(leftX, 0, halfWidth, height);
      this.renderer.setScissor(leftX, 0, halfWidth, height);
      this.renderer.render(scene, leftCam);
      this.renderer.setViewport(rightX, 0, halfWidth, height);
      this.renderer.setScissor(rightX, 0, halfWidth, height);
      this.renderer.render(scene, rightCam);
    } else if (this.mode === 'anaglyph') {
      this.renderer.setScissorTest(false);
      this.renderer.setRenderTarget(this.renderTargetL);
      this.renderer.clear();
      this.renderer.render(scene, leftCam);
      this.renderer.setRenderTarget(this.renderTargetR);
      this.renderer.clear();
      this.renderer.render(scene, rightCam);
      this.renderer.setRenderTarget(null);
      this.renderer.setViewport(0, 0, width, height);
      this.anaglyphMaterial.uniforms.mapLeft.value = this.renderTargetL.texture;
      this.anaglyphMaterial.uniforms.mapRight.value = this.renderTargetR.texture;
      this.renderer.render(this.anaglyphScene, this.anaglyphCamera);
    }
    this.renderer.setScissorTest(false);
  }

  handleResize() {
    const frame = document.getElementById('viewportFrame');
    if (!frame) return;
    // Toolbar sits below the view, or beside it on short landscape phones (see CSS media query)
    const toolbar = document.getElementById('gameBottomToolbar');
    const page = document.getElementById('gamePage');
    const beside = page && getComputedStyle(page).flexDirection === 'row';
    const tbH = toolbar && toolbar.offsetHeight ? toolbar.offsetHeight + 10 : 70;
    const tbW = toolbar && toolbar.offsetWidth ? toolbar.offsetWidth + 10 : 70;
    const availH = Math.max(160, window.innerHeight - (beside ? 8 : tbH + 8));
    const availW = Math.max(160, window.innerWidth - (beside ? tbW + 8 : 8));

    let w, h;
    if (this.mode === 'parallel' || this.mode === 'cross') {
      // Exact 2:1 so each eye gets a square image (cardboard / free-viewing)
      h = Math.min(availH, availW / 2, 800);
      w = h * 2;
    } else if (this.mode === 'hsbs') {
      h = Math.min(availH, availW / (16 / 9), 1080);
      w = h * (16 / 9);
    } else {
      w = availW; h = availH;
    }
    w = Math.round(w); h = Math.round(h);
    frame.style.width = `${w}px`;
    frame.style.height = `${h}px`;

    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    this.renderer.setPixelRatio(dpr);
    this.renderer.setSize(w, h, false);
    const tw = Math.max(1, Math.round(w * dpr)), th = Math.max(1, Math.round(h * dpr));
    this.renderTargetL.setSize(tw, th);
    this.renderTargetR.setSize(tw, th);
  }
}
