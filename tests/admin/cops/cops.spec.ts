import { test, expect } from '@fixtures/pages.fixtures';
import { requireDataCreatingTestsAllowed } from '@config/env';
import { AdminCopsPage, CopPostsPage } from '@pages/admin/AdminCopsPages';
import {
  confirmDelete,
  copDescription,
  deleteCopsByDescription,
  deletePostsByExcerpt,
  openSeedPosts,
  postExcerpt,
  publicCommunities,
  publicSeedCommunityPage,
  submitNewCop,
} from '@utils/copFlows';
import { urlOf } from '@utils/lowPrivilege';
import { describeSeed, ensureCommunity, SEED_COMMUNITY } from '@utils/seedContent';
import { collectDialogs, SQL_ERROR_PATTERN } from '@utils/security';
import { Browser, Page } from '@playwright/test';

/**
 * KM-ADMC — communities of practice in the admin (/admin/cops/index) and their news/articles
 * (/admin/cops/<encrypted id>/posts). Recon 2026-10-02: card grid + side panel (#copMod) + shared delete dialog,
 * the post form is the news form. Ids are encrypted tokens, so pages are reached by clicking, never by "/1/".
 *
 * Data: AUTO_COPS_001 (seeded as in TC-ADMC-02-01, see src/utils/seedContent.ts) is the community the read-only and
 * post cases use. Every other community/post is created by its own test and deleted again in a `finally`; the
 * marker "[Auto Test]" + a stamp sit in the description / excerpt because the name / title is the field under test.
 *
 * NOT implemented (no maxlength on the name or the post title and the sheet's {MAX} is undefined):
 * TC-ADMC-04-04/05, TC-ADMC-07-02/03 — see tests/pending/km-admc.pending.spec.ts (DEF-52).
 */

const CREATES = 'Saves a community (deleted again at the end of the case).';
const CREATES_POST = 'Saves a news/article in AUTO_COPS_001 (deleted again at the end of the case).';
const HTML_PAYLOAD = '<b>bold</b><script>alert(1)</script>';
const SQL_PAYLOAD = "' OR 1=1; DROP TABLE users;--";

function note(description: string): void {
  test.info().annotations.push({ type: 'note', description });
}

let seedNote = '';
test.beforeAll(async ({ browser }) => {
  test.setTimeout(120_000);
  seedNote = describeSeed(await ensureCommunity(browser));
});
test.beforeEach(() => {
  test.info().annotations.push({ type: 'note', description: `Test data: ${seedNote}` });
});

/**
 * Creates a community with `name`, checks it on the admin list, its pencil data and the public list, then deletes it.
 * `extra` runs while it exists (more checks).
 */
async function withNewCommunity(
  ctx: { page: Page; browser: Browser; copsPage: AdminCopsPage },
  name: string,
  extra?: (description: string) => Promise<void>,
): Promise<void> {
  const { page, copsPage } = ctx;
  const description = copDescription();
  try {
    const response = await submitNewCop(copsPage, { name, description });
    expect(response.status(), 'saving a community is not a server error').toBeLessThan(500);
    const card = await copsPage.findByDescription(description);
    expect(card, 'the new community is listed in the admin').toBeDefined();
    expect(card?.name, 'the admin card shows the name as typed').toBe(name.trim());
    expect((await copsPage.editAttributes(card!.name)).name, 'the pencil carries the name as typed').toBe(card!.name);
    await extra?.(description);
  } finally {
    note(`Cleanup: deleted ${await deleteCopsByDescription(copsPage, page, description)} community(ies).`);
    await page.waitForLoadState('load');
  }
}

