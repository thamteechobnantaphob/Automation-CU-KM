import fs from 'fs';
import { test, expect } from '@fixtures/pages.fixtures';
import { ANONYMOUS_SESSION } from '@fixtures/pages.fixtures';
import { requireDataCreatingTestsAllowed } from '@config/env';
import { MAX_LENGTH, POLICY_SOURCE, UPLOAD } from '@config/policy';
import { AdminActivityPage, AlbumCard, AlbumValues } from '@pages/admin/AdminActivityPage';
import { Submitted, submitAndFollow, UploadFile } from '@pages/admin/AdminNewsPages';
import { ALBUM_IMAGE, deleteAlbumsWhere, PanelError, panelErrors, publicActivity, PublicAlbum } from '@utils/activityFlows';
import { sheetTitle } from '@utils/caseTitles';
import { urlOf } from '@utils/lowPrivilege';
import { fetchAsVisitor, visitorGet } from '@utils/newsFlows';
import { roleStamp } from '@utils/roleFlows';
import { AUTO_TEST_FLAG } from '@utils/testData';
import { drawImage, emptyFile, exeBytes, FilePayload, fixtureFile, jpegWithOrientation, MB, paddedFile, payload, svgWithScript, truncatedFile } from '@utils/uploadFiles';
import { Browser, Page } from '@playwright/test';
import { decodedImageSize } from '../content/contentCases';
import { textOfLength } from '../content/contentLimitsSuite';

/**
 * KM-ADMA / KM-FALB — the album images, statuses, editing and the length limits (Auto:P + the {MAX} cases), checked
 * 2026-10-07. Album form: #album-image-upload (images[], png/jpeg, multiple) is posted with "บันทึก"; a refused file
 * refuses the whole album and the panel shows the server's message (today the raw key "validation.image" /
 * "validation.max.file" — DEF-66). Editing: an existing image is removed at once by its X (confirm, then DELETE).
 * Public: /frontend/activity/index → detail page /frontend/activity/detail/<id> (.activity-grid img, alt = the file's
 * name, each with a /download link).
 * Limits are the OWASP-based proposals in src/config/policy.ts (title 255, description 500, image 5 MB, 20 images per
 * upload) until SA/Dev decide (docs/policy-assumptions.md).
 * Every album carries "[Auto Test]" + a stamp in its description (or title) and is deleted again by the case.
 */

const CREATES = 'Saves an album (deleted again at the end of the case).';
const KNOWN = {
  RAW_KEY: 'Known bug (DEF-66): the file is refused but the message is the untranslated key ("validation.image" / "validation.max.file") — it does not say which types or what size are allowed.',
  BROKEN_FILES: 'Known bug (DEF-91): upload checks look only at the file header — a cut-off image is accepted, and a file named "image.jpg.exe" is accepted when its content is an image.',
  LONG_NAME_500: 'Known bug (DEF-102): an image whose file name is 256+ characters makes the save answer HTTP 500 — and the album is saved anyway, without the image.',
  FILE_LEFT: 'Known bug (DEF-100): a removed album image (or the images of a deleted album) is still served from /storage (HTTP 200).',
  NO_COVER_ORDER: 'Missing feature (DEF-104): the album panel has no way to choose the cover or reorder the images (the first image is the cover; existing images have only an X).',
  IMAGE_REMOVE_404: 'Known bug (DEF-108): removing an image from an album fails — DELETE …/activity/<id>/images/<id> answers 404 "No query results for model [App\\Models\\Album]" (the encrypted album id holds an encoded "/"), yet the panel hides the image as if it were gone.',
  DRAFT_AS_HIDDEN: 'Known bug (DEF-109): a draft ("ฉบับร่าง") is saved as hidden — the form posts status=draft but the item is stored and badged "ซ่อน" (slides, albums, footer menu).',
  DUPLICATE_KEPT: 'Known bug (DEF-110): the same image chosen twice is stored twice without a warning (the sheet asks to drop the duplicate or warn).',
  NARROW_SILENT: 'Known bug (DEF-105): an image narrower than the "อย่างน้อย 1,000 - 1,200px" the panel asks for is accepted without any warning.',
  NO_IMAGE_SAVED: 'Known bug (DEF-75): an album without any image is saved.',
};
const RAW = /\bvalidation\.[a-z_.]+/i;

test.beforeEach(() => test.setTimeout(180_000));

function note(description: string): void {
  test.info().annotations.push({ type: 'note', description });
}

const shown = (errors: PanelError[]): string => errors.filter((e) => e.visible).map((e) => e.text).join(' ');

interface AlbumRun {
  title: string;
  description: string;
  stamp: string;
  saved: Submitted;
  errors: PanelError[];
  /** Previews in the panel before saving. */
  previews: number;
  /** The saved album (undefined when refused). */
  card?: AlbumCard;
}

/**
 * Opens "เพิ่มอัลบัม", fills it (one 1200 × 675 PNG and status publish unless given), saves, runs `checks`, then deletes
 * every album carrying the case's stamp. The title is "AUTO_ALBUM_IMG <stamp>" and the description a marker unless given.
 */
async function albumCase(page: Page, values: AlbumValues, checks: (run: AlbumRun) => Promise<void>, stamp = roleStamp()): Promise<void> {
  requireDataCreatingTestsAllowed(CREATES);
  const activity = new AdminActivityPage(page);
  const title = values.title ?? `AUTO_ALBUM_IMG ${stamp}`;
  const description = values.description ?? `${AUTO_TEST_FLAG} อัลบัมทดสอบอัตโนมัติ ${stamp}`;
  const mine = (card: AlbumCard): boolean => card.editDescription.includes(stamp) || card.editTitle.includes(stamp);
  try {
    await activity.open();
    await activity.openAddForm();
    await activity.fill({ images: [ALBUM_IMAGE], status: 'publish', ...values, title, description });
    const previews = await activity.newImages.count();
    const saved = await activity.save();
    const errors = await panelErrors(page);
    note(`Save ${saved.first} → ${saved.final}; messages: ${JSON.stringify(errors.map((e) => e.text))}`);
    const card = (await activity.find(mine))?.card;
    note(card ? `Saved: ${card.imageCount} image(s) ${JSON.stringify(card.editImages.map((i) => i.url.split('/').pop()))}` : 'Not saved');
    await checks({ title, description, stamp, saved, errors, previews, card });
  } finally {
    note(`Cleanup: deleted ${await deleteAlbumsWhere(page, mine)} album(s).`);
  }
}

