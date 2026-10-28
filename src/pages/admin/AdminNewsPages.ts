import fs from 'fs';
import os from 'os';
import path from 'path';
import { Locator, Page, Request } from '@playwright/test';
import { BasePage } from '../BasePage';
import { DeleteConfirmDialog } from './AdminUserListPage';
import { AUTO_TEST_FLAG } from '@utils/testData';
import type { GroupTabKey } from './AdminGroupPage';

/**
 * The content modules that share one admin list + form (#content-module-form): news, knowledge, best practice.
 * Everything that differs between them is here; the page objects take one of these (default: news).
 */
export interface ContentModule {
  /** Path segment: /admin/<key>/index, /admin/<key>/create. */
  key: 'news' | 'knowledge' | 'bestpractice';
  listHeading: string;
  backLink: string;
  publicIndex: string;
  publicDetail: string;
  categoryTab: GroupTabKey;
  /** Flash after a create / a delete, and the list's empty state. */
  createdFlash: string;
  deletedFlash: string;
  emptyState: string;
}

export const NEWS_MODULE: ContentModule = {
  key: 'news',
  listHeading: 'รายการข่าวกิจกรรม KM',
  backLink: 'กลับไปที่รายการข่าวกิจกรรม KM',
  publicIndex: '/frontend/news/index',
  publicDetail: '/frontend/news/detail/',
  categoryTab: 'cms',
  createdFlash: 'เพิ่มข่าวกิจกรรมเรียบร้อยแล้ว',
  deletedFlash: 'ลบข่าวกิจกรรมเรียบร้อยแล้ว',
  emptyState: 'ยังไม่มีข่าวกิจกรรม',
};

/** /admin/bestpractice — "แนวทางปฎิบัติที่ดี (Best Practice)" (checked 2026-10-02; same list/search/form as knowledge). */
export const BEST_PRACTICE_MODULE: ContentModule = {
  key: 'bestpractice',
  listHeading: 'รายการแนวทางปฏิบัติที่ดี',
  backLink: 'กลับไปที่รายการแนวทางปฏิบัติที่ดี',
  publicIndex: '/frontend/bestpractice/index',
  publicDetail: '/frontend/bestpractice/detail/',
  categoryTab: 'best_practice',
  createdFlash: 'เพิ่มแนวทางปฏิบัติที่ดีเรียบร้อยแล้ว',
  deletedFlash: 'ลบแนวทางปฏิบัติที่ดีเรียบร้อยแล้ว',
  emptyState: 'ยังไม่มีแนวทางปฏิบัติที่ดี',
};

/** /admin/knowledge — "จัดการบทความ/คลังความรู้" (checked 2026-10-02; list search box name=q, GET ?q=). */
export const KNOWLEDGE_MODULE: ContentModule = {
  key: 'knowledge',
  listHeading: 'รายการบทความ/คลังความรู้',
  backLink: 'กลับไปที่รายการบทความ/คลังความรู้',
  publicIndex: '/frontend/knowledge/index',
  publicDetail: '/frontend/knowledge/detail/',
  categoryTab: 'knowledge',
  createdFlash: 'เพิ่มบทความเรียบร้อยแล้ว',
  deletedFlash: 'ลบบทความเรียบร้อยแล้ว',
  emptyState: 'ยังไม่มีบทความ/คลังความรู้',
};

export type NewsStatus = 'draft' | 'publish' | 'hide';

