import { Locator, Page } from '@playwright/test';
import { BasePage } from '../BasePage';
import { DeleteConfirmDialog } from './AdminUserListPage';
import { inputFiles, submitAndFollow, Submitted, UploadFile } from './AdminNewsPages';
import { AUTO_TEST_FLAG } from '@utils/testData';

export type AlbumStatus = 'draft' | 'publish' | 'hide';

export interface AlbumValues {
  title?: string;
  description?: string;
  /** Image files to attach (paths or payloads). */
  images?: UploadFile[];
  status?: AlbumStatus;
}

/** One album card of the admin list, as plain data (the pencil carries the stored values). */
export interface AlbumCard {
  id: string;
  title: string;
  description: string;
  status: string;
  creator: string;
  created: string;
  /** The counters under the card: images, downloads. */
  imageCount: number;
  downloadCount: number;
  cover: string;
  editAction: string;
  editTitle: string;
  editDescription: string;
  editStatus: string;
  editImages: { id: number; url: string; delete_url: string }[];
  deleteUrl: string;
}

/**
 * /admin/activity/index — "คลังกิจกรรม" (checked 2026-10-05). Summary "อัลบัมทั้งหมด n อัลบัม" / "ดาวน์โหลด n ครั้ง",
 * button "เพิ่มอัลบัม" (#btn-add-album) and one card per album in #album-sortable-list ([data-album-id], drag handle
 * .card-drag): creator, date, status badge, cover (/images/image.png when the album has no image), title, description
 * ("—" when empty), image / download counters, the pencil .js-edit-album (data-action/title/description/status/images)
 * and delete (shared "ต้องการลบข้อมูล?" dialog). Counter "แสดง1-n รายการ จาก n รายการ".
 * The side panel #activityMod ("เพิ่มอัลบัม" / "แก้ไขอัลบัม") holds #album-form: multipart POST /admin/activity
 * (edit: _method=PUT to the card's data-action), #album-title (required), #album-description, #album-image-upload
 * (images[], accept png/jpeg, multiple, NOT required; previews in #album-new-images), status radios
 * album-status-draft/publish/hide (default publish). The public list is /frontend/activity/index.
 */
export class AdminActivityPage extends BasePage {
  readonly heading: Locator;
  readonly albumSummary: Locator;
  readonly downloadSummary: Locator;
  readonly addButton: Locator;
  readonly cards: Locator;
  readonly counter: Locator;
  readonly flash: Locator;

  readonly panel: Locator;
  readonly panelTitle: Locator;
  readonly form: Locator;
  readonly titleInput: Locator;
  readonly descriptionInput: Locator;
  readonly imageInput: Locator;
  readonly newImages: Locator;
  readonly existingImages: Locator;
  readonly saveButton: Locator;
  readonly cancelButton: Locator;

  constructor(page: Page) {
    super(page);
    this.heading = page.locator('.body-content h2', { hasText: 'คลังกิจกรรม' });
    this.albumSummary = page.locator('.body-content h5', { hasText: 'อัลบัมทั้งหมด' });
    this.downloadSummary = page.locator('.body-content h5', { hasText: 'ดาวน์โหลด' });
    this.addButton = page.locator('#btn-add-album');
    this.cards = page.locator('#album-sortable-list [data-album-id]');
    this.counter = page.locator('.pagination-box');
    this.flash = page.locator('.alert');

    this.panel = page.locator('#activityMod');
    this.panelTitle = this.panel.locator('.js-album-title');
    this.form = page.locator('#album-form');
    this.titleInput = page.locator('#album-title');
    this.descriptionInput = page.locator('#album-description');
    this.imageInput = page.locator('#album-image-upload');
    this.newImages = page.locator('#album-new-images .file-item');
    this.existingImages = page.locator('#album-existing-images .file-item');
    this.saveButton = this.form.getByRole('button', { name: 'บันทึก' });
    this.cancelButton = this.form.getByRole('button', { name: 'ยกเลิก' });
  }

  async open(query = ''): Promise<number> {
    const response = await this.goto(`/admin/activity/index${query}`);
    return response?.status() ?? 0;
  }

