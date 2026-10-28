import { test, expect, ANONYMOUS_SESSION } from '@fixtures/pages.fixtures';
import { requireDataCreatingTestsAllowed } from '@config/env';
import { AdminActivityPage } from '@pages/admin/AdminActivityPage';
import { AdminCopsPage } from '@pages/admin/AdminCopsPages';
import { AdminFaqPage } from '@pages/admin/AdminFaqPage';
import { AdminGroupPage } from '@pages/admin/AdminGroupPage';
import { AdminHomePage } from '@pages/admin/AdminHomePage';
import { AdminNewsListPage, KNOWLEDGE_MODULE, NewsFormPage } from '@pages/admin/AdminNewsPages';
import { ALBUM_IMAGE, albumMarker, byDescription, deleteAlbumsWhere, publicActivity, submitAlbum } from '@utils/activityFlows';
import { CATEGORY_DESCRIPTION } from '@utils/categoryFlows';
import { sheetTitle } from '@utils/caseTitles';
import { copDescription, deleteCopsByDescription, postExcerpt, submitNewCop } from '@utils/copFlows';
import { createFaqCategory, deleteFaqCategories, deleteFaqWhere, faqMarker, publicFaq, submitFaq } from '@utils/faqFlows';
import { deleteOwnMenus, menuIds, menuTitle, publicFooter } from '@utils/footerFlows';
import { urlOf } from '@utils/lowPrivilege';
import { deleteNewsCategory, publicContentDetail, visitorGet } from '@utils/newsFlows';
import { roleStamp } from '@utils/roleFlows';
import { collectDialogs } from '@utils/security';
import { deleteOwnSlides, publicHero, slideIds, SLIDE_IMAGE } from '@utils/slideFlows';
import { AUTO_TEST_FLAG } from '@utils/testData';
import { MB } from '@utils/uploadFiles';
import { CopPostsPage } from '@pages/admin/AdminCopsPages';
import { Browser, Page } from '@playwright/test';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { cleanupItems, isOnPublicList, trackItem, itemExcerpt, itemTitle, localDateTime, publicDetailOf, saveAccepted, saveItem } from '../admin/content/contentCases';
import { ADMIN_AUTH_FILE } from '../../global-setup';

/**
 * The "Manual (QA)" cases of the two workbooks that can run on Dev (group A of 2026-10-15: 34 here, the user /
 * role / log / security ones in manual-admin.spec.ts). Most of them say "X or Y — rule TBD": a case then checks what
 * must hold whichever rule SA picks (no server error, nothing half-saved, the public page right) and notes the rule
 * it saw ("Policy seen: …"); where a DEF already calls the behaviour a bug, the case fails as that known bug. Every
 * item a case saves carries "[Auto Test]" (slides / footer items: a stamped link or title) and is deleted again.
 */

const CREATES = 'Saves test items (deleted again at the end of the case).';
const KNOWN = {
  DUP_CATEGORY: 'Known bug (DEF-36): a category with the same name (also differing only in letter case) is saved again in the same tab.',
  EMPTY_ANSWER: 'Known bug (DEF-65): a FAQ with an empty / blank answer is saved.',
  SCHEDULE_NEVER: 'Known bug (DEF-94): an item with a publish time in the past is saved but never shows on the public pages.',
  BIG_UPLOAD_HANGS: 'Known bug (DEF-99): a very large upload hangs instead of being refused quickly.',
  ANY_PAGE_AS_VIDEO: 'Known bug (DEF-134): the video link takes any URL and the public page frames that page in an iframe.',
  BLANK_BODY: 'Known bug (DEF-135): a body of blank lines is saved and the public page shows the empty paragraphs.',
  ORDER_BY_CREATED: 'Known bug (DEF-136): the public knowledge list is ordered by creation time, not by the publish date it shows.',
  SLUG_CLASH: 'Bug (to file): two items whose titles differ only in letter case / are equal share one public URL — one of them cannot be reached.',
};

test.beforeEach(() => test.setTimeout(300_000));
test.afterEach(async ({ page }) => cleanupItems(page));

function note(description: string): void {
  test.info().annotations.push({ type: 'note', description });
}

const M = KNOWLEDGE_MODULE;

async function asVisitor<T>(browser: Browser, work: (page: Page) => Promise<T>): Promise<T> {
  const context = await browser.newContext({ storageState: ANONYMOUS_SESSION });
  try {
    return await work(await context.newPage());
  } finally {
    await context.close();
  }
}

/** Swaps the letter case of the ASCII letters (the "[Auto Test]" marker is kept as it is). */
const flipCase = (text: string): string => text.replace(AUTO_TEST_FLAG, '\u0000').replace(/[a-z]/gi, (c) => (c === c.toUpperCase() ? c.toLowerCase() : c.toUpperCase())).replace('\u0000', AUTO_TEST_FLAG);

/** A temporary file of `bytes` (PNG header + padding) — big payloads go through a file, not a buffer. */
function bigFile(name: string, bytes: number): string {
  const file = path.join(os.tmpdir(), `qa-${roleStamp()}-${name}`);
  const png = fs.readFileSync(ALBUM_IMAGE);
  const fd = fs.openSync(file, 'w');
  fs.writeSync(fd, png);
  const chunk = Buffer.alloc(MB);
  for (let written = png.length; written < bytes; written += chunk.length) fs.writeSync(fd, chunk, 0, Math.min(chunk.length, bytes - written));
  fs.closeSync(fd);
  return file;
}

// ---------------------------------------------------------------------------------------------------------------

