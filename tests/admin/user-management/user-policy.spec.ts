import { test, expect } from '@fixtures/pages.fixtures';
import { requireDataCreatingTestsAllowed } from '@config/env';
import { MAX_LENGTH, POLICY_SOURCE } from '@config/policy';
import { AdminActivityLogPage } from '@pages/admin/AdminActivityLogPage';
import { AdminRoleFormPage, AdminRoleListPage } from '@pages/admin/AdminRolePages';
import { AdminUserFormModal, UserFormValues } from '@pages/admin/AdminUserFormModal';
import { AdminUserListPage } from '@pages/admin/AdminUserListPage';
import { sheetTitle } from '@utils/caseTitles';
import { urlOf } from '@utils/lowPrivilege';
import { roleStamp, AUTO_ROLE_DESCRIPTION } from '@utils/roleFlows';
import { collectDialogs } from '@utils/security';
import { QA_PREFIX, uniqueUsername } from '@utils/strings';
import { AUTO_TEST_FLAG, DEFAULT_TEST_DEPARTMENT, NEEDS_LDAP_ACCOUNT } from '@utils/testData';
import { Page } from '@playwright/test';
import { textOfLength } from '../content/contentLimitsSuite';

/**
 * KM-ADMU / KM-FUSR — the user cases left after the Auto:Y round (Auto:P + the {MIN}/{MAX} cases), checked
 * 2026-10-07. Limits are the OWASP-based proposals in src/config/policy.ts (username 3–50, name 100, department /
 * position 150) until SA/Dev decide. Sign-in is by CU NET/LDAP (DEF-49): a user created here cannot log in, so the
 * cases that need that user to sign in are On hold for UAT. Every user a case saves has the "[Auto Test]" name /
 * department and is deleted again (the row's delete button — DEF-7); test roles carry the marker and are deleted too.
 */

const CREATES = 'Saves users (and roles) — all deleted again at the end of the case.';
const KNOWN = {
  UNLIMITED: 'Known bug (DEF-20): the user form has no length limit — one character over the proposed maximum is saved.',
  RAW_KEY: 'Known bug (DEF-66): the refusal message is the untranslated key (validation.*).',
  SPACE_USERNAME: 'Known bug (DEF-118): a username with a space is accepted (no format check on the username).',
  NOT_LOGGED: 'Known bug (DEF-86): only creating a user is logged — editing and deleting a user are not recorded.',
  BAD_ID_500: 'Known bug (DEF-54): an update sent to an unknown user id answers HTTP 500 instead of 404.',
  SEARCH: 'Known bug (DEF-5): the search box of the user list does not filter the list.',
  DELETE_BUTTON: 'Known bug (DEF-7): every user row has a delete button although the design says users are only suspended.',
};
const RAW = /\bvalidation\.[a-z_.]+/i;

test.beforeEach(() => test.setTimeout(240_000));

function note(description: string): void {
  test.info().annotations.push({ type: 'note', description });
}

/** The row text of a user (name, username, email, roles, status). */
async function rowText(list: AdminUserListPage, username: string): Promise<string> {
  return ((await (await list.locateUser(username)).innerText()) ?? '').replace(/\s+/g, ' ');
}

/** Clicks the role option at `index` in the "สิทธิ์การใช้งาน" dropdown (names can repeat — DEF-25), then closes it. */
async function pickRoleAt(page: Page, modal: AdminUserFormModal, index: number): Promise<void> {
  await modal.rolesDropdownToggle.click();
  await page.locator('.dropdown-menu.show a[role="option"]').nth(index).click();
  await modal.rolesDropdownToggle.click();
}

/** Deletes a user the case made (its row must show "[Auto Test]"). Never throws. */
async function removeUser(page: Page, username: string): Promise<boolean> {
  try {
    const list = new AdminUserListPage(page);
    const row = await list.locateUser(username);
    if (!((await row.innerText()) ?? '').includes(AUTO_TEST_FLAG)) return false;
    await row.locator('button').last().click();
    const dialog = page.getByRole('dialog').filter({ hasText: 'ต้องการลบข้อมูล?' });
    await Promise.all([page.waitForLoadState('load'), dialog.getByRole('button', { name: 'ยืนยันลบข้อมูล' }).click()]);
    await page.waitForTimeout(600);
    return !(await list.isUserListed(username));
  } catch {
    return false;
  }
}