/** What to put into the news form (anything left out keeps the form's default). */
export interface NewsFormValues {
  title?: string;
  excerpt?: string;
  /** Visible text of the category option. */
  category?: string;
  /** Typed into the tag box one by one, each followed by Enter. */
  tags?: string[];
  /** HTML for the TinyMCE editor. */
  body?: string;
  videoUrl?: string;
  source?: string;
  authorName?: string;
  /** yyyy-mm-dd for <input type=date name=reference_date>; "" clears it. */
  referenceDate?: string;
  referenceUrl?: string;
  status?: NewsStatus;
  timing?: 'now' | 'schedule';
  publishedAt?: string;
  /** Files for "ไฟล์เอกสาร" (documents[], tab "อัปโหลดไฟล์"): paths or payloads. */
  documents?: UploadFile[];
  /** Files for "อัปโหลดไฟล์วิดีโอ" (video_file[], tab "วิดีโอประกอบ"). */
  videoFiles?: UploadFile[];
  /** "รูปภาพหน้าปกบทความ" (cover_image). */
  cover?: UploadFile;
}

/** A path on disk or an in-memory file. */
export type UploadFile = string | { name: string; mimeType: string; buffer: Buffer };

/** A validation message inside the form, and whether the user can see it (a message in a hidden tab is not seen). */
export interface FormMessage {
  text: string;
  visible: boolean;
}

/** A file already saved with the item, as the edit form lists it. */
export interface SavedFile {
  /** Display name (editable, input attachment_names[id]). */
  name: string;
  /** "ชื่อไฟล์เดิม: x.pdf | 0 KB" → "x.pdf". */
  original: string;
  size: string;
  /** Links have no file: their URL. */
  url: string;
  deleteUrl: string;
}

/** One card of the admin news list, as plain data. */
export interface NewsCard {
  title: string;
  excerpt: string;
  status: string;
  creator: string;
  created: string;
  editHref: string;
  previewHref: string;
  hasDelete: boolean;
  /** The card's cover image URL (/images/image.png when there is none). */
  cover: string;
  /** The two counters under the excerpt: [gallery icon, download icon]. */
  counters: number[];
}

/** Result of a form post that the browser follows: the first status (302 on success) and the final one. */
export interface Submitted {
  first: number;
  final: number;
  url: string;
}

/** Clicks `submit` and follows the form post through its redirects (waitForResponse misses the 302 here). */
export async function submitAndFollow(page: Page, submit: () => Promise<void>): Promise<Submitted> {
  const [request] = await Promise.all([
    page.waitForRequest((r) => r.method() === 'POST' && r.isNavigationRequest()),
    submit(),
  ]);
  await page.waitForLoadState('load');
  let current: Request = request;
  const first = (await current.response())?.status() ?? 0;
  let final = first;
  while (current.redirectedTo()) {
    current = current.redirectedTo() as Request;
    final = (await current.response())?.status() ?? final;
  }
  return { first, final, url: page.url() };
}

/**
 * /admin/news/index — "ข่าวสารกิจกรรม KM" (checked 2026-10-02). Heading "รายการข่าวกิจกรรม KM", link "เพิ่มบทความ"
 * (/admin/news/create) and one `.article-card` per item: creator, date, status badge, cover, title, excerpt, counters
 * (images / downloads), and three buttons — preview (/admin/news/<encrypted id>/preview, new tab), edit
 * (/admin/news/<id>/edit) and delete (the shared "ต้องการลบข้อมูล?" dialog, POST _method=DELETE, flash
 * "ลบข่าวกิจกรรมเรียบร้อยแล้ว"). Counter "แสดงx-y รายการ จาก n รายการ".
 */
export class AdminNewsListPage extends BasePage {
  readonly module: ContentModule;
  readonly listHeading: Locator;
  readonly addLink: Locator;
  readonly cards: Locator;
  readonly flash: Locator;
  readonly searchInput: Locator;
  readonly emptyState: Locator;

  constructor(page: Page, module: ContentModule = NEWS_MODULE) {
    super(page);
    this.module = module;
    this.listHeading = page.locator('.body-content').getByText(module.listHeading, { exact: true });
    this.addLink = page.locator('.body-content a', { hasText: 'เพิ่มบทความ' });
    this.cards = page.locator('.body-content .article-card');
    this.flash = page.locator('.alert');
    this.searchInput = page.locator('.body-content input[name="q"]');
    this.emptyState = page.locator('.body-content').getByText(module.emptyState);
  }

