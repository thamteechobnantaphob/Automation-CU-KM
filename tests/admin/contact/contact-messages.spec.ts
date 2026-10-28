import { test, expect, ANONYMOUS_SESSION } from '@fixtures/pages.fixtures';
import { requireDataCreatingTestsAllowed } from '@config/env';
import { MAX_LENGTH, POLICY_SOURCE } from '@config/policy';
import { AdminContactPage, ContactInfo, ContactMessage } from '@pages/admin/AdminContactPage';
import { submitAndFollow } from '@pages/admin/AdminNewsPages';
import { bySubject, contactMarker, deleteMessagesWhere, publicContact, sendContact, VALID_CONTACT, withContactInfo, withContactMap } from '@utils/contactFlows';
import { sheetTitle } from '@utils/caseTitles';
import { collectDialogs } from '@utils/security';
import { AUTO_TEST_FLAG } from '@utils/testData';
import { Browser, Page } from '@playwright/test';
import { textOfLength } from '../content/contentLimitsSuite';

/**
 * KM-ADMT — the contact info (Auto:P + the address {MAX} cases) and "รายการข้อความติดต่อ" (list, view, delete,
 * filters q / status / from / to, read state), checked 2026-10-07. The address limit is the OWASP-based proposal in
 * src/config/policy.ts (500 characters). The contact info is one shared record: every case that saves it restores
 * it. Messages are sent from an anonymous visitor context with "[Auto Test]" + a stamp as subject and deleted again.
 */

const SAVES = 'Saves the shared contact info (restored to the original values at the end of the case).';
const SENDS = 'Sends contact messages from the public form (deleted again at the end of the case).';
const KNOWN = {
  VIEW_EMPTY: 'Known bug (DEF-73): the admin message panel never shows the message text — its script fills the first row\'s view BUTTON, not the panel textarea.',
  NO_ATTACHMENT: 'Spec mismatch (DEF-106): contact messages have no attachment (the public form has no file field).',
  ADDRESS_500: 'Known bug (DEF-112): an address of 256 characters or more makes the save answer HTTP 500 (the column holds 255 and the length is not validated) — the proposed maximum (500) cannot be saved, and 501 is not refused with a message.',
  UNLIMITED: 'Known bug (DEF-101): the address has no length limit — one character over the proposed maximum is saved.',
  HIDDEN_ERROR: 'Known bug (DEF-69): a refused save reloads the page with the panel CLOSED — no visible error.',
  FOOTER_FIXED: 'Known bug (DEF-107): the public footer shows a fixed address and phone ("ติดต่องานสารบรรณ 0-2218-1128") — it does not follow the contact info saved in the admin.',
};
const VALID: ContactInfo = {
  phone: '0-2218-1128',
  facebook: 'https://www.facebook.com/nursechula',
  email: 'fonbox@chula.ac.th',
  address: `${AUTO_TEST_FLAG} อาคารบรมราชชนนีศรีศตพรรษ ชั้น 11 ถนนพระราม 1 กรุงเทพฯ 10330`,
};

test.beforeEach(() => test.setTimeout(240_000));

function note(description: string): void {
  test.info().annotations.push({ type: 'note', description });
}

/** Sends one valid message as an anonymous visitor (subject = a fresh marker unless given). */
async function send(browser: Browser, values: { subject?: string; message?: string; name?: string } = {}): Promise<string> {
  const subject = values.subject ?? contactMarker();
  const context = await browser.newContext({ storageState: ANONYMOUS_SESSION });
  try {
    const sent = await sendContact(await context.newPage(), { ...VALID_CONTACT, ...values, subject });
    expect(sent.success, `message "${subject}" sent`).toBe(true);
    return subject;
  } finally {
    await context.close();
  }
}

/** Sends messages (one per entry of `values`), runs `checks` with their subjects, then deletes them. */
async function withMessages(page: Page, browser: Browser, values: { subject?: string; message?: string; name?: string }[], checks: (subjects: string[]) => Promise<void>): Promise<void> {
  requireDataCreatingTestsAllowed(SENDS);
  const subjects: string[] = [];
  try {
    for (const v of values) {
      subjects.push(await send(browser, v));
      if (values.length > 1) await page.waitForTimeout(61_000); // the list shows minutes: one minute apart
    }
    await checks(subjects);
  } finally {
    let deleted = 0;
    for (const s of subjects) deleted += await deleteMessagesWhere(page, bySubject(s));
    note(`Cleanup: deleted ${deleted} message(s).`);
  }
}

