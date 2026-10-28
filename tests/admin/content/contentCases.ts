import { test, expect } from '@fixtures/pages.fixtures';
import { Browser, Page } from '@playwright/test';
import { AdminActivityLogPage } from '@pages/admin/AdminActivityLogPage';
import { AdminNewsListPage, ContentModule, NewsCard, NewsFormPage, NewsFormValues, Submitted } from '@pages/admin/AdminNewsPages';
import {
  deleteNewsWhere,
  fetchAsVisitor,
  openEditFor,
  publicContentDetail,
  publicListCover,
  publicNewsList,
  PublicMedia,
  PublicView,
  submitNews,
  visitorGet,
} from '@utils/newsFlows';
import { roleStamp } from '@utils/roleFlows';
import { AUTO_TEST_FLAG } from '@utils/testData';
import { FilePayload, fixtureFile, paddedFile } from '@utils/uploadFiles';

/**
 * Building blocks for the Auto:P cases of the content modules (news, knowledge, best practice — one form,
 * #content-module-form). Recon + probes 2026-10-06 on Dev:
 * - documents[] (pdf/doc/docx/xls/xlsx/ppt/pptx, 10 MB each: 10 MB is accepted, 10 MB + 1 KB refused), video_file[]
 *   (mp4/mov/avi/mkv/webm), video_url (one link per line), cover_image. The server checks the real file type (an .exe
 *   renamed .pdf is refused) and answers 422; the form's script then re-posts natively and the form comes back with
 *   red .text-xsmall messages ("รองรับเฉพาะไฟล์ …", "ไฟล์ต้องมีขนาดไม่เกิน 10 MB"); the chosen files are gone.
 * - Saved documents are served by /attachments/<id>/download (200, Content-Disposition with the original name).
 *   Covers and video files are linked as /storage/... and answer 404 (DEF-48).
 * - The edit form lists saved documents (tab "อัปโหลดไฟล์") and saved videos + links ("วิดีโอที่บันทึกไว้แล้ว").
 * - Public detail: cover <img alt=title>, "เอกสารแนบ" links, <video controls>, YouTube links become /embed/ iframes.
 * - The activity log records no content action (probe items were created and deleted, nothing was logged).
 *
 * Data: every item is saved with "[Auto Test] … <stamp>" in its excerpt and an ASCII title "AUTO_<case> <stamp>" (so
 * its public slug is known); `trackItem` remembers it and `cleanupItems` (afterEach) deletes it.
 */

export const KNOWN = {
  STORAGE_404: 'Known bug (DEF-48): files saved under /storage (cover images, uploaded videos) answer HTTP 404, so they cannot be shown or played.',
  COVER: 'Known bug (DEF-87): the public detail page does not show the cover at all (its block is commented out in the HTML). The cover itself loads on the list card (/storage works again since 2026-10-07).',
  LONG_CATEGORY: 'Known bug (DEF-98): a 150-character category name makes the category dropdown wider than the window (the menu runs off the right edge).',
  VIDEO_ERROR_HIDDEN: 'Known bug (DEF-84): a refused video file is only reported inside the closed "วิดีโอประกอบ" tab — after saving the user sees no message.',
  COVER_GIF_WEBP: "Known bug (DEF-85): the cover accepts GIF/WEBP although the form says 'รองรับไฟล์ jpeg, png' (the server rule allows PNG, JPEG, GIF, WEBP).",
  NO_ACTIVITY_LOG: 'Known bug (DEF-86): creating, editing and deleting content is not recorded in "ประวัติการใช้งานระบบ".',
  BODY_NOT_SANITISED: 'Known bug (DEF-90): the content body is not sanitised by the server — a raw post keeps javascript: links, and an <iframe> from any site (also through the editor) is shown on the public page.',
  BROKEN_FILES: 'Known bug (DEF-91): upload checks look only at the file header — a cut-off PDF/JPEG is accepted, and a cover named "image.jpg.exe" is accepted when its content is an image.',
  TRAVERSAL_DOWNLOAD: 'Known bug (DEF-92): a document uploaded as "../../evil.pdf" is listed as "evil.pdf" but its download answers HTTP 500.',
  NO_DOWNLOAD_COUNT: 'Known bug (DEF-93): downloads are not counted — the download icon on the admin card shows the number of attachments and does not change after a download.',
  SCHEDULE_NOT_PUBLISHED: 'Known bug (DEF-94): an item scheduled for a later time ("กำหนดวันและเวลา") does not appear on the public site when that time has come.',
  ONE_MESSAGE_ONLY: 'Known bug (DEF-95): with several refused documents only one message is shown (the type error) — the oversized file is not reported.',
  DELETED_CATEGORY_SILENT: 'Known bug (DEF-96): when the chosen category is deleted while the form is open, saving succeeds without telling the user.',
  IMAGE_ATTACHMENT: 'Known bug / spec mismatch (DEF-97): KM-KNOW expects a .jpg to be accepted as an attachment; the form only takes pdf/doc/xls/ppt files (SA to decide).',
  BIG_REQUEST_HANGS: 'Known bug (DEF-99): a 150 MB save (5 × 10 MB documents + 2 × 50 MB videos) gets no answer — the form script gives up after 2 minutes, its fallback post hangs, and the user sees no message.',
  CREATOR_ADMIN: 'Known bug (DEF-89): the admin list card names the creator "Admin" instead of the account name "ผู้ดูแลระบบ" (the edit form shows "สร้างโดย : ผู้ดูแลระบบ").',
};