  /** Types into the list's search box and presses Enter (GET ?q=). */
  async search(term: string): Promise<void> {
    await this.searchInput.fill(term);
    await Promise.all([this.page.waitForURL(/[?&]q=/), this.searchInput.press('Enter')]);
    await this.page.waitForLoadState('load');
  }

  async open(query = ''): Promise<number> {
    const response = await this.goto(`/admin/${this.module.key}/index${query}`);
    return response?.status() ?? 0;
  }

  async counter(): Promise<{ from: number; to: number; total: number } | null> {
    const match = /แสดง\s*(\d+)\s*-\s*(\d+)\s*รายการ\s*จาก\s*(\d+)\s*รายการ/.exec(await this.page.locator('.body-content').innerText());
    return match ? { from: Number(match[1]), to: Number(match[2]), total: Number(match[3]) } : null;
  }

  async total(): Promise<number> {
    await this.open();
    return (await this.counter())?.total ?? (await this.cards.count());
  }

  async readCards(): Promise<NewsCard[]> {
    return this.cards.evaluateAll((cards) =>
      cards.map((card) => {
        const text = (selector: string): string => (card.querySelector(selector) as HTMLElement | null)?.textContent?.replace(/\s+/g, ' ').trim() ?? '';
        return {
          title: text('.title-text'),
          excerpt: text('.content-section > .text-gray'),
          status: text('.status'),
          creator: text('.text-primary'),
          created: text('.text-muted'),
          editHref: (card.querySelector('a[href$="/edit"]') as HTMLAnchorElement | null)?.href ?? '',
          previewHref: (card.querySelector('a[href$="/preview"]') as HTMLAnchorElement | null)?.href ?? '',
          hasDelete: !!card.querySelector('[data-delete-url]'),
          cover: (card.querySelector('.image-container img') as HTMLImageElement | null)?.src ?? '',
          counters: [...card.querySelectorAll('.icon-wrap span')].map((span) => Number((span.textContent ?? '').replace(/[^\d]/g, '')) || 0),
        };
      }),
    );
  }

  /** The first card that matches, on any page; leaves that page open. */
  async locate(match: (card: NewsCard) => boolean): Promise<{ index: number; card: NewsCard } | undefined> {
    for (let pageNo = 1; pageNo <= 50; pageNo++) {
      await this.open(pageNo > 1 ? `?page=${pageNo}` : '');
      const cards = await this.readCards();
      const index = cards.findIndex(match);
      if (index >= 0) return { index, card: cards[index] };
      const counter = await this.counter();
      if (!counter || counter.to >= counter.total || cards.length === 0) return undefined;
    }
    return undefined;
  }

  async findByExcerpt(excerpt: string): Promise<NewsCard | undefined> {
    return (await this.locate((card) => card.excerpt === excerpt))?.card;
  }

  /**
   * Opens the delete dialog of the first matching item. Deleting is irreversible, so it refuses any item whose title
   * and excerpt both lack "[Auto Test]" (the seeded AUTO_NEWS_001 and QA's own items are never touched).
   */
  async openDeleteDialogWhere(match: (card: NewsCard) => boolean): Promise<DeleteConfirmDialog> {
    const found = await this.locate(match);
    if (!found) throw new Error('No such news item is listed');
    if (!found.card.title.includes(AUTO_TEST_FLAG) && !found.card.excerpt.includes(AUTO_TEST_FLAG)) {
      throw new Error(`Refusing to delete news "${found.card.title}": no "${AUTO_TEST_FLAG}" marker`);
    }
    await this.cards.nth(found.index).locator('[data-delete-url]').click();
    const dialog = new DeleteConfirmDialog(this.page);
    await dialog.root.waitFor({ state: 'visible' });
    return dialog;
  }

