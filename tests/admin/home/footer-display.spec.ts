import { test, expect } from '@fixtures/pages.fixtures';
import { ANONYMOUS_SESSION } from '@fixtures/pages.fixtures';
import { requireDataCreatingTestsAllowed } from '@config/env';
import { MAX_LENGTH, POLICY_SOURCE } from '@config/policy';
import { AdminHomePage, MenuCard } from '@pages/admin/AdminHomePage';
import { submitAndFollow } from '@pages/admin/AdminNewsPages';
import { sheetTitle } from '@utils/caseTitles';
import { menuErrors, menuIds, menuLink, menuTitle, publicFooter, shownMenuErrors, withMenu } from '@utils/footerFlows';
import { urlOf } from '@utils/lowPrivilege';
import { roleStamp } from '@utils/roleFlows';
import { AUTO_TEST_FLAG } from '@utils/testData';
import { Browser, Page } from '@playwright/test';
import { textOfLength } from '../content/contentLimitsSuite';

/**
 * KM-FFTR / KM-ADMH — the footer menu on the public pages: order, statuses, editing, deleting, the {MAX} name cases
 * (proposal: 100 characters — src/config/policy.ts) and the "footer data" cases of KM-ADMH (checked 2026-10-07).
 * The footer tab manages menu items only (no phone / address fields — DEF-77); Dev's own items are never touched: a
 * case deletes only the items it created (new section id + its "[Auto Test]" title or stamped link).
 */

const CREATES = 'Adds a footer menu item (deleted again at the end of the case).';
const KNOWN = {
  TITLE_NOT_REQUIRED: 'Known bug (DEF-78): a footer item with an empty / blank title is saved (shown as an empty entry) — the sheet expects the server to refuse it.',
  DRAFT_AS_HIDDEN: 'Known bug (DEF-109): a draft ("ฉบับร่าง") is saved as hidden — the form posts status=draft but the item is stored and badged "ซ่อน" (slides, albums, footer menu).',
  UNLIMITED: 'Known bug (DEF-101): the footer link name has no length limit — 101 characters (proposed maximum 100) are saved.',
  RAW_KEY: 'Known bug (DEF-66): the length is refused but the message is the raw key "validation.max.string".',
};

test.beforeEach(() => test.setTimeout(120_000));

function note(description: string): void {
  test.info().annotations.push({ type: 'note', description });
}

/** The footer texts and links of a public page, and whether the page scrolls sideways. */
async function footerOn(browser: Browser, path: string): Promise<{ texts: string[]; hrefs: (string | null)[]; overflowX: number }> {
  const context = await browser.newContext({ storageState: ANONYMOUS_SESSION });
  try {
    const page = await context.newPage();
    await page.goto(urlOf(path));
    await page.waitForLoadState('load');
    const items = await page.locator('footer.site-footer .nav-col h4, footer.site-footer .nav-col li').evaluateAll((els) =>
      els.map((e) => ({ text: (e.textContent ?? '').replace(/\s+/g, ' ').trim(), href: e.querySelector('a')?.getAttribute('href') ?? null })),
    );
    const overflowX = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
    return { texts: items.map((i) => i.text), hrefs: items.map((i) => i.href), overflowX };
  } finally {
    await context.close();
  }
}

async function deleteMenu(page: Page, sectionId: string): Promise<number> {
  const dialog = await new AdminHomePage(page).openDeleteMenuDialog(sectionId);
  return (await submitAndFollow(page, () => dialog.confirm())).final;
}

const menuOf = async (page: Page, sectionId: string): Promise<MenuCard | undefined> => (await new AdminHomePage(page).menus()).find((m) => m.sectionId === sectionId);

// ---------------------------------------------------------------------------------------------------------------

test.describe('SC-ADMH-02 / SC-ADMH-06 ข้อมูลส่วนท้ายเว็บไซต์', () => {
  test(sheetTitle('TC-ADMH-02-01'), async ({ page, browser }) => {
    requireDataCreatingTestsAllowed(CREATES);
    note('The footer tab has no phone / address fields (DEF-77): the "footer data" an admin can change is the menu, so the case changes that.');
    let title = '';
    await withMenu(page, {}, async (run) => {
      title = run.title;
      expect(run.created.length, 'saved').toBe(1);
      for (const path of ['/', '/frontend/faq/index', '/frontend/news/index', '/frontend/activity/index']) {
        const footer = await footerOn(browser, path);
        expect.soft(footer.texts, `the footer of ${path} shows the new item`).toContain(run.title);
      }
    });
    // Restored: the item is gone again everywhere.
    expect((await footerOn(browser, '/')).texts, 'after the case the footer is back as it was').not.toContain(title);
  });

  test(sheetTitle('TC-ADMH-06-05'), async ({ page, browser }) => {
    requireDataCreatingTestsAllowed('Tries to save a footer item with every field empty (deleted again if the app keeps it).');
    const home = new AdminHomePage(page);
    const before = await menuIds(page);
    try {
      await home.openAddMenu();
      await home.fillMenu({ title: '', link: '', column: '1', fontWeight: 'normal', status: 'publish' });
      const saved = await home.saveMenu();
      const errors = await menuErrors(page);
      const created = (await home.menus()).filter((m) => !before.has(m.sectionId) && m.editTitle === '' && m.editLink === '');
      note(`Post ${saved.first} → ${saved.final}; created ${created.length}; messages ${JSON.stringify(errors)}`);
      expect(saved.final, 'no server error').toBeLessThan(500);
      const footer = await publicFooter(browser);
      test.fail(created.length > 0, KNOWN.TITLE_NOT_REQUIRED);
      expect.soft(footer.items.filter((i) => i.href === '' || i.href === '#'), 'no empty link in the footer').toEqual([]);
      expect(created.length, 'an all-empty item is not saved').toBe(0);
      expect(shownMenuErrors(errors), 'a validation message is shown').not.toBe('');
    } finally {
      // Only new items with an empty title AND an empty link: the case's own (Dev's items all have titles).
      const own = (await home.menus()).filter((m) => !before.has(m.sectionId) && m.editTitle === '' && m.editLink === '');
      for (const m of own) await deleteMenu(page, m.sectionId).catch(() => undefined);
      note(`Cleanup: deleted ${own.length} item(s).`);
    }
  });
});

