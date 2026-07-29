import { defineConfig, devices } from '@playwright/test';
import { fileURLToPath } from 'node:url';
import { dirname } from 'node:path';

const ROOT = dirname(fileURLToPath(import.meta.url));

// End-to-end config. Uses the dev server for fast iteration.
export default defineConfig({
  testDir: './e2e',
  fullyParallel: false,
  workers: 1,
  timeout: 60_000,
  reporter: [['list']],
  use: {
    baseURL: 'http://127.0.0.1:5180',
    viewport: { width: 1600, height: 940 },
    trace: 'off',
    launchOptions: process.env.PW_CHROMIUM_PATH
      ? { executablePath: process.env.PW_CHROMIUM_PATH }
      : {},
  },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
  webServer: {
    command: 'npm run build && npx vite preview --port 5180 --strictPort --host 127.0.0.1',
    url: 'http://127.0.0.1:5180',
    cwd: ROOT,
    reuseExistingServer: true,
    timeout: 180_000,
  },
});
