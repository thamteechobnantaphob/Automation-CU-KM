import { test, expect } from '@fixtures/pages.fixtures';
import { env } from '@config/env';
import { LOG_HEADERS, LOG_PAGE_SIZE, LogRow, splitLogTime } from '@pages/admin/AdminActivityLogPage';
import { loginAs } from '@utils/lowPrivilege';

/**
 * KM-ADML — /admin/activity-log ("ประวัติการใช้งานระบบ"). Read-only apart from the
 * one login TC-ADML-03-05 makes (the log records it): the cases filter and read
 * the list, and try verbs that must be refused.
 *
 * Data on Dev keeps growing (every login and every create/delete is logged), so the
 * cases never rely on fixed dates or counts: they pick the newest / oldest day
 * actually present, and compare totals with totals. The sheet's example date
 * (18/09/2026) has no rows on Dev.
 *
 * Time zone: the page prints its times in UTC, 7 hours behind Asia/Bangkok, so
 * TC-ADML-03-05 is a known bug (see there); TC-ADML-01-01 does not repeat it.
 * Runs as admin (default storageState).
 */

const ADMIN_NAME = 'ผู้ดูแลระบบ';
const ALL = 'ทั้งหมด';
const dayBefore = (iso: string): string => new Date(Date.parse(`${iso}T00:00:00Z`) - 86_400_000).toISOString().slice(0, 10);

