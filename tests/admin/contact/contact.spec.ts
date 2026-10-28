import { test, expect } from '@fixtures/pages.fixtures';
import { requireDataCreatingTestsAllowed } from '@config/env';
import { AdminContactPage, ContactInfo } from '@pages/admin/AdminContactPage';
import { publicContact, withContactInfo, withContactMap } from '@utils/contactFlows';
import { csrfTokenOf, urlOf } from '@utils/lowPrivilege';
import { collectDialogs } from '@utils/security';
import { AUTO_TEST_FLAG } from '@utils/testData';
import { Browser, Page } from '@playwright/test';

/**
 * KM-ADMT — /admin/contractus/index (checked 2026-10-05): the "รายละเอียด" pill (contact info panel #slideMod +
 * map panel #locationMod, both PUT /admin/contractus/info) and the "รายการข้อความติดต่อ" pill.
 * The contact info is one shared record shown on the public contact page: every case that saves restores the values
 * it found (withContactInfo / withContactMap). Each field case fills the other fields with valid values (step 4).
 * The location is a map EMBED CODE (textarea map_embed), not the lat/lng the sheet describes (DEF-68 → SA).
 *
 * NOT implemented ({MAX} undefined, no maxlength — DEF-52): TC-ADMT-03-24/25.
 */

const SAVES = 'Saves the shared contact info (restored to the original values at the end of the case).';
const VALID: ContactInfo = {
  phone: '0-2218-1128',
  facebook: 'https://www.facebook.com/nursechula',
  email: 'fonbox@chula.ac.th',
  address: `${AUTO_TEST_FLAG} อาคารบรมราชชนนีศรีศตพรรษ ชั้น 11 ถนนพระราม 1 กรุงเทพฯ 10330`,
};
const HTML_PAYLOAD = '<b>bold</b><script>alert(1)</script>';
const NO_COORDINATES = 'Spec mismatch (DEF-68): the location is a map embed code (textarea "โค้ด Embed แผนที่"); there are no latitude/longitude fields to validate.';
const HIDDEN_ERROR = 'Known bug (DEF-69): a refused save reloads the page with the panel CLOSED — no success message and no visible error (the red text, a raw key like "validation.email" (DEF-66), sits in the hidden panel).';
const PHONE_UNCHECKED = 'Known bug (DEF-70): the phone field is not validated — letters, 2 digits or 30 digits are saved and shown publicly.';
const NOT_REQUIRED = 'Known bug (DEF-71): email and address are not required — an empty value is saved over the stored one.';
const URL_UNCHECKED = 'Known bug (DEF-72): the Facebook field is not validated as a URL — text, a link without scheme, javascript: and data: are saved, and the public page links to them (javascript: link = stored XSS).';
const PUBLIC_LABEL: Partial<Record<keyof ContactInfo, string>> = { phone: 'เบอร์โทร', email: 'อีเมล', address: 'ที่อยู่' };

test.beforeEach(() => test.setTimeout(90_000));

/** The validation texts the admin can see (hidden ones do not count). */
const shownText = (errors: { text: string; visible: boolean }[]): string => errors.filter((e) => e.visible).map((e) => e.text).join(' ');

function note(description: string): void {
  test.info().annotations.push({ type: 'note', description });
}

/** Saves VALID with `field` = `value`; the value must be stored as typed and shown on the public page. */
async function accepted(page: Page, browser: Browser, field: keyof ContactInfo, value: string): Promise<void> {
  await withContactInfo(page, { ...VALID, [field]: value }, async () => {
    const admin = new AdminContactPage(page);
    await expect(admin.flash.filter({ hasText: 'บันทึกข้อมูลเรียบร้อยแล้ว' }), 'success message').toBeVisible();
    const stored = await admin.info();
    expect(stored[field], 'stored as typed').toBe(value.trim());
    const label = PUBLIC_LABEL[field];
    if (label) expect((await publicContact(browser)).info[label], `shown on the public page under "${label}"`).toBe(value.trim());
  });
}

