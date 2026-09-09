import { setTextIfChanged } from './dom_ui';

export interface GameHudState {
  hp: number; maxHp: number; unlimitedHealth: boolean;
  killed: number; total: number; grenadeCooldown: number;
  relayProgress?: number; contested?: boolean; blackout?: boolean; pvp: boolean;
}

export function createGameHud(doc = document) {
  const root = doc.getElementById('hud');
  if (!root) return (_state: GameHudState) => {};
  root.classList.add('combat-hud');
  const make = (id: string, text = '') => { const el = doc.createElement('div'); el.id = id; el.textContent = text; return el; };
  const mission = doc.getElementById('center-hud');
  const header = make('mission-header');
  for (const id of ['wave-badge', 'score-badge']) { const el = doc.getElementById(id); if (el) header.append(el); }
  mission?.prepend(header);
  const eyebrow = make('mission-caption', 'SITE STATUS');
  doc.getElementById('objective')?.before(eyebrow);
  const progress = make('encounter-progress');
  const fill = make('encounter-progress-fill'); progress.append(fill);
  progress.setAttribute('role', 'progressbar'); progress.setAttribute('aria-label', 'Encounter progress');
  progress.setAttribute('aria-valuemin', '0'); progress.setAttribute('aria-valuemax', '100');
  const summary = make('encounter-summary');
  const remaining = make('enemies-remaining');
  const cleared = make('enemies-cleared');
  const kills = doc.getElementById('kills-val');
  if (kills) cleared.append(kills, ' cleared');
  summary.append(remaining, cleared); mission?.append(progress, summary);
  for (const id of ['pack-prompt', 'kill-feed', 'streak-block']) { const el = doc.getElementById(id); if (el) root.append(el); }
  const health = doc.getElementById('hp-val')?.closest<HTMLElement>('.hud-block');
  health?.classList.add('health-readout');
  const healthLabel = health?.querySelector('.hud-label'); if (healthLabel) healthLabel.textContent = 'HEALTH';
  const condition = make('health-condition'); doc.getElementById('hp-val')?.after(condition);
  const equipment = make('equipment-readout'); health?.append(equipment);
  const wallet = make('wallet-readout', 'SIMULATION SCORE  ');
  const xp = doc.getElementById('xp-val'); if (xp) wallet.append(xp);
  health?.append(wallet);
  // Move useful counters to their context, then remove the floating third panel.
  const pack = doc.getElementById('pack-val'); if (pack) { pack.hidden = true; health?.append(pack); }
  doc.querySelector('#bottom-hud .hud-block.center')?.remove();
  const tracker = make('tracker-caption', 'RADAR'); root.append(tracker);
  const style = doc.createElement('style');
  style.textContent = `
    #hud.combat-hud { --ui-ink:#f2eee6; --ui-dim:#a9a59d; --ui-line:#aaa39742; --site-orange:#ed9b34; --site-yellow:#f1c95b; font-family:'Segoe UI',sans-serif; }
    #hud.combat-hud::before { display:none; }
    #hud.combat-hud #center-hud { left:max(28px,env(safe-area-inset-left)); top:max(24px,env(safe-area-inset-top)); transform:none; width:320px; min-width:0; align-items:stretch; gap:0; padding:0 0 10px 14px; background:linear-gradient(90deg,rgba(5,10,15,.65),transparent); border:0; border-left:2px solid var(--site-orange); text-shadow:0 2px 4px #000; filter:none; box-sizing:border-box; }
    #hud.combat-hud #center-hud::after { display:none; }
    #mission-header { display:flex; justify-content:space-between; align-items:center; gap:12px; margin-bottom:12px; padding-bottom:0; border:0; }
    #hud.combat-hud #wave-badge,#hud.combat-hud #score-badge { clip-path:none; border:0; padding:0; background:none; box-shadow:none; backdrop-filter:none; letter-spacing:.06em; font:600 11px/1.4 'Segoe UI',sans-serif; }
    #hud.combat-hud #wave-badge { font-size:0; color:#f0a33a; }
    #hud.combat-hud #wave-badge::before { content:'WAVE '; font:600 11px/1.4 'Segoe UI',sans-serif; letter-spacing:.06em; }
    #hud.combat-hud #score-badge { font-size:0; color:#c9c2b5; }
    #hud.combat-hud #score-badge::before { content:'SCORE '; font:600 11px/1.4 'Segoe UI',sans-serif; letter-spacing:.06em; }
    #hud.combat-hud #wave-val,#hud.combat-hud #score-val { font:800 28px/1 'Segoe UI',sans-serif; color:#fff; font-variant-numeric:tabular-nums; }
    #hud.combat-hud .score-best { display:none; }
    #mission-caption { display:none; color:var(--site-orange); font:700 9px/1.4 'Segoe UI',sans-serif; letter-spacing:.18em; margin-bottom:5px; }
    #hud.combat-hud #objective { font:600 13px/1.45 'Segoe UI',sans-serif; letter-spacing:.035em; min-width:0; text-align:left; padding:0; border:0; background:none; box-shadow:none; clip-path:none; backdrop-filter:none; color:var(--ui-ink); overflow-wrap:anywhere; }
    #hud.combat-hud #objective::before,#hud.combat-hud #objective::after { display:none; }
    #hud.combat-hud .xhair-seg { background:#f8f5e9; box-shadow:0 0 0 1px rgba(8,10,10,.98), 0 0 5px rgba(255,255,255,.72); }
    #hud.combat-hud #xhair-dot { background:#f8f5e9; border-color:#f8f5e9; box-shadow:0 0 0 1px rgba(8,10,10,.98), 0 0 5px rgba(240,163,58,.8); }
    #encounter-progress { height:4px; background:#ffffff25; margin-top:10px; transform:skewX(-18deg); }
    #encounter-progress-fill { height:100%; width:0; background:var(--site-orange); box-shadow:0 0 8px #ed9b3440; }
    #encounter-summary { display:flex; justify-content:space-between; gap:12px; margin-top:8px; color:var(--ui-dim); font:11px/1.4 Segoe UI,sans-serif; font-variant-numeric:tabular-nums; }
    #enemies-remaining { color:#fff; font-weight:600; }
    #hud.combat-hud #kills-val { display:inline; font:inherit; color:inherit; text-shadow:none; }
    #hud.combat-hud[data-relay="true"] { --site-orange:#79d8d3; }
    #hud.combat-hud[data-blackout="true"] { --site-orange:#b6becf; }
    #hud.combat-hud[data-contested="true"] #encounter-progress-fill { background:#ffb767; }
    #hud.combat-hud[data-relay="true"] #enemies-cleared { display:none; }
    #hud.combat-hud #minimap-canvas { top:42px; right:max(28px,env(safe-area-inset-right)); width:140px; height:140px; transform:none; box-shadow:0 0 0 1px var(--ui-line); }
    #tracker-caption { position:absolute; right:28px; top:23px; width:140px; text-align:center; color:#ddd6c9; letter-spacing:.15em; font:700 9px/1.4 'Segoe UI',sans-serif; text-shadow:0 1px 3px #000; border-bottom:1px solid #aaa39755; padding-bottom:5px; }
    #hud.combat-hud #bottom-hud { padding:0 max(28px,env(safe-area-inset-right)) max(24px,env(safe-area-inset-bottom)) max(28px,env(safe-area-inset-left)); gap:16px; background:none!important; transform:none; align-items:flex-end; }
    #hud.combat-hud .hud-block { border:0!important; background:linear-gradient(90deg,rgba(4,9,14,.72),rgba(4,9,14,.12))!important; clip-path:polygon(0 0,calc(100% - 14px) 0,100% 14px,100% 100%,0 100%); box-shadow:none; text-shadow:0 2px 4px #000; backdrop-filter:none; min-width:0; box-sizing:border-box; }
    #hud.combat-hud .hud-block::before,#hud.combat-hud .hud-block::after { display:none; }
    #hud.combat-hud .health-readout { width:260px; padding:12px 14px; gap:5px; display:grid; grid-template-columns:auto 1fr auto; align-items:center; }
    #hud.combat-hud .hud-label { color:var(--ui-dim); letter-spacing:.1em; font:600 10px/1.4 'Segoe UI',sans-serif; }
    #hud.combat-hud #hp-val { grid-column:3; grid-row:1 / 3; font:800 48px/.95 'Segoe UI',sans-serif; color:#fff; text-shadow:none; }
    #health-condition { grid-column:1 / 3; grid-row:2; font:10px/1.4 'Segoe UI',sans-serif; color:#b0dac3; }
    #hud.combat-hud #hp-bar-wrap { grid-column:1 / -1; width:100%; height:9px; margin:8px 0 3px; border:0; transform:skewX(-18deg); }
    #hud.combat-hud #hp-bar { background:#d5eee2; box-shadow:0 0 10px #b8d6b330; }
    #hud.combat-hud[data-health="critical"] #hp-val,#hud.combat-hud[data-health="critical"] #health-condition { color:#ff9689; }
    #hud.combat-hud[data-health="critical"] #hp-bar { background:#ff9689; }
    #hud.combat-hud #sprint-status { display:none; }
    #hud.combat-hud #stamina-bar-wrap { grid-column:1 / -1; width:100%; height:3px; margin:0; transform:skewX(-18deg); }
    #equipment-readout { grid-column:1 / -1; padding-top:4px; font:700 10px/1.5 'Segoe UI',sans-serif; color:var(--site-yellow); letter-spacing:.08em; }
    #wallet-readout { display:none; }
    #xp-val { float:right; color:#fff; font-weight:600; font-variant-numeric:tabular-nums; }
    #hud.combat-hud #perk-row { grid-column:1 / -1; flex-wrap:wrap; }
    #hud.combat-hud #bottom-hud .weapon-readout { width:260px; min-width:0; background:linear-gradient(270deg,rgba(4,9,14,.72),rgba(4,9,14,.12))!important; }
    #hud.combat-hud #kill-feed { position:absolute; top:204px; right:28px; left:auto; width:250px; text-align:right; align-items:flex-end; margin:0; font-size:12px; }
    #hud.combat-hud #streak-block { position:absolute; top:26%; left:50%; transform:translateX(-50%); margin:0; font-size:13px; }
    #hud.combat-hud #pack-prompt { position:absolute; top:64%; left:50%; max-width:min(440px,85vw); transform:translate(-50%,0); margin:0; font-size:13px; }
    #hud.combat-hud #pack-prompt-key,#hud.combat-hud #pack-prompt.pop,#hud.combat-hud #streak-block.active { animation:none; }
    #hud.combat-hud .kill-entry { white-space:normal; overflow-wrap:anywhere; max-width:100%; }
    #hud.combat-hud[data-pvp="true"] #objective,#hud.combat-hud[data-pvp="true"] #wave-badge,#hud.combat-hud[data-pvp="true"] #encounter-summary { display:none; }
    @media(max-width:600px) {
      #hud.combat-hud #center-hud { left:12px; top:12px; width:calc(100% - 132px); padding:10px; }
      #mission-header { flex-wrap:wrap; gap:6px; margin-bottom:8px; }
      #hud.combat-hud #objective { font-size:12px; }
      #encounter-summary { font-size:10px; flex-wrap:wrap; }
      #hud.combat-hud #minimap-canvas { right:12px; top:32px; width:98px; height:98px; }
      #tracker-caption { right:12px; top:14px; width:98px; font-size:8px; }
      #hud.combat-hud #bottom-hud { padding:0 12px max(12px,env(safe-area-inset-bottom)); gap:8px; }
      #hud.combat-hud .health-readout { width:44%; flex:0 1 44%; padding:8px; }
      #hud.combat-hud #bottom-hud .weapon-readout { width:56%; flex:0 1 56%; padding:8px; }
      #hud.combat-hud #hp-val { font-size:36px; }
      #health-condition { font-size:10px; }
      #hud.combat-hud #kill-feed { top:178px; right:12px; width:180px; }
      #hud.combat-hud #sprint-status { display:none; }
      #hud.combat-hud #pack-prompt { top:55%; }
    }
    body.touch-device #hud.combat-hud #bottom-hud { bottom:170px; }
    @media(max-height:500px) {
      #hud.combat-hud #center-hud { top:8px; padding:8px 12px; }
      #mission-header { margin-bottom:4px; }
      #hud.combat-hud #minimap-canvas { width:90px; height:90px; top:28px; }
      #tracker-caption { top:10px; width:90px; }
      #hud.combat-hud #kill-feed { top:140px; }
      #hud.combat-hud #sprint-status { display:none; }
      body.touch-device #hud.combat-hud #bottom-hud { bottom:0; left:100px; right:100px; }
    }
  `;
  doc.head.append(style);
  return (state: GameHudState) => {
    const pvp = String(state.pvp); if (root.dataset.pvp !== pvp) root.dataset.pvp = pvp;
    const ratio = state.hp / Math.max(1, state.maxHp);
    const conditionName = state.unlimitedHealth ? 'protected' : state.hp <= 0 ? 'down' : ratio <= .3 ? 'critical' : ratio <= .6 ? 'wounded' : 'stable';
    if (root.dataset.health !== conditionName) root.dataset.health = conditionName;
    setTextIfChanged(condition, { protected:'Invulnerable', down:'Downed', critical:'Find cover', wounded:'Wounded', stable:'Stable' }[conditionName]);
    const grenadeKey = doc.body.classList.contains('touch-device') ? '' : '[G] ';
    setTextIfChanged(equipment, state.grenadeCooldown > 0 ? `${grenadeKey}UTILITY CHARGE  ${Math.ceil(state.grenadeCooldown)}s` : `${grenadeKey}UTILITY CHARGE  READY`);
    const relay = state.relayProgress !== undefined;
    root.dataset.relay = String(relay);
    root.dataset.blackout = String(!!state.blackout);
    setTextIfChanged(eyebrow, state.pvp ? 'MULTIPLAYER' : relay ? state.contested ? 'RELAY CONTESTED' : 'SECURE THE RELAY' : state.blackout ? 'BLACKOUT / SIGNAL LOST' : 'SITE STATUS');
    setTextIfChanged(remaining, relay ? `${Math.floor(state.relayProgress!)} / 18s secured` : `${Math.max(0, state.total - state.killed)} HOSTILES`);
    const value = Math.round(Math.max(0, Math.min(1, relay ? state.relayProgress! / 18 : state.total > 0 ? state.killed / state.total : 0)) * 100);
    const width = `${value}%`; if (fill.style.width !== width) fill.style.width = width;
    if (progress.getAttribute('aria-valuenow') !== String(value)) progress.setAttribute('aria-valuenow', String(value));
    progress.hidden = state.pvp;
    const contested = String(!!state.contested); if (root.dataset.contested !== contested) root.dataset.contested = contested;
  };
}
