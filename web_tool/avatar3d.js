import * as THREE from './libs/build/three.module.js';
import { GLTFLoader } from './libs/examples/jsm/loaders/GLTFLoader.js';

const avatarCanvas = document.getElementById('avatarCanvas');
const avatarModelName = document.getElementById('avatarLabel');
const avatarLipSyncState = document.getElementById('avatarStatus');

if (!avatarCanvas || !avatarModelName || !avatarLipSyncState) {
    throw new Error('Avatar 3D page is missing required DOM elements');
}

const DEFAULT_AVATAR_MODEL_URL = '../live3d-model/andry_3d/avatar_animasi.glb';
const DEFAULT_AVATAR_MODEL_NAME = 'andry_3d';

const avatarState = {
    renderer: null,
    scene: null,
    camera: null,
    model: null,
    mixer: null,
    clock: new THREE.Clock(),
    analyser: null,
    audioContext: null,
    audioSource: null,
    audioElement: null,
    lipSyncNodes: [],
    mouthValue: 0,
    animationFrame: 0,
    baseModelY: 0,
    baseModelYaw: THREE.MathUtils.degToRad(25),
};

function isValidAudioElement(audioElement) {
    if (!audioElement || !(audioElement instanceof HTMLMediaElement)) {
        return false;
    }

    return Boolean(audioElement.currentSrc || audioElement.src);
}

function findAudioElementsInDocument(doc) {
    const elements = [];
    if (!doc) {
        return elements;
    }

    try {
        const pageAudio = doc.querySelectorAll('audio');
        for (const audio of pageAudio) {
            elements.push(audio);
        }
    } catch {
        // Ignore cross-document access errors.
    }

    return elements;
}

function findAudioElementInFrame(frame, visited = new Set()) {
    if (!frame || visited.has(frame)) {
        return null;
    }

    visited.add(frame);

    try {
        const doc = frame.document || frame.documentElement;
        const found = findAudioElementsInDocument(frame.document || frame);
        for (const audio of found) {
            if (isValidAudioElement(audio)) {
                return audio;
            }
        }
    } catch {
        // Ignore cross-access restrictions.
    }

    if (frame.frames) {
        for (let i = 0; i < frame.frames.length; i += 1) {
            const nested = findAudioElementInFrame(frame.frames[i], visited);
            if (nested) {
                return nested;
            }
        }
    }

    return null;
}

function getAudioPlayerElement() {
    const candidates = [];

    try {
        if (window.parent && window.parent !== window) {
            candidates.push(...findAudioElementsInDocument(window.parent.document));
            const parentFrameAudio = findAudioElementInFrame(window.parent);
            if (parentFrameAudio) {
                candidates.push(parentFrameAudio);
            }
        }
    } catch {
        // Ignore cross-document access errors and continue searching locally.
    }

    candidates.push(...findAudioElementsInDocument(document));

    for (const candidate of candidates) {
        if (isValidAudioElement(candidate)) {
            return candidate;
        }
    }

    return candidates[0] || document.getElementById('audioPlayer') || document.querySelector('audio');
}

function attachAudioElement(audioElement) {
    if (!audioElement) {
        return;
    }

    if (avatarState.audioElement === audioElement) {
        return;
    }

    const currentIsEmpty = avatarState.audioElement && !isValidAudioElement(avatarState.audioElement);
    const candidateIsValid = isValidAudioElement(audioElement);
    if (!candidateIsValid && avatarState.audioElement && !currentIsEmpty) {
        return;
    }

    if (avatarState.audioElement) {
        avatarState.audioElement.removeEventListener('play', ensureAudioGraph);
        avatarState.audioElement.removeEventListener('play', startLipSync);
        avatarState.audioElement.removeEventListener('pause', resetLipSync);
        avatarState.audioElement.removeEventListener('ended', resetLipSync);
    }

    avatarState.audioElement = audioElement;
    avatarState.audioElement.addEventListener('play', ensureAudioGraph);
    avatarState.audioElement.addEventListener('play', startLipSync);
    avatarState.audioElement.addEventListener('pause', resetLipSync);
    avatarState.audioElement.addEventListener('ended', resetLipSync);

    if (!avatarState.audioElement.paused && !avatarState.audioElement.ended) {
        ensureAudioGraph();
        startLipSync();
    }
}

function scanForAudioElement() {
    const parentAudio = (() => {
        try {
            return window.parent !== window ? window.parent.document.querySelector('audio') : null;
        } catch {
            return null;
        }
    })();

    const candidates = [
        parentAudio,
        getAudioPlayerElement(),
        document.getElementById('audioPlayer'),
        document.querySelector('audio'),
    ];

    for (const candidate of candidates) {
        if (candidate) {
            attachAudioElement(candidate);
            if (isValidAudioElement(candidate)) {
                return;
            }
        }
    }
}

