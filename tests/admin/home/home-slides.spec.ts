import { test, expect } from '@fixtures/pages.fixtures';
import { requireDataCreatingTestsAllowed } from '@config/env';
import { AdminHomePage } from '@pages/admin/AdminHomePage';
import { urlOf } from '@utils/lowPrivilege';
import { deleteOwnSlides, ownSlides, publicHero, shownErrors, SLIDE_IMAGE, slideErrors, slideIds, slideLink, withSlide } from '@utils/slideFlows';
import { ALBUM_IMAGE } from '@utils/activityFlows';
import { SQL_ERROR_PATTERN } from '@utils/security';
import { Browser, Page } from '@playwright/test';

/**
 * KM-ADMH (home page admin: slides + footer) and KM-FSLD (the "เพิ่มภาพสไลด์" panel) — /admin/home/index,
 * public: the home page hero (checked 2026-10-05).
 * A slide is image + link + status only: there is no slide text and no footer phone field (KM-ADMH-04-01..05 and
 * 06-01..04 describe fields the page does not have — spec mismatch DEF-77, to SA). The footer tab is the footer menu
 * (KM-FFTR, its own spec).
 * Slides cannot carry the "[Auto Test]" marker: a case deletes only the slides that appeared while it ran and are
 * provably its own (its uploaded image path or its stamped link) — see src/utils/slideFlows.ts.
 * Choosing an image uploads it at once (before "บันทึก"): cases that close the panel without saving leave that
 * uploaded file on the server (no slide refers to it).
 *
 * NOT implemented ({MAX} undefined — DEF-52): TC-ADMH-04-02/03.
 */

const CREATES = 'Saves a slide on the home page (deleted again at the end of the case).';
const NO_SLIDE_TEXT = 'Spec mismatch (DEF-77): the slide panel has no "ข้อความสไลด์" field (image + URL + status only).';
const NO_FOOTER_PHONE = 'Spec mismatch (DEF-77): there is no "เบอร์โทรใน Footer" field — the footer tab manages menu links; the phone in the public footer is fixed text.';
const URL_UNCHECKED = 'Known bug (DEF-72): the slide link is not validated — text, a link without scheme or with a space, javascript: and data: are saved, and the home page links to them (javascript: link = stored XSS).';
const NO_IMAGE_SAVED = 'Known bug (DEF-75): a slide without an image is saved (shown as the placeholder) — KM-ADMH-03-06 requires an image, KM-FSLD-02-17 expects it to save; SA to decide.';
const LONG_URL = `https://www.example.com/${'a'.repeat(2_100 - 'https://www.example.com/'.length)}`;

test.beforeEach(() => test.setTimeout(120_000));

function note(description: string): void {
  test.info().annotations.push({ type: 'note', description });
}

/** A valid link is saved as typed and the public slide links to it in a new tab (rel=noopener). */
async function linkAccepted(page: Page, browser: Browser, link: string): Promise<void> {
  await withSlide(page, { link }, async ({ created }) => {
    expect(created.length, 'saved').toBe(1);
    expect(created[0].editLink, 'stored as typed').toBe(link);
    const hero = await publicHero(browser);
    const slide = hero.slides.find((s) => s.image === created[0].editImage);
    note(`Public slide: ${JSON.stringify(slide)}`);
    expect(slide, 'shown on the home page').toBeDefined();
    expect(slide!.href, 'links to it').toBe(link);
    expect(slide!.target, 'in a new tab').toBe('_blank');
    expect(slide!.rel, 'rel=noopener').toContain('noopener');
  });
}

/** "บันทึกสำเร็จ หรือ …ตามนโยบาย (TBD)": either outcome passes; a refusal must say why. */
async function linkEitherWay(page: Page, link: string): Promise<void> {
  await withSlide(page, { link }, async ({ saved, created, errors }) => {
    note(created.length ? `Accepted: stored ${JSON.stringify(created[0].editLink)}` : `Refused: ${JSON.stringify(errors)}`);
    expect(saved.final).toBeLessThan(500);
    if (!created.length) expect(shownErrors(errors), 'a refusal says why').not.toBe('');
  });
}

