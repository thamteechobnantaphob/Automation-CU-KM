import { test, expect } from '@fixtures/pages.fixtures';
import { requireDataCreatingTestsAllowed } from '@config/env';
import { MAX_LENGTH, POLICY_SOURCE } from '@config/policy';
import { AdminFaqPage, FaqCard } from '@pages/admin/AdminFaqPage';
import { AdminGroupPage, CategoryStatus } from '@pages/admin/AdminGroupPage';
import { submitAndFollow } from '@pages/admin/AdminNewsPages';
import { sheetTitle } from '@utils/caseTitles';
import { CATEGORY_DESCRIPTION } from '@utils/categoryFlows';
import { createFaqCategory, deleteFaqCategories, faqMarker, publicFaq, withFaq } from '@utils/faqFlows';
import { urlOf } from '@utils/lowPrivilege';
import { roleStamp } from '@utils/roleFlows';
import { collectDialogs } from '@utils/security';
import { AUTO_TEST_FLAG } from '@utils/testData';
import { ANONYMOUS_SESSION } from '@fixtures/pages.fixtures';
import { Browser, Page } from '@playwright/test';
import { textOfLength } from '../content/contentLimitsSuite';

/**
 * KM-ADMF / KM-FFAQ / KM-FEF — the FAQ cases left after the Auto:Y round (Auto:P + the {MAX} cases), checked
 * 2026-10-07. Limits are the OWASP-based proposals in src/config/policy.ts (question 500, answer 10,000, category name
 * 100 characters) until SA/Dev decide. The FAQ admin was redesigned (DEF-64): plain-text answer (no editor toolbar,
 * files, references), statuses publish/hide only, and the public page has no category tabs — those parts of the sheet
 * fail as spec mismatches. Every FAQ / FAQ category a case saves carries "[Auto Test]" and is deleted again.
 */

const CREATES = 'Saves a FAQ (deleted again at the end of the case).';
const KNOWN = {
  REDESIGNED: 'Spec mismatch (DEF-64): the FAQ admin was redesigned — this part of the sheet (editor toolbar / files / references / draft status / public category tabs) no longer exists.',
  UNLIMITED: 'Known bug (DEF-101): the field has no length limit — one character over the proposed maximum is saved.',
  CATEGORY_UNLIMITED: 'Known bug (DEF-35): the category name has no length limit.',
  NO_LINE_BREAKS: 'Known bug (DEF-114): the public FAQ page shows the answer on one line — its line breaks are lost (no paragraphs / <br>).',
  QUESTION_500: 'Known bug (DEF-113): a FAQ question of 256 characters or more makes the save answer HTTP 500 (the rule allows 500, the column holds 255).',
  RAW_KEY: 'Known bug (DEF-66): the length is refused but the message is the raw key "validation.max.string".',
  DRAFT_AS_HIDDEN: 'Known bug (DEF-109): a draft ("ฉบับร่าง") is saved as hidden.',
};
const RAW = /\bvalidation\.[a-z_.]+/i;

test.beforeEach(() => test.setTimeout(150_000));

function note(description: string): void {
  test.info().annotations.push({ type: 'note', description });
}

const byAnswer = (answer: string) => (card: FaqCard): boolean => card.editAnswer === answer;

/** withFaq with a question (required — without one the browser blocks the post) unless the case gives its own. */
const withFaqQ: typeof withFaq = (page, values, checks, match) => withFaq(page, { question: `${AUTO_TEST_FLAG} คำถามทดสอบ ${roleStamp()}`, ...values }, checks, match);

/** Whether the public FAQ page offers category tabs (it does not — DEF-64). */
async function publicCategoryTabs(browser: Browser): Promise<string[]> {
  const context = await browser.newContext({ storageState: ANONYMOUS_SESSION });
  try {
    const page = await context.newPage();
    await page.goto(urlOf('/frontend/faq/index'));
    return page.locator('.body-content [role="tab"], .body-content .nav-tabs .nav-link, .body-content .category-tab').allInnerTexts();
  } finally {
    await context.close();
  }
}

