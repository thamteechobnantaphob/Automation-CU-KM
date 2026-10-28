import { Page, Response } from '@playwright/test';
import { test, expect } from '@fixtures/pages.fixtures';
import { env } from '@config/env';
import { LoginPage } from '@pages/LoginPage';
import { loginAs, urlOf } from '@utils/lowPrivilege';

/**
 * KM-AUTH — the rest of SC-AUTH-01, 04 and 05 that needs no data:
 *   04-01 " admin " (spaces around the name)
 *   04-02 "ADMIN" (capitals)                          05-03 GET on the logout URL
 *   05-06 login page while already logged in          05-07 login form without a CSRF token
 *
 * (TC-AUTH-01-03 was retired by QA on 2026-10-01 — see scripts/retired-cases.json.) Nothing is created or changed. Every case that could end a
 * session works in its own browser context, so the shared admin session (storageState) is never logged out.
 */

const ADMIN_NAME = 'ผู้ดูแลระบบ';
const ANONYMOUS = { cookies: [], origins: [] };

test.describe('SC-AUTH-01 / 05 (เริ่มจาก Login อยู่แล้ว)', () => {
  test('TC-AUTH-05-03 [Medium] Logout ผ่านการเปิด URL (GET) ต้องไม่ทำงาน', async ({ browser }) => {
    test.skip(!env.adminUser || !env.adminPass, 'ADMIN_USER/ADMIN_PASS not set in .env');
    test.setTimeout(120_000);

    const { context, page } = await loginAs(browser, env.adminUser, env.adminPass);
    try {
      const tab = await context.newPage();
      const statuses: string[] = [];
      for (const path of ['/admin/logout', '/frontend/account/logout']) {
        const response = await tab.goto(urlOf(path));
        const status = response?.status() ?? 0;
        statuses.push(`GET ${path} → ${status}`);
        expect(status, `GET ${path} must not crash`).toBeLessThan(500);
      }

      // The session must have survived: the dashboard opens in the same context, and the first tab still works.
      await tab.goto(urlOf('/admin/dashboard/index'));
      expect(tab.url(), 'still logged in after GET on the logout URL').toContain('/admin/dashboard/index');
      await expect(tab.getByRole('heading', { name: 'แดชบอร์ด' })).toBeVisible();
      await page.reload();
      await expect(page.getByRole('heading', { name: 'แดชบอร์ด' })).toBeVisible();
      test.info().annotations.push({ type: 'note', description: `${statuses.join(' | ')} | session still alive afterwards` });
    } finally {
      await context.close();
    }
  });

  test('TC-AUTH-05-06 [Low] เปิดหน้า Login ขณะ Login อยู่แล้ว', async ({ page, loginPage, dashboardPage }) => {
    await loginPage.open();
    await page.waitForLoadState('load');

    expect(page.url(), 'sent to the dashboard, not left on the login form').toContain('/admin/dashboard/index');
    await expect(dashboardPage.heading).toBeVisible();
    await expect(loginPage.usernameInput).toHaveCount(0);
  });
});

