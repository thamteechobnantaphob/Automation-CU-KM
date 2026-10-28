import { test, expect } from '@fixtures/pages.fixtures';
import { requireDataCreatingTestsAllowed } from '@config/env';
import { AdminActivityPage, AlbumCard } from '@pages/admin/AdminActivityPage';
import { submitAndFollow } from '@pages/admin/AdminNewsPages';
import { ALBUM_IMAGE, albumMarker, byDescription, deleteAlbumsWhere, PanelError, publicActivity, publicAlbumDetail, withAlbum } from '@utils/activityFlows';
import { urlOf } from '@utils/lowPrivilege';
import { roleStamp } from '@utils/roleFlows';
import { collectDialogs, SQL_ERROR_PATTERN } from '@utils/security';
import { AUTO_TEST_FLAG } from '@utils/testData';
import { Browser, Page } from '@playwright/test';

/**
 * KM-ADMA (album list / delete / fields) and KM-FALB (the "เพิ่มอัลบัม" side panel) — /admin/activity/index,
 * public list /frontend/activity/index (checked 2026-10-05). Every album a case saves carries "[Auto Test]" + a stamp
 * in its description (in its title when the description is under test) and is deleted again by the case. QA's own
 * albums on Dev ("ทดสอบ", "test") have no marker and are never touched.
 *
 * NOT implemented ({MAX} undefined, no maxlength — DEF-52): TC-ADMA-03-02/03, TC-FALB-02-04/05, 02-14/15.
 */

const CREATES = 'Saves an album (deleted again at the end of the case).';
const HTML_PAYLOAD = '<b>bold</b><script>alert(1)</script>';
const SQL_PAYLOAD = "' OR 1=1; DROP TABLE users;--";
const NO_IMAGE_SAVED = 'Known bug (DEF-75): an album without any image is saved (the image input is not required and the server accepts it) — KM-ADMA-04-06 requires an image (KM-FALB-03-17 left it TBD; SA to decide).';
const RAW_KEY = 'Known bug (DEF-66): the blank title is refused but the message is the untranslated key "validation.required".';
const NO_REQUIRED_MARK = 'Known bug (DEF-76): no "*" on the required "ชื่ออัลบัม" label (the sheet saw one on 21/09/2026).';

test.beforeEach(() => test.setTimeout(90_000));

function note(description: string): void {
  test.info().annotations.push({ type: 'note', description });
}

/** The messages the admin can see (a red text inside the closed panel does not count). */
const shown = (errors: PanelError[]): string => errors.filter((e) => e.visible).map((e) => e.text).join(' ');

const byTitle = (title: string) => (card: AlbumCard): boolean => card.editTitle === title;

/** Saves an album titled `value`: listed as typed in the admin and on the public list (published). */
async function titleSaved(page: Page, browser: Browser, value: string): Promise<void> {
  await withAlbum(page, { title: value }, async (description) => {
    const card = (await new AdminActivityPage(page).find(byDescription(description)))?.card;
    expect(card, 'saved').toBeDefined();
    expect(card!.title, 'listed as typed (no &amp;, nothing lost)').toBe(value.trim());
    const pub = await publicActivity(browser);
    expect(pub.dialogs).toEqual([]);
    expect(pub.albums.map((a) => a.title), 'shown publicly as typed').toContain(value.trim());
  });
}

async function titleHtml(page: Page, browser: Browser): Promise<void> {
  const dialogs = collectDialogs(page);
  await withAlbum(page, { title: HTML_PAYLOAD }, async (description) => {
    const activity = new AdminActivityPage(page);
    const card = (await activity.find(byDescription(description)))?.card;
    note(`Stored title: ${JSON.stringify(card?.editTitle)}`);
    expect(card, 'saved (or refused below)').toBeDefined();
    if (card!.editTitle === HTML_PAYLOAD) {
      expect(card!.title, 'literal text in the admin').toBe(HTML_PAYLOAD);
      expect(await activity.cards.locator('.title-text b, .title-text script').count(), 'not rendered as markup').toBe(0);
    } else {
      expect(card!.editTitle, 'sanitised: no tags left').not.toMatch(/<script|<b>/i);
    }
    const pub = await publicActivity(browser);
    expect(pub.dialogs, 'no script runs publicly').toEqual([]);
    expect(pub.html, 'not rendered as markup publicly').not.toContain(HTML_PAYLOAD);
    const album = pub.albums.find((a) => a.title === card!.editTitle);
    if (album) {
      const detail = await publicAlbumDetail(browser, album.href);
      expect(detail.dialogs, 'no script runs on the album page').toEqual([]);
    }
  });
  expect(dialogs, 'no script runs in the admin').toEqual([]);
}

