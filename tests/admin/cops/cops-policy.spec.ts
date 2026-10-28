import path from 'path';
import { test, expect, ANONYMOUS_SESSION } from '@fixtures/pages.fixtures';
import { requireDataCreatingTestsAllowed } from '@config/env';
import { MAX_LENGTH, POLICY_SOURCE, UPLOAD } from '@config/policy';
import { AdminActivityLogPage } from '@pages/admin/AdminActivityLogPage';
import { AdminCopsPage, CopCard, CopFormValues, CopPostsPage, CopStatus } from '@pages/admin/AdminCopsPages';
import { UploadFile } from '@pages/admin/AdminNewsPages';
import { sheetTitle } from '@utils/caseTitles';
import { confirmDelete, copDescription, deleteCopsByDescription, postExcerpt } from '@utils/copFlows';
import { urlOf } from '@utils/lowPrivilege';
import { fetchAsVisitor } from '@utils/newsFlows';
import { roleStamp } from '@utils/roleFlows';
import { collectDialogs } from '@utils/security';
import { drawImage, exeBytes, fixtureFile, MB, paddedFile, payload } from '@utils/uploadFiles';
import { Browser, Page } from '@playwright/test';
import { textOfLength } from '../content/contentLimitsSuite';

/**
 * KM-ADMC / KM-FEC — communities and their posts (Auto:P + the {MAX} cases), checked 2026-10-07. Limits are the
 * OWASP-based proposals in src/config/policy.ts (community name 150, post title 255, cover 5 MB) until SA/Dev decide.
 * Every case works in its OWN temporary community ("[Auto Test]" in the description), deleted at the end: posts cannot
 * be deleted one by one (DEF-53), but deleting the community takes them with it (its posts page answers 404 after —
 * checked 2026-10-07). Post titles are ASCII (Thai titles give public pages that answer 500 — DEF-83). The seeded
 * AUTO_COPS_001 and QA's data are never touched.
 */

const CREATES = 'Saves a temporary community (and posts in it) — the community is deleted again at the end.';
const KNOWN = {
  RAW_KEY: 'Known bug (DEF-66): the refusal message is the untranslated key (validation.*).',
  POST_DELETE_404: 'Known bug (DEF-53): deleting a community post answers HTTP 404 and the post stays.',
  NAME_UNLIMITED: 'Known bug (DEF-52): the community name has no length limit — 151 characters (proposed maximum 150) are saved.',
  POST_EDIT_404: 'Known bug (DEF-53): saving an edited community post answers HTTP 404 (like deleting one) — the change is not saved.',
  HIDDEN_ERROR: 'Known bug (DEF-69): a refused save closes the panel — the message stays in the hidden panel, the admin sees none.',
  HIDDEN_IN_SEARCH: 'Known bug (DEF-115): posts of a hidden (ซ่อน) community still show in the public search results (their links then answer 500 — DEF-83).',
  NOT_LOGGED: 'Known bug (DEF-86): adding, editing and deleting a community is not recorded in "ประวัติการใช้งานระบบ".',
  POST_DETAIL_500: 'Known bug (DEF-83): the public page of a community post answers HTTP 500 (also for a plain English title).',
  BROKEN_FILES: 'Known bug (DEF-91): upload checks look only at the file header.',
};
const RAW = /\bvalidation\.[a-z_.]+/i;
const COVER = path.join(__dirname, '..', '..', 'fixtures', 'auto-cover.png');

test.beforeEach(() => test.setTimeout(240_000));

function note(description: string): void {
  test.info().annotations.push({ type: 'note', description });
}

interface Community {
  name: string;
  description: string;
  card: CopCard;
}

