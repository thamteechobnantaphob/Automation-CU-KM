import { Browser, expect, Page } from '@playwright/test';
import { AdminUserFormModal, UserFormValues } from '@pages/admin/AdminUserFormModal';
import { AdminUserListPage } from '@pages/admin/AdminUserListPage';
import { LoginPage } from '@pages/LoginPage';

/**
 * Shared steps for the user-management specs (KM-ADMU). Every value passed in
 * must already carry the automation markers: a `qa_auto_` username (see
 * uniqueUsername()) and — unless it is the field under test — the
 * "[Auto Test]" name/department that fillWithDefaults() applies.
 */

/** Opens the add form, fills it (defaults for everything not given) and presses "บันทึก". */
export async function submitNewUser(
  userListPage: AdminUserListPage,
  values: UserFormValues,
): Promise<AdminUserFormModal> {
  await userListPage.open();
  const modal = await userListPage.openAddUserForm();
  await modal.fillWithDefaults(values);
  await modal.save();
  return modal;
}

/** Creates a user and waits until it shows up in the list. */
export async function createUser(userListPage: AdminUserListPage, values: UserFormValues): Promise<void> {
  const modal = await submitNewUser(userListPage, values);
  await modal.waitForClosed();
  await userListPage.expectListed(values.username as string);
}

/** Creates a user that holds the given role(s) (picked in the "สิทธิ์การใช้งาน" dropdown) and waits until it is listed. */
export async function createUserWithRoles(
  userListPage: AdminUserListPage,
  values: UserFormValues,
  ...roleLabels: string[]
): Promise<void> {
  await userListPage.open();
  const modal = await userListPage.openAddUserForm();
  await modal.fillWithDefaults(values);
  await modal.selectRoles(...roleLabels);
  await modal.save();
  await modal.waitForClosed();
  await userListPage.expectListed(values.username as string);
}

/** Closes the form if a rejected save left it open, so the next step starts clean. */
export async function closeFormIfOpen(modal: AdminUserFormModal): Promise<void> {
  if (await modal.root.isVisible()) {
    await modal.cancel();
    await modal.waitForClosed();
  }
}

/**
 * The browser (HTML5 validation) must have blocked the submit: the form is
 * still open and the field reports a validation message.
 */
export async function expectBlockedByBrowser(modal: AdminUserFormModal, field: 'usernameInput' | 'nameInput' | 'emailInput'): Promise<void> {
  await expect(modal.root).toBeVisible();
  const message = await modal[field].evaluate((el: HTMLInputElement) => el.validationMessage);
  expect(message, `browser validation message on ${field}`).not.toBe('');
}

/** Submits the form as it is and asserts the user count did not change (nothing was saved). */
export async function expectRejected(
  page: Page,
  userListPage: AdminUserListPage,
  values: UserFormValues,
): Promise<void> {
  await userListPage.open();
  const before = await userListPage.totalUsers();
  const modal = await userListPage.openAddUserForm();
  await modal.fillWithDefaults(values);
  await modal.save();
  await page.waitForLoadState('networkidle');
  // userCount() reloads the page, which also discards a form left open by the rejection.
  expect(await userListPage.userCount(), 'no user should have been created').toBe(before);
}

/**
 * Tries to sign in as `username` in a brand-new anonymous browser context (the
 * admin session the test runs in is left untouched). True when the login page
 * was left, false when the app answered "ชื่อผู้ใช้งานหรือรหัสผ่านไม่ถูกต้อง".
 *
 * A successful login takes ~8 s on Dev, a rejected one ~4 s, so it waits for
 * whichever outcome shows up first instead of guessing a fixed timeout — tests
 * that call this need `test.setTimeout(LOGIN_TEST_TIMEOUT)`, well above the
 * default 30 s.
 */
export async function canLogin(browser: Browser, username: string, password: string): Promise<boolean> {
  // Explicitly anonymous: browser.newContext() inherits the config's admin
  // storageState, so without this the login page just redirects to the admin
  // dashboard and the username box never appears (the test hangs).
  const context = await browser.newContext({ storageState: { cookies: [], origins: [] } });
  try {
    const page = await context.newPage();
    const loginPage = new LoginPage(page);
    await loginPage.open();
    await loginPage.login(username, password);
    const outcome = await Promise.race([
      page
        .waitForURL((url) => !url.pathname.includes('/frontend/account/index'), { timeout: 45_000 })
        .then(() => 'in' as const, () => 'none' as const),
      page
        .getByText('ชื่อผู้ใช้งานหรือรหัสผ่านไม่ถูกต้อง')
        .waitFor({ timeout: 45_000 })
        .then(() => 'rejected' as const, () => 'none' as const),
    ]);
    return outcome === 'in';
  } finally {
    await context.close();
  }
}

/** Budget for tests that log in as a created user (each login is slow). */
export const LOGIN_TEST_TIMEOUT = 120_000;
