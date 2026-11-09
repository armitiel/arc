import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';

const model = document.querySelector('#model');
const viewport = document.querySelector('#viewport');
const status = document.querySelector('#status');
const zoomTools = document.querySelector('#zoom-tools');
const zoomOut = document.querySelector('#zoom-out');
const zoomIn = document.querySelector('#zoom-in');
const zoomLevel = document.querySelector('#zoom-level');
const patternNavigation = document.querySelector('#pattern-navigation');
const previousPattern = document.querySelector('#previous-pattern');
const nextPattern = document.querySelector('#next-pattern');
const patternCaption = document.querySelector('#pattern-caption');

const prefersReducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)');

function bakedMaterial({ albedo, lightmap, L, K, hasLightUV, brass, cleanPlaster, wallFace, wallTrim, pattern }) {
  return new THREE.ShaderMaterial({
    side: THREE.DoubleSide,
    uniforms: {
      albedo: { value: albedo },
      lightmap: { value: lightmap },
      lmL: { value: L },
      lmK: { value: K },
      brass: { value: brass },
      cleanPlaster: { value: cleanPlaster },
      wallPattern: pattern.texture,
      incomingPattern: pattern.incoming,
      slideOffset: pattern.offset,
      hasWallPattern: pattern.enabled,
      twoWallSlide: pattern.twoWallSlide,
      wallIndex: { value: pattern.wallIndex },
    },
    defines: {
      ...(hasLightUV ? { LIGHT_UV_SECONDARY: 1, USE_UV1: 1 } : {}),
      ...(wallFace ? { SMOOTH_VAULT_EDGE: 1 } : {}),
      ...(wallTrim ? { WALL_TRIM: 1 } : {}),
    },
    vertexShader: `
      varying vec2 bakedUV;
      varying vec2 paintUV;
      #ifdef WALL_TRIM
        varying vec3 worldPos;
        varying vec3 worldNormal;
      #endif
      void main() {
        #ifdef LIGHT_UV_SECONDARY
          bakedUV = uv1;
        #else
          bakedUV = uv;
        #endif
        paintUV = uv;
        vec4 local = vec4(position, 1.0);
        #ifdef WALL_TRIM
          worldPos = (modelMatrix * local).xyz;
          worldNormal = normalize(mat3(modelMatrix) * normal);
        #endif
        gl_Position = projectionMatrix * modelViewMatrix * local;
      }
    `,
    fragmentShader: `
      uniform sampler2D albedo;
      uniform sampler2D lightmap;
      uniform float lmL;
      uniform float lmK;
      uniform bool brass;
      uniform bool cleanPlaster;
      uniform sampler2D wallPattern;
      uniform sampler2D incomingPattern;
      uniform float slideOffset;
      uniform bool hasWallPattern;
      uniform bool twoWallSlide;
      uniform float wallIndex;
      varying vec2 bakedUV;
      varying vec2 paintUV;
      #ifdef WALL_TRIM
        varying vec3 worldPos;
        varying vec3 worldNormal;
      #endif
      vec3 decodeLight(vec2 uv) {
        return lmK * (exp2(texture2D(lightmap, uv).rgb * lmL) - 1.0);
      }
      void main() {
        // Match the power curve used by the Blender albedo export.
        vec3 pigment = pow(texture2D(albedo, bakedUV).rgb, vec3(2.2));
        // N and S are shipped with painted albedo. Start from bare plaster
        // above the baseboard so the browser can choose the wall S pattern.
        bool aboveBaseboard = paintUV.y < 1.0 - 0.08 / 4.2;
        if (cleanPlaster && aboveBaseboard) pigment = vec3(0.86, 0.855, 0.83);
        vec3 lighting = decodeLight(bakedUV);
        #ifdef WALL_TRIM
          float wallNormalY = normalize(worldNormal).y;
          bool atWallJoin = abs(abs(worldPos.x) - 2.8) < 0.02 ||
                            abs(abs(worldPos.z) - 2.8) < 0.02;
          if (atWallJoin && abs(wallNormalY) < 0.5) discard;
          if (wallNormalY > 0.35) lighting = vec3(0.17);
        #endif
        #ifdef SMOOTH_VAULT_EDGE
          // The wall bake catches a bright fringe along the vault join. Sample
          // lighting farther inside the same wall UV island and blend at the arch.
          float wallX = clamp(paintUV.x * 2.0 - 1.0, -1.0, 1.0);
          float archTop = 0.5 * (1.0 - sqrt(max(0.0, 1.0 - wallX * wallX)));
          float fromArch = paintUV.y - archTop;
          vec2 paintDx = dFdx(paintUV);
          vec2 paintDy = dFdy(paintUV);
          vec2 bakeDx = dFdx(bakedUV);
          vec2 bakeDy = dFdy(bakedUV);
          float determinant = paintDx.x * paintDy.y - paintDx.y * paintDy.x;
          float fromCorner = min(paintUV.x, 1.0 - paintUV.x);
          if ((fromArch < 0.075 || fromCorner < 0.025) && abs(determinant) > 1e-9) {
            vec2 bakeDown = (bakeDy * paintDx.x - bakeDx * paintDy.x) / determinant;
            vec2 bakeAcross = (bakeDx * paintDy.y - bakeDy * paintDx.y) / determinant;
            float inward = paintUV.x < 0.5 ? 1.0 : -1.0;
            vec2 innerUV = bakedUV + bakeDown * max(0.0, 0.075 - fromArch)
                         + bakeAcross * (inward * max(0.0, 0.025 - fromCorner));
            vec3 innerLight = decodeLight(innerUV);
            float archFringe = 1.0 - smoothstep(0.012, 0.075, fromArch);
            float cornerFringe = 1.0 - smoothstep(0.003, 0.025, fromCorner);
            lighting = mix(lighting, min(lighting, innerLight), max(archFringe, cornerFringe));
          }
        #endif
        if (hasWallPattern && aboveBaseboard) {
          vec4 currentPaint = texture2D(wallPattern, paintUV);
          vec3 current = mix(pigment, pow(currentPaint.rgb, vec3(2.2)), currentPaint.a);
          if (slideOffset != 0.0) {
            // Reveal the next pattern without moving its UV alignment to the wall.
            vec4 incomingPaint = texture2D(incomingPattern, paintUV);
            vec3 incoming = mix(pigment, pow(incomingPaint.rgb, vec3(2.2)), incomingPaint.a);
            float edge = slideOffset > 0.0 ? 1.0 - slideOffset : -slideOffset;
            float slideX = twoWallSlide ? (wallIndex + paintUV.x) * 0.5 : paintUV.x;
            float reveal = smoothstep(edge - 0.035, edge + 0.035, slideX);
            current = mix(current, incoming, slideOffset > 0.0 ? reveal : 1.0 - reveal);
          }
          pigment = current;
        }
        // Metallic highlights are absent from the diffuse bake.
        if (brass) pigment = vec3(0.29, 0.20, 0.105);
        vec3 litColor = pigment * lighting;
        if (brass) litColor += vec3(0.30, 0.22, 0.11);
        gl_FragColor = vec4(litColor, 1.0);
        #include <tonemapping_fragment>
        #include <colorspace_fragment>
      }
    `,
  });
}