/** Creates a temporary community (published, with a cover unless given), runs `work`, then deletes it. */
async function withCommunity(page: Page, values: CopFormValues, work: (cop: Community, saved: number) => Promise<void>): Promise<void> {
  requireDataCreatingTestsAllowed(CREATES);
  const cops = new AdminCopsPage(page);
  const description = values.description ?? copDescription();
  const name = values.name ?? `AUTO_COPS ${roleStamp()}`;
  try {
    await cops.open();
    await cops.openAddForm();
    await cops.fill({ cover: COVER, status: 'publish', ...values, name, description });
    const saved = (await cops.save()).status();
    const card = await cops.findByDescription(description);
    note(`Save ${saved}; ${card ? `listed: ${JSON.stringify({ name: card.name, status: card.status, posts: card.posts })}` : 'not listed'}`);
    await work({ name, description, card: card as CopCard }, saved);
  } finally {
    note(`Cleanup: deleted ${await deleteCopsByDescription(cops, page, description)} communit(ies) (and their posts).`);
  }
}

/** Adds a post (ASCII title, marker excerpt) on the community's posts page; returns its title and excerpt. */
async function addPost(page: Page, cop: Community, values: { title?: string; status?: CopStatus; body?: string } = {}): Promise<{ title: string; excerpt: string; status: number }> {
  const posts = new CopPostsPage(page);
  await page.goto(cop.card.postsHref);
  await posts.openCreate();
  const title = values.title ?? `AUTO_POST ${roleStamp()}`;
  const excerpt = postExcerpt();
  await posts.fill({ title, excerpt, body: values.body ?? '<p>[Auto Test] เนื้อหาทดสอบ</p>', status: values.status ?? 'publish' });
  const status = (await posts.save()).status();
  return { title, excerpt, status };
}

async function setCopStatus(page: Page, cop: Community, status: CopStatus, extra: CopFormValues = {}): Promise<number> {
  const cops = new AdminCopsPage(page);
  const found = await cops.locate((c) => c.description === cop.description);
  await cops.cards.nth(found!.index).locator('.js-edit-cop').click();
  await cops.nameInput.waitFor({ state: 'visible' });
  await cops.fill({ status, ...extra });
  return (await cops.save()).status();
}

/** /frontend/cops/index as a visitor: the community cards. */
async function publicCops(browser: Browser): Promise<{ name: string; count: string; href: string; imageLoaded: boolean; overflowX: number }[]> {
  const context = await browser.newContext({ storageState: ANONYMOUS_SESSION });
  try {
    const page = await context.newPage();
    await page.goto(urlOf('/frontend/cops/index'));
    await page.waitForTimeout(500);
    const overflowX = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
    const cards = await page.locator('.body-content a.card').evaluateAll((cs) =>
      cs.map((c) => {
        const img = c.querySelector('img') as HTMLImageElement | null;
        return { name: (c.querySelector('.card-title')?.textContent ?? '').replace(/\s+/g, ' ').trim(), count: [...c.querySelectorAll('.text-small')].map((x) => (x.textContent ?? '').trim()).join(' '), href: c.getAttribute('href') ?? '', imageLoaded: !!img && img.complete && img.naturalWidth > 0 };
      }),
    );
    return cards.map((c) => ({ ...c, overflowX }));
  } finally {
    await context.close();
  }
}

/** A community's public page (by its card on the public list): posts with title / date / excerpt. */
async function publicCommunity(browser: Browser, href: string): Promise<{ status: number; posts: { title: string; date: string; excerpt: string; href: string }[]; text: string }> {
  const context = await browser.newContext({ storageState: ANONYMOUS_SESSION });
  try {
    const page = await context.newPage();
    const response = await page.goto(href);
    await page.waitForTimeout(400);
    const posts = await page.locator('.body-content a.card').evaluateAll((cs) =>
      cs.map((c) => ({
        title: (c.querySelector('.card-title, .title-text')?.textContent ?? '').replace(/\s+/g, ' ').trim(),
        date: (c.querySelector('.text-small')?.textContent ?? '').replace(/\s+/g, ' ').trim(),
        excerpt: (c.querySelector('.card-text')?.textContent ?? '').replace(/\s+/g, ' ').trim(),
        href: c.getAttribute('href') ?? '',
      })),
    );
    return { status: response?.status() ?? 0, posts, text: (await page.locator('body').innerText()).replace(/\s+/g, ' ') };
  } finally {
    await context.close();
  }
}

