import { test, expect } from '@fixtures/pages.fixtures';
import { env, requireDataCreatingTestsAllowed } from '@config/env';
import { ADMIN_EMAIL, VALID_PASSWORD } from '@utils/testData';
import { uniqueEmail, uniqueUsername } from '@utils/strings';
import {
  canLogin,
  closeFormIfOpen,
  createUser,
  expectBlockedByBrowser,
  LOGIN_TEST_TIMEOUT,
  submitNewUser,
} from '@utils/userFlows';

/**
 * KM-ADMU — /admin/user/index (จัดการผู้ใช้งานระบบ): the list itself, adding,
 * deleting and role/edit rules. Field-by-field validation is in the
 * user-*.spec.ts files next to this one. Runs as admin (default storageState).
 *
 * Every user these tests create is `qa_auto_…` with an "[Auto Test]" name, and
 * the only user a test ever deletes is one it created itself (the page object
 * refuses any other username).
 */

test.describe('SC-ADMU-01 รายการผู้ใช้งาน', () => {
  test('TC-ADMU-01-01 [High] แสดงรายการผู้ใช้งาน', async ({ page, userListPage }) => {
    test.skip(!env.adminUser, 'ADMIN_USER not set in .env');

    await userListPage.open();
    await expect(userListPage.table.locator('thead th')).toHaveText([
      'ลำดับ',
      'ชื่อ-สกุล',
      'อีเมล',
      'สิทธิ์การใช้งาน',
      'สถานะ',
      'จัดการ',
    ]);

    // The sheet quotes "แสดง 1-1 รายการ จาก 1 รายการ" (the list then had one user).
    // The list grows with every run, so check the summary is well-formed and
    // agrees with the rows actually shown on page 1.
    const summary = await page.getByText(/จาก\s*\d+\s*รายการ/).first().innerText();
    const match = /แสดง\s*(\d+)-(\d+)\s*รายการ\s*จาก\s*(\d+)\s*รายการ/.exec(summary);
    expect(match, `summary line "${summary}"`).not.toBeNull();
    const [from, to, total] = match!.slice(1).map(Number);
    expect(from).toBe(1);
    expect(to).toBe(Math.min(total, 20));
    expect(await userListPage.rows.count()).toBe(to);

    // The built-in administrator (it may be on any page).
    const admin = await userListPage.locateUser(env.adminUser);
    await expect(admin).toContainText(ADMIN_EMAIL);
    await expect(admin).toContainText('ผู้ดูแลระบบ');
    await expect(admin).toContainText('ใช้งาน');
  });
});

test.describe('SC-ADMU-02 เพิ่มและแก้ไขผู้ใช้งาน', () => {
  test('TC-ADMU-02-02 [High] เพิ่มผู้ใช้โดยไม่กรอกข้อมูลจำเป็น', async ({ userListPage }) => {
    await userListPage.open();
    const before = await userListPage.totalUsers();

    const modal = await userListPage.openAddUserForm();
    await modal.save();

    // The sheet says "validation on every required field". The form only marks
    // username and name as required (email, roles and password are not
    // `required` in the HTML) — those two are what the browser can enforce.
    await expectBlockedByBrowser(modal, 'usernameInput');
    await expectBlockedByBrowser(modal, 'nameInput');
    test.info().annotations.push({
      type: 'note',
      description: 'Only username and name are HTML-required; email, roles and password are not (see TC-ADMU-06-11, TC-ADMU-07-09, TC-ADMU-08-02).',
    });

    await closeFormIfOpen(modal);
    expect(await userListPage.userCount()).toBe(before);
  });

  test('TC-ADMU-02-03 [High] Username หรืออีเมลซ้ำกับผู้ใช้เดิม', async ({ page, userListPage }) => {
    test.skip(!env.adminUser, 'ADMIN_USER not set in .env');

    await userListPage.open();
    const before = await userListPage.totalUsers();

    // 1) username "admin" (everything else valid)
    let modal = await submitNewUser(userListPage, { username: env.adminUser });
    await page.waitForLoadState('networkidle');
    expect(await userListPage.userCount(), 'duplicate username must not create a user').toBe(before);

    // 2) the admin's email on a new, otherwise unique user
    modal = await submitNewUser(userListPage, { username: uniqueUsername('dupmail'), email: ADMIN_EMAIL });
    await page.waitForLoadState('networkidle');
    expect(await userListPage.userCount(), 'duplicate email must not create a user').toBe(before);
    await closeFormIfOpen(modal).catch(() => undefined);
  });
});