export function note(description: string): void {
  test.info().annotations.push({ type: 'note', description });
}

/** "TC-FKNO-02-01" → "AUTO_FKNO_02_01 <stamp>" (ASCII, so the public slug is predictable). */
export function itemTitle(id: string, suffix = ''): string {
  return `AUTO_${id.replace(/^TC-/, '').replace(/-/g, '_')}${suffix} ${roleStamp()}`;
}

export function itemExcerpt(label = 'ทดสอบอัตโนมัติ'): string {
  return `${AUTO_TEST_FLAG} ${label} ${roleStamp()}`;
}

const tracked: { module: ContentModule; match: (card: NewsCard) => boolean }[] = [];

export function trackItem(module: ContentModule, excerpt: string): void {
  tracked.push({ module, match: (card) => card.excerpt === excerpt });
}

/** For items whose excerpt is the field under test: found by a stamp in the title (the marker must still be there). */
export function trackItemWhere(module: ContentModule, match: (card: NewsCard) => boolean): void {
  tracked.push({ module, match });
}

/** afterEach: deletes every item the case saved (marker required). */
export async function cleanupItems(page: Page): Promise<void> {
  let deleted = 0;
  while (tracked.length) {
    const { module, match } = tracked.shift() as { module: ContentModule; match: (card: NewsCard) => boolean };
    deleted += await deleteNewsWhere(page, match, module).catch(() => 0);
  }
  if (deleted) note(`Cleanup: deleted ${deleted} item(s).`);
}

export interface Saved {
  title: string;
  excerpt: string;
  submitted: Submitted;
}

/** Opens the create form, fills `values` (+ a fresh title/excerpt unless given, body "เนื้อหาทดสอบ") and saves. */
export async function saveItem(page: Page, M: ContentModule, id: string, values: NewsFormValues = {}): Promise<Saved> {
  const title = values.title ?? itemTitle(id);
  const excerpt = values.excerpt ?? itemExcerpt();
  trackItem(M, excerpt);
  const { submitted } = await submitNews(page, { body: '<p>เนื้อหาทดสอบ</p>', ...values, title, excerpt }, M);
  return { title, excerpt, submitted };
}

/** Saves and expects success: the fetch answers 2xx, the browser lands on the list, the card is listed. */
export async function saveAccepted(page: Page, M: ContentModule, id: string, values: NewsFormValues = {}): Promise<Saved & { card: NewsCard }> {
  const saved = await saveItem(page, M, id, values);
  expect(saved.submitted.first, 'the server accepts the save (2xx)').toBeGreaterThanOrEqual(200);
  expect(saved.submitted.first, 'the server accepts the save (2xx)').toBeLessThan(300);
  const card = await new AdminNewsListPage(page, M).findByExcerpt(saved.excerpt);
  expect(card, 'the item is listed in the admin').toBeTruthy();
  return { ...saved, card: card as NewsCard };
}

export interface Refusal {
  saved: Saved;
  messages: { text: string; visible: boolean }[];
}

