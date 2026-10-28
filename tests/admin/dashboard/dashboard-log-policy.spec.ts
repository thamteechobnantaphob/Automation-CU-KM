import { test, expect } from '@fixtures/pages.fixtures';
import { requireDataCreatingTestsAllowed } from '@config/env';
import { CSV_FORMULA_PREFIXES } from '@config/policy';
import { AdminActivityLogPage } from '@pages/admin/AdminActivityLogPage';
import { AdminCopsPage } from '@pages/admin/AdminCopsPages';
import { KNOWLEDGE_MODULE } from '@pages/admin/AdminNewsPages';
import { DashboardPage } from '@pages/DashboardPage';
import { sheetTitle } from '@utils/caseTitles';
import { copDescription, deleteCopsByDescription, submitNewCop } from '@utils/copFlows';
import { deleteNewsByExcerpt, submitNews } from '@utils/newsFlows';
import { roleStamp } from '@utils/roleFlows';
import { collectDialogs } from '@utils/security';
import { AUTO_TEST_FLAG, NEEDS_LDAP_ACCOUNT } from '@utils/testData';
import { urlOf } from '@utils/lowPrivilege';
import { uniqueUsername } from '@utils/strings';
import { createUser } from '@utils/userFlows';
import { AdminUserListPage } from '@pages/admin/AdminUserListPage';
import { Page } from '@playwright/test';

/**
 * KM-ADMD / KM-ADML — dashboard filters / report and the activity log (Auto:P), checked 2026-10-07. "ออกรายงาน" opens
 * the report as a print preview in a new tab (GET /admin/dashboard/report), not a file download; the cases check that
 * page. Content and communities a case saves carry "[Auto Test]" and are deleted again.
 */

const CREATES = 'Saves content / a community (deleted again at the end of the case).';
const KNOWN = {
  NO_FILE: 'Spec note: "ออกรายงาน" opens a print preview page (save as PDF from the browser) — there is no report file to download; the sheet expects a file (TBD).',
  DASHBOARD_500: 'Known bug (DEF-119): /admin/dashboard/index answers HTTP 500 "Server Error" (since 2026-10-08; it worked on 2026-10-05) — the filters and the report button cannot be reached.',
  NOT_LOGGED: 'Known bug (DEF-86): adding / deleting a community is not recorded in "ประวัติการใช้งานระบบ".',
  REPORT_ONCE: 'Known bug (DEF-123): after one report "ออกรายงาน" stays disabled (the admin-wide double-submit guard; the report opens in a new tab so the page never reloads) — a second report needs a page reload.',
};

test.beforeEach(() => test.setTimeout(240_000));

function note(description: string): void {
  test.info().annotations.push({ type: 'note', description });
}

/** Opens the dashboard; when Dev answers 500 the case is the known bug (fails fast instead of waiting for the heading). */
async function openDashboard(page: Page, dashboard: DashboardPage): Promise<void> {
  const status = (await page.request.get(urlOf('/admin/dashboard/index'), { maxRedirects: 0 })).status();
  note(`/admin/dashboard/index: HTTP ${status}`);
  test.fail(status >= 500, KNOWN.DASHBOARD_500);
  expect(status, 'the dashboard opens').toBeLessThan(500);
  await dashboard.open();
}

async function reportText(dashboard: DashboardPage): Promise<{ text: string; url: string; html: string }> {
  const report = await dashboard.openReport();
  try {
    return { text: (await report.locator('body').innerText()).replace(/\s+/g, ' '), url: report.url(), html: await report.content() };
  } finally {
    await report.close();
  }
}

const iso = (d: Date): string => d.toISOString().slice(0, 10);

// ---------------------------------------------------------------------------------------------------------------

