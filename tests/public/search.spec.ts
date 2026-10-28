import { test, expect, ANONYMOUS_SESSION } from '@fixtures/pages.fixtures';
import { requireDataCreatingTestsAllowed } from '@config/env';
import { KNOWLEDGE_MODULE } from '@pages/admin/AdminNewsPages';
import { createNewsCategory, deleteNewsByExcerpt, deleteNewsCategory, submitNews } from '@utils/newsFlows';
import { urlOf } from '@utils/lowPrivilege';
import { roleStamp } from '@utils/roleFlows';
import { collectDialogs, SQL_ERROR_PATTERN } from '@utils/security';
import { AUTO_TEST_FLAG } from '@utils/testData';
import { Browser, Page } from '@playwright/test';
import { ADMIN_AUTH_FILE } from '../../global-setup';

/**
 * KM-FES — the public search page /frontend/search/index (checked 2026-10-05; it was a static prototype until
 * 2026-10-02, DEF-16). A GET form: q (placeholder "ค้นหาหมวดหมู่ , Tag ,ชื่อบทความ, อื่นๆ"), "ค้นหา", scope pills
 * all/title/content and a filter panel (type, category, tag, date range). Results: "ผลลัพธ์การค้นหา "<q>"",
 * "พบทั้งหมด n รายการ", "แสดงรายการที่ a–b" and one a.card per item (type badge, category, date, .card-title,
 * .card-text excerpt, view count; no tags).
 * Dev has no "NG Tube" content, so beforeAll saves two knowledge articles that contain the sheet's search words (and a
 * test category); afterAll deletes them. `page` is an anonymous visitor.
 */

test.use({ storageState: ANONYMOUS_SESSION });

const NO_TAGS = 'Known bug (DEF-81): the result cards show no tags (the sheet expects category, date, title, excerpt, tags and views).';
const CASE_SENSITIVE = 'Known bug (DEF-58): the public search is case-sensitive too — "ng tube" / "NG TUBE" do not find what "NG Tube" finds.';
const PHRASE_ONLY = 'Known bug (DEF-82): several words are searched as one phrase — "NG Tube ผู้สูงอายุ" finds nothing although an article has both words.';
const WILDCARD = 'Known bug (DEF-60): "%" (and "_") are SQL wildcards in the public search too — "%" returns every item.';

const stamp = roleStamp();
const data = {
  category: '',
  first: {
    title: `${AUTO_TEST_FLAG} การดูแลผู้สูงอายุที่ใส่ NG Tube ${stamp}`,
    excerpt: `${AUTO_TEST_FLAG} สายอาหารทางจมูกสำหรับผู้สูงอายุ ${stamp}`,
    body: '<p>แนวปฏิบัติการดูแลผู้ป่วยที่ใส่ NG Tube (สายให้อาหารทางจมูก) ปี 2569</p>',
    tags: ['NGTube'],
  },
  second: {
    title: `${AUTO_TEST_FLAG} NG Tube กับการให้อาหารทางสาย ${stamp}`,
    excerpt: `${AUTO_TEST_FLAG} บทความทดสอบการค้นหา ${stamp}`,
    body: '<p>การให้อาหารผ่าน NG Tube อย่างปลอดภัย</p>',
    tags: [] as string[],
  },
};

async function asAdmin<T>(browser: Browser, work: (page: Page) => Promise<T>): Promise<T> {
  const context = await browser.newContext({ storageState: ADMIN_AUTH_FILE });
  try {
    return await work(await context.newPage());
  } finally {
    await context.close();
  }
}

test.beforeAll(async ({ browser }) => {
  test.setTimeout(240_000);
  requireDataCreatingTestsAllowed('Saves a knowledge category and two knowledge articles (deleted again in afterAll).');
  await asAdmin(browser, async (page) => {
    data.category = await createNewsCategory(page, `${AUTO_TEST_FLAG} แลกเปลี่ยนเรียนรู้ทางคลินิก`, KNOWLEDGE_MODULE);
    for (const item of [data.first, data.second]) {
      const { submitted } = await submitNews(page, { ...item, category: data.category, status: 'publish' }, KNOWLEDGE_MODULE);
      expect(submitted.final, 'saving the test article').toBeLessThan(500);
    }
  });
});

test.afterAll(async ({ browser }) => {
  test.setTimeout(180_000);
  await asAdmin(browser, async (page) => {
    for (const item of [data.first, data.second]) await deleteNewsByExcerpt(page, item.excerpt, KNOWLEDGE_MODULE);
    if (data.category) await deleteNewsCategory(page, data.category, KNOWLEDGE_MODULE);
  });
});

test.beforeEach(() => test.setTimeout(90_000));

function note(description: string): void {
  test.info().annotations.push({ type: 'note', description });
}

