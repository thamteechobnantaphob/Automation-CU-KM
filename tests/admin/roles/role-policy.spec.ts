import { test, expect } from '@fixtures/pages.fixtures';
import { requireDataCreatingTestsAllowed } from '@config/env';
import { MAX_LENGTH, POLICY_SOURCE } from '@config/policy';
import { AdminActivityLogPage } from '@pages/admin/AdminActivityLogPage';
import { AdminRoleFormPage, AdminRoleListPage, RoleFormValues } from '@pages/admin/AdminRolePages';
import { AdminUserListPage } from '@pages/admin/AdminUserListPage';
import { sheetTitle } from '@utils/caseTitles';
import { AUTO_ROLE_DESCRIPTION, roleStamp } from '@utils/roleFlows';
import { collectDialogs } from '@utils/security';
import { QA_PREFIX, uniqueUsername } from '@utils/strings';
import { AUTO_TEST_FLAG, NEEDS_LDAP_ACCOUNT } from '@utils/testData';
import { Page } from '@playwright/test';
import { textOfLength } from '../content/contentLimitsSuite';

/**
 * KM-ADMR / KM-FROL — the role cases left after the Auto:Y round (Auto:P + the {MAX} cases), checked 2026-10-07.
 * Limits are the OWASP-based proposals in src/config/policy.ts (role name 100, description 500) until SA/Dev decide.
 * What a role allows can only be seen by a user signing in with it — not possible on Dev (LDAP, DEF-49): those cases
 * are On hold for UAT. Every role a case saves carries "[Auto Test]" and is deleted again (hand-made roles have a
 * delete button); users it creates are deleted first.
 */

const CREATES = 'Saves roles (and users holding them) — deleted again at the end of the case.';
const KNOWN = {
  UNLIMITED: 'Known bug (DEF-28): the role form has no length limit — one character over the proposed maximum is saved.',
  RAW_KEY: 'Known bug (DEF-66): the refusal message is the untranslated key (validation.*).',
  HELD_ROLE_DELETED: 'Known bug (DEF-117): a role a user still holds can be deleted — the user is left with no role at all.',
  NOT_LOGGED: 'Known bug (DEF-86): creating / editing a role is not recorded in "ประวัติการใช้งานระบบ".',
};
const RAW = /\bvalidation\.[a-z_.]+/i;

test.beforeEach(() => test.setTimeout(240_000));

function note(description: string): void {
  test.info().annotations.push({ type: 'note', description });
}

async function saveRole(page: Page, values: RoleFormValues): Promise<{ status: number; messages: string }> {
  const roles = new AdminRoleListPage(page);
  const form = new AdminRoleFormPage(page);
  await roles.open();
  await roles.openAddForm();
  await form.fill({ levels: { home: 'view' }, ...values });
  const status = (await form.save()).status();
  const messages = (await page.locator('.text-danger, .invalid-feedback, .text-xsmall, .alert-danger').allInnerTexts()).join(' ').trim();
  return { status, messages };
}

/** Deletes a marked role by name. Never throws; true when it is gone. */
async function removeRole(page: Page, label: string): Promise<boolean> {
  const roles = new AdminRoleListPage(page);
  try {
    await roles.open();
    if (!(await roles.findRole(label))) return true;
    const dialog = await roles.openDeleteDialog(label);
    await Promise.all([page.waitForLoadState('load'), dialog.confirm()]);
    await roles.open();
    return !(await roles.findRole(label));
  } catch {
    return false;
  }
}

async function removeUser(page: Page, username: string): Promise<void> {
  try {
    const list = new AdminUserListPage(page);
    const dialog = await list.openDeleteDialog(username);
    await Promise.all([page.waitForLoadState('load'), dialog.confirm()]);
  } catch {
    // reported by the caller's note
  }
}

/** Runs `work` with the roles / users it registers, then deletes them (users first). */
async function withCleanup(page: Page, work: (track: { role: (l: string) => void; user: (u: string) => void }) => Promise<void>): Promise<void> {
  requireDataCreatingTestsAllowed(CREATES);
  const roles: string[] = [];
  const users: string[] = [];
  try {
    await work({ role: (l) => roles.push(l), user: (u) => users.push(u) });
  } finally {
    for (const u of users) await removeUser(page, u);
    let n = 0;
    for (const r of roles) if (await removeRole(page, r)) n++;
    note(`Cleanup: ${users.length} user(s), ${n} of ${roles.length} role(s) deleted.`);
  }
}

async function userWithRole(page: Page, username: string, role: string): Promise<void> {
  const list = new AdminUserListPage(page);
  await list.open();
  const modal = await list.openAddUserForm();
  await modal.fillWithDefaults({ username });
  await modal.selectRoles(role);
  await modal.save();
  await modal.waitForClosed();
}

const label = (tag: string): string => `${AUTO_TEST_FLAG} ${QA_PREFIX}_${roleStamp()}_${tag}`;

// ---------------------------------------------------------------------------------------------------------------

