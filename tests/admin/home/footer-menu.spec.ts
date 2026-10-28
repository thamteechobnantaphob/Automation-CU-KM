import { test, expect } from '@fixtures/pages.fixtures';
import { requireDataCreatingTestsAllowed } from '@config/env';
import { AdminHomePage } from '@pages/admin/AdminHomePage';
import { deleteOwnMenus, menuIds, menuLink, menuTitle, ownMenus, publicFooter, shownMenuErrors, withMenu } from '@utils/footerFlows';
import { urlOf } from '@utils/lowPrivilege';
import { collectDialogs, SQL_ERROR_PATTERN } from '@utils/security';
import { Browser, Page } from '@playwright/test';

/**
 * KM-FFTR — the "ส่วนท้ายเว็บไซต์" tab of /admin/home/index (the footer menu) and the public footer (checked
 * 2026-10-05). Dev's footer items (หน้าหลัก, Knowledge, …) are the real site footer and are never touched: a case
 * deletes only the items it created (new section id + "[Auto Test]" in the title, or its stamped link when the title is
 * under test). Test items are added to column 1 as normal links, so they show under the column's last heading.
 *
 * NOT implemented ({MAX} undefined — DEF-52): TC-FFTR-02-04/05.
 */

const CREATES = 'Adds a footer menu item (deleted again at the end of the case).';
const HTML_PAYLOAD = '<b>bold</b><script>alert(1)</script>';
const SQL_PAYLOAD = "' OR 1=1; DROP TABLE users;--";
const URL_UNCHECKED = 'Known bug (DEF-72): the footer link is not validated — text, a link without scheme or with a space, javascript: and data: are saved, and the public footer links to them (javascript: link = stored XSS).';
const TITLE_NOT_REQUIRED = 'Known bug (DEF-78): a footer item with an empty / blank title is saved (shown as an empty entry) — the sheet expects the server to refuse it.';
const NOT_NEW_TAB = 'Known bug (DEF-79): external footer links open in the same tab with no rel (no target=_blank, no noopener/noreferrer).';
const EMPTY_LINK_HASH = 'Known bug (DEF-80): a footer item without a link is rendered as <a href="#"> instead of plain text.';
const LONG_URL = `https://www.example.com/${'a'.repeat(2_100 - 'https://www.example.com/'.length)}`;

test.beforeEach(() => test.setTimeout(90_000));

function note(description: string): void {
  test.info().annotations.push({ type: 'note', description });
}

/** A title is saved as typed and shown in the public footer (the stamped link identifies the item). */
async function titleSaved(page: Page, browser: Browser, title: string): Promise<void> {
  await withMenu(page, { title }, async ({ created, link }) => {
    expect(created.length, 'saved').toBe(1);
    expect(created[0].shownTitle, 'listed as typed (no &amp;, nothing lost)').toBe(title.trim());
    const footer = await publicFooter(browser);
    const item = footer.items.find((i) => i.href === link);
    expect(item, 'shown in the public footer').toBeDefined();
    expect(item!.text, 'as typed').toBe(title.trim());
  });
}

/** A title the server must refuse (empty / blank), with a visible message. */
async function titleRefused(page: Page, title: string): Promise<void> {
  await withMenu(page, { title }, async ({ created, errors }) => {
    note(created.length ? `Saved with title ${JSON.stringify(created[0].editTitle)}` : `Refused; messages ${JSON.stringify(errors)}`);
    expect(created.length, 'not saved').toBe(0);
    expect(shownMenuErrors(errors), 'a validation message is shown').not.toBe('');
  });
}

async function linkAccepted(page: Page, browser: Browser, link: string): Promise<void> {
  await withMenu(page, { link }, async ({ created, title }) => {
    expect(created.length, 'saved').toBe(1);
    expect(created[0].editLink, 'stored as typed').toBe(link);
    const item = (await publicFooter(browser)).items.find((i) => i.text === title);
    note(`Public footer item: ${JSON.stringify(item)}`);
    expect(item, 'shown in the public footer').toBeDefined();
    expect(item!.href, 'links to it').toBe(link);
    expect(item!.target, 'in a new tab').toBe('_blank');
    expect(item!.rel, 'rel=noopener').toContain('noopener');
  });
}

