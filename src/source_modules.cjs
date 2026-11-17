// Shared by the multiplayer and test servers: browser ESM from TS sources.
const fs = require('node:fs');
const path = require('node:path');
const esbuild = require('esbuild');
const { serveAsset } = require('./http_assets.cjs');
const cache = new Map();
function sourceModules(root) {
  return (req, res, next) => {
    if (!['GET', 'HEAD'].includes(req.method)) return next();
    let pathname;
    try { pathname = decodeURIComponent(req.url.split('?')[0]); }
    catch { res.writeHead(400); return res.end('Invalid URL'); }
    if (pathname.split(/[\\/]/).some(part => part.startsWith('.'))) return next();
    const requested = path.resolve(root, '.' + pathname);
    if (!requested.startsWith(root + path.sep)) return next();
    const ext = path.extname(requested);
    if (!['', '.js', '.mjs', '.ts'].includes(ext)) return next();
    const candidates = ext === '.ts' ? [requested] : ext === ''
      ? [requested + '.ts', requested + '.js', requested + '.mjs']
      : [requested, requested.slice(0, -ext.length) + '.ts'];
    const file = candidates.find(p => { try { return fs.statSync(p).isFile(); } catch { return false; } });
    if (!file) return next();
    if (path.extname(file) !== '.ts') {
      if (ext !== '') return next();
      return serveAsset(req, res, file, 'text/javascript; charset=utf-8', false);
    }
    try {
      const mtime = fs.statSync(file).mtimeMs;
      let hit = cache.get(file);
      if (!hit || hit.mtime !== mtime) {
        hit = { mtime, code: esbuild.transformSync(fs.readFileSync(file, 'utf8'), {
          loader: 'ts', format: 'esm', target: 'esnext', sourcefile: path.basename(file),
        }).code };
        cache.set(file, hit);
      }
      res.writeHead(200, { 'Content-Type': 'text/javascript; charset=utf-8', 'Cache-Control': 'no-store' });
      res.end(req.method === 'HEAD' ? undefined : hit.code);
    } catch (error) { next(error); }
  };
}
module.exports = { sourceModules };
