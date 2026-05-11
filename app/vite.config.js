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
    rollupOptions: {
      input: {
        upload: resolve(__dirname, 'src/upload.js'),
        download: resolve(__dirname, 'src/download.js'),
        admin: resolve(__dirname, 'src/admin.js'),
      },
      output: {
        entryFileNames: '[name].js',
        chunkFileNames: 'common.js',
        assetFileNames: '[name].[ext]'
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
