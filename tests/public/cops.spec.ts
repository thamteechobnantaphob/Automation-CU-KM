import { test, expect, ANONYMOUS_SESSION } from '@fixtures/pages.fixtures';
import { ensureCommunity, describeSeed } from '@utils/seedContent';

/**
 * KM-FEC / SC-FEC-01, SC-FEC-02 — public communities-of-practice pages.
 * Read-only, logged out. (TC-FEC-01-04, the "unknown community" 500, lives in
 * url-handling.spec.ts next to the other malformed-URL cases.)
 *
 * Spec note: the sheet expects /frontend/cops/1/index, but community ids are
 * opaque encrypted tokens (numeric ids give 404), so URLs are matched by
 * pattern and the community is identified by its name instead.
 */
test.use({ storageState: ANONYMOUS_SESSION });

// Test data as in the sheet's workflow (admin creates it, the case checks it) — see src/utils/seedContent.ts.
let seedNote = '';
test.beforeAll(async ({ browser }) => {
  test.setTimeout(120_000);
  seedNote = describeSeed(await ensureCommunity(browser));
});
test.beforeEach(() => {
  test.info().annotations.push({ type: 'note', description: `Test data: ${seedNote}` });
});


test.describe('SC-FEC-01 รายการและรายละเอียดชุมชน', () => {
  test('TC-FEC-01-01 [High] แสดงรายการชุมชนนักปฏิบัติ', async ({ homePage, copsListPage }) => {
    // The cover uploaded with AUTO_COPS_001 (TC-ADMC-02-01) answered 404 until 2026-10-07 (DEF-48, fixed on Dev);
    // the case now checks it loads.
    await copsListPage.open();
    await expect(copsListPage.heading).toHaveText('ชุมชนนักปฏิบัติ');

    const titles = await copsListPage.titles();
    expect(titles.length, 'at least one community is listed').toBeGreaterThan(0);
    for (const title of titles) expect(title).not.toBe('');

    // Each card: "n บทความ/ข่าว" and a picture (a placeholder when none uploaded).
    for (const text of await copsListPage.articleCounts.allInnerTexts()) {
      expect(text.trim()).toMatch(/^\d+ บทความ\/ข่าว$/);
    }
    for (const image of await copsListPage.cardImages.all()) {
      await expect.poll(() => image.evaluate((el: HTMLImageElement) => el.complete && el.naturalWidth > 0)).toBe(true);
    }

    // The sheet compares with the published count in admin; the home page's
    // own "n กลุ่มชุมชน CoPs" statistic is the public-side source of that number.
    await homePage.open();
    expect(titles.length, 'card count equals the "กลุ่มชุมชน CoPs" statistic on the home page').toBe(
      await homePage.copsStatCount(),
    );
  });

  test('TC-FEC-01-02 [High] เปิดหน้ารายละเอียดชุมชน', async ({ page, copsListPage }) => {
    await copsListPage.open();
    const name = (await copsListPage.cardTitles.first().innerText()).trim();

    await copsListPage.cards.first().click();
    await expect(page).toHaveURL(/\/frontend\/cops\/.+\/index$/);
    await expect(page).toHaveTitle(name);
    await expect(copsListPage.heading).toHaveText(name);

    // Either the community's articles/news or an empty-state message.
    const articles = await copsListPage.cards.count();
    const emptyState = await page.locator('.body-content').getByText(/ยังไม่มี/).count();
    expect(articles + emptyState, 'community page lists articles or shows an empty state').toBeGreaterThan(0);

    await copsListPage.backToListLink.click();
    await expect(page).toHaveURL(/\/frontend\/cops\/index$/);
  });
});

test.describe('SC-FEC-02 การแสดงผลเพิ่มเติมของชุมชน (Public)', () => {
  test('TC-FEC-02-01 [Low] ลำดับการแสดงชุมชนสม่ำเสมอ', async ({ copsListPage }) => {
    // The sheet leaves the ordering rule TBD, so this checks the property
    // that matters regardless of the rule: the order never changes between visits.
    await copsListPage.open();
    const first = await copsListPage.titles();
    expect(first.length).toBeGreaterThan(0);

    for (let visit = 2; visit <= 3; visit++) {
      await copsListPage.open();
      expect(await copsListPage.titles(), `order on visit ${visit}`).toEqual(first);
    }
  });
});
