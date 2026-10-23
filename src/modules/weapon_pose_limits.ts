// Visual weapon/rig aim has a deliberately narrow anatomical envelope.
// Camera look and shot direction remain free so looking vertically still works.
export const MAX_WEAPON_ELEVATION = 7 * Math.PI / 180;
export function limitWeaponElevation(pitch: number) {
  return Math.max(-MAX_WEAPON_ELEVATION,Math.min(MAX_WEAPON_ELEVATION,Number.isFinite(pitch)?pitch:0));
}
