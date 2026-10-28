import { Locator, Page, Response } from '@playwright/test';
import { BasePage } from '../BasePage';
import { DeleteConfirmDialog } from './AdminUserListPage';
import { AUTO_TEST_FLAG } from '@utils/testData';

/**
 * The category types (tabs) of /admin/group/index, in screen order, with the
 * `?module=` value each one uses. Confirmed 2026-09-25. The source sheet lists
 * only the first five; the app also has "คำถามยอดฮิต" (faq).
 */
export const GROUP_TABS = [
  { key: 'cms', label: 'ข่าวกิจกรรม KM' },
  { key: 'knowledge', label: 'คลังความรู้' },
  { key: 'cop', label: 'ชุมชนนักปฏิบัติ' },
  { key: 'infographic', label: 'อินโฟกราฟิก' },
  { key: 'best_practice', label: 'แนวทางปฏิบัติที่ดี' },
  { key: 'faq', label: 'คำถามยอดฮิต' },
] as const;

export type GroupTabKey = (typeof GROUP_TABS)[number]['key'];

/** The tabs the source sheet knows (TC-ADMG-01-01 says "ทั้ง 5 ประเภท"). */
export const SHEET_TAB_KEYS: GroupTabKey[] = ['cms', 'knowledge', 'cop', 'infographic', 'best_practice'];

export type CategoryStatus = 'draft' | 'publish' | 'hide';

export const CATEGORY_STATUS_LABEL: Record<CategoryStatus, string> = { draft: 'ฉบับร่าง', publish: 'เผยแพร่', hide: 'ซ่อน' };

/** What to put into the add/edit form (anything left out keeps the form's default: empty, status "เผยแพร่"). */
export interface CategoryFormValues {
  name?: string;
  description?: string;
  icon?: string;
  status?: CategoryStatus;
}

/** One category card of the list, as plain data. */
export interface CategoryCard {
  name: string;
  /** The "หัวข้อย่อย" line ("—" when empty on screen; '' here). */
  description: string;
  /** "เผยแพร่" / "ซ่อน" / "ฉบับร่าง" as shown on the badge. */
  status: string;
  creator: string;
  created: string;
  hasDelete: boolean;
}

/**
 * /admin/group/index?module=<key> — categories per content type. Each tab is a
 * grid of cards (not a table); "เพิ่มหมวดหมู่" and the pencil open the same
 * side panel (#menuMod), a plain form posted to /admin/group (edit: PUT to the
 * card's data-action). Deleting uses the shared "ต้องการลบข้อมูล?" dialog.
 */
export class AdminGroupPage extends BasePage {
  readonly pageHeading: Locator;
  readonly tabHeading: Locator;
  readonly addButton: Locator;
  readonly cards: Locator;
  readonly flash: Locator;

  // The side panel.
  readonly panel: Locator;
  readonly panelTitle: Locator;
  readonly nameInput: Locator;
  readonly descriptionInput: Locator;
  readonly iconInput: Locator;
  readonly saveButton: Locator;
  readonly cancelButton: Locator;

  constructor(page: Page) {
    super(page);
    this.pageHeading = page.locator('.body-content h2').first();
    this.tabHeading = page.locator('.body-content h4').first();
    this.addButton = page.getByRole('button', { name: 'เพิ่มหมวดหมู่' });
    this.cards = page.locator('.card.vertical');
    this.flash = page.locator('.alert.alert-dismissible, .toast.show, .swal2-popup, [role="alert"]').first();

    this.panel = page.locator('#menuMod');
    this.panelTitle = this.panel.locator('.offcanvas-title, h5').first();
    this.nameInput = page.locator('#category-name');
    this.descriptionInput = page.locator('#category-description');
    this.iconInput = page.locator('#category-icon');
    this.saveButton = this.panel.getByRole('button', { name: 'บันทึก' });
    this.cancelButton = this.panel.getByRole('button', { name: 'ยกเลิก' });
  }

  /** Opens one tab (page `pageNo` of it) directly by URL. */
  async open(tab: GroupTabKey = 'cms', pageNo = 1): Promise<void> {
    await this.goto(`/admin/group/index?module=${tab}${pageNo > 1 ? `&page=${pageNo}` : ''}`);
    await this.tabHeading.waitFor({ state: 'visible' });
  }

  /** The tab that is currently open (from the URL). */
  currentTab(): GroupTabKey {
    return (new URL(this.page.url()).searchParams.get('module') ?? 'cms') as GroupTabKey;
  }

  /** Categories on the tab in total (the counter's "จาก N รายการ"; a tab shows only 9 cards per page). */
  async total(tab: GroupTabKey): Promise<number> {
    await this.open(tab);
    return (await this.counter())?.total ?? (await this.cards.count());
  }

  /**
   * Finds a card by name on ANY page of the tab (cards are listed oldest first, 9 per page, so a new one is on the
   * last page). Leaves the page that holds it open, so the card's own buttons can be used right after.
   */
  async locateCard(name: string, tab: GroupTabKey = this.currentTab()): Promise<{ pageNo: number; index: number; card: CategoryCard } | undefined> {
    for (let pageNo = 1; pageNo <= 100; pageNo++) {
      await this.open(tab, pageNo);
      const cards = await this.readCards();
      const index = cards.findIndex((card) => card.name === name.trim());
      if (index >= 0) return { pageNo, index, card: cards[index] };
      const counter = await this.counter();
      if (!counter || counter.to >= counter.total || cards.length === 0) return undefined;
    }
    return undefined;
  }

