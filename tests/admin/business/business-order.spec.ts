import { test, expect, ANONYMOUS_SESSION } from '@fixtures/pages.fixtures';
import { requireDataCreatingTestsAllowed } from '@config/env';
import { AdminFaqPage } from '@pages/admin/AdminFaqPage';
import { AdminGroupPage } from '@pages/admin/AdminGroupPage';
import { AdminHomePage } from '@pages/admin/AdminHomePage';
import { KNOWLEDGE_MODULE, submitAndFollow } from '@pages/admin/AdminNewsPages';
import { AdminSitemapPage, PUBLIC_SITEMAP_PATH } from '@pages/admin/AdminSitemapPage';
import { albumMarker, byDescription, deleteAlbumsWhere, publicActivity, submitAlbum, ALBUM_IMAGE } from '@utils/activityFlows';
import { sheetTitle } from '@utils/caseTitles';
import { createFaqCategory, deleteFaqCategories, deleteFaqWhere, faqMarker, publicFaq, submitFaq } from '@utils/faqFlows';
import { deleteOwnMenus, menuIds, menuLink, menuTitle, publicFooter } from '@utils/footerFlows';
import { urlOf } from '@utils/lowPrivilege';
import { deleteNewsByExcerpt, publicContentDetail, submitNews } from '@utils/newsFlows';
import { roleStamp } from '@utils/roleFlows';
import { collectDialogs } from '@utils/security';
import { deleteOwnSlides, publicHero, slideIds, slideLink, SLIDE_IMAGE } from '@utils/slideFlows';
import { AUTO_TEST_FLAG, NEEDS_LDAP_ACCOUNT } from '@utils/testData';
import { Locator, Page } from '@playwright/test';

/**
 * Business rules (Auto:P, user decision 2026-10-08) — ordering and small features: slides, footer menu and FAQ order
 * (SortableJS: drag the `.card-drag` handle, the list POSTs the new id order to …/reorder at once), category / sitemap
 * order, the breadcrumb of an article and the album lightbox. Checked on the Dev reset of 2026-10-08. Everything a
 * case saves carries "[Auto Test]" (slides: a stamped link) and is deleted again; the footer column a case reorders also
 * holds Dev's real items, so the case posts the column's original order back in `finally`.
 */

const CREATES = 'Saves slides / footer items / FAQs / albums / an article (deleted again at the end of the case).';
const KNOWN = {
  NO_CATEGORY_ORDER: 'Known bug (DEF-124): categories (knowledge / FAQ tabs of "หมวดหมู่") have no ordering — no drag handle, no order field; the sheet expects to reorder them.',
  SITEMAP_ONE_PAGE: 'Known bug (DEF-111): the sitemap is one rich-text page — there are no entries to order.',
  NO_BACK_LINK: 'Bug (no DEF yet — seen working 2026-10-08): the public article page has no breadcrumb / back link to its list.',
  NO_LIGHTBOX: 'Bug (no DEF yet — seen working 2026-10-08): the public album page has no lightbox — clicking an image does not enlarge it (no previous / next / Esc).',
};

test.beforeEach(() => test.setTimeout(300_000));

function note(description: string): void {
  test.info().annotations.push({ type: 'note', description });
}

/** Drags `handle` onto the first quarter of `target` (SortableJS) and returns the JSON the list posts to `urlPart`. */
async function dragOnto(page: Page, handle: Locator, target: Locator, urlPart: string): Promise<Record<string, unknown>> {
  await handle.scrollIntoViewIfNeeded();
  const posted = page.waitForRequest((r) => r.method() === 'POST' && r.url().includes(urlPart), { timeout: 20_000 });
  const a = (await handle.boundingBox())!;
  const b = (await target.boundingBox())!;
  await page.mouse.move(a.x + a.width / 2, a.y + a.height / 2);
  await page.mouse.down();
  await page.mouse.move(a.x + a.width / 2 + 6, a.y + a.height / 2 + 6, { steps: 4 });
  // Hover the target's middle, let SortableJS animate (150 ms), then its leading edge: the item lands before it.
  await page.mouse.move(b.x + b.width / 2, b.y + b.height / 2, { steps: 20 });
  await page.waitForTimeout(400);
  const moved = (await target.boundingBox()) ?? b;
  await page.mouse.move(moved.x + Math.min(8, moved.width * 0.1), moved.y + Math.min(6, moved.height * 0.1), { steps: 10 });
  await page.waitForTimeout(400);
  await page.mouse.up();
  const request = await posted;
  await page.waitForTimeout(800);
  return request.postDataJSON() as Record<string, unknown>;
}

