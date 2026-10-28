import { Dialog, Locator, Page } from '@playwright/test';
import { BasePage } from '../BasePage';
import { DeleteConfirmDialog } from './AdminUserListPage';
import { inputFiles, submitAndFollow, Submitted, UploadFile } from './AdminNewsPages';

export type SectionStatus = 'draft' | 'publish' | 'hide';

export interface SlideValues {
  /** A PNG/JPEG to upload (path or payload); the panel uploads it at once and keeps the stored path in #slide-image-path. */
  image?: UploadFile;
  link?: string;
  status?: SectionStatus;
}

export interface UploadResult {
  status: number;
  body: string;
  /** #slide-image-path after the upload ('' when it failed). */
  path: string;
  /** Alerts shown while uploading. */
  alerts: string[];
}

/** One slide card of the "ภาพสไลด์" tab, as plain data (the pencil carries the stored values). */
export interface SlideCard {
  /** data-section-id (numeric). */
  sectionId: string;
  creator: string;
  created: string;
  status: string;
  cover: string;
  editAction: string;
  editLink: string;
  editImage: string;
  editImagePath: string;
  editStatus: string;
  deleteUrl: string;
}

export interface MenuValues {
  title?: string;
  link?: string;
  column?: '1' | '2' | '3';
  fontWeight?: 'bold' | 'normal';
  status?: SectionStatus;
}

/** One footer menu card, as plain data (the pencil carries the stored values). */
export interface MenuCard {
  sectionId: string;
  /** The column list the card sits in ("1".."3"). */
  column: string;
  shownTitle: string;
  shownLink: string;
  status: string;
  editTitle: string;
  editLink: string;
  editColumn: string;
  editFontWeight: string;
  editStatus: string;
  deleteUrl: string;
}

/**
 * /admin/home/index — "หน้าหลัก" (checked 2026-10-05). Two pills: "ภาพสไลด์" (#pills-slide) and "ส่วนท้ายเว็บไซต์"
 * (#pills-footer, the footer menu — KM-FFTR). Slides: "เพิ่มสไลด์" (#btn-add-slide), empty state "ยังไม่มีรายการ
 * ภาพสไลด์", cards in #hero-sortable-list ([data-section-id], drag handle): creator, date, status badge, image, the
 * pencil .js-edit-slide (data-action/id/link/image/image-path/status) and delete (shared "ต้องการลบข้อมูล?" dialog).
 * The side panel #slideMod ("เพิ่มภาพสไลด์" / "แก้ไขภาพสไลด์") holds #slide-form: POST /admin/home-sections, type=hero,
 * hidden image path; the file input #slide-image-upload (png/jpeg, single) uploads at once to /admin/uploads/image
 * (folder home-sections) and disables "บันทึก" until the upload returns; #slide-link "URL ปลายทาง"
 * (placeholder https://www.example.com/); status radios slide-status-draft/publish/hide (default publish).
 * There is NO slide text field and NO footer phone field (the sheet's KM-ADMH-04-01..06 / 06-xx). Saving redirects to
 * ?tab=hero with "เพิ่มรายการเรียบร้อยแล้ว". Public: the home page's .hero-banner-section — an owl carousel
 * (.hero-carousel; clones!) of <a href=link target=_blank rel=noopener><img alt=""></a>, or the static
 * /images/img.png when there is no slide.
 * Footer tab: "จัดการส่วนท้ายเว็บไซต์" / "จัดการลิงก์ที่จะแสดงในส่วนท้ายของหน้าแรก", "เพิ่มเมนู" (#btn-add-menu), three
 * column lists .footer-sortable-list[data-column] of cards ([data-section-id]; title + "(หัวข้อ · ตัวหนา)" /
 * "(ลิงก์ย่อย · ตัวบาง)", link or "— ไม่มีลิงก์ —", pencil .js-edit-menu with data-title/link/column/font-weight/
 * status, delete). Panel #menuMod / #menu-form: POST /admin/home-sections type=footer, #menu-title "ชื่อลิ้งค์" (no
 * required), #menu-link "URL ปลายทาง" ("เว้นว่างได้…"), #menu-column (1..3), font weight bold/normal (default normal),
 * status (default publish). ?tab=footer opens this tab. The public footer is built from these items (bold = heading,
 * normal = link under the heading before it).
 */
export class AdminHomePage extends BasePage {
  readonly heading: Locator;
  readonly slideTab: Locator;
  readonly footerTab: Locator;
  readonly addSlideButton: Locator;
  readonly slideCards: Locator;
  readonly slideEmptyState: Locator;
  readonly flash: Locator;

  readonly slidePanel: Locator;
  readonly slidePanelTitle: Locator;
  readonly slideForm: Locator;
  readonly imageInput: Locator;
  readonly imagePath: Locator;
  readonly preview: Locator;
  readonly linkInput: Locator;
  readonly saveButton: Locator;
  readonly cancelButton: Locator;
  readonly closeButton: Locator;

