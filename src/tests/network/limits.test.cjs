const { test } = require('node:test');
const assert = require('node:assert/strict');
const { EventEmitter } = require('node:events');
const fs = require('node:fs');
const vm = require('node:vm');
const { transformSync } = require('esbuild');
function setup() {
  let peer;
  class Peer extends EventEmitter {
    constructor() { super(); peer = this; }
    destroy() {}
  }
  const source = fs.readFileSync('src/modules/netcode.ts', 'utf8').replace('import { Peer } from "peerjs";', '');
  const code = transformSync(source, { loader: 'ts', format: 'cjs' }).code;
  const context = { exports: {}, module: { exports: {} }, Peer, performance: { now: () => 100 },
    TextEncoder, URLSearchParams, location: { search: '' }, console,
    setInterval: () => 1, clearInterval() {}, setTimeout: () => 1, clearTimeout() {},
    Math, crypto: require('node:crypto').webcrypto };
  vm.runInNewContext(code, context);
  const net = context.module.exports.createNetwork();
  net.host('ABCDEF');
  peer.emit('open', 'rbfps-ABCDEF');
  const conn = new EventEmitter();
  Object.assign(conn, { peer: 'guest', open: true, sent: [], closed: false,
    send(msg) { this.sent.push(msg); }, close() { this.closed = true; } });
  peer.emit('connection', conn);
  conn.emit('open');
  conn.sent.length = 0;
  return { net, conn };
}
test('heartbeat and roster floods disconnect the peer', () => {
  for (const t of ['__ping', '__pong', '__roster']) {
    const { conn } = setup();
    for (let i = 0; i < 201; i++) conn.emit('data', { t });
    assert.equal(conn.closed, true, t);
  }
});
test('oversized internal messages are rejected before responding', () => {
  const { conn } = setup();
  conn.emit('data', { t: '__ping', payload: 'x'.repeat(32768) });
  assert.equal(conn.sent.length, 0);
});
test('UTF-8 byte limit rejects multibyte payloads; ordinary traffic passes', () => {
  const { net, conn } = setup();
  let received = 0;
  net.on('data', () => received++);
  conn.emit('data', { t: 'state', payload: '界'.repeat(12000) });
  assert.equal(received, 0);
  conn.emit('data', { t: 'state', x: 1 });
  conn.emit('data', { t: '__ping', ts: 42 });
  assert.equal(received, 1);
  assert.equal(conn.sent.at(-1).t, '__pong');
  assert.equal(conn.sent.at(-1).ts, 42);
});