const rowsOf = async (page: Page, query = ''): Promise<ContactMessage[]> => {
  const admin = new AdminContactPage(page);
  await admin.open(query);
  return admin.readMessages();
};

/** "07 ต.ค.. 26, 06:32 น." → minutes since the Thai Buddhist-era epoch of the year (comparable within the list). */
function minutesOf(date: string): number {
  const m = /(\d{1,2})\s*(\S+?)\.*\s*(\d{2}),\s*(\d{1,2}):(\d{2})/.exec(date);
  if (!m) return NaN;
  const months = ['ม.ค', 'ก.พ', 'มี.ค', 'เม.ย', 'พ.ค', 'มิ.ย', 'ก.ค', 'ส.ค', 'ก.ย', 'ต.ค', 'พ.ย', 'ธ.ค'];
  const month = months.findIndex((x) => m[2].replace(/\.+$/, '') === x);
  return ((Number(m[3]) * 12 + month) * 31 + Number(m[1])) * 1440 + Number(m[4]) * 60 + Number(m[5]);
}

const isoToday = (): string => new Date(Date.now() + 7 * 3600_000).toISOString().slice(0, 10);
const isoTomorrow = (): string => new Date(Date.now() + 31 * 3600_000).toISOString().slice(0, 10);

// ---------------------------------------------------------------------------------------------------------------

test.describe('SC-ADMT-01 ข้อมูลติดต่อและแผนที่', () => {
  test(sheetTitle('TC-ADMT-01-02'), async ({ page, browser }) => {
    requireDataCreatingTestsAllowed(SAVES);
    const values: ContactInfo = { ...VALID, phone: '0-2218-9999', email: 'auto.test@example.com', address: `${AUTO_TEST_FLAG} ที่อยู่ทดสอบ ${Date.now().toString(36)}` };
    let restored: ContactInfo | undefined;
    await withContactInfo(page, values, async () => {
      const pub = await publicContact(browser);
      note(`Public contact page: ${JSON.stringify(pub.info)}`);
      expect(pub.info['เบอร์โทร'], 'the contact page shows the new phone').toBe(values.phone);
      expect(pub.info['อีเมล'], 'the new email').toBe(values.email);
      expect(pub.info['ที่อยู่'], 'the new address').toBe(values.address);
      const context = await browser.newContext({ storageState: ANONYMOUS_SESSION });
      const footer = await (async () => {
        const visitor = await context.newPage();
        await visitor.goto(new URL('/', page.url()).toString());
        return (await visitor.locator('footer .address').innerText()).replace(/\s+/g, ' ');
      })().finally(() => context.close());
      note(`Footer: ${footer}`);
      const followed = footer.includes(values.phone) && footer.includes(values.address.replace(/\s+/g, ' '));
      test.fail(!followed, KNOWN.FOOTER_FIXED);
      expect.soft(followed, 'the footer shows the new phone and address').toBe(true);
    });
    restored = await new AdminContactPage(page).info();
    note(`After restore: ${JSON.stringify(restored)}`);
    expect(restored.phone, 'the original value is back').not.toBe(values.phone);
  });

  test(sheetTitle('TC-ADMT-01-04'), async ({ page, browser }) => {
    requireDataCreatingTestsAllowed(SAVES);
    note('The location is a map embed code (DEF-68): the case changes the embedded place.');
    const embed = '<iframe src="https://maps.google.com/maps?q=13.7465,100.5348&z=16&output=embed" width="600" height="450" style="border:0;" loading="lazy"></iframe>';
    await withContactMap(page, embed, async () => {
      expect(await new AdminContactPage(page).mapEmbed(), 'stored').toBe(embed);
      const pub = await publicContact(browser);
      note(`Public iframes: ${JSON.stringify(pub.iframes)}`);
      expect(pub.iframes.some((src) => src.includes('13.7465,100.5348')), 'the public map shows the new place').toBe(true);
    });
  });
});

