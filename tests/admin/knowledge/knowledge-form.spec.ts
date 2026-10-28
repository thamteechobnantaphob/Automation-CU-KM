import { test, expect } from '@fixtures/pages.fixtures';
import { requireDataCreatingTestsAllowed } from '@config/env';
import { ContentFormPage, ContentFormValues, ContentListPage, KNOWLEDGE_MODULE as M } from '@pages/admin/AdminNewsPages';
import { undoRedoFiveSteps } from '@utils/editorChecks';
import { urlOf } from '@utils/lowPrivilege';
import { contentMarker, deleteNewsWhere, PublicView, publicNewsDetail, publicNewsList, withContentItem } from '@utils/newsFlows';
import { roleStamp } from '@utils/roleFlows';
import { collectDialogs, SQL_ERROR_PATTERN } from '@utils/security';
import { Browser, Page } from '@playwright/test';

/**
 * KM-FKNO — the knowledge form (/admin/knowledge/create): its lower part (files, video links, reference data,
 * status/publish timing, cover) and the editor. Recon 2026-10-02: only the title is `required`; the video links are a
 * textarea (one link per line); reference_date is <input type=date>, reference_url a text input; the public detail page
 * (/frontend/knowledge/detail/<slug>) shows "โดย <author>" and a "ข้อมูลอ้างอิง" block: "แหล่งที่มา: … ผู้แต่ง: …
 * วันที่: 21 กันยายน 2026 <link target=_blank rel=noopener>".
 *
 * The sheet saves "AUTO_FKNO_001" with nothing else; the automation adds "[Auto Test] <stamp>" in the excerpt so that
 * the cleanup can find and delete exactly what each case saved.
 *
 * NOT implemented ({MAX} undefined, no maxlength — DEF-52): TC-FKNO-05-02/03 (source), 05-07/08 (author).
 */

const TITLE = 'AUTO_FKNO_001';
const HTML_PAYLOAD = '<b>bold</b><script>alert(1)</script>';
const IMG_PAYLOAD = '<img src=x onerror=alert(1)>';
const VIDEO_A = 'https://www.youtube.com/watch?v=aqz-KE-bpKQ';
const VIDEO_B = 'https://youtu.be/ScMzIvxBSi4';
const LONG_URL = `https://www.example.com/${'a'.repeat(2100 - 'https://www.example.com/'.length)}`;
const SAVES = 'Saves AUTO_FKNO_001 (deleted again at the end of the case).';

// Save + public check + cleanup takes longer than the 30 s default on Dev.
test.beforeEach(() => test.setTimeout(90_000));

function note(description: string): void {
  test.info().annotations.push({ type: 'note', description });
}

async function cardOf(page: Page, excerpt: string) {
  return new ContentListPage(page, M).findByExcerpt(excerpt);
}

/** Saves AUTO_FKNO_001 (published now) with `values`, runs `checks` with the admin card and the public detail page. */
async function saveAndView(
  page: Page,
  browser: Browser,
  values: ContentFormValues,
  checks: (saved: { excerpt: string; detail: PublicView | undefined; stored: boolean }) => Promise<void>,
): Promise<void> {
  await withContentItem(page, M, { title: TITLE, status: 'publish', timing: 'now', ...values }, async (excerpt) => {
    const stored = !!(await cardOf(page, excerpt));
    const detail = stored ? await publicNewsDetail(browser, excerpt, M) : undefined;
    await checks({ excerpt, detail, stored });
  });
}

const RAW_KEY_LONG_URL = 'Known bug (DEF-66): the too-long URL is refused but no readable message is shown (raw key "validation.max.string").';

/** The validation message(s) shown after a refused save (red text under the field, e.g. "กรุณากรอกลิงก์ให้ถูกต้อง …"). */
async function errorsShown(page: Page): Promise<string> {
  const texts = await page.locator('#content-module-form').getByText(/กรุณา|ไม่ถูกต้อง|ต้องไม่เกิน|ต้องเป็น|invalid|must|\bvalidation\.[a-z_.]+/i).allInnerTexts();
  return texts.join(' | ').replace(/\s+/g, ' ');
}

/** Saves with `values` and expects the server to refuse it (nothing stored, no 500); `extra` sees a stored item. */
async function expectRefused(page: Page, browser: Browser, values: ContentFormValues, extra?: (detail: PublicView | undefined) => Promise<void>): Promise<void> {
  await withContentItem(page, M, { title: TITLE, status: 'publish', timing: 'now', ...values }, async (excerpt) => {
    expect(SQL_ERROR_PATTERN.test(await page.locator('body').innerText()), 'no SQL error').toBe(false);
    const errors = await errorsShown(page);
    const stored = await cardOf(page, excerpt);
    note(stored ? 'Saved (not refused).' : `Refused: ${errors || '(no message)'}`);
    if (stored && extra) await extra(await publicNewsDetail(browser, excerpt, M));
    expect(stored, 'refused with validation — nothing saved').toBeUndefined();
    expect.soft(errors, 'a validation message is shown').not.toBe('');
    expect.soft(errors, 'a readable message, not a raw key').not.toMatch(/\bvalidation\.[a-z_.]+/i);
  });
}

/** Sets a date/date-time input to a value the browser would never produce (the type is switched to text first). */
async function forceValue(page: Page, selector: string, value: string): Promise<void> {
  await page.locator(selector).evaluate((input: HTMLInputElement, v) => {
    input.disabled = false;
    input.type = 'text';
    input.value = v;
  }, value);
}

/** Opens the create form, fills it, forces `selector` = `value`, saves; returns whether it was stored (then deleted). */
async function saveWithForced(page: Page, values: ContentFormValues, selector: string, value: string): Promise<{ stored: boolean; final: number; errors: string }> {
  const form = new ContentFormPage(page, M);
  const excerpt = contentMarker();
  try {
    await form.openCreate();
    await form.fill({ title: TITLE, excerpt, ...values });
    await forceValue(page, selector, value);
    const submitted = await form.save();
    const errors = await errorsShown(page);
    return { stored: !!(await cardOf(page, excerpt)), final: submitted.final, errors };
  } finally {
    await deleteNewsWhere(page, (card) => card.excerpt === excerpt, M);
  }
}

