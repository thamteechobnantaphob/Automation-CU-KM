import { test, expect } from '@fixtures/pages.fixtures';
import { requireDataCreatingTestsAllowed } from '@config/env';
import { ADMIN_EMAIL } from '@utils/testData';
import { longString, uniqueEmail, uniqueUsername } from '@utils/strings';
import { createUser, expectBlockedByBrowser, expectRejected } from '@utils/userFlows';

/**
 * KM-ADMU / SC-ADMU-06 (อีเมล), from the "เพิ่มผู้ใช้งาน" form. Page-level twin of
 * KM-FUSR SC-FUSR-04 (TC-FUSR-04-*) — same form, so the outcomes should match.
 * The email input is type="email" and NOT required, which decides several
 * results below.
 */

test.describe('SC-ADMU-06 อีเมล', () => {
  test('TC-ADMU-06-01 [High] อีเมล: อีเมลรูปแบบปกติ', async ({ userListPage }) => {
    requireDataCreatingTestsAllowed('Submitting the form creates a permanent user record.');

    const username = uniqueUsername('m01');
    const email = uniqueEmail('m01');
    await createUser(userListPage, { username, email });

    await expect(await userListPage.locateUser(username)).toContainText(email);
  });

  test('TC-ADMU-06-02 [Medium] อีเมล: โดเมนย่อยและเครื่องหมาย +', async ({ userListPage }) => {
    requireDataCreatingTestsAllowed('Submitting the form creates a permanent user record.');

    const username = uniqueUsername('m02');
    const email = `user.name+km_${username}@mail.nurse.chula.ac.th`;
    await createUser(userListPage, { username, email });

    await expect(await userListPage.locateUser(username)).toContainText(email);
  });

  test('TC-ADMU-06-03 [Low] อีเมล: ตัวพิมพ์ใหญ่ผสมตัวพิมพ์เล็ก', async ({ userListPage }) => {
    requireDataCreatingTestsAllowed('Submitting the form creates a permanent user record.');

    // Only the "saves fine" half — the sheet marks the duplicate-ignores-case
    // half TBD, and that behaviour is TC-FUSR-04-12 / TC-ADMU-05-09's known bug.
    const username = uniqueUsername('m03');
    const lower = uniqueEmail('m03');
    const mixed = `${lower.charAt(0).toUpperCase()}${lower.slice(1, -4)}${lower.slice(-4).toUpperCase()}`;
    await createUser(userListPage, { username, email: mixed });

    await expect(await userListPage.locateUser(username)).toContainText(mixed);
  });

  // 06-04 … 06-08: the browser's own type="email" validation must stop these.
  const blockedByBrowser: Array<[string, string, string, string]> = [
    ['TC-ADMU-06-04 [High]', 'อีเมล: ไม่มีเครื่องหมาย @', 'm04', 'user01example.com'],
    ['TC-ADMU-06-05 [High]', 'อีเมล: ไม่มีชื่อโดเมนหลัง @', 'm05', 'user01@'],
    ['TC-ADMU-06-06 [Medium]', 'อีเมล: ไม่มีส่วนหน้า @', 'm06', '@example.com'],
    ['TC-ADMU-06-07 [Medium]', 'อีเมล: มีช่องว่างในอีเมล', 'm07', 'user 01@example.com'],
    ['TC-ADMU-06-08 [Medium]', 'อีเมล: มีเครื่องหมาย @ สองตัว', 'm08', 'user@@example.com'],
  ];
  for (const [id, title, suffix, email] of blockedByBrowser) {
    test(`${id} ${title}`, async ({ userListPage }) => {
      await userListPage.open();
      const modal = await userListPage.openAddUserForm();
      await modal.fillWithDefaults({ username: uniqueUsername(suffix), email });
      await modal.save();

      await expectBlockedByBrowser(modal, 'emailInput');
    });
  }

  test('TC-ADMU-06-09 [Low] อีเมล: มีตัวอักษรภาษาไทย', async ({ page, userListPage }) => {
    requireDataCreatingTestsAllowed('If the app accepts the address it creates a record.');

    // Policy TBD in the sheet ("invalid, or supported by policy"): either the
    // browser rejects it, or the form is submitted and the server must answer
    // without an error. What must not happen is an HTTP 5xx.
    await userListPage.open();
    const modal = await userListPage.openAddUserForm();
    await modal.fillWithDefaults({ username: uniqueUsername('m09'), email: 'ผู้ใช้@example.com' });

    const rejectedByBrowser = !(await modal.emailInput.evaluate((el: HTMLInputElement) => el.checkValidity()));
    if (rejectedByBrowser) {
      await modal.save();
      await expectBlockedByBrowser(modal, 'emailInput');
    } else {
      const [response] = await Promise.all([
        page.waitForResponse((res) => res.request().method() === 'POST'),
        modal.save(),
      ]);
      expect(response.status()).toBeLessThan(500);
    }
  });

  test('TC-ADMU-06-10 [Low] อีเมล: ยาวเกิน 254 ตัวอักษร', async ({ page, userListPage }) => {
    await expectRejected(page, userListPage, {
      username: uniqueUsername('m10'),
      email: `${longString(250, 'a')}@example.com`,
    });
  });

  test('TC-ADMU-06-11 [High] อีเมล: เว้นว่าง', async ({ page, userListPage }) => {
    requireDataCreatingTestsAllowed('While the spec conflict exists, an empty email is accepted and creates a permanent user.');

    // SPEC CONFLICT — this case says an empty email must be refused, but the
    // form does not mark email required, TC-FUSR-04-01 says empty is allowed
    // ("ไม่บังคับ"), and TC-FUSR-04-13 has several users with no email. The
    // app follows the KM-FUSR sheet, so this is expected to fail until SA
    // decides which sheet is right.
    test.fail(true, 'Spec conflict: this case requires an email, TC-FUSR-04-01/04-13 (and the app) treat it as optional.');

    await expectRejected(page, userListPage, { username: uniqueUsername('m11'), email: '' });
  });

  test('TC-ADMU-06-12 [High] อีเมล: อีเมลซ้ำกับผู้ใช้ที่มีอยู่', async ({ page, userListPage }) => {
    await expectRejected(page, userListPage, { username: uniqueUsername('m12'), email: ADMIN_EMAIL });
  });
});
