import * as THREE from '/web-tool/libs/build/three.module.js';
import { GLTFLoader } from '/web-tool/libs/examples/jsm/loaders/GLTFLoader.js';

const DEFAULT_MODEL_URL = '/live3d-model/andry_3d/avatar_animasi.glb';
const DEFAULT_MODEL_NAME = 'andry_3d';

const state = {
  renderer: null,
  scene: null,
  camera: null,
  model: null,
  analyser: null,
  audioContext: null,
  audioSource: null,
  audioElement: null,
  connectedElements: [],
  lipSyncNodes: [],
  mouthValue: 0,
  animationFrame: 0,
  root: null,
  mixer: null,
  clock: null,
  speakingTime: 0,
  gestureWeight: 0,
  initialized: false,
};

// Expose state early for external inspection and to allow late initialization.
try {
  window.andry3d = window.andry3d || {};
  window.andry3d.state = state;
} catch (e) {}

// Register callback for early-intercepted audio elements and process already created ones
try {
  window.__onAudioCreated = (audioElement) => {
    console.log('[avatar3d] Received audio from early interceptor:', audioElement);
    attachAudioElement(audioElement);
  };
  if (window.__audioElements && window.__audioElements.length > 0) {
    console.log('[avatar3d] Attaching to early-intercepted audio elements:', window.__audioElements);
    window.__audioElements.forEach(attachAudioElement);
  }
} catch (e) {
  console.error('[avatar3d] Failed to hook early audio interceptor:', e);
}

function ensureOverlayRoot() {
  let root = document.getElementById('andry-3d-overlay');
  if (root) {
    return root;
  }

  root = document.createElement('div');
  root.id = 'andry-3d-overlay';
  root.style.position = 'fixed';
  root.style.left = '16px';
  root.style.top = '16px';
  root.style.width = '380px';
  root.style.height = '520px';
  root.style.zIndex = '9';
  root.style.pointerEvents = 'none';
  root.style.borderRadius = '20px';
  root.style.overflow = 'hidden';
  root.style.boxShadow = '0 24px 60px rgba(0, 0, 0, 0.28)';
  root.style.background = 'radial-gradient(circle at top, #20304f 0%, #101725 60%, #050816 100%)';
  root.style.position = 'fixed';

  document.body.appendChild(root);

  state.root = root;
  return root;
}

function findSubtitleElement() {
  // Walk text nodes to locate active conversation subtitles
  const walk = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT, null, false);
  let node;
  while (node = walk.nextNode()) {
    const text = node.textContent.trim();
    if (text.includes("Conversation Started") || text.includes("Andri Avatar AI") || (text.length > 20 && (text.includes("Hi, I'm") || text.includes("Avatar")))) {
      let parent = node.parentElement;
      while (parent && parent !== document.body) {
        const rect = parent.getBoundingClientRect();
        if (rect.height > 10 && rect.width > 200) {
          return parent;
        }
        parent = parent.parentElement;
      }
    }
  }
  
  // Fallback to standard subtitle selectors
  const subtitleDiv = document.querySelector('[class*="subtitle"], [class*="Subtitle"], [class*="transcription"]');
  if (subtitleDiv) return subtitleDiv;

  return null;
}

