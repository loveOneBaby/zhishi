import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

const isExtensionBuild = process.env.BUILD_TARGET === 'extension';

// 开发时把 /api 代理到后端服务（默认 5173）
export default defineConfig({
  base: isExtensionBuild ? './' : '/',
  plugins: [react()],
  server: {
    port: 3000,
    proxy: {
      '/api': {
        target: process.env.API_TARGET || 'http://localhost:5173',
        changeOrigin: true,
      },
    },
  },
  build: {
    outDir: 'dist',
  },
});
