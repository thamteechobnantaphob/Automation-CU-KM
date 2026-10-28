import { test, expect } from '@fixtures/pages.fixtures';
import { requireDataCreatingTestsAllowed } from '@config/env';
import { AdminNewsListPage, ContentModule, NewsFormPage } from '@pages/admin/AdminNewsPages';
import { urlOf } from '@utils/lowPrivilege';
import { contentMarker, deleteNewsByExcerpt, publicNewsDetail } from '@utils/newsFlows';
import { roleStamp } from '@utils/roleFlows';
import { Page } from '@playwright/test';

/**
 * The form cases the sheet repeats for the news and best-practice forms (KM-FNEW / KM-FBPR: same case numbers):
 * sections and defaults, word count, cancel/back, no leftovers after saving, Tab order at 375px, empty title, the
 * field set compared with the knowledge form, empty schedule date, javascript:/non-URL links.
 * Only the title is `required`; the schedule input is not; video URL is a textarea, reference URL a text input.
 */
export interface ContentFormSuite {
  module: ContentModule;
  /** Case prefix: "FNEW" → TC-FNEW-01-01. */
  prefix: string;
  /** "ข่าวกิจกรรม KM", "แนวทางปฏิบัติที่ดี" — as in "← กลับไปที่รายการ<name>". */
  name: string;
  /** The sheet's sample title: "AUTO_FNEW_001". */
  sampleTitle: string;
}

/** The sheet's field list (02-01); "tag-input" is the tag box's id, every other entry a field name. */
const SHEET_FIELDS = ['title', 'excerpt', 'category_id', 'tag-input', 'body', 'documents[]', 'video_file[]', 'video_url', 'source', 'author_name', 'reference_date', 'reference_url', 'status_ui', 'publish_timing_ui', 'published_at', 'cover_image'];

function note(description: string): void {
  test.info().annotations.push({ type: 'note', description });
}

async function fieldNames(page: Page): Promise<string[]> {
  return page.locator('#content-module-form').locator('input[name], select[name], textarea[name]').evaluateAll((els) =>
    [...new Set(els.map((el) => (el as HTMLInputElement).name).filter((name) => name !== '_token' && name !== '_method'))].sort(),
  );
}