  async openDeleteDialog(excerpt: string): Promise<DeleteConfirmDialog> {
    return this.openDeleteDialogWhere((card) => card.excerpt === excerpt);
  }
}

/**
 * /admin/news/create and /admin/news/<encrypted id>/edit — `#content-module-form` (POST /admin/news, multipart;
 * edit adds _method=PUT). The same field set as knowledge and best practice: title (required, no maxlength), excerpt
 * (no maxlength), category_id (bootstrap-select over #content-module-category, default "— ไม่ระบุ —"), the tag box
 * (#tag-input + chips in #tag-chips, new tags go in hidden new_tags), TinyMCE body (#content-module-body-input,
 * status bar "0 words"), tabs "อัปโหลดไฟล์"/"วิดีโอประกอบ", reference fields, status radios (Bootstrap .btn-check, the
 * label covers the input → click the label), publish timing (ทันที / กำหนดวันและเวลา → #publish-datetime-input)
 * and the cover image. Flash after create: "เพิ่มข่าวกิจกรรมเรียบร้อยแล้ว".
 */
export class NewsFormPage extends BasePage {
  readonly module: ContentModule;
  readonly form: Locator;
  readonly backLink: Locator;
  readonly titleInput: Locator;
  readonly excerptInput: Locator;
  readonly categorySelect: Locator;
  readonly tagInput: Locator;
  readonly tagChips: Locator;
  readonly wordCount: Locator;
  readonly videoUrlInput: Locator;
  readonly referenceUrlInput: Locator;
  readonly publishedAtInput: Locator;
  readonly cancelLink: Locator;
  readonly saveButton: Locator;

  constructor(page: Page, module: ContentModule = NEWS_MODULE) {
    super(page);
    this.module = module;
    this.form = page.locator('#content-module-form');
    this.backLink = page.locator('.body-content a', { hasText: module.backLink });
    this.titleInput = this.form.locator('input[name="title"]');
    this.excerptInput = this.form.locator('textarea[name="excerpt"]');
    this.categorySelect = page.locator('#content-module-category');
    this.tagInput = page.locator('#tag-input');
    this.tagChips = page.locator('#tag-chips > *');
    this.wordCount = page.locator('.tox-statusbar__wordcount, .tox-statusbar').filter({ hasText: /words?/ }).first();
    this.videoUrlInput = page.locator('#video-url-input');
    this.referenceUrlInput = this.form.locator('input[name="reference_url"]');
    this.publishedAtInput = page.locator('#publish-datetime-input');
    this.cancelLink = this.form.locator('a', { hasText: 'ยกเลิก' });
    this.saveButton = this.form.getByRole('button', { name: 'บันทึก' });
  }

  async openCreate(): Promise<void> {
    await this.goto(`/admin/${this.module.key}/create`);
    await this.waitForEditor();
  }

  async openEdit(href: string): Promise<void> {
    await this.page.goto(href);
    await this.waitForEditor();
  }

  async waitForEditor(): Promise<void> {
    await this.titleInput.waitFor({ state: 'visible' });
    await this.page.waitForFunction(() => !!(window as unknown as { tinymce?: { get(id: string): unknown } }).tinymce?.get('content-module-body-input'));
  }

  statusRadio(status: NewsStatus): Locator {
    return this.page.locator(`#content-module-status-${status}`);
  }

  /** Visible texts of the category options (the first is "— ไม่ระบุ —"). */
  async categoryOptions(): Promise<string[]> {
    return this.categorySelect.locator('option').evaluateAll((options) => options.map((option) => (option.textContent ?? '').trim()));
  }

  /** The category value that would be posted ("" = no category). */
  async categoryValue(): Promise<string> {
    return this.categorySelect.inputValue();
  }

