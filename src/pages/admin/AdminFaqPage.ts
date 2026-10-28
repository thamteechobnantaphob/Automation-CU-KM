import { Locator, Page } from '@playwright/test';
import { BasePage } from '../BasePage';
import { DeleteConfirmDialog } from './AdminUserListPage';
import { submitAndFollow, Submitted } from './AdminNewsPages';
import { AUTO_TEST_FLAG } from '@utils/testData';

export type FaqStatus = 'publish' | 'hide';

export interface FaqValues {
  question?: string;
  answer?: string;
  /** Visible text of the category option ("" / undefined = leave it). */
  category?: string;
  status?: FaqStatus;
}

/** One FAQ card of the admin list, as plain data (the pencil carries the stored values). */
export interface FaqCard {
  id: string;
  question: string;
  status: string;
  creator: string;
  created: string;
  editAction: string;
  editQuestion: string;
  editAnswer: string;
  editCategory: string;
  editStatus: string;
  deleteUrl: string;
}

/**
 * /admin/faq/index — "จัดการคำถามที่พบบ่อย (FAQ)" (redesigned before 2026-10-02; the sheet still describes the old
 * /admin/faq/detail page and a "จัดการหมวดหมู่" panel). One `.article-card[data-faq-id]` per FAQ in
 * #faq-sortable-list (drag handle `.card-drag` to reorder): creator, date, status badge, question, and two controls —
 * the pencil `.js-edit-faq` (opens #faqMod with data-action/question/answer/category/status) and delete (shared
 * "ต้องการลบข้อมูล?" dialog). "เพิ่มคำถาม" (#btn-add-faq) opens the same side panel: #faq-form POST /admin/faq
 * (edit: _method=PUT), #faq-category (options from the "คำถามยอดฮิต" tab of /admin/group), #faq-question (required),
 * #faq-answer (textarea), status radios publish/hide. Flash: "เพิ่ม/ลบคำถามยอดฮิตเรียบร้อยแล้ว". Search box name=q.
 * Categories: /admin/group/index?module=faq.
 */
export class AdminFaqPage extends BasePage {
  readonly heading: Locator;
  readonly addButton: Locator;
  readonly list: Locator;
  readonly cards: Locator;
  readonly emptyState: Locator;
  readonly searchInput: Locator;
  readonly flash: Locator;

  readonly panel: Locator;
  readonly panelTitle: Locator;
  readonly form: Locator;
  readonly categorySelect: Locator;
  readonly questionInput: Locator;
  readonly answerInput: Locator;
  readonly saveButton: Locator;
  readonly cancelButton: Locator;

  constructor(page: Page) {
    super(page);
    this.heading = page.locator('.body-content h4', { hasText: 'จัดการคำถามที่พบบ่อย (FAQ)' });
    this.addButton = page.locator('#btn-add-faq');
    this.list = page.locator('#faq-sortable-list');
    this.cards = page.locator('#faq-sortable-list .article-card');
    this.emptyState = page.locator('.body-content').getByText('ยังไม่มีคำถามยอดฮิต');
    this.searchInput = page.locator('.body-content input[name="q"]');
    this.flash = page.locator('.alert');

    this.panel = page.locator('#faqMod');
    this.panelTitle = this.panel.locator('.js-faq-title');
    this.form = page.locator('#faq-form');
    this.categorySelect = page.locator('#faq-category');
    this.questionInput = page.locator('#faq-question');
    this.answerInput = page.locator('#faq-answer');
    this.saveButton = this.form.getByRole('button', { name: 'บันทึก' });
    this.cancelButton = this.panel.getByRole('button', { name: 'ยกเลิก' });
  }

  async open(query = ''): Promise<number> {
    const response = await this.goto(`/admin/faq/index${query}`);
    return response?.status() ?? 0;
  }

  async readCards(): Promise<FaqCard[]> {
    return this.cards.evaluateAll((cards) =>
      cards.map((card) => {
        const text = (selector: string): string => (card.querySelector(selector) as HTMLElement | null)?.textContent?.replace(/\s+/g, ' ').trim() ?? '';
        const edit = card.querySelector('.js-edit-faq');
        const attr = (name: string): string => edit?.getAttribute(name) ?? '';
        return {
          id: card.getAttribute('data-faq-id') ?? '',
          question: text('.title-text'),
          status: text('.status'),
          creator: text('.text-primary'),
          created: text('.text-muted'),
          editAction: attr('data-action'),
          editQuestion: attr('data-question'),
          editAnswer: attr('data-answer'),
          editCategory: attr('data-category'),
          editStatus: attr('data-status'),
          deleteUrl: card.querySelector('[data-delete-url]')?.getAttribute('data-delete-url') ?? '',
        };
      }),
    );
  }

  async find(match: (card: FaqCard) => boolean): Promise<{ index: number; card: FaqCard } | undefined> {
    await this.open();
    const cards = await this.readCards();
    const index = cards.findIndex(match);
    return index >= 0 ? { index, card: cards[index] } : undefined;
  }

  async findByQuestion(question: string): Promise<FaqCard | undefined> {
    return (await this.find((card) => card.question === question.trim()))?.card;
  }

  async total(): Promise<number> {
    await this.open();
    return this.cards.count();
  }

  async openAddForm(): Promise<void> {
    if (!/\/admin\/faq\/index/.test(this.page.url())) await this.open();
    await this.addButton.click();
    await this.questionInput.waitFor({ state: 'visible' });
  }

  async openEditForm(match: (card: FaqCard) => boolean): Promise<FaqCard> {
    const found = await this.find(match);
    if (!found) throw new Error('No such FAQ');
    await this.cards.nth(found.index).locator('.js-edit-faq').click();
    await this.questionInput.waitFor({ state: 'visible' });
    return found.card;
  }

  async categoryOptions(): Promise<string[]> {
    return this.categorySelect.locator('option').evaluateAll((options) => options.map((option) => (option.textContent ?? '').trim()));
  }

  async fill(values: FaqValues): Promise<void> {
    if (values.category !== undefined) {
      await this.categorySelect.evaluate((select: HTMLSelectElement, label) => {
        const option = [...select.options].find((o) => (o.textContent ?? '').trim() === label);
        if (!option) throw new Error(`No category option "${label}"`);
        select.value = option.value;
        select.dispatchEvent(new Event('change', { bubbles: true }));
      }, values.category);
    }
    if (values.question !== undefined) await this.questionInput.fill(values.question);
    if (values.answer !== undefined) await this.answerInput.fill(values.answer);
    // Bootstrap .btn-check radios: the label covers the input.
    if (values.status !== undefined) await this.page.locator(`label[for="faq-status-${values.status}"]`).click();
  }

  /** Presses "บันทึก" (a plain form post that redirects back to the list). */
  async save(): Promise<Submitted> {
    return submitAndFollow(this.page, () => this.saveButton.click());
  }

  /** The delete dialog of the first match; refuses any FAQ whose question and answer both lack "[Auto Test]". */
  async openDeleteDialog(match: (card: FaqCard) => boolean): Promise<DeleteConfirmDialog> {
    const found = await this.find(match);
    if (!found) throw new Error('No such FAQ');
    if (!found.card.question.includes(AUTO_TEST_FLAG) && !found.card.editAnswer.includes(AUTO_TEST_FLAG)) {
      throw new Error(`Refusing to delete FAQ "${found.card.question}": no "${AUTO_TEST_FLAG}" marker`);
    }
    await this.cards.nth(found.index).locator('[data-delete-url]').click();
    const dialog = new DeleteConfirmDialog(this.page);
    await dialog.root.waitFor({ state: 'visible' });
    return dialog;
  }
}
