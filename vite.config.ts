// vite.config.ts
import { defineConfig } from 'vitest/config'; // ← 換這個
import vue from '@vitejs/plugin-vue';
import path from 'node:path';

export default defineConfig({
  plugins: [vue()],
  resolve: {
    alias: { '@': path.resolve(process.cwd(), 'src') },
  },
  server: {
    port: 5173,
    strictPort: true,
  },
  // 這裡就可以放 Vitest 設定了
  test: {
    environment: 'happy-dom',
    globals: true,
    include: ['src/**/*.{test,spec}.{ts,tsx}'],
    coverage: { reporter: ['text', 'html'] },
  },
});
