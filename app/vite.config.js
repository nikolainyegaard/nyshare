import { defineConfig } from 'vite'
import vue from '@vitejs/plugin-vue'
import { resolve } from 'path'

export default defineConfig({
  plugins: [vue()],
  define: {
    PSITRANSFER_VERSION: JSON.stringify(process.env.PSITRANSFER_VERSION || 'dev')
  },
  build: {
    outDir: '../public/app',
    emptyOutDir: true,
    // Content-hashed file names for cache busting; the backend resolves the
    // real names from .vite/manifest.json when rendering the pug shells
    manifest: true,
    rollupOptions: {
      input: {
        upload: resolve(__dirname, 'src/upload.js'),
        download: resolve(__dirname, 'src/download.js'),
        admin: resolve(__dirname, 'src/admin.js'),
      },
      output: {
        entryFileNames: '[name]-[hash].js',
        chunkFileNames: '[name]-[hash].js',
        assetFileNames: '[name]-[hash].[ext]'
      }
    }
  },
  server: {
    host: '0.0.0.0',
    proxy: {
      '/': {
        target: 'http://localhost:3000',
        changeOrigin: true
      }
    }
  }
})
