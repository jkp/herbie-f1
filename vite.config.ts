import { defineConfig } from 'vite';
// Relative base so the same build works on GitHub Pages (/herbie-f1/) and the tailnet (/).
// three.js alone is ~700 kB; one bundle is fine for a single-page game.
export default defineConfig({ base: './', build: { chunkSizeWarningLimit: 1000 } });
