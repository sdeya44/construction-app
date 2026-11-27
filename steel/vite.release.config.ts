import { mergeConfig } from 'vite';
import base from './vite.config';

// The distributable is intentionally one self-contained HTML file. Keep its
// dynamic imports in the single entry so scripts-singlefile can inline it.
export default mergeConfig(base, { build: { rollupOptions: { output: { inlineDynamicImports: true } } } });