/** Saves VALID with `field` = `value`; the value must be refused with a message and not stored. */
async function refused(page: Page, values: Partial<ContactInfo>, field: keyof ContactInfo): Promise<void> {
  await withContactInfo(page, { ...VALID, ...values }, async (saved) => {
    const admin = new AdminContactPage(page);
    const errors = await admin.validationTexts();
    const success = await admin.flash.filter({ hasText: 'บันทึกข้อมูลเรียบร้อยแล้ว' }).isVisible();
    const stored = await admin.info();
    note(`Post ${saved.first} -> ${saved.final}; success message ${success}; errors ${JSON.stringify(errors)}; stored ${field} = ${JSON.stringify(stored[field])}`);
    expect(stored[field], 'the bad value is not stored').not.toBe(values[field]!.trim());
    expect(shownText(errors), 'a validation message is shown').not.toBe('');
  });
}

/** Stores VALID first, then saves `field` empty: it must be refused (required) and the earlier value kept. */
async function requiredField(page: Page, field: keyof ContactInfo): Promise<void> {
  await withContactInfo(page, VALID, async () => {
    const admin = new AdminContactPage(page);
    const saved = await admin.saveInfo({ [field]: '' });
    const errors = await admin.validationTexts();
    const stored = await admin.info();
    note(`Empty ${field}: post ${saved.first} -> ${saved.final}; errors ${JSON.stringify(errors)}; stored ${JSON.stringify(stored[field])}`);
    expect(stored[field], 'the empty value is not stored').toBe(VALID[field]);
    expect(shownText(errors), 'a "required" message is shown').not.toBe('');
    expect(stored, 'the other values are kept').toEqual(VALID);
  });
}

/** Either outcome is allowed by the sheet (policy TBD): no server error, and a stored value is shown as typed. */
async function eitherWay(page: Page, browser: Browser, field: keyof ContactInfo, value: string): Promise<void> {
  await withContactInfo(page, { ...VALID, [field]: value }, async (saved) => {
    const admin = new AdminContactPage(page);
    const errors = await admin.validationTexts();
    const stored = await admin.info();
    const kept = stored[field] === value;
    note(kept ? `Accepted: stored ${JSON.stringify(stored[field])}` : `Refused: ${JSON.stringify(errors)} (stored ${JSON.stringify(stored[field])})`);
    expect(saved.final).toBeLessThan(500);
    if (kept) {
      const label = PUBLIC_LABEL[field];
      const pub = await publicContact(browser);
      if (label) expect(pub.info[label], 'shown as typed').toBe(value);
      else expect(pub.links.map((l) => l.href), 'linked as typed').toContain(value);
    } else {
      expect(shownText(errors), 'a refusal says why').not.toBe('');
    }
  });
}

/** A markup payload is stored/shown as literal text: nothing runs in the admin or on the public page. */
async function markupIsText(page: Page, browser: Browser, field: keyof ContactInfo, label: string): Promise<void> {
  const dialogs = collectDialogs(page);
  await withContactInfo(page, { ...VALID, [field]: HTML_PAYLOAD }, async () => {
    const admin = new AdminContactPage(page);
    const stored = await admin.info();
    note(`Stored ${field}: ${JSON.stringify(stored[field])}`);
    if (stored[field] === HTML_PAYLOAD) {
      expect((await admin.shownInfo())[label], 'literal text in the admin').toBe(HTML_PAYLOAD);
      expect(await page.locator('#pills-detail b, #pills-detail script').count(), 'not rendered as markup in the admin').toBe(0);
      const pub = await publicContact(browser);
      expect(pub.dialogs, 'no script runs publicly').toEqual([]);
      if (PUBLIC_LABEL[field]) expect(pub.info[PUBLIC_LABEL[field]!], 'literal text publicly').toBe(HTML_PAYLOAD);
    } else {
      expect(stored[field], 'refused (or sanitised: no tags left)').not.toMatch(/<script|<b>/i);
    }
  });
  expect(dialogs, 'no script runs in the admin').toEqual([]);
}

