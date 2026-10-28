import { test, expect } from '@fixtures/pages.fixtures';
import { requireDataCreatingTestsAllowed } from '@config/env';
import { AdminNewsListPage, ContentModule, NewsFormPage } from '@pages/admin/AdminNewsPages';
import { urlOf } from '@utils/lowPrivilege';
import {
  confirmNewsDelete,
  contentMarker,
  createNewsCategory,
  deleteNewsByExcerpt,
  deleteNewsCategory,
  deleteNewsWhere,
  publicNewsDetail,
  publicNewsList,
  submitNews,
} from '@utils/newsFlows';
import { roleStamp } from '@utils/roleFlows';
import { describeSeed } from '@utils/seedContent';
import { collectDialogs, SQL_ERROR_PATTERN } from '@utils/security';
import { AUTO_TEST_FLAG } from '@utils/testData';
import { Browser, Page } from '@playwright/test';

/**
 * The list/field cases the sheet repeats for every content module that shares #content-module-form — KM-NEWS and
 * KM-BP use the same case numbers and steps. `contentListSuite()` registers them for one module; the spec files only
 * pass the module and its wording. Test titles are built exactly as the sheet words them for that module.
 *
 * Data: every item a case saves is deleted again in a `finally`, found by the "[Auto Test]" marker + stamp in its
 * excerpt (in its title when the excerpt is the field under test). A module may have a seeded item (news:
 * AUTO_NEWS_001) that is created once and never touched.
 */
export interface ContentListSuite {
  module: ContentModule;
  /** Case prefix: "NEWS" → TC-NEWS-01-01. */
  prefix: string;
  /** How the sheet names the module in titles: "ข่าวกิจกรรม KM", "แนวทางปฏิบัติที่ดี (Best Practice)". */
  name: string;
  /** Short noun for test data titles: "ข่าว", "แนวปฏิบัติ". */
  noun: string;
  /** The module's seeded item, if it has one. */
  seed?: { name: string; ensure: (browser: Browser) => Promise<Parameters<typeof describeSeed>[0]> };
}

const HTML_PAYLOAD = '<b>bold</b><script>alert(1)</script>';
const SQL_PAYLOAD = "' OR 1=1; DROP TABLE users;--";

function note(description: string): void {
  test.info().annotations.push({ type: 'note', description });
}