test.describe('On hold (UAT): what a role allows needs a user to sign in with it', () => {
  for (const id of ['TC-ADMR-03-02', 'TC-ADMR-03-03', 'TC-ADMR-05-02', 'TC-ADMR-05-03', 'TC-ADMR-05-04', 'TC-FROL-03-21', 'TC-FROL-05-03']) {
    test(sheetTitle(id), async () => {
      test.fixme(true, NEEDS_LDAP_ACCOUNT);
    });
  }
});

test.describe('SC-ADMR-02 เพิ่ม แก้ไข ลบสิทธิ์', () => {
  test(sheetTitle('TC-ADMR-02-01'), async ({ page }) => {
    await withCleanup(page, async (track) => {
      const name = label('02-01');
      track.role(name);
      const saved = await saveRole(page, { label: name, description: AUTO_ROLE_DESCRIPTION, levels: { home: 'view', knowledge: 'full', faq: 'view' } });
      expect(saved.status).toBeLessThan(400);
      const roles = new AdminRoleListPage(page);
      await roles.open();
      const row = await roles.findRole(name);
      expect(row, 'listed').toBeDefined();
      expect(Number(row!.users), 'with 0 users').toBe(0);
      const form = await roles.openEditForm(name);
      await form.expectLevels({ home: 'view', knowledge: 'full', faq: 'view' });
    });
  });

  test(sheetTitle('TC-ADMR-02-03'), async ({ page }) => {
    await withCleanup(page, async (track) => {
      const name = label('02-03');
      track.role(name);
      await saveRole(page, { label: name, description: AUTO_ROLE_DESCRIPTION, levels: { home: 'view' } });
      const roles = new AdminRoleListPage(page);
      const form = await roles.openEditForm(name);
      await form.fill({ levels: { home: 'full', content: 'view' } });
      expect((await form.save()).status()).toBeLessThan(400);
      const again = await roles.openEditForm(name);
      await again.expectLevels({ home: 'full', content: 'view' });
      note('That the change reaches users holding the role needs a user to sign in (UAT, DEF-49).');
    });
  });

  for (const id of ['TC-ADMR-02-04', 'TC-ADMR-05-06', 'TC-FROL-05-06']) {
    test(sheetTitle(id), async ({ page }) => {
      await withCleanup(page, async (track) => {
        const roles = new AdminRoleListPage(page);
        const empty = label('empty');
        const held = label('held');
        track.role(empty);
        track.role(held);
        await saveRole(page, { label: empty, description: AUTO_ROLE_DESCRIPTION });
        await saveRole(page, { label: held, description: AUTO_ROLE_DESCRIPTION });
        const username = uniqueUsername();
        track.user(username);
        await userWithRole(page, username, held);
        await roles.open();
        const rows = await roles.readRoles();
        note(`Delete buttons: empty ${rows.find((r) => r.name === empty)?.hasDelete}, held ${rows.find((r) => r.name === held)?.hasDelete}, ผู้ดูแลระบบ ${rows.find((r) => r.name === 'ผู้ดูแลระบบ')?.hasDelete}`);
        expect(rows.find((r) => r.name === 'ผู้ดูแลระบบ')?.hasDelete, '"ผู้ดูแลระบบ" cannot be deleted').toBe(false);
        if (id !== 'TC-FROL-05-06') {
          expect(await removeRole(page, empty), 'a role without users is deleted').toBe(true);
        }
        const heldGone = await removeRole(page, held);
        const userRow = await (await new AdminUserListPage(page).locateUser(username)).innerText();
        note(`Role held by ${username}: deleted ${heldGone}; user row now "${userRow.replace(/\s+/g, ' ')}"`);
        test.fail(heldGone, KNOWN.HELD_ROLE_DELETED);
        expect(heldGone, 'a role a user still holds is protected').toBe(false);
        expect(userRow, 'the user keeps a role').toContain(held);
      });
    });
  }
});

