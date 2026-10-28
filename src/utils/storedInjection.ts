import { Browser, Page } from '@playwright/test';
import { AdminRoleFormPage, AdminRoleListPage } from '@pages/admin/AdminRolePages';
import { AdminUserListPage } from '@pages/admin/AdminUserListPage';
import { roleStamp, submitNewRole } from '@utils/roleFlows';
import { loginAs, urlOf } from '@utils/lowPrivilege';
import { collectDialogs, PUBLIC_SECURITY_PAGES } from '@utils/security';
import { exactText, uniqueUsername } from '@utils/strings';
import { AUTO_TEST_FLAG, VALID_PASSWORD } from '@utils/testData';

/**
 * Stored-payload sweep behind TC-SEC-01-01 (XSS), -05 (template injection) and
 * -08 (unclosed HTML): the same payload goes into every text field of the
 * records the automation can create, then every page that shows them is opened.
 *
 * COVERAGE — the sheet says "every text field of every module". Only the fields
 * below exist as page objects today (and only their records can be cleaned up by
 * `npm run cleanup:data`). When another module gets a page object, add its
 * fields to TEXT_FIELDS, its create step to `seedRecords()` and its pages to
 * `sweepPages()` — the three cases then cover it too.
 */

export type Mode = 'xss' | 'template' | 'broken';

/** The text fields covered so far: user (name, department, position) and role (name, description). */
export const TEXT_FIELDS = ['name', 'department', 'position', 'roleLabel', 'roleDescription'] as const;
export type TextField = (typeof TEXT_FIELDS)[number];

/** Every rendered payload element carries an id with this prefix, so "was it rendered?" is one selector. */
const MARK = 'qasec-';

/** The payload of `mode` for `field` (the sheet's payloads, with ids added so a rendered element can be attributed). */
export function payloadFor(mode: Mode, field: TextField): string {
  switch (mode) {
    case 'xss':
      return `<img id="${MARK}${field}" src=x onerror=alert(document.domain)>`;
    case 'template':
      return '{{7*7}} ${7*7} <%= 7*7 %> #{7*7}';
    case 'broken':
      return `</div></div><h1 id="${MARK}h1-${field}"> <div id="${MARK}fixed-${field}" style="position:fixed;top:0;left:0;width:100%;height:100%">`;
  }
}

export interface Seed {
  username: string;
  name: string;
  department: string;
  position: string;
  roleLabel: string;
  roleDescription: string;
  roleAssigned: boolean;
}

export interface Pages {
  browser: Browser;
  page: Page;
  roleListPage: AdminRoleListPage;
  roleFormPage: AdminRoleFormPage;
  userListPage: AdminUserListPage;
}

/**
 * Creates one role and one user carrying the payload in every text field. The
 * role name/description also carry "[Auto Test]" (cleanup finds roles by it) and
 * the username starts with `qa_auto_`. The user gets the role, except in
 * 'broken' mode: a full-screen payload div would cover the page and block the
 * clicks needed to pick it, which would hide the real finding.
 */
export async function seedRecords(mode: Mode, { page, roleListPage, roleFormPage, userListPage }: Pages, problems: string[]): Promise<Seed> {
  const roleLabel = `${payloadFor(mode, 'roleLabel')} ${AUTO_TEST_FLAG} ${roleStamp()}`;
  const roleDescription = `${payloadFor(mode, 'roleDescription')} ${AUTO_TEST_FLAG}`;
  const seed: Seed = {
    username: uniqueUsername(`sec${mode}`),
    name: payloadFor(mode, 'name'),
    department: payloadFor(mode, 'department'),
    position: payloadFor(mode, 'position'),
    roleLabel,
    roleDescription,
    roleAssigned: false,
  };

  const saved = await submitNewRole(roleListPage, roleFormPage, { label: roleLabel, description: roleDescription });
  if (saved.status() >= 500) problems.push(`saving the role with the payload answered HTTP ${saved.status()}`);

  await userListPage.open();
  const modal = await userListPage.openAddUserForm();
  await modal.fillWithDefaults({ username: seed.username, name: seed.name, department: seed.department, position: seed.position });
  if (mode !== 'broken') {
    try {
      await modal.selectRoles(roleLabel);
      seed.roleAssigned = true;
    } catch {
      problems.push('the role picker could not show or select the role that carries the payload');
      if (await modal.root.isVisible()) await page.keyboard.press('Escape');
    }
  }
  await modal.save();
  await modal.waitForClosed().catch(() => problems.push('the user carrying the payload could not be saved (the form stayed open)'));
  return seed;
}

/**
 * Opens every page that shows the seeded records and reports what went wrong:
 * a script that ran, a payload rendered as elements, a value that came back
 * changed (also through the data-* attributes and input values, which is where
 * broken escaping shows first), or a layout that is no longer usable.
 */