/** Saves a user (defaults: marked name/department) with `roles`; returns the open-modal state after the save. */
async function saveUser(page: Page, values: UserFormValues, roles: string[] = []): Promise<{ modal: AdminUserFormModal; listed: boolean; messages: string }> {
  const list = new AdminUserListPage(page);
  await list.open();
  const modal = await list.openAddUserForm();
  await modal.fillWithDefaults(values);
  if (roles.length) await modal.selectRoles(...roles);
  await modal.save();
  await page.waitForLoadState('networkidle');
  const messages = (await modal.root.locator('.text-danger, .invalid-feedback, .text-xsmall').allInnerTexts().catch(() => [])).join(' ') + ' ' + (await page.locator('.alert-danger').allInnerTexts()).join(' ');
  const listed = await list.isUserListed(values.username as string);
  return { modal, listed, messages: messages.trim() };
}

/** Runs `work` with users the case saves, then deletes them. */
async function withUsers(page: Page, work: (made: string[]) => Promise<void>): Promise<void> {
  requireDataCreatingTestsAllowed(CREATES);
  const made: string[] = [];
  try {
    await work(made);
  } finally {
    let n = 0;
    for (const u of made) if (await removeUser(page, u)) n++;
    note(`Cleanup: deleted ${n} of ${made.length} user(s).`);
  }
}

/** A role for the case ("[Auto Test]" in its name); deleted in `finally` after its users. */
async function withRole(page: Page, tag: string, work: (label: string) => Promise<void>): Promise<void> {
  const label = `${AUTO_TEST_FLAG} ${QA_PREFIX}_${roleStamp()}_${tag}`;
  const roles = new AdminRoleListPage(page);
  const form = new AdminRoleFormPage(page);
  try {
    await roles.open();
    await roles.openAddForm();
    await form.fill({ label, description: AUTO_ROLE_DESCRIPTION, levels: { home: 'view' } });
    expect((await form.save()).status(), 'saving the test role').toBeLessThan(400);
    await work(label);
  } finally {
    try {
      await roles.open();
      const dialog = await roles.openDeleteDialog(label);
      await Promise.all([page.waitForLoadState('load'), dialog.confirm()]);
      note('Cleanup: the test role was deleted.');
    } catch (error) {
      note(`Cleanup: the test role "${label}" could not be deleted (${(error as Error).message.split('\n')[0]}).`);
    }
  }
}

/** A field at its maximum is saved whole; one over is refused with a readable message. */
async function lengthCase(page: Page, field: 'name' | 'department' | 'position' | 'username', length: number, ok: boolean): Promise<void> {
  note(`Limit used: ${POLICY_SOURCE}`);
  await withUsers(page, async (made) => {
    const stamp = roleStamp();
    const username = field === 'username' ? (length < QA_PREFIX.length + 2 ? `q${stamp}`.slice(0, length) : `${QA_PREFIX}_${stamp}`.padEnd(length, 'x').slice(0, length)) : uniqueUsername();
    const value = field === 'username' ? username : textOfLength(`${AUTO_TEST_FLAG} ${stamp}`, length);
    const values: UserFormValues = { username, ...(field === 'username' ? {} : { [field]: value }), ...(field === 'name' ? {} : { name: `${AUTO_TEST_FLAG} ผู้ใช้ทดสอบ ${stamp}` }) };
    if (field === 'username' && !username.startsWith(QA_PREFIX)) values.department = DEFAULT_TEST_DEPARTMENT;
    made.push(username);
    const saved = await saveUser(page, values);
    note(`${field} of ${length}: listed ${saved.listed}; messages "${saved.messages}"`);
    if (ok) {
      expect(saved.listed, `a ${field} of ${length} characters is saved`).toBe(true);
      const row = await rowText(new AdminUserListPage(page), username);
      if (field !== 'position' && field !== 'department') expect(row, 'shown whole in the list').toContain(value);
      const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
      expect(overflow, 'the list does not break').toBeLessThanOrEqual(1);
      return;
    }
    test.fail(saved.listed, KNOWN.UNLIMITED);
    expect(saved.listed, `a ${field} of ${length} characters is not saved`).toBe(false);
    expect(saved.messages, 'a length message').toMatch(/ต้องไม่เกิน|อย่างน้อย|ไม่เกิน\s*\d+|ความยาว|ตัวอักษร|\bvalidation\.(max|min)/);
    test.fail(RAW.test(saved.messages), KNOWN.RAW_KEY);
    expect(saved.messages, 'readable, not a raw key').not.toMatch(RAW);
  });
}

