import { defineConfig } from 'vite';

export default defineConfig({
  server: { host: '127.0.0.1', port: 5183 },
  build: {
    target: 'es2022',
    rollupOptions: {
      // The prop turntable at preview.html is a development tool. Naming the
      // entry explicitly keeps it, and the props it pulls in, out of the
      // shipped bundle.
      input: { main: 'index.html' },
      // One chunk, so the standalone build can inline the whole thing into a
      // single self-contained HTML file.
      output: { manualChunks: () => 'app' },
    },
  },
});
