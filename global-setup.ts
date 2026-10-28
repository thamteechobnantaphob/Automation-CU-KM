import { chromium, FullConfig } from '@playwright/test';
import fs from 'fs';
import path from 'path';
import { env } from './src/config/env';
import { LoginPage } from './src/pages/LoginPage';

export const ADMIN_AUTH_FILE = path.join(__dirname, 'playwright/.auth/admin.json');
export const SETUP_STATUS_FILE = path.join(__dirname, 'playwright/.auth/setup-status.json');

type SetupStatus = { state: 'ok' | 'skipped' | 'failed'; reason: string; at: string };

/** Read by scripts/archive-evidence.js to explain "blocked by failed login". */
function writeSetupStatus(state: SetupStatus['state'], reason: string): void {
  const status: SetupStatus = { state, reason, at: new Date().toISOString() };
  fs.mkdirSync(path.dirname(SETUP_STATUS_FILE), { recursive: true });
  fs.writeFileSync(SETUP_STATUS_FILE, JSON.stringify(status, null, 2), 'utf-8');
}

/**
 * Logs in once as admin and persists the session (storageState) so every
 * authenticated spec can reuse it instead of logging in per test.
 * Runs before the whole suite (see `globalSetup` in playwright.config.ts).
 *
 * If credentials are missing we skip instead of throwing, so specs that
 * don't need a session (e.g. tests/auth/login.spec.ts, which starts
 * unauthenticated on purpose) can still run out of the box.
 */
export default async function globalSetup(_config: FullConfig): Promise<void> {
  if (!env.adminUser || !env.adminPass) {
    const reason = 'ADMIN_USER / ADMIN_PASS not set in .env';
    console.warn(
      `[global-setup] ${reason} — skipping admin login.\n` +
        '  Authenticated specs (e.g. admin/user-management) will fail until you fill in .env.',
    );
    writeSetupStatus('skipped', reason);
    return;
  }

  fs.mkdirSync(path.dirname(ADMIN_AUTH_FILE), { recursive: true });

  const browser = await chromium.launch();
  const page = await browser.newPage();
  try {
    const loginPage = new LoginPage(page);
    await loginPage.open();
    await loginPage.login(env.adminUser, env.adminPass);
    await page.waitForURL('**/admin/dashboard/index', { timeout: 15_000 });
    await page.context().storageState({ path: ADMIN_AUTH_FILE });
    writeSetupStatus('ok', 'Admin login succeeded');
  } catch (error) {
    const reason = (error as Error).message;
    console.warn(
      `[global-setup] Admin login failed against ${env.baseURL} — authenticated specs will fail.\n` +
        `  Reason: ${reason}`,
    );
    writeSetupStatus('failed', reason);
  } finally {
    await browser.close();
  }
}
