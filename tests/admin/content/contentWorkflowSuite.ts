import { test, expect } from '@fixtures/pages.fixtures';
import { requireDataCreatingTestsAllowed } from '@config/env';
import { Browser, Page } from '@playwright/test';
import { AdminGroupPage } from '@pages/admin/AdminGroupPage';
import { AdminNewsListPage, ContentModule, NewsFormPage } from '@pages/admin/AdminNewsPages';
import { CATEGORY_DESCRIPTION } from '@utils/categoryFlows';
import { createNewsCategory, deleteNewsCategory, fetchAsVisitor, openEditFor, publicNewsList, visitorGet } from '@utils/newsFlows';
import { sheetTitle } from '@utils/caseTitles';
import { roleStamp } from '@utils/roleFlows';
import { collectDialogs } from '@utils/security';
import { drawImage, exeFile, fixtureFile, MB, textFile } from '@utils/uploadFiles';
import {
  cleanupItems,
  COVER_MESSAGE,
  coverAccepted,
  coverRefused,
  DOC_SIZE_MESSAGE,
  docRefused,
  docsAccepted,
  expectContentActionsLogged,
  isOnPublicList,
  itemExcerpt,
  itemTitle,
  KNOWN,
  note,
  pdfFile,
  publicDetailOf,
  saveAccepted,
  saveItem,
  storedFiles,
  thaiShortDate,
  trackItem,
} from './contentCases';

/**
 * The Auto:P workflow cases the sheet repeats for the content modules (KM-NEWS, KM-BP, KM-KNOW): add / edit / publish
 * and unpublish, rich text and sanitising, the cover, draft → publish, counters, last-modified, paging and the
 * activity log. Case numbers differ per module (knowledge has an extra "ไฟล์แนบ" scenario 11, so its later
 * scenarios are shifted by one); `ids` maps each case to the module's number, and a case without a number is not
 * registered. KM-KNOW also gets its extra cases (rich-text toolbar, category edge cases, links, Word paste, image +
 * table, attachments).
 *
 * NOT implemented here: the cases that need a second (non-admin) account to log in (บุคลากรที่ได้รับมอบหมาย, the
 * real creator) — On hold for UAT like TC-ADMU-05-01 — and the cover {MAX_MB} cases (limit not given).
 */
export type WorkflowCase =
  | 'addFull' | 'addEmpty' | 'xss' | 'edit' | 'unpublish' | 'publish' | 'categoryNew' | 'bodyScript' | 'bodyFormat'
  | 'coverJpg' | 'coverPng' | 'coverBad' | 'coverFake' | 'draftEdit' | 'counters' | 'modified' | 'lastPage' | 'activity'
  | 'richText' | 'categoryDeleted' | 'categoryLong' | 'pasteWord' | 'link' | 'jsLink' | 'imageTable'
  | 'attPdf' | 'attOffice' | 'attJpg' | 'attExe' | 'attDouble' | 'attFake' | 'attEmpty' | 'attMax' | 'attOver' | 'attThai' | 'attTraversal' | 'attMulti';

export interface WorkflowSuite {
  module: ContentModule;
  prefix: string;
  /** How the sheet names an item: "ข่าวกิจกรรม KM", "แนวทางปฏิบัติที่ดี (Best Practice)", "บทความ/คลังความรู้". */
  name: string;
  ids: Partial<Record<WorkflowCase, string>>;
}

/** NEWS and BP share these numbers. */
export const LIST_MODULE_IDS: Partial<Record<WorkflowCase, string>> = {
  addFull: '02-01', addEmpty: '02-02', xss: '02-03', edit: '03-01', unpublish: '04-01', publish: '04-02', categoryNew: '07-03',
  bodyScript: '09-03', bodyFormat: '09-04', coverJpg: '10-01', coverBad: '10-02', draftEdit: '11-01', counters: '11-02',
  modified: '11-03', lastPage: '12-01', activity: '13-03',
};

export const KNOWLEDGE_IDS: Partial<Record<WorkflowCase, string>> = {
  addFull: '02-01', addEmpty: '02-02', xss: '02-03', richText: '02-05', edit: '03-01', unpublish: '04-01', publish: '04-02',
  categoryNew: '07-03', categoryDeleted: '07-04', categoryLong: '07-05', bodyScript: '09-03', bodyFormat: '09-04', pasteWord: '09-05',
  link: '09-06', jsLink: '09-07', imageTable: '09-08', coverJpg: '10-01', coverPng: '10-02', coverBad: '10-03', coverFake: '10-04',
  attPdf: '11-01', attOffice: '11-02', attJpg: '11-03', attExe: '11-05', attDouble: '11-06', attFake: '11-07', attEmpty: '11-08',
  attMax: '11-09', attOver: '11-10', attThai: '11-11', attTraversal: '11-12', attMulti: '11-13',
  draftEdit: '12-01', counters: '12-02', modified: '12-03', lastPage: '13-01', activity: '14-03',
};

/** TinyMCE helpers (the editor instance is "content-module-body-input"). */
export async function editorRun(page: Page, script: string, arg?: unknown): Promise<unknown> {
  return page.evaluate(
    ({ code, value }) => {
      const editor = (window as unknown as { tinymce: { get(id: string): unknown } }).tinymce.get('content-module-body-input');
      // eslint-disable-next-line @typescript-eslint/no-implied-eval
      return new Function('editor', 'value', code)(editor, value);
    },
    { code: script, value: arg },
  );
}