async function titleSql(page: Page): Promise<void> {
  const activity = new AdminActivityPage(page);
  const before = await activity.albumTotal();
  await withAlbum(page, { title: SQL_PAYLOAD }, async (description) => {
    expect(SQL_ERROR_PATTERN.test(await page.locator('body').innerText()), 'no SQL error').toBe(false);
    const saved = await activity.find(byDescription(description));
    note(saved ? `Saved as ${JSON.stringify(saved.card.editTitle)}` : 'Refused');
    if (saved) expect(saved.card.editTitle).toBe(SQL_PAYLOAD);
    expect(await activity.albumTotal(), 'nothing else touched').toBe(before + (saved ? 1 : 0));
  });
}

/** Empty title: the browser blocks the post (required); nothing is saved and what was typed stays. */
async function titleEmpty(page: Page): Promise<void> {
  const activity = new AdminActivityPage(page);
  const before = await activity.albumTotal();
  await activity.openAddForm();
  await expect(activity.titleInput, 'the title is required').toHaveAttribute('required', '');
  const description = albumMarker();
  await activity.fill({ title: '', description, images: [ALBUM_IMAGE] });
  const posts: string[] = [];
  page.on('request', (r) => {
    if (r.method() === 'POST') posts.push(r.url());
  });
  await activity.saveButton.click();
  await page.waitForTimeout(500);
  const message = await activity.titleInput.evaluate((el: HTMLInputElement) => el.validationMessage);
  note(`Browser message: ${message}`);
  expect(posts, 'not sent').toEqual([]);
  expect(message, 'validation on the title').not.toBe('');
  await expect(activity.titleInput, 'the panel stays open').toBeVisible();
  await expect(activity.descriptionInput, 'what was typed stays').toHaveValue(description);
  expect(await activity.newImages.count(), 'the chosen image stays').toBe(1);
  expect(await activity.albumTotal(), 'nothing saved').toBe(before);
  await deleteAlbumsWhere(page, byDescription(description));
}

/** Five spaces pass the browser; the server must refuse them as empty. */
async function titleSpaces(page: Page): Promise<void> {
  await withAlbum(page, { title: '     ' }, async (description, _saved, errors) => {
    const saved = await new AdminActivityPage(page).find(byDescription(description));
    note(saved ? `Saved with title ${JSON.stringify(saved.card.editTitle)}` : `Refused; messages: ${JSON.stringify(errors)}`);
    expect(saved, 'five spaces count as empty: nothing is saved').toBeUndefined();
    expect(shown(errors), 'a "required" message is shown').not.toBe('');
    expect(shown(errors), 'a readable message, not a raw key').not.toMatch(/\bvalidation\.[a-z_.]+/i);
  });
}

