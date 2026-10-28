import { test, expect } from '@fixtures/pages.fixtures';
import { requireDataCreatingTestsAllowed } from '@config/env';
import { Browser, Page } from '@playwright/test';
import { ContentModule, NewsFormPage } from '@pages/admin/AdminNewsPages';
import { sheetTitle } from '@utils/caseTitles';
import { openEditFor } from '@utils/newsFlows';
import { drawImage, exeFile, fixtureFile, gifFile, MB, paddedFile } from '@utils/uploadFiles';
import {
  cleanupItems,
  COVER_MESSAGE,
  DOC_SIZE_MESSAGE,
  DOC_TYPE_MESSAGE,
  expectCoverShown,
  expectDocumentsDownload,
  isOnPublicList,
  KNOWN,
  note,
  pdfFile,
  publicDetailOf,
  publicReach,
  saveAccepted,
  saveRefused,
  storedFiles,
  VIDEO_MESSAGE,
} from './contentCases';

/**
 * KM-FNEW / KM-FBPR Auto:P cases ("ความสอดคล้องกับฟอร์มบทความ" — the news and best-practice forms are the knowledge
 * form): default status, title only, every section, refused documents / videos / covers and draft / hidden items.
 * The case bodies are exported because KM-FKNO repeats them (tests/admin/knowledge/knowledge-files.spec.ts).
 */

/** Saves with only a title (and the marker excerpt) and expects it public at once — the default status is "เผยแพร่". */
export async function defaultIsPublished(page: Page, browser: Browser, M: ContentModule, id: string): Promise<void> {
  const saved = await saveAccepted(page, M, id, {});
  expect(saved.card.status, 'saved with the default status').toBe('เผยแพร่');
  expect(await isOnPublicList(browser, M, saved.excerpt), 'public right after the first save').toBe(true);
  note('Observed: the default status is "เผยแพร่", so a first save publishes at once. The sheet suggests "ฉบับร่าง" as a safer default (SA to decide).');
}

export async function titleOnly(page: Page, browser: Browser, M: ContentModule, id: string): Promise<void> {
  note('Only the title is typed; the excerpt carries the cleanup marker "[Auto Test] … <stamp>".');
  const saved = await saveAccepted(page, M, id, { body: '' });
  expect(saved.card.status).toBe('เผยแพร่');
  const detail = await publicDetailOf(browser, M, saved);
  expect(detail.text).toContain(saved.title);
}

/** Every section filled; the public page shows each one (the cover check is last: DEF-48). */
export async function everySection(page: Page, browser: Browser, M: ContentModule, id: string): Promise<void> {
  const form = new NewsFormPage(page, M);
  await form.openCreate();
  const category = (await form.categoryOptions()).find((o, i) => i > 0 && o && o !== '— ไม่ระบุ —');
  const cover = await drawImage(page, 'cover.png', { width: 1920, height: 1080, type: 'image/png' });
  const saved = await saveAccepted(page, M, id, {
    category,
    tags: ['autotest1', 'autotest2', 'autotest3'],
    body: '<p>เนื้อหาครบทุกส่วน</p>',
    documents: [pdfFile()],
    videoUrl: 'https://www.youtube.com/watch?v=dQw4w9WgXcQ',
    source: 'แหล่งที่มาทดสอบ',
    authorName: 'ผู้แต่งทดสอบ',
    referenceDate: '2026-09-21',
    referenceUrl: 'https://www.example.com/',
    status: 'publish',
    cover,
  });
  const stored = await storedFiles(page, M, saved.excerpt);
  expect(stored.documents, 'the document is saved').toContain('sample.pdf');
  expect(stored.links.join(' '), 'the video link is saved').toContain('dQw4w9WgXcQ');
  expect(stored.cover, 'the cover is saved').not.toBe('');
  const detail = await publicDetailOf(browser, M, saved);
  for (const text of [saved.title, 'เนื้อหาครบทุกส่วน', 'autotest1', 'แหล่งที่มาทดสอบ', 'ผู้แต่งทดสอบ']) expect(detail.text, `the public page shows "${text}"`).toContain(text);
  if (category) expect(detail.text, 'and the category').toContain(category);
  await expectDocumentsDownload(browser, detail.media, ['sample.pdf']);
  expect(detail.media.embeds.map((e) => e.src).join(' '), 'the YouTube player is embedded').toContain('youtube.com/embed/dQw4w9WgXcQ');
  await expectCoverShown(browser, M, saved, saved.card);
}

