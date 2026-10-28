import { Browser, expect, Page, test } from '@playwright/test';
import { ANONYMOUS_SESSION } from '@fixtures/pages.fixtures';
import { AdminGroupPage } from '@pages/admin/AdminGroupPage';
import { AdminNewsListPage, ContentModule, NEWS_MODULE, NewsCard, NewsFormPage, NewsFormValues, Submitted, submitAndFollow } from '@pages/admin/AdminNewsPages';
import { CATEGORY_DESCRIPTION } from '@utils/categoryFlows';
import { urlOf } from '@utils/lowPrivilege';
import { roleStamp } from '@utils/roleFlows';
import { collectDialogs } from '@utils/security';
import { AUTO_TEST_FLAG } from '@utils/testData';

/**
 * Shared steps for the content-module specs (KM-NEWS/FNEW, KM-KNOW/FKNO; every function takes the module, default
 * news). Every news item a test saves is deleted again by the same test (in a
 * `finally`), so Dev keeps only the seeded AUTO_NEWS_001. The title is the field under test, so the "[Auto Test]"
 * marker and a per-test stamp go into the excerpt — that is how the cleanup finds exactly what this test made. Tags
 * cannot be removed from the system (no admin page), so test tags are plain words or the sheet's payload.
 */

/** "[Auto Test] ข่าวทดสอบอัตโนมัติ <stamp>" — unique per call. */
export function newsExcerpt(): string {
  return `${AUTO_TEST_FLAG} ข่าวทดสอบอัตโนมัติ ${roleStamp()}`;
}

/** Opens the create form, fills it (excerpt = a fresh marker unless given, body "เนื้อหาทดสอบ") and saves. */
export async function submitNews(page: Page, values: NewsFormValues, module: ContentModule = NEWS_MODULE): Promise<{ excerpt: string; submitted: Submitted }> {
  const form = new NewsFormPage(page, module);
  const excerpt = values.excerpt ?? newsExcerpt();
  await form.openCreate();
  await form.fill({ body: '<p>เนื้อหาทดสอบ</p>', ...values, excerpt });
  return { excerpt, submitted: await form.save() };
}

/** Presses "ยืนยันลบข้อมูล" and follows the delete post through its redirect. */
export async function confirmNewsDelete(page: Page, excerpt: string, module: ContentModule = NEWS_MODULE): Promise<Submitted> {
  const dialog = await new AdminNewsListPage(page, module).openDeleteDialog(excerpt);
  return submitAndFollow(page, () => dialog.confirm());
}

/** Deletes every news item that matches (marker required). Never throws; returns how many went. */
export async function deleteNewsWhere(page: Page, match: (card: NewsCard) => boolean, module: ContentModule = NEWS_MODULE): Promise<number> {
  const list = new AdminNewsListPage(page, module);
  let deleted = 0;
  for (let attempt = 0; attempt < 5; attempt++) {
    try {
      if (!(await list.locate(match))) break;
      const dialog = await list.openDeleteDialogWhere(match);
      const result = await submitAndFollow(page, () => dialog.confirm());
      if (result.final >= 400 || result.first >= 400) break;
      deleted++;
    } catch {
      break;
    }
  }
  return deleted;
}

/** Deletes every news item whose excerpt is `excerpt`. Never throws; returns how many went. */
export async function deleteNewsByExcerpt(page: Page, excerpt: string, module: ContentModule = NEWS_MODULE): Promise<number> {
  return deleteNewsWhere(page, (card) => card.excerpt === excerpt, module);
}

export interface PublicView {
  status: number;
  url: string;
  text: string;
  html: string;
  dialogs: string[];
}

async function asVisitor<T>(browser: Browser, work: (page: Page) => Promise<T>): Promise<T> {
  const context = await browser.newContext({ storageState: ANONYMOUS_SESSION });
  try {
    return await work(await context.newPage());
  } finally {
    await context.close();
  }
}

async function view(page: Page, status: number, dialogs: string[]): Promise<PublicView> {
  await page.waitForLoadState('load');
  await page.waitForTimeout(300);
  return {
    status,
    url: page.url(),
    text: (await page.locator('body').innerText()).replace(/\s+/g, ' '),
    html: await page.locator('body').innerHTML(),
    dialogs,
  };
}

/** The module's public list (e.g. /frontend/news/index) as a visitor sees it. */
export async function publicNewsList(browser: Browser, module: ContentModule = NEWS_MODULE): Promise<PublicView> {
  return asVisitor(browser, async (page) => {
    const dialogs = collectDialogs(page);
    const response = await page.goto(urlOf(module.publicIndex));
    return view(page, response?.status() ?? 0, dialogs);
  });
}

/**
 * The public detail page of the item whose list card shows `excerpt` (detail URLs are slugs made from the title, so
 * the link is found on the list, not built). `undefined` when the item is not on the public list.
 */
