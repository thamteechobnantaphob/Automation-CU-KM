import { test, expect, ANONYMOUS_SESSION } from '@fixtures/pages.fixtures';
import { requireDataCreatingTestsAllowed } from '@config/env';
import { AdminContactPage, ContactMessage } from '@pages/admin/AdminContactPage';
import { ContactPage } from '@pages/public/ContactPage';
import { adminSession, bySubject, contactMarker, deleteMessagesWhere, sendContact, VALID_CONTACT, withContactInfo, withContactMessage } from '@utils/contactFlows';
import { urlOf } from '@utils/lowPrivilege';
import { collectDialogs, SQL_ERROR_PATTERN } from '@utils/security';
import { AUTO_TEST_FLAG } from '@utils/testData';
import { Page } from '@playwright/test';
import { ADMIN_AUTH_FILE } from '../../global-setup';

/**
 * KM-FECT — the public contact page /frontend/contractus/index (checked 2026-10-05): contact cards (phone / email /
 * address, "-" when empty) and "แบบฟอร์มติดต่อสอบถาม" (#contact-form: name*, email, subject, message*; plain POST,
 * success modal #modsuccess, server errors as red text under the field, no file field).
 * `page` is an anonymous visitor (the evidence video shows the public page); the admin side (checks, cleanup) runs
 * in its own logged-in context. Every message a case sends has "[Auto Test]" + a stamp as its subject and is
 * deleted again by the case; the one case that changes the contact info restores it.
 *
 * NOT implemented ({MAX} undefined, no maxlength — DEF-52): TC-FECT-03-03/04, 03-19/20.
 */

test.use({ storageState: ANONYMOUS_SESSION });

const SENDS = 'Sends a contact message (deleted again at the end of the case).';
const RAW_KEY_BUG = 'Known bug (DEF-66): a bad email is refused but the message under the field is the untranslated key "validation.email" ("validation.max.string" for a long one).';
const EMAIL_OPTIONAL = 'Known bug (DEF-67): the email field is optional (no required attribute, the server accepts it empty) — the sheet requires it.';
const VIEW_EMPTY = 'Known bug (DEF-73): the admin message panel never shows the message text — its script fills document.querySelector(".js-view-message"), which is the first row\'s view BUTTON, not the panel textarea.';
/** A server error message that is an untranslated Laravel key ("validation.email") instead of a sentence. */
const RAW_KEY = /\bvalidation\.[a-z_.]+/i;
const THAI = /[฀-๿]/;

let admin: { page: Page; close: () => Promise<void> };

test.beforeEach(async ({ browser }) => {
  test.setTimeout(200_000); // a 429 from the rate-limited form is waited out (up to 2 × 61 s)
  admin = await adminSession(browser, ADMIN_AUTH_FILE);
});

test.afterEach(async () => {
  await admin?.close();
});

function note(description: string): void {
  test.info().annotations.push({ type: 'note', description });
}

const stored = (subject: string): Promise<ContactMessage | undefined> => new AdminContactPage(admin.page).findMessage(bySubject(subject)).then((found) => found?.message);

/** The field's error must be a readable (Thai) sentence, not a raw key. */
function readable(error: string | undefined, what: string): void {
  expect(error ?? '', `${what}: a message is shown`).not.toBe('');
  expect(error, `${what}: a readable message, not the raw key`).not.toMatch(RAW_KEY);
  expect(error, `${what}: in Thai`).toMatch(THAI);
}

/** Sends the valid message with `field` = `value`; it must arrive in the admin list with that value as typed. */
async function arrives(page: Page, field: 'name' | 'email', value: string): Promise<void> {
  await withContactMessage(page, admin.page, { [field]: value }, async (sent, subject) => {
    expect(sent.success, 'the success message is shown').toBe(true);
    const message = await stored(subject);
    expect(message, 'listed in the admin').toBeDefined();
    expect(message![field], 'stored as typed').toBe(value.trim());
  });
}

