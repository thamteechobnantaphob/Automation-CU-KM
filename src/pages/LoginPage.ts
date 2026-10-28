import { Locator, Page } from '@playwright/test';
import { BasePage } from './BasePage';

/**
 * /frontend/account/index
 * Locators confirmed against the real screen (see "URL & ข้อสังเกต" sheet):
 *   input[placeholder='Username'], input[type='password'], button[type='submit']
 */
export class LoginPage extends BasePage {
  readonly usernameInput: Locator;
  readonly passwordInput: Locator;
  readonly submitButton: Locator;
  readonly rememberMeCheckbox: Locator;
  /**
   * TODO: confirm the real error-message container against the live app.
   * This broad selector covers the common Bootstrap/Laravel patterns
   * (.alert, .invalid-feedback, [role="alert"]) so the framework keeps
   * working once the exact markup is verified; narrow it down then.
   */
  readonly errorMessage: Locator;

  constructor(page: Page) {
    super(page);
    this.usernameInput = page.getByPlaceholder('Username');
    this.passwordInput = page.locator("input[type='password']");
    this.submitButton = page.locator("button[type='submit']");
    // getByLabel resolves to the actual <input type=checkbox>, which is what
    // needs to receive focus for the Tab-order test (TC-AUTH-04-09) — a
    // getByText() match on the <label> text node would never report focused.
    this.rememberMeCheckbox = page.getByLabel('จดจำการเข้าสู่ระบบ');
    this.errorMessage = page.locator('.alert, .invalid-feedback, [role="alert"]').first();
  }

  async open(): Promise<void> {
    await this.goto('/frontend/account/index');
  }

  async login(username: string, password: string): Promise<void> {
    await this.usernameInput.fill(username);
    await this.passwordInput.fill(password);
    await this.submitButton.click();
  }

  /**
   * Fresh login inside the current context. Tests that LOG OUT must use this
   * (after `context.clearCookies()`) instead of the shared storageState
   * session: logging out destroys that session server-side, so every later
   * test relying on it would land on the login page.
   */
  async loginAndWaitForDashboard(username: string, password: string): Promise<void> {
    await this.open();
    await this.login(username, password);
    await this.page.waitForURL('**/admin/dashboard/index', { timeout: 20_000 });
  }

  async submitWithEnter(username: string, password: string): Promise<void> {
    await this.usernameInput.fill(username);
    await this.passwordInput.fill(password);
    await this.passwordInput.press('Enter');
  }
}
