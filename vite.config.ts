import { defineConfig, type Plugin } from 'vite';
import { cpSync, existsSync } from 'node:fs';
import { resolve } from 'node:path';

// The game keeps `environment.js`, `exterior_map.js`, and `assets/` at the
// project root (loaded as classic global scripts / runtime URL strings rather
// than ES imports), so they live outside Vite's module graph. In dev the Vite
// server already serves project-root files; for `vite build` we copy them into
// dist verbatim so the produced site is self-contained.
function copyStaticRootFiles(): Plugin {
  const entries = ['environment.js', 'exterior_map.js', 'assets', 'modules/sjm.js'];
  return {
    name: 'copy-static-root-files',
    apply: 'build',
    closeBundle() {
      const root = process.cwd();
      const out = resolve(root, 'dist');
      for (const entry of entries) {
        const from = resolve(root, entry);
        if (existsSync(from)) {
          cpSync(from, resolve(out, entry), { recursive: true });
        }
      }
    },
  };
}

export default defineConfig({
  plugins: [copyStaticRootFiles()],
  server: { port: 3000 },
  build: {
    target: 'esnext',
    // Three.js + the ~13.5k-line game file produce large chunks by design;
    // silence the default 500 kB warning rather than chasing artificial splits.
    chunkSizeWarningLimit: 4000,
  },
});
