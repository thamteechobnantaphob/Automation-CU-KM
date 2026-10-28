import { test, expect } from '@fixtures/pages.fixtures';
import { requireDataCreatingTestsAllowed } from '@config/env';
import { Browser, Page } from '@playwright/test';
import { AdminNewsListPage, KNOWLEDGE_MODULE as M, NewsFormPage } from '@pages/admin/AdminNewsPages';
import { fetchAsVisitor, openEditFor, visitorGet } from '@utils/newsFlows';
import { sheetTitle } from '@utils/caseTitles';
import { roleStamp } from '@utils/roleFlows';
import { collectDialogs } from '@utils/security';
import {
  bmpFile,
  drawImage,
  emptyFile,
  exeFile,
  FilePayload,
  fixtureFile,
  gifFile,
  jpegWithOrientation,
  MB,
  paddedFile,
  svgWithScript,
  textFile,
  truncatedFile,
  videoStub,
  zipFile,
} from '@utils/uploadFiles';
import {
  cleanupItems,
  COVER_MESSAGE,
  coverAccepted,
  coverRefused,
  decodedImageSize,
  DOC_SIZE_MESSAGE,
  docRefused,
  docsAccepted,
  expectContentActionsLogged,
  expectCoverShown,
  isOnPublicList,
  itemExcerpt,
  itemTitle,
  KNOWN,
  localDateTime,
  note,
  pdfFile,
  publicDetailOf,
  saveAccepted,
  saveItem,
  saveRefused,
  storedFiles,
  trackItem,
  videoRefused,
  videosAccepted,
} from '../content/contentCases';
import { defaultIsPublished, notPublicAs } from '../content/contentFilesSuite';
import { editorRun, pasteHtml, setRawBody, wordHtml } from '../content/contentWorkflowSuite';

/**
 * KM-FKNO Auto:P cases — the lower part of the knowledge form (/admin/knowledge/create): documents[], video_file[],
 * video_url, status + schedule, cover_image, the tag box, the TinyMCE editor, saving everything, and file security.
 * Recon/probes 2026-10-06 are summed up in tests/admin/content/contentCases.ts.
 *
 * NOT implemented: TC-FKNO-07-15/16 (cover {MAX_MB} not given) and TC-FKNO-11-04 (needs a second account that can log
 * in — On hold for UAT).
 * Data: every item carries "[Auto Test] … <stamp>" in its excerpt and is deleted after the case. New tags cannot be
 * deleted (no admin page): TC-FKNO-08-04 leaves one "auto_tag_saved_<stamp>" tag per run.
 */

const CREATES = 'Saves knowledge items (deleted again after the case).';
const list = (page: Page): AdminNewsListPage => new AdminNewsListPage(page, M);