  async readCards(): Promise<AlbumCard[]> {
    return this.cards.evaluateAll((cards) =>
      cards.map((card) => {
        const text = (selector: string): string => (card.querySelector(selector) as HTMLElement | null)?.textContent?.replace(/\s+/g, ' ').trim() ?? '';
        const edit = card.querySelector('.js-edit-album') as HTMLElement | null;
        const counters = [...card.querySelectorAll('.icon-wrap span')].map((s) => Number((s.textContent ?? '').trim()) || 0);
        let images: { id: number; url: string; delete_url: string }[] = [];
        try {
          images = JSON.parse(edit?.dataset.images ?? '[]');
        } catch {
          images = [];
        }
        return {
          id: card.getAttribute('data-album-id') ?? '',
          title: text('.title-text'),
          description: text('.card-text'),
          status: text('.status'),
          creator: text('.text-primary'),
          created: text('.text-small'),
          imageCount: counters[0] ?? 0,
          downloadCount: counters[1] ?? 0,
          cover: card.querySelector('img.card-img-top')?.getAttribute('src') ?? '',
          editAction: edit?.dataset.action ?? '',
          editTitle: edit?.dataset.title ?? '',
          editDescription: edit?.dataset.description ?? '',
          editStatus: edit?.dataset.status ?? '',
          editImages: images,
          deleteUrl: card.querySelector('[data-delete-url]')?.getAttribute('data-delete-url') ?? '',
        };
      }),
    );
  }

  async find(match: (card: AlbumCard) => boolean): Promise<{ index: number; card: AlbumCard } | undefined> {
    await this.open();
    const cards = await this.readCards();
    const index = cards.findIndex(match);
    return index >= 0 ? { index, card: cards[index] } : undefined;
  }

  /** "อัลบัมทั้งหมด n อัลบัม" → n. */
  async albumTotal(): Promise<number> {
    await this.open();
    return Number(/(\d+)/.exec(await this.albumSummary.innerText())?.[1] ?? NaN);
  }

  async openAddForm(): Promise<void> {
    if (!/\/admin\/activity\/index/.test(this.page.url())) await this.open();
    await this.addButton.click();
    await this.titleInput.waitFor({ state: 'visible' });
  }

  async openEditForm(match: (card: AlbumCard) => boolean): Promise<AlbumCard> {
    const found = await this.find(match);
    if (!found) throw new Error('No such album');
    await this.cards.nth(found.index).locator('.js-edit-album').click();
    await this.titleInput.waitFor({ state: 'visible' });
    return found.card;
  }

  async fill(values: AlbumValues): Promise<void> {
    if (values.title !== undefined) await this.titleInput.fill(values.title);
    if (values.description !== undefined) await this.descriptionInput.fill(values.description);
    if (values.images !== undefined) await this.imageInput.setInputFiles(inputFiles(values.images));
    // Bootstrap .btn-check radios: the label covers the input.
    if (values.status !== undefined) await this.page.locator(`label[for="album-status-${values.status}"]`).click();
  }

  /**
   * Removes the existing image at `index` in the open edit panel: the panel asks "ต้องการลบรูปภาพนี้ออกจากอัลบัมหรือไม่?"
   * and deletes it at once (DELETE to the image's delete_url, before "บันทึก"). Returns that request's status.
   */
  async removeExistingImage(index: number): Promise<number> {
    this.page.once('dialog', (dialog) => void dialog.accept());
    const [response] = await Promise.all([
      this.page.waitForResponse((r) => r.request().method() === 'DELETE'),
      this.existingImages.nth(index).locator('.btn-close.file').click(),
    ]);
    return response.status();
  }

  /** Presses "บันทึก" (a plain multipart post that redirects back to the list). */
  async save(): Promise<Submitted> {
    return submitAndFollow(this.page, () => this.saveButton.click());
  }

  /** The delete dialog of the first match; refuses any album whose title and description both lack "[Auto Test]". */
  async openDeleteDialog(match: (card: AlbumCard) => boolean): Promise<DeleteConfirmDialog> {
    const found = await this.find(match);
    if (!found) throw new Error('No such album');
    if (!found.card.editTitle.includes(AUTO_TEST_FLAG) && !found.card.editDescription.includes(AUTO_TEST_FLAG)) {
      throw new Error(`Refusing to delete album "${found.card.title}": no "${AUTO_TEST_FLAG}" marker`);
    }
    await this.cards.nth(found.index).locator('[data-delete-url]').click();
    const dialog = new DeleteConfirmDialog(this.page);
    await dialog.root.waitFor({ state: 'visible' });
    return dialog;
  }
}
