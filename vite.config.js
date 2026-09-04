import { defineConfig } from 'vite';

export default defineConfig({
  server: { host: '127.0.0.1', port: 5183 },
  build: {
    target: 'es2022',
    rollupOptions: {
      // Every page that ships has to be listed here, because naming the
      // entries explicitly is also what keeps the unlisted ones out: the prop
      // turntable at preview.html is a development tool, and leaving it off
      // this list keeps it, and the props it pulls in, out of the bundle.
      input: {
        main: 'index.html',
        ghostly: 'ghostly/index.html',
      },
      // One chunk, so the standalone build can inline the whole thing into a
      // single self-contained HTML file.
      output: { manualChunks: () => 'app' },
    },
  },
});
