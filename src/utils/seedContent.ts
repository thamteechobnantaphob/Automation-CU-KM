import path from 'path';
import { Browser, Page } from '@playwright/test';
import { env } from '@config/env';
import { ADMIN_AUTH_FILE } from '../../global-setup';
import { urlOf } from '@utils/lowPrivilege';

/**
 * Test data the public / dashboard cases need, created the way the sheet's own
 * workflow does it: the admin adds it in the back office, then the public pages
 * are checked (QA, 2026-10-01: "สร้างข้อมูลทดสอบ ตาม TC และ ทดสอบตาม Workflow").
 * Needed since the 2026-10-01 Dev reset left no communities and no news.
 *
 * Names and values come from the sheet: TC-ADMC-02-01 (community
 * "AUTO_COPS_001", cover picture, status "เผยแพร่") and TC-NEWS-02-01 (news
 * "AUTO_NEWS_001", excerpt "ข้อมูลทดสอบอัตโนมัติ", first category, tag "auto",
 * body "เนื้อหาทดสอบ", published now).
 *
 * Every helper is idempotent: it creates the item only when the admin list does
 * not have it yet, and only when ALLOW_DATA_CREATING_TESTS=true; otherwise it
 * reports why nothing was created and the dependent case fails/skips on its own.
 */
export const SEED_COMMUNITY = 'AUTO_COPS_001';
export const SEED_NEWS = 'AUTO_NEWS_001';
export const SEED_DESCRIPTION = 'ข้อมูลทดสอบอัตโนมัติ';
const COVER_FILE = path.join(__dirname, '..', '..', 'tests', 'fixtures', 'auto-cover.png');

export interface SeedResult {
  name: string;
  /** 'existing' = already there, 'created' = added now, 'skipped' = missing and creating is not allowed. */
  state: 'existing' | 'created' | 'skipped';
}

async function withAdmin<T>(browser: Browser, body: (page: Page) => Promise<T>): Promise<T> {
  const context = await browser.newContext({ storageState: ADMIN_AUTH_FILE });
  try {
    return await body(await context.newPage());
  } finally {
    await context.close();
  }
}

/**
 * Whether `name` is on the list, on ANY page ("แสดงx-y รายการ จาก n รายการ"). Page 1 alone is not enough: other
 * tests' items push the seed further down, and a worker restart re-runs beforeAll — 2026-10-02 that created a second
 * AUTO_NEWS_001. Leaves a page of the list open.
 */
async function listed(page: Page, listPath: string, name: string): Promise<boolean> {
  for (let pageNo = 1; pageNo <= 50; pageNo++) {
    await page.goto(urlOf(`${listPath}${pageNo > 1 ? `?page=${pageNo}` : ''}`));
    const text = await page.locator('.body-content').innerText();
    if (text.includes(name)) return true;
    const counter = /แสดง\s*(\d+)\s*-\s*(\d+)\s*รายการ\s*จาก\s*(\d+)\s*รายการ/.exec(text);
    if (!counter || Number(counter[2]) >= Number(counter[3])) return false;
  }
  return false;
}

/** TC-ADMC-02-01: "เพิ่มชุมชนใหม่" → name, cover picture, status "เผยแพร่" → บันทึก; then it must be on /frontend/cops/index. */
export async function ensureCommunity(browser: Browser): Promise<SeedResult> {
  return withAdmin(browser, async (page) => {
    if (await listed(page, '/admin/cops/index', SEED_COMMUNITY)) return { name: SEED_COMMUNITY, state: 'existing' };
    if (!env.allowDataCreatingTests) return { name: SEED_COMMUNITY, state: 'skipped' };

    await page.getByRole('button', { name: 'เพิ่มชุมชนใหม่' }).click();
    const form = page.locator('#cop-form');
    await form.locator('#cop-name').waitFor({ state: 'visible' });
    await form.locator('#cop-name').fill(SEED_COMMUNITY);
    await form.locator('#cop-description').fill(`${SEED_DESCRIPTION} [Auto Test]`);
    await form.locator('#cop-image-upload').setInputFiles(COVER_FILE);
    await form.locator('#cop-status-publish').check();
    await Promise.all([page.waitForURL(/\/admin\/cops\/index/), form.getByRole('button', { name: 'บันทึก' }).click()]);

    if (!(await listed(page, '/admin/cops/index', SEED_COMMUNITY))) throw new Error(`${SEED_COMMUNITY} was saved but is not in the admin list`);
    if (!(await listed(page, '/frontend/cops/index', SEED_COMMUNITY))) throw new Error(`${SEED_COMMUNITY} (เผยแพร่) does not show on /frontend/cops/index`);
    return { name: SEED_COMMUNITY, state: 'created' };
  });
}

/** TC-NEWS-02-01: /admin/news/create → title, excerpt, first category, tag, body, เผยแพร่ ทันที → บันทึก; then it must be on /frontend/news/index. */
export async function ensureNews(browser: Browser): Promise<SeedResult> {
  return withAdmin(browser, async (page) => {
    if (await listed(page, '/admin/news/index', SEED_NEWS)) return { name: SEED_NEWS, state: 'existing' };
    if (!env.allowDataCreatingTests) return { name: SEED_NEWS, state: 'skipped' };

    await page.goto(urlOf('/admin/news/create'));
    const form = page.locator('#content-module-form');
    await form.locator('input[name="title"]').fill(SEED_NEWS);
    await form.locator('textarea[name="excerpt"]').fill(SEED_DESCRIPTION);
    // "หมวดหมู่ = ตัวแรกในรายการ" — the native select behind bootstrap-select; none exist right after a reset.
    await page.evaluate(() => {
      const select = document.querySelector<HTMLSelectElement>('#content-module-category');
      const first = select ? [...select.options].find((option) => option.value) : undefined;
      if (select && first) {
        select.value = first.value;
        select.dispatchEvent(new Event('change', { bubbles: true }));
      }
    });
    await form.locator('#tag-input').fill('auto');
    await form.locator('#tag-input').press('Enter');
    await page.waitForFunction(() => !!(window as unknown as { tinymce?: { get(id: string): unknown } }).tinymce?.get('content-module-body-input'));
    await page.evaluate(() => {
      const editor = (window as unknown as { tinymce: { get(id: string): { setContent(v: string): void; save(): void } } }).tinymce.get('content-module-body-input');
      editor.setContent('<p>เนื้อหาทดสอบ</p>');
      editor.save();
    });
    await form.locator('#content-module-status-publish').check();
    await form.locator('#publish-timing-now').check();
    await Promise.all([page.waitForURL(/\/admin\/news\/index/), form.getByRole('button', { name: 'บันทึก' }).click()]);

    if (!(await listed(page, '/admin/news/index', SEED_NEWS))) throw new Error(`${SEED_NEWS} was saved but is not in the admin list`);
    if (!(await listed(page, '/frontend/news/index', SEED_NEWS))) throw new Error(`${SEED_NEWS} (เผยแพร่ ทันที) does not show on /frontend/news/index`);
    return { name: SEED_NEWS, state: 'created' };
  });
}

/** One line for the test report: what the seeding did. */
export function describeSeed(result: SeedResult): string {
  return result.state === 'skipped'
    ? `${result.name} is missing and was not created (set ALLOW_DATA_CREATING_TESTS=true to create it as in the sheet's workflow).`
    : `${result.name}: ${result.state === 'created' ? 'created now through the admin form' : 'already present'}.`;
}
