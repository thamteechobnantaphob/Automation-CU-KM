import { test, expect } from '@fixtures/pages.fixtures';
import { requireDataCreatingTestsAllowed } from '@config/env';
import { AdminGroupPage, GroupTabKey } from '@pages/admin/AdminGroupPage';
import {
  cardCount,
  CATEGORY_DESCRIPTION,
  CATEGORY_TAB,
  createCategory,
  stampedName,
  publicDisplay,
  submitNewCategory,
} from '@utils/categoryFlows';
import { urlOf } from '@utils/lowPrivilege';
import { collectDialogs, PUBLIC_SECURITY_PAGES, SQL_ERROR_PATTERN } from '@utils/security';
import { Page } from '@playwright/test';

/**
 * KM-ADMG / SC-ADMG-02 (add without a name) and SC-ADMG-03 (the "ชื่อหมวดหมู่"
 * field), on the tab the sheet uses ("คลังความรู้"). The name is the field under
 * test, so the "[Auto Test]" marker sits in the "หัวข้อย่อย" line and the name gets
 * a time stamp; saved categories are removed by `npm run cleanup:categories`.
 *
 * Two cases (TC-ADMG-02-02, TC-ADMG-03-10) only prove that the browser stops an
 * empty name — nothing is saved, so they run without the data-creating switch.
 * The others save a category and are skipped unless the run allows it.
 *
 * NOT implemented (the sheet's {MAX} is undefined; the field has no maxlength):
 * TC-ADMG-03-04/05 — see tests/pending/km-admg.pending.spec.ts.
 */

interface Ctx {
  page: Page;
  groupPage: AdminGroupPage;
}

const REASON = 'Saving creates a category that only `npm run cleanup:categories` can remove.';
const HTML_PAYLOAD = '<b>bold</b><script>alert(1)</script>';
const SQL_PAYLOAD = "' OR 1=1; DROP TABLE users;--";

/** The browser (required) must stop an empty name: the panel stays open, what was typed stays, nothing is saved. */
async function blankNameBlocked({ page, groupPage }: Ctx, tab: GroupTabKey): Promise<void> {
  const before = await cardCount(groupPage, tab);
  await groupPage.openAddForm();
  // Only click "บันทึก" once the browser guard is confirmed: without `required` this click would post an empty name.
  await expect(groupPage.nameInput).toHaveAttribute('required', '');
  await groupPage.fill({ description: CATEGORY_DESCRIPTION });
  await groupPage.saveButton.click();

  await expect(page).toHaveURL(new RegExp(`module=${tab}`));
  await expect(groupPage.nameInput, 'the panel stays open').toBeVisible();
  const message = await groupPage.nameInput.evaluate((el: HTMLInputElement) => el.validationMessage);
  expect(message, 'browser validation message on the name').not.toBe('');
  await expect(groupPage.descriptionInput, 'what was already typed is kept').toHaveValue(CATEGORY_DESCRIPTION);
  expect(await cardCount(groupPage, tab), 'nothing was saved').toBe(before);
}

/** A plain value must be saved and come back exactly as typed: in the list, the pencil's data and the panel. */
async function savesName({ page, groupPage }: Ctx, sample: string): Promise<void> {
  const name = stampedName(sample);
  const card = await createCategory(page, groupPage, { name });

  expect(card.name).toBe(name);
  expect(card.description).toBe(CATEGORY_DESCRIPTION);
  await groupPage.openEditForm(name);
  await expect(groupPage.nameInput).toHaveValue(name);
  await expect(groupPage.descriptionInput).toHaveValue(CATEGORY_DESCRIPTION);
  await checkPublicPages(page, name);
}

/** Where the public site shows the category (if anywhere yet) — and that it does so as literal text. */
async function checkPublicPages(page: Page, name: string): Promise<void> {
  const { shownOn, problems } = await publicDisplay(page, name);
  test.info().annotations.push({
    type: 'note',
    description: shownOn.length ? `Shown on the public site: ${shownOn.join(', ')}` : 'Not shown on any of the 10 public pages (no content uses categories yet).',
  });
  expect(problems, 'on the public site the category must appear exactly as typed').toEqual([]);
}