test.describe('SC-ADMD แดชบอร์ดและรายงาน', () => {
  test(sheetTitle('TC-ADMD-02-02'), async ({ page, dashboardPage }) => {
    await openDashboard(page, dashboardPage);
    const periods = await dashboardPage.periodPicker.locator('select option').allInnerTexts();
    note(`Periods: ${JSON.stringify(periods)}`);
    const seen: Record<string, string> = {};
    let stuck: boolean | undefined;
    for (const label of periods.map((p) => p.trim()).filter((p) => p && p !== 'กำหนดเอง').slice(0, 3)) {
      // The admin-wide double-submit guard leaves "ออกรายงาน" disabled after one report (the page does not navigate), so
      // reload the dashboard for every period.
      if (Object.keys(seen).length) await openDashboard(page, dashboardPage);
      await dashboardPage.choosePeriod(label);
      const report = await reportText(dashboardPage);
      seen[label] = new URL(report.url).search;
      stuck ??= await dashboardPage.reportButton.isDisabled();
      expect.soft(report.text, `"${label}": the report names its range`).toMatch(/\d{1,2}\s*\S+\s*\d{2,4}/);
    }
    note(`Report queries: ${JSON.stringify(seen)}; "ออกรายงาน" disabled after the first report: ${stuck}`);
    expect(new Set(Object.values(seen)).size, 'each period gives a different range').toBe(Object.keys(seen).length);
    test.fail(stuck === true, KNOWN.REPORT_ONCE);
    expect(stuck, 'another report can be opened without reloading the dashboard').toBe(false);
  });

  test(sheetTitle('TC-ADMD-03-04'), async ({ page, dashboardPage }) => {
    await openDashboard(page, dashboardPage);
    const stats = await dashboardPage.readStats();
    const report = await reportText(dashboardPage);
    note(`Dashboard cards ${JSON.stringify(stats)}; report ${report.url}`);
    note(KNOWN.NO_FILE);
    expect(report.text, 'the report opens with data').not.toBe('');
    for (const card of stats.filter((s) => s.value)) expect.soft(report.text, `the report shows "${card.label}" = ${card.value}`).toContain(card.value);
  });

  test(sheetTitle('TC-ADMD-04-01'), async ({ page, dashboardPage }) => {
    await openDashboard(page, dashboardPage);
    const cops = (await dashboardPage.copsOptions()).filter((o) => o && !/ทั้งหมด/.test(o));
    test.skip(!cops.length, 'No community on Dev to filter by.');
    await dashboardPage.chooseCops(cops[0]);
    await dashboardPage.choosePeriod('กำหนดเอง');
    const to = new Date();
    const from = new Date(Date.now() - 30 * 86_400_000);
    await dashboardPage.setDates(iso(from), iso(to));
    const report = await reportText(dashboardPage);
    note(`Community "${cops[0]}" + last 30 days → ${report.url}`);
    expect(report.url, 'the community is part of the report query').toMatch(/cop/i);
    expect(report.text, 'the report names the community').toContain(cops[0]);
  });

  test(sheetTitle('TC-ADMD-05-03'), async ({ page, dashboardPage }) => {
    requireDataCreatingTestsAllowed(CREATES);
    const total = async (): Promise<number[]> => {
      await openDashboard(page, dashboardPage);
      return (await dashboardPage.readStats()).map((s) => Number(s.value.replace(/,/g, '')) || 0);
    };
    const before = await total();
    const { excerpt, submitted } = await submitNews(page, { title: `AUTO_DASH ${roleStamp()}`, status: 'publish' }, KNOWLEDGE_MODULE);
    try {
      expect(submitted.final).toBeLessThan(500);
      const added = await total();
      note(`Cards ${JSON.stringify(before)} → after add ${JSON.stringify(added)}`);
      expect(added.reduce((a, b) => a + b, 0) - before.reduce((a, b) => a + b, 0), 'a card grows by 1').toBeGreaterThanOrEqual(1);
    } finally {
      await deleteNewsByExcerpt(page, excerpt, KNOWLEDGE_MODULE);
    }
    const removed = await total();
    note(`After delete ${JSON.stringify(removed)}`);
    expect(removed, 'back to the numbers before').toEqual(before);
  });

  test(sheetTitle('TC-ADMD-05-04'), async ({ page, dashboardPage }) => {
    await openDashboard(page, dashboardPage);
    await dashboardPage.choosePeriod('กำหนดเอง');
    await dashboardPage.setDates('2001-01-01', '2001-01-31');
    const report = await reportText(dashboardPage);
    note(`Empty range report: "${report.text.slice(0, 300)}"`);
    expect(report.text, 'the report opens (headings, no rows) or says there is no data').toMatch(/ไม่มีข้อมูล|ไม่พบ|0/);
  });

  test(sheetTitle('TC-ADMD-05-05'), async () => {
    test.fixme(true, 'Manual (QA): needs 3,000 records in the report range — Dev has a few dozen; creating them would flood the shared Dev data.');
  });

  test(sheetTitle('TC-ADMD-05-06'), async ({ page, dashboardPage }) => {
    requireDataCreatingTestsAllowed(CREATES);
    const formulas = CSV_FORMULA_PREFIXES.filter((p) => p.trim()).map((p) => `${p}HYPERLINK("http://evil.example","x") ${roleStamp()}`);
    await openDashboard(page, dashboardPage); // before saving anything: stops here while the dashboard answers 500
    const cops = new AdminCopsPage(page);
    const description = copDescription();
    const dialogs = collectDialogs(page);
    try {
      expect((await submitNewCop(cops, { name: formulas[0], description })).status()).toBeLessThan(400);
      await openDashboard(page, dashboardPage);
      const report = await reportText(dashboardPage);
      note(`Report shows: ${report.text.includes(formulas[0]) ? 'the name as text' : 'not the community'}`);
      note(KNOWN.NO_FILE);
      expect(dialogs).toEqual([]);
      expect(report.html, 'not turned into a live formula / link').not.toMatch(/href="http:\/\/evil\.example"/);
    } finally {
      note(`Cleanup: deleted ${await deleteCopsByDescription(cops, page, description)} communit(ies).`);
    }
  });
});