/** Text of the public "ข้อมูลอ้างอิง" block. */
function referenceBlock(detail: PublicView | undefined): string {
  const text = detail?.text ?? '';
  const start = text.indexOf('ข้อมูลอ้างอิง');
  return start < 0 ? '' : text.slice(start, text.indexOf('อาคารบรมราชชนนี', start) > 0 ? text.indexOf('อาคารบรมราชชนนี', start) : undefined);
}

test.describe('SC-FKNO-01 ฟอร์มบทความ/คลังความรู้', () => {
  test('TC-FKNO-01-01 [High] [Positive] เปิดฟอร์ม: ส่วนและค่าเริ่มต้นครบตามที่ออกแบบ', async ({ page }) => {
    const form = new ContentFormPage(page, M);
    await form.openCreate();
    const text = (await page.locator('.body-content').innerText()).replace(/\s+/g, ' ');
    for (const label of ['ชื่อหัวเรื่อง', 'รายละเอียดแบบย่อ', 'หมวดหมู่', 'แท็ก', 'เนื้อหาบทความ', 'อัปโหลดไฟล์', 'วิดีโอประกอบ', 'ข้อมูลอ้างอิง', 'แหล่งที่มา', 'ชื่อผู้แต่ง', 'วันที่', 'ลิงค์อ้างอิงภายนอก', 'สถานะ', 'เผยแพร่เมื่อ', 'รูปภาพหน้าปกบทความ']) {
      expect.soft(text, `section "${label}"`).toContain(label);
    }
    await expect(form.titleInput).toHaveAttribute('required', '');
    // Same as the news form (DEF-57): no category chosen, the picker shows its placeholder.
    expect(await form.categoryValue(), 'หมวดหมู่ default = no category').toBe('');
    expect(await form.categoryOptions()).toContain('— ไม่ระบุ —');
    note(`Category picker shows: "${await form.selectedCategory()}"`);
    await expect(form.wordCount).toContainText('0 words');
    await expect(form.cancelLink).toBeVisible();
    await expect(form.saveButton).toBeVisible();
    await expect(form.statusRadio('publish'), 'สถานะ = เผยแพร่').toBeChecked();
    await expect(page.locator('#publish-timing-now'), 'เผยแพร่เมื่อ = ทันที').toBeChecked();
    expect(await form.tagTexts()).toEqual([]);
    expect(await page.locator('#document-upload').evaluate((el: HTMLInputElement) => el.files?.length ?? 0)).toBe(0);
    expect(await page.locator('#cover-image-upload').evaluate((el: HTMLInputElement) => el.files?.length ?? 0)).toBe(0);
  });

  test("TC-FKNO-01-03 [Low] [Positive] ตัวนับคำ 'words' อัปเดตตามการพิมพ์ (ไทย/อังกฤษ)", async ({ page }) => {
    const form = new ContentFormPage(page, M);
    await form.openCreate();
    const count = async (): Promise<string> => ((await form.wordCount.innerText()).match(/(\S+)\s+words?/) ?? [])[1] ?? '';
    expect(await count()).toBe('0');
    await page.frameLocator('.tox-edit-area iframe').locator('body').click();
    await page.keyboard.type('This is a test');
    await expect.poll(count).toBe('4');
    await page.keyboard.type(' ทดสอบระบบจัดการความรู้');
    await expect.poll(async () => Number(await count())).toBeGreaterThan(4);
    note(`After both phrases: "${await count()} words"`);
    expect(await count()).toMatch(/^\d+$/);
  });

  test("TC-FKNO-01-04 [High] [Positive] ปุ่ม 'ยกเลิก' กลับหน้ารายการโดยไม่บันทึก", async ({ page }) => {
    const list = new ContentListPage(page, M);
    const form = new ContentFormPage(page, M);
    const before = await list.total();
    await form.openCreate();
    await form.fill({ title: `[Auto Test] ไม่ควรถูกบันทึก ${roleStamp()}`, body: '<p>เนื้อหาทดสอบ</p>' });
    const dialogs: string[] = [];
    page.on('dialog', async (dialog) => {
      dialogs.push(dialog.message());
      await dialog.accept();
    });
    await form.cancelLink.click();
    await expect(page).toHaveURL(urlOf('/admin/knowledge/index'));
    note(dialogs.length ? `Warning shown: ${dialogs.join(' | ')}` : 'No unsaved-changes warning (TBD).');
    expect(await list.total()).toBe(before);
  });

  test("TC-FKNO-01-05 [Medium] [Positive] ลิงก์ '← กลับไปที่รายการ' ทำงาน", async ({ page }) => {
    const form = new ContentFormPage(page, M);
    await form.openCreate();
    await expect(form.backLink).toContainText('← กลับไปที่รายการบทความ/คลังความรู้');
    await form.backLink.click();
    await expect(page).toHaveURL(urlOf('/admin/knowledge/index'));
    await expect(new ContentListPage(page, M).listHeading).toBeVisible();
  });

  test('TC-FKNO-01-06 [Medium] [Negative] เปิดฟอร์มใหม่หลังบันทึกแล้วต้องไม่มีข้อมูลค้าง', async ({ page }) => {
    requireDataCreatingTestsAllowed(SAVES);
    const form = new ContentFormPage(page, M);
    await withContentItem(page, M, { title: TITLE, tags: ['autotest1'], status: 'draft' }, async (excerpt) => {
      expect(await cardOf(page, excerpt), 'saved').toBeDefined();
      await form.openCreate();
      await expect(form.titleInput).toHaveValue('');
      await expect(form.excerptInput).toHaveValue('');
      expect(await form.tagTexts()).toEqual([]);
      expect((await form.bodyText()).trim()).toBe('');
      expect(await form.categoryValue()).toBe('');
      await expect(form.statusRadio('publish'), 'status back to its default').toBeChecked();
      expect(await page.locator('#document-upload').evaluate((el: HTMLInputElement) => el.files?.length ?? 0)).toBe(0);
      expect(await page.locator('#cover-image-upload').evaluate((el: HTMLInputElement) => el.files?.length ?? 0)).toBe(0);
    });
  });

  test('TC-FKNO-01-07 [Low] [Positive] ลำดับการกด Tab และการใช้งานบนมือถือ 375px', async ({ page }) => {
    // Same editor as the news form: at 375px Tab is trapped in TinyMCE's menubar/toolbar/status bar.
    test.fail(true, 'Known bug (DEF-56): at 375px keyboard focus is trapped in the TinyMCE menubar/toolbar/status bar.');
    await page.setViewportSize({ width: 375, height: 812 });
    const form = new ContentFormPage(page, M);
    await form.openCreate();
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
    note(`Horizontal overflow at 375px: ${overflow}px`);
    expect(overflow).toBeLessThanOrEqual(1);
    await form.titleInput.focus();
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
    note(`Tab order: ${visited.slice(0, 14).join(' → ')}${visited.length > 14 ? ' → …' : ''}`);
    expect(visited[visited.length - 1], 'Tab reaches "บันทึก"').toBe('บันทึก');
  });

  test('TC-FKNO-01-08 [High] [Negative] ช่องหัวเรื่องว่างต้องบันทึกไม่ได้', async ({ page }) => {
    const list = new ContentListPage(page, M);
    const form = new ContentFormPage(page, M);
    const before = await list.total();
    await form.openCreate();
    await expect(form.titleInput).toHaveAttribute('required', '');
    await form.fill({ excerpt: contentMarker(), body: '<p>เนื้อหาทดสอบ</p>', source: 'แหล่งที่มาทดสอบ', authorName: 'ผู้แต่งทดสอบ' });
    const posts: string[] = [];
    page.on('request', (request) => request.method() === 'POST' && posts.push(request.url()));
    await form.saveButton.click();
    await page.waitForTimeout(500);
    const message = await form.titleInput.evaluate((el: HTMLInputElement) => el.validationMessage);
    note(`Browser message: "${message}"`);
    expect(message).not.toBe('');
    expect(posts, 'the form is not sent').toEqual([]);
    expect(await list.total()).toBe(before);
  });
});

