import { test, expect } from '@fixtures/pages.fixtures';
import { requireDataCreatingTestsAllowed } from '@config/env';
import { AdminFaqPage, FaqCard } from '@pages/admin/AdminFaqPage';
import { AdminGroupPage } from '@pages/admin/AdminGroupPage';
import { submitAndFollow } from '@pages/admin/AdminNewsPages';
import { CATEGORY_DESCRIPTION } from '@utils/categoryFlows';
import { createFaqCategory, deleteFaqCategories, deleteFaqWhere, faqMarker, publicFaq, submitFaq, withFaq } from '@utils/faqFlows';
import { urlOf } from '@utils/lowPrivilege';
import { roleStamp } from '@utils/roleFlows';
import { collectDialogs, SQL_ERROR_PATTERN } from '@utils/security';
import { Page } from '@playwright/test';

/**
 * KM-ADMF (FAQ list/add/delete/fields) and KM-FFAQ (the FAQ form and its categories).
 * The FAQ admin was REDESIGNED before 2026-10-02: the list /admin/faq/index has a side panel (#faqMod) instead of
 * the /admin/faq/detail page the sheet describes, the "จัดการหมวดหมู่" panel is gone (FAQ categories are the
 * "คำถามยอดฮิต" tab of /admin/group), and there is no editor/file/video/reference part, no draft status, no category
 * tabs or pagination in the admin list. Cases are run against the new design where it has an equivalent; cases whose
 * subject no longer exists fail on the sheet's expectation as spec mismatches (DEF-64, to SA).
 * Every FAQ / category a case saves is deleted again in a `finally`.
 *
 * NOT implemented ({MAX} undefined, no maxlength — DEF-52): TC-ADMF-03-04/05, 04-02/03, TC-FFAQ-02-04/05, 05-08.
 */

const CREATES = 'Saves a FAQ (deleted again at the end of the case).';
const HTML_PAYLOAD = '<b>bold</b><script>alert(1)</script>';
const SQL_PAYLOAD = "' OR 1=1; DROP TABLE users;--";
const REDESIGNED = 'Spec mismatch (DEF-64): the FAQ admin was redesigned (side panel; categories on /admin/group?module=faq); this part of the sheet no longer exists.';

test.beforeEach(() => test.setTimeout(90_000));

function note(description: string): void {
  test.info().annotations.push({ type: 'note', description });
}

const byAnswer = (answer: string) => (card: FaqCard): boolean => card.editAnswer === answer;

/**
 * The question-field cases the sheet has twice (TC-ADMF-03-xx and TC-FFAQ-02-xx, same values and expectations).
 * Saves the value, checks the admin card and the public page.
 */
async function questionSaved(page: Page, browser: import('@playwright/test').Browser, value: string): Promise<void> {
  await withFaq(page, { question: value }, async (answer) => {
    const card = await new AdminFaqPage(page).find(byAnswer(answer));
    expect(card, 'saved').toBeDefined();
    expect(card!.card.question, 'listed as typed (no &amp;, nothing lost)').toBe(value.trim());
    const pub = await publicFaq(browser);
    expect(pub.dialogs, 'no script runs publicly').toEqual([]);
    expect(pub.questions, 'shown publicly as typed').toContain(value.trim());
  });
}

async function questionHtml(page: Page, browser: import('@playwright/test').Browser): Promise<void> {
  const dialogs = collectDialogs(page);
  await withFaq(page, { question: HTML_PAYLOAD }, async (answer) => {
    const faq = new AdminFaqPage(page);
    expect((await faq.find(byAnswer(answer)))?.card.question, 'literal text in the admin').toBe(HTML_PAYLOAD);
    expect(await faq.cards.locator('.title-text b, .title-text script').count(), 'not rendered as markup').toBe(0);
    const pub = await publicFaq(browser);
    expect(pub.dialogs, 'no script runs publicly').toEqual([]);
    expect(pub.questions, 'literal text publicly').toContain(HTML_PAYLOAD);
  });
  expect(dialogs, 'no script runs in the admin').toEqual([]);
}

async function questionSql(page: Page): Promise<void> {
  const faq = new AdminFaqPage(page);
  const before = await faq.total();
  await withFaq(page, { question: SQL_PAYLOAD }, async (answer) => {
    expect(SQL_ERROR_PATTERN.test(await page.locator('body').innerText()), 'no SQL error').toBe(false);
    const saved = await faq.find(byAnswer(answer));
    note(saved ? `Saved as ${JSON.stringify(saved.card.question)}` : 'Rejected');
    if (saved) expect(saved.card.question).toBe(SQL_PAYLOAD);
    expect(await faq.total(), 'nothing else touched').toBe(before + (saved ? 1 : 0));
  });
}