/** A bad link is refused with a visible message (or, where allowed, fixed: `fixed` says what counts as fixed). */
async function linkRefused(page: Page, browser: Browser, link: string, fixed?: (stored: string) => boolean): Promise<void> {
  await withSlide(page, { link }, async ({ saved, created, errors }) => {
    note(`Post ${saved.first} -> ${saved.final}; ${created.length ? `stored ${JSON.stringify(created[0].editLink)}` : 'not stored'}; messages ${JSON.stringify(errors)}`);
    expect(saved.final, 'no server error').toBeLessThan(500);
    if (created.length && fixed?.(created[0].editLink)) return;
    const hero = await publicHero(browser);
    expect(hero.slides.filter((s) => /^\s*(javascript|data):/i.test(s.href)), 'no script link on the home page').toEqual([]);
    expect(created.length, 'not stored').toBe(0);
    expect(shownErrors(errors), 'a validation message is shown').not.toBe('');
  });
}

/** The link field cases the sheet has twice (KM-ADMH-04-07..14 and KM-FSLD-03-01..08). */
const LINK_CASES = {
  https: (page: Page, browser: Browser) => linkAccepted(page, browser, 'https://www.facebook.com/nursechula'),
  http: (page: Page) => linkEitherWay(page, 'http://example.com/page'),
  noScheme: (page: Page, browser: Browser) => linkRefused(page, browser, 'facebook.com/nursechula', (stored) => /^https?:\/\/(www\.)?facebook\.com\/nursechula$/.test(stored)),
  javascript: (page: Page, browser: Browser) => linkRefused(page, browser, 'javascript:alert(1)'),
  data: (page: Page, browser: Browser) => linkRefused(page, browser, 'data:text/html,<script>alert(1)</script>'),
  text: (page: Page, browser: Browser) => linkRefused(page, browser, 'ไม่ใช่ลิงก์'),
  tooLong: (page: Page, browser: Browser) => linkRefused(page, browser, LONG_URL),
  empty: async (page: Page, browser: Browser) => {
    // The uploaded image path identifies the slide (withSlide), the link is empty.
    await withSlide(page, { link: '' }, async ({ created }) => {
      expect(created.length, 'saved without a link').toBe(1);
      expect(created[0].editLink).toBe('');
      const hero = await publicHero(browser);
      note(`Public slides: ${JSON.stringify(hero.slides)}`);
      expect(hero.slides.find((s) => s.image === created[0].editImage), 'shown on the home page').toBeDefined();
      expect(hero.html, 'no empty link (href="" / href="#")').not.toMatch(/href="(#?)"/);
    });
  },
};

test.describe('SC-ADMH-01 ภาพสไลด์: รายการ', () => {
  test('TC-ADMH-01-01 [Low] [Positive] Empty state ของภาพสไลด์', async ({ page }) => {
    const home = new AdminHomePage(page);
    expect(await home.open()).toBe(200);
    await expect(home.heading).toBeVisible();
    const slides = await home.readSlides();
    await expect(home.addSlideButton, 'the "เพิ่มสไลด์" button').toBeVisible();
    await expect(home.addSlideButton).toContainText('เพิ่มสไลด์');
    if (slides.length) {
      note(`Not empty: ${slides.length} slide(s) on Dev — the empty state cannot show.`);
      await expect(home.slideEmptyState).toBeHidden();
    } else {
      await expect(home.slideEmptyState, '"ยังไม่มีรายการภาพสไลด์"').toBeVisible();
    }
  });
});

test.describe('SC-ADMH-03 รูปภาพสไลด์', () => {
  test('TC-ADMH-03-06 [Medium] [Negative] รูปภาพสไลด์: ไม่เลือกไฟล์ (ช่องบังคับ)', async ({ page }) => {
    test.fail(true, NO_IMAGE_SAVED);
    requireDataCreatingTestsAllowed('If the app accepts a slide without an image it saves one (deleted again at the end).');
    await withSlide(page, { image: '' }, async ({ created, errors }) => {
      note(created.length ? `Saved without an image: ${JSON.stringify(created[0])}` : `Refused: ${JSON.stringify(errors)}`);
      expect(created.length, 'a slide without an image is not saved').toBe(0);
      expect(shownErrors(errors), 'a message asks for an image').not.toBe('');
    });
  });
});

