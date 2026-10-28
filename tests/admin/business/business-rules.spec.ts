import { test, expect, ANONYMOUS_SESSION } from '@fixtures/pages.fixtures';
import { requireDataCreatingTestsAllowed } from '@config/env';
import { AdminActivityPage } from '@pages/admin/AdminActivityPage';
import { AdminContactPage } from '@pages/admin/AdminContactPage';
import { AdminCopsPage } from '@pages/admin/AdminCopsPages';
import { AdminFaqPage } from '@pages/admin/AdminFaqPage';
import { AdminGroupPage } from '@pages/admin/AdminGroupPage';
import { AdminNewsListPage, BEST_PRACTICE_MODULE, KNOWLEDGE_MODULE, NewsFormPage } from '@pages/admin/AdminNewsPages';
import { AdminUserListPage } from '@pages/admin/AdminUserListPage';
import { DashboardPage } from '@pages/DashboardPage';
import { ALBUM_IMAGE, albumMarker, byDescription, deleteAlbumsWhere, publicActivity, submitAlbum } from '@utils/activityFlows';
import { CATEGORY_DESCRIPTION } from '@utils/categoryFlows';
import { sheetTitle } from '@utils/caseTitles';
import { bySubject, contactMarker, deleteMessagesWhere, sendContact, VALID_CONTACT } from '@utils/contactFlows';
import { copDescription, deleteCopsByDescription, submitNewCop } from '@utils/copFlows';
import { createFaqCategory, deleteFaqCategories, deleteFaqWhere, faqMarker, publicFaq, submitFaq } from '@utils/faqFlows';
import { urlOf } from '@utils/lowPrivilege';
import { createNewsCategory, deleteNewsByExcerpt, deleteNewsCategory, fetchAsVisitor, publicContentDetail, submitNews } from '@utils/newsFlows';
import { roleStamp } from '@utils/roleFlows';
import { uniqueUsername } from '@utils/strings';
import { AUTO_TEST_FLAG } from '@utils/testData';
import { fixtureFile } from '@utils/uploadFiles';
import { createUser } from '@utils/userFlows';
import { Browser, Page } from '@playwright/test';

/**
 * Business rules (Auto:P, user decision 2026-10-08) — double submits, deleting things that are in use, and counters
 * (home statistics, popular articles, FAQ / album / download counters, unread messages, the user total). Checked on the
 * Dev reset of 2026-10-08 (an admin-wide double-submit guard came with that deploy). Everything a case saves carries
 * "[Auto Test]" (users: a qa_auto_ username) and is deleted again.
 */

const CREATES = 'Saves test content / users / categories / messages (deleted again at the end of the case).';
const KNOWN = {
  HOME_STATS: 'Known bug (DEF-17): the home page statistics are fixed sample numbers, not the real counts.',
  POPULAR_SAMPLE: 'Known bug (DEF-17 / DEF-44): "คลังความรู้ยอดนิยม" on the home page is sample data — not the most viewed articles.',
  NO_FAQ_COUNTER: 'Known bug (DEF-125): opening a FAQ answer on the public page does not add to its view counter.',
  NO_DOWNLOAD_COUNT: 'Known bug (DEF-93): downloads are not counted (album images are plain links to the stored file).',
  DASHBOARD_FILTER: 'Known bug (DEF-128): choosing a community (or period) does not change the dashboard cards / charts / tables — the filters only feed the report.',
  CATEGORY_IN_USE: 'Known bug (DEF-126): a category that is still used can be deleted — its items are left without a category.',
  USER_SUMMARY: 'Known bug (DEF-127): the summary line reads "แสดง1-1 รายการ" (no space after "แสดง").',
};

test.beforeEach(() => test.setTimeout(300_000));

function note(description: string): void {
  test.info().annotations.push({ type: 'note', description });
}

async function visitorPage<T>(browser: Browser, work: (page: Page) => Promise<T>): Promise<T> {
  const context = await browser.newContext({ storageState: ANONYMOUS_SESSION });
  try {
    return await work(await context.newPage());
  } finally {
    await context.close();
  }
}

/** Deletes a qa_auto_ user (the list's own guard refuses anything else). Never throws. */
async function removeUser(page: Page, username: string): Promise<void> {
  try {
    const users = new AdminUserListPage(page);
    await users.open();
    if (!(await users.isUserListed(username))) return;
    const dialog = await users.openDeleteDialog(username);
    await Promise.all([page.waitForLoadState('load'), dialog.confirm()]);
  } catch {
    // reported by the case's own checks
  }
}

