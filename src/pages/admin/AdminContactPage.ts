import { Locator, Page } from '@playwright/test';
import { BasePage } from '../BasePage';
import { DeleteConfirmDialog } from './AdminUserListPage';
import { submitAndFollow, Submitted } from './AdminNewsPages';
import { AUTO_TEST_FLAG } from '@utils/testData';

/** The values of the "ข้อมูลติดต่อ" panel (#slideMod). */
export interface ContactInfo {
  phone: string;
  facebook: string;
  email: string;
  address: string;
}

/** One row of "รายการข้อความติดต่อ", as plain data (the view button carries the stored values). */
export interface ContactMessage {
  name: string;
  email: string;
  phone: string;
  subject: string;
  message: string;
  date: string;
  isRead: boolean;
  /** The status badge ("ยังไม่อ่าน" / "อ่านแล้ว"). */
  status: string;
  markReadUrl: string;
  toggleUrl: string;
  deleteUrl: string;
}

/**
 * /admin/contractus/index — "การติดต่อสอบถาม" (checked 2026-10-05). Two pills:
 * - "รายละเอียด" (#pills-detail): read-only copies of the contact info + the map. The pencils open two side panels
 *   that both PUT /admin/contractus/info (flash "บันทึกข้อมูลเรียบร้อยแล้ว"):
 *   #slideMod "จัดการรายละเอียด" — phone, facebook, email (all type=text) and address (textarea); no required /
 *   maxlength attributes; #locationMod "จัดการสถานที่ตั้ง" — _form=location, map_embed textarea ("โค้ด Embed แผนที่").
 *   The sheet's lat/lng fields do not exist. Empty map: "ยังไม่ได้ตั้งค่าแผนที่".
 * - "รายการข้อความติดต่อ" (#pills-message): search q / status (ทั้งหมด|unread|read) / from–to dates, a table
 *   (ผู้ติดต่อ, วันที่, หัวข้อ, สถานะ, จัดการ). Per row: the view button .js-view-message (offcanvas #viewMod, data-*
 *   name/email/phone/subject/message/date/is-read, marks the message read with a fetch on first view) and delete (the
 *   shared "ต้องการลบข้อมูล?" dialog, flash "ลบข้อความเรียบร้อยแล้ว"). Message ids are opaque.
 */
export class AdminContactPage extends BasePage {
  readonly heading: Locator;
  readonly detailTab: Locator;
  readonly messagesTab: Locator;
  readonly flash: Locator;

  readonly infoPanel: Locator;
  readonly infoEdit: Locator;
  readonly phoneInput: Locator;
  readonly facebookInput: Locator;
  readonly emailInput: Locator;
  readonly addressInput: Locator;
  readonly infoSave: Locator;

  readonly locationPanel: Locator;
  readonly locationEdit: Locator;
  readonly mapInput: Locator;
  readonly locationSave: Locator;
  readonly mapArea: Locator;

  readonly messageRows: Locator;
  readonly viewPanel: Locator;

  constructor(page: Page) {
    super(page);
    this.heading = page.locator('.body-content h2', { hasText: 'การติดต่อสอบถาม' });
    this.detailTab = page.locator('#pills-detail-tab');
    this.messagesTab = page.locator('#pills-footer-tab');
    this.flash = page.locator('.alert');

    this.infoPanel = page.locator('#slideMod');
    this.infoEdit = page.locator('[data-bs-target="#slideMod"]');
    this.phoneInput = this.infoPanel.locator('[name="phone"]');
    this.facebookInput = this.infoPanel.locator('[name="facebook"]');
    this.emailInput = this.infoPanel.locator('[name="email"]');
    this.addressInput = this.infoPanel.locator('[name="address"]');
    this.infoSave = this.infoPanel.getByRole('button', { name: 'บันทึก' });

    this.locationPanel = page.locator('#locationMod');
    this.locationEdit = page.locator('[data-bs-target="#locationMod"]');
    this.mapInput = this.locationPanel.locator('[name="map_embed"]');
    this.locationSave = this.locationPanel.getByRole('button', { name: 'บันทึก' });
    this.mapArea = page.locator('#pills-detail .row').last();

    this.messageRows = page.locator('#pills-message tbody tr');
    this.viewPanel = page.locator('#viewMod');
  }

  async open(query = ''): Promise<number> {
    const response = await this.goto(`/admin/contractus/index${query}`);
    return response?.status() ?? 0;
  }

  /** The stored contact info (the values the edit panel is pre-filled with). */
  async info(): Promise<ContactInfo> {
    await this.open();
    return {
      phone: await this.phoneInput.inputValue(),
      facebook: await this.facebookInput.inputValue(),
      email: await this.emailInput.inputValue(),
      address: await this.addressInput.inputValue(),
    };
  }

  async mapEmbed(): Promise<string> {
    await this.open();
    return this.mapInput.inputValue();
  }

  /** The read-only copies on the "รายละเอียด" pill, by label. */
  async shownInfo(): Promise<Record<string, string>> {
    return this.page.locator('#pills-detail .form-group').evaluateAll((groups) =>
      Object.fromEntries(groups.map((g) => [(g.querySelector('label')?.textContent ?? '').trim(), (g.querySelector('input') as HTMLInputElement | null)?.value ?? ''])),
    );
  }

