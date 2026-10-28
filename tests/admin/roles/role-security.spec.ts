import { APIResponse } from '@playwright/test';
import { test, expect } from '@fixtures/pages.fixtures';
import { NEEDS_LDAP_ACCOUNT } from '@utils/testData';
import { requireDataCreatingTestsAllowed } from '@config/env';
import { AUTO_TEST_FLAG, VALID_PASSWORD } from '@utils/testData';
import { exactText, uniqueUsername } from '@utils/strings';
import {
  AUTO_ROLE_DESCRIPTION,
  autoRoleLabel,
  collectDialogs,
  createRole,
  roleStamp,
  submitNewRole,
} from '@utils/roleFlows';
import { createUserWithRoles, LOGIN_TEST_TIMEOUT } from '@utils/userFlows';
import { csrfTokenOf, loginAs, urlOf } from '@utils/lowPrivilege';

/**
 * KM-FROL / SC-FROL-06 — security of the role pages (/admin/role/*).
 *
 * Every case is data-creating (low-privilege users, roles) and is skipped unless
 * the run allows it. What the tests leave behind is flagged ("[Auto Test]" in the
 * role name or description, `qa_auto_` usernames) and removed by
 * `npm run cleanup:data -- --delete` (users first, then roles).
 *
 * Two deliberate differences from the sheet:
 *  - the sheet's edit URL /admin/role/detail/1 does not exist (ids are encrypted
 *    tokens), so the real edit link is read from the list and /1 is tried as well;
 *  - TC-FROL-06-04 attacks a role CREATED BY THE TEST instead of the built-in
 *    "บุคลากรที่ได้รับมอบหมาย": the risk is the same, but if the app is vulnerable
 *    only test data is altered, never a real role. (Agreed with the requester.)
 */

const REASON = 'Seeds users/roles (and, if the app is vulnerable, an unintended role) that only `npm run cleanup:data` can remove.';
const STAFF_ROLE = 'บุคลากรที่ได้รับมอบหมาย';
const ROLE_PAGE_MARKERS = ['module_permissions[', 'name="label"'];

/** A 401/403 — or a redirect/page that is not a role page and carries none of the role form/table markup. */
async function checkNoRoleAccess(
  response: APIResponse,
  requestedUrl: string,
  label: string,
  problems: string[],
  allowNotFound = false,
): Promise<string> {
  const status = response.status();
  const finalPath = new URL(response.url()).pathname;
  const body = status === 401 || status === 403 || status === 404 ? '' : await response.text();
  const leaked = ROLE_PAGE_MARKERS.filter((marker) => body.includes(marker));
  const refused =
    status === 401 ||
    status === 403 ||
    (allowNotFound && status === 404) ||
    (status === 200 && !finalPath.startsWith('/admin/role') && leaked.length === 0);
  const redirected = finalPath !== new URL(requestedUrl).pathname;
  const summary = `${label} → ${status}${redirected ? ` (redirected to ${finalPath})` : ''}`;
  if (!refused) problems.push(`${summary} — expected 403 or a redirect away from the role pages${leaked.length ? `; page contains ${leaked.join(', ')}` : ''}`);
  return summary;
}

