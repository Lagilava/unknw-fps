/** World-space hit origins stay anchored while the player turns. */
export function damageBearing(sx: number, sz: number, x: number, z: number, yaw: number) {
  const dx = sx - x, dz = sz - z;
  if (![dx, dz, yaw].every(Number.isFinite) || Math.hypot(dx, dz) < .05) return null;
  return Math.atan2(dx * Math.cos(yaw) - dz * Math.sin(yaw), -dx * Math.sin(yaw) - dz * Math.cos(yaw));
}

export function createDamageIndicators(doc: Document) {
  const root = doc.createElement('div');
  root.id = 'damage-directions'; root.setAttribute('aria-hidden', 'true');
  root.style.cssText = 'position:fixed;inset:0;pointer-events:none;z-index:35;overflow:hidden';
  const slots = Array.from({ length: 8 }, () => {
    const el = doc.createElement('div');
    el.style.cssText = 'position:absolute;left:50%;top:50%;width:min(48vmin,340px);height:min(48vmin,340px);opacity:0;filter:drop-shadow(0 1px 3px #200);';
    el.innerHTML = '<svg viewBox="0 0 300 300" width="100%" height="100%"><path d="M 110 28 A 128 128 0 0 1 190 28" fill="none" stroke="#ff5044" stroke-width="7" stroke-linecap="round"/><path d="M 140 44 L 150 33 L 160 44" fill="none" stroke="#fff1cf" stroke-width="3"/></svg>';
    root.append(el);
    return { el, sx: 0, sz: 0, life: 0, strength: 1 };
  });
  doc.body.append(root);
  return {
    hit(sx: number, sz: number, amount: number) {
      if (![sx, sz, amount].every(Number.isFinite) || amount <= 0) return;
      const slot = slots.find(s => s.life > 0 && Math.hypot(s.sx - sx, s.sz - sz) < 1.5)
        ?? slots.reduce((a, b) => a.life < b.life ? a : b);
      Object.assign(slot, { sx, sz, life: 1.25, strength: Math.min(1, .65 + amount / 60) });
    },
    update(dt: number, x: number, z: number, yaw: number, visible = true) {
      for (const s of slots) {
        s.life = Math.max(0, s.life - Math.max(0, dt));
        const angle = damageBearing(s.sx, s.sz, x, z, yaw);
        s.el.style.opacity = visible && angle !== null ? String(Math.min(1, s.life / .5) * s.strength) : '0';
        if (s.life && angle !== null) s.el.style.transform = `translate(-50%,-50%) rotate(${angle}rad)`;
      }
    },
    clear() { for (const s of slots) { s.life = 0; s.el.style.opacity = '0'; } },
    dispose() { root.remove(); },
  };
}