  /** The tab link (the sidebar menu has same-named links, so it is picked by its ?module= href). */
  tabLink(tab: GroupTabKey): Locator {
    return this.page.locator(`a.nav-link[href*="module=${tab}"]`);
  }

  /** Every card of the current tab as plain data. */
  async readCards(): Promise<CategoryCard[]> {
    return this.cards.evaluateAll((cards) =>
      cards.map((card) => {
        const text = (selector: string): string => (card.querySelector(selector) as HTMLElement | null)?.textContent?.trim() ?? '';
        const description = text('.card-body .text-gray');
        return {
          name: text('.card-body .fw-bold'),
          description: description === '—' ? '' : description,
          status: text('.status'),
          creator: text('.text-primary'),
          created: text('.text-small.text-gray'),
          hasDelete: !!card.querySelector('[data-delete-url]'),
        };
      }),
    );
  }

  /** The card whose name is exactly `name` (after trimming), or undefined. Looks through every page of the current tab. */
  async findCard(name: string): Promise<CategoryCard | undefined> {
    return (await this.locateCard(name))?.card;
  }

  /** "แสดง1-20 รายการ จาก 45 รายการ" → numbers, or null when the line is absent. */
  async counter(): Promise<{ from: number; to: number; total: number } | null> {
    const match = /แสดง\s*(\d+)\s*-\s*(\d+)\s*รายการ\s*จาก\s*(\d+)\s*รายการ/.exec(await this.page.locator('body').innerText());
    return match ? { from: Number(match[1]), to: Number(match[2]), total: Number(match[3]) } : null;
  }

  /** "ยังไม่มีหมวดหมู่<ประเภท>" shown when the tab has no category. */
  emptyState(label: string): Locator {
    return this.page.getByText(`ยังไม่มีหมวดหมู่${label}`, { exact: true });
  }

  async openAddForm(): Promise<void> {
    await this.addButton.click();
    await this.nameInput.waitFor({ state: 'visible' });
  }

  async openEditForm(name: string): Promise<void> {
    const found = await this.locateCard(name);
    if (!found) throw new Error(`Category "${name}" is not on this tab`);
    await this.cards.nth(found.index).locator('.js-edit-category').click();
    await this.nameInput.waitFor({ state: 'visible' });
  }

  /** The values a card's pencil carries (what the edit panel will show): a round-trip check of what was stored. */
  async editAttributes(name: string): Promise<{ name: string | null; description: string | null; icon: string | null; status: string | null }> {
    const found = await this.locateCard(name);
    if (!found) throw new Error(`Category "${name}" is not on this tab`);
    const edit = this.cards.nth(found.index).locator('.js-edit-category');
    return {
      name: await edit.getAttribute('data-name'),
      description: await edit.getAttribute('data-description'),
      icon: await edit.getAttribute('data-icon'),
      status: await edit.getAttribute('data-status'),
    };
  }

  statusRadio(status: CategoryStatus): Locator {
    return this.page.locator(`#category-status-${status}`);
  }

  /** Fills the open panel from `values` (only what is given). */
  async fill(values: CategoryFormValues): Promise<void> {
    if (values.name !== undefined) await this.nameInput.fill(values.name);
    if (values.description !== undefined) await this.descriptionInput.fill(values.description);
    if (values.icon !== undefined) await this.iconInput.fill(values.icon);
    if (values.status !== undefined) {
      const radio = this.statusRadio(values.status);
      // Bootstrap .btn-check: the label covers the radio (check() then waits forever), so press the label.
      await this.page.locator(`label[for="category-status-${values.status}"]`).click();
      if (!(await radio.isChecked())) await radio.check({ force: true });
    }
  }

  /** Presses "บันทึก" and returns the response of the form post (the browser follows the redirect). */
  async save(): Promise<Response> {
    const [response] = await Promise.all([
      this.page.waitForResponse((r) => r.request().isNavigationRequest() && ['POST', 'PUT'].includes(r.request().method())),
      this.saveButton.click(),
    ]);
    await this.page.waitForLoadState('load');
    return response;
  }

  /**
   * The delete dialog of a card. Deleting is irreversible, so it refuses any
   * category whose name/description does not carry the "[Auto Test]" marker
   * every automation-created category has (QA's own AUTO_CAT_001 is not touched).
   */
  async openDeleteDialog(name: string): Promise<DeleteConfirmDialog> {
    const found = await this.locateCard(name);
    if (!found) throw new Error(`Category "${name}" is not on this tab`);
    const card = found.card;
    if (!card.hasDelete) throw new Error(`Category "${name}" has no delete button`);
    if (!card.name.includes(AUTO_TEST_FLAG) && !card.description.includes(AUTO_TEST_FLAG)) {
      throw new Error(`Refusing to delete category "${name}": neither its name nor its description carries "${AUTO_TEST_FLAG}"`);
    }
    await this.cards.nth(found.index).locator('[data-delete-url]').click();
    const dialog = new DeleteConfirmDialog(this.page);
    await dialog.root.waitFor({ state: 'visible' });
    return dialog;
  }
}
