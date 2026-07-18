// modules/physics.ts — Phase 3 foundation.
// ─────────────────────────────────────────────────────────────────────────────
// Rapier (WASM) physics world. Uses the `-compat` build, which inlines the WASM
// as base64 in the JS module, so it loads with NO separate .wasm fetch — that's
// what lets it resolve on BOTH entry paths (Vite bundle + the legacy importmap /
// static-server, which has no bundler or asset pipeline).
//
// This is only the foundation: init the world + expose diagnostics. It does NOT
// yet drive gameplay. Collision migration happens incrementally behind the
// existing wallAtWorldRadius() seam (environment.js) in later slices, so the hand-
// tuned movement feel can be matched before Rapier becomes the authority.

import RAPIER from "@dimforge/rapier3d-compat";

let world: any = null;
let ready = false;
let staticColliderCount = 0;

/**
 * Build fixed wall colliders from the interior MAP grid. Additive foundation:
 * the colliders exist in the Rapier world but nothing queries them for gameplay
 * yet (player/enemy collision still runs through wallAtWorldRadius). Merges
 * horizontal runs of `#` cells per row into single cuboids to keep the collider
 * count low. `env` = window.RoomBreachEnvironment.
 */
export function buildStaticWallColliders(env: any): number {
  if (!world || !env?.MAP) return 0;
  const { MAP, MAP_W, MAP_H, CELL, WALL_H, mapToWorld } = env;
  const hy = (WALL_H ?? 8) / 2;
  const hz = CELL / 2;
  let count = 0;
  for (let my = 0; my < MAP_H; my++) {
    let mx = 0;
    while (mx < MAP_W) {
      if (MAP[my][mx] === "#") {
        let run = 1;
        while (mx + run < MAP_W && MAP[my][mx + run] === "#") run++;
        const a = mapToWorld(mx, my);
        const b = mapToWorld(mx + run - 1, my);
        const cx = (a.x + b.x) / 2;
        const hx = (run * CELL) / 2;
        const body = world.createRigidBody(
          RAPIER.RigidBodyDesc.fixed().setTranslation(cx, hy, a.z),
        );
        world.createCollider(RAPIER.ColliderDesc.cuboid(hx, hy, hz), body);
        count++;
        mx += run;
      } else {
        mx++;
      }
    }
  }
  staticColliderCount += count;
  // Step once so Rapier builds its query pipeline / broad-phase for the new
  // colliders — spatial queries (projectPoint, castRay) panic otherwise. All
  // bodies here are fixed, so this doesn't move anything.
  world.step();
  return count;
}

/**
 * Build fixed colliders for the exterior zone from its AABB footprints
 * (window.__extMapFootprints: buildings, boundary walls, parked cars, the
 * landmark statue). Each is `{ x, z, hw, hd }` (centre + half-extents in XZ).
 * Call AFTER loadWorldLandmarks so late registrations are included. Additive.
 */
export function buildExteriorColliders(footprints: any[], height = 16): number {
  if (!world || !Array.isArray(footprints)) return 0;
  const hy = height / 2;
  let count = 0;
  for (const c of footprints) {
    if (!c || !Number.isFinite(c.hw) || !Number.isFinite(c.hd) || c.hw <= 0 || c.hd <= 0) continue;
    const body = world.createRigidBody(
      RAPIER.RigidBodyDesc.fixed().setTranslation(c.x, hy, c.z),
    );
    world.createCollider(RAPIER.ColliderDesc.cuboid(c.hw, hy, c.hd), body);
    count++;
  }
  staticColliderCount += count;
  world.step(); // rebuild query pipeline for the new colliders
  return count;
}

// Reused shape/rotation to avoid per-call allocation in the movement hot path.
const _ballShapes = new Map<number, any>();
const _identQuat = { w: 1, x: 0, y: 0, z: 0 };

/**
 * Does a ball of `radius` centred at world (x, y, z) overlap any collider?
 * Rapier-backed replacement for environment.js wallAtWorldRadius() — the player's
 * wall collision now runs through the physics world (static wall + exterior
 * colliders) instead of the MAP-grid sampler. Returns false until the world +
 * colliders exist, so callers keep their existing fallback.
 */
export function physicsBlocksAt(x: number, z: number, radius: number, y = 1): boolean {
  if (!world) return false;
  let shape = _ballShapes.get(radius);
  if (!shape) { shape = new RAPIER.Ball(radius); _ballShapes.set(radius, shape); }
  return world.intersectionWithShape({ x, y, z }, _identQuat, shape) !== null;
}

/** Initialise the Rapier WASM runtime + a physics world (idempotent, async). */
export async function initPhysics(gravityY = -9.81): Promise<any> {
  if (ready) return world;
  await RAPIER.init(); // loads the inlined WASM runtime
  world = new RAPIER.World({ x: 0, y: gravityY, z: 0 });
  ready = true;

  if (typeof window !== "undefined") {
    (window as any).__physics = {
      RAPIER,
      world,
      ready: () => ready,
      bodyCount: () => (world ? world.bodies.len() : 0),
      staticColliderCount: () => staticColliderCount,
      blocksAt: (x: number, z: number, r = 0.32, y = 1) => physicsBlocksAt(x, z, r, y),
      // Is world point (x, y, z) inside any collider? Used to verify the static
      // wall colliders line up with the MAP grid (compare against wallAtWorld).
      probe: (x: number, z: number, y = 1) => {
        if (!world) return false;
        const proj = world.projectPoint({ x, y, z }, true);
        return !!proj?.isInside;
      },
      // Self-test: drop a dynamic body (with a collider, so it has mass) a few
      // steps and confirm gravity moved it. Proves the WASM runtime is live.
      selfTest: () => {
        const rb = world.createRigidBody(
          RAPIER.RigidBodyDesc.dynamic().setTranslation(0, 10, 0),
        );
        world.createCollider(RAPIER.ColliderDesc.ball(0.5), rb);
        const y0 = rb.translation().y;
        for (let i = 0; i < 10; i++) world.step();
        const y1 = rb.translation().y;
        world.removeRigidBody(rb);
        return { y0, y1, fell: y1 < y0 };
      },
    };
  }
  return world;
}

export function getPhysicsWorld(): any {
  return world;
}

export function isPhysicsReady(): boolean {
  return ready;
}

/** Advance the simulation by dt seconds (no-op until a world exists). */
export function stepPhysics(dt: number): void {
  if (world) {
    world.timestep = dt;
    world.step();
  }
}
