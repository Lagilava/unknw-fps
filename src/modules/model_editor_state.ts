const MODEL_EDITOR_STORAGE_KEY = "room-breach-model-editor-v1";
const MODEL_EDITOR_CHANGE_EVENT = "room-breach-model-editor-change";

interface Vec3Like { x?: number; y?: number; z?: number; }
interface PresetLike {
  position?: Vec3Like; rotation?: Vec3Like;
  scale?: number; fitHeight?: number; rootYaw?: number;
}

function cloneVector3(next: Vec3Like = {}) {
  return {
    x: Number.isFinite(next.x) ? next.x : 0,
    y: Number.isFinite(next.y) ? next.y : 0,
    z: Number.isFinite(next.z) ? next.z : 0,
  };
}

function clonePreset(next: PresetLike = {}, fallback: PresetLike | null = null) {
  const source: PresetLike = fallback || {};
  return {
    position: cloneVector3(next.position || source.position),
    rotation: cloneVector3(next.rotation || source.rotation),
    scale: Number.isFinite(next.scale) ? next.scale : (Number.isFinite(source.scale) ? source.scale : 1),
    fitHeight: Number.isFinite(next.fitHeight) ? next.fitHeight : (Number.isFinite(source.fitHeight) ? source.fitHeight : 1),
    rootYaw: Number.isFinite(next.rootYaw) ? next.rootYaw : (Number.isFinite(source.rootYaw) ? source.rootYaw : 0),
  };
}

export const MODEL_EDITOR_KEYS = ["angel", "clone", "player"];

export const DEFAULT_MODEL_EDITOR_STATE = {
  angel: {
    position: { x: 0, y: 0.05, z: 0 },
    rotation: { x: 0, y: 0.05, z: 0 },
    scale: 1,
    fitHeight: 1.848,
    rootYaw: 0,
  },
  clone: {
    position: { x: 0, y: 0, z: 0 },
    rotation: { x: 0, y: -0.08, z: 0 },
    scale: 1,
    fitHeight: 1.65,
    rootYaw: 0,
  },
  player: {
    position: { x: 0, y: 0, z: 0 },
    rotation: { x: 0, y: 0.12, z: 0 },
    scale: 1,
    fitHeight: 1.65,
    rootYaw: 0,
  },
};

const LEGACY_PREVIEW_DEFAULTS = {
  angel: { fitHeight: 2.3, scale: 1.05 },
  clone: { fitHeight: 2.05, scale: 1 },
  player: { fitHeight: 2.25, scale: 1 },
};

export function createDefaultModelEditorState() {
  return {
    angel: clonePreset({}, DEFAULT_MODEL_EDITOR_STATE.angel),
    clone: clonePreset({}, DEFAULT_MODEL_EDITOR_STATE.clone),
    player: clonePreset({}, DEFAULT_MODEL_EDITOR_STATE.player),
  };
}

export function sanitizeModelEditorState(next) {
  const fallback = createDefaultModelEditorState();
  const source = next && typeof next === "object" ? next : {};
  const safe = {
    angel: clonePreset(source.angel, fallback.angel),
    clone: clonePreset(source.clone, fallback.clone),
    player: clonePreset(source.player, fallback.player),
  };
  for (const key of MODEL_EDITOR_KEYS) {
    const legacy = LEGACY_PREVIEW_DEFAULTS[key];
    const preset = safe[key];
    if (!legacy || !preset) continue;
    if (Math.abs(preset.fitHeight - legacy.fitHeight) < 0.0001 && Math.abs(preset.scale - legacy.scale) < 0.0001) {
      preset.fitHeight = fallback[key].fitHeight;
      preset.scale = fallback[key].scale;
    }
  }
  return safe;
}

export function loadModelEditorState(key = MODEL_EDITOR_STORAGE_KEY) {
  try {
    const raw = localStorage.getItem(key);
    if (!raw) return createDefaultModelEditorState();
    return sanitizeModelEditorState(JSON.parse(raw));
  } catch (_) {
    return createDefaultModelEditorState();
  }
}

export function saveModelEditorState(next, key = MODEL_EDITOR_STORAGE_KEY) {
  const safe = sanitizeModelEditorState(next);
  try {
    localStorage.setItem(key, JSON.stringify(safe));
  } catch (_) {}
  return safe;
}

export function resetModelEditorState(key = MODEL_EDITOR_STORAGE_KEY) {
  return saveModelEditorState(createDefaultModelEditorState(), key);
}

export function subscribeModelEditorState(handler, key = MODEL_EDITOR_STORAGE_KEY) {
  if (typeof window === "undefined" || typeof handler !== "function") return () => {};

  const handleStorage = (event) => {
    if (event.key !== key || event.storageArea !== localStorage) return;
    handler(loadModelEditorState(key));
  };

  const handleCustom = (event) => {
    handler(sanitizeModelEditorState(event.detail));
  };

  window.addEventListener("storage", handleStorage);
  window.addEventListener(MODEL_EDITOR_CHANGE_EVENT, handleCustom);

  return () => {
    window.removeEventListener("storage", handleStorage);
    window.removeEventListener(MODEL_EDITOR_CHANGE_EVENT, handleCustom);
  };
}

export function captureModelEditorBase(root) {
  if (!root?.position || !root?.rotation || !root?.scale) return null;
  root.userData.modelEditorBase = {
    position: root.position.clone(),
    rotation: root.rotation.clone(),
    scale: root.scale.clone(),
    height: Number.isFinite(root.userData.modelEditorHeight) && root.userData.modelEditorHeight > 0 ? root.userData.modelEditorHeight : null,
  };
  return root.userData.modelEditorBase;
}

export function applyModelEditorTransform(root, modelKey, state = loadModelEditorState()) {
  if (!root) return null;
  const preset = sanitizeModelEditorState(state)[modelKey] || createDefaultModelEditorState()[modelKey];
  const base = root.userData.modelEditorBase || captureModelEditorBase(root);
  if (!base) return null;

  root.position.copy(base.position);
  root.position.x += preset.position.x;
  root.position.y += preset.position.y;
  root.position.z += preset.position.z;

  const baseHeight = Number.isFinite(base.height) && base.height > 0 ? base.height : null;
  const fitScale = baseHeight ? (preset.fitHeight / baseHeight) : 1;
  const scaleMul = fitScale * (Number.isFinite(preset.scale) ? preset.scale : 1);
  root.scale.copy(base.scale).multiplyScalar(scaleMul);

  root.rotation.set(
    base.rotation.x + preset.rotation.x,
    base.rotation.y + preset.rotation.y + (preset.rootYaw || 0),
    base.rotation.z + preset.rotation.z,
  );
  root.updateMatrixWorld(true);
  return root;
}

export function getModelEditorPreset(modelKey, state = loadModelEditorState()) {
  return sanitizeModelEditorState(state)[modelKey] || createDefaultModelEditorState()[modelKey];
}

export { MODEL_EDITOR_STORAGE_KEY, MODEL_EDITOR_CHANGE_EVENT };