// Proste otoczenie sali do odbic w metalu: jasne sklepienie, sciany, ciemniejsza podloga,
// dwa jasne prostokaty = okno i drzwi od polnocy, cieple punkty = swiece.
function roomEnvironment(renderer) {
  const c = document.createElement('canvas');
  c.width = 512; c.height = 256;
  const g = c.getContext('2d');
  const sky = g.createLinearGradient(0, 0, 0, 256);
  sky.addColorStop(0, '#f6eee2');
  sky.addColorStop(0.42, '#e6dccd');
  sky.addColorStop(0.52, '#8c7e6c');
  sky.addColorStop(0.62, '#4a4036');
  sky.addColorStop(1, '#2a241e');
  g.fillStyle = sky; g.fillRect(0, 0, 512, 256);
  g.fillStyle = '#ffffff';
  g.fillRect(60, 92, 34, 50);     // okno
  g.fillRect(150, 88, 30, 78);    // drzwi
  g.fillStyle = '#ffd9a0';
  for (let i = 0; i < 6; i++) g.fillRect(40 + i * 80, 40, 8, 8);   // swiece
  const tex = new THREE.CanvasTexture(c);
  tex.mapping = THREE.EquirectangularReflectionMapping;
  tex.colorSpace = THREE.SRGBColorSpace;
  const pmrem = new THREE.PMREMGenerator(renderer);
  const env = pmrem.fromEquirectangular(tex).texture;
  tex.dispose(); pmrem.dispose();
  return env;
}