const countOf = (text: string): number => Number(/(\d+)/.exec(text)?.[1] ?? NaN);

// ---------------------------------------------------------------------------------------------------------------

test.describe('SC-ADMC-02 เพิ่ม แก้ไข และสถานะชุมชน', () => {
  test(sheetTitle('TC-ADMC-02-01'), async ({ page, browser }) => {
    await withCommunity(page, { name: `AUTO_COPS_001 ${roleStamp()}` }, async (cop, saved) => {
      expect(saved, 'saved').toBeLessThan(400);
      expect(cop.card, 'listed in the admin').toBeDefined();
      expect(cop.card.posts, 'with 0 ข่าว/บทความ').toMatch(/^0\s/);
      const pub = await publicCops(browser);
      expect(pub.map((c) => c.name), 'shown on /frontend/cops/index').toContain(cop.name);
      const home = await fetchAsVisitor(browser, urlOf('/'));
      expect(home.body.toString(), 'and on the home page').toContain(cop.name);
    });
  });

  test(sheetTitle('TC-ADMC-02-04'), async ({ page, browser }) => {
    await withCommunity(page, {}, async (cop) => {
      const renamed = `${cop.name}_EDIT`;
      const newCover = await drawImage(page, 'cover-edit.jpg', { width: 1200, height: 800, type: 'image/jpeg' });
      expect(await setCopStatus(page, cop, 'publish', { name: renamed, cover: newCover })).toBeLessThan(400);
      const card = await new AdminCopsPage(page).findByDescription(cop.description);
      expect(card?.name, 'the new name in the admin').toBe(renamed);
      expect(card?.image, 'the new cover in the admin').not.toBe(cop.card.image);
      const pub = (await publicCops(browser)).find((c) => c.name === renamed);
      expect(pub, 'the new name on the public page').toBeDefined();
      expect(pub!.imageLoaded, 'with its cover').toBe(true);
    });
  });

  test(sheetTitle('TC-ADMC-02-05'), async ({ page, browser }) => {
    await withCommunity(page, {}, async (cop) => {
      expect(await setCopStatus(page, cop, 'hide')).toBeLessThan(400);
      const card = await new AdminCopsPage(page).findByDescription(cop.description);
      expect(card?.status, 'still in the admin with "ซ่อน"').toBe('ซ่อน');
      expect((await publicCops(browser)).map((c) => c.name), 'gone from the public page').not.toContain(cop.name);
    });
  });

  test(sheetTitle('TC-FEC-01-03'), async ({ page, browser }) => {
    await withCommunity(page, {}, async (cop) => {
      const href = (await publicCops(browser)).find((c) => c.name === cop.name)?.href;
      expect(href, 'precondition: published, with a public page').toBeTruthy();
      expect(await setCopStatus(page, cop, 'hide')).toBeLessThan(400);
      expect((await publicCops(browser)).map((c) => c.name), 'no card on /frontend/cops/index').not.toContain(cop.name);
      const direct = await publicCommunity(browser, href!);
      note(`Direct link after hiding: ${direct.status}`);
      expect(direct.status === 404 || /ไม่พบ/.test(direct.text), 'the direct link answers 404 / "ไม่พบข้อมูล"').toBe(true);
    });
  });

  test(sheetTitle('TC-ADMC-06-01'), async ({ page, browser }) => {
    await withCommunity(page, {}, async (cop) => {
      const sequence: CopStatus[] = ['hide', 'publish', 'hide', 'publish', 'hide'];
      for (const status of sequence) expect(await setCopStatus(page, cop, status)).toBeLessThan(400);
      const card = await new AdminCopsPage(page).findByDescription(cop.description);
      expect(card?.status, 'the last status in the admin').toBe('ซ่อน');
      expect((await publicCops(browser)).map((c) => c.name), 'and on the public page').not.toContain(cop.name);
    });
  });
});