async function linkRefused(page: Page, browser: Browser, link: string, fixed?: (stored: string) => boolean): Promise<void> {
  await withMenu(page, { link }, async ({ saved, created, errors }) => {
    note(`Post ${saved.first} -> ${saved.final}; ${created.length ? `stored ${JSON.stringify(created[0].editLink)}` : 'not stored'}; messages ${JSON.stringify(errors)}`);
    expect(saved.final, 'no server error').toBeLessThan(500);
    if (created.length && fixed?.(created[0].editLink)) return;
    const footer = await publicFooter(browser);
    expect(footer.items.filter((i) => /^\s*(javascript|data):/i.test(i.href ?? '')), 'no script link in the public footer').toEqual([]);
    expect(created.length, 'not stored').toBe(0);
    expect(shownMenuErrors(errors), 'a validation message is shown').not.toBe('');
  });
}

test.describe('SC-FFTR-01 แท็บและแผงเมนูส่วนท้าย', () => {
  test("TC-FFTR-01-01 [High] [Positive] เปิดแท็บ 'ส่วนท้ายเว็บไซต์' แสดงคำอธิบายและรายการว่าง", async ({ page }) => {
    const home = new AdminHomePage(page);
    await home.open();
    await home.footerTab.click();
    await expect(home.footerHeading).toBeVisible();
    await expect(page.locator('#pills-footer').getByText('จัดการลิงก์ที่จะแสดงในส่วนท้ายของหน้าแรก')).toBeVisible();
    await expect(home.addMenuButton).toBeVisible();
    await expect(home.addMenuButton).toContainText('เพิ่มเมนู');
    const menus = await home.readMenus();
    if (menus.length) {
      note(`Not empty: Dev has ${menus.length} footer item(s) (the real site footer) — the empty state cannot show.`);
      await expect(home.menuEmptyState).toBeHidden();
    } else {
      await expect(home.menuEmptyState, '"ยังไม่มีรายการเมนูส่วนท้ายเว็บไซต์"').toBeVisible();
    }
  });

  test("TC-FFTR-01-02 [Low] [Positive] สลับแท็บ 'ภาพสไลด์' ↔ 'ส่วนท้ายเว็บไซต์' คงข้อมูล", async ({ page }) => {
    const home = new AdminHomePage(page);
    await home.open();
    const menusBefore = (await home.readMenus()).length;
    const slidesBefore = (await home.readSlides()).length;
    const navigations: string[] = [];
    page.on('framenavigated', (frame) => {
      if (frame === page.mainFrame()) navigations.push(frame.url());
    });
    for (let round = 0; round < 3; round++) {
      await home.footerTab.click();
      await expect(home.footerTab, 'the footer tab is highlighted').toHaveClass(/active/);
      await expect(home.footerHeading).toBeVisible();
      await expect(page.locator('#pills-slide')).toBeHidden();
      await home.slideTab.click();
      await expect(home.slideTab, 'the slide tab is highlighted').toHaveClass(/active/);
      await expect(page.locator('#pills-slide h3', { hasText: 'จัดการภาพสไลด์' })).toBeVisible();
      await expect(page.locator('#pills-footer')).toBeHidden();
    }
    expect(navigations, 'switching tabs does not reload the page').toEqual([]);
    expect((await home.readMenus()).length, 'footer items unchanged').toBe(menusBefore);
    expect((await home.readSlides()).length, 'slides unchanged').toBe(slidesBefore);
  });

  test("TC-FFTR-01-03 [High] [Positive] เปิดแผง 'เพิ่มเมนู': ช่องและค่าเริ่มต้น", async ({ page }) => {
    const home = new AdminHomePage(page);
    await home.openAddMenu();
    await expect(home.menuPanelTitle).toHaveText('จัดการส่วนท้ายเว็บไซต์');
    const text = ((await home.menuPanel.textContent()) ?? '').replace(/\s+/g, ' ');
    note(`Panel: ${text}`);
    for (const label of ['ชื่อลิ้งค์', 'URL ปลายทาง', 'สถานะ']) expect(text, label).toContain(label);
    expect(await home.menuLinkInput.getAttribute('placeholder'), 'placeholder https://example.com').toContain('https://example.com');
    for (const [status, label] of [['draft', 'ฉบับร่าง'], ['publish', 'เผยแพร่'], ['hide', 'ซ่อน']]) await expect(page.locator(`label[for="menu-status-${status}"]`)).toHaveText(label);
    await expect(page.locator('#menu-status-publish'), 'default "เผยแพร่"').toBeChecked();
    await expect(home.menuCancelButton).toBeVisible();
    await expect(home.menuSaveButton).toBeVisible();
    await expect(home.menuTitleInput).toHaveValue('');
    await expect(home.menuLinkInput).toHaveValue('');
  });

  test("TC-FFTR-01-04 [Medium] [Positive] ปิดแผงด้วย 'ยกเลิก' โดยไม่บันทึก", async ({ page }) => {
    const home = new AdminHomePage(page);
    const before = await menuIds(page);
    const title = menuTitle();
    await home.openAddMenu();
    await home.fillMenu({ title, link: menuLink() });
    await home.menuCancelButton.click();
    await expect(home.menuPanel).toBeHidden();
    await home.openAddMenu();
    await expect(home.menuTitleInput, 'reopened empty').toHaveValue('');
    await expect(home.menuLinkInput).toHaveValue('');
    await home.menuCancelButton.click();
    const after = await menuIds(page);
    expect([...after].filter((id) => !before.has(id)), 'no item was created').toEqual([]);
  });
});

