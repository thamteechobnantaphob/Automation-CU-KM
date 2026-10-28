import { test, expect } from '@fixtures/pages.fixtures';
import { requireDataCreatingTestsAllowed } from '@config/env';
import { ROLE_MODULES, RoleLevel } from '@pages/admin/AdminRolePages';
import { AUTO_ROLE_DESCRIPTION, autoRoleLabel, createRole, ROLE_LIST_URL, submitNewRole } from '@utils/roleFlows';

/**
 * KM-FROL / SC-FROL-05 (save, edit, double submit) and KM-ADMR / SC-ADMR-02
 * (empty / duplicate name). Every case SAVES roles, which only
 * `npm run cleanup:roles` can remove, so each role is named "[Auto Test] qa_auto_<stamp>_<tag>"
 * (or carries "[Auto Test]" in its description) and is skipped unless the run
 * allows data-creating tests.
 *
 * The user-assignment cases (TC-FROL-05-04, TC-ADMR-05-07) are in
 * role-user-assignment.spec.ts.
 */

const REASON = 'Submitting the form creates a role that only `npm run cleanup:roles` can remove.';

/** Thai short months as the list prints them (the app renders e.g. "18 ก.ย.. 26"). */
const THAI_MONTHS = ['ม.ค.', 'ก.พ.', 'มี.ค.', 'เม.ย.', 'พ.ค.', 'มิ.ย.', 'ก.ค.', 'ส.ค.', 'ก.ย.', 'ต.ค.', 'พ.ย.', 'ธ.ค.'];

function todayInBangkok(): { day: number; monthIndex: number } {
  const parts = new Intl.DateTimeFormat('en-GB', { timeZone: 'Asia/Bangkok', day: 'numeric', month: 'numeric' }).formatToParts(new Date());
  return {
    day: Number(parts.find((part) => part.type === 'day')?.value),
    monthIndex: Number(parts.find((part) => part.type === 'month')?.value) - 1,
  };
}

test.describe('SC-FROL-05 การบันทึก แก้ไข และผลกับผู้ใช้', () => {
  test.setTimeout(90_000);
  test.beforeEach(() => requireDataCreatingTestsAllowed(REASON));

  test('TC-FROL-05-01 [High] สร้างสิทธิ์ใหม่สำเร็จและปรากฏในรายการ', async ({ page, roleListPage, roleFormPage }) => {
    const label = autoRoleLabel('05-01');
    const description = 'สิทธิ์ทดสอบ';
    const before = await roleListPage.roleCount();

    await submitNewRole(roleListPage, roleFormPage, { label, description, levels: { content: 'full', knowledge: 'view' } });

    // Back on the list with a success message.
    await expect(page).toHaveURL(ROLE_LIST_URL);
    await expect(roleListPage.flash, 'a success message is shown after saving').toBeVisible();
    test.info().annotations.push({ type: 'note', description: `Flash message: "${(await roleListPage.flash.innerText()).trim()}"` });

    // The new row: name, description, 0 users, today's date, a creator.
    const row = await roleListPage.findRole(label);
    expect(row, `role "${label}" is in the list`).toBeDefined();
    expect(row?.description).toBe(description);
    expect(row?.users).toBe('0');
    expect(row?.creator, 'creator is filled in').not.toBe('');
    expect(await roleListPage.roleCount(), 'exactly one role was added').toBe(before + 1);

    const today = todayInBangkok();
    expect(row?.created, 'created date shows today (day and Thai month)').toContain(String(today.day));
    expect(row?.created).toContain(THAI_MONTHS[today.monthIndex]);

    // Opening it back shows exactly what was set, module by module.
    const form = await roleListPage.openEditForm(label);
    await expect(form.labelInput).toHaveValue(label);
    await expect(form.descriptionInput).toHaveValue(description);
    const expected: Record<string, RoleLevel> = { content: 'full', knowledge: 'view' };
    for (const { key } of ROLE_MODULES) {
      expect(await form.levelOf(key), `level of "${key}"`).toBe(expected[key] ?? 'none');
    }
  });

  test('TC-FROL-05-02 [High] แก้ไขสิทธิ์แล้วบันทึก ค่าใหม่คงอยู่', async ({ page, roleListPage, roleFormPage }) => {
    // Precondition: a role of our own (never one of the built-in roles).
    const label = autoRoleLabel('05-02');
    const description = 'สิทธิ์ทดสอบ (ก่อนแก้ไข)';
    await createRole(page, roleListPage, roleFormPage, { label, description, levels: { home: 'view', knowledge: 'view' } });

    const form = await roleListPage.openEditForm(label);
    await form.selectLevel('knowledge', 'full');
    await form.selectLevel('contact', 'full');
    const response = await form.save();
    expect(response.status(), 'saving an edit is not a server error').toBeLessThan(500);
    await expect(page).toHaveURL(ROLE_LIST_URL);

    // Re-open: the two changes stuck, everything else is as before.
    const reopened = await roleListPage.openEditForm(label);
    await expect(reopened.labelInput).toHaveValue(label);
    await expect(reopened.descriptionInput).toHaveValue(description);
    const expected: Record<string, RoleLevel> = { home: 'view', knowledge: 'full', contact: 'full' };
    for (const { key } of ROLE_MODULES) {
      expect(await reopened.levelOf(key), `level of "${key}"`).toBe(expected[key] ?? 'none');
    }
    await roleListPage.open();
    expect((await roleListPage.findRole(label))?.description).toBe(description);
  });

  test('TC-FROL-05-07 [Medium] กดบันทึกซ้ำรัวๆ ไม่สร้างสิทธิ์ซ้ำ', async ({ page, roleListPage, roleFormPage }) => {
    const label = autoRoleLabel('05-07');
    const before = await roleListPage.roleCount();

    await roleListPage.openAddForm();
    await roleFormPage.fill({ label, description: AUTO_ROLE_DESCRIPTION, levels: { home: 'view' } });
    // Five real clicks in quick succession. The first submits and navigates; the
    // rest may hit a disabled button or a page that is going away — both are fine.
    await roleFormPage.saveButton.click({ clickCount: 5, delay: 20, noWaitAfter: true }).catch(() => undefined);
    await expect(page).toHaveURL(ROLE_LIST_URL, { timeout: 30_000 });
    await page.waitForLoadState('networkidle');

    // Let any late duplicate request land, then count from a fresh load.
    await page.waitForTimeout(2_000);
    await roleListPage.open();
    const roles = await roleListPage.readRoles();
    expect(roles.filter((role) => role.name === label), 'exactly one role with this name').toHaveLength(1);
    expect(await roleListPage.roleCount(), 'exactly one role was added').toBe(before + 1);
  });
});

