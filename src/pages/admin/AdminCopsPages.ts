import { Locator, Page, Response } from '@playwright/test';
import { BasePage } from '../BasePage';
import { DeleteConfirmDialog } from './AdminUserListPage';
import { inputFiles, UploadFile } from './AdminNewsPages';
import { AUTO_TEST_FLAG } from '@utils/testData';

export type CopStatus = 'draft' | 'publish' | 'hide';

export const COP_STATUS_LABEL: Record<CopStatus, string> = { draft: 'ฉบับร่าง', publish: 'เผยแพร่', hide: 'ซ่อน' };

/** What to put into the add/edit panel (anything left out keeps the panel's default: empty, icon "fas fa-users", "เผยแพร่"). */
export interface CopFormValues {
  name?: string;
  description?: string;
  icon?: string;
  /** The cover image (path or payload). */
  cover?: UploadFile;
  status?: CopStatus;
}

/** One community card of the admin list, as plain data. */
export interface CopCard {
  name: string;
  description: string;
  status: string;
  creator: string;
  created: string;
  /** "0 ข่าว/บทความ" */
  posts: string;
  image: string;
  postsHref: string;
  hasDelete: boolean;
}

/**
 * /admin/cops/index — communities of practice (checked 2026-10-02). A grid of cards like the category page: each
 * card shows creator, date, status badge, cover, name, description and "n ข่าว/บทความ", plus three buttons: the
 * posts page (/admin/cops/<encrypted id>/posts), the pencil (.js-edit-cop, opens #copMod with data-* values) and
 * delete (the shared "ต้องการลบข้อมูล?" dialog). "เพิ่มชุมชนใหม่" opens the same panel: #cop-form (multipart POST,
 * edit adds _method=PUT) with cover upload, #cop-name (required, no maxlength), #cop-description (no maxlength),
 * #cop-icon (icon picker, default "fas fa-users") and the status radios (default "เผยแพร่").
 */
export class AdminCopsPage extends BasePage {
  readonly pageHeading: Locator;
  readonly listHeading: Locator;
  readonly addButton: Locator;
  readonly cards: Locator;
  readonly emptyState: Locator;

  readonly panel: Locator;
  readonly panelTitle: Locator;
  readonly form: Locator;
  readonly nameInput: Locator;
  readonly descriptionInput: Locator;
  readonly iconInput: Locator;
  readonly coverInput: Locator;
  readonly saveButton: Locator;
  readonly cancelButton: Locator;

  constructor(page: Page) {
    super(page);
    this.pageHeading = page.locator('.body-content h2').first();
    this.listHeading = page.locator('.body-content h4').first();
    this.addButton = page.getByRole('button', { name: 'เพิ่มชุมชนใหม่' });
    this.cards = page.locator('.body-content .card.vertical');
    this.emptyState = page.locator('.body-content').getByText('ยังไม่มีชุมชนนักปฏิบัติ');

    this.panel = page.locator('#copMod');
    this.panelTitle = this.panel.locator('.offcanvas-title, h5').first();
    this.form = page.locator('#cop-form');
    this.nameInput = page.locator('#cop-name');
    this.descriptionInput = page.locator('#cop-description');
    this.iconInput = page.locator('#cop-icon');
    this.coverInput = page.locator('#cop-image-upload');
    this.saveButton = this.form.getByRole('button', { name: 'บันทึก' });
    this.cancelButton = this.form.getByRole('button', { name: 'ยกเลิก' });
  }

  async open(pageNo = 1): Promise<Response | null> {
    const response = await this.goto(`/admin/cops/index${pageNo > 1 ? `?page=${pageNo}` : ''}`);
    await this.listHeading.waitFor({ state: 'visible' });
    return response;
  }

  /** "แสดง1-9 รายการ จาก 12 รายการ" → numbers, or null when the line is absent. */
  async counter(): Promise<{ from: number; to: number; total: number } | null> {
    const match = /แสดง\s*(\d+)\s*-\s*(\d+)\s*รายการ\s*จาก\s*(\d+)\s*รายการ/.exec(await this.page.locator('.body-content').innerText());
    return match ? { from: Number(match[1]), to: Number(match[2]), total: Number(match[3]) } : null;
  }

  /** Communities in total (the counter's "จาก N รายการ"). */
  async total(): Promise<number> {
    await this.open();
    return (await this.counter())?.total ?? (await this.cards.count());
  }