test.describe('SC-FFTR-02 ชื่อลิ้งค์', () => {
  for (const [id, label, value] of [
    ['TC-FFTR-02-01 [High]', 'ข้อความภาษาไทยปกติ', 'ระบบจัดการความรู้ทดสอบ'],
    ['TC-FFTR-02-02 [Medium]', 'ภาษาอังกฤษและตัวเลข', 'Test Case 001'],
    ['TC-FFTR-02-03 [Medium]', 'ผสมไทย/อังกฤษ/ตัวเลข/สัญลักษณ์ทั่วไป', 'KM-Day 2569: SHOW & SHARE (รอบ 1)'],
    ['TC-FFTR-02-09 [Low]', 'อีโมจิและ Unicode พิเศษ', 'ทดสอบ 😀 ✓ ①'],
  ] as const) {
    test(`${id} [Positive] ชื่อลิ้งค์: ${label}`, async ({ page, browser }) => {
      requireDataCreatingTestsAllowed(CREATES);
      await titleSaved(page, browser, value);
    });
  }
  test('TC-FFTR-02-06 [Low] [Positive] ชื่อลิ้งค์: มีช่องว่างหน้า-หลังข้อความ', async ({ page }) => {
    requireDataCreatingTestsAllowed(CREATES);
    await withMenu(page, { title: '  ทดสอบ  ' }, async ({ created }) => {
      expect(created.length, 'saved').toBe(1);
      note(`Stored title: ${JSON.stringify(created[0].editTitle)}`);
      expect(created[0].editTitle, 'leading/trailing spaces removed').toBe('ทดสอบ');
    });
  });
  test('TC-FFTR-02-07 [High] [Negative] ชื่อลิ้งค์: แท็ก HTML และสคริปต์', async ({ page, browser }) => {
    requireDataCreatingTestsAllowed(CREATES);
    const dialogs = collectDialogs(page);
    await withMenu(page, { title: HTML_PAYLOAD }, async ({ created, link }) => {
      expect(created.length, 'saved (or refused below)').toBeLessThanOrEqual(1);
      if (created.length) {
        note(`Stored title: ${JSON.stringify(created[0].editTitle)}`);
        if (created[0].editTitle === HTML_PAYLOAD) expect(created[0].shownTitle, 'literal text in the admin').toBe(HTML_PAYLOAD);
        else expect(created[0].editTitle, 'sanitised: no tags left').not.toMatch(/<script|<b>/i);
        expect(await page.locator('.footer-sortable-list .card-body > .my-3 b, .footer-sortable-list script').count(), 'not rendered as markup in the admin').toBe(0);
      }
      const footer = await publicFooter(browser);
      expect(footer.dialogs, 'no script runs publicly').toEqual([]);
      expect(footer.html, 'not rendered as markup publicly').not.toContain(HTML_PAYLOAD);
      const item = footer.items.find((i) => i.href === link);
      if (item && created[0]?.editTitle === HTML_PAYLOAD) expect(item.text, 'literal text publicly').toBe(HTML_PAYLOAD);
    });
    expect(dialogs, 'no script runs in the admin').toEqual([]);
  });
  test('TC-FFTR-02-08 [High] [Negative] ชื่อลิ้งค์: อักขระ SQL', async ({ page }) => {
    requireDataCreatingTestsAllowed(CREATES);
    const before = (await new AdminHomePage(page).menus()).length;
    await withMenu(page, { title: SQL_PAYLOAD }, async ({ created }) => {
      expect(SQL_ERROR_PATTERN.test(await page.locator('body').innerText()), 'no SQL error').toBe(false);
      note(created.length ? `Saved as ${JSON.stringify(created[0].editTitle)}` : 'Refused');
      if (created.length) expect(created[0].editTitle).toBe(SQL_PAYLOAD);
      expect((await new AdminHomePage(page).menus()).length, 'nothing else touched').toBe(before + created.length);
    });
  });
  test('TC-FFTR-02-10 [High] [Negative] ชื่อลิ้งค์: เว้นว่าง', async ({ page }) => {
    test.fail(true, TITLE_NOT_REQUIRED);
    requireDataCreatingTestsAllowed('If the app accepts an empty title it adds a footer item (deleted again at the end).');
    // The sheet: "ช่องนี้ไม่มี required ในเบราว์เซอร์" — so the post reaches the server, which must refuse it.
    const home = new AdminHomePage(page);
    await home.openAddMenu();
    note(`Title input required attribute: ${JSON.stringify(await home.menuTitleInput.getAttribute('required'))}`);
    await home.menuCancelButton.click();
    await titleRefused(page, '');
  });
  test('TC-FFTR-02-11 [Medium] [Negative] ชื่อลิ้งค์: ช่องว่างล้วน (เว้นวรรค 5 ตัว)', async ({ page }) => {
    test.fail(true, TITLE_NOT_REQUIRED);
    requireDataCreatingTestsAllowed('If the app accepts a blank title it adds a footer item (deleted again at the end).');
    await titleRefused(page, '     ');
  });
});

