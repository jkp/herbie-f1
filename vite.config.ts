import { defineConfig } from 'vite';
// three.js alone is ~700 kB; one bundle is fine for a single-page game.
export default defineConfig({ build: { chunkSizeWarningLimit: 1000 } });
