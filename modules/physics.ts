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
