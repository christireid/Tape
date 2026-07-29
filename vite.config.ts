import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// SPA. Not Next.js — there is no SEO surface or server-render benefit for an
// authenticated real-time tool. See ADR 000 / spec §2.
export default defineConfig({
  plugins: [react()],
  server: { port: 5180 },
  preview: { port: 5180 },
  worker: {
    format: 'es',
  },
  build: {
    target: 'es2022',
    sourcemap: true,
    rollupOptions: {
      input: {
        main: 'index.html',
        performance: 'performance.html',
      },
    },
  },
});
