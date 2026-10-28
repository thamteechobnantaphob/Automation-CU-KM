import { Locator, Page } from '@playwright/test';
import { DEFAULT_TEST_DEPARTMENT, DEFAULT_TEST_NAME, VALID_PASSWORD } from '@utils/testData';
import { exactText } from '@utils/strings';

export interface UserFormValues {
  username?: string;
  name?: string;
  email?: string;
  department?: string;
  position?: string;
  password?: string;
  passwordConfirmation?: string;
  isLdap?: boolean;
  status?: 'active' | 'suspended';
}

/**
 * The "เพิ่มผู้ใช้งาน" / "แก้ไขผู้ใช้งาน" modal on /admin/user/index.
 * Field name/id source: "สเปกฟอร์ม (จากหน้าจอจริง)" sheet, verified 2026-09-21.
 */
export class AdminUserFormModal {
  readonly root: Locator;
  readonly title: Locator;
  readonly usernameInput: Locator;
  readonly nameInput: Locator;
  readonly emailInput: Locator;
  readonly departmentInput: Locator;
  readonly positionInput: Locator;
  readonly rolesSelect: Locator;
  readonly rolesDropdownToggle: Locator;
  readonly ldapCheckbox: Locator;
  readonly passwordInput: Locator;
  readonly passwordConfirmationInput: Locator;
  readonly statusActiveRadio: Locator;
  readonly statusSuspendedRadio: Locator;
  readonly cancelButton: Locator;
  readonly saveButton: Locator;

  constructor(private readonly page: Page) {
    // Confirmed against the real screen 2026-09-24: this renders as a
    // <dialog>/role="dialog" element, NOT Bootstrap's .modal.show/.modal.in
    // (that guess made every locator here time out — waitForOpen() waited
    // 30s for a class that never existed while the dialog sat open on
    // screen the whole time). Scope by role so it works for both the "add"
    // and "edit" variants.
    this.root = page.getByRole('dialog').filter({ hasText: 'ผู้ใช้งาน' });
    this.title = this.root.getByRole('heading');
    this.usernameInput = this.root.locator('#user-username');
    this.nameInput = this.root.locator('#user-name');
    this.emailInput = this.root.locator('#user-email');
    this.departmentInput = this.root.locator('#user-department');
    this.positionInput = this.root.locator("[name='position']");
    this.rolesSelect = this.root.locator("select[name='roles[]']");
    // Confirmed 2026-09-24: the toggle exposes role="combobox" with this
    // accessible name, and the opened list exposes role="option" per choice
    // (used by selectRoles() below) — no need to guess bootstrap-select's
    // internal CSS classes.
    // By the select's id, not by accessible name: once a role is picked the
    // button's name becomes the chosen role(s) instead of "เลือกสิทธิ์การใช้งาน",
    // so a name-based locator stops matching and closing the list times out.
    this.rolesDropdownToggle = this.root.locator('button[data-id="user-roles"]');
    // The real form pairs this with a hidden <input name="is_ldap" value="0">
    // (a standard "unchecked checkbox still submits a value" trick) — a bare
    // [name='is_ldap'] locator matches both and trips Playwright's strict
    // mode. Scope to the actual checkbox by role instead.
    this.ldapCheckbox = this.root.getByRole('checkbox', { name: 'บัญชี AD/LDAP' });
    this.passwordInput = this.root.locator("[name='password']");
    this.passwordConfirmationInput = this.root.locator("[name='password_confirmation']");
    // Same hidden-input-pairing risk as is_ldap above — use role + accessible
    // name instead of a raw [name='is_active'] attribute locator.
    this.statusActiveRadio = this.root.getByRole('radio', { name: 'ใช้งาน', exact: true });
    this.statusSuspendedRadio = this.root.getByRole('radio', { name: 'ระงับการใช้งาน' });
    this.cancelButton = this.root.getByRole('button', { name: 'ยกเลิก' });
    this.saveButton = this.root.getByRole('button', { name: 'บันทึก' });
  }

