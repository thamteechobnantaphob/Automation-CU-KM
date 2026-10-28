import { test, expect } from '@fixtures/pages.fixtures';
import { Page } from '@playwright/test';
import { DashboardPage } from '@pages/DashboardPage';
import { ensureCommunity, describeSeed } from '@utils/seedContent';

/**
 * KM-ADMD — the admin dashboard, /admin/dashboard/index (read-only; nothing here creates or changes data).
 *
 * The filter row (CoPs picker, period picker, the two date inputs) feeds "ออกรายงาน": since the 2026-10-01 deploy it
 * submits #report-form (GET /admin/dashboard/report) into a new tab — a print-preview report whose header states the
 * range used ("ประจำช่วงวันที่ 1 กันยายน 2569 ถึง 21 กันยายน 2569", "... , 21 วัน"). The dashboard itself does not
 * redraw. (Until 2026-09-26 the whole row did nothing: DEF-33, now fixed.) The filter cases therefore open the report
 * and read the range from it.
 *
 * Re-checked 2026-10-02: the dashboard refuses a start after the end (the date inputs become invalid), but a future
 * end is kept as is (not cut at today) and the server does not validate the range itself — impossible dates sent to
 * it roll over to other dates (2026-13-45 becomes 14 Feb 2027). Those two cases are expected failures (DEF-50).
 */

const RANGE_NOT_VALIDATED =
  'Known bug (DEF-50): the report range is not validated on the server — a future end date is accepted as is and impossible dates roll over to other dates.';

const THAI_MONTHS_LONG = ['มกราคม', 'กุมภาพันธ์', 'มีนาคม', 'เมษายน', 'พฤษภาคม', 'มิถุนายน', 'กรกฎาคม', 'สิงหาคม', 'กันยายน', 'ตุลาคม', 'พฤศจิกายน', 'ธันวาคม'];

/** "2026-09-01" -> "1 กันยายน 2569" (the report's date style). */
function thaiLong(iso: string): string {
  const [year, month, day] = iso.split('-').map(Number);
  return `${day} ${THAI_MONTHS_LONG[month - 1]} ${year + 543}`;
}

/** Today in Asia/Bangkok as "YYYY-MM-DD". */
function todayIso(): string {
  return new Date(Date.now() + 7 * 3_600_000).toISOString().slice(0, 10);
}

/** The report header: { range: "1 กันยายน 2569 ถึง 21 กันยายน 2569", days: 21 } (empty when the page is not a report). */
async function reportRange(report: Page): Promise<{ range: string; days: number | null; text: string }> {
  const text = (await report.locator('body').innerText()).replace(/\s+/g, ' ');
  const range = /ประจำช่วงวันที่ (.+?) ช่วงเวลาของรายงาน/.exec(text)?.[1].trim() ?? '';
  const days = /,\s*([\d,]+) วัน\)/.exec(text)?.[1];
  return { range, days: days ? Number(days.replace(/,/g, '')) : null, text };
}

/** Sets a custom range on the dashboard and opens the report; closes the tab after reading it. */
async function customReport(dashboardPage: DashboardPage, from: string, to: string): Promise<{ range: string; days: number | null; text: string }> {
  await dashboardPage.choosePeriod('กำหนดเอง');
  await dashboardPage.setDates(from, to);
  const report = await dashboardPage.openReport();
  try {
    return await reportRange(report);
  } finally {
    await report.close();
  }
}

// Test data as in the sheet's workflow (admin creates it, the case checks it) — see src/utils/seedContent.ts.
let seedNote = '';
test.beforeAll(async ({ browser }) => {
  test.setTimeout(120_000);
  seedNote = describeSeed(await ensureCommunity(browser));
});
test.beforeEach(() => {
  test.info().annotations.push({ type: 'note', description: `Test data: ${seedNote}` });
});


/** Server errors and script errors seen while `body` runs. */
async function collectProblems(page: Page, body: () => Promise<void>): Promise<string[]> {
  const problems: string[] = [];
  const onResponse = (response: { status(): number; url(): string }): void => {
    if (response.status() >= 500) problems.push(`HTTP ${response.status()} ${response.url()}`);
  };
  const onError = (error: Error): void => {
    problems.push(`script error: ${error.message}`);
  };
  page.on('response', onResponse);
  page.on('pageerror', onError);
  try {
    await body();
  } finally {
    page.off('response', onResponse);
    page.off('pageerror', onError);
  }
  return problems;
}

const NUMBER = (text: string): number => Number(text.replace(/,/g, ''));

