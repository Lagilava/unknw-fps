// Stable locomotion framing: follow actual travel without a repeating gait cycle.
export const dampCamera = (current: number, target: number, rate: number, dt: number) =>
  current + (target - current) * -Math.expm1(-rate * Math.max(0, dt));

export function createMovementCamera() {
  return { initialized: false, worldX: 0, worldZ: 0, eyeY: 0, x: 0, z: 0 };
}

export function updateMovementCamera(state: ReturnType<typeof createMovementCamera>, input: {
  x: number; y: number; z: number; yaw: number; maxSpeed: number;
  ads: number; active: boolean; grounded: boolean; dt: number;
}) {
  const { x, y, z, yaw, maxSpeed, ads, active, grounded, dt } = input;
  const dx = x - state.worldX, dz = z - state.worldZ;
  // Respawns, teleports and long suspended frames must never drag the view.
  if (!state.initialized || !active || dt <= 0 || dt > 0.1 || Math.hypot(dx, dz) > 3) {
    state.initialized = true;
    state.eyeY = y;
    state.x = state.z = 0;
    state.worldX = x;
    state.worldZ = z;
    return { x: 0, y: 0, z: 0 };
  }
  const vx = dx / dt, vz = dz / dt;
  const scale = Math.max(1, maxSpeed);
  const lateral = Math.max(-1, Math.min(1, (vx * Math.cos(yaw) - vz * Math.sin(yaw)) / scale));
  const speed = Math.min(1, Math.hypot(vx, vz) / scale);
  // Small, bounded translation eases into travel and settles completely at rest.
  // ADS removes the offset; mouse aim is never filtered.
  const attenuation = 1 - Math.max(0, Math.min(1, ads));
  state.x = dampCamera(state.x, -lateral * 0.025 * attenuation, 10, dt);
  state.z = dampCamera(state.z, speed * 0.025 * attenuation, 10, dt);
  state.eyeY = dampCamera(state.eyeY, y, grounded ? 20 : 30, dt);
  state.worldX = x;
  state.worldZ = z;
  return { x: state.x, y: state.eyeY - y, z: state.z };
}

// Retract immediately for safety; ease back out when an obstruction clears.
// Smoothing the scalar boom length keeps the result on the collision-tested ray.
export function smoothCameraBoom(current: number, safe: number, dt: number) {
  return safe < current ? safe : dampCamera(current, safe, 7, dt);
}
