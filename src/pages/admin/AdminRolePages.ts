import { expect, Locator, Page, Response } from '@playwright/test';
import { BasePage } from '../BasePage';
import { DeleteConfirmDialog } from './AdminUserListPage';
import { AUTO_TEST_FLAG } from '@utils/testData';

/** The three levels a module can be given (radio values on the real form). */
export type RoleLevel = 'none' | 'view' | 'full';

export const ROLE_LEVEL_LABEL: Record<RoleLevel, string> = {
  none: 'ไม่ได้รับอนุญาต',
  view: 'อ่านอย่างเดียว',
  full: 'อนุญาตทั้งหมด',
};

const ALL_LEVELS: readonly RoleLevel[] = ['none', 'view', 'full'];

/**
 * The fourteen rows of the role form, in screen order, grouped as on the screen
 * (`name="module_permissions[<key>]"`), with the levels each row offers.
 * Re-confirmed against /admin/role/detail on 2026-10-01 after the deploy that
 * reordered the menu: "ดูประวัติการใช้งานระบบ" and "แดชบอร์ด" only go up to
 * "อ่านอย่างเดียว", "ติดต่อสอบถาม" has no "อ่านอย่างเดียว" (the "—" cells), and the
 * former "สิทธิ์อื่น ๆ" check boxes (single_permissions[]) are gone.
 */
export const ROLE_MODULES = [
  { key: 'user', label: 'ผู้ใช้งานระบบ', group: 'สิทธิ์การใช้งานระบบ', levels: ALL_LEVELS },
  { key: 'role', label: 'สิทธิ์การใช้งานระบบ', group: 'สิทธิ์การใช้งานระบบ', levels: ALL_LEVELS },
  { key: 'activity_log', label: 'ดูประวัติการใช้งานระบบ', group: 'สิทธิ์การใช้งานระบบ', levels: ['none', 'view'] },
  { key: 'dashboard', label: 'แดชบอร์ด', group: 'จัดการเนื้อหา', levels: ['none', 'view'] },
  { key: 'home', label: 'หน้าหลัก', group: 'จัดการเนื้อหา', levels: ALL_LEVELS },
  { key: 'cop', label: 'ชุมชนนักปฏิบัติ', group: 'จัดการเนื้อหา', levels: ALL_LEVELS },
  { key: 'knowledge', label: 'จัดการบทความ/คลังความรู้', group: 'จัดการเนื้อหา', levels: ALL_LEVELS },
  { key: 'infographic', label: 'คลังกิจกรรม', group: 'จัดการเนื้อหา', levels: ALL_LEVELS },
  { key: 'bestpractice', label: 'แนวทางปฏิบัติที่ดี (Best Practice)', group: 'จัดการเนื้อหา', levels: ALL_LEVELS },
  { key: 'content', label: 'ข่าวกิจกรรม KM', group: 'จัดการเนื้อหา', levels: ALL_LEVELS },
  { key: 'menu', label: 'จัดการแผนผังเว็บไซต์', group: 'จัดการข้อมูล', levels: ALL_LEVELS },
  { key: 'category', label: 'จัดการหมวดหมู่', group: 'จัดการข้อมูล', levels: ALL_LEVELS },
  { key: 'contact', label: 'ติดต่อสอบถาม', group: 'จัดการข้อมูล', levels: ['none', 'full'] },
  { key: 'faq', label: 'จัดการคำถามยอดฮิต (FAQ)', group: 'จัดการข้อมูล', levels: ALL_LEVELS },
] as const satisfies readonly { key: string; label: string; group: string; levels: readonly RoleLevel[] }[];

export type RoleModuleKey = (typeof ROLE_MODULES)[number]['key'];

/** The highest level a row offers ("full", or "view" for the read-only rows). */
export function topLevelOf(key: RoleModuleKey): RoleLevel {
  const levels: readonly RoleLevel[] = ROLE_MODULES.find((module) => module.key === key)!.levels;
  return levels[levels.length - 1];
}

/** What to put into the role form (anything left out keeps the form's default: empty / "none"). */
export interface RoleFormValues {
  label?: string;
  description?: string;
  levels?: Partial<Record<RoleModuleKey, RoleLevel>>;
}

export const ROLE_GROUPS = ['สิทธิ์การใช้งานระบบ', 'จัดการเนื้อหา', 'จัดการข้อมูล'] as const;

export interface RoleRow {
  name: string;
  description: string;
  users: string;
  created: string;
  creator: string;
  hasDelete: boolean;
}

/**
 * /admin/role/index — list of roles. There is no pager or search (3 roles on
 * Dev); the two built-in roles have only an edit icon, a role created by hand
 * also has a delete button.
 */