export function contentFormSuite(cfg: ContentFormSuite): void {
  const { module: M, prefix: P, name, sampleTitle } = cfg;
  const id = (n: string): string => `TC-${P}-${n}`;
  const list = (page: Page): AdminNewsListPage => new AdminNewsListPage(page, M);
  const form = (page: Page): NewsFormPage => new NewsFormPage(page, M);
  const indexUrl = urlOf(`/admin/${M.key}/index`);

  test.beforeEach(() => test.setTimeout(90_000));

  test.describe(`SC-${P}-01 ฟอร์ม${name}`, () => {
    test(`${id('01-01')} [High] [Positive] เปิดฟอร์ม: ส่วนและค่าเริ่มต้นครบตามที่ออกแบบ`, async ({ page }) => {
      const f = form(page);
      await f.openCreate();
      const text = (await page.locator('.body-content').innerText()).replace(/\s+/g, ' ');
      for (const label of ['ชื่อหัวเรื่อง', 'รายละเอียดแบบย่อ', 'หมวดหมู่', 'แท็ก', 'เนื้อหาบทความ', 'อัปโหลดไฟล์', 'วิดีโอประกอบ', 'ข้อมูลอ้างอิง', 'แหล่งที่มา', 'ชื่อผู้แต่ง', 'วันที่', 'ลิงค์อ้างอิงภายนอก', 'สถานะ', 'เผยแพร่เมื่อ', 'รูปภาพหน้าปกบทความ']) {
        expect.soft(text, `section "${label}"`).toContain(label);
      }
      await expect(f.titleInput, 'ชื่อหัวเรื่อง is required').toHaveAttribute('required', '');
      // The sheet (21/09) saw "— ไม่ระบุ —" as the default; since 2026-10-02 the picker shows the placeholder "เลือกหมวดหมู่"
      // with an empty value and "— ไม่ระบุ —" is an option — same outcome (no category), label differs: DEF-57 (spec mismatch).
      expect(await f.categoryValue(), 'หมวดหมู่ default = no category').toBe('');
      expect(await f.categoryOptions(), '"— ไม่ระบุ —" is offered').toContain('— ไม่ระบุ —');
      note(`Category picker shows: "${await f.selectedCategory()}"`);
      await expect(f.wordCount, 'the editor shows "0 words"').toContainText('0 words');
      await expect(f.cancelLink).toBeVisible();
      await expect(f.saveButton).toBeVisible();
      await expect(f.statusRadio('publish'), 'สถานะ default = เผยแพร่').toBeChecked();
      await expect(page.locator('#publish-timing-now'), 'เผยแพร่เมื่อ default = ทันที').toBeChecked();
      expect(await f.tagTexts(), 'no tags').toEqual([]);
      expect(await page.locator('#document-upload').evaluate((el: HTMLInputElement) => el.files?.length ?? 0), 'no files').toBe(0);
      expect(await page.locator('#cover-image-upload').evaluate((el: HTMLInputElement) => el.files?.length ?? 0), 'no cover').toBe(0);
      await expect(f.titleInput).toHaveValue('');
      await expect(f.excerptInput).toHaveValue('');
    });

    test(`${id('01-03')} [Low] [Positive] ตัวนับคำ 'words' อัปเดตตามการพิมพ์ (ไทย/อังกฤษ)`, async ({ page }) => {
      const f = form(page);
      await f.openCreate();
      const count = async (): Promise<string> => ((await f.wordCount.innerText()).match(/(\S+)\s+words?/) ?? [])[1] ?? '';
      expect(await count()).toBe('0');
      await page.frameLocator('.tox-edit-area iframe').locator('body').click();
      await page.keyboard.type('This is a test');
      await expect.poll(count, { message: 'English words are counted' }).toBe('4');
      await page.keyboard.type(' ทดสอบระบบจัดการความรู้');
      await expect.poll(async () => Number(await count()), { message: 'Thai text raises the count' }).toBeGreaterThan(4);
      const final = await count();
      note(`After both phrases: "${final} words" (TinyMCE counts a Thai run without spaces as one word).`);
      expect(final, 'a number, not NaN').toMatch(/^\d+$/);
    });

    test(`${id('01-04')} [High] [Positive] ปุ่ม 'ยกเลิก' กลับหน้ารายการโดยไม่บันทึก`, async ({ page }) => {
      const l = list(page);
      const f = form(page);
      const before = await l.total();
      await f.openCreate();
      await f.fill({ title: `[Auto Test] ไม่ควรถูกบันทึก ${roleStamp()}`, body: '<p>เนื้อหาทดสอบ</p>' });
      const dialogs: string[] = [];
      page.on('dialog', async (dialog) => {
        dialogs.push(dialog.message());
        await dialog.accept();
      });
      await f.cancelLink.click();
      await expect(page).toHaveURL(indexUrl);
      note(dialogs.length ? `Warning shown: ${dialogs.join(' | ')}` : 'No unsaved-changes warning (sheet: TBD).');
      expect(await l.total(), 'nothing was saved').toBe(before);
    });

    test(`${id('01-05')} [Medium] [Positive] ลิงก์ '← กลับไปที่รายการ' ทำงาน`, async ({ page }) => {
      const f = form(page);
      await f.openCreate();
      await expect(f.backLink).toContainText(`← ${M.backLink}`);
      await f.backLink.click();
      await expect(page).toHaveURL(indexUrl);
      await expect(list(page).listHeading).toBeVisible();
    });

    test(`${id('01-06')} [Medium] [Negative] เปิดฟอร์มใหม่หลังบันทึกแล้วต้องไม่มีข้อมูลค้าง`, async ({ page }) => {
      requireDataCreatingTestsAllowed(`Saves ${sampleTitle} (deleted again at the end).`);
      const f = form(page);
      const excerpt = contentMarker();
      try {
        await f.openCreate();
        await f.fill({ title: sampleTitle, excerpt, tags: ['autotest1'], body: '<p>เนื้อหาทดสอบ</p>', status: 'draft' });
        expect((await f.save()).final).toBeLessThan(500);
        expect(await list(page).findByExcerpt(excerpt), 'saved').toBeDefined();
        await f.openCreate();
        await expect(f.titleInput).toHaveValue('');
        await expect(f.excerptInput).toHaveValue('');
        expect(await f.tagTexts(), 'no tag left over').toEqual([]);
        expect((await f.bodyText()).trim(), 'empty editor').toBe('');
        expect(await f.categoryValue(), 'no category left over').toBe('');
        await expect(f.statusRadio('publish'), 'status back to its default').toBeChecked();
        expect(await page.locator('#document-upload').evaluate((el: HTMLInputElement) => el.files?.length ?? 0)).toBe(0);
        expect(await page.locator('#cover-image-upload').evaluate((el: HTMLInputElement) => el.files?.length ?? 0)).toBe(0);
      } finally {
        note(`Cleanup: deleted ${await deleteNewsByExcerpt(page, excerpt, M)} item(s).`);
      }
    });

    test(`${id('01-07')} [Low] [Positive] ลำดับการกด Tab และการใช้งานบนมือถือ 375px`, async ({ page }) => {
      // KNOWN BUG (2026-10-02): at 375px Tab from the tag box enters TinyMCE's menubar/toolbar/status bar and cycles
      // there (Edit → Undo → … → 0 words → resize → Edit …); it never reaches the content or the fields below. Desktop is fine.
      test.fail(true, 'Known bug (DEF-56): at 375px keyboard focus is trapped in the TinyMCE menubar/toolbar/status bar.');
      await page.setViewportSize({ width: 375, height: 812 });
      const f = form(page);
      await f.openCreate();
      const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
      note(`Horizontal overflow at 375px: ${overflow}px`);
      expect(overflow, 'the form fits 375px (no horizontal scroll)').toBeLessThanOrEqual(1);
      await f.titleInput.focus();
      const visited: string[] = [];
      for (let i = 0; i < 120; i++) {
        const focused = await page.evaluate(() => {
          const el = document.activeElement as HTMLElement | null;
          if (!el) return '';
          if (el.tagName === 'IFRAME') return 'editor';
          return (el.getAttribute('name') || el.id || el.textContent || el.tagName).trim().slice(0, 40);
        });
        if (visited[visited.length - 1] !== focused) visited.push(focused);
        if (focused === 'บันทึก') break;
        await page.keyboard.press('Tab');
      }
      note(`Tab order: ${visited.slice(0, 14).join(' → ')}${visited.length > 14 ? ' → … (cycles)' : ''}`);
      expect(visited[visited.length - 1], 'Tab reaches "บันทึก" (focus is not trapped, e.g. in the editor)').toBe('บันทึก');
      const order = ['title', 'excerpt', 'tag-input', 'editor', 'source', 'บันทึก'].map((key) => visited.indexOf(key));
      expect(order.filter((position) => position >= 0), 'the key fields come in the order they are shown').toEqual([...order.filter((position) => position >= 0)].sort((a, b) => a - b));
    });

    test(`${id('01-08')} [High] [Negative] ช่องหัวเรื่องว่างต้องบันทึกไม่ได้`, async ({ page }) => {
      const l = list(page);
      const f = form(page);
      const before = await l.total();
      await f.openCreate();
      await expect(f.titleInput).toHaveAttribute('required', '');
      await f.fill({ excerpt: contentMarker(), body: '<p>เนื้อหาทดสอบ</p>', source: 'แหล่งที่มาทดสอบ', authorName: 'ผู้แต่งทดสอบ' });
      const requests: string[] = [];
      page.on('request', (request) => request.method() === 'POST' && requests.push(request.url()));
      await f.saveButton.click();
      await page.waitForTimeout(500);
      const message = await f.titleInput.evaluate((el: HTMLInputElement) => el.validationMessage);
      note(`Browser message: "${message}"`);
      expect(message, 'the browser blocks the empty title').not.toBe('');
      expect(requests, 'the form is not sent').toEqual([]);
      await expect(page).toHaveURL(new RegExp(`/admin/${M.key}/create$`));
      expect(await l.total()).toBe(before);
    });
  });

  test.describe(`SC-${P}-02 ความสอดคล้องกับฟอร์มบทความ`, () => {
    test(`${id('02-01')} [High] [Positive] ชุดฟิลด์เหมือนฟอร์มคลังความรู้`, async ({ page }) => {
      await form(page).openCreate();
      const fields = await fieldNames(page);
      for (const field of SHEET_FIELDS) {
        const present = await page.locator(`#content-module-form [name="${field}"], #content-module-form #${field.replace(/\[\]$/, '')}`).count();
        expect.soft(present, `field "${field}"`).toBeGreaterThan(0);
      }
      expect((await page.goto(urlOf('/admin/knowledge/create')))?.status()).toBe(200);
      const knowledge = await fieldNames(page);
      note(`Fields: ${fields.join(', ')}`);
      expect(fields, 'the same field names as the knowledge form').toEqual(knowledge);
    });

    test(`${id('02-07')} [High] [Negative] กำหนดวันและเวลาเผยแพร่แต่ไม่เลือกวันเวลา`, async ({ page }) => {
      test.fail(true, 'Known bug (DEF-55): "กำหนดวันและเวลา" with an empty date/time is saved (as เผยแพร่) instead of being refused.');
      requireDataCreatingTestsAllowed(`If the app accepts it, saves ${sampleTitle} (deleted again at the end).`);
      const f = form(page);
      const excerpt = contentMarker();
      try {
        await f.openCreate();
        await f.fill({ title: sampleTitle, excerpt, status: 'publish', timing: 'schedule' });
        await expect(f.publishedAtInput, 'the date/time box appears').toBeVisible();
        await expect(f.publishedAtInput).toHaveValue('');
        // The date box is not `required`, so the browser lets the form go; follow the form's fetch-save.
        const submitted = await f.save();
        expect(submitted.final, 'no server error').toBeLessThan(500);
        const saved = await list(page).findByExcerpt(excerpt);
        note(saved ? `Saved without a date (status "${saved.status}", save answered ${submitted.first}).` : `Refused by the server (${submitted.first} → ${submitted.url}).`);
        expect(saved, 'not saved without the date/time').toBeUndefined();
      } finally {
        await deleteNewsByExcerpt(page, excerpt, M);
      }
    });

    test(`${id('02-08')} [High] [Negative] ลิงก์วิดีโอที่เป็น javascript: และลิงก์อ้างอิงที่ไม่ใช่ URL`, async ({ page, browser }) => {
      requireDataCreatingTestsAllowed(`If the app accepts it, saves ${sampleTitle} (deleted again at the end).`);
      const f = form(page);
      const excerpt = contentMarker();
      try {
        await f.openCreate();
        await f.fill({ title: sampleTitle, excerpt, videoUrl: 'javascript:alert(1)', referenceUrl: 'ไม่ใช่ลิงก์', status: 'publish', timing: 'now' });
        const submitted = await f.save();
        expect(submitted.final, 'no server error').toBeLessThan(500);
        const saved = await list(page).findByExcerpt(excerpt);
        if (saved) {
          const detail = await publicNewsDetail(browser, excerpt, M);
          const scriptLinks = detail ? (detail.html.match(/(href|src)="\s*javascript:[^"]*"/gi) ?? []) : [];
          note(`Saved. Public page ${detail?.url ?? '(not listed)'}: ${scriptLinks.length ? `javascript: links: ${scriptLinks.join(' ')}` : 'no javascript: link'}`);
          expect(scriptLinks, 'no link that runs a script').toEqual([]);
        } else {
          const message = (await page.locator('#content-module-form').getByText(/กรุณา|ไม่ถูกต้อง/).allInnerTexts()).join(' | ');
          note(`Refused (landed on ${submitted.url})${message ? `: ${message}` : ''}.`);
        }
        expect(saved, 'refused with validation').toBeUndefined();
      } finally {
        await deleteNewsByExcerpt(page, excerpt, M);
      }
    });
  });
}