async function initViewer() {
  const [response, patternResponse, pairsResponse] = await Promise.all([
    fetch('./manifest.json'),
    fetch('./wzory/psd.json', { cache: 'no-cache' }),
    fetch('./wzory/pary.json', { cache: 'no-cache' }),
  ]);
  if (!response.ok) throw new Error('Nie można odczytać manifestu modelu.');
  const manifest = await response.json();
  if (!patternResponse.ok) throw new Error('Nie można odczytać listy wzorów.');
  const catalog = await patternResponse.json();
  if (!pairsResponse.ok) throw new Error('Nie można odczytać wzorów narożnych.');
  const patterns = [
    ...(catalog.S ?? [])
      .filter(({ id }) => id !== 'PSD-S-2')
      .map(({ label, url }) => ({ label, walls: { S: url } })),
    // wzor z "hidden": true w pary.json jest schowany (plik zostaje)
    ...(await pairsResponse.json()).filter((pattern) => !pattern.hidden),
  ];
  const scene = new THREE.Scene();
  scene.background = new THREE.Color('#5e584f');

  const roomCamera = new THREE.PerspectiveCamera(73, .75, .035, 30);
  const front = manifest.cameras.find((pose) => pose.name === 'Mural_front');
  const corner = {
    pos: [-2.13, 1.74, -2.36],
    target: [1.65, 1.98, 2.26],
    vfov: 56,
    minHfov: 84,
  };
  let activePose = front;
  roomCamera.position.fromArray(front.pos);
  roomCamera.lookAt(new THREE.Vector3().fromArray(front.target));

  const loader = new THREE.TextureLoader();
  const muralWalls = ['E', 'S'];
  const blank = new THREE.DataTexture(new Uint8Array(4), 1, 1);
  blank.needsUpdate = true;

  async function loadPatternTextures(pattern) {
    const loaded = await Promise.allSettled(muralWalls.map(async (wall) => {
      const url = pattern?.walls[wall];
      return [wall, url ? await loader.loadAsync(url) : blank];
    }));
    const textures = Object.fromEntries(loaded.filter(({ status }) => status === 'fulfilled')
      .map(({ value }) => value));
    const failed = loaded.find(({ status }) => status === 'rejected');
    if (failed) {
      for (const texture of Object.values(textures)) {
        if (texture !== blank) texture.dispose();
      }
      throw failed.reason;
    }
    return textures;
  }

  const [{ scene: room }, baked, initialTextures] = await Promise.all([
    new GLTFLoader().loadAsync('./wnetrze.glb'),
    Promise.all(Object.entries(manifest.objects).map(async ([name, entry]) => {
      const [albedo, lightmap] = await Promise.all([
        loader.loadAsync('./' + entry.alb),
        loader.loadAsync('./' + entry.lm),
      ]);
      albedo.flipY = false;
      lightmap.flipY = false;
      lightmap.generateMipmaps = false;
      lightmap.minFilter = THREE.LinearFilter;
      return [name, { albedo, lightmap, L: entry.L, K: entry.K }];
    })),
    loadPatternTextures(patterns[0]),
  ]);
  const offset = { value: 0 };
  const twoWallSlide = { value: false };
  const emptyPattern = {
    texture: { value: blank }, incoming: { value: blank },
    offset, twoWallSlide, wallIndex: 0, enabled: { value: false },
  };
  const wallPatterns = Object.fromEntries(muralWalls.map((wall, wallIndex) => [wall, {
    texture: { value: initialTextures[wall] },
    incoming: { value: blank },
    offset, twoWallSlide, wallIndex, enabled: { value: true },
  }]));
  const basicMaterials = new Map([
    ['Zarowka', new THREE.MeshBasicMaterial({ color: 0xfff1d6, toneMapped: false })],
    ['Szyba', new THREE.MeshBasicMaterial({
      color: 0xe8eef3, toneMapped: false, transparent: true, opacity: 0.92,
      depthWrite: false, side: THREE.DoubleSide,
    })],
    ['Lustro', new THREE.MeshBasicMaterial({ color: 0x8a9096, toneMapped: false, side: THREE.DoubleSide })],
    ['Znak_wyjscie', new THREE.MeshBasicMaterial({ color: 0x3fd776, toneMapped: false })],
    // Mosiadz zyrandola: wypalone swiatlo nie ma odbic, wiec metal dostaje PBR + otoczenie sali.
    ['Metal_zyrandol', new THREE.MeshStandardMaterial({
      color: 0xb38a4c, metalness: 1, roughness: 0.24, envMapIntensity: 0.3,
    })],
  ]);
  for (const [name, textures] of baked) {
    room.getObjectByName(name).traverse((node) => {
      if (!node.isMesh) return;
      const basic = basicMaterials.get(node.material.name);
      if (basic) {
        node.material = basic;
        return;
      }
      const isWall = name.startsWith('Sciana_');
      const wallFace = isWall && node.material.name === name + '_mural';
      const materials = {
        ...textures,
        wallFace,
        wallTrim: isWall && !wallFace,
        pattern: (wallFace && wallPatterns[name.at(-1)]) || emptyPattern,
        hasLightUV: node.geometry.hasAttribute('uv1'),
        brass: node.material.name === 'Metal_zyrandol',
        cleanPlaster: ['Sciana_N_mural', 'Sciana_S_mural'].includes(node.material.name),
      };
      node.material = bakedMaterial(materials);
    });
  }
  scene.add(room);

  const renderer = new THREE.WebGLRenderer({ antialias: true });
  renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
  renderer.toneMapping = THREE.AgXToneMapping;
  // Blender's exposure is expressed in stops.
  renderer.toneMappingExposure = 2 ** 1.5;
  scene.environment = roomEnvironment(renderer);
  const canvas = renderer.domElement;
  canvas.tabIndex = 0;
  canvas.setAttribute('aria-label', 'Model wnętrza. Przeciągnij lub użyj Shift ze strzałkami, żeby obrócić widok. Strzałki lewo i prawo zmieniają wzór.');
  function configurePatternTexture(texture) {
    texture.flipY = false;
    texture.anisotropy = Math.min(renderer.capabilities.getMaxAnisotropy(), 8);
  }
  for (const texture of Object.values(initialTextures)) {
    if (texture !== blank) configurePatternTexture(texture);
  }

  function render() {
    renderer.render(scene, roomCamera);
  }

  const maxZoom = 3;
  const zoomStep = 1.25;
  function setZoom(value) {
    const zoom = THREE.MathUtils.clamp(value, 1, maxZoom);
    roomCamera.zoom = zoom;
    roomCamera.updateProjectionMatrix();
    zoomLevel.textContent = Math.round(zoom * 100) + '%';
    zoomOut.setAttribute('aria-disabled', String(zoom === 1));
    zoomIn.setAttribute('aria-disabled', String(zoom === maxZoom));
    render();
  }

  zoomIn.addEventListener('click', () => setZoom(roomCamera.zoom * zoomStep));
  zoomOut.addEventListener('click', () => setZoom(roomCamera.zoom / zoomStep));
  canvas.addEventListener('wheel', (event) => {
    const multiplier = event.deltaMode === 1 ? 16 : event.deltaMode === 2 ? viewport.clientHeight : 1;
    const next = THREE.MathUtils.clamp(roomCamera.zoom * Math.exp(-event.deltaY * multiplier * .002), 1, maxZoom);
    if (next !== roomCamera.zoom || event.ctrlKey) event.preventDefault();
    if (next !== roomCamera.zoom) setZoom(next);
  }, { passive: false });

  let index = patterns.length ? 0 : -1;

  function updatePatternCaption() {
    patternCaption.textContent = 'Wzór ' + (index + 1);
  }
  let busy = false;
  let stopIntroLook;

  function animatePattern(direction, nextPose) {
    const movesCamera = nextPose !== activePose;
    const from = roomCamera.clone();
    const to = roomCamera.clone();
    to.position.fromArray(nextPose.pos);
    to.lookAt(new THREE.Vector3().fromArray(nextPose.target));

    return new Promise((resolve) => {
      let start;
      function frame(time) {
        start ??= time;
        const progress = Math.min((time - start) / 460, 1);
        const eased = progress * progress * (3 - 2 * progress);
        offset.value = direction * eased;
        if (movesCamera) {
          roomCamera.position.lerpVectors(from.position, to.position, eased);
          roomCamera.quaternion.slerpQuaternions(from.quaternion, to.quaternion, eased);
          roomCamera.zoom = THREE.MathUtils.lerp(from.zoom, 1, eased);
          roomCamera.fov = THREE.MathUtils.lerp(from.fov, cameraFov(nextPose), eased);
          roomCamera.updateProjectionMatrix();
        }
        if (progress < 1) {
          render();
          requestAnimationFrame(frame);
        } else {
          resolve();
        }
      }
      requestAnimationFrame(frame);
    });
  }

  async function showPattern(target, direction = 0) {
    if (busy) return;
    busy = true;
    previousPattern.setAttribute('aria-disabled', 'true');
    nextPattern.setAttribute('aria-disabled', 'true');
    try {
      status.textContent = index < 0 ? 'Wczytuję wzór…' : '';
      const pattern = patterns[target];
      const textures = await loadPatternTextures(pattern);
      stopIntroLook?.();
      for (const wall of muralWalls) {
        const texture = textures[wall];
        if (texture !== blank) configurePatternTexture(texture);
        wallPatterns[wall].incoming.value = texture;
      }

      const nextPose = pattern.walls.E ? corner : front;
      if (direction && index >= 0 && !prefersReducedMotion.matches) {
        twoWallSlide.value = activePose === corner || nextPose === corner;
        await animatePattern(direction, nextPose);
      }

      for (const wall of muralWalls) {
        const state = wallPatterns[wall];
        const previousTexture = state.texture.value;
        state.texture.value = textures[wall];
        state.incoming.value = blank;
        if (previousTexture !== blank) previousTexture.dispose();
      }
      offset.value = 0;
      if (nextPose !== activePose) {
        activePose = nextPose;
        roomCamera.position.fromArray(activePose.pos);
        roomCamera.lookAt(new THREE.Vector3().fromArray(activePose.target));
        rotation.setFromQuaternion(roomCamera.quaternion, 'YXZ');
        roomCamera.fov = cameraFov(activePose);
        setZoom(1);
      }
      index = target;
      updatePatternCaption();
      status.textContent = '';
      render();
    } catch {
      status.textContent = 'Nie udało się wczytać tego wzoru.';
    } finally {
      busy = false;
      previousPattern.setAttribute('aria-disabled', 'false');
      nextPattern.setAttribute('aria-disabled', 'false');
    }
  }

  function stepPattern(direction) {
    if (patterns.length < 2) return;
    const target = index < 0
      ? (direction > 0 ? 0 : patterns.length - 1)
      : (index + direction + patterns.length) % patterns.length;
    showPattern(target, direction);
  }

  previousPattern.addEventListener('click', () => stepPattern(-1));
  nextPattern.addEventListener('click', () => stepPattern(1));

  const rotation = new THREE.Euler().setFromQuaternion(roomCamera.quaternion, 'YXZ');
  function look(horizontal, vertical) {
    rotation.y += horizontal / roomCamera.zoom;
    rotation.x = THREE.MathUtils.clamp(rotation.x + vertical / roomCamera.zoom, -1.35, 1.35);
    roomCamera.quaternion.setFromEuler(rotation);
    render();
  }

  const pointers = new Map();
  function pinchDistance() {
    const [first, second] = pointers.values();
    return Math.hypot(first.x - second.x, first.y - second.y);
  }
  canvas.addEventListener('pointerdown', (event) => {
    if (event.button !== 0 || pointers.size >= 2 || (pointers.size && event.pointerType !== 'touch')) return;
    const { pointerId, clientX: x, clientY: y } = event;
    pointers.set(pointerId, { x, y });
    canvas.setPointerCapture(pointerId);
  });
  canvas.addEventListener('pointermove', (event) => {
    const point = pointers.get(event.pointerId);
    if (!point) return;
    const before = pointers.size === 2 ? pinchDistance() : 0;
    const horizontal = event.clientX - point.x;
    const vertical = event.clientY - point.y;
    point.x = event.clientX;
    point.y = event.clientY;
    if (pointers.size === 2) {
      const after = pinchDistance();
      if (before > 1 && after > 1) setZoom(roomCamera.zoom * after / before);
    } else {
      look(horizontal * .005, vertical * .005);
    }
  });
  for (const name of ['pointerup', 'pointercancel', 'lostpointercapture']) {
    canvas.addEventListener(name, (event) => pointers.delete(event.pointerId));
  }
  model.addEventListener('keydown', (event) => {
    const angles = { ArrowLeft: [.09, 0], ArrowRight: [-.09, 0], ArrowUp: [0, .09], ArrowDown: [0, -.09] };
    if (event.target === canvas && event.shiftKey && Object.hasOwn(angles, event.key)) {
      event.preventDefault();
      look(...angles[event.key]);
    } else if (['+', '=', '-', '−'].includes(event.key)) {
      event.preventDefault();
      setZoom(roomCamera.zoom * (['+', '='].includes(event.key) ? zoomStep : 1 / zoomStep));
    } else if (event.key === 'ArrowLeft' || event.key === 'ArrowRight') {
      event.preventDefault();
      stepPattern(event.key === 'ArrowLeft' ? -1 : 1);
    }
  });

  function cameraFov({ vfov, minHfov }) {
    const portraitFov = THREE.MathUtils.radToDeg(
      2 * Math.atan(Math.tan(THREE.MathUtils.degToRad(minHfov / 2)) / roomCamera.aspect),
    );
    return Math.min(90, Math.max(vfov, portraitFov));
  }

  function resizeCamera() {
    const { clientWidth, clientHeight } = viewport;
    if (clientWidth === 0 || clientHeight === 0) return;
    renderer.setSize(clientWidth, clientHeight, false);
    roomCamera.aspect = clientWidth / clientHeight;
    roomCamera.fov = cameraFov(activePose);
    roomCamera.updateProjectionMatrix();
  }

  new ResizeObserver(() => {
    if (viewport.clientWidth === 0 || viewport.clientHeight === 0) return;
    resizeCamera();
    render();
  }).observe(viewport);

  resizeCamera();
  setZoom(1);
  if (index >= 0) updatePatternCaption();
  viewport.prepend(canvas);
  zoomTools.hidden = false;
  status.textContent = '';
  patternNavigation.hidden = patterns.length < 2;
  stopIntroLook = introLook();

  // Po wejsciu kamera sama sie chwile rozglada, zeby bylo widac, ze widokiem mozna ruszac.
  function introLook() {
    const hint = document.createElement('p');
    hint.id = 'look-hint';
    hint.innerHTML = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M8 12h8M8 12l3-3M8 12l3 3M16 12l-3-3M16 12l-3 3"/></svg>Przeciągnij, żeby się rozejrzeć';
    viewport.append(hint);
    let cancelled = false;
    let hideTimer;
    const hide = () => {
      hint.classList.add('is-hidden');
      setTimeout(() => hint.remove(), 600);
    };
    const stop = () => {
      if (cancelled) return;
      cancelled = true;
      clearTimeout(hideTimer);
      hide();
    };
    for (const type of ['pointerdown', 'wheel', 'keydown']) {
      canvas.addEventListener(type, stop, { once: true, passive: true });
    }
    if (prefersReducedMotion.matches) {
      hideTimer = setTimeout(hide, 5000);
      return stop;
    }
    const baseYaw = rotation.y;
    const basePitch = rotation.x;
    const duration = 3800;
    let start;
    function frame(time) {
      if (cancelled) return;
      start ??= time;
      const t = Math.min((time - start) / duration, 1);
      // spojrzenie w lewo, w prawo i powrot; obwiednia sin(pi t) daje miekki start i koniec
      const envelope = Math.sin(Math.PI * t);
      rotation.y = baseYaw + 0.28 * Math.sin(2 * Math.PI * t) * envelope;
      rotation.x = basePitch + 0.035 * envelope;
      roomCamera.quaternion.setFromEuler(rotation);
      render();
      if (t < 1) requestAnimationFrame(frame);
      else hideTimer = setTimeout(hide, 1600);
    }
    setTimeout(() => !cancelled && requestAnimationFrame(frame), 700);
    return stop;
  }
}

// Strona otwiera sie od razu na modelu 3D.
initViewer().catch((error) => {
  console.error(error);
  status.textContent = 'Nie udało się wczytać modelu 3D. Odśwież stronę.';
});
