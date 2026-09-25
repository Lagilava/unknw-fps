import type * as ThreeTypes from 'three';

/** Hexagonal tubes retain thickness from every view; no camera-facing ribbons. */
export function createBoltCore(THREE: typeof ThreeTypes, maxSegments: number, color: ThreeTypes.ColorRepresentation) {
  const geometry = new THREE.BufferGeometry();
  const data = new Float32Array(maxSegments * 108);
  const colors = new Float32Array(data.length);
  geometry.setAttribute('position', new THREE.BufferAttribute(data, 3).setUsage(THREE.DynamicDrawUsage));
  geometry.setAttribute('color', new THREE.BufferAttribute(colors, 3));
  geometry.setDrawRange(0, 0);
  const mesh = new THREE.Mesh(geometry, new THREE.MeshBasicMaterial({ color, vertexColors:true, transparent:true, depthWrite:false, toneMapped:false }));
  mesh.frustumCulled = false;
  const a = new THREE.Vector3(), b = new THREE.Vector3(), side = new THREE.Vector3(), axis = new THREE.Vector3(), up = new THREE.Vector3();
  const points = [0,1,2,2,1,3];
  for (let i=0;i<maxSegments;i++) for (let f=0;f<6;f++) {
    const shade = .48 + .52 * (.5 + .5 * Math.cos(f * Math.PI / 3));
    for (let v=0;v<6;v++) colors.fill(shade, i*108+f*18+v*3, i*108+f*18+v*3+3);
  }
  return { mesh, update(segments: Float32Array, count: number, camera: ThreeTypes.Vector3, width: number) {
    count = Math.min(maxSegments, count);
    for(let i=0;i<count;i++) {
      a.fromArray(segments,i*6); b.fromArray(segments,i*6+3);
      axis.copy(b).sub(a).normalize();
      up.set(Math.abs(axis.y) > .9 ? 1 : 0, Math.abs(axis.y) > .9 ? 0 : 1, 0);
      side.crossVectors(axis,up).normalize(); up.crossVectors(side,axis).normalize();
      for(let f=0;f<6;f++) for(let v=0;v<6;v++) {
        const p=points[v], end=p>=2?b:a, angle=(f+p%2)*Math.PI/3, o=i*108+f*18+v*3;
        const cs=Math.cos(angle)*width/2, sn=Math.sin(angle)*width/2;
        data[o]=end.x+side.x*cs+up.x*sn;
        data[o+1]=end.y+side.y*cs+up.y*sn;
        data[o+2]=end.z+side.z*cs+up.z*sn;
      }
    }
    geometry.setDrawRange(0,count*36); geometry.attributes.position.needsUpdate=true;
  }};
}

/** Fixed pool: layered silhouettes, no extra lights or allocations per strike. */
export function createAbilityImpacts(THREE: typeof ThreeTypes, scene: ThreeTypes.Scene, capacity = 12) {
  const ringGeo = new THREE.TorusGeometry(.97, .035, 6, 48);
  const coreGeo: ThreeTypes.BufferGeometry = new THREE.IcosahedronGeometry(1, 2);
  const cageGeo = new THREE.IcosahedronGeometry(1, 1);
  const domeGeo = new THREE.SphereGeometry(1, 24, 12, 0, Math.PI*2, 0, Math.PI/2);
  const shardGeo = new THREE.ConeGeometry(.13, 1, 5);
  const material = () => new THREE.MeshStandardMaterial({transparent:true,depthWrite:false,roughness:.3,metalness:.35,emissiveIntensity:.45,toneMapped:false});
  const dummy = new THREE.Object3D();
  const white = new THREE.Color(0xffffff);
  const pool = Array.from({length:capacity}, () => {
    const root = new THREE.Group(), ring = new THREE.Mesh(ringGeo,material()), core = new THREE.Mesh(coreGeo,material());
    const halo = new THREE.Mesh(ringGeo,material());
    const cageMaterial = material(); cageMaterial.wireframe = true;
    const cage = new THREE.Mesh(cageGeo,cageMaterial);
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
      item.core.geometry=kind==='emp'?domeGeo:coreGeo;
      item.root.position.set(x,Math.max(.08,y),z); item.root.visible=true;
      for (const mesh of [item.ring,item.core,item.halo,item.cage,item.shards]) {
        mesh.material.color.setHex(color); mesh.material.emissive.setHex(color); mesh.material.opacity=0;
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
        item.halo.scale.set(blink?r*.65:r*.76,blink?r*1.3:r*.76,Math.max(.2,r*.5));
        item.halo.material.opacity=fade*.65;
        item.cage.position.y=blink?r*.7:.1;
        item.cage.scale.set(r*(blink?.5:1),r*(emp?.65:blink?1.25:.28),r*(blink?.5:1));
        item.cage.rotation.set(t*.35,t*(blink?-2.4:1.2),blink?t*.8:0);
        item.cage.material.opacity=fade*(emp?.38:.22);
        const coreSize=emp?r:item.radius*(.12+t*.18);
        item.core.scale.set(coreSize,blink?coreSize*3.8:emp?coreSize*.65:coreSize*(3.5-t*2),coreSize);
        item.core.position.y=blink?coreSize*1.8:.04;
        item.core.rotation.y=t*1.8; item.core.material.opacity=fade*(emp?.2:.85);
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
      ringGeo.dispose();coreGeo.dispose();cageGeo.dispose();domeGeo.dispose();shardGeo.dispose();
    },
  };
}
