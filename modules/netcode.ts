// Lightweight WebRTC networking layer for UNKNW multiplayer.
//
// Topology: star. The host owns a well-known PeerJS id (the room code) and every
// guest connects directly to it. The host relays guest traffic to the other
// guests, so from the game's perspective every client receives every other
// client's messages. The host is authoritative for shared world state (enemies).
//
// Transport: PeerJS over the public cloud broker by default. For internet play
// via Cloudflare tunnel, pass ?peerhost=<tunnel-host>&peerport=443&peersecure=1
// &peerpath=/peerjs (run_internet.bat does this automatically).
// For LAN without internet: ?peerhost=<HOST_LAN_IP>&peerport=9000
//   and run: node server.js (or npx peerjs --port 9000)

import { Peer } from "peerjs";

// Namespace ids on the shared public broker so we don't collide with other apps.
const ROOM_PREFIX = "rbfps-";

// Safety limits.
const MAX_GUESTS        = 7;      // Host + 7 guests = 8 players max.
const MAX_MSG_BYTES     = 32768;  // 32 KB per message.
const RATE_LIMIT_WINDOW = 1000;   // ms
const RATE_LIMIT_MAX    = 200;    // messages per window per peer (for 50 Hz snapshots).

// Error types that mean the peer is permanently broken — no point retrying.
const FATAL_PEER_ERRORS = new Set([
  "browser-incompatible",
  "invalid-id",
  "invalid-key",
  "ssl-unavailable",
  "server-error",
  "socket-error",
  "socket-closed",
  "unavailable-id",
]);

const JOIN_TIMEOUT_MS    = 18_000; // Guest waits this long for connection to open.
const HEARTBEAT_MS       = 4_000;  // Ping interval.
const STALE_MS           = 14_000; // Drop peer if no message for this long.
const RECONNECT_BASE_MS  = 1_000;  // Initial reconnect delay.
const RECONNECT_MAX_MS   = 30_000; // Cap exponential backoff at 30 s.

// ── Host migration ──────────────────────────────────────────────────────────
// When the host drops, the session stays fully P2P: a deterministic successor
// claims a new well-known id derived from the room code, and the remaining
// guests reconnect to it. Succession order = join order (host first), which
// every peer learns from the host's periodic __roster broadcast.
const MIGRATION_ROUND_MS   = 6_000; // Per-candidate window to take over before falling through to the next.
const MIGRATION_RETRY_MS   = 1_400; // Follower re-dials the new host this often within a round.
const ROSTER_BROADCAST_MS  = 3_000; // Host re-broadcasts the succession order this often.

// ── STUN (free, no auth) ─────────────────────────────────────────────────────
// STUN handles the common case: two home/broadband NATs hole-punch directly.
// Multiple providers for redundancy if one is unreachable.
const STUN_SERVERS = [
  { urls: "stun:stun.l.google.com:19302"  },
  { urls: "stun:stun1.l.google.com:19302" },
  { urls: "stun:stun2.l.google.com:19302" },
  { urls: "stun:stun.cloudflare.com:3478" },
  { urls: "stun:stun.relay.metered.ca:80" },
];

// ── TURN (relay) — REQUIRED for symmetric NAT / CGNAT / mobile / strict firewalls ─
// Free public no-signup TURN relays have all been shut down, so the only way to
// guarantee a relay for hard-NAT peers is to supply your own (free) credentials.
// Get them in ~2 min at https://dashboard.metered.ca (Open Relay, 50GB/mo free)
// or https://expressturn.com, then pass them on the URL:
//   &turnhost=<host>&turnuser=<user>&turncred=<credential>
// Example:
//   &turnhost=global.relay.metered.ca&turnuser=abc123&turncred=xyz789
// When supplied we generate the full TLS/TCP/UDP variant set for best traversal.
function turnServersFromParams(params) {
  const host = params.get("turnhost");
  const user = params.get("turnuser");
  const cred = params.get("turncred");
  if (!host || !user || !cred) return [];
  return [
    { urls: `turn:${host}:80`,                 username: user, credential: cred },
    { urls: `turn:${host}:80?transport=tcp`,   username: user, credential: cred },
    { urls: `turn:${host}:443`,                username: user, credential: cred },
    { urls: `turns:${host}:443?transport=tcp`, username: user, credential: cred },
  ];
}

