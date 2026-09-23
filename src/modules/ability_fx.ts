import type * as ThreeTypes from 'three';

/** Camera-facing triangles: lineWidth is ignored by most WebGL implementations. */
export function createBoltCore(THREE: typeof ThreeTypes, maxSegments: number, color: ThreeTypes.ColorRepresentation) {
  const geometry = new THREE.BufferGeometry();
  const data = new Float32Array(maxSegments * 18);
  geometry.setAttribute('position', new THREE.BufferAttribute(data, 3).setUsage(THREE.DynamicDrawUsage));
  geometry.setDrawRange(0, 0);
  const mesh = new THREE.Mesh(geometry, new THREE.MeshBasicMaterial({ color, transparent:true, depthWrite:false, side:THREE.DoubleSide, blending:THREE.AdditiveBlending, toneMapped:false }));
  mesh.frustumCulled = false;
  const a = new THREE.Vector3(), b = new THREE.Vector3(), side = new THREE.Vector3(), view = new THREE.Vector3();
  const points = [0,1,2,2,1,3];
  return { mesh, update(segments: Float32Array, count: number, camera: ThreeTypes.Vector3, width: number) {
    count = Math.min(maxSegments, count);
    for(let i=0;i<count;i++) {
      a.fromArray(segments,i*6); b.fromArray(segments,i*6+3);
      view.copy(camera).sub(a); side.copy(b).sub(a).cross(view);
      if(side.lengthSq()<1e-8) side.set(1,0,0);
      side.normalize().multiplyScalar(width/2);
      for(let v=0;v<6;v++) {
        const p=points[v], end=p>=2?b:a, sign=p%2===0?-1:1, o=i*18+v*3;
        data[o]=end.x+side.x*sign; data[o+1]=end.y+side.y*sign; data[o+2]=end.z+side.z*sign;
      }
    }
    geometry.setDrawRange(0,count*6); geometry.attributes.position.needsUpdate=true;
  }};
}

/** Fixed pool: layered silhouettes, no extra lights or allocations per strike. */
export function createAbilityImpacts(THREE: typeof ThreeTypes, scene: ThreeTypes.Scene, capacity = 12) {
  const ringGeo = new THREE.RingGeometry(.94, 1, 64);
  const coreGeo = new THREE.IcosahedronGeometry(1, 1);
  const shardGeo = new THREE.ConeGeometry(.09, 1, 3);
  const material = () => new THREE.MeshBasicMaterial({transparent:true,depthWrite:false,side:THREE.DoubleSide,blending:THREE.AdditiveBlending,toneMapped:false});
  const dummy = new THREE.Object3D();
  const white = new THREE.Color(0xffffff);
  const pool = Array.from({length:capacity}, () => {
    const root = new THREE.Group(), ring = new THREE.Mesh(ringGeo,material()), core = new THREE.Mesh(coreGeo,material());
    const halo = new THREE.Mesh(ringGeo,material());
    const cageMaterial = material(); cageMaterial.wireframe = true;
    const cage = new THREE.Mesh(coreGeo,cageMaterial);
    const shards = new THREE.InstancedMesh(shardGeo,material(),8);
    shards.frustumCulled = false;
    ring.rotation.x=-Math.PI/2; root.add(ring,core,halo,cage,shards); root.visible=false; scene.add(root);
    return {root,ring,core,halo,cage,shards,age:0,duration:0,radius:1,kind:'strike'};
  });
  let cursor=0;
  return {
    spawn(x:number,y:number,z:number,color:number,radius=2,kind='strike') {
      const item=pool[cursor++%capacity];
      item.age=0; item.duration=kind==='emp'?.85:kind==='blink'?.68:.55;
      item.radius=Math.max(.2,Math.min(8,radius)); item.kind=kind;
      item.root.position.set(x,Math.max(.08,y),z); item.root.visible=true;
      for (const mesh of [item.ring,item.core,item.halo,item.cage,item.shards]) {
        mesh.material.color.setHex(color); mesh.material.opacity=0;
      }
      item.core.material.color.lerp(white,.65);
      item.ring.scale.setScalar(.1); item.core.scale.setScalar(.1);
    },
    update(dt:number) {
      for(const item of pool) {
        if(!item.root.visible) continue;
        item.age+=Math.max(0,dt); const t=Math.min(1,item.age/item.duration), fade=(1-t)*(1-t);
        const r=item.radius*(1-Math.pow(1-t,3));
        const blink=item.kind==='blink', emp=item.kind==='emp';
        item.ring.scale.setScalar(Math.max(.08,r)); item.ring.material.opacity=fade*.7;
        // Seraph: two crossing fracture halos. Cherub: a rising geodesic dome.
        // Warden: a tight white-hot impact with a radial crown of electrical shards.
        item.halo.rotation.set(blink?.25:-Math.PI/2,blink?t*2:0,t*(blink?-2:.5));
        item.halo.position.y=blink?r*.65:emp?.25+t*1.8:.12;
        item.halo.scale.set(blink?r*.65:r*.76,blink?r*1.3:r*.76,1);
        item.halo.material.opacity=fade*.65;
        item.cage.position.y=blink?r*.7:.1;
        item.cage.scale.set(r*(blink?.5:1),r*(emp?.65:blink?1.25:.28),r*(blink?.5:1));
        item.cage.rotation.set(t*.35,t*(blink?-2.4:1.2),blink?t*.8:0);
        item.cage.material.opacity=fade*(emp?.38:.22);
        const coreSize=emp?r:item.radius*(.12+t*.18);
        item.core.scale.set(coreSize,blink?coreSize*3.8:emp?coreSize*.12:coreSize*(3.5-t*2),coreSize);
        item.core.rotation.y=t*1.8; item.core.material.opacity=fade*(emp?.07:.5);
        for(let i=0;i<8;i++) {
          const angle=i*Math.PI/4+t*(blink?2.4:.3);
          const reach=r*(emp?.85:blink?.7:.8);
          dummy.position.set(Math.cos(angle)*reach,blink?.4+Math.sin(angle)*r*.8:emp?.15:r*.3,Math.sin(angle)*reach);
          dummy.rotation.set(emp?Math.PI/2:blink?angle:t*.8,angle,blink?-angle:Math.PI*.2);
          dummy.scale.setScalar(Math.max(.01,item.radius*(emp?.45:.7)*(1-t*.75)));
          dummy.updateMatrix(); item.shards.setMatrixAt(i,dummy.matrix);
        }
        item.shards.instanceMatrix.needsUpdate=true;
        item.shards.material.opacity=fade*.8;
        if(t>=1) item.root.visible=false;
      }
    },
    clear() { for(const item of pool) item.root.visible=false; },
    get activeCount() { return pool.filter(item=>item.root.visible).length; },
    dispose() {
      for(const item of pool) {
        scene.remove(item.root);
        for(const mesh of [item.ring,item.core,item.halo,item.cage,item.shards]) mesh.material.dispose();
        item.shards.dispose();
      }
      ringGeo.dispose();coreGeo.dispose();shardGeo.dispose();
    },
  };
}