export async function publicNewsDetail(browser: Browser, excerpt: string, module: ContentModule = NEWS_MODULE): Promise<PublicView | undefined> {
  return asVisitor(browser, async (page) => {
    const dialogs = collectDialogs(page);
    await page.goto(urlOf(module.publicIndex));
    const link = page.locator(`a[href*="${module.publicDetail}"]`, { hasText: excerpt }).first();
    if (!(await link.count())) return undefined;
    const response = await page.goto((await link.getAttribute('href')) as string);
    return view(page, response?.status() ?? 0, dialogs);
  });
}

/** What the public detail page shows of an item's media (read from the DOM, URLs absolute). */
export interface PublicMedia {
  /** Links of the "เอกสารแนบ" block (…/attachments/<id>/download). */
  documents: { name: string; href: string; target: string }[];
  /** <video> sources (uploaded video files). */
  videos: string[];
  /** Embedded players (video links). */
  embeds: { src: string; sandbox: string | null; allow: string | null; width: number; height: number }[];
  /** The cover image (the <img> whose alt is the title), "" when none. */
  cover: string;
  /** Every <img> inside the article body (rich-text content). */
  bodyImages: string[];
  /** The view counter next to the eye icon (null when not shown). */
  views: number | null;
  /** How far the page is wider than the window (0 = no horizontal scroll). */
  overflowX: number;
}

