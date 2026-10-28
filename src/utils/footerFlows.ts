import { Browser, expect, Page, test } from '@playwright/test';
import { ANONYMOUS_SESSION } from '@fixtures/pages.fixtures';
import { AdminHomePage, MenuCard, MenuValues } from '@pages/admin/AdminHomePage';
import { Submitted, submitAndFollow } from '@pages/admin/AdminNewsPages';
import { urlOf } from '@utils/lowPrivilege';
import { roleStamp } from '@utils/roleFlows';
import { collectDialogs } from '@utils/security';
import { AUTO_TEST_FLAG } from '@utils/testData';

/**
 * Shared steps for the footer menu spec (KM-FFTR). The footer items on Dev (หน้าหลัก, Knowledge, …) are the real
 * site footer and are never touched. A case deletes only the items that appeared while it ran (section id not in the
 * list taken before) AND carry its own mark: "[Auto Test]" in the title, or its stamped link when the title is the
 * field under test.
 */

function note(description: string): void {
  test.info().annotations.push({ type: 'note', description });
}

/** "AUTO_FOOTER [Auto Test] <stamp>". */
export function menuTitle(label = 'AUTO_FOOTER'): string {
  return `${label} ${AUTO_TEST_FLAG} ${roleStamp()}`;
}

/** "https://example.com/?auto-test=<stamp>" — identifies the item when its title is under test. */
export function menuLink(): string {
  return `https://example.com/?auto-test=${roleStamp()}`;
}

export interface OwnMenu {
  title?: string;
  link?: string;
}

export async function menuIds(page: Page): Promise<Set<string>> {
  return new Set((await new AdminHomePage(page).menus()).map((m) => m.sectionId));
}

export async function ownMenus(page: Page, before: Set<string>, own: OwnMenu): Promise<MenuCard[]> {
  const menus = await new AdminHomePage(page).menus();
  return menus.filter(
    (m) =>
      !before.has(m.sectionId) &&
      ((own.title !== undefined && own.title.includes(AUTO_TEST_FLAG) && m.editTitle === own.title) || (own.link !== undefined && own.link.includes('auto-test=') && m.editLink === own.link)),
  );
}

/** Deletes the case's own new items (see ownMenus). Never throws; returns how many went. */
export async function deleteOwnMenus(page: Page, before: Set<string>, own: OwnMenu): Promise<number> {
  const home = new AdminHomePage(page);
  let deleted = 0;
  for (let attempt = 0; attempt < 8; attempt++) {
    try {
      const [menu] = await ownMenus(page, before, own);
      if (!menu) break;
      const dialog = await home.openDeleteMenuDialog(menu.sectionId);
      const result = await submitAndFollow(page, () => dialog.confirm());
      if (result.first >= 400 || result.final >= 400) break;
      deleted++;
    } catch {
      break;
    }
  }
  return deleted;
}

export interface MenuError {
  text: string;
  visible: boolean;
}

/** Validation texts on the page right after a save (the link hint left out), with their visibility. */
export async function menuErrors(page: Page): Promise<MenuError[]> {
  return page.locator('#menuMod .text-xsmall, #menuMod .invalid-feedback, #menuMod .text-danger, .alert-danger').evaluateAll((elements) =>
    elements
      .map((e) => ({ text: (e.textContent ?? '').replace(/\s+/g, ' ').trim(), visible: (e as HTMLElement).offsetParent !== null && getComputedStyle(e).visibility === 'visible' }))
      .filter((e) => e.text && !e.text.includes('เว้นว่างได้')),
  );
}

export const shownMenuErrors = (errors: MenuError[]): string => errors.filter((e) => e.visible).map((e) => e.text).join(' ');

export interface MenuRun {
  saved: Submitted;
  created: MenuCard[];
  errors: MenuError[];
  title: string;
  link: string;
}

/**
 * Saves a footer item (title AUTO_FOOTER + marker and a stamped link unless given; column 1, normal, publish), runs
 * `checks`, then deletes the items it created. When the title is under test the stamped link identifies the item.
 */
export async function withMenu(page: Page, values: MenuValues, checks: (run: MenuRun) => Promise<void>): Promise<void> {
  const home = new AdminHomePage(page);
  const before = await menuIds(page);
  const title = values.title ?? menuTitle();
  const link = values.link ?? menuLink();
  try {
    await home.openAddMenu();
    await home.fillMenu({ column: '1', fontWeight: 'normal', status: 'publish', ...values, title, link });
    const saved = await home.saveMenu();
    const errors = await menuErrors(page);
    expect(saved.final, 'saving is not a server error').toBeLessThan(500);
    const created = await ownMenus(page, before, { title, link });
    await checks({ saved, created, errors, title, link });
  } finally {
    note(`Cleanup: deleted ${await deleteOwnMenus(page, before, { title, link })} footer item(s).`);
  }
}

export interface FooterLink {
  text: string;
  href: string | null;
  target: string;
  rel: string;
  heading: boolean;
}

/** The public footer's menu (headings and links), as a visitor sees it. */
export async function publicFooter(browser: Browser): Promise<{ items: FooterLink[]; html: string; dialogs: string[] }> {
  const context = await browser.newContext({ storageState: ANONYMOUS_SESSION });
  try {
    const page = await context.newPage();
    const dialogs = collectDialogs(page);
    await page.goto(urlOf('/'));
    await page.waitForLoadState('load');
    const footer = page.locator('footer.site-footer');
    const items = await footer.locator('.nav-col h4, .nav-col li').evaluateAll((elements) =>
      elements.map((e) => {
        const a = e.querySelector('a');
        return { text: (e.textContent ?? '').replace(/\s+/g, ' ').trim(), href: a ? a.getAttribute('href') : null, target: a?.getAttribute('target') ?? '', rel: a?.getAttribute('rel') ?? '', heading: e.tagName === 'H4' };
      }),
    );
    return { items, html: await footer.innerHTML(), dialogs };
  } finally {
    await context.close();
  }
}
