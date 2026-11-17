const http = require("http");
const fs = require("fs");
const path = require("path");
const { URL } = require("url");
const { sourceModules } = require("../source_modules.cjs");
const { serveAsset } = require('../http_assets.cjs');

// __dirname is src/tests; go up two levels to the repo root so `assets/`
// (a sibling of src/, not inside it — kept out of the source tree on purpose)
// is reachable alongside the game files under src/.
const root = path.resolve(__dirname, "../..");
const port = Number(process.env.PORT || 8000);
const host = process.env.HOST || "127.0.0.1"; // set HOST=0.0.0.0 for LAN play

// ── TS-on-the-fly (Phase 1 migration support) ────────────────────────────────
// Unlike Vite, this bare file server has no module resolution or transform. As
// modules migrate .js → .ts, their import specifiers become extensionless (or
// keep a legacy `.js` that no longer exists on disk). Resolve those to the .ts
// source and transpile it to browser ESM so the legacy HTML entry + every
// Playwright spec keep working without a build step. Cached by mtime.
const serveSource = sourceModules(path.join(root, "src"));

const mime = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".mjs": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".webp": "image/webp",
  ".glb": "model/gltf-binary",
  ".gltf": "model/gltf+json",
  ".fbx": "application/octet-stream",
  ".wasm": "application/wasm",
  ".svg": "image/svg+xml",
  ".txt": "text/plain; charset=utf-8",
};

const server = http.createServer((req, res) => {
  const url = new URL(req.url, `http://${req.headers.host || "127.0.0.1"}`);
  let pathname;
  try { pathname = decodeURIComponent(url.pathname); }
  catch { res.writeHead(400); res.end('Invalid URL'); return; }
  if (pathname === "/") pathname = "/src/first_person_shooter_room_game (1).html";

  const requested = path.resolve(root, `.${pathname}`);
  if (!requested.startsWith(root + path.sep)) {
    res.writeHead(403);
    res.end("Forbidden");
    return;
  }

  if (pathname.startsWith('/src/')) {
    const original = req.url;
    req.url = pathname.slice(4);
    let handled = true;
    serveSource(req, res, error => { handled = false; if (error) console.error(error); });
    req.url = original;
    if (handled) return;
  }
  const filePath = requested;
  try { if (!fs.statSync(filePath).isFile()) throw new Error('Not a file'); }
  catch { res.writeHead(404); res.end('Not found'); return; }

  const ext = path.extname(filePath).toLowerCase();
  serveAsset(req, res, filePath, mime[ext] || "application/octet-stream", filePath.startsWith(path.join(root, 'assets') + path.sep));
});

server.listen(port, host, () => {
  console.log(`Room Breach server listening on http://${host}:${port} (transpiles .ts on the fly)`);
});
