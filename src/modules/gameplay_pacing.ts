// Shared by simulation and HUD so the displayed objective cannot drift.
export const RELAY_UPLOAD_SECONDS = 7;

// Preserve elapsed gameplay time below 40 FPS without taking oversized collision
// steps. Long stalls drop excess time instead of creating a catch-up death spiral.
export function simulationFrame(rawDt: number) {
  const elapsed = Number.isFinite(rawDt) ? Math.max(0, Math.min(rawDt, 0.1)) : 0;
  const steps = Math.max(1, Math.ceil(elapsed / 0.025));
  return { steps, dt: elapsed / steps };
}