async function questionTrimmed(page: Page): Promise<void> {
  await withFaq(page, { question: '  ทดสอบ  ' }, async (answer) => {
    const card = (await new AdminFaqPage(page).find(byAnswer(answer)))?.card;
    expect(card, 'saved').toBeDefined();
    note(`Stored question: ${JSON.stringify(card!.editQuestion)}`);
    expect(card!.editQuestion, 'leading/trailing spaces removed').toBe('ทดสอบ');
  });
}

async function questionEmpty(page: Page): Promise<void> {
  const faq = new AdminFaqPage(page);
  const before = await faq.total();
  await faq.openAddForm();
  await expect(faq.questionInput).toHaveAttribute('required', '');
  const answer = faqMarker();
  await faq.fill({ question: '', answer });
  await faq.saveButton.click();
  await expect(faq.questionInput, 'the panel stays open').toBeVisible();
  expect(await faq.questionInput.evaluate((el: HTMLInputElement) => el.validationMessage), 'validation on the question').not.toBe('');
  await expect(faq.answerInput, 'what was typed stays').toHaveValue(answer);
  expect(await faq.total(), 'nothing saved').toBe(before);
}

async function questionSpaces(page: Page): Promise<void> {
  await withFaq(page, { question: '     ' }, async (answer) => {
    const saved = await new AdminFaqPage(page).find(byAnswer(answer));
    note(saved ? `Saved with question ${JSON.stringify(saved.card.question)}` : `Refused: ${(await page.locator('.alert, .invalid-feedback, .text-danger').allInnerTexts()).join(' | ')}`);
    expect(saved, 'five spaces count as empty: nothing is saved').toBeUndefined();
  });
}

test.describe('SC-ADMF-01 รายการ FAQ', () => {
  test('TC-ADMF-01-01 [High] [Positive] แสดงรายการ FAQ และกรองตามหมวดหมู่', async ({ page }) => {
    // The cards show creator/date/status/question only — no category, no view count, and there are no category tabs.
    test.fail(true, REDESIGNED);
    requireDataCreatingTestsAllowed('Saves a FAQ category and a FAQ (deleted again at the end).');
    const faq = new AdminFaqPage(page);
    let category = '';
    try {
      category = await createFaqCategory(page, '[Auto Test] หมวด FAQ');
      await withFaq(page, { question: `[Auto Test] คำถามรายการ ${roleStamp()}`, category }, async (answer) => {
        await faq.open();
        await expect(faq.heading).toBeVisible();
        const card = (await faq.find(byAnswer(answer)))!.card;
        expect(card.creator, 'creator').not.toBe('');
        expect(card.created, 'date').toMatch(/\d{2} \S+ \d{2}/);
        expect(card.status, 'status').toBe('เผยแพร่');
        expect(card.question, 'question').not.toBe('');
        const cardText = (await faq.cards.filter({ hasText: card.question }).innerText()).replace(/\s+/g, ' ');
        note(`Card text: ${cardText}`);
        expect.soft(cardText, 'the card shows the category').toContain(category);
        expect.soft(cardText, 'the card shows a view count').toMatch(/\d+\s*(ครั้ง|views?)|เข้าชม/);
        await expect.soft(page.locator('.body-content').getByText('ทั้งหมด', { exact: true }), 'a "ทั้งหมด" tab').toBeVisible();
        await expect.soft(page.locator('.body-content').getByText(category, { exact: true }), 'a tab per category').toBeVisible();
      });
    } finally {
      if (category) await deleteFaqCategories(page, category);
    }
  });
});

test.describe('SC-ADMF-02 เพิ่ม/ลบ FAQ', () => {
  test('TC-ADMF-02-02 [High] [Negative] เพิ่ม FAQ โดยไม่กรอกคำถามหรือคำตอบ', async ({ page }) => {
    const faq = new AdminFaqPage(page);
    const before = await faq.total();
    await faq.openAddForm();
    await expect(faq.questionInput, 'the question is required').toHaveAttribute('required', '');
    await faq.saveButton.click();
    await expect(faq.questionInput, 'the panel stays open').toBeVisible();
    expect(await faq.questionInput.evaluate((el: HTMLInputElement) => el.validationMessage)).not.toBe('');
    expect(await faq.total(), 'nothing saved').toBe(before);
  });

  test('TC-ADMF-02-04 [Medium] [Positive] ลบ FAQ', async ({ page, browser }) => {
    requireDataCreatingTestsAllowed(CREATES);
    const faq = new AdminFaqPage(page);
    const question = `[Auto Test] คำถามสำหรับทดสอบการลบ ${roleStamp()}`;
    await withFaq(page, { question }, async (answer) => {
      expect((await publicFaq(browser)).questions, 'public before the delete').toContain(question);
      const before = await faq.total();
      const cancel = await faq.openDeleteDialog(byAnswer(answer));
      await cancel.cancel();
      expect(await faq.find(byAnswer(answer)), 'cancel keeps it').toBeDefined();
      const confirm = await faq.openDeleteDialog(byAnswer(answer));
      const result = await submitAndFollow(page, () => confirm.confirm());
      expect(result.final).toBeLessThan(400);
      await expect(faq.flash.filter({ hasText: 'ลบคำถามยอดฮิตเรียบร้อยแล้ว' })).toBeVisible();
      expect(await faq.find(byAnswer(answer)), 'gone from the admin').toBeUndefined();
      expect(await faq.total()).toBe(before - 1);
      expect((await publicFaq(browser)).questions, 'gone from the public page').not.toContain(question);
    });
  });
});

