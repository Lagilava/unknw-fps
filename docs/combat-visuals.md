# Combat feedback and finishes

Damage indicators store up to eight recent world-space hit origins. The arc points toward the source relative to player yaw (top = ahead, bottom = behind), follows turns, and fades over 1.25 seconds. Nearby repeated hits refresh an existing arc. Enemy attacks, co-op damage packets, PvP attackers, and self-grenades supply origins. Unknown/overlapping origins do not invent a direction. Rejected damage does not add an arc; resetting the player clears them.

Drone armor now keeps a diffuse lighting response, balanced metalness, and restrained emission so curved plates remain readable instead of collapsing into black or glowing silhouettes.

Ability effects use hexagonal lightning tubes, torus impact rings, shaded cores and shards, and a hemisphere for the Null field. Pools stay bounded and use existing scene lighting. Ground telegraphs remain flat so attack boundaries remain readable.

Every inventory gun owns its material instances, including upgrade tint state. WebGL uses an original object-space pattern on Three.js physical shading:

| Gun | Finish |
| --- | --- |
| Rifle | Blue steel / cyan circuit bands |
| Shotgun | Burnished copper / flowing grain / wood furniture |
| Sniper | Violet titanium / fine segmented markings |
| Pistol | Brushed silver |
| SMG | Teal / diagonal chevrons |
| LMG | Olive / mottled armor |
| DMR | Blue / traveling coil bands |
| Akimbo | Rose alloy / diagonal cuts |
| Flak | Bronze / hazard bands |

Grips, optics, brass, trim, and receivers use different roughness and metalness. The WebGPU r166 fallback retains each gun's physical finish and color; custom GLSL patterns are WebGL-only. No remote assets are loaded at runtime.

Reference: [Three.js MeshPhysicalMaterial](https://threejs.org/docs/pages/MeshPhysicalMaterial.html). This uses the installed MIT-licensed Three.js shader implementation and original pattern code, with no copied third-party shader assets.
