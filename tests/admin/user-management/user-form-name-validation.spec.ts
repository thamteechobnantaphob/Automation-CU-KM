import { test, expect } from '@fixtures/pages.fixtures';
import { requireDataCreatingTestsAllowed } from '@config/env';
import { uniqueUsername } from '@utils/strings';

/**
 * KM-FUSR / SC-FUSR-03 — ชื่อ-นามสกุล (name) field validation.
 *
 * TC-FUSR-03-04/05 depend on an unconfirmed max-length ({MAX} in the source
 * test case) and TC-FUSR-03-06's expected result is itself "(TBD)" — see
 * tests/pending/km-fusr.pending.spec.ts.
 */

test.describe('SC-FUSR-03 ชื่อ-นามสกุล (name)', () => {
  test('TC-FUSR-03-01 [High] ชื่อ-นามสกุล: ข้อความภาษาไทยปกติ', async ({ userListPage }) => {
    requireDataCreatingTestsAllowed('Submitting the form creates a permanent user record.');

    const username = uniqueUsername('name01');
    const name = 'ระบบจัดการความรู้ทดสอบ';
    await userListPage.open();
    const modal = await userListPage.openAddUserForm();
    await modal.fillWithDefaults({ username, name });
    await modal.save();
    await modal.waitForClosed();

    await expect(await userListPage.locateUser(username)).toContainText(name);
  });

  test('TC-FUSR-03-02 [Medium] ชื่อ-นามสกุล: ภาษาอังกฤษและตัวเลข', async ({ userListPage }) => {
    requireDataCreatingTestsAllowed('Submitting the form creates a permanent user record.');

    const username = uniqueUsername('name02');
    const name = 'Test Case 001';
    await userListPage.open();
    const modal = await userListPage.openAddUserForm();
    await modal.fillWithDefaults({ username, name });
    await modal.save();
    await modal.waitForClosed();

    await expect(await userListPage.locateUser(username)).toContainText(name);
  });

  test('TC-FUSR-03-03 [Medium] ชื่อ-นามสกุล: ผสมไทย/อังกฤษ/ตัวเลข/สัญลักษณ์ทั่วไป', async ({
    userListPage,
  }) => {
    requireDataCreatingTestsAllowed('Submitting the form creates a permanent user record.');

    const username = uniqueUsername('name03');
    const name = 'KM-Day 2569: SHOW & SHARE (รอบ 1)';
    await userListPage.open();
    const modal = await userListPage.openAddUserForm();
    await modal.fillWithDefaults({ username, name });
    await modal.save();
    await modal.waitForClosed();

    // Must render literally — not HTML-entity-encoded (e.g. "&amp;").
    await expect(await userListPage.locateUser(username)).toContainText(name);
  });

  test('TC-FUSR-03-07 [High] ชื่อ-นามสกุล: แท็ก HTML และสคริปต์ ต้องไม่ทำงาน', async ({
    page,
    userListPage,
  }) => {
    // Expected result is "escaped/sanitized" (i.e. saved, just safely) — that
    // path creates a permanent record.
    requireDataCreatingTestsAllowed('Expected result allows the value to be saved (escaped), which creates a record.');

    let dialogFired = false;
    page.on('dialog', async (dialog) => {
      dialogFired = true;
      await dialog.dismiss();
    });

    const username = uniqueUsername('name07');
    await userListPage.open();
    const modal = await userListPage.openAddUserForm();
    await modal.fillWithDefaults({ username, name: '<b>bold</b><script>alert(1)</script>' });
    await modal.save();
    await page.waitForLoadState('networkidle');

    expect(dialogFired).toBe(false);
    expect(await page.locator('script:text("alert(1)")').count()).toBe(0);
  });

  test('TC-FUSR-03-08 [High] ชื่อ-นามสกุล: อักขระ SQL ต้องไม่ทำให้เกิด SQL error', async ({
    page,
    userListPage,
  }) => {
    // Expected result allows "saved as plain text OR rejected" — the save
    // path creates a permanent record.
    requireDataCreatingTestsAllowed('Expected result allows the value to be saved as plain text.');

    const username = uniqueUsername('name08');
    await userListPage.open();
    const modal = await userListPage.openAddUserForm();
    await modal.fillWithDefaults({ username, name: "' OR 1=1; DROP TABLE users;--" });
    await modal.save();
    await page.waitForLoadState('networkidle');

    await expect(page.locator('body')).not.toContainText(/SQLSTATE|Fatal error|Stack trace/i);
  });

  test('TC-FUSR-03-09 [Low] ชื่อ-นามสกุล: อีโมจิและ Unicode พิเศษ ต้องไม่เกิด Error 500', async ({
    page,
    userListPage,
  }) => {
    // Expected result allows either accepting (and saving) or clearly
    // rejecting — the accept path creates a permanent record.
    requireDataCreatingTestsAllowed('Expected result allows the value to be accepted and saved.');

    const username = uniqueUsername('name09');
    await userListPage.open();
    const modal = await userListPage.openAddUserForm();
    await modal.fillWithDefaults({ username, name: 'ทดสอบ 😀 ✓ ①' });

    const [response] = await Promise.all([
      page.waitForResponse((res) => res.request().method() === 'POST'),
      modal.save(),
    ]);
    expect(response.status()).toBeLessThan(500);
  });

  test('TC-FUSR-03-10 [High] ชื่อ-นามสกุล: เว้นว่าง เบราว์เซอร์ต้องบล็อกการส่งฟอร์ม (required)', async ({
    userListPage,
  }) => {
    await userListPage.open();
    const modal = await userListPage.openAddUserForm();
    await modal.fillWithDefaults({ name: '' });
    await modal.save();

    await expect(modal.root).toBeVisible(); // still open — never submitted
    const validity = await modal.nameInput.evaluate((el: HTMLInputElement) => el.validationMessage);
    expect(validity).not.toBe('');
  });

  test('TC-FUSR-03-11 [Medium] ชื่อ-นามสกุล: ช่องว่างล้วน เซิร์ฟเวอร์ต้องปฏิเสธ (ถือว่าว่าง)', async ({
    page,
    userListPage,
  }) => {
    await userListPage.open();
    const before = await userListPage.userCount();

    const modal = await userListPage.openAddUserForm();
    await modal.fillWithDefaults({ username: uniqueUsername('name11'), name: '     ' });
    await modal.save();
    await page.waitForLoadState('networkidle');

    expect(await userListPage.userCount()).toBe(before);
  });
});
