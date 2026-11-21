import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  // dist/ 由 scripts/clean-dist.mjs 在构建前清空（vite 自带的清空在 Windows + Node 24 下会崩溃）
  build: { emptyOutDir: false },
  server: {
    port: 5173,
    host: true, // 监听局域网，手机扫码才能访问
    proxy: { '/api': `http://localhost:${process.env.PORT || 8787}` },
  },
});
