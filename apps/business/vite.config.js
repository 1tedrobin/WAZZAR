import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  plugins: [react()],
  server: {
    // Not 3000 — that's the backend's default port (see
    // wazzar-backend/backend/.env.example), and this app needs both
    // running at once to actually be "wired up." The other three apps
    // in the suite still default to 3000 too; worth the same fix there.
    port: 3004,
    open: true
  },
  build: {
    outDir: 'dist',
    sourcemap: false
  },
  test: {
    environment: 'jsdom',
    setupFiles: './src/test/setup.js',
    globals: true,
  },
})
