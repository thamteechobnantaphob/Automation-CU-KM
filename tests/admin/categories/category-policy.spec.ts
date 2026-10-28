import { test, expect } from '@fixtures/pages.fixtures';
import { ANONYMOUS_SESSION } from '@fixtures/pages.fixtures';
import { requireDataCreatingTestsAllowed } from '@config/env';
import { MAX_LENGTH, POLICY_SOURCE } from '@config/policy';
import { AdminFaqPage } from '@pages/admin/AdminFaqPage';
import { AdminGroupPage, GROUP_TABS, GroupTabKey } from '@pages/admin/AdminGroupPage';
import { AdminNewsListPage, BEST_PRACTICE_MODULE, ContentModule, KNOWLEDGE_MODULE, NEWS_MODULE, NewsFormPage, submitAndFollow } from '@pages/admin/AdminNewsPages';
import { sheetTitle } from '@utils/caseTitles';
import { CATEGORY_DESCRIPTION } from '@utils/categoryFlows';
import { urlOf } from '@utils/lowPrivilege';
import { deleteNewsByExcerpt, newsExcerpt, submitNews } from '@utils/newsFlows';
import { roleStamp } from '@utils/roleFlows';
import { collectDialogs } from '@utils/security';
import { AUTO_TEST_FLAG } from '@utils/testData';
import { Browser, Page } from '@playwright/test';
import { textOfLength } from '../content/contentLimitsSuite';

/**
 * KM-ADMG — categories (Auto:P + the {MAX} cases), checked 2026-10-07. Limit: category name 100 characters (the
 * OWASP-based proposal in src/config/policy.ts) until SA/Dev decide. Every category a case saves carries "[Auto Test]"
 * in its "หัวข้อย่อย" (description) and is deleted again in `finally`; the content items it saves carry the marker in
 * their excerpt and are deleted too. QA's own categories (e.g. AUTO_CAT_001, no marker) are never touched.
 */

const CREATES = 'Saves categories (and content using them) — all deleted again at the end of the case.';
const KNOWN = {
  UNLIMITED: 'Known bug (DEF-35): the category name has no length limit — 101 characters (proposed maximum 100) are saved.',
  WIDE_DROPDOWN: 'Known bug (DEF-98): a long category name makes the category dropdown wider than the window.',
};

/** The content form that uses each category tab (cop / infographic have no content form with a category picker). */
const FORM_OF: Partial<Record<GroupTabKey, ContentModule>> = { cms: NEWS_MODULE, knowledge: KNOWLEDGE_MODULE, best_practice: BEST_PRACTICE_MODULE };

test.beforeEach(() => test.setTimeout(240_000));

function note(description: string): void {
  test.info().annotations.push({ type: 'note', description });
}

/** Creates a category on `tab` (marker in the description); returns its name. */
async function addCategory(page: Page, tab: GroupTabKey, name: string): Promise<string> {
  const groupPage = new AdminGroupPage(page);
  await groupPage.open(tab);
  await groupPage.openAddForm();
  await groupPage.fill({ name, description: CATEGORY_DESCRIPTION, status: 'publish' });
  expect((await groupPage.save()).status(), `saving the category on "${tab}"`).toBeLessThan(500);
  return name;
}

/** Deletes the case's categories (name + tab), only when their description carries the marker. Never throws. */
async function removeCategories(page: Page, made: { tab: GroupTabKey; name: string }[]): Promise<void> {
  const groupPage = new AdminGroupPage(page);
  let deleted = 0;
  for (const { tab, name } of made) {
    try {
      await groupPage.open(tab);
      const card = await groupPage.findCard(name);
      if (!card || !card.description.includes(AUTO_TEST_FLAG)) continue;
      const dialog = await groupPage.openDeleteDialog(name);
      await submitAndFollow(page, () => dialog.confirm());
      deleted++;
    } catch {
      // reported below
    }
  }
  note(`Cleanup: deleted ${deleted} of ${made.length} categor(ies).`);
}

async function formOptions(page: Page, module: ContentModule): Promise<string[]> {
  const form = new NewsFormPage(page, module);
  await form.openCreate();
  return form.categoryOptions();
}

