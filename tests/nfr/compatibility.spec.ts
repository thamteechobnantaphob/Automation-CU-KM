import type { Page } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
import { test, expect, ANONYMOUS_SESSION } from '@fixtures/pages.fixtures';
import { overflowOf, pageDates } from '@utils/nfr';
import { urlOf } from '@utils/lowPrivilege';

/**
 * KM-NFR / SC-NFR-03 and SC-NFR-06 — screen sizes, accessibility basics, JavaScript off, browser time zone. Read-only.
 * As in consistency.spec.ts, `test.fail()` is called only after the checks that must hold.
 */

const PUBLIC_LAYOUT_PAGES = ['/', '/frontend/cops/index', '/frontend/search/index', '/frontend/contractus/index'];
const ADMIN_LAYOUT_PAGES = ['/admin/dashboard/index', '/admin/user/index', '/admin/role/index', '/admin/group/index', '/admin/activity-log'];

/** The admin sidebar is 278px wide; on a narrow screen the content only makes room for 72px, so it goes under the open sidebar. */
async function sidebarOverlap(page: Page): Promise<number> {
  return page.evaluate(() => {
    const sidebar = document.getElementById('sidebar')?.getBoundingClientRect();
    const content = document.querySelector('.body-content')?.getBoundingClientRect();
    return sidebar && content ? Math.max(0, Math.round(sidebar.right - content.left)) : 0;
  });
}