interface ResultCard {
  title: string;
  excerpt: string;
  type: string;
  category: string;
  date: string;
  views: string;
  tags: string[];
  href: string;
}

interface SearchResult {
  status: number;
  url: string;
  /** "พบทั้งหมด n รายการ" → n (null when absent). */
  count: number | null;
  cards: ResultCard[];
  text: string;
  query: string;
}

async function readResults(page: Page, status: number): Promise<SearchResult> {
  const text = ((await page.locator('.body-content').textContent()) ?? '').replace(/\s+/g, ' ');
  const count = /พบทั้งหมด\s*(\d+)\s*รายการ/.exec(text);
  return {
    status,
    url: page.url(),
    count: count ? Number(count[1]) : null,
    cards: await page.locator('.body-content a.card').evaluateAll((cards) =>
      cards.map((card) => {
        const t = (selector: string): string => (card.querySelector(selector)?.textContent ?? '').replace(/\s+/g, ' ').trim();
        return {
          title: t('.card-title'),
          excerpt: t('.card-text'),
          type: t('.status.type'),
          category: t('.category-text .text-small'),
          date: t('.group-inline > .text-small'),
          views: t('.mt-4 .text-small'),
          tags: [...card.querySelectorAll('.tag, .badge, [class*="tag"]')].map((e) => (e.textContent ?? '').trim()).filter(Boolean),
          href: card.getAttribute('href') ?? '',
        };
      }),
    ),
    text,
    query: (await page.locator('.body-content input[name="q"]').inputValue().catch(() => '')) ?? '',
  };
}

/** Types `q` into the search box and presses "ค้นหา" (or Enter). */
async function search(page: Page, q: string, how: 'click' | 'enter' = 'click'): Promise<SearchResult> {
  await page.goto(urlOf('/frontend/search/index'));
  await page.waitForLoadState('load');
  const box = page.locator('.body-content input[name="q"]');
  await box.fill(q);
  const [response] = await Promise.all([
    page.waitForResponse((r) => r.url().includes('/frontend/search/index') && r.request().isNavigationRequest()),
    how === 'click' ? page.locator('.body-content').getByRole('button', { name: 'ค้นหา' }).click() : box.press('Enter'),
  ]);
  await page.waitForLoadState('load');
  return readResults(page, response.status());
}

/** Opens the search URL directly (for values a text box cannot hold, e.g. %00). */
async function searchUrl(page: Page, rawQuery: string): Promise<SearchResult> {
  const response = await page.goto(urlOf(`/frontend/search/index?q=${rawQuery}`));
  await page.waitForLoadState('load');
  return readResults(page, response?.status() ?? 0);
}

const titles = (result: SearchResult): string[] => result.cards.map((c) => c.title);

/** Every result must contain `term` (case-insensitive) in its title/excerpt — or, failing that, on its page. */
async function everyResultContains(page: Page, result: SearchResult, term: string): Promise<void> {
  const needle = term.toLowerCase();
  for (const card of result.cards) {
    if (`${card.title} ${card.excerpt}`.toLowerCase().includes(needle)) continue;
    const response = await page.request.get(card.href);
    const body = (await response.text()).replace(/<[^>]+>/g, ' ').toLowerCase();
    expect(body, `"${card.title}" contains "${term}" (title / excerpt / content)`).toContain(needle);
  }
}