test.describe('SC-ADMC-01 รายการชุมชน', () => {
  test('TC-ADMC-01-01 [High] แสดงรายการชุมชน', async ({ page }) => {
    const copsPage = new AdminCopsPage(page);
    const response = await copsPage.open();
    expect(response?.status()).toBe(200);
    await expect(copsPage.listHeading).toHaveText('รายชื่อชุมชนนักปฏิบัติ (CoPs)');
    await expect(copsPage.addButton).toBeVisible();

    const cards = await copsPage.readCards();
    expect(cards.length, 'at least the seeded community is listed').toBeGreaterThan(0);
    for (const card of cards) {
      expect(card.creator, `creator of "${card.name}"`).not.toBe('');
      expect(card.created, `date of "${card.name}"`).not.toBe('');
      expect(['เผยแพร่', 'ฉบับร่าง', 'ซ่อน'], `status of "${card.name}"`).toContain(card.status);
      expect(card.name).not.toBe('');
      expect(card.posts, `post count of "${card.name}"`).toMatch(/^\d+ ข่าว\/บทความ$/);
    }
    const counter = await copsPage.counter();
    expect(counter, 'the "แสดง x-y รายการ จาก n รายการ" line').not.toBeNull();
    expect(counter!.to - counter!.from + 1, 'the counter matches the cards on the page').toBe(cards.length);
    note(`${counter!.total} community(ies): ${cards.map((card) => `${card.name} (${card.status}, ${card.posts})`).join(' | ')}`);
  });
});

test.describe('SC-ADMC-02 เพิ่ม/ลบชุมชน', () => {
  test('TC-ADMC-02-02 [High] [Negative] เพิ่มชุมชนโดยไม่กรอกชื่อ', async ({ page }) => {
    const copsPage = new AdminCopsPage(page);
    const before = await copsPage.total();
    await copsPage.openAddForm();
    // Only press "บันทึก" once the browser guard is confirmed, otherwise this read-only case could save a record.
    await expect(copsPage.nameInput).toHaveAttribute('required', '');
    await copsPage.fill({ description: copDescription() });
    await copsPage.saveButton.click();

    await expect(copsPage.nameInput, 'the panel stays open').toBeVisible();
    expect(await copsPage.nameInput.evaluate((el: HTMLInputElement) => el.validationMessage), 'validation on the name').not.toBe('');
    expect(await copsPage.total(), 'nothing was saved').toBe(before);
  });

  test('TC-ADMC-02-06 [High] [Positive] ลบชุมชน (ยกเลิกและยืนยัน)', async ({ page, browser }) => {
    requireDataCreatingTestsAllowed(CREATES);
    const copsPage = new AdminCopsPage(page);
    const description = copDescription();
    const name = `[Auto Test] ชุมชนสำหรับทดสอบการลบ ${description.split(' ').pop()}`;
    try {
      // Precondition: a community of our own, without posts (never one of the existing ones).
      expect((await submitNewCop(copsPage, { name, description })).status()).toBeLessThan(500);
      const before = await copsPage.total();
      expect((await publicCommunities(browser)).text, 'listed publicly before the delete').toContain(name);

      // "ยกเลิก" keeps it.
      const dialog = await copsPage.openDeleteDialog(name);
      await dialog.cancel();
      expect(await copsPage.findCard(name), 'cancel keeps the community').toBeDefined();
      expect(await copsPage.total()).toBe(before);

      // "ยืนยันลบข้อมูล" removes it from the admin and the public site.
      const confirm = await copsPage.openDeleteDialog(name);
      await confirmDelete(page, confirm);
      expect(await copsPage.findCard(name), 'confirm removes it from the admin').toBeUndefined();
      expect(await copsPage.total(), 'one community less').toBe(before - 1);
      expect((await publicCommunities(browser)).text, 'gone from the public list').not.toContain(name);
    } finally {
      await deleteCopsByDescription(copsPage, page, description);
    }
  });
});

test.describe('SC-ADMC-03 ข่าว/บทความของชุมชน', () => {
  test('TC-ADMC-03-01 [Medium] [Positive] เปิดหน้าข่าว/บทความของชุมชน', async ({ page }) => {
    const copsPage = new AdminCopsPage(page);
    const postsPage = new CopPostsPage(page);
    await openSeedPosts(copsPage, page);
    await expect(page).toHaveURL(/\/admin\/cops\/.+\/posts$/);
    await expect(page.locator('.body-content')).toContainText(SEED_COMMUNITY);
    await expect(postsPage.addLink).toBeVisible();
    if ((await postsPage.cards.count()) === 0) await expect(postsPage.emptyState, 'empty state without posts').toBeVisible();
    else note(`${await postsPage.cards.count()} post(s) listed`);

    await expect(postsPage.backLink).toHaveAttribute('href', urlOf('/admin/cops/index'));
    await postsPage.backLink.click();
    await expect(page).toHaveURL(urlOf('/admin/cops/index'));
  });

  test('TC-ADMC-03-04 [Low] [Negative] เข้า posts ของชุมชนที่ไม่มีอยู่จริง', async ({ request }) => {
    // KNOWN BUG (2026-10-02): an unknown id is not a clean 404 — the encrypted-id lookup throws (same as DEF-9/DEF-26).
    test.fail(true, 'Known bug (DEF-51): /admin/cops/<unknown or malformed id>/posts answers HTTP 500 instead of 404.');
    const statuses: string[] = [];
    for (const path of ['/admin/cops/99999/posts', '/admin/cops/abc/posts']) {
      const response = await request.get(path);
      statuses.push(`${path} -> ${response.status()}`);
    }
    note(statuses.join(' | '));
    expect(statuses.filter((line) => / -> 5\d\d$/.test(line)), 'never a server error').toEqual([]);
  });
});