test.describe('SC-ADMF-03 คำถาม', () => {
  for (const [id, label, value] of [
    ['TC-ADMF-03-01 [High]', 'ข้อความภาษาไทยปกติ', 'ระบบจัดการความรู้ทดสอบ'],
    ['TC-ADMF-03-02 [Medium]', 'ภาษาอังกฤษและตัวเลข', 'Test Case 001'],
    ['TC-ADMF-03-03 [Medium]', 'ผสมไทย/อังกฤษ/ตัวเลข/สัญลักษณ์ทั่วไป', 'KM-Day 2569: SHOW & SHARE (รอบ 1)'],
    ['TC-ADMF-03-09 [Low]', 'อีโมจิและ Unicode พิเศษ', 'ทดสอบ 😀 ✓ ①'],
  ] as const) {
    test(`${id} [Positive] คำถาม: ${label}`, async ({ page, browser }) => {
      requireDataCreatingTestsAllowed(CREATES);
      await questionSaved(page, browser, value);
    });
  }
  test('TC-ADMF-03-06 [Low] [Positive] คำถาม: มีช่องว่างหน้า-หลังข้อความ', async ({ page }) => {
    requireDataCreatingTestsAllowed(CREATES);
    await questionTrimmed(page);
  });
  test('TC-ADMF-03-07 [High] [Negative] คำถาม: แท็ก HTML และสคริปต์', async ({ page, browser }) => {
    requireDataCreatingTestsAllowed(CREATES);
    await questionHtml(page, browser);
  });
  test('TC-ADMF-03-08 [High] [Negative] คำถาม: อักขระ SQL', async ({ page }) => {
    requireDataCreatingTestsAllowed(CREATES);
    await questionSql(page);
  });
  test('TC-ADMF-03-10 [High] [Negative] คำถาม: เว้นว่าง', async ({ page }) => {
    await questionEmpty(page);
  });
  test('TC-ADMF-03-11 [Medium] [Negative] คำถาม: ช่องว่างล้วน (เว้นวรรค 5 ตัว)', async ({ page }) => {
    requireDataCreatingTestsAllowed('If the app accepts a blank question it saves a FAQ (deleted again at the end).');
    await questionSpaces(page);
  });
});