test.describe('SC-ADMD-02 ตัวกรองข้อมูล', () => {
  test('TC-ADMD-02-03 [Medium] กรองแบบกำหนดเอง (วันที่เริ่ม-ถึง)', async ({ dashboardPage, page }) => {
    await dashboardPage.open();

    // A valid range: the report covers exactly those days.
    const valid = await customReport(dashboardPage, '2026-09-01', '2026-09-21');
    expect(valid.range, 'the report covers 01/09/2026 – 21/09/2026').toBe(`${thaiLong('2026-09-01')} ถึง ${thaiLong('2026-09-21')}`);
    expect(valid.days).toBe(21);

    // A start after the end must be refused with a validation message, not turned into a report.
    const problems = await collectProblems(page, async () => {
      await dashboardPage.setDates('2026-09-21', '2026-09-01');
    });
    expect(problems).toEqual([]);
    const blockedHere =
      (await dashboardPage.reportButton.isDisabled()) ||
      (await page.locator('.invalid-feedback:visible, .alert-danger:visible, [role="alert"]:visible').count()) > 0 ||
      (await dashboardPage.fromDate.evaluate((el) => !(el as HTMLInputElement).validity.valid));
    let reversed = '';
    if (!blockedHere) {
      const report = await dashboardPage.openReport();
      reversed = (await reportRange(report)).range;
      await report.close();
    }
    test.info().annotations.push({ type: 'note', description: `Start 21/09 > end 01/09: ${blockedHere ? 'refused on the dashboard' : `report made for "${reversed}"`}` });
    expect(blockedHere || reversed === '', 'a start date after the end date is refused with a validation message').toBe(true);
  });
});

test.describe('SC-ADMD-03 กราฟและตาราง', () => {
  test("TC-ADMD-03-02 [Medium] สลับแท็บ 'เนื้อหายอดนิยม'", async ({ dashboardPage, page }) => {
    await dashboardPage.open();

    const tabs = [
      { tab: 'เข้าชมมากที่สุด', pane: 'pills-view', headers: ['ลำดับ', 'ชื่อบทความ', 'หมวดหมู่', 'วันที่เผยแพร่', 'ยอดเข้าชม', 'จัดการ'], metric: 'ยอดเข้าชม' },
      { tab: 'หมวดหมู่ยอดนิยม', pane: 'pills-popular', headers: ['ลำดับ', 'เนื้อหา', 'ยอดเข้าชม'], metric: 'ยอดเข้าชม' },
      { tab: 'ดาวน์โหลดมากที่สุด', pane: 'pills-download', headers: ['ลำดับ', 'รายการ', 'ยอดดาวน์โหลด'], metric: 'ยอดดาวน์โหลด' },
    ];
    const seen: string[] = [];

    for (const { tab, pane: paneId, headers, metric } of tabs) {
      const pane = await dashboardPage.openTab(tab);
      await expect(dashboardPage.tab(tab), `"${tab}" is the selected tab`).toHaveAttribute('aria-selected', 'true');
      await expect(pane, `the "${tab}" table is shown`).toBeVisible();
      for (const other of tabs.filter((t) => t.pane !== paneId)) {
        await expect(page.locator(`#${other.pane}`), `the "${other.tab}" table is hidden while "${tab}" is open`).toBeHidden();
      }

      const table = await dashboardPage.readTable(pane);
      expect(table.headers, `"${tab}" has its own columns`).toEqual(headers);

      const empty = table.rows.length === 1 && table.rows[0].length === 1;
      if (empty) {
        expect(table.rows[0][0]).toBe('ยังไม่มีข้อมูล');
        seen.push(`${tab}: ยังไม่มีข้อมูล`);
        continue;
      }
      // Order column counts 1, 2, 3 … and the metric never increases down the list.
      const order = table.rows.map((row) => row[0]);
      expect(order, `"${tab}" is numbered from 1`).toEqual(table.rows.map((_, index) => `${index + 1}.`));
      const metricIndex = headers.indexOf(metric);
      const values = table.rows.map((row) => NUMBER(row[metricIndex]));
      expect(values.every((value) => Number.isFinite(value)), `"${metric}" values are numbers (${values.join(', ')})`).toBe(true);
      expect(values, `"${tab}" is sorted from most to least`).toEqual([...values].sort((a, b) => b - a));
      seen.push(`${tab}: ${table.rows.length} rows (${metric} ${values.join(', ')})`);
    }
    test.info().annotations.push({ type: 'note', description: seen.join(' | ') });
  });

  test("TC-ADMD-03-03 [Low] แท็บ 'ภาพรวม' และ 'แนวโน้ม' ในสถิติเนื้อหา CoPs", async ({ dashboardPage, page }) => {
    const errors: string[] = [];
    page.on('pageerror', (error) => errors.push(error.message));
    await dashboardPage.open();

    const overview = await dashboardPage.openTab('ภาพรวม');
    const table = await dashboardPage.readTable(overview);
    expect(table.headers).toEqual(['ลำดับ', 'รายการ', 'จำนวนเนื้อหา']);
    const communities = await dashboardPage.copsOptions();
    expect(communities.length, 'the CoPs picker lists communities').toBeGreaterThan(0);
    expect(
      table.rows.map((row) => row[1]).sort(),
      'one row per community, the same communities the CoPs picker offers',
    ).toEqual([...communities].sort());
    for (const row of table.rows) expect(NUMBER(row[2]), `content count of "${row[1]}" is a number`).toBeGreaterThanOrEqual(0);

    const trend = await dashboardPage.openTab('แนวโน้ม');
    await expect(trend.getByRole('heading', { name: 'แนวโน้ม CoPs' })).toBeVisible();
    await expect(dashboardPage.trendChart, 'the trend chart is drawn').toBeVisible();
    const size = await dashboardPage.trendChart.evaluate((canvas) => ({ width: (canvas as HTMLCanvasElement).clientWidth, height: (canvas as HTMLCanvasElement).clientHeight }));
    expect(size.width, 'the trend chart has a size').toBeGreaterThan(0);
    expect(size.height).toBeGreaterThan(0);
    const points = (await dashboardPage.readContent()).trendChart;
    expect(points, 'the trend chart has its data').not.toBe('no chart');
    await expect(trend, 'no error text in the trend tab').not.toContainText(/error|undefined|NaN/i);
    expect(errors, 'no script errors while switching tabs').toEqual([]);
    test.info().annotations.push({ type: 'note', description: `Trend data: ${points}` });
  });
});