  /** What the category picker SHOWS (bootstrap-select's button; "เลือกหมวดหมู่" when nothing is chosen). */
  async selectedCategory(): Promise<string> {
    const shown = this.page.locator('.bootstrap-select').filter({ has: this.categorySelect }).locator('.filter-option-inner-inner');
    if (await shown.count()) return (await shown.innerText()).trim();
    return this.categorySelect.evaluate((select: HTMLSelectElement) => (select.selectedOptions[0]?.textContent ?? '').trim());
  }

  /** Tag chips as text; a tag new to the system carries the badge "(ใหม่)", which is dropped here. */
  async tagTexts(): Promise<string[]> {
    return this.tagChips.evaluateAll((chips) =>
      chips.map((chip) => (chip.textContent ?? '').replace(/×/g, '').replace(/\(ใหม่\)\s*$/, '').replace(/\s+/g, ' ').trim()).filter(Boolean),
    );
  }

  async addTag(tag: string): Promise<void> {
    await this.tagInput.fill(tag);
    await this.tagInput.press('Enter');
  }

  async bodyText(): Promise<string> {
    return this.page.evaluate(() => (window as unknown as { tinymce: { get(id: string): { getContent(o: object): string } } }).tinymce.get('content-module-body-input').getContent({ format: 'text' }));
  }

  async setBody(html: string): Promise<void> {
    await this.page.evaluate((value) => {
      const editor = (window as unknown as { tinymce: { get(id: string): { setContent(v: string): void; save(): void } } }).tinymce.get('content-module-body-input');
      editor.setContent(value);
      editor.save();
    }, html);
  }

  async fill(values: NewsFormValues): Promise<void> {
    if (values.title !== undefined) await this.titleInput.fill(values.title);
    if (values.excerpt !== undefined) await this.excerptInput.fill(values.excerpt);
    if (values.category !== undefined) {
      // The native select sits behind bootstrap-select; set it and let both know.
      await this.categorySelect.evaluate((select: HTMLSelectElement, label) => {
        const option = [...select.options].find((o) => (o.textContent ?? '').trim() === label);
        if (!option) throw new Error(`No category option "${label}"`);
        select.value = option.value;
        select.dispatchEvent(new Event('change', { bubbles: true }));
        const jq = (window as unknown as { $?: (el: Element) => { selectpicker?: (cmd: string) => void } }).$;
        jq?.(select).selectpicker?.('refresh');
      }, values.category);
    }
    for (const tag of values.tags ?? []) await this.addTag(tag);
    if (values.body !== undefined) await this.setBody(values.body);
    if (values.videoUrl !== undefined) {
      await this.page.locator('#tab-video-btn').click();
      await this.videoUrlInput.fill(values.videoUrl);
    }
    if (values.source !== undefined) await this.form.locator('input[name="source"]').fill(values.source);
    if (values.authorName !== undefined) await this.form.locator('input[name="author_name"]').fill(values.authorName);
    if (values.referenceDate !== undefined) await this.form.locator('input[name="reference_date"]').fill(values.referenceDate);
    if (values.referenceUrl !== undefined) await this.referenceUrlInput.fill(values.referenceUrl);
    // Bootstrap .btn-check radios: the label covers the input, so press the label.
    if (values.status !== undefined) await this.page.locator(`label[for="content-module-status-${values.status}"]`).click();
    if (values.timing !== undefined) await this.page.locator(`label[for="publish-timing-${values.timing}"]`).click();
    if (values.publishedAt !== undefined) await this.publishedAtInput.fill(values.publishedAt);
    if (values.documents !== undefined) await this.attachDocuments(values.documents);
    if (values.videoFiles !== undefined) await this.attachVideos(values.videoFiles);
    if (values.cover !== undefined) await this.setCover(values.cover);
  }

  /** Chooses files for "ไฟล์เอกสาร" (tab "อัปโหลดไฟล์", the tab open by default). */
  async attachDocuments(files: UploadFile[]): Promise<void> {
    await this.page.locator('#tab-doc-btn, [data-bs-target="#tab-doc"]').first().click().catch(() => undefined);
    await this.page.locator('#document-upload').setInputFiles(inputFiles(files));
  }

