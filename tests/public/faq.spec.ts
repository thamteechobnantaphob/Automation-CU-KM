import { test, expect } from '@fixtures/pages.fixtures';
import { requireDataCreatingTestsAllowed } from '@config/env';
import { ANONYMOUS_SESSION } from '@fixtures/pages.fixtures';
import { ADMIN_AUTH_FILE } from '../../global-setup';
import { FaqCard } from '@pages/admin/AdminFaqPage';
import { createFaqCategory, deleteFaqCategories, deleteFaqWhere, submitFaq } from '@utils/faqFlows';
import { urlOf } from '@utils/lowPrivilege';
import { roleStamp } from '@utils/roleFlows';
import { AUTO_TEST_FLAG } from '@utils/testData';
import { Browser, Page } from '@playwright/test';

/**
 * KM-FEF — the public FAQ page (/frontend/faq/index). Recon 2026-10-02: a search box with a scope
 * "ทั้งหมด / ค้นหาจากคำถาม / ค้นหาจากคำตอบ" (radio pills — NOT category tabs: the page has no category tabs at all,
 * DEF-64), "คำถามทั้งหมด ( n รายการ )", and a Bootstrap accordion (.accordion-button → .accordion-collapse,
 * data-bs-parent="#accordionAll").
 * Dev has no FAQ, so the workflow is followed: the admin creates a category and FAQs (one published in the category,
 * one published without, one hidden) in beforeAll; they are deleted again in afterAll.
 */

const stamp = roleStamp();
const data = {
  category: '',
  inCategory: { question: `[Auto Test] คำถามในหมวด ${stamp}`, answer: `${AUTO_TEST_FLAG} คำตอบในหมวด ${stamp}` },
  noCategory: { question: `[Auto Test] คำถามไม่มีหมวด ${stamp}`, answer: `${AUTO_TEST_FLAG} คำตอบไม่มีหมวด ${stamp}` },
  hidden: { question: `[Auto Test] คำถามที่ซ่อน ${stamp}`, answer: `${AUTO_TEST_FLAG} คำตอบที่ซ่อน ${stamp}` },
};
const ours = (card: FaqCard): boolean => card.editAnswer.includes(stamp);

async function asAdmin<T>(browser: Browser, work: (page: Page) => Promise<T>): Promise<T> {
  const context = await browser.newContext({ storageState: ADMIN_AUTH_FILE });
  try {
    return await work(await context.newPage());
  } finally {
    await context.close();
  }
}

test.beforeAll(async ({ browser }) => {
  test.setTimeout(180_000);
  requireDataCreatingTestsAllowed('Creates a FAQ category and three FAQs (deleted again in afterAll).');
  await asAdmin(browser, async (page) => {
    data.category = await createFaqCategory(page, '[Auto Test] หมวด FAQ สาธารณะ');
    await submitFaq(page, { ...data.inCategory, category: data.category, status: 'publish' });
    await submitFaq(page, { ...data.noCategory, status: 'publish' });
    await submitFaq(page, { ...data.hidden, status: 'hide' });
  });
});

test.afterAll(async ({ browser }) => {
  test.setTimeout(120_000);
  await asAdmin(browser, async (page) => {
    await deleteFaqWhere(page, ours);
    if (data.category) await deleteFaqCategories(page, data.category);
  });
});

async function visitor(browser: Browser): Promise<{ page: Page; close: () => Promise<void> }> {
  const context = await browser.newContext({ storageState: ANONYMOUS_SESSION });
  const page = await context.newPage();
  await page.goto(urlOf('/frontend/faq/index'));
  await page.waitForLoadState('load');
  return { page, close: () => context.close() };
}

const countOf = async (page: Page): Promise<number | null> => {
  const match = /\(\s*(\d+)\s*รายการ\s*\)/.exec((await page.locator('body').innerText()).replace(/\s+/g, ' '));
  return match ? Number(match[1]) : null;
};
const visibleQuestions = (page: Page): Promise<string[]> =>
  page.locator('.accordion-button:visible').evaluateAll((buttons) => buttons.map((b) => (b.textContent ?? '').replace(/\s+/g, ' ').trim()));

