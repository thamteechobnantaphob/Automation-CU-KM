import { test, expect } from '@fixtures/pages.fixtures';
import { env } from '@config/env';
import { longString } from '@utils/strings';

/**
 * KM-AUTH / SC-AUTH-01, 02, 04 (subset), 05 (subset) — /frontend/account/index
 *
 * These specs must run from a clean, unauthenticated session, so they opt
 * out of the admin storageState that every other spec gets by default
 * (see playwright.config.ts).
 */
test.use({ storageState: { cookies: [], origins: [] } });

test.describe('SC-AUTH-01 เข้าสู่ระบบสำเร็จ', () => {
  test('TC-AUTH-01-01 [High] Login ด้วยบัญชีผู้ดูแลระบบที่ถูกต้อง', async ({ page, loginPage }) => {
    test.skip(!env.adminUser || !env.adminPass, 'ADMIN_USER/ADMIN_PASS not set in .env');

    await loginPage.open();
    await loginPage.login(env.adminUser, env.adminPass);

    // Explicit timeout here (instead of inheriting the whole test's budget)
    // so a slow server gives a clear "didn't redirect within 20s" error
    // instead of swallowing the whole test in a generic "test timeout".
    await page.waitForURL('**/admin/dashboard/index', { timeout: 20_000 });
    await expect(page.getByRole('heading', { name: 'แดชบอร์ด' })).toBeVisible();
    await expect(page.getByText('ผู้ดูแลระบบ').first()).toBeVisible();

    // Evidence at the moment the expected result is proven (the automatic
    // end-of-test screenshot may show a later state). Shows up in the HTML
    // report and, via `npm run test:evidence`, in
    // evidence/<run>/screenshots/TC-AUTH-01-01__dashboard-after-login.png
    await test.info().attach('dashboard-after-login', {
      body: await page.screenshot(),
      contentType: 'image/png',
    });
  });
});

test.describe('SC-AUTH-02 เข้าสู่ระบบไม่สำเร็จ', () => {
  test('TC-AUTH-02-01 [High] Password ไม่ถูกต้อง', async ({ page, loginPage }) => {
    test.skip(!env.adminUser, 'ADMIN_USER not set in .env');

    await loginPage.open();
    await loginPage.login(env.adminUser, 'Wrong@12345');

    await expect(page).toHaveURL(/account\/index/);
    await expect(loginPage.errorMessage).toBeVisible();
    await expect(loginPage.usernameInput).toHaveValue(env.adminUser);
  });

  test('TC-AUTH-02-02 [High] Username ไม่มีอยู่ในระบบ (ข้อความต้องเหมือนกรณี Password ผิด)', async ({
    page,
    loginPage,
  }) => {
    test.skip(!env.adminUser, 'ADMIN_USER not set in .env — needed to compare error messages');

    await loginPage.open();
    await loginPage.login('no_such_user', 'Wrong@12345');
    await expect(page).toHaveURL(/account\/index/);
    // Explicit timeout: a bare .textContent() has no timeout of its own and
    // would otherwise hang for the whole test budget if this element is slow
    // to appear, instead of failing with a clear "not found" message.
    await loginPage.errorMessage.waitFor({ state: 'visible', timeout: 10_000 });
    const unknownUserMessage = (await loginPage.errorMessage.textContent())?.trim();

    await loginPage.open();
    await loginPage.login(env.adminUser, 'Wrong@12345');
    await expect(page).toHaveURL(/account\/index/);
    await loginPage.errorMessage.waitFor({ state: 'visible', timeout: 10_000 });
    const wrongPasswordMessage = (await loginPage.errorMessage.textContent())?.trim();

    // Prevents user enumeration: both failure reasons must read identically.
    expect(unknownUserMessage).toBe(wrongPasswordMessage);
  });

  test('TC-AUTH-02-03 [Medium] ไม่กรอก Username และ Password', async ({ page, loginPage }) => {
    await loginPage.open();
    await loginPage.submitButton.click();

    // Confirmed against the real screen: the form has no client-side
    // `required` validation (validationMessage stays empty) — it round-trips
    // to the server instead. The one thing the source test case actually
    // requires is "ไม่ส่งข้อมูลเข้าระบบ" (not logged in), so that's what we assert.
    await page.waitForLoadState('networkidle');
    await expect(page).toHaveURL(/account\/index/);
    await expect(loginPage.submitButton).toBeVisible();
  });

  test('TC-AUTH-02-04 [Medium] กรอก Username แต่ไม่กรอก Password', async ({ page, loginPage }) => {
    test.skip(!env.adminUser, 'ADMIN_USER not set in .env');

    await loginPage.open();
    await loginPage.usernameInput.fill(env.adminUser);
    await loginPage.submitButton.click();

    await page.waitForLoadState('networkidle');
    await expect(page).toHaveURL(/account\/index/);
    await expect(loginPage.submitButton).toBeVisible();
  });

  test('TC-AUTH-02-05 [High] SQL Injection ในช่อง Username', async ({ page, loginPage }) => {
    await loginPage.open();
    await loginPage.login("' OR '1'='1' --", 'x');

    await expect(page).toHaveURL(/account\/index/);
    await expect(page.locator('body')).not.toContainText(/SQLSTATE|Stack trace|Fatal error|ORA-\d+/i);
  });
});

