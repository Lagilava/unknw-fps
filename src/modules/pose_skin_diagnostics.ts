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
    const meshScale=mesh.getWorldScale(new THREE.Vector3()).length()/Math.sqrt(3);
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
      const rest=ids.map(id=>new THREE.Vector3().fromBufferAttribute(position,id));
      for(let j=0;j<3;j++){
        const length=points[j].distanceTo(points[(j+1)%3]);
        if(length>1e-5 && rest[j].distanceTo(rest[(j+1)%3])*meshScale>=.004)edges.push({mesh,a:ids[j],b:ids[(j+1)%3],length,
          restLength:rest[j].distanceTo(rest[(j+1)%3]),meshScale});
      }
      collected++;
    }
  });
  return edges;
}
export function compareSolvedSkin(edges) {
  let worstRest:any=null,maxAddedMetres=0,maxAddedRatio=0;
  const ratios:number[]=[],restRatios:number[]=[],authoredRestRatios:number[]=[],a=new THREE.Vector3(),b=new THREE.Vector3();
  for(const mesh of new Set<any>(edges.map(e=>e.mesh))){mesh.updateMatrixWorld(true);mesh.skeleton.update();}
  for(const edge of edges) {
    point(edge.mesh,edge.a,a);point(edge.mesh,edge.b,b);
    const length=a.distanceTo(b);
    maxAddedMetres=Math.max(maxAddedMetres,(length-edge.length)*edge.meshScale);
    maxAddedRatio=Math.max(maxAddedRatio,(length-edge.length)/edge.restLength);
    ratios.push(length/edge.length);
    if(edge.restLength>1e-5){
      const ratio=length/edge.restLength;restRatios.push(ratio);authoredRestRatios.push(edge.length/edge.restLength);
      if(!worstRest||ratio>worstRest.ratio)worstRest={ratio,restMetres:edge.restLength*edge.meshScale,
        solvedMetres:length*edge.meshScale,authoredMetres:edge.length*edge.meshScale,mesh:edge.mesh.name};
    }
  }
  ratios.sort((a,b)=>a-b);restRatios.sort((a,b)=>a-b);authoredRestRatios.sort((a,b)=>a-b);
  return {samples:ratios.length,p95:ratios[Math.floor(ratios.length*.95)]||1,max:ratios.at(-1)||1,
    restP95:restRatios[Math.floor(restRatios.length*.95)]||1,restMax:restRatios.at(-1)||1,
    authoredRestMax:authoredRestRatios.at(-1)||1,worstRest,maxAddedMetres,maxAddedRatio,finite:ratios.every(Number.isFinite)};
}