test.describe('SC-ADMH-04 ข้อความและลิงก์ของสไลด์', () => {
  for (const [id, label] of [
    ['TC-ADMH-04-01 [High] [Positive]', 'ข้อความภาษาไทยปกติ'],
    ['TC-ADMH-04-04 [High] [Negative]', 'แท็ก HTML และสคริปต์'],
    ['TC-ADMH-04-05 [High] [Negative]', 'อักขระ SQL'],
  ] as const) {
    test(`${id} ข้อความสไลด์: ${label}`, async ({ page }) => {
      test.fail(true, NO_SLIDE_TEXT);
      const home = new AdminHomePage(page);
      await home.openAddSlide();
      const fields = await home.slideForm.locator('input:not([type=hidden]):not([type=file]):not([type=radio]), textarea').evaluateAll((els) => els.map((e) => (e as HTMLInputElement).name));
      note(`Panel fields: ${JSON.stringify(fields)}; panel: ${(await home.slidePanel.innerText()).replace(/\s+/g, ' ')}`);
      await home.cancelButton.click();
      expect(fields.filter((name) => name !== 'link'), 'a slide text field').not.toEqual([]);
    });
  }
  test('TC-ADMH-04-06 [Medium] [Positive] ข้อความสไลด์: เว้นว่าง (ไม่บังคับกรอก)', async ({ page, browser }) => {
    requireDataCreatingTestsAllowed(CREATES);
    // There is no text field at all, so every slide is "a slide without text": it must save and show cleanly.
    await withSlide(page, {}, async ({ created }) => {
      expect(created.length, 'saved').toBe(1);
      const hero = await publicHero(browser);
      const slide = hero.slides.find((s) => s.image === created[0].editImage);
      expect(slide, 'shown on the home page').toBeDefined();
      expect(hero.html, 'no empty caption box').not.toMatch(/class="[^"]*caption[^"]*"[^>]*>\s*</);
    });
  });
  test('TC-ADMH-04-07 [High] [Positive] ลิงก์ของสไลด์: URL ที่ถูกต้อง (https)', async ({ page, browser }) => {
    requireDataCreatingTestsAllowed(CREATES);
    await LINK_CASES.https(page, browser);
  });
  test('TC-ADMH-04-08 [Low] [Positive] ลิงก์ของสไลด์: URL แบบ http', async ({ page }) => {
    requireDataCreatingTestsAllowed(CREATES);
    await LINK_CASES.http(page);
  });
  test('TC-ADMH-04-09 [Medium] [Negative] ลิงก์ของสไลด์: ไม่มี scheme', async ({ page, browser }) => {
    test.fail(true, URL_UNCHECKED);
    requireDataCreatingTestsAllowed(CREATES);
    await LINK_CASES.noScheme(page, browser);
  });
  test('TC-ADMH-04-10 [High] [Negative] ลิงก์ของสไลด์: javascript: scheme', async ({ page, browser }) => {
    test.fail(true, URL_UNCHECKED);
    requireDataCreatingTestsAllowed(CREATES);
    await LINK_CASES.javascript(page, browser);
  });
  test('TC-ADMH-04-11 [High] [Negative] ลิงก์ของสไลด์: data: scheme', async ({ page, browser }) => {
    test.fail(true, URL_UNCHECKED);
    requireDataCreatingTestsAllowed(CREATES);
    await LINK_CASES.data(page, browser);
  });
  test('TC-ADMH-04-12 [Medium] [Negative] ลิงก์ของสไลด์: ข้อความที่ไม่ใช่ URL', async ({ page, browser }) => {
    test.fail(true, URL_UNCHECKED);
    requireDataCreatingTestsAllowed(CREATES);
    await LINK_CASES.text(page, browser);
  });
  test('TC-ADMH-04-13 [Low] [Negative] ลิงก์ของสไลด์: URL ยาวเกิน 2,000 ตัวอักษร', async ({ page, browser }) => {
    requireDataCreatingTestsAllowed(CREATES);
    await LINK_CASES.tooLong(page, browser);
  });
  test('TC-ADMH-04-14 [Medium] [Positive] ลิงก์ของสไลด์: เว้นว่าง (ไม่บังคับ)', async ({ page, browser }) => {
    requireDataCreatingTestsAllowed(CREATES);
    await LINK_CASES.empty(page, browser);
  });
});