/** Sends the valid message with `email` = `value`; it must be refused with a readable message at the email field. */
async function emailRefused(page: Page, value: string): Promise<void> {
  await withContactMessage(page, admin.page, { email: value }, async (sent, subject) => {
    note(`Post ${sent.first} -> ${sent.final}; success ${sent.success}; errors ${JSON.stringify(sent.errors)}`);
    expect(await stored(subject), 'not sent').toBeUndefined();
    expect(sent.success, 'no success message').toBe(false);
    expect(sent.values.email, 'what was typed stays').toBe(value);
    readable(sent.errors.email, 'email');
  });
}

/** Sends the valid message with `field` empty/blank (browser validation off); refused with a message at the field. */
async function fieldRequired(page: Page, field: 'name' | 'email' | 'message', value: string): Promise<void> {
  await withContactMessage(page, admin.page, { [field]: value }, async (sent, subject) => {
    note(`Post ${sent.first} -> ${sent.final}; success ${sent.success}; errors ${JSON.stringify(sent.errors)}; values ${JSON.stringify(sent.values)}`);
    expect(await stored(subject), 'not sent').toBeUndefined();
    expect(sent.success, 'no success message').toBe(false);
    readable(sent.errors[field], field);
    for (const other of (['name', 'email', 'message'] as const).filter((f) => f !== field)) {
      expect(sent.values[other], `${other} keeps what was typed`).toBe(VALID_CONTACT[other]);
    }
  }, { browserValidation: false });
}

test.describe('SC-FECT-01 ข้อมูลติดต่อ', () => {
  test('TC-FECT-01-01 [Medium] [Positive] แสดงข้อมูลติดต่อตรงกับที่ตั้งใน admin', async ({ page }) => {
    // Dev has no contact info yet: the sheet's values are saved for the case and the original info restored after.
    requireDataCreatingTestsAllowed('Saves the shared contact info (restored to the original values at the end of the case).');
    const values = {
      phone: '0-2218-1128',
      facebook: '',
      email: 'fonbox@chula.ac.th',
      address: `${AUTO_TEST_FLAG} อาคารบรมราชชนนีศรีศตพรรษ ชั้น 11 ถนนพระราม 1 แขวงวังใหม่ เขตปทุมวัน กรุงเทพฯ 10330`,
    };
    await withContactInfo(admin.page, values, async () => {
      const adminPage = new AdminContactPage(admin.page);
      const inAdmin = await adminPage.info();
      const map = await adminPage.mapEmbed();
      const contact = new ContactPage(page);
      expect(await contact.openContact()).toBe(200);
      const shown = await contact.info();
      note(`Public: ${JSON.stringify(shown)}; admin map ${map ? 'set' : 'empty'}`);
      expect(shown, 'the same values as the admin').toMatchObject({ เบอร์โทร: inAdmin.phone, อีเมล: inAdmin.email, ที่อยู่: inAdmin.address });
      expect(shown, 'the sheet values').toMatchObject({ เบอร์โทร: '0-2218-1128', อีเมล: 'fonbox@chula.ac.th' });
      const iframes = await page.locator('.body-content iframe').count();
      expect(iframes > 0, map ? 'the admin map is shown' : 'no map while the admin has none').toBe(Boolean(map));
    });
  });
});

