import { test, expect } from '@fixtures/pages.fixtures';
import { env, requireDataCreatingTestsAllowed } from '@config/env';
import { ContentCard, ContentFormPage, ContentFormValues, ContentListPage, KNOWLEDGE_MODULE as M } from '@pages/admin/AdminNewsPages';
import { urlOf } from '@utils/lowPrivilege';
import {
  confirmNewsDelete,
  contentMarker,
  createNewsCategory,
  deleteNewsCategory,
  deleteNewsWhere,
  publicNewsDetail,
  publicNewsList,
  submitNews,
  withContentItem,
} from '@utils/newsFlows';
import { roleStamp } from '@utils/roleFlows';
import { undoRedoFiveSteps } from '@utils/editorChecks';
import { collectDialogs, SQL_ERROR_PATTERN } from '@utils/security';
import { AUTO_TEST_FLAG } from '@utils/testData';
import { Page } from '@playwright/test';

/**
 * KM-KNOW — "จัดการบทความ/คลังความรู้" (/admin/knowledge/index, form #content-module-form shared with news).
 * Recon 2026-10-02: the list is empty on Dev, has a search box (name=q, GET ?q=, case-sensitive), cards like news;
 * public list /frontend/knowledge/index, detail /frontend/knowledge/detail/<slug> with a "ข้อมูลอ้างอิง" block.
 * Every item a test saves is deleted again in a `finally` — found by the "[Auto Test]" marker + stamp in its excerpt
 * (or in its title when the excerpt is the field under test).
 *
 * NOT implemented ({MAX} undefined, no maxlength — DEF-52): TC-KNOW-05-04/05, 06-02/03.
 */

const CREATES = 'Saves a knowledge item (deleted again at the end of the case).';
const HTML_PAYLOAD = '<b>bold</b><script>alert(1)</script>';
const SQL_PAYLOAD = "' OR 1=1; DROP TABLE users;--";
const BODY = '<p>เนื้อหาทดสอบ</p>';

// Save + public check + cleanup takes longer than the 30 s default on Dev.
test.beforeEach(() => test.setTimeout(90_000));

function note(description: string): void {
  test.info().annotations.push({ type: 'note', description });
}

const marker = (): string => contentMarker();

/** Saves a knowledge item, runs `checks`, deletes it again (see withContentItem). */
async function withItem(
  page: Page,
  values: ContentFormValues,
  checks: (excerpt: string) => Promise<void>,
  match?: (card: ContentCard) => boolean,
): Promise<void> {
  await withContentItem(page, M, values, checks, match);
}

async function cardOf(page: Page, excerpt: string): Promise<ContentCard | undefined> {
  return new ContentListPage(page, M).findByExcerpt(excerpt);
}

test.describe('SC-KNOW-01 รายการบทความ/คลังความรู้', () => {
  test('TC-KNOW-01-01 [High] [Positive] แสดงหน้ารายการบทความ/คลังความรู้', async ({ page }) => {
    const list = new ContentListPage(page, M);
    expect(await list.open()).toBe(200);
    await expect(list.listHeading).toBeVisible();
    await expect(list.addLink).toHaveAttribute('href', urlOf('/admin/knowledge/create'));
    const counter = await list.counter();
    expect(counter, 'the "แสดง x-y รายการ จาก n รายการ" line').not.toBeNull();
    if (counter!.total === 0) {
      await expect(list.emptyState, 'empty state').toBeVisible();
      expect(counter).toEqual({ from: 0, to: 0, total: 0 });
      note('Dev has no knowledge item: empty state + "แสดง0-0 รายการ จาก 0 รายการ".');
    }
    if (!env.allowDataCreatingTests) return;
    // With data: one item of our own shows creator, date, status and title, and the counter follows.
    await withItem(page, { title: `[Auto Test] รายการทดสอบ ${roleStamp()}` }, async () => {
      await list.open();
      const cards = await list.readCards();
      for (const card of cards) {
        expect(card.creator, `creator of "${card.title}"`).not.toBe('');
        expect(card.created, `date of "${card.title}"`).toMatch(/\d{2} \S+ \d{2}/);
        expect(['เผยแพร่', 'ฉบับร่าง', 'ซ่อน']).toContain(card.status);
        expect(card.title).not.toBe('');
      }
      const now = await list.counter();
      expect(now!.to - now!.from + 1, 'the counter matches the cards').toBe(cards.length);
      expect(now!.total, 'one more than before').toBe(counter!.total + 1);
    });
  });

  test('TC-KNOW-01-02 [Medium] [Positive] ค้นหาในหน้ารายการ', async ({ page }) => {
    requireDataCreatingTestsAllowed(CREATES);
    const list = new ContentListPage(page, M);
    const title = `[Auto Test] บทความค้นหา ${roleStamp()}`;
    await withItem(page, { title }, async () => {
      await list.open();
      await list.search(title);
      const cards = await list.readCards();
      expect(cards.map((card) => card.title), 'only the matching item').toEqual([title]);
      expect(await list.counter(), 'the counter follows the search').toEqual({ from: 1, to: 1, total: 1 });
      await list.search('zzzz_no_result');
      expect(await list.cards.count()).toBe(0);
      await expect(list.emptyState).toBeVisible();
    });
  });
});