export class AdminRoleListPage extends BasePage {
  readonly heading: Locator;
  readonly table: Locator;
  readonly rows: Locator;
  readonly addRoleLink: Locator;
  /** Flash message shown after a save/delete (Bootstrap dismissible alert; it closes itself after 5 s). */
  readonly flash: Locator;

  constructor(page: Page) {
    super(page);
    this.flash = page.locator('.alert.alert-dismissible, .toast.show, .swal2-popup, [role="alert"]').first();
    this.heading = page.locator('.body-content .header.page, .body-content h2').first();
    this.table = page.locator('table');
    this.rows = this.table.locator('tbody tr');
    this.addRoleLink = page.getByRole('link', { name: 'เพิ่มสิทธิ์' });
  }

  async open(): Promise<void> {
    await this.goto('/admin/role/index');
    await this.rows.first().waitFor({ state: 'visible' });
  }

  /**
   * Every row as plain data (name and description are two elements inside one cell).
   * Must be called on the list itself: the role FORM also has tables, and reading those
   * rows fails with an obscure "cannot read 'textContent'" error.
   */
  async readRoles(): Promise<RoleRow[]> {
    const path = new URL(this.page.url()).pathname;
    if (!/^\/admin\/role(\/index)?\/?$/.test(path)) {
      throw new Error(`readRoles() needs the role list, but the page is at ${path} — call open() first`);
    }
    return this.rows.evaluateAll((trs) =>
      trs.map((tr) => {
        const cells = tr.querySelectorAll('td');
        const nameCell = cells[1];
        return {
          name: [...nameCell.childNodes]
            .filter((node) => node.nodeType === 3)
            .map((node) => node.textContent ?? '')
            .join('')
            .trim(),
          description: nameCell.querySelector('div')?.textContent?.trim() ?? '',
          users: cells[2].textContent?.trim() ?? '',
          created: cells[3].textContent?.trim() ?? '',
          creator: cells[4].textContent?.trim() ?? '',
          hasDelete: !!tr.querySelector('button.delete'),
        };
      }),
    );
  }

  /** The row whose name is exactly `name` (after trimming), or undefined. Re-reads the list on the current page. */
  async findRole(name: string): Promise<RoleRow | undefined> {
    return (await this.readRoles()).find((row) => row.name === name.trim());
  }

  async roleCount(): Promise<number> {
    await this.open();
    return this.rows.count();
  }

  /** The row whose name cell starts with `name` (first line of the cell). */
  rowByName(name: string): Locator {
    return this.rows.filter({ has: this.page.locator('td:nth-child(2)').filter({ hasText: name }) });
  }

  /** Absolute edit URL of the role called `name` (an encrypted token — the sheet's /detail/1 does not exist). */
  async editLink(name: string): Promise<string> {
    const rows = await this.readRoles();
    const index = rows.findIndex((row) => row.name === name);
    if (index < 0) throw new Error(`Role "${name}" is not in the list`);
    const href = await this.rows.nth(index).locator('a.edit').getAttribute('href');
    if (!href) throw new Error(`Role "${name}" has no edit link`);
    return new URL(href, this.page.url()).toString();
  }

  /** Absolute delete URL (the row's `data-delete-url`; the app deletes by POST with a hidden _method=DELETE). */
  async deleteUrl(name: string): Promise<string> {
    const rows = await this.readRoles();
    const index = rows.findIndex((row) => row.name === name);
    if (index < 0) throw new Error(`Role "${name}" is not in the list`);
    const url = await this.rows.nth(index).locator('button.delete').getAttribute('data-delete-url');
    if (!url) throw new Error(`Role "${name}" has no delete button`);
    return url;
  }

  async openEditForm(name: string): Promise<AdminRoleFormPage> {
    await this.open();
    const rows = await this.readRoles();
    const index = rows.findIndex((row) => row.name === name);
    if (index < 0) throw new Error(`Role "${name}" is not in the list`);
    await this.rows.nth(index).locator('a.edit').click();
    const form = new AdminRoleFormPage(this.page);
    await form.labelInput.waitFor({ state: 'visible' });
    return form;
  }

  async openAddForm(): Promise<AdminRoleFormPage> {
    await this.addRoleLink.click();
    const form = new AdminRoleFormPage(this.page);
    await form.labelInput.waitFor({ state: 'visible' });
    return form;
  }