test.describe('SC-ADMT-02 รายการข้อความติดต่อ', () => {
  test(sheetTitle('TC-ADMT-02-01'), async ({ page, browser }) => {
    const text = `${AUTO_TEST_FLAG} ข้อความล่าสุด ${Date.now().toString(36)}`;
    await withMessages(page, browser, [{ message: text }], async ([subject]) => {
      const rows = await rowsOf(page);
      note(`Top rows: ${JSON.stringify(rows.slice(0, 3).map((r) => [r.name, r.date, r.subject]))}`);
      expect(rows[0]?.subject, 'the newest message is on top').toBe(subject);
      const row = (await page.locator('#pills-message tbody tr').first().innerText()).replace(/\s+/g, ' ');
      expect(row, 'with the sender').toContain(VALID_CONTACT.name);
      expect(row, 'the date').toMatch(/\d{1,2}\s*\S+\s*\d{2},\s*\d{1,2}:\d{2}/);
      expect(row, 'and the subject').toContain(subject);
      const view = await new AdminContactPage(page).viewMessage(bySubject(subject));
      test.fail(view.message !== text, KNOWN.VIEW_EMPTY);
      expect(view.message, 'the message itself can be read').toBe(text);
    });
  });

  test(sheetTitle('TC-ADMT-02-02'), async ({ page, browser }) => {
    const text = `${AUTO_TEST_FLAG} เปิดอ่านข้อความ ${Date.now().toString(36)}`;
    await withMessages(page, browser, [{ message: text }], async ([subject]) => {
      const view = await new AdminContactPage(page).viewMessage(bySubject(subject));
      note(`View panel: ${JSON.stringify(view)}`);
      expect(view.name, 'sender').toBe(VALID_CONTACT.name);
      expect(view.email, 'email').toBe(VALID_CONTACT.email);
      expect(view.subject, 'subject').toBe(subject);
      const attachments = await page.locator('#viewMod a[href*="download"], #viewMod a[download], #viewMod .file-item').count();
      note(`Attachment links in the panel: ${attachments}`);
      test.fail(view.message !== text || attachments === 0, view.message !== text ? KNOWN.VIEW_EMPTY : KNOWN.NO_ATTACHMENT);
      expect(view.message, 'the whole message').toBe(text);
      expect(attachments, 'the attached file can be downloaded').toBeGreaterThan(0);
    });
  });

  test(sheetTitle('TC-ADMT-02-03'), async ({ page, browser }) => {
    await withMessages(page, browser, [{}], async ([subject]) => {
      const admin = new AdminContactPage(page);
      const cancel = await admin.openDeleteDialog(bySubject(subject));
      await cancel.cancel();
      expect(await admin.findMessage(bySubject(subject)), '"ยกเลิก": the message stays').toBeDefined();
      const confirm = await admin.openDeleteDialog(bySubject(subject));
      const result = await submitAndFollow(page, () => confirm.confirm());
      expect(result.final).toBeLessThan(400);
      await expect(admin.flash.filter({ hasText: 'ลบข้อความเรียบร้อยแล้ว' }), 'success message').toBeVisible();
      expect(await admin.findMessage(bySubject(subject)), '"ยืนยันลบข้อมูล": gone from the list').toBeUndefined();
    });
  });
});