test.describe('SC-FES-01 ค้นหาเนื้อหา', () => {
  test('TC-FES-01-01 [High] [Positive] ค้นหาด้วยคำที่มีอยู่', async ({ page }) => {
    test.fail(true, NO_TAGS);
    const result = await search(page, 'NG Tube');
    note(`Count ${result.count}; cards ${JSON.stringify(result.cards.map((c) => ({ title: c.title, type: c.type, category: c.category, date: c.date, views: c.views, tags: c.tags })))}`);
    expect(result.status).toBe(200);
    expect(titles(result), 'our two articles are found').toEqual(expect.arrayContaining([data.first.title, data.second.title]));
    expect(result.count, '"พบทั้งหมด n รายการ" matches the cards').toBe(result.cards.length);
    await everyResultContains(page, result, 'NG Tube');
    const ours = result.cards.find((c) => c.title === data.first.title)!;
    expect(ours.type || ours.category, 'category').not.toBe('');
    expect(ours.date, 'date').toMatch(/\d/);
    expect(ours.excerpt, 'excerpt').toBe(data.first.excerpt);
    expect(ours.views, 'view count').toMatch(/^\d+$/);
    expect(ours.tags, 'tags').toEqual(expect.arrayContaining(data.first.tags));
  });

  test('TC-FES-01-02 [Medium] [Negative] ค้นหาแล้วไม่พบผลลัพธ์', async ({ page }) => {
    const result = await search(page, 'zzzz_no_result_999');
    note(`Count ${result.count}; text: ${result.text.slice(0, 300)}`);
    expect(result.status).toBe(200);
    expect(result.cards, 'no result').toEqual([]);
    expect(result.count === 0 || /ไม่พบ/.test(result.text), 'says nothing was found (0 รายการ / ไม่พบ)').toBe(true);
  });

  test('TC-FES-01-03 [Medium] [Positive] ค้นหาไม่แยกตัวพิมพ์เล็ก-ใหญ่', async ({ page }) => {
    test.fail(true, CASE_SENSITIVE);
    const base = titles(await search(page, 'NG Tube')).sort();
    for (const q of ['ng tube', 'NG TUBE']) {
      expect(titles(await search(page, q)).sort(), `"${q}" finds the same as "NG Tube"`).toEqual(base);
    }
  });

  test('TC-FES-01-05 [Low] [Negative] ค้นหาด้วยข้อความว่าง', async ({ page }) => {
    // "แสดง validation หรือแสดงรายการทั้งหมดตามที่กำหนด โดยไม่เกิด error": either passes.
    const result = await search(page, '');
    note(`Status ${result.status}; count ${result.count}; ${result.cards.length} card(s); ${result.text.slice(0, 200)}`);
    expect(result.status, 'no error').toBeLessThan(400);
  });

  test('TC-FES-01-06 [High] [Negative] ป้องกัน XSS ในช่องค้นหา', async ({ page }) => {
    const dialogs = collectDialogs(page);
    const payload = '<script>alert(1)</script>';
    const result = await search(page, payload);
    expect(result.status).toBeLessThan(500);
    await page.waitForTimeout(500);
    expect(dialogs, 'no alert').toEqual([]);
    expect(await page.locator('.body-content script').evaluateAll((s) => s.filter((e) => (e.textContent ?? '').includes('alert(1)')).length), 'not injected as a script').toBe(0);
    expect(result.text, 'the search word is shown as text').toContain(payload);
  });
});