/** Posts an order like the page does (its own CSRF token). Used to put a shared list back. */
async function postOrder(page: Page, path: string, body: Record<string, unknown>): Promise<number> {
  return page.evaluate(
    async ({ url, data }) => {
      const token = document.querySelector<HTMLMetaElement>('meta[name="csrf-token"]')?.content ?? '';
      const response = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-CSRF-TOKEN': token, Accept: 'application/json' }, body: JSON.stringify(data) });
      return response.status;
    },
    { url: urlOf(path), data: body },
  );
}

/** Saves `count` slides with stamped links; runs `work` with the links in admin order; deletes them and restores the hero order. */
async function withSlides(page: Page, count: number, work: (links: string[]) => Promise<void>): Promise<void> {
  requireDataCreatingTestsAllowed(CREATES);
  const home = new AdminHomePage(page);
  await home.open();
  const before = await slideIds(page);
  const originalOrder = (await home.slides()).map((s) => s.sectionId);
  const links = Array.from({ length: count }, () => slideLink());
  try {
    for (const link of links) {
      await home.openAddSlide();
      await home.fill({ image: SLIDE_IMAGE, status: 'publish', link });
      expect((await home.save()).final, 'saving a slide').toBeLessThan(500);
    }
    await home.open();
    const own = (await home.slides()).filter((s) => !before.has(s.sectionId) && links.includes(s.editLink));
    expect(own.length, `${count} slides saved`).toBe(count);
    await work(links);
  } finally {
    let deleted = 0;
    for (const link of links) deleted += await deleteOwnSlides(page, before, { link });
    if (originalOrder.length > 1) note(`Hero order restored: HTTP ${await postOrder(page, '/admin/home-sections/reorder', { type: 'hero', ids: originalOrder })}`);
    note(`Cleanup: deleted ${deleted} slide(s).`);
  }
}

/** The case's own slides in admin order (by link). */
async function adminSlideOrder(page: Page, links: string[]): Promise<string[]> {
  const home = new AdminHomePage(page);
  await home.open();
  return (await home.slides()).map((s) => s.editLink).filter((l) => links.includes(l));
}

async function publicSlideOrder(browser: Parameters<typeof publicHero>[0], links: string[]): Promise<string[]> {
  return (await publicHero(browser)).slides.map((s) => s.href).filter((h) => links.includes(h));
}

async function slideReorderCase(page: Page, browser: Parameters<typeof publicHero>[0], count: number): Promise<void> {
  await withSlides(page, count, async (links) => {
    const before = await adminSlideOrder(page, links);
    const home = new AdminHomePage(page);
    const cards = (link: string): Locator => home.slideCards.filter({ has: page.locator(`.js-edit-slide[data-link="${link}"]`) });
    const last = before[before.length - 1];
    const posted = await dragOnto(page, cards(last).locator('.card-drag'), cards(before[0]), '/home-sections/reorder');
    note(`Posted ${JSON.stringify(posted)}`);
    const after = await adminSlideOrder(page, links);
    note(`Admin order ${JSON.stringify(before)} → ${JSON.stringify(after)}`);
    expect(after[0], 'the moved slide is first after a reload (order saved)').toBe(last);
    expect(await publicSlideOrder(browser, links), 'the home page shows the slides in the admin order').toEqual(after);
  });
}

// ---------------------------------------------------------------------------------------------------------------

