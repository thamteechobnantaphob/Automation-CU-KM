import { Locator } from '@playwright/test';
import { test, expect } from '@fixtures/pages.fixtures';
import { env, requireDataCreatingTestsAllowed } from '@config/env';
import { AUTO_TEST_FLAG, DEFAULT_TEST_NAME, VALID_PASSWORD } from '@utils/testData';
import { uniqueUsername } from '@utils/strings';

/**
 * KM-FUSR / SC-FUSR-01 — /admin/user/index, "เพิ่มผู้ใช้งาน" / "แก้ไขผู้ใช้งาน" modal.
 * Runs with the default admin storageState (see playwright.config.ts).
 */

test.describe('SC-FUSR-01 การเปิด ปิด และค่าเริ่มต้นของฟอร์ม', () => {
  test('TC-FUSR-01-01 [High] เปิด modal เพิ่มผู้ใช้งาน แสดงฟอร์มครบและค่าเริ่มต้นถูกต้อง', async ({
    userListPage,
  }) => {
    await userListPage.open();
    const modal = await userListPage.openAddUserForm();

    await expect(modal.title).toContainText('เพิ่มผู้ใช้งาน');
    await expect(modal.usernameInput).toHaveValue('');
    await expect(modal.nameInput).toHaveValue('');
    await expect(modal.emailInput).toHaveValue('');
    await expect(modal.departmentInput).toHaveValue('');
    await expect(modal.positionInput).toHaveValue('');
    await expect(modal.statusActiveRadio).toBeChecked();
    // By design since 2026-10-01 (QA, 2026-10-02): sign-in is through LDAP and no password is stored, so the form
    // has no password, confirmation or "บัญชี AD/LDAP" field — the sheet's expected list is out of date (DEF-49).
    await expect(modal.passwordInput).toHaveCount(0);
    await expect(modal.passwordConfirmationInput).toHaveCount(0);
    await expect(modal.ldapCheckbox).toHaveCount(0);
    await expect(modal.usernameInput).toHaveAttribute('required', '');
    await expect(modal.nameInput).toHaveAttribute('required', '');
  });

  test("TC-FUSR-01-02 [High] ปุ่ม 'ยกเลิก' ปิดฟอร์มโดยไม่บันทึก", async ({ userListPage }) => {
    await userListPage.open();
    const before = await userListPage.userCount();

    const modal = await userListPage.openAddUserForm();
    // Flagged even though it must NOT save: if a bug ever saves it, it's findable.
    await modal.fill({ username: 'qa_auto_should_not_save', name: `${AUTO_TEST_FLAG} ไม่ควรถูกบันทึก` });
    await modal.cancel();
    await modal.waitForClosed();

    expect(await userListPage.userCount()).toBe(before);
  });

  test('TC-FUSR-01-03 [Medium] เปิดฟอร์มใหม่หลังกดยกเลิก ต้องไม่เหลือค่าเดิม', async ({
    userListPage,
  }) => {
    await userListPage.open();

    let modal = await userListPage.openAddUserForm();
    await modal.fill({ username: 'qa_auto_leftover_data', name: `${AUTO_TEST_FLAG} ข้อมูลค้าง` });
    await modal.cancel();
    await modal.waitForClosed();

    modal = await userListPage.openAddUserForm();
    await expect(modal.usernameInput).toHaveValue('');
    await expect(modal.nameInput).toHaveValue('');
  });

  test('TC-FUSR-01-04 [Low] กด Esc ปิดฟอร์มโดยไม่บันทึกข้อมูล', async ({ userListPage }) => {
    await userListPage.open();
    const before = await userListPage.userCount();

    const modal = await userListPage.openAddUserForm();
    await modal.fill({ username: 'qa_auto_esc_should_not_save', name: `${AUTO_TEST_FLAG} ปิดด้วย Esc` });
    await modal.closeWithEscape();
    await modal.waitForClosed();

    expect(await userListPage.userCount()).toBe(before);
  });

  test("TC-FUSR-01-05 [High] คลิกไอคอนดินสอเปิด modal 'แก้ไขผู้ใช้งาน' พร้อมข้อมูลเดิม", async ({
    userListPage,
  }) => {
    test.skip(!env.adminUser, 'ADMIN_USER not set in .env');

    await userListPage.open();
    const modal = await userListPage.openEditUserForm(env.adminUser);

    await expect(modal.title).toContainText('แก้ไขผู้ใช้งาน');
    await expect(modal.usernameInput).toHaveValue(env.adminUser);
    await expect(modal.nameInput).not.toHaveValue('');
    await expect(modal.passwordInput, 'no password field: LDAP sign-in, by design (DEF-49)').toHaveCount(0);
  });

  test("TC-FUSR-01-07 [Low] กด Enter ในช่องข้อความเพื่อส่งฟอร์ม", async ({ userListPage }) => {
    requireDataCreatingTestsAllowed('Submitting the form creates a permanent user record.');

    const username = uniqueUsername('enter');
    await userListPage.open();
    const modal = await userListPage.openAddUserForm();
    await modal.fill({
      username,
      name: DEFAULT_TEST_NAME,
      position: 'QA Automation',
      password: VALID_PASSWORD,
      passwordConfirmation: VALID_PASSWORD,
    });
    await modal.positionInput.press('Enter');
    await modal.waitForClosed();

    await userListPage.expectListed(username);
  });

  test('TC-FUSR-01-08 [Low] ลำดับการกด Tab ในฟอร์ม', async ({ page, userListPage }) => {
    // NOTE: one run observed the "เลือกสิทธิ์การใช้งาน" dropdown toggle with
    // tabindex="-1" (Tab skipped over it), but a later run passed cleanly —
    // looks like a bootstrap-select initialization timing issue rather than
    // a consistent bug. If this starts failing again, check whether the
    // widget's JS has finished setting up by the time we reach it.
    await userListPage.open();
    const modal = await userListPage.openAddUserForm();

    await modal.usernameInput.focus();
    await expect(modal.usernameInput).toBeFocused();

    const expectedOrder: Locator[] = [
      modal.nameInput,
      modal.emailInput,
      modal.departmentInput,
      modal.positionInput,
      modal.rolesDropdownToggle,
      // (no AD/LDAP checkbox or password fields: LDAP sign-in, by design — DEF-49)
      modal.statusActiveRadio,
      modal.cancelButton,
      modal.saveButton,
    ];
    for (const field of expectedOrder) {
      await page.keyboard.press('Tab');
      await expect(field).toBeFocused();
    }
  });

  test('TC-FUSR-01-09 [Low] modal แสดงผลบนหน้าจอมือถือ (375px)', async ({ page, userListPage }) => {
    // ON HOLD (2026-09-25) — awaiting a decision from dev & SA. At 375px the
    // sidebar opens expanded by default and covers the "เพิ่มผู้ใช้งาน"
    // button (click is blocked: "#sidebar intercepts pointer events"). It has
    // a « collapse button, so it's undecided whether that's a responsive
    // defect or intended behavior. Evidence: evidence/2026-09-25_1542/
    // screenshots/TC-FUSR-01-09.png. Remove this line once decided: if it's
    // a defect, replace with test.fail(); if intended, collapse the sidebar
    // first and assert only the modal behaviour below.
    test.fixme(true, 'On hold: awaiting dev & SA decision — sidebar covers the add-user button at 375px (defect or by design?).');

    await page.setViewportSize({ width: 375, height: 812 });
    await userListPage.open();
    const modal = await userListPage.openAddUserForm();

    await expect(modal.saveButton).toBeVisible();
    await expect(modal.cancelButton).toBeVisible();
    const box = await modal.root.boundingBox();
    expect(box?.width ?? 0).toBeLessThanOrEqual(375);
  });
});
