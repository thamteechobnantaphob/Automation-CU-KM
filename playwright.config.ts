import { defineConfig, devices } from '@playwright/test';
import fs from 'fs';
import { env } from './src/config/env';
import { ADMIN_AUTH_FILE } from './global-setup';

const hasAdminSession = fs.existsSync(ADMIN_AUTH_FILE);

export default defineConfig({
  testDir: './tests',
  // The app under test is one shared, stateful backend (e.g. the
  // /admin/user/index table every KM-FUSR spec file reads and writes) with
  // no per-test data isolation. Running workers in parallel lets unrelated
  // tests' writes land between another test's "before" and "after" reads,
  // producing failures that have nothing to do with what that test actually
  // checks (confirmed 2026-09-24: a "duplicate username rejected" assertion
  // failed because a *different*, concurrently-running test's row landed in
  // the count). Serial execution trades speed for correctness against this
  // kind of app; revisit if/when tests get their own isolated data.
  fullyParallel: false,
  workers: 1,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  reporter: [
    ['list'],
    ['html', { open: 'never', outputFolder: 'playwright-report' }],
    ['junit', { outputFile: 'test-results/junit.xml' }],
    // Machine-readable per-test status/annotations/attachments — what
    // scripts/archive-evidence.js reads to build the evidence folder.
    ['json', { outputFile: 'test-results/results.json' }],
  ],
  globalSetup: require.resolve('./global-setup'),
  outputDir: 'test-results',

  use: {
    baseURL: env.baseURL,
    trace: 'on-first-retry',
    // EVIDENCE=true (set by `npm run test:evidence`) keeps captures for
    // passing tests too; by default only failures are kept.
    screenshot: env.evidence ? 'on' : 'only-on-failure',
    video: env.evidence ? 'on' : 'retain-on-failure',
    // Every test starts already logged in as admin unless the spec file
    // opts out with `test.use({ storageState: { cookies: [], origins: [] } })`
    // (see tests/auth/*.spec.ts, which must start unauthenticated on purpose).
    ...(hasAdminSession ? { storageState: ADMIN_AUTH_FILE } : {}),
  },

  projects: [
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'] },
    },
  ],
});
