import { test, expect } from '@fixtures/pages.fixtures';
import { env, requireDataCreatingTestsAllowed } from '@config/env';
import { VALID_PASSWORD } from '@utils/testData';
import { NEEDS_LDAP_ACCOUNT } from '@utils/testData';
import { uniqueUsername } from '@utils/strings';
import {
  canLogin,
  closeFormIfOpen,
  createUser,
  expectBlockedByBrowser,
  expectRejected,
  LOGIN_TEST_TIMEOUT,
  submitNewUser,
} from '@utils/userFlows';

/**
 * KM-ADMU / SC-ADMU-04 (ชื่อ-สกุล) and SC-ADMU-05 (Username), driven from the
 * "เพิ่มผู้ใช้งาน" form on /admin/user/index. These repeat, at page level, the
 * scenarios KM-FUSR already covers at form level (TC-FUSR-03-*, TC-FUSR-02-*),
 * so the two suites should agree — same known bugs, same results.
 *
 * NOT implemented here (sheet uses {MIN}/{MAX} that nobody has defined; the
 * form has no maxlength/minlength attributes, so the limits live server-side):
 * TC-ADMU-04-03/04, TC-ADMU-05-02/03/04/05 — see tests/pending/km-admu.pending.spec.ts.
 */

test.describe('SC-ADMU-04 ชื่อ-สกุล', () => {
  test('TC-ADMU-04-01 [High] ชื่อ-สกุล: ข้อความภาษาไทยปกติ', async ({ userListPage }) => {
    requireDataCreatingTestsAllowed('Submitting the form creates a permanent user record.');

    const username = uniqueUsername('n01');
    const name = 'ระบบจัดการความรู้ทดสอบ';
    await createUser(userListPage, { username, name });

    await expect(await userListPage.locateUser(username)).toContainText(name);
  });

  test('TC-ADMU-04-02 [Medium] ชื่อ-สกุล: ภาษาอังกฤษและตัวเลข', async ({ userListPage }) => {
    requireDataCreatingTestsAllowed('Submitting the form creates a permanent user record.');

    const username = uniqueUsername('n02');
    await createUser(userListPage, { username, name: 'Test Case 001' });

    await expect(await userListPage.locateUser(username)).toContainText('Test Case 001');
  });

  test('TC-ADMU-04-05 [High] ชื่อ-สกุล: แท็ก HTML และสคริปต์', async ({ page, userListPage }) => {
    requireDataCreatingTestsAllowed('The expected result allows the value to be saved (escaped), which creates a record.');

    let dialogFired = false;
    page.on('dialog', async (dialog) => {
      dialogFired = true;
      await dialog.dismiss();
    });

    const username = uniqueUsername('n05');
    await createUser(userListPage, { username, name: '<b>bold</b><script>alert(1)</script>' });

    // Escaped or stripped are both fine — but nothing may be interpreted as markup.
    const row = await userListPage.locateUser(username);
    expect(dialogFired, 'no alert() from the injected script').toBe(false);
    await expect(row.locator('b')).toHaveCount(0);
    await expect(row.locator('script')).toHaveCount(0);
    expect(await page.locator('script:text("alert(1)")').count()).toBe(0);
    // The sheet also asks for the public site; a user's name is not shown there.
  });

  test('TC-ADMU-04-06 [High] ชื่อ-สกุล: อักขระ SQL', async ({ page, userListPage }) => {
    requireDataCreatingTestsAllowed('The expected result allows the value to be saved as plain text.');

    test.skip(!env.adminUser, 'ADMIN_USER not set in .env');

    await userListPage.open();
    const before = await userListPage.totalUsers();

    const username = uniqueUsername('n06');
    const modal = await submitNewUser(userListPage, { username, name: "' OR 1=1; DROP TABLE users;--" });
    await page.waitForLoadState('networkidle');
    await expect(page.locator('body')).not.toContainText(/SQLSTATE|Fatal error|Stack trace/i);
    await closeFormIfOpen(modal).catch(() => undefined);

    // Other data untouched: nobody disappeared, the admin is still there.
    expect(await userListPage.userCount(), 'no user removed').toBeGreaterThanOrEqual(before);
    await userListPage.locateUser(env.adminUser);
  });

  test('TC-ADMU-04-07 [High] ชื่อ-สกุล: เว้นว่าง', async ({ userListPage }) => {
    const username = uniqueUsername('n07');
    await userListPage.open();
    const modal = await userListPage.openAddUserForm();
    await modal.fillWithDefaults({ username, name: '' });
    await modal.save();

    await expectBlockedByBrowser(modal, 'nameInput');
    // The other values the user typed are still there.
    await expect(modal.usernameInput).toHaveValue(username);
  });

  test('TC-ADMU-04-08 [Medium] ชื่อ-สกุล: ช่องว่างล้วน (เว้นวรรค 5 ตัว)', async ({ page, userListPage }) => {
    await expectRejected(page, userListPage, { username: uniqueUsername('n08'), name: '     ' });
  });
});