export function contentListSuite(cfg: ContentListSuite): void {
  const { module: M, prefix: P, name, noun } = cfg;
  const CREATES = `Saves a ${M.key} item (deleted again at the end of the case).`;
  const id = (n: string): string => `TC-${P}-${n}`;
  const marker = (): string => contentMarker(`${noun}ทดสอบอัตโนมัติ`);
  const list = (page: Page): AdminNewsListPage => new AdminNewsListPage(page, M);
  const form = (page: Page): NewsFormPage => new NewsFormPage(page, M);

  // Save + public check + cleanup takes longer than the 30 s default on Dev.
  test.beforeEach(() => test.setTimeout(90_000));
  if (cfg.seed) {
    let seedNote = '';
    const seed = cfg.seed;
    test.beforeAll(async ({ browser }) => {
      test.setTimeout(120_000);
      seedNote = describeSeed(await seed.ensure(browser));
    });
    test.beforeEach(() => {
      test.info().annotations.push({ type: 'note', description: `Test data: ${seedNote}` });
    });
  }

  /** Saves an item, runs `checks` while it exists, then deletes it (by its excerpt). */
  async function withItem(page: Page, values: Parameters<typeof submitNews>[1], checks: (excerpt: string) => Promise<void>): Promise<void> {
    const excerpt = values.excerpt ?? marker();
    try {
      const { submitted } = await submitNews(page, { ...values, excerpt }, M);
      expect(submitted.final, 'saving is not a server error').toBeLessThan(500);
      await checks(excerpt);
    } finally {
      note(`Cleanup: deleted ${await deleteNewsByExcerpt(page, excerpt, M)} item(s).`);
    }
  }

  test.describe(`SC-${P}-01 รายการ${name}`, () => {
    test(`${id('01-01')} [High] [Positive] แสดงหน้ารายการ${name}`, async ({ page }) => {
      const l = list(page);
      expect(await l.open()).toBe(200);
      await expect(l.listHeading).toBeVisible();
      await expect(l.addLink).toBeVisible();
      await expect(l.addLink).toHaveAttribute('href', urlOf(`/admin/${M.key}/create`));
      const counter = await l.counter();
      expect(counter, 'the "แสดง x-y รายการ จาก n รายการ" line').not.toBeNull();
      const cards = await l.readCards();
      if (cards.length === 0) {
        await expect(l.emptyState, 'empty state').toBeVisible();
        expect(counter).toEqual({ from: 0, to: 0, total: 0 });
        note('No item yet: empty state + "แสดง0-0 รายการ จาก 0 รายการ".');
        return;
      }
      for (const card of cards) {
        expect(card.creator, `creator of "${card.title}"`).not.toBe('');
        expect(card.created, `date of "${card.title}"`).toMatch(/\d{2} \S+ \d{2}/);
        expect(['เผยแพร่', 'ฉบับร่าง', 'ซ่อน'], `status of "${card.title}"`).toContain(card.status);
        expect(card.title).not.toBe('');
      }
      expect(counter!.to - counter!.from + 1, 'the counter matches the cards on the page').toBe(cards.length);
      note(`${counter!.total} item(s): ${cards.map((card) => `${card.title} (${card.status})`).join(' | ')}`);
    });
  });

  test.describe(`SC-${P}-03 แก้ไขและลบ${name}`, () => {
    test(`${id('03-02')} [High] [Positive] ลบ${name} - กดยกเลิกใน dialog`, async ({ page }) => {
      requireDataCreatingTestsAllowed(CREATES);
      const l = list(page);
      await withItem(page, { title: `[Auto Test] ${noun}สำหรับทดสอบยกเลิกการลบ ${roleStamp()}` }, async (excerpt) => {
        const before = await l.total();
        const dialog = await l.openDeleteDialog(excerpt);
        await dialog.cancel();
        await expect(dialog.root, 'the dialog closes').toBeHidden();
        expect(await l.findByExcerpt(excerpt), 'cancel keeps the item').toBeDefined();
        expect(await l.total(), 'the count does not change').toBe(before);
      });
    });

    test(`${id('03-03')} [High] [Positive] ลบ${name} - กดยืนยันลบข้อมูล`, async ({ page, browser }) => {
      requireDataCreatingTestsAllowed(CREATES);
      const l = list(page);
      const title = `[Auto Test] ${noun}สำหรับทดสอบการลบ ${roleStamp()}`;
      await withItem(page, { title, status: 'publish', timing: 'now' }, async (excerpt) => {
        expect((await publicNewsList(browser, M)).text, 'listed publicly before the delete').toContain(title);
        const before = await l.total();
        const result = await confirmNewsDelete(page, excerpt, M);
        expect(result.final, 'the delete is not a server error').toBeLessThan(400);
        await expect(l.flash.filter({ hasText: M.deletedFlash })).toBeVisible();
        expect(await l.findByExcerpt(excerpt), 'gone from the admin list').toBeUndefined();
        expect(await l.total(), 'one item less').toBe(before - 1);
        expect((await publicNewsList(browser, M)).text, 'gone from the public list').not.toContain(title);
        // "มีบันทึกการลบใน 'ประวัติการใช้งานระบบ' (ถ้ามีการรองรับ)"
        await page.goto(urlOf('/admin/activity-log'));
        const rows = (await page.locator('table tbody tr').allInnerTexts()).slice(0, 20).join(' | ');
        note(new RegExp(`${M.key}|${noun}`, 'i').test(rows) ? 'The activity log shows the delete.' : 'The activity log does not record these deletes (only logins/users/roles) — "ถ้ามีการรองรับ": not supported.');
      });
    });
  });

  test.describe(`SC-${P}-05 หัวเรื่อง`, () => {
    test(`${id('05-01')} [High] [Positive] หัวเรื่อง: ข้อความภาษาไทยปกติ`, async ({ page, browser }) => {
      requireDataCreatingTestsAllowed(CREATES);
      const title = 'ระบบจัดการความรู้ทดสอบ';
      await withItem(page, { title, status: 'publish', timing: 'now' }, async (excerpt) => {
        expect((await list(page).findByExcerpt(excerpt))?.title, 'listed in the admin as typed').toBe(title);
        const detail = await publicNewsDetail(browser, excerpt, M);
        expect(detail, `listed on ${M.publicIndex}`).toBeDefined();
        note(`Public detail: ${detail!.url}`);
        expect(detail!.status, 'the public detail page opens').toBe(200);
        expect(detail!.text, 'the detail page shows the title').toContain(title);
      });
    });

    test(`${id('05-04')} [High] [Negative] หัวเรื่อง: แท็ก HTML และสคริปต์`, async ({ page, browser }) => {
      requireDataCreatingTestsAllowed(CREATES);
      const dialogs = collectDialogs(page);
      await withItem(page, { title: HTML_PAYLOAD, status: 'publish', timing: 'now' }, async (excerpt) => {
        const l = list(page);
        expect((await l.findByExcerpt(excerpt))?.title, 'stored and shown as literal text in the admin').toBe(HTML_PAYLOAD);
        expect(await l.cards.locator('.title-text b, .title-text script').count(), 'not rendered as markup').toBe(0);
        const pub = await publicNewsList(browser, M);
        expect(pub.dialogs, 'no script runs on the public list').toEqual([]);
        expect(pub.text, 'literal text on the public list').toContain(HTML_PAYLOAD);
        const detail = await publicNewsDetail(browser, excerpt, M);
        expect(detail, 'listed publicly').toBeDefined();
        note(`Public detail: ${detail!.url} (HTTP ${detail!.status})`);
        expect(detail!.status, 'the public detail page opens').toBe(200);
        expect(detail!.dialogs, 'no script runs on the detail page').toEqual([]);
        expect(detail!.text, 'literal text on the detail page').toContain(HTML_PAYLOAD);
      });
      expect(dialogs, 'no script runs in the admin').toEqual([]);
    });

    test(`${id('05-05')} [High] [Negative] หัวเรื่อง: อักขระ SQL`, async ({ page }) => {
      requireDataCreatingTestsAllowed(CREATES);
      const l = list(page);
      const before = await l.total();
      await withItem(page, { title: SQL_PAYLOAD }, async (excerpt) => {
        expect(SQL_ERROR_PATTERN.test(await page.locator('body').innerText()), 'no SQL error text').toBe(false);
        const saved = await l.findByExcerpt(excerpt);
        note(saved ? `Saved as ${JSON.stringify(saved.title)}` : 'Rejected');
        if (saved) expect(saved.title, 'kept as plain text').toBe(SQL_PAYLOAD);
        expect(await l.total(), 'nothing else touched').toBe(before + (saved ? 1 : 0));
        if (cfg.seed) expect(await l.locate((card) => card.title === cfg.seed!.name), 'the seeded item is still there').toBeDefined();
      });
    });

    test(`${id('05-06')} [High] [Negative] หัวเรื่อง: เว้นว่าง`, async ({ page }) => {
      const l = list(page);
      const f = form(page);
      const before = await l.total();
      await f.openCreate();
      // Only press "บันทึก" once the browser guard is confirmed, otherwise this read-only case could save a record.
      await expect(f.titleInput).toHaveAttribute('required', '');
      const excerpt = marker();
      await f.fill({ title: '', excerpt, body: '<p>เนื้อหาทดสอบ</p>' });
      await f.saveButton.click();
      await expect(page, 'still on the create form').toHaveURL(new RegExp(`/admin/${M.key}/create$`));
      expect(await f.titleInput.evaluate((el: HTMLInputElement) => el.validationMessage), 'validation on the title').not.toBe('');
      await expect(f.excerptInput, 'what was typed stays').toHaveValue(excerpt);
      expect(await l.total(), 'nothing was saved').toBe(before);
    });

    test(`${id('05-07')} [Medium] [Negative] หัวเรื่อง: ช่องว่างล้วน (เว้นวรรค 5 ตัว)`, async ({ page }) => {
      requireDataCreatingTestsAllowed('If the app accepts a blank title it saves an item (deleted again at the end).');
      await withItem(page, { title: '     ' }, async (excerpt) => {
        const saved = await list(page).findByExcerpt(excerpt);
        note(saved ? `Saved with title ${JSON.stringify(saved.title)}` : 'Not saved');
        expect(saved, 'five spaces count as empty: nothing is saved').toBeUndefined();
      });
    });
  });

  test.describe(`SC-${P}-06 รายละเอียดแบบย่อ`, () => {
    test(`${id('06-03')} [High] [Negative] รายละเอียดแบบย่อ: แท็ก HTML และสคริปต์`, async ({ page, browser }) => {
      requireDataCreatingTestsAllowed(CREATES);
      // The excerpt is under test, so the marker + stamp go into the title this time.
      const title = `[Auto Test] ${noun}ทดสอบรายละเอียดย่อ ${roleStamp()}`;
      const excerpt = `${HTML_PAYLOAD} ${AUTO_TEST_FLAG}`;
      const dialogs = collectDialogs(page);
      try {
        const { submitted } = await submitNews(page, { title, excerpt, status: 'publish', timing: 'now' }, M);
        expect(submitted.final).toBeLessThan(500);
        const l = list(page);
        const card = (await l.locate((c) => c.title === title))?.card;
        expect(card, 'saved').toBeDefined();
        expect(card!.excerpt, 'stored and shown as literal text in the admin').toBe(excerpt);
        expect(await l.cards.locator('.content-section b, .content-section script').count(), 'not rendered as markup').toBe(0);
        const pub = await publicNewsList(browser, M);
        expect(pub.dialogs, 'no script runs on the public list').toEqual([]);
        expect(pub.text, 'literal text on the public list').toContain(HTML_PAYLOAD);
        const detail = await publicNewsDetail(browser, title, M);
        expect(detail?.dialogs ?? [], 'no script runs on the detail page').toEqual([]);
      } finally {
        note(`Cleanup: deleted ${await deleteNewsWhere(page, (c) => c.title === title, M)} item(s).`);
      }
      expect(dialogs, 'no script runs in the admin').toEqual([]);
    });
  });

  test.describe(`SC-${P}-07 หมวดหมู่`, () => {
    test(`${id('07-01')} [High] [Positive] เลือกหมวดหมู่จากรายการ`, async ({ page, browser }) => {
      test.setTimeout(180_000);
      requireDataCreatingTestsAllowed(`Saves two "${M.categoryTab}" categories and an item (all deleted again at the end).`);
      const categories: string[] = [];
      const excerpt = marker();
      const f = form(page);
      const l = list(page);
      try {
        // Precondition (workflow): categories of the module's tab to pick from.
        categories.push(await createNewsCategory(page, `[Auto Test] หมวด${noun} ก`, M));
        categories.push(await createNewsCategory(page, `[Auto Test] หมวด${noun} ข`, M));
        await f.openCreate();
        const options = (await f.categoryOptions()).filter((option) => option && option !== '— ไม่ระบุ —');
        expect(options, 'the new categories are offered').toEqual(expect.arrayContaining(categories));
        const [first, last] = [options[0], options[options.length - 1]];
        note(`Options: ${options.join(' | ')}`);
        await f.fill({ title: `[Auto Test] ${noun}ทดสอบหมวดหมู่ ${roleStamp()}`, excerpt, category: first, body: '<p>เนื้อหาทดสอบ</p>', status: 'publish', timing: 'now' });
        expect((await f.save()).final).toBeLessThan(500);
        const card = await l.findByExcerpt(excerpt);
        expect(card, 'saved').toBeDefined();
        await f.openEdit(card!.editHref);
        expect(await f.selectedCategory(), 'the edit form shows the first category').toBe(first);
        const detail1 = await publicNewsDetail(browser, excerpt, M);
        note(`Public detail ${detail1?.url}: ${detail1?.text.includes(first) ? 'shows' : 'does NOT show'} the category "${first}".`);
        await f.fill({ category: last });
        expect((await f.save()).final).toBeLessThan(500);
        await f.openEdit((await l.findByExcerpt(excerpt))!.editHref);
        expect(await f.selectedCategory(), 'the edit form shows the last category').toBe(last);
        const detail2 = await publicNewsDetail(browser, excerpt, M);
        expect.soft(detail2?.text ?? '', 'the public detail page shows the chosen category').toContain(last);
      } finally {
        note(`Cleanup: deleted ${await deleteNewsByExcerpt(page, excerpt, M)} item(s).`);
        for (const category of categories) note(`Cleanup: category "${category}" ${(await deleteNewsCategory(page, category, M)) ? 'deleted' : 'NOT deleted'}.`);
      }
    });

    test(`${id('07-02')} [High] [Negative] ไม่เลือกหมวดหมู่`, async ({ page }) => {
      requireDataCreatingTestsAllowed(CREATES);
      const f = form(page);
      await f.openCreate();
      expect(await f.categoryValue(), 'default = no category (picker shows "เลือกหมวดหมู่", DEF-57)').toBe('');
      const required = await f.categorySelect.evaluate((el: HTMLSelectElement) => el.required);
      await withItem(page, { title: `[Auto Test] ${noun}ไม่ระบุหมวดหมู่ ${roleStamp()}` }, async (excerpt) => {
        const saved = await list(page).findByExcerpt(excerpt);
        note(`Category select required=${required}; ${saved ? 'saved without a category' : 'not saved'}.`);
        // The sheet: "แจ้ง validation (หากเป็นช่องบังคับ)". The form defaults to no category and offers "— ไม่ระบุ —",
        // i.e. the category is optional by design — then saving without one is the expected outcome.
        if (required) expect(saved, 'a required category blocks the save').toBeUndefined();
        else expect(saved, 'optional category: saved without one').toBeDefined();
      });
    });
  });

  test.describe(`SC-${P}-08 แท็ก`, () => {
    test(`${id('08-01')} [Medium] [Positive] เพิ่มหลายแท็ก (5 แท็ก)`, async ({ page, browser }) => {
      requireDataCreatingTestsAllowed(CREATES);
      // Tags stay in the system once saved (no admin page to remove them), so the same five are reused every run.
      const tags = ['autotest1', 'autotest2', 'autotest3', 'autotest4', 'autotest5'];
      const f = form(page);
      await withItem(page, { title: `[Auto Test] ${noun}ทดสอบแท็ก ${roleStamp()}`, tags, status: 'publish', timing: 'now' }, async (excerpt) => {
        await f.openEdit((await list(page).findByExcerpt(excerpt))!.editHref);
        expect((await f.tagTexts()).sort(), 'all five tags are stored').toEqual(tags);
        const detail = await publicNewsDetail(browser, excerpt, M);
        expect(detail, 'listed publicly').toBeDefined();
        for (const tag of tags) expect(detail!.text, `the public page shows #${tag}`).toContain(`#${tag}`);
      });
    });

    test(`${id('08-02')} [Medium] [Negative] แท็กซ้ำในบทความเดียวกัน`, async ({ page }) => {
      const f = form(page);
      await f.openCreate();
      await f.addTag('km');
      await f.addTag('km');
      // An existing "KM" tag (any case) is picked instead of a new one — what matters is a single chip.
      expect((await f.tagTexts()).map((tag) => tag.toLowerCase()), 'only one "km" chip').toEqual(['km']);
    });

    test(`${id('08-03')} [Low] [Negative] แท็กว่างเปล่า/ช่องว่างล้วน`, async ({ page }) => {
      const f = form(page);
      await f.openCreate();
      await f.tagInput.press('Enter');
      await f.addTag('   ');
      expect(await f.tagTexts(), 'no empty tag').toEqual([]);
      expect(await f.tagChips.count(), 'no chip at all').toBe(0);
    });

    test(`${id('08-04')} [High] [Negative] แท็กที่มี HTML/สคริปต์`, async ({ page, browser }) => {
      requireDataCreatingTestsAllowed(CREATES + ' The tag itself stays in the system (no page to remove tags).');
      const payload = '<script>alert(1)</script>';
      const dialogs = collectDialogs(page);
      const f = form(page);
      await withItem(page, { title: `[Auto Test] ${noun}ทดสอบแท็กสคริปต์ ${roleStamp()}`, tags: [payload], status: 'publish', timing: 'now' }, async (excerpt) => {
        await f.openEdit((await list(page).findByExcerpt(excerpt))!.editHref);
        expect(await f.tagTexts(), 'stored as literal text').toEqual([payload]);
        expect(await page.locator('#tag-chips script').count(), 'not rendered as markup in the form').toBe(0);
        const detail = await publicNewsDetail(browser, excerpt, M);
        expect(detail, 'listed publicly').toBeDefined();
        expect(detail!.dialogs, 'no script runs on the public page').toEqual([]);
        expect(detail!.text, 'shown as literal text').toContain(payload);
      });
      expect(dialogs, 'no script runs in the admin').toEqual([]);
    });
  });

  test.describe(`SC-${P}-09 เนื้อหา`, () => {
    // The form's title is "the only required field"; the body has no `required`. The sheet makes both cases
    // conditional ("หากเป็นช่องบังคับ"), so what must hold is: no server error, and the outcome is recorded.
    for (const [n, label, body] of [
      ['09-01 [High]', 'เนื้อหาว่างเปล่า', ''],
      ['09-02 [Medium]', 'เนื้อหาเป็นช่องว่าง/ขึ้นบรรทัดใหม่ล้วน', '<p>&nbsp;&nbsp;&nbsp;</p><p>&nbsp;</p><p>&nbsp;</p>'],
    ] as const) {
      test(`${id(n)} [Negative] ${label}`, async ({ page }) => {
        requireDataCreatingTestsAllowed('If the app accepts an empty body it saves an item (deleted again at the end).');
        await withItem(page, { title: `[Auto Test] ${noun}ทดสอบเนื้อหาว่าง ${roleStamp()}`, body }, async (excerpt) => {
          expect(SQL_ERROR_PATTERN.test(await page.locator('body').innerText())).toBe(false);
          const saved = await list(page).findByExcerpt(excerpt);
          note(saved ? 'Saved with an empty body — the body is optional (only the title is required).' : 'Not saved — validation for the body.');
        });
      });
    }
  });

  test.describe(`SC-${P}-12 รายการ: พารามิเตอร์และการเรียง`, () => {
    test(`${id('12-02')} [Low] [Negative] ?page นอกช่วงและไม่ใช่ตัวเลข`, async ({ page }) => {
      const l = list(page);
      const results: string[] = [];
      for (const value of ['0', '-1', 'abc', '99999']) {
        const status = await l.open(`?page=${value}`);
        const cards = await l.cards.count();
        results.push(`?page=${value} -> ${status}, ${cards} card(s)`);
        expect(status, `?page=${value} is not a server error`).toBeLessThan(500);
        expect(SQL_ERROR_PATTERN.test(await page.locator('body').innerText())).toBe(false);
      }
      note(results.join(' | '));
    });

    test(`${id('12-03')} [Medium] [Negative] เปิดหน้าแก้ไขด้วย id ที่ไม่มี/ไม่ใช่ตัวเลข`, async ({ request }) => {
      // KNOWN BUG (2026-10-02): the encrypted-id lookup throws for an unknown/malformed id (same family as DEF-9/26/51).
      test.fail(true, `Known bug (DEF-54): /admin/${M.key}/<unknown or malformed id>/edit answers HTTP 500 instead of 404.`);
      const results: string[] = [];
      for (const bad of ['99999', 'abc', "1' OR '1'='1"]) {
        const response = await request.get(`/admin/${M.key}/${encodeURIComponent(bad)}/edit`);
        const body = await response.text();
        results.push(`${bad} -> ${response.status()}${SQL_ERROR_PATTERN.test(body) ? ' (SQL error text)' : ''}`);
      }
      note(results.join(' | '));
      expect(results.filter((line) => / -> 5\d\d|SQL/.test(line)), 'never a server error or SQL error').toEqual([]);
      expect(results.filter((line) => !/ -> 404/.test(line)), 'every bad id is a 404').toEqual([]);
    });

    test(`${id('12-04')} [Low] [Positive] เรียงลำดับรายการใหม่→เก่าเป็นค่าเริ่มต้น`, async ({ page }) => {
      test.setTimeout(180_000);
      requireDataCreatingTestsAllowed('Saves three items one after the other (deleted again at the end).');
      const stamp = roleStamp();
      const excerpts = [1, 2, 3].map((n) => `${AUTO_TEST_FLAG} ${noun}ทดสอบลำดับ ${stamp}-${n}`);
      try {
        for (const [n, excerpt] of excerpts.entries()) {
          const { submitted } = await submitNews(page, { title: `[Auto Test] ลำดับที่ ${n + 1} ${stamp}`, excerpt }, M);
          expect(submitted.final).toBeLessThan(500);
          await page.waitForTimeout(1_100); // distinct created_at seconds
        }
        const l = list(page);
        await l.open();
        const order = (await l.readCards()).map((card) => card.excerpt).filter((excerpt) => excerpts.includes(excerpt));
        note(`Admin order: ${order.map((excerpt) => excerpt.slice(-1)).join(' → ')}`);
        expect(order, 'newest first').toEqual([...excerpts].reverse());
      } finally {
        for (const excerpt of excerpts) await deleteNewsByExcerpt(page, excerpt, M);
      }
    });
  });

  test.describe(`SC-${P}-13 สิทธิ์`, () => {
    test(`${id('13-02')} [High] [Negative] ยิง POST สร้าง/แก้/ลบ โดยไม่ Login`, async ({ page, playwright }) => {
      requireDataCreatingTestsAllowed('Saves its own target item (deleted again at the end); never aims at a seeded item.');
      const title = `[Auto Test] ${noun}เป้าหมายทดสอบสิทธิ์ ${roleStamp()}`;
      const anonTitle = `[Auto Test] สร้างโดยไม่ล็อกอิน ${roleStamp()}`;
      await withItem(page, { title }, async (excerpt) => {
        const l = list(page);
        const card = (await l.locate((c) => c.excerpt === excerpt))!;
        const deleteUrl = (await l.cards.nth(card.index).locator('[data-delete-url]').getAttribute('data-delete-url')) as string;
        const f = form(page);
        await f.openEdit(card.card.editHref);
        const updateUrl = (await f.form.getAttribute('action')) as string;
        const anonymous = await playwright.request.newContext({ baseURL: urlOf('/'), storageState: { cookies: [], origins: [] } });
        try {
          const results: string[] = [];
          const send = async (label: string, url: string, data: Record<string, string>): Promise<void> => {
            const response = await anonymous.post(url, { form: data, maxRedirects: 0 });
            const location = response.headers()['location'] ?? '';
            results.push(`${label} -> ${response.status()}${location ? ` ${location}` : ''}`);
            const refused = [401, 403, 419].includes(response.status()) || (response.status() === 302 && /login|signin|auth|frontend\/account/i.test(location));
            expect(refused, `${label}: refused (login redirect/401/403/419)`).toBe(true);
          };
          await send('create', urlOf(`/admin/${M.key}`), { title: anonTitle, excerpt, status: 'publish' });
          await send('edit', updateUrl, { _method: 'PUT', title: anonTitle, status: 'publish' });
          await send('delete', deleteUrl, { _method: 'DELETE' });
          note(results.join(' | '));
        } finally {
          await anonymous.dispose();
        }
        expect((await l.findByExcerpt(excerpt))?.title, 'the target is still there, unchanged').toBe(title);
        expect(await l.locate((c) => c.title === anonTitle), 'nothing was created').toBeUndefined();
      });
    });
  });
}
