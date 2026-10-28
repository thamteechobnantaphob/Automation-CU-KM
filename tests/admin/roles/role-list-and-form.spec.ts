import { test, expect } from '@fixtures/pages.fixtures';
import { SERVER_LEAK_PATTERN } from '@utils/publicPages';
import {
  ROLE_GROUPS,
  ROLE_LEVEL_LABEL,
  ROLE_MODULES,
  topLevelOf,
} from '@pages/admin/AdminRolePages';

/**
 * KM-ADMR (list) and KM-FROL SC-FROL-01 (open/inspect the role form) —
 * /admin/role/index and /admin/role/detail. Everything here is read-only:
 * nothing is saved (TC-FROL-01-04 fills the form but leaves through "ยกเลิก").
 * Runs as admin (default storageState).
 *
 * Spec note: the sheet opens edit pages as /admin/role/detail/1 and /2, but the
 * app uses opaque encrypted ids, so edit pages are reached by clicking the
 * pencil on the role's row.
 */

test.describe('SC-ADMR-01 รายการสิทธิ์การใช้งาน', () => {
  test('TC-ADMR-01-01 [High] แสดงรายการสิทธิ์การใช้งาน', async ({ roleListPage }) => {
    await roleListPage.open();
    await expect(roleListPage.heading).toHaveText('สิทธิ์การใช้งานระบบ');
    await expect(roleListPage.table.locator('thead th')).toHaveText([
      'ลำดับ',
      'สิทธิ์การใช้งาน',
      'จำนวนผู้ใช้',
      'วันที่สร้าง',
      'ผู้สร้าง',
      'จัดการ',
    ]);
    await expect(roleListPage.addRoleLink).toBeVisible();

    const roles = await roleListPage.readRoles();
    const admin = roles.find((role) => role.name === 'ผู้ดูแลระบบ');
    const staff = roles.find((role) => role.name === 'บุคลากรที่ได้รับมอบหมาย');
    expect(admin?.description).toBe('เข้าถึงและจัดการได้ทุกส่วน');
    expect(staff?.description).toBe('จัดการเนื้อหาที่ได้รับมอบหมาย');

    // The sheet quotes "ผู้ดูแลระบบ 1 คน / บุคลากรที่ได้รับมอบหมาย 0 คน" — data that
    // has since changed, so only check that every count is a number.
    for (const role of roles) {
      expect(role.users, `user count of "${role.name}"`).toMatch(/^\d+$/);
      expect(role.created, `created date of "${role.name}"`).not.toBe('');
    }
    // The two built-in roles can be edited but never deleted.
    expect(admin?.hasDelete).toBe(false);
    expect(staff?.hasDelete).toBe(false);

    test.info().annotations.push({
      type: 'note',
      description:
        'Built-in roles show "—" as creator (sheet noted it on 2026-09-21); the created date renders as "18 ก.ย.. 26" (double dot, 2-digit year — the same date-format bug as TC-FEN-03-03).',
    });
  });
});