test.describe('SC-ADMC-03 / SC-FEC-02 ข่าว/บทความในชุมชน', () => {
  test(sheetTitle('TC-ADMC-03-02'), async ({ page, browser }) => {
    await withCommunity(page, {}, async (cop) => {
      const post = await addPost(page, cop);
      expect(post.status, 'saved').toBeLessThan(400);
      await page.goto(cop.card.postsHref);
      expect((await new CopPostsPage(page).readCards()).map((p) => p.title), 'on the posts page').toContain(post.title);
      const card = await new AdminCopsPage(page).findByDescription(cop.description);
      expect(countOf(card!.posts), '"n ข่าว/บทความ" grows by 1').toBe(1);
      const href = (await publicCops(browser)).find((c) => c.name === cop.name)!.href;
      expect((await publicCommunity(browser, href)).posts.map((p) => p.title), 'on the public community page').toContain(post.title);
    });
  });

  test(sheetTitle('TC-ADMC-03-03'), async ({ page, browser }) => {
    await withCommunity(page, {}, async (cop) => {
      const post = await addPost(page, cop);
      const posts = new CopPostsPage(page);
      await page.goto(cop.card.postsHref);
      const index = (await posts.readCards()).findIndex((p) => p.title === post.title);
      const edit = posts.cards.nth(index).locator('a[href*="/posts/"]:not([data-delete-url])').first();
      await edit.click();
      await posts.titleInput.waitFor({ state: 'visible' });
      const renamed = `${post.title} EDIT`;
      await posts.titleInput.fill(renamed);
      const edited = (await posts.save()).status();
      test.fail(edited === 404, KNOWN.POST_EDIT_404);
      expect(edited, 'the edit is saved').toBeLessThan(400);
      await page.goto(cop.card.postsHref);
      expect((await posts.readCards()).map((p) => p.title), 'the new title in the admin').toContain(renamed);
      const href = (await publicCops(browser)).find((c) => c.name === cop.name)!.href;
      expect((await publicCommunity(browser, href)).posts.map((p) => p.title), 'and publicly').toContain(renamed);
      const dialog = await posts.openDeleteDialog(renamed);
      const deleted = (await confirmDelete(page, dialog)).status();
      const card = await new AdminCopsPage(page).findByDescription(cop.description);
      note(`Delete ${deleted}; count now "${card?.posts}"`);
      test.fail(deleted === 404, KNOWN.POST_DELETE_404);
      expect(countOf(card!.posts), 'after deleting, the count drops by 1').toBe(0);
    });
  });

  test(sheetTitle('TC-FEC-02-02'), async ({ page, browser }) => {
    await withCommunity(page, {}, async (cop) => {
      const made: string[] = [];
      for (let i = 1; i <= 3; i++) {
        made.push((await addPost(page, cop, { title: `AUTO_POST_${i} ${roleStamp()}` })).title);
        await page.waitForTimeout(1_100);
      }
      const href = (await publicCops(browser)).find((c) => c.name === cop.name)!.href;
      const pub = await publicCommunity(browser, href);
      note(`Public posts: ${JSON.stringify(pub.posts)}`);
      expect(pub.posts.map((p) => p.title), 'all 3, newest first').toEqual([...made].reverse());
      for (const p of pub.posts) {
        expect.soft(p.date, `"${p.title}" shows a date`).not.toBe('');
        expect.soft(p.excerpt, `"${p.title}" shows its summary`).toContain('[Auto Test]');
      }
      const detail = await fetchAsVisitor(browser, pub.posts[0].href);
      note(`${pub.posts[0].href}: HTTP ${detail.status}`);
      test.fail(detail.status === 500, KNOWN.POST_DETAIL_500);
      expect(detail.status, 'clicking opens the post').toBe(200);
      expect(detail.body.toString(), 'the right post').toContain(made[2]);
    });
  });

  test(sheetTitle('TC-FEC-02-03'), async ({ page, browser }) => {
    await withCommunity(page, {}, async (cop) => {
      await addPost(page, cop, { title: `AUTO_POST_PUB ${roleStamp()}` });
      await addPost(page, cop, { title: `AUTO_POST_HIDE ${roleStamp()}`, status: 'hide' });
      const card = (await publicCops(browser)).find((c) => c.name === cop.name)!;
      const pub = await publicCommunity(browser, card.href);
      note(`Card "${card.count}"; page lists ${pub.posts.length}`);
      expect(countOf(card.count), 'the card count matches the page').toBe(pub.posts.length);
      expect(pub.posts.length, 'only the published post counts').toBe(1);
    });
  });

  test(sheetTitle('TC-FEC-02-04'), async ({ page, browser }) => {
    const name = textOfLength(`AUTO_COPS ${roleStamp()}`, 200);
    await withCommunity(page, { name }, async (cop, saved) => {
      note(`200-character name: save ${saved}; ${cop.card ? 'saved' : 'refused'}`);
      if (!cop.card) return; // refused by a length rule: nothing to show
      const pub = await publicCops(browser);
      expect(pub.map((c) => c.name), 'listed publicly').toContain(name);
      expect(pub[0]?.overflowX ?? 0, 'the card layout does not break the page').toBeLessThanOrEqual(1);
      const context = await browser.newContext({ storageState: ANONYMOUS_SESSION });
      try {
        const home = await context.newPage();
        await home.goto(urlOf('/'));
        await home.waitForTimeout(800);
        expect(await home.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth), 'nor the home page').toBeLessThanOrEqual(1);
      } finally {
        await context.close();
      }
    });
  });
});