  readonly footerHeading: Locator;
  readonly addMenuButton: Locator;
  readonly menuEmptyState: Locator;
  readonly menuPanel: Locator;
  readonly menuPanelTitle: Locator;
  readonly menuForm: Locator;
  readonly menuTitleInput: Locator;
  readonly menuLinkInput: Locator;
  readonly menuColumnSelect: Locator;
  readonly menuSaveButton: Locator;
  readonly menuCancelButton: Locator;

  constructor(page: Page) {
    super(page);
    this.heading = page.locator('.body-content h2', { hasText: 'หน้าหลัก' });
    this.slideTab = page.locator('[data-bs-target="#pills-slide"]');
    this.footerTab = page.locator('[data-bs-target="#pills-footer"]');
    this.addSlideButton = page.locator('#btn-add-slide');
    this.slideCards = page.locator('#hero-sortable-list [data-section-id]');
    this.slideEmptyState = page.locator('#pills-slide').getByText('ยังไม่มีรายการภาพสไลด์');
    this.flash = page.locator('.alert');

    this.slidePanel = page.locator('#slideMod');
    this.slidePanelTitle = this.slidePanel.locator('.js-slide-title');
    this.slideForm = page.locator('#slide-form');
    this.imageInput = page.locator('#slide-image-upload');
    this.imagePath = page.locator('#slide-image-path');
    this.preview = page.locator('#slide-file-box-container img');
    this.linkInput = page.locator('#slide-link');
    this.saveButton = this.slideForm.getByRole('button', { name: 'บันทึก' });
    this.cancelButton = this.slideForm.getByRole('button', { name: 'ยกเลิก' });
    this.closeButton = this.slidePanel.locator('.btn-close.text-reset');

    this.footerHeading = page.locator('#pills-footer h3', { hasText: 'จัดการส่วนท้ายเว็บไซต์' });
    this.addMenuButton = page.locator('#btn-add-menu');
    this.menuEmptyState = page.locator('#pills-footer').getByText('ยังไม่มีรายการเมนูส่วนท้ายเว็บไซต์');
    this.menuPanel = page.locator('#menuMod');
    this.menuPanelTitle = this.menuPanel.locator('.js-menu-title');
    this.menuForm = page.locator('#menu-form');
    this.menuTitleInput = page.locator('#menu-title');
    this.menuLinkInput = page.locator('#menu-link');
    this.menuColumnSelect = page.locator('#menu-column');
    this.menuSaveButton = this.menuForm.getByRole('button', { name: 'บันทึก' });
    this.menuCancelButton = this.menuForm.getByRole('button', { name: 'ยกเลิก' });
  }

  async open(query = ''): Promise<number> {
    const response = await this.goto(`/admin/home/index${query}`);
    return response?.status() ?? 0;
  }

  async readSlides(): Promise<SlideCard[]> {
    return this.slideCards.evaluateAll((cards) =>
      cards.map((card) => {
        const edit = card.querySelector('.js-edit-slide') as HTMLElement | null;
        const text = (selector: string): string => (card.querySelector(selector)?.textContent ?? '').replace(/\s+/g, ' ').trim();
        return {
          sectionId: card.getAttribute('data-section-id') ?? '',
          creator: text('.text-primary'),
          created: text('.text-small'),
          status: text('.status'),
          cover: card.querySelector('img.card-img-top')?.getAttribute('src') ?? '',
          editAction: edit?.dataset.action ?? '',
          editLink: edit?.dataset.link ?? '',
          editImage: edit?.dataset.image ?? '',
          editImagePath: edit?.dataset.imagePath ?? '',
          editStatus: edit?.dataset.status ?? '',
          deleteUrl: card.querySelector('[data-delete-url]')?.getAttribute('data-delete-url') ?? '',
        };
      }),
    );
  }

  async slides(): Promise<SlideCard[]> {
    await this.open();
    return this.readSlides();
  }

  async openAddSlide(): Promise<void> {
    if (!/\/admin\/home\/index/.test(this.page.url())) await this.open();
    await this.addSlideButton.click();
    await this.linkInput.waitFor({ state: 'visible' });
  }

  /** Chooses `file` and waits for the panel's own upload; returns the stored path (empty when the upload failed). */
  async uploadImage(file: UploadFile): Promise<string> {
    return (await this.uploadImageResult(file)).path;
  }

  /**
   * Chooses `file` and reports the panel's upload: the HTTP status and body of /admin/uploads/image, the stored path
   * and the alert the panel shows when the upload is refused ("อัปโหลดรูปภาพไม่สำเร็จ กรุณาลองใหม่อีกครั้ง").
   */
  async uploadImageResult(file: UploadFile): Promise<UploadResult> {
    const alerts: string[] = [];
    const onDialog = (dialog: Dialog): void => {
      alerts.push(dialog.message());
      void dialog.accept().catch(() => undefined);
    };
    this.page.on('dialog', onDialog);
    try {
      const [response] = await Promise.all([
        this.page.waitForResponse((r) => r.url().includes('/admin/uploads/image'), { timeout: 90_000 }),
        this.imageInput.setInputFiles(inputFiles([file])),
      ]);
      await this.page.waitForFunction(() => !(document.querySelector('#slide-form button[type="submit"]') as HTMLButtonElement | null)?.disabled);
      await this.page.waitForTimeout(300);
      return { status: response.status(), body: await response.text().catch(() => ''), path: await this.imagePath.inputValue(), alerts };
    } finally {
      this.page.off('dialog', onDialog);
    }
  }

