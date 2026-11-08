import react from '@vitejs/plugin-react';
import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vite';

export default defineConfig({
  plugins: [react()],
  resolve: { alias: { '@core': fileURLToPath(new URL('../core', import.meta.url)) } },
  server: { fs: { allow: ['..'] } },
  build: { target: 'es2022' },
});
