import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';

const layout = document.querySelector('.layout');
const photo = document.querySelector('#photo');
const model = document.querySelector('#model');
const photoButton = document.querySelector('#show-photo');
const modelButton = document.querySelector('#show-model');
const viewport = document.querySelector('#viewport');
const poster = document.querySelector('#poster');
const status = document.querySelector('#status');
const zoomTools = document.querySelector('#zoom-tools');
const zoomOut = document.querySelector('#zoom-out');
const zoomIn = document.querySelector('#zoom-in');
const zoomLevel = document.querySelector('#zoom-level');
const patternNavigation = document.querySelector('#pattern-navigation');
const previousPattern = document.querySelector('#previous-pattern');
const nextPattern = document.querySelector('#next-pattern');
const patternCaption = document.querySelector('#pattern-caption');

let loading = false;

function selectMode(showModel) {
  layout.classList.toggle('layout--model', showModel);
  photo.hidden = showModel;
  model.hidden = !showModel;
  photoButton.setAttribute('aria-pressed', String(!showModel));
  modelButton.setAttribute('aria-pressed', String(showModel));

  if (showModel && !loading) {
    loading = true;
    status.textContent = 'Wczytuję model 3D…';
    initViewer().catch((error) => {
      console.error(error);
      status.textContent = 'Podgląd 3D jest niedostępny. Możesz obejrzeć wizualizację i zapisany kadr sali.';
    });
  }
}

photoButton.addEventListener('click', () => selectMode(false));
modelButton.addEventListener('click', () => selectMode(true));

function bakedMaterial({ albedo, lightmap, scale, hasLightUV, brass, plaster, wallFace, pattern }) {
  return new THREE.ShaderMaterial({
    side: THREE.DoubleSide,
    uniforms: {
      albedo: { value: albedo },
      lightmap: { value: lightmap },
      lightScale: { value: scale },
      brass: { value: brass },
      plaster: { value: plaster },
      wallPattern: pattern.texture,
      incomingPattern: pattern.incoming,
      slideOffset: pattern.offset,
      hasWallPattern: pattern.enabled,
    },
    defines: {
      ...(hasLightUV ? { LIGHT_UV_SECONDARY: 1, USE_UV1: 1 } : {}),
      ...(wallFace ? { SMOOTH_VAULT_EDGE: 1 } : {}),
    },
    vertexShader: `
      varying vec2 bakedUV;
      varying vec2 paintUV;
      void main() {
        #ifdef LIGHT_UV_SECONDARY
          bakedUV = uv1;
        #else
          bakedUV = uv;
        #endif
        paintUV = uv;
        gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
      }
    `,
    fragmentShader: `
      uniform sampler2D albedo;
      uniform sampler2D lightmap;
      uniform float lightScale;
      uniform bool brass;
      uniform bool plaster;
      uniform sampler2D wallPattern;
      uniform sampler2D incomingPattern;
      uniform float slideOffset;
      uniform bool hasWallPattern;
      varying vec2 bakedUV;
      varying vec2 paintUV;
      void main() {
        // Match the power curve used by the Blender texture export.
        vec3 pigment = pow(texture2D(albedo, bakedUV).rgb, vec3(2.2));
        vec3 lighting = pow(texture2D(lightmap, bakedUV, 1.7).rgb, vec3(2.2)) * lightScale;
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
          if (fromArch < 0.075 && abs(determinant) > 1e-9) {
            vec2 bakeDown = (bakeDy * paintDx.x - bakeDx * paintDy.x) / determinant;
            vec2 innerUV = bakedUV + bakeDown * (0.075 - fromArch);
            vec3 innerLight = pow(texture2D(lightmap, innerUV, 1.7).rgb, vec3(2.2)) * lightScale;
            float fringe = 1.0 - smoothstep(0.012, 0.075, fromArch);
            lighting = mix(lighting, min(lighting, innerLight), fringe);
          }
        #endif
        if (hasWallPattern) {
          vec4 currentPaint = texture2D(wallPattern, paintUV);
          vec3 current = mix(pigment, pow(currentPaint.rgb, vec3(2.2)), currentPaint.a);
          if (slideOffset != 0.0) {
            // Reveal the next pattern without moving its UV alignment to the wall.
            vec4 incomingPaint = texture2D(incomingPattern, paintUV);
            vec3 incoming = mix(pigment, pow(incomingPaint.rgb, vec3(2.2)), incomingPaint.a);
            float edge = slideOffset > 0.0 ? 1.0 - slideOffset : -slideOffset;
            float reveal = smoothstep(edge - 0.035, edge + 0.035, paintUV.x);
            current = mix(current, incoming, slideOffset > 0.0 ? reveal : 1.0 - reveal);
          }
          pigment = current;
        }
        // Metallic highlights are absent from the diffuse bake.
        if (brass) pigment = vec3(0.29, 0.20, 0.105);
        // Suppress bright bake artifacts where the vault meets the walls.
        float peak = max(lighting.r, max(lighting.g, lighting.b));
        if (plaster && peak > 0.32) {
          float excess = peak - 0.32;
          lighting *= (0.32 + excess / (1.0 + 4.0 * excess)) / peak;
        }
        vec3 previewLight = vec3(0.12, 0.105, 0.088) + min(lighting, vec3(3.0));
        gl_FragColor = vec4(pigment * previewLight, 1.0);
        #include <tonemapping_fragment>
        #include <colorspace_fragment>
      }
    `,
  });
}