test.describe('SC-ADMC-04 ชื่อชุมชน', () => {
  for (const [id, title, value] of [
    ['TC-ADMC-04-01 [High]', 'ข้อความภาษาไทยปกติ', 'ระบบจัดการความรู้ทดสอบ'],
    ['TC-ADMC-04-02 [Medium]', 'ภาษาอังกฤษและตัวเลข', 'Test Case 001'],
    ['TC-ADMC-04-03 [Medium]', 'ผสมไทย/อังกฤษ/ตัวเลข/สัญลักษณ์ทั่วไป', 'KM-Day 2569: SHOW & SHARE (รอบ 1)'],
    ['TC-ADMC-04-09 [Low]', 'อีโมจิและ Unicode พิเศษ', 'ทดสอบ 😀 ✓ ①'],
  ] as const) {
    test(`${id} [Positive] ชื่อชุมชน: ${title}`, async ({ page, browser }) => {
      requireDataCreatingTestsAllowed(CREATES);
      const copsPage = new AdminCopsPage(page);
      await withNewCommunity({ page, browser, copsPage }, value, async () => {
        const pub = await publicCommunities(browser);
        expect(pub.text, 'the public list shows the name exactly as typed (no "&amp;", nothing lost)').toContain(value);
      });
    });
  }

  test('TC-ADMC-04-06 [Low] [Positive] ชื่อชุมชน: มีช่องว่างหน้า-หลังข้อความ', async ({ page, browser }) => {
    requireDataCreatingTestsAllowed(CREATES);
    const copsPage = new AdminCopsPage(page);
    const description = copDescription();
    try {
      expect((await submitNewCop(copsPage, { name: ' ทดสอบ ', description })).status()).toBeLessThan(500);
      const card = await copsPage.findByDescription(description);
      expect(card, 'saved').toBeDefined();
      const stored = (await copsPage.editAttributes(card!.name)).name;
      note(`Stored name: ${JSON.stringify(stored)} (${stored === 'ทดสอบ' ? 'trimmed' : 'NOT trimmed'})`);
      // The sheet leaves trimming TBD: what must hold is that the shown name has no stray spaces.
      expect(card!.name, 'shown without the surrounding spaces').toBe('ทดสอบ');
    } finally {
      await deleteCopsByDescription(copsPage, page, description);
    }
  });

  test('TC-ADMC-04-07 [High] [Negative] ชื่อชุมชน: แท็ก HTML และสคริปต์', async ({ page, browser }) => {
    requireDataCreatingTestsAllowed(CREATES);
    const copsPage = new AdminCopsPage(page);
    const dialogs = collectDialogs(page);
    await withNewCommunity({ page, browser, copsPage }, HTML_PAYLOAD, async () => {
      expect(await copsPage.cards.locator('script, b').count(), 'the name is not rendered as markup in the admin').toBe(0);
      const pub = await publicCommunities(browser);
      expect(pub.dialogs, 'no script runs on the public list').toEqual([]);
      expect(pub.text, 'shown as literal text publicly').toContain(HTML_PAYLOAD);
    });
    expect(dialogs, 'no script runs in the admin').toEqual([]);
  });

  test('TC-ADMC-04-08 [High] [Negative] ชื่อชุมชน: อักขระ SQL', async ({ page, browser }) => {
    requireDataCreatingTestsAllowed(CREATES);
    const copsPage = new AdminCopsPage(page);
    const totalBefore = await copsPage.total();
    await withNewCommunity({ page, browser, copsPage }, SQL_PAYLOAD, async () => {
      expect(SQL_ERROR_PATTERN.test(await page.locator('body').innerText()), 'no SQL error text').toBe(false);
      expect(await copsPage.total(), 'exactly one community more — nothing else touched').toBe(totalBefore + 1);
      expect((await publicCommunities(browser)).text).toContain(SQL_PAYLOAD);
    });
  });

  test('TC-ADMC-04-10 [High] [Negative] ชื่อชุมชน: เว้นว่าง', async ({ page }) => {
    const copsPage = new AdminCopsPage(page);
    const before = await copsPage.total();
    const description = copDescription();
    await copsPage.openAddForm();
    await expect(copsPage.nameInput).toHaveAttribute('required', '');
    await copsPage.fill({ name: '', description, status: 'draft' });
    await copsPage.saveButton.click();

    await expect(copsPage.nameInput, 'the panel stays open').toBeVisible();
    expect(await copsPage.nameInput.evaluate((el: HTMLInputElement) => el.validationMessage)).not.toBe('');
    await expect(copsPage.descriptionInput, 'what was typed stays').toHaveValue(description);
    await expect(copsPage.statusRadio('draft'), 'the chosen status stays').toBeChecked();
    expect(await copsPage.total(), 'nothing was saved').toBe(before);
  });

  test('TC-ADMC-04-11 [Medium] [Negative] ชื่อชุมชน: ช่องว่างล้วน (เว้นวรรค 5 ตัว)', async ({ page }) => {
    requireDataCreatingTestsAllowed('If the app accepts a blank name it saves a community (deleted again at the end).');
    const copsPage = new AdminCopsPage(page);
    const description = copDescription();
    try {
      const before = await copsPage.total();
      const response = await submitNewCop(copsPage, { name: '     ', description });
      expect(response.status(), 'never a server error').toBeLessThan(500);
      const saved = await copsPage.findByDescription(description);
      note(saved ? `Saved with name ${JSON.stringify(saved.name)}` : 'Not saved');
      expect(saved, 'five spaces count as empty: nothing is saved').toBeUndefined();
      expect(await copsPage.total()).toBe(before);
    } finally {
      await deleteCopsByDescription(copsPage, page, description);
    }
  });
});