test.describe('SC-ADMA-01 รายการอัลบั้ม', () => {
  test('TC-ADMA-01-01 [High] [Positive] แสดงหน้ารายการอัลบั้ม', async ({ page }) => {
    const activity = new AdminActivityPage(page);
    expect(await activity.open()).toBe(200);
    await expect(activity.heading).toBeVisible();
    const cards = await activity.readCards();
    const summary = (await activity.albumSummary.innerText()).replace(/\s+/g, ' ');
    const downloads = (await activity.downloadSummary.innerText()).replace(/\s+/g, ' ');
    const counter = (await activity.counter.innerText()).replace(/\s+/g, ' ');
    note(`${summary} | ${downloads} | ${counter} | ${cards.length} card(s)`);
    expect(summary, '"อัลบัมทั้งหมด n อัลบัม"').toMatch(new RegExp(`อัลบัมทั้งหมด\\s*${cards.length}\\s*อัลบัม`));
    expect(downloads, '"ดาวน์โหลด n ครั้ง"').toMatch(/ดาวน์โหลด\s*\d+\s*ครั้ง/);
    const sum = cards.reduce((total, card) => total + card.downloadCount, 0);
    expect(downloads, 'the download total adds up the cards').toContain(`${sum} ครั้ง`);
    await expect(activity.addButton, 'the "เพิ่มอัลบัม" button').toBeVisible();
    await expect(activity.addButton).toContainText('เพิ่มอัลบัม');
    if (cards.length === 0) {
      await expect(page.locator('.body-content').getByText('ยังไม่มีอัลบัมกิจกรรม'), 'empty state').toBeVisible();
      expect(counter).toMatch(/แสดง\s*0-0\s*รายการ จาก\s*0\s*รายการ/);
    } else {
      // Dev has albums, so the empty state cannot show; the counter must match the list.
      expect(counter, 'the counter matches the list').toMatch(new RegExp(`แสดง\\s*1-${cards.length}\\s*รายการ จาก\\s*${cards.length}\\s*รายการ`));
      note('Empty state not checked: Dev has albums (QA data that is not ours to delete).');
    }
  });
});

test.describe('SC-ADMA-02 เพิ่ม/ลบอัลบั้ม', () => {
  test('TC-ADMA-02-04 [Medium] [Positive] ลบอัลบั้ม', async ({ page, browser }) => {
    requireDataCreatingTestsAllowed(CREATES);
    test.fail(true, 'Known bug (DEF-100): after an album is deleted its image file is still served (HTTP 200) — the upload is not removed from storage.');
    const activity = new AdminActivityPage(page);
    const title = `[Auto Test] อัลบัมสำหรับทดสอบการลบ ${roleStamp()}`;
    await withAlbum(page, { title }, async (description) => {
      const card = (await activity.find(byDescription(description)))!.card;
      const imageUrls = card.editImages.map((i) => i.url);
      expect(imageUrls.length, 'the album has its image').toBe(1);
      const servedBefore = await Promise.all(imageUrls.map(async (url) => (await page.request.get(url)).status()));
      expect((await publicActivity(browser)).albums.map((a) => a.title), 'public before the delete').toContain(title);
      const before = await activity.albumTotal();
      const cancel = await activity.openDeleteDialog(byDescription(description));
      await cancel.cancel();
      expect(await activity.find(byDescription(description)), 'cancel keeps it').toBeDefined();
      const confirm = await activity.openDeleteDialog(byDescription(description));
      const result = await submitAndFollow(page, () => confirm.confirm());
      expect(result.final).toBeLessThan(400);
      note(`Flash: ${(await activity.flash.allInnerTexts()).join(' | ')}`);
      expect(await activity.find(byDescription(description)), 'gone from the admin').toBeUndefined();
      expect(await activity.albumTotal(), 'the counter drops by one').toBe(before - 1);
      expect((await publicActivity(browser)).albums.map((a) => a.title), 'gone from the public page').not.toContain(title);
      for (const [index, url] of imageUrls.entries()) {
        const status = (await page.request.get(url)).status();
        note(`Image ${url.split('/').pop()}: ${servedBefore[index]} before the delete, ${status} after`);
        if (servedBefore[index] === 404) {
          note('The image was already HTTP 404 before the delete (DEF-48): its removal from storage cannot be shown here.');
          continue;
        }
        expect(status, 'the image file is gone too').toBe(404);
      }
    });
  });
});

test.describe('SC-ADMA-03 ชื่ออัลบั้ม', () => {
  test('TC-ADMA-03-01 [High] [Positive] ชื่ออัลบั้ม: ข้อความภาษาไทยปกติ', async ({ page, browser }) => {
    requireDataCreatingTestsAllowed(CREATES);
    await titleSaved(page, browser, 'ระบบจัดการความรู้ทดสอบ');
  });
  test('TC-ADMA-03-04 [High] [Negative] ชื่ออัลบั้ม: แท็ก HTML และสคริปต์', async ({ page, browser }) => {
    requireDataCreatingTestsAllowed(CREATES);
    await titleHtml(page, browser);
  });
  test('TC-ADMA-03-05 [High] [Negative] ชื่ออัลบั้ม: อักขระ SQL', async ({ page }) => {
    requireDataCreatingTestsAllowed(CREATES);
    await titleSql(page);
  });
  test('TC-ADMA-03-06 [High] [Negative] ชื่ออัลบั้ม: เว้นว่าง', async ({ page }) => {
    await titleEmpty(page);
  });
  test('TC-ADMA-03-07 [Medium] [Negative] ชื่ออัลบั้ม: ช่องว่างล้วน (เว้นวรรค 5 ตัว)', async ({ page }) => {
    test.fail(true, RAW_KEY);
    requireDataCreatingTestsAllowed('If the app accepts a blank title it saves an album (deleted again at the end).');
    await titleSpaces(page);
  });
});

