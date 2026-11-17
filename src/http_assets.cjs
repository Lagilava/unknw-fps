const fs = require('node:fs');
const path = require('node:path');
const { createGzip } = require('node:zlib');

function acceptsGzip(value = '') {
  return String(value).split(',').some(entry => {
    const [encoding, ...options] = entry.trim().toLowerCase().split(';');
    const quality = options.map(option => option.trim()).find(option => option.startsWith('q='));
    return encoding === 'gzip' && (!quality || Number(quality.slice(2)) > 0);
  });
}

// Compress text/models in transit; images, audio and the precompressed animation
// bank are already compressed. Cache validation avoids repeat asset downloads.
function serveAsset(req, res, filePath, contentType, cacheable = true) {
  const stat = fs.statSync(filePath);
  const etag = `W/"${stat.size.toString(16)}-${Math.trunc(stat.mtimeMs).toString(16)}"`;
  res.setHeader('Content-Type', contentType);
  res.setHeader('Cache-Control', cacheable ? 'public, max-age=0, must-revalidate' : 'no-store');
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Vary', 'Accept-Encoding');
  if (cacheable) {
    res.setHeader('ETag', etag);
    if (req.headers['if-none-match'] === etag) { res.writeHead(304); res.end(); return; }
  }
  const compressed = acceptsGzip(req.headers['accept-encoding'])
    && /\.(?:html|js|mjs|css|json|glb|gltf|fbx|svg|txt)$/.test(filePath) && stat.size > 1024;
  if (compressed) res.setHeader('Content-Encoding', 'gzip');
  else res.setHeader('Content-Length', stat.size);
  res.writeHead(200);
  if (req.method === 'HEAD') { res.end(); return; }
  const input = fs.createReadStream(filePath);
  const output = compressed ? input.pipe(createGzip({ level: 4 })) : input;
  input.on('error', () => res.destroy());
  if (compressed) output.on('error', () => res.destroy());
  res.on('close', () => { input.destroy(); if (output !== input) output.destroy(); });
  output.pipe(res);
}
module.exports = { serveAsset, acceptsGzip };