/**
 * Saves and expects a refusal: no server error, the form comes back, a message matching `message` is in the form,
 * nothing is saved — and, last, that message can be seen (`visible` is checked last so a hidden message is the
 * only failing step).
 */
export async function saveRefused(page: Page, M: ContentModule, id: string, values: NewsFormValues, message: RegExp): Promise<Refusal> {
  const saved = await saveItem(page, M, id, values);
  expect(saved.submitted.final, 'no server error').toBeLessThan(500);
  expect(page.url(), 'the form comes back').toMatch(/\/(create|edit)(\?|$)/);
  const messages = await new NewsFormPage(page, M).messages();
  note(`Messages: ${messages.map((m) => `${m.text}${m.visible ? '' : ' (hidden)'}`).join(' | ') || '(none)'}`);
  const hit = messages.find((m) => message.test(m.text));
  expect(hit, `a message like ${message}`).toBeTruthy();
  expect(await new AdminNewsListPage(page, M).findByExcerpt(saved.excerpt), 'nothing is saved').toBeUndefined();
  expect(hit?.visible, 'the message can be seen').toBe(true);
  return { saved, messages };
}

export const DOC_TYPE_MESSAGE = /รองรับเฉพาะไฟล์ \.doc/;
export const DOC_SIZE_MESSAGE = /ขนาดไม่เกิน 10 MB/;
export const VIDEO_MESSAGE = /รองรับเฉพาะไฟล์วิดีโอ|ขนาดไม่เกิน 50 MB|วิดีโอ/;
export const COVER_MESSAGE = /รองรับเฉพาะไฟล์รูปภาพ/;

/** Original names of the files the edit form lists as saved. */
export async function storedFiles(page: Page, M: ContentModule, excerpt: string): Promise<{ documents: string[]; videos: string[]; links: string[]; cover: string; form: NewsFormPage }> {
  const form = await openEditFor(page, M, excerpt);
  const documents = (await form.savedFiles('documents')).map((f) => f.original).filter(Boolean);
  const videoItems = await form.savedFiles('videos');
  return {
    documents,
    videos: videoItems.map((f) => f.original).filter(Boolean),
    links: videoItems.map((f) => f.url).filter(Boolean),
    cover: await form.coverSrc(),
    form,
  };
}

/** The public detail of a saved item (must be published and listed). */
export async function publicDetailOf(browser: Browser, M: ContentModule, saved: { excerpt: string; title: string }, viewport?: { width: number; height: number }): Promise<PublicView & { media: PublicMedia }> {
  const detail = await publicContentDetail(browser, saved.excerpt, saved.title, M, viewport);
  expect(detail, 'the item is on the public list').toBeTruthy();
  const shown = detail as PublicView & { media: PublicMedia };
  expect(shown.status, 'its detail page opens').toBe(200);
  return shown;
}

export async function isOnPublicList(browser: Browser, M: ContentModule, excerpt: string): Promise<boolean> {
  return (await publicNewsList(browser, M)).text.includes(excerpt);
}

/** Visitor GET of the item's slug URL and of the site search for its stamp. */
export async function publicReach(browser: Browser, M: ContentModule, title: string): Promise<{ direct: number; search: boolean }> {
  const slug = title.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
  const direct = await visitorGet(browser, `${M.publicDetail}${slug}`);
  // Search by the stamp; the page repeats the query, so a hit is the full title in the results.
  const stamp = title.split(' ').pop() as string;
  const search = await visitorGet(browser, `/frontend/search/index?q=${encodeURIComponent(stamp)}`);
  return { direct: direct.status, search: search.text.includes(title) };
}

/** Every document link downloads (200) with its name in Content-Disposition. */
export async function expectDocumentsDownload(browser: Browser, media: PublicMedia, names: string[]): Promise<void> {
  expect(media.documents.length, 'the "เอกสารแนบ" block lists the documents').toBeGreaterThanOrEqual(names.length);
  for (const doc of media.documents) {
    const got = await fetchAsVisitor(browser, doc.href);
    note(`Download "${doc.name}": ${got.status} ${got.type} ${got.disposition}`);
    expect(got.status, `"${doc.name}" downloads`).toBe(200);
  }
  const dispositions = await Promise.all(media.documents.map(async (doc) => decodeURIComponent((await fetchAsVisitor(browser, doc.href)).disposition)));
  for (const name of names) expect(dispositions.join(' | '), `a download is named "${name}"`).toContain(name);
}

