import { test, expect, ANONYMOUS_SESSION } from '@fixtures/pages.fixtures';
import { env, requireDataCreatingTestsAllowed } from '@config/env';
import { UPLOAD } from '@config/policy';
import { AdminCopsPage } from '@pages/admin/AdminCopsPages';
import { AdminFaqPage } from '@pages/admin/AdminFaqPage';
import { AdminGroupPage } from '@pages/admin/AdminGroupPage';
import { AdminNewsListPage, KNOWLEDGE_MODULE, NewsFormPage } from '@pages/admin/AdminNewsPages';
import { DashboardPage } from '@pages/DashboardPage';
import { LoginPage } from '@pages/LoginPage';
import { sheetTitle } from '@utils/caseTitles';
import { deleteFaqWhere } from '@utils/faqFlows';
import { urlOf } from '@utils/lowPrivilege';
import { createNewsCategory, deleteNewsByExcerpt, deleteNewsCategory, fetchAsVisitor, publicContentDetail, submitNews } from '@utils/newsFlows';
import { roleStamp } from '@utils/roleFlows';
import { AUTO_TEST_FLAG } from '@utils/testData';
import { MB, paddedFile, payload } from '@utils/uploadFiles';
import { Browser, BrowserType, firefox, Page, webkit } from '@playwright/test';

/**
 * KM-NFR — non-functional cases left after the Auto:Y round (Auto:P), checked 2026-10-08. Thresholds the sheet leaves
 * TBD use its own proposals (page load ≤ 3 s, upload of 10 MB ≤ 30 s). Content a case saves carries "[Auto Test]" and
 * is deleted again. The "load test" sends 50 concurrent page requests only (no JMeter run against the shared Dev).
 */

const KNOWN = {
  HEAVY_HOME: 'Known bug (DEF-43): the home page weighs 6.3 MB (3.3 MB PNG hero, large backgrounds / SVG) and loads slower than the proposed 3 s.',
  MISSING_IMAGES: 'Known bug (DEF-13): background images /image/bg.png and /images/bg/bg-section-flower-r.png answer 404 (console errors in every browser).',
  NO_STAR:'Known bug (DEF-76): required fields carry no "*" mark (content title like the album title).',
  LOAD: 'Known bug (DEF-122): 50 concurrent page requests overload Dev — errors / time-outs and a p95 far above the proposed 5 s.',
  DASHBOARD_500: 'Known bug (DEF-119): /admin/dashboard/index answers HTTP 500 "Server Error" (since 2026-10-08) — the dashboard figures cannot be read.',
};

/** Opens the dashboard; when Dev answers 500 the case is the known bug (fails fast instead of waiting for the heading). */
async function openDashboard(page: Page, dashboard: DashboardPage): Promise<void> {
  const status = (await page.request.get(urlOf('/admin/dashboard/index'), { maxRedirects: 0 })).status();
  note(`/admin/dashboard/index: HTTP ${status}`);
  test.fail(status >= 500, KNOWN.DASHBOARD_500);
  expect(status, 'the dashboard opens').toBeLessThan(500);
  await dashboard.open();
}

test.beforeEach(() => test.setTimeout(300_000));

function note(description: string): void {
  test.info().annotations.push({ type: 'note', description });
}

async function visitor<T>(browser: Browser, work: (page: Page) => Promise<T>, viewport?: { width: number; height: number }): Promise<T> {
  const context = await browser.newContext({ storageState: ANONYMOUS_SESSION, ...(viewport ? { viewport } : {}) });
  try {
    return await work(await context.newPage());
  } finally {
    await context.close();
  }
}