test.describe('SC-FFTR-02 ชื่อลิ้งค์ (ความยาว)', () => {
  test(sheetTitle('TC-FFTR-02-04'), async ({ page, browser }) => {
    requireDataCreatingTestsAllowed(CREATES);
    note(`Limit used: ${POLICY_SOURCE}`);
    const title = textOfLength(`AUTO_FOOTER ${AUTO_TEST_FLAG} ${roleStamp()}`, MAX_LENGTH.footerLinkName);
    await withMenu(page, { title }, async ({ created, link }) => {
      expect(created.length, `a ${MAX_LENGTH.footerLinkName}-character name is saved`).toBe(1);
      expect(created[0].editTitle, 'stored whole').toBe(title);
      const footer = await footerOn(browser, '/');
      const index = footer.hrefs.indexOf(link);
      note(`Public: ${JSON.stringify(footer.texts[index])}; overflow ${footer.overflowX}px`);
      expect(footer.texts[index], 'shown whole in the footer').toBe(title.replace(/\s+/g, ' '));
      expect(footer.overflowX, 'the layout does not break').toBeLessThanOrEqual(1);
    });
  });

  test(sheetTitle('TC-FFTR-02-05'), async ({ page }) => {
    requireDataCreatingTestsAllowed(CREATES);
    note(`Limit used: ${POLICY_SOURCE}`);
    const home = new AdminHomePage(page);
    await home.openAddMenu();
    const maxlength = await home.menuTitleInput.getAttribute('maxlength');
    await home.menuCancelButton.click();
    note(`maxlength: ${maxlength ?? '(none)'}`);
    if (maxlength && Number(maxlength) <= MAX_LENGTH.footerLinkName) return;
    const title = textOfLength(`AUTO_FOOTER ${AUTO_TEST_FLAG} ${roleStamp()}`, MAX_LENGTH.footerLinkName + 1);
    await withMenu(page, { title }, async ({ created, errors, saved }) => {
      expect(saved.final, 'no server error').toBeLessThan(500);
      test.fail(created.length > 0, KNOWN.UNLIMITED);
      expect(created.length, `${MAX_LENGTH.footerLinkName + 1} characters are not saved`).toBe(0);
      const text = shownMenuErrors(errors);
      expect(text, 'a message about the length').toMatch(/ต้องไม่เกิน|ไม่เกิน\s*\d+|ยาวเกิน|ความยาว|\bvalidation\.max/);
      test.fail(/\bvalidation\./.test(text), KNOWN.RAW_KEY);
      expect(text, 'a readable message, not a raw key').not.toMatch(/\bvalidation\./);
    });
  });
});