test.describe('SC-ADML ประวัติการใช้งานระบบ', () => {
  test(sheetTitle('TC-ADML-02-01'), async ({ page }) => {
    requireDataCreatingTestsAllowed(CREATES);
    const cops = new AdminCopsPage(page);
    const description = copDescription();
    const name = `AUTO_LOG ${roleStamp()}`;
    try {
      await submitNewCop(cops, { name, description });
    } finally {
      await deleteCopsByDescription(cops, page, description);
    }
    const log = new AdminActivityLogPage(page);
    await log.open();
    const rows = (await log.readRows()).filter((r) => r.item.includes(name));
    note(`Rows for ${name}: ${JSON.stringify(rows)}`);
    test.fail(rows.length < 2, KNOWN.NOT_LOGGED);
    expect(rows.length, 'add and delete are both logged').toBeGreaterThanOrEqual(2);
    for (const r of rows) {
      expect.soft(r.user, 'with the user').not.toBe('');
      expect.soft(r.time, 'the time').toMatch(/\d{2}\/\d{2}\/\d{4} \d{2}:\d{2}/);
      expect.soft(r.ip, 'and the IP').toMatch(/\d+\.\d+\.\d+\.\d+|:/);
    }
  });

  test(sheetTitle('TC-ADML-03-06'), async ({ page }) => {
    const log = new AdminActivityLogPage(page);
    await log.open();
    const ips = [...new Set((await log.readRows()).map((r) => r.ip))];
    note(`IPs in the log: ${JSON.stringify(ips)}`);
    expect(ips.length, 'the log has IPs').toBeGreaterThan(0);
    expect(ips.filter((ip) => /^(127\.|::1$|0\.0\.0\.0)/.test(ip)), 'not the loopback / proxy address').toEqual([]);
    note('Which IP is "the user\'s real IP" behind the UAT proxy / load balancer can only be judged on UAT.');
  });

  test(sheetTitle('TC-ADML-04-01'), async () => {
    test.fixme(true, NEEDS_LDAP_ACCOUNT);
  });

  test(sheetTitle('TC-ADML-04-03'), async ({ page }) => {
    requireDataCreatingTestsAllowed(CREATES);
    const dialogs = collectDialogs(page);
    // Saving a user is logged with its name (communities are not — DEF-86), so the HTML goes into a user's name.
    const users = new AdminUserListPage(page);
    const username = uniqueUsername();
    const name = `<img src=x onerror=alert(1)> ${AUTO_TEST_FLAG} ${username}`;
    await createUser(users, { username, name });
    try {
      await users.open();
      const dialog = await users.openDeleteDialog(username);
      await Promise.all([page.waitForLoadState('load'), dialog.confirm()]);
      note(`Cleanup: user ${username} listed after delete: ${await users.isUserListed(username)}`);
    } catch (error) {
      note(`Cleanup of ${username} failed: ${String(error).slice(0, 200)}`);
    }
    const log = new AdminActivityLogPage(page);
    await log.open();
    await page.waitForTimeout(800);
    expect(await page.locator('table img[src="x"]').count(), 'not rendered as an image').toBe(0);
    expect(dialogs, 'no script runs').toEqual([]);
    const rows = (await log.readRows()).filter((r) => r.item.includes('onerror'));
    note(`Rows: ${JSON.stringify(rows.map((r) => r.item))}`);
    expect(rows.length, 'shown as text').toBeGreaterThan(0);
  });
});