  /** Chooses files for "อัปโหลดไฟล์วิดีโอ" (tab "วิดีโอประกอบ"). */
  async attachVideos(files: UploadFile[]): Promise<void> {
    await this.page.locator('#tab-video-btn').click();
    await this.page.locator('#video-file-input').setInputFiles(inputFiles(files));
  }

  async setCover(file: UploadFile): Promise<void> {
    await this.page.locator('#cover-image-upload').setInputFiles(file);
  }

  /** Presses the × on the cover box (sets remove_cover_image=1). */
  async removeCover(): Promise<void> {
    await this.page.locator('#cover-file-box-container .btn-close').click();
  }

  /** The cover shown in the form ("" when none). */
  async coverSrc(): Promise<string> {
    const img = this.page.locator('#cover-file-box-container img');
    return (await img.count()) ? ((await img.first().getAttribute('src')) ?? '') : '';
  }

  /** Names listed for files chosen but not yet saved ("ชื่อไฟล์เดิม: x | size"), per list. */
  async pendingFiles(list: 'documents' | 'videos'): Promise<string[]> {
    const id = list === 'documents' ? '#new-files-list' : '#new-video-files-list';
    return this.page.locator(`${id} .text-xsmall`).evaluateAll((els) => els.map((e) => (e.textContent ?? '').replace(/\s+/g, ' ').trim()));
  }

  /**
   * Files and video links already saved with the item (edit form): the documents of tab "อัปโหลดไฟล์" and the
   * "วิดีโอที่บันทึกไว้แล้ว" list of tab "วิดีโอประกอบ".
   */
  async savedFiles(list: 'documents' | 'videos'): Promise<SavedFile[]> {
    const pane = list === 'documents' ? '#tab-doc' : '#tab-video';
    return this.page.locator(`${pane} .file-item`).evaluateAll((items) =>
      items
        .filter((item) => !item.closest('#new-files-list, #new-video-files-list'))
        .map((item) => {
          const info = (item.querySelector('.text-xsmall, span:not(.icon-wrapper)')?.textContent ?? '').replace(/\s+/g, ' ').trim();
          const match = /ชื่อไฟล์เดิม:\s*(.+?)\s*\|\s*(.+)$/.exec(info);
          return {
            name: (item.querySelector('input[name^="attachment_names"]') as HTMLInputElement | null)?.value ?? '',
            original: match?.[1] ?? '',
            size: match?.[2] ?? '',
            url: match ? '' : (item.querySelector('.fw-bold')?.textContent ?? '').trim(),
            deleteUrl: item.querySelector('[data-delete-url]')?.getAttribute('data-delete-url') ?? '',
          };
        }),
    );
  }

  /**
   * Validation messages inside the form (red .text-xsmall lines: "รองรับเฉพาะไฟล์…", "กรุณา…", raw keys) and whether
   * each can be seen — a message inside the closed "วิดีโอประกอบ" tab is in the page but not visible.
   */
  async messages(): Promise<FormMessage[]> {
    // The form may still be coming back from the native re-post: wait for it, and read again if a navigation won.
    await this.page.waitForLoadState('load');
    try {
      return await this.readMessages();
    } catch {
      await this.page.waitForLoadState('load');
      await this.form.waitFor({ state: 'attached', timeout: 15_000 }).catch(() => undefined);
      return this.readMessages();
    }
  }