test.describe('SC-ADMH-06 ส่วนท้ายเว็บไซต์: เบอร์โทร', () => {
  for (const [id, label] of [
    ['TC-ADMH-06-01 [High] [Positive]', 'รูปแบบ 0-2218-1128'],
    ['TC-ADMH-06-02 [Medium] [Negative]', 'มีตัวอักษร'],
    ['TC-ADMH-06-03 [Medium] [Negative]', 'สั้นเกินไป'],
    ['TC-ADMH-06-04 [High] [Negative]', 'แท็กสคริปต์'],
  ] as const) {
    test(`${id} เบอร์โทรใน Footer: ${label}`, async ({ page }) => {
      test.fail(true, NO_FOOTER_PHONE);
      const home = new AdminHomePage(page);
      await home.open();
      await home.footerTab.click();
      const fields = await page.locator('#pills-footer input:not([type=hidden]), #menu-form input:not([type=hidden]):not([type=radio]), #menu-form select').evaluateAll((els) => els.map((e) => (e as HTMLInputElement).name));
      note(`Footer tab fields: ${JSON.stringify(fields)}`);
      expect(fields.filter((name) => /phone|tel|เบอร์/i.test(name)), 'a footer phone field').not.toEqual([]);
    });
  }
});

test.describe('SC-FSLD-01 แผงเพิ่มภาพสไลด์', () => {
  test("TC-FSLD-01-01 [High] [Positive] เปิดแผง 'เพิ่มภาพสไลด์': ช่องและค่าเริ่มต้น", async ({ page }) => {
    const home = new AdminHomePage(page);
    await home.openAddSlide();
    await expect(home.slidePanelTitle).toHaveText('เพิ่มภาพสไลด์');
    const text = (await home.slidePanel.innerText()).replace(/\s+/g, ' ');
    note(`Panel: ${text}`);
    for (const part of ['รูปภาพสไลด์', 'ขนาดที่แนะนำ : 1920 x 1080', 'อัปโหลดรูปภาพ', 'รองรับไฟล์ PNG , JPEG', 'URL ปลายทาง', 'สถานะ']) expect(text, part).toContain(part);
    await expect(home.linkInput).toHaveAttribute('placeholder', 'https://www.example.com/');
    expect(await home.imageInput.getAttribute('accept')).toMatch(/image\/png.*image\/jpeg|image\/jpeg.*image\/png/);
    for (const [status, label] of [['draft', 'ฉบับร่าง'], ['publish', 'เผยแพร่'], ['hide', 'ซ่อน']]) await expect(page.locator(`label[for="slide-status-${status}"]`)).toHaveText(label);
    await expect(page.locator('#slide-status-publish'), 'default "เผยแพร่"').toBeChecked();
    await expect(home.preview, 'no image yet').toHaveCount(0);
    await expect(home.linkInput).toHaveValue('');
  });

  test("TC-FSLD-01-03 [Medium] [Positive] ปิดแผงด้วย 'ยกเลิก'/X/Esc/คลิกนอกแผง โดยไม่บันทึก", async ({ page }) => {
    const home = new AdminHomePage(page);
    const before = await slideIds(page);
    const ways: [string, () => Promise<void>][] = [
      ['ยกเลิก', () => home.cancelButton.click()],
      ['X', () => home.closeButton.click()],
      ['Esc', () => page.keyboard.press('Escape')],
      ['คลิกนอกแผง', () => page.mouse.click(150, 400)],
    ];
    for (const [index, [label, close]] of ways.entries()) {
      await home.openAddSlide();
      // One upload is enough to prove the form resets (every upload leaves a file on the server).
      if (index === 0) await home.uploadImage(SLIDE_IMAGE);
      await home.linkInput.fill(slideLink());
      await close();
      await expect(home.slidePanel, `${label}: the panel closes`).toBeHidden();
      await home.openAddSlide();
      await expect(home.linkInput, `${label}: reopened empty`).toHaveValue('');
      await expect(home.preview, `${label}: no image left over`).toHaveCount(0);
      expect(await home.imagePath.inputValue(), `${label}: no stored image path left over`).toBe('');
      await home.cancelButton.click();
      await expect(home.slidePanel).toBeHidden();
    }
    const after = await slideIds(page);
    expect([...after].filter((id) => !before.has(id)), 'no slide was created').toEqual([]);
  });

  test('TC-FSLD-01-04 [Medium] [Positive] แสดงตัวอย่างรูปหลังเลือกไฟล์', async ({ page }) => {
    const home = new AdminHomePage(page);
    await home.openAddSlide();
    const first = await home.uploadImage(SLIDE_IMAGE);
    await expect(home.preview, 'a preview is shown').toHaveCount(1);
    const firstSrc = await home.preview.getAttribute('src');
    const second = await home.uploadImage(ALBUM_IMAGE);
    await expect(home.preview, 'still one preview').toHaveCount(1);
    const secondSrc = await home.preview.getAttribute('src');
    note(`Stored paths: ${first} -> ${second}`);
    expect(first, 'the first image was uploaded').not.toBe('');
    expect(second, 'the image can be replaced before saving').not.toBe(first);
    expect(secondSrc, 'the preview shows the new image').not.toBe(firstSrc);
    await home.cancelButton.click();
  });

  test('TC-FSLD-01-05 [Low] [Positive] แผงแสดงผลบนมือถือ (375px)', async ({ page }) => {
    await page.setViewportSize({ width: 375, height: 812 });
    const home = new AdminHomePage(page);
    await home.open();
    // At 375px the admin sidebar covers the page (DEF-4, checked by KM-NFR); open the panel with the button's own click.
    await home.addSlideButton.dispatchEvent('click');
    await home.linkInput.waitFor({ state: 'visible' });
    // Measure once the panel has finished sliding in.
    await expect(home.slidePanel).toHaveClass(/\bshow\b/);
    await expect(home.slidePanel).not.toHaveClass(/showing/);
    await page.waitForTimeout(400);
    const box = await home.slidePanel.boundingBox();
    note(`Panel box at 375px: ${JSON.stringify(box)}`);
    expect(box!.x, 'starts inside the screen').toBeGreaterThanOrEqual(0);
    expect(box!.x + box!.width, 'fits the screen width').toBeLessThanOrEqual(375 + 1);
    for (const [label, locator] of [['อัปโหลดรูปภาพ', page.locator('#slide-upload-area')], ['บันทึก', home.saveButton], ['ยกเลิก', home.cancelButton]] as const) {
      await locator.scrollIntoViewIfNeeded();
      const b = await locator.boundingBox();
      expect(b, `${label} is shown`).not.toBeNull();
      expect(b!.x + b!.width, `${label} fits the screen`).toBeLessThanOrEqual(375 + 1);
    }
    await home.cancelButton.click();
    await expect(home.slidePanel, 'ยกเลิก works').toBeHidden();
  });
});