function updateOverlayGeometry() {
  try {
    const liveCanvas = document.getElementById('canvas');
    const overlayRoot = document.getElementById('andry-3d-overlay');
    if (!overlayRoot) return;

    if (liveCanvas) {
      // Hide the Live2D canvas so it doesn't overlap with the 3D model
      liveCanvas.style.visibility = 'hidden';

      const rect = liveCanvas.getBoundingClientRect();
      
      // Integrated Mode: Full height, transparent background, behind UI
      overlayRoot.style.position = 'absolute';
      overlayRoot.style.left = rect.left + 'px';
      overlayRoot.style.top = rect.top + 'px';
      overlayRoot.style.width = rect.width + 'px';
      overlayRoot.style.height = rect.height + 'px';
      overlayRoot.style.background = 'transparent';
      overlayRoot.style.boxShadow = 'none';
      overlayRoot.style.borderRadius = '0px';
      overlayRoot.style.zIndex = '1'; // Behind React UI (subtitles, buttons, etc.)

      // Make all parent containers of the canvas transparent so the main page background is visible behind the 3D model
      let parent = liveCanvas.parentElement;
      while (parent && parent !== document.body) {
        parent.style.setProperty('background', 'transparent', 'important');
        parent.style.setProperty('background-color', 'transparent', 'important');
        parent = parent.parentElement;
      }
      
      // Update Three.js size and aspect ratio
      const w = overlayRoot.clientWidth;
      const h = overlayRoot.clientHeight;
      if (state.renderer) {
        state.renderer.setSize(w, h, false);
      }
      if (state.camera) {
        state.camera.aspect = w / Math.max(1, h);
        state.camera.updateProjectionMatrix();
      }
    }
  } catch (e) {
    console.warn('[avatar3d] geometry sync failed', e);
  }
}

function createScene() {
  const root = ensureOverlayRoot();
  const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
  renderer.setSize(root.clientWidth, root.clientHeight, false);
  renderer.domElement.style.width = '100%';
  renderer.domElement.style.height = '100%';
  renderer.domElement.style.display = 'block';
  renderer.domElement.style.position = 'absolute';
  renderer.domElement.style.left = '0';
  renderer.domElement.style.top = '0';
  renderer.domElement.style.pointerEvents = 'none';
  renderer.domElement.style.zIndex = '1';
  root.appendChild(renderer.domElement);

  const scene = new THREE.Scene();
  scene.fog = new THREE.Fog(0x111827, 8, 26);

  const camera = new THREE.PerspectiveCamera(35, root.clientWidth / Math.max(1, root.clientHeight), 0.1, 100);
  camera.position.set(0, 1.2, 3.2);

  scene.add(new THREE.AmbientLight(0xffffff, 1.7));

  const key = new THREE.DirectionalLight(0xffffff, 2.5);
  key.position.set(2.8, 4.1, 4.5);
  scene.add(key);

  const rim = new THREE.DirectionalLight(0x8ab4ff, 0.8);
  rim.position.set(-3, 1, 2);
  scene.add(rim);



  state.renderer = renderer;
  state.scene = scene;
  state.camera = camera;
  state.root = root;
  state.clock = new THREE.Clock();
  state.rootRotation = null;

  // Let geometry update function handle initial sizing
  updateOverlayGeometry();
}

function fitModel(root) {
  const box = new THREE.Box3().setFromObject(root);
  const size = box.getSize(new THREE.Vector3());
  const center = box.getCenter(new THREE.Vector3());

  root.position.x -= center.x;
  root.position.y -= center.y - size.y * 0.42;
  root.position.z -= center.z;

  const maxAxis = Math.max(size.x, size.y, size.z) || 1;
  root.scale.setScalar(1.8 / maxAxis);
}

function collectLipSyncNodes(root) {
  const nodes = [];
  root.traverse((child) => {
    if (!child.isMesh || !child.morphTargetDictionary || !child.morphTargetInfluences) {
      return;
    }

    const dictionary = child.morphTargetDictionary;
    const targetNames = [
      'mouthOpen',
      'jawOpen',
      'viseme_aa',
      'viseme_O',
      'viseme_U',
      'viseme_E',
      'viseme_I',
      'mouthSmile',
      'MouthOpen',
      'JawOpen'
    ];
    for (const name of targetNames) {
      if (dictionary[name] !== undefined) {
        nodes.push({ mesh: child, index: dictionary[name], name: name });
      }
    }
  });
  return nodes;
}

function resetLipSync() {
  state.mouthValue = 0;
}

