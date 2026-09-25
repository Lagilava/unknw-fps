import * as THREE from 'three';
import type { GunType } from './gun_config';

// Original surface patterns over Three.js's MIT-licensed physical shader.
// Reference: https://threejs.org/docs/pages/MeshPhysicalMaterial.html
const finishes: Record<GunType, [number, number, number, number, string]> = {
  rifle: [0x244a60, 0x54dfff, .72, .32, 'step(.86, fract(p.x * 19.0 + p.y * 8.0))'],
  shotgun: [0x492419, 0xff862e, .65, .4, 'pow(.5 + .5 * sin(p.x * 65.0 + sin(p.y * 24.0) * 3.0), 8.0)'],
  sniper: [0x34265b, 0xc190ff, .85, .22, 'step(.94, fract(p.x * 32.0)) * step(.35, fract(p.y * 26.0))'],
  pistol: [0x8594a0, 0xe5f5ff, .95, .2, 'pow(.5 + .5 * sin(p.x * 150.0), 18.0)'],
  smg: [0x124e43, 0x58ffd0, .6, .36, 'step(.8, fract((p.x + abs(p.y)) * 28.0))'],
  lmg: [0x494c25, 0xe4db62, .68, .48, 'step(.62, sin(p.x * 32.0) * sin(p.y * 32.0) * sin(p.z * 32.0))'],
  dmr: [0x183957, 0x38baff, .82, .25, 'pow(.5 + .5 * sin(p.x * 36.0 - uSkinTime * 1.5), 22.0)'],
  akimbo: [0x78324c, 0xff6096, .78, .27, 'step(.84, fract((p.x - p.y) * 24.0))'],
  flak: [0x7d4816, 0xffc34b, .68, .38, 'step(.55, fract((p.x + p.y) * 12.0))'],
};

export function createWeaponMaterials(type: GunType, time: { value: number }, webgpu = false) {
  const [color, accent, metalness, roughness, pattern] = finishes[type];
  const bodyMat = new THREE.MeshPhysicalMaterial({ color, metalness, roughness, clearcoat: .35, clearcoatRoughness: .3 });
  bodyMat.name = `${type}-signature-finish`;
  // Object coordinates follow the receiver during aim/reload, unlike screen-space skins.
  if (!webgpu) {
    bodyMat.customProgramCacheKey = () => `weapon-finish-${type}-v1`;
    bodyMat.onBeforeCompile = shader => {
      shader.uniforms.uSkinTime = time;
      shader.uniforms.uSkinAccent = { value: new THREE.Color(accent) };
      shader.vertexShader = 'varying vec3 vSkinPosition;\n' + shader.vertexShader;
      shader.vertexShader = shader.vertexShader.replace('#include <begin_vertex>', '#include <begin_vertex>\nvSkinPosition = position;');
      shader.fragmentShader = 'varying vec3 vSkinPosition;\nuniform float uSkinTime;\nuniform vec3 uSkinAccent;\n' + shader.fragmentShader;
      shader.fragmentShader = shader.fragmentShader.replace('#include <color_fragment>', `#include <color_fragment>\nvec3 p = vSkinPosition;\nfloat finishPattern = ${pattern};\ndiffuseColor.rgb = mix(diffuseColor.rgb, uSkinAccent, finishPattern * .38);`);
      shader.fragmentShader = shader.fragmentShader.replace('#include <emissivemap_fragment>', '#include <emissivemap_fragment>\ntotalEmissiveRadiance += uSkinAccent * finishPattern * .09;');
    };
  }
  const standard = (c: number, m: number, r: number) => new THREE.MeshStandardMaterial({ color: c, metalness: m, roughness: r });
  return {
    bodyMat,
    darkMat: standard(0x141b23, .7, .42),
    accentMat: new THREE.MeshStandardMaterial({ color: accent, metalness: .65, roughness: .3, emissive: accent, emissiveIntensity: .15 }),
    woodMat: standard(type === 'shotgun' ? 0x633820 : color, .08, .65),
    rubberMat: standard(0x11151a, .03, .88),
    lensMat: new THREE.MeshPhysicalMaterial({ color: accent, metalness: .25, roughness: .08, clearcoat: 1, emissive: accent, emissiveIntensity: .12 }),
    brassMat: standard(0xb99043, .85, .26),
    edgeMat: standard(0xa5b4bb, .9, .22),
    warningMat: standard(0xffb52b, .3, .44),
  };
}