/** Removes TinyMCE and puts raw HTML into the body textarea: what a client that skips the editor would post. */
export async function setRawBody(page: Page, html: string): Promise<void> {
  await page.evaluate((value) => {
    const tinymce = (window as unknown as { tinymce: { remove(selector: string): void } }).tinymce;
    tinymce.remove('#content-module-body-input');
    const textarea = document.getElementById('content-module-body-input') as HTMLTextAreaElement;
    textarea.value = value;
  }, html);
}

/** Dispatches a paste of `html` into the editor body (TinyMCE runs its paste filters on it). */
export async function pasteHtml(page: Page, html: string): Promise<void> {
  await page.evaluate((value) => {
    const editor = (window as unknown as { tinymce: { get(id: string): { focus(): void; getBody(): HTMLElement } } }).tinymce.get('content-module-body-input');
    editor.focus();
    const data = new DataTransfer();
    data.setData('text/html', value);
    data.setData('text/plain', value.replace(/<[^>]+>/g, ' '));
    editor.getBody().dispatchEvent(new ClipboardEvent('paste', { clipboardData: data, bubbles: true, cancelable: true }));
  }, html);
  await page.waitForTimeout(500);
}

/** A Word-style clipboard fragment: MsoNormal paragraphs, mso- styles, <o:p>, a heading and a 2×2 table. */
export function wordHtml(stamp: string): string {
  return [
    '<html xmlns:o="urn:schemas-microsoft-com:office:office" xmlns:w="urn:schemas-microsoft-com:office:word"><head><style>p.MsoNormal{mso-style-parent:"";font-family:Calibri}</style></head><body lang=TH>',
    '<!--StartFragment-->',
    `<h1 style="mso-margin-top-alt:auto;mso-outline-level:1"><span style="font-family:'TH Sarabun New';mso-bidi-font-family:'TH Sarabun New'">หัวข้อจากเวิร์ด ${stamp}<o:p></o:p></span></h1>`,
    `<p class=MsoNormal style="mso-line-height-alt:12pt"><span style="font-size:16.0pt;font-family:Calibri;mso-ascii-theme-font:minor-latin">ย่อหน้าจากเวิร์ด ${stamp}<o:p></o:p></span></p>`,
    '<table class=MsoTableGrid border=1 cellspacing=0 cellpadding=0 style="border-collapse:collapse;mso-yfti-tbllook:1184;mso-padding-alt:0cm 5.4pt 0cm 5.4pt">',
    `<tr style="mso-yfti-irow:0"><td style="mso-border-alt:solid windowtext .5pt"><p class=MsoNormal>เซลล์1 ${stamp}<o:p></o:p></p></td><td><p class=MsoNormal>เซลล์2<o:p></o:p></p></td></tr>`,
    '<tr style="mso-yfti-irow:1;mso-yfti-lastrow:yes"><td><p class=MsoNormal>เซลล์3<o:p></o:p></p></td><td><p class=MsoNormal>เซลล์4<o:p></o:p></p></td></tr>',
    '</table><!--EndFragment--></body></html>',
  ].join('');
}