export async function readPublicMedia(page: Page, title: string): Promise<PublicMedia> {
  return page.evaluate((itemTitle) => {
    const abs = (url: string | null): string => (url ? new URL(url, location.href).href : '');
    const body = document.querySelector('.content-body, .article-content, .detail-content, article') ?? document.body;
    return {
      documents: [...document.querySelectorAll('a[href*="/attachments/"]')].map((a) => ({
        name: (a.textContent ?? '').replace(/\s+/g, ' ').trim(),
        href: (a as HTMLAnchorElement).href,
        target: a.getAttribute('target') ?? '',
      })),
      videos: [...document.querySelectorAll('video')].map((v) => abs(v.getAttribute('src') ?? v.querySelector('source')?.getAttribute('src') ?? '')),
      embeds: [...document.querySelectorAll('iframe')].map((f) => ({
        src: f.src,
        sandbox: f.getAttribute('sandbox'),
        allow: f.getAttribute('allow'),
        width: f.getBoundingClientRect().width,
        height: f.getBoundingClientRect().height,
      })),
      cover: abs(
        ([...document.querySelectorAll('img')].find((img) => img.getAttribute('alt')?.trim() === itemTitle.trim()) ??
          [...document.querySelectorAll('img')].find((img) => /\/covers\//.test(img.getAttribute('src') ?? '')))?.getAttribute('src') ?? '',
      ),
      bodyImages: [...body.querySelectorAll('img')].map((img) => img.getAttribute('src') ?? '').filter((src) => !/\/images\/icon\//.test(src)),
      views: (() => {
        const eye = document.querySelector('img[src*="Eye"]');
        const text = (eye?.parentElement?.parentElement?.textContent ?? '').replace(/[^\d]/g, '');
        return text ? Number(text) : null;
      })(),
      overflowX: Math.max(0, document.documentElement.scrollWidth - window.innerWidth),
    };
  }, title);
}

/** Status, type and disposition of a URL as a visitor (no cookies) gets it. */
export async function fetchAsVisitor(browser: Browser, url: string): Promise<{ status: number; type: string; disposition: string; body: Buffer }> {
  return asVisitor(browser, async (page) => {
    const response = await page.request.get(url, { maxRedirects: 0 });
    return {
      status: response.status(),
      type: response.headers()['content-type'] ?? '',
      disposition: response.headers()['content-disposition'] ?? '',
      body: await response.body().catch(() => Buffer.alloc(0)),
    };
  });
}

/** The public detail page of the item listed with `excerpt`, plus its media; `undefined` when not on the list. */
export async function publicContentDetail(browser: Browser, excerpt: string, title: string, module: ContentModule = NEWS_MODULE, viewport?: { width: number; height: number }): Promise<(PublicView & { media: PublicMedia }) | undefined> {
  return asVisitor(browser, async (page) => {
    if (viewport) await page.setViewportSize(viewport);
    const dialogs = collectDialogs(page);
    await page.goto(urlOf(module.publicIndex));
    const link = page.locator(`a[href*="${module.publicDetail}"]`, { hasText: excerpt }).first();
    if (!(await link.count())) return undefined;
    const response = await page.goto((await link.getAttribute('href')) as string);
    const shown = await view(page, response?.status() ?? 0, dialogs);
    return { ...shown, media: await readPublicMedia(page, title) };
  });
}

/** The image of the item's card on the module's public list ("" when the item is not listed). */
export async function publicListCover(browser: Browser, excerpt: string, module: ContentModule = NEWS_MODULE): Promise<string> {
  return asVisitor(browser, async (page) => {
    await page.goto(urlOf(module.publicIndex));
    const link = page.locator(`a[href*="${module.publicDetail}"]`, { hasText: excerpt }).first();
    if (!(await link.count())) return '';
    return link.evaluate((a) => {
      let node: Element | null = a;
      // Walk up to the card that holds both the text and the picture.
      while (node && !node.querySelector('img')) node = node.parentElement;
      return (node?.querySelector('img') as HTMLImageElement | null)?.src ?? '';
    });
  });
}

/** The slug the app makes from an ASCII title ("AUTO_FKNO_001 abc" → "auto-fkno-001-abc"). */
export function slugOf(title: string): string {
  return title.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
}

/** GET of a public path as a visitor: status and body text (follows redirects). */
export async function visitorGet(browser: Browser, path: string): Promise<{ status: number; text: string; url: string }> {
  return asVisitor(browser, async (page) => {
    const response = await page.goto(urlOf(path));
    return { status: response?.status() ?? 0, text: (await page.locator('body').innerText()).replace(/\s+/g, ' '), url: page.url() };
  });
}

/** Opens the edit form of the item listed with `excerpt`, fills `values` and saves. */
export async function editContentItem(page: Page, module: ContentModule, excerpt: string, values: NewsFormValues): Promise<Submitted> {
  const found = await new AdminNewsListPage(page, module).findByExcerpt(excerpt);
  if (!found) throw new Error(`No ${module.key} item with excerpt "${excerpt}"`);
  const form = new NewsFormPage(page, module);
  await form.openEdit(found.editHref);
  await form.fill(values);
  return form.save();
}

/** Opens the edit form of the item listed with `excerpt` (and returns the form). */
export async function openEditFor(page: Page, module: ContentModule, excerpt: string): Promise<NewsFormPage> {
  const found = await new AdminNewsListPage(page, module).findByExcerpt(excerpt);
  if (!found) throw new Error(`No ${module.key} item with excerpt "${excerpt}"`);
  const form = new NewsFormPage(page, module);
  await form.openEdit(found.editHref);
  return form;
}

/** Creates a published category on the module's tab (news: cms) whose description carries the marker; returns its name. */
export async function createNewsCategory(page: Page, label: string, module: ContentModule = NEWS_MODULE): Promise<string> {
  const groupPage = new AdminGroupPage(page);
  const name = `${label} ${roleStamp()}`;
  await groupPage.open(module.categoryTab);
  await groupPage.openAddForm();
  await groupPage.fill({ name, description: CATEGORY_DESCRIPTION, status: 'publish' });
  expect((await groupPage.save()).status(), 'saving the test category').toBeLessThan(500);
  return name;
}

/** Deletes a test category of the cms tab by name (refused unless it carries the marker). Never throws. */
export async function deleteNewsCategory(page: Page, name: string, module: ContentModule = NEWS_MODULE): Promise<boolean> {
  try {
    const groupPage = new AdminGroupPage(page);
    await groupPage.open(module.categoryTab);
    const dialog = await groupPage.openDeleteDialog(name);
    await submitAndFollow(page, () => dialog.confirm());
    await groupPage.open(module.categoryTab);
    return !(await groupPage.findCard(name));
  } catch {
    return false;
  }
}

/** "[Auto Test] <label> <stamp>" — the cleanup marker for an item whose excerpt is not under test. */
export function contentMarker(label = 'บทความทดสอบอัตโนมัติ'): string {
  return `${AUTO_TEST_FLAG} ${label} ${roleStamp()}`;
}

/**
 * Saves an item of `module` (body "เนื้อหาทดสอบ" unless given), runs `checks` while it exists, then deletes it. By
 * default the excerpt is a fresh marker and the cleanup matches it; pass `match` when the excerpt is under test (then
 * put the marker in the title). Writes a "Cleanup: …" note.
 */
export async function withContentItem(
  page: Page,
  module: ContentModule,
  values: NewsFormValues,
  checks: (excerpt: string) => Promise<void>,
  match?: (card: NewsCard) => boolean,
): Promise<void> {
  const excerpt = values.excerpt ?? contentMarker();
  try {
    const { submitted } = await submitNews(page, { body: '<p>เนื้อหาทดสอบ</p>', ...values, excerpt }, module);
    expect(submitted.final, 'saving is not a server error').toBeLessThan(500);
    await checks(excerpt);
  } finally {
    const deleted = await deleteNewsWhere(page, match ?? ((card) => card.excerpt === excerpt), module);
    test.info().annotations.push({ type: 'note', description: `Cleanup: deleted ${deleted} item(s).` });
  }
}
