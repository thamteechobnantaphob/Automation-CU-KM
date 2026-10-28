import { test, expect, ANONYMOUS_SESSION } from '@fixtures/pages.fixtures';
import { requireDataCreatingTestsAllowed } from '@config/env';
import { AdminNewsListPage, BEST_PRACTICE_MODULE, ContentModule, KNOWLEDGE_MODULE, NEWS_MODULE, NewsFormValues } from '@pages/admin/AdminNewsPages';
import { AdminActivityPage } from '@pages/admin/AdminActivityPage';
import { ALBUM_IMAGE, deleteAlbumsWhere, publicActivity, submitAlbum } from '@utils/activityFlows';
import { sheetTitle } from '@utils/caseTitles';
import { urlOf } from '@utils/lowPrivilege';
import { createNewsCategory, deleteNewsByExcerpt, deleteNewsCategory, editContentItem, fetchAsVisitor, publicContentDetail, submitNews } from '@utils/newsFlows';
import { roleStamp } from '@utils/roleFlows';
import { AUTO_TEST_FLAG } from '@utils/testData';
import { drawImage, fixtureFile } from '@utils/uploadFiles';
import { Browser, Page } from '@playwright/test';
import { ADMIN_AUTH_FILE } from '../../global-setup';

/**
 * KM-FEH / KM-FEK / KM-FEN — public list and detail pages with content the case saves itself (Auto:P), checked
 * 2026-10-07. `page` is an anonymous visitor; content is saved from an admin context (excerpt "[Auto Test] … <stamp>",
 * titles ASCII so the detail slug is known) and deleted again at the end. Albums carry the marker in their description.
 */

test.use({ storageState: ANONYMOUS_SESSION });

const KNOWN = {
  EXCERPT_HIDDEN: 'Known bug (DEF-87): the public detail page does not show the cover / excerpt (commented out in the HTML).',
  NO_DOWNLOAD_COUNT: 'Known bug (DEF-93): downloads are not counted.',
  TAG_NOT_LINK: 'Known bug (DEF-116): tags on the public detail page are plain text — clicking one does not open the list / search of that tag.',
  EXTERNAL_LINK: 'Known bug (DEF-79): external links (also in article content) open in the same tab with no rel=noopener noreferrer.',
  NO_IMAGE_SAVED: 'Known bug (DEF-75): an album without any image is saved.',
  LIST_NO_TAG: 'Known bug (DEF-81): the article cards on the public list show no tags (like the search result cards).',
};

test.beforeEach(() => test.setTimeout(480_000));

function note(description: string): void {
  test.info().annotations.push({ type: 'note', description });
}

interface Saved {
  title: string;
  excerpt: string;
  module: ContentModule;
}

/** Saves items from an admin context, runs `work` (with that admin page), then deletes them (and the categories). */
async function withContent(browser: Browser, items: (NewsFormValues & { module?: ContentModule })[], work: (saved: Saved[], admin: Page) => Promise<void>, categories: { module: ContentModule; name: string }[] = []): Promise<void> {
  requireDataCreatingTestsAllowed('Saves content items (deleted again at the end of the case).');
  const context = await browser.newContext({ storageState: ADMIN_AUTH_FILE });
  const admin = await context.newPage();
  const saved: Saved[] = [];
  try {
    for (const item of items) {
      const module = item.module ?? KNOWLEDGE_MODULE;
      const title = item.title ?? `AUTO_ITEM ${roleStamp()}`;
      const { excerpt, submitted } = await submitNews(admin, { status: 'publish', ...item, title }, module);
      expect(submitted.final, `saving "${title}"`).toBeLessThan(500);
      saved.push({ title, excerpt, module });
    }
    await work(saved, admin);
  } finally {
    let deleted = 0;
    for (const s of saved) deleted += await deleteNewsByExcerpt(admin, s.excerpt, s.module);
    for (const c of categories) await deleteNewsCategory(admin, c.name, c.module);
    note(`Cleanup: deleted ${deleted} item(s)${categories.length ? ` and ${categories.length} categor(ies)` : ''}.`);
    await context.close();
  }
}