test.describe('SC-ADMD-04 ตัวกรองและช่วงวันที่: ค่าขอบเขต', () => {
  test('TC-ADMD-04-02 [Medium] กำหนดเอง: วันเริ่มเท่ากับวันสิ้นสุด (วันเดียว)', async ({ dashboardPage }) => {
    await dashboardPage.open();
    const report = await customReport(dashboardPage, '2026-09-18', '2026-09-18');
    expect(report.range, 'the report covers 18/09/2026 only').toBe(`${thaiLong('2026-09-18')} ถึง ${thaiLong('2026-09-18')}`);
    expect(report.days, 'one whole day').toBe(1);
  });

  test('TC-ADMD-04-03 [Low] กำหนดเอง: วันสิ้นสุดเป็นวันในอนาคต', async ({ dashboardPage, page }) => {
    test.fail(true, RANGE_NOT_VALIDATED);
    await dashboardPage.open();

    let report = { range: '', days: null as number | null, text: '' };
    const problems = await collectProblems(page, async () => {
      report = await customReport(dashboardPage, '2026-09-01', '2030-12-31');
    });
    expect(problems, 'a future end date never causes an error').toEqual([]);
    test.info().annotations.push({ type: 'note', description: `End 31/12/2030 -> report "${report.range}" (${report.days} days)` });
    // Expected: refused with a message, or calculated only up to today.
    const cutAtToday = report.range === `${thaiLong('2026-09-01')} ถึง ${thaiLong(todayIso())}`;
    expect(report.range === '' || cutAtToday, 'a future end date is refused or the report stops at today').toBe(true);
  });

  test('TC-ADMD-04-04 [Medium] กำหนดเอง: วันที่ไม่มีอยู่จริง (ป้อนผ่านสคริปต์)', async ({ dashboardPage, page, request }) => {
    test.fail(true, RANGE_NOT_VALIDATED);
    await dashboardPage.open();
    await dashboardPage.choosePeriod('กำหนดเอง');

    // In the page: the browser empties an impossible value set by script, so the form cannot send it.
    for (const input of [dashboardPage.fromDate, dashboardPage.toDate]) {
      for (const impossible of ['2027-02-29', '2026-13-45']) {
        await input.evaluate((el, value) => {
          (el as HTMLInputElement).value = value;
          el.dispatchEvent(new Event('input', { bubbles: true }));
          el.dispatchEvent(new Event('change', { bubbles: true }));
        }, impossible);
        await expect(input, `${impossible} cannot stay in a date input`).toHaveValue('');
      }
    }

    // On the server (what the sheet asks for): the same values sent directly must be refused, never a 500.
    const response = await request.get('/admin/dashboard/report?period=custom&date_from=2027-02-29&date_to=2026-13-45');
    expect(response.status(), 'impossible dates never cause a server error').toBeLessThan(500);
    const text = (await response.text()).replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ');
    const range = /ประจำช่วงวันที่ (.+?) ช่วงเวลาของรายงาน/.exec(text)?.[1].trim() ?? '';
    test.info().annotations.push({ type: 'note', description: `GET date_from=2027-02-29&date_to=2026-13-45 -> HTTP ${response.status()}, report range "${range}"` });
    expect(range, 'impossible dates are refused with validation, not turned into a report for other dates').toBe('');
  });

  test('TC-ADMD-04-05 [Low] กำหนดเอง: วันที่ปีอธิกสุรทิน 29/02/2028', async ({ dashboardPage }) => {
    await dashboardPage.open();
    const report = await customReport(dashboardPage, '2028-02-29', '2028-03-01');
    expect(report.range, 'the leap day is accepted').toBe(`${thaiLong('2028-02-29')} ถึง ${thaiLong('2028-03-01')}`);
    expect(report.days, '29/02 and 01/03 = 2 days').toBe(2);
  });

  test('TC-ADMD-04-07 [Medium] ช่วงที่ไม่มีข้อมูล', async ({ dashboardPage }) => {
    await dashboardPage.open();
    const report = await customReport(dashboardPage, '2020-01-01', '2020-01-02');
    expect(report.range).toBe(`${thaiLong('2020-01-01')} ถึง ${thaiLong('2020-01-02')}`);
    expect(report.text, 'zero visits read as 0').toMatch(/ผู้เข้าชมเว็บไซต์ 0 ครั้ง/);
    expect(report.text, 'no NaN / undefined anywhere in the report').not.toMatch(/NaN|undefined/);
  });

  test('TC-ADMD-04-08 [Low] ตัวกรองคงอยู่เมื่อรีเฟรชหรือกลับมาหน้าเดิม', async ({ dashboardPage, page }) => {
    await dashboardPage.open();
    const untouched = await dashboardPage.readContent();

    // The filter lives in the report URL: refreshing the report keeps exactly the same range.
    await dashboardPage.choosePeriod('เดือนนี้');
    const report = await dashboardPage.openReport();
    const first = await reportRange(report);
    await report.reload();
    const again = await reportRange(report);
    await report.close();
    expect(first.range, 'the report shows a range').not.toBe('');
    expect(again.range, 'F5 on the report keeps the same range').toBe(first.range);

    // The dashboard itself never filters, so after F5 / Back / Forward what it shows still matches its (unfiltered) state.
    const problems = await collectProblems(page, async () => {
      await page.reload();
      await dashboardPage.heading.waitFor({ state: 'visible' });
      await page.goBack().catch(() => undefined);
      await page.goForward().catch(() => undefined);
    });
    expect(problems).toEqual([]);
    expect(await dashboardPage.readContent(), 'the dashboard shows the same unfiltered data after F5').toEqual(untouched);
  });
});

