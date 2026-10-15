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
    // The app calls "/api/..." on its own address and Vite forwards those
    // calls to FastAPI, the same job nginx does in prod. The browser never
    // talks to the backend directly, so the backend needs no CORS settings.
    proxy: {
      '/api': {
        target: process.env.VITE_PROXY_TARGET || 'http://localhost:8000',
        changeOrigin: true,
      },
    },
  },
})