test.describe('SC-ADMF-04 คำตอบและหมวดหมู่', () => {
  test('TC-ADMF-04-01 [High] [Positive] คำตอบ: ข้อความภาษาไทยปกติ', async ({ page, browser }) => {
    requireDataCreatingTestsAllowed(CREATES);
    const question = `[Auto Test] คำถามทดสอบคำตอบ ${roleStamp()}`;
    const value = 'ระบบจัดการความรู้ทดสอบ';
    await withFaq(page, { question, answer: value }, async () => {
      expect((await new AdminFaqPage(page).find((c) => c.question === question))?.card.editAnswer, 'stored as typed').toBe(value);
      const pub = await publicFaq(browser);
      expect(pub.answers, 'shown publicly (in the accordion body)').toContain(value);
    }, (card) => card.question === question);
  });

  test('TC-ADMF-04-04 [High] [Negative] คำตอบ: แท็ก HTML และสคริปต์', async ({ page, browser }) => {
    requireDataCreatingTestsAllowed(CREATES);
    const question = `[Auto Test] คำถามทดสอบคำตอบสคริปต์ ${roleStamp()}`;
    const dialogs = collectDialogs(page);
    await withFaq(page, { question, answer: HTML_PAYLOAD }, async () => {
      expect((await new AdminFaqPage(page).find((c) => c.question === question))?.card.editAnswer, 'stored as typed').toBe(HTML_PAYLOAD);
      const pub = await publicFaq(browser);
      expect(pub.dialogs, 'no script runs publicly').toEqual([]);
      expect(pub.answers, 'shown as literal text publicly').toContain(HTML_PAYLOAD);
      expect(pub.html, 'not rendered as markup').not.toContain('<b>bold</b>');
    }, (card) => card.question === question);
    expect(dialogs).toEqual([]);
  });

  for (const [id, label, value] of [
    ['TC-ADMF-04-05 [High]', 'เว้นว่าง', ''],
    ['TC-ADMF-04-06 [Medium]', 'ช่องว่างล้วน (เว้นวรรค 5 ตัว)', '     '],
  ] as const) {
    test(`${id} [Negative] คำตอบ: ${label}`, async ({ page }) => {
      test.fail(true, 'Known bug (DEF-65): a FAQ with an empty / blank answer is saved (and shown publicly with an empty body).');
      requireDataCreatingTestsAllowed('If the app accepts an empty answer it saves a FAQ (deleted again at the end).');
      const question = `[Auto Test] คำถามคำตอบว่าง ${roleStamp()}`;
      const faq = new AdminFaqPage(page);
      await withFaq(page, { question, answer: value }, async () => {
        const saved = await faq.find((c) => c.question === question);
        note(saved ? `Saved with answer ${JSON.stringify(saved.card.editAnswer)}` : 'Refused');
        expect(saved, 'the answer is required: nothing is saved').toBeUndefined();
      }, (card) => card.question === question);
    });
  }

  test('TC-ADMF-04-07 [Medium] [Negative] ไม่เลือกหมวดหมู่', async ({ page }) => {
    requireDataCreatingTestsAllowed(CREATES);
    const faq = new AdminFaqPage(page);
    await faq.openAddForm();
    const required = await faq.categorySelect.evaluate((el: HTMLSelectElement) => el.required);
    expect(await faq.categorySelect.inputValue(), 'default "— ไม่ระบุหมวดหมู่ —"').toBe('');
    await withFaq(page, { question: `[Auto Test] คำถามไม่ระบุหมวด ${roleStamp()}` }, async (answer) => {
      const saved = await faq.find(byAnswer(answer));
      note(`Category required=${required}; ${saved ? 'saved without a category' : 'not saved'}`);
      // "แจ้ง validation ให้เลือกหมวดหมู่ (หากบังคับ)" — the form offers "— ไม่ระบุหมวดหมู่ —", i.e. optional.
      if (required) expect(saved).toBeUndefined();
      else expect(saved, 'optional category: saved without one').toBeDefined();
    });
  });

  test('TC-ADMF-04-10 [Medium] [Negative] หมวดหมู่ FAQ ชื่อซ้ำ', async ({ page }) => {
    test.fail(true, 'Known issue (DEF-36): a category name can be used twice on the same tab (here: คำถามยอดฮิต).');
    requireDataCreatingTestsAllowed('Saves a FAQ category (and, if accepted, its duplicate) — deleted again at the end.');
    await duplicateCategory(page, '');
  });
});

/** Adds a category, then the same name again (+ `suffix`); expects the second to be refused. Cleans up both. */
async function duplicateCategory(page: Page, suffix: string): Promise<void> {
  const groupPage = new AdminGroupPage(page);
  let name = '';
  try {
    name = await createFaqCategory(page, '[Auto Test] หมวดซ้ำ');
    await groupPage.open('faq');
    const before = (await groupPage.readCards()).filter((c) => c.name === name).length;
    await groupPage.openAddForm();
    await groupPage.fill({ name: name + suffix, description: CATEGORY_DESCRIPTION, status: 'publish' });
    const response = await groupPage.save();
    expect(response.status(), 'no server error').toBeLessThan(500);
    await groupPage.open('faq');
    const after = (await groupPage.readCards()).filter((c) => c.name.trim() === name).length;
    note(`"${name}${suffix}": ${after > before ? 'accepted — two categories with the same name' : 'refused'}`);
    expect(after, 'the duplicate name is refused').toBe(before);
  } finally {
    if (name) await deleteFaqCategories(page, name);
  }
}

