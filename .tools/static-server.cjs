const http = require("http");
const fs = require("fs");
const path = require("path");
const { URL } = require("url");
const esbuild = require("esbuild");

const root = path.resolve(__dirname, "..");
const port = Number(process.env.PORT || 8000);
const host = process.env.HOST || "127.0.0.1"; // set HOST=0.0.0.0 for LAN play

// ── TS-on-the-fly (Phase 1 migration support) ────────────────────────────────
// Unlike Vite, this bare file server has no module resolution or transform. As
// modules migrate .js → .ts, their import specifiers become extensionless (or
// keep a legacy `.js` that no longer exists on disk). Resolve those to the .ts
// source and transpile it to browser ESM so the legacy HTML entry + every
// Playwright spec keep working without a build step. Cached by mtime.
const tsCache = new Map(); // absPath -> { mtimeMs, code }

// Given the on-disk path a request resolved to (which may not exist), return the
// actual file to serve: the request itself if it exists, else a `.ts` sibling
// (for extensionless imports or `.js` specifiers pointing at migrated sources).
function resolveSource(filePath) {
  if (fileExists(filePath)) return filePath;
  const ext = path.extname(filePath);
  const candidates = [];
  if (ext === "") {
    candidates.push(filePath + ".ts", filePath + ".js", filePath + ".mjs");
  } else if (ext === ".js" || ext === ".mjs") {
    candidates.push(filePath.slice(0, -ext.length) + ".ts"); // ./foo.js -> ./foo.ts
  }
  for (const c of candidates) if (fileExists(c)) return c;
  return null;
}

function fileExists(p) {
  try { return fs.statSync(p).isFile(); } catch { return false; }
}

function serveTs(absPath, res) {
  const { mtimeMs } = fs.statSync(absPath);
  let hit = tsCache.get(absPath);
  if (!hit || hit.mtimeMs !== mtimeMs) {
    const src = fs.readFileSync(absPath, "utf8");
    const out = esbuild.transformSync(src, {
      loader: "ts",
      format: "esm",
      target: "esnext",
      sourcefile: path.basename(absPath),
      sourcemap: "inline",
    });
    hit = { mtimeMs, code: out.code };
    tsCache.set(absPath, hit);
  }
  res.writeHead(200, {
    "Content-Type": "text/javascript; charset=utf-8",
    "Cache-Control": "no-store",
    "Access-Control-Allow-Origin": "*",
  });
  res.end(hit.code);
}

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
  let pathname = decodeURIComponent(url.pathname);
  if (pathname === "/") pathname = "/first_person_shooter_room_game (1).html";

  const requested = path.resolve(root, `.${pathname}`);
  if (!requested.startsWith(root)) {
    res.writeHead(403);
    res.end("Forbidden");
    return;
  }

  // Resolve extensionless / migrated-.js requests to their real source (incl. .ts).
  const filePath = resolveSource(requested);
  if (!filePath) {
    res.writeHead(404);
    res.end("Not found");
    return;
  }

  // TypeScript source: transpile to browser ESM on the fly.
  if (path.extname(filePath).toLowerCase() === ".ts") {
    try {
      serveTs(filePath, res);
    } catch (err) {
      res.writeHead(500);
      res.end(`// TS transform failed for ${pathname}\n// ${err && err.message}`);
    }
    return;
  }

  const ext = path.extname(filePath).toLowerCase();
  res.writeHead(200, {
    "Content-Type": mime[ext] || "application/octet-stream",
    "Cache-Control": "no-store",
    "Access-Control-Allow-Origin": "*",
  });
  fs.createReadStream(filePath).pipe(res);
});

server.listen(port, host, () => {
  console.log(`Room Breach server listening on http://${host}:${port} (transpiles .ts on the fly)`);
});