test.describe('SC-FFTR-03 URL ปลายทาง', () => {
  test('TC-FFTR-03-01 [High] [Positive] URL ปลายทาง: URL ที่ถูกต้อง (https)', async ({ page, browser }) => {
    test.fail(true, NOT_NEW_TAB);
    requireDataCreatingTestsAllowed(CREATES);
    await linkAccepted(page, browser, 'https://www.facebook.com/nursechula');
  });
  test('TC-FFTR-03-02 [Low] [Positive] URL ปลายทาง: URL แบบ http', async ({ page }) => {
    requireDataCreatingTestsAllowed(CREATES);
    await withMenu(page, { link: 'http://example.com/page' }, async ({ saved, created, errors }) => {
      note(created.length ? `Accepted: ${JSON.stringify(created[0].editLink)}` : `Refused: ${JSON.stringify(errors)}`);
      expect(saved.final).toBeLessThan(500);
      if (!created.length) expect(shownMenuErrors(errors), 'a refusal says why').not.toBe('');
    });
  });
  test('TC-FFTR-03-03 [Medium] [Negative] URL ปลายทาง: ไม่มี scheme', async ({ page, browser }) => {
    test.fail(true, URL_UNCHECKED);
    requireDataCreatingTestsAllowed(CREATES);
    await linkRefused(page, browser, 'facebook.com/nursechula', (stored) => /^https?:\/\/(www\.)?facebook\.com\/nursechula$/.test(stored));
  });
  test('TC-FFTR-03-04 [High] [Negative] URL ปลายทาง: javascript: scheme', async ({ page, browser }) => {
    test.fail(true, URL_UNCHECKED);
    requireDataCreatingTestsAllowed(CREATES);
    await linkRefused(page, browser, 'javascript:alert(1)');
  });
  test('TC-FFTR-03-05 [High] [Negative] URL ปลายทาง: data: scheme', async ({ page, browser }) => {
    test.fail(true, URL_UNCHECKED);
    requireDataCreatingTestsAllowed(CREATES);
    await linkRefused(page, browser, 'data:text/html,<script>alert(1)</script>');
  });
  test('TC-FFTR-03-06 [Medium] [Negative] URL ปลายทาง: ข้อความที่ไม่ใช่ URL', async ({ page, browser }) => {
    test.fail(true, URL_UNCHECKED);
    requireDataCreatingTestsAllowed(CREATES);
    await linkRefused(page, browser, 'ไม่ใช่ลิงก์');
  });
  test('TC-FFTR-03-07 [Low] [Negative] URL ปลายทาง: URL ยาวเกิน 2,000 ตัวอักษร', async ({ page, browser }) => {
    requireDataCreatingTestsAllowed(CREATES);
    await linkRefused(page, browser, LONG_URL);
  });
  test('TC-FFTR-03-08 [Medium] [Positive] URL ปลายทาง: เว้นว่าง (ไม่บังคับ)', async ({ page, browser }) => {
    test.fail(true, EMPTY_LINK_HASH);
    requireDataCreatingTestsAllowed(CREATES);
    await withMenu(page, { link: '' }, async ({ created, title }) => {
      expect(created.length, 'saved without a link').toBe(1);
      const footer = await publicFooter(browser);
      const item = footer.items.find((i) => i.text === title);
      note(`Public footer item: ${JSON.stringify(item)}`);
      expect(item, 'shown in the public footer').toBeDefined();
      expect(item!.href === null || (item!.href !== '' && item!.href !== '#'), 'plain text, not an empty link').toBe(true);
    });
  });
  test('TC-FFTR-03-09 [Medium] [Positive] URL ปลายทาง: ลิงก์ภายในเว็บแบบ path', async ({ page, browser }) => {
    requireDataCreatingTestsAllowed(CREATES);
    const link = '/frontend/faq/index';
    await withMenu(page, { link }, async ({ created, title, errors }) => {
      note(created.length ? `Stored ${JSON.stringify(created[0].editLink)}` : `Refused: ${JSON.stringify(errors)}`);
      expect(created.length, 'saved').toBe(1);
      const item = (await publicFooter(browser)).items.find((i) => i.text === title);
      expect(item?.href, 'shown in the public footer').toBeTruthy();
      const target = new URL(item!.href!, urlOf('/'));
      expect(target.origin, 'a page of this site').toBe(new URL(urlOf('/')).origin);
      expect(target.pathname).toBe(link);
      expect((await page.request.get(target.toString())).status(), 'the page opens').toBe(200);
    });
  });
  test('TC-FFTR-03-11 [Low] [Negative] URL ปลายทาง: ลิงก์มีช่องว่างกลาง', async ({ page, browser }) => {
    test.fail(true, URL_UNCHECKED);
    requireDataCreatingTestsAllowed(CREATES);
    await linkRefused(page, browser, 'https://www.example .com', (stored) => !/\s/.test(stored));
  });
});