test.describe('SC-FFTR-04 การแสดงผลบน Public', () => {
  test(sheetTitle('TC-FFTR-04-01'), async ({ page, browser }) => {
    requireDataCreatingTestsAllowed(CREATES);
    await withMenu(page, { title: menuTitle('AUTO_FOOTER') }, async ({ created, title, link }) => {
      expect(created.length).toBe(1);
      const footer = await publicFooter(browser);
      const item = footer.items.find((i) => i.text === title);
      expect(item, 'shown in the footer').toBeDefined();
      expect(item!.href, 'links to the URL set (not "#")').toBe(link);
      // Order: the public footer lists the published items of each column in the admin order.
      const admin = (await new AdminHomePage(page).menus()).filter((m) => m.editStatus === 'publish').map((m) => m.editTitle.replace(/\s+/g, ' ').trim());
      const shown = footer.items.map((i) => i.text).filter((t) => admin.includes(t));
      note(`Admin order ${JSON.stringify(admin)}; footer order ${JSON.stringify(shown)}`);
      expect(shown, 'in the admin order').toEqual(admin.filter((t) => shown.includes(t)));
    });
  });

  test(sheetTitle('TC-FFTR-04-02'), async ({ page, browser }) => {
    requireDataCreatingTestsAllowed(CREATES);
    for (const [status, badge] of [['draft', 'ฉบับร่าง'], ['hide', 'ซ่อน']] as const) {
      await withMenu(page, { title: menuTitle(`AUTO_FOOTER_${status.toUpperCase()}`), status }, async ({ created, title }) => {
        expect(created.length, `${status}: in the admin list`).toBe(1);
        test.fail(status === 'draft' && created[0].status !== badge, KNOWN.DRAFT_AS_HIDDEN);
        expect.soft(created[0].status, `${status}: with the badge "${badge}"`).toBe(badge);
        expect((await publicFooter(browser)).items.map((i) => i.text), `${status}: not in the footer`).not.toContain(title);
      });
    }
  });

  test(sheetTitle('TC-FFTR-04-03'), async ({ page, browser }) => {
    const admin = (await new AdminHomePage(page).menus()).filter((m) => m.editStatus === 'publish');
    const footer = await publicFooter(browser);
    const managed = admin.map((m) => m.editTitle.replace(/\s+/g, ' ').trim());
    note(`Admin (published): ${JSON.stringify(admin.map((m) => [m.editTitle, m.editLink]))}`);
    note(`Public footer: ${JSON.stringify(footer.items.map((i) => [i.text, i.href]))}`);
    expect(footer.items.map((i) => i.text).filter((t) => !managed.includes(t)), 'every footer entry comes from the managed list').toEqual([]);
    expect(managed.filter((t) => !footer.items.some((i) => i.text === t)), 'every published item is shown').toEqual([]);
    expect(footer.items.filter((i) => i.href === '#' || i.href === ''), 'no "#" / empty link').toEqual([]);
    for (const m of admin.filter((x) => x.editLink)) {
      // Titles repeat ("คลังกิจกรรม" is a heading and a link): match title + URL.
      expect.soft(footer.items.some((i) => i.text === m.editTitle.trim() && i.href === m.editLink), `"${m.editTitle}" links to its managed URL`).toBe(true);
    }
  });
});

test.describe('SC-FFTR-05 แก้ไขและลบเมนู', () => {
  test(sheetTitle('TC-FFTR-05-01'), async ({ page, browser }) => {
    requireDataCreatingTestsAllowed(CREATES);
    const home = new AdminHomePage(page);
    const before = await menuIds(page);
    const title = menuTitle('AUTO_FOOTER');
    const link = menuLink();
    let sectionId = '';
    try {
      await home.openAddMenu();
      await home.fillMenu({ title, link, column: '1', fontWeight: 'normal', status: 'publish' });
      await home.saveMenu();
      const created = (await home.menus()).find((m) => !before.has(m.sectionId) && m.editTitle === title);
      expect(created, 'precondition: a test item').toBeDefined();
      sectionId = created!.sectionId;
      await home.openEditMenu(sectionId);
      expect(await home.menuTitleInput.inputValue(), 'the form shows the stored name').toBe(title);
      expect(await home.menuLinkInput.inputValue(), 'and the stored URL').toBe(link);
      expect(await home.menuColumnSelect.inputValue(), 'and the stored column').toBe('1');
      const newTitle = menuTitle('AUTO_FOOTER_EDIT');
      const newLink = menuLink();
      await home.fillMenu({ title: newTitle, link: newLink });
      expect((await home.saveMenu()).final).toBeLessThan(400);
      const after = await menuOf(page, sectionId);
      expect(after?.editTitle, 'the new name is kept').toBe(newTitle);
      expect(after?.editLink, 'the new URL is kept').toBe(newLink);
      const item = (await publicFooter(browser)).items.find((i) => i.text === newTitle);
      expect(item?.href, 'the footer shows the new name and URL').toBe(newLink);
    } finally {
      if (sectionId) note(`Cleanup: delete ${await deleteMenu(page, sectionId).catch(() => 'failed')}`);
    }
  });

  test(sheetTitle('TC-FFTR-05-02'), async ({ page, browser }) => {
    requireDataCreatingTestsAllowed(CREATES);
    await withMenu(page, {}, async ({ created, title }) => {
      const home = new AdminHomePage(page);
      const id = created[0].sectionId;
      const cancel = await home.openDeleteMenuDialog(id);
      await cancel.cancel();
      expect(await menuOf(page, id), '"ยกเลิก": still listed').toBeDefined();
      expect(await deleteMenu(page, id), '"ยืนยันลบข้อมูล"').toBeLessThan(400);
      expect(await menuOf(page, id), 'gone from the list').toBeUndefined();
      expect((await publicFooter(browser)).items.map((i) => i.text), 'gone from the footer').not.toContain(title);
      const others = (await home.menus()).length;
      note(others ? `The empty state cannot be shown: Dev has ${others} real footer item(s), which are never deleted.` : 'No item left.');
      if (!others) await expect(home.menuEmptyState, 'the empty state is shown').toBeVisible();
    });
  });
});
