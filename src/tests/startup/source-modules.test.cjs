const { test } = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { sourceModules } = require('../../source_modules.cjs');
const serve = sourceModules(path.resolve(__dirname, '../..'));
function request(url, method = 'GET') {
  const result = { next: false };
  serve({ url, method, headers: {} }, {
    writeHead(status, headers) { Object.assign(result, { status, headers }); },
    end(body) { result.body = body; },
  }, error => { assert.ifError(error); result.next = true; });
  return result;
}
test('legacy .js and extensionless imports become browser JavaScript', () => {
  for (const url of ['/three_fps_game.js', '/modules/gun_config', '/modules/asset_paths.js', '/modules/gun_config.ts']) {
    const result = request(url);
    assert.equal(result.status, 200, url);
    assert.match(result.headers['Content-Type'], /javascript/);
    assert.match(result.body, /(?:import|export) /);
    assert.doesNotMatch(result.body, /declare global|export type GunType/);
  }
});
test('module HEAD requests have no body', () => {
  const result = request('/modules/gun_config', 'HEAD');
  assert.equal(result.status, 200);
  assert.equal(result.body, undefined);
});
test('invalid URLs and paths outside the source root are not served', () => {
  assert.equal(request('/%ZZ').status, 400);
  assert.equal(request('/../vite.config.ts').next, true);
  assert.equal(request('/.private.ts').next, true);
  assert.equal(request('/modules/missing.js').next, true);
});