test.describe('SC-ADMF-05 แบ่งหน้าและพารามิเตอร์', () => {
  test('TC-ADMF-05-01 [Medium] [Positive] แบ่งหน้าครบ (ปุ่ม 1, 2, 3)', async ({ page }) => {
    // The redesigned list is one drag-sortable list: no pagination at all.
    test.fail(true, REDESIGNED);
    const faq = new AdminFaqPage(page);
    await faq.open();
    const pager = page.locator('.body-content .pagination, .body-content nav[aria-label*="agination"]');
    note(`Pagination controls: ${await pager.count()}`);
    await expect(pager, 'page buttons 1, 2, 3').toBeVisible();
  });

  test('TC-ADMF-05-02 [Low] [Negative] ?page นอกช่วงและไม่ใช่ตัวเลข', async ({ page }) => {
    const faq = new AdminFaqPage(page);
    const results: string[] = [];
    for (const value of ['0', '99', 'abc']) {
      const status = await faq.open(`?page=${value}`);
      results.push(`?page=${value} -> ${status}`);
      expect(status).toBeLessThan(500);
      expect(SQL_ERROR_PATTERN.test(await page.locator('body').innerText())).toBe(false);
    }
    note(results.join(' | '));
  });

  test('TC-ADMF-05-03 [Low] [Positive] กรองตามหมวดหมู่แล้วแบ่งหน้าถูกต้อง', async ({ page }) => {
    test.fail(true, REDESIGNED);
    await new AdminFaqPage(page).open();
    await expect(page.locator('.body-content').getByText('การใช้งานทั่วไป', { exact: true }), 'a category tab in the admin list').toBeVisible({ timeout: 5_000 });
  });
});

test.describe('SC-FFAQ-01 ฟอร์มเพิ่ม FAQ', () => {
  test('TC-FFAQ-01-01 [High] [Negative] ฟอร์มเพิ่ม FAQ ต้องไม่มีข้อมูลตัวอย่างค้างอยู่', async ({ page }) => {
    const faq = new AdminFaqPage(page);
    await faq.openAddForm();
    const text = (await faq.panel.innerText()).replace(/\s+/g, ' ');
    note(`Panel: ${text}`);
    for (const sample of ['สร้างโดย', 'แก้ไขล่าสุด', 'ดิเรก', 'report_final']) expect(text, `no sample "${sample}"`).not.toContain(sample);
    await expect(faq.panelTitle).toHaveText('เพิ่มคำถาม');
    await expect(faq.questionInput).toHaveValue('');
    await expect(faq.answerInput).toHaveValue('');
    expect(await faq.categorySelect.inputValue()).toBe('');
  });

  test("TC-FFAQ-01-02 [High] [Negative] ตัวเลือกหมวดหมู่ต้องมาจาก 'จัดการหมวดหมู่คำถาม'", async ({ page }) => {
    requireDataCreatingTestsAllowed('Saves a FAQ category (deleted again at the end).');
    const faq = new AdminFaqPage(page);
    let category = '';
    try {
      category = await createFaqCategory(page, '[Auto Test] หมวด FAQ');
      const groupPage = new AdminGroupPage(page);
      await groupPage.open('faq');
      const managed = (await groupPage.readCards()).map((c) => c.name);
      await faq.open();
      await faq.openAddForm();
      const options = (await faq.categoryOptions()).filter((o) => o && !o.startsWith('—'));
      note(`Managed: ${managed.join(' | ')} — offered: ${options.join(' | ')}`);
      expect(options, 'the managed category is offered').toContain(category);
      for (const sample of ['เทคโนโลยี & IT', 'UI/UX & Design', 'ข่าวสารทั่วไป', 'การตลาด']) expect(options, `no sample "${sample}"`).not.toContain(sample);
      expect(options.every((o) => managed.includes(o)), 'every option is a managed (published) FAQ category').toBe(true);
    } finally {
      if (category) await deleteFaqCategories(page, category);
    }
  });

  test('TC-FFAQ-01-03 [High] [Negative] ช่องของฟอร์มต้องส่งค่าไปเซิร์ฟเวอร์ได้ (มี name)', async ({ page }) => {
    const faq = new AdminFaqPage(page);
    await faq.openAddForm();
    await expect(faq.questionInput).toHaveAttribute('name', 'question');
    await expect(faq.categorySelect).toHaveAttribute('name', 'category_id');
    await expect(faq.answerInput).toHaveAttribute('name', 'answer');
    expect(await faq.form.locator('input[name="status"]').count()).toBe(2);
    await expect(faq.form).toHaveAttribute('action', urlOf('/admin/faq'));
  });

  test('TC-FFAQ-01-04 [High] [Negative] ปุ่มแก้ไขของแต่ละ FAQ ต้องเปิดข้อมูลของรายการนั้น', async ({ page }) => {
    requireDataCreatingTestsAllowed('Saves two FAQs (deleted again at the end).');
    const faq = new AdminFaqPage(page);
    const stamp = roleStamp();
    const answers = [`[Auto Test] คำตอบ ก ${stamp}`, `[Auto Test] คำตอบ ข ${stamp}`];
    try {
      await submitFaq(page, { question: `[Auto Test] คำถาม ก ${stamp}`, answer: answers[0], status: 'publish' });
      await submitFaq(page, { question: `[Auto Test] คำถาม ข ${stamp}`, answer: answers[1], status: 'hide' });
      const actions: string[] = [];
      for (const [n, answer] of answers.entries()) {
        const card = await faq.openEditForm(byAnswer(answer));
        actions.push(card.editAction);
        await expect(faq.panelTitle, 'the edit title').not.toHaveText('เพิ่มคำถาม');
        await expect(faq.questionInput, 'that item\'s question').toHaveValue(`[Auto Test] คำถาม ${n === 0 ? 'ก' : 'ข'} ${stamp}`);
        await expect(faq.answerInput, 'that item\'s answer').toHaveValue(answer);
        await expect(page.locator(`#faq-status-${n === 0 ? 'publish' : 'hide'}`), 'that item\'s status').toBeChecked();
        expect(await faq.form.getAttribute('action'), 'the form posts to that item').toBe(card.editAction);
        await faq.cancelButton.click();
      }
      note(`Edit actions: ${actions.map((a) => a.replace(/.*\/faq\//, '…/')).join(' | ')}`);
      expect(new Set(actions).size, 'each FAQ has its own edit URL (with its id)').toBe(2);
    } finally {
      for (const answer of answers) await deleteFaqWhere(page, byAnswer(answer));
    }
  });

  test('TC-FFAQ-01-05 [Medium] [Positive] เปิดหน้าเพิ่ม FAQ: โครงสร้างฟอร์ม', async ({ page }) => {
    // Now: หมวดหมู่, คำถาม, คำตอบ (textarea), สถานะ เผยแพร่/ซ่อน — no editor, files, video, reference data or draft.
    test.fail(true, REDESIGNED);
    const faq = new AdminFaqPage(page);
    await faq.openAddForm();
    const text = (await faq.panel.innerText()).replace(/\s+/g, ' ');
    note(`Panel: ${text}`);
    for (const part of ['คำถาม', 'หมวดหมู่', 'เผยแพร่', 'ซ่อน', 'ยกเลิก', 'บันทึก']) expect(text, `"${part}"`).toContain(part);
    for (const part of ['เนื้อหาบทความ', 'อัปโหลดไฟล์', 'วิดีโอประกอบ', 'ข้อมูลอ้างอิง', 'แหล่งที่มา', 'ชื่อผู้แต่ง', 'ลิงค์อ้างอิงภายนอก', 'ฉบับร่าง']) {
      expect.soft(text, `the sheet's "${part}"`).toContain(part);
    }
  });
});