test.describe('SC-ADMU-03 สถานะและการลบผู้ใช้', () => {
  test('TC-ADMU-03-02 [Medium] ลบผู้ใช้ทดสอบ', async ({ browser, userListPage }) => {
    requireDataCreatingTestsAllowed('Seeds a user, then deletes that same user (the first time the delete confirmation is used end-to-end).');
    test.setTimeout(LOGIN_TEST_TIMEOUT);

    const username = uniqueUsername('del');
    await createUser(userListPage, { username });
    // A "cannot log in after deletion" check only means something if this user
    // could log in beforehand. Users created here have no role; if the app
    // refuses those a login, that half of the case can't be proven and is
    // reported as a note instead of a false failure.
    const couldLoginBefore = await canLogin(browser, username, VALID_PASSWORD);

    // Cancel: the user stays.
    const cancelled = await userListPage.openDeleteDialog(username);
    await cancelled.cancel();
    expect(await userListPage.isUserListed(username), 'user still listed after "ยกเลิก"').toBe(true);

    // Confirm: the user disappears and can no longer log in.
    const confirming = await userListPage.openDeleteDialog(username);
    await confirming.confirm();
    await expect
      .poll(() => userListPage.isUserListed(username), { message: 'user removed from the list', timeout: 10_000 })
      .toBe(false);
    if (couldLoginBefore) {
      expect(await canLogin(browser, username, VALID_PASSWORD), 'deleted user cannot log in').toBe(false);
    } else {
      test.info().annotations.push({
        type: 'note',
        description: 'The seeded user (no role) could not log in even before deletion, so "cannot log in after deletion" was not verified.',
      });
    }
  });
});

test.describe('SC-ADMU-08 สิทธิ์การใช้งานและการแก้ไข', () => {
  test('TC-ADMU-08-02 [High] ไม่เลือกสิทธิ์', async ({ page, userListPage }) => {
    requireDataCreatingTestsAllowed('While the known bug exists, saving without a role creates a permanent user.');

    // KNOWN BEHAVIOUR — the roles select is not required and the server accepts
    // a user with no role: every automation-created user in the list shows "—"
    // under "สิทธิ์การใช้งาน". The sheet expects a validation message instead.
    // It matters: read-only GETs on 2026-09-25 showed such a user can log in,
    // reach /admin/dashboard and open /admin/knowledge and /admin/home (200);
    // only /admin/user, /admin/role and /admin/activity-log answer 403.
    test.fail(true, 'Known bug/spec mismatch: a user can be saved without any role (sheet expects a "select a role" validation), and a role-less user can log in and open content admin pages.');

    const username = uniqueUsername('norole');
    const modal = await submitNewUser(userListPage, { username });
    await page.waitForLoadState('networkidle');
    await closeFormIfOpen(modal).catch(() => undefined);

    expect(await userListPage.isUserListed(username), 'a user without a role must not be saved').toBe(false);
  });

  test('TC-ADMU-08-05 [High] แก้ไขอีเมลให้ซ้ำกับผู้ใช้อื่น', async ({ page, userListPage }) => {
    requireDataCreatingTestsAllowed('Seeds two users.');

    const emailA = uniqueEmail('editA');
    const emailB = uniqueEmail('editB');
    const usernameA = uniqueUsername('editA');
    const usernameB = uniqueUsername('editB');
    await createUser(userListPage, { username: usernameA, email: emailA });
    await createUser(userListPage, { username: usernameB, email: emailB });

    // Change B's email to A's. Password fields are filled so a "password
    // required" message can never be mistaken for the duplicate-email check.
    const edit = await userListPage.openEditUserForm(usernameB);
    await edit.emailInput.fill(emailA);
    if (await edit.passwordInput.count()) {
      await edit.passwordInput.fill(VALID_PASSWORD);
      await edit.passwordConfirmationInput.fill(VALID_PASSWORD);
    }
    await edit.save();
    await page.waitForLoadState('networkidle');
    await closeFormIfOpen(edit).catch(() => undefined);

    const rowB = await userListPage.locateUser(usernameB);
    await expect(rowB, 'B keeps its own email').toContainText(emailB);
    await expect(rowB).not.toContainText(emailA);
  });
});