test.describe('Manual → Auto: อัปโหลดถูกขัดจังหวะ', () => {
  for (const [id, count] of [['TC-ADMA-05-05', 1], ['TC-FALB-05-03', 3]] as const) {
    test(sheetTitle(id), async ({ page }) => {
      requireDataCreatingTestsAllowed(CREATES);
      const description = albumMarker();
      const files = Array.from({ length: count }, (_, i) => bigFile(`big-${i}.png`, 4.5 * MB));
      const admin = page.context();
      try {
        const albums = new AdminActivityPage(page);
        await albums.openAddForm();
        await albums.fill({ title: `AUTO_INTERRUPT ${roleStamp()}`, description, images: files, status: 'publish' });
        await albums.saveButton.click({ noWaitAfter: true });
        await page.waitForTimeout(300);
        await page.close(); // the tab is closed while the upload runs
        const check = await admin.newPage();
        await check.waitForTimeout(10_000);
        const list = new AdminActivityPage(check);
        await list.open();
        const card = (await list.readCards()).find((c) => c.editDescription === description);
        note(`After closing the tab: ${card ? `album saved with ${card.imageCount} of ${count} image(s)` : 'no album saved'}`);
        if (card) {
          expect(card.imageCount, 'no half-saved album: it has every image').toBe(count);
          for (const image of card.editImages) expect((await check.request.get(image.url)).status(), `image ${image.url} is served`).toBe(200);
        }
        await deleteAlbumsWhere(check, byDescription(description));
      } finally {
        for (const f of files) fs.rmSync(f, { force: true });
      }
    });
  }
});

test.describe('Manual → Auto: ชื่ออัลบัมซ้ำ', () => {
  test(sheetTitle('TC-FALB-02-12'), async ({ page, browser }) => {
    requireDataCreatingTestsAllowed(CREATES);
    const title = `AUTO_ALBUM_Dup ${roleStamp()}`;
    const descriptions = [albumMarker(), albumMarker()];
    try {
      expect((await submitAlbum(page, { title, description: descriptions[0] })).final).toBeLessThan(400);
      const again = await submitAlbum(page, { title: flipCase(title), description: descriptions[1] });
      expect(again.final, 'no server error').toBeLessThan(500);
      const albums = new AdminActivityPage(page);
      await albums.open();
      const saved = (await albums.readCards()).filter((c) => descriptions.includes(c.editDescription));
      const shown = (await publicActivity(browser)).albums.filter((a) => a.title.toLowerCase() === title.toLowerCase()).length;
      note(`Policy seen: ${saved.length === 2 ? 'an album name differing only in letter case is saved again' : 'the duplicate name is refused'}; public cards ${shown}`);
      expect([1, 2], 'one or two albums').toContain(saved.length);
      expect(shown, 'the public page shows the same albums').toBe(saved.length);
    } finally {
      for (const d of descriptions) await deleteAlbumsWhere(page, byDescription(d));
    }
  });
});

test.describe('Manual → Auto: ชุมชน', () => {
  async function copNames(cops: AdminCopsPage, name: string): Promise<string[]> {
    await cops.open();
    return (await cops.readCards()).map((c) => c.name).filter((n) => n.toLowerCase() === name.toLowerCase());
  }

  for (const [id, second] of [['TC-ADMC-02-03', (n: string) => n], ['TC-ADMC-04-12', flipCase]] as const) {
    test(sheetTitle(id), async ({ page, browser }) => {
      requireDataCreatingTestsAllowed(CREATES);
      const cops = new AdminCopsPage(page);
      const name = `AUTO_COPS_Dup ${roleStamp()}`;
      const d1 = copDescription();
      const d2 = copDescription();
      try {
        expect((await submitNewCop(cops, { name, description: d1, status: 'publish' })).status()).toBeLessThan(400);
        const again = await submitNewCop(cops, { name: second(name), description: d2, status: 'publish' });
        expect(again.status(), 'no server error').toBeLessThan(500);
        const names = await copNames(cops, name);
        const shown = await asVisitor(browser, async (p) => {
          await p.goto(urlOf('/frontend/cops/index'));
          return (await p.locator('.body-content a.card').allInnerTexts()).filter((t) => t.toLowerCase().includes(name.toLowerCase())).length;
        });
        note(`Policy seen: ${names.length === 2 ? 'the second community is saved as its own item' : 'the second name is refused'}; admin cards ${JSON.stringify(names)}; public cards ${shown}`);
        expect([1, 2], 'one or two communities, nothing else').toContain(names.length);
        expect(shown, 'the public list shows the same communities as the admin').toBe(names.length);
      } finally {
        await deleteCopsByDescription(cops, page, d1);
        await deleteCopsByDescription(cops, page, d2);
      }
    });
  }

  test(sheetTitle('TC-ADMC-02-07'), async ({ page, browser }) => {
    requireDataCreatingTestsAllowed(CREATES);
    const cops = new AdminCopsPage(page);
    const description = copDescription();
    const postTitle = `AUTO ORPHAN ${roleStamp()}`; // letters, digits and spaces only: other characters break the post page (DEF-83)
    let deleted = 0;
    try {
      expect((await submitNewCop(cops, { name: `AUTO_COPS_DEL ${roleStamp()}`, description, status: 'publish' })).status()).toBeLessThan(400);
      const card = await cops.findByDescription(description);
      const posts = new CopPostsPage(page);
      await page.goto(card!.postsHref);
      await posts.openCreate();
      await posts.fill({ title: postTitle, excerpt: postExcerpt(), body: '<p>[Auto Test] เนื้อหาทดสอบ</p>', status: 'publish' });
      expect((await posts.save()).status()).toBeLessThan(400);
      const slug = postTitle.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
      // The delete dialog: does it warn that the community still has posts?
      await cops.open();
      const dialogText = await (async () => {
        const dialog = await cops.openDeleteDialog(card!.name);
        const text = (await dialog.root.innerText()).replace(/\s+/g, ' ');
        await dialog.cancel();
        return text;
      })();
      // The post's real public link: community card on /frontend/cops/index → the post card on its page.
      const postHref = await asVisitor(browser, async (p) => {
        await p.goto(urlOf('/frontend/cops/index'));
        await p.locator('.body-content a.card').filter({ hasText: card!.name }).first().click();
        await p.waitForLoadState('load');
        const link = p.locator('.body-content a.card').filter({ hasText: postTitle }).first();
        return (await link.count()) ? new URL((await link.getAttribute('href')) ?? '', p.url()).pathname : `/frontend/cops/detail/${slug}`;
      });
      const before = await visitorGet(browser, postHref);
      note(`Post page ${postHref} before the delete: HTTP ${before.status}`);
      if (before.status >= 500) note('The post page answers HTTP 500 even before the delete (DEF-83) — the orphan check uses the search and the admin post list instead.');
      const searchUrl = `/frontend/search/index?q=${encodeURIComponent(postTitle.split(' ').pop()!)}`;
      const searchBefore = await visitorGet(browser, searchUrl);
      expect(searchBefore.text.includes(postTitle), 'the post is in the search before the delete').toBe(true);
      deleted = await deleteCopsByDescription(cops, page, description);
      const direct = await visitorGet(browser, postHref);
      const search = await visitorGet(browser, searchUrl);
      const adminPosts = await page.request.get(card!.postsHref);
      const adminText = await adminPosts.text();
      note(`Delete dialog: "${dialogText}"; community deleted ${deleted}; afterwards: post page HTTP ${direct.status}, in search ${search.text.includes(postTitle)}, admin post list HTTP ${adminPosts.status()} (lists the post ${adminText.includes(postTitle)})`);
      note(`Policy seen: ${deleted ? 'the community is deleted with its posts, without a warning that it still has posts' : 'the delete is refused'}`);
      if (deleted) {
        expect(direct.status, 'no orphan: the post page is gone').not.toBe(200);
        if (before.status === 200) expect.soft(direct.status, 'and gone cleanly (404, not a server error)').toBeLessThan(500);
        expect(search.text.includes(postTitle), 'no orphan: the post is not in the search').toBe(false);
        expect(adminText.includes(postTitle), 'no orphan: the admin no longer lists it').toBe(false);
      }
    } finally {
      if (!deleted) await deleteCopsByDescription(cops, page, description);
    }
  });

  test(sheetTitle('TC-ADMC-06-06'), async ({ page, browser }) => {
    requireDataCreatingTestsAllowed(CREATES);
    const cops = new AdminCopsPage(page);
    const description = copDescription();
    const contexts = [await browser.newContext({ storageState: ADMIN_AUTH_FILE }), await browser.newContext({ storageState: ADMIN_AUTH_FILE })];
    try {
      expect((await submitNewCop(cops, { name: `AUTO_COPS_RACE ${roleStamp()}`, description, status: 'publish' })).status()).toBeLessThan(400);
      const pages = await Promise.all(contexts.map((c) => c.newPage()));
      const editors = pages.map((p) => new AdminCopsPage(p));
      for (const e of editors) {
        await e.open();
        const found = await e.locate((c) => c.description === description);
        await e.cards.nth(found!.index).locator('.js-edit-cop').click();
        await e.nameInput.waitFor({ state: 'visible' });
      }
      const names = [`AUTO_COPS_A ${roleStamp()}`, `AUTO_COPS_B ${roleStamp()}`];
      const statuses: number[] = [];
      for (const [i, e] of editors.entries()) {
        await e.fill({ name: names[i] });
        statuses.push((await e.save()).status());
      }
      await cops.open();
      const cards = (await cops.readCards()).filter((c) => c.description === description);
      const flash = (await pages[1].locator('.alert').allInnerTexts()).join(' ');
      note(`Saves ${JSON.stringify(statuses)}; second editor saw "${flash}"; result ${JSON.stringify(cards.map((c) => c.name))}`);
      note(`Policy seen: ${cards[0]?.name === names[1] ? 'last write wins' : cards[0]?.name === names[0] ? 'the first save is kept (conflict detected)' : 'other'}`);
      expect(statuses.every((s) => s < 500), 'no server error').toBe(true);
      expect(cards.length, 'still exactly one community').toBe(1);
      expect(names, 'its name is one of the two saves (no mix-up)').toContain(cards[0].name);
      expect(cards[0].description, 'the other fields are intact').toBe(description);
    } finally {
      for (const c of contexts) await c.close();
      await deleteCopsByDescription(cops, page, description);
    }
  });
});