test.describe('SC-FECT-02 แบบฟอร์มติดต่อสอบถาม', () => {
  test('TC-FECT-02-03 [High] [Negative] ไม่กรอกช่องที่จำเป็น', async ({ page }) => {
    const adminPage = new AdminContactPage(admin.page);
    const before = await adminPage.messageCount();
    // 1) The browser blocks the empty form (required name + message).
    const contact = new ContactPage(page);
    await contact.openContact();
    const posts: string[] = [];
    page.on('request', (r) => {
      if (r.method() === 'POST') posts.push(r.url());
    });
    await contact.submitButton.click();
    await page.waitForTimeout(500);
    expect(posts, 'nothing is sent').toEqual([]);
    const native = {
      name: await contact.nameInput.evaluate((el: HTMLInputElement) => el.validationMessage),
      email: await contact.emailInput.evaluate((el: HTMLInputElement) => el.validationMessage),
      message: await contact.messageInput.evaluate((el: HTMLTextAreaElement) => el.validationMessage),
    };
    // 2) The server refuses it too (browser validation off) and says which fields are missing.
    await contact.disableBrowserValidation();
    await contact.submitButton.click();
    await page.waitForLoadState('load');
    await page.waitForTimeout(500);
    const errors = await contact.fieldErrors();
    note(`Browser: ${JSON.stringify(native)} | server: ${JSON.stringify(errors)}`);
    expect(native.name, 'name is required').not.toBe('');
    expect(native.message, 'message is required').not.toBe('');
    readable(errors.name, 'name');
    readable(errors.message, 'message');
    await expect(contact.successModal).toBeHidden();
    expect(await adminPage.messageCount(), 'nothing stored').toBe(before);
  });

  test('TC-FECT-02-04 [Medium] [Negative] รูปแบบอีเมลไม่ถูกต้อง', async ({ page }) => {
    test.fail(true, RAW_KEY_BUG);
    requireDataCreatingTestsAllowed('If the app accepts the address it stores a message (deleted again at the end).');
    await emailRefused(page, 'abc@');
  });

  test('TC-FECT-02-08 [Low] [Negative] กดส่งแบบฟอร์มซ้ำ (Double submit)', async ({ page }) => {
    requireDataCreatingTestsAllowed(SENDS);
    await withContactMessage(page, admin.page, {}, async (sent, subject) => {
      const adminPage = new AdminContactPage(admin.page);
      await adminPage.open();
      const copies = (await adminPage.readMessages()).filter(bySubject(subject)).length;
      note(`${copies} message(s) after 2 rapid clicks; success ${sent.success}`);
      expect(copies, 'only one message').toBe(1);
    }, { clicks: 2 });
  });
});