  /** Opens the pencil of the slide with this section id (the panel shows its stored values). */
  async openEditSlide(sectionId: string): Promise<void> {
    await this.open();
    await this.page.locator(`#hero-sortable-list [data-section-id="${sectionId}"] .js-edit-slide`).click();
    await this.linkInput.waitFor({ state: 'visible' });
  }

  /** Fills the open panel; returns the uploaded image path ('' without an image). */
  async fill(values: SlideValues): Promise<string> {
    const path = values.image ? await this.uploadImage(values.image) : '';
    if (values.link !== undefined) await this.linkInput.fill(values.link);
    if (values.status !== undefined) await this.page.locator(`label[for="slide-status-${values.status}"]`).click();
    return path;
  }

  async save(): Promise<Submitted> {
    return submitAndFollow(this.page, () => this.saveButton.click());
  }

  // ---- Footer menu (#pills-footer) ----

  async readMenus(): Promise<MenuCard[]> {
    return this.page.locator('.footer-sortable-list [data-section-id]').evaluateAll((cards) =>
      cards.map((card) => {
        const edit = card.querySelector('.js-edit-menu') as HTMLElement | null;
        const text = (selector: string): string => (card.querySelector(selector)?.textContent ?? '').replace(/\s+/g, ' ').trim();
        // ".my-3.fw-bold" for a heading item, ".my-3.fw-normal" for a link item; the first text node is the title.
        const titleBox = card.querySelector('.card-body > .my-3');
        return {
          sectionId: card.getAttribute('data-section-id') ?? '',
          column: (card.closest('.footer-sortable-list') as HTMLElement | null)?.dataset.column ?? '',
          shownTitle: (titleBox?.childNodes[0]?.textContent ?? '').replace(/\s+/g, ' ').trim(),
          shownLink: text('.card-body .text-break'),
          status: text('.status'),
          editTitle: edit?.dataset.title ?? '',
          editLink: edit?.dataset.link ?? '',
          editColumn: edit?.dataset.column ?? '',
          editFontWeight: edit?.dataset.fontWeight ?? '',
          editStatus: edit?.dataset.status ?? '',
          deleteUrl: card.querySelector('[data-delete-url]')?.getAttribute('data-delete-url') ?? '',
        };
      }),
    );
  }

  async menus(): Promise<MenuCard[]> {
    await this.open('?tab=footer');
    return this.readMenus();
  }

  async openAddMenu(): Promise<void> {
    if (!/\/admin\/home\/index/.test(this.page.url())) await this.open('?tab=footer');
    if (!(await this.addMenuButton.isVisible())) await this.footerTab.click();
    await this.addMenuButton.click();
    await this.menuTitleInput.waitFor({ state: 'visible' });
  }

  async fillMenu(values: MenuValues): Promise<void> {
    if (values.title !== undefined) await this.menuTitleInput.fill(values.title);
    if (values.link !== undefined) await this.menuLinkInput.fill(values.link);
    if (values.column !== undefined) await this.menuColumnSelect.selectOption(values.column);
    if (values.fontWeight !== undefined) await this.page.locator(`label[for="menu-weight-${values.fontWeight}"]`).click();
    if (values.status !== undefined) await this.page.locator(`label[for="menu-status-${values.status}"]`).click();
  }

  /** Opens the pencil of the footer item with this section id (the panel shows its stored values). */
  async openEditMenu(sectionId: string): Promise<void> {
    await this.open('?tab=footer');
    await this.page.locator(`.footer-sortable-list [data-section-id="${sectionId}"] .js-edit-menu`).click();
    await this.menuTitleInput.waitFor({ state: 'visible' });
  }

  async saveMenu(): Promise<Submitted> {
    return submitAndFollow(this.page, () => this.menuSaveButton.click());
  }

  /** The delete dialog of the footer menu item with this section id. */
  async openDeleteMenuDialog(sectionId: string): Promise<DeleteConfirmDialog> {
    await this.open('?tab=footer');
    await this.page.locator(`.footer-sortable-list [data-section-id="${sectionId}"] [data-delete-url]`).click();
    const dialog = new DeleteConfirmDialog(this.page);
    await dialog.root.waitFor({ state: 'visible' });
    return dialog;
  }

  /** The delete dialog of the slide with this section id. */
  async openDeleteDialog(sectionId: string): Promise<DeleteConfirmDialog> {
    await this.open();
    await this.page.locator(`#hero-sortable-list [data-section-id="${sectionId}"] [data-delete-url]`).click();
    const dialog = new DeleteConfirmDialog(this.page);
    await dialog.root.waitFor({ state: 'visible' });
    return dialog;
  }
}