function driveLipSync() {
  // Check if any of our connected audio elements are currently playing
  let anyPlaying = false;
  if (state.connectedElements && state.connectedElements.length > 0) {
    for (const el of state.connectedElements) {
      if (el && !el.paused && !el.ended) {
        anyPlaying = true;
        break;
      }
    }
  }

  if (!state.analyser || !anyPlaying) {
    resetLipSync();
    state.animationFrame = requestAnimationFrame(driveLipSync);
    return;
  }

  const bufferLength = state.analyser.frequencyBinCount;
  const dataArray = new Uint8Array(bufferLength);
  state.analyser.getByteFrequencyData(dataArray);

  let sum = 0;
  for (let index = 0; index < bufferLength; index += 1) {
    sum += dataArray[index];
  }

  const rawLevel = (sum / bufferLength) / 255;
  const mouthLevel = Math.min(1, Math.max(0, rawLevel * 2.6));
  state.mouthValue = state.mouthValue * 0.72 + mouthLevel * 0.28;

  if (state.mouthValue > 0.01) {
    console.log('[avatar3d] Speaking, mouthValue:', state.mouthValue.toFixed(3));
  }

  state.animationFrame = requestAnimationFrame(driveLipSync);
}

function attachAudioElement(audioElement) {
  if (!audioElement) {
    return;
  }

  if (state.audioElement !== audioElement) {
    state.audioElement = audioElement;
    audioElement.addEventListener('play', ensureAudioGraph);
    audioElement.addEventListener('pause', resetLipSync);
    audioElement.addEventListener('ended', resetLipSync);
  }

  // If already playing, ensure graph is set up
  if (!audioElement.paused) {
    ensureAudioGraph();
  }
}

function ensureAudioGraph() {
  if (!state.audioElement) {
    return;
  }

  if (!state.audioContext) {
    state.audioContext = new (window.AudioContext || window.webkitAudioContext)();
  }

  if (state.audioContext.state === 'suspended') {
    state.audioContext.resume();
  }

  if (!state.analyser) {
    state.analyser = state.audioContext.createAnalyser();
    state.analyser.fftSize = 1024;
    state.analyser.connect(state.audioContext.destination);
  }

  // Connect current audio element to the analyser if not already connected
  const element = state.audioElement;
  if (element && !state.connectedElements.includes(element)) {
    try {
      const source = state.audioContext.createMediaElementSource(element);
      source.connect(state.analyser);
      state.connectedElements.push(element);
      console.log('[avatar3d] Successfully connected intercepted audio element:', element);
    } catch (e) {
      console.warn('[avatar3d] Failed to connect audio element to Web Audio:', e);
    }
  }

  if (state.animationFrame === 0) {
    state.animationFrame = requestAnimationFrame(driveLipSync);
  }
}

function scanForAudioElement() {
  const candidate = document.querySelector('audio');
  if (candidate) {
    attachAudioElement(candidate);
  }
}

