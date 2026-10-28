import fs from 'fs';
import { test, expect } from '@fixtures/pages.fixtures';
import { ANONYMOUS_SESSION } from '@fixtures/pages.fixtures';
import { requireDataCreatingTestsAllowed } from '@config/env';
import { POLICY_SOURCE, UPLOAD } from '@config/policy';
import { AdminHomePage, SectionStatus, SlideCard, UploadResult } from '@pages/admin/AdminHomePage';
import { submitAndFollow, UploadFile } from '@pages/admin/AdminNewsPages';
import { sheetTitle } from '@utils/caseTitles';
import { urlOf } from '@utils/lowPrivilege';
import { fetchAsVisitor } from '@utils/newsFlows';
import { publicHero, SLIDE_IMAGE, slideIds, slideLink, SlideRun, withSlide } from '@utils/slideFlows';
import { bmpFile, drawImage, emptyFile, exeBytes, FilePayload, fixtureFile, gifFile, jpegWithOrientation, MB, paddedFile, payload, svgWithScript, textFile, truncatedFile } from '@utils/uploadFiles';
import { Browser, Page } from '@playwright/test';
import { decodedImageSize } from '../content/contentCases';

/**
 * KM-ADMH / KM-FSLD — slide images, statuses, editing, deleting and the home page carousel (Auto:P), checked
 * 2026-10-07. Choosing an image uploads it at once to /admin/uploads/image (folder home-sections): the server checks
 * type (png/jpeg by content) and size (5 MB — the proposal in src/config/policy.ts) and answers 422 with
 * "validation.image" / "validation.mimes" / "validation.max.file", but the panel only shows the alert
 * "อัปโหลดรูปภาพไม่สำเร็จ กรุณาลองใหม่อีกครั้ง" (DEF-103). Refused-upload cases never save a slide (they cancel the panel).
 * Slides cannot carry "[Auto Test]": a case deletes only its own new slides (its uploaded image path / stamped link,
 * see src/utils/slideFlows.ts); Dev had no slide when this was written.
 */

const CREATES = 'Saves a slide on the home page (deleted again at the end of the case).';
const KNOWN = {
  NO_REASON: 'Known bug (DEF-103): a refused slide image only shows the alert "อัปโหลดรูปภาพไม่สำเร็จ กรุณาลองใหม่อีกครั้ง" — it does not say why (type / maximum size / empty file); the server\'s reason (validation.mimes / validation.max.file) is dropped.',
  BROKEN_FILES: 'Known bug (DEF-91): upload checks look only at the file header — a cut-off image is accepted, and a file named "image.jpg.exe" is accepted when its content is an image.',
  FILE_LEFT: 'Known bug (DEF-100): the image of a deleted slide is still served from /storage (HTTP 200).',
  DRAFT_AS_HIDDEN: 'Known bug (DEF-109): a draft ("ฉบับร่าง") is saved as hidden — the form posts status=draft but the item is stored and badged "ซ่อน" (slides, albums, footer menu).',
  NO_SLIDE_TEXT: 'Spec mismatch (DEF-77): the slide panel has no "ข้อความสไลด์" field (image + URL + status only).',
};

test.beforeEach(() => test.setTimeout(150_000));

function note(description: string): void {
  test.info().annotations.push({ type: 'note', description });
}

const png = (name = 'slide.png'): FilePayload => payload(name, fs.readFileSync(SLIDE_IMAGE), 'image/png');

/** Chooses `file` in a new slide panel, reports the upload, then cancels the panel (no slide is saved). */
async function uploadOnly(page: Page, file: UploadFile): Promise<UploadResult> {
  const home = new AdminHomePage(page);
  await home.openAddSlide();
  const result = await home.uploadImageResult(file);
  note(`Upload ${result.status} ${result.body.slice(0, 160)}; path "${result.path}"; alerts ${JSON.stringify(result.alerts)}`);
  await home.cancelButton.click();
  return result;
}

/** The text the admin sees after a refused upload: the alerts plus the visible texts of the panel. */
async function refusalText(page: Page, result: UploadResult): Promise<string> {
  return result.alerts.join(' ');
}