/** A short smoke run in another browser engine: public pages, search, admin login + dashboard; console errors. */
async function smoke(type: BrowserType): Promise<{ errors: string[]; steps: string[] }> {
  const errors: string[] = [];
  const steps: string[] = [];
  const browser = await type.launch({ timeout: 60_000 });
  try {
    // Explicitly anonymous: the test runner gives every new context the config's admin storageState.
    const page = await (await browser.newContext({ storageState: { cookies: [], origins: [] } })).newPage();
    page.setDefaultTimeout(45_000);
    page.setDefaultNavigationTimeout(60_000);
    page.on('console', (m) => m.type() === 'error' && errors.push(m.text().slice(0, 120)));
    page.on('pageerror', (e) => errors.push(e.message.slice(0, 120)));
    page.on('response', (r) => r.status() >= 400 && errors.push(`HTTP ${r.status()} ${new URL(r.url()).pathname}`));
    for (const path of ['/', '/frontend/knowledge/index', '/frontend/faq/index', '/frontend/search/index?q=KM']) {
      const started = Date.now();
      // Wait for 'load': leaving earlier aborts image / font downloads, which Firefox reports as "corrupt or truncated".
      const r = await page.goto(urlOf(path), { waitUntil: 'load' });
      steps.push(`${path} ${r?.status()} (${Date.now() - started} ms)`);
    }
    const login = new LoginPage(page);
    await login.open();
    await login.login(env.adminUser, env.adminPass);
    await page.waitForURL((url) => !url.pathname.includes('/frontend/account/'), { timeout: 60_000, waitUntil: 'domcontentloaded' });
    steps.push(`login → ${new URL(page.url()).pathname}`);
    const r = await page.goto(urlOf('/admin/knowledge/index'), { waitUntil: 'domcontentloaded' });
    steps.push(`/admin/knowledge/index ${r?.status()}: ${await page.locator('.article-card').count()} card(s)`);
  } catch (error) {
    const page = browser.contexts()[0]?.pages()[0];
    steps.push(`stopped at ${page?.url() ?? '?'}: ${String(error).split('\n')[0].slice(0, 160)}`);
    if (page) {
      const shot = await page.screenshot({ fullPage: false }).catch(() => null);
      if (shot) await test.info().attach(`${type.name()}-stopped.png`, { body: shot, contentType: 'image/png' });
    }
  } finally {
    await browser.close();
  }
  return { errors, steps };
}

// ---------------------------------------------------------------------------------------------------------------

test.describe('SC-NFR-01/03 ข้อความ เบราว์เซอร์ ความเร็ว', () => {
  test(sheetTitle('TC-NFR-01-04'), async ({ page, browser }) => {
    requireDataCreatingTestsAllowed('Saves a knowledge article (deleted again at the end).');
    const text = `ไทย English 😀✓① ©®™ “อัญประกาศ” & <tag> ${roleStamp()}`;
    const { excerpt, submitted } = await submitNews(page, { title: `AUTO_UTF8 ${roleStamp()}`, excerpt: `${AUTO_TEST_FLAG} ${text}`, status: 'publish' }, KNOWLEDGE_MODULE);
    try {
      expect(submitted.final).toBeLessThan(500);
      const card = await new AdminNewsListPage(page, KNOWLEDGE_MODULE).findByExcerpt(excerpt);
      expect(card?.excerpt, 'admin: stored and shown as typed').toBe(excerpt);
      const list = await fetchAsVisitor(browser, urlOf(KNOWLEDGE_MODULE.publicIndex));
      expect(list.body.toString(), 'public: shown as typed (UTF-8)').toContain(text.replace('&', '&amp;').replace('<tag>', '&lt;tag&gt;'));
      note('The exported report is a print page (ADMD-03-04); it shows dashboard figures, not this text.');
    } finally {
      await deleteNewsByExcerpt(page, excerpt, KNOWLEDGE_MODULE);
    }
  });

  test(sheetTitle('TC-NFR-03-02'), async () => {
    const results: Record<string, { errors: string[]; steps: string[] }> = {};
    for (const [name, type] of [['Firefox', firefox], ['WebKit (Safari engine)', webkit]] as const) results[name] = await smoke(type);
    note(JSON.stringify(results));
    note('Chrome / Edge share the Chromium engine of the main suite; a real Safari / Edge is a manual check.');
    test.fail(Object.values(results).some((r) => r.errors.includes('HTTP 500 /admin/dashboard/index')), KNOWN.DASHBOARD_500);
    test.fail(Object.values(results).some((r) => r.errors.some((e) => /^HTTP 404 \/image(s\/bg)?\/bg/.test(e))), KNOWN.MISSING_IMAGES);
    for (const [name, r] of Object.entries(results)) {
      expect.soft(r.steps.filter((s) => /^stopped/.test(s)), `${name}: every step finished`).toEqual([]);
      expect.soft(r.steps.filter((s) => / 5\d\d\b/.test(s)), `${name}: no server error`).toEqual([]);
      expect.soft(r.errors, `${name}: no console error`).toEqual([]);
    }
  });

  test(sheetTitle('TC-NFR-03-03'), async ({ browser }) => {
    const times: Record<string, number[]> = { '/': [], '/frontend/search/index?q=KM': [] };
    for (const path of Object.keys(times)) {
      for (let i = 0; i < 5; i++) {
        times[path].push(await visitor(browser, async (page) => {
          const started = Date.now();
          await page.goto(urlOf(path), { waitUntil: 'load' });
          return Date.now() - started;
        }));
      }
    }
    const avg = (xs: number[]): number => Math.round(xs.reduce((a, b) => a + b, 0) / xs.length);
    note(`Load times (ms): ${JSON.stringify(times)}; averages home ${avg(times['/'])}, search ${avg(times['/frontend/search/index?q=KM'])}`);
    expect.soft(avg(times['/frontend/search/index?q=KM']), 'search ≤ 3 s').toBeLessThanOrEqual(3_000);
    test.fail(avg(times['/']) > 3_000, KNOWN.HEAVY_HOME);
    expect(avg(times['/']), 'home ≤ 3 s').toBeLessThanOrEqual(3_000);
  });
});