export function contentWorkflowSuite(cfg: WorkflowSuite): void {
  const { module: M, prefix: P, name, ids } = cfg;
  const CREATES = `Saves ${M.key} items (deleted again after the case).`;
  const list = (page: Page): AdminNewsListPage => new AdminNewsListPage(page, M);
  const form = (page: Page): NewsFormPage => new NewsFormPage(page, M);
  /** Registers `body` as TC-<P>-<n> when the module has a number for `key`. */
  const tcase = (key: WorkflowCase, title: string, body: (args: { page: Page; browser: Browser }, id: string) => Promise<void>): void => {
    const n = ids[key];
    if (!n) return;
    const id = `TC-${P}-${n}`;
    test(sheetTitle(id, title), async ({ page, browser }) => {
      requireDataCreatingTestsAllowed(CREATES);
      await body({ page, browser }, id);
    });
  };

  test.beforeEach(() => test.setTimeout(150_000));
  test.afterEach(async ({ page }) => cleanupItems(page));

  tcase('addFull', `[Positive] เพิ่ม${name}สำเร็จด้วยข้อมูลครบ`, async ({ page }, id) => {
    test.fail(true, KNOWN.CREATOR_ADMIN);
    const f = form(page);
    await f.openCreate();
    const options = await f.categoryOptions();
    const category = options.find((o, i) => i > 0 && o !== '' && o !== '— ไม่ระบุ —');
    note(category ? `Category: first in the list = "${category}"` : 'No category exists for this module — saved without one.');
    const excerpt = itemExcerpt('ข้อมูลทดสอบอัตโนมัติ');
    const saved = await saveItem(page, M, id, { excerpt, category, tags: ['auto'], body: '<p>เนื้อหาทดสอบ</p>', status: 'publish' });
    expect(saved.submitted.first, 'saved').toBeLessThan(300);
    expect(page.url(), 'back on the list').toContain(`/admin/${M.key}/index`);
    await expect(list(page).flash.filter({ hasText: M.createdFlash }), 'a success message').toBeVisible();
    const card = await list(page).findByExcerpt(excerpt);
    expect(card, 'listed').toBeTruthy();
    expect(card?.title).toBe(saved.title);
    expect(card?.status, 'status as chosen').toBe('เผยแพร่');
    const today = new Date();
    expect(thaiShortDate(card?.created ?? ''), 'date = today').toEqual({ day: today.getDate(), month: today.getMonth() });
    note(`Card creator: "${card?.creator}"`);
    expect(card?.creator, 'creator = ผู้ดูแลระบบ').toBe('ผู้ดูแลระบบ');
  });

  tcase('addEmpty', `[Negative] เพิ่ม${name}โดยไม่กรอกข้อมูลที่จำเป็น`, async ({ page }) => {
    const before = await list(page).total();
    const f = form(page);
    await f.openCreate();
    let posted = false;
    page.on('request', (r) => {
      if (r.method() === 'POST' && r.url().endsWith(`/admin/${M.key}`)) posted = true;
    });
    await f.saveButton.click();
    await page.waitForTimeout(1000);
    expect(posted, 'nothing is sent').toBe(false);
    expect(page.url()).toContain(`/admin/${M.key}/create`);
    const validity = await f.titleInput.evaluate((input: HTMLInputElement) => ({ missing: input.validity.valueMissing, message: input.validationMessage }));
    note(`Title validation: ${validity.message}`);
    expect(validity.missing, 'the title is flagged as required').toBe(true);
    expect(await list(page).total(), 'nothing is saved').toBe(before);
  });

  tcase('xss', '[Negative] ป้องกัน XSS/HTML Injection ในหัวเรื่องและเนื้อหา', async ({ page, browser }, id) => {
    const dialogs = collectDialogs(page);
    const title = `<script>alert(1)</script> ${itemTitle(id)}`;
    const saved = await saveItem(page, M, id, { title, body: '<p>เนื้อหา XSS</p><img src="x" onerror="alert(1)">' });
    expect(saved.submitted.first, 'saved').toBeLessThan(300);
    const card = await list(page).findByExcerpt(saved.excerpt);
    expect(card?.title, 'the admin list shows the title as text').toBe(title);
    const detail = await publicDetailOf(browser, M, saved);
    expect(detail.text, 'the public page shows the title as text').toContain('<script>alert(1)</script>');
    expect(detail.html, 'no script tag from the title').not.toMatch(/<script>alert\(1\)<\/script>/);
    expect(detail.html, 'no event handler from the body').not.toMatch(/onerror\s*=/i);
    expect([...dialogs, ...detail.dialogs], 'no script ran').toEqual([]);
  });

  tcase('edit', `[Positive] แก้ไข${name}และบันทึก`, async ({ page, browser }, id) => {
    const category = await createNewsCategory(page, 'AUTO_CAT_EDIT', M);
    try {
      const saved = await saveAccepted(page, M, id);
      const editedTitle = itemTitle(id, '_EDIT');
      const f = await openEditFor(page, M, saved.excerpt);
      await f.fill({ title: editedTitle, category });
      expect((await f.save()).first, 'the edit is saved').toBeLessThan(400);
      expect((await list(page).findByExcerpt(saved.excerpt))?.title, 'the admin list shows the new title').toBe(editedTitle);
      const detail = await publicDetailOf(browser, M, { excerpt: saved.excerpt, title: editedTitle });
      expect(detail.text, 'the public page shows the new title').toContain(editedTitle);
      expect(detail.text, 'and the new category').toContain(category);
    } finally {
      note(`Category cleanup: ${(await deleteNewsCategory(page, category, M)) ? 'deleted' : 'NOT deleted'}`);
    }
  });

  tcase('unpublish', '[Positive] ยกเลิกเผยแพร่แล้วต้องหายจากหน้า Public', async ({ page, browser }, id) => {
    const saved = await saveAccepted(page, M, id, { status: 'publish' });
    const detail = await publicDetailOf(browser, M, saved);
    const f = await openEditFor(page, M, saved.excerpt);
    await f.fill({ status: 'draft' });
    expect((await f.save()).first, 'saved as draft').toBeLessThan(400);
    expect(await isOnPublicList(browser, M, saved.excerpt), 'gone from the public list').toBe(false);
    const direct = await visitorGet(browser, new URL(detail.url).pathname);
    note(`Direct URL ${detail.url} → ${direct.status}`);
    expect(direct.status, 'its URL no longer opens').toBe(404);
  });

  tcase('publish', '[Positive] เผยแพร่รายการแล้วต้องแสดงบนหน้า Public', async ({ page, browser }, id) => {
    const saved = await saveAccepted(page, M, id, { status: 'draft' });
    expect(await isOnPublicList(browser, M, saved.excerpt), 'not public while a draft').toBe(false);
    const f = await openEditFor(page, M, saved.excerpt);
    await f.fill({ status: 'publish' });
    expect((await f.save()).first, 'published').toBeLessThan(400);
    const detail = await publicDetailOf(browser, M, saved);
    expect(detail.text).toContain(saved.title);
    const publicList = await publicNewsList(browser, M);
    const firstLink = /href="[^"]*detail\/([^"]+)"/.exec(publicList.html)?.[1] ?? '';
    note(`First item on the public list: ${firstLink}`);
    expect(new URL(detail.url).pathname, 'newest first: it heads the list').toContain(firstLink);
  });

  tcase('categoryNew', '[Positive] หมวดหมู่ที่เพิ่งสร้างต้องปรากฏใน dropdown ทันที', async ({ page }) => {
    const category = await createNewsCategory(page, 'AUTO_CAT_NEW', M);
    try {
      const f = form(page);
      await f.openCreate();
      expect(await f.categoryOptions(), 'the new category is offered').toContain(category);
    } finally {
      note(`Category cleanup: ${(await deleteNewsCategory(page, category, M)) ? 'deleted' : 'NOT deleted'}`);
    }
  });

  tcase('bodyScript', '[Negative] วางสคริปต์/iframe/onclick ในเนื้อหา', async ({ page, browser }, id) => {
    test.fail(true, KNOWN.BODY_NOT_SANITISED);
    const payload = '<p>เนื้อหาสคริปต์</p><script>alert(1)</script><iframe src="https://evil.example/"></iframe><p><a href="#" onclick="alert(2)">คลิก</a></p>';
    // 1) Through the editor (its source view), 2) posted raw (a client that skips the editor).
    const viaEditor = await saveAccepted(page, M, id, { body: payload });
    const f = form(page);
    await f.openCreate();
    const rawTitle = itemTitle(id, '_RAW');
    const rawExcerpt = itemExcerpt('raw');
    trackItem(M, rawExcerpt);
    await f.fill({ title: rawTitle, excerpt: rawExcerpt });
    await setRawBody(page, payload);
    expect((await f.save()).final, 'the raw post is not a server error').toBeLessThan(500);
    for (const saved of [viaEditor, { title: rawTitle, excerpt: rawExcerpt }]) {
      const detail = await publicDetailOf(browser, M, saved);
      expect.soft(detail.dialogs, `${saved.title}: no script ran`).toEqual([]);
      expect.soft(detail.html, `${saved.title}: no <script> from the body`).not.toMatch(/<script>alert\(1\)<\/script>/);
      expect.soft(detail.html, `${saved.title}: no foreign iframe`).not.toContain('evil.example');
      expect.soft(detail.html, `${saved.title}: no onclick handler`).not.toMatch(/onclick\s*=\s*"alert/i);
    }
  });

  tcase('bodyFormat', '[Positive] จัดรูปแบบผสม (ตัวหนา/เอียง/สี/รายการ)', async ({ page, browser }, id) => {
    const s = roleStamp();
    const body = `<p><strong>หนา-${s}</strong> <em>เอียง-${s}</em> <span style="text-decoration: underline;">ขีด-${s}</span> <span style="color: rgb(224, 62, 45);">สี-${s}</span></p><ul><li>หัวข้อ-${s}</li></ul><ol><li>ลำดับ-${s}</li></ol>`;
    const saved = await saveAccepted(page, M, id, { body });
    const inEditor = (await editorRunAfterOpen(page, M, saved.excerpt)) as string;
    const detail = await publicDetailOf(browser, M, saved);
    for (const [label, re] of [
      ['bold', new RegExp(`<strong>หนา-${s}</strong>`)],
      ['italic', new RegExp(`<em>เอียง-${s}</em>`)],
      ['underline', new RegExp(`underline[^>]*>ขีด-${s}`)],
      ['colour', new RegExp(`color:\\s*(rgb\\(224, 62, 45\\)|#e03e2d)[^>]*>สี-${s}`, 'i')],
      ['bullet list', new RegExp(`<ul>\\s*<li>หัวข้อ-${s}`)],
      ['numbered list', new RegExp(`<ol>\\s*<li>ลำดับ-${s}`)],
    ] as [string, RegExp][]) {
      expect(inEditor, `editor keeps ${label}`).toMatch(re);
      expect(detail.html, `public page shows ${label}`).toMatch(re);
    }
  });

  /** Opens the edit form of the item and returns the editor's HTML. */
  async function editorRunAfterOpen(page: Page, module: ContentModule, excerpt: string): Promise<unknown> {
    await openEditFor(page, module, excerpt);
    return editorRun(page, 'return editor.getContent();');
  }

  tcase('coverJpg', '[Positive] รูปปก: ไฟล์ .jpg ขนาดปกติ (200 KB)', async ({ page, browser }, id) => {
    test.fail(true, KNOWN.COVER);
    const jpg = await drawImage(page, 'image.jpg', { width: 1600, height: 900, type: 'image/jpeg', quality: 0.9 });
    note(`image.jpg: ${Math.round(jpg.buffer.length / 1024)} KB`);
    await coverAccepted(page, browser, M, id, jpg);
  });

  tcase('coverPng', '[Positive] รูปปก: ไฟล์ .png ขนาดปกติ', async ({ page, browser }, id) => {
    test.fail(true, KNOWN.COVER);
    const png = await drawImage(page, 'image.png', { width: 1200, height: 675, type: 'image/png', transparent: true });
    await coverAccepted(page, browser, M, id, png);
  });

  tcase('coverBad', '[Negative] รูปปก: ไฟล์ที่ไม่ใช่รูปภาพ (.pdf / .txt)', async ({ page }, id) => {
    await coverRefused(page, M, id, pdfFile('doc.pdf'));
    await coverRefused(page, M, id, textFile('test.txt', '[Auto Test] not an image'));
  });

  tcase('coverFake', '[Negative] รูปปก: ไฟล์ .exe เปลี่ยนนามสกุลเป็น .jpg', async ({ page }, id) => {
    await coverRefused(page, M, id, exeFile('fake.jpg'), COVER_MESSAGE);
  });

  tcase('draftEdit', '[Positive] บันทึกเป็นฉบับร่างแล้วกลับมาแก้ต่อ', async ({ page, browser }, id) => {
    const s = roleStamp();
    const saved = await saveAccepted(page, M, id, { status: 'draft', tags: ['autotest1'], body: `<p>ร่างทดสอบ ${s}</p>`, source: `แหล่งที่มา ${s}` });
    expect(saved.card.status, 'listed as a draft').toBe('ฉบับร่าง');
    expect(await isOnPublicList(browser, M, saved.excerpt), 'a draft is not public').toBe(false);
    const f = await openEditFor(page, M, saved.excerpt);
    expect(await f.titleInput.inputValue(), 'title kept').toBe(saved.title);
    expect(await f.bodyText(), 'body kept').toContain(`ร่างทดสอบ ${s}`);
    expect(await f.tagTexts(), 'tags kept').toContain('autotest1');
    expect(await f.form.locator('input[name="source"]').inputValue(), 'reference kept').toBe(`แหล่งที่มา ${s}`);
    await expect(f.statusRadio('draft'), 'status kept').toBeChecked();
    await f.fill({ status: 'publish' });
    expect((await f.save()).first, 'published').toBeLessThan(400);
    const detail = await publicDetailOf(browser, M, saved);
    expect(detail.text, 'the published page has the saved body').toContain(`ร่างทดสอบ ${s}`);
  });

  tcase('counters', '[Positive] แก้ไขบทความที่เผยแพร่แล้วไม่ทำให้ยอดเข้าชมถูกรีเซ็ต', async ({ page, browser }, id) => {
    const saved = await saveAccepted(page, M, id, { documents: [pdfFile()] });
    // Precondition: views > 0 (and one download).
    await publicDetailOf(browser, M, saved);
    const before = await publicDetailOf(browser, M, saved);
    if (before.media.documents[0]) await fetchAsVisitor(browser, before.media.documents[0].href);
    const cardBefore = await list(page).findByExcerpt(saved.excerpt);
    note(`Before the edit: public views ${before.media.views}, card counters ${cardBefore?.counters.join('/')}`);
    expect(before.media.views ?? 0, 'precondition: the item has been viewed').toBeGreaterThan(0);
    const f = await openEditFor(page, M, saved.excerpt);
    await f.fill({ title: itemTitle(id, '_EDIT') });
    expect((await f.save()).first, 'the edit is saved').toBeLessThan(400);
    const cardAfter = await list(page).findByExcerpt(saved.excerpt);
    const after = await publicDetailOf(browser, M, { excerpt: saved.excerpt, title: cardAfter?.title ?? '' });
    note(`After the edit: public views ${after.media.views}, card counters ${cardAfter?.counters.join('/')}`);
    expect(cardAfter?.counters, 'the card counters are unchanged').toEqual(cardBefore?.counters);
    expect(after.media.views ?? 0, 'views are not reset').toBeGreaterThan(before.media.views ?? 0);
  });

  tcase('modified', '[Positive] วันที่แก้ไขล่าสุดอัปเดตเมื่อแก้ไข', async ({ page }, id) => {
    test.setTimeout(240_000);
    const saved = await saveAccepted(page, M, id);
    const stampOf = async (): Promise<string> => (/แก้ไขล่าสุด\s*:\s*([^\n]+?\d{2}:\d{2})/.exec(await page.locator('.body-content').innerText()) ?? [])[1] ?? '';
    const f = await openEditFor(page, M, saved.excerpt);
    const first = await stampOf();
    note(`แก้ไขล่าสุด before: ${first}`);
    expect(first, 'the form shows a last-modified time').not.toBe('');
    // The time is shown to the minute: wait for the next minute before editing.
    const waitMs = (61 - new Date().getSeconds()) * 1000;
    await page.waitForTimeout(waitMs);
    await f.setBody('<p>เนื้อหาแก้ไขแล้ว</p>');
    expect((await f.save()).first).toBeLessThan(400);
    const card = await list(page).findByExcerpt(saved.excerpt);
    expect(card?.created, 'the created date is unchanged').toBe(saved.card.created);
    await openEditFor(page, M, saved.excerpt);
    const second = await stampOf();
    note(`แก้ไขล่าสุด after: ${second}`);
    expect(second, 'last-modified moved on').not.toBe(first);
  });

  tcase('lastPage', "[Positive] ท้ายรายการ 'แสดง x-y รายการ จาก n' ถูกต้องที่หน้าสุดท้าย", async ({ page }, id) => {
    test.setTimeout(900_000);
    const l = list(page);
    await l.open();
    let counter = await l.counter();
    let made = 0;
    // Add items until the list needs a second page and the last page is not full.
    while (made < 25) {
      if (counter && counter.to < counter.total && counter.total % (counter.to - counter.from + 1) !== 0) break;
      await saveItem(page, M, id, { title: itemTitle(id, `_${made + 1}`) });
      made++;
      await l.open();
      counter = await l.counter();
    }
    note(`Added ${made} item(s); page 1 counter ${JSON.stringify(counter)}`);
    expect(counter && counter.to < counter.total, 'the list has more than one page').toBe(true);
    const size = (counter?.to ?? 0) - (counter?.from ?? 0) + 1;
    const total = counter?.total ?? 0;
    const lastPage = Math.ceil(total / size);
    await l.open(`?page=${lastPage}`);
    const last = await l.counter();
    const cards = await l.cards.count();
    note(`Page ${lastPage}: ${JSON.stringify(last)}, ${cards} card(s); page size ${size}`);
    expect(last, `"แสดง ${(lastPage - 1) * size + 1}-${total} รายการ จาก ${total} รายการ"`).toEqual({ from: (lastPage - 1) * size + 1, to: total, total });
    expect(cards, 'the cards are the remaining items').toBe(total - (lastPage - 1) * size);
  });

  tcase('activity', '[Positive] การเพิ่ม/แก้/ลบถูกบันทึกในประวัติการใช้งาน', async ({ page }, id) => {
    test.fail(true, KNOWN.NO_ACTIVITY_LOG);
    await expectContentActionsLogged(page, M, id);
  });

  // ---- KM-KNOW extras ----

  tcase('richText', '[Positive] จัดรูปแบบเนื้อหาด้วย Rich-text editor', async ({ page, browser }, id) => {
    const s = roleStamp();
    const f = form(page);
    await f.openCreate();
    const title = itemTitle(id);
    const excerpt = itemExcerpt();
    trackItem(M, excerpt);
    await f.fill({ title, excerpt });
    await editorRun(page, `editor.setContent('<p>ข้อความจัดรูปแบบ ${s}</p>'); editor.selection.select(editor.getBody().firstChild, true);
      ['Bold','Italic','Underline'].forEach((c) => editor.execCommand(c));
      editor.execCommand('ForeColor', false, '#e03e2d'); editor.execCommand('HiliteColor', false, '#fbeeb8'); editor.execCommand('FontSize', false, '24px');`);
    const formatted = (await editorRun(page, 'return editor.getContent();')) as string;
    await editorRun(page, "editor.execCommand('Undo');");
    const undone = (await editorRun(page, 'return editor.getContent();')) as string;
    await editorRun(page, "editor.execCommand('Redo');");
    const redone = (await editorRun(page, 'return editor.getContent();')) as string;
    note(`After formatting: ${formatted}`);
    expect(undone, 'Undo removes the last format (font size)').not.toBe(formatted);
    expect(redone, 'Redo puts it back').toBe(formatted);
    for (const re of [/<strong>|font-weight:\s*bold/, /<em>|font-style:\s*italic/, /underline/, /color:\s*(#e03e2d|rgb\(224, 62, 45\))/i, /background-color/, /font-size:\s*24px/]) expect(formatted, `editor: ${re}`).toMatch(re);
    expect((await f.save()).first, 'saved').toBeLessThan(400);
    const detail = await publicDetailOf(browser, M, { excerpt, title });
    for (const re of [/<strong>|font-weight:\s*bold/, /<em>|font-style:\s*italic/, /underline/, /color:\s*(#e03e2d|rgb\(224, 62, 45\))/i, /background-color/, /font-size:\s*24px/]) expect(detail.html, `public: ${re}`).toMatch(re);
  });

  tcase('categoryDeleted', '[Negative] หมวดหมู่ถูกลบขณะกรอกฟอร์มค้างอยู่', async ({ page }, id) => {
    test.fail(true, KNOWN.DELETED_CATEGORY_SILENT);
    const category = await createNewsCategory(page, 'AUTO_CAT_DEL', M);
    const f = form(page);
    await f.openCreate();
    const title = itemTitle(id);
    const excerpt = itemExcerpt();
    trackItem(M, excerpt);
    await f.fill({ title, excerpt, category });
    // Another tab deletes the category.
    const other = await page.context().newPage();
    try {
      expect(await deleteNewsCategory(other, category, M), 'the category is deleted in the other tab').toBe(true);
    } finally {
      await other.close();
    }
    const submitted = await f.save();
    note(`Save after the category was deleted: ${submitted.first} → ${submitted.final} (${submitted.url})`);
    expect(submitted.final, 'no server error').toBeLessThan(500);
    const messages = await f.messages().catch(() => []);
    const flash = (await page.locator('.alert').allInnerTexts().catch(() => [])).join(' | ');
    note(`Messages: ${messages.map((m) => m.text).join(' | ') || '(none)'}; flash: ${flash || '(none)'}`);
    const card = await list(page).findByExcerpt(excerpt);
    if (card) note(`Saved; its category in the edit form: "${await (await openEditFor(page, M, excerpt)).selectedCategory()}"`);
    expect(messages.length > 0 || /หมวดหมู่/.test(flash), 'the user is told the category no longer exists').toBe(true);
  });

  tcase('categoryLong', '[Negative] ชื่อหมวดหมู่ยาวมากใน dropdown', async ({ page }) => {
    test.fail(true, KNOWN.LONG_CATEGORY);
    const groups = new AdminGroupPage(page);
    const name = `หมวดหมู่ชื่อยาว ${roleStamp()} `.padEnd(150, 'ก');
    await groups.open(M.categoryTab);
    await groups.openAddForm();
    await groups.fill({ name, description: CATEGORY_DESCRIPTION, status: 'publish' });
    expect((await groups.save()).status()).toBeLessThan(500);
    try {
      const f = form(page);
      await f.openCreate();
      expect(await f.categoryOptions(), 'the long name is offered').toContain(name);
      const picker = page.locator('.bootstrap-select').filter({ has: f.categorySelect });
      await picker.locator('button.dropdown-toggle').click();
      const menu = picker.locator('div.dropdown-menu.show');
      await expect(menu).toBeVisible();
      const box = await menu.boundingBox();
      const width = page.viewportSize()?.width ?? 0;
      note(`Dropdown box: x=${box?.x} w=${box?.width}, window ${width}`);
      expect((box?.x ?? 0) + (box?.width ?? 0), 'the dropdown stays inside the window').toBeLessThanOrEqual(width + 1);
      await menu.locator('a[role="option"]', { hasText: name.slice(0, 40) }).first().click();
      expect(await f.selectedCategory(), 'it can be chosen').toBe(name);
    } finally {
      note(`Category cleanup: ${(await deleteNewsCategory(page, name, M)) ? 'deleted' : 'NOT deleted'}`);
    }
  });

  tcase('pasteWord', '[Positive] วางข้อความจาก Microsoft Word', async ({ page, browser }, id) => {
    const s = roleStamp();
    const f = form(page);
    await f.openCreate();
    const title = itemTitle(id);
    const excerpt = itemExcerpt();
    trackItem(M, excerpt);
    await f.fill({ title, excerpt });
    await editorRun(page, "editor.setContent('');");
    await pasteHtml(page, wordHtml(s));
    const pasted = (await editorRun(page, 'return editor.getContent();')) as string;
    note(`Pasted: ${pasted.slice(0, 400)}`);
    expect(pasted, 'the pasted text is there').toContain(`ย่อหน้าจากเวิร์ด ${s}`);
    expect((await f.save()).first).toBeLessThan(400);
    const detail = await publicDetailOf(browser, M, { excerpt, title });
    expect(detail.html, 'the heading is kept').toMatch(new RegExp(`<h[1-6][^>]*>[^<]*(<[^>]+>)*หัวข้อจากเวิร์ด ${s}`));
    expect(detail.html, 'the table is kept').toMatch(new RegExp(`<table[\\s\\S]*เซลล์1 ${s}[\\s\\S]*เซลล์4[\\s\\S]*</table>`));
    expect(detail.html, 'no Word-only markup is left (mso- styles, <o:p>)').not.toMatch(/mso-|<o:p>/);
    note(`Word class names left: ${/Mso[A-Za-z]+/.test(detail.html) ? 'yes (class="MsoNormal" etc. — harmless)' : 'none'}`);
  });

  tcase('link', '[Positive] แทรกลิงก์ในเนื้อหา', async ({ page, browser }, id) => {
    const s = roleStamp();
    const f = form(page);
    await f.openCreate();
    const title = itemTitle(id);
    const excerpt = itemExcerpt();
    trackItem(M, excerpt);
    await f.fill({ title, excerpt });
    await editorRun(page, `editor.setContent('<p>ลิงก์ทดสอบ ${s}</p>'); editor.selection.select(editor.getBody().firstChild, true); editor.execCommand('mceInsertLink', false, { href: 'https://www.example.com', target: '_blank' });`);
    expect((await f.save()).first).toBeLessThan(400);
    const detail = await publicDetailOf(browser, M, { excerpt, title });
    const anchor = new RegExp(`<a[^>]*href="https://www\\.example\\.com/?"[^>]*>[^<]*ลิงก์ทดสอบ ${s}`);
    expect(detail.html, 'the link is on the public page').toMatch(anchor);
    const tag = (detail.html.match(new RegExp(`<a[^>]*href="https://www\\.example\\.com/?"[^>]*>`)) ?? [''])[0];
    note(`Link: ${tag}`);
    if (/target="_blank"/.test(tag)) expect(tag, 'a new-tab link has rel=noopener').toMatch(/rel="[^"]*noopener/);
  });

  tcase('jsLink', '[Negative] ลิงก์ที่เป็น javascript: ในเนื้อหา', async ({ page, browser }, id) => {
    test.fail(true, KNOWN.BODY_NOT_SANITISED);
    const body = '<p><a href="javascript:alert(1)">ลิงก์อันตราย</a></p>';
    const viaEditor = await saveAccepted(page, M, id, { body });
    const f = form(page);
    await f.openCreate();
    const rawTitle = itemTitle(id, '_RAW');
    const rawExcerpt = itemExcerpt('raw');
    trackItem(M, rawExcerpt);
    await f.fill({ title: rawTitle, excerpt: rawExcerpt });
    await setRawBody(page, body);
    expect((await f.save()).final).toBeLessThan(500);
    for (const saved of [viaEditor, { title: rawTitle, excerpt: rawExcerpt }]) {
      const detail = await publicDetailOf(browser, M, saved);
      expect.soft(detail.html, `${saved.title}: no javascript: link`).not.toMatch(/href\s*=\s*"\s*javascript:/i);
    }
  });

  tcase('imageTable', '[Positive] แทรกรูปและตารางในเนื้อหา', async ({ page, browser }, id) => {
    const s = roleStamp();
    const rows = [1, 2, 3].map((r) => `<tr>${[1, 2, 3].map((c) => `<td>แถว${r}คอลัมน์${c}ข้อความยาวสำหรับทดสอบ</td>`).join('')}</tr>`).join('');
    const body = `<p><img src="/images/image.png" alt="รูปทดสอบ ${s}" width="1200" height="675"></p><table style="border-collapse: collapse; width: 100%;" border="1"><tbody>${rows}</tbody></table>`;
    const saved = await saveAccepted(page, M, id, { body });
    const detail = await publicDetailOf(browser, M, saved, { width: 375, height: 812 });
    expect(detail.html, 'the image is on the page').toContain(`alt="รูปทดสอบ ${s}"`);
    expect(detail.html, 'the 3×3 table is on the page').toContain('แถว3คอลัมน์3');
    note(`Horizontal overflow at 375 px: ${detail.media.overflowX}px`);
    expect(detail.media.overflowX, 'nothing overflows the phone screen').toBeLessThanOrEqual(1);
  });

  tcase('attPdf', '[Positive] ไฟล์แนบ: แนบไฟล์ .pdf ขนาดปกติ', async ({ page, browser }, id) => {
    await docsAccepted(page, browser, M, id, [pdfFile('sample.pdf', 300 * 1024)]);
  });

  tcase('attOffice', '[Positive] ไฟล์แนบ: แนบไฟล์ .docx / .xlsx', async ({ page, browser }, id) => {
    await docsAccepted(page, browser, M, id, [fixtureFile('sample.docx'), fixtureFile('sample.xlsx')]);
  });

  tcase('attJpg', '[Positive] ไฟล์แนบ: แนบรูป .jpg', async ({ page, browser }, id) => {
    test.fail(true, KNOWN.IMAGE_ATTACHMENT);
    const jpg = await drawImage(page, 'photo.jpg', { width: 800, height: 600, type: 'image/jpeg' });
    await docsAccepted(page, browser, M, id, [jpg]);
  });

  tcase('attExe', '[Negative] ไฟล์แนบ: ไฟล์ .exe / .bat / .js', async ({ page }, id) => {
    for (const file of [exeFile('test.exe'), textFile('run.bat', '@echo [Auto Test]'), textFile('script.js', 'alert(1)')]) await docRefused(page, M, id, [file]);
  });

  tcase('attDouble', '[Negative] ไฟล์แนบ: นามสกุลซ้อน', async ({ page }, id) => {
    await docRefused(page, M, id, [exeFile('report.pdf.exe')]);
  });

  tcase('attFake', '[Negative] ไฟล์แนบ: ไฟล์ปลอมนามสกุล (.exe เปลี่ยนเป็น .pdf)', async ({ page }, id) => {
    await docRefused(page, M, id, [exeFile('fake.pdf')]);
  });

  tcase('attEmpty', '[Negative] ไฟล์แนบ: ไฟล์ขนาด 0 ไบต์', async ({ page }, id) => {
    const refusal = await docRefused(page, M, id, [{ name: 'empty.pdf', mimeType: 'application/pdf', buffer: Buffer.alloc(0) }]);
    note(`Expected wording "ไฟล์ว่างเปล่า"; shown: ${refusal.messages.map((m) => m.text).join(' | ')}`);
  });

  tcase('attMax', '[Positive] ไฟล์แนบ: ขนาดเท่าค่าสูงสุดพอดี', async ({ page, browser }, id) => {
    note('Maximum = 10 MB, as the form states ("ไม่เกิน 10 MB/ไฟล์").');
    await docsAccepted(page, browser, M, id, [pdfFile('max10.pdf', 10 * MB)], { download: false });
  });

  tcase('attOver', '[Negative] ไฟล์แนบ: ขนาดเกินค่าสูงสุด', async ({ page }, id) => {
    await docRefused(page, M, id, [pdfFile('over10.pdf', 10 * MB + 1024)], DOC_SIZE_MESSAGE);
  });

  tcase('attThai', '[Positive] ไฟล์แนบ: ชื่อไฟล์ภาษาไทยและมีช่องว่าง', async ({ page, browser }, id) => {
    await docsAccepted(page, browser, M, id, [pdfFile('เอกสาร แนบ 1.pdf')]);
  });

  tcase('attTraversal', '[Negative] ไฟล์แนบ: ชื่อไฟล์เป็น path traversal', async ({ page, browser }, id) => {
    test.fail(true, KNOWN.TRAVERSAL_DOWNLOAD);
    const saved = await saveItem(page, M, id, { documents: [pdfFile('../../evil.pdf')] });
    expect(saved.submitted.final, 'no server error').toBeLessThan(500);
    const card = await list(page).findByExcerpt(saved.excerpt);
    if (!card) {
      note('The file was refused.');
      return;
    }
    const stored = (await storedFiles(page, M, saved.excerpt)).documents;
    note(`Stored as: ${stored.join(' | ')}`);
    for (const nameShown of stored) expect(nameShown, 'the name has no path parts').not.toMatch(/\.\.|[\\/]/);
    const detail = await publicDetailOf(browser, M, saved);
    for (const doc of detail.media.documents) {
      expect(doc.href, 'served from the attachment route').toMatch(/\/attachments\/[^/]+\/download$/);
      expect((await fetchAsVisitor(browser, doc.href)).status, 'and downloads').toBe(200);
    }
  });

  tcase('attMulti', '[Positive] ไฟล์แนบ: แนบหลายไฟล์พร้อมกัน (ถ้ารองรับ)', async ({ page, browser }, id) => {
    await docsAccepted(page, browser, M, id, [pdfFile('a.pdf'), fixtureFile('sample.docx', 'b.docx'), fixtureFile('sample.xlsx', 'c.xlsx')]);
  });
}