function createScene() {
    const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    renderer.setSize(avatarCanvas.clientWidth, avatarCanvas.clientHeight, false);

    const scene = new THREE.Scene();
    scene.fog = new THREE.Fog(0x101827, 8, 22);

    const camera = new THREE.PerspectiveCamera(35, avatarCanvas.clientWidth / avatarCanvas.clientHeight, 0.1, 100);
    camera.position.set(0, 1.55, 3.2);

    scene.add(new THREE.AmbientLight(0xffffff, 1.8));

    const key = new THREE.DirectionalLight(0xffffff, 2.4);
    key.position.set(2.5, 3.5, 4.5);
    scene.add(key);

    const fill = new THREE.DirectionalLight(0x8fb8ff, 0.9);
    fill.position.set(-3, 1.5, 2);
    scene.add(fill);

    const stage = new THREE.Mesh(
        new THREE.CircleGeometry(2.2, 48),
        new THREE.MeshStandardMaterial({ color: 0x0f172a, metalness: 0.1, roughness: 0.9 }),
    );
    stage.rotation.x = -Math.PI / 2;
    stage.position.y = -1.25;
    scene.add(stage);

    renderer.domElement.style.position = 'absolute';
    renderer.domElement.style.left = '0';
    renderer.domElement.style.top = '0';
    renderer.domElement.style.width = '100%';
    renderer.domElement.style.height = '100%';
    renderer.domElement.style.display = 'block';
    avatarCanvas.replaceChildren(renderer.domElement);

    avatarState.renderer = renderer;
    avatarState.scene = scene;
    avatarState.camera = camera;
}

function fitModel(root) {
    const box = new THREE.Box3().setFromObject(root);
    const size = box.getSize(new THREE.Vector3());
    const center = box.getCenter(new THREE.Vector3());

    root.position.x -= center.x;
    root.position.y -= center.y - size.y * 0.42;
    root.position.z -= center.z;

    const maxAxis = Math.max(size.x, size.y, size.z) || 1;
    root.scale.setScalar(2.45 / maxAxis);
}

function collectLipSyncNodes(root) {
    const nodes = [];
    const mouthTargets = [
        'mouthOpen',
        'jawOpen',
        'mouthClose',
        'mouthFrownLeft',
        'mouthFrownRight',
        'mouthPucker',
        'mouthSmile',
        'mouthSmileLeft',
        'mouthSmileRight',
        'viseme_aa',
        'viseme_E',
        'viseme_I',
        'viseme_O',
        'viseme_U',
    ];

    root.traverse((child) => {
        if (!child.isMesh || !child.morphTargetDictionary || !child.morphTargetInfluences) {
            return;
        }

        const dictionary = child.morphTargetDictionary;
        const matchedTargets = mouthTargets
            .map((name) => ({ name, index: dictionary[name] }))
            .filter((entry) => entry.index !== undefined);

        for (const target of matchedTargets) {
            nodes.push({ mesh: child, index: target.index, name: target.name });
        }
    });

    return nodes;
}

function resetLipSync() {
    if (avatarState.animationFrame) {
        cancelAnimationFrame(avatarState.animationFrame);
        avatarState.animationFrame = 0;
    }

    for (const node of avatarState.lipSyncNodes) {
        if (node.mesh.morphTargetInfluences) {
            node.mesh.morphTargetInfluences[node.index] = 0;
        }
    }

    avatarState.mouthValue = 0;
}

function startLipSync() {
    if (!avatarState.audioElement || !avatarState.analyser) {
        return;
    }

    if (avatarState.animationFrame) {
        cancelAnimationFrame(avatarState.animationFrame);
    }

    avatarState.animationFrame = requestAnimationFrame(driveLipSync);
}

function stopCurrentAnimation() {
    if (!avatarState.mixer) {
        return;
    }

    avatarState.mixer.stopAllAction();
    avatarState.mixer.uncacheRoot(avatarState.model);
    avatarState.mixer = null;
}

function ensureAudioGraph() {
    avatarState.audioElement = getAudioPlayerElement();

    if (!avatarState.audioElement) {
        return;
    }

    if (!avatarState.audioContext) {
        avatarState.audioContext = new (window.AudioContext || window.webkitAudioContext)();
    }

    if (!avatarState.audioSource || avatarState.audioElement !== avatarState.audioSource.mediaElement) {
        if (avatarState.audioSource) {
            avatarState.audioSource.disconnect();
        }

        avatarState.audioSource = avatarState.audioContext.createMediaElementSource(avatarState.audioElement);
        avatarState.analyser = avatarState.audioContext.createAnalyser();
        avatarState.analyser.fftSize = 1024;
        avatarState.audioSource.connect(avatarState.analyser);
        avatarState.analyser.connect(avatarState.audioContext.destination);
    }

    if (avatarState.audioContext.state === 'suspended') {
        avatarState.audioContext.resume();
    }
}

