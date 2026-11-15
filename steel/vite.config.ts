import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// base: './' so the build runs from any sub-path (GitHub Pages, local file server).
export default defineConfig({
  base: './',
  plugins: [react()],
  // גופנים מוטמעים כ-data URI כדי שהקובץ היחיד יעבוד ללא קבצים נלווים
  build: { target: 'es2022', chunkSizeWarningLimit: 1500, assetsInlineLimit: (f: string) => (f.endsWith('.woff2') ? true : undefined) },
  test: { environment: 'node', include: ['tests/**/*.test.ts'] },
} as any);
