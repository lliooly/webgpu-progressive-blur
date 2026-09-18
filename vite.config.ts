import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vite';

const projectRoot = resolve(dirname(fileURLToPath(import.meta.url)));

export default defineConfig({
  root: resolve(projectRoot, 'examples/navbar'),
  // GitHub Pages serves this project from /webgpu-progressive-blur/.
  // Keep local development at /, while allowing the workflow to override it.
  base: process.env.VITE_BASE_PATH ?? '/',
  resolve: {
    alias: [
      {
        find: '@webgpu-progressive-blur/dom',
        replacement: resolve(projectRoot, 'src/dom/index.ts'),
      },
      {
        find: '@webgpu-progressive-blur',
        replacement: resolve(projectRoot, 'src/index.ts'),
      },
    ],
  },
  server: {
    host: '127.0.0.1',
    port: 4173,
  },
  build: {
    outDir: resolve(projectRoot, 'examples/navbar/dist'),
    emptyOutDir: true,
    sourcemap: true,
  },
});
