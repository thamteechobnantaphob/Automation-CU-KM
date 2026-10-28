import { test, expect, ANONYMOUS_SESSION } from '@fixtures/pages.fixtures';
import { ensureCommunity, describeSeed } from '@utils/seedContent';

/**
 * KM-FEH / SC-FEH-02 — content sections of the home page. Read-only, logged out.
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


test.describe('SC-FEH-02 ส่วนเนื้อหาในหน้าหลัก', () => {
  test('TC-FEH-02-01 [Medium] Carousel ชุมชนนักปฏิบัติ (CoPs)', async ({ page, homePage, copsListPage }) => {
    await homePage.open();
    await expect(homePage.copsHeading).toBeVisible();

    // Real slides only: Owl's loop clones (.owl-item.cloned) are excluded by
    // homePage.copsSlides, so the sheet's "6 cards for 2 communities" note is
    // not a data problem.
    const titles = await homePage.copsSlideTitles();
    expect(titles.length, 'carousel shows at least one community').toBeGreaterThan(0);
    expect(new Set(titles).size, `a community appears twice: ${titles.join(' | ')}`).toBe(titles.length);
    expect(titles.length, 'matches the "กลุ่มชุมชน CoPs" statistic beside it').toBe(await homePage.copsStatCount());

    await copsListPage.open();
    expect([...titles].sort(), 'same communities as /frontend/cops/index').toEqual([...(await copsListPage.titles())].sort());

    // Next / Previous. On a desktop viewport with only two communities Owl
    // disables its navigation (`.owl-nav.disabled`), so there is nothing to
    // click — recorded as a note instead of failing on an untestable step.
    await homePage.open();
    if (await homePage.copsNext.isVisible()) {
      const stage = homePage.copsCarousel.locator('.owl-stage');
      const before = await stage.evaluate((el) => (el as HTMLElement).style.transform);
      await homePage.copsNext.click();
      await expect.poll(() => stage.evaluate((el) => (el as HTMLElement).style.transform)).not.toBe(before);
      await homePage.copsPrev.click();
    } else {
      test.info().annotations.push({
        type: 'note',
        description: 'Next/Previous buttons are not displayed (owl-nav disabled), so the slide-by-button step was not checked.',
      });
    }

    // Clicking a card opens that community's page.
    const card = homePage.copsSlides.first();
    const name = (await card.locator('.item-title').innerText()).trim();
    await card.click();
    await expect(page).toHaveURL(/\/frontend\/cops\/.+\/index$/);
    await expect(page).toHaveTitle(name);
  });

  test('TC-FEH-02-04 [Low] Empty state เมื่อไม่มีเนื้อหา', async ({ homePage, copsListPage, knowledgeListPage }) => {
    // Precondition from the sheet — no community news/articles and no
    // published knowledge — is read off the public pages themselves.
    await knowledgeListPage.open();
    const hasKnowledge = (await knowledgeListPage.cards.count()) > 0;
    await copsListPage.open();
    const hasCopsArticles = (await copsListPage.articleCounts.allInnerTexts()).some((text) => !/^\s*0\s/.test(text));
    test.skip(hasKnowledge || hasCopsArticles, 'Precondition not met: the site already has published articles.');

    await homePage.open();
    await expect(homePage.copsArticlesEmptyState).toBeVisible();
    await expect(homePage.latestKnowledgeEmptyState).toBeVisible();
    expect(await homePage.hasHorizontalScroll(), 'empty sections do not break the layout').toBe(false);
  });
});