/**
 * The cover is on the admin card and the public list card, the image itself loads and the public detail shows it
 * (DEF-87: the detail's cover block is commented out). The last checks are soft, so every failing one is reported.
 */
export async function expectCoverShown(browser: Browser, M: ContentModule, saved: { excerpt: string; title: string }, card: NewsCard): Promise<string> {
  expect(card.cover, 'the admin card shows the uploaded cover (not the placeholder)').not.toMatch(/\/images\/image\.png$/);
  const listCover = await publicListCover(browser, saved.excerpt, M);
  note(`Public list card image: ${listCover}`);
  expect(listCover, 'the public list card shows the uploaded cover').toMatch(/\/covers\//);
  const got = await fetchAsVisitor(browser, listCover);
  note(`Cover ${listCover} → ${got.status} ${got.type}`);
  expect.soft(got.status, 'the cover image loads').toBe(200);
  expect.soft(got.type, 'it is served as an image').toMatch(/^image\//);
  const detail = await publicDetailOf(browser, M, saved);
  expect.soft(detail.media.cover, 'the public detail shows the cover').toBeTruthy();
  return listCover;
}

/** Every uploaded video has a <video> on the public detail and its file loads. */
export async function expectVideosPlayable(browser: Browser, media: PublicMedia, count: number): Promise<void> {
  expect(media.videos.length, 'the public detail has a <video> per uploaded file').toBeGreaterThanOrEqual(count);
  for (const src of media.videos) {
    const got = await fetchAsVisitor(browser, src);
    note(`Video ${src} → ${got.status} ${got.type}`);
    expect(got.status, 'the video file loads').toBe(200);
    expect(got.type, 'it is served as video').toMatch(/^video\//);
  }
}

/** Rows of the activity log (first page) whose item mentions `text`. */
export async function logRowsAbout(page: Page, text: string): Promise<{ action: string; item: string; user: string; ip: string; time: string }[]> {
  const log = new AdminActivityLogPage(page);
  await log.open();
  return (await log.readRows()).filter((row) => row.item.includes(text));
}

/** Adds, edits and deletes an item, then expects the three actions in the activity log. */
export async function expectContentActionsLogged(page: Page, M: ContentModule, id: string): Promise<void> {
  const saved = await saveAccepted(page, M, id);
  const stamp = saved.title.split(' ').pop() as string;
  const form = await openEditFor(page, M, saved.excerpt);
  const editedTitle = `${saved.title} EDIT`;
  await form.fill({ title: editedTitle });
  expect((await form.save()).first, 'the edit is saved').toBeLessThan(400);
  expect(await deleteNewsWhere(page, (card) => card.excerpt === saved.excerpt, M), 'the item is deleted').toBe(1);
  const rows = await logRowsAbout(page, stamp);
  note(`Log rows mentioning ${stamp}: ${rows.map((r) => `${r.action} ${r.item}`).join(' | ') || '(none)'}`);
  const actions = rows.map((r) => r.action);
  for (const action of ['create', 'update', 'delete']) expect(actions, `"${action}" is logged`).toContain(action);
  for (const row of rows) {
    expect(row.user, 'the log names the user').not.toBe('');
    expect(row.ip, 'the log has the IP').toMatch(/\d+\.\d+\.\d+\.\d+/);
  }
}

/** sample.pdf (real, made by Word), optionally padded to `bytes` and renamed. */
export function pdfFile(name = 'sample.pdf', bytes?: number): FilePayload {
  const base = fixtureFile('sample.pdf', name);
  return bytes ? paddedFile(base, bytes, name) : base;
}

/** Saves the files as documents and expects all to be stored; then (unless `download: false`) downloads them as a visitor. */
export async function docsAccepted(page: Page, browser: Browser, M: ContentModule, id: string, files: FilePayload[], opts: { download?: boolean; values?: NewsFormValues } = {}): Promise<Saved & { stored: string[] }> {
  const saved = await saveAccepted(page, M, id, { ...opts.values, documents: files });
  const stored = (await storedFiles(page, M, saved.excerpt)).documents;
  note(`Stored documents: ${stored.join(' | ')}`);
  expect(stored.length, 'every chosen document is saved').toBe(files.length);
  for (const file of files) if (!/[\\/]/.test(file.name)) expect(stored, `"${file.name}" is saved under its name`).toContain(file.name);
  if (opts.download !== false) {
    const detail = await publicDetailOf(browser, M, saved);
    await expectDocumentsDownload(browser, detail.media, files.filter((f) => !/[\\/]/.test(f.name)).map((f) => f.name));
  }
  return { ...saved, stored };
}

export async function docRefused(page: Page, M: ContentModule, id: string, files: FilePayload[], message = DOC_TYPE_MESSAGE): Promise<Refusal> {
  return saveRefused(page, M, id, { documents: files }, message);
}

/** Video files are refused; the message sits in the "วิดีโอประกอบ" tab (DEF-84: not visible after saving). */
export async function videoRefused(page: Page, M: ContentModule, id: string, files: FilePayload[], message = VIDEO_MESSAGE): Promise<Refusal> {
  return saveRefused(page, M, id, { videoFiles: files }, message);
}

export async function coverRefused(page: Page, M: ContentModule, id: string, file: FilePayload, message = COVER_MESSAGE): Promise<Refusal> {
  return saveRefused(page, M, id, { cover: file }, message);
}

/** Saves video files, expects them listed as saved, then a playable <video> per file on the public detail. */
export async function videosAccepted(page: Page, browser: Browser, M: ContentModule, id: string, files: FilePayload[]): Promise<Saved & { media: PublicMedia }> {
  const saved = await saveAccepted(page, M, id, { videoFiles: files });
  const stored = (await storedFiles(page, M, saved.excerpt)).videos;
  note(`Stored videos: ${stored.join(' | ')}`);
  for (const file of files) expect(stored, `"${file.name}" is saved`).toContain(file.name);
  const detail = await publicDetailOf(browser, M, saved);
  await expectVideosPlayable(browser, detail.media, files.length);
  return { ...saved, media: detail.media };
}

/** Saves a cover and expects it stored, on the admin card and loading on the public detail. */
export async function coverAccepted(page: Page, browser: Browser, M: ContentModule, id: string, file: FilePayload): Promise<Saved & { coverUrl: string }> {
  const saved = await saveAccepted(page, M, id, { cover: file });
  expect((await storedFiles(page, M, saved.excerpt)).cover, 'the edit form shows the saved cover').not.toBe('');
  const coverUrl = await expectCoverShown(browser, M, saved, saved.card);
  return { ...saved, coverUrl };
}

/** Size of an image as a visitor's browser decodes it (0×0 when it does not load). */
export async function decodedImageSize(browser: Browser, url: string): Promise<{ width: number; height: number }> {
  const context = await browser.newContext({ storageState: { cookies: [], origins: [] } });
  try {
    const page = await context.newPage();
    await page.setContent(`<img id="probe" src="${url}">`);
    await page.waitForFunction(() => (document.getElementById('probe') as HTMLImageElement).complete, undefined, { timeout: 15_000 }).catch(() => undefined);
    return page.evaluate(() => {
      const img = document.getElementById('probe') as HTMLImageElement;
      return { width: img.naturalWidth, height: img.naturalHeight };
    });
  } finally {
    await context.close();
  }
}

/** "06 ต.ค.. 26" → day + month index (the year format is DEF-15/59 and ignored here). */
export function thaiShortDate(text: string): { day: number; month: number } | null {
  const months = ['ม.ค', 'ก.พ', 'มี.ค', 'เม.ย', 'พ.ค', 'มิ.ย', 'ก.ค', 'ส.ค', 'ก.ย', 'ต.ค', 'พ.ย', 'ธ.ค'];
  const match = /(\d{1,2})\s+([ก-๙.]+)/.exec(text);
  if (!match) return null;
  const month = months.findIndex((m) => match[2].replace(/\.+$/, '') === m);
  return month < 0 ? null : { day: Number(match[1]), month };
}

/** The local wall clock as <input type=datetime-local> wants it ("2026-10-06T14:05"). */
export function localDateTime(date: Date): string {
  const pad = (n: number): string => String(n).padStart(2, '0');
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
}
