import { GUNS, GUN_SPECS, type GunType, type GunState } from './gun_config';
import { setTextIfChanged } from './dom_ui';
import { AIM_PROFILES } from './weapon_ads';

const ACCENTS: Record<GunType, string> = {
  pistol:'#9fdcff', rifle:'#62e4c5', shotgun:'#ffbc70', sniper:'#b8b4ff',
  smg:'#7ce9ff', lmg:'#e8cf88', dmr:'#a8c9ff', akimbo:'#f3a6dc', flak:'#ff977c',
};

/** Augments existing ammo IDs, preserving both entry pages and existing HUD consumers. */
export function createWeaponHud(doc = document) {
  const panel = doc.querySelector<HTMLElement>('#bottom-hud .hud-block.end');
  if (!panel) return () => {};
  const style = doc.createElement('style');
  style.textContent = `
    #bottom-hud .weapon-readout { --weapon-accent:#ed9b34; width:286px; min-width:0; gap:5px; padding:10px 12px; background:transparent; box-sizing:border-box; }
    .weapon-heading { display:flex; justify-content:space-between; width:100%; font:700 9px/1.4 'Segoe UI',sans-serif; letter-spacing:.15em; color:var(--weapon-accent); }
    #bottom-hud .weapon-readout #weapon-val { font:700 15px/1.3 'Segoe UI',sans-serif; letter-spacing:.04em; margin:0; max-width:100%; text-align:right; align-self:flex-end; }
    .weapon-labels { width:100%; display:none; justify-content:space-between; font:10px/1.3 'Segoe UI',sans-serif; letter-spacing:.06em; color:#adbdc5; margin-top:4px; }
    #bottom-hud .weapon-readout #ammo-val { width:100%; display:flex; align-items:baseline; justify-content:flex-end; gap:12px; font:800 58px/1 'Segoe UI',sans-serif; font-variant-numeric:tabular-nums; color:#f4f8fa; letter-spacing:0; text-shadow:none; }
    #bottom-hud .weapon-readout .ammo-reserve { font:400 23px/1.1 'Segoe UI',sans-serif; color:#b9c8ce; opacity:1; letter-spacing:0; }
    .weapon-readout .weapon-meter { display:flex; gap:2px; width:100%; height:5px; margin:3px 0; transform:skewX(-18deg); }
    .weapon-readout .weapon-meter i { flex:1; background:#a5c3ce26; }
    .weapon-readout .weapon-meter i.filled { background:var(--weapon-accent); }
    .weapon-readout .weapon-status { width:100%; min-height:15px; text-align:right; font:600 11px/1.4 'Segoe UI',sans-serif; color:#b9c8ce; letter-spacing:0; }
    #bottom-hud .weapon-readout[data-ammo-state="low"] #ammo-val,.weapon-readout[data-ammo-state="low"] .weapon-status { color:#ffc477; }
    #bottom-hud .weapon-readout[data-ammo-state="empty"] #ammo-val,.weapon-readout[data-ammo-state="empty"] .weapon-status { color:#ff8a86; }
    #bottom-hud .weapon-readout #reload-bar-wrap { width:100%; height:3px; margin:0; display:none; }
    #bottom-hud .weapon-readout[data-ammo-state="reloading"] #reload-bar-wrap { display:block; opacity:1; }
    .weapon-readout #reload-bar { background:var(--weapon-accent); }
    .weapon-readout[data-unlimited="true"] .ammo-reserve,.weapon-readout[data-unlimited="true"] .reserve-label,.weapon-readout[data-unlimited="true"] .weapon-meter { display:none!important; }
    .weapon-readout #weapon-slots { max-width:100%; margin-top:4px!important; gap:4px!important; }
    .weapon-readout #weapon-slots span { box-shadow:none!important; font:600 10px/1.2 'Segoe UI',sans-serif; }
    @media(max-width:600px) {
      #bottom-hud .weapon-readout #ammo-val { font-size:42px; }
      #bottom-hud .weapon-readout #weapon-val { font-size:13px; }
      .weapon-readout .weapon-heading,.weapon-readout .weapon-labels { font-size:9px; }
      .weapon-readout .weapon-status { font-size:10px; }
    }
  `;
  doc.head.appendChild(style);
  panel.classList.add('weapon-readout');
  panel.setAttribute('aria-label', 'Equipped weapon');
  const make = (className: string) => { const el = doc.createElement('div'); el.className = className; return el; };
  const heading = make('weapon-heading');
  const code = doc.createElement('span'), tier = doc.createElement('span');
  heading.append(code, tier); panel.prepend(heading);
  const oldLabel = panel.querySelector('.hud-label');
  if (oldLabel) oldLabel.remove();
  const labels = make('weapon-labels');
  const capacity = doc.createElement('span');
  const reserveLabel = doc.createElement('span'); reserveLabel.textContent = 'RESERVE'; reserveLabel.className = 'reserve-label';
  labels.append(capacity, reserveLabel);
  panel.querySelector('#ammo-val')?.before(labels);
  const meter = make('weapon-meter'); meter.setAttribute('aria-hidden', 'true');
  const cells = Array.from({ length: 24 }, () => doc.createElement('i')); meter.append(...cells);
  const status = make('weapon-status');
  panel.querySelector('#ammo-val')?.after(meter);
  meter.after(status);
  let previousGun: GunType | null = null;
  let previousMeter = "";
  return (type: GunType, gun: GunState, unlimited: boolean, level: number) => {
    const accent = ACCENTS[type] || ACCENTS[GUNS.RIFLE];
    if (previousGun !== type) {
      previousGun = type; panel.dataset.weapon = type;
      panel.style.setProperty('--weapon-accent', accent);
      setTextIfChanged(code, type === 'akimbo' ? 'MACHINE PISTOL' : type.toUpperCase());
    }
    setTextIfChanged(tier, level > 0 ? `MK ${level + 1}` : "");
    const displayName = type === 'pistol' ? 'SIDEARM' : GUN_SPECS[type].name;
    setTextIfChanged(panel.querySelector("#weapon-val"), displayName);
    if (panel.dataset.unlimited !== String(unlimited)) panel.dataset.unlimited = String(unlimited);
    setTextIfChanged(panel.querySelector("#ammo-mag"), unlimited ? "\u221e" : gun.mag);
    setTextIfChanged(panel.querySelector("#ammo-reserve"), gun.ammo);
    setTextIfChanged(capacity, unlimited ? "AMMUNITION" : `MAG / ${gun.magSize}`);
    const ratio = unlimited ? 1 : Math.max(0, Math.min(1, gun.mag / Math.max(1, gun.magSize)));
    const state = gun.reloadTimer > 0 ? 'reloading' : unlimited ? 'ready' : gun.mag <= 0 ? 'empty' : ratio <= .25 ? 'low' : 'ready';
    if (panel.dataset.ammoState !== state) panel.dataset.ammoState = state;
    const count = Math.min(24, Math.max(1, gun.magSize));
    const filled = Math.ceil(ratio * count);
    if (previousMeter !== `${count}/${filled}/${unlimited}`) {
      previousMeter = `${count}/${filled}/${unlimited}`;
      cells.forEach((cell, i) => { cell.hidden = i >= count; cell.classList.toggle('filled', i < filled); });
    }
    setTextIfChanged(status, state === 'reloading' ? `RELOADING · ${gun.reloadTimer.toFixed(1)}s` : unlimited ? 'UNLIMITED AMMO' : state === 'empty' ? gun.ammo > 0 ? 'EMPTY · RELOAD' : 'OUT OF AMMO · SWITCH WEAPON' : state === 'low' ? gun.ammo > 0 ? 'LOW MAGAZINE · RELOAD' : 'LAST ROUNDS · NO RESERVE' : gun.ammo <= 0 ? 'NO RESERVE · CONSERVE AMMO' : AIM_PROFILES[type].label);
  };
}
