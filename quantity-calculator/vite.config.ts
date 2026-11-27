import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// אפליקציה מקומית בלבד - בנייה לקבצים סטטיים שאפשר לפתוח בדפדפן.
// base יחסי כדי שאפשר יהיה לפתוח את התיקייה dist גם ללא שרת.
export default defineConfig({
  base: './',
  plugins: [react()],
  build: {
    outDir: 'dist',
    chunkSizeWarningLimit: 2000,
  },
});