  /** Every card on the current page as plain data. */
  async readCards(): Promise<CopCard[]> {
    return this.cards.evaluateAll((cards) =>
      cards.map((card) => {
        const text = (selector: string): string => (card.querySelector(selector) as HTMLElement | null)?.textContent?.replace(/\s+/g, ' ').trim() ?? '';
        const description = text('.card-body > .text-gray');
        return {
          name: text('.card-body .sub-text'),
          description: description === '—' ? '' : description,
          status: text('.status'),
          creator: text('.text-primary'),
          created: text('.card-wrapper .text-small.text-gray'),
          posts: text('.card-body .text-small.text-gray'),
          image: (card.querySelector('.card-img-top') as HTMLImageElement | null)?.getAttribute('src') ?? '',
          postsHref: (card.querySelector('a[href*="/posts"]') as HTMLAnchorElement | null)?.href ?? '',
          hasDelete: !!card.querySelector('[data-delete-url]'),
        };
      }),
    );
  }

  /** Finds the first card that matches, on any page; leaves that page open. */
  async locate(match: (card: CopCard) => boolean): Promise<{ index: number; card: CopCard } | undefined> {
    for (let pageNo = 1; pageNo <= 50; pageNo++) {
      await this.open(pageNo);
      const cards = await this.readCards();
      const index = cards.findIndex(match);
      if (index >= 0) return { index, card: cards[index] };
      const counter = await this.counter();
      if (!counter || counter.to >= counter.total || cards.length === 0) return undefined;
    }
    return undefined;
  }

  /** Finds a card by its exact (trimmed) name on any page; leaves that page open. */
  async locateCard(name: string): Promise<{ index: number; card: CopCard } | undefined> {
    return this.locate((card) => card.name === name.trim());
  }

  async findCard(name: string): Promise<CopCard | undefined> {
    return (await this.locateCard(name))?.card;
  }

  /** The card whose description is exactly `description` (each test gives its community a unique one). */
  async findByDescription(description: string): Promise<CopCard | undefined> {
    return (await this.locate((card) => card.description === description))?.card;
  }

  async openAddForm(): Promise<void> {
    await this.addButton.click();
    await this.nameInput.waitFor({ state: 'visible' });
  }

  /** The values a card's pencil carries (what the edit panel will show). */
  async editAttributes(name: string): Promise<Record<'name' | 'description' | 'icon' | 'status' | 'image', string | null>> {
    const found = await this.locateCard(name);
    if (!found) throw new Error(`Community "${name}" is not listed`);
    const edit = this.cards.nth(found.index).locator('.js-edit-cop');
    return {
      name: await edit.getAttribute('data-name'),
      description: await edit.getAttribute('data-description'),
      icon: await edit.getAttribute('data-icon'),
      status: await edit.getAttribute('data-status'),
      image: await edit.getAttribute('data-image'),
    };
  }

  statusRadio(status: CopStatus): Locator {
    return this.page.locator(`#cop-status-${status}`);
  }

  async fill(values: CopFormValues): Promise<void> {
    if (values.name !== undefined) await this.nameInput.fill(values.name);
    if (values.description !== undefined) await this.descriptionInput.fill(values.description);
    if (values.icon !== undefined) await this.iconInput.fill(values.icon);
    if (values.cover !== undefined) await this.coverInput.setInputFiles(inputFiles([values.cover]));
    // Bootstrap .btn-check: the label covers the radio, so press the label.
    if (values.status !== undefined) await this.page.locator(`label[for="cop-status-${values.status}"]`).click();
  }

  /** Presses "บันทึก" and returns the response of the form post (the browser follows the redirect). */
  async save(): Promise<Response> {
    const [response] = await Promise.all([
      this.page.waitForResponse((r) => r.request().isNavigationRequest() && r.request().method() === 'POST'),
      this.saveButton.click(),
    ]);
    await this.page.waitForLoadState('load');
    return response;
  }

  /**
   * The delete dialog of a card. Deleting is irreversible, so it refuses any community whose name and description
   * both lack the "[Auto Test]" marker every automation-created community carries (QA's and the seeded
   * AUTO_COPS_001 are never deleted by tests).
   */
  async openDeleteDialog(name: string, by: 'name' | 'description' = 'name'): Promise<DeleteConfirmDialog> {
    const found = by === 'name' ? await this.locateCard(name) : await this.locate((card) => card.description === name);
    if (!found) throw new Error(`Community with ${by} "${name}" is not listed`);
    const { card } = found;
    if (!card.hasDelete) throw new Error(`Community "${card.name}" has no delete button`);
    if (!card.name.includes(AUTO_TEST_FLAG) && !card.description.includes(AUTO_TEST_FLAG)) {
      throw new Error(`Refusing to delete community "${name}": neither its name nor its description carries "${AUTO_TEST_FLAG}"`);
    }
    if (card.name === 'AUTO_COPS_001') throw new Error('Refusing to delete the seeded AUTO_COPS_001');
    await this.cards.nth(found.index).locator('[data-delete-url]').click();
    const dialog = new DeleteConfirmDialog(this.page);
    await dialog.root.waitFor({ state: 'visible' });
    return dialog;
  }
}