test.describe('SC-ADMD-05 ตัวเลข ตาราง และการออกรายงาน', () => {
  test('TC-ADMD-05-01 [Low] รูปแบบตัวเลขมีตัวคั่นหลักพันสอดคล้องกัน', async ({ dashboardPage, page }) => {
    await dashboardPage.open();

    // Every counter, and every count column of every table (also those on tabs that are not shown).
    const numbers: string[] = (await dashboardPage.readStats()).map((stat) => stat.value);
    const metricHeaders = ['ยอดเข้าชม', 'ยอดดาวน์โหลด', 'จำนวนเนื้อหา'];
    const cells = await page.locator('table').evaluateAll((tables, headers) => {
      const out: string[] = [];
      for (const table of tables) {
        const heads = [...table.querySelectorAll('thead th')].map((th) => (th.textContent ?? '').replace(/\s+/g, ' ').trim());
        heads.forEach((head, column) => {
          if (!headers.includes(head)) return;
          for (const row of table.querySelectorAll('tbody tr')) {
            const cell = row.querySelectorAll('td')[column];
            if (cell && row.querySelectorAll('td').length > 1) out.push((cell.textContent ?? '').replace(/\s+/g, ' ').trim());
          }
        });
      }
      return out;
    }, metricHeaders);
    numbers.push(...cells);
    expect(numbers.length, 'the dashboard shows numbers to check').toBeGreaterThan(0);

    // One style: digits with "," between thousands (8,000 — never 8000, 8 000, 8.000).
    const inconsistent = numbers.filter((text) => !/^\d{1,3}(,\d{3})*$/.test(text));
    expect(inconsistent, 'every number uses the same thousands-separator format').toEqual([]);

    const bodyText = await page.locator('body').innerText();
    expect(bodyText, 'no NaN / undefined / null in place of a number').not.toMatch(/\bNaN\b|\bundefined\b|\bnull\b|\bInfinity\b/);

    const largest = Math.max(...numbers.map(NUMBER));
    test.info().annotations.push({
      type: 'note',
      description: `${numbers.length} numbers checked (${numbers.join(', ')}). The largest is ${largest}: ${largest >= 1000 ? 'the separator is exercised' : 'no value reaches 1,000 on Dev, so the separator itself could not be seen in use'}.`,
    });
  });

  test('TC-ADMD-05-08 [Low] แดชบอร์ดแสดงผลได้ที่ความกว้าง 768px และ 375px', async ({ dashboardPage, page }) => {
    const notes: string[] = [];

    for (const [width, height] of [[768, 1024], [375, 800]] as const) {
      await page.setViewportSize({ width, height });
      await dashboardPage.open();
      await page.waitForLoadState('networkidle');

      const layout = await page.evaluate(() => {
        const viewport = window.innerWidth;
        const scrollParent = (element: Element): Element | null => {
          for (let parent = element.parentElement; parent; parent = parent.parentElement) {
            const overflow = getComputedStyle(parent).overflowX;
            if (overflow === 'auto' || overflow === 'scroll') return parent;
          }
          return null;
        };
        const visible = (element: Element): boolean => !!((element as HTMLElement).offsetWidth || (element as HTMLElement).offsetHeight);
        const cards = [...document.querySelectorAll('.stat-card')].map((card) => card.getBoundingClientRect());
        return {
          viewport,
          pageWidth: document.documentElement.scrollWidth,
          cardRights: cards.map((box) => Math.round(box.right)),
          cardRows: new Set(cards.map((box) => Math.round(box.top))).size,
          canvasRights: [...document.querySelectorAll('canvas')].filter(visible).map((canvas) => Math.round(canvas.getBoundingClientRect().right)),
          tables: [...document.querySelectorAll('table')].filter(visible).map((table) => {
            const box = table.getBoundingClientRect();
            const holder = scrollParent(table);
            return { wide: box.width > viewport, scrolls: !!holder, holderRight: holder ? Math.round(holder.getBoundingClientRect().right) : null, right: Math.round(box.right) };
          }),
          overflowing: [...document.querySelectorAll('body *')]
            .filter((element) => visible(element) && element.getBoundingClientRect().right > viewport + 1 && !scrollParent(element))
            .slice(0, 5)
            .map((element) => `${element.tagName}.${String((element as HTMLElement).className).slice(0, 30)}`),
          sidebarRight: Math.round(document.getElementById('sidebar')?.getBoundingClientRect().right ?? 0),
          firstCardLeft: Math.round(cards[0]?.left ?? 0),
        };
      });

      const at = `at ${width}px`;
      expect(layout.pageWidth, `the page does not scroll sideways ${at}`).toBeLessThanOrEqual(layout.viewport);
      expect(layout.overflowing, `no element sticks out of the screen ${at}`).toEqual([]);
      for (const right of [...layout.cardRights, ...layout.canvasRights]) expect(right, `cards and charts stay inside the screen ${at}`).toBeLessThanOrEqual(layout.viewport + 1);
      if (width <= 375) expect(layout.cardRows, `the four cards do not stay in one row ${at}`).toBeGreaterThan(1);
      for (const table of layout.tables) {
        if (table.wide) {
          expect(table.scrolls, `a table wider than the screen scrolls inside its frame ${at}`).toBe(true);
          expect(table.holderRight ?? 0, `the scrolling frame fits the screen ${at}`).toBeLessThanOrEqual(layout.viewport + 1);
        }
      }
      notes.push(
        `${width}px: cards in ${layout.cardRows} row(s), ${layout.tables.length} table(s) scroll inside their frame` +
          (layout.sidebarRight > layout.firstCardLeft ? `; NOTE the open sidebar (${layout.sidebarRight}px wide edge) overlaps the content that starts at ${layout.firstCardLeft}px` : ''),
      );
    }
    test.info().annotations.push({ type: 'note', description: notes.join(' | ') });
  });
});
