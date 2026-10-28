import { test, expect } from '@fixtures/pages.fixtures';
import { requireDataCreatingTestsAllowed } from '@config/env';
import { uniqueUsername } from '@utils/strings';

/**
 * KM-FUSR / SC-FUSR-05 — หน่วยงาน (department) และตำแหน่ง (position) fields.
 * Both fields are optional free text with no client-side validation, so
 * every implemented case here ends in a successful save — all gated behind
 * ALLOW_DATA_CREATING_TESTS.
 *
 * TC-FUSR-05-04/05/12/13 depend on an unconfirmed max-length ({MAX}) and
 * TC-FUSR-05-06's expected result is itself "(TBD)" — see
 * tests/pending/km-fusr.pending.spec.ts.
 */

test.describe('SC-FUSR-05 หน่วยงาน (department) และตำแหน่ง (position)', () => {
  test('TC-FUSR-05-01 [High] หน่วยงาน: ข้อความภาษาไทยปกติ', async ({ userListPage }) => {
    requireDataCreatingTestsAllowed('Submitting the form creates a permanent user record.');

    const username = uniqueUsername('dept01');
    const department = 'ระบบจัดการความรู้ทดสอบ';
    await userListPage.open();
    const modal = await userListPage.openAddUserForm();
    await modal.fillWithDefaults({ username, department });
    await modal.save();
    await modal.waitForClosed();

    await userListPage.expectListed(username);
  });

  test('TC-FUSR-05-02 [Medium] หน่วยงาน: ภาษาอังกฤษและตัวเลข', async ({ userListPage }) => {
    requireDataCreatingTestsAllowed('Submitting the form creates a permanent user record.');

    const username = uniqueUsername('dept02');
    await userListPage.open();
    const modal = await userListPage.openAddUserForm();
    await modal.fillWithDefaults({ username, department: 'Test Case 001' });
    await modal.save();
    await modal.waitForClosed();

    await userListPage.expectListed(username);
  });

  test('TC-FUSR-05-03 [Medium] หน่วยงาน: ผสมไทย/อังกฤษ/ตัวเลข/สัญลักษณ์ทั่วไป', async ({
    userListPage,
  }) => {
    requireDataCreatingTestsAllowed('Submitting the form creates a permanent user record.');

    const username = uniqueUsername('dept03');
    await userListPage.open();
    const modal = await userListPage.openAddUserForm();
    await modal.fillWithDefaults({ username, department: 'KM-Day 2569: SHOW & SHARE (รอบ 1)' });
    await modal.save();
    await modal.waitForClosed();

    await userListPage.expectListed(username);
  });

  test('TC-FUSR-05-07 [High] หน่วยงาน: แท็ก HTML และสคริปต์ ต้องไม่ทำงาน', async ({
    page,
    userListPage,
  }) => {
    requireDataCreatingTestsAllowed('Expected result allows the value to be saved (escaped).');

    let dialogFired = false;
    page.on('dialog', async (dialog) => {
      dialogFired = true;
      await dialog.dismiss();
    });

    const username = uniqueUsername('dept07');
    await userListPage.open();
    const modal = await userListPage.openAddUserForm();
    await modal.fillWithDefaults({ username, department: '<b>bold</b><script>alert(1)</script>' });
    await modal.save();
    await page.waitForLoadState('networkidle');

    expect(dialogFired).toBe(false);
    expect(await page.locator('script:text("alert(1)")').count()).toBe(0);
  });

  test('TC-FUSR-05-08 [High] หน่วยงาน: อักขระ SQL ต้องไม่ทำให้เกิด SQL error', async ({
    page,
    userListPage,
  }) => {
    requireDataCreatingTestsAllowed('Expected result allows the value to be saved as plain text.');

    const username = uniqueUsername('dept08');
    await userListPage.open();
    const modal = await userListPage.openAddUserForm();
    await modal.fillWithDefaults({ username, department: "' OR 1=1; DROP TABLE users;--" });
    await modal.save();
    await page.waitForLoadState('networkidle');

    await expect(page.locator('body')).not.toContainText(/SQLSTATE|Fatal error|Stack trace/i);
  });

  test('TC-FUSR-05-09 [Low] หน่วยงาน: อีโมจิและ Unicode พิเศษ ต้องไม่เกิด Error 500', async ({
    page,
    userListPage,
  }) => {
    requireDataCreatingTestsAllowed('Expected result allows the value to be accepted and saved.');

    const username = uniqueUsername('dept09');
    await userListPage.open();
    const modal = await userListPage.openAddUserForm();
    await modal.fillWithDefaults({ username, department: 'ทดสอบ 😀 ✓ ①' });

    const [response] = await Promise.all([
      page.waitForResponse((res) => res.request().method() === 'POST'),
      modal.save(),
    ]);
    expect(response.status()).toBeLessThan(500);
  });

  test('TC-FUSR-05-10 [Medium] หน่วยงาน: เว้นว่าง (ไม่บังคับ) สร้างสำเร็จ', async ({ userListPage }) => {
    requireDataCreatingTestsAllowed('Submitting the form creates a permanent user record.');

    const username = uniqueUsername('dept10');
    await userListPage.open();
    const modal = await userListPage.openAddUserForm();
    await modal.fillWithDefaults({ username, department: '' });
    await modal.save();
    await modal.waitForClosed();

    await userListPage.expectListed(username);
  });

  test('TC-FUSR-05-11 [High] ตำแหน่ง: ข้อความภาษาไทยปกติ', async ({ userListPage }) => {
    requireDataCreatingTestsAllowed('Submitting the form creates a permanent user record.');

    const username = uniqueUsername('pos11');
    const position = 'ระบบจัดการความรู้ทดสอบ';
    await userListPage.open();
    const modal = await userListPage.openAddUserForm();
    await modal.fillWithDefaults({ username, position });
    await modal.save();
    await modal.waitForClosed();

    await userListPage.expectListed(username);
  });

  test('TC-FUSR-05-14 [High] ตำแหน่ง: แท็ก HTML และสคริปต์ ต้องไม่ทำงาน', async ({
    page,
    userListPage,
  }) => {
    requireDataCreatingTestsAllowed('Expected result allows the value to be saved (escaped).');

    let dialogFired = false;
    page.on('dialog', async (dialog) => {
      dialogFired = true;
      await dialog.dismiss();
    });

    const username = uniqueUsername('pos14');
    await userListPage.open();
    const modal = await userListPage.openAddUserForm();
    await modal.fillWithDefaults({ username, position: '<b>bold</b><script>alert(1)</script>' });
    await modal.save();
    await page.waitForLoadState('networkidle');

    expect(dialogFired).toBe(false);
    expect(await page.locator('script:text("alert(1)")').count()).toBe(0);
  });

  test('TC-FUSR-05-15 [Medium] ตำแหน่ง: เว้นว่าง (ไม่บังคับ) สร้างสำเร็จ', async ({ userListPage }) => {
    requireDataCreatingTestsAllowed('Submitting the form creates a permanent user record.');

    const username = uniqueUsername('pos15');
    await userListPage.open();
    const modal = await userListPage.openAddUserForm();
    await modal.fillWithDefaults({ username, position: '' });
    await modal.save();
    await modal.waitForClosed();

    await userListPage.expectListed(username);
  });
});