test.describe('SC-ADMC-04 / SC-ADMC-07 ความยาวชื่อชุมชนและหัวเรื่อง', () => {
  test(sheetTitle('TC-ADMC-04-04'), async ({ page, browser }) => {
    note(`Limit used: ${POLICY_SOURCE}`);
    const name = textOfLength(`AUTO_COPS ${roleStamp()}`, MAX_LENGTH.communityName);
    await withCommunity(page, { name }, async (cop) => {
      expect(cop.card?.name, `${MAX_LENGTH.communityName} characters saved whole`).toBe(name);
      const pub = await publicCops(browser);
      expect(pub.map((c) => c.name), 'shown whole publicly').toContain(name);
      expect(pub[0]?.overflowX ?? 0, 'the layout does not break').toBeLessThanOrEqual(1);
    });
  });

  test(sheetTitle('TC-ADMC-04-05'), async ({ page }) => {
    note(`Limit used: ${POLICY_SOURCE}`);
    const name = textOfLength(`AUTO_COPS ${roleStamp()}`, MAX_LENGTH.communityName + 1);
    await withCommunity(page, { name }, async (cop, saved) => {
      const errors = (await page.locator('#copMod .text-xsmall, #copMod .invalid-feedback, .alert-danger').allInnerTexts()).join(' ');
      note(`Save ${saved}; saved ${Boolean(cop.card)}; messages "${errors}"`);
      expect(saved, 'no server error').toBeLessThan(500);
      test.fail(Boolean(cop.card), KNOWN.NAME_UNLIMITED);
      expect(cop.card, `${MAX_LENGTH.communityName + 1} characters are not saved`).toBeUndefined();
      expect(errors, 'a length message').toMatch(/ต้องไม่เกิน|ไม่เกิน\s*\d+|ยาวเกิน|ความยาว|\bvalidation\.max/);
    });
  });

  test(sheetTitle('TC-ADMC-07-02'), async ({ page, browser }) => {
    note(`Limit used: ${POLICY_SOURCE}`);
    await withCommunity(page, {}, async (cop) => {
      const title = textOfLength(`AUTO_POST ${roleStamp()}`, MAX_LENGTH.title).replace(/[^\x20-\x7e]/g, 'x');
      const post = await addPost(page, cop, { title });
      expect(post.status, `a ${MAX_LENGTH.title}-character title is saved`).toBeLessThan(400);
      await page.goto(cop.card.postsHref);
      expect((await new CopPostsPage(page).readCards()).map((p) => p.title), 'listed whole').toContain(title);
      const href = (await publicCops(browser)).find((c) => c.name === cop.name)!.href;
      expect((await publicCommunity(browser, href)).posts.map((p) => p.title), 'shown whole publicly').toContain(title);
    });
  });

  test(sheetTitle('TC-ADMC-07-03'), async ({ page }) => {
    note(`Limit used: ${POLICY_SOURCE}`);
    await withCommunity(page, {}, async (cop) => {
      const posts = new CopPostsPage(page);
      await page.goto(cop.card.postsHref);
      await posts.openCreate();
      const maxlength = await posts.titleInput.getAttribute('maxlength');
      note(`maxlength: ${maxlength ?? '(none)'}`);
      if (maxlength && Number(maxlength) <= MAX_LENGTH.title) return;
      const title = 'x'.repeat(MAX_LENGTH.title + 1);
      await posts.fill({ title, excerpt: postExcerpt(), body: '<p>[Auto Test]</p>', status: 'publish' });
      const status = (await posts.save()).status();
      const messages = (await page.locator('#post-form .text-xsmall, #post-form .invalid-feedback, .alert-danger').allInnerTexts()).join(' ');
      await page.goto(cop.card.postsHref);
      const saved = (await posts.readCards()).some((p) => p.title === title);
      note(`Save ${status}; saved ${saved}; messages "${messages}"`);
      expect(status, 'no server error').toBeLessThan(500);
      expect(saved, `${MAX_LENGTH.title + 1} characters are not saved`).toBe(false);
      expect(messages, 'a length message').toMatch(/ต้องไม่เกิน|ไม่เกิน\s*\d+|ยาวเกิน|ความยาว|\bvalidation\.max/);
      test.fail(RAW.test(messages), KNOWN.RAW_KEY);
      expect(messages, 'readable, not a raw key').not.toMatch(RAW);
    });
  });
});

