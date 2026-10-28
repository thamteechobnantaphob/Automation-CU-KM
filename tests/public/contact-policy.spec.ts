import { test, expect, ANONYMOUS_SESSION } from '@fixtures/pages.fixtures';
import { requireDataCreatingTestsAllowed } from '@config/env';
import { MAX_LENGTH, POLICY_SOURCE, SESSION } from '@config/policy';
import { AdminContactPage, ContactMessage } from '@pages/admin/AdminContactPage';
import { ContactPage } from '@pages/public/ContactPage';
import { adminSession, bySubject, contactMarker, deleteMessagesWhere, withContactMessage } from '@utils/contactFlows';
import { sheetTitle } from '@utils/caseTitles';
import { urlOf } from '@utils/lowPrivilege';
import { collectDialogs } from '@utils/security';
import { AUTO_TEST_FLAG } from '@utils/testData';
import { Page } from '@playwright/test';
import { ADMIN_AUTH_FILE } from '../../global-setup';
import { textOfLength } from '../admin/content/contentLimitsSuite';

/**
 * KM-FECT — the public contact form (Auto:P + the {MAX} cases), checked 2026-10-07. Limits are the OWASP-based
 * proposals in src/config/policy.ts (name 100, message 5,000 characters, 5 posts per 10 minutes) until SA/Dev decide.
 * The form has NO file field (name, email, subject, message only): every attachment case is a spec mismatch (DEF-106)
 * and only checks that a file field exists.
 * `page` is an anonymous visitor; the admin side runs in its own logged-in context. Every message carries "[Auto Test]"
 * + a stamp as its subject and is deleted again by the case.
 */

test.use({ storageState: ANONYMOUS_SESSION });

const SENDS = 'Sends a contact message (deleted again at the end of the case).';
const KNOWN = {
  NO_ATTACHMENT: 'Spec mismatch (DEF-106): the contact form has no file field ("ไฟล์แนบ") — the attachment cases cannot be run (SA: drop them or add the field).',
  UNLIMITED: 'Known bug (DEF-101): the field has no length limit — one character over the proposed maximum is accepted.',
  RAW_KEY: 'Known bug (DEF-66): the length is refused but the message is the raw key "validation.max.string".',
  VIEW_EMPTY: 'Known bug (DEF-73): the admin message panel never shows the message text.',
};
const RAW = /\bvalidation\.[a-z_.]+/i;

let admin: { page: Page; close: () => Promise<void> };

test.beforeEach(async ({ browser }) => {
  test.setTimeout(200_000); // a 429 from the rate-limited form is waited out
  admin = await adminSession(browser, ADMIN_AUTH_FILE);
});

test.afterEach(async () => {
  await admin?.close();
});

function note(description: string): void {
  test.info().annotations.push({ type: 'note', description });
}

const stored = (subject: string): Promise<ContactMessage | undefined> => new AdminContactPage(admin.page).findMessage(bySubject(subject)).then((found) => found?.message);

/** The attachment cases: the form must offer a file field (it does not — DEF-106). */
async function attachmentCase(page: Page): Promise<void> {
  test.fail(true, KNOWN.NO_ATTACHMENT);
  const contact = new ContactPage(page);
  expect(await contact.openContact()).toBe(200);
  const fields = await contact.form.locator('[name]').evaluateAll((els) => els.map((e) => `${e.tagName.toLowerCase()}[${(e as HTMLInputElement).type}] ${(e as HTMLInputElement).name}`));
  note(`Form fields: ${JSON.stringify(fields)}`);
  expect(await contact.form.locator('input[type="file"]').count(), 'the form has a file field ("ไฟล์แนบ")').toBeGreaterThan(0);
}

