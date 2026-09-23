import { Mesh, Object3D } from 'three';
import { MeshBVH, acceleratedRaycast } from 'three-mesh-bvh';

/** Index immutable collision geometry once during loading, preserving triangle order. */
export function accelerateStaticRaycasts(objects: Object3D[]): number {
  let accelerated = 0;
  for (const object of objects) {
    const mesh = object as Mesh;
    if (!mesh.isMesh || (mesh as any).isInstancedMesh || (mesh as any).isSkinnedMesh) continue;
    if (mesh.raycast !== Mesh.prototype.raycast && mesh.raycast !== acceleratedRaycast) continue;
    const geometry = mesh.geometry;
    if (!geometry.attributes.position || Object.keys(geometry.morphAttributes).length) continue;
    const count = geometry.index?.count ?? geometry.attributes.position.count;
    if (count < 300) continue;
    if (!geometry.boundsTree) geometry.boundsTree = new MeshBVH(geometry, { indirect: true });
    mesh.raycast = acceleratedRaycast;
    accelerated++;
  }
  return accelerated;
}