test.describe('SC-ADMT-03 ที่อยู่ (ความยาว)', () => {
  test(sheetTitle('TC-ADMT-03-24'), async ({ page, browser }) => {
    requireDataCreatingTestsAllowed(SAVES);
    note(`Limit used: ${POLICY_SOURCE}`);
    const address = textOfLength(`${AUTO_TEST_FLAG} ที่อยู่`, MAX_LENGTH.address);
    test.fail(MAX_LENGTH.address > 255, KNOWN.ADDRESS_500);
    await withContactInfo(page, { ...VALID, address }, async () => {
      expect((await new AdminContactPage(page).info()).address, `${MAX_LENGTH.address} characters are stored whole`).toBe(address);
      const pub = await publicContact(browser);
      expect(pub.info['ที่อยู่'], 'the public page shows it whole').toBe(address);
      const context = await browser.newContext({ storageState: ANONYMOUS_SESSION });
      try {
        const visitor = await context.newPage();
        await visitor.goto(new URL('/frontend/contractus/index', page.url()).toString());
        const overflow = await visitor.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
        expect(overflow, 'the layout does not break').toBeLessThanOrEqual(1);
      } finally {
        await context.close();
      }
    });
  });

  test(sheetTitle('TC-ADMT-03-25'), async ({ page }) => {
    requireDataCreatingTestsAllowed(SAVES);
    note(`Limit used: ${POLICY_SOURCE}`);
    const admin = new AdminContactPage(page);
    await admin.openInfoForm();
    const maxlength = await admin.addressInput.getAttribute('maxlength');
    note(`maxlength: ${maxlength ?? '(none)'}`);
    if (maxlength && Number(maxlength) <= MAX_LENGTH.address) return;
    const address = textOfLength(`${AUTO_TEST_FLAG} ที่อยู่`, MAX_LENGTH.address + 1);
    test.fail(MAX_LENGTH.address + 1 > 255, KNOWN.ADDRESS_500);
    await withContactInfo(page, { ...VALID, address }, async (saved) => {
      const errors = await admin.validationTexts();
      const stored = (await admin.info()).address;
      note(`Post ${saved.first} → ${saved.final}; stored ${stored.length} characters; messages ${JSON.stringify(errors)}`);
      expect(saved.final, 'no server error').toBeLessThan(500);
      test.fail(stored === address, KNOWN.UNLIMITED);
      expect(stored, `${MAX_LENGTH.address + 1} characters are not saved`).not.toBe(address);
      const visible = errors.filter((e) => e.visible).map((e) => e.text).join(' ');
      test.fail(visible === '', KNOWN.HIDDEN_ERROR);
      expect(visible, 'a visible message about the length').toMatch(/ต้องไม่เกิน|ไม่เกิน\s*\d+|ยาวเกิน|ความยาว/);
    });
  });
});