const stat = (stats: { value: string; label: string }[], label: RegExp): number => Number(stats.find((s) => label.test(s.label))?.value.replace(/,/g, '') ?? NaN);

// ---------------------------------------------------------------------------------------------------------------

test.describe('BR กดบันทึกซ้ำ / ข้อมูลซ้ำ', () => {
  test(sheetTitle('TC-NFR-04-06'), async ({ page }) => {
    requireDataCreatingTestsAllowed(CREATES);
    const form = new NewsFormPage(page, KNOWLEDGE_MODULE);
    const excerpt = `${AUTO_TEST_FLAG} กดซ้ำ ${roleStamp()}`;
    try {
      await form.openCreate();
      await form.fill({ title: `AUTO_DOUBLE ${roleStamp()}`, excerpt, status: 'publish' });
      const save = page.locator('form button[type="submit"]').filter({ hasText: 'บันทึก' }).first();
      const posts: string[] = [];
      page.on('request', (r) => r.method() === 'POST' && !/uploads/.test(r.url()) && posts.push(r.url()));
      await Promise.all([page.waitForLoadState('load'), ...Array.from({ length: 5 }, () => save.click({ force: true, noWaitAfter: true, timeout: 5_000 }).catch(() => undefined))]);
      await page.waitForTimeout(3_000);
      const cards = (await new AdminNewsListPage(page, KNOWLEDGE_MODULE).readCards().catch(async () => {
        await new AdminNewsListPage(page, KNOWLEDGE_MODULE).open();
        return new AdminNewsListPage(page, KNOWLEDGE_MODULE).readCards();
      })).filter((c) => c.excerpt === excerpt);
      const list = new AdminNewsListPage(page, KNOWLEDGE_MODULE);
      await list.open();
      const saved = (await list.readCards()).filter((c) => c.excerpt === excerpt).length;
      note(`Form posts sent: ${posts.length}; articles saved: ${saved} (seen right after: ${cards.length})`);
      expect(saved, 'five clicks save one article').toBe(1);
    } finally {
      for (let i = 0; i < 5; i++) if (!(await deleteNewsByExcerpt(page, excerpt, KNOWLEDGE_MODULE))) break;
    }
  });

  test(sheetTitle('TC-FUSR-10-06'), async ({ page }) => {
    requireDataCreatingTestsAllowed(CREATES);
    const users = new AdminUserListPage(page);
    const username = uniqueUsername();
    try {
      await users.open();
      const before = await users.totalUsers();
      const modal = await users.openAddUserForm();
      await modal.fillWithDefaults({ username });
      const save = modal.root.getByRole('button', { name: 'บันทึก' });
      const posts: string[] = [];
      page.on('request', (r) => r.method() !== 'GET' && posts.push(`${r.method()} ${new URL(r.url()).pathname}`));
      const answered = page.waitForResponse((r) => r.request().method() === 'POST' && /\/admin\/user/.test(r.url()), { timeout: 60_000 }).catch(() => null);
      // Five rapid clicks on the same spot, like an impatient user.
      await save.click({ clickCount: 5, delay: 0, noWaitAfter: true });
      await answered;
      await page.waitForLoadState('load');
      await page.waitForTimeout(2_000);
      note(`User form posts answered: ${JSON.stringify(posts)}`);
      await users.open();
      const after = await users.totalUsers();
      const rows = await page.locator('table tbody tr').filter({ hasText: username }).count();
      note(`Users ${before} → ${after}; rows with ${username}: ${rows}`);
      expect(rows, 'one user is created').toBe(1);
      expect(after - before, 'the total grows by one').toBe(1);
    } finally {
      await removeUser(page, username);
    }
  });

  test(sheetTitle('TC-FUSR-02-15'), async ({ page }) => {
    requireDataCreatingTestsAllowed(CREATES);
    const users = new AdminUserListPage(page);
    const username = uniqueUsername();
    try {
      await createUser(users, { username });
      await users.open();
      const modal = await users.openEditUserForm(username);
      const editable = (await modal.usernameInput.isEditable().catch(() => false)) && !(await modal.usernameInput.getAttribute('readonly'));
      note(`Username editable in the edit form: ${editable}`);
      if (editable) {
        await modal.usernameInput.fill('admin');
        await modal.save();
        await page.waitForLoadState('networkidle');
        const messages = (await modal.root.locator('.text-danger, .invalid-feedback, .text-xsmall').allInnerTexts().catch(() => [])).join(' ');
        note(`Messages: "${messages}"`);
      }
      await users.open();
      expect(await users.isUserListed(username), 'the user keeps its username').toBe(true);
      const adminRows = await page.locator('table tbody tr').filter({ hasText: /\badmin\b/ }).count();
      expect(adminRows, 'there is still exactly one "admin"').toBe(1);
    } finally {
      await removeUser(page, username);
    }
  });
});