test.describe('SC-KNOW-02 เพิ่มบทความ/คลังความรู้', () => {
  test('TC-KNOW-02-04 [Medium] [Positive] เพิ่มแท็กใหม่และเลือกแท็กเดิม', async ({ page }) => {
    requireDataCreatingTestsAllowed(CREATES + ' The new tag "autotag-<stamp>" stays in the system.');
    const form = new ContentFormPage(page, M);
    const excerpt = marker();
    // Tags are not deleted with the article: a tag that is new on every run needs its own name.
    const newTag = `autotag-${roleStamp()}`;
    try {
      await form.openCreate();
      await form.fill({ title: `[Auto Test] บทความทดสอบแท็ก ${roleStamp()}`, excerpt, body: BODY });
      await form.addTag(newTag);
      expect(await form.tagChips.first().innerText(), 'a new tag shows the "ใหม่" badge').toContain('ใหม่');
      // An existing tag, picked from the suggestions.
      await form.tagInput.fill('autotest');
      const suggestion = page.locator('#tag-suggestions .dropdown-item', { hasText: /^autotest1$/ });
      await expect(suggestion, 'existing tags are suggested').toBeVisible();
      await suggestion.click();
      await form.tagInput.fill('autotest');
      await page.waitForTimeout(800);
      const again = page.locator('#tag-suggestions .dropdown-item:visible', { hasText: /^autotest1$/ });
      if (await again.count()) await again.click();
      else await form.tagInput.fill('');
      expect((await form.tagTexts()).filter((tag) => tag === 'autotest1'), 'picking it twice adds it once').toHaveLength(1);
      // Remove one, then save.
      await form.addTag('autotag-remove');
      await form.tagChips.filter({ hasText: 'autotag-remove' }).locator('.tag-remove').click();
      expect(await form.tagTexts()).toEqual([newTag, 'autotest1'].sort());
      expect((await form.save()).final).toBeLessThan(500);
      await form.openEdit((await cardOf(page, excerpt))!.editHref);
      expect((await form.tagTexts()).sort(), 'the removed tag is not stored').toEqual([newTag, 'autotest1'].sort());
    } finally {
      await deleteNewsWhere(page, (card) => card.excerpt === excerpt, M);
    }
  });

  test('TC-KNOW-02-06 [Low] [Negative] หัวเรื่องยาวมากและมีอักขระพิเศษ/ภาษาไทย', async ({ page, browser }) => {
    requireDataCreatingTestsAllowed(CREATES);
    const unit = 'ทดสอบ Test & 100% \'quote\' "dq" ';
    const title = unit.repeat(20).slice(0, 300);
    await withItem(page, { title, status: 'publish', timing: 'now' }, async (excerpt) => {
      const card = await cardOf(page, excerpt);
      note(card ? `Saved: ${card.title.length} characters shown in the list (max length TBD — DEF-52)` : 'Refused');
      if (!card) return;
      expect(card.title, 'Thai text and symbols shown correctly (not truncated, no &amp;)').toBe(title.trim());
      const detail = await publicNewsDetail(browser, excerpt, M);
      expect(detail?.status, 'the public detail page opens').toBe(200);
      expect(detail!.text).toContain(title.trim());
    });
  });

  test('TC-KNOW-02-07 [Low] [Positive] คลิก \'← กลับไปที่รายการ\' ขณะกรอกข้อมูลค้าง', async ({ page }) => {
    const list = new ContentListPage(page, M);
    const form = new ContentFormPage(page, M);
    const before = await list.total();
    await form.openCreate();
    await form.fill({ title: `[Auto Test] ไม่ควรถูกบันทึก ${roleStamp()}` });
    const dialogs: string[] = [];
    page.on('dialog', async (dialog) => {
      dialogs.push(dialog.message());
      await dialog.accept();
    });
    await form.backLink.click();
    await expect(page).toHaveURL(urlOf('/admin/knowledge/index'));
    note(dialogs.length ? `Warning shown: ${dialogs.join(' | ')}` : 'No unsaved-changes warning.');
    expect(await list.total(), 'nothing was saved').toBe(before);
  });
});