test.describe('SC-ADMT-04 การจัดการข้อความ', () => {
  test(sheetTitle('TC-ADMT-04-01'), async ({ page, browser }) => {
    await withMessages(page, browser, [{}, {}], async ([older, newer]) => {
      const rows = await rowsOf(page);
      const order = rows.map((r) => r.subject);
      note(`Rows: ${rows.length}; ${JSON.stringify(rows.map((r) => [r.subject.slice(0, 40), r.date]))}`);
      expect(order.indexOf(newer), 'the newer message is above the older one').toBeLessThan(order.indexOf(older));
      const minutes = rows.map((r) => minutesOf(r.date)).filter((m) => !Number.isNaN(m));
      expect(minutes, 'the list runs newest → oldest').toEqual([...minutes].sort((a, b) => b - a));
      const pager = (await page.locator('#pills-message .pagination-box, #pills-message .pagination').allInnerTexts()).join(' ').replace(/\s+/g, ' ');
      const counter = /จาก\s*([\d,]+)/.exec(pager);
      note(`Pager: "${pager}"`);
      if (counter) expect(Number(counter[1].replace(/,/g, '')), 'the counter matches the messages').toBeGreaterThanOrEqual(rows.length);
      else expect(rows.length, 'everything fits on one page (no pager needed)').toBeLessThanOrEqual(20);
    });
  });

  test(sheetTitle('TC-ADMT-04-02'), async ({ page, browser }) => {
    const sender = `${AUTO_TEST_FLAG} ผู้ส่งกรอง ${Date.now().toString(36)}`;
    await withMessages(page, browser, [{ name: sender }], async ([subject]) => {
      const bySender = await rowsOf(page, `?tab=message&q=${encodeURIComponent(sender)}`);
      note(`q=sender → ${JSON.stringify(bySender.map((r) => r.subject))}`);
      expect(bySender.map((r) => r.subject), 'search by sender finds it').toContain(subject);
      expect(bySender.every((r) => r.name.includes(sender) || r.subject.includes(sender) || r.email.includes(sender)), 'and only matches').toBe(true);
      const today = await rowsOf(page, `?tab=message&from=${isoToday()}&to=${isoToday()}`);
      expect(today.map((r) => r.subject), 'from–to today includes it').toContain(subject);
      const tomorrow = await rowsOf(page, `?tab=message&from=${isoTomorrow()}`);
      expect(tomorrow.map((r) => r.subject), 'from tomorrow excludes it').not.toContain(subject);
      const unread = await rowsOf(page, '?tab=message&status=unread');
      expect(unread.map((r) => r.subject), 'status "ยังไม่อ่าน" includes the new message').toContain(subject);
      expect(unread.every((r) => !r.isRead), 'and only unread ones').toBe(true);
    });
  });

  test(sheetTitle('TC-ADMT-04-03'), async ({ page, browser }) => {
    await withMessages(page, browser, [{}], async ([subject]) => {
      const admin = new AdminContactPage(page);
      const before = (await admin.findMessage(bySubject(subject)))?.message;
      expect(before?.status, 'a new message is "ยังไม่อ่าน"').toBe('ยังไม่อ่าน');
      const unreadBefore = (await rowsOf(page, '?tab=message&status=unread')).length;
      await admin.viewMessage(bySubject(subject));
      await page.waitForTimeout(1_000);
      const after = (await admin.findMessage(bySubject(subject)))?.message;
      const unreadAfter = (await rowsOf(page, '?tab=message&status=unread')).length;
      note(`Status ${before?.status} → ${after?.status}; unread ${unreadBefore} → ${unreadAfter}`);
      expect(after?.status, 'opening it marks it "อ่านแล้ว"').toBe('อ่านแล้ว');
      expect(unreadAfter, 'one unread fewer').toBe(unreadBefore - 1);
      // Back to unread with the panel's button "ทำเครื่องหมายว่ายังไม่อ่าน" (a form posted to data-toggle-url).
      await admin.viewMessage(bySubject(subject));
      const toggle = page.locator('#viewMod .js-view-toggle-btn');
      await expect(toggle, 'the panel offers "ทำเครื่องหมายว่ายังไม่อ่าน"').toHaveText(/ยังไม่อ่าน/);
      const toggled = await submitAndFollow(page, () => toggle.click());
      const again = (await admin.findMessage(bySubject(subject)))?.message;
      note(`Toggle ${toggled.first} → ${toggled.final}; status ${again?.status}`);
      expect(again?.status, 'the toggle sets it back to "ยังไม่อ่าน"').toBe('ยังไม่อ่าน');
    });
  });

  test(sheetTitle('TC-ADMT-04-04'), async ({ page, browser }) => {
    const payload = `${AUTO_TEST_FLAG} <script>alert('admt')</script><img src=x onerror=alert(2)>`;
    const dialogs = collectDialogs(page);
    await withMessages(page, browser, [{ message: payload, name: `${AUTO_TEST_FLAG} <b>ผู้ส่ง</b>` }], async ([subject]) => {
      const admin = new AdminContactPage(page);
      const row = (await admin.findMessage(bySubject(subject)))?.message;
      expect(row?.message, 'stored as typed').toBe(payload);
      await admin.messagesTab.click();
      expect(await page.locator('#pills-message b, #pills-message img[src="x"]').count(), 'shown as text in the list').toBe(0);
      await admin.viewMessage(bySubject(subject));
      expect(await page.locator('#viewMod img[src="x"], #viewMod script').count(), 'shown as text in the panel').toBe(0);
      await page.waitForTimeout(1_000);
      expect(dialogs, 'no script runs').toEqual([]);
    });
  });

  test(sheetTitle('TC-ADMT-04-05'), async ({ page, browser }) => {
    const long = `${AUTO_TEST_FLAG} ${'ก'.repeat(3_000)} ${'x'.repeat(1_500)}`;
    await withMessages(page, browser, [{ message: long, subject: `${contactMarker()} ${'ยาว'.repeat(60)}` }], async ([subject]) => {
      const admin = new AdminContactPage(page);
      await admin.open('?tab=message');
      await admin.messagesTab.click();
      const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
      const table = await page.locator('#pills-message table').evaluate((t) => ({ width: t.scrollWidth, box: (t.parentElement as HTMLElement).clientWidth }));
      note(`Page overflow ${overflow}px; table ${table.width}px in ${table.box}px`);
      expect(overflow, 'the page does not scroll sideways').toBeLessThanOrEqual(1);
      expect(table.width, 'the table fits its box (long text wraps or is cut)').toBeLessThanOrEqual(table.box + 1);
      await admin.viewMessage(bySubject(subject));
      const panel = await page.locator('#viewMod').evaluate((p) => p.scrollWidth - p.clientWidth);
      expect(panel, 'the view panel does not scroll sideways').toBeLessThanOrEqual(1);
    });
  });
});