test.describe('SC-NFR-03 ความเข้ากันได้และประสิทธิภาพ', () => {
  test('TC-NFR-03-01 [Medium] Responsive layout ในหลายขนาดหน้าจอ', async ({ browser, page }) => {
    test.setTimeout(240_000);
    const sizes = [
      { width: 1920, height: 1080 },
      { width: 1366, height: 768 },
      { width: 768, height: 1024 },
      { width: 375, height: 800 },
    ];
    const overlaps: string[] = [];
    const sideways: string[] = [];
    const notes: string[] = [];

    const anonymous = await browser.newContext({ storageState: ANONYMOUS_SESSION });
    try {
      const publicPage = await anonymous.newPage();
      for (const { width, height } of sizes) {
        await publicPage.setViewportSize({ width, height });
        for (const path of PUBLIC_LAYOUT_PAGES) {
          await publicPage.goto(urlOf(path), { waitUntil: 'load' });
          const layout = await overflowOf(publicPage);
          if (layout.pageWidth > layout.viewport || layout.sticking.length) sideways.push(`${path} at ${width}px: the page is ${layout.pageWidth}px wide${layout.sticking.length ? ` (sticking out: ${layout.sticking.join(', ')})` : ''}`);
          await expect(publicPage.locator('nav a[href$="/frontend/search/index"]'), `${path} at ${width}px: search icon is usable`).toBeVisible();
          await expect(publicPage.locator('nav a[href$="/frontend/account/index"]'), `${path} at ${width}px: login icon is usable`).toBeVisible();
        }
        // The menu turns into the mobile one on narrow screens and stays a full menu on wide ones.
        const toggler = publicPage.locator('nav .navbar-toggler');
        if (width <= 768) {
          await expect(toggler, `the mobile menu button shows at ${width}px`).toBeVisible();
          await toggler.click();
          await expect(publicPage.locator('#offcanvasNavbar'), `the mobile menu opens at ${width}px`).toBeVisible();
        } else {
          await expect(toggler, `the full menu is used at ${width}px`).toBeHidden();
        }
      }

      for (const { width, height } of sizes) {
        await page.setViewportSize({ width, height });
        for (const path of ['/admin/dashboard/index']) {
          await page.goto(urlOf(path), { waitUntil: 'load' });
          const layout = await overflowOf(page);
          if (layout.pageWidth > layout.viewport || layout.sticking.length) sideways.push(`${path} at ${width}px: the page is ${layout.pageWidth}px wide${layout.sticking.length ? ` (sticking out: ${layout.sticking.join(', ')})` : ''}`);
          const overlap = await sidebarOverlap(page);
          notes.push(`${width}px: sidebar over content by ${overlap}px`);
          if (overlap > 0) overlaps.push(`${path} at ${width}px: the open sidebar covers ${overlap}px of the content`);
        }
      }
    } finally {
      await anonymous.close();
    }

    test.info().annotations.push({
      type: 'note',
      description: `${PUBLIC_LAYOUT_PAGES.length} public pages + the dashboard × ${sizes.length} widths; the mobile menu opens at ≤768px. Sideways scroll / overflow: ${sideways.join(' | ') || 'none'}. Admin dashboard — ${notes.join(' | ')}.`,
    });

    // Known: the contact page is a few px wider than a 375px screen. Anything else that spills over is a NEW failure.
    const knownSideways = sideways.filter((entry) => entry.startsWith('/frontend/contractus/index at 375px'));
    expect(sideways.filter((entry) => !knownSideways.includes(entry)), 'no other page scrolls sideways or sticks out of the screen').toEqual([]);

    // KNOWN BUGS: (DEF-4) below the desktop breakpoint the admin sidebar stays open and covers the content; the contact page overflows at 375px.
    test.fail(overlaps.length > 0 || knownSideways.length > 0, 'Known bugs: on narrow screens the admin sidebar stays open (278px) over the content (DEF-4); the contact page is wider than a 375px screen (DEF-45).');
    expect([...knownSideways, ...overlaps], 'on every screen size nothing scrolls sideways and the admin content is not hidden under the sidebar').toEqual([]);
  });

  test('TC-NFR-03-04 [Low] Accessibility พื้นฐาน', async ({ browser }) => {
    test.setTimeout(180_000);
    const pages = ['/', '/frontend/search/index', '/frontend/contractus/index', '/frontend/account/index'];
    const serious: string[] = [];
    const noAlt: string[] = [];
    const noLabel: string[] = [];
    const overview: string[] = [];

    const context = await browser.newContext({ storageState: ANONYMOUS_SESSION });
    try {
      const page = await context.newPage();
      for (const path of pages) {
        await page.goto(urlOf(path), { waitUntil: 'load' });
        await page.waitForTimeout(3_500); // page loader
        const result = await new AxeBuilder({ page }).analyze();
        const worst = result.violations.filter((violation) => violation.impact === 'critical' || violation.impact === 'serious');
        overview.push(`${path}: ${result.violations.length} violations, ${worst.length} critical/serious`);
        for (const violation of worst) serious.push(`${path} ${violation.impact} ${violation.id} ×${violation.nodes.length}`);

        const images = await page.evaluate(() => [...document.images].filter((image) => image.getAttribute('alt') === null).map((image) => image.getAttribute('src') ?? ''));
        if (images.length) noAlt.push(`${path}: ${images.length} image(s) without alt (${[...new Set(images.map((src) => src.split('/').pop()))].join(', ')})`);

        const inputs = await page.evaluate(() =>
          [...document.querySelectorAll('input:not([type=hidden]):not([type=submit]), select, textarea')]
            .filter((field) => !(field as HTMLInputElement).labels?.length && !field.getAttribute('aria-label') && !field.getAttribute('aria-labelledby'))
            .map((field) => `${field.tagName.toLowerCase()}[${(field as HTMLInputElement).name || (field as HTMLInputElement).placeholder}]`),
        );
        if (inputs.length) noLabel.push(`${path}: ${inputs.join(', ')}`);
      }
    } finally {
      await context.close();
    }

    test.info().annotations.push({ type: 'note', description: `axe-core (all rules): ${overview.join(' | ')}. Images without alt: ${noAlt.join(' | ') || 'none'}. Fields with no <label>: ${noLabel.join(' | ') || 'none'}. Many images share the alt "Logo".` });
    const problems = [...serious, ...noAlt, ...noLabel.map((entry) => `no label — ${entry}`)];
    // KNOWN BUG: critical axe violations (image-alt, button-name), images without alt, and form fields that have only a placeholder.
    test.fail(problems.length > 0, 'Known bug (DEF-42): critical accessibility violations (images without alt, an unnamed button) and form fields without a <label>.');
    expect(problems, 'no critical/serious violation; images have alt; every field has a label').toEqual([]);
  });
});

