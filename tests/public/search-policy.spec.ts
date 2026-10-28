import { test, expect, ANONYMOUS_SESSION } from '@fixtures/pages.fixtures';
import { requireDataCreatingTestsAllowed } from '@config/env';
import { KNOWLEDGE_MODULE, NewsFormValues } from '@pages/admin/AdminNewsPages';
import { sheetTitle } from '@utils/caseTitles';
import { urlOf } from '@utils/lowPrivilege';
import { deleteNewsByExcerpt, submitNews } from '@utils/newsFlows';
import { roleStamp } from '@utils/roleFlows';
import { AUTO_TEST_FLAG } from '@utils/testData';
import { Browser, Page } from '@playwright/test';
import { ADMIN_AUTH_FILE } from '../../global-setup';

/**
 * KM-FES — the public search cases left after the Auto:Y round (Auto:P), checked 2026-10-07: search by tag, no
 * unpublished content in the results, paging and order. `page` is an anonymous visitor; the articles a case needs are
 * saved (excerpt = "[Auto Test] … <stamp>") from an admin context and deleted again at the end. Tags persist in the
 * system (there is no tag admin), so the case reuses the test tag "autotest4".
 */

test.use({ storageState: ANONYMOUS_SESSION });

const CREATES = 'Saves knowledge articles (deleted again at the end of the case).';
const TAG = 'autotest4';

test.beforeEach(() => test.setTimeout(240_000));

function note(description: string): void {
  test.info().annotations.push({ type: 'note', description });
}

interface Result {
  count: number | null;
  range: string;
  titles: string[];
  excerpts: string[];
  dates: string[];
  url: string;
}

async function searchPage(page: Page, query: string): Promise<Result> {
  await page.goto(urlOf(`/frontend/search/index${query}`));
  await page.waitForLoadState('load');
  const text = ((await page.locator('.body-content').textContent()) ?? '').replace(/\s+/g, ' ');
  const cards = page.locator('.body-content a.card');
  const read = (selector: string): Promise<string[]> => cards.evaluateAll((cs, s) => cs.map((c) => (c.querySelector(s)?.textContent ?? '').replace(/\s+/g, ' ').trim()), selector);
  return {
    count: Number(/พบทั้งหมด\s*(\d+)\s*รายการ/.exec(text)?.[1] ?? NaN) || null,
    range: /แสดงรายการที่\s*([\d\s–-]+)/.exec(text)?.[1]?.trim() ?? '',
    titles: await read('.card-title'),
    excerpts: await read('.card-text'),
    dates: await read('.group-inline > .text-small'),
    url: page.url(),
  };
}

/** Saves the articles from an admin context, runs `work`, then deletes them. */
async function withArticles(browser: Browser, items: NewsFormValues[], work: () => Promise<void>): Promise<void> {
  requireDataCreatingTestsAllowed(CREATES);
  const context = await browser.newContext({ storageState: ADMIN_AUTH_FILE });
  const admin = await context.newPage();
  const excerpts: string[] = [];
  try {
    for (const item of items) {
      const { excerpt, submitted } = await submitNews(admin, item, KNOWLEDGE_MODULE);
      excerpts.push(excerpt);
      expect(submitted.final, `saving "${item.title}"`).toBeLessThan(500);
    }
    await work();
  } finally {
    let deleted = 0;
    for (const e of excerpts) deleted += await deleteNewsByExcerpt(admin, e, KNOWLEDGE_MODULE);
    note(`Cleanup: deleted ${deleted} article(s).`);
    await context.close();
  }
}