test.describe('SC-ADMA-04 รูปภาพในอัลบั้ม', () => {
  test('TC-ADMA-04-06 [Medium] [Negative] รูปภาพในอัลบั้ม: ไม่เลือกไฟล์ (ช่องบังคับ)', async ({ page }) => {
    test.fail(true, NO_IMAGE_SAVED);
    requireDataCreatingTestsAllowed('If the app accepts an album without images it saves one (deleted again at the end).');
    const activity = new AdminActivityPage(page);
    const title = `AUTO_ALBUM_IMG ${AUTO_TEST_FLAG} ${roleStamp()}`;
    await withAlbum(page, { title, images: [] }, async (description, _saved, errors) => {
      const saved = await activity.find(byDescription(description));
      note(saved ? `Saved without images (${saved.card.imageCount} image(s), cover ${saved.card.cover})` : `Refused: ${JSON.stringify(errors)}`);
      expect(saved, 'an album without images is not saved').toBeUndefined();
      expect(shown(errors), 'a message asks for an image').not.toBe('');
    });
  });
});

test.describe('SC-FALB-01 แผงเพิ่มอัลบัม', () => {
  test("TC-FALB-01-01 [High] [Positive] เปิดแผง 'เพิ่มอัลบัม': ช่องและค่าเริ่มต้น", async ({ page }) => {
    test.fail(true, NO_REQUIRED_MARK);
    const activity = new AdminActivityPage(page);
    await activity.openAddForm();
    await expect(activity.panelTitle).toHaveText('เพิ่มอัลบัม');
    // textContent: innerText misses parts of the panel while it is still sliding in.
    const panelText = ((await activity.panel.textContent()) ?? '').replace(/\s+/g, ' ');
    note(`Panel: ${panelText}`);
    for (const label of ['ชื่ออัลบัม', 'คำอธิบาย', 'รูปภาพ', 'สถานะ']) expect(panelText, `the "${label}" field`).toContain(label);
    expect(panelText).toContain('ความกว้างภาพ (Width) อย่างน้อย 1,000 - 1,200px');
    expect(panelText).toContain('รองรับไฟล์ PNG , JPEG (เลือกได้หลายรูปพร้อมกัน)');
    await expect(activity.titleInput, 'the title is required').toHaveAttribute('required', '');
    expect(await activity.imageInput.getAttribute('accept'), 'PNG / JPEG only').toMatch(/image\/png.*image\/jpeg|image\/jpeg.*image\/png/);
    expect(await activity.imageInput.evaluate((el: HTMLInputElement) => el.multiple), 'several images at once').toBe(true);
    for (const [status, label] of [['draft', 'ฉบับร่าง'], ['publish', 'เผยแพร่'], ['hide', 'ซ่อน']]) {
      await expect(page.locator(`label[for="album-status-${status}"]`)).toHaveText(label);
    }
    await expect(page.locator('#album-status-publish'), 'default "เผยแพร่"').toBeChecked();
    // "มี * เฉพาะ 'ชื่ออัลบัม'": the required mark of the title label (CSS ::after or a literal *).
    const marks = await activity.panel.locator('label.form-label').evaluateAll((labels) =>
      labels.map((l) => ({ text: (l.textContent ?? '').trim(), star: (l.textContent ?? '').includes('*') || getComputedStyle(l, '::after').content.includes('*') || l.classList.contains('required') })),
    );
    note(`Required marks: ${JSON.stringify(marks)}`);
    expect(marks.filter((m) => m.star).map((m) => m.text.replace('*', '').trim()), 'a * on "ชื่ออัลบัม" only').toEqual(['ชื่ออัลบัม']);
  });

  test("TC-FALB-01-02 [Medium] [Positive] 'ยกเลิก' ปิดแผงโดยไม่สร้างอัลบัม", async ({ page }) => {
    const activity = new AdminActivityPage(page);
    const before = await activity.albumTotal();
    const title = `[Auto Test] อัลบัมที่ยกเลิก ${roleStamp()}`;
    await activity.openAddForm();
    await activity.fill({ title, images: [ALBUM_IMAGE] });
    expect(await activity.newImages.count(), 'the chosen image is previewed').toBe(1);
    await activity.cancelButton.click();
    await expect(activity.panel, 'the panel closes').toBeHidden();
    expect(await activity.albumTotal(), 'no album was created').toBe(before);
    expect(await activity.find(byTitle(title)), 'not listed').toBeUndefined();
    await activity.openAddForm();
    await expect(activity.titleInput, 'reopened: the form is empty').toHaveValue('');
    expect(await activity.newImages.count(), 'no image left over').toBe(0);
    expect(await activity.imageInput.evaluate((el: HTMLInputElement) => el.files?.length ?? 0), 'no file left in the input').toBe(0);
  });

  test('TC-FALB-01-03 [High] [Positive] สร้างอัลบัมด้วยชื่อและรูป 1 รูป', async ({ page, browser }) => {
    requireDataCreatingTestsAllowed(CREATES);
    const description = `อัลบัมทดสอบ ${albumMarker('')}`;
    await withAlbum(page, { title: 'AUTO_ALBUM_001', description }, async () => {
      const activity = new AdminActivityPage(page);
      const card = (await activity.find(byDescription(description)))?.card;
      expect(card, 'listed').toBeDefined();
      note(`Card: ${JSON.stringify({ title: card!.title, status: card!.status, images: card!.imageCount, cover: card!.cover })}`);
      expect(card!.title).toBe('AUTO_ALBUM_001');
      expect(card!.status).toBe('เผยแพร่');
      expect(card!.imageCount, 'one image').toBe(1);
      expect(card!.cover, 'the uploaded image is the cover').toBe(card!.editImages[0]?.url);
      const pub = await publicActivity(browser);
      const album = pub.albums.find((a) => a.description === description || (a.title === 'AUTO_ALBUM_001' && a.description.includes(description)));
      expect(album, 'shown on the public page (published)').toBeDefined();
      expect(album!.imageLoaded, 'with its cover').toBe(true);
      expect(album!.counters[0], 'and its image count').toBe(1);
      const detail = await publicAlbumDetail(browser, album!.href);
      expect(detail.status).toBe(200);
      expect(detail.images.length, 'the album page shows the image').toBeGreaterThanOrEqual(1);
    });
  });
});