test.describe('SC-FSLD-02 รูปภาพสไลด์', () => {
  test('TC-FSLD-02-17 [High] [Positive] รูปภาพสไลด์: ไม่เลือกรูป', async ({ page, browser }) => {
    requireDataCreatingTestsAllowed('Saves a slide without image or link (deleted again at the end of the case).');
    const home = new AdminHomePage(page);
    const before = await slideIds(page);
    try {
      await home.openAddSlide();
      await home.fill({ link: '', status: 'publish' });
      const saved = await home.save();
      const errors = await slideErrors(page);
      const created = await ownSlides(page, before, { blank: true });
      note(created.length ? `Saved without an image: cover ${JSON.stringify(created[0].cover)}` : `Refused: ${JSON.stringify(errors)} (${saved.first} -> ${saved.final})`);
      expect(created.length, 'saved without an image').toBe(1);
      const hero = await publicHero(browser);
      note(`Public hero: ${JSON.stringify(hero.slides)}; default image ${hero.defaultImage}`);
      expect(hero.slides.every((s) => s.imageLoaded) && (hero.slides.length > 0 || hero.defaultImage), 'the home page shows a placeholder, not a broken image').toBe(true);
    } finally {
      note(`Cleanup: deleted ${await deleteOwnSlides(page, before, { blank: true })} slide(s).`);
    }
  });
});

