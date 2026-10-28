import type { Browser, Page } from '@playwright/test';
import { test, expect, ANONYMOUS_SESSION } from '@fixtures/pages.fixtures';
import { env } from '@config/env';
import { dateOnly, dateShape, pageDates, readLinks, STANDARD_DATE, visibleText } from '@utils/nfr';
import { DROPDOWN_MENU, SERVER_LEAK_PATTERN } from '@utils/publicPages';
import { ADMIN_PAGES, PUBLIC_SECURITY_PAGES } from '@utils/security';
import { urlOf } from '@utils/lowPrivilege';

/**
 * KM-NFR / SC-NFR-01 and SC-NFR-04 (spelling, names) — what the whole system shows, page by page. Read-only.
 *
 * Cases that mix "must hold" checks with a known bug call `test.fail()` only AFTER the checks that must hold, so a
 * different failure earlier in the test still shows up as a real failure instead of being swallowed as "expected".
 */

/** Links known to answer 4xx (see the findings) — anything else that breaks is a new failure. */
const KNOWN_BROKEN = ['/frontend/knowledge/detail'];
/** Community post pages: Thai / special-character titles answer HTTP 500 or 404 (DEF-83). */
const KNOWN_BROKEN_PREFIX = ['/frontend/cops/detail/'];

/** The dates shown on the pages that have any: public (logged out) and admin (logged in). */
const DATE_PAGES = {
  public: ['/frontend/news/index', '/frontend/search/index'],
  admin: ['/admin/dashboard/index', '/admin/role/index', '/admin/cops/index', '/admin/news/index', '/admin/group/index', '/admin/activity-log'],
};

async function collectDates(browser: Browser, page: Page): Promise<Array<{ page: string; date: string }>> {
  const found: Array<{ page: string; date: string }> = [];
  const anonymous = await browser.newContext({ storageState: ANONYMOUS_SESSION });
  try {
    const publicPage = await anonymous.newPage();
    for (const path of DATE_PAGES.public) {
      await publicPage.goto(urlOf(path));
      await publicPage.waitForLoadState('load');
      for (const date of await pageDates(publicPage)) found.push({ page: path, date });
    }
  } finally {
    await anonymous.close();
  }
  for (const path of DATE_PAGES.admin) {
    await page.goto(urlOf(path));
    await page.waitForLoadState('load');
    for (const date of await pageDates(page)) found.push({ page: path, date });
  }
  return found;
}

/** Same words, ignoring the prefixes/suffixes the menu adds ("จัดการ…", "…ระบบ") and the ฏ/ฎ slip (that is TC-NFR-04-01's business). */
function normalise(label: string): string {
  return label
    .replace(/ฎ/g, 'ฏ')
    .replace(/\s+/g, '')
    .replace(/^จัดการ/, '')
    .replace(/^การ/, '')
    .replace(/ระบบ$/, '')
    .toLowerCase();
}

const sameMeaning = (menu: string, heading: string): boolean => {
  const a = normalise(menu);
  const b = normalise(heading);
  return a === b || a.includes(b) || b.includes(a);
};