test.describe('SC-ADML-01 รายการและตัวกรอง', () => {
  test('TC-ADML-01-01 [High] แสดงประวัติการใช้งาน', async ({ page, activityLogPage: log }) => {
    await log.open();
    await expect(log.heading).toHaveText('ประวัติการใช้งานระบบ');
    await expect(page.locator('table thead th')).toHaveText([...LOG_HEADERS]);

    const rows = await log.readRows();
    expect(rows.length, 'the log has rows').toBeGreaterThan(0);
    expect(rows.length).toBeLessThanOrEqual(LOG_PAGE_SIZE);

    // Newest first (the times are read as one clock, so their order is what matters).
    const times = rows.map((row) => splitLogTime(row.time).epochAs(0));
    for (let i = 1; i < times.length; i++) expect(times[i - 1], `row ${i} is not newer than row ${i - 1}`).toBeGreaterThanOrEqual(times[i]);

    // "แสดง1-30 รายการ จาก N รายการ"
    const counter = await log.counter();
    expect(counter, 'the counter line is shown').not.toBeNull();
    expect(counter?.from).toBe(1);
    expect(counter?.to).toBe(rows.length);
    expect(counter?.total).toBeGreaterThanOrEqual(rows.length);
    for (const row of rows) expect(row.ip, `IP of the row at ${row.time}`).toMatch(/^\d{1,3}(\.\d{1,3}){3}$/);

    test.info().annotations.push({
      type: 'note',
      description: 'Times are printed as DD/MM/YYYY (Gregorian year) HH:mm:ss — unlike the Thai พ.ศ. style of other pages. The time zone (UTC, not Asia/Bangkok) is checked by TC-ADML-03-05.',
    });
  });

  test('TC-ADML-01-02 [Medium] กรองตามผู้ใช้งาน', async ({ activityLogPage: log }) => {
    test.setTimeout(150_000);
    await log.open();
    const unfiltered = (await log.counter())?.total ?? 0;
    const offered = [...new Set((await log.userOptions()).filter((label) => label !== ALL))];
    expect(offered, 'the picker offers the admin').toContain(ADMIN_NAME);
    // Dev has 100+ (mostly test) accounts: check the admin and up to 4 other distinct plain names, not every one —
    // names made of markup / quote payloads (left by the security tests) cannot be picked by their text.
    // (Names with doubled / edge spaces, left by the trim tests, cannot be matched exactly either.)
    const plain = (label: string): boolean => !/[<>'"]/.test(label) && label === label.replace(/\s+/g, ' ').trim();
    const users = [ADMIN_NAME, ...offered.filter((label) => label !== ADMIN_NAME && plain(label)).slice(0, 4)];
    test.info().annotations.push({ type: 'note', description: `${offered.length} distinct names offered; checked: ${users.join(' | ')}` });

    const problems: string[] = [];
    let sum = 0;
    for (const user of users) {
      await log.open();
      await log.selectUser(user);
      await log.applyFilter();
      expect(await log.selectedUser(), 'the picker keeps the chosen user').toBe(user);

      const rows = await log.readRows();
      const total = (await log.counter())?.total ?? 0;
      sum += total;
      for (const row of rows) if (row.user !== user) problems.push(`filter "${user}" still shows a row of "${row.user}" (${row.time})`);
      if (total < LOG_PAGE_SIZE && rows.length !== total) problems.push(`filter "${user}": ${rows.length} rows shown but the counter says ${total}`);
      if (total === 0) await expect(log.emptyMessage).toBeVisible();
    }
    expect(sum, 'the users\' rows can not outnumber the whole log').toBeLessThanOrEqual(unfiltered);
    expect(problems, 'filtering by user shows only that user\'s rows, counted correctly').toEqual([]);
  });

  test('TC-ADML-01-03 [Medium] กรองตามการกระทำ', async ({ activityLogPage: log }) => {
    await log.open();
    const unfiltered = (await log.counter())?.total ?? 0;
    const actions = (await log.actionOptions()).filter((label) => label !== ALL);
    expect(actions, 'the picker offers login and logout').toEqual(expect.arrayContaining(['login', 'logout']));

    const problems: string[] = [];
    let sum = 0;
    for (const action of actions) {
      await log.open();
      await log.selectAction(action);
      await log.applyFilter();
      expect(await log.selectedAction()).toBe(action);
      const rows = await log.readRows();
      sum += (await log.counter())?.total ?? 0;
      for (const row of rows) if (row.action !== action) problems.push(`filter "${action}" still shows a "${row.action}" row (${row.time})`);
    }
    // "ตัวเลือกครอบคลุมทุกประเภทที่ระบบบันทึก": every row has one of the offered actions, so the totals add up to the whole log.
    expect(sum, `the offered actions (${actions.join(', ')}) must cover every recorded action`).toBe(unfiltered);
    expect(problems, 'filtering by action shows only that action').toEqual([]);
    test.info().annotations.push({ type: 'note', description: `Actions offered: ${actions.join(', ')} (the sheet noted only login/logout on 21/09; create/update/delete are offered now).` });
  });

  test('TC-ADML-01-04 [Medium] กรองตามช่วงวันที่', async ({ activityLogPage: log }) => {
    // A valid range: the newest day that has rows (the sheet's 18/09/2026 has none on Dev).
    await log.open();
    const newestDay = splitLogTime((await log.readRows())[0].time);
    await log.fromInput.fill(newestDay.iso);
    await log.toInput.fill(newestDay.iso);
    await log.applyFilter();
    const dayRows = await log.readRows();
    expect(dayRows.length, `rows exist on ${newestDay.date}`).toBeGreaterThan(0);
    for (const row of dayRows) expect(splitLogTime(row.time).date, `row ${row.time} is outside ${newestDay.date}`).toBe(newestDay.date);

    // A range with no rows: the empty state, not an error.
    await log.open();
    await log.fromInput.fill('2020-01-01');
    await log.toInput.fill('2020-01-02');
    await log.applyFilter();
    await expect(log.emptyMessage).toBeVisible();
    expect(await log.counter()).toEqual({ from: 0, to: 0, total: 0 });

    // From after To: no error and nothing listed.
    await log.open();
    await log.fromInput.fill(newestDay.iso);
    await log.toInput.fill(dayBefore(newestDay.iso));
    const response = await log.applyFilter();
    expect(response.status(), 'an inverted range must not be a server error').toBeLessThan(500);
    expect(await log.readRows(), 'an inverted range lists nothing').toEqual([]);
    test.info().annotations.push({ type: 'note', description: 'An inverted range shows the plain "ไม่พบประวัติการใช้งาน" state; no separate validation message.' });
  });

  test("TC-ADML-01-05 [Low] ปุ่ม 'ล้าง' คืนค่าตัวกรอง", async ({ page, activityLogPage: log }) => {
    await log.open();
    const unfiltered = (await log.counter())?.total ?? 0;
    const day = splitLogTime((await log.readRows())[0].time).iso;

    await log.selectUser(ADMIN_NAME);
    await log.selectAction('login');
    await log.fromInput.fill(day);
    await log.toInput.fill(day);
    await log.applyFilter();
    expect((await log.counter())?.total ?? 0, 'the filter narrowed the list').toBeLessThan(unfiltered);

    await log.clear();
    expect(new URL(page.url()).search, 'no filter left in the URL').toBe('');
    expect(await log.selectedUser()).toBe(ALL);
    expect(await log.selectedAction()).toBe(ALL);
    await expect(log.fromInput).toHaveValue('');
    await expect(log.toInput).toHaveValue('');
    expect((await log.counter())?.total, 'the full list is back').toBe(unfiltered);
  });
});

test.describe('SC-ADML-03 ประวัติการใช้งาน: ตัวกรองและการแบ่งหน้า', () => {
  test('TC-ADML-03-01 [Medium] ใช้ตัวกรองหลายเงื่อนไขพร้อมกัน', async ({ activityLogPage: log }) => {
    await log.open();
    const day = splitLogTime((await log.readRows())[0].time);

    // Each condition alone, then all three together (AND).
    const alone = {
      user: await log.total('?user_id=1'),
      action: await log.total('?action=login'),
      day: await log.total(`?from=${day.iso}&to=${day.iso}`),
    };
    await log.open();
    await log.selectUser(ADMIN_NAME);
    await log.selectAction('login');
    await log.fromInput.fill(day.iso);
    await log.toInput.fill(day.iso);
    await log.applyFilter();

    const rows = await log.readRows();
    const total = (await log.counter())?.total ?? 0;
    expect(total, 'admin logins on that day exist').toBeGreaterThan(0);
    for (const row of rows) {
      expect({ user: row.user, action: row.action, date: splitLogTime(row.time).date }, `row ${row.time} breaks a condition`).toEqual({ user: ADMIN_NAME, action: 'login', date: day.date });
    }
    expect(total, 'AND is never wider than one condition').toBeLessThanOrEqual(Math.min(alone.user, alone.action, alone.day));
  });

  test('TC-ADML-03-02 [Medium] ขอบเขตวันที่รวมทั้งวัน', async ({ activityLogPage: log }) => {
    // The OLDEST day in the log: its rows never change, so a count taken by walking the unfiltered log stays valid.
    await log.open();
    const total = (await log.counter())?.total ?? 0;
    const lastPage = Math.max(1, Math.ceil(total / LOG_PAGE_SIZE));
    await log.open(`?page=${lastPage}`);
    const lastRows = await log.readRows();
    const oldest = splitLogTime(lastRows[lastRows.length - 1].time);

    const onThatDay: LogRow[] = [];
    for (let pageNo = lastPage; pageNo >= 1; pageNo--) {
      if (pageNo !== lastPage) await log.open(`?page=${pageNo}`);
      const rows = await log.readRows();
      const same = rows.filter((row) => splitLogTime(row.time).date === oldest.date);
      onThatDay.push(...same);
      if (same.length < rows.length) break; // a newer day begins on this page
    }

    expect(await log.total(`?from=${oldest.iso}&to=${oldest.iso}`), `the from=to=${oldest.date} filter keeps every row of that day`).toBe(onThatDay.length);
    const latest = onThatDay.map((row) => splitLogTime(row.time)).sort((a, b) => b.hour * 3600 + b.minute * 60 + b.second - (a.hour * 3600 + a.minute * 60 + a.second))[0];
    test.info().annotations.push({
      type: 'note',
      description: `${oldest.date}: ${onThatDay.length} rows, the latest at ${String(latest.hour).padStart(2, '0')}:${String(latest.minute).padStart(2, '0')}:${String(latest.second).padStart(2, '0')} (all included). No row near 23:59 exists on Dev to prove the very end of the day.`,
    });
  });

  test('TC-ADML-03-03 [Low] ตั้งวันที่ผิดรูปแบบหรือกลับด้าน', async ({ request, activityLogPage: log }) => {
    // KNOWN BUG — confirmed 2026-09-25 (DEF-31): an inverted range is handled (empty result), but a "from"/"to"
    // that is not a date at all ("abc", "2026-13-45", "'") answers HTTP 500 "Server Error" instead of a validation
    // message. The form's date boxes can't send such values; a hand-edited URL can.
    test.fail(true, 'Known bug (DEF-31): /admin/activity-log?from=<not a date> or ?to=<not a date> answers HTTP 500.');

    const problems: string[] = [];
    await log.open();
    const day = splitLogTime((await log.readRows())[0].time).iso;
    await log.fromInput.fill(day);
    await log.toInput.fill(dayBefore(day));
    const inverted = await log.applyFilter();
    if (inverted.status() >= 500) problems.push(`inverted range (from ${day} to ${dayBefore(day)}) → HTTP ${inverted.status()}`);

    for (const query of ['?from=abc', '?to=abc', '?from=2026-13-45', "?from='"]) {
      const response = await request.get(`/admin/activity-log${query}`);
      if (response.status() >= 500) problems.push(`${query} → HTTP ${response.status()}`);
    }
    expect(problems, 'a bad date must give a validation message, never HTTP 500').toEqual([]);
  });

  test('TC-ADML-03-05 [Medium] เวลาที่แสดงตรงกับเขตเวลาจริง', async ({ browser, activityLogPage: log }) => {
    // KNOWN BUG — confirmed 2026-09-25: the log prints its times in UTC. A login at 23:11:03 Bangkok time appears as
    // 16:11:03 — seven hours behind Asia/Bangkok, which the sheet expects. (New finding, see Notion Findings.)
    test.fail(true, 'Known bug (DEF-32): the activity log shows UTC times, 7 hours behind Asia/Bangkok.');

    test.setTimeout(90_000);
    const started = Date.now();
    const { context } = await loginAs(browser, env.adminUser, env.adminPass); // the app logs this login
    await context.close();

    await log.open('?action=login');
    const newest = (await log.readRows())[0];
    expect(newest.user, 'the newest login row is the one just made').toBe(ADMIN_NAME);
    const printed = splitLogTime(newest.time);
    const asBangkok = printed.epochAs(7);
    const asUtc = printed.epochAs(0);

    const offsetHours = Math.round(((Date.now() - asBangkok) / 3_600_000) * 10) / 10;
    test.info().annotations.push({
      type: 'note',
      description: `Printed ${newest.time}; taken as UTC it is ${Math.round(Math.abs(asUtc - started) / 1000)} s from the real login, taken as Asia/Bangkok it is ${offsetHours} h behind now.`,
    });
    expect(Math.abs(asBangkok - Date.now()), 'log time vs the real Asia/Bangkok time (ms)').toBeLessThan(60_000);
  });
});

test.describe('SC-ADML-04 ประวัติการใช้งาน: ความครบถ้วนและความคงทน', () => {
  test('TC-ADML-04-02 [High] ยิงคำสั่งแก้ไข/ลบบันทึกต้องถูกปฏิเสธ', async ({ request, activityLogPage: log }) => {
    // Sent WITHOUT a CSRF token on purpose: if a route did exist, the token check would still stop the request, so
    // this can never damage the log. A route that exists at all answers 419 — flagged below.
    const before = await log.total();
    const problems: string[] = [];
    const seen: string[] = [];
    for (const path of ['/admin/activity-log', '/admin/activity-log/1']) {
      for (const method of ['PUT', 'PATCH', 'DELETE', 'POST']) {
        const response = await request.fetch(path, { method, maxRedirects: 0 });
        seen.push(`${method} ${path} → ${response.status()}`);
        if (![403, 404, 405].includes(response.status())) problems.push(`${method} ${path} → HTTP ${response.status()} (expected 404/405/403; 419 would mean a route exists)`);
      }
    }
    const after = await log.total();
    test.info().annotations.push({ type: 'note', description: seen.join(' | ') });
    expect(after, 'no log record disappeared (the log only grows)').toBeGreaterThanOrEqual(before);
    expect(problems, 'the log can not be edited or deleted through any verb').toEqual([]);
  });
});