test.describe('SC-FSLD-03 URL ปลายทาง', () => {
  test('TC-FSLD-03-01 [High] [Positive] URL ปลายทาง: URL ที่ถูกต้อง (https)', async ({ page, browser }) => {
    requireDataCreatingTestsAllowed(CREATES);
    await LINK_CASES.https(page, browser);
  });
  test('TC-FSLD-03-02 [Low] [Positive] URL ปลายทาง: URL แบบ http', async ({ page }) => {
    requireDataCreatingTestsAllowed(CREATES);
    await LINK_CASES.http(page);
  });
  test('TC-FSLD-03-03 [Medium] [Negative] URL ปลายทาง: ไม่มี scheme', async ({ page, browser }) => {
    test.fail(true, URL_UNCHECKED);
    requireDataCreatingTestsAllowed(CREATES);
    await LINK_CASES.noScheme(page, browser);
  });
  test('TC-FSLD-03-04 [High] [Negative] URL ปลายทาง: javascript: scheme', async ({ page, browser }) => {
    test.fail(true, URL_UNCHECKED);
    requireDataCreatingTestsAllowed(CREATES);
    await LINK_CASES.javascript(page, browser);
  });
  test('TC-FSLD-03-05 [High] [Negative] URL ปลายทาง: data: scheme', async ({ page, browser }) => {
    test.fail(true, URL_UNCHECKED);
    requireDataCreatingTestsAllowed(CREATES);
    await LINK_CASES.data(page, browser);
  });
  test('TC-FSLD-03-06 [Medium] [Negative] URL ปลายทาง: ข้อความที่ไม่ใช่ URL', async ({ page, browser }) => {
    test.fail(true, URL_UNCHECKED);
    requireDataCreatingTestsAllowed(CREATES);
    await LINK_CASES.text(page, browser);
  });
  test('TC-FSLD-03-07 [Low] [Negative] URL ปลายทาง: URL ยาวเกิน 2,000 ตัวอักษร', async ({ page, browser }) => {
    requireDataCreatingTestsAllowed(CREATES);
    await LINK_CASES.tooLong(page, browser);
  });
  test('TC-FSLD-03-08 [Medium] [Positive] URL ปลายทาง: เว้นว่าง (ไม่บังคับ)', async ({ page, browser }) => {
    requireDataCreatingTestsAllowed(CREATES);
    await LINK_CASES.empty(page, browser);
  });
  test('TC-FSLD-03-09 [Medium] [Positive] URL ปลายทาง: ลิงก์ภายในเว็บแบบ path', async ({ page, browser }) => {
    requireDataCreatingTestsAllowed(CREATES);
    const link = '/frontend/faq/index';
    await withSlide(page, { link }, async ({ created, errors }) => {
      note(created.length ? `Stored ${JSON.stringify(created[0].editLink)}` : `Refused: ${JSON.stringify(errors)}`);
      expect(created.length, 'saved').toBe(1);
      const slide = (await publicHero(browser)).slides.find((s) => s.image === created[0].editImage);
      expect(slide, 'shown on the home page').toBeDefined();
      const target = new URL(slide!.href, urlOf('/'));
      expect(target.origin, 'a page of this site').toBe(new URL(urlOf('/')).origin);
      expect(target.pathname).toBe(link);
      expect((await page.request.get(target.toString())).status(), 'the page opens').toBe(200);
    });
  });
  test('TC-FSLD-03-11 [Low] [Negative] URL ปลายทาง: ลิงก์มีช่องว่างกลาง', async ({ page, browser }) => {
    test.fail(true, URL_UNCHECKED);
    requireDataCreatingTestsAllowed(CREATES);
    await linkRefused(page, browser, 'https://www.example .com', (stored) => !/\s/.test(stored));
  });
});

test.describe('SC-FSLD-04 สถานะ', () => {
  test('TC-FSLD-04-05 [Medium] [Negative] ส่งค่าสถานะที่ไม่มีอยู่ (แก้ค่า radio ด้วยสคริปต์)', async ({ page }) => {
    requireDataCreatingTestsAllowed('If the app accepts the value it saves a slide (deleted again at the end).');
    const home = new AdminHomePage(page);
    const before = await slideIds(page);
    const link = slideLink();
    let imagePath = '';
    try {
      await home.openAddSlide();
      imagePath = await home.fill({ image: SLIDE_IMAGE, link });
      await page.locator('#slide-status-publish').evaluate((radio: HTMLInputElement) => {
        radio.value = 'deleted';
        radio.checked = true;
      });
      const saved = await home.save();
      expect(SQL_ERROR_PATTERN.test(await page.locator('body').innerText()), 'no SQL error').toBe(false);
      const created = await ownSlides(page, before, { imagePath, link });
      note(`Post ${saved.first} -> ${saved.final}; ${created.length ? `saved with status ${JSON.stringify(created[0].editStatus)}` : 'refused'}`);
      expect(saved.final, 'no server error').toBeLessThan(500);
      if (created.length) expect(['draft', 'publish', 'hide'], 'a known status (the default)').toContain(created[0].editStatus);
    } finally {
      note(`Cleanup: deleted ${await deleteOwnSlides(page, before, { imagePath, link })} slide(s).`);
    }
  });
});