test.describe('SC-FECT-03 แบบฟอร์มติดต่อสอบถาม: ตรวจทีละ field', () => {
  test('TC-FECT-03-01 [High] [Positive] ชื่อผู้ติดต่อ: ข้อความภาษาไทยปกติ', async ({ page }) => {
    requireDataCreatingTestsAllowed(SENDS);
    await arrives(page, 'name', 'ระบบจัดการความรู้ทดสอบ');
  });
  test('TC-FECT-03-02 [Medium] [Positive] ชื่อผู้ติดต่อ: ภาษาอังกฤษและตัวเลข', async ({ page }) => {
    requireDataCreatingTestsAllowed(SENDS);
    await arrives(page, 'name', 'Test Case 001');
  });
  test('TC-FECT-03-05 [High] [Negative] ชื่อผู้ติดต่อ: แท็ก HTML และสคริปต์', async ({ page }) => {
    requireDataCreatingTestsAllowed(SENDS);
    const payload = '<b>bold</b><script>alert(1)</script>';
    const visitorDialogs = collectDialogs(page);
    const adminDialogs = collectDialogs(admin.page);
    await withContactMessage(page, admin.page, { name: payload }, async (sent, subject) => {
      const message = await stored(subject);
      note(`Stored name: ${JSON.stringify(message?.name)}; success ${sent.success}`);
      if (message) {
        if (message.name !== payload) expect(message.name, 'sanitised: no script tag left').not.toMatch(/<script/i);
        const row = admin.page.locator('#pills-message tbody tr', { hasText: subject });
        expect(await row.locator('b, script').count(), 'not rendered as markup in the list').toBe(0);
        const view = await new AdminContactPage(admin.page).viewMessage(bySubject(subject));
        expect(view.name, 'literal text in the view panel').toBe(message.name);
      }
    });
    expect(visitorDialogs, 'no script runs on the public page').toEqual([]);
    expect(adminDialogs, 'no script runs in the admin').toEqual([]);
  });
  test('TC-FECT-03-06 [High] [Negative] ชื่อผู้ติดต่อ: อักขระ SQL', async ({ page }) => {
    requireDataCreatingTestsAllowed(SENDS);
    const payload = "' OR 1=1; DROP TABLE users;--";
    const adminPage = new AdminContactPage(admin.page);
    const before = await adminPage.messageCount();
    await withContactMessage(page, admin.page, { name: payload }, async (sent, subject) => {
      expect(SQL_ERROR_PATTERN.test(await page.locator('body').innerText()), 'no SQL error').toBe(false);
      const message = await stored(subject);
      note(message ? `Saved as ${JSON.stringify(message.name)}` : `Refused: ${JSON.stringify(sent.errors)}`);
      if (message) expect(message.name, 'stored as plain text').toBe(payload);
      expect(await adminPage.messageCount(), 'nothing else touched').toBe(before + (message ? 1 : 0));
    });
  });
  test('TC-FECT-03-07 [High] [Negative] ชื่อผู้ติดต่อ: เว้นว่าง', async ({ page }) => {
    requireDataCreatingTestsAllowed('If the app accepts an empty name it stores a message (deleted again at the end).');
    // The browser blocks it first (required) …
    const contact = new ContactPage(page);
    await contact.openContact();
    expect(await contact.nameInput.evaluate((el: HTMLInputElement) => el.validationMessage), 'browser: name is required').not.toBe('');
    // … and the server too.
    await fieldRequired(page, 'name', '');
  });
  test('TC-FECT-03-08 [Medium] [Negative] ชื่อผู้ติดต่อ: ช่องว่างล้วน (เว้นวรรค 5 ตัว)', async ({ page }) => {
    requireDataCreatingTestsAllowed('If the app accepts a blank name it stores a message (deleted again at the end).');
    await fieldRequired(page, 'name', '     ');
  });

  test('TC-FECT-03-09 [High] [Positive] อีเมล: อีเมลรูปแบบปกติ', async ({ page }) => {
    requireDataCreatingTestsAllowed(SENDS);
    await arrives(page, 'email', 'user01@example.com');
  });
  test('TC-FECT-03-10 [Medium] [Positive] อีเมล: โดเมนย่อยและเครื่องหมาย +', async ({ page }) => {
    requireDataCreatingTestsAllowed(SENDS);
    await arrives(page, 'email', 'user.name+km@mail.nurse.chula.ac.th');
  });
  for (const [id, label, value] of [
    ['TC-FECT-03-11 [High]', 'ไม่มีเครื่องหมาย @', 'user01example.com'],
    ['TC-FECT-03-12 [High]', 'ไม่มีชื่อโดเมนหลัง @', 'user01@'],
    ['TC-FECT-03-13 [Medium]', 'ไม่มีส่วนหน้า @', '@example.com'],
    ['TC-FECT-03-14 [Medium]', 'มีช่องว่างในอีเมล', 'user 01@example.com'],
    ['TC-FECT-03-15 [Low]', 'ยาวเกิน 254 ตัวอักษร', `${'a'.repeat(250)}@example.com`],
  ] as const) {
    test(`${id} [Negative] อีเมล: ${label}`, async ({ page }) => {
      test.fail(true, RAW_KEY_BUG);
      requireDataCreatingTestsAllowed('If the app accepts the address it stores a message (deleted again at the end).');
      await emailRefused(page, value);
    });
  }
  test('TC-FECT-03-16 [High] [Negative] อีเมล: เว้นว่าง', async ({ page }) => {
    test.fail(true, EMAIL_OPTIONAL);
    requireDataCreatingTestsAllowed('If the app accepts an empty email it stores a message (deleted again at the end).');
    await fieldRequired(page, 'email', '');
  });

  test('TC-FECT-03-17 [Low] [Positive] ข้อความ: ข้อความสั้น 1 ตัวอักษร', async ({ page }) => {
    requireDataCreatingTestsAllowed(SENDS);
    // "ส่งสำเร็จ หรือแจ้งความยาวขั้นต่ำตามกติกา (TBD)": either passes; the note records which.
    await withContactMessage(page, admin.page, { message: 'ก' }, async (sent, subject) => {
      const message = await stored(subject);
      note(message ? `Sent; stored ${JSON.stringify(message.message)}` : `Refused: ${JSON.stringify(sent.errors)}`);
      if (message) {
        expect(sent.success).toBe(true);
        expect(message.message).toBe('ก');
      } else readable(sent.errors.message, 'message');
    });
  });
  test('TC-FECT-03-18 [Medium] [Positive] ข้อความ: ข้อความหลายบรรทัด', async ({ page }) => {
    test.fail(true, VIEW_EMPTY);
    requireDataCreatingTestsAllowed(SENDS);
    const text = 'บรรทัดที่ 1\nบรรทัดที่ 2\nบรรทัดที่ 3';
    await withContactMessage(page, admin.page, { message: text }, async (sent, subject) => {
      expect(sent.success, 'sent').toBe(true);
      const message = await stored(subject);
      expect(message?.message.replace(/\r\n/g, '\n'), 'line breaks kept').toBe(text);
      const view = await new AdminContactPage(admin.page).viewMessage(bySubject(subject));
      expect(view.message.replace(/\r\n/g, '\n'), 'shown with its line breaks in the admin').toBe(text);
    });
  });
  test('TC-FECT-03-21 [High] [Negative] ข้อความ: ข้อความว่างเปล่า', async ({ page }) => {
    requireDataCreatingTestsAllowed('If the app accepts an empty message it stores one (deleted again at the end).');
    const contact = new ContactPage(page);
    await contact.openContact();
    expect(await contact.messageInput.evaluate((el: HTMLTextAreaElement) => el.validationMessage), 'browser: the message is required').not.toBe('');
    await fieldRequired(page, 'message', '');
  });
  test('TC-FECT-03-22 [Medium] [Negative] ข้อความ: ช่องว่างล้วน', async ({ page }) => {
    requireDataCreatingTestsAllowed('If the app accepts a blank message it stores one (deleted again at the end).');
    await fieldRequired(page, 'message', '     ');
  });
  test('TC-FECT-03-23 [High] [Negative] ข้อความ: สคริปต์และ HTML', async ({ page }) => {
    test.fail(true, VIEW_EMPTY);
    requireDataCreatingTestsAllowed(SENDS);
    const payload = '<img src=x onerror=alert(1)>';
    const adminDialogs = collectDialogs(admin.page);
    await withContactMessage(page, admin.page, { message: payload }, async (sent, subject) => {
      const message = await stored(subject);
      note(`Stored message: ${JSON.stringify(message?.message)}`);
      expect(sent.success, 'sent').toBe(true);
      expect(message, 'listed in the admin').toBeDefined();
      const view = await new AdminContactPage(admin.page).viewMessage(bySubject(subject));
      expect(view.message, 'literal text in the admin view').toBe(message!.message);
      expect(await admin.page.locator('#pills-message img[src="x"], #viewMod img[src="x"]').count(), 'not rendered as an image').toBe(0);
    });
    expect(adminDialogs, 'no script runs in the admin').toEqual([]);
  });
  test('TC-FECT-03-27 [High] [Positive] ไฟล์แนบ: ไม่แนบไฟล์ (ไม่บังคับ)', async ({ page }) => {
    requireDataCreatingTestsAllowed(SENDS);
    const contact = new ContactPage(page);
    await contact.openContact();
    const fileFields = await contact.form.locator('input[type="file"]').count();
    note(fileFields ? `${fileFields} file field(s)` : 'The form has no file field at all.');
    await withContactMessage(page, admin.page, {}, async (sent, subject) => {
      expect(sent.success, 'sent without a file').toBe(true);
      expect(await stored(subject), 'listed in the admin').toBeDefined();
    });
  });
});