/** The FAQ form messages the admin can see after a save. */
async function faqMessages(page: Page): Promise<string> {
  const texts = await page.locator('#faqMod .text-xsmall, #faqMod .invalid-feedback, #faqMod .text-danger, .alert-danger').evaluateAll((els) =>
    els.filter((e) => (e as HTMLElement).offsetParent !== null).map((e) => (e.textContent ?? '').replace(/\s+/g, ' ').trim()),
  );
  return texts.filter(Boolean).join(' ');
}

/** A FAQ category for the case (marker in its description); deleted in `finally`. */
async function withFaqCategory(page: Page, label: string, status: CategoryStatus, work: (name: string) => Promise<void>): Promise<void> {
  let name = '';
  try {
    name = await createFaqCategory(page, `${label}`, status);
    await work(name);
  } finally {
    if (name) note(`Cleanup: deleted ${await deleteFaqCategories(page, name)} FAQ categor(ies).`);
  }
}

/** A question / answer of exactly `max` characters is saved whole and shown whole publicly. */
async function atMax(page: Page, browser: Browser, field: 'question' | 'answer', max: number): Promise<void> {
  requireDataCreatingTestsAllowed(CREATES);
  note(`Limit used: ${POLICY_SOURCE}`);
  const stamp = roleStamp();
  const value = textOfLength(`${AUTO_TEST_FLAG} ${stamp}`, max);
  const values = field === 'question' ? { question: value } : { question: `${AUTO_TEST_FLAG} คำถามยาว ${stamp}`, answer: value };
  test.fail(field === 'question' && max > 255, KNOWN.QUESTION_500);
  await withFaqQ(page, values, async (answer) => {
    const card = (await new AdminFaqPage(page).find((c) => c.editAnswer.includes(stamp) || c.editQuestion.includes(stamp) || c.editAnswer === answer))?.card;
    expect(card, `${max} characters are saved`).toBeDefined();
    expect(field === 'question' ? card!.editQuestion : card!.editAnswer, 'stored whole').toBe(value);
    const pub = await publicFaq(browser);
    const shown = field === 'question' ? pub.questions : pub.answers;
    expect(shown.some((t) => t === value.replace(/\s+/g, ' ').trim()), 'shown whole publicly').toBe(true);
    const context = await browser.newContext({ storageState: ANONYMOUS_SESSION });
    try {
      const visitor = await context.newPage();
      await visitor.goto(urlOf('/frontend/faq/index'));
      await visitor.locator('.accordion-button').filter({ hasText: field === 'question' ? stamp : `คำถามยาว ${stamp}` }).first().click();
      await visitor.waitForTimeout(600);
      const overflow = await visitor.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
      expect(overflow, 'the layout does not break').toBeLessThanOrEqual(1);
    } finally {
      await context.close();
    }
  }, (c) => c.editQuestion.includes(stamp) || c.editAnswer.includes(stamp));
}