/**
 * A payload that could hurt (script, SQL, emoji) is either saved as plain text or
 * rejected — never a server error, never executed. Returns what happened.
 */
async function submitPayload({ page, groupPage }: Ctx, name: string, dialogs: string[]): Promise<'saved' | 'rejected'> {
  const before = await cardCount(groupPage);
  const response = await submitNewCategory(groupPage, { name });
  expect(response.status(), 'the payload must not cause a server error').toBeLessThan(500);
  expect(SQL_ERROR_PATTERN.test(await page.locator('body').innerText()), 'no SQL/stack-trace text on the page').toBe(false);

  const after = await cardCount(groupPage);
  expect(after, 'at most one category is created').toBeLessThanOrEqual(before + 1);
  const saved = after === before + 1;
  if (saved) {
    const card = await groupPage.findCard(name);
    expect(card, `saved "${name}" must be listed as plain text (not rendered)`).toBeDefined();
    expect(card?.description).toBe(CATEGORY_DESCRIPTION);
    const stored = await groupPage.editAttributes(name);
    expect(stored.name, 'the pencil carries the name exactly as typed').toBe(name);
    await checkPublicPages(page, name);
  }
  expect(dialogs, 'no script may run (no alert/confirm/prompt)').toEqual([]);
  return saved ? 'saved' : 'rejected';
}

test.describe('SC-ADMG-02 เพิ่มหมวดหมู่โดยไม่กรอกชื่อ', () => {
  test('TC-ADMG-02-02 [High] เพิ่มหมวดหมู่โดยไม่กรอกชื่อ', async ({ page, groupPage }) => {
    await blankNameBlocked({ page, groupPage }, 'cms');
  });
});

