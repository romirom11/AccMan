import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import path from 'path'

// https://vitejs.dev/config/
// Tauri: devUrl in src-tauri/tauri.conf.json is http://localhost:5173, so the port must be fixed,
// and the terminal must not be cleared so Rust errors stay visible.
export default defineConfig({
  plugins: [react()],
  clearScreen: false,
  server: {
    port: 5173,
    strictPort: true,
  },
  envPrefix: ['VITE_', 'TAURI_ENV_'],
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './'),
    },
  },
})