  /**
   * Delete button of a role created by hand (built-in roles have none). Deleting is
   * irreversible, so it refuses any role whose name/description does not carry the
   * "[Auto Test]" marker every automation-created role has.
   */
  async openDeleteDialog(name: string): Promise<DeleteConfirmDialog> {
    const rows = await this.readRoles();
    const index = rows.findIndex((row) => row.name === name);
    if (index < 0) throw new Error(`Role "${name}" is not in the list`);
    if (!rows[index].hasDelete) throw new Error(`Role "${name}" has no delete button`);
    if (!rows[index].name.includes(AUTO_TEST_FLAG) && !rows[index].description.includes(AUTO_TEST_FLAG)) {
      throw new Error(`Refusing to delete role "${name}": neither its name nor its description carries "${AUTO_TEST_FLAG}"`);
    }
    await this.rows.nth(index).locator('button.delete').click();
    const dialog = new DeleteConfirmDialog(this.page);
    await dialog.root.waitFor({ state: 'visible' });
    return dialog;
  }
}

/**
 * /admin/role/detail (add) and /admin/role/detail/<encrypted id> (edit).
 * Add posts to /admin/role, edit is a PUT to /admin/role/<encrypted id>.
 * Ids are opaque encrypted tokens, so the edit page is reached by clicking the
 * pencil in the list — never by a numeric id (that is what the sheet says).
 */
export class AdminRoleFormPage extends BasePage {
  readonly heading: Locator;
  readonly labelInput: Locator;
  readonly descriptionInput: Locator;
  readonly cancelLink: Locator;
  readonly saveButton: Locator;

  constructor(page: Page) {
    super(page);
    this.heading = page.locator('.body-content h2').first();
    this.labelInput = page.locator('input[name="label"]');
    this.descriptionInput = page.locator('input[name="description"]');
    this.cancelLink = page.getByRole('link', { name: 'ยกเลิก' });
    this.saveButton = page.getByRole('button', { name: 'บันทึก' });
  }

  /** Where this form posts to (edit: /admin/role/<encrypted id> with a hidden _method=PUT). */
  async action(): Promise<string> {
    return this.labelInput.evaluate((input) => (input.closest('form') as HTMLFormElement).action);
  }

  async openNew(): Promise<void> {
    await this.goto('/admin/role/detail');
    await this.labelInput.waitFor({ state: 'visible' });
  }

  radio(module: RoleModuleKey, level: RoleLevel): Locator {
    return this.page.locator(`input[name="module_permissions[${module}]"][value="${level}"]`);
  }


  /** H5 group title, e.g. "จัดการเนื้อหา". */
  groupHeading(title: string): Locator {
    return this.page.locator('.body-content h5').filter({ hasText: title });
  }

  /** Table rows listed under a group heading. */
  groupRows(title: string): Locator {
    return this.groupHeading(title).first().locator('xpath=following::table[1]//tbody/tr');
  }

  /** Fills the form from `values` (only what is given). */
  async fill(values: RoleFormValues): Promise<void> {
    if (values.label !== undefined) await this.labelInput.fill(values.label);
    if (values.description !== undefined) await this.descriptionInput.fill(values.description);
    for (const [module, level] of Object.entries(values.levels ?? {})) {
      await this.selectLevel(module as RoleModuleKey, level as RoleLevel);
    }
  }

  /**
   * Presses "บันทึก" and returns the response of the form POST/PUT (plain form
   * post: the browser follows the redirect, so this is the 302 or the 4xx/5xx).
   */
  async save(): Promise<Response> {
    const [response] = await Promise.all([
      this.page.waitForResponse((r) => r.request().isNavigationRequest() && ['POST', 'PUT'].includes(r.request().method())),
      this.saveButton.click(),
    ]);
    await this.page.waitForLoadState('load');
    return response;
  }

  /** Selects a level by clicking the visible radio (or its label when the input is styled away). */
  async selectLevel(module: RoleModuleKey, level: RoleLevel): Promise<void> {
    const input = this.radio(module, level);
    if (await input.isVisible()) await input.check();
    else await input.locator('xpath=ancestor::td[1]').click();
  }

  /** Level currently selected for a module, or null. */
  async levelOf(module: RoleModuleKey): Promise<RoleLevel | null> {
    return this.page.evaluate((key) => {
      const checked = document.querySelector<HTMLInputElement>(`input[name="module_permissions[${key}]"]:checked`);
      return (checked?.value as RoleLevel | undefined) ?? null;
    }, module);
  }

  async expectLevels(expected: Partial<Record<RoleModuleKey, RoleLevel>>): Promise<void> {
    for (const [module, level] of Object.entries(expected)) {
      expect(await this.levelOf(module as RoleModuleKey), `level of "${module}"`).toBe(level);
    }
  }
}