test.describe('SC-AUTH-04 / 05 (เริ่มจากยังไม่ Login)', () => {
  test.use({ storageState: ANONYMOUS });

  /** Submits the login form and reports what the browser ended up with. Every page of the round trip must be < 500. */
  async function attempt(page: Page, loginPage: LoginPage, username: string, password: string): Promise<{ loggedIn: boolean; message: string }> {
    const serverErrors: string[] = [];
    const onResponse = (response: Response): void => {
      if (response.request().isNavigationRequest() && response.status() >= 500) serverErrors.push(`${response.status()} ${response.url()}`);
    };
    page.on('response', onResponse);
    try {
      await loginPage.open();
      await loginPage.usernameInput.fill(username);
      await loginPage.passwordInput.fill(password);
      await Promise.all([
        page.waitForResponse((r) => r.request().method() === 'POST' && r.url().includes('/frontend/account')),
        loginPage.submitButton.click(),
      ]);
      // Either the dashboard or the login form with its message follows the redirect.
      await Promise.race([
        page.getByRole('heading', { name: 'แดชบอร์ด' }).waitFor({ timeout: 20_000 }),
        loginPage.errorMessage.waitFor({ timeout: 20_000 }),
      ]).catch(() => undefined);
      await page.waitForLoadState('load');
    } finally {
      page.off('response', onResponse);
    }
    expect(serverErrors, `login as ${JSON.stringify(username)} must not produce a server error`).toEqual([]);

    const loggedIn = page.url().includes('/admin/dashboard/index');
    const message = loggedIn ? '' : ((await loginPage.errorMessage.innerText().catch(() => '')) ?? '').trim();
    return { loggedIn, message };
  }

  /** "Same policy either way": logged in as the admin, or refused with exactly the message an unknown user gets. */
  async function expectConsistentOutcome(page: Page, loginPage: LoginPage, username: string): Promise<string> {
    const unknown = await attempt(page, loginPage, 'no_such_user', env.adminPass);
    expect(unknown.loggedIn, 'a user that does not exist must not get in').toBe(false);
    expect(unknown.message, 'the failed login shows a message').not.toBe('');

    const result = await attempt(page, loginPage, username, env.adminPass);
    if (result.loggedIn) {
      await expect(page.getByRole('heading', { name: 'แดชบอร์ด' })).toBeVisible();
      await expect(page.getByText(ADMIN_NAME).first(), 'it is the admin account that was opened').toBeVisible();
      return 'accepted: logged in as the admin';
    }
    expect(result.message, 'the refusal must read exactly like the one for an unknown user (no hint that the name exists)').toBe(unknown.message);
    return `refused with the generic message "${result.message}"`;
  }

  test("TC-AUTH-04-01 [Low] Username มีช่องว่างหน้า-หลัง", async ({ page, loginPage }) => {
    test.skip(!env.adminUser || !env.adminPass, 'ADMIN_USER/ADMIN_PASS not set in .env');
    const outcome = await expectConsistentOutcome(page, loginPage, ` ${env.adminUser} `);
    test.info().annotations.push({ type: 'note', description: `" ${env.adminUser} " → ${outcome}` });
  });

  test("TC-AUTH-04-02 [Low] Username ตัวพิมพ์ใหญ่ ('ADMIN')", async ({ page, loginPage }) => {
    test.skip(!env.adminUser || !env.adminPass, 'ADMIN_USER/ADMIN_PASS not set in .env');
    const outcome = await expectConsistentOutcome(page, loginPage, env.adminUser.toUpperCase());
    test.info().annotations.push({ type: 'note', description: `"${env.adminUser.toUpperCase()}" → ${outcome}` });
  });

  test('TC-AUTH-05-07 [High] ส่งฟอร์ม Login โดยไม่มี CSRF token', async ({ page, context, loginPage }) => {
    test.skip(!env.adminUser || !env.adminPass, 'ADMIN_USER/ADMIN_PASS not set in .env');

    await loginPage.open();
    const form = page.locator('form', { has: loginPage.passwordInput });
    const action = await form.evaluate((element) => (element as HTMLFormElement).action);
    const token = await form.locator('input[name="_token"]').inputValue();
    expect(token, 'the real form carries a CSRF token (otherwise this test proves nothing)').not.toBe('');

    const credentials = { username: env.adminUser, password: env.adminPass };
    const attempts: Array<[string, Record<string, string>]> = [
      ['without _token', credentials],
      ['with an empty _token', { _token: '', ...credentials }],
      ['with a wrong _token', { _token: `${token.slice(0, -4)}xxxx`, ...credentials }],
    ];
    const seen: string[] = [];
    for (const [label, fields] of attempts) {
      const response = await context.request.post(action, { form: fields, maxRedirects: 0 });
      seen.push(`${label} → ${response.status()}`);
      expect([403, 419], `POST ${label} must be refused`).toContain(response.status());
    }

    // None of it may have logged anyone in.
    await page.goto(urlOf('/admin/dashboard/index'));
    expect(page.url(), 'still logged out').toMatch(/account\/index/);
    test.info().annotations.push({ type: 'note', description: seen.join(' | ') });
  });
});