/** The public list of `module` (optionally filtered) as a visitor: text, category filter options and URL. */
async function publicList(browser: Browser, module: ContentModule, query = ''): Promise<{ text: string; options: { value: string; label: string }[]; html: string; dialogs: string[] }> {
  const context = await browser.newContext({ storageState: ANONYMOUS_SESSION });
  try {
    const page = await context.newPage();
    const dialogs = collectDialogs(page);
    await page.goto(urlOf(`${module.publicIndex}${query}`));
    await page.waitForLoadState('load');
    await page.waitForTimeout(400);
    const options = await page.locator('select[name="category"] option').evaluateAll((os) => os.map((o) => ({ value: (o as HTMLOptionElement).value, label: (o.textContent ?? '').trim() })));
    return { text: (await page.locator('body').innerText()).replace(/\s+/g, ' '), options, html: await page.locator('.body-content').innerHTML(), dialogs };
  } finally {
    await context.close();
  }
}

// ---------------------------------------------------------------------------------------------------------------

test.describe('SC-ADMG-02 เพิ่มและแก้ไขหมวดหมู่', () => {
  test(sheetTitle('TC-ADMG-02-01'), async ({ page }) => {
    requireDataCreatingTestsAllowed(CREATES);
    const stamp = roleStamp();
    const made: { tab: GroupTabKey; name: string }[] = [];
    try {
      for (const { key } of GROUP_TABS) made.push({ tab: key, name: await addCategory(page, key, `AUTO_CAT_${key} ${stamp}`) });
      const groupPage = new AdminGroupPage(page);
      for (const { tab, name } of made) {
        for (const other of GROUP_TABS) {
          await groupPage.open(other.key);
          const found = Boolean(await groupPage.findCard(name));
          expect.soft(found, `"${name}" ${other.key === tab ? 'is' : 'is not'} on the "${other.label}" tab`).toBe(other.key === tab);
        }
        const module = FORM_OF[tab];
        if (module) {
          const options = await formOptions(page, module);
          expect.soft(options, `offered in the ${module.key} form`).toContain(name);
          for (const [otherTab, otherModule] of Object.entries(FORM_OF)) if (otherTab !== tab) expect.soft(await formOptions(page, otherModule!), `not offered in the ${otherModule!.key} form`).not.toContain(name);
        } else if (tab === 'faq') {
          const faq = new AdminFaqPage(page);
          await faq.open();
          await faq.openAddForm();
          expect.soft(await faq.categoryOptions(), 'offered in the FAQ form').toContain(name);
          await faq.cancelButton.click();
        } else {
          note(`"${tab}": no content form with a category picker on Dev — only the tab is checked.`);
        }
      }
    } finally {
      await removeCategories(page, made);
    }
  });

  test(sheetTitle('TC-ADMG-02-04'), async ({ page, browser }) => {
    requireDataCreatingTestsAllowed(CREATES);
    const stamp = roleStamp();
    const made: { tab: GroupTabKey; name: string }[] = [];
    const excerpt = newsExcerpt();
    const title = `AUTO_CATEGORY_RENAME ${stamp}`;
    try {
      const before = await addCategory(page, 'knowledge', `AUTO_CAT_OLD ${stamp}`);
      made.push({ tab: 'knowledge', name: before });
      expect((await submitNews(page, { title, excerpt, category: before, status: 'publish' }, KNOWLEDGE_MODULE)).submitted.final).toBeLessThan(500);
      const after = `AUTO_CAT_NEW ${stamp}`;
      const groupPage = new AdminGroupPage(page);
      await groupPage.open('knowledge');
      await groupPage.openEditForm(before);
      await groupPage.fill({ name: after });
      expect((await groupPage.save()).status()).toBeLessThan(400);
      made.push({ tab: 'knowledge', name: after });
      const pub = await publicList(browser, KNOWLEDGE_MODULE);
      note(`Public filter options: ${JSON.stringify(pub.options.map((o) => o.label))}`);
      expect(pub.text, 'the article is still listed').toContain(excerpt);
      expect(pub.options.map((o) => o.label), 'the public filter shows the new name').toContain(after);
      expect(pub.text + JSON.stringify(pub.options), 'and not the old one').not.toContain(before);
      const form = new NewsFormPage(page, KNOWLEDGE_MODULE);
      const list = new AdminNewsListPage(page, KNOWLEDGE_MODULE);
      const card = await list.findByExcerpt(excerpt);
      await form.openEdit(card!.editHref);
      expect(await form.selectedCategory(), 'the article now shows the new category name').toBe(after);
    } finally {
      note(`Cleanup: deleted ${await deleteNewsByExcerpt(page, excerpt, KNOWLEDGE_MODULE)} article(s).`);
      await removeCategories(page, made);
    }
  });
});