test.describe('SC-FFAQ-02 คำถาม (ฟอร์ม)', () => {
  for (const [id, label, value] of [
    ['TC-FFAQ-02-01 [High]', 'ข้อความภาษาไทยปกติ', 'ระบบจัดการความรู้ทดสอบ'],
    ['TC-FFAQ-02-02 [Medium]', 'ภาษาอังกฤษและตัวเลข', 'Test Case 001'],
    ['TC-FFAQ-02-03 [Medium]', 'ผสมไทย/อังกฤษ/ตัวเลข/สัญลักษณ์ทั่วไป', 'KM-Day 2569: SHOW & SHARE (รอบ 1)'],
    ['TC-FFAQ-02-09 [Low]', 'อีโมจิและ Unicode พิเศษ', 'ทดสอบ 😀 ✓ ①'],
  ] as const) {
    test(`${id} [Positive] คำถาม: ${label}`, async ({ page, browser }) => {
      requireDataCreatingTestsAllowed(CREATES);
      await questionSaved(page, browser, value);
    });
  }
  test('TC-FFAQ-02-06 [Low] [Positive] คำถาม: มีช่องว่างหน้า-หลังข้อความ', async ({ page }) => {
    requireDataCreatingTestsAllowed(CREATES);
    await questionTrimmed(page);
  });
  test('TC-FFAQ-02-07 [High] [Negative] คำถาม: แท็ก HTML และสคริปต์', async ({ page, browser }) => {
    requireDataCreatingTestsAllowed(CREATES);
    await questionHtml(page, browser);
  });
  test('TC-FFAQ-02-08 [High] [Negative] คำถาม: อักขระ SQL', async ({ page }) => {
    requireDataCreatingTestsAllowed(CREATES);
    await questionSql(page);
  });
  test('TC-FFAQ-02-10 [High] [Negative] คำถาม: เว้นว่าง', async ({ page }) => {
    // The sheet noted "no required in the browser" for the old page; the new panel has `required` — blocked earlier.
    await questionEmpty(page);
  });
  test('TC-FFAQ-02-11 [Medium] [Negative] คำถาม: ช่องว่างล้วน (เว้นวรรค 5 ตัว)', async ({ page }) => {
    requireDataCreatingTestsAllowed('If the app accepts a blank question it saves a FAQ (deleted again at the end).');
    await questionSpaces(page);
  });
});