test.describe('SC-NFR-04 การใช้งาน', () => {
  test(sheetTitle('TC-NFR-04-04'), async ({ page }) => {
    requireDataCreatingTestsAllowed('Adds and deletes a FAQ and an article (deleted again at once).');
    // The delete helpers reload the list to check the item is gone (the one-time flash is then used up), so read the
    // flash from every page the server sends instead of from the screen.
    const flashes: string[] = [];
    const pending: Promise<void>[] = [];
    page.on('response', (response) => {
      if (response.request().resourceType() !== 'document' || response.status() !== 200) return;
      pending.push(response.text().then((html) => {
        for (const m of html.matchAll(/<div[^>]*class="[^"]*\balert\b[^"]*"[^>]*>([\s\S]*?)<\/div>/g)) {
          const text = m[1].replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
          if (text) flashes.push(`${text} [close: ${/btn-close|data-bs-dismiss/.test(m[0]) ? 1 : 0}]`);
        }
      }, () => undefined));
    });
    const { excerpt } = await submitNews(page, { title: `AUTO_FLASH ${roleStamp()}` }, KNOWLEDGE_MODULE);
    await deleteNewsByExcerpt(page, excerpt, KNOWLEDGE_MODULE);
    const faq = new AdminFaqPage(page);
    await faq.open();
    await faq.openAddForm();
    const answer = `${AUTO_TEST_FLAG} แจ้งผล ${roleStamp()}`;
    await faq.fill({ question: `${AUTO_TEST_FLAG} คำถามแจ้งผล`, answer, status: 'hide' });
    await faq.save();
    await page.waitForLoadState('load');
    await deleteFaqWhere(page, (c) => c.editAnswer === answer);
    await Promise.all(pending);
    note(`Messages: ${JSON.stringify(flashes)}`);
    expect.soft(flashes.filter((f) => /เพิ่ม|บันทึก/.test(f)).length, 'adding the article and the FAQ shows a message each').toBeGreaterThanOrEqual(2);
    expect(flashes.filter((f) => /ลบ/.test(f)).length, 'deleting the article and the FAQ shows a message each').toBeGreaterThanOrEqual(2);
    for (const f of flashes) expect.soft(f, 'in Thai').toMatch(/[฀-๿]/);
    expect.soft(flashes.every((f) => /close: [1-9]/.test(f)), 'each can be closed').toBe(true);
  });

  test(sheetTitle('TC-NFR-04-05'), async ({ page }) => {
    const form = new NewsFormPage(page, KNOWLEDGE_MODULE);
    await form.openCreate();
    const label = (await page.locator('label[for="content-module-title"], label').filter({ hasText: /หัวเรื่อง|ชื่อ/ }).first().innerText().catch(() => '')).trim();
    await form.form.evaluate((f: HTMLFormElement) => (f.noValidate = false));
    await page.getByRole('button', { name: 'บันทึก' }).first().click();
    await page.waitForTimeout(600);
    const focused = await page.evaluate(() => (document.activeElement as HTMLInputElement | null)?.name ?? '');
    const message = await form.titleInput.evaluate((el: HTMLInputElement) => el.validationMessage);
    note(`Title label "${label}"; focused "${focused}"; message "${message}"`);
    expect(message, 'the empty required field reports a message').not.toBe('');
    expect(focused, 'focus goes to the first wrong field').toBe('title');
    test.fail(!label.includes('*'), KNOWN.NO_STAR);
    expect(label, 'the required field is marked with *').toContain('*');
  });

  test(sheetTitle('TC-NFR-04-07'), async ({ page }) => {
    const form = new NewsFormPage(page, KNOWLEDGE_MODULE);
    await form.openCreate();
    await form.titleInput.fill(`${AUTO_TEST_FLAG} ยังไม่บันทึก`);
    let warned = false;
    page.on('dialog', (d) => {
      warned = true;
      void d.dismiss();
    });
    await page.goto(urlOf('/admin/dashboard/index')).catch(() => undefined);
    note(warned ? 'A "leave page?" warning is shown.' : 'No warning: the typed data is dropped silently ("หรือไม่เตือนตามกติกา TBD").');
    // Either is allowed by the sheet (TBD); nothing may be saved by leaving.
    expect(await new AdminNewsListPage(page, KNOWLEDGE_MODULE).findByExcerpt(`${AUTO_TEST_FLAG} ยังไม่บันทึก`)).toBeUndefined();
  });

  test(sheetTitle('TC-NFR-04-13'), async ({ browser }) => {
    // 200 % zoom of a 1366 × 768 window = a 683 × 384 CSS viewport.
    const viewport = { width: 683, height: 384 };
    const problems: string[] = [];
    await visitor(browser, async (page) => {
      for (const path of ['/', '/frontend/search/index', '/frontend/contractus/index']) {
        await page.goto(urlOf(path));
        const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
        if (overflow > 1) problems.push(`${path}: ${overflow}px sideways`);
      }
      await page.goto(urlOf('/frontend/contractus/index'));
      if (!(await page.getByRole('button', { name: 'ส่งแบบฟอร์ม' }).isVisible())) problems.push('contact: the send button is hidden');
    }, viewport);
    const admin = await browser.newContext({ storageState: 'playwright/.auth/admin.json', viewport });
    try {
      const page = await admin.newPage();
      await page.goto(urlOf('/admin/dashboard/index'));
      const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
      if (overflow > 1) problems.push(`dashboard: ${overflow}px sideways`);
    } finally {
      await admin.close();
    }
    note(`Problems at 200 %: ${JSON.stringify(problems)}`);
    expect(problems, 'nothing cut off, every button reachable').toEqual([]);
  });
});

