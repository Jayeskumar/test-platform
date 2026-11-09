import { defineConfig } from '@playwright/test';

const PORT = Number(process.env.E2E_PORT ?? 4300);

/**
 * Browser tests against a real, isolated server: a fresh database in e2e/.data,
 * the demo content seeded, and the built web client. Run with `npm run e2e`.
 */
export default defineConfig({
  testDir: '.',
  timeout: 90_000,
  expect: { timeout: 15_000 },
  fullyParallel: false,
  workers: 1,
  reporter: [['list']],
  use: {
    baseURL: `http://localhost:${PORT}`,
    trace: 'off',
    viewport: { width: 1280, height: 900 },
  },
  webServer: {
    command: `node server.mjs`,
    url: `http://localhost:${PORT}/api/health`,
    timeout: 180_000,
    reuseExistingServer: false,
    env: { E2E_PORT: String(PORT) },
  },
});