test.describe('SC-FALB-02 ชื่ออัลบัมและคำอธิบาย', () => {
  for (const [id, label, value] of [
    ['TC-FALB-02-01 [High]', 'ข้อความภาษาไทยปกติ', 'ระบบจัดการความรู้ทดสอบ'],
    ['TC-FALB-02-02 [Medium]', 'ภาษาอังกฤษและตัวเลข', 'Test Case 001'],
    ['TC-FALB-02-03 [Medium]', 'ผสมไทย/อังกฤษ/ตัวเลข/สัญลักษณ์ทั่วไป', 'KM-Day 2569: SHOW & SHARE (รอบ 1)'],
    ['TC-FALB-02-09 [Low]', 'อีโมจิและ Unicode พิเศษ', 'ทดสอบ 😀 ✓ ①'],
  ] as const) {
    test(`${id} [Positive] ชื่ออัลบัม: ${label}`, async ({ page, browser }) => {
      requireDataCreatingTestsAllowed(CREATES);
      await titleSaved(page, browser, value);
    });
  }
  test('TC-FALB-02-06 [Low] [Positive] ชื่ออัลบัม: มีช่องว่างหน้า-หลังข้อความ', async ({ page }) => {
    requireDataCreatingTestsAllowed(CREATES);
    await withAlbum(page, { title: '  ทดสอบ  ' }, async (description) => {
      const card = (await new AdminActivityPage(page).find(byDescription(description)))?.card;
      expect(card, 'saved').toBeDefined();
      note(`Stored title: ${JSON.stringify(card!.editTitle)}`);
      expect(card!.editTitle, 'leading/trailing spaces removed').toBe('ทดสอบ');
    });
  });
  test('TC-FALB-02-07 [High] [Negative] ชื่ออัลบัม: แท็ก HTML และสคริปต์', async ({ page, browser }) => {
    requireDataCreatingTestsAllowed(CREATES);
    await titleHtml(page, browser);
  });
  test('TC-FALB-02-08 [High] [Negative] ชื่ออัลบัม: อักขระ SQL', async ({ page }) => {
    requireDataCreatingTestsAllowed(CREATES);
    await titleSql(page);
  });
  test('TC-FALB-02-10 [High] [Negative] ชื่ออัลบัม: เว้นว่าง', async ({ page }) => {
    await titleEmpty(page);
  });
  test('TC-FALB-02-11 [Medium] [Negative] ชื่ออัลบัม: ช่องว่างล้วน (เว้นวรรค 5 ตัว)', async ({ page }) => {
    test.fail(true, RAW_KEY);
    requireDataCreatingTestsAllowed('If the app accepts a blank title it saves an album (deleted again at the end).');
    await titleSpaces(page);
  });

  test('TC-FALB-02-13 [High] [Positive] คำอธิบาย: ข้อความภาษาไทยปกติ', async ({ page, browser }) => {
    requireDataCreatingTestsAllowed(CREATES);
    const title = `AUTO_ALBUM_001 ${albumMarker('')}`;
    await withAlbum(page, { title, description: 'ระบบจัดการความรู้ทดสอบ' }, async () => {
      const card = (await new AdminActivityPage(page).find(byTitle(title)))?.card;
      expect(card?.description, 'shown in the admin list').toBe('ระบบจัดการความรู้ทดสอบ');
      const album = (await publicActivity(browser)).albums.find((a) => a.title === title);
      expect(album?.description, 'shown on the public list').toBe('ระบบจัดการความรู้ทดสอบ');
    }, byTitle(title));
  });
  test('TC-FALB-02-16 [High] [Negative] คำอธิบาย: แท็ก HTML และสคริปต์', async ({ page, browser }) => {
    requireDataCreatingTestsAllowed(CREATES);
    const dialogs = collectDialogs(page);
    const title = `AUTO_ALBUM_001 ${albumMarker('')}`;
    await withAlbum(page, { title, description: HTML_PAYLOAD }, async () => {
      const activity = new AdminActivityPage(page);
      const card = (await activity.find(byTitle(title)))?.card;
      note(`Stored description: ${JSON.stringify(card?.editDescription)}`);
      expect(card, 'saved').toBeDefined();
      if (card!.editDescription === HTML_PAYLOAD) expect(card!.description, 'literal text in the admin').toBe(HTML_PAYLOAD);
      else expect(card!.editDescription, 'sanitised: no tags left').not.toMatch(/<script|<b>/i);
      expect(await activity.cards.locator('.card-text b, .card-text script').count(), 'not rendered as markup').toBe(0);
      const pub = await publicActivity(browser);
      expect(pub.dialogs, 'no script runs publicly').toEqual([]);
      expect(pub.html, 'not rendered as markup publicly').not.toContain(HTML_PAYLOAD);
      const album = pub.albums.find((a) => a.title === title);
      if (album) expect((await publicAlbumDetail(browser, album.href)).dialogs, 'nor on the album page').toEqual([]);
    }, byTitle(title));
    expect(dialogs, 'no script runs in the admin').toEqual([]);
  });
  test('TC-FALB-02-17 [Medium] [Positive] คำอธิบาย: เว้นว่าง (ไม่บังคับ)', async ({ page, browser }) => {
    requireDataCreatingTestsAllowed(CREATES);
    const title = `AUTO_ALBUM_001 ${albumMarker('')}`;
    await withAlbum(page, { title, description: '' }, async () => {
      const card = (await new AdminActivityPage(page).find(byTitle(title)))?.card;
      expect(card, 'saved without a description').toBeDefined();
      note(`Admin card description: ${JSON.stringify(card!.description)}`);
      expect(card!.description, 'the admin card shows a dash, not an empty gap').toBe('—');
      const album = (await publicActivity(browser)).albums.find((a) => a.title === title);
      expect(album, 'shown on the public list').toBeDefined();
      expect(album!.description, 'no stray text in the public card').toBe('');
    }, byTitle(title));
  });
});

