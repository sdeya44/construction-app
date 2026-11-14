import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// base: './' so the build runs from any sub-path (GitHub Pages, local file server).
export default defineConfig({
  base: './',
  plugins: [react()],
  build: { target: 'es2022', chunkSizeWarningLimit: 1500 },
  test: { environment: 'node', include: ['tests/**/*.test.ts'] },
} as any);