test.describe('SC-ADMU-05 Username', () => {
  test('TC-ADMU-05-01 [High] Username: ตัวพิมพ์เล็กและตัวเลข', async ({ browser, userListPage }) => {
    test.fixme(true, NEEDS_LDAP_ACCOUNT);
    requireDataCreatingTestsAllowed('Submitting the form creates a permanent user record.');
    test.setTimeout(LOGIN_TEST_TIMEOUT);

    const username = uniqueUsername('u01');
    await createUser(userListPage, { username });

    expect(await canLogin(browser, username, VALID_PASSWORD), 'the new user can log in').toBe(true);
  });

  test('TC-ADMU-05-06 [Medium] Username: มีช่องว่าง', async ({ page, userListPage }) => {
    requireDataCreatingTestsAllowed('While the known bug exists the value is accepted and creates a record.');

    // KNOWN BUG — confirmed 2026-09-25: "qa_auto_…_u06 x" (with a space) was saved.
    // The sheet expects a "characters not allowed" validation.
    test.fail(true, 'Known bug/spec mismatch: a username containing a space is accepted (sheet expects a validation error).');

    await expectRejected(page, userListPage, { username: `${uniqueUsername('u06')} x` });
  });

  test('TC-ADMU-05-07 [Medium] Username: มีอักขระพิเศษ', async ({ page, userListPage }) => {
    requireDataCreatingTestsAllowed('While the known bug exists the value is accepted and creates a record.');

    // KNOWN BUG — confirmed 2026-09-25: "qa_auto_…_u07@#$%" was saved.
    test.fail(true, 'Known bug/spec mismatch: a username with special characters (@#$%) is accepted (sheet expects a validation error).');

    await expectRejected(page, userListPage, { username: `${uniqueUsername('u07')}@#$%` });
  });

  test('TC-ADMU-05-08 [Low] Username: ภาษาไทย', async ({ browser, page, userListPage }) => {
    test.fixme(true, NEEDS_LDAP_ACCOUNT);
    requireDataCreatingTestsAllowed('If the app accepts Thai usernames it creates a record.');
    test.setTimeout(LOGIN_TEST_TIMEOUT);

    // The sheet leaves the policy TBD: either rejected, or accepted and then
    // usable to log in. The one wrong outcome is "saved but cannot log in".
    // (No qa_auto_ prefix is possible here — the value under test IS the
    // username — so it is tagged with the [Auto Test] name/department only.)
    const username = `ทดสอบ${Date.now().toString(36)}`;
    const modal = await submitNewUser(userListPage, { username });
    await page.waitForLoadState('networkidle');
    await closeFormIfOpen(modal).catch(() => undefined);

    if (await userListPage.isUserListed(username)) {
      expect(await canLogin(browser, username, VALID_PASSWORD), 'a saved Thai username can log in').toBe(true);
    }
  });

  test("TC-ADMU-05-09 [High] Username: ซ้ำกับ admin (รวมตัวพิมพ์ใหญ่ 'ADMIN')", async ({ page, userListPage }) => {
    requireDataCreatingTestsAllowed('Seeds a base user (permanent) and, while the known bug exists, the case-variant attempt creates a second one.');

    // KNOWN BUG — same as TC-FUSR-02-12: the duplicate check is case-sensitive.
    // "admin" itself is rejected (checked first, below); the uppercase variant
    // is tried on a fresh unique user rather than the literal "ADMIN", because
    // a leftover "ADMIN" row from earlier runs would make that literal an
    // exact duplicate and prove nothing.
    test.skip(true, "Retired — Dev 2026-10-02: Won't fix (DEF-1): usernames/emails come from the Chula directory (LDAP), so case-only duplicates are not checked.");
    test.fail(true, 'Known regression: username duplicate check is case-sensitive (accepts "ADMIN" alongside "admin").');
    test.skip(!env.adminUser, 'ADMIN_USER not set in .env');

    await expectRejected(page, userListPage, { username: env.adminUser });

    const base = uniqueUsername('u09');
    await createUser(userListPage, { username: base });
    await expectRejected(page, userListPage, { username: base.toUpperCase() });
  });

  test('TC-ADMU-05-10 [High] Username: เว้นว่าง', async ({ userListPage }) => {
    await userListPage.open();
    const modal = await userListPage.openAddUserForm();
    await modal.fillWithDefaults({ username: '' });
    await modal.save();

    await expectBlockedByBrowser(modal, 'usernameInput');
  });
});
