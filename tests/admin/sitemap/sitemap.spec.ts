import { test, expect, ANONYMOUS_SESSION } from '@fixtures/pages.fixtures';
import { requireDataCreatingTestsAllowed } from '@config/env';
import {
  AdminSitemapPage,
  PUBLIC_SITEMAP_PATH,
  SITEMAP_DETAIL_PATH,
  SITEMAP_EMPTY_TEXT,
} from '@pages/admin/AdminSitemapPage';
import { csrfTokenOf, urlOf } from '@utils/lowPrivilege';
import { collectDialogs } from '@utils/security';
import { Browser, Page } from '@playwright/test';

/**
 * KM-ADMS — /admin/sitemap/index. Recon 2026-09-29: the page is ONE content
 * block (TinyMCE body + optional cover image) edited at /admin/sitemap/detail,
 * not the list of entries with an add button the sheet describes. The sheet's
 * field "คำอธิบายรายการแผนผัง" is therefore mapped to the only text field there
 * is: the body ("เนื้อหาแผนผังเว็บไซต์").
 *
 * TC-ADMS-01-01 only reads. The SC-ADMS-02 cases overwrite the real sitemap
 * body, so they need ALLOW_DATA_CREATING_TESTS=true, and each one puts the body
 * it found back when it ends (pass or fail) from a second tab, so the end-of-test
 * screenshot still shows what the case saved. The cover image is never touched.
 *
 * NOT implemented (the body has no maxlength and the sheet's {MAX} is
 * undefined): TC-ADMS-02-02/03 — see tests/pending/km-adms.pending.spec.ts.
 */

const REASON = 'Saving overwrites the real sitemap body (restored at the end of the case).';
const THAI_TEXT = 'ระบบจัดการความรู้ทดสอบ';
const HTML_PAYLOAD = '<b>bold</b><script>alert(1)</script>';
/** Sent straight to the server (no editor in between): a sanitiser must drop the script and the handler. */
const RAW_PAYLOAD = '<p><b>bold</b></p><script>alert(1)</script><img src=x onerror=alert(2)>';
/** The items the sheet expects on the page (TC-ADMS-01-01) — only reported, the design has changed. */
const SHEET_ITEMS = ['หน้าหลัก', 'ชุมชนนักปฏิบัติ', 'คลังความรู้'];

function note(description: string): void {
  test.info().annotations.push({ type: 'note', description });
}

async function attachShot(page: Page, name: string): Promise<void> {
  await test.info().attach(name, { body: await page.screenshot({ fullPage: true }), contentType: 'image/png' });
}

/**
 * Runs `body` and afterwards saves the sitemap body that was there before, from
 * a second tab of the same (admin) session. Reports when putting it back failed.
 */
async function restoringBody(page: Page, body: (original: string) => Promise<void>): Promise<void> {
  const sitemapPage = new AdminSitemapPage(page);
  await sitemapPage.openEditor();
  const original = await sitemapPage.editorContent();
  note(`Body before the case: ${original ? JSON.stringify(original.slice(0, 200)) : '(empty)'}`);
  try {
    await body(original);
  } finally {
    const tab = await page.context().newPage();
    try {
      const restorer = new AdminSitemapPage(tab);
      await restorer.openEditor();
      await restorer.setEditorContent(original);
      const response = await restorer.save();
      await restorer.openEditor();
      const now = await restorer.editorContent();
      note(
        now === original
          ? `Body restored (HTTP ${response.status()}).`
          : `Body NOT restored (HTTP ${response.status()}); it is now ${JSON.stringify(now.slice(0, 200))}.`,
      );
    } catch (error) {
      note(`Restoring the body failed: ${(error as Error).message}`);
    } finally {
      await tab.close();
    }
  }
}

/** Types `text` into the editor, saves, and returns the POST status; then opens the index. */
async function typeAndSave(sitemapPage: AdminSitemapPage, text: string): Promise<number> {
  await sitemapPage.openEditor();
  await sitemapPage.typeBody(text);
  const response = await sitemapPage.save();
  await sitemapPage.open();
  return response.status();
}

interface PublicView {
  status: number;
  text: string;
  dialogs: string[];
  activeMarkup: number;
}

