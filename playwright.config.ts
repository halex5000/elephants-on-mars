import { defineConfig, devices } from '@playwright/test';
import { E2E_PASSCODE } from './tests/e2e/env.js';

const PORT = Number(process.env.E2E_PORT ?? 3100);
// In environments that can't download Playwright's browser, point at an installed Chrome.
const executablePath = process.env.CHROME_PATH || undefined;

export default defineConfig({
  testDir: 'tests/e2e',
  timeout: 60_000,
  fullyParallel: false,
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? [['list'], ['html', { open: 'never' }]] : 'list',
  use: {
    baseURL: `http://127.0.0.1:${PORT}`,
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
    launchOptions: executablePath ? { executablePath } : {},
  },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
  webServer: {
    command: `npm run build && node dist/server/index.js`,
    // 10x clock so the fuel pool fills in seconds; tests set long missions to compensate
    env: { PORT: String(PORT), HOST: '127.0.0.1', GAME_SPEED: '10', HOST_PASSCODE: E2E_PASSCODE },
    url: `http://127.0.0.1:${PORT}/healthz`,
    reuseExistingServer: !process.env.CI,
    timeout: 120_000,
  },
});
