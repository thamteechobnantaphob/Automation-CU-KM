import { expect, Page, Response } from '@playwright/test';
import { AdminGroupPage, CategoryCard, CategoryFormValues, GroupTabKey } from '@pages/admin/AdminGroupPage';
import { urlOf } from '@utils/lowPrivilege';
import { roleStamp } from '@utils/roleFlows';
import { PUBLIC_SECURITY_PAGES } from '@utils/security';
import { AUTO_TEST_FLAG } from '@utils/testData';

/**
 * Shared steps for the category specs (KM-ADMG). Categories can only be removed
 * by `npm run cleanup:categories` (or by hand), so every saved value must be
 * findable and unique:
 *
 *  - the name is the field under test in most cases, so it can't carry the
 *    marker: the "หัวข้อย่อย" (description) line carries "[Auto Test]" instead,
 *    and the cleanup deletes cards that have the marker in either field;
 *  - the name gets a time stamp so each run's category is unique (QA's own
 *    "AUTO_CAT_001" cards, which have no marker, are never touched).
 */

/** The tab the sheet uses for the name cases ("คลังความรู้", empty on Dev). */
export const CATEGORY_TAB: GroupTabKey = 'knowledge';

export const CATEGORY_DESCRIPTION = `${AUTO_TEST_FLAG} หมวดหมู่ทดสอบอัตโนมัติ`;

/** The sheet's sample name made unique for this run: "<sample> <stamp>". */
export function stampedName(sample: string): string {
  return `${sample} ${roleStamp()}`;
}

/** Opens the tab, opens the add panel, fills it and presses "บันทึก". Returns the response of the submit. */
export async function submitNewCategory(
  groupPage: AdminGroupPage,
  values: CategoryFormValues,
  tab: GroupTabKey = CATEGORY_TAB,
): Promise<Response> {
  await groupPage.open(tab);
  await groupPage.openAddForm();
  await groupPage.fill({ description: CATEGORY_DESCRIPTION, ...values });
  return groupPage.save();
}

/** Creates a category and checks it is listed on its tab; returns its card. */
export async function createCategory(
  page: Page,
  groupPage: AdminGroupPage,
  values: CategoryFormValues & { name: string },
  tab: GroupTabKey = CATEGORY_TAB,
): Promise<CategoryCard> {
  const response = await submitNewCategory(groupPage, values, tab);
  expect(response.status(), 'a valid category is saved without a server error').toBeLessThan(500);
  await groupPage.open(tab);
  const card = await groupPage.findCard(values.name);
  expect(card, `category "${values.name.trim()}" should be listed on its tab`).toBeDefined();
  return card as CategoryCard;
}

/**
 * The sheet also expects the name on "the related pages". Categories reach the public site only through content
 * that uses them, so on Dev today none of the ten public pages shows one. This opens each public page and, WHEN
 * one shows the category (its time stamp is in the visible text), requires the name to appear exactly as typed —
 * not truncated, not double-escaped ("&amp;"), not rendered as HTML. Returns where it was shown.
 */
export async function publicDisplay(page: Page, name: string): Promise<{ shownOn: string[]; problems: string[] }> {
  const typed = name.trim();
  const stamp = typed.split(/\s+/).pop() as string;
  const shownOn: string[] = [];
  const problems: string[] = [];
  for (const path of PUBLIC_SECURITY_PAGES) {
    await page.goto(urlOf(path));
    await page.waitForLoadState('load');
    const text = await page.locator('body').innerText();
    if (!text.includes(stamp)) continue;
    shownOn.push(path);
    if (!text.includes(typed)) problems.push(`${path}: shows the category but not as the literal text "${typed}"`);
  }
  return { shownOn, problems };
}

/** Number of categories on a tab in TOTAL (a tab shows only 9 cards per page, so counting the cards on screen would stop at 9). */
export async function cardCount(groupPage: AdminGroupPage, tab: GroupTabKey = CATEGORY_TAB): Promise<number> {
  return groupPage.total(tab);
}