test.describe('BR ลำดับสไลด์ / ส่วนท้าย / FAQ', () => {
  test(sheetTitle('TC-ADMH-01-04'), async ({ page, browser }) => {
    await withSlides(page, 2, async (links) => {
      const home = new AdminHomePage(page);
      const card = (link: string): Locator => home.slideCards.filter({ has: page.locator(`.js-edit-slide[data-link="${link}"]`) });
      // Edit: the slide's only text-like field is its link (there is no slide text — DEF-77).
      const edited = slideLink();
      const id = (await home.slides()).find((s) => s.editLink === links[0])!.sectionId;
      await home.openEditSlide(id);
      await home.linkInput.fill(edited);
      expect((await home.save()).final, 'saving the edit').toBeLessThan(500);
      links[0] = edited;
      let order = await adminSlideOrder(page, links);
      expect(order, 'the edited link is stored').toContain(edited);
      // Reorder.
      await dragOnto(page, card(order[1]).locator('.card-drag'), card(order[0]), '/home-sections/reorder');
      const reordered = await adminSlideOrder(page, links);
      note(`Order ${JSON.stringify(order)} → ${JSON.stringify(reordered)}`);
      expect(reordered[0], 'the second slide is first now').toBe(order[1]);
      expect(await publicSlideOrder(browser, links), 'the home page follows the edit and the order').toEqual(reordered);
      // Delete one.
      const gone = reordered[0];
      const dialog = await home.openDeleteDialog((await home.slides()).find((s) => s.editLink === gone)!.sectionId);
      await submitAndFollow(page, () => dialog.confirm());
      order = await adminSlideOrder(page, links);
      expect(order, 'deleted from the admin list').not.toContain(gone);
      expect(await publicSlideOrder(browser, links), 'and from the home page').toEqual(order);
    });
  });

  test(sheetTitle('TC-ADMH-05-01'), async ({ page, browser }) => {
    await slideReorderCase(page, browser, 3);
  });

  test(sheetTitle('TC-FSLD-05-05'), async ({ page, browser }) => {
    await slideReorderCase(page, browser, 3);
  });

  test(sheetTitle('TC-FFTR-05-03'), async ({ page, browser }) => {
    requireDataCreatingTestsAllowed(CREATES);
    const home = new AdminHomePage(page);
    await home.open('?tab=footer');
    const before = await menuIds(page);
    const column = '3';
    const originalOrder = (await home.menus()).filter((m) => m.column === column).map((m) => m.sectionId);
    const titles = [1, 2, 3].map((i) => menuTitle(`AUTO_ORDER_${i}`));
    try {
      for (const title of titles) {
        await home.openAddMenu();
        await home.fillMenu({ title, link: menuLink(), column, fontWeight: 'normal', status: 'publish' });
        expect((await home.saveMenu()).final, 'saving a footer item').toBeLessThan(500);
      }
      const ownOrder = async (): Promise<string[]> => {
        await home.open('?tab=footer');
        return (await home.menus()).filter((m) => titles.includes(m.editTitle)).map((m) => m.editTitle);
      };
      const start = await ownOrder();
      const card = (title: string): Locator => page.locator(`.footer-sortable-list[data-column="${column}"] [data-section-id]`).filter({ hasText: title });
      // In the vertical footer column SortableJS drops the item just after the hovered one, so only check that the
      // order changed, was saved, and is the one the public footer shows.
      const posted = await dragOnto(page, card(start[2]).locator('.card-drag'), card(start[0]), '/home-sections/reorder');
      note(`Posted ${JSON.stringify(posted)}`);
      const after = await ownOrder();
      note(`Admin order ${JSON.stringify(start)} → ${JSON.stringify(after)}`);
      expect(after, 'the new order is kept after a reload').not.toEqual(start);
      expect(after.indexOf(start[2]), 'the moved item went up').toBeLessThan(2);
      const shown = (await publicFooter(browser)).items.map((i) => i.text).filter((t) => titles.includes(t));
      expect(shown, 'the public footer shows the admin order').toEqual(after);
    } finally {
      let deleted = 0;
      for (const title of titles) deleted += await deleteOwnMenus(page, before, { title });
      await home.open('?tab=footer');
      note(`Cleanup: deleted ${deleted} footer item(s); column ${column} order restored: HTTP ${await postOrder(page, '/admin/home-sections/reorder', { type: 'footer', column, ids: originalOrder })}`);
      const now = (await home.menus()).filter((m) => m.column === column).map((m) => m.sectionId);
      expect(now, `Dev's own footer items keep their order`).toEqual(originalOrder);
    }
  });

  test(sheetTitle('TC-ADMF-05-05'), async ({ page, browser }) => {
    requireDataCreatingTestsAllowed(CREATES);
    const faq = new AdminFaqPage(page);
    const category = await createFaqCategory(page, `${AUTO_TEST_FLAG} หมวดลำดับ`);
    const answers = [1, 2, 3].map(() => faqMarker());
    const questions = answers.map((_, i) => `${AUTO_TEST_FLAG} คำถามลำดับ ${i + 1} ${roleStamp()}`);
    await faq.open();
    const originalOrder = (await faq.readCards()).map((c) => c.id);
    try {
      for (let i = 0; i < 3; i++) expect((await submitFaq(page, { question: questions[i], answer: answers[i], category })).final).toBeLessThan(500);
      const ownOrder = async (): Promise<string[]> => {
        await faq.open();
        return (await faq.readCards()).map((c) => c.question).filter((q) => questions.includes(q));
      };
      const start = await ownOrder();
      const card = (q: string): Locator => faq.cards.filter({ hasText: q });
      await dragOnto(page, card(start[2]).locator('.card-drag'), card(start[0]), '/admin/faq/reorder');
      const after = await ownOrder();
      note(`Admin order ${JSON.stringify(start)} → ${JSON.stringify(after)}`);
      expect(after[0], 'the moved FAQ is first after a reload').toBe(start[2]);
      const shown = (await publicFaq(browser)).questions.filter((q) => questions.some((own) => q.includes(own)));
      note(`Public order ${JSON.stringify(shown)}`);
      expect(shown.map((q) => questions.find((own) => q.includes(own))), 'the public FAQ list follows the admin order').toEqual(after);
    } finally {
      let deleted = 0;
      for (const answer of answers) deleted += await deleteFaqWhere(page, (c) => c.editAnswer === answer);
      if (originalOrder.length > 1) {
        await faq.open();
        note(`FAQ order restored: HTTP ${await postOrder(page, '/admin/faq/reorder', { ids: originalOrder })}`);
      }
      note(`Cleanup: deleted ${deleted} FAQ(s) and ${await deleteFaqCategories(page, category)} categor(ies).`);
    }
  });
});

