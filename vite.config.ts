import { defineConfig } from 'vitest/config';
import vue from '@vitejs/plugin-vue';
import path from 'node:path';
import pkg from './package.json' assert { type: 'json' };

export default defineConfig({
  plugins: [vue()],
  resolve: { alias: { '@': path.resolve(process.cwd(), 'src') } },
  server: { port: 5173, strictPort: true, hmr: { overlay: true } },
  define: {
    __APP_VERSION__: JSON.stringify(pkg.version),
    __BUILD_TIME__: JSON.stringify(new Date().toISOString())
  },
  build: { sourcemap: true, target: 'es2020' },
  test: {
    environment: 'happy-dom',
    globals: true,
    include: ['src/**/*.{test,spec}.{ts,tsx}'],
    exclude: ['node_modules', 'dist'],
    coverage: { reporter: ['text', 'html', 'lcov'] },
    environmentOptions: { happyDOM: { url: 'http://localhost:5173' } }
  }
});
