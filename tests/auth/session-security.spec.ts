import { test, expect } from '@fixtures/pages.fixtures';
import { env } from '@config/env';
import { PROTECTED_ADMIN_URLS } from '@utils/testData';

/**
 * KM-AUTH / SC-AUTH-03, SC-AUTH-05 (subset) — logout & session integrity.
 *
 * Unlike tests/auth/login.spec.ts, these run WITH the default admin
 * storageState from global-setup.ts (i.e. they start already logged in),
 * except the SC-AUTH-03-03 describe block below, which explicitly opts
 * back out because it must start from an empty session.
 *
 * Tests that LOG OUT (03-01, 03-02, 05-04) log in again with their own fresh
 * session first (`context.clearCookies()` + `loginAndWaitForDashboard`).
 * Logging out destroys the session server-side; if they used the shared
 * storageState session, every later test relying on it — including 03-02 and
 * 05-04 themselves — would land on the login page and time out (found in the
 * first `npm run test:evidence` run, 2026-09-25).
 */

test.describe('SC-AUTH-03 ออกจากระบบและการควบคุม Session', () => {
  test('TC-AUTH-03-01 [High] Logout จากเมนูผู้ใช้', async ({
    page,
    context,
    loginPage,
    dashboardPage,
  }) => {
    test.skip(!env.adminUser || !env.adminPass, 'ADMIN_USER/ADMIN_PASS not set in .env');

    await context.clearCookies();
    await loginPage.loginAndWaitForDashboard(env.adminUser, env.adminPass);
    await dashboardPage.logout();
    await page.waitForLoadState('networkidle');

    expect(page.url()).not.toContain('/admin/dashboard/index');
  });

  test('TC-AUTH-03-02 [High] กดปุ่ม Back หลัง Logout ต้องไม่เห็นหน้า admin', async ({
    page,
    context,
    loginPage,
    dashboardPage,
  }) => {
    test.skip(!env.adminUser || !env.adminPass, 'ADMIN_USER/ADMIN_PASS not set in .env');

    // KNOWN BUG — confirmed manually 2026-09-23: after logout, pressing the
    // browser Back button still shows the cached dashboard (browser bfcache
    // restores the page without a server round-trip). Likely missing
    // `Cache-Control: no-store` on admin pages — same header TC-AUTH-05-09
    // checks for. Keep test.fail() until it's fixed so this reports as an
    // *expected* failure and flips to an "unexpected pass" alert the day it's
    // actually fixed.
    //
    // CAVEAT (2026-09-25): before this test got its own session, it was
    // actually timing out on a dead shared session, so the automated run had
    // never really proven this bug — only the manual check did. Re-verify
    // after this change that the failure is now the final assertion.
    test.fail(true, 'Known regression: back button after logout shows cached admin page (bfcache).');

    await context.clearCookies();
    await loginPage.loginAndWaitForDashboard(env.adminUser, env.adminPass);
    await dashboardPage.logout();
    await page.waitForLoadState('networkidle');

    await page.goBack();
    await expect(dashboardPage.heading).not.toBeVisible();
  });

  test.describe('TC-AUTH-03-03 [High] เข้าหน้า admin โดยไม่ Login (วนทุก URL)', () => {
    test.use({ storageState: { cookies: [], origins: [] } });

    for (const url of PROTECTED_ADMIN_URLS) {
      test(`redirect เมื่อเปิด ${url} แบบไม่ Login`, async ({ page }) => {
        const response = await page.goto(`${env.baseURL}${url}`);
        const status = response?.status() ?? 0;
        const redirectedToLogin = /account\/index/.test(page.url());

        expect(redirectedToLogin || status === 401 || status === 403).toBeTruthy();
      });
    }
  });
});