interface ShownImage {
  src: string;
  alt: string;
  loaded: boolean;
  naturalWidth: number;
  naturalHeight: number;
  width: number;
  height: number;
  objectFit: string;
  download: string;
}

/** The album's public card and detail page (images with their natural and drawn sizes), as a visitor sees them. */
async function publicAlbum(browser: Browser, title: string): Promise<{ card?: PublicAlbum; status: number; images: ShownImage[]; overflowX: number; loadMs: number; text: string }> {
  let card = (await publicActivity(browser)).albums.find((a) => a.title === title);
  if (!card) card = await publicCardOnLaterPages(browser, title);
  if (!card) return { card, status: 0, images: [], overflowX: 0, loadMs: 0, text: '' };
  const context = await browser.newContext({ storageState: ANONYMOUS_SESSION });
  try {
    const page = await context.newPage();
    const started = Date.now();
    const response = await page.goto(card.href);
    await page.waitForLoadState('load');
    const loadMs = Date.now() - started;
    await page.waitForTimeout(500);
    const images = await page.locator('.activity-grid img').evaluateAll((imgs) =>
      imgs.map((i) => {
        const img = i as HTMLImageElement;
        return {
          src: img.getAttribute('src') ?? '',
          alt: img.getAttribute('alt') ?? '',
          loaded: img.complete && img.naturalWidth > 0,
          naturalWidth: img.naturalWidth,
          naturalHeight: img.naturalHeight,
          width: img.clientWidth,
          height: img.clientHeight,
          objectFit: getComputedStyle(img).objectFit,
          download: img.dataset.download ?? '',
        };
      }),
    );
    const overflowX = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
    return { card, status: response?.status() ?? 0, images, overflowX, loadMs, text: (await page.locator('.body-content').innerText()).replace(/\s+/g, ' ') };
  } finally {
    await context.close();
  }
}

/** The public list is paginated (new albums go last): looks for the card on ?page=2.. until a page has no card. */
async function publicCardOnLaterPages(browser: Browser, title: string): Promise<PublicAlbum | undefined> {
  const context = await browser.newContext({ storageState: ANONYMOUS_SESSION });
  try {
    const page = await context.newPage();
    for (let n = 2; n <= 10; n++) {
      await page.goto(urlOf(`/frontend/activity/index?page=${n}`));
      const cards = await page.locator('.body-content a.card').evaluateAll((els) =>
        els.map((card) => {
          const img = card.querySelector('img.img-fluid, img.act-h-100') as HTMLImageElement | null;
          return {
            title: (card.querySelector('.card-title')?.textContent ?? '').replace(/\s+/g, ' ').trim(),
            description: (card.querySelector('.card-text')?.textContent ?? '').replace(/\s+/g, ' ').trim(),
            counters: [...card.querySelectorAll('.text-small')].map((s) => Number((s.textContent ?? '').trim()) || 0),
            href: card.getAttribute('href') ?? '',
            image: img?.getAttribute('src') ?? '',
            imageLoaded: !!img && img.complete && img.naturalWidth > 0,
          };
        }),
      );
      const found = cards.find((c) => c.title === title);
      if (found) {
        note(`Found on public page ${n}.`);
        return found;
      }
      if (!cards.length) break;
    }
    return undefined;
  } finally {
    await context.close();
  }
}

/** Drawn without stretching: with object-fit fill the drawn ratio equals the image's own ratio (2 % slack). */
function undistorted(image: ShownImage): boolean {
  if (image.objectFit !== 'fill' || !image.width || !image.height) return true;
  return Math.abs(image.width / image.height - image.naturalWidth / image.naturalHeight) / (image.naturalWidth / image.naturalHeight) < 0.02;
}

/** The files are saved as one album, the panel previewed them, and the public page shows every image whole. */
async function imagesAccepted(page: Page, browser: Browser, files: UploadFile[], more?: (run: AlbumRun, shown: Awaited<ReturnType<typeof publicAlbum>>) => Promise<void>): Promise<void> {
  await albumCase(page, { images: files }, async (run) => {
    expect(run.saved.final, 'no server error').toBeLessThan(500);
    expect(run.previews, 'the panel previews every chosen image').toBe(files.length);
    expect(run.card, 'the album is saved').toBeDefined();
    expect(run.card!.imageCount, `all ${files.length} image(s) are stored`).toBe(files.length);
    const pub = await publicAlbum(browser, run.title);
    note(`Public: ${pub.images.length} image(s) ${JSON.stringify(pub.images.map((i) => `${i.alt} ${i.naturalWidth}x${i.naturalHeight} drawn ${i.width}x${i.height} ${i.objectFit}`))}; overflow ${pub.overflowX}px; load ${pub.loadMs} ms`);
    expect(pub.card, 'listed on the public activity page').toBeDefined();
    expect(pub.card!.imageLoaded, 'the public card image loads').toBe(true);
    expect(pub.images.length, 'the detail page shows every image').toBe(files.length);
    for (const image of pub.images) {
      expect.soft(image.loaded, `${image.alt} loads`).toBe(true);
      expect.soft(undistorted(image), `${image.alt} is not stretched`).toBe(true);
    }
    expect(pub.overflowX, 'the layout does not break (no sideways scroll)').toBeLessThanOrEqual(1);
    if (more) await more(run, pub);
  });
}

/**
 * The files are refused: no server error, nothing saved, and a visible message matching `about` (when the case asks
 * for a reason). A raw key is DEF-66 and is checked last.
 */
