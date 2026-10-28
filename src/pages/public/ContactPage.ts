import { Locator, Page } from '@playwright/test';
import { PublicPage } from './PublicPage';

/** What a visitor types into "แบบฟอร์มติดต่อสอบถาม". */
export interface ContactFormValues {
  name?: string;
  email?: string;
  subject?: string;
  message?: string;
}

/**
 * /frontend/contractus/index — "ติดต่อสอบถาม" (checked 2026-10-05). Left: one `.section-card` per contact item
 * (icon, `.fw-bold` label "เบอร์โทร" / "อีเมล" / "ที่อยู่", `.text-small` value, "-" when empty; no Facebook card and
 * no map while those are empty). Right: #contact-form, a plain POST to the same URL (redirect back):
 * name (required, placeholder "ชื่อ - นามสกุล"), email (type=text, NOT required), subject ("หัวข้อ"), message
 * (textarea, required, placeholder "รายละเอียด"); no file field, no maxlength. Server-side errors are red
 * `.text-xsmall` texts under the field ("กรุณากรอกชื่อ - นามสกุล", "กรุณากรอกรายละเอียด"; a bad email shows the raw
 * key "validation.email"); the typed values come back. Success opens the modal #modsuccess "สำเร็จ! ระบบได้บันทึก
 * ข้อมูลของคุณเรียบร้อยแล้ว" and the form is empty again.
 */
export class ContactPage extends PublicPage {
  readonly infoCards: Locator;
  readonly form: Locator;
  readonly nameInput: Locator;
  readonly emailInput: Locator;
  readonly subjectInput: Locator;
  readonly messageInput: Locator;
  readonly submitButton: Locator;
  readonly successModal: Locator;

  constructor(page: Page) {
    super(page);
    this.form = page.locator('#contact-form');
    this.infoCards = page.locator('.body-content .section-card').filter({ hasNot: page.locator('#contact-form') });
    this.nameInput = this.form.locator('[name="name"]');
    this.emailInput = this.form.locator('[name="email"]');
    this.subjectInput = this.form.locator('[name="subject"]');
    this.messageInput = this.form.locator('[name="message"]');
    this.submitButton = this.form.getByRole('button', { name: 'ส่งแบบฟอร์ม' });
    this.successModal = page.locator('#modsuccess');
  }

  /** Opens the contact page (after the loader) and returns the HTTP status. */
  async openContact(): Promise<number> {
    const response = await this.open('/frontend/contractus/index');
    return response?.status() ?? 0;
  }

  /** The contact cards as label → value ("-" when empty). */
  async info(): Promise<Record<string, string>> {
    return this.infoCards.evaluateAll((cards) =>
      Object.fromEntries(
        cards.map((card) => [
          (card.querySelector('.fw-bold')?.textContent ?? '').replace(/\s+/g, ' ').trim(),
          (card.querySelector('.text-small')?.textContent ?? '').replace(/\s+/g, ' ').trim(),
        ]),
      ),
    );
  }

  async fill(values: ContactFormValues): Promise<void> {
    if (values.name !== undefined) await this.nameInput.fill(values.name);
    if (values.email !== undefined) await this.emailInput.fill(values.email);
    if (values.subject !== undefined) await this.subjectInput.fill(values.subject);
    if (values.message !== undefined) await this.messageInput.fill(values.message);
  }

  async values(): Promise<Required<ContactFormValues>> {
    return {
      name: await this.nameInput.inputValue(),
      email: await this.emailInput.inputValue(),
      subject: await this.subjectInput.inputValue(),
      message: await this.messageInput.inputValue(),
    };
  }

  /** Red texts under the fields, keyed by field name (after a refused post). */
  async fieldErrors(): Promise<Record<string, string>> {
    return this.form.locator('.form-group').evaluateAll((groups) =>
      Object.fromEntries(
        groups
          .map((g) => [g.querySelector('[name]')?.getAttribute('name') ?? '', (g.querySelector('.text-xsmall, .invalid-feedback, .text-danger')?.textContent ?? '').replace(/\s+/g, ' ').trim()])
          .filter(([name, error]) => name && error),
      ),
    );
  }

  /** Lets the post reach the server even when a required field is empty (browser validation off). */
  async disableBrowserValidation(): Promise<void> {
    await this.form.evaluate((form: HTMLFormElement) => {
      form.noValidate = true;
    });
  }
}