test.describe('Manual → Auto: FAQ', () => {
  async function faqDupCase(page: Page, browser: Browser, second: (q: string) => string): Promise<void> {
    requireDataCreatingTestsAllowed(CREATES);
    const category = await createFaqCategory(page, `${AUTO_TEST_FLAG} หมวดซ้ำ`);
    const question = `${AUTO_TEST_FLAG} Duplicate Question ${roleStamp()}`;
    const answers = [faqMarker(), faqMarker()];
    try {
      expect((await submitFaq(page, { question, answer: answers[0], category })).final).toBeLessThan(500);
      const again = await submitFaq(page, { question: second(question), answer: answers[1], category });
      const message = (await page.locator('#faqMod .text-danger, #faqMod .invalid-feedback, #faqMod .text-xsmall, .alert').allInnerTexts()).join(' ').replace(/\s+/g, ' ');
      expect(again.final, 'no server error').toBeLessThan(500);
      const faq = new AdminFaqPage(page);
      await faq.open();
      const saved = (await faq.readCards()).filter((c) => answers.includes(c.editAnswer));
      const pub = await publicFaq(browser);
      const shown = pub.questions.filter((q) => q.toLowerCase().includes(question.toLowerCase())).length;
      note(`Policy seen: ${saved.length === 2 ? 'the duplicate question is saved' : 'the duplicate is refused'} (message "${message}"); public shows ${shown}`);
      expect([1, 2], 'one or two FAQs').toContain(saved.length);
      expect(shown, 'the public page shows the same FAQs').toBe(saved.length);
    } finally {
      for (const a of answers) await deleteFaqWhere(page, (c) => c.editAnswer === a);
      await deleteFaqCategories(page, category);
    }
  }

  test(sheetTitle('TC-ADMF-05-04'), async ({ page, browser }) => faqDupCase(page, browser, (q) => q));
  test(sheetTitle('TC-ADMF-03-12'), async ({ page, browser }) => faqDupCase(page, browser, flipCase));
  test(sheetTitle('TC-FFAQ-02-12'), async ({ page, browser }) => faqDupCase(page, browser, flipCase));

  test(sheetTitle('TC-FFAQ-01-06'), async ({ page }) => {
    const faq = new AdminFaqPage(page);
    await faq.openAddForm();
    const fields = await faq.panel.locator('input, select, textarea').evaluateAll((els) => els.map((e) => `${e.tagName.toLowerCase()}[${e.getAttribute('name') ?? e.id}]`));
    note(`FAQ panel fields: ${JSON.stringify(fields)}`);
    expect(fields.filter((f) => /author|source|video|document|reference|cover|tag/i.test(f)), 'no article-only fields (author, source, video, documents, reference, cover, tags)').toEqual([]);
  });

  test(sheetTitle('TC-FFAQ-01-07'), async ({ page, browser }) => {
    requireDataCreatingTestsAllowed(CREATES);
    const faq = new AdminFaqPage(page);
    await faq.openAddForm();
    const faqEditor = await faq.answerInput.evaluate((el) => `${el.tagName.toLowerCase()}${el.closest('.tox, .ql-container, .note-editor') ? ' (rich editor)' : ''}`);
    const form = new NewsFormPage(page, M);
    await form.openCreate();
    const articleEditor = (await page.locator('.tox-tinymce, iframe[id$="_ifr"]').count()) ? 'TinyMCE (rich editor)' : 'other';
    note(`Editors: FAQ answer = ${faqEditor}; article body = ${articleEditor}`);
    // Whatever the editor, the same markup must be equally safe on the public pages.
    const category = await createFaqCategory(page, `${AUTO_TEST_FLAG} หมวดตัวแก้ไข`);
    const payload = `<b>ตัวหนา</b><img src=x onerror=alert(1)><script>alert(2)</script> ${roleStamp()}`;
    const answer = `${AUTO_TEST_FLAG} ${payload}`;
    try {
      expect((await submitFaq(page, { question: `${AUTO_TEST_FLAG} คำถามตัวแก้ไข ${roleStamp()}`, answer, category })).final).toBeLessThan(500);
      const faqDialogs = await asVisitor(browser, async (p) => {
        const dialogs = collectDialogs(p);
        await p.goto(urlOf('/frontend/faq/index'));
        await p.locator('.accordion-button').last().click().catch(() => undefined);
        await p.waitForTimeout(800);
        return dialogs;
      });
      const saved = await saveAccepted(page, M, 'TC-FFAQ-01-07', { body: payload, status: 'publish' });
      const detail = await publicDetailOf(browser, M, saved);
      note(`Dialogs: FAQ page ${JSON.stringify(faqDialogs)}; article page ${JSON.stringify(detail.dialogs)}`);
      expect(faqDialogs, 'FAQ: no script runs').toEqual([]);
      expect(detail.dialogs, 'article: no script runs').toEqual([]);
    } finally {
      await deleteFaqWhere(page, (c) => c.editAnswer === answer);
      await deleteFaqCategories(page, category);
    }
  });

  test(sheetTitle('TC-FFAQ-02-14'), async ({ page }) => {
    requireDataCreatingTestsAllowed(CREATES);
    const faq = new AdminFaqPage(page);
    const cats = [await createFaqCategory(page, `${AUTO_TEST_FLAG} หมวดหนึ่ง`), await createFaqCategory(page, `${AUTO_TEST_FLAG} หมวดสอง`)];
    const answer = faqMarker();
    try {
      await faq.open();
      await faq.openAddForm();
      const multiple = await faq.categorySelect.evaluate((s: HTMLSelectElement) => s.multiple);
      note(`Category field: ${multiple ? 'multi-select' : 'single select (one category per FAQ)'}`);
      await faq.fill({ question: `${AUTO_TEST_FLAG} หลายหมวด ${roleStamp()}`, answer, status: 'publish' });
      await faq.categorySelect.evaluate((s: HTMLSelectElement, labels) => {
        for (const o of [...s.options]) o.selected = labels.includes((o.textContent ?? '').trim()) && (s.multiple || labels[0] === (o.textContent ?? '').trim());
        s.dispatchEvent(new Event('change', { bubbles: true }));
      }, cats);
      const saved = await faq.save();
      expect(saved.final, 'no server error').toBeLessThan(500);
      await faq.open();
      const mine = (await faq.readCards()).find((c) => c.editAnswer === answer);
      note(`Saved: ${!!mine}; stored category "${mine?.editCategory}"`);
      expect(mine, 'the FAQ is saved with its category (one, or several when the field allows it)').toBeTruthy();
      expect(mine!.editCategory, 'a category is stored').not.toBe('');
    } finally {
      await deleteFaqWhere(page, (c) => c.editAnswer === answer);
      for (const c of cats) await deleteFaqCategories(page, c);
    }
  });

  test(sheetTitle('TC-FFAQ-02-15'), async ({ page }) => {
    requireDataCreatingTestsAllowed(CREATES);
    const faq = new AdminFaqPage(page);
    const answer = faqMarker();
    try {
      await faq.openAddForm();
      await faq.fill({ question: `${AUTO_TEST_FLAG} ไม่มีหมวด ${roleStamp()}`, answer, status: 'publish' });
      await faq.categorySelect.evaluate((s: HTMLSelectElement) => {
        s.value = '';
        s.removeAttribute('required');
        s.dispatchEvent(new Event('change', { bubbles: true }));
      });
      const saved = await faq.save();
      const message = (await page.locator('#faqMod .text-danger, #faqMod .invalid-feedback, #faqMod .text-xsmall').allInnerTexts()).join(' ');
      await faq.open();
      const mine = (await faq.readCards()).find((c) => c.editAnswer === answer);
      note(`Policy seen: ${mine ? `saved (category "${mine.editCategory}")` : `refused ("${message}")`}`);
      expect(saved.final, 'no server error').toBeLessThan(500);
      if (!mine) expect(message, 'the refusal says why (in Thai)').toMatch(/[฀-๿]/);
    } finally {
      await deleteFaqWhere(page, (c) => c.editAnswer === answer);
    }
  });

  test(sheetTitle('TC-FFAQ-03-02'), async ({ page }) => {
    requireDataCreatingTestsAllowed(CREATES);
    const category = await createFaqCategory(page, `${AUTO_TEST_FLAG} หมวดคำตอบว่าง`);
    const question = `${AUTO_TEST_FLAG} คำตอบว่าง ${roleStamp()}`;
    try {
      const faq = new AdminFaqPage(page);
      await faq.openAddForm();
      await faq.fill({ question, answer: '', category, status: 'publish' });
      await faq.answerInput.evaluate((el) => el.removeAttribute('required'));
      expect((await faq.save()).final).toBeLessThan(500);
      const saved = await faq.findByQuestion(question);
      note(`Empty answer saved: ${!!saved}`);
      test.fail(!!saved, KNOWN.EMPTY_ANSWER);
      expect(saved, 'a FAQ needs an answer').toBeUndefined();
    } finally {
      await deleteFaqWhere(page, (c) => c.question === question);
      await deleteFaqCategories(page, category);
    }
  });
});