test.describe('SC-ADMR-02 เพิ่ม แก้ไข ลบ สิทธิ์', () => {
  test.setTimeout(90_000);
  test.beforeEach(() => requireDataCreatingTestsAllowed(REASON));

  test('TC-ADMR-02-02 [Medium] เพิ่มสิทธิ์โดยไม่กรอกชื่อ / ชื่อซ้ำ', async ({ page, roleListPage, roleFormPage }) => {
    // KNOWN BUG — confirmed 2026-09-25 (evidence/2026-09-25_2011): step 1 (no name) is stopped by the
    // browser, but the server accepts a duplicate name — both a second "ผู้ดูแลระบบ" (the role picker
    // in the user form then lists two indistinguishable options, ids 1 and 22) and a copy of a role
    // of our own. The sheet expects "ระบบปฏิเสธและแจ้งชื่อซ้ำ".
    test.fail(true, 'Known bug: the server accepts a duplicate role name (also "ผู้ดูแลระบบ"), the sheet expects it to be rejected.');

    const before = await roleListPage.roleCount();

    // 1) No name: the browser stops the form.
    await roleListPage.openAddForm();
    await roleFormPage.fill({ description: AUTO_ROLE_DESCRIPTION, levels: { home: 'view' } });
    await roleFormPage.saveButton.click();
    await expect(page).toHaveURL(/\/admin\/role\/detail$/);
    expect(await roleFormPage.labelInput.evaluate((el: HTMLInputElement) => el.validationMessage), 'validation on the empty name').not.toBe('');
    expect(await roleListPage.roleCount(), 'no role was created without a name').toBe(before);

    // 2) A name that already exists (the built-in role): must be refused. The
    // description carries the marker, so if a copy DOES get saved it can still be cleaned up.
    const duplicateOfBuiltIn = await submitNewRole(roleListPage, roleFormPage, { label: 'ผู้ดูแลระบบ', description: AUTO_ROLE_DESCRIPTION });
    expect.soft(duplicateOfBuiltIn.status(), 'no server error on a duplicate name').toBeLessThan(500);
    const afterBuiltIn = await roleListPage.roleCount();
    test.info().annotations.push({ type: 'note', description: `Duplicate of built-in "ผู้ดูแลระบบ": ${afterBuiltIn === before ? 'rejected' : 'ACCEPTED (a second role with the same name now exists)'}.` });
    expect.soft(afterBuiltIn, 'a role named "ผู้ดูแลระบบ" must not be created twice').toBe(before);

    // 3) Same name as a role of our own.
    const label = autoRoleLabel('02-02');
    await createRole(page, roleListPage, roleFormPage, { label, description: AUTO_ROLE_DESCRIPTION });
    const countWithOwn = await roleListPage.roleCount();
    const duplicateOfOwn = await submitNewRole(roleListPage, roleFormPage, { label, description: AUTO_ROLE_DESCRIPTION });
    expect.soft(duplicateOfOwn.status(), 'no server error on a duplicate name').toBeLessThan(500);
    const afterOwn = await roleListPage.roleCount();
    test.info().annotations.push({ type: 'note', description: `Duplicate of own role: ${afterOwn === countWithOwn ? 'rejected' : 'ACCEPTED'}.` });
    expect.soft(afterOwn, 'the same role name must not be created twice').toBe(countWithOwn);
  });
});
