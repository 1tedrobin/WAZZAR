import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  plugins: [react()],
  server: {
    // Not 3000 — that's the backend's default port (see
    // wazzar-backend/backend/.env.example), and this app needs both
    // running at once to actually be "wired up." Business app fixed the
    // same collision with 3004; admin console with 5174. This one takes
    // 5175 so the three wired-non-customer apps sit next to each other.
    port: 5175,
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
