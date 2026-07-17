export const SETTINGS_STORAGE_KEY = "room-breach-settings-v2";

export function loadSettings(key = SETTINGS_STORAGE_KEY) {
  try {
    const raw = localStorage.getItem(key);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === "object" ? parsed : null;
  } catch (_) {
    return null;
  }
}

export function saveSettings(next, key = SETTINGS_STORAGE_KEY) {
  try {
    localStorage.setItem(key, JSON.stringify({ ...(loadSettings(key) || {}), ...next }));
  } catch (_) {}
}