test.describe('SC-NFR-01 ความสอดคล้องและการใช้งานทั่วไป', () => {
  test('TC-NFR-01-01 [Medium] ลิงก์ในเมนูและ Footer ไม่เสีย (Link crawl)', async ({ browser, page }) => {
    test.setTimeout(240_000);
    const origin = new URL(env.baseURL).origin;
    const links: Array<{ scope: 'public' | 'admin'; page: string; raw: string; url: string; text: string }> = [];

    const anonymous = await browser.newContext({ storageState: ANONYMOUS_SESSION });
    try {
      const publicPage = await anonymous.newPage();
      for (const path of PUBLIC_SECURITY_PAGES) {
        await publicPage.goto(urlOf(path));
        await publicPage.waitForLoadState('load');
        for (const link of await readLinks(publicPage)) if (!link.toggle) links.push({ scope: 'public', page: path, ...link });
      }
      for (const path of ADMIN_PAGES) {
        await page.goto(urlOf(path));
        await page.waitForLoadState('load');
        for (const link of await readLinks(page)) if (!link.toggle) links.push({ scope: 'admin', page: path, ...link });
      }

      // Every distinct same-origin destination must answer (after redirects) with something below 400.
      const checked = new Map<string, number>();
      const external = new Set<string>();
      const broken: string[] = [];
      for (const link of links) {
        if (!/^https?:$/.test(new URL(link.url, origin).protocol) || link.raw === '#' || link.raw === '' || /^javascript:/i.test(link.raw)) continue;
        const target = new URL(link.url);
        if (target.origin !== origin) {
          external.add(target.host);
          continue;
        }
        const key = `${link.scope}|${target.pathname}${target.search}`;
        if (checked.has(key)) continue;
        const response = await (link.scope === 'public' ? anonymous.request : page.request).get(target.href, { maxRedirects: 5 });
        checked.set(key, response.status());
        if (response.status() >= 400) broken.push(`${link.scope} ${target.pathname}${target.search} → HTTP ${response.status()} (from ${link.page}, "${link.text}")`);
      }

      const placeholders = [...new Set(links.filter((link) => link.raw === '#' || link.raw === '' || /^javascript:/i.test(link.raw)).map((link) => `${link.scope} "${link.text}" href="${link.raw}"`))];
      test.info().annotations.push({
        type: 'note',
        description: `${links.length} links on ${PUBLIC_SECURITY_PAGES.length} public + ${ADMIN_PAGES.length} admin pages, ${checked.size} distinct same-origin destinations checked; external hosts not followed: ${[...external].join(', ') || 'none'}. Placeholder links (href="#"): ${placeholders.join('; ') || 'none'}.`,
      });

      // Broken links that are already reported (the home page's hard-coded sample card points at /frontend/knowledge/detail with no id).
      const knownBroken = broken.filter((entry) => KNOWN_BROKEN.some((path) => entry.includes(` ${path} `)) || KNOWN_BROKEN_PREFIX.some((prefix) => entry.includes(` ${prefix}`)));
      const newBroken = broken.filter((entry) => !knownBroken.includes(entry));
      expect(newBroken, 'no other link leads to a 4xx/5xx page').toEqual([]);

      // KNOWN BUGS: the six footer links and the logo are href="#" (DEF-10), and the sample knowledge card on the home page links to a 404.
      test.fail(placeholders.length > 0 || knownBroken.length > 0, 'Known bugs: footer links and the logo are href="#" (DEF-10); the home page sample knowledge card links to /frontend/knowledge/detail, which answers 404 (DEF-44); community post pages answer 500/404 (DEF-83).');
      expect(knownBroken, 'no link leads to a 4xx/5xx page').toEqual([]);
      expect(placeholders, 'no link that is meant to be followed is href="#"').toEqual([]);
    } finally {
      await anonymous.close();
    }
  });

  test('TC-NFR-01-02 [Medium] รูปแบบวันที่สอดคล้องกันทั้งระบบ', async ({ browser, page }) => {
    test.setTimeout(120_000);
    const found = await collectDates(browser, page);
    expect(found.length, 'the pages show dates to compare').toBeGreaterThan(0);

    // One line per date FORMAT (its shape) that is not the standard, with an example and where it was seen.
    const offenders = new Map<string, string>();
    for (const { page: where, date } of found) {
      if (!STANDARD_DATE.test(date)) offenders.set(dateShape(dateOnly(date)), `${dateShape(dateOnly(date))} e.g. "${date}" on ${where}`);
    }
    test.info().annotations.push({ type: 'note', description: `${found.length} dates on ${new Set(found.map((entry) => entry.page)).size} pages; formats that are not the standard: ${[...offenders.values()].join(' | ') || 'none'}` });

    // KNOWN BUG (DEF-15 / DEF-27): "23 ก.ย.. 26" (double dot, two-digit year), "10 มิ.ย 69" (no dot) and "26/09/2026" (Gregorian) are all in use.
    test.fail(offenders.size > 0, 'Known bug (DEF-15): dates are shown as "23 ก.ย.. 26", "10 มิ.ย 69" and "26/09/2026" instead of one standard "18 ก.ย. 2569".');
    expect([...offenders.values()], 'every date uses the standard "d MMM. yyyy" with a four-digit Buddhist year and one dot').toEqual([]);
  });

  test('TC-NFR-07-07 [Medium] รูปแบบวันที่/เวลาเป็นมาตรฐานเดียวกัน', async ({ browser, page }) => {
    test.setTimeout(120_000);
    const found = await collectDates(browser, page);
    expect(found.length, 'the pages show dates to compare').toBeGreaterThan(0);

    // Date AND time together: how many different formats are in use across public, admin lists, dashboard and the activity log?
    const formats = new Map<string, string>();
    for (const { page: where, date } of found) if (!formats.has(dateShape(date))) formats.set(dateShape(date), `${dateShape(date)} e.g. "${date}" on ${where}`);
    test.info().annotations.push({ type: 'note', description: `${formats.size} different formats: ${[...formats.values()].join(' | ')}` });

    // KNOWN BUG (DEF-15): the sheet found four formats mixed on 21/09; they still are.
    test.fail(formats.size > 1, `Known bug (DEF-15): ${formats.size} date/time formats are mixed across the system instead of one.`);
    expect([...formats.values()], 'date and time use one format across the whole system').toHaveLength(1);
  });

  test('TC-NFR-01-03 [Medium] หน้า 404 และหน้า Error แสดงอย่างเหมาะสม', async ({ browser, page }) => {
    test.setTimeout(120_000);
    const cases = [
      { scope: 'public', path: '/frontend/xxx', status: 404 },
      { scope: 'public', path: '/xxx', status: 404 },
      { scope: 'admin', path: '/admin/xxx', status: 404 },
      { scope: 'admin', path: '/admin/role/create', status: 405 },
      { scope: 'admin', path: '/admin/user/create', status: 405 },
    ] as const;

    const anonymous = await browser.newContext({ storageState: ANONYMOUS_SESSION });
    const unfriendly: string[] = [];
    const seen: string[] = [];
    try {
      const publicPage = await anonymous.newPage();
      for (const { scope, path, status } of cases) {
        const target = scope === 'public' ? publicPage : page;
        const response = await target.goto(urlOf(path));
        expect(response?.status(), `${path} answers ${status}, not a server error`).toBe(status);
        expect(await target.content(), `${path} shows no stack trace or internal path`).not.toMatch(SERVER_LEAK_PATTERN);

        const text = (await visibleText(target)).replace(/\s+/g, ' ').trim();
        const themed = (await target.locator('nav, #sidebar, footer, header img, link[href*="bootstrap"]').count()) > 0;
        const wayBack = (await target.locator('a[href]').count()) > 0;
        seen.push(`${path} → ${status} "${text.slice(0, 60)}"`);
        if (!themed || !wayBack) unfriendly.push(`${path} → "${text.slice(0, 40)}" (${themed ? 'themed' : 'no site theme'}, ${wayBack ? 'has a link' : 'no link back'})`);
      }
    } finally {
      await anonymous.close();
    }
    test.info().annotations.push({ type: 'note', description: seen.join(' | ') });

    // KNOWN BUG: the error pages are the framework's plain pages — no site theme, no way back ("405 … Something is broken. Please let us know…").
    test.fail(unfriendly.length > 0, 'Known bug (DEF-37): 404/405/500 pages are the framework defaults — no site theme and no link back to the site.');
    expect(unfriendly, 'error pages are themed and offer a way back').toEqual([]);
  });
});