test.describe('Manual → Auto: หมวดหมู่ซ้ำ', () => {
  for (const [id, second] of [['TC-ADMG-02-03', (n: string) => n], ['TC-ADMG-03-12', flipCase]] as const) {
    test(sheetTitle(id), async ({ page }) => {
      requireDataCreatingTestsAllowed(CREATES);
      const group = new AdminGroupPage(page);
      const name = `AUTO_GRP_Know ${roleStamp()}`;
      try {
        for (const n of [name, second(name)]) {
          await group.open('knowledge');
          await group.openAddForm();
          await group.fill({ name: n, description: CATEGORY_DESCRIPTION, status: 'publish' });
          expect((await group.save()).status(), 'no server error').toBeLessThan(500);
        }
        await group.open('knowledge');
        const same = (await group.readCards()).filter((c) => c.name.toLowerCase() === name.toLowerCase());
        note(`Categories named "${name}" (any case): ${same.length}`);
        test.fail(same.length > 1, KNOWN.DUP_CATEGORY);
        expect(same.length, 'the duplicate is refused').toBe(1);
      } finally {
        for (const n of [name, second(name)]) for (let i = 0; i < 3; i++) if (!(await deleteNewsCategory(page, n, M))) break;
      }
    });
  }
});

test.describe('Manual → Auto: สไลด์และส่วนท้าย', () => {
  test(sheetTitle('TC-ADMH-05-05'), async ({ page, browser }) => {
    requireDataCreatingTestsAllowed(CREATES);
    const home = new AdminHomePage(page);
    const before = await slideIds(page);
    const links = Array.from({ length: 12 }, (_, i) => `https://www.example.com/auto-test-max-${i}-${roleStamp()}`);
    const results: string[] = [];
    try {
      for (const link of links) {
        await home.openAddSlide();
        await home.fill({ image: SLIDE_IMAGE, status: 'publish', link });
        const saved = await home.save();
        const message = (await page.locator('.alert, #slideMod .text-danger, #slideMod .text-xsmall').allInnerTexts()).join(' ').replace(/\s+/g, ' ');
        results.push(`${saved.final}${/สูงสุด|เกิน|ไม่เกิน|limit/i.test(message) ? ` limit: ${message}` : ''}`);
        expect(saved.final, 'no server error').toBeLessThan(500);
        if (/สูงสุด|เกิน|ไม่เกิน|limit/i.test(message)) break;
      }
      await home.open();
      const own = (await home.slides()).filter((s) => links.includes(s.editLink));
      const hero = await publicHero(browser);
      const shown = hero.slides.filter((s) => links.includes(s.href)).length;
      note(`Saves: ${results.join(' | ')}; stored ${own.length}; home page shows ${shown}`);
      note(`Policy seen: ${results.some((r) => r.includes('limit')) ? 'a maximum is enforced with a message' : `no maximum — ${own.length} slides accepted`}`);
      expect(shown, 'the home page shows every stored slide').toBe(own.length);
    } finally {
      let n = 0;
      for (const link of links) n += await deleteOwnSlides(page, before, { link });
      note(`Cleanup: deleted ${n} slide(s).`);
    }
  });

  test(sheetTitle('TC-FSLD-03-10'), async ({ page, browser }) => {
    requireDataCreatingTestsAllowed(CREATES);
    const home = new AdminHomePage(page);
    const before = await slideIds(page);
    const link = `mailto:km@nurse.chula.ac.th?subject=auto-test-${roleStamp()}`;
    try {
      await home.openAddSlide();
      await home.fill({ image: SLIDE_IMAGE, status: 'publish', link });
      expect((await home.save()).final, 'no server error').toBeLessThan(500);
      await home.open();
      const stored = (await home.slides()).find((s) => s.editLink === link && !before.has(s.sectionId));
      const hero = await publicHero(browser);
      note(`Policy seen: ${stored ? 'mailto: accepted' : 'mailto: refused'}; public hrefs ${JSON.stringify(hero.slides.map((s) => s.href).filter((h) => h.startsWith('mailto:')))}`);
      if (stored) expect(hero.slides.map((s) => s.href), 'the slide opens the mail program (href mailto:)').toContain(link);
    } finally {
      await deleteOwnSlides(page, before, { link });
    }
  });

  test(sheetTitle('TC-FFTR-03-10'), async ({ page, browser }) => {
    requireDataCreatingTestsAllowed(CREATES);
    const home = new AdminHomePage(page);
    const before = await menuIds(page);
    const title = menuTitle('AUTO_MAILTO');
    const link = 'mailto:km@nurse.chula.ac.th';
    try {
      await home.openAddMenu();
      await home.fillMenu({ title, link, column: '3', fontWeight: 'normal', status: 'publish' });
      expect((await home.saveMenu()).final, 'no server error').toBeLessThan(500);
      const item = (await publicFooter(browser)).items.find((i) => i.text === title);
      note(`Policy seen: ${item ? `mailto: accepted, public href ${item.href}` : 'refused / not shown'}`);
      if (item) expect(item.href, 'the footer link opens the mail program').toBe(link);
    } finally {
      await deleteOwnMenus(page, before, { title });
    }
  });

  test(sheetTitle('TC-FFTR-03-12'), async ({ page, browser }) => {
    requireDataCreatingTestsAllowed(CREATES);
    const home = new AdminHomePage(page);
    const before = await menuIds(page);
    const title = menuTitle('AUTO_FOOTER_DUP');
    const links = [`https://example.com/?auto-test=${roleStamp()}`, `https://example.com/?auto-test=${roleStamp()}`];
    try {
      for (const link of links) {
        await home.openAddMenu();
        await home.fillMenu({ title, link, column: '3', fontWeight: 'normal', status: 'publish' });
        expect((await home.saveMenu()).final, 'no server error').toBeLessThan(500);
      }
      const items = (await publicFooter(browser)).items.filter((i) => i.text === title);
      note(`Policy seen: ${items.length} footer item(s) named "${title}"; hrefs ${JSON.stringify(items.map((i) => i.href))}`);
      expect([1, 2], 'one or two items').toContain(items.length);
      if (items.length === 2) expect(new Set(items.map((i) => i.href)).size, 'each keeps its own link').toBe(2);
    } finally {
      await deleteOwnMenus(page, before, { title });
    }
  });
});