const slugOf = (title: string): string => title.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');

/** A public list page as a visitor: cards (title, text, images) plus paging. */
async function listPage(page: Page, path: string): Promise<{ cards: { title: string; text: string; image: string; imageLoaded: boolean; href: string }[]; pager: string[]; active: string; overflowX: number }> {
  await page.goto(urlOf(path));
  await page.waitForLoadState('load');
  await page.waitForTimeout(500);
  const cards = await page.locator('.body-content a.card').evaluateAll((cs) =>
    cs.map((c) => {
      const img = c.querySelector('img:not([src*="/icon/"])') as HTMLImageElement | null;
      return { title: (c.querySelector('.card-title')?.textContent ?? '').replace(/\s+/g, ' ').trim(), text: (c.textContent ?? '').replace(/\s+/g, ' ').trim(), image: img?.getAttribute('src') ?? '', imageLoaded: !img || (img.complete && img.naturalWidth > 0), href: c.getAttribute('href') ?? '' };
    }),
  );
  const pager = await page.locator('.pagination .page-item, .pagination a, .pagination span').allInnerTexts();
  // No pager on a short list: innerText() would wait for it until the test times out.
  const activeItem = page.locator('.pagination .active').first();
  const active = (await activeItem.count()) ? (await activeItem.innerText()).trim() : '';
  const overflowX = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  return { cards, pager: pager.map((p) => p.trim()).filter(Boolean), active, overflowX };
}

async function detailOf(browser: Browser, s: Saved): Promise<NonNullable<Awaited<ReturnType<typeof publicContentDetail>>>> {
  const detail = await publicContentDetail(browser, s.excerpt, s.title, s.module);
  expect(detail, `"${s.title}" is on the public list`).toBeTruthy();
  return detail!;
}

// ---------------------------------------------------------------------------------------------------------------

