import { test, expect } from '@fixtures/pages.fixtures';
import { env, requireDataCreatingTestsAllowed } from '@config/env';
import { uniqueUsername } from '@utils/strings';

/**
 * KM-FUSR / SC-FUSR-02 — username (ชื่อผู้ใช้งาน) field validation.
 *
 * Only cases with an unambiguous expected result are implemented here.
 * TC-FUSR-02-04/05/08 depend on an unconfirmed max-length ({MAX} in the
 * source test case) and TC-FUSR-02-02/03/10/14 are Auto:P/M in the sheet —
 * see tests/pending/km-fusr.pending.spec.ts.
 */

test.describe('SC-FUSR-02 ชื่อผู้ใช้งาน (username)', () => {
  test('TC-FUSR-02-01 [High] username ตัวพิมพ์เล็กและตัวเลข: สร้างสำเร็จ', async ({ userListPage }) => {
    requireDataCreatingTestsAllowed('Submitting the form creates a permanent user record.');

    const username = uniqueUsername('lc01');
    await userListPage.open();
    const modal = await userListPage.openAddUserForm();
    await modal.fillWithDefaults({ username });
    await modal.save();
    await modal.waitForClosed();

    await userListPage.expectListed(username);
  });

  test('TC-FUSR-02-06 [High] username เว้นว่าง: เบราว์เซอร์บล็อกการส่งฟอร์ม (required)', async ({
    userListPage,
  }) => {
    await userListPage.open();
    const modal = await userListPage.openAddUserForm();
    await modal.fillWithDefaults({});
    await modal.save();

    await expect(modal.root).toBeVisible(); // still open — never submitted
    const validity = await modal.usernameInput.evaluate((el: HTMLInputElement) => el.validationMessage);
    expect(validity).not.toBe('');
  });

  test('TC-FUSR-02-07 [Medium] username เป็นช่องว่างล้วน: เซิร์ฟเวอร์ต้องปฏิเสธ (ถือว่าว่าง)', async ({
    page,
    userListPage,
  }) => {
    await userListPage.open();
    const before = await userListPage.userCount();

    const modal = await userListPage.openAddUserForm();
    await modal.fillWithDefaults({ username: '     ' });
    await modal.save();
    await page.waitForLoadState('networkidle');

    expect(await userListPage.userCount()).toBe(before);
  });

  test('TC-FUSR-02-09 [High] username มีอักขระ HTML/SQL พิเศษ: ไม่มี script ทำงานและไม่มี SQL error', async ({
    page,
    userListPage,
  }) => {
    let dialogFired = false;
    page.on('dialog', async (dialog) => {
      dialogFired = true;
      await dialog.dismiss();
    });

    await userListPage.open();
    const modal = await userListPage.openAddUserForm();
    await modal.fillWithDefaults({ username: '<script>alert(1)</script>' });
    await modal.save();
    await page.waitForLoadState('networkidle');

    expect(dialogFired).toBe(false);
    await expect(page.locator('body')).not.toContainText(/SQLSTATE|Fatal error|Stack trace/i);
    expect(await page.locator('script:text("alert(1)")').count()).toBe(0);
  });

  test('TC-FUSR-02-11 [High] username ซ้ำกับ admin: ต้องถูกปฏิเสธ', async ({ page, userListPage }) => {
    test.skip(!env.adminUser, 'ADMIN_USER not set in .env');

    await userListPage.open();
    const before = await userListPage.userCount();

    const modal = await userListPage.openAddUserForm();
    await modal.fillWithDefaults({ username: env.adminUser });
    await modal.save();
    await page.waitForLoadState('networkidle');

    expect(await userListPage.userCount()).toBe(before);
  });

  test('TC-FUSR-02-12 [High] username ซ้ำแบบต่างตัวพิมพ์/มีช่องว่างหน้า-หลัง: ต้องถูกปฏิเสธ', async ({
    page,
    userListPage,
  }) => {
    requireDataCreatingTestsAllowed(
      'Seeds a base user (permanent) and, while the known bug exists, the case-variant attempt creates a second permanent user.',
    );

    // KNOWN BUG — confirmed 2026-09-24: submitting username "ADMIN" (the
    // real admin user, uppercased) actually created a new user — visible as
    // its own row in the table afterwards. Duplicate-username checking is
    // not case-insensitive as the source test case requires.
    //
    // Reworked 2026-09-25: that "ADMIN" row is now permanently in the DB, so
    // re-submitting "ADMIN" would be rejected as an *exact* duplicate and
    // prove nothing (and a later "Admin" variant would go the same way after
    // its first run). Instead the test seeds its own unique lowercase user
    // each run and tries case/whitespace variants of THAT — the same rule
    // (case-insensitive, trim-before-compare), repeatable without depending
    // on leftover data. The whitespace-padded variant is only reached once
    // the case variant stops failing.
    test.skip(true, "Retired — Dev 2026-10-02: Won't fix (DEF-1): usernames/emails come from the Chula directory (LDAP), so case-only duplicates are not checked.");
    test.fail(true, 'Known regression: username duplicate check is case-sensitive (accepts "ADMIN" alongside "admin").');

    const base = uniqueUsername('ci');
    await userListPage.open();
    const seed = await userListPage.openAddUserForm();
    await seed.fillWithDefaults({ username: base });
    await seed.save();
    await seed.waitForClosed();
    await userListPage.expectListed(base);

    for (const variant of [base.toUpperCase(), ` ${base} `]) {
      const before = await userListPage.userCount();

      const modal = await userListPage.openAddUserForm();
      await modal.fillWithDefaults({ username: variant });
      await modal.save();
      await page.waitForLoadState('networkidle');

      expect(await userListPage.userCount()).toBe(before);
      if (await modal.root.isVisible()) {
        await modal.cancel();
        // Same race fixed in TC-FUSR-04-06: reopening before the closing
        // dialog is gone makes the next fill() hang.
        await modal.waitForClosed();
      }
    }
  });

  test('TC-FUSR-02-13 [Low] username มีช่องว่างหน้า-หลัง: บันทึกแบบตัดช่องว่างแล้ว', async ({
    userListPage,
  }) => {
    requireDataCreatingTestsAllowed('Submitting the form creates a permanent user record.');

    const trimmed = uniqueUsername('trim');
    await userListPage.open();
    const modal = await userListPage.openAddUserForm();
    await modal.fillWithDefaults({ username: `  ${trimmed}  ` });
    await modal.save();
    await modal.waitForClosed();

    await userListPage.expectListed(trimmed);
  });
});