  private async readMessages(): Promise<FormMessage[]> {
    return this.form.locator('*').evaluateAll((els) =>
      els
        .filter((e) => !e.children.length && /รองรับเฉพาะ|กรุณา|ต้องไม่เกิน|ต้องมีขนาด|ไม่ถูกต้อง|ไม่สามารถ|\bvalidation\.[a-z_.]+/i.test(e.textContent ?? ''))
        .filter((e) => !/^(รองรับไฟล์|ขนาดที่แนะนำ)/.test((e.textContent ?? '').trim()))
        .map((e) => ({ text: (e.textContent ?? '').replace(/\s+/g, ' ').trim(), visible: (e as HTMLElement).offsetParent !== null && getComputedStyle(e).visibility !== 'hidden' })),
    );
  }

  /**
   * Presses "บันทึก". The form's own script intercepts the submit (checked 2026-10-02): it opens a preview tab,
   * sends the form with fetch (Accept: application/json, redirect: manual) and, on `{preview, redirect}`, navigates
   * to the list; on any other answer it falls back to a normal submit (navigation POST → redirect, e.g. back to the
   * form with errors). `first` = the fetch status, `final` = where the browser ended up. The preview tab is closed.
   */
  async save(): Promise<Submitted> {
    const action = (await this.form.getAttribute('action')) as string;
    const formUrl = this.page.url();
    const popups: Page[] = [];
    const onPage = (opened: Page): void => {
      popups.push(opened);
    };
    this.page.context().on('page', onPage);
    try {
      // The fallback post redirects (e.g. back to the form); the final document's "load" marks the end of it.
      const fallback = this.page
        .waitForRequest((r) => r.method() === 'POST' && r.isNavigationRequest(), { timeout: 20_000 })
        .then(async (request) => {
          await this.page.waitForEvent('load', { timeout: 20_000 });
          return request;
        })
        .catch(() => undefined);
      const [request] = await Promise.all([
        this.page.waitForRequest((r) => r.method() === 'POST' && r.url() === action && !r.isNavigationRequest()),
        this.saveButton.click(),
      ]);
      const first = (await request.response())?.status() ?? 0;
      if (first >= 200 && first < 300) {
        // Success: the script navigates to the list.
        await this.page.waitForURL((url) => url.href !== formUrl, { timeout: 20_000 });
        await this.page.waitForLoadState('load');
        return { first, final: first, url: this.page.url() };
      }
      // Anything else: the script re-submits the form natively — follow that post.
      const native = await fallback;
      await this.page.waitForLoadState('load');
      let final = first;
      let current: Request | null | undefined = native;
      while (current) {
        final = (await current.response())?.status() ?? final;
        current = current.redirectedTo();
      }
      return { first, final, url: this.page.url() };
    } finally {
      this.page.context().off('page', onPage);
      for (const popup of popups) await popup.close().catch(() => undefined);
    }
  }
}

/** Generic names for the other content modules (same classes). */
export { AdminNewsListPage as ContentListPage, NewsFormPage as ContentFormPage };
export type { NewsCard as ContentCard, NewsFormValues as ContentFormValues };

/**
 * setInputFiles takes either paths or payloads, not a mix, and no payload over 50 MB: paths are read into payloads,
 * unless one payload is that big — then every payload is written to a temporary file (under its own name) instead.
 */
export function inputFiles(files: UploadFile[]): string[] | { name: string; mimeType: string; buffer: Buffer }[] {
  if (files.every((file) => typeof file === 'string')) return files as string[];
  // The 50 MB limit is for the whole call, not per file.
  const total = files.reduce((sum, file) => sum + (typeof file === 'string' ? 0 : file.buffer.length), 0);
  const big = total > 40 * 1024 * 1024;
  if (big) {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'km-upload-'));
    return files.map((file, i) => {
      if (typeof file === 'string') return file;
      const sub = path.join(dir, String(i));
      fs.mkdirSync(sub);
      const target = path.join(sub, path.basename(file.name));
      fs.writeFileSync(target, file.buffer);
      return target;
    });
  }
  return files.map((file) => (typeof file === 'string' ? { name: path.basename(file), mimeType: 'application/octet-stream', buffer: fs.readFileSync(file) } : file));
}
