import { test, expect, ANONYMOUS_SESSION } from '@fixtures/pages.fixtures';
import { THAI_SHORT_DATE } from '@utils/publicPages';
import { ensureNews, describeSeed } from '@utils/seedContent';

/**
 * KM-FEK (knowledge / best practice) and KM-FEN (news / activity) — the public
 * list pages. Read-only, logged out.
 *
 * These pages show whatever is published, so each case checks the page for
 * the state it is actually in: empty state when nothing is published, cards
 * when something is. A case whose precondition is gone is skipped, not failed.
 * Detail-page cases (TC-FEK-03-*, TC-FEN-03-06) need published articles /
 * albums, which Dev does not have yet — they stay pending.
 */
test.use({ storageState: ANONYMOUS_SESSION });

// Test data as in the sheet's workflow (admin creates it, the case checks it) — see src/utils/seedContent.ts.
let seedNote = '';
test.beforeAll(async ({ browser }) => {
  test.setTimeout(120_000);
  seedNote = describeSeed(await ensureNews(browser));
});
test.beforeEach(() => {
  test.info().annotations.push({ type: 'note', description: `Test data: ${seedNote}` });
});


test.describe('SC-FEK-01 องค์ความรู้ทั่วไป (Knowledge)', () => {
  test('TC-FEK-01-01 [Low] Empty state เมื่อไม่มีบทความเผยแพร่', async ({ knowledgeListPage }) => {
    await knowledgeListPage.open();
    await expect(knowledgeListPage.heading).toHaveText('คลังความรู้');

    test.skip((await knowledgeListPage.cards.count()) > 0, 'Precondition not met: articles are published.');
    await expect(knowledgeListPage.emptyState).toHaveText('ยังไม่มีบทความ/คลังความรู้ที่เผยแพร่');
  });
});

test.describe('SC-FEK-02 แนวปฏิบัติที่ดี (Best Practice)', () => {
  test('TC-FEK-02-01 [Medium] แสดงรายการและ Empty state', async ({ bestPracticeListPage }) => {
    await bestPracticeListPage.open();
    // The heading really is spelled "ปฎิบัติ" (ฎ) in the app.
    await expect(bestPracticeListPage.heading).toHaveText('แนวปฎิบัติที่ดี (Best Practice)');

    if ((await bestPracticeListPage.cards.count()) === 0) {
      await expect(bestPracticeListPage.emptyState).toHaveText('ยังไม่มีแนวทางปฏิบัติที่ดีที่เผยแพร่');
    } else {
      // Not exercised yet (Dev has none published when this was written).
      for (const title of await bestPracticeListPage.titles()) expect(title).not.toBe('');
    }
  });
});

test.describe('SC-FEN-01 ข่าวสาร KM', () => {
  test('TC-FEN-01-01 [High] แสดงข่าวที่เผยแพร่', async ({ newsListPage }) => {
    await newsListPage.open();
    await expect(newsListPage.heading).toHaveText('ข่าวสาร KM');

    // Whether unpublished news is hidden needs the admin list to compare
    // with; this checks what a visitor sees for every published item.
    const total = await newsListPage.cards.count();
    test.skip(total === 0, 'Precondition not met: no news is published.');

    for (let index = 0; index < total; index++) {
      const card = newsListPage.cards.nth(index);
      await expect(card.locator('.card-title'), `news #${index + 1} title`).not.toHaveText('');
      await expect(card.locator('.text-small'), `news #${index + 1} date`).not.toHaveText('');
      await expect(card.locator('.card-text'), `news #${index + 1} summary`).not.toHaveText('');
    }
  });
});

test.describe('SC-FEN-02 คลังกิจกรรม', () => {
  test('TC-FEN-02-01 [Medium] แสดงอัลบั้มกิจกรรม / Empty state', async ({ activityListPage }) => {
    await activityListPage.open();
    await expect(activityListPage.heading).toHaveText('คลังกิจกรรม');

    const total = await activityListPage.albumTotalCount();
    if (total === 0) {
      await expect(activityListPage.emptyState).toHaveText('ยังไม่มีอัลบัมกิจกรรม');
    } else {
      // Not exercised yet (Dev has no albums when this was written): the
      // "ทั้งหมด n อัลบัม" label should match the albums shown.
      await expect(activityListPage.cards).toHaveCount(total);
    }
  });
});

test.describe('SC-FEN-03 รายละเอียดข่าวและอัลบัม (Public)', () => {
  test('TC-FEN-03-03 [Low] วันที่ข่าวแสดงเป็นรูปแบบไทยที่ถูกต้อง', async ({ newsListPage }) => {
    // KNOWN BUG — noted in the sheet on 2026-09-21 ("18 ก.ย.. 26"), still
    // there on 2026-09-25 ("23 ก.ย.. 26"): the month abbreviation gets a
    // second dot and the year is cut to two digits, instead of "23 ก.ย. 2569".
    // (The search page uses yet another format, "10 มิ.ย 69".)
    test.fail(true, 'Known bug: news date renders "23 ก.ย.. 26" (double dot, 2-digit year) instead of "23 ก.ย. 2569".');

    await newsListPage.open();
    const dates = await newsListPage.dates.allInnerTexts();
    test.skip(dates.length === 0, 'Precondition not met: no news is published.');

    for (const date of dates) expect(date.trim()).toMatch(THAI_SHORT_DATE);
  });
});