async function imagesRefused(page: Page, files: UploadFile[], about?: RegExp): Promise<void> {
  await albumCase(page, { images: files }, async (run) => {
    expect(run.saved.final, 'no server error').toBeLessThan(500);
    expect(run.card, 'the album is not saved (no half-saved album)').toBeUndefined();
    if (!about) return;
    const text = shown(run.errors);
    expect(text, 'a message is shown').not.toBe('');
    test.fail(RAW.test(text), KNOWN.RAW_KEY);
    expect(text, 'a readable message, not a raw key').not.toMatch(RAW);
    expect(text, 'the message says why').toMatch(about);
  });
}

const TYPE_MESSAGE = /PNG|JPE?G|ชนิด|ประเภท|นามสกุล|รองรับ/i;
const SIZE_MESSAGE = /MB|ขนาด/;
const EMPTY_MESSAGE = /ว่าง|0\s*(ไบต์|byte)|ไม่มีข้อมูล|ขนาด/i;

const png = (name = 'image.png'): FilePayload => payload(name, fs.readFileSync(ALBUM_IMAGE), 'image/png');
const oversized = (base: FilePayload, bytes: number, name: string): FilePayload => paddedFile(base, bytes, name);

/** Edits the album that carries `stamp`: `act` runs in the open edit panel, then "บันทึก". */
async function editAlbum(page: Page, stamp: string, act: (activity: AdminActivityPage) => Promise<void>): Promise<Submitted> {
  const activity = new AdminActivityPage(page);
  await activity.openEditForm((c) => c.editDescription.includes(stamp) || c.editTitle.includes(stamp));
  await act(activity);
  return activity.save();
}

const findMine = async (page: Page, stamp: string): Promise<AlbumCard | undefined> =>
  (await new AdminActivityPage(page).find((c) => c.editDescription.includes(stamp) || c.editTitle.includes(stamp)))?.card;

// ---------------------------------------------------------------------------------------------------------------

test.describe('SC-ADMA-02 / SC-FALB-05 เพิ่ม แก้ไข ลบอัลบั้ม', () => {
  test(sheetTitle('TC-ADMA-02-02'), async ({ page }) => {
    // .exe and an image over the size limit, chosen together.
    const big = oversized(png('big.png'), UPLOAD.imageMaxMB * MB + 1024, 'big.png');
    await imagesRefused(page, [payload('virus.exe', exeBytes(), 'application/x-msdownload'), big], /PNG|JPE?G|ชนิด|รองรับ|MB|ขนาด/i);
  });

  test(sheetTitle('TC-ADMA-02-03'), async ({ page, browser }) => {
    await albumCase(page, { images: [png('a1.png'), png('a2.png')] }, async (run) => {
      expect(run.card?.imageCount, 'precondition: an album with 2 images').toBe(2);
      const removedUrl = run.card!.editImages[0].url;
      const newTitle = `AUTO_ALBUM_EDIT ${run.stamp}`;
      const saved = await editAlbum(page, run.stamp, async (activity) => {
        await activity.fill({ title: newTitle, images: [png('a3.png')] });
        const removed0 = await activity.removeExistingImage(0);
      test.fail(removed0 === 404, KNOWN.IMAGE_REMOVE_404);
      expect(removed0, 'the image is removed').toBeLessThan(400);
      });
      expect(saved.final, 'no server error').toBeLessThan(500);
      const card = await findMine(page, run.stamp);
      note(`After edit: ${card?.editTitle} ${card?.imageCount} image(s)`);
      expect(card?.editTitle, 'the new name is saved').toBe(newTitle);
      expect(card?.imageCount, 'admin: 2 − 1 + 1 = 2 images').toBe(2);
      expect(card!.editImages.map((i) => i.url), 'the removed image is gone from the album').not.toContain(removedUrl);
      const pub = await publicAlbum(browser, newTitle);
      expect(pub.card, 'public: listed under the new name').toBeDefined();
      expect(pub.images.length, 'public: 2 images').toBe(2);
      expect(pub.images.map((i) => i.alt).sort(), 'public: the kept and the added image').toEqual(['a2', 'a3']);
    });
  });

  test(sheetTitle('TC-FALB-05-01'), async ({ page, browser }) => {
    await albumCase(page, { images: [png('b1.png'), png('b2.png'), png('b3.png')] }, async (run) => {
      expect(run.card?.imageCount, 'precondition: 3 images').toBe(3);
      const removedUrl = run.card!.editImages[1].url;
      const activity = new AdminActivityPage(page);
      await activity.openEditForm((c) => c.editDescription.includes(run.stamp));
      expect(await activity.titleInput.inputValue(), 'the form shows the stored name').toBe(run.title);
      expect(await activity.descriptionInput.inputValue(), 'the form shows the stored description').toBe(run.description);
      expect(await activity.existingImages.count(), 'the form shows the 3 stored images').toBe(3);
      const removed1 = await activity.removeExistingImage(1);
      test.fail(removed1 === 404, KNOWN.IMAGE_REMOVE_404);
      expect(removed1, 'the image is removed').toBeLessThan(400);
      await activity.fill({ images: [png('b4.png'), png('b5.png')] });
      const saved = await activity.save();
      expect(saved.final).toBeLessThan(500);
      const card = await findMine(page, run.stamp);
      expect(card?.imageCount, '3 − 1 + 2 = 4 images').toBe(4);
      const pub = await publicAlbum(browser, run.title);
      expect(pub.images.length, 'public: 4 images').toBe(4);
      const removed = await fetchAsVisitor(browser, removedUrl);
      note(`Removed image ${removedUrl.split('/').pop()}: HTTP ${removed.status}`);
      test.fail(removed.status === 200, KNOWN.FILE_LEFT);
      expect(removed.status, 'the removed image can no longer be opened').not.toBe(200);
    });
  });

  test(sheetTitle('TC-FALB-05-02'), async ({ page, browser }) => {
    await albumCase(page, { images: [png('c1.png'), png('c2.png')] }, async (run) => {
      const activity = new AdminActivityPage(page);
      const mine = (c: AlbumCard): boolean => c.editDescription.includes(run.stamp);
      const urls = run.card!.editImages.map((i) => i.url);
      const cancel = await activity.openDeleteDialog(mine);
      await cancel.cancel();
      expect(await activity.find(mine), '"ยกเลิก": the album is still there').toBeDefined();
      expect((await publicAlbum(browser, run.title)).card, '…and still public').toBeDefined();
      const confirm = await activity.openDeleteDialog(mine);
      const result = await submitAndFollow(page, () => confirm.confirm());
      expect(result.final).toBeLessThan(500);
      expect(await activity.find(mine), '"ยืนยันลบข้อมูล": gone from the admin list').toBeUndefined();
      expect((await publicAlbum(browser, run.title)).card, 'gone from the public page').toBeUndefined();
      const statuses = await Promise.all(urls.map(async (u) => (await fetchAsVisitor(browser, u)).status));
      note(`Images after the delete: ${JSON.stringify(statuses)}`);
      test.fail(statuses.includes(200), KNOWN.FILE_LEFT);
      expect(statuses.filter((s) => s === 200), 'its images can no longer be opened').toEqual([]);
    });
  });
});