test.describe('SC-NFR-06 ความเข้ากันได้เพิ่มเติม', () => {
  test('TC-NFR-06-02 [Low] แท็บเล็ต (768-1024px)', async ({ browser, page }) => {
    test.setTimeout(240_000);
    const overlaps: string[] = [];

    const anonymous = await browser.newContext({ storageState: ANONYMOUS_SESSION });
    try {
      const publicPage = await anonymous.newPage();
      for (const width of [768, 1024]) {
        await publicPage.setViewportSize({ width, height: 1000 });
        for (const path of [...PUBLIC_LAYOUT_PAGES, '/frontend/news/index']) {
          await publicPage.goto(urlOf(path), { waitUntil: 'load' });
          const layout = await overflowOf(publicPage);
          expect(layout.pageWidth, `${path} at ${width}px does not scroll sideways`).toBeLessThanOrEqual(layout.viewport);
          expect(layout.sticking, `${path} at ${width}px: nothing sticks out`).toEqual([]);
        }
        await page.setViewportSize({ width, height: 1000 });
        for (const path of ADMIN_LAYOUT_PAGES) {
          await page.goto(urlOf(path), { waitUntil: 'load' });
          const layout = await overflowOf(page);
          expect(layout.pageWidth, `${path} at ${width}px does not scroll sideways`).toBeLessThanOrEqual(layout.viewport);
          expect(layout.sticking, `${path} at ${width}px: nothing sticks out`).toEqual([]);
          const overlap = await sidebarOverlap(page);
          if (overlap > 0) overlaps.push(`${path} at ${width}px: sidebar covers ${overlap}px`);
        }
      }
    } finally {
      await anonymous.close();
    }

    test.info().annotations.push({ type: 'note', description: `No sideways scroll on 5 public + ${ADMIN_LAYOUT_PAGES.length} admin pages at 768 and 1024px. Sidebar overlap: ${overlaps.join(' | ') || 'none'}.` });
    // KNOWN BUG (DEF-4): at 768px the admin sidebar stays open and covers the content.
    test.fail(overlaps.length > 0, 'Known bug (DEF-4): at 768px the admin sidebar stays open (278px) and covers the content of every admin page.');
    expect(overlaps, 'the admin content is not hidden under the sidebar').toEqual([]);
  });

  test('TC-NFR-06-03 [Low] ปิด JavaScript', async ({ browser }) => {
    test.setTimeout(120_000);
    const context = await browser.newContext({ storageState: ANONYMOUS_SESSION, javaScriptEnabled: false, viewport: { width: 1400, height: 900 } });
    const blocked: string[] = [];
    const notes: string[] = [];
    try {
      const page = await context.newPage();
      for (const path of ['/', '/frontend/news/index', '/frontend/knowledge/index']) {
        const response = await page.goto(urlOf(path), { waitUntil: 'load' });
        expect(response?.status(), `${path} answers normally without JavaScript`).toBe(200);
        const text = (await page.locator('body').innerText()).replace(/\s+/g, ' ').trim();
        expect(text.length, `${path}: the server still sends the page content`).toBeGreaterThan(200);

        const state = await page.evaluate(() => {
          const loader = document.getElementById('pageLoader');
          const top = document.elementFromPoint(window.innerWidth / 2, window.innerHeight / 2);
          return { covered: !!loader && !!top && loader.contains(top), notice: [...document.querySelectorAll('noscript')].map((element) => (element.textContent ?? '').trim()).filter(Boolean) };
        });
        notes.push(`${path}: ${text.length} chars, ${state.covered ? 'covered by the loader' : 'readable'}, ${state.notice.length ? 'noscript notice' : 'no noscript notice'}`);
        if (state.covered && !state.notice.length) blocked.push(`${path}: the "รอสักครู่ กำลังเตรียมข้อมูล" loader stays over the page and there is no <noscript> message`);
      }
    } finally {
      await context.close();
    }

    test.info().annotations.push({ type: 'note', description: notes.join(' | ') });
    // KNOWN BUG: the loader is hidden by JavaScript only, so with JS off it covers the page for good and nothing tells the visitor to turn JS on.
    test.fail(blocked.length > 0, 'Known bug (DEF-41): with JavaScript off the full-screen loader never closes and there is no <noscript> message.');
    expect(blocked, 'the content is readable, or the visitor is told to enable JavaScript').toEqual([]);
  });

  test('TC-NFR-06-05 [Low] เขตเวลาของเบราว์เซอร์ต่างกัน', async ({ browser }) => {
    test.setTimeout(180_000);
    const storageState = test.info().project.use.storageState as string | undefined;
    test.skip(!storageState, 'No saved admin session to reuse');
    const pages = ['/admin/dashboard/index', '/admin/role/index', '/admin/cops/index', '/admin/news/index', '/admin/group/index', '/frontend/news/index'];
    const byZone: Record<string, Record<string, string[]>> = {};

    for (const timezoneId of ['Asia/Bangkok', 'UTC', 'America/New_York']) {
      const context = await browser.newContext({ storageState, timezoneId });
      try {
        const page = await context.newPage();
        byZone[timezoneId] = {};
        for (const path of pages) {
          await page.goto(urlOf(path), { waitUntil: 'load' });
          byZone[timezoneId][path] = (await pageDates(page)).sort();
        }
      } finally {
        await context.close();
      }
    }

    const shown = Object.values(byZone['Asia/Bangkok']).flat();
    expect(shown.length, 'the pages show dates to compare').toBeGreaterThan(0);
    for (const timezoneId of ['UTC', 'America/New_York']) {
      for (const path of pages) {
        expect(byZone[timezoneId][path], `${path} shows the same dates in a ${timezoneId} browser as in a Bangkok one`).toEqual(byZone['Asia/Bangkok'][path]);
      }
    }
    test.info().annotations.push({
      type: 'note',
      description: `${shown.length} dates on ${pages.length} pages are identical in Asia/Bangkok, UTC and America/New_York browsers (they are formatted on the server, e.g. ${shown.slice(0, 3).join(' | ')}). Activity-log times are not compared here: they are already UTC on the server (DEF-32).`,
    });
  });
});