export async function sweepPages(mode: Mode, seed: Seed, pages: Pages, dialogs: string[]): Promise<string[]> {
  const { browser, page, roleListPage, userListPage } = pages;
  const problems: string[] = [];

  const clean = async (surface: string): Promise<void> => {
    await page.waitForLoadState('load');
    const rendered = await page.locator(`[id^="${MARK}"]`).count();
    if (dialogs.length) problems.push(`${surface}: a script ran (${dialogs.join('; ')})`);
    if (rendered) problems.push(`${surface}: the payload was rendered as ${rendered} HTML element(s)`);
    dialogs.length = 0;
  };
  const same = (surface: string, what: string, actual: string | null, expected: string): void => {
    if (actual !== expected) problems.push(`${surface}: ${what} came back as ${JSON.stringify(actual)} instead of ${JSON.stringify(expected)}`);
  };
  const usable = async (surface: string, button: ReturnType<Page['locator']>, label: string): Promise<void> => {
    if (mode !== 'broken') return;
    await button.click({ trial: true, timeout: 5_000 }).catch(() => problems.push(`${surface}: "${label}" is covered or cannot be clicked — the layout is broken`));
  };

  // 1) User list: the row, and the data-* attributes of its edit button (an attribute that breaks out would show here).
  await userListPage.open();
  const row = await userListPage.locateUser(seed.username).catch(() => null);
  if (!row) {
    problems.push('user list: the user carrying the payload is not listed');
  } else {
    const edit = row.locator('button.js-edit-user');
    same('user list', 'name (data-name)', await edit.getAttribute('data-name'), seed.name);
    same('user list', 'department (data-department)', await edit.getAttribute('data-department'), seed.department);
    same('user list', 'position (data-position)', await edit.getAttribute('data-position'), seed.position);
    const text = await row.innerText();
    if (!text.includes(seed.name)) problems.push('user list: the name is not shown as literal text');
    if (seed.roleAssigned && !text.includes(seed.roleLabel)) problems.push('user list: the role name is not shown as literal text');
  }
  await usable('user list', userListPage.addUserButton, 'เพิ่มผู้ใช้งาน');
  await clean('user list');

  // 2) The user's edit form: what the inputs hold.
  if (row) {
    const modal = await userListPage.openEditUserForm(seed.username);
    same('user edit form', 'name', await modal.nameInput.inputValue(), seed.name);
    same('user edit form', 'department', await modal.departmentInput.inputValue(), seed.department);
    same('user edit form', 'position', await modal.positionInput.inputValue(), seed.position);
    await clean('user edit form');
    await modal.cancel();
    await modal.waitForClosed();
  }

  // 3) Role list and the role's edit form.
  await roleListPage.open();
  const role = await roleListPage.findRole(seed.roleLabel);
  if (!role) problems.push('role list: the role carrying the payload is not shown as plain text');
  else same('role list', 'description', role.description, seed.roleDescription.trim());
  await usable('role list', roleListPage.addRoleLink, 'เพิ่มสิทธิ์');
  await clean('role list');
  if (role) {
    const form = await roleListPage.openEditForm(seed.roleLabel);
    same('role edit form', 'name', await form.labelInput.inputValue(), seed.roleLabel.trim());
    same('role edit form', 'description', await form.descriptionInput.inputValue(), seed.roleDescription);
    await clean('role edit form');
  }

  // 4) The role picker of the user form.
  await userListPage.open();
  const picker = await userListPage.openAddUserForm();
  await picker.rolesDropdownToggle.click();
  const offered = await page.locator('.dropdown-menu.show a[role="option"]').filter({ hasText: exactText(seed.roleLabel) }).count();
  if (offered !== 1) problems.push(`role picker: the role is offered ${offered} times (expected once, as literal text)`);
  await clean('role picker');
  await picker.rolesDropdownToggle.click().catch(() => undefined);
  await picker.cancel().catch(() => undefined);
  await picker.waitForClosed().catch(() => undefined);

  // 5) The activity log (what was just done to these records is listed there).
  await page.goto(urlOf('/admin/activity-log'));
  await clean('activity log');

  // 6) The created user's own view: their name is in the page header on every admin page.
  if (row) {
    const { context, page: own } = await loginAs(browser, seed.username, VALID_PASSWORD);
    try {
      const ownDialogs = collectDialogs(own);
      for (const path of ['/admin/dashboard/index', '/admin/role/index']) {
        await own.goto(urlOf(path));
        await own.waitForLoadState('load');
        const rendered = await own.locator(`[id^="${MARK}"]`).count();
        if (ownDialogs.length) problems.push(`signed in as the user, ${path}: a script ran (${ownDialogs.join('; ')})`);
        if (rendered) problems.push(`signed in as the user, ${path}: the payload was rendered as ${rendered} HTML element(s)`);
        ownDialogs.length = 0;
      }
      if (!(await own.locator('body').innerText()).includes(seed.name)) problems.push('signed in as the user: the name in the page header is not shown as literal text');
    } finally {
      await context.close();
    }
  }

  // 7) The public site (the sheet also names Public and search): nothing may run there either.
  for (const path of PUBLIC_SECURITY_PAGES) {
    await page.goto(urlOf(path));
    await clean(`public ${path}`);
  }
  return problems;
}