test.describe('SC-ADMA-03 / SC-FALB-02 ความยาวชื่อและคำอธิบายอัลบั้ม', () => {
  /** A field of exactly `max` characters: saved whole and shown whole on the public page without breaking the layout. */
  async function atMax(page: Page, browser: Browser, field: 'title' | 'description', max: number): Promise<void> {
    note(`Limit used: ${POLICY_SOURCE}`);
    const stamp = roleStamp();
    const value = textOfLength(field === 'title' ? `AUTO_${stamp}` : `${AUTO_TEST_FLAG} ${stamp}`, max);
    await albumCase(page, { [field]: value, ...(field === 'title' ? { description: `${AUTO_TEST_FLAG} ${stamp}` } : { title: `AUTO_ALBUM ${stamp}` }) }, async (run) => {
      expect(run.saved.final, 'no server error').toBeLessThan(500);
      expect(run.card, `a ${field} of ${max} characters is saved`).toBeDefined();
      expect(field === 'title' ? run.card!.editTitle : run.card!.editDescription, 'stored whole').toBe(value);
      const pub = await publicAlbum(browser, field === 'title' ? value : run.title);
      expect(pub.card, 'listed publicly').toBeDefined();
      note(`Public detail overflow ${pub.overflowX}px`);
      expect(pub.text, 'the public page shows it whole').toContain(value.replace(/\s+/g, ' '));
      expect(pub.overflowX, 'the layout does not break (no sideways scroll)').toBeLessThanOrEqual(1);
    }, stamp);
  }

  /** `max` + 1 characters: refused with a length message (or the input stops at `max`); never a server error. */
  async function overMax(page: Page, field: 'title' | 'description', max: number): Promise<void> {
    note(`Limit used: ${POLICY_SOURCE}`);
    const stamp = roleStamp();
    const value = textOfLength(field === 'title' ? `AUTO_${stamp}` : `${AUTO_TEST_FLAG} ${stamp}`, max + 1);
    const activity = new AdminActivityPage(page);
    await activity.open();
    await activity.openAddForm();
    const input = field === 'title' ? activity.titleInput : activity.descriptionInput;
    const maxlength = await input.getAttribute('maxlength');
    note(`maxlength: ${maxlength ?? '(none)'}`);
    await activity.cancelButton.click();
    if (maxlength && Number(maxlength) <= max) return;
    await albumCase(page, { [field]: value, ...(field === 'title' ? { description: `${AUTO_TEST_FLAG} ${stamp}` } : { title: `AUTO_ALBUM ${stamp}` }) }, async (run) => {
      expect(run.saved.final, 'no server error').toBeLessThan(500);
      test.fail(Boolean(run.card) && field === 'description', 'Known bug (DEF-101): the album description has no length limit — 501 characters (proposed maximum 500) are saved.');
      expect(run.card, `${max + 1} characters are not saved`).toBeUndefined();
      const text = shown(run.errors);
      expect(text, 'a message about the length').toMatch(/ต้องไม่เกิน|ไม่เกิน\s*\d+|ยาวเกิน|ความยาว|\bvalidation\.max/);
      test.fail(RAW.test(text), 'Known bug (DEF-66): the length is refused but the message is the raw key "validation.max.string".');
      expect(text, 'a readable message, not a raw key').not.toMatch(RAW);
    }, stamp);
  }

  test(sheetTitle('TC-ADMA-03-02'), ({ page, browser }) => atMax(page, browser, 'title', MAX_LENGTH.albumTitle));
  test(sheetTitle('TC-ADMA-03-03'), ({ page }) => overMax(page, 'title', MAX_LENGTH.albumTitle));
  test(sheetTitle('TC-FALB-02-04'), ({ page, browser }) => atMax(page, browser, 'title', MAX_LENGTH.albumTitle));
  test(sheetTitle('TC-FALB-02-05'), ({ page }) => overMax(page, 'title', MAX_LENGTH.albumTitle));
  test(sheetTitle('TC-FALB-02-14'), ({ page, browser }) => atMax(page, browser, 'description', MAX_LENGTH.description));
  test(sheetTitle('TC-FALB-02-15'), ({ page }) => overMax(page, 'description', MAX_LENGTH.description));
});