test.describe('SC-FECT-04 แบบฟอร์มติดต่อสอบถาม: พฤติกรรมและความปลอดภัย', () => {
  test('TC-FECT-04-01 [Medium] [Negative] ค่าที่กรอกยังอยู่หลัง validation ไม่ผ่าน', async ({ page }) => {
    test.fail(true, EMAIL_OPTIONAL);
    requireDataCreatingTestsAllowed('If the app accepts an empty email it stores a message (deleted again at the end).');
    await withContactMessage(page, admin.page, { email: '' }, async (sent, subject) => {
      note(`Success ${sent.success}; errors ${JSON.stringify(sent.errors)}; values ${JSON.stringify(sent.values)}`);
      expect(await stored(subject), 'not sent').toBeUndefined();
      readable(sent.errors.email, 'email');
      expect(sent.values.name, 'the name stays').toBe(VALID_CONTACT.name);
      expect(sent.values.message, 'the message stays').toBe(VALID_CONTACT.message);
    });
  });

  test('TC-FECT-04-02 [Medium] [Positive] รีเฟรชหน้าหลังส่งสำเร็จไม่ส่งซ้ำ', async ({ page }) => {
    requireDataCreatingTestsAllowed(SENDS);
    await withContactMessage(page, admin.page, {}, async (sent, subject) => {
      expect(sent.success, 'sent').toBe(true);
      expect(page.url(), 'redirected after the post (GET page)').toContain('/frontend/contractus/index');
      const posts: string[] = [];
      page.on('request', (r) => {
        if (r.method() === 'POST') posts.push(r.url());
      });
      const dialogs: string[] = [];
      page.on('dialog', (d) => {
        dialogs.push(d.message());
        void d.dismiss();
      });
      await page.reload();
      await page.waitForLoadState('load');
      expect(posts, 'F5 does not post again').toEqual([]);
      expect(dialogs, 'no "Confirm Form Resubmission"').toEqual([]);
      const adminPage = new AdminContactPage(admin.page);
      await adminPage.open();
      expect((await adminPage.readMessages()).filter(bySubject(subject)).length, 'still one message').toBe(1);
    });
  });

  test('TC-FECT-04-03 [High] [Negative] ส่งแบบฟอร์มโดยไม่มี CSRF token', async ({ page }) => {
    const subject = contactMarker('ไม่มี token');
    try {
      const response = await page.request.post(urlOf('/frontend/contractus/index'), { form: { ...VALID_CONTACT, subject }, maxRedirects: 0 });
      note(`POST /frontend/contractus/index without _token -> ${response.status()}`);
      expect([403, 419], 'refused').toContain(response.status());
      expect(await stored(subject), 'nothing stored').toBeUndefined();
    } finally {
      await deleteMessagesWhere(admin.page, bySubject(subject));
    }
  });

  test('TC-FECT-04-05 [Low] [Negative] ส่งแบบฟอร์มขณะไม่มีอินเทอร์เน็ต/เซิร์ฟเวอร์ไม่ตอบ', async ({ page, context }) => {
    requireDataCreatingTestsAllowed('If the post got through it would store a message (deleted again at the end).');
    const subject = contactMarker('ออฟไลน์');
    const contact = new ContactPage(page);
    try {
      await contact.openContact();
      await contact.fill({ ...VALID_CONTACT, subject });
      await context.setOffline(true);
      await contact.submitButton.click().catch(() => undefined);
      await page.waitForTimeout(1_500);
      const success = await contact.successModal.isVisible().catch(() => false);
      const shown = (await page.locator('body').innerText().catch(() => '')).replace(/\s+/g, ' ').slice(0, 200);
      await context.setOffline(false);
      note(`While offline: url ${page.url()}; success ${success}; page says: ${shown}`);
      expect(success, 'not shown as sent').toBe(false);
      expect(await stored(subject), 'nothing stored').toBeUndefined();
    } finally {
      await context.setOffline(false);
      await deleteMessagesWhere(admin.page, bySubject(subject));
    }
  });

  test('TC-FECT-04-06 [Low] [Positive] ข้อความแจ้งผลเป็นภาษาไทยและอ่านง่าย', async ({ page }) => {
    test.fail(true, RAW_KEY_BUG);
    requireDataCreatingTestsAllowed(SENDS);
    const texts: string[] = [];
    await withContactMessage(page, admin.page, {}, async (sent) => {
      expect(sent.success, 'sent').toBe(true);
      const modal = (await new ContactPage(page).successModal.innerText()).replace(/\s+/g, ' ').trim();
      texts.push(`success: ${modal}`);
      expect(modal, 'the success message is Thai').toMatch(THAI);
    });
    const empty = await sendContact(page, { name: '', email: '', subject: '', message: '' }, { browserValidation: false });
    texts.push(`empty: ${JSON.stringify(empty.errors)}`);
    const badEmail = await sendContact(page, { ...VALID_CONTACT, subject: '', email: 'abc@', message: '' }, { browserValidation: false });
    texts.push(`bad email: ${JSON.stringify(badEmail.errors)}`);
    note(texts.join(' | '));
    for (const [field, error] of Object.entries({ ...empty.errors, ...badEmail.errors })) readable(error, field);
  });
});