test.describe('SC-KNOW-03 แก้ไขและลบ', () => {
  test('TC-KNOW-03-02 [High] [Positive] ลบบทความ/คลังความรู้ - กดยกเลิกใน dialog', async ({ page }) => {
    requireDataCreatingTestsAllowed(CREATES);
    const list = new ContentListPage(page, M);
    await withItem(page, { title: `[Auto Test] บทความทดสอบยกเลิกการลบ ${roleStamp()}` }, async (excerpt) => {
      const before = await list.total();
      const dialog = await list.openDeleteDialog(excerpt);
      await dialog.cancel();
      await expect(dialog.root).toBeHidden();
      expect(await list.findByExcerpt(excerpt), 'cancel keeps the item').toBeDefined();
      expect(await list.total()).toBe(before);
    });
  });

  test('TC-KNOW-03-03 [High] [Positive] ลบบทความ/คลังความรู้ - กดยืนยันลบข้อมูล', async ({ page, browser }) => {
    requireDataCreatingTestsAllowed(CREATES);
    const list = new ContentListPage(page, M);
    const title = `[Auto Test] บทความทดสอบการลบ ${roleStamp()}`;
    await withItem(page, { title, status: 'publish', timing: 'now' }, async (excerpt) => {
      expect((await publicNewsList(browser, M)).text, 'public before the delete').toContain(title);
      const before = await list.total();
      const result = await confirmNewsDelete(page, excerpt, M);
      expect(result.final).toBeLessThan(400);
      await expect(list.flash.filter({ hasText: M.deletedFlash })).toBeVisible();
      expect(await list.findByExcerpt(excerpt), 'gone from the admin list').toBeUndefined();
      expect(await list.total(), 'one item less').toBe(before - 1);
      expect((await publicNewsList(browser, M)).text, 'gone from the public list').not.toContain(title);
      await page.goto(urlOf('/admin/activity-log'));
      const rows = (await page.locator('table tbody tr').allInnerTexts()).slice(0, 20).join(' | ');
      note(/Knowledge|บทความ/.test(rows) ? 'The activity log shows the delete.' : 'The activity log does not record knowledge deletes — "ถ้ามีการรองรับ": not supported.');
    });
  });
});

test.describe('SC-KNOW-05 หัวเรื่อง', () => {
  for (const [id, label, value] of [
    ['TC-KNOW-05-01 [High]', 'ข้อความภาษาไทยปกติ', 'ระบบจัดการความรู้ทดสอบ'],
    ['TC-KNOW-05-02 [Medium]', 'ภาษาอังกฤษและตัวเลข', 'Test Case 001'],
    ['TC-KNOW-05-03 [Medium]', 'ผสมไทย/อังกฤษ/ตัวเลข/สัญลักษณ์ทั่วไป', 'KM-Day 2569: SHOW & SHARE (รอบ 1)'],
    ['TC-KNOW-05-09 [Low]', 'อีโมจิและ Unicode พิเศษ', 'ทดสอบ 😀 ✓ ①'],
  ] as const) {
    test(`${id} [Positive] หัวเรื่อง: ${label}`, async ({ page, browser }) => {
      requireDataCreatingTestsAllowed(CREATES);
      await withItem(page, { title: value, status: 'publish', timing: 'now' }, async (excerpt) => {
        expect((await cardOf(page, excerpt))?.title, 'the admin list shows it as typed').toBe(value);
        const detail = await publicNewsDetail(browser, excerpt, M);
        expect(detail, 'listed publicly').toBeDefined();
        note(`Public detail: ${detail!.url}`);
        expect(detail!.status).toBe(200);
        expect(detail!.text, 'shown as typed (no &amp;, nothing lost)').toContain(value);
        expect(detail!.text).not.toContain('&amp;');
      });
    });
  }

  test('TC-KNOW-05-06 [Low] [Positive] หัวเรื่อง: มีช่องว่างหน้า-หลังข้อความ', async ({ page }) => {
    requireDataCreatingTestsAllowed(CREATES);
    const form = new ContentFormPage(page, M);
    const list = new ContentListPage(page, M);
    await withItem(page, { title: '  ทดสอบ  ' }, async (excerpt) => {
      const card = await cardOf(page, excerpt);
      expect(card, 'saved').toBeDefined();
      await form.openEdit(card!.editHref);
      const stored = await form.titleInput.inputValue();
      note(`Stored title: ${JSON.stringify(stored)}`);
      expect(stored, 'leading/trailing spaces removed').toBe('ทดสอบ');
      await list.open();
      await list.search('ทดสอบ');
      expect((await list.readCards()).some((c) => c.excerpt === excerpt), 'found by the search').toBe(true);
    });
  });

  test('TC-KNOW-05-07 [High] [Negative] หัวเรื่อง: แท็ก HTML และสคริปต์', async ({ page, browser }) => {
    requireDataCreatingTestsAllowed(CREATES);
    const dialogs = collectDialogs(page);
    await withItem(page, { title: HTML_PAYLOAD, status: 'publish', timing: 'now' }, async (excerpt) => {
      const list = new ContentListPage(page, M);
      expect((await list.findByExcerpt(excerpt))?.title, 'literal text in the admin').toBe(HTML_PAYLOAD);
      expect(await list.cards.locator('.title-text b, .title-text script').count()).toBe(0);
      const pub = await publicNewsList(browser, M);
      expect(pub.dialogs).toEqual([]);
      expect(pub.text).toContain(HTML_PAYLOAD);
      const detail = await publicNewsDetail(browser, excerpt, M);
      expect(detail?.status).toBe(200);
      expect(detail!.dialogs, 'no script runs on the detail page').toEqual([]);
      expect(detail!.text).toContain(HTML_PAYLOAD);
    });
    expect(dialogs, 'no script runs in the admin').toEqual([]);
  });

  test('TC-KNOW-05-08 [High] [Negative] หัวเรื่อง: อักขระ SQL', async ({ page }) => {
    requireDataCreatingTestsAllowed(CREATES);
    const list = new ContentListPage(page, M);
    const before = await list.total();
    await withItem(page, { title: SQL_PAYLOAD }, async (excerpt) => {
      expect(SQL_ERROR_PATTERN.test(await page.locator('body').innerText())).toBe(false);
      const saved = await list.findByExcerpt(excerpt);
      note(saved ? `Saved as ${JSON.stringify(saved.title)}` : 'Rejected');
      if (saved) expect(saved.title).toBe(SQL_PAYLOAD);
      expect(await list.total(), 'nothing else touched').toBe(before + (saved ? 1 : 0));
    });
  });

  test('TC-KNOW-05-10 [High] [Negative] หัวเรื่อง: เว้นว่าง', async ({ page }) => {
    const list = new ContentListPage(page, M);
    const form = new ContentFormPage(page, M);
    const before = await list.total();
    await form.openCreate();
    await expect(form.titleInput).toHaveAttribute('required', '');
    const excerpt = marker();
    await form.fill({ title: '', excerpt, body: BODY });
    await form.saveButton.click();
    await expect(page).toHaveURL(/\/admin\/knowledge\/create$/);
    expect(await form.titleInput.evaluate((el: HTMLInputElement) => el.validationMessage)).not.toBe('');
    await expect(form.excerptInput, 'what was typed stays').toHaveValue(excerpt);
    expect(await list.total(), 'nothing was saved').toBe(before);
  });

  test('TC-KNOW-05-11 [Medium] [Negative] หัวเรื่อง: ช่องว่างล้วน (เว้นวรรค 5 ตัว)', async ({ page }) => {
    requireDataCreatingTestsAllowed('If the app accepts a blank title it saves an item (deleted again at the end).');
    await withItem(page, { title: '     ' }, async (excerpt) => {
      const saved = await cardOf(page, excerpt);
      note(saved ? `Saved with title ${JSON.stringify(saved.title)}` : 'Not saved');
      expect(saved, 'five spaces count as empty').toBeUndefined();
    });
  });
});

