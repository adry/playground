import { defineConfig } from 'vite';

export default defineConfig({
  server: { host: '127.0.0.1', port: 5183 },
  build: {
    target: 'es2022',
    rollupOptions: {
      // One chunk, so the standalone build can inline the whole thing into a
      // single self-contained HTML file.
      output: { manualChunks: () => 'app' },
    },
  },
});
