import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vite';

const projectRoot = resolve(dirname(fileURLToPath(import.meta.url)));

export default defineConfig({
  root: resolve(projectRoot, 'tests/gpu'),
  server: {
    host: '127.0.0.1',
    port: 4174,
  },
});