test.describe('SC-KNOW-06 รายละเอียดแบบย่อ', () => {
  test('TC-KNOW-06-01 [High] [Positive] รายละเอียดแบบย่อ: ข้อความภาษาไทยปกติ', async ({ page, browser }) => {
    requireDataCreatingTestsAllowed(CREATES);
    const title = `[Auto Test] บทความทดสอบรายละเอียดย่อ ${roleStamp()}`;
    const value = 'ระบบจัดการความรู้ทดสอบ';
    await withItem(page, { title, excerpt: value, status: 'publish', timing: 'now' }, async () => {
      const card = (await new ContentListPage(page, M).locate((c) => c.title === title))?.card;
      expect(card?.excerpt, 'the admin list shows it as typed').toBe(value);
      const pub = await publicNewsList(browser, M);
      expect(pub.text, 'shown on the public list').toContain(value);
    }, (card) => card.title === title);
  });

  test('TC-KNOW-06-04 [High] [Negative] รายละเอียดแบบย่อ: แท็ก HTML และสคริปต์', async ({ page, browser }) => {
    requireDataCreatingTestsAllowed(CREATES);
    const title = `[Auto Test] บทความทดสอบรายละเอียดย่อ ${roleStamp()}`;
    const dialogs = collectDialogs(page);
    await withItem(page, { title, excerpt: HTML_PAYLOAD, status: 'publish', timing: 'now' }, async () => {
      const list = new ContentListPage(page, M);
      const card = (await list.locate((c) => c.title === title))?.card;
      expect(card?.excerpt, 'literal text in the admin').toBe(HTML_PAYLOAD);
      expect(await list.cards.locator('.content-section b, .content-section script').count()).toBe(0);
      const pub = await publicNewsList(browser, M);
      expect(pub.dialogs).toEqual([]);
      expect(pub.text).toContain(HTML_PAYLOAD);
      expect((await publicNewsDetail(browser, title, M))?.dialogs ?? []).toEqual([]);
    }, (card) => card.title === title);
    expect(dialogs).toEqual([]);
  });

  test('TC-KNOW-06-05 [Medium] [Positive] รายละเอียดแบบย่อ: เว้นว่าง (ไม่บังคับกรอก)', async ({ page, browser }) => {
    requireDataCreatingTestsAllowed(CREATES);
    const title = `[Auto Test] บทความไม่มีรายละเอียดย่อ ${roleStamp()}`;
    await withItem(page, { title, excerpt: '', status: 'publish', timing: 'now' }, async () => {
      const card = (await new ContentListPage(page, M).locate((c) => c.title === title))?.card;
      expect(card, 'saved without an excerpt').toBeDefined();
      expect(card!.excerpt, 'no stray text where the excerpt goes').toBe('');
      const detail = await publicNewsDetail(browser, title, M);
      expect(detail?.status, 'the public page opens').toBe(200);
    }, (card) => card.title === title);
  });
});