test.describe('Manual → Auto: ฟอร์มบทความ', () => {
  test(sheetTitle('TC-FKNO-04-06'), async ({ page, browser }) => {
    requireDataCreatingTestsAllowed(CREATES);
    const saved = await saveItem(page, M, 'TC-FKNO-04-06', { videoUrl: 'https://vimeo.com/76979871', status: 'publish' });
    expect(saved.submitted.final, 'no server error').toBeLessThan(500);
    const card = await new AdminNewsListPage(page, M).findByExcerpt(saved.excerpt);
    if (!card) {
      const messages = await new NewsFormPage(page, M).messages();
      note(`Policy seen: Vimeo refused — ${messages.map((m) => m.text).join(' | ')}`);
      expect(messages.some((m) => m.visible), 'with a message').toBe(true);
      return;
    }
    const detail = await publicDetailOf(browser, M, saved);
    note(`Policy seen: Vimeo accepted; embeds ${JSON.stringify(detail.media.embeds.map((e) => e.src))}`);
    expect(detail.media.embeds.some((e) => /vimeo/.test(e.src)) || detail.html.includes('vimeo.com/76979871'), 'the video is shown (player or link)').toBe(true);
  });

  test(sheetTitle('TC-FKNO-04-07'), async ({ page, browser }) => {
    requireDataCreatingTestsAllowed(CREATES);
    const saved = await saveItem(page, M, 'TC-FKNO-04-07', { videoUrl: 'https://example.com/page', status: 'publish' });
    expect(saved.submitted.final, 'no server error').toBeLessThan(500);
    const card = await new AdminNewsListPage(page, M).findByExcerpt(saved.excerpt);
    if (!card) {
      note('Policy seen: a non-video link is refused');
      return;
    }
    const detail = await publicDetailOf(browser, M, saved);
    const framed = detail.media.embeds.filter((e) => /example\.com/.test(e.src));
    note(`Policy seen: accepted; embeds ${JSON.stringify(detail.media.embeds.map((e) => e.src))}`);
    expect(detail.status, 'the public page works').toBe(200);
    test.fail(framed.length > 0, KNOWN.ANY_PAGE_AS_VIDEO);
    expect(framed.length, 'the page is not framed as a video (shown as a plain link or left out)').toBe(0);
  });

  test(sheetTitle('TC-FKNO-05-14'), async ({ page, browser }) => {
    requireDataCreatingTestsAllowed(CREATES);
    const saved = await saveItem(page, M, 'TC-FKNO-05-14', { referenceDate: '2030-12-31', status: 'publish' });
    expect(saved.submitted.final, 'no server error').toBeLessThan(500);
    const card = await new AdminNewsListPage(page, M).findByExcerpt(saved.excerpt);
    note(`Policy seen: a future reference date is ${card ? 'accepted' : 'refused'}`);
    if (card) expect((await publicDetailOf(browser, M, saved)).status).toBe(200);
  });

  test(sheetTitle('TC-FKNO-05-27'), async ({ page, browser }) => {
    requireDataCreatingTestsAllowed(CREATES);
    const link = 'mailto:km@nurse.chula.ac.th';
    const saved = await saveItem(page, M, 'TC-FKNO-05-27', { referenceUrl: link, status: 'publish' });
    expect(saved.submitted.final, 'no server error').toBeLessThan(500);
    const card = await new AdminNewsListPage(page, M).findByExcerpt(saved.excerpt);
    note(`Policy seen: mailto: ${card ? 'accepted' : 'refused'}`);
    if (card) {
      const detail = await publicDetailOf(browser, M, saved);
      expect(detail.html, 'the reference opens the mail program').toContain(`href="${link}"`);
    }
  });

  test(sheetTitle('TC-FKNO-06-07'), async ({ page, browser }) => {
    requireDataCreatingTestsAllowed(CREATES);
    const yesterday = localDateTime(new Date(Date.now() - 24 * 3600_000));
    const saved = await saveItem(page, M, 'TC-FKNO-06-07', { status: 'publish', timing: 'schedule', publishedAt: yesterday });
    expect(saved.submitted.final, 'no server error').toBeLessThan(500);
    const card = await new AdminNewsListPage(page, M).findByExcerpt(saved.excerpt);
    const pub = card ? await isOnPublicList(browser, M, saved.excerpt) : false;
    note(`Scheduled for ${yesterday}: saved ${!!card} (status "${card?.status}"); public ${pub}`);
    if (card) {
      test.fail(!pub, KNOWN.SCHEDULE_NEVER);
      expect(pub, 'a past time publishes at once').toBe(true);
    }
  });

  test(sheetTitle('TC-FKNO-06-08'), async ({ page, browser }) => {
    requireDataCreatingTestsAllowed(CREATES);
    test.setTimeout(420_000);
    const at = new Date(Date.now() + 2 * 60_000);
    const drafts = [];
    for (const status of ['draft', 'hide'] as const) {
      // The schedule option shows only while "เผยแพร่" is picked: set the time first, then switch the status.
      const saved = { title: itemTitle('TC-FKNO-06-08', `_${status.toUpperCase()}`), excerpt: itemExcerpt() };
      trackItem(M, saved.excerpt);
      const form = new NewsFormPage(page, M);
      await form.openCreate();
      await form.fill({ ...saved, body: '<p>เนื้อหาทดสอบ</p>', status: 'publish', timing: 'schedule', publishedAt: localDateTime(at) });
      await form.fill({ status });
      const scheduleShown = await page.locator('label[for="publish-timing-schedule"]').isVisible();
      note(`${status}: the schedule option is ${scheduleShown ? 'still shown' : 'hidden'} once the status is "${status}"`);
      expect((await form.save()).final, 'no server error').toBeLessThan(500);
      const card = await new AdminNewsListPage(page, M).findByExcerpt(saved.excerpt);
      note(`${saved.title}: saved ${!!card} with status "${card?.status}"`);
      drafts.push(saved);
    }
    await page.waitForTimeout(Math.max(0, at.getTime() - Date.now()) + 70_000);
    for (const s of drafts) {
      const pub = await isOnPublicList(browser, M, s.excerpt);
      note(`${s.title}: public after the time passed ${pub}`);
      expect(pub, 'a draft / hidden item never publishes itself').toBe(false);
    }
  });

  test(sheetTitle('TC-FKNO-09-10'), async ({ page, browser }) => {
    requireDataCreatingTestsAllowed(CREATES);
    for (const [label, body] of [['empty', ''], ['blank', '<p>&nbsp;</p><p>&nbsp;</p><p>   </p>']] as const) {
      const saved = await saveItem(page, M, 'TC-FKNO-09-10', { title: itemTitle('TC-FKNO-09-10', `_${label.toUpperCase()}`), body, status: 'publish' });
      expect(saved.submitted.final, 'no server error').toBeLessThan(500);
      const card = await new AdminNewsListPage(page, M).findByExcerpt(saved.excerpt);
      note(`Policy seen (${label} body): ${card ? 'saved' : 'refused'}`);
      if (!card) continue;
      const detail = await publicDetailOf(browser, M, saved);
      const blanks = (detail.html.match(/<p>(\s|&nbsp;| )*<\/p>/g) ?? []).length;
      note(`Public page: ${blanks} blank paragraph(s) rendered`);
      expect(detail.status).toBe(200);
      if (blanks) test.fail(true, KNOWN.BLANK_BODY);
      expect.soft(blanks, 'no empty content block on the public page').toBe(0);
    }
  });

  async function twinTitles(page: Page, browser: Browser, id: string, second: (t: string) => string): Promise<void> {
    requireDataCreatingTestsAllowed(CREATES);
    const title = `AUTO_Twin ${roleStamp()}`;
    // The public detail page shows no excerpt (DEF-87): each item is told apart by a marker in its body.
    const bodies = [`twin-first-${roleStamp()}`, `twin-second-${roleStamp()}`];
    const first = await saveItem(page, M, id, { title, body: `<p>${AUTO_TEST_FLAG} ${bodies[0]}</p>`, status: 'publish' });
    const other = await saveItem(page, M, id, { title: second(title), body: `<p>${AUTO_TEST_FLAG} ${bodies[1]}</p>`, excerpt: itemExcerpt('รายการที่สอง'), status: 'publish' });
    expect(first.submitted.final).toBeLessThan(500);
    expect(other.submitted.final, 'no server error').toBeLessThan(500);
    const list = new AdminNewsListPage(page, M);
    const both = [await list.findByExcerpt(first.excerpt), await list.findByExcerpt(other.excerpt)];
    note(`Policy seen: second title ${both[1] ? 'saved' : 'refused'}`);
    if (!both[1]) return;
    const pages = [await publicContentDetail(browser, first.excerpt, first.title, M), await publicContentDetail(browser, other.excerpt, other.title, M)];
    note(`Public URLs: ${pages.map((p) => p?.url).join(' | ')}`);
    const reachable = pages.every((p, i) => p?.status === 200 && p.text.includes(bodies[i]));
    test.fail(!reachable || pages[0]?.url === pages[1]?.url, KNOWN.SLUG_CLASH);
    expect(pages[0]?.url, 'each item has its own public URL').not.toBe(pages[1]?.url);
    expect(reachable, 'and each URL opens its own item').toBe(true);
  }

  test(sheetTitle('TC-FKNO-10-05'), async ({ page, browser }) => twinTitles(page, browser, 'TC-FKNO-10-05', (t) => t));
  test(sheetTitle('TC-KNOW-05-12'), async ({ page, browser }) => twinTitles(page, browser, 'TC-KNOW-05-12', flipCase));

  test(sheetTitle('TC-KNOW-12-04'), async ({ page, browser }) => {
    requireDataCreatingTestsAllowed(CREATES);
    const tomorrow = localDateTime(new Date(Date.now() + 24 * 3600_000));
    const saved = await saveAccepted(page, M, 'TC-KNOW-12-04', { status: 'publish', timing: 'schedule', publishedAt: tomorrow });
    const slug = saved.title.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
    const direct = await visitorGet(browser, `${M.publicDetail}${slug}`);
    const listed = await isOnPublicList(browser, M, saved.excerpt);
    note(`Scheduled for ${tomorrow}: on the public list ${listed}; direct URL HTTP ${direct.status}`);
    expect(listed, 'not on the public list before its time').toBe(false);
    expect(direct.status, 'not reachable by URL before its time').not.toBe(200);
  });

  test(sheetTitle('TC-KNOW-12-05'), async ({ page, browser }) => {
    requireDataCreatingTestsAllowed(CREATES);
    const newer = await saveAccepted(page, M, 'TC-KNOW-12-05', { title: itemTitle('TC-KNOW-12-05', '_NEW'), status: 'publish' });
    const old = await saveItem(page, M, 'TC-KNOW-12-05', { title: itemTitle('TC-KNOW-12-05', '_1990'), status: 'publish', timing: 'schedule', publishedAt: '1990-01-01T09:00' });
    expect(old.submitted.final, 'no server error').toBeLessThan(500);
    const card = await new AdminNewsListPage(page, M).findByExcerpt(old.excerpt);
    note(`Policy seen: a 1990 publish date is ${card ? 'accepted' : 'refused'}`);
    if (!card) return;
    const text = await asVisitor(browser, async (p) => {
      await p.goto(urlOf(M.publicIndex));
      return (await p.locator('body').innerText()).replace(/\s+/g, ' ');
    });
    const at = { newer: text.indexOf(newer.title), old: text.indexOf(old.title) };
    note(`Public list positions: newer ${at.newer}, 1990 ${at.old}`);
    for (const [k, i] of Object.entries(at)) if (i >= 0) note(`Card text (${k}): "${text.slice(Math.max(0, i - 60), i + 160)}"`);
    test.fail(at.old < 0, KNOWN.SCHEDULE_NEVER);
    expect(at.old, 'the 1990 item is listed').toBeGreaterThanOrEqual(0);
    test.fail(at.old < at.newer, KNOWN.ORDER_BY_CREATED);
    expect(at.old, 'after the newer item (newest first)').toBeGreaterThan(at.newer);
  });

  test(sheetTitle('TC-NFR-07-08'), async ({ page, browser }) => {
    requireDataCreatingTestsAllowed(CREATES);
    const saved = await saveAccepted(page, M, 'TC-NFR-07-08', { status: 'publish' });
    const contexts = [await browser.newContext({ storageState: ADMIN_AUTH_FILE }), await browser.newContext({ storageState: ADMIN_AUTH_FILE })];
    try {
      const forms = await Promise.all(contexts.map(async (c) => {
        const p = await c.newPage();
        const f = new NewsFormPage(p, M);
        await f.openEdit(new URL(saved.card.editHref, page.url()).href);
        return f;
      }));
      await forms[0].fill({ status: 'hide' });
      const a = await forms[0].save();
      await forms[1].fill({ title: `${saved.title} B` });
      const b = await forms[1].save();
      const card = await new AdminNewsListPage(page, M).findByExcerpt(saved.excerpt);
      const pub = await isOnPublicList(browser, M, saved.excerpt);
      const search = await visitorGet(browser, `/frontend/search/index?q=${encodeURIComponent(saved.title.split(' ').pop()!)}`);
      note(`Saves A ${a.final}, B ${b.final}; admin status "${card?.status}" title "${card?.title}"; public list ${pub}; search ${search.text.includes(saved.excerpt)}`);
      expect([a.final, b.final].every((s) => s < 500), 'no server error').toBe(true);
      const hidden = /ซ่อน/.test(card?.status ?? '');
      expect(pub, 'the public list agrees with the admin status').toBe(!hidden);
      expect(search.text.includes(saved.excerpt), 'and so does the search').toBe(!hidden);
    } finally {
      for (const c of contexts) await c.close();
    }
  });
});

