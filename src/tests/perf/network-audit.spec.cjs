// Network audit: boots the game, starts a wave, plays ~20 s and records EVERY
// network request (url, status, bytes, time) to network-audit.json.
//
// Requests are split into "before first interactive" (until body[data-rb-ready])
// and "after" (menu → mission → gameplay). Any .fbx request and any lazy load
// over 2 MB is flagged.
//
// Default target is the legacy page served by src/tests/static-server.cjs. To
// audit the BUILT output (what GitHub Pages serves):
//   npm run build && npx vite preview --port 4173 &
//   AUDIT_URL="http://127.0.0.1:4173/index.html?test=1" \
//   AUDIT_OUT=network-audit-dist.json npx playwright test src/tests/perf/network-audit.spec.cjs
const { test, expect } = require("@playwright/test");
const fs = require("fs");
const path = require("path");

const URL = process.env.AUDIT_URL || "http://127.0.0.1:8000/src/first_person_shooter_room_game%20(1).html?test=1";
const OUT = path.resolve(process.env.AUDIT_OUT || "network-audit.json");
const PLAY_MS = Number(process.env.AUDIT_PLAY_MS || 20000);
const LAZY_FLAG_BYTES = 2 * 1024 * 1024;

const fmt = n => (n >= 1048576 ? (n / 1048576).toFixed(2) + " MB" : (n / 1024).toFixed(1) + " KB");
const short = u => { try { const x = new globalThis.URL(u); return decodeURIComponent(x.pathname + x.search); } catch { return u; } };

function printTable(title, rows) {
  const total = rows.reduce((s, r) => s + r.bytes, 0);
  console.log(`\n=== ${title}: ${rows.length} requests, ${fmt(total)} ===`);
  console.log("   size      status  ms     url");
  for (const r of [...rows].sort((a, b) => b.bytes - a.bytes)) {
    const flag = (/\.fbx(\?|$)/i.test(r.url) ? " [FBX]" : "") + (r.phase === "after" && r.bytes > LAZY_FLAG_BYTES ? " [LAZY>2MB]" : "");
    console.log(`${fmt(r.bytes).padStart(10)}  ${String(r.status).padStart(4)}  ${String(r.ms).padStart(6)}  ${short(r.url)}${flag}`);
  }
}

test("network audit: boot + wave + 20s of play", async ({ page }) => {
  test.setTimeout(420000);
  let phase = "boot";
  const rows = [];
  const t0 = Date.now();

  page.on("requestfinished", async request => {
    const url = request.url();
    if (url.startsWith("data:") || url.startsWith("blob:")) return;
    let bytes = 0, status = 0;
    try {
      const response = await request.response();
      status = response ? response.status() : 0;
      const sizes = await request.sizes();
      bytes = sizes.responseBodySize + sizes.responseHeadersSize;
      if (!bytes && response) bytes = Number(response.headers()["content-length"] || 0);
    } catch { /* request already gone */ }
    const timing = request.timing();
    rows.push({ url, status, bytes, ms: Math.max(0, Math.round(timing.responseEnd)), at: Date.now() - t0, phase, type: request.resourceType() });
  });
  const loaderWarnings = [];
  page.on("console", msg => {
    // Loader fallbacks (e.g. "x.glb could not be loaded; trying FBX") show up here.
    if (/could not be loaded|failed to load|fall back|falling back/i.test(msg.text()) && ["warning", "error"].includes(msg.type())) loaderWarnings.push(msg.text().slice(0, 200));
  });
  page.on("requestfailed", request => {
    const url = request.url();
    if (/favicon/i.test(url)) return;
    rows.push({ url, status: 0, bytes: 0, ms: 0, at: Date.now() - t0, phase, type: request.resourceType(), failed: request.failure()?.errorText || "failed" });
  });

  await page.goto(URL, { waitUntil: "domcontentloaded" });
  await page.waitForFunction(() => document.body.dataset.rbReady === "1", { timeout: 180000 });
  await page.waitForFunction(() => window.__rbTest, { timeout: 15000 });
  const bootMs = Date.now() - t0;
  phase = "after";

  await page.locator("#startBtn").click();
  await page.waitForFunction(() => window.__rbTest.getState() === "playing", { timeout: 20000 });
  await page.waitForFunction(() => window.__rbTest.getEnemyCount() > 0, { timeout: 20000 });

  // ~20 s of play: move, fire, force a second wave so wave-gated assets load.
  const end = Date.now() + PLAY_MS;
  let completedWave = false;
  while (Date.now() < end) {
    await page.keyboard.down("KeyW");
    await page.keyboard.down("ShiftLeft");
    await page.waitForTimeout(1500);
    await page.keyboard.up("ShiftLeft");
    await page.keyboard.up("KeyW");
    await page.evaluate(() => { window.__rbTest.aimAtNearest(); window.__rbTest.fireAtNearest(); }).catch(() => {});
    if (!completedWave && Date.now() > end - PLAY_MS / 2) {
      completedWave = true;
      await page.evaluate(() => window.__rbTest.completeWave()).catch(() => {});
    }
    await page.waitForTimeout(500);
  }
  await page.waitForTimeout(1500);

  const summary = {
    url: URL,
    bootMs,
    boot: { requests: 0, bytes: 0 },
    after: { requests: 0, bytes: 0 },
    fbxRequests: rows.filter(r => /\.fbx(\?|$)/i.test(r.url)).map(r => ({ url: r.url, bytes: r.bytes, phase: r.phase })),
    lazyOver2MB: rows.filter(r => r.phase === "after" && r.bytes > LAZY_FLAG_BYTES).map(r => ({ url: r.url, bytes: r.bytes })),
    failed: rows.filter(r => r.failed || r.status >= 400).map(r => ({ url: r.url, status: r.status, failed: r.failed })),
    loaderWarnings,
  };
  for (const r of rows) {
    const b = r.phase === "boot" ? summary.boot : summary.after;
    b.requests++; b.bytes += r.bytes;
  }
  fs.writeFileSync(OUT, JSON.stringify({ summary, requests: rows }, null, 2));

  printTable("BEFORE first interactive (boot)", rows.filter(r => r.phase === "boot"));
  printTable("AFTER (mission start + play)", rows.filter(r => r.phase === "after"));
  console.log(`\nboot ready in ${(bootMs / 1000).toFixed(1)}s; boot ${fmt(summary.boot.bytes)} / after ${fmt(summary.after.bytes)}`);
  console.log(`FBX requests: ${summary.fbxRequests.length}${summary.fbxRequests.length ? "  <-- FLAGGED" : ""}`);
  for (const f of summary.fbxRequests) console.log(`  [${f.phase}] ${fmt(f.bytes)} ${short(f.url)}`);
  console.log(`Lazy loads >2MB: ${summary.lazyOver2MB.length}`);
  console.log(`Failed/4xx+: ${summary.failed.length}`);
  for (const f of summary.failed) console.log(`  ${f.status} ${f.failed || ""} ${short(f.url)}`);
  console.log(`Loader fallback warnings: ${loaderWarnings.length}`);
  for (const w of loaderWarnings) console.log(`  ${w}`);
  console.log(`Wrote ${OUT}`);

  expect(rows.length).toBeGreaterThan(0);
});