/** Refused by the server (4xx, no stored path, never 500); when `about` is given the admin must be told why. */
async function imageRefused(page: Page, file: UploadFile, about?: RegExp): Promise<void> {
  requireDataCreatingTestsAllowed('Uploads a file through the slide panel (nothing is saved).');
  const result = await uploadOnly(page, file);
  expect(result.status, 'no server error').toBeLessThan(500);
  expect(result.status, 'the server refuses it').toBeGreaterThanOrEqual(400);
  expect(result.path, 'no stored file').toBe('');
  if (!about) return;
  const text = await refusalText(page, result);
  expect(text, 'the admin is told').not.toBe('');
  test.fail(!about.test(text), KNOWN.NO_REASON);
  expect(text, 'the message says why').toMatch(about);
}

interface HeroImage {
  src: string;
  loaded: boolean;
  naturalWidth: number;
  naturalHeight: number;
  width: number;
  height: number;
  objectFit: string;
}

/** The real (not cloned) hero image with this src, as a visitor sees it, plus the page's sideways overflow. */
async function heroImage(browser: Browser, src: string): Promise<{ image?: HeroImage; overflowX: number; loadMs: number }> {
  const context = await browser.newContext({ storageState: ANONYMOUS_SESSION });
  try {
    const page = await context.newPage();
    const started = Date.now();
    await page.goto(urlOf('/'));
    await page.waitForLoadState('load');
    const loadMs = Date.now() - started;
    await page.waitForTimeout(800);
    const images = await page.locator('.hero-banner-section img').evaluateAll((imgs) =>
      imgs
        .filter((i) => !i.closest('.owl-item.cloned'))
        .map((i) => {
          const img = i as HTMLImageElement;
          return { src: img.getAttribute('src') ?? '', loaded: img.complete && img.naturalWidth > 0, naturalWidth: img.naturalWidth, naturalHeight: img.naturalHeight, width: img.clientWidth, height: img.clientHeight, objectFit: getComputedStyle(img).objectFit };
        }),
    );
    const overflowX = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
    return { image: images.find((i) => i.src === src), overflowX, loadMs };
  } finally {
    await context.close();
  }
}

const undistorted = (i: HeroImage): boolean => i.objectFit !== 'fill' || !i.height || Math.abs(i.width / i.height - i.naturalWidth / i.naturalHeight) / (i.naturalWidth / i.naturalHeight) < 0.02;

/** Saves a slide with `file`: the panel previews it, the slide is listed and the home page shows the image whole. */
async function imageAccepted(page: Page, browser: Browser, file: UploadFile, more?: (run: SlideRun, shown: HeroImage) => Promise<void>): Promise<void> {
  requireDataCreatingTestsAllowed(CREATES);
  await withSlide(page, { image: file }, async (run) => {
    expect(run.imagePath, 'the upload is accepted').not.toBe('');
    expect(run.created.length, 'the slide is saved').toBe(1);
    const hero = await heroImage(browser, run.created[0].editImage);
    note(`Home page: ${JSON.stringify(hero.image)}; overflow ${hero.overflowX}px; load ${hero.loadMs} ms`);
    expect(hero.image, 'shown on the home page').toBeDefined();
    expect(hero.image!.loaded, 'the image loads').toBe(true);
    expect(undistorted(hero.image!), 'not stretched or squashed').toBe(true);
    expect(hero.overflowX, 'the layout does not break').toBeLessThanOrEqual(1);
    if (more) await more(run, hero.image!);
  });
}

/** Deletes a slide by section id (only ever called with the case's own new slide). */
async function deleteSlide(page: Page, sectionId: string): Promise<number> {
  const dialog = await new AdminHomePage(page).openDeleteDialog(sectionId);
  return (await submitAndFollow(page, () => dialog.confirm())).final;
}

async function setSlideStatus(page: Page, sectionId: string, status: SectionStatus): Promise<void> {
  const home = new AdminHomePage(page);
  await home.openEditSlide(sectionId);
  await page.locator(`label[for="slide-status-${status}"]`).click();
  expect((await home.save()).final, 'saved').toBeLessThan(400);
}

const cardOf = async (page: Page, sectionId: string): Promise<SlideCard | undefined> => (await new AdminHomePage(page).slides()).find((s) => s.sectionId === sectionId);
const onHome = async (browser: Browser, image: string): Promise<boolean> => (await publicHero(browser)).slides.some((s) => s.image === image);

const TYPE_MESSAGE = /PNG|JPE?G|ชนิด|ประเภท|รองรับ/i;
const SIZE_MESSAGE = /MB|ขนาด/;

// ---------------------------------------------------------------------------------------------------------------