test.describe('SC-FEH หน้าหลัก', () => {
  test(sheetTitle('TC-FEH-03-05'), async ({ page, browser }) => {
    const footerCount = async (p: Page): Promise<number> => {
      await p.goto(urlOf('/'), { waitUntil: 'domcontentloaded', timeout: 60_000 });
      const text = (await p.locator('footer').first().innerText({ timeout: 30_000 })).replace(/\s+/g, ' ');
      return Number(/ผู้เข้าชมทั้งหมด\s*:\s*([\d,]+)/.exec(text)?.[1].replace(/,/g, '') ?? NaN);
    };
    const before = await footerCount(page);
    const context = await browser.newContext({ storageState: ANONYMOUS_SESSION });
    try {
      await (await context.newPage()).goto(urlOf('/'));
    } finally {
      await context.close();
    }
    const after = await footerCount(page);
    note(`ผู้เข้าชมทั้งหมด: ${before} → ${after} after one new session (and this page reloaded)`);
    expect(after - before, 'the counter grows by the new visits (per session or per IP — TBD in the sheet)').toBeGreaterThanOrEqual(0);
    expect(after - before, 'and not by more than the visits made (3 page loads)').toBeLessThanOrEqual(3);
    const admin = await browser.newContext({ storageState: ADMIN_AUTH_FILE });
    try {
      const dash = await admin.newPage();
      await dash.goto(urlOf('/admin/dashboard/index'), { waitUntil: 'domcontentloaded', timeout: 60_000 });
      const text = (await dash.locator('body').innerText({ timeout: 30_000 })).replace(/\s+/g, ' ');
      note(`Dashboard: ${/ผู้เข้าชม[^\d]{0,40}[\d,]+/.exec(text)?.[0] ?? '(no visitor figure)'}`);
      const shown = Number(/ผู้เข้าชม[^\d]{0,40}([\d,]+)/.exec(text)?.[1].replace(/,/g, '') ?? NaN);
      if (!Number.isNaN(shown)) expect(Math.abs(shown - after), 'the dashboard shows the same total').toBeLessThanOrEqual(1);
    } finally {
      await admin.close();
    }
  });

  test(sheetTitle('TC-FEH-03-06'), async ({ page, browser }) => {
    await withContent(browser, [{ title: `AUTO_NO_COVER ${roleStamp()}` }, { title: `AUTO_NEWS_NO_COVER ${roleStamp()}`, module: NEWS_MODULE }], async (saved) => {
      for (const path of ['/', '/frontend/knowledge/index', '/frontend/news/index']) {
        const list = await listPage(page, path);
        const broken = list.cards.filter((c) => !c.imageLoaded);
        note(`${path}: ${list.cards.length} card(s), broken images ${JSON.stringify(broken.map((b) => b.image))}`);
        expect.soft(broken, `${path}: no broken image icon (a placeholder instead)`).toEqual([]);
        expect.soft(list.overflowX, `${path}: the layout does not shift`).toBeLessThanOrEqual(1);
      }
      const card = (await listPage(page, '/frontend/knowledge/index')).cards.find((c) => c.text.includes(saved[0].excerpt.slice(-10)));
      expect(card?.image, 'the item without a cover uses a placeholder image').toBeTruthy();
    });
  });

  test(sheetTitle('TC-FEH-04-03'), async ({ page, browser }) => {
    const stamp = roleStamp();
    const items = Array.from({ length: 13 }, (_, i) => ({ title: `AUTO_PAGE_${String(i + 1).padStart(2, '0')} ${stamp}`, module: NEWS_MODULE }));
    await withContent(browser, items, async () => {
      const first = await listPage(page, '/frontend/news/index');
      note(`Page 1: ${first.cards.length} card(s); pager ${JSON.stringify(first.pager)}; active "${first.active}"`);
      expect(first.pager.length, 'a pager is shown when there is more than one page').toBeGreaterThan(0);
      expect(first.active, 'page 1 is highlighted').toBe('1');
      // The page renders two pagers (narrow / wide screen, one hidden) — use the visible one.
      const pager = page.locator('.pagination:visible').first();
      const prev = pager.locator('.page-item').first();
      expect(await prev.evaluate((li) => li.classList.contains('disabled') || !li.querySelector('a[href]')), '"ก่อนหน้า" is disabled on the first page').toBe(true);
      await Promise.all([page.waitForURL(/page=2/, { timeout: 60_000 }), pager.locator('a', { hasText: /^\s*2\s*$/ }).first().click()]);
      await page.waitForLoadState('load');
      const second = (await pager.locator('.active').first().innerText({ timeout: 30_000 })).trim();
      expect(second, 'the page number goes to page 2').toBe('2');
      const last = pager.locator('.page-item').last();
      const pages = (await pager.locator('.page-item').allInnerTexts()).map((t) => Number(t.trim())).filter((n) => !Number.isNaN(n));
      note(`Page 2: pages ${JSON.stringify(pages)}`);
      if (Math.max(...pages) === 2) expect(await last.evaluate((li) => li.classList.contains('disabled') || !li.querySelector('a[href]')), '"ถัดไป" is disabled on the last page').toBe(true);
      await Promise.all([page.waitForURL((url) => !/page=2/.test(url.search), { timeout: 60_000 }), pager.locator('a').first().click()]);
      await page.waitForLoadState('load');
      expect((await pager.locator('.active').first().innerText({ timeout: 30_000 })).trim(), '"ก่อนหน้า" goes back to page 1').toBe('1');
    });
  });
});