// Build the full ICE server list: STUN always, plus any configured TURN relay.
function buildIceServers() {
  const params = new URLSearchParams(location.search);
  return [...STUN_SERVERS, ...turnServersFromParams(params)];
}

// True if a TURN relay has been configured (so hard-NAT peers can connect).
function hasTurnConfigured() {
  const params = new URLSearchParams(location.search);
  return !!(params.get("turnhost") && params.get("turnuser") && params.get("turncred"));
}

export function makeRoomCode() {
  const alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"; // no ambiguous 0/O/1/I
  let code = "";
  for (let i = 0; i < 6; i++) code += alphabet[Math.floor(Math.random() * alphabet.length)];
  return code;
}

export function createNetwork() {
  const listeners   = Object.create(null);
  const connections = new Map(); // peerId -> DataConnection
  const lastSeen    = new Map(); // peerId -> performance.now() timestamp
  const msgCounts   = new Map(); // peerId -> { count, windowStart }
  let peer          = null;
  let isHost        = false;
  let selfId        = null;
  let roomCode      = null;
  let heartbeatTimer  = null;
  let reconnectTimer  = null;
  let reconnectAttempts = 0;
  let _isReconnecting   = false;

  // ── Host-migration state ─────────────────────────────────────────────────
  let hostGen        = 0;     // Host generation. 0 = original host; each migration bumps it.
  let succession     = [];    // Ordered peer ids [hostId, guest1, guest2, …] = takeover priority.
  let rosterTimer    = null;  // Host: periodic __roster broadcaster.
  let migrating      = false; // Guest: a migration round is in progress.
  let migrationTimer = null;  // Guest: round/retry timer.
  let migrationRound = 0;     // Guest: which successor index is currently trying.

  // ── Event bus ──────────────────────────────────────────────────────────────
  // Each listener is called independently — a crash in one never silences others.
  function emit(event, ...args) {
    const cbs = listeners[event];
    if (!cbs) return;
    for (const cb of cbs.slice()) {
      try { cb(...args); }
      catch (err) { console.error(`[netcode] listener error on "${event}":`, err); }
    }
  }

  function on(event, cb) {
    (listeners[event] || (listeners[event] = [])).push(cb);
    return () => { listeners[event] = (listeners[event] || []).filter(c => c !== cb); };
  }

  // ── PeerJS options ─────────────────────────────────────────────────────────
  function peerOptions() {
    const params = new URLSearchParams(location.search);
    const host   = params.get("peerhost");
    if (host) {
      const secure = params.get("peersecure") === "1";
      // peersecure=1 → self-hosted broker via HTTPS tunnel (internet play).
      // LAN mode (secure=0) only needs a single STUN; internet needs the full set.
      const iceServers           = secure ? buildIceServers() : [{ urls: "stun:stun.l.google.com:19302" }];
      const iceCandidatePoolSize = secure ? 16 : 4;
      return {
        host,
        port:   Number(params.get("peerport")) || 9000,
        // server.js mounts ExpressPeerServer at /peerjs, and peer's internal WS
        // suffix makes the real endpoint /peerjs/peerjs — the client must be told
        // path "/peerjs" (default "/" handshakes at /peerjs and gets HTTP 400).
        path:   params.get("peerpath") || "/peerjs",
        secure,
        debug: 0,
        config: { iceServers, iceTransportPolicy: "all", iceCandidatePoolSize, bundlePolicy: "max-bundle", rtcpMuxPolicy: "require" },
      };
    }
    // Public broker: STUN + any configured TURN for symmetric NATs / strict firewalls.
    return {
      debug: 0,
      config: {
        iceServers: buildIceServers(),
        iceTransportPolicy: "all",
        iceCandidatePoolSize: 16,
        bundlePolicy: "max-bundle",
        rtcpMuxPolicy: "require",
      },
    };
  }

  // Returns true only for genuine LAN play (self-hosted broker, NOT via HTTPS tunnel).
  function isLanMode() {
    const params = new URLSearchParams(location.search);
    return !!(params.get("peerhost")) && params.get("peersecure") !== "1";
  }

  // ── Low-level send ─────────────────────────────────────────────────────────
  function sendRaw(conn, msg) {
    if (!conn?.open) return false;
    try { conn.send(msg); return true; }
    catch (_) { return false; }
  }

  // ── Peer tracking ──────────────────────────────────────────────────────────
  function touch(peerId) {
    if (peerId) lastSeen.set(peerId, performance.now());
  }

  function dropConnection(peerId) {
    if (!connections.has(peerId)) return;
    const conn = connections.get(peerId);
    const wasHostConn = !isHost && peerId === currentHostId();
    connections.delete(peerId);
    lastSeen.delete(peerId);
    msgCounts.delete(peerId);
    try { conn?.close(); } catch (_) { /* ignore */ }
    emit("peerleave", peerId);

    if (isHost) {
      // Lost a guest — succession order changed, tell everyone.
      broadcastRoster();
    } else if (wasHostConn && roomCode && !migrating) {
      // Lost the host — start a P2P migration round instead of ending the session.
      beginMigration();
    }
  }

  // Returns true if within rate limit, false (and drops) if flooding.
  function checkRateLimit(peerId) {
    const now = performance.now();
    let rec = msgCounts.get(peerId);
    if (!rec || now - rec.windowStart > RATE_LIMIT_WINDOW) {
      rec = { count: 1, windowStart: now };
      msgCounts.set(peerId, rec);
      return true;
    }
    rec.count++;
    if (rec.count > RATE_LIMIT_MAX) { dropConnection(peerId); return false; }
    return true;
  }

  function estimateMsgSize(data) {
    try { return JSON.stringify(data).length; } catch (_) { return 0; }
  }

  // ── Heartbeat ──────────────────────────────────────────────────────────────
  function startHeartbeat() {
    if (heartbeatTimer) return;
    heartbeatTimer = setInterval(() => {
      const now = performance.now();
      for (const [id, conn] of connections) {
        const seen = lastSeen.get(id) ?? now;
        if (!conn.open || now - seen > STALE_MS) { dropConnection(id); continue; }
        sendRaw(conn, { t: "__ping", ts: Math.round(now) });
      }
    }, HEARTBEAT_MS);
  }

  // ── Incoming data handler ─────────────────────────────────────────────────
  function handleIncomingData(conn, data) {
    if (!data || typeof data !== "object" || Array.isArray(data)) return;
    if (typeof data.t !== "string" || data.t.length > 32) return;

    // Heartbeat bypass.
    if (data.t === "__ping") {
      touch(conn.peer);
      sendRaw(conn, { t: "__pong", ts: typeof data.ts === "number" ? data.ts : 0 });
      return;
    }
    if (data.t === "__pong") { touch(conn.peer); return; }

    // Succession roster (host → guests). Internal: never surfaced to the game.
    if (data.t === "__roster") {
      touch(conn.peer);
      if (!isHost && Array.isArray(data.order)) {
        succession = data.order.filter(x => typeof x === "string");
        if (Number.isFinite(data.gen)) hostGen = data.gen;
      }
      return;
    }

    if (estimateMsgSize(data) > MAX_MSG_BYTES) return;
    if (!checkRateLimit(conn.peer)) return;

    touch(conn.peer);
    emit("data", data, conn.peer);
    if (isHost) relay(data, conn.peer);
  }

  // Attach diagnostics to the underlying RTCPeerConnection so an ICE/NAT failure
  // is reported as exactly that — not mistaken for "server down". The broker
  // (signalling) and the P2P data channel (ICE) are separate; this distinguishes
  // them. peerConnection may not exist yet, so poll briefly until it appears.
  function attachIceDiagnostics(conn) {
    let tries = 0;
    const wire = () => {
      const pc = conn.peerConnection;
      if (!pc) {
        if (tries++ < 40) setTimeout(wire, 150);
        return;
      }
      pc.addEventListener("iceconnectionstatechange", () => {
        const st = pc.iceConnectionState;
        if (st === "failed") {
          // ICE exhausted every candidate pair. This is a NAT-traversal failure:
          // at least one peer is behind a symmetric/CGNAT and no TURN relay is
          // available. Signalling was fine — the direct P2P path could not form.
          emit("icefailed", {
            peer: conn.peer,
            hasTurn: hasTurnConfigured(),
            message: hasTurnConfigured()
              ? "Direct connection failed even via the TURN relay. The relay may be down or out of quota."
              : "Direct P2P connection blocked by your network (strict/mobile NAT). A TURN relay is required — add &turnhost=&turnuser=&turncred= to the link.",
          });
        }
      });
    };
    wire();
  }

  // ── Connection setup ───────────────────────────────────────────────────────
  function setupConnection(conn, { joinTimeout = false } = {}) {
    let openTimer = null;
    attachIceDiagnostics(conn);

    if (joinTimeout) {
      openTimer = setTimeout(() => {
        if (!connections.has(conn.peer)) {
          try { conn.close(); } catch (_) { /* ignore */ }
          const hint = hasTurnConfigured()
            ? " Signalling reached the host but the P2P link never formed — the TURN relay may be down or out of quota."
            : " The host was reachable but a direct P2P link could not form (strict/mobile NAT). Add a TURN relay: &turnhost=&turnuser=&turncred=.";
          emit("fatal", { type: "join-timeout", message: `Could not establish a connection to the host.${hint}` });
          destroyPeer();
        }
      }, JOIN_TIMEOUT_MS);
    }

    conn.on("open", () => {
      if (openTimer) { clearTimeout(openTimer); openTimer = null; }
      if (isHost && connections.size >= MAX_GUESTS) {
        try { conn.close(); } catch (_) { /* ignore */ }
        return;
      }
      connections.set(conn.peer, conn);
      touch(conn.peer);
      reconnectAttempts = 0; // successful connection resets backoff
      _isReconnecting   = false;

      // Migration success: a follower just (re)connected to the new host.
      if (migrating && !isHost && conn.peer === currentHostId()) {
        migrating = false;
        if (migrationTimer)      { clearInterval(migrationTimer); migrationTimer = null; }
        if (_migrationRoundTimer) { clearTimeout(_migrationRoundTimer); _migrationRoundTimer = null; }
        emit("hostmigrated", { hostId: conn.peer, gen: hostGen });
      }

      // Host just gained/lost a guest → refresh and rebroadcast the succession order.
      if (isHost) broadcastRoster();

      emit("peerjoin", conn.peer);
    });

    conn.on("data",  data  => handleIncomingData(conn, data));
    conn.on("close", ()    => { if (openTimer) { clearTimeout(openTimer); openTimer = null; } dropConnection(conn.peer); });
    conn.on("error", err   => {
      if (openTimer) { clearTimeout(openTimer); openTimer = null; }
      dropConnection(conn.peer);
      emit("error", err);
    });
  }

  // ── Peer lifecycle ─────────────────────────────────────────────────────────
  function destroyPeer() {
    if (heartbeatTimer)  { clearInterval(heartbeatTimer);  heartbeatTimer = null; }
    if (reconnectTimer)  { clearTimeout(reconnectTimer);   reconnectTimer = null; }
    if (rosterTimer)     { clearInterval(rosterTimer);     rosterTimer = null; }
    if (migrationTimer)  { clearInterval(migrationTimer);  migrationTimer = null; }
    if (_migrationRoundTimer) { clearTimeout(_migrationRoundTimer); _migrationRoundTimer = null; }
    try { peer?.destroy(); } catch (_) { /* ignore */ }
    peer              = null;
    isHost            = false;
    selfId            = null;
    roomCode          = null;
    _isReconnecting   = false;
    reconnectAttempts = 0;
    migrating         = false;
    hostGen           = 0;
    succession        = [];
  }

  // Broker disconnected — schedule an exponential-backoff reconnect.
  // No hard cap: we keep trying until the user explicitly closes the session
  // or the peer is destroyed. The UI is notified via "reconnecting" each attempt.
  function scheduleReconnect() {
    if (!peer || reconnectTimer) return;
    _isReconnecting = true;
    reconnectAttempts++;
    const delay = Math.min(RECONNECT_BASE_MS * 2 ** (reconnectAttempts - 1), RECONNECT_MAX_MS);
    emit("reconnecting", { attempt: reconnectAttempts, delayMs: delay });
    reconnectTimer = setTimeout(() => {
      reconnectTimer = null;
      if (!peer) return;
      try {
        peer.reconnect();
        // After a successful broker reconnect, peer fires "open" again.
        // We listen for it once to emit "reconnected".
        peer.once("open", () => {
          _isReconnecting   = false;
          reconnectAttempts = 0;
          emit("reconnected");
        });
      } catch (_) {
        // If reconnect() itself throws the peer is too broken — schedule again.
        scheduleReconnect();
      }
    }, delay);
  }

  // Host-only: relay a guest message to all other guests.
  function relay(data, fromId) {
    for (const [id, conn] of connections) {
      if (id !== fromId && conn.open) sendRaw(conn, data);
    }
  }

  // ── Host migration ─────────────────────────────────────────────────────────
  // Well-known host id for a given generation. Gen 0 keeps the original code so
  // first-time joiners work; later generations append a suffix so a new host can
  // claim its id immediately without waiting for the broker to free the old one.
  function hostIdFor(code, gen) {
    return ROOM_PREFIX + code + (gen > 0 ? `_g${gen}` : "");
  }
  function currentHostId() {
    return roomCode ? hostIdFor(roomCode, hostGen) : null;
  }

  // Host: succession = self + guests in join order (Map preserves insertion order).
  function rebuildSuccession() {
    succession = [selfId, ...connections.keys()].filter(Boolean);
  }
  function broadcastRoster() {
    if (!isHost) return;
    rebuildSuccession();
    const msg = { t: "__roster", gen: hostGen, order: succession };
    for (const conn of connections.values()) sendRaw(conn, msg);
  }
  function startRosterBroadcast() {
    if (rosterTimer) return;
    rosterTimer = setInterval(broadcastRoster, ROSTER_BROADCAST_MS);
  }

  // Promote this (guest) peer to host by claiming a fresh well-known id.
  function promoteToHost(gen) {
    try { peer?.destroy(); } catch (_) { /* ignore */ }
    if (heartbeatTimer) { clearInterval(heartbeatTimer); heartbeatTimer = null; }
    connections.clear(); lastSeen.clear(); msgCounts.clear();

    isHost   = true;
    hostGen  = gen;
    migrating = false;
    const newId = hostIdFor(roomCode, gen);
    peer = new Peer(newId, peerOptions());

    peer.on("open", id => {
      selfId = id;
      rebuildSuccession();
      startHeartbeat();
      startRosterBroadcast();
      emit("becamehost", { code: roomCode, gen });
      emit("ready", roomCode, true);
    });
    peer.on("connection", conn => setupConnection(conn));
    peer.on("error", err => {
      // The new-generation id is collision-free by construction, so this should
      // essentially never fire. If it does (a genuine broker race), degrade
      // cleanly rather than risk an election loop — this node is candidate[0].
      if (err?.type === "unavailable-id") {
        emit("fatal", { type: "migration-failed", message: "Could not claim host role after migration — session ended." });
        destroyPeer();
        return;
      }
      emit("error", err);
    });
    peer.on("disconnected", () => { if (peer) scheduleReconnect(); });
    peer.on("close", () => { emit("fatal", { type: "socket-closed", message: "Lost connection to signalling server." }); destroyPeer(); });
  }

  // Follower: dial the new host id for the current round, retrying until the round ends.
  function followNewHost(gen) {
    const targetId = hostIdFor(roomCode, gen);
    const dial = () => {
      if (!migrating || isHost || !peer || peer.destroyed) return;
      if (connections.has(targetId)) return; // already connected
      try {
        const conn = peer.connect(targetId, { reliable: true, serialization: "json", metadata: { role: "guest", migrate: true } });
        setupConnection(conn);
      } catch (_) { /* will retry */ }
    };
    dial();
    migrationTimer = setInterval(dial, MIGRATION_RETRY_MS);
  }

  // Begin (or advance) a migration round. Deterministic across all peers:
  // round k → successor at index k of the surviving candidates becomes host at
  // generation (baseGen + 1 + k). Everyone targets the same derived id.
  let _migrationBaseGen = 0;
  let _migrationCandidates = [];
  function beginMigration() {
    if (isHost) return;
    const deadHostId = currentHostId();

    if (!migrating) {
      // First entry: snapshot the candidate order (everyone but the dead host).
      migrating = true;
      migrationRound = 0;
      _migrationBaseGen = hostGen;
      _migrationCandidates = succession.filter(id => id && id !== deadHostId);
      emit("migrating", { candidates: _migrationCandidates.slice() });
    } else {
      // Previous round's designated host failed — advance.
      migrationRound++;
    }

    if (migrationTimer) { clearInterval(migrationTimer); migrationTimer = null; }

    const k = migrationRound;
    if (k >= _migrationCandidates.length) {
      // No surviving successor could take over — give up, surface the failure.
      migrating = false;
      emit("fatal", { type: "migration-failed", message: "Host left and no successor could take over — session ended." });
      destroyPeer();
      return;
    }

    const gen = _migrationBaseGen + 1 + k;
    const designated = _migrationCandidates[k];
    // Track the round's target generation so currentHostId() resolves to the new host.
    hostGen = gen;

    if (designated === selfId) {
      promoteToHost(gen);
      return; // host has no round watchdog — it either claims the id or errors out.
    }

    followNewHost(gen); // sets migrationTimer to the retry interval.

    // Round watchdog: if this round doesn't produce a live host, advance to the next.
    if (_migrationRoundTimer) clearTimeout(_migrationRoundTimer);
    _migrationRoundTimer = setTimeout(() => {
      if (!migrating || isHost) return;
      if (!connections.has(hostIdFor(roomCode, gen))) beginMigration(); // advance to round k+1
    }, MIGRATION_ROUND_MS);
  }
  let _migrationRoundTimer = null;

  // ── Public API ─────────────────────────────────────────────────────────────
  function host(code) {
    isHost   = true;
    roomCode = code;
    hostGen  = 0;
    peer     = new Peer(ROOM_PREFIX + code, peerOptions());

    peer.on("open", id => { selfId = id; rebuildSuccession(); startHeartbeat(); startRosterBroadcast(); emit("ready", code, true); });
    peer.on("connection", conn => setupConnection(conn));
    peer.on("error", err => {
      const isFatal = FATAL_PEER_ERRORS.has(err?.type) || err?.type === "unavailable-id";
      const message = err?.type === "unavailable-id"
        ? "Room code already in use — click Host Game again for a new code."
        : (err?.message || String(err?.type || err));
      emit("error", { ...err, message });
      if (isFatal) { emit("fatal", { ...err, message }); destroyPeer(); }
    });
    peer.on("close", () => {
      emit("fatal", { type: "socket-closed", message: "Lost connection to signalling server." });
      destroyPeer();
    });
    peer.on("disconnected", () => { if (peer) scheduleReconnect(); });
  }

  function join(code) {
    isHost   = false;
    roomCode = code;
    peer     = new Peer(peerOptions());

    peer.on("open", id => {
      selfId = id;
      const conn = peer.connect(ROOM_PREFIX + code, {
        reliable:      true,
        serialization: "json",
        metadata:      { role: "guest" },
      });
      setupConnection(conn, { joinTimeout: true });
      startHeartbeat();
      emit("ready", code, false);
    });

    peer.on("error", err => {
      const type = err?.type;
      const isFatal = FATAL_PEER_ERRORS.has(type);
      let message;
      if (type === "peer-unavailable") {
        message = isLanMode()
          ? "Room not found on local broker — is the host running with the same ?peerhost= address?"
          : "Room not found — check the code and make sure the host has started the game.";
      } else {
        message = err?.message || String(err);
      }
      emit("error", { ...err, message });
      if (isFatal || type === "peer-unavailable") { emit("fatal", { type, message }); destroyPeer(); }
    });

    peer.on("close", () => {
      emit("fatal", { type: "socket-closed", message: "Lost connection to signalling server." });
      destroyPeer();
    });
    peer.on("disconnected", () => { if (peer) scheduleReconnect(); });
  }

  function send(msg) {
    for (const conn of connections.values()) sendRaw(conn, msg);
  }

  function sendTo(id, msg) {
    const conn = connections.get(id);
    sendRaw(conn, msg);
  }

  function close() {
    for (const conn of connections.values()) { try { conn.close(); } catch (_) { /* ignore */ } }
    connections.clear();
    lastSeen.clear();
    msgCounts.clear();
    destroyPeer();
  }

  return {
    host, join, send, sendTo,
    kick: dropConnection,
    on,
    close,
    isLanMode,
    get isHost()         { return isHost; },
    get selfId()         { return selfId; },
    get roomCode()       { return roomCode; },
    get hostId()         { return currentHostId(); },
    get peerIds()        { return [...connections.keys()]; },
    get peerCount()      { return connections.size; },
    get active()         { return peer != null; },
    get isReconnecting() { return _isReconnecting; },
    get isMigrating()    { return migrating; },
    get hostGeneration() { return hostGen; },
    get succession()     { return succession.slice(); },
  };
}