test.describe('SC-ADMH-01 / SC-FSLD-01 เพิ่มสไลด์', () => {
  test(sheetTitle('TC-ADMH-01-02'), async ({ page, browser }) => {
    requireDataCreatingTestsAllowed(CREATES);
    await withSlide(page, { image: await drawImage(page, 'slide.jpg', { width: 1920, height: 1080, type: 'image/jpeg' }) }, async ({ created }) => {
      expect(created.length, 'listed in the admin').toBe(1);
      const admin = (await new AdminHomePage(page).slides()).map((s) => s.editImage);
      const shown = (await publicHero(browser)).slides.map((s) => s.image);
      note(`Admin order ${JSON.stringify(admin)}; home order ${JSON.stringify(shown)}`);
      expect(shown, 'shown on the home page').toContain(created[0].editImage);
      expect(shown, 'in the admin order').toEqual(admin.filter((src) => shown.includes(src)));
    });
  });

  test(sheetTitle('TC-ADMH-01-03'), async ({ page }) => {
    requireDataCreatingTestsAllowed('Uploads files through the slide panel (nothing is saved).');
    const txt = await uploadOnly(page, textFile('note.txt', '[Auto Test] not an image'));
    const base = await drawImage(page, 'big.png', { width: 1920, height: 1080, type: 'image/png' });
    const big = await uploadOnly(page, paddedFile(base, UPLOAD.imageMaxMB * MB + 1024, 'big.png'));
    for (const r of [txt, big]) {
      expect(r.status, 'refused by the server, no 500').toBeGreaterThanOrEqual(400);
      expect(r.status).toBeLessThan(500);
      expect(r.path, 'nothing stored').toBe('');
    }
    const texts = `${await refusalText(page, txt)} | ${await refusalText(page, big)}`;
    const told = TYPE_MESSAGE.test(await refusalText(page, txt)) && SIZE_MESSAGE.test(await refusalText(page, big));
    note(`Shown: ${texts}`);
    test.fail(!told, KNOWN.NO_REASON);
    expect(told, 'the admin is told the supported type and the maximum size').toBe(true);
  });

  test(sheetTitle('TC-FSLD-01-02'), async ({ page, browser }) => {
    requireDataCreatingTestsAllowed(CREATES);
    const home = new AdminHomePage(page);
    await home.openAddSlide();
    const checked = await page.locator('#slide-form input[type=radio]:checked').getAttribute('value');
    await home.cancelButton.click();
    note(`Default status: ${checked}`);
    expect(checked, 'the default status is publish').toBe('publish');
    // Status left untouched.
    await withSlide(page, { status: undefined }, async ({ created }) => {
      expect(created.length).toBe(1);
      expect(created[0].editStatus, 'saved as published').toBe('publish');
      expect(await onHome(browser, created[0].editImage), 'on the home page at once').toBe(true);
    });
  });
});