test.describe('SC-FFTR-04 การแสดงผลบน Public', () => {
  test('TC-FFTR-04-04 [Low] [Positive] ลิงก์ภายนอกเปิดอย่างปลอดภัย', async ({ page, browser }) => {
    test.fail(true, NOT_NEW_TAB);
    requireDataCreatingTestsAllowed(CREATES);
    await withMenu(page, { link: 'https://example.com/' }, async ({ created, title }) => {
      expect(created.length, 'saved').toBe(1);
      const item = (await publicFooter(browser)).items.find((i) => i.text === title);
      note(`Public footer item: ${JSON.stringify(item)}`);
      expect(item, 'shown in the public footer').toBeDefined();
      expect(item!.rel, 'rel=noopener').toContain('noopener');
      expect(item!.rel, 'rel=noreferrer').toContain('noreferrer');
    });
  });
});

test.describe('SC-FFTR-05 ความปลอดภัย', () => {
  test('TC-FFTR-05-04 [High] [Negative] ส่งฟอร์มโดยไม่มี CSRF token', async ({ page }) => {
    const before = await menuIds(page);
    const title = menuTitle();
    try {
      const response = await page.request.post(urlOf('/admin/home-sections'), { form: { type: 'footer', title, link: menuLink(), footer_column: '1', font_weight: 'normal', status: 'publish' }, maxRedirects: 0 });
      note(`POST /admin/home-sections without _token -> ${response.status()}`);
      expect([403, 419], 'refused').toContain(response.status());
      expect(await ownMenus(page, before, { title }), 'nothing created').toEqual([]);
    } finally {
      await deleteOwnMenus(page, before, { title });
    }
  });
});