test.describe('SC-ADMG-03 ชื่อหมวดหมู่ (ความยาว)', () => {
  test(sheetTitle('TC-ADMG-03-04'), async ({ page }) => {
    requireDataCreatingTestsAllowed(CREATES);
    note(`Limit used: ${POLICY_SOURCE}`);
    const name = textOfLength(`AUTO_CAT ${roleStamp()}`, MAX_LENGTH.categoryName);
    const made = [{ tab: 'knowledge' as GroupTabKey, name }];
    try {
      await addCategory(page, 'knowledge', name);
      const groupPage = new AdminGroupPage(page);
      await groupPage.open('knowledge');
      const card = await groupPage.findCard(name);
      expect(card?.name, `${MAX_LENGTH.categoryName} characters are saved whole`).toBe(name);
      const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
      expect(overflow, 'the category list does not break').toBeLessThanOrEqual(1);
      const form = new NewsFormPage(page, KNOWLEDGE_MODULE);
      await form.openCreate();
      expect(await form.categoryOptions(), 'offered whole in the knowledge form').toContain(name);
      await page.locator('.bootstrap-select').filter({ has: form.categorySelect }).locator('button').click();
      await page.waitForTimeout(400);
      const menu = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
      note(`Page overflow with the dropdown open: ${menu}px`);
      test.fail(menu > 1, KNOWN.WIDE_DROPDOWN);
      expect(menu, 'the open dropdown fits the window').toBeLessThanOrEqual(1);
    } finally {
      await removeCategories(page, made);
    }
  });

  test(sheetTitle('TC-ADMG-03-05'), async ({ page }) => {
    requireDataCreatingTestsAllowed(CREATES);
    note(`Limit used: ${POLICY_SOURCE}`);
    const groupPage = new AdminGroupPage(page);
    await groupPage.open('knowledge');
    await groupPage.openAddForm();
    const maxlength = await page.locator('#menuMod [name="name"]').getAttribute('maxlength');
    note(`maxlength: ${maxlength ?? '(none)'}`);
    if (maxlength && Number(maxlength) <= MAX_LENGTH.categoryName) return;
    const name = textOfLength(`AUTO_CAT ${roleStamp()}`, MAX_LENGTH.categoryName + 1);
    try {
      await groupPage.fill({ name, description: CATEGORY_DESCRIPTION, status: 'publish' });
      const response = await groupPage.save();
      expect(response.status(), 'no server error').toBeLessThan(500);
      await groupPage.open('knowledge');
      const kept = await groupPage.findCard(name);
      test.fail(Boolean(kept), KNOWN.UNLIMITED);
      expect(kept, `${MAX_LENGTH.categoryName + 1} characters are not saved`).toBeUndefined();
    } finally {
      await removeCategories(page, [{ tab: 'knowledge', name }]);
    }
  });
});