test.describe('SC-ADMT-01 แท็บรายละเอียดการติดต่อ', () => {
  test('TC-ADMT-01-01 [Medium] [Positive] แสดงข้อมูลติดต่อปัจจุบัน', async ({ page }) => {
    const admin = new AdminContactPage(page);
    expect(await admin.open()).toBe(200);
    await expect(admin.heading).toBeVisible();
    await expect(admin.detailTab).toHaveClass(/active/);
    const shown = await admin.shownInfo();
    note(`Shown: ${JSON.stringify(shown)}`);
    expect(Object.keys(shown), 'phone, Facebook, email and address fields').toEqual(expect.arrayContaining(['เบอร์โทร', 'Facebook', 'อีเมล', 'ที่อยู่']));
    await expect(page.locator('#pills-detail h3', { hasText: 'สถานที่ตั้ง' }), 'the location section').toBeVisible();
    const stored = await admin.info();
    expect(shown, 'the current values').toMatchObject({ เบอร์โทร: stored.phone, Facebook: stored.facebook, อีเมล: stored.email, ที่อยู่: stored.address });
    const map = await admin.mapEmbed();
    if (!map) await expect(page.locator('#pills-detail').getByText('ยังไม่ได้ตั้งค่าแผนที่'), 'an empty map says so').toBeVisible();
    // Sheet remark (21/09/2026): the heading was "จัดการภาพสไลด์". The panel id is still #slideMod but its title now reads:
    await admin.openInfoForm();
    await expect(admin.infoPanel.locator('.offcanvas-header h5')).toHaveText('จัดการรายละเอียด');
  });

  test('TC-ADMT-01-03 [Medium] [Negative] ตรวจรูปแบบอีเมลและลิงก์ Facebook', async ({ page }) => {
    test.fail(true, HIDDEN_ERROR);
    requireDataCreatingTestsAllowed(SAVES);
    await withContactInfo(page, { ...VALID, email: 'abc@', facebook: 'not a url' }, async (saved) => {
      const admin = new AdminContactPage(page);
      const errors = await admin.validationTexts();
      const stored = await admin.info();
      note(`Post ${saved.first} -> ${saved.final}; errors ${JSON.stringify(errors)}; stored ${JSON.stringify(stored)}`);
      expect(stored.email, 'the bad email is not stored').not.toBe('abc@');
      expect(stored.facebook, 'the bad link is not stored').not.toBe('not a url');
      expect(shownText(errors), 'validation messages are shown').not.toBe('');
    });
  });
});