test.describe('Manual → Auto: ไฟล์ใหญ่มาก / ไฟล์บีบอัด', () => {
  test(sheetTitle('TC-SEC-02-10'), async ({ page }) => {
    requireDataCreatingTestsAllowed(CREATES);
    const zlib = await import('zlib');
    // A small zip that inflates to 200 MB of zeros (stored with the deflate method).
    const raw = Buffer.alloc(200 * MB);
    const data = zlib.deflateRawSync(raw, { level: 9 });
    const crc = (() => {
      let c = ~0 >>> 0;
      const table = Array.from({ length: 256 }, (_, n) => {
        let x = n;
        for (let k = 0; k < 8; k++) x = x & 1 ? 0xedb88320 ^ (x >>> 1) : x >>> 1;
        return x >>> 0;
      });
      for (let i = 0; i < raw.length; i++) c = table[(c ^ raw[i]) & 0xff] ^ (c >>> 8);
      return (~c >>> 0);
    })();
    const name = Buffer.from('zeros.txt');
    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0); local.writeUInt16LE(20, 4); local.writeUInt16LE(8, 8); local.writeUInt32LE(crc, 14); local.writeUInt32LE(data.length, 18); local.writeUInt32LE(raw.length, 22); local.writeUInt16LE(name.length, 26);
    const central = Buffer.alloc(46);
    central.writeUInt32LE(0x02014b50, 0); central.writeUInt16LE(20, 4); central.writeUInt16LE(20, 6); central.writeUInt16LE(8, 10); central.writeUInt32LE(crc, 16); central.writeUInt32LE(data.length, 20); central.writeUInt32LE(raw.length, 24); central.writeUInt16LE(name.length, 28);
    const end = Buffer.alloc(22);
    const centralAt = local.length + name.length + data.length;
    end.writeUInt32LE(0x06054b50, 0); end.writeUInt16LE(1, 8); end.writeUInt16LE(1, 10); end.writeUInt32LE(central.length + name.length, 12); end.writeUInt32LE(centralAt, 16);
    const bomb = path.join(os.tmpdir(), `qa-${roleStamp()}-bomb.zip`);
    fs.writeFileSync(bomb, Buffer.concat([local, name, data, central, name, end]));
    const huge = bigFile('huge.pdf', 120 * MB);
    try {
      for (const [label, file] of [['zip bomb', bomb], ['120 MB file', huge]] as const) {
        const started = Date.now();
        const saved = await Promise.race([
          saveItem(page, M, 'TC-SEC-02-10', { title: itemTitle('TC-SEC-02-10', label === 'zip bomb' ? '_ZIP' : '_HUGE'), documents: [file], status: 'draft' }).then(async (s) => {
            const card = await new AdminNewsListPage(page, M).findByExcerpt(s.excerpt);
            note(`${label}: item ${card ? `saved (counters ${JSON.stringify(card.counters)})` : 'not saved'}`);
            return s.submitted.final;
          }),
          new Promise<number>((r) => setTimeout(() => r(-1), 90_000)),
        ]);
        const seconds = Math.round((Date.now() - started) / 1000);
        note(`${label}: ${saved < 0 ? 'no answer within 90 s' : `HTTP ${saved}`} after ${seconds} s`);
        if (label === '120 MB file') test.fail(saved < 0, KNOWN.BIG_UPLOAD_HANGS);
        expect(saved, `${label}: answered (refused) within 90 s`).toBeGreaterThan(0);
        expect(saved, `${label}: no server error`).toBeLessThan(500);
        await page.goto(urlOf('/admin/knowledge/index'));
      }
    } finally {
      fs.rmSync(bomb, { force: true });
      fs.rmSync(huge, { force: true });
    }
  });
});
