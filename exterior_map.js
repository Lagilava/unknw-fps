/**
 * exterior_map.js — Outdoor zone for UNKNW
 * All geometry uses MeshStandardMaterial (responds to flashlight + lamps).
 * Sky: Three.js Sky shader + Points stars + procedural moon.
 * v3 — Sky overhaul: realistic night sky, improved moon, starfield.
 */
(function () {
  "use strict";

  // ── Ensure facade function exists (called by environment.js) ──────────
  if (typeof window.buildInteriorExteriorFacade === 'undefined') {
    window.buildInteriorExteriorFacade = function() {
      // Stub – no operation
    };
  }

  // ── Zone constants ────────────────────────────────────────────────────────
  // EXT_Z_NEAR must line up exactly with the interior floor's south edge
  // (MAP_WORLD_CENTER_Z + MAP_H*CELL/2 = 120). If it doesn't, a dead band forms
  // between interior and exterior that both blocks the exits and z-fights the
  // two ground planes. 120 makes them meet edge-to-edge.
  const EXT_Z_NEAR = 120;
  const EXT_Z_FAR  = 380;   // extended: the exterior is now a deep city district
  const EXT_X_MIN  = -135;  // widened: a full city grid flanks the central avenue
  const EXT_X_MAX  =  135;

  // PLAYABLE box — deliberately the ORIGINAL pre-expansion plaza. The city grid
  // beyond it is pure vista: fully built and visible so the world reads as vast,
  // but movement (extWallAt), the boundary colliders and the world-clamp
  // (__extBounds) all stop at these bounds. Cheap "big world" feel, zero cost.
  const PLAY_X_MIN = -72;
  const PLAY_X_MAX =  72;
  const PLAY_Z_FAR = 230;

  // ── Collision (runs immediately) ──────────────────────────────────────────
  const colliders = [];
  function addCollider(cx, cz, w, d) {
    colliders.push({ x: cx, z: cz, hw: w * 0.5, hd: d * 0.5 });
  }
  function extWallAt(px, pz) {
    // Solid outside the exterior box on every side. The near edge (pz < EXT_Z_NEAR)
    // is critical: below it lies only the interior, which is always inside the MAP
    // grid and never delegates here. Without this check the side "wings" beside the
    // interior and the empty space north of it read as open and the player escapes.
    if (px < PLAY_X_MIN || px > PLAY_X_MAX || pz > PLAY_Z_FAR || pz < EXT_Z_NEAR) return true;
    for (let i = 0; i < colliders.length; i++) {
      const c = colliders[i];
      if (Math.abs(px - c.x) < c.hw && Math.abs(pz - c.z) < c.hd) return true;
    }
    return false;
  }
  window.__extWallAt = extWallAt;
  // Expose collider registration so the landmark loader (and other systems) can add
  // AABB footprints that block movement in the exterior zone. (cx,cz)=centre, (w,d)=full size.
  window.__extAddCollider = addCollider;
  // Publish the exterior play-area box so the game's world-boundary failsafe stays in sync.
  window.__extBounds = { xMin: PLAY_X_MIN, xMax: PLAY_X_MAX, zNear: EXT_Z_NEAR, zFar: PLAY_Z_FAR };

  // ── Minimap layout export ─────────────────────────────────────────────────
  // The GTA-style minimap (three_fps_game.js renderMinimap) pre-renders the FULL
  // world — interior MAP grid + this exterior street — into one offscreen
  // texture. It reads:
  //  - __extMapFootprints: LIVE reference to the collider list (building AABBs,
  //    parked cars, props, boundary walls). Late registrations (landmark statue
  //    via __extAddCollider) are picked up because the texture rebuilds when the
  //    list length changes.
  //  - __extMapLayout: static street layout (road/sidewalk rects, crosswalk) —
  //    mirrors the queueBox calls in buildGround().
  window.__extMapFootprints = colliders;
  window.__extMapLayout = {
    bounds: window.__extBounds,
    roadHalfW: 19,                                  // asphalt spans x −19..19
    sidewalks: [{ x: -43, w: 26 }, { x: 43, w: 26 }],
    crosswalkZ: 176,
  };

  // ── Builder ───────────────────────────────────────────────────────────────
  window.buildExteriorPlayArea = async function (THREE, scene, renderer) {

    // seededRandom — reproducible noise
    function seededRandom(seedText) {
      let h = 2166136261 >>> 0;
      for (let i = 0; i < seedText.length; i++) {
        h ^= seedText.charCodeAt(i);
        h = Math.imul(h, 16777619) >>> 0;
      }
      return function () {
        h ^= h << 13; h ^= h >>> 17; h ^= h << 5;
        return ((h >>> 0) / 4294967296);
      };
    }

    // mergeGeometries — inlined, no CDN dependency
    function mergeGeometries(geometries) {
      let vertCount = 0, idxCount = 0, hasIndex = false;
      for (const g of geometries) {
        vertCount += g.attributes.position.count;
        if (g.index) { hasIndex = true; idxCount += g.index.count; }
      }
      const merged = new THREE.BufferGeometry();
      const attrs = Object.keys(geometries[0].attributes);
      const out = {};
      for (const name of attrs) {
        const item = geometries[0].attributes[name];
        out[name] = new Float32Array(vertCount * item.itemSize);
      }
      let vOff = 0, iOff = 0;
      const indices = hasIndex ? new Uint32Array(idxCount) : null;
      for (const g of geometries) {
        const vc = g.attributes.position.count;
        for (const name of attrs) {
          const src = g.attributes[name];
          if (!src) continue;
          const dst = out[name];
          const sz = src.itemSize;
          for (let i = 0; i < vc * sz; i++) dst[vOff * sz + i] = src.array[i];
        }
        if (indices && g.index) {
          const si = g.index.array;
          for (let i = 0; i < si.length; i++) indices[iOff + i] = si[i] + vOff;
          iOff += si.length;
        }
        vOff += vc;
      }
      for (const name of attrs) {
        const sz = geometries[0].attributes[name].itemSize;
        merged.setAttribute(name, new THREE.BufferAttribute(out[name], sz));
      }
      if (indices) merged.setIndex(new THREE.BufferAttribute(indices, 1));
      return merged;
    }

    if (!window.__wallMeshes) window.__wallMeshes = [];
    const extWallMeshes = window.__wallMeshes;

    // Lighting profile
    function getExtLightingProfile() {
      const aniso = renderer.capabilities?.getMaxAnisotropy?.() ?? 1;
      const mem = renderer.info?.memory;
      const low = (mem && mem.textures > 80) || (aniso < 2);
      const high = aniso >= 8 && !low;
      if (low)  return { tier:"low",    lampLit:12, lampIntensity:180, lampDistance:55, lampDecay:1.4, aniso:1,                 texSize:256 };
      if (high) return { tier:"high",   lampLit:12, lampIntensity:180, lampDistance:55, lampDecay:1.4, aniso:Math.min(aniso,8), texSize:512 };
      return           { tier:"medium", lampLit:12, lampIntensity:180, lampDistance:55, lampDecay:1.4, aniso:Math.min(aniso,4), texSize:384 };
    }
    const profile = getExtLightingProfile();

    // Texture helpers
    function makeTex(canvas, repeatX, repeatY, srgb) {
      const tex = new THREE.CanvasTexture(canvas);
      if (srgb) tex.colorSpace = THREE.SRGBColorSpace;
      tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
      tex.repeat.set(repeatX, repeatY);
      tex.anisotropy = profile.aniso;
      tex.needsUpdate = true;
      return tex;
    }
    function loadLocal(path, repeatX, repeatY, colorSpace = false) {
      const tex = new THREE.TextureLoader().load(path);
      tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
      tex.repeat.set(repeatX, repeatY);
      if (colorSpace) tex.colorSpace = THREE.SRGBColorSpace;
      tex.anisotropy = profile.aniso;
      return tex;
    }

    function makeRoadTex(W = 512, H = 512) {
      const canvas = document.createElement("canvas");
      canvas.width = W; canvas.height = H;
      const ctx = canvas.getContext("2d");
      // Dark wet asphalt base
      const grad = ctx.createLinearGradient(0, 0, 0, H);
      grad.addColorStop(0, "rgb(28,28,32)"); grad.addColorStop(1, "rgb(22,22,26)");
      ctx.fillStyle = grad; ctx.fillRect(0, 0, W, H);
      const rng = seededRandom("road-v3");
      // Surface imperfections
      ctx.fillStyle = "rgba(0,0,0,0.08)";
      for (let i = 0; i < 80; i++) ctx.fillRect(rng()*W, rng()*H, 1+rng()*4, 1+rng()*3);
      // Wet sheen streaks
      ctx.globalCompositeOperation = "screen";
      for (let i = 0; i < 40; i++) {
        const x = rng()*W, len = 12+rng()*80, a = (0.06+rng()*0.12);
        const g = ctx.createLinearGradient(x, rng()*H, x+len*0.3, rng()*H+len);
        g.addColorStop(0,"rgba(180,195,210,0)"); g.addColorStop(0.5,`rgba(180,195,210,${a})`); g.addColorStop(1,"rgba(180,195,210,0)");
        ctx.fillStyle = g; ctx.fillRect(x, rng()*H, Math.max(1,len*0.15), len);
      }
      ctx.globalCompositeOperation = "source-over";
      // Subtle tar patches
      ctx.fillStyle = "rgba(0,0,0,0.10)";
      for (let i = 0; i < 30; i++) ctx.fillRect(rng()*W, rng()*H, 10+rng()*50, 2+rng()*6);
      return makeTex(canvas, 3, 4, true);
    }

    function makeRoadNormalTex(size = 256) {
      const canvas = document.createElement("canvas");
      canvas.width = canvas.height = size;
      const ctx = canvas.getContext("2d");
      const img = ctx.createImageData(size, size);
      const rng = seededRandom("road-normal-v2");
      for (let y = 0; y < size; y++) {
        for (let x = 0; x < size; x++) {
          const f = (2*Math.PI)/size;
          // Ripple/puddle normal detail
          const dhdx = Math.sin(x*f*5)*0.5 + Math.sin(x*f*11)*0.2 + (rng()-0.5)*0.25;
          const dhdy = Math.cos(y*f*4)*0.4 + Math.cos(y*f*9)*0.15 + (rng()-0.5)*0.25;
          const i = (y*size+x)*4;
          img.data[i]   = Math.floor(128+dhdx*60);
          img.data[i+1] = Math.floor(128+dhdy*60);
          img.data[i+2] = 215;
          img.data[i+3] = 255;
        }
      }
      ctx.putImageData(img, 0, 0);
      return makeTex(canvas, 3, 4);
    }

    function makeWetRoadNormalTex(size = 256) {
      // More pronounced ripple normals for the wet surface layer
      const canvas = document.createElement("canvas");
      canvas.width = canvas.height = size;
      const ctx = canvas.getContext("2d");
      const img = ctx.createImageData(size, size);
      const rng = seededRandom("wet-road-normal");
      for (let y = 0; y < size; y++) {
        for (let x = 0; x < size; x++) {
          const f = (2*Math.PI)/size;
          const dhdx = Math.sin(x*f*3.1)*0.7 + Math.sin(x*f*7.8)*0.3 + (rng()-0.5)*0.2;
          const dhdy = Math.cos(y*f*2.7)*0.6 + Math.cos(y*f*6.4)*0.25 + (rng()-0.5)*0.2;
          const i = (y*size+x)*4;
          img.data[i]   = Math.floor(128+dhdx*70);
          img.data[i+1] = Math.floor(128+dhdy*70);
          img.data[i+2] = 200;
          img.data[i+3] = 255;
        }
      }
      ctx.putImageData(img, 0, 0);
      return makeTex(canvas, 2, 3);
    }

    function makePuddleNormalTex(size = 128) {
      const canvas = document.createElement("canvas");
      canvas.width = canvas.height = size;
      const ctx = canvas.getContext("2d");
      const img = ctx.createImageData(size, size);
      const rng = seededRandom("puddle-normal");
      for (let y = 0; y < size; y++) {
        for (let x = 0; x < size; x++) {
          const f = (2*Math.PI)/size;
          const dhdx = Math.sin(x*f*2)*0.9 + (rng()-0.5)*0.1;
          const dhdy = Math.cos(y*f*2)*0.9 + (rng()-0.5)*0.1;
          const i = (y*size+x)*4;
          img.data[i]   = Math.floor(128+dhdx*80);
          img.data[i+1] = Math.floor(128+dhdy*80);
          img.data[i+2] = 190;
          img.data[i+3] = 255;
        }
      }
      ctx.putImageData(img, 0, 0);
      const tex = new THREE.CanvasTexture(canvas);
      tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
      tex.repeat.set(1,1);
      tex.needsUpdate = true;
      return tex;
    }

    function makeSidewalkTex(W = 512, H = 512) {
      const canvas = document.createElement("canvas");
      canvas.width = W; canvas.height = H;
      const ctx = canvas.getContext("2d");
      const rng = seededRandom("sidewalk-v2");
      ctx.fillStyle = "rgb(140,134,124)"; ctx.fillRect(0,0,W,H);
      // Base variation
      for (let i = 0; i < 120; i++) {
        const v = Math.floor(128 + (rng()-0.5)*30);
        ctx.fillStyle = `rgba(${v},${v-5},${v-10},0.12)`;
        ctx.fillRect(rng()*W, rng()*H, 4+rng()*18, 2+rng()*8);
      }
      // Tile lines
      ctx.strokeStyle = "rgba(85,80,72,0.85)"; ctx.lineWidth = 2;
      for (let x = 0; x < W; x += 52) { ctx.beginPath(); ctx.moveTo(x,0); ctx.lineTo(x,H); ctx.stroke(); }
      for (let y = 0; y < H; y += 36) { ctx.beginPath(); ctx.moveTo(0,y); ctx.lineTo(W,y); ctx.stroke(); }
      // Cracks
      ctx.strokeStyle = "rgba(60,55,48,0.5)"; ctx.lineWidth = 1;
      for (let i = 0; i < 15; i++) {
        ctx.beginPath();
        let cx2 = rng()*W, cy2 = rng()*H;
        ctx.moveTo(cx2, cy2);
        for (let s = 0; s < 4; s++) { cx2 += (rng()-0.5)*30; cy2 += (rng()-0.5)*30; ctx.lineTo(cx2, cy2); }
        ctx.stroke();
      }
      // Stains
      for (let i = 0; i < 8; i++) {
        const sx = rng()*W, sy = rng()*H;
        const sg = ctx.createRadialGradient(sx,sy,0,sx,sy,12+rng()*20);
        sg.addColorStop(0,`rgba(50,48,44,${(0.08+rng()*0.12).toFixed(2)})`);
        sg.addColorStop(1,"rgba(0,0,0,0)");
        ctx.fillStyle = sg; ctx.fillRect(sx-32,sy-32,64,64);
      }
      return makeTex(canvas, 4, 6, true);
    }

    function makeBrickTex(W = 256, H = 256) {
      const canvas = document.createElement("canvas");
      canvas.width = W; canvas.height = H;
      const ctx = canvas.getContext("2d");
      const rng = seededRandom("brick-v2");
      ctx.fillStyle = "rgb(110,58,34)"; ctx.fillRect(0,0,W,H);
      const bw = 40, bh = 18;
      for (let row = 0; row < Math.ceil(H/bh)+1; row++) {
        const off = (row%2)*bw*0.5;
        for (let col = -1; col < Math.ceil(W/bw)+1; col++) {
          const bx = col*bw+off, by = row*bh;
          const r = Math.floor(105+rng()*30), g2 = Math.floor(52+rng()*20), b = Math.floor(28+rng()*18);
          ctx.fillStyle = `rgb(${r},${g2},${b})`;
          ctx.fillRect(bx+1, by+1, bw-2, bh-2);
          ctx.strokeStyle = "rgba(60,32,18,0.7)"; ctx.lineWidth = 1;
          ctx.strokeRect(bx+0.5, by+0.5, bw-1, bh-1);
        }
      }
      return makeTex(canvas, 3, 4, true);
    }

    function makeBrickNormalTex(size = 256) {
      const canvas = document.createElement("canvas");
      canvas.width = canvas.height = size;
      const ctx = canvas.getContext("2d");
      const img = ctx.createImageData(size, size);
      for (let y = 0; y < size; y++) {
        for (let x = 0; x < size; x++) {
          const bw = 40, bh = 18;
          const row = Math.floor(y/bh);
          const off = (row%2)*(bw*0.5);
          const lx = ((x+off)%bw)/bw, ly = (y%bh)/bh;
          const edge = Math.min(lx, 1-lx, ly, 1-ly) * 8;
          const bump = Math.min(1, edge);
          const i = (y*size+x)*4;
          img.data[i]   = Math.floor(128+(bump*2-1)*40);
          img.data[i+1] = Math.floor(128+(bump*2-1)*40);
          img.data[i+2] = 200;
          img.data[i+3] = 255;
        }
      }
      ctx.putImageData(img, 0, 0);
      return makeTex(canvas, 3, 4);
    }

    function makeConcreteWallTex(W = 256, H = 256) {
      const canvas = document.createElement("canvas");
      canvas.width = W; canvas.height = H;
      const ctx = canvas.getContext("2d");
      const rng = seededRandom("concrete-v2");
      ctx.fillStyle = "rgb(148,148,148)"; ctx.fillRect(0,0,W,H);
      ctx.fillStyle = "rgba(0,0,0,0.04)";
      for (let i = 0; i < 50; i++) ctx.fillRect(rng()*W, rng()*H, 4+rng()*20, 1+rng()*3);
      return makeTex(canvas, 2, 3, true);
    }

    function makeWoodTex(W = 256, H = 256) {
      const canvas = document.createElement("canvas");
      canvas.width = W; canvas.height = H;
      const ctx = canvas.getContext("2d");
      ctx.fillStyle = "rgb(120,78,38)"; ctx.fillRect(0,0,W,H);
      ctx.strokeStyle = "rgba(80,48,18,0.4)"; ctx.lineWidth = 1;
      for (let y = 0; y < H; y += 6) { ctx.beginPath(); ctx.moveTo(0,y); ctx.lineTo(W,y); ctx.stroke(); }
      return makeTex(canvas, 2, 4, true);
    }

    function makeWaterNormalTex(size = 256) {
      const canvas = document.createElement("canvas");
      canvas.width = canvas.height = size;
      const ctx = canvas.getContext("2d");
      const img = ctx.createImageData(size, size);
      const rng = seededRandom("ext-water-normal");
      for (let y = 0; y < size; y++) {
        for (let x = 0; x < size; x++) {
          const f = (2*Math.PI)/size;
          const dhdx = Math.cos(x*f*3.2+0.8)*3.2*f + (rng()-0.5)*0.3;
          const dhdy = -Math.sin(y*f*2.1)*2.1*f + (rng()-0.5)*0.3;
          const i = (y*size+x)*4;
          img.data[i]   = Math.floor(128+dhdx*60);
          img.data[i+1] = Math.floor(128+dhdy*60);
          img.data[i+2] = 225;
          img.data[i+3] = 255;
        }
      }
      ctx.putImageData(img, 0, 0);
      return makeTex(canvas, 3, 3);
    }

    function makeParticleTex(size = 64) {
      const canvas = document.createElement("canvas");
      canvas.width = canvas.height = size;
      const ctx = canvas.getContext("2d");
      const grad = ctx.createRadialGradient(size/2, size/2, 0, size/2, size/2, size/2);
      grad.addColorStop(0, "rgba(255,220,160,1)");
      grad.addColorStop(0.4, "rgba(255,200,120,0.6)");
      grad.addColorStop(1, "rgba(0,0,0,0)");
      ctx.fillStyle = grad;
      ctx.fillRect(0, 0, size, size);
      const tex = new THREE.CanvasTexture(canvas);
      tex.needsUpdate = true;
      return tex;
    }

    function makeGlowSpriteTex(size = 128, r, g, b) {
      const canvas = document.createElement("canvas");
      canvas.width = canvas.height = size;
      const ctx = canvas.getContext("2d");
      const grad = ctx.createRadialGradient(size/2, size/2, 0, size/2, size/2, size/2);
      grad.addColorStop(0, `rgba(${r},${g},${b},0.9)`);
      grad.addColorStop(0.35, `rgba(${r},${g},${b},0.4)`);
      grad.addColorStop(0.7, `rgba(${r},${g},${b},0.1)`);
      grad.addColorStop(1, "rgba(0,0,0,0)");
      ctx.fillStyle = grad;
      ctx.fillRect(0, 0, size, size);
      const tex = new THREE.CanvasTexture(canvas);
      tex.needsUpdate = true;
      return tex;
    }

    function makeAuroraTex(W = 512, H = 128) {
      const canvas = document.createElement("canvas");
      canvas.width = W; canvas.height = H;
      const ctx = canvas.getContext("2d");
      // Horizontal aurora bands
      const rng = seededRandom("aurora-v1");
      for (let band = 0; band < 6; band++) {
        const y = H * (0.1 + band * 0.15);
        const alpha = 0.08 + rng() * 0.18;
        const hue = 160 + rng() * 60; // cyan to blue-green
        const g2 = ctx.createLinearGradient(0, y - 20, 0, y + 20);
        g2.addColorStop(0, "rgba(0,0,0,0)");
        g2.addColorStop(0.5, `hsla(${hue},90%,60%,${alpha.toFixed(2)})`);
        g2.addColorStop(1, "rgba(0,0,0,0)");
        ctx.fillStyle = g2;
        ctx.fillRect(0, 0, W, H);
        // Wavy vertical variation
        for (let x = 0; x < W; x += 4) {
          const wave = Math.sin(x * 0.04 + band) * 8;
          const pa = alpha * (0.5 + 0.5 * Math.sin(x * 0.02));
          ctx.fillStyle = `hsla(${hue + rng()*20},90%,65%,${pa.toFixed(3)})`;
          ctx.fillRect(x, y + wave - 4, 4, 8);
        }
      }
      const tex = new THREE.CanvasTexture(canvas);
      tex.needsUpdate = true;
      return tex;
    }

    function makeLightDomeTex(size = 256) {
      const canvas = document.createElement("canvas");
      canvas.width = canvas.height = size;
      const ctx = canvas.getContext("2d");
      const grad = ctx.createRadialGradient(size/2, size/2, 0, size/2, size/2, size/2);
      grad.addColorStop(0, "rgba(255,140,40,0.8)");
      grad.addColorStop(0.3, "rgba(220,100,20,0.35)");
      grad.addColorStop(0.65, "rgba(160,60,10,0.08)");
      grad.addColorStop(1, "rgba(0,0,0,0)");
      ctx.fillStyle = grad;
      ctx.fillRect(0, 0, size, size);
      const tex = new THREE.CanvasTexture(canvas);
      tex.needsUpdate = true;
      return tex;
    }

    function makeGroundFogTex(size = 256) {
      const canvas = document.createElement("canvas");
      canvas.width = canvas.height = size;
      const ctx = canvas.getContext("2d");
      const grad = ctx.createRadialGradient(size/2, size/2, 0, size/2, size/2, size/2);
      grad.addColorStop(0, "rgba(200,210,230,0.9)");
      grad.addColorStop(0.5, "rgba(180,190,210,0.4)");
      grad.addColorStop(1, "rgba(0,0,0,0)");
      ctx.fillStyle = grad;
      ctx.fillRect(0, 0, size, size);
      const tex = new THREE.CanvasTexture(canvas);
      tex.needsUpdate = true;
      return tex;
    }

    function makeDebrisTex(W = 128, H = 128) {
      const canvas = document.createElement("canvas");
      canvas.width = W; canvas.height = H;
      const ctx = canvas.getContext("2d");
      ctx.clearRect(0, 0, W, H);
      const rng = seededRandom("debris-v1");
      // Dark stains and cracks
      for (let i = 0; i < 12; i++) {
        const x = rng()*W, y = rng()*H;
        const r = 4 + rng()*20;
        const g2 = ctx.createRadialGradient(x,y,0,x,y,r);
        g2.addColorStop(0, `rgba(10,8,5,${(0.2+rng()*0.3).toFixed(2)})`);
        g2.addColorStop(1, "rgba(0,0,0,0)");
        ctx.fillStyle = g2; ctx.fillRect(x-r,y-r,r*2,r*2);
      }
      const tex = new THREE.CanvasTexture(canvas);
      tex.needsUpdate = true;
      return tex;
    }

    // Texture cache
    const T = {
      road:          makeRoadTex(),
      roadNormal:    makeRoadNormalTex(),
      wetRoadNormal: makeWetRoadNormalTex(),
      puddleNormal:  makePuddleNormalTex(),
      sidewalk:      makeSidewalkTex(),
      brick:         makeBrickTex(),
      brickNormal:   makeBrickNormalTex(),
      concrete:      makeConcreteWallTex(),
      wood:          makeWoodTex(),
      waterNormals:  makeWaterNormalTex(),
      particle:      makeParticleTex(),
      debris:        makeDebrisTex(),
    };

    // Material factory — MeshStandardMaterial everywhere so lights work
    function std(params) { return new THREE.MeshStandardMaterial(params); }
    const white_c  = new THREE.Color(0xf0f0e8);
    const yellow_c = new THREE.Color(0xffe060);
    const M = {
      // polygonOffset pushes the exterior ground slightly deeper so it never
      // z-fights with the interior floor where the two overlap near the exits.
      ground:    std({ color:0x252528, roughness:0.96, metalness:0,    map:T.road,     normalMap:T.roadNormal, normalScale:new THREE.Vector2(0.3,0.3), polygonOffset:true, polygonOffsetFactor:1.5, polygonOffsetUnits:1.5 }),
      asphalt:   std({ color:0x1e1e22, roughness:0.92, metalness:0.05, map:T.road,     normalMap:T.roadNormal, normalScale:new THREE.Vector2(0.25,0.25) }),
      wetRoad:   std({ color:0x1a1a1e, roughness:0.05, metalness:0.80, map:T.road,     normalMap:T.wetRoadNormal, normalScale:new THREE.Vector2(0.6,0.6), envMapIntensity:2.0 }),
      sidewalk:  std({ color:0x8a8480, roughness:0.88, metalness:0,    map:T.sidewalk }),
      concrete:  std({ color:0x909090, roughness:0.85, metalness:0,    map:T.concrete }),
      brick:     std({ color:0x8a4828, roughness:0.88, metalness:0,    map:T.brick,    normalMap:T.brickNormal, normalScale:new THREE.Vector2(0.45,0.45) }),
      brickDark: std({ color:0x6a3418, roughness:0.90, metalness:0,    map:T.brick,    normalMap:T.brickNormal, normalScale:new THREE.Vector2(0.40,0.40) }),
      stone:     std({ color:0x888880, roughness:0.92, metalness:0,    map:T.concrete }),
      roof:      std({ color:0x282828, roughness:0.95, metalness:0.15 }),
      metal:     std({ color:0x909090, roughness:0.30, metalness:0.85, normalScale:new THREE.Vector2(0.5,0.5) }),
      metalDark: std({ color:0x404040, roughness:0.45, metalness:0.80 }),
      metalBase: std({ color:0x1a1a1a, roughness:0.35, metalness:0.90 }),
      lampPole:  std({ color:0x606058, roughness:0.50, metalness:0.70 }),
      wood:      std({ color:0x7a4e26, roughness:0.85, metalness:0,    map:T.wood }),
      glass:     std({ color:0x1a2030, roughness:0.05, metalness:0.1, transparent:true, opacity:0.45, emissive:new THREE.Color(0x121e34), emissiveIntensity:0.18 }),
      winLit:    std({ color:0x201808, roughness:0.10, metalness:0,   emissive:new THREE.Color(0xffb030), emissiveIntensity:0.28 }),
      winLitCool:std({ color:0x080c18, roughness:0.10, metalness:0,   emissive:new THREE.Color(0x50d8ff), emissiveIntensity:0.22 }),
      winBlue:   std({ color:0x080c18, roughness:0.10, metalness:0,   emissive:new THREE.Color(0x2870c0), emissiveIntensity:0.22 }),
      winDim:    std({ color:0x101418, roughness:0.15, metalness:0,   emissive:new THREE.Color(0x182030), emissiveIntensity:0.12 }),
      winOff:    std({ color:0x0c0e12, roughness:0.20, metalness:0 }),
      neon1:     std({ color:0x200008, roughness:0.10, metalness:0,   emissive:new THREE.Color(0xff1840), emissiveIntensity:0.7 }),
      neon2:     std({ color:0x001810, roughness:0.10, metalness:0,   emissive:new THREE.Color(0x00ffcc), emissiveIntensity:0.55 }),
      neon3:     std({ color:0x001020, roughness:0.10, metalness:0,   emissive:new THREE.Color(0x4488ff), emissiveIntensity:0.55 }),
      white:     std({ color:white_c,  roughness:0.60, metalness:0 }),
      yellow:    std({ color:yellow_c, roughness:0.60, metalness:0 }),
      rust:      std({ color:0x8b4513, roughness:0.95, metalness:0.2 }),
      water:     std({ color:0x3366aa, roughness:0.05, metalness:0.3, transparent:true, opacity:0.75, normalMap:T.waterNormals, normalScale:new THREE.Vector2(0.8,0.8) }),
      manhole:   std({ color:0x2a2a2a, roughness:0.55, metalness:0.70 }),
      tireTrack: std({ color:0x0a0a0a, roughness:0.95, metalness:0, depthWrite:false, polygonOffset:true, polygonOffsetFactor:-1, polygonOffsetUnits:-1 }),
    };

    // UV helper
    function copyUvToUv2(geo) {
      const uv = geo.attributes.uv;
      if (uv && !geo.attributes.uv2) geo.setAttribute("uv2", uv.clone());
    }

    // Geometry bucket system (merge per material for draw call efficiency)
    const _buckets = new Map();
    const _q = new THREE.Quaternion();
    const _m4 = new THREE.Matrix4();

    function addMesh(w, h, d, cx, cy, cz, mat, addToWalls) {
      const geo = new THREE.BoxGeometry(w, h, d);
      copyUvToUv2(geo);
      const mesh = new THREE.Mesh(geo, mat);
      mesh.position.set(cx, cy, cz);
      mesh.receiveShadow = true;
      mesh.castShadow = mat.transparent !== true; // opaque props/buildings cast sun shadows
      scene.add(mesh);
      if (addToWalls) extWallMeshes.push(mesh);
      return mesh;
    }

    function bucket(mat) {
      if (!_buckets.has(mat)) _buckets.set(mat, []);
      return _buckets.get(mat);
    }

    function queueBox(w, h, d, cx, cy, cz, mat, ry) {
      const geo = new THREE.BoxGeometry(w, h, d);
      copyUvToUv2(geo);
      _q.setFromEuler(new THREE.Euler(0, ry || 0, 0));
      _m4.compose(new THREE.Vector3(cx, cy, cz), _q, new THREE.Vector3(1,1,1));
      geo.applyMatrix4(_m4);
      bucket(mat).push(geo);
    }

    function queueCyl(rT, rB, h, cx, cy, cz, mat, segs) {
      const geo = new THREE.CylinderGeometry(rT, rB, h, segs || 8);
      copyUvToUv2(geo);
      _m4.makeTranslation(cx, cy, cz);
      geo.applyMatrix4(_m4);
      bucket(mat).push(geo);
    }

    function flushBuckets() {
      for (const [mat, geos] of _buckets) {
        if (!geos.length) continue;
        const merged = geos.length === 1 ? geos[0] : mergeGeometries(geos);
        const mesh = new THREE.Mesh(merged, mat);
        mesh.receiveShadow = true;
        // Opaque merged geometry (buildings, kerbs, planters, poles…) must CAST too —
        // this was the missing half of the exterior shadow setup: everything received
        // but nothing cast, so the outdoors had no shadows at all. Transparent mats
        // (glass, water, decals) stay non-casting.
        mesh.castShadow = mat.transparent !== true;
        mesh.name = "ext_merged";
        scene.add(mesh);
        extWallMeshes.push(mesh);
        for (const g of geos) if (g !== merged) g.dispose();
      }
      _buckets.clear();
    }

    // ── NEW SKY IMPLEMENTATION ──────────────────────────────────────────
    async function setupExtSky() {
      // Remove any previous sky objects (from old versions)
      ['ExtSkyDome', 'ExtStars', 'ExtMilkyWay', 'ExtMoon', 'ExtMoonGlow'].forEach(n => {
        const o = scene.getObjectByName(n); if (o) scene.remove(o);
      });

      // 1. Night sky background — deep navy, no atmospheric scattering shader.
      // Three.js Sky shader produces a black disc at the zenith on night settings,
      // so we skip it entirely and use a simple gradient dome instead.
      // ── DAYTIME SKY ──────────────────────────────────────────────────────
      // Just a solid bright-blue clear colour — no dome/sun/starfield meshes. The
      // old night build stacked a painted sky sphere + moon + stars + Milky Way,
      // which were both a cost and (against the new daylight) a source of floating
      // disc/blob artifacts. A plain background fills the whole sky, can't misrender,
      // and costs nothing. (A stylised sun/clouds can come back in the polish pass.)
      // Fallback flat sky colour only. The main game builds a procedural equirect sky
      // + IBL environment map AFTER the exterior (buildSkyEnvironment in three_fps_game.js),
      // which overrides this background and supplies the visible sun — so there is no
      // separate sun sprite here (a second sun would double up).
      scene.background = new THREE.Color(0xd8c2a4);
    }


    // ── Lighting ──────────────────────────────────────────────────────────
    function setupExtLighting() {
      // ── DAYTIME LIGHTING ─────────────────────────────────────────────────
      // The night build evaluated ~24 dynamic point lights per fragment (12 lamps
      // + ground bounces + window glows + fountain + billboard) and its own comment
      // flagged that as the dominant exterior cost on WebGPU. Daylight only needs a
      // sun + sky fill, so every point light is gone — a large, safe perf win that
      // also delivers the bright daytime look. Sun shadows are intentionally off to
      // avoid a second real-time shadow map (perf-first, per the redesign brief).
      // GOLDEN HOUR: aimed at the ACTUAL sun in the kloppenheim_06 HDR skybox so the
      // cast shadows point away from the visible sun. Azimuth measured from the HDR by
      // scripts/find-sun.mjs (brightest-pixel centroid → the dome's equirect mapping,
      // u = (PI - atan2(z,x))/2PI): azimuth -39.3deg. The old hand-guessed
      // (0.86,0.30,0.18) put the light on the WRONG side (+Z), so shadows fell opposite
      // the sky's sun. Elevation nudged up from the measured 7deg to 14deg so the
      // golden-hour shadows stay long/dramatic but readable for gameplay.
      const sunDir = new THREE.Vector3(0.751, 0.242, -0.615).normalize();
      // Shadows only on medium/high tier (low tier disables them for performance).
      const sunShadows = profile.tier !== "low";
      // No shadows → lean on fill for even light across the whole scene.
      // With shadows → keep fill low so the cast shadows read as contrast.
      scene.add(new THREE.AmbientLight(0xffdfc0, sunShadows ? 0.10 : 0.24));
      // Dusk sky fill: cool blue-grey from above, warm earth bounce from below.
      // With shadows on, fill is kept LOW on purpose — it's what pools inside cast
      // shadows, so every bit of it lightens them and kills contrast.
      const hemi = new THREE.HemisphereLight(0xafbdd8, 0xa07c56, sunShadows ? 0.26 : 0.60);
      hemi.position.set(0, 40, 176);
      scene.add(hemi);
      // Warm golden-hour sun — the KEY light (+ shadow caster on medium/high).
      const sun = new THREE.DirectionalLight(0xffc27c, sunShadows ? 2.9 : 2.3);
      const SUN_CENTER_Z = 60; // between the arena (z<120) and exterior plaza
      sun.position.set(sunDir.x * 200, sunDir.y * 200, SUN_CENTER_Z + sunDir.z * 200);
      sun.target.position.set(0, 0, SUN_CENTER_Z);
      sun.castShadow = sunShadows;
      if (sunShadows) {
        // High tier gets a denser map (sharper edges).
        const shadowRes = profile.tier === "high" ? 4096 : 2048;
        sun.shadow.mapSize.set(shadowRes, shadowRes);
        sun.shadow.bias = -0.0005;
        // normalBias 0.8 was eroding shadows: it pushes sample points ~a meter off
        // every surface, shrinking and lightening all shadow edges. The geometry here
        // is large merged boxes, so a much smaller bias still avoids acne.
        sun.shadow.normalBias = 0.25;
        // Fit the ortho shadow frustum TIGHTLY to the actual playable world instead
        // of a fixed ±185 box: project the world AABB's corners into light space and
        // size the frustum to them. The old fixed box wasted well over half the map
        // (play area is x ±74, z -40..232) so texel density was needlessly low.
        // Exposed as window.__extFitSunShadow so the game can refit after moving the
        // sun (blackout waves reposition it to the fiery horizon).
        const fitSunShadow = () => {
          const sc = sun.shadow.camera;
          const target = sun.target.position;
          // World AABB of everything that matters for gameplay shadows:
          // interior (x ±68, z -40..122) + exterior (x ±74, z 118..232), y 0..26.
          const min = new THREE.Vector3(-76, -1, -42);
          const max = new THREE.Vector3(76, 28, EXT_Z_FAR + 4);
          const look = new THREE.Matrix4().lookAt(sun.position, target, new THREE.Vector3(0, 1, 0));
          const toLight = new THREE.Matrix4().copy(look).transpose(); // rotation only, world->light
          const p = new THREE.Vector3();
          let lx0 = Infinity, lx1 = -Infinity, ly0 = Infinity, ly1 = -Infinity, lz0 = Infinity, lz1 = -Infinity;
          for (let i = 0; i < 8; i++) {
            p.set(i & 1 ? max.x : min.x, i & 2 ? max.y : min.y, i & 4 ? max.z : min.z)
              .sub(sun.position).applyMatrix4(toLight);
            lx0 = Math.min(lx0, p.x); lx1 = Math.max(lx1, p.x);
            ly0 = Math.min(ly0, p.y); ly1 = Math.max(ly1, p.y);
            lz0 = Math.min(lz0, p.z); lz1 = Math.max(lz1, p.z);
          }
          const pad = 4;
          sc.left = lx0 - pad; sc.right = lx1 + pad;
          sc.bottom = ly0 - pad; sc.top = ly1 + pad;
          sc.near = Math.max(0.5, -lz1 - pad); sc.far = -lz0 + pad;
          sc.updateProjectionMatrix();
        };
        fitSunShadow();
        window.__extFitSunShadow = fitSunShadow;
      }
      scene.add(sun);
      scene.add(sun.target);
      // Expose sun + hemisphere so the game can dim them when the player is inside the
      // roofed interior (global lights don't self-occlude, so this is how we make the
      // interior read darker than the sunny exterior).
      sun.userData.baseIntensity = sun.intensity;
      hemi.userData.baseIntensity = hemi.intensity;
      window.__extSun = sun;
      window.__extHemi = hemi;
    }

    // ── Ground ────────────────────────────────────────────────────────────
    function buildGround() {
      const depth = EXT_Z_FAR - EXT_Z_NEAR;
      const cz = EXT_Z_NEAR + depth * 0.5;

      // Wide base plane under the ENTIRE play area (interior footprint + exterior +
      // generous margins) so there's never a visible void beside or behind the
      // building. Sits just below y=0 so it never z-fights the interior floor (y=0)
      // or the detailed exterior ground above it. Collision is unchanged — movement is
      // still gated by the MAP grid / exterior bounds, this is purely visual backing.
      queueBox(360, 0.10, 640, 0, -0.20, 90, M.ground);

      // Base ground
      queueBox(146, 0.10, depth, 0, -0.05, cz, M.ground);
      // Road asphalt
      queueBox(38,  0.09, depth, 0,  0.05, cz, M.asphalt);
      // Sidewalks
      queueBox(26,  0.12, depth, -43, 0.06, cz, M.sidewalk);
      queueBox(26,  0.12, depth,  43, 0.06, cz, M.sidewalk);

      // Wet reflective asphalt surface (slightly above road)
      const wetGeo = new THREE.PlaneGeometry(36, depth);
      copyUvToUv2(wetGeo);
      const wetMesh = new THREE.Mesh(wetGeo, M.wetRoad);
      wetMesh.rotation.x = -Math.PI / 2;
      wetMesh.position.set(0, 0.06, cz);
      wetMesh.receiveShadow = true;
      wetMesh.name = "wetRoadSurface";
      scene.add(wetMesh);

      // Road markings
      for (let z = EXT_Z_NEAR + 5; z < EXT_Z_FAR; z += 10) {
        queueBox(0.15, 0.09, 4.2, -6.5, 0.10, z, M.white);
        queueBox(0.15, 0.09, 4.2,  0,   0.10, z, M.yellow);
        queueBox(0.15, 0.09, 4.2,  6.5, 0.10, z, M.white);
      }
      // Edge lines
      queueBox(0.18, 0.09, depth, -18.9, 0.10, cz, M.white);
      queueBox(0.18, 0.09, depth,  18.9, 0.10, cz, M.white);
      // Crosswalk near fountain
      for (let i = -3; i <= 3; i++) {
        queueBox(32, 0.09, 0.9, 0, 0.10, 176 + i*1.9, M.white);
      }

      // Puddles near lampposts and fountain area
      const puddleRng = seededRandom("puddles-v1");
      const puddleSpots = [
        [-15, 137, 3.5, 1.8], [15, 137, 2.8, 2.0],
        [-16, 160, 4.0, 1.5], [16, 160, 3.2, 2.2],
        [-14, 175, 2.6, 1.8], [14, 175, 3.8, 1.6],
        [2, 134, 4.5, 3.0],   [-4, 132, 2.8, 2.2],
        [-16, 192, 3.4, 1.9], [16, 208, 3.0, 2.1],
      ];
      const puddleMat = std({
        color: 0x1a2030, roughness: 0.0, metalness: 1.0,
        transparent: true, opacity: 0.65,
        normalMap: T.puddleNormal,
        normalScale: new THREE.Vector2(0.4, 0.4),
      });
      for (const [px, pz, pw, pd] of puddleSpots) {
        const puddleGeo = new THREE.PlaneGeometry(pw + puddleRng()*0.5, pd + puddleRng()*0.4, 4, 4);
        // Slightly deform edges for irregular shape
        const pos = puddleGeo.attributes.position;
        for (let i = 0; i < pos.count; i++) {
          const xi = pos.getX(i), zi = pos.getZ(i);
          if (Math.abs(xi) > pw*0.2 || Math.abs(zi) > pd*0.2) {
            pos.setX(i, xi + (puddleRng()-0.5)*0.4);
            pos.setZ(i, zi + (puddleRng()-0.5)*0.4);
          }
        }
        pos.needsUpdate = true;
        copyUvToUv2(puddleGeo);
        const puddleMesh = new THREE.Mesh(puddleGeo, puddleMat.clone());
        puddleMesh.rotation.x = -Math.PI / 2;
        puddleMesh.position.set(px, 0.07, pz);
        puddleMesh.receiveShadow = true;
        scene.add(puddleMesh);
      }

      // Tire marks
      const tireMarkSpots = [
        [-24, cz, 0.6, depth * 0.8],
        [ 24, cz, 0.6, depth * 0.8],
        [ -8, cz, 0.4, depth * 0.6],
        [  8, cz, 0.4, depth * 0.6],
      ];
      for (const [tx, tz, tw, td] of tireMarkSpots) {
        const tGeo = new THREE.PlaneGeometry(tw, td);
        const tMesh = new THREE.Mesh(tGeo, M.tireTrack);
        tMesh.rotation.x = -Math.PI / 2;
        tMesh.position.set(tx, 0.07, tz);
        scene.add(tMesh);
      }

      // Manhole covers
      const manholeSpots = [[0, 148], [0, 166], [0, 184], [6, 155], [-6, 175]];
      for (const [mx, mz] of manholeSpots) {
        queueCyl(0.5, 0.5, 0.04, mx, 0.07, mz, M.manhole, 16);
      }
    }

    // ── Buildings ─────────────────────────────────────────────────────────
    function buildBuilding(cx, cz, w, d, h, bodyMat) {
      const rng = seededRandom(`bld-${cx}-${cz}`);

      // Main body
      queueBox(w, h, d, cx, h*0.5, cz, bodyMat);
      addCollider(cx, cz, w+0.1, d+0.1);

      // Ledges at each floor boundary (every 3.5 units)
      const floors = Math.floor(h / 3.5);
      for (let f = 1; f < floors; f++) {
        const ly = f * 3.5;
        queueBox(w + 0.24, 0.18, d + 0.24, cx, ly, cz, M.concrete);
      }

      // Base trim (dark metallic)
      queueBox(w + 0.1, 0.5, d + 0.1, cx, 0.25, cz, M.metalBase);

      // Windows on front face (south-facing, lower Z side)
      const faceZ = cz - d*0.5 - 0.08;
      const cols = Math.max(2, Math.floor(w / 3.8));
      const rows = Math.max(2, Math.floor(h / 3.5));
      for (let r = 0; r < rows; r++) {
        for (let c = 0; c < cols; c++) {
          const wx = cx - w*0.5 + (c+0.5)*(w/cols);
          const wy = 2.0 + r*3.5;
          const roll = rng();
          const wm = roll < 0.45 ? M.winLit
                   : roll < 0.62 ? M.winLitCool
                   : roll < 0.74 ? M.winBlue
                   : roll < 0.88 ? M.winDim
                   : M.winOff;
          queueBox(1.30, 1.70, 0.10, wx, wy, faceZ, wm);
        }
      }

      // Rooftop details
      queueBox(w + 0.3, 0.65, d + 0.3, cx, h + 0.32, cz, M.roof);
      // AC units on roof
      const acCount = Math.floor(2 + rng() * 3);
      for (let a = 0; a < acCount; a++) {
        const ax = cx + (rng()-0.5)*(w*0.7);
        const az = cz + (rng()-0.5)*(d*0.7);
        const aw = 0.8 + rng()*0.6, ah = 0.6 + rng()*0.5, ad = 0.7 + rng()*0.5;
        queueBox(aw, ah, ad, ax, h + 0.65 + ah*0.5, az, M.metalDark);
      }
      // Water tower (on taller buildings)
      if (h > 15) {
        const wtx = cx + (rng()-0.5)*w*0.4;
        const wtz = cz + (rng()-0.5)*d*0.4;
        queueCyl(0.06, 0.08, 2.5, wtx, h + 1.9, wtz, M.metalDark, 6);
        queueCyl(0.06, 0.08, 2.5, wtx + 0.9, h + 1.9, wtz, M.metalDark, 6);
        queueCyl(0.06, 0.08, 2.5, wtx - 0.9, h + 1.9, wtz, M.metalDark, 6);
        queueCyl(0.7, 0.8, 1.8, wtx, h + 3.5, wtz, M.wood, 10);
        queueCyl(0.75, 0.75, 0.15, wtx, h + 4.45, wtz, M.metalDark, 10);
      }
      // Antenna
      if (rng() > 0.4) {
        const antx = cx + (rng()-0.5)*w*0.5;
        const antz = cz + (rng()-0.5)*d*0.5;
        queueCyl(0.02, 0.03, 3.0 + rng()*2, antx, h + 2.1, antz, M.metalDark, 4);
      }

      // Fire escape on one face (if wide enough)
      if (w >= 18 && rng() > 0.3) {
        const feX = cx - w*0.5 + 3;
        const feZ = cz - d*0.5 - 0.2;
        const feLevels = Math.min(3, Math.floor(h / 3.5) - 1);
        for (let fl = 0; fl < feLevels; fl++) {
          const fy = 2.0 + fl * 3.5;
          // Platform
          queueBox(2.2, 0.08, 1.2, feX, fy, feZ - 0.7, M.metalDark);
          // Railing
          queueBox(2.2, 0.6, 0.05, feX, fy + 0.34, feZ - 1.25, M.metalDark);
          // Vertical rail posts
          queueCyl(0.04, 0.04, 0.7, feX - 1.0, fy + 0.35, feZ - 1.25, M.metalDark, 4);
          queueCyl(0.04, 0.04, 0.7, feX + 1.0, fy + 0.35, feZ - 1.25, M.metalDark, 4);
          // Ladder between levels
          if (fl < feLevels - 1) {
            queueBox(0.05, 3.5, 0.05, feX - 0.4, fy + 1.75, feZ - 0.7, M.metalDark);
            queueBox(0.05, 3.5, 0.05, feX + 0.4, fy + 1.75, feZ - 0.7, M.metalDark);
          }
        }
      }
    }

    function buildAllBuildings() {
      buildBuilding(-52, 155, 18, 12, 14, M.brick);
      buildBuilding(-54, 198, 20, 14, 22, M.concrete);
      buildBuilding( 52, 155, 18, 12, 18, M.stone);
      buildBuilding( 54, 198, 20, 14, 16, M.brickDark);
      buildBuilding(-36, 222, 42, 14, 20, M.concrete);
      buildBuilding( 36, 222, 42, 14, 16, M.brickDark);
    }

    // Procedural CITY GRID flanking the central avenue. A seeded (deterministic)
    // grid of blocks separated by cross-streets (skipped rows/cols). The central
    // avenue and the hand-authored near-plaza are kept clear. buildBuilding
    // auto-registers each as a movement + Rapier collider and merges geometry into
    // the shared buckets, so draw-call cost stays low even at city scale.
    function buildProceduralCity() {
      const rng = seededRandom("city-grid-v2");
      const mats = [M.brick, M.concrete, M.stone, M.brickDark];
      const PITCH = 20;
      let col = 0;
      for (let cx = EXT_X_MIN + 8; cx <= EXT_X_MAX - 8; cx += PITCH, col++) {
        if (Math.abs(cx) < 28) continue;              // keep the central avenue clear
        if (col % 4 === 0) continue;                   // N-S cross streets
        let row = 0;
        for (let cz = 132; cz <= EXT_Z_FAR - 12; cz += PITCH, row++) {
          if (row % 4 === 0) continue;                 // E-W cross streets
          // Keep the whole PLAYABLE box clear — the grid is pure vista beyond it.
          if (cz < PLAY_Z_FAR + 12 && Math.abs(cx) < PLAY_X_MAX + 10) continue;
          if (rng() < 0.12) continue;                   // occasional empty lot
          const w = PITCH - 6 - rng() * 3;
          const d = PITCH - 6 - rng() * 3;
          const h = 10 + Math.floor(rng() * 36);        // varied skyline
          buildBuilding(cx + (rng() - 0.5) * 2, cz + (rng() - 0.5) * 2, w, d, h, mats[Math.floor(rng() * mats.length)]);
        }
      }
    }

    // ── Neon signs ────────────────────────────────────────────────────────
    // Track neon meshes for flicker animation
    const _neonMeshes = []; // { mesh, baseIntensity, color }

    function addNeonWithGlow() { /* neon lights removed */ }

    function buildNeons() { /* neon lights removed per user request */ }

    // ── Fountain ─────────────────────────────────────────────────────────
    function buildFountain(cx, cz) {
      cx = cx ?? 0; cz = cz ?? 134;
      addCollider(cx, cz, 5.5, 5.5);
      queueBox(5.2, 0.5,  5.2, cx, 0.25, cz, M.stone);
      queueBox(5.0, 0.08, 5.0, cx, 0.50, cz, M.water);
      queueBox(0.3, 1.2,  5.2, cx-2.6, 0.85, cz, M.stone);
      queueBox(0.3, 1.2,  5.2, cx+2.6, 0.85, cz, M.stone);
      queueBox(5.2, 1.2,  0.3, cx, 0.85, cz-2.6, M.stone);
      queueBox(5.2, 1.2,  0.3, cx, 0.85, cz+2.6, M.stone);
      queueCyl(0.22, 0.28, 2.2, cx, 1.1,  cz, M.stone, 10);
      queueCyl(1.1,  1.2,  0.3, cx, 2.35, cz, M.stone, 16);
      queueCyl(0.9,  0.9,  0.1, cx, 2.55, cz, M.water, 16);
      const fwn = T.waterNormals.clone();
      fwn.wrapS = fwn.wrapT = THREE.RepeatWrapping;
      fwn.repeat.set(3, 2);
      const fallMat = new THREE.MeshStandardMaterial({
        color:0x5599bb, roughness:0.10, metalness:0.40,
        transparent:true, opacity:0.55,
        normalMap:fwn, normalScale:new THREE.Vector2(0.6,0.6),
        side:THREE.DoubleSide,
      });
      let _fwt = 0;
      const fallMesh = new THREE.Mesh(new THREE.CylinderGeometry(1.05,1.10,1.65,24,4,true), fallMat);
      fallMesh.position.set(cx, 1.62, cz);
      fallMesh.receiveShadow = true;
      fallMesh.onBeforeRender = () => { _fwt += 0.012; fwn.offset.set(Math.sin(_fwt*0.07)*0.04, -_fwt*0.18); };
      scene.add(fallMesh);
    }

    // ── Benches ──────────────────────────────────────────────────────────
    function buildBenches() {
      const spots = [[-18,148],[-18,165],[18,150],[18,168],[-18,185],[18,188]];
      for (const [bx, bz] of spots) {
        queueBox(2.4, 0.12, 0.6, bx, 0.88, bz, M.wood);
        queueBox(0.1, 0.7,  0.5, bx-1.0, 0.45, bz, M.metalDark);
        queueBox(0.1, 0.7,  0.5, bx+1.0, 0.45, bz, M.metalDark);
        queueBox(2.4, 0.08, 0.5, bx, 1.32, bz-0.22, M.wood);
        addCollider(bx, bz, 2.6, 0.8);
      }
    }

    // ── Lampposts ────────────────────────────────────────────────────────
    function buildLampposts() {
      const posts = [
        [-17.5,137],[17.5,137],[-17.5,145],[17.5,145],
        [-17.5,160],[17.5,160],[-17.5,175],[17.5,175],
        [-17.5,192],[17.5,192],[-17.5,208],[17.5,208],
      ];
      for (const [lx, lz] of posts) {
        queueCyl(0.06, 0.08, 7.0, lx+3.5, 3.5,  lz, M.lampPole, 6);
        queueCyl(0.05, 0.05, 1.4, lx+4.2, 7.0,  lz, M.lampPole, 6);
        queueBox(0.6,  0.25, 0.6, lx+4.8, 7.35, lz, M.metal);
        addCollider(lx+3.5, lz, 0.2, 0.2);
      }
    }

    // ── Hydrants & props ─────────────────────────────────────────────────
    function buildHydrantsAndProps() {
      const hydrants = [
        [-20,140],[-20,158],[20,152],[20,170],[-20,180],
        [-20,195],[20,188],[-20,212],[20,205],
      ];
      for (const [hx, hz] of hydrants) {
        queueCyl(0.12, 0.14, 0.55, hx, 0.275, hz, M.neon1, 6);
        queueBox(0.28, 0.10, 0.18, hx, 0.60, hz, M.neon1);
        addCollider(hx, hz, 0.35, 0.35);
      }
      const bins = [[-22,148],[22,155],[-22,172],[22,182],[-22,200],[22,195]];
      for (const [bx, bz] of bins) {
        queueCyl(0.28, 0.30, 0.9, bx, 0.45, bz, M.metalDark, 8);
        // Slightly offset lid
        queueCyl(0.31, 0.31, 0.06, bx + 0.04, 0.93, bz + 0.03, M.metalDark, 8);
        addCollider(bx, bz, 0.65, 0.65);
      }
    }

    // ── Billboard ────────────────────────────────────────────────────────
    function buildBillboard(cx, cz) {
      cx = cx ?? -43; cz = cz ?? 215;
      queueBox(0.3, 11, 0.3,  cx-5.2, 5.5, cz, M.metalDark);
      queueBox(0.3, 11, 0.3,  cx+5.2, 5.5, cz, M.metalDark);
      queueBox(12,  7,  0.26, cx, 13.5,     cz, M.metalDark);
      queueBox(10,  1.0,0.08, cx, 14.0,     cz-0.15, M.neon3);
      queueBox(7,   0.8,0.08, cx, 12.8,     cz-0.15, M.neon1);
      addCollider(cx-5.2, cz, 0.4, 0.4);
      addCollider(cx+5.2, cz, 0.4, 0.4);
    }

    // ── Procedural cars ──────────────────────────────────────────────────
    function buildCar(cx, cz, ry, bodyColor) {
      const bodyMat = std({ color:bodyColor, roughness:0.22, metalness:0.88 });
      const glassMat = std({ color:0x1a2030, roughness:0.04, metalness:0.1, transparent:true, opacity:0.48, emissive:new THREE.Color(0x0a1020), emissiveIntensity:0.12 });
      const chromeMat = std({ color:0xd0d0d0, roughness:0.12, metalness:0.98 });
      const darkMat   = std({ color:0x181818, roughness:0.80, metalness:0.2 });
      const tireMat   = std({ color:0x151515, roughness:0.92, metalness:0 });
      const rimMat    = std({ color:0xb0b8c0, roughness:0.18, metalness:0.95 });
      const lightMat  = std({ color:0x200800, roughness:0.05, metalness:0, emissive:new THREE.Color(0xff6010), emissiveIntensity:0.55 });
      const bLightMat = std({ color:0x080008, roughness:0.05, metalness:0, emissive:new THREE.Color(0xcc0010), emissiveIntensity:0.5 });

      const g = new THREE.Group();
      g.position.set(cx, 0, cz);
      g.rotation.y = ry;
      scene.add(g);
      extWallMeshes.push(g);

      function part(geo, mat, px, py, pz, rx, rz) {
        const m = new THREE.Mesh(geo, mat);
        m.position.set(px||0, py||0, pz||0);
        if (rx) m.rotation.x = rx;
        if (rz) m.rotation.z = rz;
        m.receiveShadow = true;
        m.castShadow = mat.transparent !== true; // car bodies cast; glass doesn't
        g.add(m); return m;
      }

      part(new THREE.BoxGeometry(4.20, 0.80, 1.92), bodyMat, 0, 0.58, 0);
      part(new THREE.BoxGeometry(2.40, 0.72, 1.82), bodyMat, 0, 1.22, 0.04);
      const hoodGeo = new THREE.BoxGeometry(1.30, 0.32, 1.88);
      const hs = part(hoodGeo, bodyMat, 1.42, 0.90, 0);
      hs.rotation.z = -0.22;
      const trunkGeo = new THREE.BoxGeometry(1.10, 0.28, 1.88);
      const tr = part(trunkGeo, bodyMat, -1.42, 0.88, 0);
      tr.rotation.z = 0.18;
      part(new THREE.BoxGeometry(0.06, 0.52, 1.76), glassMat, 1.06, 1.12, 0);
      const ws = part(new THREE.BoxGeometry(0.06, 0.48, 1.78), glassMat, -1.20, 1.10, 0);
      ws.rotation.z = 0.38;
      part(new THREE.BoxGeometry(2.20, 0.46, 0.06), glassMat, -0.06, 1.22, -0.91);
      part(new THREE.BoxGeometry(2.20, 0.46, 0.06), glassMat, -0.06, 1.22,  0.91);
      part(new THREE.BoxGeometry(4.20, 0.06, 0.05), chromeMat, 0, 0.20, -0.97);
      part(new THREE.BoxGeometry(4.20, 0.06, 0.05), chromeMat, 0, 0.20,  0.97);
      part(new THREE.BoxGeometry(0.22, 0.10, 0.30), darkMat, 0.82, 1.08, -0.99);
      part(new THREE.BoxGeometry(0.22, 0.10, 0.30), darkMat, 0.82, 1.08,  0.99);
      part(new THREE.BoxGeometry(0.14, 0.22, 0.60), lightMat,  2.10, 0.64, -0.62);
      part(new THREE.BoxGeometry(0.14, 0.22, 0.60), lightMat,  2.10, 0.64,  0.62);
      part(new THREE.BoxGeometry(0.12, 0.18, 0.50), bLightMat,-2.10, 0.64, -0.62);
      part(new THREE.BoxGeometry(0.12, 0.18, 0.50), bLightMat,-2.10, 0.64,  0.62);

      for (const [wx, wz] of [[1.28,-0.97],[1.28,0.97],[-1.28,-0.97],[-1.28,0.97]]) {
        const tGeo = new THREE.CylinderGeometry(0.33, 0.33, 0.26, 14);
        const tw = new THREE.Mesh(tGeo, tireMat);
        tw.rotation.z = Math.PI/2;
        tw.position.set(wx, 0.33, wz);
        tw.receiveShadow = true;
        tw.castShadow = true;
        g.add(tw);
        const rGeo = new THREE.CylinderGeometry(0.21, 0.21, 0.28, 8);
        const rw = new THREE.Mesh(rGeo, rimMat);
        rw.rotation.z = Math.PI/2;
        rw.position.set(wx, 0.33, wz);
        g.add(rw);
      }

      // Car head/tail lights: DISABLED. This is a bright daytime scene, so 7 cars ×
      // 2 real-time PointLights = 14 lights added huge per-fragment forward-lighting
      // cost across the whole outdoor arena (a top FPS sink) for effectively zero
      // visible gain under the sun. The light housings keep their emissive glow, so
      // the cars still read correctly. Flip CAR_LIGHTS_ENABLED to true for a night build.
      const CAR_LIGHTS_ENABLED = false;
      if (CAR_LIGHTS_ENABLED) {
        const carDir = new THREE.Vector3(Math.sin(ry), 0, Math.cos(ry));
        const headL = new THREE.PointLight(0xfff8e0, 60, 14, 2.0);
        headL.position.set(cx + carDir.x*2.15, 0.64, cz + carDir.z*2.15);
        scene.add(headL);
        const tailL = new THREE.PointLight(0xff0808, 40, 8, 2.0);
        tailL.position.set(cx - carDir.x*2.15, 0.64, cz - carDir.z*2.15);
        scene.add(tailL);
      }

      addCollider(cx, cz, 4.4, 2.1);

      // Car-alarm registry: the game (three_fps_game.js) lets the player trigger a
      // 10 s alarm on any parked car (KeyE). It flashes these emissive materials in
      // sync with the two-tone — emissive-only, NO real lights (light-count invariant).
      window.__extCarAlarms = window.__extCarAlarms || [];
      window.__extCarAlarms.push({
        x: cx, z: cz, cooldownUntil: 0,
        mats: [
          { mat: lightMat,  base: lightMat.emissiveIntensity,  scale: 1 },
          { mat: bLightMat, base: bLightMat.emissiveIntensity, scale: 1 },
          { mat: glassMat,  base: glassMat.emissiveIntensity,  scale: 0.35 },
        ],
      });
    }

    function placeParkedCars() {
      const CAR_SPOTS = [
        { cx:-28, cz:138, ry:0,         color:0xc0392b },
        { cx:-28, cz:154, ry:0,         color:0x2980b9 },
        { cx: 28, cz:142, ry:Math.PI,   color:0x27ae60 },
        { cx: 28, cz:160, ry:Math.PI,   color:0x8e44ad },
        { cx:-28, cz:170, ry:0,         color:0xe67e22 },
        { cx: 28, cz:178, ry:Math.PI,   color:0x1abc9c },
        { cx:-28, cz:196, ry:0,         color:0xe74c3c },
      ];
      for (const { cx, cz, ry, color } of CAR_SPOTS) buildCar(cx, cz, ry, color);
    }

    // ── Procedural trees ─────────────────────────────────────────────────
    function buildTrees(positions) {
      const rng = seededRandom('ext-trees-v3');
      for (const { cx, cz, h, cr } of positions) {
        const trunkH = h * 0.32;
        queueCyl(cr*0.08, cr*0.12, trunkH, cx, trunkH*0.5, cz, M.wood, 6);
        const layers = 5;
        for (let li = 0; li < layers; li++) {
          const t = li / (layers-1);
          const layerR = cr * (0.9 - t*0.55);
          const layerH = (h - trunkH) * 0.38;
          const layerY = trunkH + (h - trunkH) * (t * 0.72);
          const foliageMat = std({ color: new THREE.Color().setHSL(0.30 + rng()*0.06, 0.55+rng()*0.15, 0.16+rng()*0.06), roughness:0.95, metalness:0 });
          queueCyl(layerR*0.12, layerR, layerH, cx + (rng()-0.5)*0.3, layerY + layerH*0.5, cz + (rng()-0.5)*0.3, foliageMat, 7);
        }
        addCollider(cx, cz, cr*0.3, cr*0.3);
      }
    }

    const TREE_SPOTS = [
      { cx:-50, cz:132, h:5.5, cr:1.8 }, { cx: 50, cz:132, h:6.0, cr:2.0 },
      { cx:-50, cz:148, h:5.0, cr:1.6 }, { cx: 50, cz:148, h:5.8, cr:1.9 },
      { cx:-50, cz:164, h:6.2, cr:2.1 }, { cx: 50, cz:164, h:5.4, cr:1.7 },
      { cx:-50, cz:180, h:5.6, cr:1.8 }, { cx: 50, cz:180, h:6.0, cr:2.0 },
      { cx:-50, cz:196, h:5.2, cr:1.7 }, { cx: 50, cz:196, h:5.9, cr:1.9 },
      { cx:-50, cz:212, h:5.5, cr:1.8 }, { cx: 50, cz:212, h:6.1, cr:2.0 },
      { cx:-14, cz:228, h:4.8, cr:1.5 }, { cx:  0, cz:228, h:5.2, cr:1.7 },
      { cx: 14, cz:228, h:4.9, cr:1.6 },
    ];

    // ── Street clutter ────────────────────────────────────────────────────
    function buildStreetClutter() {
      const rng = seededRandom("clutter-v1");

      // Street debris / decal patches
      const debrisMat = std({
        color: 0x151515, roughness: 0.95, metalness: 0,
        transparent: true, opacity: 0.35,
        map: T.debris,
        depthWrite: false, polygonOffset: true,
        polygonOffsetFactor: -2, polygonOffsetUnits: -2,
      });
      const debrisSpots = [
        [-40,138],[-38,152],[38,145],[40,160],[-40,175],[38,185],
        [-38,200],[40,195],[-40,215],[38,218],
      ];
      for (const [dx, dz] of debrisSpots) {
        const dw = 1.5 + rng()*1.5, dd = 1.0 + rng()*1.2;
        const dGeo = new THREE.PlaneGeometry(dw, dd);
        const dMesh = new THREE.Mesh(dGeo, debrisMat.clone());
        dMesh.rotation.x = -Math.PI/2;
        dMesh.rotation.z = rng() * Math.PI;
        dMesh.position.set(dx + (rng()-0.5)*2, 0.08, dz + (rng()-0.5)*2);
        scene.add(dMesh);
      }

      // Power lines between building tops and lamppost tops
      // Using thin cylinders along a CatmullRom curve approximated by segments
      function makePowerLine(x1, y1, z1, x2, y2, z2, sag) {
        try {
          const pts = [];
          const segs = 8;
          for (let i = 0; i <= segs; i++) {
            const t = i / segs;
            const lx = x1 + (x2-x1)*t;
            const ly = y1 + (y2-y1)*t - Math.sin(t*Math.PI)*sag;
            const lz = z1 + (z2-z1)*t;
            pts.push(new THREE.Vector3(lx, ly, lz));
          }
          const curve = new THREE.CatmullRomCurve3(pts);
          const tubeGeo = new THREE.TubeGeometry(curve, 12, 0.025, 4, false);
          copyUvToUv2(tubeGeo);
          const tubeMesh = new THREE.Mesh(tubeGeo, M.metalDark);
          tubeMesh.receiveShadow = true;
          scene.add(tubeMesh);
        } catch(e) { /* degrade gracefully */ }
      }

      // Lines from buildings to lamppost tops
      makePowerLine(-43, 13.5, 149, -13.5, 7.0, 145, 0.8);
      makePowerLine(-43, 13.5, 149, -13.5, 7.0, 160, 1.2);
      makePowerLine( 43, 13.5, 149,  21.5, 7.0, 145, 0.8);
      makePowerLine( 43, 13.5, 149,  21.5, 7.0, 160, 1.2);
      makePowerLine(-45, 20.0, 192, -13.5, 7.0, 192, 1.5);
      makePowerLine( 45, 14.0, 192,  21.5, 7.0, 192, 1.3);

      // Broken glass patches near buildings
      const glassPatchMat = std({
        color: 0x8ab4c8, roughness: 0.1, metalness: 0.5,
        transparent: true, opacity: 0.18, depthWrite: false,
      });
      const glassSpots = [
        [-44,152],[-44,160],[ 43,152],[ 43,168],[-36,215],[ 36,215],
      ];
      for (const [gx, gz] of glassSpots) {
        for (let s = 0; s < 4; s++) {
          const gsz = 0.15 + rng()*0.35;
          const gGeo = new THREE.PlaneGeometry(gsz, gsz*0.6);
          const gMesh = new THREE.Mesh(gGeo, glassPatchMat.clone());
          gMesh.rotation.x = -Math.PI/2;
          gMesh.rotation.z = rng()*Math.PI;
          gMesh.position.set(gx+(rng()-0.5)*2, 0.07, gz+(rng()-0.5)*1.5);
          scene.add(gMesh);
        }
      }
    }

    // ── Atmosphere ───────────────────────────────────────────────────────
    function buildAtmosphere() {
      // Dust / ember particle system
      try {
        const PARTICLE_COUNT = 400;
        const positions = new Float32Array(PARTICLE_COUNT * 3);
        const velocities = new Float32Array(PARTICLE_COUNT * 3);
        const rng = seededRandom("particles-v1");
        const extDepth = EXT_Z_FAR - EXT_Z_NEAR;
        for (let i = 0; i < PARTICLE_COUNT; i++) {
          positions[i*3]   = (rng()-0.5) * 140;
          positions[i*3+1] = rng() * 18;
          positions[i*3+2] = EXT_Z_NEAR + rng() * extDepth;
          velocities[i*3]   = (rng()-0.5) * 0.015;
          velocities[i*3+1] = 0.005 + rng() * 0.010;
          velocities[i*3+2] = (rng()-0.5) * 0.010;
        }
        const partGeo = new THREE.BufferGeometry();
        partGeo.setAttribute("position", new THREE.BufferAttribute(positions, 3));
        const partMat = new THREE.PointsMaterial({
          size: 0.08,
          transparent: true,
          opacity: 0.18,
          depthWrite: false,
          sizeAttenuation: true,
          color: new THREE.Color(0xffcc88),
        });
        const particles = new THREE.Points(partGeo, partMat);
        particles.frustumCulled = false;
        particles.name = "ExtParticles";
        let _partTime = 0;
        particles.onBeforeRender = () => {
          _partTime += 0.016;
          const pos = partGeo.attributes.position.array;
          for (let i = 0; i < PARTICLE_COUNT; i++) {
            pos[i*3]   += velocities[i*3]   + Math.sin(_partTime*0.3 + i)*0.002;
            pos[i*3+1] += velocities[i*3+1];
            pos[i*3+2] += velocities[i*3+2];
            // Wrap when out of bounds
            if (pos[i*3+1] > 20) { pos[i*3+1] = 0; pos[i*3] = (rng()-0.5)*140; pos[i*3+2] = EXT_Z_NEAR + rng()*extDepth; }
            if (pos[i*3]   < EXT_X_MIN) pos[i*3] = EXT_X_MAX;
            if (pos[i*3]   > EXT_X_MAX) pos[i*3] = EXT_X_MIN;
            if (pos[i*3+2] > EXT_Z_FAR)  pos[i*3+2] = EXT_Z_NEAR;
            if (pos[i*3+2] < EXT_Z_NEAR) pos[i*3+2] = EXT_Z_FAR;
          }
          partGeo.attributes.position.needsUpdate = true;
        };
        scene.add(particles);
      } catch(e) { /* degrade gracefully */ }

      // Ground haze layer (normal blending — no additive to avoid WebGPU black-circle artifact)
      try {
        const fogTex = makeGroundFogTex(256);
        const fogGeo = new THREE.PlaneGeometry(200, 200);
        const fogMat = new THREE.MeshBasicMaterial({
          map: fogTex,
          transparent: true,
          opacity: 0.04,
          depthWrite: false,
        });
        const fogPlane = new THREE.Mesh(fogGeo, fogMat);
        fogPlane.rotation.x = -Math.PI / 2;
        fogPlane.frustumCulled = false;
        fogPlane.renderOrder = 1;
        fogPlane.onBeforeRender = (_r, _s, cam) => {
          fogPlane.position.set(cam.position.x, 0.15, cam.position.z);
        };
        scene.add(fogPlane);
      } catch(e) { /* degrade gracefully */ }
    }

    // ── GLTF loaders ─────────────────────────────────────────────────────
    async function loadAndPlaceCars() {
      try {
        const { GLTFLoader } = await import("https://unpkg.com/three@0.166.1/examples/jsm/loaders/GLTFLoader.js");
        const loader = new GLTFLoader();
        const gltf = await new Promise((res, rej) => loader.load(
          "https://raw.githubusercontent.com/mrdoob/three.js/r166/examples/models/gltf/ferrari.glb",
          res, undefined, rej
        ));
        const templateScene = gltf.scene;
        const box = new THREE.Box3().setFromObject(templateScene);
        const sz = new THREE.Vector3(); box.getSize(sz);
        const scaleFactor = 3.8 / Math.max(sz.x, sz.z);
        const yOff = -box.min.y * scaleFactor;
        const CAR_SPOTS = [
          { cx:-28, cz:138, ry:0,         color:0xc0392b },
          { cx:-28, cz:154, ry:0,         color:0x2980b9 },
          { cx: 28, cz:142, ry:Math.PI,   color:0x27ae60 },
          { cx: 28, cz:160, ry:Math.PI,   color:0x8e44ad },
          { cx:-28, cz:170, ry:0,         color:0xe67e22 },
          { cx: 28, cz:178, ry:Math.PI,   color:0x1abc9c },
          { cx:-28, cz:196, ry:0,         color:0xe74c3c },
        ];
        for (const { cx, cz, ry, color } of CAR_SPOTS) {
          const clone = templateScene.clone(true);
          clone.scale.setScalar(scaleFactor);
          clone.position.set(cx, yOff, cz);
          clone.rotation.y = ry;
          clone.traverse(c => {
            if (!c.isMesh) return;
            c.receiveShadow = true;
            if (c.material?.isMeshBasicMaterial) c.material = new THREE.MeshStandardMaterial({ color: c.material.color });
            if (c.material && c.material.name && c.material.name.toLowerCase().includes("body")) {
              c.material = c.material.clone(); c.material.color.setHex(color);
            }
          });
          scene.add(clone); addCollider(cx, cz, 4.2, 2.2); extWallMeshes.push(clone);
        }
      } catch (_) {
        placeParkedCars();
      }
    }

    async function loadAndPlaceTrees() {
      try {
        const { GLTFLoader } = await import("https://unpkg.com/three@0.166.1/examples/jsm/loaders/GLTFLoader.js");
        const loader = new GLTFLoader();
        const gltf = await new Promise((res, rej) => loader.load("assets/models/tree.glb", res, undefined, rej));
        const template = gltf.scene;
        const box = new THREE.Box3().setFromObject(template);
        const sz = new THREE.Vector3(); box.getSize(sz);
        if (sz.y < 0.1) { buildTrees(TREE_SPOTS); return; }
        const rng2 = seededRandom('trees-gltf-v2');
        for (const { cx, cz, h, cr } of TREE_SPOTS) {
          const clone = template.clone(true);
          const sf = h / sz.y;
          clone.scale.setScalar(sf);
          clone.position.set(cx, -box.min.y * sf, cz);
          clone.rotation.y = rng2() * Math.PI * 2;
          clone.traverse(c => {
            if (!c.isMesh) return;
            c.receiveShadow = true;
            if (c.material?.isMeshBasicMaterial) c.material = new THREE.MeshStandardMaterial({ color: c.material.color });
          });
          scene.add(clone); addCollider(cx, cz, Math.max(2, cr), Math.max(2, cr));
        }
      } catch (_) {
        buildTrees(TREE_SPOTS);
      }
    }

    // ── Boundaries ───────────────────────────────────────────────────────
    function buildBoundaries() {
      // Boundary colliders sit at the PLAYABLE box, not the visual city extents —
      // the district beyond is scenery the player can see but never reach.
      const zc = (EXT_Z_NEAR + PLAY_Z_FAR) / 2;
      const zlen = PLAY_Z_FAR - EXT_Z_NEAR;
      const xlen = PLAY_X_MAX - PLAY_X_MIN + 2;
      addCollider(PLAY_X_MIN - 0.5, zc, 1, zlen);
      addCollider(PLAY_X_MAX + 0.5, zc, 1, zlen);
      addCollider(0, PLAY_Z_FAR + 0.5, xlen, 1);
    }

    // Polish: the play boundary reads as DESIGNED, not as an invisible wall — a
    // jersey-barrier line closes the avenue where the vista district begins.
    // Purely visual (the collider above already blocks); merges into buckets.
    function buildBoundaryDressing() {
      const bz = PLAY_Z_FAR - 0.9;
      for (let x = -21; x <= 21; x += 3.0) {
        queueBox(2.55, 0.92, 0.55, x, 0.46, bz, M.concrete);      // barrier body
        queueBox(2.35, 0.10, 0.62, x, 0.96, bz, M.metalDark);      // top rail
      }
      // End posts + hazard stripe board on each sidewalk side.
      for (const sx of [-24.5, 24.5]) {
        queueBox(0.35, 1.5, 0.35, sx, 0.75, bz, M.metalDark);
        queueBox(3.4, 0.5, 0.12, sx, 1.25, bz, M.yellow);
      }
    }

    // ── Assemble ─────────────────────────────────────────────────────────
    buildBoundaries();
    await setupExtSky();
    setupExtLighting();
    buildGround();
    buildAllBuildings();
    buildProceduralCity();
    buildBoundaryDressing();
    buildFountain();
    buildBenches();
    buildLampposts();
    buildNeons();
    buildBillboard();
    buildHydrantsAndProps();
    buildStreetClutter();
    buildAtmosphere();
    flushBuckets();
    // On mobile, use the lightweight procedural cars/trees instead of the
    // external high-poly Ferrari GLB (×7 clones) and the 5.8 MB tree GLB — a big
    // download + draw-call saving on phones with no meaningful visual loss.
    if (window.__mobileMode) {
      placeParkedCars();
      buildTrees(TREE_SPOTS);
    } else {
      await Promise.all([loadAndPlaceCars(), loadAndPlaceTrees()]);
    }
    console.info("[Exterior] Built — tier=%s, %d colliders, %d wall meshes",
      profile.tier, colliders.length, extWallMeshes.length);
  };

})();