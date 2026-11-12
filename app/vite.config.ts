import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
  server: { fs: { allow: ['..'] } },
  // older phones (owner, 12 Nov 2026): field staff carry cheap phones whose Android System WebView is often never updated.
  // Build for WebView 87 (late 2020) instead of Vite's default 111 (2023); index.html shows an "update" message below that.
  build: { target: ['chrome87', 'safari14', 'firefox78'], cssTarget: ['chrome87', 'safari14', 'firefox78'] },
})
