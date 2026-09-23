import { defineConfig, type Plugin } from 'vite';
import { cpSync, existsSync, statSync, createReadStream } from 'node:fs';
import { resolve, join } from 'node:path';

const projectRoot = process.cwd();
const srcRoot = resolve(projectRoot, 'src');

// The game keeps `environment.js`, `exterior_map.js`, and `modules/sjm.js` as
// classic global scripts (not ES imports) and `assets/` as runtime URL strings,
// so they live outside Vite's module graph even though the first three now sit
// inside `src/`. `assets/` itself stays a sibling of `src/` (kept out of the
// module graph, and out of the source tree, on purpose — it's ~440MB of
// FBX/GLB/audio, not code). Vite's dev server only auto-serves files under its
// configured `root` (src/), so assets/ needs an explicit dev-time middleware;
// `vite build` only bundles the HTML's module graph, so all four need an
// explicit copy into dist on build.
function serveSiblingAssetsInDev(): Plugin {
  const assetsDir = resolve(projectRoot, 'assets');
  return {
    name: 'serve-sibling-assets-dev',
    apply: 'serve',
    configureServer(server) {
      server.middlewares.use((req, res, next) => {
        if (!req.url || !req.url.startsWith('/assets/')) return next();
        const rel = decodeURIComponent(req.url.slice('/assets/'.length).split('?')[0]);
        const filePath = join(assetsDir, rel);
        if (!filePath.startsWith(assetsDir) || !existsSync(filePath) || !statSync(filePath).isFile()) {
          return next();
        }
        createReadStream(filePath).pipe(res);
      });
    },
  };
}

function copySiblingAssetsOnBuild(): Plugin {
  const assetsDir = resolve(projectRoot, 'assets');
  const buildCopyEntries = ['environment.js', 'exterior_map.js', 'modules/sjm.js'];
  return {
    name: 'copy-sibling-assets-build',
    apply: 'build',
    closeBundle() {
      const out = resolve(projectRoot, 'dist');
      for (const entry of buildCopyEntries) {
        const from = resolve(srcRoot, entry);
        if (existsSync(from)) cpSync(from, resolve(out, entry), { recursive: true });
      }
      if (existsSync(assetsDir)) cpSync(assetsDir, resolve(out, 'assets'), { recursive: true });
    },
  };
}

export default defineConfig({
  root: 'src',
  plugins: [serveSiblingAssetsInDev(), copySiblingAssetsOnBuild()],
  server: { port: 3000 },
  build: {
    outDir: resolve(projectRoot, 'dist'),
    emptyOutDir: true,
    target: 'esnext',
    // Three.js + the ~13.5k-line game file produce large chunks by design;
    // silence the default 500 kB warning rather than chasing artificial splits.
    chunkSizeWarningLimit: 4000,
  },
});