async function initViewer() {
  const [response, patternResponse] = await Promise.all([
    fetch('./manifest.json'),
    fetch('./wzory/psd.json', { cache: 'no-cache' }),
  ]);
  if (!response.ok) throw new Error('Nie można odczytać manifestu modelu.');
  const manifest = await response.json();
  const catalog = patternResponse.ok ? await patternResponse.json() : {};
  const patterns = catalog.S ?? [];
  const scene = new THREE.Scene();
  scene.background = new THREE.Color('#b5aa9d');

  const roomCamera = new THREE.PerspectiveCamera(73, .75, .035, 30);
  const front = manifest.cameras.find((pose) => pose.name === 'Mural_front');
  roomCamera.position.fromArray(front.pos);
  roomCamera.lookAt(new THREE.Vector3().fromArray(front.target));

  const loader = new THREE.TextureLoader();
  const [{ scene: room }, baked] = await Promise.all([
    new GLTFLoader().loadAsync('./wnetrze.glb'),
    Promise.all(Object.entries(manifest.objects).map(async ([name, entry]) => {
      const [albedo, lightmap] = await Promise.all([
        loader.loadAsync('./' + entry.alb),
        loader.loadAsync('./' + entry.lm),
      ]);
      albedo.flipY = false;
      lightmap.flipY = false;
      return [name, { albedo, lightmap, scale: entry.S }];
    })),
  ]);
  const emptyPattern = { texture: { value: null }, incoming: { value: null },
    offset: { value: 0 }, enabled: { value: false } };
  const wallPattern = {
    texture: { value: null },
    incoming: { value: null },
    offset: { value: 0 },
    enabled: { value: false },
  };
  for (const [name, textures] of baked) {
    room.getObjectByName(name).traverse((node) => {
      if (!node.isMesh || node.material.name === 'Zarowka') return;
      const materials = {
        ...textures,
        wallFace: name.startsWith('Sciana_') && node.material.name === name + '_mural',
        pattern: name === 'Sciana_S' && node.material.name === 'Sciana_S_mural'
          ? wallPattern : emptyPattern,
        hasLightUV: node.geometry.hasAttribute('uv1'),
        brass: node.material.name === 'Metal_zyrandol',
        plaster: name === 'Sklepienie' || name.startsWith('Sciana_') && /tynk|mural/i.test(node.material.name),
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
  const canvas = renderer.domElement;
  canvas.tabIndex = 0;
  canvas.setAttribute('aria-label', 'Model ściany S. Przeciągnij lub użyj Shift ze strzałkami, żeby obrócić widok. Strzałki lewo i prawo zmieniają wzór.');
  viewport.prepend(canvas);

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

  let index = -1;
  let busy = false;
  const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)');

  function animatePattern(direction) {
    return new Promise((resolve) => {
      let start;
      function frame(time) {
        start ??= time;
        const progress = Math.min((time - start) / 460, 1);
        wallPattern.offset.value = direction * progress * progress * (3 - 2 * progress);
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
      const texture = await loader.loadAsync(pattern.url);
      texture.flipY = false;
      texture.anisotropy = Math.min(renderer.capabilities.getMaxAnisotropy(), 8);

      if (direction && index >= 0 && !reducedMotion.matches) {
        wallPattern.incoming.value = texture;
        await animatePattern(direction);
      }

      const previousTexture = wallPattern.texture.value;
      wallPattern.texture.value = texture;
      wallPattern.enabled.value = true;
      wallPattern.offset.value = 0;
      wallPattern.incoming.value = null;
      previousTexture?.dispose();
      index = target;
      const label = pattern.label.replace(/^wzor\b/i, 'Wzór');
      patternCaption.textContent = label + ' · ' + (index + 1) + '/' + patterns.length + ' · Ściana S';
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

  function resizeCamera() {
    const { clientWidth, clientHeight } = viewport;
    if (clientWidth === 0 || clientHeight === 0) return;
    renderer.setSize(clientWidth, clientHeight, false);
    roomCamera.aspect = clientWidth / clientHeight;
    const { vfov, minHfov } = front;
    const portraitFov = minHfov
      ? THREE.MathUtils.radToDeg(2 * Math.atan(Math.tan(THREE.MathUtils.degToRad(minHfov / 2)) / roomCamera.aspect))
      : vfov;
    roomCamera.fov = Math.min(90, Math.max(vfov, portraitFov));
    roomCamera.updateProjectionMatrix();
  }

  new ResizeObserver(() => {
    if (viewport.clientWidth === 0 || viewport.clientHeight === 0) return;
    resizeCamera();
    render();
  }).observe(viewport);

  resizeCamera();
  poster.hidden = true;
  zoomTools.hidden = false;
  setZoom(1);
  status.textContent = '';
  patternNavigation.hidden = patterns.length < 2;
  if (patterns.length) showPattern(0);
}
