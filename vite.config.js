import { defineConfig } from 'vite';
import { resolve } from 'node:path';

export default defineConfig({
  server: { host: '127.0.0.1', port: 5183 },
  build: {
    target: 'es2022',
    rollupOptions: {
      input: {
        lab: resolve(__dirname, 'index.html'),
        ghost: resolve(__dirname, 'ghost.html'),
      },
    },
  },
});
