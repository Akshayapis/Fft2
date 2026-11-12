import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

const backend = process.env.VITE_API_PROXY || 'http://127.0.0.1:4000';

export default defineConfig({
  plugins: [react()],
  server: {
    host: '0.0.0.0',
    port: Number(process.env.PORT) || 5173,
    strictPort: false,
    // The preview environment proxies HTTPS traffic to this dev server, so the
    // app is served under a public host name. Never allowlist a single host.
    allowedHosts: true,
    proxy: {
      '/api': { target: backend, changeOrigin: true },
    },
  },
  preview: {
    host: '0.0.0.0',
    port: Number(process.env.PORT) || 5173,
    allowedHosts: true,
    proxy: {
      '/api': { target: backend, changeOrigin: true },
    },
  },
  build: { outDir: 'dist', sourcemap: false },
});
