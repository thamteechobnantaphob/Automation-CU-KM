import { APIRequestContext } from '@playwright/test';
import { test, expect } from '@fixtures/pages.fixtures';
import { env, requireDataCreatingTestsAllowed } from '@config/env';
import { AUTO_ROLE_DESCRIPTION, autoRoleLabel, createRole } from '@utils/roleFlows';
import { loginAs, urlOf } from '@utils/lowPrivilege';
import { uniqueUsername } from '@utils/strings';
import { VALID_PASSWORD } from '@utils/testData';
import { createUser } from '@utils/userFlows';

/**
 * KM-SEC / SC-SEC-03 — TC-SEC-03-03: every state-changing action must refuse a
 * request that carries the session cookie but no CSRF token (what a form posted
 * from another site amounts to; the token is the only thing the server can check).
 *
 * ENDPOINTS COVERED (registry below): create / edit / delete of a role and of a user
 * (edit also carries the status change), and logout. When a module is automated,
 * add its create/edit/delete/status endpoints to `ATTEMPTS`.
 *
 * Creates one role and one user of its own (flagged, cleaned by
 * `npm run cleanup:data`) to aim the edit/delete requests at. If an endpoint
 * turns out to be unprotected, the damage is limited to those test records.
 */

const REASON = 'Creates a role and a user of its own to aim the requests at (cleanup: `npm run cleanup:data`).';
const REFUSED = [403, 419];

test.describe('SC-SEC-03 CSRF', () => {
  test.beforeEach(() => requireDataCreatingTestsAllowed(REASON));

  test('TC-SEC-03-03 [High] CSRF ทุก action ที่เปลี่ยนข้อมูล', async ({ browser, page, request, roleListPage, roleFormPage, userListPage }) => {
    test.setTimeout(240_000);
    const problems: string[] = [];
    const seen: string[] = [];

    // Records to aim at.
    const roleLabel = autoRoleLabel('03-03');
    await createRole(page, roleListPage, roleFormPage, { label: roleLabel, description: AUTO_ROLE_DESCRIPTION });
    const roleUpdate = await (await roleListPage.openEditForm(roleLabel)).action();
    await roleListPage.open();
    const roleRemove = await roleListPage.deleteUrl(roleLabel);

    const username = uniqueUsername('csrf');
    await createUser(userListPage, { username });
    const { update: userUpdate, remove: userRemove } = await userListPage.actionUrls(username);
    const userRow = await userListPage.locateUser(username);
    const userNameBefore = await userRow.locator('button.js-edit-user').getAttribute('data-name');
    const forgedUsername = uniqueUsername('csrfnew');
    const forgedRole = autoRoleLabel('03-03n');

    // The attempts: a POST with the admin's cookies and NO _token. `_method` is what the app's own forms send for PUT/DELETE.
    const attempts: Array<{ name: string; url: string; form: Record<string, string> }> = [
      { name: 'create role', url: urlOf('/admin/role'), form: { label: forgedRole, description: AUTO_ROLE_DESCRIPTION, 'module_permissions[home]': 'view' } },
      { name: 'edit role', url: roleUpdate, form: { _method: 'PUT', label: `${roleLabel} CHANGED`, description: 'CHANGED', 'module_permissions[home]': 'full' } },
      { name: 'delete role', url: roleRemove, form: { _method: 'DELETE' } },
      {
        name: 'create user',
        url: urlOf('/admin/user'),
        form: { username: forgedUsername, name: '[Auto Test] CSRF forged user', password: VALID_PASSWORD, password_confirmation: VALID_PASSWORD, is_ldap: '0' },
      },
      { name: 'edit user (also changes status)', url: userUpdate, form: { _method: 'PUT', username, name: '[Auto Test] CSRF CHANGED', is_active: '0', is_ldap: '0' } },
      { name: 'delete user', url: userRemove, form: { _method: 'DELETE' } },
    ];
    for (const attempt of attempts) {
      const response = await request.post(attempt.url, { form: attempt.form, maxRedirects: 0 });
      seen.push(`${attempt.name} → ${response.status()}`);
      if (!REFUSED.includes(response.status())) problems.push(`${attempt.name} without a token answered HTTP ${response.status()} (expected 403/419)`);
    }

    // Logout, in a throwaway admin session so a successful forged logout cannot hurt the shared one.
    const { context, page: throwaway } = await loginAs(browser, env.adminUser, env.adminPass);
    try {
      const logout = await throwaway.request.post(urlOf('/admin/logout'), { form: {}, maxRedirects: 0 });
      seen.push(`logout → ${logout.status()}`);
      if (!REFUSED.includes(logout.status())) problems.push(`logout without a token answered HTTP ${logout.status()} (expected 403/419)`);
      const after = await throwaway.request.get(urlOf('/admin/dashboard/index'), { maxRedirects: 0 });
      if (after.status() !== 200) problems.push('a logout without a token ended the session');
    } finally {
      await context.close();
    }

    // Login is not in the sheet's list; recorded for information only.
    seen.push(`(info) login without a token → ${await loginWithoutToken(browser)}`);

    // Nothing may have changed, whatever the statuses said.
    await roleListPage.open();
    const roles = await roleListPage.readRoles();
    if (roles.some((role) => role.name === forgedRole)) problems.push('a role was created without a token');
    const own = roles.find((role) => role.name === roleLabel);
    if (!own) problems.push('the test role was edited or deleted without a token (it is gone or renamed)');
    else if (own.description !== AUTO_ROLE_DESCRIPTION) problems.push('the test role was edited without a token');
    if (await userListPage.isUserListed(forgedUsername)) problems.push('a user was created without a token');
    if (!(await userListPage.isUserListed(username))) problems.push('the test user was deleted without a token');
    else {
      const row = await userListPage.locateUser(username);
      const edit = row.locator('button.js-edit-user');
      if ((await edit.getAttribute('data-name')) !== userNameBefore) problems.push('the test user was edited without a token');
      if ((await edit.getAttribute('data-status')) !== 'active') problems.push('the test user\'s status was changed without a token');
    }

    test.info().annotations.push({ type: 'note', description: seen.join(' | ') });
    expect(problems, 'every state-changing request without a CSRF token must be refused and change nothing').toEqual([]);
  });
});

/** POSTs the login form with bad credentials and no token, in a fresh anonymous session; returns the status. */
async function loginWithoutToken(browser: import('@playwright/test').Browser): Promise<string> {
  const context = await browser.newContext({ storageState: { cookies: [], origins: [] } });
  try {
    const page = await context.newPage();
    await page.goto(urlOf('/frontend/account/index'));
    const form = await page.locator('form').first().evaluate((el: HTMLFormElement) => ({
      action: el.action,
      user: el.querySelector<HTMLInputElement>('input[type="text"], input[placeholder="Username"]')?.name ?? 'username',
      pass: el.querySelector<HTMLInputElement>('input[type="password"]')?.name ?? 'password',
    }));
    const request: APIRequestContext = context.request;
    const response = await request.post(form.action, { form: { [form.user]: 'qa_auto_nobody', [form.pass]: 'x' }, maxRedirects: 0 });
    return String(response.status());
  } catch (error) {
    return `could not be tried (${(error as Error).message.split('\n')[0]})`;
  } finally {
    await context.close();
  }
}