test.describe('SC-NFR-05/06 ประสิทธิภาพและอุปกรณ์', () => {
  test(sheetTitle('TC-NFR-05-04'), async ({ playwright }) => {
    const request = await playwright.request.newContext({ baseURL: env.baseURL });
    try {
      const paths = ['/', '/frontend/search/index?q=KM', '/frontend/account/index'];
      const runs = Array.from({ length: 50 }, (_, i) => paths[i % paths.length]);
      const results = await Promise.all(runs.map(async (path) => {
        const started = Date.now();
        const r = await request.get(urlOf(path)).catch(() => null);
        return { ok: !!r && r.status() < 500, ms: Date.now() - started };
      }));
      const errors = results.filter((r) => !r.ok).length;
      const sorted = results.map((r) => r.ms).sort((a, b) => a - b);
      const p95 = sorted[Math.floor(sorted.length * 0.95) - 1];
      note(`50 concurrent requests: ${errors} error(s); p95 ${p95} ms; max ${sorted[sorted.length - 1]} ms. (Not a 10-minute JMeter run.)`);
      test.fail(errors / 50 >= 0.01 || p95 > 5_000, KNOWN.LOAD);
      expect(errors / 50, 'error rate < 1 %').toBeLessThan(0.01);
      expect(p95, 'p95 ≤ 5 s (TBD in the sheet)').toBeLessThanOrEqual(5_000);
    } finally {
      await request.dispose();
    }
  });

  test(sheetTitle('TC-NFR-05-08'), async ({ page }) => {
    requireDataCreatingTestsAllowed('Saves an article with a 10 MB document (deleted again at the end).');
    note(`Album images allow ${UPLOAD.imageMaxMB} MB (proposal), so the 10 MB upload uses a document (limit ${UPLOAD.documentMaxMB} MB).`);
    const doc = paddedFile(payload('big.pdf', Buffer.from('%PDF-1.4\n%[Auto Test]\n'), 'application/pdf'), UPLOAD.documentMaxMB * MB, 'big.pdf');
    const started = Date.now();
    const { excerpt, submitted } = await submitNews(page, { title: `AUTO_10MB ${roleStamp()}`, documents: [doc] }, KNOWLEDGE_MODULE);
    const took = Date.now() - started;
    try {
      note(`10 MB save: ${took} ms (HTTP ${submitted.first} → ${submitted.final})`);
      expect(submitted.final, 'no server error').toBeLessThan(500);
      expect(took, 'within 30 s on the LAN').toBeLessThanOrEqual(30_000);
    } finally {
      await deleteNewsByExcerpt(page, excerpt, KNOWLEDGE_MODULE);
    }
  });

  test(sheetTitle('TC-NFR-06-01'), async () => {
    test.fixme(true, 'Manual (QA): needs real Android / iOS phones — emulated mobile widths are covered by the 375px cases.');
  });

  test(sheetTitle('TC-NFR-06-06'), async ({ browser }) => {
    const report = await visitor(browser, async (page) => {
      await page.goto(urlOf('/frontend/faq/index'));
      await page.evaluate(() => document.fonts.ready);
      return page.evaluate(() => ({
        family: getComputedStyle(document.body).fontFamily,
        thaiCovered: document.fonts.check('16px ' + getComputedStyle(document.body).fontFamily, 'ภาษาไทย ปิ่น ญี่ ฐู'),
        failed: [...document.fonts].filter((f) => f.status === 'error').map((f) => f.family),
      }));
    });
    note(`Font: ${JSON.stringify(report)} — floating vowels / stacked tone marks need a visual check in Safari / Edge.`);
    expect(report.failed, 'every web font loads').toEqual([]);
    expect(report.thaiCovered, 'the font covers Thai').toBe(true);
  });

  test(sheetTitle('TC-NFR-06-07'), async ({ page, browser }) => {
    requireDataCreatingTestsAllowed('Saves a knowledge article (deleted again at the end).');
    const title = `AUTO_PRINT ${roleStamp()}`;
    const { excerpt } = await submitNews(page, { title, body: `<p>${'เนื้อหาสำหรับพิมพ์ '.repeat(80)}</p>`, status: 'publish' }, KNOWLEDGE_MODULE);
    try {
      const detail = await publicContentDetail(browser, excerpt, title, KNOWLEDGE_MODULE);
      const shown = await visitor(browser, async (v) => {
        await v.goto(detail!.url);
        await v.emulateMedia({ media: 'print' });
        return v.evaluate(() => ({
          nav: [...document.querySelectorAll('nav, header, footer')].filter((e) => (e as HTMLElement).offsetHeight > 0).length,
          text: document.body.innerText.includes('เนื้อหาสำหรับพิมพ์'),
          overflow: document.documentElement.scrollWidth - document.documentElement.clientWidth,
        }));
      });
      note(`Print view: ${JSON.stringify(shown)} (menus left visible: ${shown.nav} — hiding them is TBD in the sheet)`);
      expect(shown.text, 'the content is printed').toBe(true);
      expect(shown.overflow, 'nothing runs off the page').toBeLessThanOrEqual(1);
    } finally {
      await deleteNewsByExcerpt(page, excerpt, KNOWLEDGE_MODULE);
    }
  });
});