test.describe('SC-ADMG-04 หมวดหมู่กับเนื้อหาและหน้า Public', () => {
  test(sheetTitle('TC-ADMG-04-01'), async ({ page }) => {
    requireDataCreatingTestsAllowed(CREATES);
    const name = `AUTO_CAT_SAME ${roleStamp()}`;
    const made: { tab: GroupTabKey; name: string }[] = [];
    try {
      for (const tab of ['knowledge', 'best_practice'] as const) made.push({ tab, name: await addCategory(page, tab, name) });
      const groupPage = new AdminGroupPage(page);
      for (const tab of ['knowledge', 'best_practice', 'cms'] as const) {
        await groupPage.open(tab);
        const found = Boolean(await groupPage.locateCard(name, tab));
        expect.soft(found, `"${tab}" tab ${tab === 'cms' ? 'does not have it' : 'has it'}`).toBe(tab !== 'cms');
      }
      expect((await formOptions(page, KNOWLEDGE_MODULE)).filter((o) => o === name).length, 'the knowledge form offers it once').toBe(1);
      expect((await formOptions(page, BEST_PRACTICE_MODULE)).filter((o) => o === name).length, 'the best-practice form offers it once').toBe(1);
      expect(await formOptions(page, NEWS_MODULE), 'the news form does not offer it').not.toContain(name);
    } finally {
      await removeCategories(page, made);
    }
  });

  test(sheetTitle('TC-ADMG-04-02'), async ({ page, browser }) => {
    requireDataCreatingTestsAllowed(CREATES);
    const stamp = roleStamp();
    const excerpt = newsExcerpt();
    const made: { tab: GroupTabKey; name: string }[] = [];
    try {
      const before = await addCategory(page, 'knowledge', `AUTO_CAT_FILTER ${stamp}`);
      made.push({ tab: 'knowledge', name: before });
      expect((await submitNews(page, { title: `AUTO_FILTER ${stamp}`, excerpt, category: before, status: 'publish' }, KNOWLEDGE_MODULE)).submitted.final).toBeLessThan(500);
      const option = (await publicList(browser, KNOWLEDGE_MODULE)).options.find((o) => o.label === before);
      expect(option, 'the category is a public filter option').toBeDefined();
      const query = `?category=${encodeURIComponent(option!.value)}`;
      expect((await publicList(browser, KNOWLEDGE_MODULE, query)).text, 'the filter shows the article').toContain(excerpt);
      const after = `AUTO_CAT_FILTER_NEW ${stamp}`;
      const groupPage = new AdminGroupPage(page);
      await groupPage.open('knowledge');
      await groupPage.openEditForm(before);
      await groupPage.fill({ name: after });
      expect((await groupPage.save()).status()).toBeLessThan(400);
      made.push({ tab: 'knowledge', name: after });
      const again = await publicList(browser, KNOWLEDGE_MODULE, query);
      note(`Filter ${query} after the rename: options ${JSON.stringify(again.options.filter((o) => o.value === option!.value))}`);
      expect(again.text, 'the same filter URL still shows the article').toContain(excerpt);
      expect(again.options.find((o) => o.value === option!.value)?.label, 'the option now has the new name').toBe(after);
    } finally {
      note(`Cleanup: deleted ${await deleteNewsByExcerpt(page, excerpt, KNOWLEDGE_MODULE)} article(s).`);
      await removeCategories(page, made);
    }
  });

  test(sheetTitle('TC-ADMG-04-03'), async ({ page, browser }) => {
    requireDataCreatingTestsAllowed(CREATES);
    const stamp = roleStamp();
    const name = `<b>AUTO</b><script>alert('cat')</script> ${stamp}`;
    const excerpt = newsExcerpt();
    const made: { tab: GroupTabKey; name: string }[] = [];
    try {
      made.push({ tab: 'knowledge', name: await addCategory(page, 'knowledge', name) });
      expect((await submitNews(page, { title: `AUTO_CAT_HTML ${stamp}`, excerpt, category: name, status: 'publish' }, KNOWLEDGE_MODULE)).submitted.final).toBeLessThan(500);
      const pub = await publicList(browser, KNOWLEDGE_MODULE);
      note(`Public filter option: ${JSON.stringify(pub.options.find((o) => o.label.includes(stamp)))}`);
      expect(pub.dialogs, 'no script runs on the public list').toEqual([]);
      expect(pub.html, 'not rendered as markup').not.toContain(`<b>AUTO</b><script>`);
      expect(pub.options.map((o) => o.label), 'shown as text in the filter').toContain(name);
      const search = await (async () => {
        const context = await browser.newContext({ storageState: ANONYMOUS_SESSION });
        try {
          const visitor = await context.newPage();
          const dialogs = collectDialogs(visitor);
          await visitor.goto(urlOf(`/frontend/search/index?q=${encodeURIComponent(stamp)}`));
          await visitor.waitForTimeout(500);
          return { dialogs, html: await visitor.locator('.body-content').innerHTML() };
        } finally {
          await context.close();
        }
      })();
      expect(search.dialogs, 'no script runs on the search page').toEqual([]);
      expect(search.html, 'not rendered as markup in the results').not.toContain(`<b>AUTO</b><script>`);
    } finally {
      note(`Cleanup: deleted ${await deleteNewsByExcerpt(page, excerpt, KNOWLEDGE_MODULE)} article(s).`);
      await removeCategories(page, made);
    }
  });
});
