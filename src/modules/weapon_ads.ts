import type { GunType } from './gun_config';

type AimProfile = {
  sight: 'post' | 'dot' | 'ring' | 'scope' | 'chevron' | 'bracket';
  label: string; shoulder: number; pullIn: number; vignette: number;
  pose: { x: number; y: number; z: number; ry: number; rz: number };
};
export const AIM_PROFILES: Record<GunType, AimProfile> = {
  pistol: { sight:'post', label:'IRON SIGHTS', shoulder:.86, pullIn:.24, vignette:.12, pose:{x:-.015,y:.058,z:.24,ry:-.015,rz:-.006} },
  rifle: { sight:'dot', label:'REFLEX', shoulder:.74, pullIn:.52, vignette:.22, pose:{x:-.055,y:.045,z:.14,ry:-.055,rz:-.015} },
  shotgun: { sight:'ring', label:'GHOST RING', shoulder:.9, pullIn:.3, vignette:.12, pose:{x:-.045,y:.04,z:.12,ry:-.045,rz:-.015} },
  sniper: { sight:'scope', label:'PRECISION OPTIC', shoulder:1, pullIn:.7, vignette:0, pose:{x:0,y:0,z:0,ry:0,rz:0} },
  smg: { sight:'dot', label:'COMPACT REFLEX', shoulder:.82, pullIn:.36, vignette:.16, pose:{x:-.035,y:.052,z:.19,ry:-.028,rz:-.008} },
  lmg: { sight:'bracket', label:'SUPPORT SIGHT', shoulder:.7, pullIn:.62, vignette:.3, pose:{x:-.065,y:.036,z:.1,ry:-.06,rz:-.02} },
  dmr: { sight:'chevron', label:'MARKSMAN OPTIC', shoulder:.76, pullIn:.6, vignette:.35, pose:{x:-.05,y:.048,z:.17,ry:-.04,rz:-.01} },
  akimbo: { sight:'bracket', label:'FOCUSED FIRE', shoulder:.94, pullIn:.18, vignette:.08, pose:{x:-.02,y:.03,z:.16,ry:-.02,rz:-.004} },
  flak: { sight:'ring', label:'WIDE APERTURE', shoulder:.92, pullIn:.26, vignette:.14, pose:{x:-.04,y:.032,z:.11,ry:-.035,rz:-.018} },
};

// ADS specs were authored against the 90-degree FP camera. Preserve their
// optical magnification in the narrower 63-degree shoulder view as well.
export function getWeaponAdsFov(specFov: number, thirdPerson: boolean) {
  const radians = Math.PI / 180;
  return thirdPerson
    ? 2 * Math.atan(Math.tan(63 * radians / 2) * Math.tan(specFov * radians / 2)) / radians
    : specFov;
}

export function createAimSight(doc = document) {
  const el = doc.createElement('div'); el.id = 'weapon-aim-sight';
  el.setAttribute('aria-hidden', 'true'); el.hidden = true;
  el.innerHTML = `<div class="optic-mask"></div><svg viewBox="-100 -100 200 200"><g class="sight-post"><path d="M-17 8v9h10M17 8v9H7M0 10V1"/></g><g class="sight-dot"><circle r="2" class="sight-center"/><path d="M-13 -7v-6h6M13 -7v-6H7M-13 7v6h6M13 7v6H7"/></g><g class="sight-ring"><circle r="19"/><circle r="1.5" class="sight-center"/></g><g class="sight-chevron"><path d="m-7 5 7-5 7 5M0 15v5M-4 26h8M-6 36h12"/></g><g class="sight-bracket"><path d="M-15 -8h-4v16h4M15 -8h4v16h-4"/><circle r="1.5" class="sight-center"/></g><g class="sight-scope"><path d="M-100 0h94M6 0h94M0 -100v94M0 6v94M-3 15h6M-4 30h8M-5 45h10M-15 -3v6M15 -3v6"/><circle r="1" class="sight-center"/></g></svg><span class="optic-label"></span>`;
  const style = doc.createElement('style');
  style.textContent = `
    #weapon-aim-sight { position:fixed; inset:0; pointer-events:none; z-index:1; color:#e5f7ed; }
    #hud #bottom-hud,#hud #center-hud,#hud #minimap-canvas,#hud #tracker-caption,#hud #kill-feed,#hud #pack-prompt { z-index:2; }
    #hud #hit-marker { z-index:3; }
    #weapon-aim-sight[hidden] { display:none; }
    #weapon-aim-sight svg { position:absolute; width:200px; height:200px; left:50%; top:50%; transform:translate(-50%,-50%); overflow:visible; filter:drop-shadow(0 1px 1px #000); }
    #weapon-aim-sight g { display:none; fill:none; stroke:currentColor; stroke-width:1.5; }
    #weapon-aim-sight .sight-center { fill:#ff735c; stroke:none; }
    #weapon-aim-sight[data-sight="post"] .sight-post,#weapon-aim-sight[data-sight="dot"] .sight-dot,#weapon-aim-sight[data-sight="ring"] .sight-ring,#weapon-aim-sight[data-sight="chevron"] .sight-chevron,#weapon-aim-sight[data-sight="bracket"] .sight-bracket,#weapon-aim-sight[data-sight="scope"] .sight-scope { display:block; }
    #weapon-aim-sight[data-weapon="flak"] .sight-ring { transform:scale(1.4); }
    #weapon-aim-sight[data-weapon="smg"] .sight-dot { transform:scale(.8); }
    #weapon-aim-sight[data-weapon="akimbo"] .sight-bracket { transform:scale(1.35); }
    .optic-mask,.optic-label { display:none; }
    #weapon-aim-sight[data-sight="scope"] .optic-mask { display:block; position:absolute; left:50%; top:50%; width:78vmin; height:78vmin; transform:translate(-50%,-50%); border-radius:50%; border:4px solid #152024; box-shadow:0 0 0 150vmax rgba(2,5,7,.97),inset 0 0 35px #000a; }
    #weapon-aim-sight[data-sight="scope"] svg { width:78vmin; height:78vmin; overflow:hidden; border-radius:50%; color:#101a19; }
    #weapon-aim-sight[data-sight="scope"] g { stroke-width:.4; }
    #weapon-aim-sight[data-sight="scope"] .optic-label { display:block; position:absolute; top:calc(50% + 29vmin); left:50%; transform:translateX(-50%); color:#bed2c8; font:11px/1.4 monospace; letter-spacing:.15em; }
  `;
  doc.head.append(style); doc.getElementById('hud')?.append(el);
  const label = el.querySelector('.optic-label')!;
  return (type: GunType, ads: number, visible: boolean, x = 0, y = 0) => {
    const profile = AIM_PROFILES[type];
    el.hidden = !visible || ads < .55;
    if (el.hidden) return;
    if (el.dataset.weapon !== type) {
      el.dataset.weapon = type; el.dataset.sight = profile.sight;
      label.textContent = profile.label;
    }
    el.style.opacity = String(Math.min(1, (ads - .55) / .2));
    // The aim cursor drives both shot direction and sight position.
    el.style.transform = `translate(${x.toFixed(2)}px,${y.toFixed(2)}px)`;
  };
}
