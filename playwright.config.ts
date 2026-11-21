import { defineConfig } from '@playwright/test';
export default defineConfig({
  testDir: 'e2e',
  use: {
    baseURL: 'http://localhost:5199',
    // real GPU: the software renderer is too slow for the full 3D scene
    channel: 'chromium',
    launchOptions: { args: ['--use-angle=metal', '--enable-gpu', '--ignore-gpu-blocklist'] },
  },
  webServer: { command: 'npx vite --port 5199 --strictPort', port: 5199, reuseExistingServer: false },
});
