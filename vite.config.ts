import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vite';

const projectRoot = resolve(dirname(fileURLToPath(import.meta.url)));

export default defineConfig({
  root: resolve(projectRoot, 'examples/navbar'),
  resolve: {
    alias: {
      '@webgpu-progressive-blur': resolve(projectRoot, 'src/index.ts'),
      '@webgpu-progressive-blur/dom': resolve(projectRoot, 'src/dom/index.ts'),
    },
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