/** An .exe and a 10 MB + 1 KB PDF together: both refused, each with a message. */
export async function documentsTypeAndSize(page: Page, M: ContentModule, id: string): Promise<void> {
  const refusal = await saveRefused(page, M, id, { documents: [exeFile('test.exe'), pdfFile('big.pdf', 10 * MB + 1024)] }, DOC_TYPE_MESSAGE);
  expect(refusal.messages.map((m) => m.text).join(' | '), 'the size is reported too').toMatch(DOC_SIZE_MESSAGE);
}

/** A .wmv and a 50 MB + 1 KB mp4 together: refused (the message is in the video tab — DEF-84). */
export async function videosTypeAndSize(page: Page, M: ContentModule, id: string): Promise<void> {
  const big = paddedFile(fixtureFile('clip.mp4'), 50 * MB + 1024, 'big.mp4');
  await saveRefused(page, M, id, { videoFiles: [fixtureFile('clip.wmv', 'test.wmv'), big] }, VIDEO_MESSAGE);
}

/** A GIF cover: the sheet expects "รองรับไฟล์ jpeg, png" (DEF-85: GIF is accepted). */
export async function coverGif(page: Page, M: ContentModule, id: string): Promise<void> {
  await saveRefused(page, M, id, { cover: gifFile('image.gif') }, COVER_MESSAGE);
}

/** Saved as `status`: listed in the admin with that badge, but not on the public list, the search or its URL. */
export async function notPublicAs(page: Page, browser: Browser, M: ContentModule, id: string, status: 'draft' | 'hide'): Promise<void> {
  const label = status === 'draft' ? 'ฉบับร่าง' : 'ซ่อน';
  const saved = await saveAccepted(page, M, id, { status });
  expect(saved.card.status, `the admin list shows "${label}"`).toBe(label);
  expect(await isOnPublicList(browser, M, saved.excerpt), `${label}: not on the public list`).toBe(false);
  const reach = await publicReach(browser, M, saved.title);
  note(`${label}: direct URL → ${reach.direct}, found by the search: ${reach.search}`);
  expect(reach.search, `${label}: not found by the search`).toBe(false);
  expect(reach.direct, `${label}: its URL answers 404`).toBe(404);
  const form = await openEditFor(page, M, saved.excerpt);
  expect(await form.titleInput.inputValue(), `${label}: still editable in the admin`).toBe(saved.title);
}

export interface FilesSuite {
  module: ContentModule;
  prefix: string;
  name: string;
}

export function contentFilesSuite(cfg: FilesSuite): void {
  const { module: M, prefix: P, name } = cfg;
  const CREATES = `Saves ${M.key} items (deleted again after the case).`;
  const id = (n: string): string => `TC-${P}-${n}`;

  test.beforeEach(() => test.setTimeout(180_000));
  test.afterEach(async ({ page }) => cleanupItems(page));

  test(sheetTitle(id('01-02')), async ({ page, browser }) => {
    requireDataCreatingTestsAllowed(CREATES);
    await defaultIsPublished(page, browser, M, id('01-02'));
  });

  test(sheetTitle(id('02-02')), async ({ page, browser }) => {
    requireDataCreatingTestsAllowed(CREATES);
    await titleOnly(page, browser, M, id('02-02'));
  });

  test(sheetTitle(id('02-03')), async ({ page, browser }) => {
    requireDataCreatingTestsAllowed(CREATES);
    test.fail(true, KNOWN.COVER);
    await everySection(page, browser, M, id('02-03'));
  });

  test(sheetTitle(id('02-04')), async ({ page }) => {
    requireDataCreatingTestsAllowed(CREATES);
    test.fail(true, KNOWN.ONE_MESSAGE_ONLY);
    await documentsTypeAndSize(page, M, id('02-04'));
  });

  test(sheetTitle(id('02-05')), async ({ page }) => {
    requireDataCreatingTestsAllowed(CREATES);
    test.fail(true, KNOWN.VIDEO_ERROR_HIDDEN);
    await videosTypeAndSize(page, M, id('02-05'));
  });

  test(sheetTitle(id('02-06')), async ({ page }) => {
    requireDataCreatingTestsAllowed(CREATES);
    test.fail(true, KNOWN.COVER_GIF_WEBP);
    await coverGif(page, M, id('02-06'));
  });

  test(sheetTitle(id('02-09')), async ({ page, browser }) => {
    requireDataCreatingTestsAllowed(CREATES);
    note(`${name}: draft and hidden items.`);
    await notPublicAs(page, browser, M, id('02-09'), 'draft');
    await notPublicAs(page, browser, M, id('02-09'), 'hide');
  });
}