test.describe('SC-ADMA-04 รูปภาพในอัลบั้ม', () => {
  test(sheetTitle('TC-ADMA-04-01'), async ({ page, browser }) => {
    await imagesAccepted(page, browser, [await drawImage(page, 'image.jpg', { width: 1200, height: 800, type: 'image/jpeg' })]);
  });
  test(sheetTitle('TC-ADMA-04-02'), async ({ page, browser }) => {
    await imagesAccepted(page, browser, [await drawImage(page, 'image.png', { width: 1200, height: 800, type: 'image/png', transparent: true })]);
  });
  test(sheetTitle('TC-ADMA-04-03'), async ({ page }) => {
    await imagesRefused(page, [fixtureFile('sample.pdf', 'doc.pdf')], TYPE_MESSAGE);
  });
  test(sheetTitle('TC-ADMA-04-04'), async ({ page }) => {
    await imagesRefused(page, [payload('fake.jpg', exeBytes(), 'image/jpeg')]);
  });
  test(sheetTitle('TC-ADMA-04-05'), async ({ page }) => {
    note(`Limit used: ${POLICY_SOURCE}`);
    await imagesRefused(page, [oversized(png('big.png'), UPLOAD.imageMaxMB * MB + 1024, 'big.png')], SIZE_MESSAGE);
  });
  test(sheetTitle('TC-ADMA-04-07'), async ({ page, browser }) => {
    // "อัปโหลดสำเร็จ หรือแจ้งว่าไม่รองรับอย่างชัดเจน (TBD)": either is fine, a refusal must say why.
    const webp = await drawImage(page, 'image.webp', { width: 1200, height: 675, type: 'image/webp' });
    await albumCase(page, { images: [webp] }, async (run) => {
      expect(run.saved.final, 'no server error').toBeLessThan(500);
      if (run.card) {
        const pub = await publicAlbum(browser, run.title);
        expect(pub.images[0]?.loaded, 'the WEBP shows publicly').toBe(true);
        return;
      }
      const text = shown(run.errors);
      expect(text, 'a refusal says why').not.toBe('');
      test.fail(RAW.test(text), KNOWN.RAW_KEY);
      expect(text).not.toMatch(RAW);
    });
  });
  test(sheetTitle('TC-ADMA-04-08'), async ({ page, browser }) => {
    note(`Limit used: ${POLICY_SOURCE}`);
    const base = await drawImage(page, 'max.png', { width: 1200, height: 675, type: 'image/png' });
    await imagesAccepted(page, browser, [paddedFile(base, UPLOAD.imageMaxMB * MB, 'max.png')]);
  });
  test(sheetTitle('TC-ADMA-04-09'), async ({ page, browser }) => {
    await albumCase(page, { images: [svgWithScript('evil.svg')] }, async (run) => {
      expect(run.saved.final, 'no server error').toBeLessThan(500);
      if (!run.card) return; // refused: fine
      // Kept: it must not run as a page.
      for (const image of run.card.editImages) {
        const got = await fetchAsVisitor(browser, image.url);
        note(`${image.url}: ${got.status} ${got.type}`);
        expect(got.type, 'not served as SVG/HTML').not.toMatch(/svg|html/i);
      }
    });
  });
  test(sheetTitle('TC-ADMA-04-10'), async ({ page }) => {
    await imagesRefused(page, [emptyFile('empty.jpg')], EMPTY_MESSAGE);
  });
  test(sheetTitle('TC-ADMA-04-11'), async ({ page }) => {
    const broken = truncatedFile(await drawImage(page, 'broken.jpg', { width: 1200, height: 675, type: 'image/jpeg' }), 'broken.jpg');
    await albumCase(page, { images: [broken] }, async (run) => {
      expect(run.saved.final, 'no server error').toBeLessThan(500);
      test.fail(Boolean(run.card), KNOWN.BROKEN_FILES);
      expect(run.card, 'a cut-off image is refused').toBeUndefined();
      expect(shown(run.errors), 'the admin is told the image cannot be read').not.toBe('');
    });
  });
  test(sheetTitle('TC-ADMA-04-12'), async ({ page, browser }) => {
    // image.php.jpg (an image) may be kept as an image; image.jpg.exe must be refused. Neither may run on the server.
    await albumCase(page, { images: [png('image.php.jpg'), payload('image.jpg.exe', png().buffer, 'application/x-msdownload')] }, async (run) => {
      expect(run.saved.final, 'no server error').toBeLessThan(500);
      const stored = run.card?.editImages.map((i) => i.url) ?? [];
      note(`Stored as: ${JSON.stringify(stored.map((u) => u.split('/').pop()))}`);
      expect(stored.filter((u) => /\.(php|exe|phtml)(\?|$)/i.test(u)), 'nothing is stored with a runnable extension').toEqual([]);
      for (const url of stored) {
        const got = await fetchAsVisitor(browser, url);
        expect(got.type, `${url.split('/').pop()} is served as an image`).toMatch(/^image\//);
      }
      test.fail(Boolean(run.card), KNOWN.BROKEN_FILES);
      expect(run.card, '"image.jpg.exe" is refused (its real extension is not allowed)').toBeUndefined();
    });
  });
  test(sheetTitle('TC-ADMA-04-13'), async ({ page, browser }) => {
    const name = 'รูป กิจกรรม 1.jpg';
    await imagesAccepted(page, browser, [await drawImage(page, name, { width: 1200, height: 675, type: 'image/jpeg' })], async (_run, pub) => {
      expect(pub.images[0].alt, 'the Thai name is kept (alt) without mojibake').toBe('รูป กิจกรรม 1');
    });
  });
  test(sheetTitle('TC-ADMA-04-14'), async ({ page }) => {
    const name = `${'ก'.repeat(256)}.png`;
    await albumCase(page, { images: [png(name)] }, async (run) => {
      test.fail(run.saved.first >= 500 || run.saved.final >= 500, KNOWN.LONG_NAME_500);
      expect(run.saved.first, 'no server error').toBeLessThan(500);
      expect(run.saved.final, 'no server error').toBeLessThan(500);
      if (run.card) expect(run.card.imageCount, 'saved with its image (name shortened)').toBe(1);
      else expect(shown(run.errors), 'or refused with a message').not.toBe('');
    });
  });
  test(sheetTitle('TC-ADMA-04-15'), async ({ page, browser }) => {
    const big = await drawImage(page, 'big.jpg', { width: 8000, height: 6000, type: 'image/jpeg', quality: 0.6 });
    note(`8000 × 6000 JPEG: ${(big.buffer.length / MB).toFixed(2)} MB`);
    expect(big.buffer.length, `the file is within ${UPLOAD.imageMaxMB} MB`).toBeLessThanOrEqual(UPLOAD.imageMaxMB * MB);
    await imagesAccepted(page, browser, [big], async (run, pub) => {
      const served = await fetchAsVisitor(browser, pub.images[0].src);
      note(`Served ${pub.images[0].naturalWidth} × ${pub.images[0].naturalHeight}, ${(served.body.length / MB).toFixed(2)} MB; detail page loaded in ${pub.loadMs} ms`);
      expect(pub.loadMs, 'the public page is not abnormally slow (< 5 s)').toBeLessThan(5_000);
    });
  });
});

test.describe('SC-ADMA-05 หลายรูป ลบรูป ปก และตัวนับ', () => {
  test(sheetTitle('TC-ADMA-05-01'), async ({ page, browser }) => {
    note(`Limit used: ${POLICY_SOURCE}`);
    const files = Array.from({ length: UPLOAD.imagesPerUpload }, (_, i) => png(`img-${String(i + 1).padStart(2, '0')}.png`));
    await imagesAccepted(page, browser, files, async (_run, pub) => {
      expect(pub.images.map((i) => i.alt), 'in the chosen order').toEqual(files.map((f) => f.name.replace(/\.png$/, '')));
    });
  });
  test(sheetTitle('TC-ADMA-05-02'), async ({ page, browser }) => {
    const a = await drawImage(page, 'a.jpg', { width: 1200, height: 675, type: 'image/jpeg' });
    const b = await drawImage(page, 'a.jpg', { width: 1000, height: 1000, type: 'image/jpeg' });
    await imagesAccepted(page, browser, [a, b], async (run, pub) => {
      const urls = run.card!.editImages.map((i) => i.url);
      expect(new Set(urls).size, 'stored as two files (no overwrite)').toBe(2);
      expect(pub.images.map((i) => `${i.naturalWidth}x${i.naturalHeight}`).sort(), 'both contents are kept').toEqual(['1000x1000', '1200x675']);
    });
  });
  test(sheetTitle('TC-ADMA-05-03'), async ({ page, browser }) => {
    await albumCase(page, { images: [png('d1.png'), png('d2.png'), png('d3.png')] }, async (run) => {
      const removedUrl = run.card!.editImages[1].url;
      const activity = new AdminActivityPage(page);
      await activity.openEditForm((c) => c.editDescription.includes(run.stamp));
      const removed1 = await activity.removeExistingImage(1);
      test.fail(removed1 === 404, KNOWN.IMAGE_REMOVE_404);
      expect(removed1, 'the 2nd image is removed').toBeLessThan(400);
      await activity.cancelButton.click();
      const card = await findMine(page, run.stamp);
      expect(card?.imageCount, '2 images left').toBe(2);
      const pub = await publicAlbum(browser, run.title);
      expect(pub.images.map((i) => i.alt), 'the album still works publicly').toEqual(['d1', 'd3']);
      const removed = await fetchAsVisitor(browser, removedUrl);
      note(`Removed image: HTTP ${removed.status}`);
      test.fail(removed.status === 200, KNOWN.FILE_LEFT);
      expect(removed.status, 'the removed file can no longer be opened').not.toBe(200);
    });
  });
  test(sheetTitle('TC-ADMA-05-04'), async ({ page }) => {
    await albumCase(page, { images: [png('e1.png'), png('e2.png'), png('e3.png')] }, async (run) => {
      const activity = new AdminActivityPage(page);
      await activity.openEditForm((c) => c.editDescription.includes(run.stamp));
      const controls = await activity.panel.locator('#album-existing-images *').evaluateAll((els) =>
        els.filter((e) => /ปก|cover|drag|sort|order|ลำดับ/i.test(`${e.className} ${e.textContent} ${e.getAttribute('title') ?? ''} ${e.getAttribute('draggable') ?? ''}`)).map((e) => e.outerHTML.slice(0, 120)),
      );
      note(`Cover / order controls on the existing images: ${JSON.stringify(controls)}`);
      await activity.cancelButton.click();
      test.fail(controls.length === 0, KNOWN.NO_COVER_ORDER);
      expect(controls.length, 'a way to choose the cover and reorder the images').toBeGreaterThan(0);
    });
  });
  test(sheetTitle('TC-ADMA-05-06'), async ({ page, browser }) => {
    // "แจ้งให้เลือกรูป หรือเผยแพร่ได้โดยหน้า Public แสดงสถานะว่างอย่างเหมาะสม (TBD)".
    await albumCase(page, { images: [] }, async (run) => {
      expect(run.saved.final, 'no server error').toBeLessThan(500);
      if (!run.card) {
        expect(shown(run.errors), 'the admin is asked for an image').not.toBe('');
        return;
      }
      note(KNOWN.NO_IMAGE_SAVED);
      const pub = await publicAlbum(browser, run.title);
      note(`Public card image ${pub.card?.image} loaded=${pub.card?.imageLoaded}; detail ${pub.status}, ${pub.images.length} image(s)`);
      expect(pub.card, 'listed publicly').toBeDefined();
      expect(pub.card!.imageLoaded, 'the card shows a placeholder, not a broken image').toBe(true);
      expect(pub.status, 'the detail page opens').toBe(200);
      expect(pub.images.filter((i) => !i.loaded), 'no broken image on the detail page').toEqual([]);
    });
  });
  test(sheetTitle('TC-ADMA-05-07'), async ({ page, browser }) => {
    await albumCase(page, {}, async (run) => {
      const activity = new AdminActivityPage(page);
      const total = async (): Promise<number> => {
        await activity.open();
        return Number(/([\d,]+)/.exec(await activity.downloadSummary.innerText())?.[1].replace(/,/g, '') ?? NaN);
      };
      const beforeTotal = await total();
      const pub = await publicAlbum(browser, run.title);
      const link = pub.images[0]?.download;
      expect(link, 'the image has a download link').toBeTruthy();
      for (let i = 0; i < 3; i++) {
        const got = await fetchAsVisitor(browser, link);
        expect(got.status, `download ${i + 1}`).toBe(200);
      }
      const card = await findMine(page, run.stamp);
      const afterTotal = await total();
      note(`Album counter ${card?.downloadCount}; "ดาวน์โหลด n ครั้ง" ${beforeTotal} → ${afterTotal}. Dashboard comparison is TBD in the sheet (not checked).`);
      expect([1, 3], 'the album counter grows by 3 (or 1 per session)').toContain(card?.downloadCount);
      expect(afterTotal - beforeTotal, 'the page total grows by the same amount').toBe(card?.downloadCount);
    });
  });
});

test.describe('SC-FALB-03 รูปภาพอัลบัม', () => {
  test(sheetTitle('TC-FALB-03-01'), async ({ page, browser }) => {
    await imagesAccepted(page, browser, [await drawImage(page, 'image.png', { width: 1920, height: 1080, type: 'image/png' })]);
  });
  test(sheetTitle('TC-FALB-03-02'), async ({ page, browser }) => {
    await imagesAccepted(page, browser, [await drawImage(page, 'image.jpg', { width: 1920, height: 1080, type: 'image/jpeg' })]);
  });
  test(sheetTitle('TC-FALB-03-03'), async ({ page, browser }) => {
    await imagesAccepted(page, browser, [await drawImage(page, 'transparent.png', { width: 1200, height: 675, type: 'image/png', transparent: true })], async (run) => {
      const stored = await fetchAsVisitor(browser, run.card!.editImages[0].url);
      expect(stored.type, 'kept as PNG (transparency not flattened to JPEG)').toMatch(/png/);
    });
  });
  test(sheetTitle('TC-FALB-03-04'), async ({ page, browser }) => {
    await imagesAccepted(page, browser, [await jpegWithOrientation(page, 'phone_portrait.jpg', 1200, 900)], async (run) => {
      const size = await decodedImageSize(browser, run.card!.editImages[0].url);
      note(`Decoded ${size.width} × ${size.height} (drawn 1200 × 900 landscape + EXIF orientation 6)`);
      expect(size.height, 'shown upright (portrait)').toBeGreaterThan(size.width);
    });
  });
  test(sheetTitle('TC-FALB-03-05'), async ({ page, browser }) => {
    await imagesAccepted(page, browser, [await drawImage(page, 'ภาพ กิจกรรม 1.jpg', { width: 1200, height: 675, type: 'image/jpeg' })], async (_run, pub) => {
      expect(pub.images[0].alt, 'the name is kept without mojibake').toBe('ภาพ กิจกรรม 1');
    });
  });
  test(sheetTitle('TC-FALB-03-06'), async ({ page, browser }) => {
    await imagesAccepted(page, browser, [await drawImage(page, '4k.jpg', { width: 3840, height: 2160, type: 'image/jpeg' })], async (_run, pub) => {
      note(`Detail page loaded in ${pub.loadMs} ms; served ${pub.images[0].naturalWidth} × ${pub.images[0].naturalHeight}`);
      expect(pub.loadMs, 'the public page is not abnormally slow (< 5 s)').toBeLessThan(5_000);
    });
  });
  test(sheetTitle('TC-FALB-03-07'), async ({ page, browser }) => {
    // Below the recommended size: "เตือน/รับได้ตามกติกา (TBD)" — accepted and usable is a pass.
    await imagesAccepted(page, browser, [await drawImage(page, 'small.jpg', { width: 800, height: 450, type: 'image/jpeg' })]);
  });
  test(sheetTitle('TC-FALB-03-08'), async ({ page, browser }) => {
    await imagesAccepted(page, browser, [
      await drawImage(page, 'square.jpg', { width: 1080, height: 1080, type: 'image/jpeg' }),
      await drawImage(page, 'tall.jpg', { width: 1080, height: 1920, type: 'image/jpeg' }),
    ]);
  });
  test(sheetTitle('TC-FALB-03-09'), async ({ page }) => {
    const narrow = await drawImage(page, 'narrow.jpg', { width: 800, height: 600, type: 'image/jpeg' });
    await albumCase(page, { images: [narrow] }, async (run) => {
      expect(run.saved.final, 'no server error').toBeLessThan(500);
      const flash = (await page.locator('.alert').allInnerTexts()).join(' ');
      const warned = /กว้าง|1,?000|px/.test(`${shown(run.errors)} ${flash}`);
      note(`Saved: ${Boolean(run.card)}; warning: ${warned}`);
      test.fail(Boolean(run.card) && !warned, KNOWN.NARROW_SILENT);
      expect(!run.card || warned, 'refused, or accepted with a warning about the width').toBe(true);
    });
  });
  test(sheetTitle('TC-FALB-03-10'), async ({ page, browser }) => {
    await imagesAccepted(page, browser, [
      await drawImage(page, 'w1000.jpg', { width: 1000, height: 563, type: 'image/jpeg' }),
      await drawImage(page, 'w1200.jpg', { width: 1200, height: 675, type: 'image/jpeg' }),
    ]);
  });
  test(sheetTitle('TC-FALB-03-11'), async ({ page, browser }) => {
    await imagesAccepted(page, browser, [await drawImage(page, 'w4000.jpg', { width: 4000, height: 2250, type: 'image/jpeg' })], async (_run, pub) => {
      note(`Served ${pub.images[0].naturalWidth} × ${pub.images[0].naturalHeight}; detail page ${pub.loadMs} ms`);
      expect(pub.loadMs, 'the public page is not abnormally slow (< 5 s)').toBeLessThan(5_000);
    });
  });
  test(sheetTitle('TC-FALB-03-12'), async ({ page, browser }) => {
    await imagesAccepted(page, browser, [await drawImage(page, 'portrait.jpg', { width: 1200, height: 1800, type: 'image/jpeg' })]);
  });
  test(sheetTitle('TC-FALB-03-13'), async ({ page, browser }) => {
    const files = Array.from({ length: 5 }, (_, i) => png(`five-${i + 1}.png`));
    await imagesAccepted(page, browser, files, async (run, pub) => {
      expect(run.card!.imageCount, 'the card counts 5').toBe(5);
      expect(pub.images.map((i) => i.alt), 'in the chosen order').toEqual(files.map((f) => f.name.replace(/\.png$/, '')));
    });
  });
  test(sheetTitle('TC-FALB-03-14'), async ({ page, browser }) => {
    // 30 at once (above the proposed 20 per upload): all saved, or refused as a whole with a clear message — never a
    // partial album without a word.
    const files = Array.from({ length: 30 }, (_, i) => png(`thirty-${String(i + 1).padStart(2, '0')}.png`));
    await albumCase(page, { images: files }, async (run) => {
      expect(run.saved.final, 'no server error / no timeout').toBeLessThan(500);
      expect(run.previews, 'the panel previews all 30').toBe(30);
      if (run.card) {
        expect(run.card.imageCount, 'all 30 images are stored').toBe(30);
        const pub = await publicAlbum(browser, run.title);
        expect(pub.images.length, 'all 30 show publicly').toBe(30);
      } else {
        expect(shown(run.errors), 'a refusal says why (the number of images)').toMatch(/รูป|ไฟล์|\d+/);
      }
    });
  });
  test(sheetTitle('TC-FALB-03-15'), async ({ page }) => {
    await imagesRefused(page, [png('ok-1.png'), png('ok-2.png'), png('ok-3.png'), fixtureFile('sample.pdf', 'doc.pdf')], TYPE_MESSAGE);
  });
  test(sheetTitle('TC-FALB-03-16'), async ({ page }) => {
    // The same file chosen twice: "ตัดซ้ำหรือแจ้งเตือน (TBD)".
    const same = png('image.png');
    await albumCase(page, { images: [same, same] }, async (run) => {
      expect(run.saved.final, 'no server error').toBeLessThan(500);
      note(`Previews ${run.previews}; stored ${run.card?.imageCount ?? 0}`);
      const warned = shown(run.errors) !== '';
      const handled = run.card?.imageCount === 1 || warned || run.previews === 1;
      test.fail(!handled, KNOWN.DUPLICATE_KEPT);
      expect(handled, 'the duplicate is dropped or the admin is warned').toBe(true);
    });
  });
});

test.describe('SC-FALB-04 สถานะอัลบัม', () => {
  test(sheetTitle('TC-FALB-04-01'), async ({ page, browser }) => {
    await albumCase(page, { title: `AUTO_ALBUM_PUB ${roleStamp()}` }, async (run) => {
      const pub = await publicAlbum(browser, run.title);
      expect(pub.card, 'listed on /frontend/activity/index').toBeDefined();
      expect(pub.card!.imageLoaded, 'with its cover').toBe(true);
      expect(pub.status, 'the album opens').toBe(200);
      expect(pub.images.length, 'its image is shown').toBe(1);
      expect(pub.images[0].loaded, 'and loads').toBe(true);
    });
  });

  test(sheetTitle('TC-FALB-04-02'), async ({ page, browser }) => {
    for (const status of ['draft', 'hide'] as const) {
      await albumCase(page, { title: `AUTO_ALBUM_${status.toUpperCase()} ${roleStamp()}`, status }, async (run) => {
        expect(run.card, `${status}: still in the admin list`).toBeDefined();
        const badge = status === 'draft' ? 'ฉบับร่าง' : 'ซ่อน';
        test.fail(status === 'draft' && run.card!.status !== badge, KNOWN.DRAFT_AS_HIDDEN);
        expect.soft(run.card!.status, `${status}: with its badge`).toBe(badge);
        expect((await publicAlbum(browser, run.title)).card, `${status}: not on the public list`).toBeUndefined();
        const search = await visitorGet(browser, `/frontend/search/index?q=${encodeURIComponent(run.stamp)}`);
        expect(search.text, `${status}: not in the search results`).not.toContain(run.title);
        // The direct link exists only while published: publish once to learn it, then switch back.
        await editAlbum(page, run.stamp, (a) => a.fill({ status: 'publish' }));
        const href = (await publicAlbum(browser, run.title)).card?.href;
        expect(href, 'published, it gets a public link').toBeTruthy();
        await editAlbum(page, run.stamp, (a) => a.fill({ status }));
        const direct = await visitorGet(browser, new URL(href!).pathname + new URL(href!).search);
        note(`${status}: direct link ${direct.status}`);
        expect(direct.status, `${status}: the direct link answers 404`).toBe(404);
      });
    }
  });

  test(sheetTitle('TC-FALB-04-03'), async ({ page, browser }) => {
    await albumCase(page, {}, async (run) => {
      const before = await publicAlbum(browser, run.title);
      expect(before.card, 'precondition: published').toBeDefined();
      const imageUrl = run.card!.editImages[0].url;
      const saved = await editAlbum(page, run.stamp, (a) => a.fill({ status: 'hide' }));
      expect(saved.final).toBeLessThan(500);
      expect((await findMine(page, run.stamp))?.status, 'the badge says ซ่อน').toBe('ซ่อน');
      expect((await publicAlbum(browser, run.title)).card, 'gone from the public page').toBeUndefined();
      const direct = await fetchAsVisitor(browser, before.card!.href);
      const image = await fetchAsVisitor(browser, imageUrl);
      note(`Hidden album: direct link ${direct.status}; image file ${image.status} (whether the files stay reachable is TBD in the sheet)`);
      expect(direct.status, 'its page is no longer reachable').toBe(404);
    });
  });
});