test.describe('SC-ADMT-03 ตั้งค่าข้อมูลติดต่อ: ตรวจทีละ field', () => {
  test('TC-ADMT-03-01 [High] [Positive] เบอร์โทร: รูปแบบ 0-2218-1128', async ({ page, browser }) => {
    requireDataCreatingTestsAllowed(SAVES);
    await accepted(page, browser, 'phone', '0-2218-1128');
  });
  test('TC-ADMT-03-02 [Low] [Positive] เบอร์โทร: รูปแบบ +66', async ({ page, browser }) => {
    requireDataCreatingTestsAllowed(SAVES);
    await eitherWay(page, browser, 'phone', '+66 2 218 1128');
  });
  test('TC-ADMT-03-03 [Medium] [Negative] เบอร์โทร: มีตัวอักษร', async ({ page }) => {
    test.fail(true, PHONE_UNCHECKED);
    requireDataCreatingTestsAllowed(SAVES);
    await refused(page, { phone: 'abc-defg' }, 'phone');
  });
  test('TC-ADMT-03-04 [Medium] [Negative] เบอร์โทร: สั้นเกินไป', async ({ page }) => {
    test.fail(true, PHONE_UNCHECKED);
    requireDataCreatingTestsAllowed(SAVES);
    await refused(page, { phone: '12' }, 'phone');
  });
  test('TC-ADMT-03-05 [Low] [Negative] เบอร์โทร: ยาวเกินกำหนด (30 หลัก)', async ({ page }) => {
    test.fail(true, PHONE_UNCHECKED);
    requireDataCreatingTestsAllowed(SAVES);
    await refused(page, { phone: '1'.repeat(30) }, 'phone');
  });
  test('TC-ADMT-03-06 [High] [Negative] เบอร์โทร: แท็กสคริปต์', async ({ page, browser }) => {
    requireDataCreatingTestsAllowed(SAVES);
    const dialogs = collectDialogs(page);
    await withContactInfo(page, { ...VALID, phone: '<script>alert(1)</script>' }, async () => {
      const stored = await new AdminContactPage(page).info();
      note(`Stored phone: ${JSON.stringify(stored.phone)}`);
      const pub = await publicContact(browser);
      expect(pub.dialogs, 'no script runs publicly').toEqual([]);
      if (stored.phone === '<script>alert(1)</script>') expect(pub.info['เบอร์โทร'], 'escaped: literal text publicly').toBe('<script>alert(1)</script>');
    });
    expect(dialogs, 'no script runs in the admin').toEqual([]);
  });

  test('TC-ADMT-03-07 [High] [Positive] อีเมล: อีเมลรูปแบบปกติ', async ({ page, browser }) => {
    requireDataCreatingTestsAllowed(SAVES);
    await accepted(page, browser, 'email', 'user01@example.com');
  });
  test('TC-ADMT-03-08 [Medium] [Positive] อีเมล: โดเมนย่อยและเครื่องหมาย +', async ({ page, browser }) => {
    requireDataCreatingTestsAllowed(SAVES);
    await accepted(page, browser, 'email', 'user.name+km@mail.nurse.chula.ac.th');
  });
  for (const [id, label, value] of [
    ['TC-ADMT-03-09 [High]', 'ไม่มีเครื่องหมาย @', 'user01example.com'],
    ['TC-ADMT-03-10 [High]', 'ไม่มีชื่อโดเมนหลัง @', 'user01@'],
    ['TC-ADMT-03-11 [Medium]', 'ไม่มีส่วนหน้า @', '@example.com'],
    ['TC-ADMT-03-12 [Medium]', 'มีช่องว่างในอีเมล', 'user 01@example.com'],
    ['TC-ADMT-03-13 [Low]', 'ยาวเกิน 254 ตัวอักษร', `${'a'.repeat(250)}@example.com`],
  ] as const) {
    test(`${id} [Negative] อีเมล: ${label}`, async ({ page }) => {
      test.fail(true, HIDDEN_ERROR);
      requireDataCreatingTestsAllowed(SAVES);
      await refused(page, { email: value }, 'email');
    });
  }
  test('TC-ADMT-03-14 [High] [Negative] อีเมล: เว้นว่าง', async ({ page }) => {
    test.fail(true, NOT_REQUIRED);
    requireDataCreatingTestsAllowed(SAVES);
    await requiredField(page, 'email');
  });

  test('TC-ADMT-03-15 [High] [Positive] Facebook: URL ที่ถูกต้อง (https)', async ({ page, browser }) => {
    requireDataCreatingTestsAllowed(SAVES);
    const url = 'https://www.facebook.com/nursechula';
    await withContactInfo(page, { ...VALID, facebook: url }, async () => {
      expect((await new AdminContactPage(page).info()).facebook, 'stored').toBe(url);
      const pub = await publicContact(browser);
      note(`Public contact links: ${JSON.stringify(pub.links)}; cards ${JSON.stringify(pub.info)}`);
      const link = pub.links.find((l) => l.href === url);
      expect(link, 'the public contact page links to the Facebook page').toBeDefined();
      expect(link!.target, 'opens in a new tab').toBe('_blank');
      expect(link!.rel, 'rel=noopener').toContain('noopener');
    });
  });
  test('TC-ADMT-03-16 [Low] [Positive] Facebook: URL แบบ http', async ({ page }) => {
    requireDataCreatingTestsAllowed(SAVES);
    // "บันทึกสำเร็จ หรือเตือนให้ใช้ https ตามนโยบาย (TBD)": either outcome passes; the note records which.
    await withContactInfo(page, { ...VALID, facebook: 'http://example.com/page' }, async (saved) => {
      const admin = new AdminContactPage(page);
      const errors = await admin.validationTexts();
      const stored = await admin.info();
      note(stored.facebook === 'http://example.com/page' ? 'Accepted as typed' : `Refused / changed: ${JSON.stringify(errors)} -> ${JSON.stringify(stored.facebook)}`);
      expect(saved.final).toBeLessThan(500);
      if (stored.facebook !== 'http://example.com/page') expect(shownText(errors), 'a refusal says why').not.toBe('');
    });
  });
  test('TC-ADMT-03-17 [Medium] [Negative] Facebook: ไม่มี scheme', async ({ page }) => {
    test.fail(true, URL_UNCHECKED);
    requireDataCreatingTestsAllowed(SAVES);
    await withContactInfo(page, { ...VALID, facebook: 'facebook.com/nursechula' }, async () => {
      const admin = new AdminContactPage(page);
      const errors = await admin.validationTexts();
      const stored = await admin.info();
      note(`Errors ${JSON.stringify(errors)}; stored ${JSON.stringify(stored.facebook)}`);
      // Either a validation message (nothing stored) or a scheme added automatically — not stored as a relative link.
      expect(stored.facebook, 'not stored without a scheme').not.toBe('facebook.com/nursechula');
      if (!/^https?:\/\//.test(stored.facebook)) expect(shownText(errors), 'a validation message').not.toBe('');
    });
  });
  test('TC-ADMT-03-18 [High] [Negative] Facebook: javascript: scheme', async ({ page, browser }) => {
    test.fail(true, URL_UNCHECKED);
    requireDataCreatingTestsAllowed(SAVES);
    await withContactInfo(page, { ...VALID, facebook: 'javascript:alert(1)' }, async () => {
      const stored = await new AdminContactPage(page).info();
      const pub = await publicContact(browser);
      note(`Stored ${JSON.stringify(stored.facebook)}; public links ${JSON.stringify(pub.links)}`);
      expect(pub.links.filter((l) => /^\s*javascript:/i.test(l.href)), 'no javascript: link on the public page').toEqual([]);
      expect(stored.facebook, 'refused').not.toBe('javascript:alert(1)');
    });
  });
  test('TC-ADMT-03-19 [High] [Negative] Facebook: data: scheme', async ({ page }) => {
    test.fail(true, URL_UNCHECKED);
    requireDataCreatingTestsAllowed(SAVES);
    await refused(page, { facebook: 'data:text/html,<script>alert(1)</script>' }, 'facebook');
  });
  test('TC-ADMT-03-20 [Medium] [Negative] Facebook: ข้อความที่ไม่ใช่ URL', async ({ page }) => {
    test.fail(true, URL_UNCHECKED);
    requireDataCreatingTestsAllowed(SAVES);
    await refused(page, { facebook: 'ไม่ใช่ลิงก์' }, 'facebook');
  });
  test('TC-ADMT-03-21 [Low] [Negative] Facebook: URL ยาวเกิน 2,000 ตัวอักษร', async ({ page }) => {
    test.fail(true, HIDDEN_ERROR);
    requireDataCreatingTestsAllowed(SAVES);
    const url = `https://www.facebook.com/${'a'.repeat(2_100 - 'https://www.facebook.com/'.length)}`;
    await refused(page, { facebook: url }, 'facebook');
  });
  test('TC-ADMT-03-22 [Medium] [Positive] Facebook: เว้นว่าง (ไม่บังคับ)', async ({ page, browser }) => {
    requireDataCreatingTestsAllowed(SAVES);
    await withContactInfo(page, { ...VALID, facebook: '' }, async () => {
      const admin = new AdminContactPage(page);
      await expect(admin.flash.filter({ hasText: 'บันทึกข้อมูลเรียบร้อยแล้ว' }), 'saved').toBeVisible();
      expect(await admin.info(), 'stored with an empty Facebook').toEqual({ ...VALID, facebook: '' });
      const pub = await publicContact(browser);
      note(`Public links: ${JSON.stringify(pub.links)}`);
      expect(pub.links.filter((l) => !l.href || l.href === '#'), 'no empty link on the public page').toEqual([]);
    });
  });

  test('TC-ADMT-03-23 [High] [Positive] ที่อยู่: ข้อความภาษาไทยปกติ', async ({ page, browser }) => {
    requireDataCreatingTestsAllowed(SAVES);
    await accepted(page, browser, 'address', 'ระบบจัดการความรู้ทดสอบ');
  });
  test('TC-ADMT-03-26 [High] [Negative] ที่อยู่: แท็ก HTML และสคริปต์', async ({ page, browser }) => {
    requireDataCreatingTestsAllowed(SAVES);
    await markupIsText(page, browser, 'address', 'ที่อยู่');
  });
  test('TC-ADMT-03-27 [High] [Negative] ที่อยู่: เว้นว่าง', async ({ page }) => {
    test.fail(true, NOT_REQUIRED);
    requireDataCreatingTestsAllowed(SAVES);
    await requiredField(page, 'address');
  });

  test('TC-ADMT-03-28 [Medium] [Positive] สถานที่ตั้ง (พิกัด): พิกัดที่ถูกต้อง (กรุงเทพฯ)', async ({ page, browser }) => {
    requireDataCreatingTestsAllowed('Saves the shared map (restored at the end of the case).');
    // What the page offers instead: an embed code. A map for lat 13.7367, lng 100.5231 must show on the public page.
    const embed = '<iframe src="https://maps.google.com/maps?q=13.7367,100.5231&z=15&output=embed" width="600" height="450" style="border:0;" loading="lazy"></iframe>';
    await withContactMap(page, embed, async () => {
      const admin = new AdminContactPage(page);
      await expect(admin.flash.filter({ hasText: 'บันทึกข้อมูลเรียบร้อยแล้ว' }), 'saved').toBeVisible();
      expect(await admin.mapEmbed(), 'stored').toBe(embed);
      const pub = await publicContact(browser);
      note(`Public iframes: ${JSON.stringify(pub.iframes)}`);
      expect(pub.iframes.some((src) => src.includes('13.7367,100.5231')), 'the public page shows the map at those coordinates').toBe(true);
      const coordinateFields = await page.locator('#locationMod input[name*="lat" i], #locationMod input[name*="lng" i], #locationMod input[name*="long" i]').count();
      test.fail(coordinateFields === 0, NO_COORDINATES);
      expect(coordinateFields, 'latitude/longitude fields').toBe(2);
    });
  });
  for (const [id, label] of [
    ['TC-ADMT-03-29 [Medium]', 'ละติจูดเกินช่วง'],
    ['TC-ADMT-03-30 [Medium]', 'ลองจิจูดเกินช่วง'],
    ['TC-ADMT-03-31 [Medium]', 'ค่าที่ไม่ใช่ตัวเลข'],
  ] as const) {
    test(`${id} [Negative] สถานที่ตั้ง (พิกัด): ${label}`, async ({ page }) => {
      test.fail(true, NO_COORDINATES);
      const admin = new AdminContactPage(page);
      await admin.open();
      await admin.locationEdit.click();
      await admin.mapInput.waitFor({ state: 'visible' });
      note(`Location panel: ${(await admin.locationPanel.innerText()).replace(/\s+/g, ' ')}`);
      expect(await page.locator('#locationMod input[name*="lat" i], #locationMod input[name*="lng" i]').count(), 'latitude/longitude fields to validate').toBe(2);
    });
  }
  test('TC-ADMT-03-32 [Low] [Negative] สถานที่ตั้ง (พิกัด): เว้นว่าง', async ({ page, browser }) => {
    requireDataCreatingTestsAllowed('Saves the shared map (restored at the end of the case).');
    await withContactMap(page, '', async (saved) => {
      const admin = new AdminContactPage(page);
      const errors = await admin.validationTexts();
      const map = await admin.mapEmbed();
      note(`Post ${saved.first} -> ${saved.final}; errors ${JSON.stringify(errors)}; stored ${JSON.stringify(map)}`);
      if (map === '') {
        await expect(page.locator('#pills-detail').getByText('ยังไม่ได้ตั้งค่าแผนที่'), 'the admin says no map is set').toBeVisible();
        const pub = await publicContact(browser);
        expect(pub.iframes, 'no (broken) map on the public page').toEqual([]);
      } else {
        expect(shownText(errors), 'or: a message asks for the map').not.toBe('');
      }
    });
  });
});

test.describe('SC-ADMT-04 รายการข้อความติดต่อ', () => {
  test('TC-ADMT-04-06 [Low] [Negative] เปิดข้อความของ id ที่ไม่มี', async ({ page }) => {
    // There is no message page: a message opens in the #viewMod panel, which marks it read with
    // POST /admin/contractus/messages/<opaque id>/read (GET there is 405). The case asks that endpoint for ids that
    // do not exist: a plain number and a malformed opaque id. Nothing can change — no such message.
    test.fail(true, 'Known bug (DEF-74): an unknown or malformed message id answers HTTP 500 instead of 404 (POST …/messages/99999/read, …/abc/read).');
    const admin = new AdminContactPage(page);
    await admin.open();
    const token = await csrfTokenOf(page);
    const statuses: Record<string, number> = {};
    for (const id of ['99999', 'abc']) {
      const response = await page.request.post(urlOf(`/admin/contractus/messages/${id}/read`), { headers: { 'X-CSRF-TOKEN': token, Accept: 'application/json' }, maxRedirects: 0 });
      statuses[id] = response.status();
    }
    note(`POST …/messages/<id>/read: ${JSON.stringify(statuses)}`);
    for (const [id, status] of Object.entries(statuses)) expect(status, `id ${id}: 404, not a server error`).toBe(404);
  });
});