test.describe('SC-FES ค้นหา (Auto:P)', () => {
  test(sheetTitle('TC-FES-01-04'), async ({ page, browser }) => {
    const stamp = roleStamp();
    const tagged = { title: `AUTO_TAGGED ${stamp}`, excerpt: `${AUTO_TEST_FLAG} มีแท็ก ${stamp}`, tags: [TAG], status: 'publish' as const };
    const plain = { title: `AUTO_UNTAGGED ${stamp}`, excerpt: `${AUTO_TEST_FLAG} ไม่มีแท็ก ${stamp}`, status: 'publish' as const };
    await withArticles(browser, [tagged, plain], async () => {
      await page.goto(urlOf('/frontend/search/index'));
      const option = await page.locator('select[name="tag"] option').evaluateAll((os, t) => os.map((o) => ({ value: (o as HTMLOptionElement).value, label: (o.textContent ?? '').trim() })).find((o) => o.label === t), TAG);
      note(`Tag option: ${JSON.stringify(option)}`);
      expect(option, `"${TAG}" is a tag filter option`).toBeDefined();
      const result = await searchPage(page, `?tag=${encodeURIComponent(option!.value)}`);
      note(`?tag=${option!.value}: ${result.count} result(s) ${JSON.stringify(result.titles.slice(0, 10))}`);
      expect(result.titles, 'the tagged article is found').toContain(tagged.title);
      expect(result.titles, 'the article without the tag is not').not.toContain(plain.title);
      // By text too: the box says it searches tags ("ค้นหาหมวดหมู่ , Tag ,ชื่อบทความ, อื่นๆ").
      const byText = await searchPage(page, `?q=${encodeURIComponent(TAG)}`);
      note(`?q=${TAG}: ${JSON.stringify(byText.titles.slice(0, 10))}`);
      expect.soft(byText.titles, 'typing the tag finds the tagged article').toContain(tagged.title);
    });
  });

  test(sheetTitle('TC-FES-01-07'), async ({ page, browser }) => {
    const stamp = roleStamp();
    const items = (['draft', 'hide'] as const).map((status) => ({ title: `AUTO_UNPUBLISHED_${status} ${stamp}`, excerpt: `${AUTO_TEST_FLAG} ไม่เผยแพร่ ${status} ${stamp}`, status }));
    await withArticles(browser, items, async () => {
      const result = await searchPage(page, `?q=${encodeURIComponent(stamp)}`);
      note(`?q=${stamp}: count ${result.count}, titles ${JSON.stringify(result.titles)}`);
      expect(result.titles.filter((t) => t.includes(stamp)), 'no unpublished article in the results').toEqual([]);
    });
  });

  test(sheetTitle('TC-FES-02-15'), async ({ page, browser }) => {
    // 12 articles with the stamp: 1 has it in the title, 11 only in the excerpt — enough for a second page.
    const stamp = roleStamp();
    const items: NewsFormValues[] = [
      { title: `AUTO_RANK ${stamp}`, excerpt: `${AUTO_TEST_FLAG} ลำดับ 0`, status: 'publish' },
      ...Array.from({ length: 11 }, (_, i) => ({ title: `AUTO_PAGE ${String(i + 1).padStart(2, '0')} ${roleStamp()}`, excerpt: `${AUTO_TEST_FLAG} ผลค้นหา ${stamp} ${i + 1}`, status: 'publish' as const })),
    ];
    await withArticles(browser, items, async () => {
      const first = await searchPage(page, `?q=${encodeURIComponent(stamp)}`);
      note(`Page 1: count ${first.count}, range "${first.range}", ${first.titles.length} card(s)`);
      expect(first.count, 'all 12 are found').toBe(12);
      const perPage = first.titles.length;
      if (perPage < 12) {
        const second = await searchPage(page, `?q=${encodeURIComponent(stamp)}&page=2`);
        note(`Page 2: range "${second.range}", ${second.titles.length} card(s)`);
        expect(second.titles.length, 'page 2 holds the rest').toBe(Math.min(perPage, 12 - perPage));
        expect(second.titles.filter((t) => first.titles.includes(t)), 'no item on both pages').toEqual([]);
      } else {
        note(`All 12 on one page (${perPage} per page).`);
      }
      // Order (TBD in the sheet): the title match first, or newest first — one of the two must hold.
      const titleFirst = first.titles[0] === `AUTO_RANK ${stamp}`;
      const newestFirst = first.titles[0] === items[items.length - 1].title;
      note(`First result: ${first.titles[0]} (title match first: ${titleFirst}, newest first: ${newestFirst})`);
      expect(titleFirst || newestFirst, 'ordered by relevance (title match first) or newest first').toBe(true);
    });
  });
});
