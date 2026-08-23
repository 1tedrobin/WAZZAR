import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  plugins: [react()],
  server: {
    // Not 3000 — that's the backend's default port (see
    // wazzar-backend/backend/.env.example), and this app needs both
    // running at once. Admin took 5174, rider took 5175 — this one
    // takes 5173 to sit in the same range.
    port: 5173,
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
