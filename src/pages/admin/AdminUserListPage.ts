import { expect, Locator, Page } from '@playwright/test';
import { BasePage } from '../BasePage';
import { AdminUserFormModal } from './AdminUserFormModal';
import { QA_PREFIX } from '@utils/strings';

/** Rows per page of the user list (Laravel paginator; ?page=N). Seen 2026-09-25: "แสดง1-20 รายการ จาก 29 รายการ". */
const PAGE_SIZE = 20;

/**
 * The "ต้องการลบข้อมูล?" confirmation shown by a row's delete button
 * (confirmed 2026-09-25: buttons "ยืนยันลบข้อมูล" (submit) and "ยกเลิก").
 */
export class DeleteConfirmDialog {
  readonly root: Locator;
  readonly confirmButton: Locator;
  readonly cancelButton: Locator;

  constructor(page: Page) {
    this.root = page.getByRole('dialog').filter({ hasText: 'ต้องการลบข้อมูล?' });
    this.confirmButton = this.root.getByRole('button', { name: 'ยืนยันลบข้อมูล' });
    this.cancelButton = this.root.getByRole('button', { name: 'ยกเลิก' });
  }

  async confirm(): Promise<void> {
    await this.confirmButton.click();
  }

  async cancel(): Promise<void> {
    await this.cancelButton.click();
    await this.root.waitFor({ state: 'hidden' });
  }
}

/**
 * /admin/user/index
 *
 * The list is PAGINATED (20 per page, sorted by name) and every automated
 * run adds users, so anything that counts or looks for a user must not
 * assume it is on the page currently shown — the built-in `admin` account
 * itself moved to page 2 once test users accumulated. Use userCount()
 * (reads the "จาก N รายการ" total) and locateUser()/expectListed()
 * (walk the pages) instead of counting `rows` or reading `rowByUsername`
 * directly.
 */
export class AdminUserListPage extends BasePage {
  readonly addUserButton: Locator;
  readonly table: Locator;
  readonly rows: Locator;

  constructor(page: Page) {
    super(page);
    this.addUserButton = page.getByRole('button', { name: 'เพิ่มผู้ใช้งาน' });
    this.table = page.locator('table');
    this.rows = this.table.locator('tbody tr');
  }

  async open(page = 1): Promise<void> {
    await this.goto(page > 1 ? `/admin/user/index?page=${page}` : '/admin/user/index');
    // Defensive: wait for the first row so nothing reads the table before it
    // has rendered (there are always >= 2 permanent accounts).
    await this.rows.first().waitFor({ state: 'visible' });
  }

  async openAddUserForm(): Promise<AdminUserFormModal> {
    await this.addUserButton.click();
    const modal = new AdminUserFormModal(this.page);
    await modal.waitForOpen();
    return modal;
  }

  /**
   * Row layout: name on the first line, username as the subtext underneath
   * it. Uses an EXACT text match — a plain `hasText` substring filter is
   * case-insensitive and once other tests have seeded data like
   * "ADMIN@cu-km-nurse.local", rowByUsername('admin') would incorrectly
   * match that row too (confirmed 2026-09-24: this caused a click on the
   * wrong row's action button, which opened a delete-confirmation dialog
   * instead of the edit modal — no data was actually deleted, but it came
   * uncomfortably close).
   *
   * Only searches the page CURRENTLY on screen — prefer locateUser().
   */
  rowByUsername(username: string): Locator {
    return this.rows.filter({ has: this.page.getByText(username, { exact: true }) });
  }

  /** Total users, from the "แสดง1-20 รายการ จาก 29 รายการ" line (`rows.count()` is capped at one page). */
  async totalUsers(): Promise<number> {
    const text = await this.page.getByText(/จาก\s*\d+\s*รายการ/).first().innerText();
    return Number(/จาก\s*(\d+)\s*รายการ/.exec(text)![1]);
  }

  /** Reloads the list first, so the figure is never stale and a rejected/closed form can't skew it. */
  async userCount(): Promise<number> {
    await this.open();
    return this.totalUsers();
  }

  /**
   * Reloads the list, walks its pages until `username` is found, and returns
   * that row (the list is left on the page that contains it). Throws if the
   * user is on no page.
   */
  async locateUser(username: string): Promise<Locator> {
    await this.open();
    const pages = Math.max(1, Math.ceil((await this.totalUsers()) / PAGE_SIZE));
    for (let p = 1; p <= pages; p++) {
      if (p > 1) await this.open(p);
      const row = this.rowByUsername(username);
      if ((await row.count()) > 0) return row.first();
    }
    throw new Error(`User "${username}" was not found on any of the ${pages} list page(s)`);
  }

  async isUserListed(username: string): Promise<boolean> {
    try {
      await this.locateUser(username);
      return true;
    } catch {
      return false;
    }
  }

  /** Retries for a few seconds (the list may lag right after a save) before failing. */
  async expectListed(username: string): Promise<void> {
    await expect
      .poll(() => this.isUserListed(username), {
        message: `user "${username}" should appear in the user list`,
        timeout: 10_000,
      })
      .toBe(true);
  }

  /**
   * Opens the delete confirmation for one user (the row's LAST button). Deleting
   * is the one irreversible thing this page can do, so it refuses anything that
   * is not an automation-created account (username starting "qa_auto") — a
   * mistyped or shared value can never point it at a real user.
   */
  async openDeleteDialog(username: string): Promise<DeleteConfirmDialog> {
    if (!username.startsWith(QA_PREFIX)) {
      throw new Error(
        `Refusing to delete "${username}": only usernames starting with "${QA_PREFIX}" (created by automation) may be deleted`,
      );
    }
    const row = await this.locateUser(username);
    // Never click a row whose text is not the exact user we were asked for.
    await expect(row.getByText(username, { exact: true })).toHaveCount(1);
    await row.locator('button').last().click();
    const dialog = new DeleteConfirmDialog(this.page);
    await dialog.root.waitFor({ state: 'visible' });
    return dialog;
  }

  /**
   * The URLs behind a user's row buttons: `update` is where the edit form posts (with _method=PUT) and
   * `remove` where the delete dialog posts (with _method=DELETE). Read from the row's data attributes.
   */
  async actionUrls(username: string): Promise<{ update: string; remove: string }> {
    const row = await this.locateUser(username);
    const update = await row.locator('button.js-edit-user').getAttribute('data-action');
    const remove = await row.locator('button.delete').getAttribute('data-delete-url');
    if (!update || !remove) throw new Error(`User "${username}" has no edit/delete URL on its row`);
    return { update, remove };
  }

  async openEditUserForm(username: string): Promise<AdminUserFormModal> {
    // Edit is the FIRST action button. Rows of custom-created users have two
    // buttons and the LAST opens the delete-confirmation dialog (that's how a
    // wrong-row click nearly deleted data on 2026-09-24); the built-in admin
    // row has only the edit button. waitForOpen() below only accepts a dialog
    // containing "ผู้ใช้งาน", which the delete dialog ("ต้องการลบข้อมูล?")
    // does not, so a wrong button fails loudly instead of proceeding.
    const row = await this.locateUser(username);
    await row.locator('button').first().click();
    const modal = new AdminUserFormModal(this.page);
    await modal.waitForOpen();
    return modal;
  }
}