/** `max` + 1 characters: refused with a readable length message (or the input stops); never a 500. */
async function overMax(page: Page, field: 'question' | 'answer', max: number): Promise<void> {
  requireDataCreatingTestsAllowed(CREATES);
  note(`Limit used: ${POLICY_SOURCE}`);
  const faq = new AdminFaqPage(page);
  await faq.open();
  await faq.openAddForm();
  const maxlength = await (field === 'question' ? faq.questionInput : faq.answerInput).getAttribute('maxlength');
  note(`maxlength: ${maxlength ?? '(none)'}`);
  await faq.cancelButton.click();
  if (maxlength && Number(maxlength) <= max) return;
  const stamp = roleStamp();
  const value = textOfLength(`${AUTO_TEST_FLAG} ${stamp}`, max + 1);
  const values = field === 'question' ? { question: value } : { question: `${AUTO_TEST_FLAG} คำถามยาว ${stamp}`, answer: value };
  await withFaqQ(page, values, async (_answer, saved) => {
    const messages = await faqMessages(page);
    const card = (await faq.find((c) => c.editQuestion.includes(stamp) || c.editAnswer.includes(stamp)))?.card;
    note(`Save ${saved.first} → ${saved.final}; saved ${Boolean(card)}; messages "${messages}"`);
    expect(saved.final, 'no server error').toBeLessThan(500);
    test.fail(Boolean(card), KNOWN.UNLIMITED);
    expect(card, `${max + 1} characters are not saved`).toBeUndefined();
    expect(messages, 'a message about the length').toMatch(/ต้องไม่เกิน|ไม่เกิน\s*\d+|ยาวเกิน|ความยาว|\bvalidation\.max/);
    test.fail(RAW.test(messages), KNOWN.RAW_KEY);
    expect(messages, 'a readable message, not a raw key').not.toMatch(RAW);
  }, (c) => c.editQuestion.includes(stamp) || c.editAnswer.includes(stamp));
}

// ---------------------------------------------------------------------------------------------------------------

test.describe('SC-FEF FAQ บนหน้า Public', () => {
  test(sheetTitle('TC-FEF-01-04'), async ({ page, browser }) => {
    requireDataCreatingTestsAllowed(CREATES);
    const before = await publicFaq(browser);
    const question = `${AUTO_TEST_FLAG} FAQ ที่ไม่เผยแพร่ ${roleStamp()}`;
    await withFaqQ(page, { question, status: 'hide' }, async () => {
      const pub = await publicFaq(browser);
      note(`Count ${before.count} → ${pub.count}`);
      expect(pub.questions, 'the hidden FAQ is not shown').not.toContain(question);
      expect(pub.count, 'and not counted').toBe(before.count);
    });
  });

  test(sheetTitle('TC-FEF-02-03'), async ({ page, browser }) => {
    requireDataCreatingTestsAllowed('Saves a FAQ category without FAQs (deleted again at the end).');
    await withFaqCategory(page, `${AUTO_TEST_FLAG} หมวดว่าง`, 'publish', async (name) => {
      const tabs = await publicCategoryTabs(browser);
      note(`Public category tabs: ${JSON.stringify(tabs)}`);
      test.fail(!tabs.length, KNOWN.REDESIGNED);
      expect(tabs, 'the empty category has a tab').toContain(name);
    });
  });

  test(sheetTitle('TC-FEF-02-04'), async ({ page, browser }) => {
    requireDataCreatingTestsAllowed(CREATES);
    const stamp = roleStamp();
    const answer = [`${AUTO_TEST_FLAG} คำตอบยาว ${stamp}`, 'บรรทัดที่สอง: ขั้นตอนที่ 1 ล้างมือ', 'บรรทัดที่สาม: ขั้นตอนที่ 2 เตรียมอุปกรณ์', 'ข้อความยาว'.repeat(400)].join('\n');
    await withFaqQ(page, { answer }, async () => {
      const context = await browser.newContext({ storageState: ANONYMOUS_SESSION });
      try {
        const visitor = await context.newPage();
        await visitor.goto(urlOf('/frontend/faq/index'));
        const item = visitor.locator('.accordion-item').filter({ has: visitor.locator('.accordion-body', { hasText: stamp }) }).first();
        await item.locator('.accordion-button').click();
        await visitor.waitForTimeout(800);
        const body = item.locator('.accordion-body');
        const text = await body.innerText();
        const overflow = await visitor.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
        note(`Shown ${text.length} characters; lines ${text.split('\n').length}; overflow ${overflow}px`);
        expect(text.replace(/\s+/g, ''), 'the whole answer is shown').toContain(answer.replace(/\s+/g, ''));
        test.fail(text.split('\n').length < 3, KNOWN.NO_LINE_BREAKS);
        expect.soft(text.split('\n').length, 'its line breaks are kept').toBeGreaterThanOrEqual(3);
        expect(overflow, 'the layout does not break').toBeLessThanOrEqual(1);
      } finally {
        await context.close();
      }
    });
  });

  test(sheetTitle('TC-FEF-02-06'), async ({ page, browser }) => {
    requireDataCreatingTestsAllowed(CREATES);
    const question = `${AUTO_TEST_FLAG} <b>ตัวหนา</b> & "อัญประกาศ" <script>alert('q')</script> ${roleStamp()}`;
    const answer = `${faqMarker()} <img src=x onerror=alert(1)> 5 < 6 & 7 > 3`;
    await withFaqQ(page, { question, answer }, async () => {
      const pub = await publicFaq(browser);
      expect(pub.dialogs, 'no script runs').toEqual([]);
      expect(pub.questions, 'the question is shown as text').toContain(question);
      expect(pub.answers, 'the answer is shown as text').toContain(answer);
      expect(pub.html, 'no live markup from the FAQ').not.toMatch(/<img src="?x"? onerror/);
    });
  });
});