  async openInfoForm(): Promise<void> {
    if (!/\/admin\/contractus\/index/.test(this.page.url())) await this.open();
    await this.infoEdit.click();
    await this.phoneInput.waitFor({ state: 'visible' });
  }

  async fillInfo(values: Partial<ContactInfo>): Promise<void> {
    if (values.phone !== undefined) await this.phoneInput.fill(values.phone);
    if (values.facebook !== undefined) await this.facebookInput.fill(values.facebook);
    if (values.email !== undefined) await this.emailInput.fill(values.email);
    if (values.address !== undefined) await this.addressInput.fill(values.address);
  }

  /** Opens the info panel, fills `values` over the stored ones and saves (a plain form post back to the page). */
  async saveInfo(values: Partial<ContactInfo>): Promise<Submitted> {
    await this.openInfoForm();
    await this.fillInfo(values);
    return submitAndFollow(this.page, () => this.infoSave.click());
  }

  async saveMap(embed: string): Promise<Submitted> {
    if (!/\/admin\/contractus\/index/.test(this.page.url())) await this.open();
    await this.locationEdit.click();
    await this.mapInput.waitFor({ state: 'visible' });
    await this.mapInput.fill(embed);
    return submitAndFollow(this.page, () => this.locationSave.click());
  }

  /**
   * Validation texts after a refused save, with whether the admin can see them. The page redirects back with the
   * panels CLOSED, so a red text under a field sits in a hidden panel (checked 2026-10-05: "validation.email").
   */
  async validationTexts(): Promise<{ text: string; visible: boolean }[]> {
    return this.page
      .locator('#slideMod .invalid-feedback, #slideMod .text-danger, #slideMod .text-xsmall, #locationMod .text-xsmall, #locationMod .invalid-feedback, .alert-danger')
      .evaluateAll((elements) =>
        elements
          .map((e) => ({ text: (e.textContent ?? '').replace(/\s+/g, ' ').trim(), visible: (e as HTMLElement).offsetParent !== null && getComputedStyle(e).visibility === 'visible' }))
          .filter((e) => e.text),
      );
  }

  /** The validation texts the admin can actually see. */
  async visibleValidationTexts(): Promise<string[]> {
    return (await this.validationTexts()).filter((e) => e.visible).map((e) => e.text);
  }

  async readMessages(): Promise<ContactMessage[]> {
    return this.messageRows.evaluateAll((rows) =>
      rows
        .filter((row) => row.querySelector('.js-view-message'))
        .map((row) => {
          const view = row.querySelector('.js-view-message') as HTMLElement;
          const data = view.dataset;
          return {
            name: data.name ?? '',
            email: data.email ?? '',
            phone: data.phone ?? '',
            subject: data.subject ?? '',
            message: data.message ?? '',
            date: data.date ?? '',
            isRead: data.isRead === '1',
            status: (row.querySelector('.status')?.textContent ?? '').trim(),
            markReadUrl: data.markReadUrl ?? '',
            toggleUrl: data.toggleUrl ?? '',
            deleteUrl: row.querySelector('[data-delete-url]')?.getAttribute('data-delete-url') ?? '',
          };
        }),
    );
  }

  async findMessage(match: (message: ContactMessage) => boolean, query = ''): Promise<{ index: number; message: ContactMessage } | undefined> {
    await this.open(query);
    const messages = await this.readMessages();
    const index = messages.findIndex(match);
    return index >= 0 ? { index, message: messages[index] } : undefined;
  }

  async messageCount(): Promise<number> {
    await this.open();
    return (await this.readMessages()).length;
  }

  /** Opens the view panel of the first match and returns what it shows. */
  async viewMessage(match: (message: ContactMessage) => boolean): Promise<Record<string, string>> {
    const found = await this.findMessage(match);
    if (!found) throw new Error('No such message');
    await this.messagesTab.click();
    await this.messageRows.nth(found.index).locator('.js-view-message').click();
    await this.viewPanel.waitFor({ state: 'visible' });
    return this.viewPanel.evaluate((panel) => {
      const value = (selector: string): string => (panel.querySelector(selector) as HTMLInputElement | HTMLTextAreaElement | null)?.value ?? '';
      return {
        date: (panel.querySelector('.js-view-date')?.textContent ?? '').trim(),
        name: value('.js-view-name'),
        email: value('.js-view-email'),
        phone: value('.js-view-phone'),
        subject: value('.js-view-subject'),
        message: value('.js-view-message'),
      };
    });
  }

  /** The delete dialog of the first match; refuses any message whose name, subject and text all lack "[Auto Test]". */
  async openDeleteDialog(match: (message: ContactMessage) => boolean): Promise<DeleteConfirmDialog> {
    const found = await this.findMessage(match);
    if (!found) throw new Error('No such message');
    const { name, subject, message } = found.message;
    if (![name, subject, message].some((text) => text.includes(AUTO_TEST_FLAG))) {
      throw new Error(`Refusing to delete the message from "${name}": no "${AUTO_TEST_FLAG}" marker`);
    }
    await this.messagesTab.click();
    await this.messageRows.nth(found.index).locator('[data-delete-url]').click();
    const dialog = new DeleteConfirmDialog(this.page);
    await dialog.root.waitFor({ state: 'visible' });
    return dialog;
  }
}
