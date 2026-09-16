const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const source = fs.readFileSync('three_fps_game.ts', 'utf8');

// Exercise the runtime controller with deterministic presentation intervals.
function controller(overrides = {}) {
  const context = vm.createContext({
    quality: { scale: .8, minScale: .54, maxScale: .8, smoothDt: 1 / 60,
      sampleTimer: 0, hitchCooldown: 0, lastFps: 60 },
    document: { hidden: false }, game: { state: 'playing' }, keys: new Set(),
    renderer: { shadowMap: { enabled: true } }, mobileMode: false, lowEndMode: false,
    _shadowPerformanceAsked: false, cutscene: { active: false }, promptCount: 0,
    pauseGame() {}, resumeGame() {},
    showShadowPerformancePrompt(decide) { this.promptCount++; this.decideShadows = decide; },
    _governorStrikes: 0, _autoFallbackStrikes: 0, _shadowsDroppedByGovernor: false,
    devVal: (_category, key, fallback) => overrides[key] ?? fallback,
    maybeAutoFallbackRenderer() {}, applyRenderScale() {}, flashPerfNotice() {},
    console: { warn() {} },
  });
  context.showShadowPerformancePrompt = decide => { context.promptCount++; context.decideShadows = decide; };
  const adaptive = source.slice(source.indexOf('  function updateAdaptiveQuality('), source.indexOf('  // Self-healing renderer fallback:'));
  const governor = source.slice(source.indexOf('  function maybePerfGovernor('), source.indexOf('  // Brief, non-blocking on-screen perf notice.'));
  vm.runInContext(`function setShadowsEnabled(value) { renderer.shadowMap.enabled = value; }\n${adaptive}\n${governor}`, context);
  context.tick = (seconds, fps) => {
    for (let i = 0; i < seconds * fps; i++) context.updateAdaptiveQuality(1 / fps);
  };
  return context;
}

test('22 FPS requests permission and only disables shadows after acceptance', () => {
  assert.match(source, /updateAdaptiveQuality\(rawDt\)/);
  const c = controller();
  c.tick(6, 22);
  assert.ok(Math.abs(c.quality.lastFps - 22) < .1);
  assert.equal(c.renderer.shadowMap.enabled, true);
  assert.equal(c.promptCount, 1);
  c.decideShadows(true);
  assert.equal(c.renderer.shadowMap.enabled, false);
  assert.equal(c.quality.scale, .8);
});

test('healthy FPS, explicit shadow settings, disabled governor and menus keep shadows', () => {
  for (const overrides of [{ shadows: 'on' }, { autoPerfGovernor: false }]) {
    const c = controller(overrides);
    c.tick(8, 22);
    assert.equal(c.renderer.shadowMap.enabled, true);
  }
  const healthy = controller();
  healthy.tick(8, 60);
  assert.equal(healthy.renderer.shadowMap.enabled, true);
  const menu = controller();
  menu.game.state = 'menu';
  menu.tick(8, 22);
  assert.equal(menu.renderer.shadowMap.enabled, true);
});

test('isolated hitches and tab suspension do not count as sustained poor performance', () => {
  const c = controller();
  c.tick(2, 22);
  c.updateAdaptiveQuality(5);
  assert.equal(c._governorStrikes, 0);
  c.document.hidden = true;
  c.tick(8, 22);
  c.document.hidden = false;
  c.tick(6, 60);
  assert.equal(c.renderer.shadowMap.enabled, true);
  c.updateAdaptiveQuality(NaN);
  assert.ok(Number.isFinite(c.quality.smoothDt));
});

 test('declining keeps shadows and never repeats the prompt this session', () => {
  const c = controller(); c.tick(6, 22); c.decideShadows(false); c.tick(20, 22);
  assert.equal(c.renderer.shadowMap.enabled, true); assert.equal(c.promptCount, 1);
});