test.describe('SC-FEK บทความ/คลังความรู้และแนวปฏิบัติที่ดี', () => {
  test(sheetTitle('TC-FEK-01-02'), async ({ page, browser }) => {
    const stamp = roleStamp();
    const category = `${AUTO_TEST_FLAG} หมวดบทความ ${stamp}`;
    const context = await browser.newContext({ storageState: ADMIN_AUTH_FILE });
    const name = await createNewsCategory(await context.newPage(), category, KNOWLEDGE_MODULE);
    await context.close();
    await withContent(
      browser,
      [
        { title: `AUTO_OLDER ${stamp}`, category: name, tags: ['autotest1'] },
        { title: `AUTO_NEWER ${stamp}`, category: name, tags: ['autotest2'] },
        { title: `AUTO_DRAFT ${stamp}`, status: 'draft' },
      ],
      async (saved) => {
        const list = await listPage(page, '/frontend/knowledge/index');
        const mine = list.cards.filter((c) => c.text.includes(stamp) || saved.some((s) => c.text.includes(s.excerpt)));
        note(`Cards with the stamp: ${JSON.stringify(mine.map((c) => c.title))}`);
        expect(mine.map((c) => c.title), 'the published articles, newest first').toEqual([`AUTO_NEWER ${stamp}`, `AUTO_OLDER ${stamp}`]);
        expect(list.cards.map((c) => c.title), 'the draft is not shown').not.toContain(`AUTO_DRAFT ${stamp}`);
        test.fail(mine.some((c) => !/autotest[12]/.test(c.text)), KNOWN.LIST_NO_TAG);
        for (const c of mine) {
          expect.soft(c.text, `"${c.title}" shows its category`).toContain(name);
          expect.soft(c.text, `"${c.title}" shows a date`).toMatch(/\d{1,2}\s*\S+\s*\d{2}/);
          expect.soft(c.text, `"${c.title}" shows its tag`).toMatch(/autotest[12]/);
        }
      },
      [{ module: KNOWLEDGE_MODULE, name }],
    );
  });

  test(sheetTitle('TC-FEK-01-03'), async ({ browser }) => {
    const stamp = roleStamp();
    const body = '<h2>หัวข้อย่อย</h2><p><strong>ตัวหนา</strong> และ <em>ตัวเอียง</em></p><ul><li>ข้อ 1</li><li>ข้อ 2</li></ul>';
    await withContent(browser, [{ title: `AUTO_DETAIL ${stamp}`, body, tags: ['autotest3'], documents: [fixtureFile('sample.pdf', 'เอกสาร แนบ.pdf')] }], async ([s]) => {
      const detail = await detailOf(browser, s);
      note(`URL ${detail.url}; documents ${JSON.stringify(detail.media.documents)}`);
      expect(detail.status).toBe(200);
      expect(detail.text, 'the title').toContain(s.title);
      expect(detail.text, 'a date').toMatch(/\d{1,2}\s*\S+\s*\d{2}/);
      expect(detail.text, 'the tag').toContain('autotest3');
      expect(detail.html, 'the rich text keeps its formatting').toMatch(/<strong>ตัวหนา<\/strong>[\s\S]*<li>ข้อ 1<\/li>/);
      expect(detail.media.documents.length, 'the attachment with a download link').toBe(1);
      expect((await fetchAsVisitor(browser, detail.media.documents[0].href)).status, 'it downloads').toBe(200);
      expect(new URL(detail.url).pathname, 'the URL identifies the article').toContain(slugOf(s.title));
    });
  });

  test(sheetTitle('TC-FEK-01-04'), async ({ browser }) => {
    await withContent(browser, [{ title: `AUTO_VIEWS ${roleStamp()}` }], async ([s]) => {
      const first = await detailOf(browser, s);
      const second = await detailOf(browser, s);
      note(`Views: ${first.media.views} → ${second.media.views}`);
      expect(first.media.views, 'the view count is shown').not.toBeNull();
      expect(second.media.views, 'one more visit (new session) adds 1').toBe((first.media.views ?? 0) + 1);
    });
  });

  test(sheetTitle('TC-FEK-01-05'), async ({ browser }) => {
    const stamp = roleStamp();
    await withContent(browser, [{ title: `AUTO_UNPUBLISHED ${stamp}`, status: 'draft' }, { title: `AUTO_HIDDEN ${stamp}`, status: 'hide' }], async (saved) => {
      for (const s of saved) {
        const got = await fetchAsVisitor(browser, urlOf(`${KNOWLEDGE_MODULE.publicDetail}${slugOf(s.title)}`));
        note(`${s.title}: ${got.status}`);
        expect(got.status === 404 || !got.body.toString().includes(s.excerpt), `"${s.title}": 404 / not found, its content is not shown`).toBe(true);
        expect(got.status, 'answers 404').toBe(404);
      }
    });
  });

  test(sheetTitle('TC-FEK-02-02'), async ({ browser }) => {
    const stamp = roleStamp();
    const context = await browser.newContext({ storageState: ADMIN_AUTH_FILE });
    const name = await createNewsCategory(await context.newPage(), `${AUTO_TEST_FLAG} หมวดแนวปฏิบัติ`, BEST_PRACTICE_MODULE);
    await context.close();
    await withContent(browser, [{ title: `AUTO_BP_DETAIL ${stamp}`, module: BEST_PRACTICE_MODULE, category: name, body: '<p>เนื้อหาแนวปฏิบัติที่ดี [Auto Test]</p>' }], async ([s]) => {
      const detail = await detailOf(browser, s);
      expect(detail.status).toBe(200);
      expect(detail.text, 'the title').toContain(s.title);
      expect(detail.text, 'the body').toContain('เนื้อหาแนวปฏิบัติที่ดี');
      expect(detail.text, 'the category').toContain(name);
      expect(detail.text, 'a date').toMatch(/\d{1,2}\s*\S+\s*\d{2}/);
    }, [{ module: BEST_PRACTICE_MODULE, name }]);
  });

  test(sheetTitle('TC-FEK-03-01'), async ({ page, browser }) => {
    await withContent(browser, [{ title: `AUTO_PLAIN ${roleStamp()}`, body: '<p>เนื้อหาธรรมดา</p>' }], async ([s]) => {
      const card = (await listPage(page, KNOWLEDGE_MODULE.publicIndex)).cards.find((c) => c.text.includes(s.excerpt));
      expect(card?.imageLoaded, 'the list card shows a placeholder, not a broken image').toBe(true);
      const detail = await detailOf(browser, s);
      const broken = await (async () => {
        const context = await browser.newContext({ storageState: ANONYMOUS_SESSION });
        try {
          const visitor = await context.newPage();
          await visitor.goto(detail.url);
          await visitor.waitForTimeout(600);
          return visitor.locator('.body-content img').evaluateAll((imgs) => imgs.filter((i) => !(i as HTMLImageElement).complete || (i as HTMLImageElement).naturalWidth === 0).map((i) => i.getAttribute('src')));
        } finally {
          await context.close();
        }
      })();
      expect(broken, 'no broken image on the detail page').toEqual([]);
      expect(detail.media.documents, 'no empty "เอกสารแนบ" block').toEqual([]);
      expect(detail.text, 'no empty tag / attachment heading').not.toMatch(/เอกสารแนบ\s*$/);
    });
  });

  test(sheetTitle('TC-FEK-03-02'), async ({ browser }) => {
    const table = `<table border="1"><tr>${Array.from({ length: 30 }, (_, i) => `<td>คอลัมน์ที่ ${i + 1} ข้อมูลยาว</td>`).join('')}</tr></table>`;
    const body = `<p>${'เนื้อหายาวมาก '.repeat(3_600)}</p>${table}`;
    await withContent(browser, [{ title: `AUTO_LONG ${roleStamp()}`, body }], async ([s]) => {
      for (const viewport of [{ width: 1366, height: 900 }, { width: 375, height: 800 }]) {
        const detail = await publicContentDetail(browser, s.excerpt, s.title, KNOWLEDGE_MODULE, viewport);
        expect(detail?.status, `${viewport.width}px: the page loads`).toBe(200);
        note(`${viewport.width}px: overflow ${detail?.media.overflowX}px`);
        expect.soft(detail?.media.overflowX ?? 99, `${viewport.width}px: nothing runs off the screen (the table scrolls in its own box)`).toBeLessThanOrEqual(1);
      }
    });
  });

  test(sheetTitle('TC-FEK-03-03'), async ({ browser }) => {
    await withContent(browser, [{ title: `AUTO_DOWNLOAD ${roleStamp()}`, documents: [fixtureFile('sample.pdf', 'คู่มือ การพยาบาล.pdf')] }], async ([s], admin) => {
      const detail = await detailOf(browser, s);
      const got = await fetchAsVisitor(browser, detail.media.documents[0].href);
      const name = decodeURIComponent(got.disposition);
      note(`Download ${got.status} ${got.type}; ${name}`);
      expect(got.status).toBe(200);
      expect(name, 'the Thai file name is kept').toContain('คู่มือ การพยาบาล.pdf');
      expect(got.body.subarray(0, 4).toString(), 'the right file (a PDF)').toBe('%PDF');
      const card = await new AdminNewsListPage(admin, KNOWLEDGE_MODULE).findByExcerpt(s.excerpt);
      note(`Admin card counters: ${JSON.stringify(card?.counters)}`);
      test.fail(card?.counters[1] !== 1, KNOWN.NO_DOWNLOAD_COUNT);
      expect(card?.counters[1], 'the download counter is 1').toBe(1);
    });
  });

  test(sheetTitle('TC-FEK-03-04'), async ({ browser }) => {
    await withContent(browser, [{ title: `AUTO_MISSING_FILE ${roleStamp()}`, documents: [fixtureFile('sample.pdf', 'missing.pdf')] }], async ([s]) => {
      const detail = await detailOf(browser, s);
      const real = detail.media.documents[0].href;
      // A link to an attachment that is not on the server: the same link with an unknown id.
      const missing = real.replace(/\/attachments\/[^/]+\/download/, '/attachments/AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA/download');
      const got = await fetchAsVisitor(browser, missing);
      note(`${missing} → ${got.status} ${got.type}`);
      expect(got.status, 'no server error').toBeLessThan(500);
      expect(got.status, 'a "not found" answer').toBe(404);
    });
  });

  test(sheetTitle('TC-FEK-03-05'), async ({ browser }) => {
    await withContent(browser, [{ title: `AUTO_TAG_LINK ${roleStamp()}`, tags: ['autotest5'] }], async ([s]) => {
      const detail = await detailOf(browser, s);
      const context = await browser.newContext({ storageState: ANONYMOUS_SESSION });
      try {
        const visitor = await context.newPage();
        await visitor.goto(detail.url);
        const tag = visitor.locator('.body-content a', { hasText: 'autotest5' }).first();
        const isLink = (await tag.count()) > 0;
        note(`Tag link: ${isLink ? await tag.getAttribute('href') : '(the tag is not a link)'}`);
        test.fail(!isLink, KNOWN.TAG_NOT_LINK);
        expect(isLink, 'the tag is a link').toBe(true);
        await tag.click();
        await visitor.waitForLoadState('load');
        const text = (await visitor.locator('.body-content').innerText()).replace(/\s+/g, ' ');
        expect(visitor.url(), 'goes to a list / search filtered by the tag').toMatch(/tag=|\/tag\//);
        expect(text, 'which shows the tagged article').toContain(s.title);
      } finally {
        await context.close();
      }
    });
  });

  test(sheetTitle('TC-FEK-03-06'), async ({ browser }) => {
    const body = '<p>อ่านต่อที่ <a href="https://www.example.com/km">เว็บภายนอก</a></p>';
    await withContent(browser, [{ title: `AUTO_EXT_LINK ${roleStamp()}`, body }], async ([s]) => {
      const detail = await detailOf(browser, s);
      const link = /<a[^>]*href="https:\/\/www\.example\.com\/km"[^>]*>/.exec(detail.html)?.[0] ?? '';
      note(`Link: ${link}`);
      expect(link, 'the external link is shown').not.toBe('');
      test.fail(!/target="_blank"/.test(link), KNOWN.EXTERNAL_LINK);
      expect(link, 'opens in a new tab').toMatch(/target="_blank"/);
      expect(link, 'with rel=noopener noreferrer').toMatch(/rel="[^"]*noopener[^"]*"/);
      expect(link).toMatch(/rel="[^"]*noreferrer[^"]*"/);
    });
  });

  test(sheetTitle('TC-FEK-03-07'), async ({ page, browser }) => {
    const wide = await drawImage(page, 'wide.png', { width: 3000, height: 600, type: 'image/png' });
    const body = `<p>รูปกว้าง</p><p><img src="data:image/png;base64,${wide.buffer.toString('base64')}" alt="wide"></p>`;
    await withContent(browser, [{ title: `AUTO_WIDE_IMG ${roleStamp()}`, body }], async ([s]) => {
      const detail = await publicContentDetail(browser, s.excerpt, s.title, KNOWLEDGE_MODULE, { width: 375, height: 800 });
      note(`375px: body images ${JSON.stringify(detail?.media.bodyImages)}; overflow ${detail?.media.overflowX}px`);
      expect(detail?.media.bodyImages.length, 'the image is shown').toBeGreaterThan(0);
      expect(detail?.media.overflowX, 'it does not run off a 375px screen').toBeLessThanOrEqual(1);
    });
  });
});

test.describe('SC-FEN ข่าวสารและคลังกิจกรรม', () => {
  test(sheetTitle('TC-FEN-01-02'), async ({ browser }) => {
    await withContent(browser, [{ title: `KM-Day SHOW and SHARE ${roleStamp()}`, module: NEWS_MODULE, body: '<p>โครงการ KM-Day: SHOW &amp; SHARE [Auto Test]</p>' }], async ([s]) => {
      const detail = await detailOf(browser, s);
      expect(detail.status).toBe(200);
      expect(detail.text, 'the title').toContain(s.title);
      expect(detail.text, 'a date').toMatch(/\d{1,2}\s*\S+\s*\d{2}/);
      expect(detail.text, 'the content').toContain('KM-Day: SHOW & SHARE');
    });
  });

  test(sheetTitle('TC-FEN-01-03'), async ({ page, browser }) => {
    await withContent(browser, [{ title: `AUTO_NEWS_HIDE ${roleStamp()}`, module: NEWS_MODULE }], async ([s], admin) => {
      expect((await listPage(page, NEWS_MODULE.publicIndex)).cards.some((c) => c.text.includes(s.excerpt)), 'precondition: published').toBe(true);
      expect((await editContentItem(admin, NEWS_MODULE, s.excerpt, { status: 'hide' })).final).toBeLessThan(400);
      expect((await listPage(page, NEWS_MODULE.publicIndex)).cards.some((c) => c.text.includes(s.excerpt)), 'gone from /frontend/news/index').toBe(false);
    });
  });

  test(sheetTitle('TC-FEN-03-01'), async ({ page, browser }) => {
    await withContent(browser, [{ title: `AUTO_NEWS_BARE ${roleStamp()}`, module: NEWS_MODULE }], async ([s]) => {
      const list = await listPage(page, NEWS_MODULE.publicIndex);
      const card = list.cards.find((c) => c.title === s.title);
      note(`Card: ${JSON.stringify(card)}`);
      expect(card, 'listed').toBeDefined();
      expect(card!.imageLoaded, 'a placeholder instead of a broken image').toBe(true);
      expect(list.overflowX, 'no layout break').toBeLessThanOrEqual(1);
    });
  });

  test(sheetTitle('TC-FEN-03-02'), async ({ page, browser }) => {
    const stamp = roleStamp();
    const items = Array.from({ length: 15 }, (_, i) => ({ title: `AUTO_NEWS_${String(i + 1).padStart(2, '0')} ${stamp}`, module: NEWS_MODULE }));
    await withContent(browser, items, async () => {
      const first = await listPage(page, NEWS_MODULE.publicIndex);
      const mine = first.cards.map((c) => c.title).filter((t) => t.includes(stamp));
      note(`Page 1: ${first.cards.length} card(s) (${mine.length} of ours); pager ${JSON.stringify(first.pager)}`);
      expect(mine[0], 'newest first').toBe(`AUTO_NEWS_15 ${stamp}`);
      expect(mine, 'in order new → old').toEqual([...mine].sort().reverse());
      expect(first.pager.length, '15 news need a second page').toBeGreaterThan(0);
      await page.locator('.pagination a', { hasText: '2' }).first().click();
      await page.waitForLoadState('load');
      const second = await page.locator('.body-content a.card .card-title').allInnerTexts();
      expect(second.filter((t) => first.cards.some((c) => c.title === t.trim())), 'page 2 shows other news').toEqual([]);
      expect(second.length, 'page 2 is not empty').toBeGreaterThan(0);
    });
  });

  test(sheetTitle('TC-FEN-02-02'), async ({ page, browser }) => {
    requireDataCreatingTestsAllowed('Saves an album (deleted again at the end).');
    const admin = await browser.newContext({ storageState: ADMIN_AUTH_FILE });
    const adminPage = await admin.newPage();
    const stamp = roleStamp();
    const description = `${AUTO_TEST_FLAG} อัลบัมดาวน์โหลด ${stamp}`;
    const title = `AUTO_ALBUM_DL ${stamp}`;
    try {
      await submitAlbum(adminPage, { title, description, images: [ALBUM_IMAGE, ALBUM_IMAGE] });
      const before = (await new AdminActivityPage(adminPage).find((c) => c.editDescription === description))?.card.downloadCount ?? 0;
      const card = (await publicActivity(browser)).albums.find((a) => a.title === title);
      expect(card, 'listed publicly').toBeDefined();
      await page.goto(card!.href);
      const images = await page.locator('.activity-grid img').evaluateAll((imgs) => imgs.map((i) => ({ loaded: (i as HTMLImageElement).naturalWidth > 0, download: (i as HTMLElement).dataset.download ?? '' })));
      expect(images.length, 'all images of the album').toBe(2);
      expect(images.every((i) => i.loaded), 'every image loads').toBe(true);
      const got = await fetchAsVisitor(browser, images[0].download);
      expect(got.status, 'the download works').toBe(200);
      expect(got.type, 'an image').toMatch(/^image\//);
      const after = (await new AdminActivityPage(adminPage).find((c) => c.editDescription === description))?.card.downloadCount ?? 0;
      note(`Download counter ${before} → ${after}`);
      expect(after, '"ดาวน์โหลด n ครั้ง" grows').toBe(before + 1);
    } finally {
      note(`Cleanup: deleted ${await deleteAlbumsWhere(adminPage, (c) => c.editDescription === description)} album(s).`);
      await admin.close();
    }
  });

  test(sheetTitle('TC-FEN-03-04'), async ({ page, browser }) => {
    requireDataCreatingTestsAllowed('Saves an album without images (deleted again at the end).');
    const admin = await browser.newContext({ storageState: ADMIN_AUTH_FILE });
    const adminPage = await admin.newPage();
    const stamp = roleStamp();
    const description = `${AUTO_TEST_FLAG} อัลบัมว่าง ${stamp}`;
    const title = `AUTO_ALBUM_EMPTY ${stamp}`;
    try {
      await submitAlbum(adminPage, { title, description, images: [] });
      const saved = await new AdminActivityPage(adminPage).find((c) => c.editDescription === description);
      test.skip(!saved, 'The app refuses an album without images — there is no empty published album to open.');
      note(KNOWN.NO_IMAGE_SAVED);
      const card = (await publicActivity(browser)).albums.find((a) => a.title === title);
      expect(card, 'listed publicly').toBeDefined();
      const response = await page.goto(card!.href);
      const text = (await page.locator('.body-content').innerText()).replace(/\s+/g, ' ');
      note(`Empty album page: ${response?.status()}; "${text.slice(0, 200)}"`);
      expect(response?.status(), 'no error').toBe(200);
      expect(text, 'a message that the album has no pictures yet').toMatch(/ยังไม่มีรูป|ไม่มีรูป|ไม่พบรูป/);
    } finally {
      note(`Cleanup: deleted ${await deleteAlbumsWhere(adminPage, (c) => c.editDescription === description)} album(s).`);
      await admin.close();
    }
  });
});
