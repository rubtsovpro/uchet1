import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import path from 'node:path';

export default defineConfig({
  plugins: [react()],
  base: '/',
  resolve: {
    alias: {
      '@': path.resolve(__dirname, 'src'),
    },
  },
  publicDir: 'public',
  server: {
    port: 5173,
    proxy: {
      '/api': { target: 'http://127.0.0.1:3101', changeOrigin: true },
      '/logo-uchet1.svg': 'http://127.0.0.1:3101',
      '/logo-rubtsov.svg': 'http://127.0.0.1:3101',
    },
  },
  build: {
    outDir: 'dist',
    emptyOutDir: true,
    assetsDir: 'assets',
    rollupOptions: {
      output: {
        entryFileNames: 'assets/ui-[hash].js',
        chunkFileNames: 'assets/ui-[hash].js',
        assetFileNames: 'assets/ui-[hash][extname]',
      },
    },
  },
});