/** The public sitemap page as a visitor sees it (logged out), plus any dialog and any script/handler in the page. */
async function publicView(browser: Browser): Promise<PublicView> {
  const context = await browser.newContext({ storageState: ANONYMOUS_SESSION });
  try {
    const page = await context.newPage();
    const dialogs = collectDialogs(page);
    const response = await page.goto(urlOf(PUBLIC_SITEMAP_PATH));
    await page.waitForLoadState('load');
    await page.waitForTimeout(500);
    const text = (await page.locator('body').innerText()).replace(/\s+/g, ' ');
    const activeMarkup = await page.locator('script:has-text("alert("), [onerror*="alert"]').count();
    await attachShot(page, 'public');
    return { status: response?.status() ?? 0, text, dialogs, activeMarkup };
  } finally {
    await context.close();
  }
}

/** Where the saved text must show: the index, the editor when reopened, and the public page. */
async function expectShownEverywhere(page: Page, browser: Browser, sitemapPage: AdminSitemapPage, text: string): Promise<void> {
  await expect(sitemapPage.bodyView, 'the index shows the saved text').toContainText(text);
  await attachShot(page, 'admin-index');
  await sitemapPage.openEditor();
  await expect(sitemapPage.editorBody, 'the editor shows the saved text when reopened').toContainText(text);
  await sitemapPage.open();

  const pub = await publicView(browser);
  expect.soft(pub.status, `the public sitemap page (${PUBLIC_SITEMAP_PATH}) must open`).toBe(200);
  expect.soft(pub.text, 'the public sitemap page shows the saved text').toContain(text);
}

test.describe('SC-ADMS-01 แผนผังเว็บไซต์', () => {
  test('TC-ADMS-01-01 [Medium] [Positive] แสดงรายการแผนผังเว็บไซต์', async ({ page }) => {
    const sitemapPage = new AdminSitemapPage(page);
    const response = await sitemapPage.open();
    expect(response?.status()).toBe(200);

    await expect(sitemapPage.pageHeading).toHaveText('จัดการแผนผังเว็บไซต์');
    await expect(sitemapPage.sectionHeading).toHaveText('แผนผังเว็บไซต์');
    await expect(sitemapPage.coverImage).toBeVisible();
    await expect(sitemapPage.bodyView).toBeVisible();
    const shown = await sitemapPage.shownText();
    expect(shown, 'the body area shows either the saved content or the empty-state hint').not.toBe('');

    const found = SHEET_ITEMS.filter((item) => shown.includes(item));
    note(`Body shown: ${shown.includes(SITEMAP_EMPTY_TEXT) ? '(empty-state hint)' : JSON.stringify(shown.slice(0, 200))}`);
    note(`Sheet items present: ${found.length ? found.join(', ') : 'none'}. Add buttons on the page: ${await sitemapPage.addButton.count()} (the sheet expects one; the page is edit-only).`);

    await expect(sitemapPage.editLink).toHaveAttribute('href', urlOf(SITEMAP_DETAIL_PATH));
    await sitemapPage.editLink.click();
    await expect(page).toHaveURL(urlOf(SITEMAP_DETAIL_PATH));
    await expect(sitemapPage.editorBody, 'the rich-text body editor').toBeVisible();
    await expect(sitemapPage.coverInput).toBeAttached();
    await expect(sitemapPage.saveButton).toBeVisible();
    await expect(sitemapPage.cancelLink).toHaveAttribute('href', urlOf('/admin/sitemap/index'));
  });
});

