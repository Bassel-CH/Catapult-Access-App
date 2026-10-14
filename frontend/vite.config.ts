import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react(), tailwindcss()],
  server: {
    port: 5173,
    strictPort: true,
    // Windows→container filesystem writes don't reliably raise inotify events
    // across the /mnt/c bind mount, so Vite's watcher silently misses edits and
    // serves stale modules. Polling checks the files on a timer instead.
    watch: {
      usePolling: true,
      interval: 300,
    },
    // ── Phase C: wired to the real backend ────────────────────────────────
    // The browser calls same-origin "/api/..." and Vite forwards to FastAPI,
    // so the backend's CORS list (:3000/:3001, NOT :5173) never comes into
    // play in dev — no preflight, no CORS config to keep in sync.
    // Requires VITE_USE_MOCKS=false and an EMPTY VITE_API_BASE_URL (see
    // .env.local); a non-empty base URL bypasses this proxy and would need
    // "http://localhost:5173" added to CORS_ORIGINS in backend/app/config.py.
    proxy: {
      '/api': {
        target: process.env.VITE_PROXY_TARGET || 'http://localhost:8000',
        changeOrigin: true,
      },
    },
  },
})