test.describe('SC-KNOW-07 หมวดหมู่', () => {
  test('TC-KNOW-07-01 [High] [Positive] เลือกหมวดหมู่จากรายการ', async ({ page, browser }) => {
    test.setTimeout(180_000);
    requireDataCreatingTestsAllowed('Saves two "คลังความรู้" categories and an item (all deleted again at the end).');
    const categories: string[] = [];
    const excerpt = marker();
    const form = new ContentFormPage(page, M);
    try {
      categories.push(await createNewsCategory(page, '[Auto Test] หมวดความรู้ ก', M));
      categories.push(await createNewsCategory(page, '[Auto Test] หมวดความรู้ ข', M));
      await form.openCreate();
      const options = (await form.categoryOptions()).filter((option) => option && option !== '— ไม่ระบุ —');
      expect(options).toEqual(expect.arrayContaining(categories));
      const [first, last] = [options[0], options[options.length - 1]];
      await form.fill({ title: `[Auto Test] บทความทดสอบหมวดหมู่ ${roleStamp()}`, excerpt, category: first, body: BODY, status: 'publish', timing: 'now' });
      expect((await form.save()).final).toBeLessThan(500);
      await form.openEdit((await cardOf(page, excerpt))!.editHref);
      expect(await form.selectedCategory(), 'the first category is stored').toBe(first);
      await form.fill({ category: last });
      expect((await form.save()).final).toBeLessThan(500);
      await form.openEdit((await cardOf(page, excerpt))!.editHref);
      expect(await form.selectedCategory(), 'the last category is stored').toBe(last);
      const detail = await publicNewsDetail(browser, excerpt, M);
      note(`Public detail ${detail?.url}: ${detail?.text.includes(last) ? 'shows' : 'does NOT show'} "${last}".`);
      expect.soft(detail?.text ?? '', 'the public page shows the category').toContain(last);
    } finally {
      await deleteNewsWhere(page, (card) => card.excerpt === excerpt, M);
      for (const name of categories) note(`Cleanup: category "${name}" ${(await deleteNewsCategory(page, name, M)) ? 'deleted' : 'NOT deleted'}.`);
    }
  });

  test('TC-KNOW-07-02 [High] [Negative] ไม่เลือกหมวดหมู่', async ({ page }) => {
    requireDataCreatingTestsAllowed(CREATES);
    const form = new ContentFormPage(page, M);
    await form.openCreate();
    expect(await form.categoryValue(), 'default = no category').toBe('');
    const required = await form.categorySelect.evaluate((el: HTMLSelectElement) => el.required);
    await withItem(page, { title: `[Auto Test] บทความไม่ระบุหมวดหมู่ ${roleStamp()}` }, async (excerpt) => {
      const saved = await cardOf(page, excerpt);
      note(`Category required=${required}; ${saved ? 'saved without a category' : 'not saved'}.`);
      if (required) expect(saved).toBeUndefined();
      else expect(saved, 'optional category: saved without one').toBeDefined();
    });
  });
});

