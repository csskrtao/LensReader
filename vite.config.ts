import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    host: true, // 监听局域网，手机扫码才能访问
    proxy: { '/api': `http://localhost:${process.env.PORT || 8787}` },
  },
});