test.describe('SC-FFAQ-04 ส่วนอื่นของฟอร์ม', () => {
  test("TC-FFAQ-04-04 [Low] [Positive] แท็บ 'วิดีโอประกอบ'", async ({ page }) => {
    test.fail(true, REDESIGNED);
    const faq = new AdminFaqPage(page);
    await faq.openAddForm();
    await expect(faq.panel.getByText('วิดีโอประกอบ'), 'the video tab').toBeVisible({ timeout: 5_000 });
  });

  test('TC-FFAQ-04-06 [High] [Negative] ลิงค์อ้างอิงภายนอกที่เป็น javascript: หรือไม่ใช่ URL', async ({ page }) => {
    test.fail(true, REDESIGNED);
    const faq = new AdminFaqPage(page);
    await faq.openAddForm();
    await expect(faq.form.locator('input[name="reference_url"]'), 'the reference link field').toHaveCount(1, { timeout: 5_000 });
  });

  test("TC-FFAQ-04-09 [Medium] [Positive] ปุ่ม 'ยกเลิก' กลับหน้ารายการโดยไม่บันทึก", async ({ page }) => {
    const faq = new AdminFaqPage(page);
    const before = await faq.total();
    await faq.openAddForm();
    await faq.fill({ question: `[Auto Test] ไม่ควรถูกบันทึก ${roleStamp()}` });
    await faq.cancelButton.click();
    await expect(faq.panel, 'the panel closes').toBeHidden();
    await expect(page).toHaveURL(urlOf('/admin/faq/index'));
    expect(await faq.total(), 'nothing saved').toBe(before);
  });

  test('TC-FFAQ-04-10 [Medium] [Negative] กดบันทึกซ้ำรัวๆ ไม่สร้าง FAQ ซ้ำ', async ({ page }) => {
    requireDataCreatingTestsAllowed(CREATES);
    const faq = new AdminFaqPage(page);
    const answer = faqMarker();
    try {
      await faq.openAddForm();
      await faq.fill({ question: `[Auto Test] คำถามกดรัว ${roleStamp()}`, answer });
      // The form posts to /admin/faq and redirects back to /admin/faq/index — the page is already on that URL, so wait
      // for the post itself to come back (a URL wait returns at once and the next goto would abort the save).
      const [post] = await Promise.all([
        page.waitForRequest((r) => r.method() === 'POST' && r.isNavigationRequest()),
        page.evaluate(() => {
          const button = document.querySelector<HTMLButtonElement>('#faq-form button[type="submit"]');
          for (let i = 0; i < 5; i++) button?.click();
        }),
      ]);
      await post.response();
      await page.waitForLoadState('load');
      await page.waitForTimeout(1_000); // any further (duplicate) post would have been sent by now
      await faq.open();
      const copies = (await faq.readCards()).filter((card) => card.editAnswer === answer).length;
      note(`${copies} FAQ(s) after 5 rapid clicks`);
      expect(copies, 'only one').toBe(1);
    } finally {
      note(`Cleanup: deleted ${await deleteFaqWhere(page, byAnswer(answer))} FAQ(s).`);
    }
  });
});