// ---------------------------------------------------------------------------------------------------------------

test.describe('On hold (UAT): needs the created user to sign in', () => {
  for (const id of ['TC-ADMU-08-03', 'TC-ADMU-08-04', 'TC-ADMU-08-06', 'TC-ADMU-08-10', 'TC-ADMU-08-13', 'TC-FUSR-02-16', 'TC-FUSR-06-03', 'TC-FUSR-08-01', 'TC-FUSR-08-02', 'TC-FUSR-08-03', 'TC-FUSR-08-04']) {
    test(sheetTitle(id), async () => {
      test.fixme(true, NEEDS_LDAP_ACCOUNT);
    });
  }
});

test.describe('SC-ADMU / SC-FUSR ความยาวของช่อง', () => {
  test(sheetTitle('TC-ADMU-04-03'), ({ page }) => lengthCase(page, 'name', MAX_LENGTH.personName, true));
  test(sheetTitle('TC-ADMU-04-04'), ({ page }) => lengthCase(page, 'name', MAX_LENGTH.personName + 1, false));
  test(sheetTitle('TC-FUSR-03-04'), ({ page }) => lengthCase(page, 'name', MAX_LENGTH.personName, true));
  test(sheetTitle('TC-FUSR-03-05'), ({ page }) => lengthCase(page, 'name', MAX_LENGTH.personName + 1, false));
  test(sheetTitle('TC-ADMU-05-02'), ({ page }) => lengthCase(page, 'username', MAX_LENGTH.usernameMin, true));
  test(sheetTitle('TC-ADMU-05-03'), ({ page }) => lengthCase(page, 'username', MAX_LENGTH.username, true));
  test(sheetTitle('TC-ADMU-05-04'), ({ page }) => lengthCase(page, 'username', MAX_LENGTH.usernameMin - 1, false));
  test(sheetTitle('TC-ADMU-05-05'), ({ page }) => lengthCase(page, 'username', MAX_LENGTH.username + 1, false));
  test(sheetTitle('TC-FUSR-02-04'), ({ page }) => lengthCase(page, 'username', MAX_LENGTH.username, true));
  test(sheetTitle('TC-FUSR-02-05'), ({ page }) => lengthCase(page, 'username', MAX_LENGTH.username + 1, false));
  test(sheetTitle('TC-FUSR-05-04'), ({ page }) => lengthCase(page, 'department', MAX_LENGTH.department, true));
  test(sheetTitle('TC-FUSR-05-05'), ({ page }) => lengthCase(page, 'department', MAX_LENGTH.department + 1, false));
  test(sheetTitle('TC-FUSR-05-12'), ({ page }) => lengthCase(page, 'position', MAX_LENGTH.position, true));
  test(sheetTitle('TC-FUSR-05-13'), ({ page }) => lengthCase(page, 'position', MAX_LENGTH.position + 1, false));
});