test.describe('SC-ADMR-04 / SC-FROL-02 ความยาวชื่อและคำอธิบายสิทธิ์', () => {
  async function lengthCase(page: Page, field: 'label' | 'description', length: number, ok: boolean): Promise<void> {
    note(`Limit used: ${POLICY_SOURCE}`);
    await withCleanup(page, async (track) => {
      const stamp = roleStamp();
      const value = textOfLength(`${AUTO_TEST_FLAG} ${stamp}`, length);
      const name = field === 'label' ? value : label(stamp);
      track.role(name);
      const saved = await saveRole(page, { label: name, description: field === 'description' ? value : AUTO_ROLE_DESCRIPTION });
      const roles = new AdminRoleListPage(page);
      await roles.open();
      const row = (await roles.readRoles()).find((r) => r.name === name.trim() || r.name.includes(stamp));
      note(`${field} of ${length}: HTTP ${saved.status}; saved ${Boolean(row)}; messages "${saved.messages}"`);
      expect(saved.status, 'no server error').toBeLessThan(500);
      if (ok) {
        expect(row, `${length} characters are saved`).toBeDefined();
        expect(field === 'label' ? row!.name : row!.description, 'shown whole').toBe(value);
        const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
        expect(overflow, 'the list does not break').toBeLessThanOrEqual(1);
        return;
      }
      test.fail(Boolean(row), KNOWN.UNLIMITED);
      expect(row, `${length} characters are not saved`).toBeUndefined();
      expect(saved.messages, 'a length message').toMatch(/ต้องไม่เกิน|ไม่เกิน\s*\d+|ความยาว|\bvalidation\.max/);
      test.fail(RAW.test(saved.messages), KNOWN.RAW_KEY);
      expect(saved.messages, 'readable, not a raw key').not.toMatch(RAW);
    });
  }

  test(sheetTitle('TC-ADMR-04-03'), ({ page }) => lengthCase(page, 'label', MAX_LENGTH.roleLabel, true));
  test(sheetTitle('TC-ADMR-04-04'), ({ page }) => lengthCase(page, 'label', MAX_LENGTH.roleLabel + 1, false));
  test(sheetTitle('TC-FROL-02-04'), ({ page }) => lengthCase(page, 'label', MAX_LENGTH.roleLabel, true));
  test(sheetTitle('TC-FROL-02-05'), ({ page }) => lengthCase(page, 'label', MAX_LENGTH.roleLabel + 1, false));
  test(sheetTitle('TC-FROL-02-14'), ({ page }) => lengthCase(page, 'description', MAX_LENGTH.description, true));
  test(sheetTitle('TC-FROL-02-15'), ({ page }) => lengthCase(page, 'description', MAX_LENGTH.description + 1, false));
});

test.describe('SC-ADMR-05 / SC-FROL-05 กรณีอื่นของสิทธิ์', () => {
  test(sheetTitle('TC-ADMR-05-01'), async ({ page }) => {
    // "แจ้งให้เลือกอย่างน้อยหนึ่งรายการ หรือบันทึกได้โดยผู้ใช้เข้าถึงอะไรไม่ได้ (TBD)": either is fine.
    await withCleanup(page, async (track) => {
      const name = label('empty-perm');
      track.role(name);
      const saved = await saveRole(page, { label: name, description: AUTO_ROLE_DESCRIPTION, levels: {} });
      const roles = new AdminRoleListPage(page);
      await roles.open();
      const row = await roles.findRole(name);
      note(`HTTP ${saved.status}; saved ${Boolean(row)}; messages "${saved.messages}"`);
      expect(saved.status, 'no server error').toBeLessThan(500);
      if (!row) {
        expect(saved.messages, 'refused with a message').not.toBe('');
        return;
      }
      const form = await roles.openEditForm(name);
      for (const module of ['user', 'role', 'home', 'knowledge', 'faq'] as const) expect.soft(await form.levelOf(module), `${module}: no access`).toBe('none');
    });
  });

  test(sheetTitle('TC-ADMR-05-08'), async ({ page }) => {
    const dialogs = collectDialogs(page);
    await withCleanup(page, async (track) => {
      const name = label('05-08');
      track.role(name);
      const description = `${AUTO_TEST_FLAG} <script>alert(1)</script> ${'ก'.repeat(1_000)}`;
      const saved = await saveRole(page, { label: name, description });
      const roles = new AdminRoleListPage(page);
      await roles.open();
      const row = await roles.findRole(name);
      note(`HTTP ${saved.status}; saved ${Boolean(row)} (${row?.description.length ?? 0} characters); messages "${saved.messages}"`);
      expect(saved.status, 'no server error').toBeLessThan(500);
      await page.waitForTimeout(800);
      expect(dialogs, 'no script runs in the role list').toEqual([]);
      expect(await page.locator('table script').count(), 'no script element').toBe(0);
      test.fail(Boolean(row) && row!.description.length > MAX_LENGTH.description, KNOWN.UNLIMITED);
      expect(!row || row.description.length <= MAX_LENGTH.description, `cut or refused at the proposed ${MAX_LENGTH.description}`).toBe(true);
    });
  });

  test(sheetTitle('TC-FROL-05-08'), async ({ page }) => {
    let name = '';
    await withCleanup(page, async (track) => {
      name = label('log');
      track.role(name);
      await saveRole(page, { label: name, description: AUTO_ROLE_DESCRIPTION });
      const form = await new AdminRoleListPage(page).openEditForm(name);
      await form.fill({ description: `${AUTO_ROLE_DESCRIPTION} (แก้ไข)` });
      await form.save();
    });
    const log = new AdminActivityLogPage(page);
    await log.open();
    const rows = (await log.readRows()).filter((r) => r.item.includes(name.split(' ').pop() as string));
    note(`Log rows: ${JSON.stringify(rows.map((r) => [r.time, r.user, r.action, r.item]))}`);
    test.fail(rows.length < 2, KNOWN.NOT_LOGGED);
    expect(rows.length, 'create and edit are logged with the role name, user and time').toBeGreaterThanOrEqual(2);
    expect(rows.every((r) => r.user && r.time), 'each with the user and the time').toBe(true);
  });
});

