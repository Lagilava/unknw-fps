export interface EncounterContact {
  alive: boolean; aggroed: boolean; mesh: { position: { x: number; z: number } };
}

/** Staggered approaches give fights breathing room and end straggler hunts. */
export function createEncounterDirector() {
  let key = '', elapsed = 0, nextPush = 4;
  return <T extends EncounterContact>(dt: number, encounter: string, enemies: Iterable<T>, x: number, z: number) => {
    if (key !== encounter) { key = encounter; elapsed = 0; nextPush = 4; }
    elapsed += Math.max(0, Math.min(dt, .1));
    if (elapsed < nextPush) return [] as T[];
    nextPush = elapsed + 7;
    const alive = Array.from(enemies).filter(e => e.alive);
    const distance = (e: T) => Math.hypot(e.mesh.position.x - x, e.mesh.position.z - z);
    if (alive.length <= 3 && elapsed >= 11) return alive.filter(e => !e.aggroed || distance(e) > 18);
    const nearby = alive.filter(e => e.aggroed && distance(e) < 22).length;
    const slots = Math.max(0, 3 - nearby);
    return alive.filter(e => !e.aggroed || distance(e) > 30)
      .sort((a, b) => distance(a) - distance(b)).slice(0, Math.min(2, slots));
  };
}