test.describe('SC-ADMH-03 / SC-FSLD-02 รูปภาพสไลด์', () => {
  test(sheetTitle('TC-ADMH-03-01'), async ({ page, browser }) => {
    await imageAccepted(page, browser, await drawImage(page, 'image.jpg', { width: 1920, height: 1080, type: 'image/jpeg' }), async (run) => {
      const home = new AdminHomePage(page);
      await home.openEditSlide(run.created[0].sectionId);
      const preview = await home.preview.getAttribute('src');
      await home.cancelButton.click();
      expect(preview, 'the panel previews the image').toContain(run.imagePath.split('/').pop());
    });
  });
  test(sheetTitle('TC-ADMH-03-02'), async ({ page, browser }) => {
    await imageAccepted(page, browser, await drawImage(page, 'image.png', { width: 1920, height: 1080, type: 'image/png', transparent: true }), async (run) => {
      expect((await fetchAsVisitor(browser, run.created[0].editImage)).type, 'kept as PNG (transparency)').toMatch(/png/);
    });
  });
  test(sheetTitle('TC-ADMH-03-03'), async ({ page }) => {
    await imageRefused(page, fixtureFile('sample.pdf', 'doc.pdf'), TYPE_MESSAGE);
  });
  test(sheetTitle('TC-ADMH-03-04'), async ({ page }) => {
    await imageRefused(page, payload('fake.jpg', exeBytes(), 'image/jpeg'));
  });
  test(sheetTitle('TC-ADMH-03-05'), async ({ page }) => {
    note(`Limit used: ${POLICY_SOURCE}`);
    const base = await drawImage(page, 'big.png', { width: 1920, height: 1080, type: 'image/png' });
    await imageRefused(page, paddedFile(base, UPLOAD.imageMaxMB * MB + 1024, 'big.png'), SIZE_MESSAGE);
  });

  test(sheetTitle('TC-FSLD-02-01'), async ({ page, browser }) => {
    await imageAccepted(page, browser, await drawImage(page, 'image.png', { width: 1920, height: 1080, type: 'image/png' }));
  });
  test(sheetTitle('TC-FSLD-02-02'), async ({ page, browser }) => {
    await imageAccepted(page, browser, await drawImage(page, 'image.jpg', { width: 1920, height: 1080, type: 'image/jpeg' }));
  });
  test(sheetTitle('TC-FSLD-02-03'), async ({ page, browser }) => {
    await imageAccepted(page, browser, await drawImage(page, 'transparent.png', { width: 1920, height: 1080, type: 'image/png', transparent: true }), async (run) => {
      expect((await fetchAsVisitor(browser, run.created[0].editImage)).type, 'kept as PNG (transparency not flattened)').toMatch(/png/);
    });
  });
  test(sheetTitle('TC-FSLD-02-04'), async ({ page, browser }) => {
    await imageAccepted(page, browser, await jpegWithOrientation(page, 'phone_portrait.jpg', 1600, 1200), async (run) => {
      const size = await decodedImageSize(browser, run.created[0].editImage);
      note(`Decoded ${size.width} × ${size.height} (drawn 1600 × 1200 landscape + EXIF orientation 6)`);
      expect(size.height, 'shown upright (portrait)').toBeGreaterThan(size.width);
    });
  });
  test(sheetTitle('TC-FSLD-02-05'), async ({ page, browser }) => {
    await imageAccepted(page, browser, await drawImage(page, 'ภาพ สไลด์ 1.jpg', { width: 1920, height: 1080, type: 'image/jpeg' }), async (run) => {
      expect((await fetchAsVisitor(browser, run.created[0].editImage)).status, 'the stored image opens').toBe(200);
    });
  });
  test(sheetTitle('TC-FSLD-02-06'), async ({ page, browser }) => {
    await imageAccepted(page, browser, await drawImage(page, '4k.jpg', { width: 3840, height: 2160, type: 'image/jpeg' }), async (run, shown) => {
      const hero = await heroImage(browser, run.created[0].editImage);
      note(`Served ${shown.naturalWidth} × ${shown.naturalHeight}; home page ${hero.loadMs} ms`);
      expect(hero.loadMs, 'the home page is not abnormally slow (< 5 s)').toBeLessThan(5_000);
    });
  });
  test(sheetTitle('TC-FSLD-02-07'), async ({ page, browser }) => {
    // Below the recommended 1920 × 1080: "เตือน/รับได้ตามกติกา (TBD)" — accepted and usable is a pass.
    await imageAccepted(page, browser, await drawImage(page, 'small.jpg', { width: 800, height: 450, type: 'image/jpeg' }));
  });
  test(sheetTitle('TC-FSLD-02-08'), async ({ page, browser }) => {
    await imageAccepted(page, browser, await drawImage(page, 'square.jpg', { width: 1080, height: 1080, type: 'image/jpeg' }));
    await imageAccepted(page, browser, await drawImage(page, 'tall.jpg', { width: 1080, height: 1920, type: 'image/jpeg' }));
  });
  test(sheetTitle('TC-FSLD-02-09'), async ({ page }) => {
    requireDataCreatingTestsAllowed('Uploads files through the slide panel (nothing is saved).');
    const webp = await drawImage(page, 'image.webp', { width: 1920, height: 1080, type: 'image/webp' });
    const files = [gifFile('anim.gif'), webp, svgWithScript('image.svg'), bmpFile('image.bmp'), fixtureFile('sample.pdf', 'doc.pdf')];
    const shownHint = async (): Promise<string> => {
      await new AdminHomePage(page).openAddSlide();
      const text = (await page.locator('#slideMod').innerText()).replace(/\s+/g, ' ');
      await new AdminHomePage(page).cancelButton.click();
      return text;
    };
    for (const file of files) {
      const result = await uploadOnly(page, file);
      expect.soft(result.status, `${file.name}: refused by the server`).toBe(422);
      expect.soft(result.path, `${file.name}: not stored`).toBe('');
    }
    // The panel names the supported types next to the field ("รองรับไฟล์ PNG , JPEG").
    expect(await shownHint(), 'the panel says "รองรับไฟล์ PNG, JPEG"').toMatch(/รองรับไฟล์\s*PNG\s*,\s*JPEG/);
  });
  test(sheetTitle('TC-FSLD-02-10'), async ({ page }) => {
    await imageRefused(page, payload('fake.jpg', exeBytes(), 'image/jpeg'));
  });
  test(sheetTitle('TC-FSLD-02-11'), async ({ page }) => {
    await imageRefused(page, payload('evil.png', svgWithScript().buffer, 'image/png'));
  });
  test(sheetTitle('TC-FSLD-02-12'), async ({ page }) => {
    await imageRefused(page, emptyFile('empty.jpg'), /ว่าง|0\s*(ไบต์|byte)|ไม่มีข้อมูล|ขนาด/i);
  });
  test(sheetTitle('TC-FSLD-02-13'), async ({ page }) => {
    requireDataCreatingTestsAllowed('Uploads a file through the slide panel (nothing is saved).');
    const broken = truncatedFile(await drawImage(page, 'broken.jpg', { width: 1920, height: 1080, type: 'image/jpeg' }), 'broken.jpg');
    const result = await uploadOnly(page, broken);
    expect(result.status, 'no server error').toBeLessThan(500);
    test.fail(result.status < 400, KNOWN.BROKEN_FILES);
    expect(result.status, 'a cut-off image is refused').toBeGreaterThanOrEqual(400);
  });
  test(sheetTitle('TC-FSLD-02-14'), async ({ page, browser }) => {
    requireDataCreatingTestsAllowed('Uploads files through the slide panel (nothing is saved).');
    const php = await uploadOnly(page, png('image.php.jpg'));
    const exe = await uploadOnly(page, payload('image.jpg.exe', png().buffer, 'application/x-msdownload'));
    for (const r of [php, exe].filter((x) => x.path)) {
      expect(r.path, 'not stored with a runnable extension').not.toMatch(/\.(php|exe|phtml)$/i);
      const got = await fetchAsVisitor(browser, JSON.parse(r.body).url);
      expect(got.type, 'served as an image').toMatch(/^image\//);
    }
    test.fail(exe.status < 400, KNOWN.BROKEN_FILES);
    expect(exe.status, '"image.jpg.exe" is refused (its real extension is not allowed)').toBeGreaterThanOrEqual(400);
  });
  test(sheetTitle('TC-FSLD-02-15'), async ({ page }) => {
    note(`Limit used: ${POLICY_SOURCE}`);
    const base = await drawImage(page, 'big.png', { width: 1920, height: 1080, type: 'image/png' });
    await imageRefused(page, paddedFile(base, UPLOAD.imageMaxMB * MB + 1024, 'big.png'), SIZE_MESSAGE);
  });
  test(sheetTitle('TC-FSLD-02-16'), async ({ page, browser }) => {
    note(`Limit used: ${POLICY_SOURCE}`);
    const base = await drawImage(page, 'max.png', { width: 1920, height: 1080, type: 'image/png' });
    await imageAccepted(page, browser, paddedFile(base, UPLOAD.imageMaxMB * MB, 'max.png'));
  });
});

test.describe('SC-ADMH-04 ข้อความสไลด์ (ความยาว)', () => {
  for (const id of ['TC-ADMH-04-02', 'TC-ADMH-04-03']) {
    test(sheetTitle(id), async ({ page }) => {
      test.fail(true, KNOWN.NO_SLIDE_TEXT);
      const home = new AdminHomePage(page);
      await home.openAddSlide();
      const fields = await home.slideForm.locator('input:not([type=hidden]):not([type=file]):not([type=radio]), textarea').evaluateAll((els) => els.map((e) => (e as HTMLInputElement).name));
      await home.cancelButton.click();
      note(`Panel fields: ${JSON.stringify(fields)}`);
      expect(fields.filter((name) => name !== 'link'), 'a slide text field').not.toEqual([]);
    });
  }
});

test.describe('SC-FSLD-03 ลิงก์ของสไลด์บนหน้าหลัก', () => {
  test(sheetTitle('TC-FSLD-03-12'), async ({ page, browser }) => {
    requireDataCreatingTestsAllowed(CREATES);
    await withSlide(page, { link: '/frontend/faq/index' }, async ({ created }) => {
      expect(created.length).toBe(1);
      const context = await browser.newContext({ storageState: ANONYMOUS_SESSION });
      try {
        const visitor = await context.newPage();
        await visitor.goto(urlOf('/'));
        await visitor.waitForLoadState('load');
        const link = visitor.locator('.hero-banner-section .owl-item.active a').filter({ has: visitor.locator(`img[src="${created[0].editImage}"]`) }).first();
        const target = await link.getAttribute('target');
        const [opened] = await Promise.all([target === '_blank' ? context.waitForEvent('page') : visitor.waitForURL(/faq/).then(() => visitor), link.click({ force: true, timeout: 10_000 })]);
        await opened.waitForLoadState('load');
        note(`Clicked: target=${target}; landed on ${opened.url()}`);
        expect(new URL(opened.url()).pathname, 'lands on the slide URL').toBe('/frontend/faq/index');
      } finally {
        await context.close();
      }
    });
  });

  test(sheetTitle('TC-FSLD-03-13'), async ({ page, browser }) => {
    requireDataCreatingTestsAllowed(CREATES);
    await withSlide(page, { link: '' }, async ({ created }) => {
      expect(created.length).toBe(1);
      const context = await browser.newContext({ storageState: ANONYMOUS_SESSION });
      try {
        const visitor = await context.newPage();
        await visitor.goto(urlOf('/'));
        await visitor.waitForLoadState('load');
        const img = visitor.locator(`.hero-banner-section .owl-item.active img[src="${created[0].editImage}"]`).first();
        const info = await img.evaluate((el) => {
          const a = el.closest('a');
          return { href: a?.getAttribute('href') ?? null, cursor: getComputedStyle(el).cursor };
        });
        const before = visitor.url();
        const popups: string[] = [];
        context.on('page', (p) => popups.push(p.url()));
        // The carousel keeps moving (autoplay), so click where the image is instead of waiting for it to stand still.
        const box = await img.boundingBox();
        if (box) await visitor.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
        await visitor.waitForTimeout(1_500);
        note(`Slide without URL: link ${JSON.stringify(info.href)}, cursor ${info.cursor}; after click ${visitor.url()}, new tabs ${JSON.stringify(popups)}`);
        expect(visitor.url(), 'clicking goes nowhere').toBe(before);
        expect(popups, 'no new tab').toEqual([]);
        expect(info.href === null || info.href === '' ? 'no link' : info.href, 'not a link (no href, not "#")').toBe('no link');
        expect(info.cursor, 'no hand cursor').not.toBe('pointer');
      } finally {
        await context.close();
      }
    });
  });
});

test.describe('SC-FSLD-04 สถานะสไลด์', () => {
  test(sheetTitle('TC-FSLD-04-01'), async ({ page, browser }) => {
    requireDataCreatingTestsAllowed(CREATES);
    await withSlide(page, { status: 'publish' }, async ({ created }) => {
      expect(created[0].status, 'badge').toBe('เผยแพร่');
      expect(await onHome(browser, created[0].editImage), 'in the home page carousel').toBe(true);
    });
  });
  for (const [id, status, badge] of [['TC-FSLD-04-02', 'draft', 'ฉบับร่าง'], ['TC-FSLD-04-03', 'hide', 'ซ่อน']] as const) {
    test(sheetTitle(id), async ({ page, browser }) => {
      requireDataCreatingTestsAllowed(CREATES);
      await withSlide(page, { status }, async ({ created }) => {
        expect(created.length, 'still in the admin list').toBe(1);
        test.fail(status === 'draft' && created[0].status !== badge, KNOWN.DRAFT_AS_HIDDEN);
        expect.soft(created[0].status, `with the badge "${badge}"`).toBe(badge);
        expect(await onHome(browser, created[0].editImage), 'not on the home page').toBe(false);
      });
    });
  }
  test(sheetTitle('TC-FSLD-04-04'), async ({ page, browser }) => {
    requireDataCreatingTestsAllowed(CREATES);
    await withSlide(page, { status: 'hide' }, async ({ created }) => {
      expect(await onHome(browser, created[0].editImage), 'precondition: hidden').toBe(false);
      await setSlideStatus(page, created[0].sectionId, 'publish');
      expect((await cardOf(page, created[0].sectionId))?.status).toBe('เผยแพร่');
      expect(await onHome(browser, created[0].editImage), 'back on the home page').toBe(true);
    });
  });
});

test.describe('SC-ADMH-05 / SC-FSLD-05 รายการสไลด์บนหน้าหลัก', () => {
  test(sheetTitle('TC-ADMH-05-02'), async ({ page, browser }) => {
    requireDataCreatingTestsAllowed(CREATES);
    await withSlide(page, { image: png('first.png') }, async (first) => {
      await withSlide(page, { image: png('second.png') }, async (second) => {
        expect(await onHome(browser, second.created[0].editImage), 'precondition: both shown').toBe(true);
        await setSlideStatus(page, second.created[0].sectionId, 'hide');
        const hero = await publicHero(browser);
        expect(hero.slides.map((s) => s.image), 'the first is still shown').toContain(first.created[0].editImage);
        expect(hero.slides.map((s) => s.image), 'the switched-off one is not').not.toContain(second.created[0].editImage);
      });
    });
  });

  async function carousel(browser: Browser): Promise<{ real: number; navVisible: boolean; dotsVisible: number; errors: string[]; activeBefore: string; activeAfterWait: string; activeAfterNext: string }> {
    const context = await browser.newContext({ storageState: ANONYMOUS_SESSION });
    try {
      const page = await context.newPage();
      const errors: string[] = [];
      page.on('pageerror', (e) => errors.push(e.message));
      await page.goto(urlOf('/'));
      await page.waitForLoadState('load');
      await page.waitForTimeout(1_000);
      const hero = page.locator('.hero-banner-section');
      const active = async (): Promise<string> => (await hero.locator('.owl-item.active img').first().getAttribute('src').catch(() => null)) ?? '';
      const real = await hero.locator('.owl-item:not(.cloned) img').count();
      const navVisible = await hero.locator('.owl-nav:not(.disabled) button').first().isVisible().catch(() => false);
      const dotsVisible = await hero.locator('.owl-dots:not(.disabled) .owl-dot:visible').count();
      const activeBefore = await active();
      await page.waitForTimeout(7_000);
      const activeAfterWait = await active();
      let activeAfterNext = activeAfterWait;
      if (navVisible) {
        await hero.locator('.owl-nav button.owl-next').click();
        await page.waitForTimeout(1_200);
        activeAfterNext = await active();
      }
      return { real, navVisible, dotsVisible, errors, activeBefore, activeAfterWait, activeAfterNext };
    } finally {
      await context.close();
    }
  }

  test(sheetTitle('TC-ADMH-05-03'), async ({ page, browser }) => {
    requireDataCreatingTestsAllowed(CREATES);
    const others = (await new AdminHomePage(page).slides()).filter((s) => s.editStatus === 'publish').length;
    test.skip(others > 0, `Dev has ${others} published slide(s) that are not the case's — "only one slide" cannot be set up without touching them.`);
    await withSlide(page, {}, async () => {
      const c = await carousel(browser);
      note(`One slide: ${JSON.stringify(c)}`);
      expect(c.real, 'one slide').toBe(1);
      expect(!c.navVisible || c.errors.length === 0, 'no Previous/Next buttons, or they work without an error').toBe(true);
      expect(c.errors, 'no script error').toEqual([]);
    });
  });

  test(sheetTitle('TC-ADMH-05-04'), async ({ page, browser }) => {
    const slides = await new AdminHomePage(page).slides();
    const published = slides.filter((s) => s.editStatus === 'publish').length;
    test.skip(published > 0, `Dev has ${published} published slide(s) that are not the case's — they cannot be deleted for this case.`);
    const context = await browser.newContext({ storageState: ANONYMOUS_SESSION });
    try {
      const visitor = await context.newPage();
      const errors: string[] = [];
      visitor.on('pageerror', (e) => errors.push(e.message));
      expect((await visitor.goto(urlOf('/')))?.status()).toBe(200);
      await visitor.waitForLoadState('load');
      const hero = visitor.locator('.hero-banner-section');
      const box = await hero.boundingBox();
      const image = await hero.locator('img').first().evaluate((i) => ({ src: i.getAttribute('src'), loaded: (i as HTMLImageElement).complete && (i as HTMLImageElement).naturalWidth > 0 }));
      note(`No slide: hero ${JSON.stringify(box)}; image ${JSON.stringify(image)}; errors ${JSON.stringify(errors)}`);
      expect(image.loaded, 'the default main image is shown').toBe(true);
      expect(box?.height ?? 0, 'no empty gap').toBeGreaterThan(100);
      expect(errors, 'no script error').toEqual([]);
    } finally {
      await context.close();
    }
  });

  for (const id of ['TC-ADMH-05-06', 'TC-FSLD-05-04']) {
    test(sheetTitle(id), async ({ page, browser }) => {
      requireDataCreatingTestsAllowed(CREATES);
      await withSlide(page, {}, async ({ created }) => {
        const slide = created[0];
        expect(await onHome(browser, slide.editImage), 'precondition: on the home page').toBe(true);
        expect(await deleteSlide(page, slide.sectionId), 'deleted').toBeLessThan(400);
        expect(await cardOf(page, slide.sectionId), 'gone from the admin list').toBeUndefined();
        expect(await onHome(browser, slide.editImage), 'gone from the home page').toBe(false);
        const file = await fetchAsVisitor(browser, slide.editImage);
        note(`Image after the delete: HTTP ${file.status}`);
        test.fail(file.status === 200, KNOWN.FILE_LEFT);
        expect(file.status, 'its image can no longer be opened').not.toBe(200);
      });
    });
  }

  test(sheetTitle('TC-FSLD-05-02'), async ({ page, browser }) => {
    requireDataCreatingTestsAllowed(CREATES);
    const home = new AdminHomePage(page);
    const before = await slideIds(page);
    const firstLink = slideLink();
    let sectionId = '';
    try {
      await home.openAddSlide();
      const firstPath = await home.fill({ image: png('old.png'), link: firstLink, status: 'publish' });
      await home.save();
      const created = (await home.slides()).find((s) => !before.has(s.sectionId) && s.editImagePath === firstPath);
      expect(created, 'precondition: a test slide').toBeDefined();
      sectionId = created!.sectionId;
      await home.openEditSlide(sectionId);
      expect(await home.linkInput.inputValue(), 'the form shows the stored URL').toBe(firstLink);
      expect(await page.locator('#slide-form input[type=radio]:checked').getAttribute('value'), 'and the stored status').toBe('publish');
      expect(await home.preview.getAttribute('src'), 'and the stored image').toContain(firstPath.split('/').pop());
      const newLink = slideLink();
      const newPath = await home.uploadImage(await drawImage(page, 'new.jpg', { width: 1920, height: 1080, type: 'image/jpeg' }));
      await home.linkInput.fill(newLink);
      expect((await home.save()).final).toBeLessThan(400);
      const after = await cardOf(page, sectionId);
      note(`Before ${firstPath} ${firstLink}; after ${after?.editImagePath} ${after?.editLink}`);
      expect(after?.editImagePath, 'the new image is kept').toBe(newPath);
      expect(after?.editLink, 'the new URL is kept').toBe(newLink);
      const hero = await publicHero(browser);
      expect(hero.slides.find((s) => s.image === after!.editImage)?.href, 'the home page shows the new image and URL').toBe(newLink);
      expect(hero.slides.some((s) => s.image === created!.editImage), 'the old image is no longer used').toBe(false);
    } finally {
      if (sectionId) note(`Cleanup: delete ${await deleteSlide(page, sectionId).catch(() => 'failed')}`);
    }
  });

  test(sheetTitle('TC-FSLD-05-06'), async ({ page, browser }) => {
    requireDataCreatingTestsAllowed(CREATES);
    const others = (await new AdminHomePage(page).slides()).filter((s) => s.editStatus === 'publish').length;
    await withSlide(page, { image: png('s1.png') }, async () => {
      await withSlide(page, { image: png('s2.png') }, async () => {
        await withSlide(page, { image: png('s3.png') }, async () => {
          const c = await carousel(browser);
          note(`Three slides (+${others} other): ${JSON.stringify(c)}`);
          expect(c.real, 'every published slide is in the carousel').toBe(3 + others);
          expect(c.errors, 'no script error').toEqual([]);
          expect(c.dotsVisible === 0 || c.dotsVisible === 3 + others, 'the position dots match the number of slides').toBe(true);
          expect(c.activeAfterWait !== c.activeBefore || c.activeAfterNext !== c.activeAfterWait, 'the carousel moves (by itself or with the next button)').toBe(true);
        });
      });
    });
  });
});