test.describe('SC-FALB-03 รูปภาพอัลบัม', () => {
  test('TC-FALB-03-17 [High] [Negative] รูปภาพอัลบัม: ไม่เลือกรูป (สร้างอัลบัมเปล่า)', async ({ page, browser }) => {
    requireDataCreatingTestsAllowed('If the app accepts an album without images it saves one (deleted again at the end).');
    // "ระบบแจ้งให้เลือกรูป หรือสร้างอัลบัมว่างที่ Public แสดงสถานะว่างอย่างเหมาะสม (TBD)": either passes.
    const title = `AUTO_ALBUM_IMG ${AUTO_TEST_FLAG} ${roleStamp()}`;
    await withAlbum(page, { title, images: [] }, async (description, _saved, errors) => {
      const saved = await new AdminActivityPage(page).find(byDescription(description));
      if (!saved) {
        note(`Refused: ${JSON.stringify(errors)}`);
        expect(shown(errors), 'a message asks for an image').not.toBe('');
        return;
      }
      note(`Saved without images: ${saved.card.imageCount} image(s), cover ${saved.card.cover}`);
      const album = (await publicActivity(browser)).albums.find((a) => a.title === title);
      expect(album, 'listed publicly').toBeDefined();
      expect(album!.imageLoaded, 'a placeholder cover, not a broken image').toBe(true);
      const detail = await publicAlbumDetail(browser, album!.href);
      note(`Album page: ${detail.status}; ${detail.text.slice(0, 200)}`);
      expect(detail.status, 'the empty album page opens').toBe(200);
    });
  });
});

