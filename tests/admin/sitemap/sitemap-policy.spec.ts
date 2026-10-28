import { test, expect, ANONYMOUS_SESSION } from '@fixtures/pages.fixtures';
import { requireDataCreatingTestsAllowed } from '@config/env';
import { AdminSitemapPage, PUBLIC_SITEMAP_PATH } from '@pages/admin/AdminSitemapPage';
import { sheetTitle } from '@utils/caseTitles';
import { urlOf } from '@utils/lowPrivilege';
import { roleStamp } from '@utils/roleFlows';
import { AUTO_TEST_FLAG } from '@utils/testData';
import { Page } from '@playwright/test';

/**
 * KM-ADMS — the sitemap cases left after the Auto:Y round (checked 2026-10-07). /admin/sitemap is ONE content page
 * (TinyMCE body + cover) edited at /admin/sitemap/detail; it has no list of entries, so adding / deleting an entry and
 * the entry field "คำอธิบายรายการแผนผัง" (with its {MAX}) do not exist — spec mismatch DEF-111. TC-ADMS-01-03 saves
 * the body and puts back the body it found (from a second tab), like tests/admin/sitemap/sitemap.spec.ts.
 */

const NO_ENTRIES = 'Spec mismatch (DEF-111): the sitemap admin is one content page (body + cover) — there is no list of entries to add, edit or delete, and no field "คำอธิบายรายการแผนผัง".';

test.beforeEach(() => test.setTimeout(120_000));

function note(description: string): void {
  test.info().annotations.push({ type: 'note', description });
}

/** The entry cases: the page must offer an entry list with an add button (it does not). */
async function entryCase(page: Page): Promise<void> {
  test.fail(true, NO_ENTRIES);
  const sitemap = new AdminSitemapPage(page);
  expect((await sitemap.open())?.status()).toBe(200);
  const rows = await page.locator('.body-content table tbody tr, .body-content [data-sitemap-id]').count();
  note(`Add buttons: ${await sitemap.addButton.count()}; entry rows: ${rows}`);
  expect(await sitemap.addButton.count(), 'an "add entry" button').toBeGreaterThan(0);
}

test.describe('SC-ADMS แผนผังเว็บไซต์ (Auto:P)', () => {
  test(sheetTitle('TC-ADMS-01-02'), ({ page }) => entryCase(page));
  test(sheetTitle('TC-ADMS-02-02'), ({ page }) => entryCase(page));
  test(sheetTitle('TC-ADMS-02-03'), ({ page }) => entryCase(page));
  test(sheetTitle('TC-ADMS-02-06'), ({ page }) => entryCase(page));

  test(sheetTitle('TC-ADMS-01-03'), async ({ page, browser }) => {
    requireDataCreatingTestsAllowed('Saves the sitemap body (the body found before is saved back at the end).');
    const sitemap = new AdminSitemapPage(page);
    await sitemap.openEditor();
    const original = await sitemap.editorContent();
    const marker = `${AUTO_TEST_FLAG} แผนผังทดสอบ ${roleStamp()}`;
    try {
      await sitemap.setEditorContent(`${original}<p>${marker}</p>`);
      expect((await sitemap.save()).status(), 'saved').toBeLessThan(400);
      const context = await browser.newContext({ storageState: ANONYMOUS_SESSION });
      try {
        const visitor = await context.newPage();
        expect((await visitor.goto(urlOf(PUBLIC_SITEMAP_PATH)))?.status()).toBe(200);
        const text = (await visitor.locator('body').innerText()).replace(/\s+/g, ' ');
        expect(text, 'the public sitemap shows what was saved in the admin').toContain(marker);
      } finally {
        await context.close();
      }
    } finally {
      const tab = await page.context().newPage();
      try {
        const restorer = new AdminSitemapPage(tab);
        await restorer.openEditor();
        await restorer.setEditorContent(original);
        await restorer.save();
        await restorer.openEditor();
        note((await restorer.editorContent()) === original ? 'Body restored.' : 'Body NOT restored — check /admin/sitemap.');
      } finally {
        await tab.close();
      }
    }
  });
});