test.describe('SC-FES-02 คำค้นแบบต่างๆ และการใช้งาน', () => {
  test('TC-FES-02-01 [Medium] [Positive] ค้นหาด้วยบางส่วนของคำภาษาไทย', async ({ page }) => {
    const result = await search(page, 'สายอาหาร');
    note(`Found: ${JSON.stringify(titles(result))}`);
    expect(titles(result), 'the article with "สายอาหาร…" is found').toContain(data.first.title);
    await everyResultContains(page, result, 'สายอาหาร');
  });

  test('TC-FES-02-02 [Medium] [Positive] ค้นหาหลายคำ', async ({ page }) => {
    test.fail(true, PHRASE_ONLY);
    const result = await search(page, 'NG Tube ผู้สูงอายุ');
    const found = titles(result);
    const rule = found.includes(data.second.title) ? 'OR (or phrase-free): the article without "ผู้สูงอายุ" is found too' : 'AND: only articles with every word';
    note(`Found: ${JSON.stringify(found)} → ${rule}`);
    expect(result.status).toBe(200);
    expect(found, 'the article with both words is found').toContain(data.first.title);
  });

  test('TC-FES-02-03 [Low] [Positive] ค้นหาด้วยชื่อหมวดหมู่', async ({ page }) => {
    // "แสดงเนื้อหาในหมวดหมู่นั้น (ถ้าระบบรองรับ)": the placeholder says categories are searchable.
    const result = await search(page, data.category);
    note(`Category "${data.category}": ${JSON.stringify(titles(result))}`);
    expect(result.status).toBe(200);
    expect(titles(result), 'the articles in that category').toEqual(expect.arrayContaining([data.first.title, data.second.title]));
  });

  test('TC-FES-02-04 [Low] [Positive] ค้นหาด้วยตัวเลข', async ({ page }) => {
    const result = await search(page, '2569');
    note(`Count ${result.count}: ${JSON.stringify(titles(result))}`);
    expect(result.status).toBe(200);
    expect(result.count, 'a result count is shown').not.toBeNull();
  });

  test('TC-FES-02-05 [Low] [Positive] ค้นหาคำที่มีสัญลักษณ์', async ({ page }) => {
    for (const q of ['C++', 'A&B']) {
      const result = await search(page, q);
      note(`"${q}" -> ${result.status}, count ${result.count}, box ${JSON.stringify(result.query)}`);
      expect(result.status, `"${q}": no server error`).toBe(200);
      expect(result.query, `"${q}" kept exactly (no + → space, no &amp;)`).toBe(q);
      expect(result.text, 'echoed as typed').toContain(`"${q}"`);
    }
  });

  test('TC-FES-02-06 [Low] [Negative] ค้นหาด้วยช่องว่างล้วน', async ({ page }) => {
    const blank = await search(page, '   ');
    const empty = await search(page, '');
    note(`Blank: ${blank.status}, count ${blank.count}; empty: count ${empty.count}`);
    expect(blank.status, 'no error').toBeLessThan(400);
    expect(blank.count, 'treated like an empty search').toBe(empty.count);
  });

  test('TC-FES-02-07 [Low] [Negative] คำค้นยาว 1,000 ตัวอักษร', async ({ page }) => {
    const started = Date.now();
    const result = await search(page, 'ก'.repeat(1_000));
    const ms = Date.now() - started;
    note(`${result.status} in ${ms} ms; count ${result.count}`);
    expect(result.status, 'no server error').toBe(200);
    expect(ms, 'answers in normal time').toBeLessThan(10_000);
    expect(result.cards, 'nothing found').toEqual([]);
  });

  test('TC-FES-02-08 [Medium] [Negative] อักขระ wildcard % และ _', async ({ page }) => {
    test.fail(true, WILDCARD);
    for (const q of ['%', '_']) {
      const result = await search(page, q);
      note(`"${q}" -> count ${result.count}: ${JSON.stringify(titles(result).slice(0, 5))}`);
      expect(result.status).toBe(200);
      expect(titles(result), `"${q}" is a literal character, not "match everything" (our articles have no "${q}")`).not.toContain(data.first.title);
    }
  });

  test('TC-FES-02-09 [High] [Negative] SQL Injection ในช่องค้นหา', async ({ page }) => {
    const result = await search(page, "' OR 1=1 --");
    note(`Count ${result.count}: ${JSON.stringify(titles(result).slice(0, 5))}`);
    expect(result.status, 'no server error').toBe(200);
    expect(SQL_ERROR_PATTERN.test(result.text), 'no SQL error').toBe(false);
    expect(titles(result), 'no extra data (our articles do not contain the words)').not.toContain(data.first.title);
  });

  test('TC-FES-02-10 [Low] [Negative] อักขระควบคุมและ null byte', async ({ page }) => {
    for (const raw of ['%00', encodeURIComponent('\u0000'), `NG%00Tube`]) {
      const result = await searchUrl(page, raw);
      note(`q=${raw} -> ${result.status}`);
      expect(result.status, `q=${raw}: no server error`).toBeLessThan(500);
    }
  });

  test('TC-FES-02-11 [Low] [Positive] กดปุ่ม Enter เพื่อค้นหา', async ({ page }) => {
    const clicked = await search(page, 'NG Tube', 'click');
    const navigations: string[] = [];
    page.on('request', (r) => {
      if (r.isNavigationRequest() && r.url().includes('/frontend/search/index')) navigations.push(r.url());
    });
    const entered = await search(page, 'NG Tube', 'enter');
    note(`Requests: ${JSON.stringify(navigations)}`);
    expect(titles(entered).sort(), 'the same results as the button').toEqual(titles(clicked).sort());
    expect(navigations.filter((u) => /[?&]q=/.test(u)).length, 'sent once').toBe(1);
  });

  test('TC-FES-02-12 [Low] [Positive] ช่องค้นหาคงคำค้นเดิมหลังค้นหา', async ({ page }) => {
    const result = await search(page, 'NG Tube');
    expect(result.query, 'the box still says "NG Tube"').toBe('NG Tube');
  });

  test('TC-FES-02-13 [Low] [Positive] กด Back/Forward หลังค้นหา', async ({ page }) => {
    const result = await search(page, 'NG Tube');
    expect(result.cards.length).toBeGreaterThan(0);
    await page.locator('.body-content a.card').first().click();
    await page.waitForLoadState('load');
    expect(page.url(), 'the result page opened').not.toContain('/frontend/search/index');
    await page.goBack();
    await page.waitForLoadState('load');
    const back = await readResults(page, 200);
    expect(back.url, 'back on the search').toBe(result.url);
    expect(back.query, 'the search word kept').toBe('NG Tube');
    expect(titles(back), 'the same results').toEqual(titles(result));
    await page.goForward();
    await page.waitForLoadState('load');
    expect(page.url(), 'forward again').toBe(result.cards[0].href);
  });

  test('TC-FES-02-14 [High] [Positive] คลิกผลลัพธ์แล้วไปหน้ารายละเอียดถูกรายการ', async ({ page }) => {
    const result = await search(page, 'NG Tube');
    expect(result.cards.length, 'two results to click').toBeGreaterThanOrEqual(2);
    const opened: string[] = [];
    for (const index of [0, 1]) {
      const card = result.cards[index];
      if (index > 0) await search(page, 'NG Tube');
      await page.locator('.body-content a.card').nth(index).click();
      await page.waitForLoadState('load');
      opened.push(page.url());
      expect(page.url(), `result ${index + 1} opens its own page`).toBe(card.href);
      await expect(page.locator('body'), `the page of "${card.title}"`).toContainText(card.title);
    }
    expect(new Set(opened).size, 'two different pages').toBe(2);
  });
});