test.describe('SC-AUTH-05 ความปลอดภัยของ Session และการ Login (เริ่มจาก Login อยู่แล้ว)', () => {
  test('TC-AUTH-05-04 [High] Logout ในแท็บหนึ่ง แท็บอื่นต้องหมด Session', async ({
    page,
    context,
    loginPage,
    dashboardPage,
  }) => {
    test.skip(!env.adminUser || !env.adminPass, 'ADMIN_USER/ADMIN_PASS not set in .env');

    // Own fresh session (see file header) shared by both tabs via `context`.
    await context.clearCookies();
    await loginPage.loginAndWaitForDashboard(env.adminUser, env.adminPass);

    const tabB = await context.newPage();
    await tabB.goto(`${env.baseURL}/admin/dashboard/index`);
    // Tab B must genuinely be logged in before we log out in tab A —
    // otherwise "tab B shows no dashboard" would pass for the wrong reason.
    await expect(tabB.getByRole('heading', { name: 'แดชบอร์ด' })).toBeVisible();

    await page.bringToFront();
    await dashboardPage.logout();
    await page.waitForLoadState('networkidle');

    await tabB.bringToFront();
    await tabB.goto(`${env.baseURL}/admin/dashboard/index`);
    await expect(tabB.getByRole('heading', { name: 'แดชบอร์ด' })).not.toBeVisible();
    await tabB.close();
  });

  test('TC-AUTH-05-09 [Medium] หน้า admin ต้องไม่ถูก cache (Cache-Control: no-store/no-cache)', async ({
    page,
  }) => {
    test.skip(!env.adminUser || !env.adminPass, 'ADMIN_USER/ADMIN_PASS not set in .env');

    const response = await page.goto(`${env.baseURL}/admin/dashboard/index`);
    // Must be the real admin page, not a redirect to login (whose headers
    // would say nothing about admin pages).
    expect(page.url()).toContain('/admin/dashboard/index');
    const cacheControl = response?.headers()['cache-control'] ?? '';
    expect(cacheControl.toLowerCase()).toMatch(/no-store|no-cache/);
  });

  test('TC-AUTH-05-10 [High] Cookie session ปลอม/เสียหาย ต้องพาไปหน้า Login ไม่ใช่ Error 500', async ({
    page,
    context,
  }) => {
    test.skip(!env.adminUser || !env.adminPass, 'ADMIN_USER/ADMIN_PASS not set in .env');

    const sessionCookie = (await context.cookies()).find((c) => /session/i.test(c.name));
    test.skip(!sessionCookie, 'Could not locate a session cookie on this app to tamper with');

    // Sanity check first: the untampered session must actually work, or the
    // redirect-to-login below would prove nothing.
    await page.goto(`${env.baseURL}/admin/dashboard/index`);
    expect(page.url()).toContain('/admin/dashboard/index');

    await context.addCookies([
      { ...sessionCookie!, value: `tampered-${Math.random().toString(36).slice(2)}` },
    ]);
    const response = await page.goto(`${env.baseURL}/admin/dashboard/index`);

    expect(response?.status() ?? 0).toBeLessThan(500);
    expect(page.url()).toMatch(/account\/index/);
  });

  test('TC-AUTH-05-11 [Low] Method ที่ไม่รองรับ (POST/PUT/DELETE) ไปยังหน้า admin', async ({
    request,
  }) => {
    test.skip(!env.adminUser || !env.adminPass, 'ADMIN_USER/ADMIN_PASS not set in .env');

    const url = `${env.baseURL}/admin/dashboard/index`;
    const statuses: Record<string, number> = {};
    for (const method of ['post', 'put', 'delete'] as const) {
      const response = await request[method](url);
      statuses[method.toUpperCase()] = response.status();
    }

    // API-only test (no page => no automatic screenshot/video), so attach
    // the observed status codes as its evidence.
    await test.info().attach('http-status-codes', {
      body: JSON.stringify({ url, statuses }, null, 2),
      contentType: 'application/json',
    });
    for (const status of Object.values(statuses)) expect([404, 405]).toContain(status);
  });
});