test.describe('SC-FALB-05 ความปลอดภัยและการบันทึก', () => {
  test('TC-FALB-05-04 [High] [Negative] ส่งฟอร์มโดยไม่มี CSRF token', async ({ page }) => {
    const activity = new AdminActivityPage(page);
    const before = await activity.albumTotal();
    const description = albumMarker('ไม่มี token');
    try {
      const response = await page.request.post(urlOf('/admin/activity'), { form: { title: `[Auto Test] ไม่มี token ${roleStamp()}`, description, status: 'publish' }, maxRedirects: 0 });
      note(`POST /admin/activity without _token -> ${response.status()}`);
      expect([403, 419], 'refused').toContain(response.status());
      expect(await activity.albumTotal(), 'nothing created').toBe(before);
    } finally {
      await deleteAlbumsWhere(page, byDescription(description));
    }
  });

  test('TC-FALB-05-05 [Medium] [Negative] กดบันทึกซ้ำรัวๆ ไม่สร้างอัลบัมซ้ำ', async ({ page }) => {
    requireDataCreatingTestsAllowed(CREATES);
    const activity = new AdminActivityPage(page);
    const description = albumMarker();
    try {
      await activity.openAddForm();
      await activity.fill({ title: `[Auto Test] อัลบัมกดรัว ${roleStamp()}`, description, images: [ALBUM_IMAGE] });
      // The page is already on /admin/activity/index: wait for the post itself, not the URL.
      const [post] = await Promise.all([
        page.waitForRequest((r) => r.method() === 'POST' && r.isNavigationRequest()),
        page.evaluate(() => {
          const button = document.querySelector<HTMLButtonElement>('#album-form button[type="submit"]');
          for (let i = 0; i < 5; i++) button?.click();
        }),
      ]);
      await post.response();
      await page.waitForLoadState('load');
      await page.waitForTimeout(1_000);
      await activity.open();
      const copies = (await activity.readCards()).filter(byDescription(description)).length;
      note(`${copies} album(s) after 5 rapid clicks`);
      expect(copies, 'only one').toBe(1);
    } finally {
      note(`Cleanup: deleted ${await deleteAlbumsWhere(page, byDescription(description))} album(s).`);
    }
  });
});