test.describe('BR ลำดับหมวดหมู่และแผนผัง', () => {
  for (const [id, tab] of [['TC-ADMG-04-06', 'knowledge'], ['TC-FFAQ-05-13', 'faq']] as const) {
    test(sheetTitle(id), async ({ page }) => {
      const group = new AdminGroupPage(page);
      await group.open(tab);
      const handles = await page.locator('.body-content .card-drag, .body-content [class*="sortable"], .body-content input[name*="order" i], .body-content input[name*="sort" i]').count();
      const scripts = await page.evaluate(() => [...document.scripts].some((s) => /reorder|Sortable\.create/.test(s.textContent ?? '')));
      note(`Tab "${tab}": drag handles / order fields ${handles}; reorder script ${scripts}`);
      test.fail(handles === 0 && !scripts, KNOWN.NO_CATEGORY_ORDER);
      expect(handles > 0 || scripts, 'the categories can be put in order').toBe(true);
    });
  }

  test(sheetTitle('TC-ADMS-02-07'), async ({ page }) => {
    const sitemap = new AdminSitemapPage(page);
    await sitemap.open();
    const entries = await page.locator('.body-content [data-id], .body-content .card-drag, .body-content table tbody tr').count();
    const visitor = await page.context().browser()!.newContext({ storageState: ANONYMOUS_SESSION });
    let publicLinks = 0;
    try {
      const p = await visitor.newPage();
      await p.goto(urlOf(PUBLIC_SITEMAP_PATH));
      publicLinks = await p.locator('.body-content a, main a').count();
    } finally {
      await visitor.close();
    }
    note(`Admin entries / handles: ${entries}; public sitemap links: ${publicLinks}`);
    test.fail(entries === 0, KNOWN.SITEMAP_ONE_PAGE);
    expect(entries, 'the sitemap has entries that can be put in order').toBeGreaterThan(0);
  });
});

