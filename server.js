/**
 * UNKNW FPS — self-hosted game + PeerJS signalling server.
 *
 * Serves static game files AND runs a PeerJS broker at /peerjs on the same
 * port so a single Cloudflare tunnel covers everything.
 *
 * Usage:  node server.js [port]     (default: 8000)
 */

import http  from "http";
import path  from "path";
import { fileURLToPath } from "url";
import express from "express";
import { ExpressPeerServer } from "peer";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PORT = Number(process.argv[2]) || 8000;

// ── Security headers ──────────────────────────────────────────────────────────
function applySecurityHeaders(res) {
  // No COEP/COOP — those block cross-origin CDN module imports (Three.js, PeerJS).
  // No tight CSP — the game uses CDN importmaps that span many hosts.
  res.setHeader("X-Content-Type-Options", "nosniff");
  res.setHeader("Cache-Control", "no-cache");
}

// ── Rate limiter (static file requests) ──────────────────────────────────────
const RATE_WINDOW_MS = 10_000;
const RATE_MAX_REQ   = 120;
const rateBuckets    = new Map();

function isRateLimited(ip) {
  const now = Date.now();
  let bucket = rateBuckets.get(ip);
  if (!bucket || now - bucket.windowStart > RATE_WINDOW_MS) {
    rateBuckets.set(ip, { count: 1, windowStart: now });
    return false;
  }
  bucket.count++;
  return bucket.count > RATE_MAX_REQ;
}

setInterval(() => {
  const cutoff = Date.now() - RATE_WINDOW_MS;
  for (const [ip, b] of rateBuckets) {
    if (b.windowStart < cutoff) rateBuckets.delete(ip);
  }
}, 60_000).unref();

// ── Express app ───────────────────────────────────────────────────────────────
const app = express();

app.use((req, res, next) => {
  const headerSize = JSON.stringify(req.headers).length;
  if (headerSize > 8192) { res.status(431).end("Request Header Fields Too Large"); return; }
  const ip = req.socket.remoteAddress || "unknown";
  if (isRateLimited(ip)) { res.status(429).end("Too Many Requests"); return; }
  applySecurityHeaders(res);
  next();
});

// ── Health endpoint ───────────────────────────────────────────────────────────
app.get("/health", (_req, res) => {
  res.json({ status: "ok", uptime: process.uptime(), ts: Date.now() });
});

// ── File extension allowlist ──────────────────────────────────────────────────
const ALLOWED_EXTENSIONS = new Set([
  ".html", ".js", ".mjs", ".cjs", ".css", ".json",
  ".png", ".jpg", ".jpeg", ".gif", ".svg", ".ico", ".webp",
  ".woff", ".woff2", ".ttf", ".otf",
  ".wav", ".mp3", ".ogg",
  ".glb", ".gltf", ".bin",
]);

app.use((req, res, next) => {
  if (req.path.startsWith("/peerjs") || req.path === "/health") return next();
  const ext = path.extname(req.path).toLowerCase();
  if (ext && !ALLOWED_EXTENSIONS.has(ext)) { res.status(403).end("Forbidden"); return; }
  next();
});

app.use(express.static(__dirname, {
  dotfiles:     "deny",
  index:        false,
  etag:         false,
  lastModified: false,
}));

// ── HTTP server ───────────────────────────────────────────────────────────────
const server = http.createServer(app);
server.maxConnections = 256;

// ── PeerJS broker at /peerjs ──────────────────────────────────────────────────
const peerServer = ExpressPeerServer(server, {
  path:             "/",       // relative to the mount point below
  allow_discovery:  false,
  concurrent_limit: 32,
  alive_timeout:    20_000,
  cleanup_out_msgs: 200,
  key: "peerjs",
});

app.use("/peerjs", peerServer);

let activePeers = 0;
peerServer.on("connection",  (c) => { activePeers++; console.log(`[peer] +${c.getId()}  (${activePeers} active)`); });
peerServer.on("disconnect",  (c) => { activePeers = Math.max(0, activePeers - 1); console.log(`[peer] -${c.getId()}  (${activePeers} active)`); });

// ── Boot ──────────────────────────────────────────────────────────────────────
server.listen(PORT, "127.0.0.1", () => {
  console.log(`\n  UNKNW  |  http://127.0.0.1:${PORT}`);
  console.log(`  PeerJS       |  http://127.0.0.1:${PORT}/peerjs`);
  console.log(`  Health       |  http://127.0.0.1:${PORT}/health`);
  console.log(`\n  Press Ctrl+C to stop.\n`);
});

server.on("error", (err) => {
  if (err.code === "EADDRINUSE") console.error(`\n  ERROR: Port ${PORT} is already in use.\n`);
  else console.error("\n  ERROR:", err.message, "\n");
  process.exit(1);
});

// ── Graceful shutdown ─────────────────────────────────────────────────────────
function shutdown(signal) {
  console.log(`\n  ${signal} — shutting down…`);
  server.close(() => { console.log("  HTTP server closed."); process.exit(0); });
  setTimeout(() => { console.warn("  Force exit."); process.exit(1); }, 8_000).unref();
}

process.on("SIGTERM", () => shutdown("SIGTERM"));
process.on("SIGINT",  () => shutdown("SIGINT"));

process.on("uncaughtException",  (err)    => { console.error("[server] Uncaught:", err);    shutdown("uncaughtException"); });
process.on("unhandledRejection", (reason) => { console.error("[server] Rejection:", reason); });