test('TC-FEF-01-01 [High] [Positive] แสดง FAQ ทั้งหมดและจำนวนรายการ', async ({ browser }) => {
  test.fail(true, 'Spec mismatch (DEF-64): the public FAQ page has no category tabs any more ("ทั้งหมด" is now a search scope).');
  const { page, close } = await visitor(browser);
  try {
    const questions = await visibleQuestions(page);
    const count = await countOf(page);
    test.info().annotations.push({ type: 'note', description: `Count ${count}; ${questions.length} question(s) shown` });
    expect(questions, 'published FAQs are listed').toEqual(expect.arrayContaining([data.inCategory.question, data.noCategory.question]));
    expect(questions, 'a hidden FAQ is not').not.toContain(data.hidden.question);
    expect(count, '"( n รายการ )" matches the questions shown').toBe(questions.length);
    // The sheet's tabs: "ทั้งหมด" + one per category.
    await expect(page.getByText(data.category, { exact: true }).first(), 'a tab for the category').toBeVisible({ timeout: 5_000 });
  } finally {
    await close();
  }
});

test('TC-FEF-01-02 [Medium] [Positive] กรองตามหมวดหมู่', async ({ browser }) => {
  test.fail(true, 'Spec mismatch (DEF-64): the public FAQ page has no category tabs any more.');
  const { page, close } = await visitor(browser);
  try {
    await page.getByText(data.category, { exact: true }).first().click({ timeout: 5_000 });
    await page.waitForLoadState('load');
    await page.waitForTimeout(500);
    const questions = await visibleQuestions(page);
    test.info().annotations.push({ type: 'note', description: `Tab "${data.category}": ${questions.join(' | ')} (count ${await countOf(page)})` });
    expect(questions, 'only the category\'s FAQ').toEqual([data.inCategory.question]);
    expect(await countOf(page), 'the count follows').toBe(1);
  } finally {
    await close();
  }
});

test('TC-FEF-01-03 [Medium] [Positive] กดคำถามเพื่อดูคำตอบ', async ({ browser }) => {
  const { page, close } = await visitor(browser);
  try {
    const button = page.locator('.accordion-button', { hasText: data.noCategory.question });
    const body = page.locator(`.accordion-item:has(.accordion-button:has-text("${data.noCategory.question}")) .accordion-collapse`);
    await expect(body, 'closed at first').toBeHidden();
    await button.click();
    await expect(body, 'opens on the first click').toBeVisible();
    await expect(body, 'the answer is not empty').toContainText(data.noCategory.answer);
    // Bootstrap ignores clicks while the collapse is still animating ("collapsing"): wait until it has settled.
    await expect(body).toHaveClass(/\bshow\b/);
    await expect(body).not.toHaveClass(/collapsing/);
    await button.click();
    await expect(body, 'closes on the second click').toBeHidden();
  } finally {
    await close();
  }
});

test('TC-FEF-02-01 [Low] [Positive] ใช้คีย์บอร์ดเปิด/ปิดคำตอบ', async ({ browser }) => {
  const { page, close } = await visitor(browser);
  try {
    const button = page.locator('.accordion-button', { hasText: data.noCategory.question });
    await button.focus();
    await page.keyboard.press('Enter');
    await expect(button, 'Enter opens it (aria-expanded)').toHaveAttribute('aria-expanded', 'true');
    // Wait for the open animation to finish (Bootstrap ignores toggles while "collapsing").
    const body = page.locator(`.accordion-item:has(.accordion-button:has-text("${data.noCategory.question}")) .accordion-collapse`);
    await expect(body).toHaveClass(/\bshow\b/);
    await expect(body).not.toHaveClass(/collapsing/);
    await page.keyboard.press('Space');
    await expect(button, 'Space closes it').toHaveAttribute('aria-expanded', 'false');
  } finally {
    await close();
  }
});

test('TC-FEF-02-02 [Low] [Positive] เปิดหลายคำถามพร้อมกัน', async ({ browser }) => {
  const { page, close } = await visitor(browser);
  try {
    const first = page.locator('.accordion-button', { hasText: data.inCategory.question });
    const second = page.locator('.accordion-button', { hasText: data.noCategory.question });
    await first.click();
    await expect(first).toHaveAttribute('aria-expanded', 'true');
    await second.click();
    await expect(second).toHaveAttribute('aria-expanded', 'true');
    await page.waitForTimeout(500);
    const firstOpen = (await first.getAttribute('aria-expanded')) === 'true';
    test.info().annotations.push({ type: 'note', description: firstOpen ? 'Both stay open.' : 'One at a time: opening the second closes the first (accordion, data-bs-parent).' });
    // "ทำงานตามกติกา: เปิดพร้อมกันได้ หรือเปิดทีละข้อ (TBD)" — either rule is accepted; the second must be open.
  } finally {
    await close();
  }
});
