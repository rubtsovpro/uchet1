import { defineConfig } from 'vite';
import vue from '@vitejs/plugin-vue';
import { quasar, transformAssetUrls } from '@quasar/vite-plugin';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.dirname(fileURLToPath(import.meta.url));

export default defineConfig({
  plugins: [
    vue({ template: { transformAssetUrls } }),
    quasar(),
  ],
  resolve: {
    alias: { '@': path.join(root, 'src') },
  },
  server: {
    port: 9100,
    proxy: {
      '/api': {
        target: process.env.WMS_API_PROXY || 'http://127.0.0.1:3101',
        changeOrigin: true,
      },
    },
  },
  base: '/app/',
});