test.describe('SC-KNOW-08 แท็ก', () => {
  test('TC-KNOW-08-01 [Medium] [Positive] เพิ่มหลายแท็ก (5 แท็ก)', async ({ page, browser }) => {
    requireDataCreatingTestsAllowed(CREATES);
    const tags = ['autotest1', 'autotest2', 'autotest3', 'autotest4', 'autotest5'];
    const form = new ContentFormPage(page, M);
    await withItem(page, { title: `[Auto Test] บทความทดสอบแท็ก ${roleStamp()}`, tags, status: 'publish', timing: 'now' }, async (excerpt) => {
      await form.openEdit((await cardOf(page, excerpt))!.editHref);
      expect((await form.tagTexts()).sort()).toEqual(tags);
      const detail = await publicNewsDetail(browser, excerpt, M);
      expect(detail).toBeDefined();
      for (const tag of tags) expect(detail!.text, `#${tag} on the public page`).toContain(`#${tag}`);
    });
  });

  test('TC-KNOW-08-02 [Medium] [Negative] แท็กซ้ำในบทความเดียวกัน', async ({ page }) => {
    const form = new ContentFormPage(page, M);
    await form.openCreate();
    await form.addTag('km');
    await form.addTag('km');
    // An existing "KM" tag (any case) is picked instead of a new one — what matters is a single chip.
    expect((await form.tagTexts()).map((tag) => tag.toLowerCase()), 'only one "km" chip').toEqual(['km']);
  });

  test('TC-KNOW-08-03 [Low] [Negative] แท็กว่างเปล่า/ช่องว่างล้วน', async ({ page }) => {
    const form = new ContentFormPage(page, M);
    await form.openCreate();
    await form.tagInput.press('Enter');
    await form.addTag('   ');
    expect(await form.tagChips.count(), 'no empty chip').toBe(0);
  });

  test('TC-KNOW-08-04 [High] [Negative] แท็กที่มี HTML/สคริปต์', async ({ page, browser }) => {
    requireDataCreatingTestsAllowed(CREATES + ' The tag itself stays in the system.');
    const payload = '<script>alert(1)</script>';
    const dialogs = collectDialogs(page);
    const form = new ContentFormPage(page, M);
    await withItem(page, { title: `[Auto Test] บทความทดสอบแท็กสคริปต์ ${roleStamp()}`, tags: [payload], status: 'publish', timing: 'now' }, async (excerpt) => {
      await form.openEdit((await cardOf(page, excerpt))!.editHref);
      expect(await form.tagTexts()).toEqual([payload]);
      expect(await page.locator('#tag-chips script').count()).toBe(0);
      const detail = await publicNewsDetail(browser, excerpt, M);
      expect(detail!.dialogs).toEqual([]);
      expect(detail!.text).toContain(payload);
    });
    expect(dialogs).toEqual([]);
  });

  test('TC-KNOW-08-05 [Low] [Negative] แท็กยาวเกินกำหนด', async ({ page }) => {
    const form = new ContentFormPage(page, M);
    await form.openCreate();
    const long = 'ก'.repeat(50) + 'a'.repeat(50);
    await form.addTag(long);
    const tags = await form.tagTexts();
    note(tags.length ? `Accepted as a ${tags[0].length}-character tag, no notice (max length TBD — DEF-52)` : 'Rejected');
    // "ระบบตัด/ปฏิเสธและแจ้งความยาวสูงสุด (TBD)": the limit is undefined, so what must hold is no broken chip.
    if (tags.length) expect(tags[0].length, 'kept whole or cut — never garbled').toBeLessThanOrEqual(100);
    await expect(form.saveButton).toBeEnabled();
  });

  test('TC-KNOW-08-06 [Low] [Negative] จำนวนแท็กเกินกำหนด', async ({ page }) => {
    const form = new ContentFormPage(page, M);
    await form.openCreate();
    for (let i = 1; i <= 30; i++) await form.addTag(`autocount${i}`);
    const count = await form.tagChips.count();
    note(`${count} of 30 tags accepted (max count TBD — DEF-52)`);
    expect(count, 'never more chips than typed').toBeLessThanOrEqual(30);
    await expect(form.saveButton).toBeEnabled();
  });

  test('TC-KNOW-08-07 [Medium] [Positive] กด Enter ในช่องแท็กต้องไม่ส่งฟอร์มทั้งหมด', async ({ page }) => {
    const form = new ContentFormPage(page, M);
    await form.openCreate();
    await form.fill({ title: `[Auto Test] ไม่ควรถูกบันทึก ${roleStamp()}` });
    const posts: string[] = [];
    page.on('request', (request) => request.method() === 'POST' && posts.push(request.url()));
    await form.addTag('autoenter');
    await page.waitForTimeout(800);
    expect(await form.tagTexts(), 'the tag is added').toEqual(['autoenter']);
    expect(posts, 'the form is not sent').toEqual([]);
    await expect(page).toHaveURL(/\/admin\/knowledge\/create$/);
  });

  test('TC-KNOW-08-08 [Low] [Positive] ลบแท็กด้วยปุ่ม Backspace/กากบาท', async ({ page }) => {
    const form = new ContentFormPage(page, M);
    await form.openCreate();
    await form.addTag('autodel1');
    await form.addTag('autodel2');
    expect(await form.tagTexts()).toEqual(['autodel1', 'autodel2']);
    await form.tagInput.press('Backspace');
    expect(await form.tagTexts(), 'Backspace in the empty box removes the last tag').toEqual(['autodel1']);
    await form.tagChips.first().locator('.tag-remove').click();
    expect(await form.tagTexts(), '× removes the tag').toEqual([]);
    expect(await page.locator('#tag-hidden-inputs input[name="new_tags"]').inputValue(), 'nothing left to be saved').toBe('');
  });

  test('TC-KNOW-08-09 [Low] [Positive] แท็กภาษาไทยและตัวพิมพ์ต่างกัน', async ({ page }) => {
    const form = new ContentFormPage(page, M);
    await form.openCreate();
    for (const tag of ['ทักษะทางคลินิก', 'KM', 'km']) await form.addTag(tag);
    const tags = await form.tagTexts();
    note(`Chips: ${tags.join(' | ')} — "KM"/"km" ${tags.filter((t) => t.toLowerCase() === 'km').length > 1 ? 'kept as two tags' : 'treated as one tag'} (rule TBD)`);
    expect(tags, 'Thai shown correctly').toContain('ทักษะทางคลินิก');
  });
});

test.describe('SC-KNOW-09 เนื้อหา', () => {
  for (const [id, label, body] of [
    ['TC-KNOW-09-01 [High]', 'เนื้อหาว่างเปล่า', ''],
    ['TC-KNOW-09-02 [Medium]', 'เนื้อหาเป็นช่องว่าง/ขึ้นบรรทัดใหม่ล้วน', '<p>&nbsp;&nbsp;&nbsp;</p><p>&nbsp;</p><p>&nbsp;</p>'],
  ] as const) {
    test(`${id} [Negative] ${label}`, async ({ page }) => {
      requireDataCreatingTestsAllowed('If the app accepts an empty body it saves an item (deleted again at the end).');
      await withItem(page, { title: `[Auto Test] บทความเนื้อหาว่าง ${roleStamp()}`, body }, async (excerpt) => {
        const saved = await cardOf(page, excerpt);
        // Only the title is required (TC-FKNO-01-06), and the sheet makes this conditional ("หากเป็นช่องบังคับ").
        note(saved ? 'Saved with an empty body — the body is optional.' : 'Not saved — validation for the body.');
      });
    });
  }

  test('TC-KNOW-09-09 [Low] [Negative] เนื้อหาขนาดใหญ่มาก (1 MB)', async ({ page }) => {
    test.setTimeout(240_000);
    requireDataCreatingTestsAllowed('Saves a 1 MB item (deleted again at the end).');
    const big = `<p>${'ทดสอบเนื้อหายาว KM '.repeat(1024 * 1024 / 40)}</p>`;
    await withItem(page, { title: `[Auto Test] บทความ 1MB ${roleStamp()}`, body: big }, async (excerpt) => {
      const saved = await cardOf(page, excerpt);
      note(`Body ${(big.length / 1024).toFixed(0)} KB: ${saved ? 'saved' : 'refused'} (no timeout / 500).`);
    });
  });

  test('TC-KNOW-09-10 [Low] [Positive] Undo/Redo หลายขั้นตอน', async ({ page }) => {
    const form = new ContentFormPage(page, M);
    await form.openCreate();
    await undoRedoFiveSteps(page);
  });
});

