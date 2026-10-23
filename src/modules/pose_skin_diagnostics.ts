import * as THREE from 'three';
// Lab-only: compare the rendered skin at the same mixer frame before/after IK.
// Sampling triangles catches axial skin stretching that joint positions miss.
const v=new THREE.Vector3();
function point(mesh,index,out) {
  out.fromBufferAttribute(mesh.geometry.attributes.position,index);
  mesh.applyBoneTransform(index,out);
  return out;
}
export function sampleAuthoredSkin(root) {
  const edges:any[]=[];
  root.updateMatrixWorld(true);
  root.traverse(mesh=>{
    if(!mesh.isSkinnedMesh || !mesh.applyBoneTransform) return;
    const geometry=mesh.geometry,index=geometry.index,position=geometry.attributes.position;
    const skinIndex=geometry.attributes.skinIndex,skinWeight=geometry.attributes.skinWeight;
    if(!position || !skinIndex || !skinWeight) return;
    mesh.skeleton.update();
    const count=Math.floor((index?index.count:position.count)/3),stride=Math.max(1,Math.floor(count/512));
    let collected=0;
    for(let triangle=0;triangle<count && collected<128;triangle+=stride) {
      const ids=[0,1,2].map(n=>index?index.getX(triangle*3+n):triangle*3+n);
      const arm=ids.some(id=>[0,1,2,3].some(k=>{
        const weight=skinWeight.getComponent(id,k),bone=mesh.skeleton.bones[skinIndex.getComponent(id,k)];
        return weight>.2 && /arm|hand|shoulder/i.test(bone?.name||'');
      }));
      if(!arm)continue;
      const points=ids.map(id=>point(mesh,id,new THREE.Vector3()));
      for(let j=0;j<3;j++){
        const length=points[j].distanceTo(points[(j+1)%3]);
        if(length>1e-5)edges.push({mesh,a:ids[j],b:ids[(j+1)%3],length});
      }
      collected++;
    }
  });
  return edges;
}
export function compareSolvedSkin(edges) {
  const ratios:number[]=[],a=new THREE.Vector3(),b=new THREE.Vector3();
  for(const mesh of new Set<any>(edges.map(e=>e.mesh))){mesh.updateMatrixWorld(true);mesh.skeleton.update();}
  for(const edge of edges) {
    point(edge.mesh,edge.a,a);point(edge.mesh,edge.b,b);
    ratios.push(a.distanceTo(b)/edge.length);
  }
  ratios.sort((a,b)=>a-b);
  return {samples:ratios.length,p95:ratios[Math.floor(ratios.length*.95)]||1,max:ratios.at(-1)||1,
    finite:ratios.every(Number.isFinite)};
}