test.describe('SC-FUSR ค่าในช่อง', () => {
  test(sheetTitle('TC-FUSR-02-08'), async ({ page }) => {
    await withUsers(page, async (made) => {
      const username = `${QA_PREFIX} ${roleStamp()}`;
      made.push(username);
      const saved = await saveUser(page, { username });
      note(`Listed ${saved.listed}; messages "${saved.messages}"`);
      test.fail(saved.listed, KNOWN.SPACE_USERNAME);
      expect(saved.listed, 'a username with a space is refused').toBe(false);
      expect(saved.messages, 'with a message').not.toBe('');
    });
  });

  for (const [id, field] of [['TC-FUSR-03-06', 'name'], ['TC-FUSR-05-06', 'department']] as const) {
    test(sheetTitle(id), async ({ page }) => {
      await withUsers(page, async (made) => {
        const username = uniqueUsername();
        made.push(username);
        const value = `${AUTO_TEST_FLAG} ช่องว่าง ${roleStamp()}`;
        const saved = await saveUser(page, { username, [field]: `   ${value}   ` });
        expect(saved.listed, 'saved').toBe(true);
        const modal = await new AdminUserListPage(page).openEditUserForm(username);
        const stored = await (field === 'name' ? modal.nameInput : modal.departmentInput).inputValue();
        await modal.cancel();
        expect(stored, 'leading / trailing spaces are trimmed').toBe(value);
      });
    });
  }

  test(sheetTitle('TC-FUSR-03-12'), async ({ page }) => {
    const dialogs = collectDialogs(page);
    await withUsers(page, async (made) => {
      const username = uniqueUsername();
      made.push(username);
      const name = `<img src=x onerror=alert(1)> ${AUTO_TEST_FLAG} ${roleStamp()}`;
      expect((await saveUser(page, { username, name })).listed).toBe(true);
      const list = new AdminUserListPage(page);
      expect(await rowText(list, username), 'the list shows it as text').toContain(name);
      expect(await page.locator('table img[src="x"]').count(), 'no image tag rendered').toBe(0);
      const modal = await list.openEditUserForm(username);
      await modal.cancel();
      const log = new AdminActivityLogPage(page);
      await log.open();
      expect(await page.locator('table img[src="x"]').count(), 'not rendered in the activity log').toBe(0);
      await page.waitForTimeout(800);
      expect(dialogs, 'no script runs (list, edit form, log)').toEqual([]);
      note('The top-right user menu needs this user to sign in (UAT, DEF-49) — not checked.');
    });
  });

  test(sheetTitle('TC-FUSR-03-13'), async ({ page }) => {
    await withUsers(page, async (made) => {
      const username = uniqueUsername();
      made.push(username);
      expect((await saveUser(page, { username })).listed).toBe(true);
      const list = new AdminUserListPage(page);
      const modal = await list.openEditUserForm(username);
      const renamed = `${AUTO_TEST_FLAG} ชื่อใหม่ ${roleStamp()}`;
      await modal.nameInput.fill(renamed);
      await modal.save();
      await modal.waitForClosed();
      expect(await rowText(list, username), 'the list shows the new name').toContain(renamed);
      note('The user menu and the "ผู้ใช้งาน" column of the log show the name of a signed-in user — needs this user to sign in (UAT).');
    });
  });
});

