/** Vite: the dev server (with its /api proxy) and the production build. */
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'

export default defineConfig({
  plugins: [react(), tailwindcss()],
  server: {
    port: 5173,
    strictPort: true,
    // Edits made on Windows don't reliably notify a watcher inside the
    // container, so Vite would serve stale files. Polling avoids that.
    watch: {
      usePolling: true,
      interval: 300,
    },
    // Forwards /api to the backend, as nginx does in production, so the
    // browser only ever talks to the page's own address.
    proxy: {
      '/api': {
        target: process.env.VITE_PROXY_TARGET || 'http://localhost:8000',
        changeOrigin: true,
      },
    },
  },
})