test.describe('SC-NFR-04 ความสอดคล้องของข้อความและ UI', () => {
  test("TC-NFR-04-01 [Low] การสะกดคำว่า 'ปฏิบัติ' สอดคล้องและถูกต้อง", async ({ browser, page }) => {
    test.setTimeout(180_000);
    const wrong = /ปฎิบัติ/;
    const offenders: string[] = [];
    let correct = 0;

    const anonymous = await browser.newContext({ storageState: ANONYMOUS_SESSION });
    try {
      const publicPage = await anonymous.newPage();
      const scan = async (target: Page, path: string): Promise<void> => {
        await target.goto(urlOf(path));
        await target.waitForLoadState('load');
        const text = `${await target.title()} ${await visibleText(target)}`;
        correct += (text.match(/ปฏิบัติ/g) ?? []).length;
        const bad = text.match(/ปฎิบัติ/g)?.length ?? 0;
        if (bad) {
          const inLabels = (await target.locator('a, h1, h2, h3, .header, .page-title, button').allInnerTexts()).filter((label) => wrong.test(label));
          offenders.push(`${path} ×${bad}: ${[...new Set(inLabels.map((label) => label.replace(/\s+/g, ' ').trim().slice(0, 40)))].join(' / ')}`);
        }
      };
      for (const path of PUBLIC_SECURITY_PAGES) await scan(publicPage, path);
      for (const path of ADMIN_PAGES) await scan(page, path);
    } finally {
      await anonymous.close();
    }

    test.info().annotations.push({ type: 'note', description: `Correct "ปฏิบัติ" ×${correct}; misspelt "ปฎิบัติ" on: ${offenders.join(' | ') || 'no page'}` });
    // KNOWN BUG: menus and headings say "ปฎิบัติ" (ฎ) while other text says "ปฏิบัติ" (ฏ).
    test.fail(offenders.length > 0, 'Known bug (DEF-38): "ปฎิบัติ" (ฎ) appears in menus/headings of the public site and the admin sidebar next to the correct "ปฏิบัติ" (ฏ).');
    expect(offenders, 'no page uses the misspelling "ปฎิบัติ"').toEqual([]);
  });

  test('TC-NFR-04-02 [Low] ชื่อเมนูตรงกับหัวข้อหน้าและสอดคล้องกัน', async ({ browser, page }) => {
    test.setTimeout(180_000);
    const mismatches: string[] = [];
    const pairs: string[] = [];

    // Admin: every sidebar entry against the title of the page it opens.
    await page.goto(urlOf('/admin/dashboard/index'));
    const sidebar = await page.locator('#sidebar a[href]').evaluateAll((anchors) =>
      anchors.map((anchor) => ({ text: (anchor.textContent ?? '').replace(/\s+/g, ' ').trim(), href: (anchor as HTMLAnchorElement).href })).filter((entry) => entry.text && !entry.href.endsWith('#')),
    );
    expect(sidebar.length, 'the admin sidebar has entries').toBeGreaterThan(5);
    for (const { text, href } of sidebar) {
      await page.goto(href);
      const heading = (await page.locator('.page-title').first().innerText()).replace(/\s+/g, ' ').trim();
      pairs.push(`${text} ⇄ ${heading}`);
      if (!sameMeaning(text, heading)) mismatches.push(`admin menu "${text}" opens a page titled "${heading}"`);
    }

    // Public: every header dropdown item against the big title of the page it opens.
    const anonymous = await browser.newContext({ storageState: ANONYMOUS_SESSION });
    try {
      const publicPage = await anonymous.newPage();
      for (const { item, path } of DROPDOWN_MENU) {
        await publicPage.goto(urlOf(path));
        const heading = (await publicPage.locator('.body-content .header.page').first().innerText()).replace(/\s+/g, ' ').trim();
        pairs.push(`${item} ⇄ ${heading}`);
        if (!sameMeaning(item, heading)) mismatches.push(`public menu "${item}" opens a page titled "${heading}"`);
      }
    } finally {
      await anonymous.close();
    }

    test.info().annotations.push({ type: 'note', description: pairs.join(' | ') });
    // KNOWN BUG: 'ข่าวกิจกรรม KM' vs 'ข่าวสารกิจกรรม KM', 'จัดการคำถามยอดฮิต (FAQ)' vs 'จัดการคำถามที่พบบ่อย (FAQ)', 'องค์ความรู้ทั่วไป (Knowledge)' vs 'คลังความรู้'.
    test.fail(mismatches.length > 0, 'Known bug (DEF-39): some menu names differ from the title of the page they open (news, FAQ, knowledge).');
    expect(mismatches, 'every menu name means the same as the title of its page').toEqual([]);
  });

  test('TC-NFR-04-03 [Low] ชื่อปุ่มสื่อความหมายกับหน้าที่ใช้', async ({ page }) => {
    test.setTimeout(120_000);
    // Each admin list page, and the word its "เพิ่ม…" button must carry to say what it adds there.
    const expected: Array<{ path: string; nouns: string[] }> = [
      { path: '/admin/user/index', nouns: ['ผู้ใช้'] },
      { path: '/admin/role/index', nouns: ['สิทธิ์'] },
      { path: '/admin/home/index', nouns: ['สไลด์'] },
      { path: '/admin/cops/index', nouns: ['ชุมชน'] },
      { path: '/admin/knowledge/index', nouns: ['บทความ', 'องค์ความรู้'] },
      { path: '/admin/news/index', nouns: ['ข่าว', 'บทความ'] },
      { path: '/admin/faq/index', nouns: ['คำถาม'] },
      { path: '/admin/group/index', nouns: ['หมวดหมู่'] },
      { path: '/admin/activity/index', nouns: ['อัลบัม', 'กิจกรรม'] },
      { path: '/admin/bestpractice/index', nouns: ['บทความ', 'แนวปฏิบัติ', 'แนวทาง'] },
    ];
    const names: string[] = [];
    const wrong: string[] = [];
    for (const { path, nouns } of expected) {
      await page.goto(urlOf(path));
      const buttons = (await page.locator('a, button').filter({ hasText: /^\s*\+?\s*เพิ่ม/ }).allInnerTexts()).map((label) => label.replace(/\s+/g, ' ').trim()).filter((label) => label.length < 40);
      names.push(`${path.replace('/admin/', '').replace('/index', '')}: ${buttons.join(', ') || '—'}`);
      expect(buttons.length, `${path} has an add button`).toBeGreaterThan(0);
      if (!buttons.some((label) => nouns.some((noun) => label.includes(noun)))) wrong.push(`${path}: "${buttons.join(', ')}" should mention ${nouns.join(' or ')}`);
    }
    test.info().annotations.push({
      type: 'note',
      description: `Add buttons: ${names.join(' | ')}. The sheet (21/09) saw "เพิ่มบทความ" on the FAQ and site-map pages; the FAQ now says "เพิ่มคำถาม" and the site map page has no add button.`,
    });
    expect(wrong, 'each add button names what it adds on its page').toEqual([]);
  });
});