test.describe('SC-ADMF-02 เพิ่ม/แก้ไข FAQ', () => {
  for (const id of ['TC-ADMF-02-01', 'TC-FFAQ-04-08']) {
    test(sheetTitle(id), async ({ page, browser }) => {
      requireDataCreatingTestsAllowed(CREATES);
      await withFaqCategory(page, `${AUTO_TEST_FLAG} หมวด FAQ`, 'publish', async (category) => {
        const before = await publicFaq(browser);
        const adminBefore = await new AdminFaqPage(page).total();
        const question = `${AUTO_TEST_FLAG} คำถามใหม่ ${roleStamp()}`;
        await withFaqQ(page, { question, category }, async (answer) => {
          const faq = new AdminFaqPage(page);
          await expect(faq.flash.filter({ hasText: 'เรียบร้อย' }).first(), 'success message').toBeVisible();
          const card = (await faq.find(byAnswer(answer)))?.card;
          expect(card?.question, 'listed in the admin').toBe(question);
          expect(await faq.total(), 'one more FAQ in the admin list').toBe(adminBefore + 1);
          const pub = await publicFaq(browser);
          note(`Public count ${before.count} → ${pub.count}`);
          expect(pub.questions, 'shown on /frontend/faq/index').toContain(question);
          expect(pub.count, 'the public count grows by 1').toBe((before.count ?? 0) + 1);
          const tabs = await publicCategoryTabs(browser);
          test.fail(!tabs.length, KNOWN.REDESIGNED);
          expect(tabs, `under its category "${category}"`).toContain(category);
        });
      });
    });
  }

  test(sheetTitle('TC-ADMF-02-03'), async ({ page, browser }) => {
    requireDataCreatingTestsAllowed(CREATES);
    const stamp = roleStamp();
    const question = `${AUTO_TEST_FLAG} คำถามก่อนแก้ ${stamp}`;
    await withFaqQ(page, { question }, async (answer) => {
      const faq = new AdminFaqPage(page);
      await faq.openEditForm(byAnswer(answer));
      const newQuestion = `${AUTO_TEST_FLAG} คำถามหลังแก้ ${stamp}`;
      const newAnswer = `${answer} (แก้ไขแล้ว)`;
      await faq.fill({ question: newQuestion, answer: newAnswer, status: 'hide' });
      expect((await faq.save()).final).toBeLessThan(400);
      const card = (await faq.find((c) => c.editQuestion === newQuestion))?.card;
      expect(card?.editAnswer, 'the new answer is kept').toBe(newAnswer);
      expect(card?.status, 'and the new status').toBe('ซ่อน');
      const pub = await publicFaq(browser);
      expect(pub.questions, 'the unpublished FAQ is gone from the public page').not.toContain(newQuestion);
      expect(pub.questions).not.toContain(question);
    }, (c) => c.editQuestion.includes(stamp));
  });
});