  async waitForOpen(): Promise<void> {
    await this.root.waitFor({ state: 'visible' });
  }

  async waitForClosed(): Promise<void> {
    await this.root.waitFor({ state: 'hidden' });
  }

  /** Select one or more roles from the bootstrap-select "สิทธิ์การใช้งาน" dropdown. */
  async selectRoles(...roleLabels: string[]): Promise<void> {
    await this.rolesDropdownToggle.click();
    for (const label of roleLabels) {
      // Scoped to the open dropdown: getByRole('option') alone also matches the
      // hidden native <option> inside the <select> (same text), and .click() on
      // that one times out.
      await this.page.locator('.dropdown-menu.show a[role="option"]').filter({ hasText: exactText(label) }).click();
    }
    await this.rolesDropdownToggle.click(); // close the dropdown
  }

  /**
   * Fills the fields under test plus whatever the form requires to submit
   * at all (name + password + confirmation) so single-field validation
   * tests (username/name/email/department/position) don't each repeat the
   * same "fill everything else with a normal value" boilerplate. Name and
   * department carry the [Auto Test] flag (see AUTO_TEST_FLAG) so any user
   * that gets saved can be found and deleted later; passing an explicit
   * value (even '') for a field overrides its default.
   *
   * The default name also carries the username. The user list is sorted by
   * name ONLY, and when many users share a name its pagination becomes
   * unstable (confirmed 2026-09-25: a walk of all pages returned 54 rows for
   * 54 users but only 51 distinct ones — three users invisible, three shown
   * twice), so a user just created could not be found. A unique name per user
   * keeps automation-created rows out of that tie.
   */
  async fillWithDefaults(overrides: UserFormValues): Promise<void> {
    await this.fill({
      name: overrides.username ? `${DEFAULT_TEST_NAME} ${overrides.username}` : DEFAULT_TEST_NAME,
      department: DEFAULT_TEST_DEPARTMENT,
      password: VALID_PASSWORD,
      passwordConfirmation: VALID_PASSWORD,
      ...overrides,
    });
  }

  /**
   * Removes HTML5 client-side validation from the form (sets `novalidate`)
   * so a test can verify the SERVER also rejects bad input, not just the
   * browser (TC-FUSR-04-09).
   */
  async disableClientValidation(): Promise<void> {
    await this.root.locator('form').evaluate((form: HTMLFormElement) => {
      form.noValidate = true;
    });
  }

  async fill(values: UserFormValues): Promise<void> {
    if (values.username !== undefined) await this.usernameInput.fill(values.username);
    if (values.name !== undefined) await this.nameInput.fill(values.name);
    if (values.email !== undefined) await this.emailInput.fill(values.email);
    if (values.department !== undefined) await this.departmentInput.fill(values.department);
    if (values.position !== undefined) await this.positionInput.fill(values.position);
    // Since the 2026-10-01 deploy the form has no password, confirmation or AD/LDAP field (sign-in is by
    // CU NET account). The defaults still pass them, so they are only filled while the field exists.
    if (values.isLdap && (await this.ldapCheckbox.count())) await this.ldapCheckbox.check();
    if (values.password !== undefined && (await this.passwordInput.count())) await this.passwordInput.fill(values.password);
    if (values.passwordConfirmation !== undefined && (await this.passwordConfirmationInput.count())) {
      await this.passwordConfirmationInput.fill(values.passwordConfirmation);
    }
    if (values.status === 'active') await this.statusActiveRadio.check();
    if (values.status === 'suspended') await this.statusSuspendedRadio.check();
  }

  async save(): Promise<void> {
    await this.saveButton.click();
  }

  async cancel(): Promise<void> {
    await this.cancelButton.click();
  }

  async closeWithEscape(): Promise<void> {
    await this.page.keyboard.press('Escape');
  }
}