test.describe('SC-FFAQ-05 หมวดหมู่คำถาม', () => {
  // The "จัดการหมวดหมู่คำถาม" panel of the sheet is now the "คำถามยอดฮิต" tab of /admin/group (same add panel as
  // every category tab). The cases run there.
  test('TC-FFAQ-05-01 [High] [Positive] เปิดแผงจัดการหมวดหมู่: โครงสร้างและข้อมูลเดิม', async ({ page }) => {
    test.fail(true, REDESIGNED);
    await new AdminFaqPage(page).open();
    await expect(page.locator('.body-content').getByText('จัดการหมวดหมู่', { exact: false }).first(), 'a "จัดการหมวดหมู่" button on the FAQ page').toBeVisible({ timeout: 5_000 });
  });

  test('TC-FFAQ-05-02 [Medium] [Negative] ตัวเลขจำนวนหมวดหมู่ตรงกับรายการที่แสดง', async ({ page }) => {
    const groupPage = new AdminGroupPage(page);
    await groupPage.open('faq');
    const counter = await groupPage.counter();
    const cards = await groupPage.readCards();
    note(`Counter ${JSON.stringify(counter)}; ${cards.length} card(s)`);
    expect(counter, 'the counter line').not.toBeNull();
    expect(counter!.total === 0 ? 0 : counter!.to - counter!.from + 1, 'the count matches the categories shown').toBe(cards.length);
  });

  for (const [id, label, value] of [
    ['TC-FFAQ-05-04 [High]', 'เพิ่มหมวดหมู่โดยเว้นชื่อว่าง', ''],
    ['TC-FFAQ-05-05 [Medium]', 'ชื่อหมวดหมู่เป็นช่องว่างล้วน', '     '],
  ] as const) {
    test(`${id} [Negative] ${label}`, async ({ page }) => {
      requireDataCreatingTestsAllowed('If the app accepts it, saves a FAQ category (deleted again at the end).');
      const groupPage = new AdminGroupPage(page);
      const before = await groupPage.total('faq');
      const marker = faqMarker('หมวดว่าง');
      await groupPage.open('faq');
      await groupPage.openAddForm();
      await groupPage.fill({ name: value, description: marker, status: 'publish' });
      const required = await groupPage.nameInput.evaluate((el: HTMLInputElement) => el.required);
      if (required && value === '') {
        await groupPage.saveButton.click();
        expect(await groupPage.nameInput.evaluate((el: HTMLInputElement) => el.validationMessage), 'the browser blocks it').not.toBe('');
      } else {
        expect((await groupPage.save()).status()).toBeLessThan(500);
      }
      const after = await groupPage.total('faq');
      note(`Name required=${required}; categories ${before} → ${after}`);
      if (after > before) {
        await groupPage.open('faq');
        const created = (await groupPage.readCards()).find((c) => c.description === marker);
        if (created) await deleteFaqCategories(page, created.name);
      }
      expect(after, 'no empty category').toBe(before);
    });
  }

  test('TC-FFAQ-05-06 [Medium] [Negative] ชื่อหมวดหมู่ซ้ำกับที่มี (รวมต่างตัวพิมพ์)', async ({ page }) => {
    test.fail(true, 'Known issue (DEF-36): a category name can be used twice on the same tab (here: คำถามยอดฮิต).');
    requireDataCreatingTestsAllowed('Saves a FAQ category (and, if accepted, its duplicate) — deleted again at the end.');
    // The sheet types the same name and the name + a trailing space.
    await duplicateCategory(page, ' ');
  });

  test('TC-FFAQ-05-07 [High] [Negative] ชื่อหมวดหมู่ที่มี HTML/สคริปต์', async ({ page, browser }) => {
    requireDataCreatingTestsAllowed('Saves a FAQ category and a FAQ in it (deleted again at the end).');
    const dialogs = collectDialogs(page);
    let category = '';
    try {
      category = await createFaqCategory(page, '<script>alert(1)</script>');
      const groupPage = new AdminGroupPage(page);
      await groupPage.open('faq');
      expect((await groupPage.readCards()).map((c) => c.name), 'literal text on the category tab').toContain(category);
      const faq = new AdminFaqPage(page);
      await faq.open();
      await faq.openAddForm();
      expect(await faq.categoryOptions(), 'literal text in the form\'s options').toContain(category);
      await faq.cancelButton.click();
      await withFaq(page, { question: `[Auto Test] คำถามในหมวดสคริปต์ ${roleStamp()}`, category }, async () => {
        const pub = await publicFaq(browser);
        expect(pub.dialogs, 'no script runs publicly').toEqual([]);
        note(pub.text.includes(category) ? 'The public page shows the category as text.' : 'The public page does not show the category name.');
      });
    } finally {
      if (category) await deleteFaqCategories(page, category);
    }
    expect(dialogs, 'no script runs in the admin').toEqual([]);
  });

  test("TC-FFAQ-05-14 [Medium] [Positive] 'ยกเลิก' ปิดแผงโดยไม่บันทึกการเปลี่ยนแปลง", async ({ page }) => {
    const groupPage = new AdminGroupPage(page);
    const before = await groupPage.total('faq');
    await groupPage.open('faq');
    await groupPage.openAddForm();
    await groupPage.fill({ name: `AUTO_FAQ_X ${roleStamp()}` });
    await groupPage.cancelButton.click();
    await expect(groupPage.panel, 'the panel closes').toBeHidden();
    expect(await groupPage.total('faq'), 'no AUTO_FAQ_X').toBe(before);
  });

  test('TC-FFAQ-05-15 [High] [Negative] ส่งคำขอบันทึกหมวดหมู่โดยไม่มี CSRF token', async ({ page }) => {
    const groupPage = new AdminGroupPage(page);
    const before = await groupPage.total('faq');
    const name = `[Auto Test] ไม่มี token ${roleStamp()}`;
    const response = await page.request.post(urlOf('/admin/group'), { form: { module: 'faq', name, description: CATEGORY_DESCRIPTION, status: 'publish' }, maxRedirects: 0 });
    note(`POST /admin/group without _token -> ${response.status()}`);
    expect([403, 419], 'refused').toContain(response.status());
    expect(await groupPage.total('faq'), 'nothing created').toBe(before);
  });
});