/** A field of exactly `max` characters is sent and stored whole; the admin list does not scroll sideways. */
async function atMax(page: Page, field: 'name' | 'message', max: number): Promise<void> {
  requireDataCreatingTestsAllowed(SENDS);
  note(`Limit used: ${POLICY_SOURCE}`);
  const value = textOfLength(`${AUTO_TEST_FLAG} ${field}`, max);
  await withContactMessage(page, admin.page, { [field]: value }, async (sent, subject) => {
    note(`Post ${sent.first} → ${sent.final}; success ${sent.success}; errors ${JSON.stringify(sent.errors)}`);
    expect(sent.success, `${max} characters are sent`).toBe(true);
    const message = await stored(subject);
    expect(message?.[field], 'stored whole').toBe(value);
    const overflow = await admin.page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
    expect(overflow, 'the admin list does not break (no sideways scroll)').toBeLessThanOrEqual(1);
  });
}

/** `max` + 1 characters: refused with a readable length message (or the input stops at `max`); never a 500. */
async function overMax(page: Page, field: 'name' | 'message', max: number): Promise<void> {
  requireDataCreatingTestsAllowed(SENDS);
  note(`Limit used: ${POLICY_SOURCE}`);
  const contact = new ContactPage(page);
  await contact.openContact();
  const maxlength = await (field === 'name' ? contact.nameInput : contact.messageInput).getAttribute('maxlength');
  note(`maxlength: ${maxlength ?? '(none)'}`);
  if (maxlength && Number(maxlength) <= max) return;
  const value = textOfLength(`${AUTO_TEST_FLAG} ${field}`, max + 1);
  await withContactMessage(page, admin.page, { [field]: value }, async (sent, subject) => {
    note(`Post ${sent.first} → ${sent.final}; success ${sent.success}; errors ${JSON.stringify(sent.errors)}`);
    expect(sent.final, 'no server error').toBeLessThan(500);
    const message = await stored(subject);
    test.fail(Boolean(message), KNOWN.UNLIMITED);
    expect(message, `${max + 1} characters are not stored`).toBeUndefined();
    const error = sent.errors[field] ?? '';
    expect(error, 'a message about the length').toMatch(/ต้องไม่เกิน|ไม่เกิน\s*\d+|ยาวเกิน|ความยาว|\bvalidation\.max/);
    test.fail(RAW.test(error), KNOWN.RAW_KEY);
    expect(error, 'a readable message, not a raw key').not.toMatch(RAW);
  });
}

// ---------------------------------------------------------------------------------------------------------------

test.describe('SC-FECT-02 ส่งแบบฟอร์ม', () => {
  test(sheetTitle('TC-FECT-02-01'), async ({ page }) => {
    requireDataCreatingTestsAllowed(SENDS);
    await withContactMessage(page, admin.page, {}, async (sent, subject) => {
      expect(sent.success, 'the success message is shown').toBe(true);
      await expect(new ContactPage(page).successModal, '"สำเร็จ! ระบบได้บันทึกข้อมูลของคุณเรียบร้อยแล้ว"').toContainText('สำเร็จ');
      expect(sent.values, 'the form is cleared').toEqual({ name: '', email: '', subject: '', message: '' });
      expect(await stored(subject), 'listed under "รายการข้อความติดต่อ"').toBeDefined();
    });
  });
  test(sheetTitle('TC-FECT-02-02'), ({ page }) => attachmentCase(page));
  test(sheetTitle('TC-FECT-02-05'), ({ page }) => attachmentCase(page));
  test(sheetTitle('TC-FECT-02-06'), ({ page }) => attachmentCase(page));

  test(sheetTitle('TC-FECT-02-07'), async ({ page }) => {
    requireDataCreatingTestsAllowed(SENDS);
    const payload = `${AUTO_TEST_FLAG} <script>alert('xss')</script><img src=x onerror=alert(1)><b>bold</b>`;
    const adminDialogs = collectDialogs(admin.page);
    const visitorDialogs = collectDialogs(page);
    await withContactMessage(page, admin.page, { message: payload, name: `${AUTO_TEST_FLAG} <i>ชื่อ</i>` }, async (sent, subject) => {
      expect(sent.success, 'sent').toBe(true);
      const message = await stored(subject);
      expect(message?.message, 'stored as typed').toBe(payload);
      const contact = new AdminContactPage(admin.page);
      await contact.messagesTab.click();
      expect(await admin.page.locator('#pills-message img[src="x"], #pills-message b, #pills-message i').count(), 'not rendered as markup in the list').toBe(0);
      const view = await contact.viewMessage(bySubject(subject));
      note(`View panel: ${JSON.stringify(view)}`);
      expect(await admin.page.locator('#viewMod img[src="x"], #viewMod script').count(), 'not rendered as markup in the panel').toBe(0);
      await admin.page.waitForTimeout(1_000);
      expect(adminDialogs, 'no script runs in the admin').toEqual([]);
      expect(visitorDialogs, 'no script runs on the public page').toEqual([]);
    });
  });
});

