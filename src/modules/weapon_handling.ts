import type { GunState } from './gun_config';

export function beginWeaponReload(state: GunState): boolean {
  if (state.reloadTimer > 0 || state.mag >= state.magSize || state.ammo <= 0) return false;
  state.reloadDuration = Math.max(.05, state.reloadTime);
  state.reloadTimer = state.reloadDuration;
  return true;
}

export function cancelWeaponReload(state: GunState) {
  state.reloadTimer = 0;
  state.isAutoReloading = false;
}

// Ammo transfers exactly once, at completion; cancellation never grants ammo.
export function advanceWeaponReload(state: GunState, dt: number): boolean {
  if (state.reloadTimer <= 0 || !Number.isFinite(dt) || dt <= 0) return false;
  state.reloadTimer = Math.max(0, state.reloadTimer - dt);
  if (state.reloadTimer > 0) return false;
  const take = Math.max(0, Math.min(state.magSize - state.mag, state.ammo));
  state.mag += take;
  state.ammo -= take;
  state.isAutoReloading = false;
  return true;
}

export function weaponReloadProgress(state: GunState): number {
  return Math.max(0, Math.min(1, 1 - state.reloadTimer / Math.max(.05, state.reloadDuration)));
}

// Convert screen pixels to the camera-plane tangent offsets used by shot rays.
export function aimCursorTangents(x: number, y: number, width: number, height: number, fov: number, aspect: number) {
  const halfHeight = Math.tan(fov * Math.PI / 360);
  return { x: x / Math.max(1, width * .5) * halfHeight * aspect,
    y: -y / Math.max(1, height * .5) * halfHeight };
}

export function adsLookScale(fov: number, hipFov: number): number {
  return Math.max(.05, Math.min(1, Math.tan(fov * Math.PI / 360) / Math.tan(hipFov * Math.PI / 360)));
}

export function dampAds(current: number, target: number, speed: number, dt: number): number {
  return current + (target - current) * (1 - Math.exp(-Math.max(0, speed) * Math.max(0, dt)));
}
