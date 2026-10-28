import type { Page } from '@playwright/test';
import { test, expect, ANONYMOUS_SESSION } from '@fixtures/pages.fixtures';
import { env } from '@config/env';
import { ADMIN_PAGES, PUBLIC_SECURITY_PAGES } from '@utils/security';
import { loginAs, urlOf } from '@utils/lowPrivilege';

/**
 * KM-NFR / SC-NFR-04 — how the shared chrome behaves: page loader, sidebar, active menu, "หน้าเว็บไซต์" and the two
 * logout buttons. Read-only; the two logouts run in their own sessions so the shared admin session is never ended.
 */

const SYSTEM_GROUP_PAGES = ['/admin/user/index', '/admin/role/index', '/admin/activity-log'];

test.describe('SC-NFR-04 พฤติกรรมของส่วนประกอบร่วม', () => {
  test('TC-NFR-04-08 [Medium] หน้า Loading ปิดเมื่อโหลดเสร็จ', async ({ browser }) => {
    test.setTimeout(180_000);
    const context = await browser.newContext({ storageState: ANONYMOUS_SESSION, viewport: { width: 1400, height: 900 } });
    try {
      const page = await context.newPage();
      const notes: string[] = [];
      for (const path of PUBLIC_SECURITY_PAGES) {
        await page.goto(urlOf(path), { waitUntil: 'load' });
        const loader = page.locator('#pageLoader');
        // The loader gets class "hidden" on window.load (or after a 3 s safety timeout): it must be gone, not just faded.
        await expect(loader, `${path}: loader is closed after loading`).toHaveClass(/\bhidden\b/, { timeout: 10_000 });
        const state = await loader.evaluate((element) => {
          const style = getComputedStyle(element);
          const box = element.getBoundingClientRect();
          const top = document.elementFromPoint(window.innerWidth / 2, window.innerHeight / 2);
          return { display: style.display, visibility: style.visibility, opacity: style.opacity, pointer: style.pointerEvents, covers: !!top && element.contains(top), area: Math.round(box.width * box.height) };
        });
        const gone = state.display === 'none' || state.visibility === 'hidden' || state.opacity === '0' || state.pointer === 'none';
        expect(gone, `${path}: the closed loader no longer shows (${JSON.stringify(state)})`).toBe(true);
        expect(state.covers, `${path}: nothing of the loader sits over the page centre`).toBe(false);
        notes.push(`${path}: ${state.display}/${state.opacity}`);
      }
      test.info().annotations.push({ type: 'note', description: `Loader closed on all ${PUBLIC_SECURITY_PAGES.length} public pages (${notes.join(' | ')}). A hidden "Loading..." image stays in the DOM.` });
    } finally {
      await context.close();
    }
  });

  test('TC-NFR-04-09 [Low] ยุบ/ขยาย Sidebar ของ admin', async ({ page, dashboardPage }) => {
    await dashboardPage.open();
    const sidebar = page.locator('#sidebar');
    const width = async (): Promise<number> => Math.round((await sidebar.boundingBox())?.width ?? 0);
    const contentLeft = async (): Promise<number> => Math.round((await page.locator('.stat-card').first().boundingBox())?.x ?? 0);

    const open = { sidebar: await width(), content: await contentLeft() };
    await page.locator('#toggle-btn').click();
    await expect(sidebar).toHaveClass(/\bclose\b/);
    await expect(page.locator('body')).toHaveClass(/sidebar-closed/);
    // The width and the content margin animate (CSS transition), so wait for them to settle.
    await expect.poll(width, { message: 'the sidebar gets narrower when collapsed' }).toBeLessThan(open.sidebar);
    await expect.poll(contentLeft, { message: 'the content moves left to use the space' }).toBeLessThan(open.content);
    await page.waitForTimeout(600);
    const closed = { sidebar: await width(), content: await contentLeft() };

    await page.locator('#toggle-btn').click();
    await expect(sidebar).not.toHaveClass(/\bclose\b/);
    await expect.poll(width, { message: 'the sidebar expands again' }).toBe(open.sidebar);

    // After F5 the state is either kept or back to the default (the sheet leaves the rule TBD) — but never half-way.
    await page.locator('#toggle-btn').click();
    await expect(sidebar).toHaveClass(/\bclose\b/);
    await expect.poll(width).toBe(closed.sidebar);
    await page.reload();
    await dashboardPage.heading.waitFor({ state: 'visible' });
    await page.waitForTimeout(800);
    const afterReload = await width();
    expect([open.sidebar, closed.sidebar], 'after a reload the sidebar is fully open or fully collapsed').toContain(afterReload);
    test.info().annotations.push({
      type: 'note',
      description: `Open ${open.sidebar}px / collapsed ${closed.sidebar}px; content starts at ${open.content}px → ${closed.content}px. After F5 the sidebar is ${afterReload === open.sidebar ? 'open again (the state is not remembered)' : 'still collapsed (the state is remembered)'}.`,
    });
  });

  test('TC-NFR-04-10 [Low] เมนูที่กำลังใช้งานถูกไฮไลต์', async ({ page }) => {
    test.setTimeout(180_000);
    const problems: string[] = [];
    const seen: string[] = [];

    for (const path of ADMIN_PAGES) {
      await page.goto(urlOf(path));
      const active = await page.locator('#sidebar a.active').evaluateAll((anchors) => anchors.map((anchor) => (anchor as HTMLAnchorElement).pathname));
      // Must hold: the page's own menu entry is highlighted.
      expect(active, `${path}: its own menu entry is highlighted`).toContain(path);
      seen.push(`${path.replace('/admin/', '')}: ${active.length}`);
      // Only that one.
      if (active.length > 1) problems.push(`${path}: ${active.length} entries highlighted (${active.join(', ')})`);
      // Pages in the "จัดการระบบ" group: the group must be open so the highlighted entry can be seen.
      if (SYSTEM_GROUP_PAGES.includes(path)) {
        const entryVisible = await page.locator(`#sidebar a.active[href$="${path}"]`).first().isVisible();
        if (!entryVisible) problems.push(`${path}: the "จัดการระบบ" group stays collapsed, so the highlighted entry is hidden`);
      }
    }

    test.info().annotations.push({ type: 'note', description: `Highlighted entries per page: ${seen.join(' | ')}` });
    // KNOWN BUG: /admin/activity-log also lights "คลังกิจกรรม" (the menu matches /admin/activity as a prefix of /admin/activity-log).
    test.fail(problems.length > 0, 'Known bug (DEF-40): on the activity log page the menu highlights "คลังกิจกรรม" as well as "ประวัติการใช้งานระบบ" (prefix match on /admin/activity).');
    expect(problems, 'exactly the current page is highlighted and visible').toEqual([]);
  });

  test("TC-NFR-04-11 [Medium] ปุ่ม 'หน้าเว็บไซต์' ใน admin เปิดเว็บ Public", async ({ page, context, dashboardPage }) => {
    await dashboardPage.open();
    const button = page.locator('a', { hasText: 'หน้าเว็บไซต์' }).first();
    await expect(button, 'the button leads somewhere (not href="#")').toHaveAttribute('href', /^https?:\/\/.+/);

    const [site] = await Promise.all([context.waitForEvent('page'), button.click()]);
    await site.waitForLoadState('load');
    expect(new URL(site.url()).pathname, 'the public home page opens').toBe('/');
    await expect(site, 'no error page').toHaveTitle('หน้าหลัก');
    expect(page.url(), 'the admin tab stays where it was').toContain('/admin/dashboard/index');
    const opensNewTab = (await button.getAttribute('target')) === '_blank';
    await site.close();
    test.info().annotations.push({
      type: 'note',
      description: `Opens the public home in ${opensNewTab ? 'a new tab' : 'the same tab'} (rel="${await button.getAttribute('rel')}"). The sheet saw href="#" on 21/09; it is a real link now. The button is hidden below the "lg" breakpoint.`,
    });
  });

  test("TC-NFR-04-12 [Low] ปุ่ม 'ออกจากระบบ' ทั้ง 2 จุดทำงาน", async ({ browser }) => {
    test.skip(!env.adminUser || !env.adminPass, 'ADMIN_USER/ADMIN_PASS not set in .env');
    test.setTimeout(180_000);

    const loggedOut = async (page: Page): Promise<void> => {
      await expect(page, 'sent to the login page').toHaveURL(/account\/index/);
      await page.goto(urlOf('/admin/dashboard/index'));
      await expect(page, 'the admin is no longer reachable').toHaveURL(/account\/index/);
    };

    // 1. The user menu (top right) — its own session.
    const first = await loginAs(browser, env.adminUser, env.adminPass);
    try {
      await first.page.goto(urlOf('/admin/dashboard/index'));
      await first.page.getByText('ผู้ดูแลระบบ').first().click();
      await first.page.locator('.dropdown-item', { hasText: 'ออกจากระบบ' }).click();
      await loggedOut(first.page);
    } finally {
      await first.context.close();
    }

    // 2. The button at the bottom of the sidebar — a new login, its own session.
    const second = await loginAs(browser, env.adminUser, env.adminPass);
    try {
      await second.page.goto(urlOf('/admin/dashboard/index'));
      const sidebarLogout = second.page.locator('.sidebar-logout-btn');
      await expect(sidebarLogout, 'the sidebar has its own logout button').toBeVisible();
      await sidebarLogout.click();
      await loggedOut(second.page);
    } finally {
      await second.context.close();
    }
    test.info().annotations.push({ type: 'note', description: 'Both the user-menu item and the sidebar button end the session (each in its own login).' });
  });
});