test.describe('SC-KNOW-10/11 รูปปกและไฟล์แนบ', () => {
  test('TC-KNOW-10-06 [Medium] [Negative] รูปปก: ไม่เลือกไฟล์ (ช่องไม่บังคับ)', async ({ page, browser }) => {
    requireDataCreatingTestsAllowed(CREATES);
    await withItem(page, { title: `[Auto Test] บทความไม่มีรูปปก ${roleStamp()}`, status: 'publish', timing: 'now' }, async (excerpt) => {
      const list = new ContentListPage(page, M);
      const found = (await list.locate((c) => c.excerpt === excerpt))!;
      const src = await list.cards.nth(found.index).locator('img').first().getAttribute('src');
      note(`Admin card image: ${src}`);
      expect(src, 'a placeholder, not an uploaded file').not.toContain('/storage/');
      const pub = await publicNewsList(browser, M);
      expect(pub.status).toBe(200);
    });
  });

  test('TC-KNOW-11-04 [High] [Positive] ไฟล์แนบ: ไม่แนบไฟล์ (ไม่บังคับ)', async ({ page }) => {
    requireDataCreatingTestsAllowed(CREATES);
    await withItem(page, { title: `[Auto Test] บทความไม่มีไฟล์แนบ ${roleStamp()}` }, async (excerpt) => {
      expect(await cardOf(page, excerpt), 'saved without attachments').toBeDefined();
    });
  });
});

