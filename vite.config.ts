import { defineConfig } from 'vite'

// Tauri expects a fixed port and must not have its output cleared by Vite.
export default defineConfig({
  clearScreen: false,
  server: { port: 1420, strictPort: true },
  envPrefix: ['VITE_', 'TAURI_ENV_'],
  build: {
    target: 'safari15',
    sourcemap: false,
    // Everything is loaded from disk, so one bundle is fine.
    chunkSizeWarningLimit: 2048,
  },
})
