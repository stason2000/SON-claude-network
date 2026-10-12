import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

const apiPort = process.env.PORT ?? '4100';

export default defineConfig({
  plugins: [react()],
  build: { outDir: 'dist/web', emptyOutDir: true },
  server: {
    host: '127.0.0.1',
    port: 5173,
    // changeOrigin:false → 브라우저가 보낸 Host(localhost:5173)를 그대로 전달해야
    // 서버의 Origin 검사(CSRF 방어)가 개발 모드에서도 정상 요청을 통과시킵니다.
    proxy: { '/api': { target: `http://127.0.0.1:${apiPort}`, changeOrigin: false } },
  },
});