function driveLipSync() {
    if (!avatarState.analyser || !avatarState.audioElement || avatarState.audioElement.paused || avatarState.audioElement.ended) {
        resetLipSync();
        avatarState.animationFrame = requestAnimationFrame(driveLipSync);
        return;
    }

    const bufferLength = avatarState.analyser.frequencyBinCount;
    const dataArray = new Uint8Array(bufferLength);
    avatarState.analyser.getByteFrequencyData(dataArray);

    let sum = 0;
    for (let index = 0; index < bufferLength; index += 1) {
        sum += dataArray[index];
    }

    const rawLevel = (sum / bufferLength) / 255;
    const mouthLevel = Math.min(1, Math.max(0, rawLevel * 2.8));
    avatarState.mouthValue = avatarState.mouthValue * 0.7 + mouthLevel * 0.3;

    for (const node of avatarState.lipSyncNodes) {
        if (node.mesh.morphTargetInfluences) {
            node.mesh.morphTargetInfluences[node.index] = avatarState.mouthValue;
        }
    }

    avatarState.animationFrame = requestAnimationFrame(driveLipSync);
}

function loadAvatar(modelUrl, modelName) {
    avatarModelName.textContent = modelName;
    avatarLipSyncState.textContent = 'Loading';

    const loader = new GLTFLoader();
    loader.load(
        modelUrl,
        (gltf) => {
            if (avatarState.model) {
                avatarState.scene.remove(avatarState.model);
            }

            stopCurrentAnimation();

            avatarState.model = gltf.scene;
            fitModel(avatarState.model);
            avatarState.baseModelY = avatarState.model.position.y;
            avatarState.model.rotation.y = avatarState.baseModelYaw;
            avatarState.scene.add(avatarState.model);
            avatarState.lipSyncNodes = collectLipSyncNodes(avatarState.model);

            if (gltf.animations && gltf.animations.length > 0) {
                avatarState.mixer = new THREE.AnimationMixer(avatarState.model);
                const preferredClip = gltf.animations.find((clip) => /idle|rest|stand|breath/i.test(clip.name)) || gltf.animations[0];
                const action = avatarState.mixer.clipAction(preferredClip);
                action.reset();
                action.play();
            }

            const lipSyncStatus = avatarState.lipSyncNodes.length > 0 ? 'Ready' : 'No morph target found';
            avatarLipSyncState.textContent = gltf.animations && gltf.animations.length > 0
                ? `${lipSyncStatus} | Animating`
                : `${lipSyncStatus} | Idle sway`;
        },
        undefined,
        (error) => {
            avatarLipSyncState.textContent = 'Model load failed';
            console.error('Failed to load 3D avatar:', error);
        },
    );
}

function renderAvatar() {
    if (!avatarState.renderer || !avatarState.scene || !avatarState.camera) {
        return;
    }

    const delta = avatarState.clock.getDelta();
    if (avatarState.mixer) {
        avatarState.mixer.update(delta);
    } else if (avatarState.model) {
        const elapsed = avatarState.clock.elapsedTime;
        avatarState.model.position.y = avatarState.baseModelY + Math.sin(elapsed * 1.3) * 0.03;
        avatarState.model.rotation.y = avatarState.baseModelYaw;
    }

    avatarState.renderer.render(avatarState.scene, avatarState.camera);
    requestAnimationFrame(renderAvatar);
}

async function initializeAvatarViewer() {
    createScene();
    renderAvatar();
    scanForAudioElement();

    setInterval(scanForAudioElement, 2000);

    avatarModelName.textContent = DEFAULT_AVATAR_MODEL_NAME;

    try {
        const response = await fetch(`${window.location.origin}/live3d-models/info`);
        if (!response.ok) {
            throw new Error('Unable to fetch 3D model info');
        }

        const payload = await response.json();
        const modelInfo = payload.characters?.[0];

        if (!modelInfo?.model_path) {
            loadAvatar(DEFAULT_AVATAR_MODEL_URL, DEFAULT_AVATAR_MODEL_NAME);
            return;
        }

        loadAvatar(`${window.location.origin}/${modelInfo.model_path}`, modelInfo.name || DEFAULT_AVATAR_MODEL_NAME);
    } catch (error) {
        console.error(error);
        loadAvatar(DEFAULT_AVATAR_MODEL_URL, DEFAULT_AVATAR_MODEL_NAME);
    }
}

window.addEventListener('resize', () => {
    if (!avatarState.renderer || !avatarState.camera) {
        return;
    }

    avatarState.camera.aspect = avatarCanvas.clientWidth / avatarCanvas.clientHeight;
    avatarState.camera.updateProjectionMatrix();
    avatarState.renderer.setSize(avatarCanvas.clientWidth, avatarCanvas.clientHeight, false);
});

initializeAvatarViewer();