function loadAvatar(modelUrl, modelName) {
  const label = document.getElementById('andry-3d-overlay-label');
  if (label) {
    label.textContent = `3D: ${modelName}`;
  }

  const loader = new GLTFLoader();
  loader.load(
    modelUrl,
    (gltf) => {
      console.log('[avatar3d] gltf loaded, animations count=', gltf.animations ? gltf.animations.length : 0);
      if (state.model) {
        state.scene.remove(state.model);
      }

      state.model = gltf.scene;
      fitModel(state.model);
      // Rotate 40 degrees to the left (counter-clockwise from top view, 40 degrees)
      state.model.rotation.y = 40 * Math.PI / 180;
      // Position model lower to render naturally behind subtitles and fit appropriate sizing.
      state.model.position.y += -0.82;
      state.scene.add(state.model);
      state.lipSyncNodes = collectLipSyncNodes(state.model);
      
      // Discover and register key arm/hand bones for presenter gesturing animations
      state.avatarBones = {};
      state.initialBonesRotation = {};
      state.model.traverse((child) => {
        if (child.isBone) {
          const name = child.name;
          if ([
            'LeftArm', 'LeftForeArm', 'LeftHand',
            'RightArm', 'RightForeArm', 'RightHand',
            'LeftShoulder', 'RightShoulder'
          ].includes(name)) {
            state.avatarBones[name] = child;
            state.initialBonesRotation[name] = child.rotation.clone();
          }
        }
      });
      console.log('[avatar3d] Found skeleton bones for gesturing:', Object.keys(state.avatarBones));
      
      // Initialize viseme states dynamically based on the model's collected morph targets
      state.visemeWeights = {};
      state.visemeTargets = {};
      state.visemeTimer = 0;
      for (const node of state.lipSyncNodes) {
        const name = node.name;
        if (name !== 'mouthOpen' && name !== 'MouthOpen' && name !== 'jawOpen' && name !== 'JawOpen' && name !== 'mouthSmile') {
          state.visemeWeights[name] = 0;
          state.visemeTargets[name] = 0;
        }
      }
      console.log('[avatar3d] Initialized visemes:', Object.keys(state.visemeWeights));
      // Save current root rotation so we can prevent global rotation from animations
      try {
        state.rootRotation = state.model.rotation.clone();
      } catch (e) {
        state.rootRotation = null;
      }
      // Re-center camera to look at model center so it appears visually centered
      try {
        const box = new THREE.Box3().setFromObject(state.model);
        const center = box.getCenter(new THREE.Vector3());
        if (state.camera) {
          state.camera.lookAt(center.x, center.y * 0.6, center.z);
        }
      } catch (e) {
        // ignore
      }
      // If the GLTF contains animations, create a mixer and play them.
      if (gltf.animations && gltf.animations.length > 0) {
        console.log('GLTF animations found:', gltf.animations.map((a) => ({ name: a.name || '<noname>', duration: a.duration })));
        // ensure clock exists
        if (!state.clock) state.clock = new THREE.Clock();
        state.mixer = new THREE.AnimationMixer(state.model);
        gltf.animations.forEach((clip) => {
          try {
            const action = state.mixer.clipAction(clip);
            action.reset();
            action.enabled = true;
            action.setEffectiveWeight(1.0);
            action.setLoop(THREE.LoopRepeat);
            action.play();
            action.paused = false;
          } catch (e) {
            console.warn('Failed to play animation clip:', e);
          }
        });
        // Also try to play the first clip explicitly as a fallback
        try {
          const first = gltf.animations[0];
          const a = state.mixer.clipAction(first);
          a.reset();
          a.enabled = true;
          a.setEffectiveWeight(1.0);
          a.setLoop(THREE.LoopRepeat);
          a.play();
        } catch (e) {
          console.warn('Failed to explicitly play first clip', e);
        }
      } else {
        console.log('No GLTF animations present');
        state.mixer = null;
      }
    },
    undefined,
    (error) => {
      console.error('Failed to load 3D avatar:', error);
    },
  );
}

function render() {
  if (!state.renderer || !state.scene || !state.camera) {
    return;
  }


  // Advance animations if present, otherwise apply gentle idle rotation.
  const delta = state.clock ? state.clock.getDelta() : 0;
  if (state.mixer) {
    state.mixer.update(delta);
  }

  // Apply manual lip sync overrides after animation mixer has updated
  if (state.model && state.lipSyncNodes && state.lipSyncNodes.length > 0) {
    const isSpeaking = state.mouthValue > 0.05;
    
    if (isSpeaking) {
      state.visemeTimer = (state.visemeTimer || 0) - delta;
      if (state.visemeTimer <= 0) {
        // Reset all targets
        for (const k in state.visemeTargets) {
          state.visemeTargets[k] = 0.0;
        }
        // Choose one random viseme to activate
        const visemeKeys = Object.keys(state.visemeTargets || {});
        if (visemeKeys.length > 0) {
          const randomKey = visemeKeys[Math.floor(Math.random() * visemeKeys.length)];
          state.visemeTargets[randomKey] = 1.0;
        }
        state.visemeTimer = 0.08 + Math.random() * 0.12; // transition every 80-200ms
      }
    } else {
      // Set all targets to 0
      for (const k in state.visemeTargets) {
        state.visemeTargets[k] = 0.0;
      }
      state.visemeTimer = 0;
    }

    // Interpolate current weights towards targets
    for (const k in state.visemeWeights) {
      const target = state.visemeTargets[k] || 0;
      const current = state.visemeWeights[k] || 0;
      state.visemeWeights[k] = current + (target - current) * Math.min(1.0, delta * 18.0);
    }

    // Apply influences with natural limits (capping the mouth opening and viseme shapes to look more human and less exaggerated)
    for (const node of state.lipSyncNodes) {
      if (node.mesh.morphTargetInfluences) {
        const name = node.name;
        if (name === 'mouthOpen' || name === 'MouthOpen' || name === 'jawOpen' || name === 'JawOpen') {
          // Cap the maximum open level to 0.20 for a natural speaking voice (prevent opening too wide)
          node.mesh.morphTargetInfluences[node.index] = (state.mouthValue || 0) * 0.20;
        } else if (name === 'mouthSmile') {
          node.mesh.morphTargetInfluences[node.index] = 0.25; // keep a gentle friendly smile
        } else {
          // Visemes are modulated by the overall mouth volume level and scaled to 0.25 for realism (subtler shapes)
          const weight = state.visemeWeights[name] || 0;
          node.mesh.morphTargetInfluences[node.index] = weight * (state.mouthValue || 0) * 0.25;
        }
      }
    }


  }

  // Prevent unwanted rotation on the model root (keep it visually stable)
  if (state.model && state.rootRotation) {
    state.model.rotation.copy(state.rootRotation);
  }

  state.renderer.render(state.scene, state.camera);
  requestAnimationFrame(render);
}