test.describe('SC-KNOW-13 รายการ: พารามิเตอร์ การเรียง และการค้นหา', () => {
  test('TC-KNOW-13-02 [Low] [Negative] ?page นอกช่วงและไม่ใช่ตัวเลข', async ({ page }) => {
    const list = new ContentListPage(page, M);
    const results: string[] = [];
    for (const value of ['0', '-1', 'abc', '99999']) {
      const status = await list.open(`?page=${value}`);
      results.push(`?page=${value} -> ${status}`);
      expect(status, `?page=${value}`).toBeLessThan(500);
      expect(SQL_ERROR_PATTERN.test(await page.locator('body').innerText())).toBe(false);
    }
    note(results.join(' | '));
  });

  test('TC-KNOW-13-03 [Medium] [Negative] เปิดหน้าแก้ไขด้วย id ที่ไม่มี/ไม่ใช่ตัวเลข', async ({ request }) => {
    test.fail(true, 'Known bug (DEF-54): /admin/knowledge/<unknown or malformed id>/edit answers HTTP 500 instead of 404 (as for news).');
    const results: string[] = [];
    for (const id of ['99999', 'abc', "1' OR '1'='1"]) {
      const response = await request.get(`/admin/knowledge/${encodeURIComponent(id)}/edit`);
      results.push(`${id} -> ${response.status()}${SQL_ERROR_PATTERN.test(await response.text()) ? ' (SQL error text)' : ''}`);
    }
    note(results.join(' | '));
    expect(results.filter((line) => / -> 5\d\d|SQL/.test(line)), 'never a server error or SQL error').toEqual([]);
    expect(results.filter((line) => !/ -> 404/.test(line)), 'every bad id is a 404').toEqual([]);
  });

  test('TC-KNOW-13-04 [Low] [Positive] เรียงลำดับรายการใหม่→เก่าเป็นค่าเริ่มต้น', async ({ page }) => {
    test.setTimeout(180_000);
    requireDataCreatingTestsAllowed('Saves three items one after the other (deleted again at the end).');
    const stamp = roleStamp();
    const excerpts = [1, 2, 3].map((n) => `${AUTO_TEST_FLAG} บทความทดสอบลำดับ ${stamp}-${n}`);
    try {
      for (const [n, excerpt] of excerpts.entries()) {
        expect((await submitNews(page, { title: `[Auto Test] ลำดับที่ ${n + 1} ${stamp}`, excerpt, body: BODY }, M)).submitted.final).toBeLessThan(500);
        await page.waitForTimeout(1_100);
      }
      const list = new ContentListPage(page, M);
      await list.open();
      const order = (await list.readCards()).map((card) => card.excerpt).filter((excerpt) => excerpts.includes(excerpt));
      note(`Admin order: ${order.map((excerpt) => excerpt.slice(-1)).join(' → ')}`);
      expect(order, 'newest first').toEqual([...excerpts].reverse());
    } finally {
      for (const excerpt of excerpts) await deleteNewsWhere(page, (card) => card.excerpt === excerpt, M);
    }
  });

  test('TC-KNOW-13-05 [Medium] [Positive] ค้นหาในหน้ารายการด้วยภาษาไทยและอังกฤษ', async ({ page }) => {
    test.fail(true, 'Known bug (DEF-58): the admin list search is case-sensitive — "ng TUBE" does not find "NG tube".');
    requireDataCreatingTestsAllowed(CREATES);
    const list = new ContentListPage(page, M);
    const title = `[Auto Test] การใส่สายอาหาร NG tube ${roleStamp()}`;
    await withItem(page, { title }, async (excerpt) => {
      const found = async (term: string): Promise<boolean> => {
        await list.open();
        await list.search(term);
        return (await list.readCards()).some((card) => card.excerpt === excerpt);
      };
      expect(await found('สายอาหาร'), 'Thai term').toBe(true);
      expect(await found('NG tube'), 'English term as typed').toBe(true);
      const lower = await found('ng TUBE');
      note(`"ng TUBE" ${lower ? 'finds' : 'does NOT find'} "NG tube"`);
      expect(lower, 'the search ignores upper/lower case').toBe(true);
    });
  });

  test('TC-KNOW-13-06 [High] [Negative] ค้นหาด้วย wildcard/XSS/SQL', async ({ page }) => {
    test.fail(true, 'Known bug (DEF-60): searching "%" returns every item (the LIKE wildcard is not escaped).');
    requireDataCreatingTestsAllowed('Saves one ordinary item so "returns everything" can be told apart (deleted again at the end).');
    const list = new ContentListPage(page, M);
    const dialogs = collectDialogs(page);
    await withItem(page, { title: `[Auto Test] บทความธรรมดา ${roleStamp()}` }, async () => {
      const results: string[] = [];
      for (const term of ['%', '<script>alert(1)</script>', "' OR 1=1 --"]) {
        await list.open();
        await list.search(term);
        const text = await page.locator('body').innerText();
        const count = await list.cards.count();
        results.push(`${JSON.stringify(term)} -> ${count} card(s)`);
        expect(SQL_ERROR_PATTERN.test(text), `${term}: no SQL error`).toBe(false);
        expect(count, `${term}: does not return every item`).toBe(0);
        await expect(list.searchInput, 'the term is echoed back as text').toHaveValue(term);
      }
      note(results.join(' | '));
    });
    expect(dialogs, 'no script runs').toEqual([]);
  });

  test('TC-KNOW-13-07 [Low] [Negative] ค้นหาไม่พบ', async ({ page }) => {
    const list = new ContentListPage(page, M);
    await list.open();
    await list.search('zzzz_no_result');
    expect(await list.cards.count()).toBe(0);
    await expect(list.emptyState).toBeVisible();
    expect(await list.counter()).toEqual({ from: 0, to: 0, total: 0 });
  });
});

test.describe('SC-KNOW-14 สิทธิ์', () => {
  test('TC-KNOW-14-02 [High] [Negative] ยิง POST สร้าง/แก้/ลบ โดยไม่ Login', async ({ page, playwright }) => {
    requireDataCreatingTestsAllowed('Saves its own target item (deleted again at the end).');
    const title = `[Auto Test] บทความเป้าหมายทดสอบสิทธิ์ ${roleStamp()}`;
    const anonTitle = `[Auto Test] สร้างโดยไม่ล็อกอิน ${roleStamp()}`;
    await withItem(page, { title }, async (excerpt) => {
      const list = new ContentListPage(page, M);
      const found = (await list.locate((c) => c.excerpt === excerpt))!;
      const deleteUrl = (await list.cards.nth(found.index).locator('[data-delete-url]').getAttribute('data-delete-url')) as string;
      const form = new ContentFormPage(page, M);
      await form.openEdit(found.card.editHref);
      const updateUrl = (await form.form.getAttribute('action')) as string;
      const anonymous = await playwright.request.newContext({ baseURL: urlOf('/'), storageState: { cookies: [], origins: [] } });
      try {
        const results: string[] = [];
        for (const [label, url, data] of [
          ['create', urlOf('/admin/knowledge'), { title: anonTitle, status: 'publish' }],
          ['edit', updateUrl, { _method: 'PUT', title: anonTitle }],
          ['delete', deleteUrl, { _method: 'DELETE' }],
        ] as const) {
          const response = await anonymous.post(url, { form: data, maxRedirects: 0 });
          const location = response.headers()['location'] ?? '';
          results.push(`${label} -> ${response.status()}${location ? ` ${location}` : ''}`);
          const refused = [401, 403, 419].includes(response.status()) || (response.status() === 302 && /login|signin|auth/i.test(location));
          expect(refused, `${label}: refused`).toBe(true);
        }
        note(results.join(' | '));
      } finally {
        await anonymous.dispose();
      }
      expect((await list.findByExcerpt(excerpt))?.title, 'unchanged').toBe(title);
      expect(await list.locate((c) => c.title === anonTitle), 'nothing created').toBeUndefined();
    });
  });
});