test.describe('SC-NFR-07 ความสอดคล้องของข้อมูล', () => {
  test(sheetTitle('TC-NFR-07-01'), async ({ page, browser }) => {
    const dashboard = new DashboardPage(page);
    await openDashboard(page, dashboard);
    const stats = await dashboard.readStats();
    const dash = Number(stats.find((s) => /CoPs|ชุมชน/i.test(s.label))?.value.replace(/,/g, '') ?? NaN);
    const cops = new AdminCopsPage(page);
    await cops.open();
    const cards = await cops.readCards();
    const published = cards.filter((c) => c.status === 'เผยแพร่').length;
    const pub = await visitor(browser, async (v) => {
      await v.goto(urlOf('/frontend/cops/index'));
      return v.locator('.body-content a.card').count();
    });
    note(`Dashboard ${dash}; admin ${cards.length} (${published} published); public list ${pub}`);
    expect(pub, 'the public list counts the published ones').toBe(published);
    expect(dash === cards.length || dash === published, 'the dashboard matches the admin (all or published)').toBe(true);
  });

  test(sheetTitle('TC-NFR-07-03'), async ({ page, browser }) => {
    requireDataCreatingTestsAllowed('Saves a knowledge article (deleted again at the end).');
    const dashboard = new DashboardPage(page);
    await openDashboard(page, dashboard);
    const before = (await dashboard.readStats()).map((s) => s.value).join('/');
    const title = `AUTO_EVERYWHERE ${roleStamp()}`;
    const { excerpt } = await submitNews(page, { title, status: 'publish' }, KNOWLEDGE_MODULE);
    try {
      const list = await fetchAsVisitor(browser, urlOf(KNOWLEDGE_MODULE.publicIndex));
      const search = await fetchAsVisitor(browser, urlOf(`/frontend/search/index?q=${encodeURIComponent(title.split(' ').pop()!)}`));
      await openDashboard(page, dashboard);
      const after = (await dashboard.readStats()).map((s) => s.value).join('/');
      note(`Dashboard cards ${before} → ${after}`);
      expect(list.body.toString(), 'on the public list').toContain(title);
      expect(search.body.toString().replace(/value="[^"]*"/g, ''), 'in the search results').toContain(title);
      expect(after, 'the dashboard figures change').not.toBe(before);
    } finally {
      await deleteNewsByExcerpt(page, excerpt, KNOWLEDGE_MODULE);
    }
  });

  test(sheetTitle('TC-NFR-07-04'), async ({ page, browser }) => {
    requireDataCreatingTestsAllowed('Saves a knowledge article and deletes it.');
    const title = `AUTO_GONE ${roleStamp()}`;
    const { excerpt } = await submitNews(page, { title, status: 'publish' }, KNOWLEDGE_MODULE);
    const detail = await publicContentDetail(browser, excerpt, title, KNOWLEDGE_MODULE);
    expect(detail?.status, 'precondition: published').toBe(200);
    expect(await deleteNewsByExcerpt(page, excerpt, KNOWLEDGE_MODULE)).toBe(1);
    const list = await fetchAsVisitor(browser, urlOf(KNOWLEDGE_MODULE.publicIndex));
    const search = await fetchAsVisitor(browser, urlOf(`/frontend/search/index?q=${encodeURIComponent(title.split(' ').pop()!)}`));
    const home = await fetchAsVisitor(browser, urlOf('/'));
    const old = await fetchAsVisitor(browser, detail!.url);
    note(`Old link ${detail!.url} → ${old.status}`);
    expect(list.body.toString(), 'not on the list').not.toContain(title);
    expect(search.body.toString().replace(/value="[^"]*"/g, ''), 'not in search').not.toContain(title);
    expect(home.body.toString(), 'not on the home page').not.toContain(title);
    expect(old.status, 'the old link answers 404').toBe(404);
  });

  test(sheetTitle('TC-NFR-07-05'), async ({ page, browser }) => {
    requireDataCreatingTestsAllowed('Saves a knowledge category and an article (deleted again at the end).');
    const name = await createNewsCategory(page, `${AUTO_TEST_FLAG} หมวดก่อนเปลี่ยน`, KNOWLEDGE_MODULE);
    let current = name;
    const title = `AUTO_RENAME_EVERYWHERE ${roleStamp()}`;
    const { excerpt } = await submitNews(page, { title, category: name, status: 'publish' }, KNOWLEDGE_MODULE);
    try {
      const renamed = `${AUTO_TEST_FLAG} หมวดหลังเปลี่ยน ${roleStamp()}`;
      const group = new AdminGroupPage(page);
      await group.open('knowledge');
      await group.openEditForm(name);
      await group.fill({ name: renamed });
      expect((await group.save()).status()).toBeLessThan(400);
      current = renamed;
      const detail = await publicContentDetail(browser, excerpt, title, KNOWLEDGE_MODULE);
      note(`Detail shows the new name: ${detail?.text.includes(renamed)}`);
      expect(detail?.text, 'the article shows the new category name').toContain(renamed);
      expect(detail?.text, 'not the old one').not.toContain(name);
      note('The "user" half (renamed creator in the creator column / log) needs a second account that creates content — UAT (DEF-49). The admin card shows "Admin" anyway (DEF-89).');
    } finally {
      await deleteNewsByExcerpt(page, excerpt, KNOWLEDGE_MODULE);
      await deleteNewsCategory(page, current, KNOWLEDGE_MODULE);
    }
  });
});
