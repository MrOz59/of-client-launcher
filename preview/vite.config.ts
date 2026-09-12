import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import path from 'path'

export default defineConfig({
  root: __dirname,
  base: './',
  plugins: [react()],
  build: {
    outDir: path.join(__dirname, 'dist'),
    emptyOutDir: true,
    // One entry per screen the harness can show.
    rollupOptions: {
      input: {
        index: path.join(__dirname, 'index.html'),
        'store-game': path.join(__dirname, 'store-game.html'),
        'fix-inputs': path.join(__dirname, 'fix-inputs.html'),
        'fix-downloads': path.join(__dirname, 'fix-downloads.html')
      }
    }
  }
})