test.describe('SC-ADMF-03/04 / SC-FFAQ-02 ความยาวคำถามและคำตอบ', () => {
  test(sheetTitle('TC-ADMF-03-04'), ({ page, browser }) => atMax(page, browser, 'question', MAX_LENGTH.faqQuestion));
  test(sheetTitle('TC-ADMF-03-05'), ({ page }) => overMax(page, 'question', MAX_LENGTH.faqQuestion));
  test(sheetTitle('TC-FFAQ-02-04'), ({ page, browser }) => atMax(page, browser, 'question', MAX_LENGTH.faqQuestion));
  test(sheetTitle('TC-FFAQ-02-05'), ({ page }) => overMax(page, 'question', MAX_LENGTH.faqQuestion));
  test(sheetTitle('TC-ADMF-04-02'), ({ page, browser }) => atMax(page, browser, 'answer', MAX_LENGTH.faqAnswer));
  test(sheetTitle('TC-ADMF-04-03'), ({ page }) => overMax(page, 'answer', MAX_LENGTH.faqAnswer));

  test(sheetTitle('TC-FFAQ-03-05'), async ({ page }) => {
    // "บันทึกได้หรือแจ้งความยาวสูงสุดอย่างชัดเจน ไม่ timeout/Error 500": either is fine.
    requireDataCreatingTestsAllowed(CREATES);
    const stamp = roleStamp();
    const answer = textOfLength(`${AUTO_TEST_FLAG} ${stamp}`, 100_000);
    const started = Date.now();
    await withFaqQ(page, { question: `${AUTO_TEST_FLAG} คำตอบแสนตัว ${stamp}`, answer }, async (_a, saved) => {
      const took = Date.now() - started;
      const card = (await new AdminFaqPage(page).find((c) => c.editQuestion.includes(stamp)))?.card;
      const messages = await faqMessages(page);
      note(`Save ${saved.first} → ${saved.final} in ${took} ms; saved ${card ? `${card.editAnswer.length} characters` : 'no'}; messages "${messages}"`);
      expect(saved.first, 'no server error').toBeLessThan(500);
      expect(saved.final, 'no server error').toBeLessThan(500);
      expect(took, 'no timeout (< 60 s)').toBeLessThan(60_000);
      if (card) expect(card.editAnswer.length, 'saved whole (not cut silently)').toBe(answer.length);
      else expect(messages, 'or refused with a clear length message').toMatch(/ต้องไม่เกิน|ไม่เกิน\s*\d+|ยาวเกิน|ความยาว|\bvalidation\.max/);
    }, (c) => c.editQuestion.includes(stamp));
  });
});