test.describe('KM-FKNO — ไฟล์ วิดีโอ สถานะ รูปปก แท็ก และตัวแก้ไข (Auto: P)', () => {
  test.beforeEach(() => {
    requireDataCreatingTestsAllowed(CREATES);
    test.setTimeout(180_000);
  });
  test.afterEach(async ({ page }) => cleanupItems(page));

  const pdf = (name = 'sample.pdf', bytes?: number): FilePayload => pdfFile(name, bytes);

  // ---- SC-FKNO-01 ----
  test(sheetTitle('TC-FKNO-01-02'), async ({ page, browser }) => {
    await defaultIsPublished(page, browser, M, 'TC-FKNO-01-02');
  });

  // ---- SC-FKNO-02 documents ----
  test(sheetTitle('TC-FKNO-02-01'), async ({ page, browser }) => {
    const saved = await docsAccepted(page, browser, M, 'TC-FKNO-02-01', [pdf('sample.pdf', 300 * 1024)]);
    note(`Stored: ${saved.stored.join(', ')}`);
  });

  test(sheetTitle('TC-FKNO-02-02'), async ({ page, browser }) => {
    await docsAccepted(page, browser, M, 'TC-FKNO-02-02', [fixtureFile('sample.docx'), fixtureFile('sample.doc')]);
  });

  test(sheetTitle('TC-FKNO-02-03'), async ({ page, browser }) => {
    await docsAccepted(page, browser, M, 'TC-FKNO-02-03', [fixtureFile('sample.xlsx'), fixtureFile('sample.xls')]);
  });

  test(sheetTitle('TC-FKNO-02-04'), async ({ page, browser }) => {
    await docsAccepted(page, browser, M, 'TC-FKNO-02-04', [fixtureFile('sample.pptx'), fixtureFile('sample.ppt')]);
  });

  test(sheetTitle('TC-FKNO-02-05'), async ({ page }) => {
    const png = await drawImage(page, 'image.png', { width: 200, height: 100, type: 'image/png' });
    for (const file of [textFile('test.txt', '[Auto Test]'), zipFile('archive.zip'), fixtureFile('data.csv'), png, fixtureFile('sample.odt', 'doc.odt')]) {
      await docRefused(page, M, 'TC-FKNO-02-05', [file]);
    }
  });

  test(sheetTitle('TC-FKNO-02-06'), async ({ page }) => {
    for (const file of [exeFile('test.exe'), textFile('run.bat', '@echo [Auto Test]'), textFile('script.js', 'alert(1)')]) await docRefused(page, M, 'TC-FKNO-02-06', [file]);
  });

  test(sheetTitle('TC-FKNO-02-07'), async ({ page }) => {
    await docRefused(page, M, 'TC-FKNO-02-07', [exeFile('fake.pdf')]);
  });

  test(sheetTitle('TC-FKNO-02-08'), async ({ page }) => {
    await docRefused(page, M, 'TC-FKNO-02-08', [exeFile('report.pdf.exe')]);
    await docRefused(page, M, 'TC-FKNO-02-08', [textFile('shell.php.pdf', '<?php echo "[Auto Test]"; ?>')]);
  });

  test(sheetTitle('TC-FKNO-02-09'), async ({ page, browser }) => {
    await docsAccepted(page, browser, M, 'TC-FKNO-02-09', [pdf('big10.pdf', 10 * MB)], { download: false });
  });

  test(sheetTitle('TC-FKNO-02-10'), async ({ page }) => {
    await docRefused(page, M, 'TC-FKNO-02-10', [pdf('big.pdf', 10 * MB + 1024)], DOC_SIZE_MESSAGE);
  });

  test(sheetTitle('TC-FKNO-02-11'), async ({ page }) => {
    test.fail(true, KNOWN.BROKEN_FILES);
    await docRefused(page, M, 'TC-FKNO-02-11', [emptyFile('empty.pdf')]);
    await docRefused(page, M, 'TC-FKNO-02-11', [truncatedFile(pdf(), 'broken.pdf')]);
  });

  test(sheetTitle('TC-FKNO-02-12'), async ({ page, browser }) => {
    await docsAccepted(page, browser, M, 'TC-FKNO-02-12', [pdf('เอกสาร แนบ 1 (สำเนา) & test.pdf')]);
  });

  test(sheetTitle('TC-FKNO-02-13'), async ({ page, browser }) => {
    test.fail(true, KNOWN.TRAVERSAL_DOWNLOAD);
    for (const name of [`${'a'.repeat(256)}.pdf`, '../../evil.pdf']) {
      const saved = await saveItem(page, M, 'TC-FKNO-02-13', { documents: [pdf(name)] });
      expect(saved.submitted.final, `${name.slice(0, 20)}…: no server error`).toBeLessThan(500);
      if (!(await list(page).findByExcerpt(saved.excerpt))) {
        note(`${name.slice(0, 20)}… was refused.`);
        continue;
      }
      const stored = (await storedFiles(page, M, saved.excerpt)).documents;
      note(`${name.slice(0, 20)}… stored as: ${stored.map((s) => `${s.slice(0, 40)}… (${s.length})`).join(' | ')}`);
      for (const s of stored) {
        expect(s, 'no path parts in the stored name').not.toMatch(/\.\.|[\\/]/);
        expect(s.length, 'the stored name fits 255 characters').toBeLessThanOrEqual(255);
      }
      const detail = await publicDetailOf(browser, M, saved);
      for (const doc of detail.media.documents) expect((await fetchAsVisitor(browser, doc.href)).status, 'downloadable').toBe(200);
    }
  });

  test(sheetTitle('TC-FKNO-02-14'), async ({ page, browser }) => {
    await docsAccepted(page, browser, M, 'TC-FKNO-02-14', [pdf('a.pdf'), fixtureFile('sample.docx', 'b.docx'), fixtureFile('sample.xlsx', 'c.xlsx')]);
  });

  test(sheetTitle('TC-FKNO-02-15'), async ({ page, browser }) => {
    const first = pdf('a.pdf');
    const second = pdf('a.pdf', first.buffer.length + 4096);
    const saved = await saveAccepted(page, M, 'TC-FKNO-02-15', { documents: [first, second] });
    const stored = (await storedFiles(page, M, saved.excerpt)).documents;
    expect(stored.filter((s) => s === 'a.pdf').length, 'both files are kept').toBe(2);
    const detail = await publicDetailOf(browser, M, saved);
    const sizes = await Promise.all(detail.media.documents.map(async (d) => (await fetchAsVisitor(browser, d.href)).body.length));
    note(`Downloaded sizes: ${sizes.join(', ')} (uploaded ${first.buffer.length}, ${second.buffer.length})`);
    expect(sizes.sort((x, y) => x - y), 'each download is its own file (no overwrite)').toEqual([first.buffer.length, second.buffer.length].sort((x, y) => x - y));
  });

  test(sheetTitle('TC-FKNO-02-16'), async ({ page }) => {
    test.setTimeout(420_000);
    const files = [1, 2, 3, 4, 5].map((n) => pdf(`big${n}.pdf`, 10 * MB));
    const saved = await saveItem(page, M, 'TC-FKNO-02-16', { documents: files });
    note(`5 × 10 MB: fetch ${saved.submitted.first} → ${saved.submitted.final} (${saved.submitted.url})`);
    expect(saved.submitted.final, 'not a server error page').toBeLessThan(500);
    const card = await list(page).findByExcerpt(saved.excerpt);
    if (card) {
      note('The server took the whole 50 MB request; all files must be there.');
      expect((await storedFiles(page, M, saved.excerpt)).documents.length).toBe(5);
      return;
    }
    await page.goBack().catch(() => undefined);
    const body = await page.locator('body').innerText();
    expect(body, 'a readable message, not a raw "413 Request Entity Too Large"').not.toMatch(/413|Request Entity Too Large|PostTooLargeException/i);
  });

  test(sheetTitle('TC-FKNO-02-17'), async ({ page, browser }) => {
    test.fail(true, KNOWN.NO_DOWNLOAD_COUNT);
    const saved = await saveAccepted(page, M, 'TC-FKNO-02-17', { documents: [pdf()] });
    const before = saved.card.counters;
    const detail = await publicDetailOf(browser, M, saved);
    const got = await fetchAsVisitor(browser, detail.media.documents[0].href);
    expect(got.status, 'the download works').toBe(200);
    expect(got.body.equals(pdf().buffer), 'the same bytes as uploaded').toBe(true);
    expect(decodeURIComponent(got.disposition)).toContain('sample.pdf');
    const after = (await list(page).findByExcerpt(saved.excerpt))?.counters ?? [];
    note(`Card counters before ${before.join('/')}, after one download ${after.join('/')}`);
    expect(after[1], 'the download counter went up by 1').toBe((before[1] ?? 0) + 1);
  });

  test(sheetTitle('TC-FKNO-02-18'), async ({ page }) => {
    const form = new NewsFormPage(page, M);
    await form.openCreate();
    const excerpt = itemExcerpt();
    trackItem(M, excerpt);
    await form.fill({ excerpt, documents: [pdf()] });
    expect((await form.pendingFiles('documents')).length, 'the file is listed before saving').toBe(1);
    await form.form.evaluate((f: HTMLFormElement) => (f.noValidate = true));
    const submitted = await form.save();
    note(`Save with an empty title: ${submitted.first} → ${submitted.final}`);
    expect(submitted.final).toBeLessThan(500);
    const messages = await form.messages();
    note(`Messages: ${messages.map((m) => m.text).join(' | ')}`);
    expect(await form.pendingFiles('documents'), 'no file is shown as still attached').toEqual([]);
    expect(messages.some((m) => m.visible), 'the user sees why the save failed').toBe(true);
  });

  // ---- SC-FKNO-03 video files ----
  test(sheetTitle('TC-FKNO-03-01'), async ({ page, browser }) => {
    await videosAccepted(page, browser, M, 'TC-FKNO-03-01', [fixtureFile('clip.mp4')]);
  });

  test(sheetTitle('TC-FKNO-03-02'), async ({ page, browser }) => {
    await videosAccepted(page, browser, M, 'TC-FKNO-03-02', [fixtureFile('auto-clip.webm', 'clip.webm')]);
  });

  test(sheetTitle('TC-FKNO-03-03'), async ({ page, browser }) => {
    note('The .mov/.avi/.mkv files are minimal containers (recognised by type, not playable).');
    const saved = await saveAccepted(page, M, 'TC-FKNO-03-03', { videoFiles: [videoStub('mov'), videoStub('avi'), videoStub('mkv')] });
    expect((await storedFiles(page, M, saved.excerpt)).videos, 'all three are saved').toEqual(['clip.mov', 'clip.avi', 'clip.mkv']);
    const detail = await publicDetailOf(browser, M, saved);
    expect(detail.media.videos.length, 'a player per file').toBe(3);
    for (const src of detail.media.videos) {
      const got = await fetchAsVisitor(browser, src);
      note(`${src} → ${got.status} ${got.type}`);
      expect(got.status, 'the file loads').toBe(200);
      // A type the browser cannot play must at least be downloadable (sheet: play, or offer a download).
      expect(got.type, 'served as video, or as a download').toMatch(/^video\/|^application\/octet-stream/);
    }
  });

  test(sheetTitle('TC-FKNO-03-04'), async ({ page }) => {
    test.fail(true, KNOWN.VIDEO_ERROR_HIDDEN);
    for (const file of [fixtureFile('clip.wmv'), videoStub('flv'), videoStub('3gp'), gifFile('anim.gif')]) await videoRefused(page, M, 'TC-FKNO-03-04', [file]);
  });

  test(sheetTitle('TC-FKNO-03-05'), async ({ page }) => {
    test.fail(true, KNOWN.VIDEO_ERROR_HIDDEN);
    await videoRefused(page, M, 'TC-FKNO-03-05', [exeFile('fake.mp4')]);
  });

  test(sheetTitle('TC-FKNO-03-06'), async ({ page }) => {
    test.setTimeout(420_000);
    const saved = await saveItem(page, M, 'TC-FKNO-03-06', { videoFiles: [paddedFile(fixtureFile('auto-clip.webm'), 50 * MB, 'video50.webm')] });
    note(`50 MB video: fetch ${saved.submitted.first} → ${saved.submitted.final}; messages: ${(await new NewsFormPage(page, M).messages()).map((m) => m.text).join(' | ') || '(none)'}`);
    expect(saved.submitted.first, 'the 50 MB file is accepted').toBeLessThan(300);
    expect((await storedFiles(page, M, saved.excerpt)).videos, 'it is saved').toContain('video50.webm');
  });

  test(sheetTitle('TC-FKNO-03-07'), async ({ page }) => {
    test.setTimeout(420_000);
    test.fail(true, KNOWN.VIDEO_ERROR_HIDDEN);
    await videoRefused(page, M, 'TC-FKNO-03-07', [paddedFile(fixtureFile('auto-clip.webm'), 50 * MB + 1024, 'video50plus.webm')]);
  });

  test(sheetTitle('TC-FKNO-03-08'), async ({ page }) => {
    test.fail(true, KNOWN.VIDEO_ERROR_HIDDEN);
    await videoRefused(page, M, 'TC-FKNO-03-08', [emptyFile('empty.mp4')]);
    await videoRefused(page, M, 'TC-FKNO-03-08', [truncatedFile(fixtureFile('clip.mp4'), 'broken.mp4')]);
  });

  test(sheetTitle('TC-FKNO-03-09'), async ({ page, browser }) => {
    await videosAccepted(page, browser, M, 'TC-FKNO-03-09', [fixtureFile('clip.mp4', 'v1.mp4'), fixtureFile('clip.mp4', 'v2.mp4')]);
  });

  test(sheetTitle('TC-FKNO-03-10'), async ({ page, browser }) => {
    await videosAccepted(page, browser, M, 'TC-FKNO-03-10', [fixtureFile('clip.mp4', 'วิดีโอ อบรม 1.mp4')]);
  });

  // ---- SC-FKNO-04 video links ----
  async function linksShown(page: Page, browser: Browser, id: string, links: string[], videoIds: string[]): Promise<void> {
    const saved = await saveAccepted(page, M, id, { videoUrl: links.join('\n') });
    const detail = await publicDetailOf(browser, M, saved);
    const embeds = detail.media.embeds.map((e) => e.src);
    note(`Embeds: ${embeds.join(' | ')}`);
    expect(embeds.length, 'one player per link').toBe(videoIds.length);
    videoIds.forEach((videoId, i) => expect(embeds[i], `player ${i + 1} plays ${videoId}`).toContain(`/embed/${videoId}`));
  }

  test(sheetTitle('TC-FKNO-04-01'), async ({ page, browser }) => {
    await linksShown(page, browser, 'TC-FKNO-04-01', ['https://www.youtube.com/watch?v=dQw4w9WgXcQ'], ['dQw4w9WgXcQ']);
  });

  test(sheetTitle('TC-FKNO-04-02'), async ({ page, browser }) => {
    await linksShown(page, browser, 'TC-FKNO-04-02', ['https://youtu.be/dQw4w9WgXcQ?t=30'], ['dQw4w9WgXcQ']);
  });

  test(sheetTitle('TC-FKNO-04-03'), async ({ page, browser }) => {
    await linksShown(
      page,
      browser,
      'TC-FKNO-04-03',
      ['https://www.youtube.com/watch?v=dQw4w9WgXcQ', 'https://www.youtube.com/watch?v=9bZkp7q19f0', 'https://youtu.be/kJQP7kiw5Fk'],
      ['dQw4w9WgXcQ', '9bZkp7q19f0', 'kJQP7kiw5Fk'],
    );
  });

  test(sheetTitle('TC-FKNO-04-13'), async ({ page, browser }) => {
    test.fail(true, 'Known bug (DEF-88): the embedded YouTube <iframe> has neither a sandbox nor an allow attribute.');
    const saved = await saveAccepted(page, M, 'TC-FKNO-04-13', { videoUrl: 'https://www.youtube.com/watch?v=dQw4w9WgXcQ', videoFiles: [fixtureFile('clip.mp4')] });
    for (const viewport of [{ width: 1366, height: 900 }, { width: 375, height: 812 }]) {
      const detail = await publicDetailOf(browser, M, saved, viewport);
      const embed = detail.media.embeds[0];
      note(`${viewport.width}px: iframe ${Math.round(embed?.width)}×${Math.round(embed?.height)}, overflow ${detail.media.overflowX}px, sandbox=${embed?.sandbox} allow=${embed?.allow}`);
      expect(embed, 'the player is there').toBeTruthy();
      expect(embed.height / embed.width, `${viewport.width}px: 16:9`).toBeCloseTo(9 / 16, 1);
      expect(embed.width, `${viewport.width}px: fits the window`).toBeLessThanOrEqual(viewport.width);
      expect(detail.media.overflowX, `${viewport.width}px: no horizontal scroll`).toBeLessThanOrEqual(1);
      expect(detail.html, 'the video file has playback controls').toMatch(/<video[^>]*controls/);
    }
    const detail = await publicDetailOf(browser, M, saved);
    const embed = detail.media.embeds[0];
    expect(embed.sandbox !== null || embed.allow !== null, 'the iframe is restricted (sandbox / allow)').toBe(true);
  });

  // ---- SC-FKNO-06 status and schedule ----
  test(sheetTitle('TC-FKNO-06-01'), async ({ page, browser }) => {
    const saved = await saveAccepted(page, M, 'TC-FKNO-06-01', { status: 'publish', timing: 'now' });
    const detail = await publicDetailOf(browser, M, saved);
    const months = ['มกราคม', 'กุมภาพันธ์', 'มีนาคม', 'เมษายน', 'พฤษภาคม', 'มิถุนายน', 'กรกฎาคม', 'สิงหาคม', 'กันยายน', 'ตุลาคม', 'พฤศจิกายน', 'ธันวาคม'];
    const now = new Date();
    const day = String(now.getDate()).padStart(2, '0');
    note(`Public date shown: ${/\d{1,2} [ก-๙]+ \d{4}/.exec(detail.text)?.[0]}`);
    expect(detail.text, 'published today').toMatch(new RegExp(`0?${Number(day)} ${months[now.getMonth()]} (${now.getFullYear()}|${now.getFullYear() + 543})`));
  });

  test(sheetTitle('TC-FKNO-06-02'), async ({ page, browser }) => {
    await notPublicAs(page, browser, M, 'TC-FKNO-06-02', 'draft');
  });

  test(sheetTitle('TC-FKNO-06-03'), async ({ page, browser }) => {
    await notPublicAs(page, browser, M, 'TC-FKNO-06-03', 'hide');
  });

  test(sheetTitle('TC-FKNO-06-06'), async ({ page, browser }) => {
    test.fail(true, KNOWN.SCHEDULE_NOT_PUBLISHED);
    test.setTimeout(480_000);
    const at = new Date(Date.now() + 3 * 60_000);
    at.setSeconds(0, 0);
    const saved = await saveAccepted(page, M, 'TC-FKNO-06-06', { status: 'publish', timing: 'schedule', publishedAt: localDateTime(at) });
    note(`Scheduled for ${localDateTime(at)} (local time of the test machine).`);
    expect(await isOnPublicList(browser, M, saved.excerpt), 'not public before the time').toBe(false);
    let shownAt = '';
    const deadline = at.getTime() + 2.5 * 60_000;
    while (Date.now() < deadline) {
      await page.waitForTimeout(20_000);
      if (await isOnPublicList(browser, M, saved.excerpt)) {
        shownAt = new Date().toISOString();
        break;
      }
    }
    note(shownAt ? `Became public at ${shownAt}` : 'Still not public 2.5 minutes after the scheduled time.');
    expect(shownAt, 'public once the time has come, without another edit').not.toBe('');
  });

  test(sheetTitle('TC-FKNO-06-10'), async ({ page, browser }) => {
    const context = await browser.newContext({ storageState: 'playwright/.auth/admin.json', timezoneId: 'UTC' });
    try {
      const utcPage = await context.newPage();
      const tomorrow = new Date(Date.now() + 24 * 3600_000);
      const value = `${localDateTime(tomorrow).slice(0, 10)}T10:00`;
      const saved = await saveAccepted(utcPage, M, 'TC-FKNO-06-10', { status: 'publish', timing: 'schedule', publishedAt: value });
      const form = await openEditFor(utcPage, M, saved.excerpt);
      const shown = await form.publishedAtInput.inputValue();
      note(`Typed ${value} in a UTC browser; the edit form shows ${shown}. Card date: ${saved.card.created}`);
      expect(shown, 'the time comes back as typed (no 7-hour shift)').toBe(value);
    } finally {
      await cleanupItems(page);
      await context.close();
    }
  });

  test(sheetTitle('TC-FKNO-06-11'), async ({ page }) => {
    const value = `${localDateTime(new Date(Date.now() + 2 * 24 * 3600_000)).slice(0, 10)}T09:30`;
    const saved = await saveAccepted(page, M, 'TC-FKNO-06-11', { status: 'publish', timing: 'schedule', publishedAt: value });
    const form = await openEditFor(page, M, saved.excerpt);
    await expect(page.locator('#publish-timing-schedule'), "'กำหนดวันและเวลา' is selected").toBeChecked();
    expect(await form.publishedAtInput.inputValue(), 'the date and time are as saved').toBe(value);
  });

  test(sheetTitle('TC-FKNO-06-12'), async ({ page, browser }) => {
    const value = `${localDateTime(new Date(Date.now() + 2 * 24 * 3600_000)).slice(0, 10)}T09:30`;
    const saved = await saveAccepted(page, M, 'TC-FKNO-06-12', { status: 'publish', timing: 'schedule', publishedAt: value });
    expect(await isOnPublicList(browser, M, saved.excerpt), 'not public while scheduled').toBe(false);
    const form = await openEditFor(page, M, saved.excerpt);
    await form.fill({ timing: 'now' });
    expect((await form.save()).first).toBeLessThan(400);
    expect(await isOnPublicList(browser, M, saved.excerpt), 'public right away').toBe(true);
    const again = await openEditFor(page, M, saved.excerpt);
    await expect(page.locator('#publish-timing-now'), "'ทันที' is kept").toBeChecked();
    note(`Date field after the change: "${await again.publishedAtInput.inputValue()}"`);
    expect(await again.publishedAtInput.inputValue(), 'the old date is cleared').not.toBe(value);
  });

  // ---- SC-FKNO-07 cover ----
  test(sheetTitle('TC-FKNO-07-01'), async ({ page, browser }) => {
    test.fail(true, KNOWN.COVER);
    await coverAccepted(page, browser, M, 'TC-FKNO-07-01', await drawImage(page, 'image.png', { width: 1920, height: 1080, type: 'image/png' }));
  });

  test(sheetTitle('TC-FKNO-07-02'), async ({ page, browser }) => {
    test.fail(true, KNOWN.COVER);
    await coverAccepted(page, browser, M, 'TC-FKNO-07-02', await drawImage(page, 'image.jpg', { width: 1920, height: 1080, type: 'image/jpeg' }));
  });

  test(sheetTitle('TC-FKNO-07-03'), async ({ page, browser }) => {
    test.fail(true, KNOWN.COVER);
    await coverAccepted(page, browser, M, 'TC-FKNO-07-03', await drawImage(page, 'transparent.png', { width: 1200, height: 675, type: 'image/png', transparent: true }));
  });

  test(sheetTitle('TC-FKNO-07-04'), async ({ page, browser }) => {
    test.fail(true, KNOWN.COVER);
    const saved = await coverAccepted(page, browser, M, 'TC-FKNO-07-04', await jpegWithOrientation(page, 'phone_portrait.jpg', 800, 600));
    const size = await decodedImageSize(browser, saved.coverUrl);
    expect(size.height, 'shown upright (portrait)').toBeGreaterThan(size.width);
  });

  test(sheetTitle('TC-FKNO-07-05'), async ({ page, browser }) => {
    test.fail(true, KNOWN.COVER);
    await coverAccepted(page, browser, M, 'TC-FKNO-07-05', await drawImage(page, 'ภาพ กิจกรรม 1.jpg', { width: 1280, height: 720, type: 'image/jpeg' }));
  });

  test(sheetTitle('TC-FKNO-07-06'), async ({ page, browser }) => {
    test.fail(true, KNOWN.COVER);
    const image = await drawImage(page, '4k.jpg', { width: 3840, height: 2160, type: 'image/jpeg' });
    note(`4k.jpg: ${Math.round(image.buffer.length / 1024)} KB`);
    const saved = await coverAccepted(page, browser, M, 'TC-FKNO-07-06', image);
    const got = await fetchAsVisitor(browser, saved.coverUrl);
    note(`Served cover: ${Math.round(got.body.length / 1024)} KB`);
  });

  test(sheetTitle('TC-FKNO-07-07'), async ({ page, browser }) => {
    test.fail(true, KNOWN.COVER);
    note('Minimum size not defined (TBD): the case expects the image to be accepted and shown usable.');
    await coverAccepted(page, browser, M, 'TC-FKNO-07-07', await drawImage(page, 'small.jpg', { width: 800, height: 450, type: 'image/jpeg' }));
  });

  test(sheetTitle('TC-FKNO-07-08'), async ({ page, browser }) => {
    test.fail(true, KNOWN.COVER);
    for (const [name, width, height] of [['square.jpg', 1080, 1080], ['tall.jpg', 1080, 1920]] as [string, number, number][]) {
      await coverAccepted(page, browser, M, 'TC-FKNO-07-08', await drawImage(page, name, { width, height, type: 'image/jpeg' }));
    }
  });

  test(sheetTitle('TC-FKNO-07-09'), async ({ page }) => {
    test.fail(true, `${KNOWN.COVER_GIF_WEBP} Also: a BMP is refused with the raw key "validation.mimes" (DEF-66).`);
    const webp = await drawImage(page, 'image.webp', { width: 640, height: 360, type: 'image/webp' });
    for (const file of [svgWithScript('image.svg'), bmpFile('image.bmp'), pdf('image.pdf'), gifFile('image.gif'), webp]) {
      const refusal = await coverRefused(page, M, 'TC-FKNO-07-09', file, /รองรับเฉพาะไฟล์รูปภาพ|\bvalidation\.[a-z_.]+/);
      expect.soft(refusal.messages.map((m) => m.text).join(' | '), `${file.name}: a readable message, not a raw key`).not.toMatch(/\bvalidation\.[a-z_.]+/);
    }
  });

  test(sheetTitle('TC-FKNO-07-10'), async ({ page }) => {
    await coverRefused(page, M, 'TC-FKNO-07-10', exeFile('fake.jpg'));
  });

  test(sheetTitle('TC-FKNO-07-11'), async ({ page }) => {
    await coverRefused(page, M, 'TC-FKNO-07-11', svgWithScript('evil.png'));
  });

  test(sheetTitle('TC-FKNO-07-12'), async ({ page }) => {
    await coverRefused(page, M, 'TC-FKNO-07-12', emptyFile('empty.jpg'));
  });

  test(sheetTitle('TC-FKNO-07-13'), async ({ page }) => {
    test.fail(true, KNOWN.BROKEN_FILES);
    const jpg = await drawImage(page, 'broken.jpg', { width: 1280, height: 720, type: 'image/jpeg' });
    await coverRefused(page, M, 'TC-FKNO-07-13', truncatedFile(jpg, 'broken.jpg'), COVER_MESSAGE);
  });

  test(sheetTitle('TC-FKNO-07-14'), async ({ page }) => {
    test.fail(true, KNOWN.BROKEN_FILES);
    const jpg = await drawImage(page, 'image.jpg', { width: 640, height: 360, type: 'image/jpeg' });
    await coverRefused(page, M, 'TC-FKNO-07-14', { ...jpg, name: 'image.jpg.exe', mimeType: 'application/x-msdownload' });
    const saved = await saveItem(page, M, 'TC-FKNO-07-14', { cover: { ...jpg, name: 'image.php.jpg' } });
    const card = await list(page).findByExcerpt(saved.excerpt);
    note(`image.php.jpg: ${card ? `saved, cover ${card.cover}` : 'refused'}`);
    if (card) expect(card.cover, 'stored with an image extension, never .php').toMatch(/\.(jpe?g|png)$/i);
  });

  test(sheetTitle('TC-FKNO-07-18'), async ({ page, browser }) => {
    test.fail(true, KNOWN.COVER);
    const saved = await saveAccepted(page, M, 'TC-FKNO-07-18', { cover: await drawImage(page, 'first.jpg', { width: 1280, height: 720, type: 'image/jpeg' }) });
    const form = await openEditFor(page, M, saved.excerpt);
    await form.fill({ cover: await drawImage(page, 'second.png', { width: 1280, height: 720, type: 'image/png' }) });
    expect((await form.save()).first).toBeLessThan(400);
    const card = await list(page).findByExcerpt(saved.excerpt);
    note(`Cover before ${saved.card.cover}, after ${card?.cover}`);
    expect(card?.cover, 'the card uses the new cover').not.toBe(saved.card.cover);
    expect(card?.cover).toMatch(/\.png$/);
    await expectCoverShown(browser, M, saved, card as NonNullable<typeof card>);
  });

  test(sheetTitle('TC-FKNO-07-19'), async ({ page, browser }) => {
    const saved = await saveAccepted(page, M, 'TC-FKNO-07-19', { cover: await drawImage(page, 'cover.jpg', { width: 1280, height: 720, type: 'image/jpeg' }) });
    const form = await openEditFor(page, M, saved.excerpt);
    await form.removeCover();
    expect((await form.save()).first).toBeLessThan(400);
    const card = await list(page).findByExcerpt(saved.excerpt);
    expect(card?.cover, 'the card shows the placeholder').toMatch(/\/images\/image\.png$/);
    const old = await fetchAsVisitor(browser, saved.card.cover);
    note(`Old cover ${saved.card.cover} → ${old.status} (uploaded covers answer 404 anyway — DEF-48)`);
    expect(old.status, 'the old file cannot be opened').not.toBe(200);
  });

  // ---- SC-FKNO-08 tags ----
  async function suggestions(page: Page, typed: string): Promise<{ existing: string[]; offerNew: boolean }> {
    await page.locator('#tag-input').fill(typed);
    await page.waitForTimeout(400);
    const items = await page.locator('.dropdown-item:visible').allInnerTexts();
    return {
      existing: items.filter((t) => !/เพิ่มแท็กใหม่/.test(t)).map((t) => t.replace(/\s+/g, ' ').trim()),
      offerNew: items.some((t) => /เพิ่มแท็กใหม่/.test(t)),
    };
  }

  test(sheetTitle('TC-FKNO-08-01'), async ({ page }) => {
    const form = new NewsFormPage(page, M);
    await form.openCreate();
    const shown = await suggestions(page, 'K');
    note(`Suggestions for "K": ${shown.existing.join(', ')}`);
    expect(shown.existing, '"KM" is suggested').toContain('KM');
    await page.locator('.dropdown-item:visible').filter({ hasText: /^\s*KM\s*$/ }).first().click();
    expect(await form.tagTexts(), '"KM" is added').toContain('KM');
  });

  test(sheetTitle('TC-FKNO-08-03'), async ({ page }) => {
    const tag = `auto_tag_cancel_${roleStamp()}`;
    const form = new NewsFormPage(page, M);
    await form.openCreate();
    await form.fill({ title: itemTitle('TC-FKNO-08-03'), tags: [tag] });
    expect(await form.tagTexts()).toContain(tag);
    await form.cancelLink.click();
    await page.waitForLoadState('load');
    await form.openCreate();
    const shown = await suggestions(page, tag);
    expect(shown.existing, 'the cancelled tag does not exist').not.toContain(tag);
    expect(shown.offerNew, 'it is only offered as new').toBe(true);
  });

  test(sheetTitle('TC-FKNO-08-04'), async ({ page }) => {
    const tag = `auto_tag_saved_${roleStamp()}`;
    note(`Leaves the tag "${tag}" in the system (tags cannot be deleted).`);
    await saveAccepted(page, M, 'TC-FKNO-08-04', { tags: [tag] });
    const form = new NewsFormPage(page, M);
    await form.openCreate();
    const shown = await suggestions(page, tag);
    expect(shown.existing, 'offered as an existing tag').toContain(tag);
  });

  test(sheetTitle('TC-FKNO-08-08'), async ({ page }) => {
    const form = new NewsFormPage(page, M);
    await form.openCreate();
    const excerpt = itemExcerpt();
    trackItem(M, excerpt);
    await form.fill({ title: itemTitle('TC-FKNO-08-08'), excerpt, tags: ['autotest1', 'autotest2', 'autotest3'] });
    await page.locator('#tag-chips > *', { hasText: 'autotest2' }).locator('.tag-remove').click();
    expect(await form.tagTexts(), '× removes the tag').toEqual(['autotest1', 'autotest3']);
    await form.tagInput.fill('a,b,c');
    await form.tagInput.press('Enter');
    const afterPaste = await form.tagTexts();
    note(`After pasting "a,b,c": ${afterPaste.join(' | ')} (rule TBD: one tag or three)`);
    // Do not create the pasted tags in the system: remove them again before saving.
    for (const chip of afterPaste.filter((t) => !['autotest1', 'autotest3'].includes(t))) await page.locator('#tag-chips > *', { hasText: chip }).locator('.tag-remove').click();
    expect((await form.save()).first).toBeLessThan(400);
    const again = await openEditFor(page, M, excerpt);
    expect((await again.tagTexts()).sort(), 'the removed tag is not saved').toEqual(['autotest1', 'autotest3']);
  });

  // ---- SC-FKNO-09 editor ----
  async function newItemForm(page: Page, id: string): Promise<{ form: NewsFormPage; title: string; excerpt: string }> {
    const form = new NewsFormPage(page, M);
    await form.openCreate();
    const title = itemTitle(id);
    const excerpt = itemExcerpt();
    trackItem(M, excerpt);
    await form.fill({ title, excerpt });
    return { form, title, excerpt };
  }

  test(sheetTitle('TC-FKNO-09-02'), async ({ page, browser }) => {
    note("The editor holds the pasted image as base64; on save the server turns it into a file (/media/body-image/…) — the check is that no base64 reaches the public page and the image is shown."); 
    const { form, title, excerpt } = await newItemForm(page, 'TC-FKNO-09-02');
    await page.evaluate(async () => {
      const canvas = document.createElement('canvas');
      canvas.width = 1600;
      canvas.height = 1000;
      const ctx = canvas.getContext('2d') as CanvasRenderingContext2D;
      for (let i = 0; i < 4000; i++) {
        ctx.fillStyle = `hsl(${i % 360},80%,50%)`;
        ctx.fillRect(Math.random() * 1600, Math.random() * 1000, 30, 30);
      }
      const blob: Blob = await new Promise((resolve) => canvas.toBlob((b) => resolve(b as Blob), 'image/png'));
      const editor = (window as unknown as { tinymce: { get(id: string): { focus(): void; getBody(): HTMLElement } } }).tinymce.get('content-module-body-input');
      editor.focus();
      const data = new DataTransfer();
      data.items.add(new File([blob], 'pasted.png', { type: 'image/png' }));
      editor.getBody().dispatchEvent(new ClipboardEvent('paste', { clipboardData: data, bubbles: true, cancelable: true }));
    });
    await page.waitForTimeout(1500);
    const content = (await editorRun(page, 'return editor.getContent();')) as string;
    note(`Editor after paste: ${content.slice(0, 120)}… (${content.length} characters)`);
    expect(content, 'the pasted image is in the editor').toMatch(/<img/);
    expect((await form.save()).first).toBeLessThan(400);
    const detail = await publicDetailOf(browser, M, { excerpt, title });
    note(`Public page: ${Math.round(detail.html.length / 1024)} KB of HTML`);
    const kept = (await openEditFor(page, M, excerpt).then(() => editorRun(page, 'return editor.getContent();'))) as string;
    note(`Saved content: ${kept.slice(0, 160)} (${kept.length} characters)`);
    expect(detail.html, 'no base64 image in the public content').not.toMatch(/src="data:image\//);
    expect(detail.media.bodyImages.filter((src) => !src.startsWith('data:')).length, 'the pasted image is shown on the public page as a file').toBeGreaterThan(0);
  });

  test(sheetTitle('TC-FKNO-09-03'), async ({ page, browser }) => {
    const { form, title, excerpt } = await newItemForm(page, 'TC-FKNO-09-03');
    await editorRun(page, "editor.setContent('<p>สื่อภายนอก</p><p><img src=\"https://www.w3.org/Icons/w3c_home.png\" alt=\"external\"></p><p><iframe src=\"https://www.youtube.com/embed/dQw4w9WgXcQ\" width=\"560\" height=\"315\"></iframe></p>');");
    const content = (await editorRun(page, 'return editor.getContent();')) as string;
    note(`Editor keeps: ${content}`);
    expect((await form.save()).first).toBeLessThan(400);
    const detail = await publicDetailOf(browser, M, { excerpt, title });
    expect(detail.html, 'the external image is shown').toContain('https://www.w3.org/Icons/w3c_home.png');
    const iframes = detail.media.embeds.map((e) => e.src);
    note(`Public iframes: ${iframes.join(' | ') || '(none)'}; the site itself is served over ${new URL(detail.url).protocol}`);
    for (const src of iframes) expect(src, 'only an https YouTube player').toMatch(/^https:\/\/www\.youtube\.com\/embed\//);
  });

  async function scriptPayloadCase(page: Page, browser: Browser, id: string, payload: string, checks: (html: string, dialogs: string[], label: string) => void): Promise<void> {
    const dialogs = collectDialogs(page);
    const viaEditor = await newItemForm(page, id);
    await viaEditor.form.setBody(payload);
    expect((await viaEditor.form.save()).first).toBeLessThan(400);
    const raw = await newItemForm(page, id);
    await setRawBody(page, payload);
    expect((await raw.form.save()).final, 'a raw post is not a server error').toBeLessThan(500);
    for (const [label, item] of [['editor', viaEditor], ['raw post', raw]] as const) {
      const detail = await publicDetailOf(browser, M, item);
      checks(detail.html, [...dialogs, ...detail.dialogs], label);
    }
  }

  test(sheetTitle('TC-FKNO-09-04'), async ({ page, browser }) => {
    test.fail(true, KNOWN.BODY_NOT_SANITISED);
    await scriptPayloadCase(page, browser, 'TC-FKNO-09-04', '<p>ซอร์สโค้ด</p><script>alert(1)</script><iframe src="//evil.example"></iframe><a href="#" onclick="alert(1)">x</a>', (html, dialogs, label) => {
      expect.soft(dialogs, `${label}: no script ran`).toEqual([]);
      expect.soft(html, `${label}: no <script>`).not.toMatch(/<script>alert\(1\)<\/script>/);
      expect.soft(html, `${label}: no foreign iframe`).not.toContain('evil.example');
      expect.soft(html, `${label}: no onclick`).not.toMatch(/onclick\s*=\s*"alert/i);
    });
  });

  test(sheetTitle('TC-FKNO-09-06'), async ({ page, browser }) => {
    const cells = (r: number): string => [1, 2, 3].map((c) => `<td style="text-align: center; background-color: rgb(251, 238, 184);">แถว${r}คอลัมน์${c}ข้อความยาวยาวสำหรับทดสอบความกว้าง</td>`).join('');
    const body = `<table style="border-collapse: collapse; width: 100%;" border="1"><tbody>${[1, 2, 3].map((r) => `<tr>${cells(r)}</tr>`).join('')}</tbody></table>`;
    const saved = await saveAccepted(page, M, 'TC-FKNO-09-06', { body });
    const detail = await publicDetailOf(browser, M, saved, { width: 375, height: 812 });
    expect(detail.html, 'the table is shown').toContain('แถว3คอลัมน์3');
    expect(detail.html, 'its formatting is kept').toMatch(/background-color:\s*(rgb\(251, 238, 184\)|#fbeeb8)/i);
    note(`Horizontal overflow of the page at 375 px: ${detail.media.overflowX}px`);
    expect(detail.media.overflowX, 'the page does not scroll sideways (the table scrolls in its box)').toBeLessThanOrEqual(1);
  });

  test(sheetTitle('TC-FKNO-09-07'), async ({ page, browser }) => {
    const s = roleStamp();
    const { form, title, excerpt } = await newItemForm(page, 'TC-FKNO-09-07');
    await editorRun(page, "editor.setContent('');");
    await pasteHtml(page, wordHtml(s));
    const pasted = (await editorRun(page, 'return editor.getContent();')) as string;
    note(`Pasted: ${pasted.slice(0, 400)}`);
    expect(pasted).toContain(`ย่อหน้าจากเวิร์ด ${s}`);
    expect((await form.save()).first).toBeLessThan(400);
    const detail = await publicDetailOf(browser, M, { excerpt, title });
    expect(detail.html, 'the heading is kept').toMatch(new RegExp(`<h[1-6][^>]*>[^<]*(<[^>]+>)*หัวข้อจากเวิร์ด ${s}`));
    expect(detail.html, 'the table is kept').toMatch(new RegExp(`<table[\\s\\S]*เซลล์1 ${s}[\\s\\S]*</table>`));
    expect(detail.html, 'no mso- styles / <o:p> left').not.toMatch(/mso-|<o:p>/);
    note(`Word class names left: ${/Mso[A-Za-z]+/.test(detail.html) ? 'yes (class="MsoNormal" etc. — harmless)' : 'none'}`);
  });

  test(sheetTitle('TC-FKNO-09-08'), async ({ page, browser }) => {
    test.fail(true, KNOWN.BODY_NOT_SANITISED);
    const payload = '<p><a href="javascript:alert(1)">ลิงก์อันตราย</a> <a href="https://example.com/" target="_blank">ลิงก์ภายนอก</a></p>';
    await scriptPayloadCase(page, browser, 'TC-FKNO-09-08', payload, (html, dialogs, label) => {
      expect.soft(html, `${label}: no javascript: link`).not.toMatch(/href\s*=\s*"\s*javascript:/i);
      const external = (html.match(/<a[^>]*href="https:\/\/example\.com\/?"[^>]*>/) ?? [''])[0];
      note(`${label}: external link ${external}`);
      expect.soft(external, `${label}: the external link is kept`).not.toBe('');
      expect.soft(external, `${label}: a new-tab link has rel=noopener`).toMatch(/rel="[^"]*noopener/);
      expect.soft(dialogs, `${label}: no script ran`).toEqual([]);
    });
  });

  // ---- SC-FKNO-10 saving ----
  test(sheetTitle('TC-FKNO-10-02'), async ({ page }) => {
    const when = `${localDateTime(new Date(Date.now() + 2 * 24 * 3600_000)).slice(0, 10)}T08:45`;
    const saved = await saveAccepted(page, M, 'TC-FKNO-10-02', {
      tags: ['autotest1', 'autotest2', 'autotest3'],
      body: '<p>ครบทุกส่วน</p>',
      documents: [pdfFile()],
      videoFiles: [fixtureFile('clip.mp4')],
      videoUrl: 'https://www.youtube.com/watch?v=dQw4w9WgXcQ\nhttps://youtu.be/9bZkp7q19f0',
      source: 'แหล่งที่มา',
      authorName: 'ผู้แต่ง',
      referenceDate: '2026-09-21',
      referenceUrl: 'https://www.example.com/',
      status: 'publish',
      timing: 'schedule',
      publishedAt: when,
      cover: await drawImage(page, 'cover.png', { width: 1920, height: 1080, type: 'image/png' }),
    });
    const stored = await storedFiles(page, M, saved.excerpt);
    const f = stored.form;
    expect(await f.titleInput.inputValue()).toBe(saved.title);
    expect(await f.excerptInput.inputValue()).toBe(saved.excerpt);
    expect((await f.tagTexts()).sort()).toEqual(['autotest1', 'autotest2', 'autotest3']);
    expect(await f.bodyText()).toContain('ครบทุกส่วน');
    expect(stored.documents, 'the document, by name').toEqual(['sample.pdf']);
    expect(stored.videos, 'the video file').toEqual(['clip.mp4']);
    expect(stored.links.length, 'both video links').toBe(2);
    expect(await f.form.locator('input[name="source"]').inputValue()).toBe('แหล่งที่มา');
    expect(await f.form.locator('input[name="author_name"]').inputValue()).toBe('ผู้แต่ง');
    expect(await f.form.locator('input[name="reference_date"]').inputValue()).toBe('2026-09-21');
    expect(await f.referenceUrlInput.inputValue()).toBe('https://www.example.com/');
    expect(await f.publishedAtInput.inputValue(), 'the scheduled time').toBe(when);
    expect(stored.cover, 'the cover').not.toBe('');
    const files = [...(await f.savedFiles('documents')), ...(await f.savedFiles('videos'))];
    expect(files.every((file) => file.deleteUrl !== ''), 'every saved file / link can be deleted').toBe(true);
  });

  test(sheetTitle('TC-FKNO-10-03'), async ({ page }) => {
    test.setTimeout(480_000);
    test.fail(true, KNOWN.BIG_REQUEST_HANGS);
    // The upload runs in its own tab, closed before the checks: a hanging post must not block the cleanup.
    const tab = await page.context().newPage();
    const form = new NewsFormPage(tab, M);
    await form.openCreate();
    const title = itemTitle('TC-FKNO-10-03');
    const excerpt = itemExcerpt();
    trackItem(M, excerpt);
    await form.fill({
      title,
      excerpt,
      documents: [1, 2, 3, 4, 5].map((n) => pdfFile(`big${n}.pdf`, 10 * MB)),
      videoFiles: [1, 2].map((n) => paddedFile(fixtureFile('auto-clip.webm'), 50 * MB, `big${n}.webm`)),
    });
    const started = Date.now();
    await form.saveButton.click();
    // Give the server 4 minutes to answer: the list (saved) or the form with a readable message.
    const settled = await tab
      .waitForURL((url) => !/\/create(\?|$)/.test(url.href), { timeout: 240_000 })
      .then(() => true)
      .catch(() => false);
    const seconds = Math.round((Date.now() - started) / 1000);
    const body = await tab.locator('body').innerText({ timeout: 5_000 }).catch(() => '');
    const buttonText = await form.saveButton.innerText({ timeout: 5_000 }).catch(() => '');
    note(`150 MB request after ${seconds}s: ${settled ? `left the form (${tab.url()})` : 'still on the form'}; save button "${buttonText}"`);
    await tab.close({ runBeforeUnload: false }).catch(() => undefined);
    expect(body, 'no raw error page').not.toMatch(/413|Request Entity Too Large|PostTooLargeException|Server Error/i);
    if (settled && (await list(page).findByExcerpt(excerpt))) {
      note('The server took the whole request.');
      return;
    }
    // Still uploading: reading the form would wait for a load that never comes — the missing answer is the finding.
    expect(settled, 'within 4 minutes the user gets an answer (saved, or a readable message)').toBe(true);
  });

  test(sheetTitle('TC-FKNO-10-06'), async ({ page }) => {
    test.fail(true, KNOWN.NO_ACTIVITY_LOG);
    await expectContentActionsLogged(page, M, 'TC-FKNO-10-06');
  });

  // ---- SC-FKNO-11 security ----
  test(sheetTitle('TC-FKNO-11-02'), async ({ page }) => {
    const shells = (): FilePayload[] => [textFile('shell.php', '<?php echo "[Auto Test]"; ?>'), textFile('shell.phtml', '<?php echo 1; ?>'), textFile('.htaccess', 'AddType application/x-httpd-php .jpg')];
    await saveRefused(page, M, 'TC-FKNO-11-02', { documents: shells() }, /รองรับเฉพาะไฟล์/);
    const videoRefusal = await saveItem(page, M, 'TC-FKNO-11-02', { videoFiles: shells() });
    expect(await list(page).findByExcerpt(videoRefusal.excerpt), 'video field: nothing saved').toBeUndefined();
    for (const shell of shells()) {
      const saved = await saveItem(page, M, 'TC-FKNO-11-02', { cover: shell });
      expect(await list(page).findByExcerpt(saved.excerpt), `cover ${shell.name}: nothing saved`).toBeUndefined();
    }
  });

  test(sheetTitle('TC-FKNO-11-06'), async ({ page, browser }) => {
    const saved = await saveAccepted(page, M, 'TC-FKNO-11-06', { documents: [pdfFile()], videoFiles: [fixtureFile('clip.mp4')] });
    const detail = await publicDetailOf(browser, M, saved);
    const doc = detail.media.documents[0].href;
    const token = /\/attachments\/([^/]+)\/download/.exec(doc)?.[1] ?? '';
    note(`Document URL ${doc}`);
    expect(decodeURIComponent(token).length, 'the file id is an opaque token, not a counter').toBeGreaterThan(20);
    const folders = new Set<string>(['/attachments/', `/attachments/${token}/`]);
    for (const src of detail.media.videos) folders.add(new URL(src).pathname.replace(/[^/]+$/, ''));
    for (const folder of folders) {
      const got = await visitorGet(browser, folder);
      note(`${folder} → ${got.status}`);
      expect([403, 404, 405], `${folder}: no listing`).toContain(got.status);
      expect(got.text, `${folder}: no "Index of"`).not.toMatch(/Index of/i);
    }
  });
});

