import { Browser, expect, Page, Response } from '@playwright/test';
import { ANONYMOUS_SESSION } from '@fixtures/pages.fixtures';
import { AdminCopsPage, CopCard, CopFormValues, CopPostsPage } from '@pages/admin/AdminCopsPages';
import { DeleteConfirmDialog } from '@pages/admin/AdminUserListPage';
import { urlOf } from '@utils/lowPrivilege';
import { roleStamp } from '@utils/roleFlows';
import { collectDialogs } from '@utils/security';
import { AUTO_TEST_FLAG } from '@utils/testData';
import { SEED_COMMUNITY } from '@utils/seedContent';

/**
 * Shared steps for the KM-ADMC specs. Every community/post a test creates is deleted again by the same test
 * (in a `finally`), so Dev keeps only the seeded AUTO_COPS_001 / AUTO_NEWS_001. The field under test is the name
 * (or the post title), so the "[Auto Test]" marker and a per-test stamp go into the description / excerpt — that is
 * how the cleanup finds exactly what this test made, even when the name is blank or mangled by the app.
 */

/** "[Auto Test] ชุมชนทดสอบอัตโนมัติ <stamp>" — unique per call. */
export function copDescription(): string {
  return `${AUTO_TEST_FLAG} ชุมชนทดสอบอัตโนมัติ ${roleStamp()}`;
}

/** "[Auto Test] ข่าวทดสอบอัตโนมัติ <stamp>" — unique per call. */
export function postExcerpt(): string {
  return `${AUTO_TEST_FLAG} ข่าวทดสอบอัตโนมัติ ${roleStamp()}`;
}

/** Opens the add panel, fills it (status "เผยแพร่" unless given) and saves. Returns the response of the post. */
export async function submitNewCop(copsPage: AdminCopsPage, values: CopFormValues & { description: string }): Promise<Response> {
  await copsPage.open();
  await copsPage.openAddForm();
  await copsPage.fill({ status: 'publish', ...values });
  return copsPage.save();
}

/**
 * Presses "ยืนยันลบข้อมูล" and waits for the DELETE form post to come back. The page is already "loaded" before the
 * click, so waiting for the load state alone returns at once — the next goto then aborts the delete (2026-10-02: the
 * KM-ADMC posts were never removed that way).
 */
export async function confirmDelete(page: Page, dialog: DeleteConfirmDialog): Promise<Response> {
  const [response] = await Promise.all([
    page.waitForResponse((r) => r.request().isNavigationRequest() && r.request().method() === 'POST'),
    dialog.confirm(),
  ]);
  await page.waitForLoadState('load');
  return response;
}

/** Deletes every community whose description is `description` (what one test created). Never throws. */
export async function deleteCopsByDescription(copsPage: AdminCopsPage, page: Page, description: string): Promise<number> {
  let deleted = 0;
  for (let attempt = 0; attempt < 5; attempt++) {
    try {
      if (!(await copsPage.findByDescription(description))) break;
      const dialog = await copsPage.openDeleteDialog(description, 'description');
      await confirmDelete(page, dialog);
      deleted++;
    } catch {
      break;
    }
  }
  return deleted;
}

/** Names of the communities a visitor sees on /frontend/cops/index (logged out), plus any dialog that popped up. */
export async function publicCommunities(browser: Browser): Promise<{ text: string; dialogs: string[] }> {
  const context = await browser.newContext({ storageState: ANONYMOUS_SESSION });
  try {
    const page = await context.newPage();
    const dialogs = collectDialogs(page);
    await page.goto(urlOf('/frontend/cops/index'));
    await page.waitForLoadState('load');
    await page.waitForTimeout(300);
    return { text: (await page.locator('body').innerText()).replace(/\s+/g, ' '), dialogs };
  } finally {
    await context.close();
  }
}

/** The public page of the seeded community (its posts), as a visitor sees it. */
export async function publicSeedCommunityPage(browser: Browser): Promise<{ text: string; dialogs: string[]; html: string }> {
  const context = await browser.newContext({ storageState: ANONYMOUS_SESSION });
  try {
    const page = await context.newPage();
    const dialogs = collectDialogs(page);
    await page.goto(urlOf('/frontend/cops/index'));
    const link = page.locator('a[href*="/frontend/cops/"][href$="/index"]', { hasText: SEED_COMMUNITY }).first();
    await page.goto((await link.getAttribute('href')) as string);
    await page.waitForLoadState('load');
    await page.waitForTimeout(300);
    return { text: (await page.locator('body').innerText()).replace(/\s+/g, ' '), dialogs, html: await page.locator('body').innerHTML() };
  } finally {
    await context.close();
  }
}

/** Opens the posts page of the seeded community from the admin list. */
export async function openSeedPosts(copsPage: AdminCopsPage, page: Page): Promise<CopCard> {
  const card = await copsPage.findCard(SEED_COMMUNITY);
  expect(card, `the seeded community ${SEED_COMMUNITY} is listed`).toBeDefined();
  await page.goto((card as CopCard).postsHref);
  return card as CopCard;
}

/**
 * Deletes every post on the seeded community's posts page whose excerpt is `excerpt`. Never throws; returns how many
 * were deleted and, when the app refused, the HTTP status (DEF-53: DELETE /admin/cops/<id>/posts/<id> answers 404).
 */
export async function deletePostsByExcerpt(
  copsPage: AdminCopsPage,
  postsPage: CopPostsPage,
  page: Page,
  excerpt: string,
): Promise<{ deleted: number; refused?: number }> {
  let deleted = 0;
  for (let attempt = 0; attempt < 5; attempt++) {
    try {
      await openSeedPosts(copsPage, page);
      const post = (await postsPage.readCards()).find((card) => card.excerpt === excerpt);
      if (!post) break;
      const dialog = await postsPage.openDeleteDialog(post.title);
      const response = await confirmDelete(page, dialog);
      if (response.status() >= 400) return { deleted, refused: response.status() };
      deleted++;
    } catch {
      break;
    }
  }
  return { deleted };
}
