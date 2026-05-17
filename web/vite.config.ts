import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// SPA do portal. Build → web/dist (servido pelo Fastify em prod).
// Em dev, proxy /api → servidor Fastify (porta 8080).
export default defineConfig({
  plugins: [react()],
  build: {
    outDir: 'dist',
    sourcemap: false,
    target: 'es2022',
  },
  server: {
    port: 5173,
    proxy: {
      '/api': { target: 'http://localhost:8080', changeOrigin: true },
    },
  },
});
