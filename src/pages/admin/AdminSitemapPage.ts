import { FrameLocator, Locator, Page, Response } from '@playwright/test';
import { BasePage } from '../BasePage';

export const SITEMAP_INDEX_PATH = '/admin/sitemap/index';
export const SITEMAP_DETAIL_PATH = '/admin/sitemap/detail';
/** The public route exists (500, not 404) but nothing on the public site links to it yet (2026-09-29). */
export const PUBLIC_SITEMAP_PATH = '/frontend/sitemap/index';

/** What the index shows while the body is empty. */
export const SITEMAP_EMPTY_TEXT = 'ยังไม่มีข้อมูล';

/**
 * /admin/sitemap/index — NOT a list of entries as the source sheet assumes
 * (confirmed 2026-09-29). It is one content page: a cover image on the left,
 * the saved body on the right (.sitemap-text) and a single "แก้ไข" link to
 * /admin/sitemap/detail. There is no add button.
 *
 * The detail page is one form (#sitemap-form, PUT to /admin/sitemap,
 * multipart): `body` is a TinyMCE editor on textarea#sitemap-body-input (no
 * `required`, no maxlength) and `cover_image` an optional jpeg/png upload.
 */
export class AdminSitemapPage extends BasePage {
  readonly pageHeading: Locator;
  readonly sectionHeading: Locator;
  readonly editLink: Locator;
  readonly addButton: Locator;
  readonly coverImage: Locator;
  readonly bodyView: Locator;
  readonly flash: Locator;

  // The detail (edit) form.
  readonly form: Locator;
  readonly bodyTextarea: Locator;
  readonly editorFrame: FrameLocator;
  readonly editorBody: Locator;
  readonly coverInput: Locator;
  readonly saveButton: Locator;
  readonly cancelLink: Locator;
  readonly fieldErrors: Locator;

  constructor(page: Page) {
    super(page);
    this.pageHeading = page.locator('.body-content h2').first();
    this.sectionHeading = page.locator('.body-content h4').first();
    this.editLink = page.locator('.body-content a', { hasText: 'แก้ไข' });
    this.addButton = page.locator('.body-content').getByRole('button', { name: /เพิ่ม/ }).or(page.locator('.body-content a', { hasText: /เพิ่ม/ }));
    this.coverImage = page.locator('.sitemap-img');
    this.bodyView = page.locator('.sitemap-text');
    this.flash = page.locator('.alert.alert-dismissible, .toast.show, .swal2-popup, [role="alert"]').first();

    this.form = page.locator('#sitemap-form');
    this.bodyTextarea = page.locator('#sitemap-body-input');
    this.editorFrame = page.frameLocator('.tox-edit-area__iframe');
    this.editorBody = this.editorFrame.locator('body');
    this.coverInput = page.locator('#cover-image-upload');
    this.saveButton = this.form.locator('button[type="submit"]');
    this.cancelLink = this.form.locator('a', { hasText: 'ยกเลิก' });
    this.fieldErrors = page.locator('.invalid-feedback:visible, .text-danger:visible, .alert-danger:visible');
  }

  async open(): Promise<Response | null> {
    return this.goto(SITEMAP_INDEX_PATH);
  }

  async openEditor(): Promise<Response | null> {
    const response = await this.goto(SITEMAP_DETAIL_PATH);
    await this.editorBody.waitFor();
    await this.page.waitForFunction(() => {
      const tiny = (window as unknown as { tinymce?: { get(id: string): unknown } }).tinymce;
      return !!tiny?.get('sitemap-body-input');
    });
    return response;
  }

  /** The editor's current HTML, as TinyMCE would post it. */
  async editorContent(): Promise<string> {
    return this.page.evaluate(() => {
      const tiny = (window as unknown as { tinymce: { get(id: string): { getContent(): string } } }).tinymce;
      return tiny.get('sitemap-body-input').getContent();
    });
  }

  /** Puts HTML straight into the editor (TinyMCE still filters it) — used to put back what was there before. */
  async setEditorContent(html: string): Promise<void> {
    await this.page.evaluate((value) => {
      const tiny = (window as unknown as { tinymce: { get(id: string): { setContent(v: string): void; save(): void } } }).tinymce;
      const editor = tiny.get('sitemap-body-input');
      editor.setContent(value);
      editor.save();
    }, html);
  }

  /** Types into the editor the way an admin would: select all, delete, type (text typed here is text, never markup). */
  async typeBody(text: string): Promise<void> {
    await this.clearBody();
    if (text) await this.editorBody.pressSequentially(text);
  }

  async clearBody(): Promise<void> {
    await this.editorBody.click();
    await this.editorBody.press('ControlOrMeta+a');
    await this.editorBody.press('Delete');
  }

  /** Clicks "บันทึก" and returns the form's POST response (the page then follows the redirect). */
  async save(): Promise<Response> {
    const [response] = await Promise.all([
      this.page.waitForResponse((r) => r.request().method() === 'POST' && /\/admin\/sitemap(\?|$)/.test(r.url())),
      this.saveButton.click(),
    ]);
    await this.page.waitForLoadState('domcontentloaded');
    return response;
  }

  /** The body as shown on the index (plain text, whitespace collapsed). */
  async shownText(): Promise<string> {
    return ((await this.bodyView.innerText()) || '').replace(/\s+/g, ' ').trim();
  }
}