test.describe('BR ลบข้อมูลที่ถูกใช้งาน', () => {
  test(sheetTitle('TC-ADMC-06-04'), async ({ page }) => {
    requireDataCreatingTestsAllowed(CREATES);
    const dashboard = new DashboardPage(page);
    const cops = new AdminCopsPage(page);
    const description = copDescription();
    const name = `AUTO_DASH_COP ${roleStamp()}`;
    let deleted = 0;
    try {
      expect((await submitNewCop(cops, { name, description, status: 'publish' })).status()).toBeLessThan(400);
      await dashboard.open();
      const withCop = stat(await dashboard.readStats(), /CoPs/);
      const optionsWith = await dashboard.copsOptions();
      deleted = await deleteCopsByDescription(cops, page, description);
      await dashboard.open();
      const without = stat(await dashboard.readStats(), /CoPs/);
      const optionsWithout = await dashboard.copsOptions();
      note(`"CoPs ทั้งหมด" ${withCop} → ${without}; option listed ${optionsWith.includes(name)} → ${optionsWithout.includes(name)}`);
      expect(deleted, 'the community is deleted').toBe(1);
      expect(without, '"CoPs ทั้งหมด" goes down by one').toBe(withCop - 1);
      expect(optionsWith, 'the new community was a "เลือก CoPs" option').toContain(name);
      expect(optionsWithout, 'and is gone from it').not.toContain(name);
    } finally {
      if (!deleted) await deleteCopsByDescription(cops, page, description);
    }
  });

  test(sheetTitle('TC-ADMG-02-05'), async ({ page, browser }) => {
    requireDataCreatingTestsAllowed(CREATES);
    const unused = await createNewsCategory(page, `${AUTO_TEST_FLAG} หมวดว่าง`, KNOWLEDGE_MODULE);
    const used = await createNewsCategory(page, `${AUTO_TEST_FLAG} หมวดใช้งาน`, KNOWLEDGE_MODULE);
    const title = `AUTO_IN_USE ${roleStamp()}`;
    const { excerpt } = await submitNews(page, { title, category: used, status: 'publish' }, KNOWLEDGE_MODULE);
    try {
      const group = new AdminGroupPage(page);
      expect(await deleteNewsCategory(page, unused, KNOWLEDGE_MODULE), 'the unused category is deleted').toBe(true);
      await group.open('knowledge');
      const usedDeleted = await deleteNewsCategory(page, used, KNOWLEDGE_MODULE);
      const message = (await page.locator('.alert').allInnerTexts()).join(' ').replace(/\s+/g, ' ');
      const card = await new AdminNewsListPage(page, KNOWLEDGE_MODULE).findByExcerpt(excerpt);
      const detail = await publicContentDetail(browser, excerpt, title, KNOWLEDGE_MODULE);
      note(`Used category deleted: ${usedDeleted}; message "${message}"; article listed ${!!card}; public detail ${detail?.status}`);
      expect(card, 'the article is still in the admin list').toBeTruthy();
      expect(detail?.status, 'the article page still opens').toBe(200);
      test.fail(usedDeleted, KNOWN.CATEGORY_IN_USE);
      expect(usedDeleted, 'a category in use is protected (or its deletion is warned about)').toBe(false);
    } finally {
      await deleteNewsByExcerpt(page, excerpt, KNOWLEDGE_MODULE);
      await deleteNewsCategory(page, used, KNOWLEDGE_MODULE);
      await deleteNewsCategory(page, unused, KNOWLEDGE_MODULE);
    }
  });

  test(sheetTitle('TC-ADMG-04-05'), async ({ page }) => {
    requireDataCreatingTestsAllowed(CREATES);
    const name = await createNewsCategory(page, `${AUTO_TEST_FLAG} หมวดลบ`, KNOWLEDGE_MODULE);
    try {
      const form = new NewsFormPage(page, KNOWLEDGE_MODULE);
      await form.openCreate();
      expect(await form.categoryOptions(), 'the new category is offered').toContain(name);
      expect(await deleteNewsCategory(page, name, KNOWLEDGE_MODULE), 'it is deleted').toBe(true);
      await form.openCreate();
      expect(await form.categoryOptions(), 'and is no longer offered').not.toContain(name);
    } finally {
      await deleteNewsCategory(page, name, KNOWLEDGE_MODULE);
    }
  });

  test(sheetTitle('TC-ADMF-01-02'), async ({ page }) => {
    requireDataCreatingTestsAllowed(CREATES);
    const group = new AdminGroupPage(page);
    const faq = new AdminFaqPage(page);
    const name = await createFaqCategory(page, `${AUTO_TEST_FLAG} AUTO_FAQ_CAT`);
    const renamed = `${name} แก้ไข`;
    try {
      await faq.open();
      await faq.openAddForm();
      expect(await faq.categoryOptions(), 'added: offered in the FAQ form').toContain(name);
      await group.open('faq');
      await group.openEditForm(name);
      await group.fill({ name: renamed, description: CATEGORY_DESCRIPTION });
      expect((await group.save()).status()).toBeLessThan(500);
      await faq.open();
      await faq.openAddForm();
      const options = await faq.categoryOptions();
      expect(options, 'renamed: the new name is offered').toContain(renamed);
      expect(options, 'and the old one is not').not.toContain(name);
      expect(await deleteFaqCategories(page, renamed), 'deleted').toBe(1);
      await faq.open();
      await faq.openAddForm();
      expect(await faq.categoryOptions(), 'deleted: no longer offered').not.toContain(renamed);
    } finally {
      await deleteFaqCategories(page, renamed);
      await deleteFaqCategories(page, name);
    }
  });

  for (const id of ['TC-ADMF-04-09', 'TC-FFAQ-05-12']) {
    test(sheetTitle(id), async ({ page, browser }) => {
      requireDataCreatingTestsAllowed(CREATES);
      const name = await createFaqCategory(page, `${AUTO_TEST_FLAG} หมวดมีคำถาม`);
      const answer = faqMarker();
      const question = `${AUTO_TEST_FLAG} คำถามในหมวด ${roleStamp()}`;
      try {
        expect((await submitFaq(page, { question, answer, category: name })).final).toBeLessThan(500);
        const categoryDeleted = (await deleteFaqCategories(page, name)) > 0;
        const message = (await page.locator('.alert').allInnerTexts()).join(' ').replace(/\s+/g, ' ');
        const faq = new AdminFaqPage(page);
        const card = await faq.findByQuestion(question);
        const pub = await publicFaq(browser);
        note(`Category deleted: ${categoryDeleted}; message "${message}"; FAQ in admin ${!!card} (category "${card?.editCategory}"); on the public page ${pub.questions.some((q) => q.includes(question))}`);
        expect(card, 'the FAQ is not lost').toBeTruthy();
        expect(pub.status, 'the public FAQ page still works').toBe(200);
        test.fail(categoryDeleted, KNOWN.CATEGORY_IN_USE);
        expect(categoryDeleted, 'a FAQ category with questions is protected (or the questions are moved)').toBe(false);
      } finally {
        await deleteFaqWhere(page, (c) => c.editAnswer === answer);
        await deleteFaqCategories(page, name);
      }
    });
  }

  test(sheetTitle('TC-FFAQ-05-11'), async ({ page }) => {
    requireDataCreatingTestsAllowed(CREATES);
    const group = new AdminGroupPage(page);
    const name = await createFaqCategory(page, `${AUTO_TEST_FLAG} หมวดลบได้`);
    try {
      await group.open('faq');
      const before = await group.total('faq');
      const dialog = await group.openDeleteDialog(name);
      await dialog.cancel();
      await group.open('faq');
      expect(await group.findCard(name), 'cancel keeps the category').toBeTruthy();
      expect(await deleteFaqCategories(page, name), 'confirm deletes it').toBe(1);
      await group.open('faq');
      expect(await group.findCard(name), 'gone from the list').toBeUndefined();
      expect(await group.total('faq'), 'the count goes down by one').toBe(before - 1);
      const faq = new AdminFaqPage(page);
      await faq.open();
      await faq.openAddForm();
      expect(await faq.categoryOptions(), 'and from the FAQ form').not.toContain(name);
    } finally {
      await deleteFaqCategories(page, name);
    }
  });
});