test.describe('SC-ADMS-02 แผนผังเว็บไซต์: ตรวจข้อมูล', () => {
  test.beforeEach(() => {
    requireDataCreatingTestsAllowed(REASON);
  });

  test('TC-ADMS-02-01 [High] [Positive] คำอธิบายรายการแผนผัง: ข้อความภาษาไทยปกติ', async ({ page, browser }) => {
    const sitemapPage = new AdminSitemapPage(page);
    await restoringBody(page, async () => {
      const status = await typeAndSave(sitemapPage, THAI_TEXT);
      expect(status, 'the save must not fail').toBeLessThan(400);
      await expectShownEverywhere(page, browser, sitemapPage, THAI_TEXT);
    });
  });

  test('TC-ADMS-02-04 [High] [Negative] คำอธิบายรายการแผนผัง: แท็ก HTML และสคริปต์', async ({ page, browser }) => {
    // KNOWN BUG (2026-10-02): typed text stays literal, but a body posted straight to PUT /admin/sitemap is stored and
    // rendered unsanitised — <script> and onerror run on the admin index AND on /frontend/sitemap/index.
    test.fail(true, 'Known bug (DEF-46): stored XSS — the sitemap body is rendered unsanitised; a posted <script>/onerror runs on the admin index and the public sitemap page.');
    const sitemapPage = new AdminSitemapPage(page);
    const dialogs = collectDialogs(page);
    await restoringBody(page, async () => {
      await test.step('typed into the editor: stays literal text', async () => {
        const status = await typeAndSave(sitemapPage, HTML_PAYLOAD);
        expect(status, 'the save must not fail').toBeLessThan(500);
        await page.waitForTimeout(500);
        expect(await sitemapPage.bodyView.locator('script, b').count(), 'typed tags must not become markup').toBe(0);
        await expectShownEverywhere(page, browser, sitemapPage, HTML_PAYLOAD);
      });

      await test.step('posted straight to the server: no script runs (admin + public)', async () => {
        await sitemapPage.openEditor();
        const token = await csrfTokenOf(page);
        const response = await page.request.post(urlOf('/admin/sitemap'), {
          multipart: { _token: token, _method: 'PUT', body: RAW_PAYLOAD, remove_cover_image: '0' },
          maxRedirects: 0,
        });
        note(`Raw POST -> HTTP ${response.status()}`);
        expect(response.status(), 'the raw post must not cause a server error').toBeLessThan(500);

        await sitemapPage.open();
        await page.waitForLoadState('load');
        await page.waitForTimeout(500);
        const stored = await sitemapPage.bodyView.innerHTML();
        note(`Index renders the raw post as: ${JSON.stringify(stored.trim().slice(0, 300))}`);
        await attachShot(page, 'admin-raw');
        expect.soft(dialogs, 'no alert on the admin index').toEqual([]);
        expect.soft(await sitemapPage.bodyView.locator('script, [onerror]').count(), 'no <script> / onerror left in the admin index').toBe(0);

        const pub = await publicView(browser);
        note(`Public page after the raw post: HTTP ${pub.status}`);
        expect.soft(pub.dialogs, 'no alert on the public sitemap page').toEqual([]);
        expect.soft(pub.activeMarkup, 'no <script> / onerror with alert() on the public sitemap page').toBe(0);
      });
    });
  });

  test('TC-ADMS-02-05 [High] [Negative] คำอธิบายรายการแผนผัง: เว้นว่าง', async ({ page }) => {
    // KNOWN BUG (2026-10-02): saving an empty body is accepted and wipes the content (back to "ยังไม่มีข้อมูล").
    test.fail(true, 'Known bug (DEF-47): a blank sitemap body is saved without any validation and replaces the existing content.');
    const sitemapPage = new AdminSitemapPage(page);
    await restoringBody(page, async () => {
      // Needs a saved body first, otherwise "blank was not saved" cannot be told apart from "blank was saved".
      expect(await typeAndSave(sitemapPage, THAI_TEXT), 'setting up a non-empty body').toBeLessThan(400);
      await expect(sitemapPage.bodyView).toContainText(THAI_TEXT);

      await sitemapPage.openEditor();
      await sitemapPage.clearBody();
      expect(await sitemapPage.editorContent(), 'the editor is empty before saving').toBe('');
      const response = await sitemapPage.save();
      expect(response.status(), 'a blank body must not cause a server error').toBeLessThan(500);
      const landedOn = page.url();
      const errors = await sitemapPage.fieldErrors.allInnerTexts();
      await attachShot(page, 'after-blank-save');
      note(`After saving blank: HTTP ${response.status()}, landed on ${landedOn}, messages: ${JSON.stringify(errors)}`);

      await sitemapPage.open();
      await expect(sitemapPage.bodyView, 'the blank body must not be saved: the previous text stays').toContainText(THAI_TEXT);
      expect(
        errors.length > 0 || landedOn.includes(SITEMAP_DETAIL_PATH),
        'the admin is told the body is required (message shown / kept on the form)',
      ).toBe(true);
    });
  });
});
