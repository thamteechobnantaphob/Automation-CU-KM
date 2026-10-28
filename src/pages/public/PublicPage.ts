import { expect, Locator, Page, Response } from '@playwright/test';
import { BasePage } from '../BasePage';
import { exactText } from '@utils/strings';

/**
 * Shared chrome of every public page: header menu, footer, back-to-top button
 * and the "รอสักครู่ กำลังเตรียมข้อมูล" page loader. Locators confirmed against
 * the live markup on 2026-09-25 (Bootstrap 5 navbar + offcanvas, jQuery).
 *
 * Public specs must run anonymously — the default admin storageState would
 * change what the site shows — so they start with
 * `test.use({ storageState: ANONYMOUS_SESSION })`.
 */
export class PublicPage extends BasePage {
  readonly navbar: Locator;
  readonly logo: Locator;
  readonly menuToggler: Locator;
  readonly offcanvas: Locator;
  readonly menuCloseButton: Locator;
  readonly searchIcon: Locator;
  readonly userIcon: Locator;
  readonly openDropdownMenu: Locator;
  readonly footer: Locator;
  readonly footerLinks: Locator;
  readonly backToTop: Locator;
  readonly pageLoader: Locator;
  /** Big page title, e.g. "ชุมชนนักปฏิบัติ" (`<div class="header page">`). */
  readonly heading: Locator;

  constructor(page: Page) {
    super(page);
    this.navbar = page.locator('nav.navbar');
    this.logo = this.navbar.locator('.navbar-brand img').first();
    this.menuToggler = this.navbar.locator('.navbar-toggler');
    this.offcanvas = page.locator('#offcanvasNavbar');
    this.menuCloseButton = this.offcanvas.locator('.btn-close');
    this.searchIcon = this.navbar.locator('a[href$="/frontend/search/index"]');
    this.userIcon = this.navbar.locator('a[href$="/frontend/account/index"]');
    this.openDropdownMenu = this.navbar.locator('.dropdown-menu.show');
    this.footer = page.locator('footer.site-footer');
    this.footerLinks = this.footer.locator('a');
    this.backToTop = page.locator('#backToTop');
    this.pageLoader = page.locator('#pageLoader');
    this.heading = page.locator('.body-content .header.page');
  }

  /** Opens a public page and waits until the page loader has faded away. */
  async open(path = '/'): Promise<Response | null> {
    const response = await this.goto(path);
    await this.waitForLoader();
    return response;
  }

  /**
   * The loader gets class "hidden" on window.load, or after a 3 s safety
   * timeout — so a slow third-party asset delays it but never blocks it.
   */
  async waitForLoader(): Promise<void> {
    if (await this.pageLoader.count()) {
      await expect(this.pageLoader).toHaveClass(/\bhidden\b/, { timeout: 10_000 });
    }
  }

  /** Plain top-level menu entry ("หน้าหลัก", "CoPs"). */
  navLink(label: string): Locator {
    return this.navbar.locator('.nav-item > .nav-link').filter({ hasText: exactText(label) });
  }

  /** Top-level dropdown toggle ("Knowledge", "คลังกิจกรรม", "ติดต่อสอบถาม"). */
  dropdownToggle(label: string): Locator {
    return this.navbar.locator('.nav-link.dropdown-toggle').filter({ hasText: exactText(label) });
  }

  /**
   * A link inside a dropdown. Scoped through the toggle because item labels
   * repeat the toggle's own ("คลังกิจกรรม" > "คลังกิจกรรม").
   */
  dropdownItem(toggleLabel: string, itemLabel: string): Locator {
    const owner = this.page.locator('.nav-item.dropdown').filter({
      has: this.page.locator('.nav-link.dropdown-toggle').filter({ hasText: exactText(toggleLabel) }),
    });
    return owner.locator('.dropdown-item').filter({ hasText: exactText(itemLabel) });
  }

  footerLink(label: string): Locator {
    return this.footerLinks.filter({ hasText: exactText(label) });
  }

  async scrollToBottom(): Promise<void> {
    await this.page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
  }

  async scrollY(): Promise<number> {
    return this.page.evaluate(() => Math.round(window.scrollY));
  }

  async hasHorizontalScroll(): Promise<boolean> {
    return this.page.evaluate(() => document.documentElement.scrollWidth > document.documentElement.clientWidth);
  }

  /**
   * Presses Tab from the top of the page until `target` has focus.
   * Returns false if it is never reached within `maxPresses` — which is how a
   * control that keyboard users cannot get to shows up.
   */
  async tabTo(target: Locator, maxPresses = 15): Promise<boolean> {
    for (let press = 0; press < maxPresses; press++) {
      await this.page.keyboard.press('Tab');
      if (await target.evaluate((element) => element === document.activeElement).catch(() => false)) return true;
    }
    return false;
  }
}