/** One article card on a community's posts page. */
export interface CopPostCard {
  title: string;
  excerpt: string;
  status: string;
  creator: string;
  hasDelete: boolean;
}

/**
 * /admin/cops/<encrypted id>/posts — the news/articles of one community: "← ชุมชนนักปฏิบัติทั้งหมด" back link, the
 * community name, "เพิ่มข่าว/บทความ" (→ .../posts/create) and article cards (.article-card, like the news list) or
 * "ยังไม่มีข่าว/บทความในชุมชนนี้". The create form (#post-form, POST .../posts) is the news form: title (required,
 * no maxlength), excerpt, category, tags, TinyMCE body, files, video, source/author/date/link, status + timing, cover.
 */
export class CopPostsPage extends BasePage {
  readonly backLink: Locator;
  readonly addLink: Locator;
  readonly cards: Locator;
  readonly emptyState: Locator;

  readonly form: Locator;
  readonly titleInput: Locator;
  readonly excerptInput: Locator;
  readonly saveButton: Locator;

  constructor(page: Page) {
    super(page);
    this.backLink = page.locator('.body-content a', { hasText: 'ชุมชนนักปฏิบัติทั้งหมด' });
    this.addLink = page.locator('.body-content a', { hasText: 'เพิ่มข่าว/บทความ' });
    this.cards = page.locator('.body-content .article-card');
    this.emptyState = page.locator('.body-content').getByText('ยังไม่มีข่าว/บทความในชุมชนนี้');

    this.form = page.locator('#post-form');
    this.titleInput = this.form.locator('input[name="title"]');
    this.excerptInput = this.form.locator('textarea[name="excerpt"]');
    this.saveButton = this.form.getByRole('button', { name: 'บันทึก' });
  }

  async readCards(): Promise<CopPostCard[]> {
    return this.cards.evaluateAll((cards) =>
      cards.map((card) => {
        const text = (selector: string): string => (card.querySelector(selector) as HTMLElement | null)?.textContent?.replace(/\s+/g, ' ').trim() ?? '';
        return {
          title: text('.title-text'),
          excerpt: text('.content-section > .text-gray'),
          status: text('.status'),
          creator: text('.text-primary'),
          hasDelete: !!card.querySelector('[data-delete-url]'),
        };
      }),
    );
  }

  async openCreate(): Promise<void> {
    await this.addLink.click();
    await this.titleInput.waitFor({ state: 'visible' });
    await this.page.waitForFunction(() => !!(window as unknown as { tinymce?: { get(id: string): unknown } }).tinymce?.get('post-body-input'));
  }

  /** Fills the create form; the body goes into the TinyMCE editor. */
  async fill(values: { title?: string; excerpt?: string; body?: string; status?: CopStatus }): Promise<void> {
    if (values.title !== undefined) await this.titleInput.fill(values.title);
    if (values.excerpt !== undefined) await this.excerptInput.fill(values.excerpt);
    if (values.body !== undefined) {
      await this.page.evaluate((html) => {
        const editor = (window as unknown as { tinymce: { get(id: string): { setContent(v: string): void; save(): void } } }).tinymce.get('post-body-input');
        editor.setContent(html);
        editor.save();
      }, values.body);
    }
    if (values.status !== undefined) await this.page.locator(`label[for="post-status-${values.status}"]`).click();
  }

  async save(): Promise<Response> {
    const [response] = await Promise.all([
      this.page.waitForResponse((r) => r.request().isNavigationRequest() && r.request().method() === 'POST'),
      this.saveButton.click(),
    ]);
    await this.page.waitForLoadState('load');
    return response;
  }

  /** The delete dialog of a post; refuses posts whose title and excerpt both lack "[Auto Test]". */
  async openDeleteDialog(title: string): Promise<DeleteConfirmDialog> {
    const cards = await this.readCards();
    const index = cards.findIndex((card) => card.title === title.trim());
    if (index < 0) throw new Error(`Post "${title}" is not listed`);
    if (!cards[index].title.includes(AUTO_TEST_FLAG) && !cards[index].excerpt.includes(AUTO_TEST_FLAG)) {
      throw new Error(`Refusing to delete post "${title}": no "${AUTO_TEST_FLAG}" marker`);
    }
    await this.cards.nth(index).locator('[data-delete-url]').click();
    const dialog = new DeleteConfirmDialog(this.page);
    await dialog.root.waitFor({ state: 'visible' });
    return dialog;
  }
}
