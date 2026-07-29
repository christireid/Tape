import { defineConfig, devices } from '@playwright/test';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');

// Benchmark / audit / verify config. Runs against a production build (preview)
// for representative numbers. A single CPU-limited container is slower than a
// developer laptop — that caveat is stated wherever the numbers are published.
export default defineConfig({
  testDir: '.',
  testMatch: ['**/*.spec.ts', '**/*.bench.ts'],
  fullyParallel: false,
  workers: 1,
  timeout: 180_000,
  reporter: [['list']],
  use: {
    baseURL: 'http://127.0.0.1:5180',
    viewport: { width: 1600, height: 940 },
    trace: 'off',
  },
  projects: [
    {
      name: 'chromium',
      use: {
        ...devices['Desktop Chrome'],
        launchOptions: process.env.PW_CHROMIUM_PATH
          ? { executablePath: process.env.PW_CHROMIUM_PATH }
          : {},
      },
    },
  ],
  webServer: {
    command: 'npm run build && npx vite preview --port 5180 --strictPort --host 127.0.0.1',
    url: 'http://127.0.0.1:5180',
    // Playwright resolves the command's cwd to this config file's directory
    // (bench/), which would make vite preview serve a nonexistent bench/dist
    // and 404 the readiness poll forever. Anchor it to the repo root.
    cwd: ROOT,
    reuseExistingServer: true,
    timeout: 180_000,
  },
});
