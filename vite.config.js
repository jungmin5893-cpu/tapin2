import { defineConfig } from 'vite';
import { VitePWA } from 'vite-plugin-pwa';
import { resolve } from 'path';

export default defineConfig({
  root: '.',
  publicDir: 'public',
  base: '/',
  build: {
    outDir: 'dist',
    rollupOptions: {
      input: {
        main: resolve(__dirname, 'index.html'),
        login: resolve(__dirname, 'login.html'),
        owner: resolve(__dirname, 'dashboard.html'),
        employee: resolve(__dirname, 'employee.html'),
        terms: resolve(__dirname, 'terms.html'),
        privacy: resolve(__dirname, 'privacy.html'),
      },
    },
  },
  server: {
    port: 5173,
    strictPort: false,
  },
  plugins: [
    VitePWA({
      strategies: 'injectManifest',
      srcDir: 'src',
      filename: 'sw.js',
      registerType: 'autoUpdate',
      includeAssets: ['icons/*.png'],
      manifest: {
        name: 'SCAN&GO — 스마트 근태관리',
        short_name: 'SCAN&GO',
        description: 'QR 출퇴근, 시프트 관리, 자동 급여계산',
        theme_color: '#00c9a7',
        background_color: '#0f1b2d',
        display: 'standalone',
        orientation: 'portrait',
        scope: '/',
        start_url: '/employee.html',
        icons: [
          { src: '/icons/icon-192.png', sizes: '192x192', type: 'image/png' },
          { src: '/icons/icon-512.png', sizes: '512x512', type: 'image/png' },
          { src: '/icons/icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
        ],
      },
      injectManifest: {
        globPatterns: ['**/*.{js,css,html,png,svg,ico}'],
      },
    }),
  ],
});