test.describe('SC-ADMG-03 หมวดหมู่: ตรวจชื่อ', () => {
  test('TC-ADMG-03-10 [High] ชื่อหมวดหมู่: เว้นว่าง', async ({ page, groupPage }) => {
    await blankNameBlocked({ page, groupPage }, CATEGORY_TAB);
  });

  test.describe('บันทึกหมวดหมู่จริง', () => {
    test.setTimeout(90_000);
    test.beforeEach(() => requireDataCreatingTestsAllowed(REASON));

    test('TC-ADMG-03-01 [High] ชื่อหมวดหมู่: ข้อความภาษาไทยปกติ', async ({ page, groupPage }) => {
      const name = stampedName('ระบบจัดการความรู้ทดสอบ');
      const response = await submitNewCategory(groupPage, { name });
      expect(response.status()).toBeLessThan(500);
      // Recorded, not asserted: the app's own confirmation after saving.
      const flash = await groupPage.flash.innerText({ timeout: 3_000 }).catch(() => '(no message found)');
      test.info().annotations.push({ type: 'note', description: `Message after saving: "${flash.trim()}"` });

      await groupPage.open(CATEGORY_TAB);
      const card = await groupPage.findCard(name);
      expect(card, `category "${name}" should be listed on its tab`).toBeDefined();
      expect(card?.description).toBe(CATEGORY_DESCRIPTION);
      await groupPage.openEditForm(name);
      await expect(groupPage.nameInput).toHaveValue(name);
      await checkPublicPages(page, name);
    });

    test('TC-ADMG-03-02 [Medium] ชื่อหมวดหมู่: ภาษาอังกฤษและตัวเลข', async ({ page, groupPage }) => {
      await savesName({ page, groupPage }, 'Test Case 001');
    });

    test('TC-ADMG-03-03 [Medium] ชื่อหมวดหมู่: ผสมไทย/อังกฤษ/ตัวเลข/สัญลักษณ์ทั่วไป', async ({ page, groupPage }) => {
      // "&" must come back as "&", not "&amp;" (double escaping).
      await savesName({ page, groupPage }, 'KM-Day 2569: SHOW & SHARE (รอบ 1)');
    });

    test('TC-ADMG-03-06 [Low] ชื่อหมวดหมู่: มีช่องว่างหน้า-หลังข้อความ', async ({ page, groupPage }) => {
      const core = stampedName('ทดสอบ');
      const card = await createCategory(page, groupPage, { name: `  ${core}  ` });

      // TBD in the sheet whether the server trims; either is fine as long as the text itself is intact.
      expect(card.name).toBe(core);
      const stored = (await groupPage.editAttributes(core)).name ?? '';
      expect(stored.trim()).toBe(core);
      test.info().annotations.push({
        type: 'note',
        description: stored === core ? 'The server trims leading/trailing spaces.' : `The server keeps the spaces as typed (stored ${JSON.stringify(stored)}).`,
      });
      await checkPublicPages(page, core);
    });

    test('TC-ADMG-03-07 [High] ชื่อหมวดหมู่: แท็ก HTML และสคริปต์', async ({ page, groupPage }) => {
      const dialogs = collectDialogs(page);
      const outcome = await submitPayload({ page, groupPage }, stampedName(HTML_PAYLOAD), dialogs);

      // "ทั้งฝั่ง admin และ Public": no category tab renders the tags, and no public page runs anything.
      for (const tab of ['cms', CATEGORY_TAB] as const) {
        await groupPage.open(tab);
        await expect(groupPage.cards.locator('b, script'), `no rendered tags on tab "${tab}"`).toHaveCount(0);
      }
      expect(dialogs, 'no script ran on the admin tabs or the public pages (checked while the public pages were opened)').toEqual([]);
      test.info().annotations.push({ type: 'note', description: `HTML in the name was ${outcome === 'saved' ? 'saved and shown as text' : 'rejected'}.` });
    });

    test('TC-ADMG-03-08 [High] ชื่อหมวดหมู่: อักขระ SQL', async ({ page, groupPage }) => {
      const otherTabBefore = await cardCount(groupPage, 'cms');
      const outcome = await submitPayload({ page, groupPage }, stampedName(SQL_PAYLOAD), collectDialogs(page));

      // "ข้อมูลอื่นไม่ถูกกระทบ": the other tab keeps its categories and the user table still exists.
      expect(await cardCount(groupPage, 'cms'), 'the other tab is untouched').toBe(otherTabBefore);
      const users = await page.request.get('/admin/user/index');
      expect(users.status(), 'the user list still loads').toBe(200);
      expect(await users.text()).toContain('admin');
      test.info().annotations.push({ type: 'note', description: `SQL text in the name was ${outcome === 'saved' ? 'saved as plain text' : 'rejected'}.` });
    });

    test('TC-ADMG-03-09 [Low] ชื่อหมวดหมู่: อีโมจิและ Unicode พิเศษ', async ({ page, groupPage }) => {
      const outcome = await submitPayload({ page, groupPage }, stampedName('ทดสอบ 😀 ✓ ①'), collectDialogs(page));
      // Saved → shown exactly (checked in submitPayload: no "?" / mojibake); rejected → clear, no HTTP 500.
      test.info().annotations.push({ type: 'note', description: `Emoji/Unicode in the name was ${outcome === 'saved' ? 'saved and displayed intact' : 'rejected without a server error'}.` });
    });

    test('TC-ADMG-03-11 [Medium] ชื่อหมวดหมู่: ช่องว่างล้วน (เว้นวรรค 5 ตัว)', async ({ groupPage }) => {
      // Five spaces pass the browser's `required`; the SERVER must treat them as empty.
      const before = await cardCount(groupPage);
      const response = await submitNewCategory(groupPage, { name: '     ' });
      expect(response.status(), 'a rejected name must not be a server error').toBeLessThan(500);
      expect(await cardCount(groupPage), 'no category should have been created').toBe(before);
    });
  });
});