function syncOverlayToLiveCanvas() {
  try {
    const liveCanvas = document.getElementById('canvas');
    if (!liveCanvas) return false;
    updateOverlayGeometry();
    return true;
  } catch (e) {
    return false;
  }
}
// expose for debugging and manual triggering
try { window.syncOverlayToLiveCanvas = syncOverlayToLiveCanvas; } catch (e) {}
// expose loader to allow manual triggering from page console
try { window.avatar3d_loadAvatar = loadAvatar; } catch (e) {}

async function initialize() {
  if (state.initialized) {
    console.log('[avatar3d] Already initialized, skipping duplicate initialize.');
    return;
  }
  state.initialized = true;
  console.log('[avatar3d] initialize start');
  try {
    ensureOverlayRoot();
    let liveCanvas = document.getElementById('canvas');
    let tries = 0;
    while (!liveCanvas && tries < 12) {
      await new Promise((r) => setTimeout(r, 200));
      liveCanvas = document.getElementById('canvas');
      tries += 1;
    }
    updateOverlayGeometry();
  } catch (e) {
    console.warn('[avatar3d] positioning failed', e);
  }

  createScene();
  // expose state for debugging in browser console
  try {
    window.andry3d = window.andry3d || {};
    window.andry3d.state = state;
  } catch (e) {}
  render();
  scanForAudioElement();

  setInterval(scanForAudioElement, 2000);
  // keep syncing overlay to the live canvas until it's aligned
  let syncTries = 0;
  const syncInterval = setInterval(() => {
    const ok = syncOverlayToLiveCanvas();
    syncTries += 1;
    if (ok || syncTries > 40) {
      clearInterval(syncInterval);
    }
  }, 250);

  try {
    const response = await fetch('/live3d-models/info');
    const payload = response.ok ? await response.json() : null;
    const modelInfo = payload?.characters?.[0];
    if (modelInfo?.model_path) {
      loadAvatar(`/${modelInfo.model_path}`, modelInfo.name || DEFAULT_MODEL_NAME);
      return;
    }
  } catch {
    // Fall back to the default model below.
  }

  loadAvatar(DEFAULT_MODEL_URL, DEFAULT_MODEL_NAME);
}

window.addEventListener('resize', () => {
  updateOverlayGeometry();
});

if (document.readyState === 'loading') {
  window.addEventListener('DOMContentLoaded', initialize, { once: true });
} else {
  initialize();
}

// Also try a delayed initialize after full load to cooperate with the main bundle.
window.addEventListener('load', () => setTimeout(() => { try { initialize(); } catch (e) {} }, 600));