test.describe('SC-ADMC-05 รูปปกชุมชน', () => {
  test('TC-ADMC-05-06 [Medium] [Negative] รูปปกชุมชน: ไม่เลือกไฟล์ (ช่องไม่บังคับ)', async ({ page, browser }) => {
    requireDataCreatingTestsAllowed(CREATES);
    const copsPage = new AdminCopsPage(page);
    const name = `AUTO_COPS_IMG ${copDescription().split(' ').pop()}`;
    await withNewCommunity({ page, browser, copsPage }, name, async () => {
      const card = await copsPage.findCard(name);
      note(`Cover shown: ${card?.image}`);
      expect(card?.image, 'a placeholder, not an uploaded file').not.toContain('/storage/');
      const image = copsPage.cards.filter({ hasText: name }).locator('.card-img-top');
      await expect.poll(() => image.evaluate((el: HTMLImageElement) => el.complete && el.naturalWidth > 0), { message: 'the placeholder loads' }).toBe(true);
    });
  });
});

test.describe('SC-ADMC-07 หัวเรื่องข่าว/บทความในชุมชน', () => {
  /** Creates a post in AUTO_COPS_001 with `title`, runs `checks`, then deletes it. */
  async function withNewPost(page: Page, title: string, checks: (excerpt: string) => Promise<void>): Promise<void> {
    const copsPage = new AdminCopsPage(page);
    const postsPage = new CopPostsPage(page);
    const excerpt = postExcerpt();
    try {
      await openSeedPosts(copsPage, page);
      await postsPage.openCreate();
      await postsPage.fill({ title, excerpt, body: '<p>เนื้อหาทดสอบ</p>', status: 'publish' });
      const response = await postsPage.save();
      expect(response.status(), 'saving a post is not a server error').toBeLessThan(500);
      await checks(excerpt);
    } finally {
      const cleanup = await deletePostsByExcerpt(copsPage, postsPage, page, excerpt);
      note(
        cleanup.refused
          ? `Cleanup: the app refused to delete the post (HTTP ${cleanup.refused}, DEF-53) — "${excerpt}" stays in ${SEED_COMMUNITY}.`
          : `Cleanup: deleted ${cleanup.deleted} post(s).`,
      );
    }
  }

  async function savedPost(page: Page, excerpt: string): Promise<{ title: string } | undefined> {
    const copsPage = new AdminCopsPage(page);
    await openSeedPosts(copsPage, page);
    return (await new CopPostsPage(page).readCards()).find((card) => card.excerpt === excerpt);
  }

  test('TC-ADMC-07-01 [High] [Positive] หัวเรื่องข่าว/บทความในชุมชน: ข้อความภาษาไทยปกติ', async ({ page, browser }) => {
    requireDataCreatingTestsAllowed(CREATES_POST);
    const title = 'ระบบจัดการความรู้ทดสอบ';
    await withNewPost(page, title, async (excerpt) => {
      expect((await savedPost(page, excerpt))?.title, 'listed on the community posts page as typed').toBe(title);
      const pub = await publicSeedCommunityPage(browser);
      expect(pub.text, 'shown on the public page of the community').toContain(title);
    });
  });

  test('TC-ADMC-07-04 [High] [Negative] หัวเรื่องข่าว/บทความในชุมชน: แท็ก HTML และสคริปต์', async ({ page, browser }) => {
    requireDataCreatingTestsAllowed(CREATES_POST);
    const dialogs = collectDialogs(page);
    await withNewPost(page, HTML_PAYLOAD, async (excerpt) => {
      expect((await savedPost(page, excerpt))?.title, 'stored and shown as literal text').toBe(HTML_PAYLOAD);
      expect(await page.locator('.body-content .article-card .title-text script, .body-content .article-card .title-text b').count()).toBe(0);
      const pub = await publicSeedCommunityPage(browser);
      expect(pub.dialogs, 'no script runs publicly').toEqual([]);
      expect(pub.text, 'shown as literal text publicly').toContain(HTML_PAYLOAD);
    });
    expect(dialogs, 'no script runs in the admin').toEqual([]);
  });

  test('TC-ADMC-07-05 [High] [Negative] หัวเรื่องข่าว/บทความในชุมชน: อักขระ SQL', async ({ page }) => {
    requireDataCreatingTestsAllowed(CREATES_POST);
    await withNewPost(page, SQL_PAYLOAD, async (excerpt) => {
      expect(SQL_ERROR_PATTERN.test(await page.locator('body').innerText()), 'no SQL error text').toBe(false);
      const post = await savedPost(page, excerpt);
      note(post ? `Saved as ${JSON.stringify(post.title)}` : 'Rejected');
      if (post) expect(post.title, 'kept as plain text').toBe(SQL_PAYLOAD);
      await expect(page.locator('.body-content')).toContainText(SEED_COMMUNITY);
    });
  });

  test('TC-ADMC-07-06 [High] [Negative] หัวเรื่องข่าว/บทความในชุมชน: เว้นว่าง', async ({ page }) => {
    const copsPage = new AdminCopsPage(page);
    const postsPage = new CopPostsPage(page);
    await openSeedPosts(copsPage, page);
    const before = await postsPage.cards.count();
    await postsPage.openCreate();
    await expect(postsPage.titleInput).toHaveAttribute('required', '');
    const excerpt = postExcerpt();
    await postsPage.fill({ title: '', excerpt });
    await postsPage.saveButton.click();

    await expect(page, 'still on the create form').toHaveURL(/\/posts\/create$/);
    expect(await postsPage.titleInput.evaluate((el: HTMLInputElement) => el.validationMessage)).not.toBe('');
    await expect(postsPage.excerptInput, 'what was typed stays').toHaveValue(excerpt);
    await openSeedPosts(copsPage, page);
    expect(await postsPage.cards.count(), 'nothing was saved').toBe(before);
  });

  test('TC-ADMC-07-07 [Medium] [Negative] หัวเรื่องข่าว/บทความในชุมชน: ช่องว่างล้วน (เว้นวรรค 5 ตัว)', async ({ page }) => {
    requireDataCreatingTestsAllowed('If the app accepts a blank title it saves a post (deleted again at the end).');
    await withNewPost(page, '     ', async (excerpt) => {
      const post = await savedPost(page, excerpt);
      note(post ? `Saved with title ${JSON.stringify(post.title)}` : 'Not saved');
      expect(post, 'five spaces count as empty: nothing is saved').toBeUndefined();
    });
  });
});
