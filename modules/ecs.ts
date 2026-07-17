// modules/ecs.ts — Phase 2 foundation.
// ─────────────────────────────────────────────────────────────────────────────
// Entity-Component-System world (Miniplex). Miniplex entities are PLAIN OBJECTS,
// so the game's existing enemy objects ARE the entities — `registerEnemy(enemy)`
// adds the very same object the game already holds in `enemies[]`. This is the
// "strangler" seam: the ECS world and the legacy array reference identical
// objects, so systems can migrate to archetype queries one at a time with zero
// behavioural change and no risk to the working game.
//
// Component types are intentionally loose for now (the enemy object carries many
// runtime-attached fields, still `any` after the Phase 1 migration). They tighten
// as each system moves onto the ECS in later slices.

import { World } from "miniplex";
import type * as THREE from "three";

/** An enemy entity — the same object the game pushes into `enemies[]`. */
export interface Enemy {
  mesh: THREE.Object3D;
  hp: number;
  maxHp: number;
  type?: any;
  typeName?: string;
  hpBar?: any;
  // Presence-tag component: present (=== true) only while the enemy is alive, so
  // `world.with("live")` is the alive archetype. Kept SEPARATE from the `.alive`
  // boolean (which existing code reads everywhere) and synced via setEnemyAlive().
  live?: true;
  // AI-brain outputs (see updateEnemyBrain dispatcher in the game).
  aiPhase?: string;      // named behaviour phase, e.g. "idle" (drives model pose)
  aiAdvanceMul?: number;
  aiLateralMul?: number;
  aiRetreat?: boolean;
  // Enemies accumulate many other runtime fields; keep them addressable while
  // the shape is still being formalised.
  [key: string]: any;
}

export type Entity = Enemy;

/** The single ECS world for the session. */
export const world = new World<Entity>();

/** Archetype query: every registered enemy (anything with hp + a mesh). */
export const enemies = world.with("hp", "mesh");

/** Archetype query: only ALIVE enemies (carry the `live` presence tag). */
export const liveEnemies = world.with("live");

// Guard against double-registration / double-removal without relying on a
// specific Miniplex internal (entities enter/leave via several game call sites).
const tracked = new WeakSet<Entity>();

// Reconcile the `live` tag with the enemy's `.alive` boolean. Only touches
// entities currently in the world; the boolean is the source of truth.
function syncLive(entity: Entity): void {
  if (!tracked.has(entity)) return;
  const tagged = entity.live === true;
  if (entity.alive && !tagged) world.addComponent(entity, "live", true);
  else if (!entity.alive && tagged) world.removeComponent(entity, "live");
}

/** Add an existing enemy object to the ECS world (idempotent). */
export function registerEnemy(entity: Entity): Entity {
  if (!tracked.has(entity)) {
    tracked.add(entity);
    world.add(entity);
  }
  syncLive(entity); // pick up `.alive` that may have been set before registration
  return entity;
}

/** Remove an enemy object from the ECS world (idempotent). */
export function unregisterEnemy(entity: Entity): void {
  if (tracked.has(entity)) {
    tracked.delete(entity);
    world.remove(entity); // drops the `live` tag with the entity
  }
}

/** Set an enemy's alive state — updates BOTH the `.alive` boolean (for legacy
 *  reads) and the `live` archetype tag. Use in place of `enemy.alive = x`. */
export function setEnemyAlive(entity: Entity, alive: boolean): void {
  entity.alive = alive;
  syncLive(entity);
}

// NOTE: no bulk clear() helper on purpose. Enemy objects are POOLED and reused
// across waves, so the tracking WeakSet must stay in lock-step with each object's
// membership — always call unregisterEnemy(e) per enemy (which keeps tracking
// consistent so the object can be registerEnemy'd again on its next spawn).

// Diagnostics hook (mirrors the game's window.__rb* helpers).
if (typeof window !== "undefined") {
  (window as any).__ecs = {
    world,
    count: () => world.entities.length,
    enemyCount: () => enemies.entities.length,
    liveCount: () => liveEnemies.entities.length,
  };
}
