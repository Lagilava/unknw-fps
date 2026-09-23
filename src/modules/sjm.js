// modules/sjm.js — Skeleton Jump Monitor
// Diagnostic overlay for the Cloned Ghost enemy (zombie) animation and locomotion state.
// Toggle with F8 during gameplay.
// Config values here are read by the game at enemy creation / each update frame.
(function () {
  'use strict';

  // ── Config ────────────────────────────────────────────────────────────────────
  // Tunable constants consumed by the game. Change these and reload to iterate
  // without touching the core game file.
  const CONFIG = {
    ghostSpeed:       7.5,   // world-units / second (replaces the hard-coded 4.15 / 5.2)
    sprintThreshold:  0.42,  // speedT ratio above which the sprint animation plays
    animScaleFloor:   0.85,  // minimum animation timeScale (walk, slow movement)
    animScaleSprint:  2.20,  // maximum animation timeScale (full-speed sprint)
  };

  // ── Overlay ───────────────────────────────────────────────────────────────────
  let el     = null;
  let active = false;

  function bar(v, w) {
    w = w || 10;
    const filled = Math.round(Math.min(1, Math.max(0, v)) * w);
    return '█'.repeat(filled) + '░'.repeat(w - filled);
  }

  function createEl() {
    el = document.createElement('div');
    el.id = 'sjm-overlay';
    Object.assign(el.style, {
      position:       'fixed',
      top:            '50%',
      right:          '16px',
      transform:      'translateY(-50%)',
      width:          '232px',
      background:     'rgba(0,4,12,0.90)',
      border:         '1px solid rgba(0,255,188,0.38)',
      borderRadius:   '10px',
      padding:        '12px 14px',
      fontFamily:     'ui-monospace, SFMono-Regular, Menlo, Consolas, monospace',
      fontSize:       '11px',
      lineHeight:     '1.62',
      color:          '#9df5d8',
      zIndex:         '80',
      pointerEvents:  'none',
      backdropFilter: 'blur(8px)',
      boxShadow:      '0 8px 32px rgba(0,0,0,0.55)',
      display:        'none',
      whiteSpace:     'pre',
    });
    document.body.appendChild(el);
  }

  function renderOverlay() {
    if (!el || !active) return;
    const s = window.__sjmState;
    if (!s) {
      el.innerHTML = '<b>SJM</b>\nNo state yet — game not started.';
      return;
    }
    if (!s.nearest) {
      el.innerHTML = '<b>SJM — Ghost Diag</b>\nNo ghost in scene.';
      return;
    }
    const d  = s.nearest.diagState   || {};
    const av = s.nearest.actionsAvail || [];

    const sprint = d.sprinting ? '<span style="color:#ff5a5a">YES</span>' : 'no';
    const anim   = '<span style="color:#ffe07a">' + (d.action || '?') + '</span>';
    const ts     = typeof d.timeScale === 'number' ? d.timeScale.toFixed(2) : '?';

    el.innerHTML = [
      '<b>SJM — Ghost Locomotion</b>',
      '─────────────────────────',
      'dist   : ' + ((d.dist  || 0).toFixed(1)) + ' u',
      'speed  : ' + ((d.speed || 0).toFixed(2)) + '  [' + bar(d.speedT) + ']',
      'speedT : ' + ((d.speedT || 0).toFixed(3)),
      'action : ' + anim,
      'tScale : ' + ts,
      'sprint : ' + sprint + '   strafe: ' + (d.strafing ? 'yes' : 'no'),
      'jump   : ' + (d.jumping ? 'yes' : 'no') + '   moving: ' + (d.moving ? 'yes' : 'no'),
      '─────────────────────────',
      'clips  : ' + (av.join(' ') || '(none loaded)'),
    ].join('\n');
  }

  function tick() {
    renderOverlay();
    if (active) requestAnimationFrame(tick);
  }

  function enable() {
    if (active) return;
    active = true;
    if (!el) createEl();
    el.style.display = 'block';
    tick();
    console.info('[SJM] Overlay enabled. Press F8 to hide.');
  }

  function disable() {
    active = false;
    if (el) el.style.display = 'none';
    console.info('[SJM] Overlay disabled.');
  }

  // ── Key binding ───────────────────────────────────────────────────────────────
  window.addEventListener('keydown', function (e) {
    if (e.code === 'F8') {
      e.preventDefault();
      active ? disable() : enable();
    }
  });

  // ── Public API ────────────────────────────────────────────────────────────────
  window.SJM = {
    config:  CONFIG,
    enable:  enable,
    disable: disable,
    diagnose: function () {
      const s = window.__sjmState;
      if (!s || !s.nearest) { console.log('[SJM] No ghost data available.'); return; }
      console.table(s.nearest.diagState);
      console.log('[SJM] Available clips:', s.nearest.actionsAvail);
    },
  };

  // ── State bucket (filled each frame by the game) ──────────────────────────────
  window.__sjmState = { nearest: null };

  console.info('[SJM] Loaded — F8 toggles overlay, SJM.diagnose() for console dump.');
})();