test.describe('BR ฟีเจอร์หน้า Public', () => {
  test(sheetTitle('TC-FEK-03-08'), async ({ page, browser }) => {
    requireDataCreatingTestsAllowed(CREATES);
    const title = `AUTO_BACK ${roleStamp()}`;
    const { excerpt, submitted } = await submitNews(page, { title, status: 'publish' }, KNOWLEDGE_MODULE);
    try {
      expect(submitted.final).toBeLessThan(500);
      const detail = await publicContentDetail(browser, excerpt, title, KNOWLEDGE_MODULE);
      expect(detail, 'the article is on the public list').toBeTruthy();
      const context = await browser.newContext({ storageState: ANONYMOUS_SESSION });
      try {
        const visitor = await context.newPage();
        await visitor.goto(detail!.url);
        const back = visitor.locator('.breadcrumb a, nav[aria-label*="breadcrumb" i] a, a.btn-back, a:has-text("ย้อนกลับ"), a:has-text("กลับ")').filter({ hasNot: visitor.locator('header *') });
        const toList = visitor.locator('.body-content a[href*="/frontend/knowledge/index"], main a[href*="/frontend/knowledge/index"]');
        const found = (await back.count()) + (await toList.count());
        note(`Breadcrumb / back links: ${await back.count()}; content links to the list: ${await toList.count()}`);
        test.fail(found === 0, KNOWN.NO_BACK_LINK);
        expect(found, 'a breadcrumb / back link to the list').toBeGreaterThan(0);
        // Prefer the link that names the list (the breadcrumb also links "หน้าหลัก").
        await ((await toList.count()) ? toList.first() : back.last()).click();
        await visitor.waitForLoadState('load');
        expect(visitor.url(), 'it leads back to the list').toContain('/frontend/knowledge/index');
      } finally {
        await context.close();
      }
    } finally {
      await deleteNewsByExcerpt(page, excerpt, KNOWLEDGE_MODULE);
    }
  });

  test(sheetTitle('TC-FEN-03-06'), async ({ page, browser }) => {
    requireDataCreatingTestsAllowed(CREATES);
    const description = albumMarker();
    const title = `AUTO_LIGHTBOX ${roleStamp()}`;
    try {
      expect((await submitAlbum(page, { title, description, images: [ALBUM_IMAGE, ALBUM_IMAGE, ALBUM_IMAGE], status: 'publish' })).final).toBeLessThan(500);
      const album = (await publicActivity(browser)).albums.find((a) => a.title === title);
      expect(album, 'the album is on the public page').toBeTruthy();
      const context = await browser.newContext({ storageState: ANONYMOUS_SESSION });
      try {
        const visitor = await context.newPage();
        const dialogs = collectDialogs(visitor);
        await visitor.goto(album!.href);
        await visitor.waitForLoadState('load');
        const images = visitor.locator('.body-content img, main img').filter({ hasNot: visitor.locator('[src*="/icon/"]') });
        note(`Images on the album page: ${await images.count()}`);
        await images.first().click({ timeout: 10_000 }).catch(() => undefined);
        await visitor.waitForTimeout(800);
        const box = visitor.locator('.modal.show, .lightbox, .fancybox__container, .glightbox-container, .lg-outer, .pswp--open, [class*="lightbox"]:visible');
        const opened = (await box.count()) > 0;
        note(`Lightbox opened: ${opened}; URL after the click ${visitor.url()}`);
        test.fail(!opened, KNOWN.NO_LIGHTBOX);
        expect(opened, 'clicking an image enlarges it').toBe(true);
        await visitor.keyboard.press('ArrowRight');
        await visitor.keyboard.press('Escape');
        await visitor.waitForTimeout(500);
        expect(await box.count(), 'Esc closes it').toBe(0);
        expect(dialogs).toEqual([]);
      } finally {
        await context.close();
      }
    } finally {
      note(`Cleanup: deleted ${await deleteAlbumsWhere(page, byDescription(description))} album(s).`);
    }
  });

  test(sheetTitle('TC-FROL-03-19'), async () => {
    test.fixme(true, NEEDS_LDAP_ACCOUNT);
  });
});