test.describe('SC-FROL-01 การเปิดฟอร์มสิทธิ์', () => {
  test('TC-FROL-01-01 [High] เปิดหน้าเพิ่มสิทธิ์: โครงสร้างของฟอร์มและตารางสิทธิ์', async ({ page, roleListPage, roleFormPage }) => {
    await roleListPage.open();
    await roleListPage.openAddForm();
    await expect(page).toHaveURL(/\/admin\/role\/detail$/);

    // Name (required) and description (optional).
    await expect(page.getByText('ชื่อสิทธิ์การใช้งานระบบ')).toBeVisible();
    await expect(page.getByText('คำอธิบาย')).toBeVisible();
    await expect(roleFormPage.labelInput).toHaveAttribute('required', '');
    await expect(roleFormPage.descriptionInput).not.toHaveAttribute('required', '');

    // The three level columns; each row has a radio per level it offers (some rows show "—").
    for (const level of Object.values(ROLE_LEVEL_LABEL)) {
      await expect(page.locator('.body-content table thead th').filter({ hasText: level }).first()).toBeVisible();
    }
    await expect(page.locator('input[name^="module_permissions["]')).toHaveCount(ROLE_MODULES.reduce((sum, module) => sum + module.levels.length, 0));
    for (const { key, levels } of ROLE_MODULES) {
      await expect(page.locator(`input[name="module_permissions[${key}]"]`), `levels offered by "${key}"`).toHaveCount(levels.length);
    }

    // Groups and the modules listed under each, in screen order.
    for (const group of ROLE_GROUPS) await expect(roleFormPage.groupHeading(group).first()).toBeVisible();
    for (const group of ROLE_GROUPS) {
      const expected = ROLE_MODULES.filter((module) => module.group === group).map((module) => module.label);
      const rows = roleFormPage.groupRows(group);
      await expect(rows, `modules under "${group}"`).toHaveCount(expected.length);
      for (let index = 0; index < expected.length; index++) {
        await expect(rows.nth(index)).toContainText(expected[index]);
      }
    }

    // The former "สิทธิ์อื่น ๆ" check boxes were removed on 2026-10-01.
    await expect(page.locator('input[name="single_permissions[]"]')).toHaveCount(0);
    await expect(roleFormPage.saveButton).toBeVisible();
    await expect(roleFormPage.cancelLink).toBeVisible();
  });

  test('TC-FROL-01-02 [High] เปิดหน้าเพิ่มสิทธิ์: ค่าเริ่มต้น', async ({ roleFormPage }) => {
    await roleFormPage.openNew();

    await expect(roleFormPage.labelInput).toHaveValue('');
    await expect(roleFormPage.descriptionInput).toHaveValue('');
    for (const { key } of ROLE_MODULES) {
      expect(await roleFormPage.levelOf(key), `default level of "${key}"`).toBe('none');
    }
  });

  test('TC-FROL-01-03 [Medium] แต่ละโมดูลเลือกได้ทีละ 1 ระดับ (radio)', async ({ roleFormPage }) => {
    await roleFormPage.openNew();

    await roleFormPage.selectLevel('home', 'view');
    expect(await roleFormPage.levelOf('home')).toBe('view');
    await roleFormPage.selectLevel('home', 'full');

    // Only the latest level stays selected, and other modules are untouched.
    expect(await roleFormPage.levelOf('home')).toBe('full');
    await expect(roleFormPage.radio('home', 'view')).not.toBeChecked();
    await expect(roleFormPage.radio('home', 'none')).not.toBeChecked();
    for (const { key } of ROLE_MODULES.filter((module) => module.key !== 'home')) {
      expect(await roleFormPage.levelOf(key), `level of "${key}" is untouched`).toBe('none');
    }
  });

  test("TC-FROL-01-04 [High] ปุ่ม 'ยกเลิก' กลับรายการโดยไม่บันทึก", async ({ page, roleListPage, roleFormPage }) => {
    const before = await roleListPage.roleCount();

    await roleListPage.openAddForm();
    // Flagged even though it must NOT be saved: if a bug ever saves it, it can be found.
    await roleFormPage.labelInput.fill('[Auto Test] ไม่ควรถูกบันทึก');
    await roleFormPage.selectLevel('home', 'full');
    await roleFormPage.selectLevel('contact', 'full');
    await roleFormPage.cancelLink.click();

    await expect(page).toHaveURL(/\/admin\/role\/index$/);
    expect(await roleListPage.roleCount(), 'no role was created').toBe(before);
    await expect(roleListPage.rowByName('[Auto Test] ไม่ควรถูกบันทึก')).toHaveCount(0);
  });

  test("TC-FROL-01-05 [High] เปิดหน้าแก้ไขสิทธิ์ 'บุคลากรที่ได้รับมอบหมาย' แสดงข้อมูลเดิมถูกต้อง", async ({
    roleListPage,
    roleFormPage,
  }) => {
    await roleListPage.openEditForm('บุคลากรที่ได้รับมอบหมาย');

    await expect(roleFormPage.labelInput).toHaveValue('บุคลากรที่ได้รับมอบหมาย');
    await expect(roleFormPage.descriptionInput).toHaveValue('จัดการเนื้อหาที่ได้รับมอบหมาย');
    // As seeded on 2026-10-01: no user/role/audit-log rights, dashboard read-only, every content and data row in full.
    await roleFormPage.expectLevels({
      user: 'none',
      role: 'none',
      activity_log: 'none',
      dashboard: 'view',
      home: 'full',
      cop: 'full',
      knowledge: 'full',
      infographic: 'full',
      bestpractice: 'full',
      content: 'full',
      menu: 'full',
      category: 'full',
      contact: 'full',
      faq: 'full',
    });
  });

  test("TC-FROL-01-06 [Medium] เปิดหน้าแก้ไขสิทธิ์ 'ผู้ดูแลระบบ' ทุกช่องเป็นอนุญาตทั้งหมด", async ({
    roleListPage,
    roleFormPage,
  }) => {
    await roleListPage.openEditForm('ผู้ดูแลระบบ');

    // "Everything allowed" = the top level each row offers (read-only rows stop at "อ่านอย่างเดียว").
    for (const { key } of ROLE_MODULES) {
      expect(await roleFormPage.levelOf(key), `level of "${key}"`).toBe(topLevelOf(key));
    }
  });

  test('TC-FROL-01-07 [Medium] เปิดหน้าแก้ไขด้วย id ที่ไม่มี/ไม่ใช่ตัวเลข', async ({ request }) => {
    // KNOWN BUG — confirmed 2026-09-25, same root cause as TC-FEH-04-01 on the
    // public site: ids are encrypted tokens; a purely numeric bad id ("0") gets
    // a clean 404, but "abc", an unknown number and SQL text throw → HTTP 500.
    test.fail(true, 'Known bug: /admin/role/detail/<bad id> ("abc", "999", SQL text) returns HTTP 500 instead of 404.');

    const paths = ['/admin/role/detail/999', '/admin/role/detail/abc', "/admin/role/detail/1'"];
    const problems: string[] = [];
    for (const path of paths) {
      const response = await request.get(path, { maxRedirects: 0 });
      if (response.status() !== 404) problems.push(`${path} → HTTP ${response.status()} (expected 404)`);
      else if (SERVER_LEAK_PATTERN.test(await response.text())) problems.push(`${path} → response leaks server details`);
    }

    expect(problems).toEqual([]);
  });
});