test.describe('SC-FROL-06 ความปลอดภัยของหน้าสิทธิ์', () => {
  test.setTimeout(90_000);
  test.beforeEach(() => requireDataCreatingTestsAllowed(REASON));

  test("TC-FROL-06-01 [High] ผู้ใช้ที่ไม่มีสิทธิ์ 'สิทธิ์การใช้งานระบบ' เปิด /admin/role/detail ไม่ได้", async ({
    browser,
    roleListPage,
    userListPage,
  }) => {
    test.fixme(true, NEEDS_LDAP_ACCOUNT);
    test.setTimeout(LOGIN_TEST_TIMEOUT);

    // A real edit link (read as admin) — the sheet's /detail/1 is only tried on top of it.
    await roleListPage.open();
    const editLink = await roleListPage.editLink(STAFF_ROLE);

    const username = uniqueUsername('sec0601');
    await createUserWithRoles(userListPage, { username }, STAFF_ROLE);

    const { context, page } = await loginAs(browser, username, VALID_PASSWORD);
    try {
      const problems: string[] = [];
      const seen: string[] = [];
      // The sheet's numeric /detail/1 is not a real id (ids are encrypted tokens), so the app answers 404 for it
      // even to an admin — a "not found" that shows no role data is an acceptable closed answer there. The three
      // real pages must be refused with 403.
      const targets = [
        { path: '/admin/role/index', label: '/admin/role/index', allowNotFound: false },
        { path: '/admin/role/detail', label: '/admin/role/detail', allowNotFound: false },
        { path: editLink, label: '<edit link of a real role>', allowNotFound: false },
        { path: '/admin/role/detail/1', label: '/admin/role/detail/1', allowNotFound: true },
      ];
      for (const target of targets) {
        const url = urlOf(target.path);
        const response = await page.request.get(url);
        seen.push(await checkNoRoleAccess(response, url, target.label, problems, target.allowNotFound));
      }
      test.info().annotations.push({ type: 'note', description: `As "${STAFF_ROLE}": ${seen.join(' | ')}` });

      // What the person would actually see (kept as evidence; the fixture screenshot is the admin's page).
      await page.goto(urlOf('/admin/role/index'));
      await test.info().attach('low-privilege view of /admin/role/index', { body: await page.screenshot(), contentType: 'image/png' });

      expect(problems, 'the role pages must be closed to a user without the role permission').toEqual([]);
    } finally {
      await context.close();
    }
  });

  test('TC-FROL-06-02 [High] ส่งฟอร์มสิทธิ์โดยไม่มี CSRF token', async ({ page, roleListPage, roleFormPage }) => {
    const before = await roleListPage.roleCount();

    // 1) Create without _token (the request carries the admin cookies but no token, as a forged cross-site post would).
    const forgedLabel = autoRoleLabel('06-02');
    const created = await page.request.post(urlOf('/admin/role'), {
      form: { label: forgedLabel, description: AUTO_ROLE_DESCRIPTION, 'module_permissions[home]': 'view' },
      maxRedirects: 0,
    });
    expect.soft([403, 419], `create without token answered ${created.status()}`).toContain(created.status());

    // 2) Edit a role of our own without _token (the form spoofs PUT with a hidden _method).
    const own = autoRoleLabel('06-02e');
    await createRole(page, roleListPage, roleFormPage, { label: own, description: AUTO_ROLE_DESCRIPTION });
    const action = await (await roleListPage.openEditForm(own)).action();
    const edited = await page.request.post(action, {
      form: { _method: 'PUT', label: `${own} CHANGED`, description: 'CHANGED', 'module_permissions[home]': 'full' },
      maxRedirects: 0,
    });
    expect.soft([403, 419], `edit without token answered ${edited.status()}`).toContain(edited.status());
    test.info().annotations.push({ type: 'note', description: `Without _token: create → HTTP ${created.status()}, edit → HTTP ${edited.status()}.` });

    // Nothing was created or altered, whatever the status said.
    await roleListPage.open();
    const roles = await roleListPage.readRoles();
    expect(roles.some((role) => role.name === forgedLabel), 'no role was created without a token').toBe(false);
    expect(roles.some((role) => role.name.includes('CHANGED') || role.description === 'CHANGED'), 'the edit without a token must not apply').toBe(false);
    expect((await roleListPage.findRole(own))?.description, 'own role is unchanged').toBe(AUTO_ROLE_DESCRIPTION);
    expect(await roleListPage.roleCount(), 'exactly the role we made for the edit attempt was added').toBe(before + 1);
  });

  test('TC-FROL-06-03 [High] ส่งค่าระดับสิทธิ์ที่ไม่มีอยู่จริง (แก้ค่า radio ด้วยสคริปต์)', async ({ page, roleListPage, roleFormPage }) => {
    const label = autoRoleLabel('06-03');
    await roleListPage.open();
    await roleListPage.openAddForm();
    await roleFormPage.fill({ label, description: AUTO_ROLE_DESCRIPTION, levels: { home: 'view' } });

    // Tamper with the page like a user with dev tools: an impossible level for "user", and a module that does not exist.
    await page.evaluate(() => {
      const radio = document.querySelector<HTMLInputElement>('input[name="module_permissions[user]"][value="full"]') as HTMLInputElement;
      radio.value = 'superuser';
      radio.checked = true;
      const extra = document.createElement('input');
      extra.type = 'hidden';
      extra.name = 'module_permissions[abc]';
      extra.value = 'full';
      (radio.closest('form') as HTMLFormElement).appendChild(extra);
    });
    const response = await roleFormPage.save();
    expect(response.status(), 'tampered levels must not cause a server error').toBeLessThan(500);

    await roleListPage.open();
    const row = await roleListPage.findRole(label);
    if (!row) {
      test.info().annotations.push({ type: 'note', description: 'The server rejected the tampered form (nothing saved).' });
      return;
    }

    // Saved: only real levels of real modules may have been kept — "superuser" must not become access.
    const form = await roleListPage.openEditForm(label);
    expect(await form.levelOf('user'), '"superuser" must not be stored or treated as a level').toBe('none');
    expect(await form.levelOf('home')).toBe('view');
    await expect(page.locator('input[name^="module_permissions["]'), 'no extra module appeared').toHaveCount(30);
    for (const key of ['role', 'cop', 'content', 'knowledge', 'infographic', 'menu', 'category', 'faq'] as const) {
      expect(await form.levelOf(key), `level of "${key}"`).toBe('none');
    }
    test.info().annotations.push({ type: 'note', description: 'The server saved the role and ignored the invalid values ("user" stays none).' });
  });

  test("TC-FROL-06-04 [High] ผู้ใช้ที่ถือสิทธิ์หนึ่ง แก้ไขสิทธิ์ของตนเองเป็นสิทธิ์สูงขึ้นไม่ได้ (ยกระดับสิทธิ์)", async ({
    browser,
    page,
    roleListPage,
    roleFormPage,
    userListPage,
  }) => {
    test.fixme(true, NEEDS_LDAP_ACCOUNT);
    test.setTimeout(LOGIN_TEST_TIMEOUT + 60_000);

    // A role of our own with no rights on users or roles (only "หน้าหลัก" read-only) and its holder.
    const label = autoRoleLabel('06-04');
    await createRole(page, roleListPage, roleFormPage, { label, description: AUTO_ROLE_DESCRIPTION, levels: { home: 'view' } });
    const action = await (await roleListPage.openEditForm(label)).action();
    const username = uniqueUsername('sec0604');
    await createUserWithRoles(userListPage, { username }, label);

    // As that user, with a VALID CSRF token (so a 419 can't hide the authorization check), try to give the role full user/role rights.
    const { context, page: lowPage } = await loginAs(browser, username, VALID_PASSWORD);
    let status = 0;
    try {
      const token = await csrfTokenOf(lowPage);
      const attempt = await lowPage.request.post(action, {
        form: {
          _token: token,
          _method: 'PUT',
          label,
          description: AUTO_ROLE_DESCRIPTION,
          'module_permissions[home]': 'view',
          'module_permissions[user]': 'full',
          'module_permissions[role]': 'full',
        },
        maxRedirects: 0,
      });
      status = attempt.status();
    } finally {
      await context.close();
    }
    test.info().annotations.push({ type: 'note', description: `PUT to the role's own edit URL as its holder answered HTTP ${status}.` });

    // The decisive check: the role is exactly as before.
    const reopened = await roleListPage.openEditForm(label);
    expect(await reopened.levelOf('user'), 'the holder must not be able to raise "user" rights on their own role').toBe('none');
    expect(await reopened.levelOf('role'), 'the holder must not be able to raise "role" rights on their own role').toBe('none');
    expect(await reopened.levelOf('home')).toBe('view');

    expect(status, 'expected the request to be refused with 403').toBe(403);
  });

  test('TC-FROL-06-05 [High] ชื่อ/คำอธิบายสิทธิ์ที่มี HTML แสดงอย่างปลอดภัย', async ({ page, roleListPage, roleFormPage, userListPage }) => {
    const dialogs = collectDialogs(page);
    // The sheet's payloads, plus the marker so the role can be found and removed later.
    const label = `<script>alert(1)</script> ${AUTO_TEST_FLAG} ${roleStamp()}`;
    const description = `<img src=x onerror=alert(1)> ${AUTO_TEST_FLAG}`;

    const response = await submitNewRole(roleListPage, roleFormPage, { label, description });
    expect(response.status(), 'HTML in name/description must not cause a server error').toBeLessThan(500);

    // 1) The role list: shown as text, nothing rendered, nothing executed.
    await roleListPage.open();
    expect(dialogs, 'no script ran on the role list').toEqual([]);
    const row = await roleListPage.findRole(label);
    expect(row, 'the name is listed as plain text').toBeDefined();
    expect(row?.description, 'the description is listed as plain text').toBe(description);
    await expect(page.locator('table tbody img[src="x"]'), 'the <img> in the description must not be rendered').toHaveCount(0);

    // 2) The role picker of the user form (bootstrap-select could render option text as HTML).
    await userListPage.open();
    const modal = await userListPage.openAddUserForm();
    await modal.rolesDropdownToggle.click();
    const options = page.locator('.dropdown-menu.show a[role="option"]');
    await expect(options.filter({ hasText: exactText(label) }), 'the role is offered by its literal text').toHaveCount(1);
    await expect(page.locator('.dropdown-menu.show img[src="x"], .dropdown-menu.show script')).toHaveCount(0);
    await modal.rolesDropdownToggle.click();
    await modal.cancel();
    await modal.waitForClosed();
    expect(dialogs, 'no script ran in the user form').toEqual([]);

    // 3) The activity log ("ประวัติการใช้งาน"), which lists what was just done to the role.
    await page.goto(urlOf('/admin/activity-log'));
    await expect(page.locator('table tbody tr').first()).toBeVisible();
    await expect(page.locator('img[src="x"]')).toHaveCount(0);
    expect(dialogs, 'no script ran on the activity log').toEqual([]);
  });
});