test.describe('SC-AUTH-04 ค่าขอบเขตและอักขระพิเศษที่หน้า Login', () => {
  test('TC-AUTH-04-03 [Medium] Username ยาว 1,000 ตัวอักษร: ไม่เกิด Error 500/timeout', async ({
    page,
    loginPage,
  }) => {
    await loginPage.open();
    const [response] = await Promise.all([
      page.waitForResponse((res) => res.request().method() === 'POST'),
      loginPage.login(longString(1000), 'x'),
    ]);
    expect(response.status()).toBeLessThan(500);
  });

  test('TC-AUTH-04-04 [Medium] Password ยาว 10,000 ตัวอักษร: server ตอบสนองในเวลาปกติ', async ({
    page,
    loginPage,
  }) => {
    test.skip(!env.adminUser, 'ADMIN_USER not set in .env');

    await loginPage.open();
    const start = Date.now();
    const [response] = await Promise.all([
      page.waitForResponse((res) => res.request().method() === 'POST'),
      loginPage.login(env.adminUser, longString(10_000)),
    ]);
    expect(response.status()).toBeLessThan(500);
    expect(Date.now() - start).toBeLessThan(10_000);
  });

  test('TC-AUTH-04-05 [High] XSS ในช่อง Username: ไม่มี alert และไม่ inject <script>', async ({
    page,
    loginPage,
  }) => {
    // Scoped to the login page's own reaction (no confirmed locators yet for
    // the activity-log reflection mentioned in the test case) — see
    // tests/pending/km-auth.pending.spec.ts for the cross-module half.
    let dialogFired = false;
    page.on('dialog', async (dialog) => {
      dialogFired = true;
      await dialog.dismiss();
    });

    await loginPage.open();
    await loginPage.login('<script>alert(1)</script>', 'x');

    await expect(page).toHaveURL(/account\/index/);
    expect(dialogFired).toBe(false);
    expect(await page.locator('script:text("alert(1)")').count()).toBe(0);
  });

  test('TC-AUTH-04-06 [Low] Username/Password ภาษาไทยและ Unicode: ไม่เกิด Error 500', async ({
    page,
    loginPage,
  }) => {
    await loginPage.open();
    const [response] = await Promise.all([
      page.waitForResponse((res) => res.request().method() === 'POST'),
      loginPage.login('ผู้ดูแล😀', 'รหัสผ่าน😀'),
    ]);
    expect(response.status()).toBeLessThan(500);
    await expect(page).toHaveURL(/account\/index/);
  });

  test('TC-AUTH-04-07 [Medium] กดปุ่ม Enter เพื่อส่งฟอร์ม', async ({ page, loginPage }) => {
    test.skip(!env.adminUser || !env.adminPass, 'ADMIN_USER/ADMIN_PASS not set in .env');

    await loginPage.open();
    await loginPage.submitWithEnter(env.adminUser, env.adminPass);
    await page.waitForURL('**/admin/dashboard/index');
  });

  test('TC-AUTH-04-08 [High] Password เป็น type=password และไม่ถูกส่งทาง URL', async ({
    page,
    loginPage,
  }) => {
    test.skip(!env.adminUser || !env.adminPass, 'ADMIN_USER/ADMIN_PASS not set in .env');

    await loginPage.open();
    await expect(loginPage.passwordInput).toHaveAttribute('type', 'password');

    const requestUrls: string[] = [];
    page.on('request', (req) => requestUrls.push(req.url()));

    await loginPage.login(env.adminUser, env.adminPass);
    await page.waitForURL('**/admin/dashboard/index');

    for (const url of requestUrls) {
      expect(url).not.toContain(env.adminPass);
    }
    expect(page.url()).not.toContain(env.adminPass);
  });

  test('TC-AUTH-04-09 [Low] ลำดับการกด Tab: Username → Password → จดจำการเข้าสู่ระบบ → เข้าสู่ระบบ', async ({
    page,
    loginPage,
  }) => {
    await loginPage.open();
    await loginPage.usernameInput.focus();
    await expect(loginPage.usernameInput).toBeFocused();

    await page.keyboard.press('Tab');
    await expect(loginPage.passwordInput).toBeFocused();

    // The "จดจำการเข้าสู่ระบบ" checkbox was removed from the login form (seen 2026-10-01; TC-AUTH-01-02 retired by QA),
    // so Password is followed straight by the button. If it ever comes back, it must sit between the two.
    await page.keyboard.press('Tab');
    if (await loginPage.rememberMeCheckbox.count()) {
      await expect(loginPage.rememberMeCheckbox).toBeFocused();
      await page.keyboard.press('Tab');
    }
    await expect(loginPage.submitButton).toBeFocused();
  });
});

test.describe('SC-AUTH-05 ความปลอดภัยของ Session และการ Login (เริ่มจากยังไม่ Login)', () => {
  test('TC-AUTH-05-01 [High] Open Redirect หลัง Login ต้องไม่พาไปเว็บภายนอก', async ({
    page,
    loginPage,
  }) => {
    test.skip(!env.adminUser || !env.adminPass, 'ADMIN_USER/ADMIN_PASS not set in .env');

    await loginPage.goto('/frontend/account/index?redirect=http://evil.example.com');
    await loginPage.login(env.adminUser, env.adminPass);
    await page.waitForLoadState('networkidle');

    expect(page.url()).not.toContain('evil.example.com');
  });

  test('TC-AUTH-05-02 [High] Session ID ต้องเปลี่ยนหลัง Login (ป้องกัน Session Fixation)', async ({
    page,
    loginPage,
  }) => {
    test.skip(!env.adminUser || !env.adminPass, 'ADMIN_USER/ADMIN_PASS not set in .env');

    await loginPage.open();
    const before = (await page.context().cookies()).find((c) => /session/i.test(c.name));

    await loginPage.login(env.adminUser, env.adminPass);
    await page.waitForURL('**/admin/dashboard/index');
    const after = (await page.context().cookies()).find((c) => /session/i.test(c.name));

    expect(after?.value).toBeTruthy();
    expect(after?.value).not.toBe(before?.value);
  });
});