test.describe('SC-FSLD-05 รายการสไลด์และความปลอดภัย', () => {
  test('TC-FSLD-05-01 [Low] [Positive] รายการว่างแสดงข้อความสถานะว่าง', async ({ page }) => {
    const home = new AdminHomePage(page);
    await home.open();
    const slides = await home.readSlides();
    await expect(home.addSlideButton).toBeVisible();
    if (slides.length) note(`Precondition not met: ${slides.length} slide(s) on Dev.`);
    else await expect(home.slideEmptyState, 'empty state').toBeVisible();
  });

  test('TC-FSLD-05-03 [Medium] [Positive] ลบสไลด์: ยกเลิกใน dialog', async ({ page }) => {
    requireDataCreatingTestsAllowed(CREATES);
    await withSlide(page, {}, async ({ created }) => {
      expect(created.length, 'the test slide').toBe(1);
      const home = new AdminHomePage(page);
      const dialog = await home.openDeleteDialog(created[0].sectionId);
      await dialog.cancel();
      expect((await home.slides()).map((s) => s.sectionId), 'still there').toContain(created[0].sectionId);
    });
  });

  test('TC-FSLD-05-07 [Low] [Negative] สไลด์ไม่มีข้อความทดแทน (alt) สำหรับผู้ใช้โปรแกรมอ่านหน้าจอ', async ({ page, browser }) => {
    requireDataCreatingTestsAllowed(CREATES);
    await withSlide(page, {}, async ({ created }) => {
      const hero = await publicHero(browser);
      const slide = hero.slides.find((s) => s.image === created[0].editImage);
      note(`Slide image alt: ${JSON.stringify(slide?.alt)}; all: ${JSON.stringify(hero.slides.map((s) => s.alt))}`);
      expect(slide, 'shown on the home page').toBeDefined();
      // A meaningful alt, or alt="" (decorative) — but not a missing alt.
      expect(slide!.alt, 'has an alt attribute').not.toBeNull();
    });
  });

  test('TC-FSLD-05-08 [High] [Negative] ส่งฟอร์มโดยไม่มี CSRF token', async ({ page }) => {
    const before = await slideIds(page);
    const link = slideLink();
    try {
      const response = await page.request.post(urlOf('/admin/home-sections'), { form: { type: 'hero', link, status: 'publish' }, maxRedirects: 0 });
      note(`POST /admin/home-sections without _token -> ${response.status()}`);
      expect([403, 419], 'refused').toContain(response.status());
      expect(await ownSlides(page, before, { link }), 'nothing created').toEqual([]);
    } finally {
      await deleteOwnSlides(page, before, { link });
    }
  });

  test('TC-FSLD-05-09 [Medium] [Negative] กดบันทึกซ้ำรัวๆ ไม่สร้างสไลด์ซ้ำ', async ({ page }) => {
    requireDataCreatingTestsAllowed(CREATES);
    const home = new AdminHomePage(page);
    const before = await slideIds(page);
    const link = slideLink();
    let imagePath = '';
    try {
      await home.openAddSlide();
      imagePath = await home.fill({ image: SLIDE_IMAGE, link });
      const [post] = await Promise.all([
        page.waitForRequest((r) => r.method() === 'POST' && r.isNavigationRequest()),
        page.evaluate(() => {
          const button = document.querySelector<HTMLButtonElement>('#slide-form button[type="submit"]');
          for (let i = 0; i < 5; i++) button?.click();
        }),
      ]);
      await post.response();
      await page.waitForLoadState('load');
      await page.waitForTimeout(1_000);
      const copies = (await ownSlides(page, before, { imagePath, link })).length;
      note(`${copies} slide(s) after 5 rapid clicks`);
      expect(copies, 'only one').toBe(1);
    } finally {
      note(`Cleanup: deleted ${await deleteOwnSlides(page, before, { imagePath, link })} slide(s).`);
    }
  });
});