test.describe('SC-FFAQ-02/04 หมวดหมู่ สถานะ และส่วนที่ถูกตัดออก', () => {
  test(sheetTitle('TC-FFAQ-02-13'), async ({ page, browser }) => {
    requireDataCreatingTestsAllowed(CREATES);
    await withFaqCategory(page, `${AUTO_TEST_FLAG} หมวดที่เลือก`, 'publish', async (category) => {
      await withFaqQ(page, { category }, async (answer) => {
        const faq = new AdminFaqPage(page);
        await faq.openEditForm(byAnswer(answer));
        const selected = await faq.categorySelect.evaluate((s: HTMLSelectElement) => s.options[s.selectedIndex]?.textContent?.trim() ?? '');
        await faq.cancelButton.click();
        expect(selected, 'the FAQ is in the chosen category').toBe(category);
        const tabs = await publicCategoryTabs(browser);
        test.fail(!tabs.length, KNOWN.REDESIGNED);
        expect(tabs, 'shown under that category tab publicly').toContain(category);
      });
    });
  });

  test(sheetTitle('TC-FFAQ-02-16'), async ({ page, browser }) => {
    requireDataCreatingTestsAllowed('Saves a hidden FAQ category (deleted again at the end).');
    await withFaqCategory(page, `${AUTO_TEST_FLAG} หมวดซ่อน`, 'hide', async (name) => {
      const faq = new AdminFaqPage(page);
      await faq.open();
      await faq.openAddForm();
      const options = await faq.categoryOptions();
      await faq.cancelButton.click();
      note(`FAQ form options: ${JSON.stringify(options)}`);
      expect(options, 'a hidden category is not offered').not.toContain(name);
      expect((await publicFaq(browser)).text, 'and not shown publicly').not.toContain(name);
    });
  });

  test(sheetTitle('TC-FFAQ-03-01'), async ({ page }) => {
    test.fail(true, KNOWN.REDESIGNED);
    const faq = new AdminFaqPage(page);
    await faq.open();
    await faq.openAddForm();
    const editor = await page.locator('#faqMod .tox-tinymce, #faqMod [role="toolbar"], #faqMod .tox-toolbar').count();
    const tag = await faq.answerInput.evaluate((e) => e.tagName.toLowerCase());
    await faq.cancelButton.click();
    note(`Answer field: <${tag}>, editor toolbars: ${editor}`);
    expect(editor, 'the answer has a formatting toolbar').toBeGreaterThan(0);
  });

  test(sheetTitle('TC-FFAQ-03-03'), async ({ page, browser }) => {
    requireDataCreatingTestsAllowed(CREATES);
    const answer = `${faqMarker()} <script>alert('s')</script><iframe src="https://example.com"></iframe><a href="#" onclick="alert(2)">คลิก</a>`;
    const adminDialogs = collectDialogs(page);
    await withFaqQ(page, { answer }, async () => {
      const context = await browser.newContext({ storageState: ANONYMOUS_SESSION });
      try {
        const visitor = await context.newPage();
        const dialogs = collectDialogs(visitor);
        await visitor.goto(urlOf('/frontend/faq/index'));
        const item = visitor.locator('.accordion-item').filter({ hasText: answer.slice(0, 20) }).first();
        await item.locator('.accordion-button').click();
        await visitor.waitForTimeout(600);
        const live = await item.locator('.accordion-body iframe, .accordion-body script, .accordion-body [onclick]').count();
        await item.locator('.accordion-body a').first().click({ timeout: 2_000 }).catch(() => undefined);
        await visitor.waitForTimeout(500);
        expect(live, 'no iframe / script / onclick in the shown answer').toBe(0);
        expect(dialogs, 'no script runs publicly').toEqual([]);
      } finally {
        await context.close();
      }
      expect(adminDialogs, 'no script runs in the admin').toEqual([]);
    });
  });

  test(sheetTitle('TC-FFAQ-03-04'), async ({ page, browser }) => {
    requireDataCreatingTestsAllowed(CREATES);
    const answer = `${faqMarker()} <a href="javascript:alert(1)">ลิงก์อันตราย</a> javascript:alert(2)`;
    await withFaqQ(page, { answer }, async () => {
      const pub = await publicFaq(browser);
      // A live link only: the answer is HTML-escaped, so its text may still read href="javascript:…".
      expect(pub.html, 'no javascript: link on the page').not.toMatch(/<a\b[^>]*href\s*=\s*["']?\s*javascript:/i);
      expect(pub.dialogs).toEqual([]);
    });
  });

  for (const id of ['TC-FFAQ-04-01', 'TC-FFAQ-04-02', 'TC-FFAQ-04-03', 'TC-FFAQ-04-05']) {
    test(sheetTitle(id), async ({ page }) => {
      test.fail(true, KNOWN.REDESIGNED);
      const faq = new AdminFaqPage(page);
      await faq.open();
      await faq.openAddForm();
      const fields = await page.locator('#faq-form [name]').evaluateAll((els) => els.map((e) => `${(e as HTMLInputElement).type} ${(e as HTMLInputElement).name}`));
      await faq.cancelButton.click();
      note(`FAQ form fields: ${JSON.stringify(fields)}`);
      const wanted = id === 'TC-FFAQ-04-05' ? /reference|อ้างอิง|ref/i : /file/;
      expect(fields.filter((f) => wanted.test(f)), id === 'TC-FFAQ-04-05' ? 'reference fields' : 'a file field').not.toEqual([]);
    });
  }

  test(sheetTitle('TC-FFAQ-04-07'), async ({ page, browser }) => {
    requireDataCreatingTestsAllowed(CREATES);
    const question = `${AUTO_TEST_FLAG} FAQ ซ่อน ${roleStamp()}`;
    await withFaqQ(page, { question, status: 'hide' }, async (answer) => {
      expect((await new AdminFaqPage(page).find(byAnswer(answer)))?.card.status, '"ซ่อน": still in the admin list').toBe('ซ่อน');
      expect((await publicFaq(browser)).questions, '"ซ่อน": not public').not.toContain(question);
      const faq = new AdminFaqPage(page);
      await faq.open();
      await faq.openAddForm();
      const statuses = await page.locator('#faq-form input[type=radio]').evaluateAll((r) => r.map((x) => (x as HTMLInputElement).value));
      await faq.cancelButton.click();
      note(`Statuses offered: ${JSON.stringify(statuses)}`);
      test.fail(!statuses.includes('draft'), KNOWN.REDESIGNED);
      expect(statuses, 'a "ฉบับร่าง" status').toContain('draft');
    });
  });
});

test.describe('SC-FFAQ-05 / SC-ADMF-04 หมวดหมู่ FAQ', () => {
  test(sheetTitle('TC-FFAQ-05-03'), async ({ page, browser }) => {
    requireDataCreatingTestsAllowed('Saves a FAQ category and a FAQ (both deleted again at the end).');
    const groupPage = new AdminGroupPage(page);
    const before = await groupPage.total('faq');
    await withFaqCategory(page, `${AUTO_TEST_FLAG} หมวดใหม่`, 'publish', async (name) => {
      expect(await groupPage.total('faq'), 'the category count grows by 1').toBe(before + 1);
      const faq = new AdminFaqPage(page);
      await faq.open();
      const filter = await page.locator('select[name="category"], select[name="category_id"], #filter-category').first().evaluate((s: HTMLSelectElement) => [...s.options].map((o) => (o.textContent ?? '').trim())).catch(() => [] as string[]);
      await faq.openAddForm();
      const options = await faq.categoryOptions();
      await faq.cancelButton.click();
      expect(options, 'offered in the FAQ form').toContain(name);
      note(`Admin list filter options: ${JSON.stringify(filter)}`);
      if (filter.length) expect(filter, 'and in the admin list filter').toContain(name);
      await withFaqQ(page, { category: name }, async () => {
        const tabs = await publicCategoryTabs(browser);
        test.fail(!tabs.length, KNOWN.REDESIGNED);
        expect(tabs, 'a public tab once it has a FAQ').toContain(name);
      });
    });
  });

  test(sheetTitle('TC-ADMF-04-08'), async ({ page, browser }) => {
    requireDataCreatingTestsAllowed('Saves a FAQ category and a FAQ (both deleted again at the end).');
    await withFaqCategory(page, `${AUTO_TEST_FLAG} หมวดเลือกได้`, 'publish', async (name) => {
      const faq = new AdminFaqPage(page);
      await faq.open();
      await faq.openAddForm();
      expect(await faq.categoryOptions(), 'in the "เลือกหมวดหมู่" dropdown').toContain(name);
      await faq.cancelButton.click();
      await withFaqQ(page, { category: name }, async () => {
        const tabs = await publicCategoryTabs(browser);
        test.fail(!tabs.length, KNOWN.REDESIGNED);
        expect(tabs, 'a public tab when it has a FAQ').toContain(name);
      });
    });
  });

  test(sheetTitle('TC-FFAQ-05-08'), async ({ page }) => {
    requireDataCreatingTestsAllowed('Tries to save a FAQ category with a long name (deleted again if kept).');
    note(`Limit used: ${POLICY_SOURCE}`);
    const groupPage = new AdminGroupPage(page);
    await groupPage.open('faq');
    await groupPage.openAddForm();
    const maxlength = await page.locator('#menuMod [name="name"]').getAttribute('maxlength');
    note(`maxlength: ${maxlength ?? '(none)'}`);
    if (maxlength && Number(maxlength) <= MAX_LENGTH.categoryName) return;
    const name = textOfLength(`${AUTO_TEST_FLAG} ${roleStamp()}`, MAX_LENGTH.categoryName + 1);
    try {
      await groupPage.fill({ name, description: CATEGORY_DESCRIPTION, status: 'publish' });
      const response = await groupPage.save();
      expect(response.status(), 'no server error').toBeLessThan(500);
      await groupPage.open('faq');
      const kept = await groupPage.findCard(name);
      const panel = await page.locator('#menuMod').evaluate((p) => p.scrollWidth - p.clientWidth);
      note(`Saved: ${Boolean(kept)}; panel overflow ${panel}px`);
      expect(panel, 'the panel layout does not break').toBeLessThanOrEqual(1);
      test.fail(Boolean(kept), KNOWN.CATEGORY_UNLIMITED);
      expect(kept, `${MAX_LENGTH.categoryName + 1} characters are not saved`).toBeUndefined();
    } finally {
      note(`Cleanup: deleted ${await deleteFaqCategories(page, name)} categor(ies).`);
    }
  });

  test(sheetTitle('TC-FFAQ-05-09'), async ({ page }) => {
    requireDataCreatingTestsAllowed('Saves a hidden FAQ category (deleted again at the end).');
    await withFaqCategory(page, `${AUTO_TEST_FLAG} หมวดซ่อนไว้`, 'hide', async (name) => {
      const groupPage = new AdminGroupPage(page);
      await groupPage.open('faq');
      const card = await groupPage.findCard(name);
      expect(card?.status, 'badged "ซ่อน" (not saved as "เผยแพร่")').toBe('ซ่อน');
      const attrs = await groupPage.editAttributes(name);
      expect(attrs.status, 'and stored as hide').toBe('hide');
    });
  });

  test(sheetTitle('TC-FFAQ-05-10'), async ({ page }) => {
    requireDataCreatingTestsAllowed('Saves a FAQ category and a FAQ (both deleted again at the end).');
    const groupPage = new AdminGroupPage(page);
    let current = '';
    try {
      current = await createFaqCategory(page, `${AUTO_TEST_FLAG} หมวดก่อนแก้`, 'publish');
      await withFaqQ(page, { category: current }, async (answer) => {
        const before = (await new AdminFaqPage(page).find(byAnswer(answer)))?.card.editCategory;
        const renamed = `${AUTO_TEST_FLAG} หมวดหลังแก้ ${roleStamp()}`;
        await groupPage.open('faq');
        await groupPage.openEditForm(current);
        await groupPage.fill({ name: renamed, status: 'hide' });
        expect((await groupPage.save()).status()).toBeLessThan(400);
        current = renamed;
        await groupPage.open('faq');
        const card = await groupPage.findCard(renamed);
        expect(card, 'the new name is kept').toBeDefined();
        expect(card!.status, 'and the new status').toBe('ซ่อน');
        // A hidden category is not offered in the FAQ form, so compare the FAQ's stored category id.
        const after = (await new AdminFaqPage(page).find(byAnswer(answer)))?.card.editCategory;
        note(`The FAQ's category id: ${before} → ${after}`);
        expect(before, 'it had a category').toBeTruthy();
        expect(after, 'the FAQ is still in that category (same id, now with the new name)').toBe(before);
      });
    } finally {
      if (current) note(`Cleanup: deleted ${await deleteFaqCategories(page, current)} categor(ies).`);
    }
  });
});
