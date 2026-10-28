import { Browser, expect, Page, test } from '@playwright/test';
import { ANONYMOUS_SESSION } from '@fixtures/pages.fixtures';
import { AdminFaqPage, FaqCard, FaqValues } from '@pages/admin/AdminFaqPage';
import { AdminGroupPage, CategoryStatus } from '@pages/admin/AdminGroupPage';
import { Submitted, submitAndFollow } from '@pages/admin/AdminNewsPages';
import { CATEGORY_DESCRIPTION } from '@utils/categoryFlows';
import { urlOf } from '@utils/lowPrivilege';
import { roleStamp } from '@utils/roleFlows';
import { collectDialogs } from '@utils/security';
import { AUTO_TEST_FLAG } from '@utils/testData';

/**
 * Shared steps for the FAQ specs (KM-ADMF / KM-FFAQ / KM-FEF). Every FAQ a test saves is deleted again by the same
 * test, found by the "[Auto Test]" marker + stamp it carries in its answer (or its question when the answer is under
 * test). FAQ categories live on the "คำถามยอดฮิต" tab of /admin/group (module=faq); test categories carry the
 * marker in their description like every other test category.
 */

/** "[Auto Test] คำตอบทดสอบอัตโนมัติ <stamp>" — unique per call. */
export function faqMarker(label = 'คำตอบทดสอบอัตโนมัติ'): string {
  return `${AUTO_TEST_FLAG} ${label} ${roleStamp()}`;
}

/** Opens the add panel, fills it (status publish unless given) and saves. */
export async function submitFaq(page: Page, values: FaqValues): Promise<Submitted> {
  const faq = new AdminFaqPage(page);
  await faq.open();
  await faq.openAddForm();
  await faq.fill({ status: 'publish', ...values });
  return faq.save();
}

/** Deletes every FAQ that matches (marker required). Never throws; returns how many went. */
export async function deleteFaqWhere(page: Page, match: (card: FaqCard) => boolean): Promise<number> {
  const faq = new AdminFaqPage(page);
  let deleted = 0;
  for (let attempt = 0; attempt < 5; attempt++) {
    try {
      if (!(await faq.find(match))) break;
      const dialog = await faq.openDeleteDialog(match);
      const result = await submitAndFollow(page, () => dialog.confirm());
      if (result.final >= 400 || result.first >= 400) break;
      deleted++;
    } catch {
      break;
    }
  }
  return deleted;
}

/**
 * Saves a FAQ (answer = a fresh marker unless given), runs `checks`, then deletes it. Pass `match` when the answer is
 * under test (put the marker in the question then). Writes a "Cleanup: …" note.
 */
export async function withFaq(page: Page, values: FaqValues, checks: (answer: string, saved: Submitted) => Promise<void>, match?: (card: FaqCard) => boolean): Promise<void> {
  const answer = values.answer ?? faqMarker();
  try {
    const saved = await submitFaq(page, { ...values, answer });
    expect(saved.final, 'saving is not a server error').toBeLessThan(500);
    await checks(answer, saved);
  } finally {
    const deleted = await deleteFaqWhere(page, match ?? ((card) => card.editAnswer === answer));
    test.info().annotations.push({ type: 'note', description: `Cleanup: deleted ${deleted} FAQ(s).` });
  }
}

export interface PublicFaq {
  status: number;
  text: string;
  html: string;
  dialogs: string[];
  /** "คำถามทั้งหมด ( n รายการ )" → n (null when absent). */
  count: number | null;
  questions: string[];
  /** The answers (from the DOM — they sit in collapsed accordion bodies, so innerText would skip them). */
  answers: string[];
}

/** /frontend/faq/index (optionally with a query string) as a visitor sees it. */
export async function publicFaq(browser: Browser, query = ''): Promise<PublicFaq> {
  const context = await browser.newContext({ storageState: ANONYMOUS_SESSION });
  try {
    const page = await context.newPage();
    const dialogs = collectDialogs(page);
    const response = await page.goto(urlOf(`/frontend/faq/index${query}`));
    await page.waitForLoadState('load');
    await page.waitForTimeout(300);
    const text = (await page.locator('body').innerText()).replace(/\s+/g, ' ');
    const count = /\(\s*(\d+)\s*รายการ\s*\)/.exec(text);
    return {
      status: response?.status() ?? 0,
      text,
      html: await page.locator('body').innerHTML(),
      dialogs,
      count: count ? Number(count[1]) : null,
      questions: (await page.locator('.accordion-button').allInnerTexts()).map((q) => q.replace(/\s+/g, ' ').trim()),
      answers: await page.locator('.accordion-body').evaluateAll((bodies) => bodies.map((b) => (b.textContent ?? '').replace(/\s+/g, ' ').trim())),
    };
  } finally {
    await context.close();
  }
}

/** Creates a FAQ category ("คำถามยอดฮิต" tab) whose description carries the marker; returns its name. */
export async function createFaqCategory(page: Page, label: string, status: CategoryStatus = 'publish'): Promise<string> {
  const groupPage = new AdminGroupPage(page);
  const name = `${label} ${roleStamp()}`;
  await groupPage.open('faq');
  await groupPage.openAddForm();
  await groupPage.fill({ name, description: CATEGORY_DESCRIPTION, status });
  expect((await groupPage.save()).status(), 'saving the test FAQ category').toBeLessThan(500);
  return name;
}

/** Deletes test categories of the faq tab whose name starts with `name` (marker required). Never throws. */
export async function deleteFaqCategories(page: Page, name: string): Promise<number> {
  const groupPage = new AdminGroupPage(page);
  let deleted = 0;
  for (let attempt = 0; attempt < 5; attempt++) {
    try {
      await groupPage.open('faq');
      const card = (await groupPage.readCards()).find((c) => c.name.trim() === name.trim());
      if (!card) break;
      const dialog = await groupPage.openDeleteDialog(card.name);
      await submitAndFollow(page, () => dialog.confirm());
      deleted++;
    } catch {
      break;
    }
  }
  return deleted;
}