test.describe('BR ตัวนับและสถิติ', () => {
  test(sheetTitle('TC-FEH-02-02'), async ({ page, browser }) => {
    const home = await visitorPage(browser, async (p) => {
      await p.goto(urlOf('/'));
      return (await p.locator('body').innerText()).replace(/\s+/g, ' ');
    });
    const copsFigure = /([\d.,]+k?\+?)\s*กลุ่มชุมชน|กลุ่มชุมชน[^\d]{0,30}([\d.,]+k?\+?)/i.exec(home);
    const knowFigure = /([\d.,]+k?\+?)\s*องค์ความรู้|องค์ความรู้และแนวปฏิบัติ[^\d]{0,30}([\d.,]+k?\+?)/i.exec(home);
    const cops = new AdminCopsPage(page);
    await cops.open();
    const copsPublished = (await cops.readCards()).filter((c) => /เผยแพร่/.test(c.status)).length;
    // "องค์ความรู้และแนวปฏิบัติต่างๆ" = knowledge articles + best practices.
    let knowPublished = 0;
    for (const module of [KNOWLEDGE_MODULE, BEST_PRACTICE_MODULE]) {
      const list = new AdminNewsListPage(page, module);
      await list.open();
      knowPublished += (await list.readCards()).filter((c) => /เผยแพร่/.test(c.status)).length;
    }
    const shown = { cops: copsFigure?.[1] ?? copsFigure?.[2] ?? '(none)', knowledge: knowFigure?.[1] ?? knowFigure?.[2] ?? '(none)' };
    note(`Home shows ${JSON.stringify(shown)}; admin has ${copsPublished} published communities, ${knowPublished} published articles (first page)`);
    const matches = Number(shown.cops) === copsPublished && Number(shown.knowledge) === knowPublished;
    test.fail(!matches, KNOWN.HOME_STATS);
    expect(matches, 'the home figures are the real counts').toBe(true);
  });

  test(sheetTitle('TC-FEH-02-03'), async ({ page, browser }) => {
    requireDataCreatingTestsAllowed(CREATES);
    const items = await Promise.all([1, 2, 3, 4].map(async () => ({ title: `AUTO_POP ${roleStamp()}` })));
    const saved: { title: string; excerpt: string; views: number }[] = [];
    try {
      for (const [i, item] of items.entries()) {
        const { excerpt } = await submitNews(page, { title: item.title, status: 'publish' }, KNOWLEDGE_MODULE);
        saved.push({ title: item.title, excerpt, views: i + 1 });
      }
      // Views: 1..4 fresh visits each (a new session counts once — TC-FEK-01-04).
      for (const s of saved) for (let v = 0; v < s.views; v++) await publicContentDetail(browser, s.excerpt, s.title, KNOWLEDGE_MODULE);
      const section = await visitorPage(browser, async (p) => {
        await p.goto(urlOf('/'));
        const block = p.locator('section, .container').filter({ hasText: 'คลังความรู้ยอดนิยม' }).last();
        return { text: (await block.innerText()).replace(/\s+/g, ' '), hrefs: await block.locator('a').evaluateAll((as) => as.map((a) => a.getAttribute('href') ?? '')) };
      });
      const shownOrder = saved.map((s) => ({ title: s.title, at: section.text.indexOf(s.title) })).filter((s) => s.at >= 0).sort((a, b) => a.at - b.at).map((s) => s.title);
      note(`Popular block: "${section.text.slice(0, 300)}"; links ${JSON.stringify(section.hrefs.slice(0, 6))}; ours in order ${JSON.stringify(shownOrder)}`);
      const expected = [...saved].sort((a, b) => b.views - a.views).map((s) => s.title);
      const real = shownOrder.length === 4;
      test.fail(!real, KNOWN.POPULAR_SAMPLE);
      expect(shownOrder, 'the 4 most viewed articles, most viewed first').toEqual(expected);
      expect(new Set(section.hrefs.filter((h) => /knowledge\/detail\/./.test(h))).size, 'each links to its own page').toBeGreaterThanOrEqual(4);
    } finally {
      for (const s of saved) await deleteNewsByExcerpt(page, s.excerpt, KNOWLEDGE_MODULE);
    }
  });

  test(sheetTitle('TC-FEF-02-05'), async ({ page, browser }) => {
    requireDataCreatingTestsAllowed(CREATES);
    const category = await createFaqCategory(page, `${AUTO_TEST_FLAG} หมวดนับ`);
    const answer = faqMarker();
    const question = `${AUTO_TEST_FLAG} คำถามนับยอด ${roleStamp()}`;
    const faq = new AdminFaqPage(page);
    const counterOf = async (): Promise<string> => {
      await faq.open();
      return (await faq.cards.filter({ hasText: question }).first().innerText()).replace(/\s+/g, ' ');
    };
    try {
      expect((await submitFaq(page, { question, answer, category })).final).toBeLessThan(500);
      const before = await counterOf();
      await visitorPage(browser, async (p) => {
        await p.goto(urlOf('/frontend/faq/index'));
        await p.locator('.accordion-button').filter({ hasText: question }).first().click();
        await p.waitForTimeout(1_500);
      });
      const after = await counterOf();
      const num = (s: string): number[] => (s.match(/\d+/g) ?? []).map(Number);
      note(`Admin card before "${before}" → after "${after}"`);
      const grew = JSON.stringify(num(before)) !== JSON.stringify(num(after));
      test.fail(!grew, KNOWN.NO_FAQ_COUNTER);
      expect(grew, 'opening the answer adds a view').toBe(true);
    } finally {
      await deleteFaqWhere(page, (c) => c.editAnswer === answer);
      await deleteFaqCategories(page, category);
    }
  });

  test(sheetTitle('TC-ADMD-02-01'), async ({ page }) => {
    const dashboard = new DashboardPage(page);
    await dashboard.open();
    const cops = (await dashboard.copsOptions()).filter((o) => o && !/ทั้งหมด/.test(o));
    test.skip(!cops.length, 'No community on Dev to filter by.');
    const result = await dashboard.observe(() => dashboard.chooseCops(cops[0]));
    note(`Chose "${cops[0]}": requests ${JSON.stringify(result.requests)}; content changed ${result.changed}`);
    test.fail(!result.changed && !result.requests.some((r) => /dashboard/.test(r)), KNOWN.DASHBOARD_FILTER);
    expect(result.changed || result.requests.some((r) => /dashboard/.test(r)), 'the cards / charts / tables follow the chosen community').toBe(true);
  });

  test(sheetTitle('TC-ADMD-03-01'), async ({ page }) => {
    const dashboard = new DashboardPage(page);
    await dashboard.open();
    const content = await dashboard.readContent();
    const visitors = stat(await dashboard.readStats(), /ผู้เข้าชม/);
    const trend = content.trendChart === 'no chart' ? content.barChart : content.trendChart;
    const values = (trend.split('=')[1] ?? '').split(/[;,]/).map(Number).filter((n) => !Number.isNaN(n));
    note(`Charts: bar "${content.barChart.slice(0, 200)}"; trend "${content.trendChart.slice(0, 200)}"; visitors card ${visitors}`);
    expect(trend, 'a visitor chart is drawn').not.toBe('no chart');
    expect(values.length, 'with values per label').toBeGreaterThan(0);
    expect(values.every((v) => v >= 0), 'no negative values').toBe(true);
  });

  test(sheetTitle('TC-ADMD-05-02'), async ({ page }) => {
    const dashboard = new DashboardPage(page);
    await dashboard.open();
    const pane = await dashboard.openTab('เข้าชมมากที่สุด');
    const first = await dashboard.readTable(pane);
    await dashboard.open();
    const second = await dashboard.readTable(await dashboard.openTab('เข้าชมมากที่สุด'));
    note(`Most viewed: ${JSON.stringify(first).slice(0, 300)}`);
    expect(second, 'the order is the same after a reload').toEqual(first);
  });

  test(sheetTitle('TC-ADMA-02-01'), async ({ page, browser }) => {
    requireDataCreatingTestsAllowed(CREATES);
    const albums = new AdminActivityPage(page);
    const description = albumMarker();
    const title = `AUTO_ALBUM_001 ${roleStamp()}`;
    try {
      await albums.open();
      const before = await albums.albumTotal();
      expect((await submitAlbum(page, { title, description, images: [ALBUM_IMAGE, ALBUM_IMAGE, ALBUM_IMAGE], status: 'publish' })).final).toBeLessThan(500);
      await albums.open();
      const card = (await albums.readCards()).find((c) => c.editDescription === description);
      const after = await albums.albumTotal();
      const pub = await publicActivity(browser);
      note(`"อัลบัมทั้งหมด" ${before} → ${after}; images on the card ${card?.imageCount}; public ${pub.albums.some((a) => a.title === title)}`);
      expect(card, 'listed').toBeTruthy();
      expect(card?.imageCount, 'with its 3 images').toBe(3);
      expect(after, 'the total grows by one').toBe(before + 1);
      expect(pub.albums.map((a) => a.title), 'shown on /frontend/activity/index').toContain(title);
    } finally {
      note(`Cleanup: deleted ${await deleteAlbumsWhere(page, byDescription(description))} album(s).`);
    }
  });

  test(sheetTitle('TC-ADMA-02-05'), async ({ page, browser }) => {
    requireDataCreatingTestsAllowed(CREATES);
    const albums = new AdminActivityPage(page);
    const description = albumMarker();
    const title = `AUTO_ALBUM_DL ${roleStamp()}`;
    try {
      expect((await submitAlbum(page, { title, description, images: [ALBUM_IMAGE], status: 'publish' })).final).toBeLessThan(500);
      const countOf = async (): Promise<number | undefined> => {
        await albums.open();
        return (await albums.readCards()).find((c) => c.editDescription === description)?.downloadCount;
      };
      const before = await countOf();
      const href = (await publicActivity(browser)).albums.find((a) => a.title === title)!.href;
      const got = await visitorPage(browser, async (p) => {
        await p.goto(href);
        await p.waitForLoadState('load');
        const byText = p.locator('a, button').filter({ hasText: 'ดาวน์โหลด' });
        const controls = (await byText.count()) ? byText : p.locator('a[download], a[href*="download"], [data-download], [data-url*="download"]');
        const found = await controls.evaluateAll((els) => els.map((e) => `${e.tagName.toLowerCase()}.${(e.getAttribute('class') ?? '').replace(/\s+/g, '.')} ${(e.textContent ?? '').trim().slice(0, 30)} ${e.getAttribute('href') ?? e.getAttribute('data-url') ?? ''}`));
        note(`Download controls on the album page: ${JSON.stringify(found.slice(0, 6))}`);
        if (found.length) {
          note(`First control: ${(await controls.first().evaluate((e) => e.outerHTML)).replace(/\s+/g, ' ').slice(0, 400)}`);
          const js = await p.evaluate(() => [...document.scripts].map((s) => s.textContent ?? '').filter((t) => /download|item-btn|ดาวน์โหลด/i.test(t)).map((t) => t.replace(/\s+/g, ' ')).join(' | '));
          note(`Scripts about downloads: ${js.slice(0, 900) || '(none)'}`);
        }
        if (!found.length) return { found: 0, status: 0, href: '' };
        // The button sits in the image preview (#imagePreviewModal): clicking an image opens it and copies the image's
        // data-download into the button's href.
        await p.locator('.pop-img').first().click();
        await p.locator('#imagePreviewModal').waitFor({ state: 'visible', timeout: 10_000 });
        const dl = (await p.locator('#downloadImageBtn').getAttribute('href')) ?? '';
        const download = p.waitForEvent('download', { timeout: 20_000 }).catch(() => null);
        const response = p.waitForResponse((r) => dl !== '' && r.url() === new URL(dl, p.url()).href, { timeout: 20_000 }).catch(() => null);
        await p.locator('#downloadImageBtn').click({ timeout: 10_000 }).catch(() => undefined);
        const [d, r] = await Promise.all([download, response]);
        return { found: found.length, status: r?.status() ?? (d ? 200 : 0), href: dl };
      });
      note(`Download link in the preview: ${got.href}`);
      expect(got.found, 'the album page offers a download').toBeGreaterThan(0);
      const after = await countOf();
      note(`Download HTTP ${got.status}; counter ${before} → ${after}`);
      expect(got.status, 'the download works').toBe(200);
      test.fail(after === before, KNOWN.NO_DOWNLOAD_COUNT);
      expect(after, 'the counter grows by one').toBe((before ?? 0) + 1);
    } finally {
      note(`Cleanup: deleted ${await deleteAlbumsWhere(page, byDescription(description))} album(s).`);
    }
  });

  test(sheetTitle('TC-ADMT-04-03'), async ({ page, browser }) => {
    requireDataCreatingTestsAllowed(CREATES);
    const subjects = [contactMarker(), contactMarker()];
    const contact = new AdminContactPage(page);
    try {
      await visitorPage(browser, async (p) => {
        for (const subject of subjects) expect((await sendContact(p, { ...VALID_CONTACT, subject })).success, `sent "${subject}"`).toBe(true);
      });
      const unread = async (): Promise<{ text: string; flags: boolean[] }> => {
        await contact.open('?tab=messages');
        const text = (await page.locator('.body-content .nav, .body-content [role="tablist"]').first().innerText().catch(() => '')).replace(/\s+/g, ' ');
        const flags = (await contact.readMessages()).filter((m) => subjects.includes(m.subject)).map((m) => m.isRead);
        return { text, flags };
      };
      const before = await unread();
      await contact.viewMessage(bySubject(subjects[0]));
      const after = await unread();
      const statusOf = (await contact.readMessages()).find((m) => m.subject === subjects[0]);
      note(`Tabs "${before.text}" → "${after.text}"; read flags ${JSON.stringify(before.flags)} → ${JSON.stringify(after.flags)}; badge "${statusOf?.status}"`);
      expect(before.flags, 'both arrive unread').toEqual([false, false]);
      expect(statusOf?.isRead, 'opening the first marks it read').toBe(true);
      expect(after.flags.filter((f) => !f).length, 'one unread message left').toBe(1);
    } finally {
      for (const subject of subjects) await deleteMessagesWhere(page, bySubject(subject));
    }
  });

  test(sheetTitle('TC-NFR-07-06'), async ({ page, browser }) => {
    requireDataCreatingTestsAllowed(CREATES);
    const title = `AUTO_COUNTS ${roleStamp()}`;
    const { excerpt } = await submitNews(page, { title, status: 'publish', documents: [fixtureFile('sample.pdf', 'counter.pdf')] }, KNOWLEDGE_MODULE);
    try {
      const detail = await publicContentDetail(browser, excerpt, title, KNOWLEDGE_MODULE);
      expect(detail?.media.documents.length, 'the attachment is offered').toBe(1);
      expect((await fetchAsVisitor(browser, detail!.media.documents[0].href)).status, 'it downloads').toBe(200);
      const again = await publicContentDetail(browser, excerpt, title, KNOWLEDGE_MODULE);
      const card = await new AdminNewsListPage(page, KNOWLEDGE_MODULE).findByExcerpt(excerpt);
      const dashboard = new DashboardPage(page);
      await dashboard.open();
      const downloads = stat(await dashboard.readStats(), /ดาวน์โหลด/);
      note(`Views on the page ${detail?.media.views} → ${again?.media.views}; admin card counters ${JSON.stringify(card?.counters)}; dashboard "ดาวน์โหลดทั้งหมด" ${downloads}`);
      expect(again?.media.views, 'the page counts the visits').toBe((detail?.media.views ?? 0) + 1);
      test.fail(!(downloads > 0) || !card?.counters.includes(1), KNOWN.NO_DOWNLOAD_COUNT);
      expect(downloads, 'the dashboard counts the download').toBeGreaterThan(0);
    } finally {
      await deleteNewsByExcerpt(page, excerpt, KNOWLEDGE_MODULE);
    }
  });

  test(sheetTitle('TC-FUSR-09-01'), async ({ page }) => {
    requireDataCreatingTestsAllowed(CREATES);
    const users = new AdminUserListPage(page);
    const username = uniqueUsername();
    try {
      await users.open();
      const before = await users.totalUsers();
      await createUser(users, { username });
      await users.open();
      const after = await users.totalUsers();
      const row = (await page.locator('table tbody tr').filter({ hasText: username }).first().innerText()).replace(/\s+/g, ' ');
      const summary = (await page.getByText(/จาก\s*\d+\s*รายการ/).first().innerText()).replace(/\s+/g, ' ');
      note(`Total ${before} → ${after}; row "${row}"; summary "${summary}"`);
      expect(after, 'the total grows by one').toBe(before + 1);
      expect(row, 'the row shows the name and username').toContain(username);
      expect(summary, 'the summary is "แสดง x-y รายการ จาก n รายการ"').toMatch(new RegExp(`แสดง\\s*\\d+\\s*-\\s*\\d+\\s*รายการ\\s*จาก\\s*${after}\\s*รายการ`));
      test.fail(/แสดง\d/.test(summary), KNOWN.USER_SUMMARY);
      expect(summary, 'with a space after "แสดง"').toMatch(/แสดง\s+\d/);
    } finally {
      await removeUser(page, username);
    }
  });
});