test.describe('SC-FKNO-04 ลิงก์วิดีโอ', () => {
  test('TC-FKNO-04-04 [Medium] [Positive] ลิงก์วิดีโอ: มีบรรทัดว่างและช่องว่างหน้า-หลัง', async ({ page, browser }) => {
    requireDataCreatingTestsAllowed(SAVES);
    await saveAndView(page, browser, { videoUrl: `  ${VIDEO_A}   \n\n\n${VIDEO_B}  \n` }, async ({ stored, detail }) => {
      expect(stored, 'saved').toBe(true);
      // The edit form lists stored videos apart (its textarea is for new links), so check what the public page embeds.
      const embeds = (detail?.html.match(/<iframe[^>]+src="[^"]*"/g) ?? []).map((tag) => tag.replace(/.*src="/, '').replace(/"$/, ''));
      note(`Public embeds: ${JSON.stringify(embeds)}`);
      expect(embeds.filter((src) => src.includes('aqz-KE-bpKQ')), 'the first link').toHaveLength(1);
      expect(embeds.filter((src) => src.includes('ScMzIvxBSi4')), 'the second link').toHaveLength(1);
      expect(embeds, 'nothing from the blank lines').toHaveLength(2);
    });
  });

  test('TC-FKNO-04-05 [Low] [Negative] ลิงก์วิดีโอ: ลิงก์ซ้ำกัน', async ({ page, browser }) => {
    test.fail(true, 'Known bug (DEF-61): the same video link entered twice is saved twice and embedded twice on the public page.');
    requireDataCreatingTestsAllowed(SAVES);
    await saveAndView(page, browser, { videoUrl: `${VIDEO_A}\n${VIDEO_A}` }, async ({ stored, detail }) => {
      if (!stored) return note('Refused (duplicate links).');
      const shown = (detail?.html.match(/aqz-KE-bpKQ/g) ?? []).length;
      const embeds = (detail?.html.match(/<iframe[^>]+aqz-KE-bpKQ/g) ?? []).length;
      note(`Saved; public page: ${embeds} embed(s), ${shown} mention(s) of the video id`);
      expect(embeds, 'the same video is not shown twice').toBeLessThanOrEqual(1);
    });
  });

  for (const [id, label, value] of [
    ['TC-FKNO-04-08 [Medium]', 'ข้อความที่ไม่ใช่ URL', 'ไม่ใช่ลิงก์'],
    ['TC-FKNO-04-10 [Low]', 'URL ยาวเกินกำหนด (2,100 ตัวอักษร)', LONG_URL],
  ] as const) {
    test(`${id} [Negative] ลิงก์วิดีโอ: ${label}`, async ({ page, browser }) => {
      test.fail(id.startsWith('TC-FKNO-04-10'), RAW_KEY_LONG_URL);
      requireDataCreatingTestsAllowed('If the app accepts it, saves AUTO_FKNO_001 (deleted again at the end).');
      await expectRefused(page, browser, { videoUrl: value });
    });
  }

  test('TC-FKNO-04-09 [High] [Negative] ลิงก์วิดีโอ: javascript: และ data: scheme', async ({ page, browser }) => {
    requireDataCreatingTestsAllowed('If the app accepts it, saves AUTO_FKNO_001 (deleted again at the end).');
    await expectRefused(page, browser, { videoUrl: 'javascript:alert(1)\ndata:text/html,<script>alert(1)</script>' }, async (detail) => {
      expect(detail?.dialogs ?? [], 'no script runs publicly').toEqual([]);
      expect(detail?.html.match(/(src|href)="\s*(javascript|data):[^"]*"/gi) ?? [], 'no javascript:/data: link or embed').toEqual([]);
    });
  });

  test('TC-FKNO-04-11 [High] [Negative] ลิงก์วิดีโอ: แท็ก HTML ในช่องลิงก์', async ({ page, browser }) => {
    requireDataCreatingTestsAllowed('If the app accepts it, saves AUTO_FKNO_001 (deleted again at the end).');
    const dialogs = collectDialogs(page);
    // "ถูกปฏิเสธหรือ escape": either is fine, a running script is not.
    await saveAndView(page, browser, { videoUrl: '<script>alert(1)</script>' }, async ({ stored, detail }) => {
      note(stored ? 'Saved — checked as escaped on the public page.' : `Refused: ${await errorsShown(page)}`);
      if (stored) expect(detail?.dialogs ?? [], 'no script runs publicly').toEqual([]);
    });
    expect(dialogs).toEqual([]);
  });

  test('TC-FKNO-04-12 [Medium] [Positive] ลิงก์วิดีโอ: เว้นว่าง (ไม่บังคับ)', async ({ page, browser }) => {
    requireDataCreatingTestsAllowed(SAVES);
    await saveAndView(page, browser, { videoUrl: '' }, async ({ stored, detail }) => {
      expect(stored, 'saved without video links').toBe(true);
      expect(detail?.status).toBe(200);
      expect(detail?.html.match(/<iframe/gi) ?? [], 'no empty video embed on the public page').toEqual([]);
    });
  });
});

test.describe('SC-FKNO-05 ข้อมูลอ้างอิง', () => {
  test('TC-FKNO-05-01 [High] [Positive] แหล่งที่มา: ข้อความภาษาไทยปกติ', async ({ page, browser }) => {
    requireDataCreatingTestsAllowed(SAVES);
    await saveAndView(page, browser, { source: 'ระบบจัดการความรู้ทดสอบ' }, async ({ stored, detail }) => {
      expect(stored).toBe(true);
      expect(referenceBlock(detail), 'the public page shows it').toContain('แหล่งที่มา: ระบบจัดการความรู้ทดสอบ');
    });
  });

  for (const [id, field, label, key] of [
    ['TC-FKNO-05-04 [High]', 'แหล่งที่มา', 'แหล่งที่มา', 'source'],
    ['TC-FKNO-05-09 [High]', 'ชื่อผู้แต่ง', 'ผู้แต่ง', 'authorName'],
  ] as const) {
    test(`${id} [Negative] ${field}: แท็ก HTML และสคริปต์`, async ({ page, browser }) => {
      requireDataCreatingTestsAllowed(SAVES);
      const dialogs = collectDialogs(page);
      await saveAndView(page, browser, { [key]: HTML_PAYLOAD }, async ({ stored, detail }) => {
        if (!stored) return note('Refused.');
        expect(detail?.dialogs ?? [], 'no script runs publicly').toEqual([]);
        expect(referenceBlock(detail), 'shown as literal text').toContain(`${label}: ${HTML_PAYLOAD}`);
      });
      expect(dialogs).toEqual([]);
    });
  }

  for (const [id, field, label, key] of [
    ['TC-FKNO-05-05 [Medium]', 'แหล่งที่มา', 'แหล่งที่มา', 'source'],
    ['TC-FKNO-05-10 [Medium]', 'ชื่อผู้แต่ง', 'ผู้แต่ง', 'authorName'],
  ] as const) {
    test(`${id} [Positive] ${field}: เว้นว่าง (ไม่บังคับ)`, async ({ page, browser }) => {
      requireDataCreatingTestsAllowed(SAVES);
      await saveAndView(page, browser, { source: key === 'source' ? '' : 'แหล่งที่มาทดสอบ', authorName: key === 'authorName' ? '' : 'ผู้แต่งทดสอบ' }, async ({ stored, detail }) => {
        expect(stored, 'saved').toBe(true);
        const block = referenceBlock(detail);
        note(`Reference block: ${block || '(none)'}`);
        expect(block, `no empty "${label}:" line`).not.toMatch(new RegExp(`${label}:\\s*(แหล่งที่มา:|ผู้แต่ง:|วันที่:|https?:|$)`));
        if (key === 'authorName') expect(detail?.text ?? '', 'no empty "โดย"').not.toMatch(/โดย\s+\d{2} /);
      });
    });
  }

  test('TC-FKNO-05-06 [High] [Positive] ชื่อผู้แต่ง: ข้อความภาษาไทยปกติ', async ({ page, browser }) => {
    requireDataCreatingTestsAllowed(SAVES);
    await saveAndView(page, browser, { authorName: 'ระบบจัดการความรู้ทดสอบ' }, async ({ stored, detail }) => {
      expect(stored).toBe(true);
      expect(referenceBlock(detail)).toContain('ผู้แต่ง: ระบบจัดการความรู้ทดสอบ');
      expect(detail?.text, 'the byline').toContain('โดย ระบบจัดการความรู้ทดสอบ');
    });
  });

  test('TC-FKNO-05-11 [High] [Positive] วันที่ (reference_date): วันที่ปัจจุบัน', async ({ page, browser }) => {
    // With only the date filled in (the sheet's step) the public page shows no "ข้อมูลอ้างอิง" block at all (DEF-62);
    // with other reference data it shows "วันที่: 21 กันยายน 2026" — Christian-era year, the sheet expects "21 ก.ย. 2569" (DEF-59).
    test.fail(true, 'Known bug (DEF-62 / DEF-59): a reference date alone is not shown publicly; when shown, the year is Christian-era.');
    requireDataCreatingTestsAllowed(SAVES);
    await saveAndView(page, browser, { referenceDate: '2026-09-21' }, async ({ stored, detail }) => {
      expect(stored).toBe(true);
      const block = referenceBlock(detail);
      note(`Reference block: ${block}`);
      expect(block, 'Thai date with the Buddhist-era year').toMatch(/วันที่:\s*21 (ก\.ย\.|กันยายน) 2569/);
    });
  });

  for (const [id, label, value, shown] of [
    ['TC-FKNO-05-12 [Low]', 'วันที่ในอดีตไกล', '1900-01-01', /1 (ม\.ค\.|มกราคม) (1900|2443)/],
    ['TC-FKNO-05-13 [Low]', 'วันที่ปีอธิกสุรทิน', '2028-02-29', /29 (ก\.พ\.|กุมภาพันธ์) (2028|2571)/],
  ] as const) {
    test(`${id} [Positive] วันที่ (reference_date): ${label}`, async ({ page, browser }) => {
      requireDataCreatingTestsAllowed(SAVES);
      // "แหล่งที่มา" is filled too: a date alone is not shown publicly at all (DEF-62); this case checks the format.
      await saveAndView(page, browser, { source: 'แหล่งที่มาทดสอบ', referenceDate: value }, async ({ stored, detail }) => {
        const block = referenceBlock(detail);
        note(stored ? `Saved; public: ${block}` : `Refused: ${await errorsShown(page)}`);
        if (stored) expect(block, 'the date is shown correctly').toMatch(shown);
      });
    });
  }

  test('TC-FKNO-05-15 [Medium] [Negative] วันที่ (reference_date): วันที่ไม่มีอยู่จริง (ป้อนผ่านสคริปต์)', async ({ page }) => {
    requireDataCreatingTestsAllowed('If the app accepts it, saves AUTO_FKNO_001 (deleted again at the end).');
    const results: string[] = [];
    for (const value of ['2027-02-29', '2026-13-45']) {
      const result = await saveWithForced(page, {}, 'input[name="reference_date"]', value);
      results.push(`${value} -> ${result.stored ? 'saved' : 'refused'} (${result.final})${result.errors ? ` "${result.errors}"` : ''}`);
      expect(result.final, `${value}: no server error`).toBeLessThan(500);
    }
    note(results.join(' | '));
    expect(results.filter((line) => line.includes('saved')), 'the server refuses impossible dates').toEqual([]);
  });

  test('TC-FKNO-05-16 [Low] [Negative] วันที่ (reference_date): ปีสุดขอบ (0001 และ 9999)', async ({ page }) => {
    requireDataCreatingTestsAllowed('Saves AUTO_FKNO_001 twice (deleted again at the end).');
    const results: string[] = [];
    for (const value of ['0001-01-01', '9999-12-31']) {
      const result = await saveWithForced(page, {}, 'input[name="reference_date"]', value);
      results.push(`${value} -> ${result.stored ? 'saved' : 'refused'} (${result.final})`);
      expect(result.final, `${value}: no server error`).toBeLessThan(500);
    }
    note(results.join(' | '));
  });

  test('TC-FKNO-05-17 [Medium] [Positive] วันที่ (reference_date): ล้างค่าวันที่ (ไม่บังคับ)', async ({ page, browser }) => {
    requireDataCreatingTestsAllowed(SAVES);
    await saveAndView(page, browser, { source: 'แหล่งที่มาทดสอบ', referenceDate: '' }, async ({ stored, detail }) => {
      expect(stored).toBe(true);
      const block = referenceBlock(detail);
      note(`Reference block: ${block}`);
      expect(block, 'no empty "วันที่:"').not.toMatch(/วันที่:\s*(?!\d)/);
    });
  });

  test('TC-FKNO-05-18 [High] [Positive] ลิงค์อ้างอิงภายนอก: URL ที่ถูกต้อง (https)', async ({ page, browser }) => {
    requireDataCreatingTestsAllowed(SAVES);
    const url = 'https://www.facebook.com/nursechula';
    await saveAndView(page, browser, { referenceUrl: url }, async ({ stored, detail }) => {
      expect(stored).toBe(true);
      const anchor = detail?.html.match(new RegExp(`<a[^>]+href="${url.replace(/[.]/g, '\\.')}"[^>]*>`))?.[0] ?? '';
      note(`Link: ${anchor}`);
      expect(anchor, 'the link is on the public page').not.toBe('');
      expect(anchor).toContain('target="_blank"');
      expect(anchor).toMatch(/rel="[^"]*noopener/);
    });
  });

  test('TC-FKNO-05-19 [Low] [Positive] ลิงค์อ้างอิงภายนอก: URL แบบ http', async ({ page, browser }) => {
    requireDataCreatingTestsAllowed(SAVES);
    await saveAndView(page, browser, { referenceUrl: 'http://example.com/page' }, async ({ stored, detail }) => {
      note(stored ? 'Saved (no https warning).' : `Refused: ${await errorsShown(page)}`);
      if (stored) expect(detail?.html ?? '').toContain('href="http://example.com/page"');
    });
  });

  test('TC-FKNO-05-20 [Medium] [Negative] ลิงค์อ้างอิงภายนอก: ไม่มี scheme', async ({ page, browser }) => {
    requireDataCreatingTestsAllowed('If the app accepts it, saves AUTO_FKNO_001 (deleted again at the end).');
    await saveAndView(page, browser, { referenceUrl: 'facebook.com/nursechula' }, async ({ stored, detail }) => {
      if (!stored) return note(`Refused: ${await errorsShown(page)}`);
      const href = detail?.html.match(/href="([^"]*facebook\.com\/nursechula)"/)?.[1] ?? '';
      note(`Saved; public href: ${href}`);
      expect(href, 'a scheme was added (otherwise the link is broken)').toMatch(/^https?:\/\//);
    });
  });

  for (const [id, label, value] of [
    ['TC-FKNO-05-21 [High]', 'javascript: scheme', 'javascript:alert(1)'],
    ['TC-FKNO-05-22 [High]', 'data: scheme', 'data:text/html,<script>alert(1)</script>'],
    ['TC-FKNO-05-23 [Medium]', 'ข้อความที่ไม่ใช่ URL', 'ไม่ใช่ลิงก์'],
    ['TC-FKNO-05-24 [Low]', 'URL ยาวเกิน 2,000 ตัวอักษร', LONG_URL],
  ] as const) {
    test(`${id} [Negative] ลิงค์อ้างอิงภายนอก: ${label}`, async ({ page, browser }) => {
      test.fail(id.startsWith('TC-FKNO-05-24'), RAW_KEY_LONG_URL);
      requireDataCreatingTestsAllowed('If the app accepts it, saves AUTO_FKNO_001 (deleted again at the end).');
      await expectRefused(page, browser, { referenceUrl: value }, async (detail) => {
        expect(detail?.html.match(/href="\s*(javascript|data):[^"]*"/gi) ?? [], 'no link that runs a script').toEqual([]);
      });
    });
  }

  test('TC-FKNO-05-25 [Medium] [Positive] ลิงค์อ้างอิงภายนอก: เว้นว่าง (ไม่บังคับ)', async ({ page, browser }) => {
    requireDataCreatingTestsAllowed(SAVES);
    await saveAndView(page, browser, { source: 'แหล่งที่มาทดสอบ', referenceUrl: '' }, async ({ stored, detail }) => {
      expect(stored).toBe(true);
      expect(detail?.html.match(/<a[^>]+href=""[^>]*>/g) ?? [], 'no empty link').toEqual([]);
    });
  });

  test('TC-FKNO-05-26 [Medium] [Positive] ลิงค์อ้างอิงภายนอก: ลิงก์ภายในเว็บแบบ path', async ({ page, browser }) => {
    test.fail(true, 'Known bug (DEF-63): a site path such as /frontend/faq/index is refused ("กรุณากรอกลิงก์ให้ถูกต้อง") — only absolute URLs are accepted.');
    requireDataCreatingTestsAllowed(SAVES);
    await saveAndView(page, browser, { referenceUrl: '/frontend/faq/index' }, async ({ stored, detail }) => {
      note(stored ? 'Saved.' : `Refused: ${await errorsShown(page)}`);
      expect(stored, 'a site path is accepted').toBe(true);
      const visitor = await browser.newPage();
      try {
        await visitor.goto(detail!.url);
        await visitor.locator('a[href="/frontend/faq/index"], a[href$="/frontend/faq/index"]').filter({ hasText: /faq/ }).first().click();
        await expect(visitor).toHaveURL(/\/frontend\/faq\/index$/);
      } finally {
        await visitor.close();
      }
    });
  });

  test('TC-FKNO-05-28 [Low] [Negative] ลิงค์อ้างอิงภายนอก: ลิงก์มีช่องว่างกลาง', async ({ page, browser }) => {
    requireDataCreatingTestsAllowed('If the app accepts it, saves AUTO_FKNO_001 (deleted again at the end).');
    await saveAndView(page, browser, { referenceUrl: 'https://www.example .com' }, async ({ stored, detail }) => {
      if (!stored) return note(`Refused: ${await errorsShown(page)}`);
      const href = detail?.html.match(/href="(https:\/\/www\.example[^"]*)"/)?.[1] ?? '';
      note(`Saved; public href: ${JSON.stringify(href)}`);
      expect(href, 'encoded (no raw space)').not.toContain(' ');
    });
  });
});

test.describe('SC-FKNO-06 สถานะและเวลาเผยแพร่', () => {
  test("TC-FKNO-06-04 [Medium] [Positive] เลือก 'กำหนดวันและเวลา' แล้วมีช่องวันเวลาปรากฏ", async ({ page }) => {
    const form = new ContentFormPage(page, M);
    await form.openCreate();
    await form.fill({ title: TITLE });
    await expect(form.publishedAtInput).toBeHidden();
    await form.fill({ timing: 'schedule' });
    await expect(form.publishedAtInput, 'the date/time box appears').toBeVisible();
    await expect(form.publishedAtInput).toHaveAttribute('type', 'datetime-local');
    await form.publishedAtInput.fill('2030-01-01T09:00');
    await form.fill({ timing: 'now' });
    await expect(form.publishedAtInput, 'hidden again with "ทันที"').toBeHidden();
    expect(await form.publishedAtInput.evaluate((el: HTMLInputElement) => el.disabled), 'and not sent').toBe(true);
  });

  test('TC-FKNO-06-05 [High] [Negative] กำหนดวันและเวลาแต่เว้นว่าง', async ({ page }) => {
    test.fail(true, 'Known bug (DEF-55): "กำหนดวันและเวลา" with an empty date/time is saved (as เผยแพร่) instead of being refused.');
    requireDataCreatingTestsAllowed('If the app accepts it, saves AUTO_FKNO_001 (deleted again at the end).');
    await withContentItem(page, M, { title: TITLE, status: 'publish', timing: 'schedule' }, async (excerpt) => {
      const saved = await cardOf(page, excerpt);
      note(saved ? `Saved without a date (status "${saved.status}").` : 'Refused.');
      expect(saved, 'not saved silently as published').toBeUndefined();
    });
  });

  test('TC-FKNO-06-09 [Medium] [Negative] ค่าวันเวลาที่ไม่ถูกต้อง (ป้อนผ่านสคริปต์)', async ({ page }) => {
    requireDataCreatingTestsAllowed('If the app accepts it, saves AUTO_FKNO_001 (deleted again at the end).');
    const results: string[] = [];
    for (const value of ['abc', '2026-02-30T25:61']) {
      const result = await saveWithForced(page, { status: 'publish', timing: 'schedule' }, '#publish-datetime-input', value);
      results.push(`${value} -> ${result.stored ? 'saved' : 'refused'} (${result.final})${result.errors ? ` "${result.errors}"` : ''}`);
      expect(result.final, `${value}: no server error`).toBeLessThan(500);
    }
    note(results.join(' | '));
    expect(results.filter((line) => line.includes('saved')), 'the server refuses them').toEqual([]);
  });
});

test.describe('SC-FKNO-07 รูปภาพหน้าปก', () => {
  test('TC-FKNO-07-17 [High] [Positive] รูปภาพหน้าปกบทความ: ไม่เลือกรูป', async ({ page, browser }) => {
    requireDataCreatingTestsAllowed(SAVES);
    await saveAndView(page, browser, {}, async ({ excerpt, stored }) => {
      expect(stored, 'saved without a cover').toBe(true);
      const list = new ContentListPage(page, M);
      const found = (await list.locate((c) => c.excerpt === excerpt))!;
      const src = await list.cards.nth(found.index).locator('img').first().getAttribute('src');
      note(`Admin card image: ${src}`);
      expect(src, 'a placeholder').not.toContain('/storage/');
      const pub = await publicNewsList(browser, M);
      const publicSrc = pub.html.match(/<img[^>]+src="([^"]+)"[^>]*alt="AUTO_FKNO_001"/)?.[1] ?? pub.html.match(/<img[^>]+alt="AUTO_FKNO_001"[^>]*src="([^"]+)"/)?.[1] ?? '';
      note(`Public list image: ${publicSrc || '(not found)'}`);
      if (publicSrc) expect(publicSrc).not.toContain('/storage/');
    });
  });
});

test.describe('SC-FKNO-08 แท็ก', () => {
  test("TC-FKNO-08-02 [High] [Positive] พิมพ์คำใหม่แล้วกด Enter ขึ้นเป็นแท็ก 'ใหม่'", async ({ page }) => {
    const form = new ContentFormPage(page, M);
    await form.openCreate();
    const posts: string[] = [];
    page.on('request', (request) => request.method() === 'POST' && posts.push(request.url()));
    await form.addTag('AUTO_TAG_NEW');
    await page.waitForTimeout(500);
    await expect(form.tagChips.first(), 'the chip carries the "ใหม่" badge').toContainText('ใหม่');
    expect(await form.tagTexts()).toEqual(['AUTO_TAG_NEW']);
    expect(posts, 'the form is not sent').toEqual([]);
  });

  test('TC-FKNO-08-05 [Medium] [Negative] เพิ่มแท็กที่มีอยู่แล้วแบบพิมพ์เอง (ต่างตัวพิมพ์)', async ({ page }) => {
    requireDataCreatingTestsAllowed('Saves an item with the tag "KM" (deleted again; the tag stays in the system).');
    const form = new ContentFormPage(page, M);
    // Precondition: the tag "KM" exists.
    await withContentItem(page, M, { title: TITLE, tags: ['KM'], status: 'draft' }, async () => {
      await form.openCreate();
      await form.addTag('km');
      const chip = (await form.tagChips.first().innerText()).replace(/\s+/g, ' ');
      note(`Typed "km" → chip "${chip}"`);
      expect(chip, 'bound to the existing "KM" (not a new duplicate tag)').not.toContain('ใหม่');
    });
  });

  test('TC-FKNO-08-06 [Medium] [Negative] แท็กเว้นว่าง ช่องว่างล้วน และเกินความยาว', async ({ page }) => {
    const form = new ContentFormPage(page, M);
    await form.openCreate();
    await form.tagInput.press('Enter');
    await form.addTag('   ');
    expect(await form.tagChips.count(), 'no empty chip').toBe(0);
    await form.addTag('x'.repeat(100));
    const tags = await form.tagTexts();
    note(tags.length ? `100-character tag accepted as ${tags[0].length} characters, no notice (max TBD — DEF-52)` : '100-character tag refused');
  });

  test('TC-FKNO-08-07 [High] [Negative] แท็กที่มี HTML/สคริปต์ แสดงอย่างปลอดภัย', async ({ page, browser }) => {
    requireDataCreatingTestsAllowed(SAVES + ' The tag itself stays in the system.');
    const payload = '<script>alert(1)</script>';
    const dialogs = collectDialogs(page);
    const form = new ContentFormPage(page, M);
    await saveAndView(page, browser, { tags: [payload] }, async ({ excerpt, detail }) => {
      // The suggestions list.
      await form.openCreate();
      await form.tagInput.fill('<scr');
      await page.waitForTimeout(800);
      note(`Suggestions: ${(await page.locator('#tag-suggestions .dropdown-item').allInnerTexts()).join(' | ')}`);
      expect(await page.locator('#tag-suggestions script').count()).toBe(0);
      // The edit page.
      await form.openEdit((await cardOf(page, excerpt))!.editHref);
      expect(await form.tagTexts()).toEqual([payload]);
      // The public page.
      expect(detail?.dialogs ?? []).toEqual([]);
      expect(detail?.text ?? '').toContain(payload);
    });
    expect(dialogs, 'no script runs in the admin').toEqual([]);
  });
});

test.describe('SC-FKNO-09 ตัวแก้ไขเนื้อหา', () => {
  test('TC-FKNO-09-01 [Medium] [Positive] เมนูและเครื่องมือของตัวแก้ไข', async ({ page }) => {
    await new ContentFormPage(page, M).openCreate();
    expect((await page.locator('.tox-menubar').innerText()).split(/\s+/)).toEqual(['Edit', 'Insert', 'View', 'Format', 'Table']);
    const labels = await page.locator('.tox-tinymce [aria-label]').evaluateAll((els) => els.map((el) => el.getAttribute('aria-label') ?? ''));
    const want: Array<[string, RegExp]> = [
      ['Undo', /^Undo$/], ['Redo', /^Redo$/], ['บล็อก', /^Block/], ['ขนาดตัวอักษร', /^Font size/], ['ตัวหนา', /^Bold$/], ['ตัวเอียง', /^Italic$/],
      ['ขีดเส้นใต้', /^Underline$/], ['สี', /^Text color/], ['ชิดซ้าย', /^Align left$/], ['กลาง', /^Align center$/], ['ขวา', /^Align right$/],
      ['เต็มบรรทัด', /^Justify$/], ['รายการ', /^Bullet list$/], ['รายการเลข', /^Numbered list$/], ['เยื้อง', /indent$/], ['ลิงก์', /^Insert\/edit link$/],
      ['รูป', /^Insert\/edit image$/], ['สื่อ', /^Insert\/edit media$/], ['ตาราง', /^Table$/], ['ล้างรูปแบบ', /^Clear formatting$/],
      ['Source code', /^Source code$/], ['Fullscreen', /^Fullscreen$/],
    ];
    for (const [name, pattern] of want) expect.soft(labels.some((label) => pattern.test(label)), `tool "${name}"`).toBe(true);
  });

  test('TC-FKNO-09-05 [Low] [Positive] โหมด Fullscreen เปิด/ปิดด้วยปุ่มและ Esc', async ({ page }) => {
    const form = new ContentFormPage(page, M);
    await form.openCreate();
    const fullscreen = page.locator('.tox-tinymce button[aria-label="Fullscreen"]');
    const isFull = (): Promise<boolean> => page.locator('.tox-fullscreen').count().then((n) => n > 0);
    const pressFullscreen = async (): Promise<void> => {
      // At this width the button sits behind "Reveal or hide additional toolbar items".
      if (!(await fullscreen.isVisible())) await page.locator('.tox-tinymce button[aria-label="Reveal or hide additional toolbar items"]').click();
      await fullscreen.click();
    };
    await pressFullscreen();
    expect(await isFull(), 'fullscreen on').toBe(true);
    await page.frameLocator('.tox-edit-area iframe').locator('body').click();
    await page.keyboard.type('ข้อความทดสอบเต็มจอ');
    await pressFullscreen();
    expect(await isFull(), 'off with the button').toBe(false);
    await pressFullscreen();
    await page.keyboard.press('Escape');
    const escClosed = !(await isFull());
    note(`Esc ${escClosed ? 'leaves' : 'does not leave'} fullscreen (TinyMCE default: only the button/Ctrl+Shift+F).`);
    if (!escClosed) await pressFullscreen();
    expect(await form.bodyText(), 'the content is kept').toContain('ข้อความทดสอบเต็มจอ');
    await expect(form.saveButton, 'save still usable').toBeEnabled();
    await expect(form.saveButton).toBeVisible();
  });

  test('TC-FKNO-09-09 [Low] [Negative] เนื้อหาขนาดใหญ่ (1 MB)', async ({ page }) => {
    test.setTimeout(240_000);
    requireDataCreatingTestsAllowed('Saves a 1 MB AUTO_FKNO_001 (deleted again at the end).');
    const big = `<p>${'ทดสอบเนื้อหายาว KM '.repeat(1024 * 1024 / 40)}</p>`;
    await withContentItem(page, M, { title: TITLE, body: big }, async (excerpt) => {
      note(`Body ${(big.length / 1024).toFixed(0)} KB: ${(await cardOf(page, excerpt)) ? 'saved' : 'refused'} (no timeout / 500).`);
    });
  });

  test('TC-FKNO-09-11 [Low] [Positive] Undo/Redo หลายขั้นตอน', async ({ page }) => {
    await new ContentFormPage(page, M).openCreate();
    await undoRedoFiveSteps(page);
  });

  test('TC-FKNO-09-12 [Low] [Negative] ออกจากหน้าโดยไม่บันทึกเมื่อมีเนื้อหาค้าง', async ({ page }) => {
    const list = new ContentListPage(page, M);
    const before = await list.total();
    await new ContentFormPage(page, M).openCreate();
    await page.frameLocator('.tox-edit-area iframe').locator('body').click();
    await page.keyboard.type('เนื้อหาที่ยังไม่บันทึก');
    const dialogs: string[] = [];
    page.on('dialog', async (dialog) => {
      dialogs.push(`${dialog.type()}: ${dialog.message()}`);
      await dialog.accept();
    });
    await page.locator('#sidebar a', { hasText: 'แดชบอร์ด' }).first().click();
    await page.waitForLoadState('load');
    note(dialogs.length ? `Warning: ${dialogs.join(' | ')}` : 'No warning — the typed content is lost (allowed: "ยอมรับการสูญเสียตามกติกา TBD").');
    expect(page.url(), 'navigation is not blocked forever').not.toMatch(/\/create$/);
    expect(await list.total(), 'nothing saved').toBe(before);
  });
});

test.describe('SC-FKNO-10 การบันทึก', () => {
  test('TC-FKNO-10-01 [High] [Positive] บันทึกด้วยหัวเรื่องอย่างเดียว', async ({ page, browser }) => {
    requireDataCreatingTestsAllowed(SAVES);
    const list = new ContentListPage(page, M);
    await withContentItem(page, M, { title: TITLE, body: '' }, async (excerpt) => {
      await expect(list.flash.filter({ hasText: M.createdFlash }), 'success message').toBeVisible();
      const card = await cardOf(page, excerpt);
      expect(card, 'listed').toBeDefined();
      expect(card!.status, 'published').toBe('เผยแพร่');
      expect(card!.creator, 'creator').toBe('Admin');
      const day = new Date().toLocaleDateString('en-GB', { day: '2-digit', timeZone: 'Asia/Bangkok' });
      expect(card!.created, 'today').toMatch(new RegExp(`^${day} `));
      note(`Card date: "${card!.created}"`);
      const detail = await publicNewsDetail(browser, excerpt, M);
      expect(detail?.status, 'opens publicly').toBe(200);
      expect(detail!.text).toContain(TITLE);
    });
  });

  test('TC-FKNO-10-04 [High] [Negative] กดบันทึกซ้ำรัวๆ ไม่สร้างรายการซ้ำ', async ({ page }) => {
    requireDataCreatingTestsAllowed(SAVES);
    const form = new ContentFormPage(page, M);
    const excerpt = contentMarker();
    try {
      await form.openCreate();
      await form.fill({ title: TITLE, excerpt });
      await Promise.all([
        page.waitForURL(/\/admin\/knowledge\/index/, { timeout: 30_000 }),
        page.evaluate(() => {
          const button = document.querySelector<HTMLButtonElement>('#content-module-form button[type="submit"]');
          for (let i = 0; i < 5; i++) button?.click();
        }),
      ]);
      for (const popup of page.context().pages()) if (popup !== page) await popup.close();
      const list = new ContentListPage(page, M);
      await list.open();
      const copies = (await list.readCards()).filter((card) => card.excerpt === excerpt).length;
      note(`${copies} item(s) after 5 rapid clicks`);
      expect(copies, 'only one item').toBe(1);
    } finally {
      note(`Cleanup: deleted ${await deleteNewsWhere(page, (card) => card.excerpt === excerpt, M)} item(s).`);
    }
  });
});

test.describe('SC-FKNO-11 ความปลอดภัย', () => {
  test('TC-FKNO-11-01 [High] [Negative] ส่งฟอร์มโดยไม่มี CSRF token', async ({ page }) => {
    const list = new ContentListPage(page, M);
    const before = await list.total();
    const title = `[Auto Test] ไม่มี token ${roleStamp()}`;
    const response = await page.request.post(urlOf('/admin/knowledge'), { multipart: { title, status: 'publish' }, maxRedirects: 0 });
    note(`POST without _token -> ${response.status()}`);
    expect([403, 419], 'refused').toContain(response.status());
    expect(await list.total(), 'nothing created').toBe(before);
    if ((await list.total()) !== before) await deleteNewsWhere(page, (card) => card.title === title, M);
  });

  test('TC-FKNO-11-03 [High] [Negative] XSS ที่ช่องข้อมูลอ้างอิงและลิงก์', async ({ page, browser }) => {
    requireDataCreatingTestsAllowed(SAVES);
    const dialogs = collectDialogs(page);
    await saveAndView(page, browser, { source: IMG_PAYLOAD, authorName: IMG_PAYLOAD }, async ({ excerpt, detail }) => {
      await new ContentListPage(page, M).open();
      await new ContentFormPage(page, M).openEdit((await cardOf(page, excerpt))!.editHref);
      expect(detail?.dialogs ?? [], 'no script runs publicly').toEqual([]);
      expect(detail?.html.match(/<img[^>]+onerror/gi) ?? [], 'no live <img onerror>').toEqual([]);
      expect(referenceBlock(detail)).toContain(IMG_PAYLOAD);
    });
    expect(dialogs, 'no script runs in the admin').toEqual([]);
  });

  test('TC-FKNO-11-05 [High] [Negative] เข้าหน้าสร้างโดยไม่ Login', async ({ page, playwright }) => {
    const list = new ContentListPage(page, M);
    const before = await list.total();
    const anonymous = await playwright.request.newContext({ baseURL: urlOf('/'), storageState: { cookies: [], origins: [] } });
    try {
      const get = await anonymous.get('/admin/knowledge/create');
      note(`GET create (logged out) ended on ${get.url()} (${get.status()})`);
      // The site's login page is /frontend/account/index.
      expect(get.url(), 'sent to the login page').toMatch(/login|signin|auth|\/frontend\/account/i);
      const post = await anonymous.post('/admin/knowledge', { form: { title: `[Auto Test] ไม่ล็อกอิน ${roleStamp()}` }, maxRedirects: 0 });
      note(`POST (logged out) -> ${post.status()} ${post.headers()['location'] ?? ''}`);
      expect([302, 401, 403, 419]).toContain(post.status());
    } finally {
      await anonymous.dispose();
    }
    expect(await list.total(), 'nothing created').toBe(before);
  });
});
