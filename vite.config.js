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
        lab: 'lab/index.html',
      },
      // There is deliberately no manualChunks here. It used to force everything
      // into one chunk so the standalone build could inline a single file, but
      // with a second HTML entry Vite can no longer tell which page owns that
      // chunk and injects the demo's bundle into the landing page as well,
      // where it throws on the canvas it cannot find. Nothing needs forcing:
      // the demo is the only page carrying a script, so it is the only JS
      // entry and rollup emits exactly one chunk by itself. If that ever stops
      // being true, scripts/build-standalone.mjs fails loudly rather than
      // inlining half the app.
    },
  },
});