test.describe('SC-ADMU-02/08 แก้ไขผู้ใช้และสิทธิ์', () => {
  test(sheetTitle('TC-ADMU-02-05'), async ({ page }) => {
    await withUsers(page, async (made) => {
      await withRole(page, 'old', async (oldRole) => {
        await withRole(page, 'new', async (newRole) => {
          const username = uniqueUsername();
          made.push(username);
          expect((await saveUser(page, { username }, [oldRole])).listed).toBe(true);
          const roles = new AdminRoleListPage(page);
          await roles.open();
          const before = { old: (await roles.findRole(oldRole))?.users, new: (await roles.findRole(newRole))?.users };
          const list = new AdminUserListPage(page);
          const modal = await list.openEditUserForm(username);
          const renamed = `${AUTO_TEST_FLAG} แก้ไขแล้ว ${roleStamp()}`;
          await modal.nameInput.fill(renamed);
          await modal.selectRoles(oldRole, newRole); // untick the old one, tick the new one
          await modal.save();
          await modal.waitForClosed();
          const row = await rowText(list, username);
          note(`Row: ${row}`);
          expect(row, 'the new name').toContain(renamed);
          expect(row, 'the new role').toContain(newRole);
          expect(row, 'not the old role').not.toContain(oldRole);
          await roles.open();
          const after = { old: (await roles.findRole(oldRole))?.users, new: (await roles.findRole(newRole))?.users };
          note(`Users per role: ${JSON.stringify(before)} → ${JSON.stringify(after)}`);
          expect(Number(after.old), 'the old role has one user fewer').toBe(Number(before.old) - 1);
          expect(Number(after.new), 'the new role has one more').toBe(Number(before.new) + 1);
          await removeUser(page, username); // before the roles are deleted
        });
      });
    });
  });

  test(sheetTitle('TC-ADMU-08-01'), async ({ page }) => {
    await withUsers(page, async (made) => {
      const list = new AdminUserListPage(page);
      await list.open();
      const modal = await list.openAddUserForm();
      // Real (not test-made) roles, first option of each name — old test roles may share their names (DEF-25), so pick by position.
      const texts = (await modal.rolesSelect.locator('option').allInnerTexts()).map((o) => o.trim());
      const options = texts
        .map((role, index) => ({ role, index }))
        .filter(({ role, index }) => role && !role.includes(AUTO_TEST_FLAG) && !/qa_auto|\{\{|<|\bmu[a-z0-9]{6,}/.test(role) && texts.indexOf(role) === index)
        .slice(0, 2);
      await modal.cancel();
      note(`Real role options (index): ${JSON.stringify(options)}`);
      for (const { index, role } of options) {
        const username = uniqueUsername();
        made.push(username);
        await list.open();
        const form = await list.openAddUserForm();
        await form.fillWithDefaults({ username });
        await pickRoleAt(page, form, index);
        await form.save();
        await page.waitForLoadState('networkidle');
        expect(await list.isUserListed(username), `saved with "${role}"`).toBe(true);
        expect(await rowText(list, username), `the list shows "${role}"`).toContain(role);
      }
      note('Whether each user then gets the menus of its role needs the user to sign in (UAT, DEF-49).');
    });
  });

  test(sheetTitle('TC-ADMU-08-15'), async ({ page }) => {
    let username = '';
    await withUsers(page, async (made) => {
      username = uniqueUsername();
      made.push(username);
      expect((await saveUser(page, { username })).listed).toBe(true);
      const modal = await new AdminUserListPage(page).openEditUserForm(username);
      await modal.nameInput.fill(`${AUTO_TEST_FLAG} แก้ไข log ${roleStamp()}`);
      await modal.save();
      await modal.waitForClosed();
    });
    const log = new AdminActivityLogPage(page);
    await log.open();
    // Rows read "User#<id> — <name>": after the edit the name no longer holds the username, so follow the id.
    const all = await log.readRows();
    const id = all.find((r) => r.item.includes(username))?.item.split(' ')[0] ?? username;
    const rows = all.filter((r) => r.item.split(' ')[0] === id || r.item.includes(username));
    note(`Log rows for ${id} (${username}): ${JSON.stringify(rows.map((r) => [r.action, r.item]))}`);
    test.fail(rows.length < 3, KNOWN.NOT_LOGGED);
    expect(rows.length, 'create, edit and delete are logged with the target user').toBeGreaterThanOrEqual(3);
  });
});

test.describe('SC-FUSR-06 ตัวเลือกสิทธิ์ในฟอร์มผู้ใช้', () => {
  test(sheetTitle('TC-FUSR-06-04'), async ({ page }) => {
    await withUsers(page, async (made) => {
      await withRole(page, 'a', async (a) => {
        await withRole(page, 'b', async (b) => {
          const username = uniqueUsername();
          made.push(username);
          expect((await saveUser(page, { username }, [a, b])).listed).toBe(true);
          const row = await rowText(new AdminUserListPage(page), username);
          expect(row, 'both roles are listed').toContain(a);
          expect(row).toContain(b);
          await removeUser(page, username);
        });
      });
    });
  });

  test(sheetTitle('TC-FUSR-06-05'), async ({ page }) => {
    const list = new AdminUserListPage(page);
    await list.open();
    const modal = await list.openAddUserForm();
    await pickRoleAt(page, modal, 0);
    const picked = (await modal.rolesDropdownToggle.innerText()).trim();
    await pickRoleAt(page, modal, 0); // click it again
    const after = (await modal.rolesDropdownToggle.innerText()).trim();
    const selected = await modal.rolesSelect.evaluate((s: HTMLSelectElement) => [...s.selectedOptions].length);
    await modal.cancel();
    note(`Button: "${picked}" → "${after}"`);
    expect(selected, 'nothing selected').toBe(0);
    expect(after, 'the button reads "เลือกสิทธิ์การใช้งาน" again').toContain('เลือกสิทธิ์การใช้งาน');
  });

  test(sheetTitle('TC-FUSR-06-07'), async ({ page }) => {
    const list = new AdminUserListPage(page);
    await list.open();
    const modal = await list.openAddUserForm();
    await modal.rolesDropdownToggle.click();
    const box = page.locator('.dropdown-menu.show input[type="search"], .bs-searchbox input').first();
    const hasSearch = await box.isVisible().catch(() => false);
    note(`Search box in the role list: ${hasSearch}`);
    expect(hasSearch, 'the role list has a search box').toBe(true);
    await box.fill('zzz');
    await page.waitForTimeout(400);
    const noResults = (await page.locator('.dropdown-menu.show .no-results, .dropdown-menu.show li.no-results').allInnerTexts()).join(' ');
    const visibleOptions = await page.locator('.dropdown-menu.show a[role="option"]:visible').count();
    await page.keyboard.press('Escape');
    await modal.cancel().catch(() => undefined);
    note(`No-results text "${noResults}", visible options ${visibleOptions}`);
    expect(visibleOptions, 'no option matches').toBe(0);
    expect(noResults, 'a "not found" text').not.toBe('');
  });

  test(sheetTitle('TC-FUSR-06-09'), async ({ page }) => {
    requireDataCreatingTestsAllowed(CREATES);
    await withRole(page, 'new', async (label) => {
      const list = new AdminUserListPage(page);
      await list.open();
      const modal = await list.openAddUserForm();
      const options = (await modal.rolesSelect.locator('option').allInnerTexts()).map((o) => o.trim());
      await modal.cancel();
      expect(options, 'the new role is offered at once').toContain(label);
    });
  });

  test(sheetTitle('TC-FUSR-06-10'), async ({ page }) => {
    requireDataCreatingTestsAllowed(CREATES);
    const dialogs = collectDialogs(page);
    const roles = new AdminRoleListPage(page);
    const form = new AdminRoleFormPage(page);
    const label = `<img src=x onerror=alert(1)> ${AUTO_TEST_FLAG} ${roleStamp()}`;
    try {
      await roles.open();
      await roles.openAddForm();
      await form.fill({ label, description: AUTO_ROLE_DESCRIPTION, levels: { home: 'view' } });
      await form.save();
      const list = new AdminUserListPage(page);
      await list.open();
      const modal = await list.openAddUserForm();
      await modal.rolesDropdownToggle.click();
      await page.waitForTimeout(500);
      const live = await page.locator('.dropdown-menu.show img[src="x"]').count();
      const shown = await page.locator('.dropdown-menu.show a[role="option"]').allInnerTexts();
      await page.keyboard.press('Escape');
      await modal.cancel().catch(() => undefined);
      expect(live, 'not rendered as an image').toBe(0);
      expect(shown.map((t) => t.trim()), 'shown as text').toContain(label);
      expect(dialogs, 'no script runs').toEqual([]);
    } finally {
      try {
        await roles.open();
        const dialog = await roles.openDeleteDialog(label);
        await Promise.all([page.waitForLoadState('load'), dialog.confirm()]);
      } catch {
        note('Cleanup: the HTML role could not be deleted.');
      }
    }
  });
});

test.describe('SC-FUSR-09/10 รายการและความปลอดภัย', () => {
  test(sheetTitle('TC-FUSR-09-02'), async ({ page }) => {
    await withUsers(page, async (made) => {
      const username = uniqueUsername();
      made.push(username);
      expect((await saveUser(page, { username })).listed).toBe(true);
      await page.goto(urlOf(`/admin/user/index?search=${encodeURIComponent(username)}&q=${encodeURIComponent(username)}`));
      const rows = await page.locator('table tbody tr').allInnerTexts();
      note(`Search for ${username}: ${rows.length} row(s)`);
      test.fail(rows.length !== 1, KNOWN.SEARCH);
      expect(rows.length, 'only the matching user').toBe(1);
      expect(rows[0]).toContain(username);
    });
  });

  test(sheetTitle('TC-FUSR-09-03'), async ({ page }) => {
    const dialogs = collectDialogs(page);
    for (const q of ['zzz_no_such_user', '<script>alert(1)</script>', "' OR 1=1--"]) {
      const response = await page.goto(urlOf(`/admin/user/index?search=${encodeURIComponent(q)}&q=${encodeURIComponent(q)}`));
      expect(response?.status(), `"${q}": no server error`).toBeLessThan(500);
    }
    await page.waitForTimeout(500);
    expect(dialogs, 'no script runs').toEqual([]);
    const rows = await page.locator('table tbody tr').allInnerTexts();
    note(`Last search shows ${rows.length} row(s)`);
    test.fail(rows.length > 1, KNOWN.SEARCH);
    expect(rows.join(' '), 'a "not found" state').toMatch(/ไม่พบ|ไม่มีข้อมูล/);
  });

  test(sheetTitle('TC-FUSR-09-04'), async ({ page }) => {
    await withUsers(page, async (made) => {
      const username = uniqueUsername();
      made.push(username);
      expect((await saveUser(page, { username })).listed).toBe(true);
      const row = await new AdminUserListPage(page).locateUser(username);
      const deletes = await row.locator('button.delete, [data-delete-url]').count();
      note(`Delete buttons on the row: ${deletes}`);
      test.fail(deletes > 0, KNOWN.DELETE_BUTTON);
      expect(deletes, 'only the edit (pencil) button').toBe(0);
    });
  });

  test(sheetTitle('TC-FUSR-10-01'), async ({ page }) => {
    requireDataCreatingTestsAllowed('Posts a user form without CSRF token (deleted again if the app keeps it).');
    const username = uniqueUsername();
    await page.goto(urlOf('/admin/user/index'));
    const response = await page.request.post(urlOf('/admin/user'), { form: { username, name: `${AUTO_TEST_FLAG} csrf`, department: DEFAULT_TEST_DEPARTMENT, is_active: '1' }, maxRedirects: 0 });
    note(`Without _token: HTTP ${response.status()}`);
    const listed = await new AdminUserListPage(page).isUserListed(username);
    if (listed) await removeUser(page, username);
    expect([419, 403], 'refused (419 / 403)').toContain(response.status());
    expect(listed, 'no user created').toBe(false);
  });

  test(sheetTitle('TC-FUSR-10-03'), async ({ page }) => {
    await withUsers(page, async (made) => {
      const username = uniqueUsername();
      made.push(username);
      expect((await saveUser(page, { username })).listed).toBe(true);
      const list = new AdminUserListPage(page);
      const { update } = await list.actionUrls(username);
      const token = await page.locator('meta[name="csrf-token"]').getAttribute('content');
      const other = update.replace(/\/user\/[^/?]+/, '/user/999');
      const response = await page.request.post(other, { form: { _token: token ?? '', _method: 'PUT', username: 'admin', name: `${AUTO_TEST_FLAG} idor`, department: DEFAULT_TEST_DEPARTMENT, is_active: '1' }, maxRedirects: 0 });
      note(`PUT ${other}: HTTP ${response.status()}`);
      expect(response.status(), 'answers 404 (or another refusal)').toBeGreaterThanOrEqual(400);
      test.fail(response.status() >= 500, KNOWN.BAD_ID_500);
      expect(response.status(), 'no server error').toBeLessThan(500);
      expect(await rowText(list, 'admin'), 'the admin account is unchanged').toContain('ผู้ดูแลระบบ');
    });
  });

  test(sheetTitle('TC-FUSR-10-04'), async ({ page }) => {
    await withUsers(page, async (made) => {
      const username = uniqueUsername();
      made.push(username);
      await page.goto(urlOf('/admin/user/index'));
      const token = await page.locator('meta[name="csrf-token"]').getAttribute('content');
      const response = await page.request.post(urlOf('/admin/user'), {
        form: { _token: token ?? '', username, name: `${AUTO_TEST_FLAG} mass ${username}`, department: DEFAULT_TEST_DEPARTMENT, is_active: '1', is_admin: '1', id: '1', created_at: '2000-01-01' },
        maxRedirects: 0,
      });
      note(`Post with extra fields: HTTP ${response.status()}`);
      expect(response.status(), 'no server error').toBeLessThan(500);
      const list = new AdminUserListPage(page);
      expect(await list.isUserListed(username), 'the user is created (extra fields ignored)').toBe(true);
      expect(await rowText(list, 'admin'), 'the admin account (id 1) is untouched').toContain('admin@cu-km-nurse.local');
      const row = await rowText(list, username);
      expect(row, 'not made an administrator').not.toContain('ผู้ดูแลระบบ');
    });
  });
});