test.describe('SC-ADMC-05 รูปปกชุมชน', () => {
  async function coverAccepted(page: Page, browser: Browser, file: UploadFile, transparent = false): Promise<void> {
    await withCommunity(page, { cover: file }, async (cop, saved) => {
      expect(saved, 'saved').toBeLessThan(400);
      expect(cop.card?.image, 'the admin card shows the uploaded cover').toMatch(/\/storage\//);
      const got = await fetchAsVisitor(browser, cop.card.image);
      expect(got.status, 'the cover opens').toBe(200);
      if (transparent) expect(got.type, 'kept as PNG (transparency)').toMatch(/png/);
      const pub = (await publicCops(browser)).find((c) => c.name === cop.name);
      expect(pub?.imageLoaded, 'shown on the public card').toBe(true);
    });
  }

  async function coverRefused(page: Page, file: UploadFile, about?: RegExp): Promise<void> {
    await withCommunity(page, { cover: file }, async (cop, saved) => {
      const errors = (await page.locator('#copMod .text-xsmall, #copMod .invalid-feedback, .alert-danger').allInnerTexts()).join(' ');
      note(`Save ${saved}; saved ${Boolean(cop.card)}; messages "${errors}"`);
      expect(saved, 'no server error').toBeLessThan(500);
      expect(cop.card, 'not saved').toBeUndefined();
      if (!about) return;
      const hidden = (await page.locator('#copMod .text-xsmall, #copMod .invalid-feedback').allTextContents()).join(' ').trim();
      note(`Message in the (closed) panel: "${hidden}"`);
      test.fail(errors === '' && hidden !== '', KNOWN.HIDDEN_ERROR);
      expect(errors, 'a message').not.toBe('');
      test.fail(RAW.test(errors), KNOWN.RAW_KEY);
      expect(errors, 'readable, not a raw key').not.toMatch(RAW);
      expect(errors, 'says why').toMatch(about);
    });
  }

  test(sheetTitle('TC-ADMC-05-01'), async ({ page, browser }) => {
    await coverAccepted(page, browser, await drawImage(page, 'image.jpg', { width: 1200, height: 800, type: 'image/jpeg' }));
  });
  test(sheetTitle('TC-ADMC-05-02'), async ({ page, browser }) => {
    await coverAccepted(page, browser, await drawImage(page, 'image.png', { width: 1200, height: 800, type: 'image/png', transparent: true }), true);
  });
  test(sheetTitle('TC-ADMC-05-03'), async ({ page }) => {
    await coverRefused(page, fixtureFile('sample.pdf', 'doc.pdf'), /PNG|JPE?G|ชนิด|รองรับ/i);
  });
  test(sheetTitle('TC-ADMC-05-04'), async ({ page }) => {
    await coverRefused(page, payload('fake.jpg', exeBytes(), 'image/jpeg'));
  });
  test(sheetTitle('TC-ADMC-05-05'), async ({ page }) => {
    note(`Limit used: ${POLICY_SOURCE}`);
    const base = await drawImage(page, 'big.png', { width: 1200, height: 800, type: 'image/png' });
    await coverRefused(page, paddedFile(base, UPLOAD.imageMaxMB * MB + 1024, 'big.png'), /MB|ขนาด/);
  });
});

test.describe('SC-ADMC-06 ชุมชนที่ไม่เผยแพร่ และประวัติการใช้งาน', () => {
  test(sheetTitle('TC-ADMC-06-02'), async ({ page, browser }) => {
    await withCommunity(page, { status: 'hide' }, async (cop) => {
      const post = await addPost(page, cop);
      expect(post.status, 'a post can still be added').toBeLessThan(400);
      await page.goto(cop.card.postsHref);
      expect((await new CopPostsPage(page).readCards()).map((p) => p.title), 'and is listed in the admin').toContain(post.title);
      expect((await publicCops(browser)).map((c) => c.name), 'the community stays hidden publicly').not.toContain(cop.name);
    });
  });

  test(sheetTitle('TC-ADMC-06-03'), async ({ page, browser }) => {
    await withCommunity(page, {}, async (cop) => {
      const href = (await publicCops(browser)).find((c) => c.name === cop.name)!.href;
      const post = await addPost(page, cop);
      const postHref = (await publicCommunity(browser, href)).posts.find((p) => p.title === post.title)?.href;
      expect(await setCopStatus(page, cop, 'hide')).toBeLessThan(400);
      const dialogs = collectDialogs(page);
      const home = await fetchAsVisitor(browser, urlOf('/'));
      const search = await fetchAsVisitor(browser, urlOf(`/frontend/search/index?q=${encodeURIComponent(post.title)}`));
      const community = await publicCommunity(browser, href);
      const direct = postHref ? (await fetchAsVisitor(browser, postHref)).status : 0;
      note(`Home has it: ${home.body.toString().includes(post.title)}; search has it: ${search.body.toString().includes(post.title)}; community page ${community.status}; post link ${direct}`);
      test.fail(search.body.toString().replace(/value="[^"]*"/g, '').includes(post.title), KNOWN.HIDDEN_IN_SEARCH);
      expect(home.body.toString(), 'not on the home page').not.toContain(post.title);
      expect(search.body.toString().replace(/value="[^"]*"/g, ''), 'not in the search results').not.toContain(post.title);
      expect(community.posts.map((p) => p.title), 'not on the community page').not.toContain(post.title);
      if (postHref) expect(direct, 'its own link is closed').not.toBe(200);
      expect(dialogs).toEqual([]);
    });
  });

  test(sheetTitle('TC-ADMC-06-08'), async ({ page }) => {
    let name = '';
    await withCommunity(page, {}, async (cop) => {
      name = `${cop.name}_EDIT`;
      expect(await setCopStatus(page, cop, 'publish', { name })).toBeLessThan(400);
    });
    const log = new AdminActivityLogPage(page);
    await log.open();
    const rows = (await log.readRows()).filter((r) => r.item.includes(name.replace(/_EDIT$/, '')));
    note(`Log rows for the community: ${JSON.stringify(rows.map((r) => [r.action, r.item]))}`);
    test.fail(rows.length === 0, KNOWN.NOT_LOGGED);
    expect(rows.length, 'add, edit and delete are all logged with the community name').toBeGreaterThanOrEqual(3);
  });
});