test.describe('SC-FECT-03 ความยาวชื่อและข้อความ', () => {
  test(sheetTitle('TC-FECT-03-03'), ({ page }) => atMax(page, 'name', MAX_LENGTH.contactName));
  test(sheetTitle('TC-FECT-03-04'), ({ page }) => overMax(page, 'name', MAX_LENGTH.contactName));
  test(sheetTitle('TC-FECT-03-19'), ({ page }) => atMax(page, 'message', MAX_LENGTH.contactMessage));
  test(sheetTitle('TC-FECT-03-20'), ({ page }) => overMax(page, 'message', MAX_LENGTH.contactMessage));
});

test.describe('SC-FECT-03 ไฟล์แนบ', () => {
  for (const id of ['TC-FECT-03-24', 'TC-FECT-03-25', 'TC-FECT-03-26', 'TC-FECT-03-28', 'TC-FECT-03-29', 'TC-FECT-03-30', 'TC-FECT-03-31', 'TC-FECT-03-32', 'TC-FECT-03-33', 'TC-FECT-03-34', 'TC-FECT-03-35', 'TC-FECT-03-36']) {
    test(sheetTitle(id), ({ page }) => attachmentCase(page));
  }
});

test.describe('SC-FECT-04 การส่งซ้ำ', () => {
  test(sheetTitle('TC-FECT-04-04'), async ({ page }) => {
    test.setTimeout(420_000); // the form may still be throttled by the cases before it
    requireDataCreatingTestsAllowed('Posts the contact form several times in a row (every stored message is deleted again).');
    note(`Limit used: ${POLICY_SOURCE} — at most ${SESSION.contactPostsPer10Minutes} posts per 10 minutes from one visitor.`);
    const base = contactMarker('สแปมทดสอบ');
    const contact = new ContactPage(page);
    // The form may still be throttled by an earlier case: wait until it opens.
    for (let i = 0; i < 3 && (await contact.openContact()) === 429; i++) await page.waitForTimeout(61_000);
    const token = await contact.form.locator('input[name="_token"]').inputValue();
    const statuses: number[] = [];
    const started = Date.now();
    try {
      for (let i = 1; i <= SESSION.contactPostsPer10Minutes + 3; i++) {
        const response = await page.request.post(urlOf('/frontend/contractus/index'), {
          form: { _token: token, name: `${AUTO_TEST_FLAG} สแปม ${i}`, email: 'qa.auto@example.com', subject: `${base} #${i}`, message: `${AUTO_TEST_FLAG} ข้อความซ้ำ ${i}` },
          maxRedirects: 0,
        });
        statuses.push(response.status());
      }
      const elapsed = Date.now() - started;
      const inbox = new AdminContactPage(admin.page);
      await inbox.open(`?q=${encodeURIComponent(base)}`);
      const kept = (await inbox.readMessages()).filter((m) => m.subject.startsWith(base)).length;
      note(`${statuses.length} posts in ${elapsed} ms: ${JSON.stringify(statuses)}; stored ${kept}`);
      expect(statuses.filter((s) => s >= 500), 'no server error').toEqual([]);
      expect(statuses.some((s) => s === 429), 'the burst is throttled (HTTP 429) or blocked').toBe(true);
      expect(kept, `at most ${SESSION.contactPostsPer10Minutes} messages reach the inbox`).toBeLessThanOrEqual(SESSION.contactPostsPer10Minutes);
      const home = await page.request.get(urlOf('/'));
      expect(home.status(), 'the site stays up for other pages').toBe(200);
    } finally {
      note(`Cleanup: deleted ${await deleteMessagesWhere(admin.page, (m) => m.subject.startsWith(base))} message(s).`);
    }
  });
});
