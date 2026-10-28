import { Locator, Page } from '@playwright/test';
import { BasePage } from './BasePage';

/** One tab's table, as plain data (an "ยังไม่มีข้อมูล" line is a one-cell row). */
export interface DashboardTable {
  headers: string[];
  rows: string[][];
}

/** What the dashboard shows apart from the filter controls themselves: enough to tell whether a filter changed anything. */
export interface DashboardContent {
  stats: string;
  barChart: string;
  trendChart: string;
  tables: string;
  url: string;
}

/**
 * /admin/dashboard/index — four stat cards, a filter row (CoPs picker, period picker, two date inputs, "ออกรายงาน"),
 * the "ยอดผู้เข้าชม" bar chart, the "เนื้อหายอดนิยม" tabs and the "สถิติเนื้อหา CoPs" tabs (Chart.js canvases + tables).
 * Confirmed 2026-09-25 against Dev; the filter row is NOT wired to anything there (see TC-ADMD-* and DEF-33).
 */
export class DashboardPage extends BasePage {
  readonly heading: Locator;
  readonly userMenu: Locator;
  readonly logoutButton: Locator;

  readonly statCards: Locator;
  readonly copsPicker: Locator;
  readonly periodPicker: Locator;
  readonly fromDate: Locator;
  readonly toDate: Locator;
  readonly reportButton: Locator;
  readonly barChart: Locator;
  readonly trendChart: Locator;

  constructor(page: Page) {
    super(page);
    this.heading = page.getByRole('heading', { name: 'แดชบอร์ด' });
    this.userMenu = page.getByText('ผู้ดูแลระบบ').first();
    // The real screen has TWO "ออกจากระบบ" buttons at once: one inside the
    // user-menu dropdown (.dropdown-item) and a persistent one in #sidebar
    // (.sidebar-logout-btn). Scope to the dropdown one, since that's the one
    // userMenu.click() actually reveals (matches the test script: click the
    // user menu top-right, then click "ออกจากระบบ").
    this.logoutButton = page.locator('.dropdown-item', { hasText: 'ออกจากระบบ' });

    this.statCards = page.locator('.stat-card');
    this.copsPicker = page.locator('.bootstrap-select').nth(0);
    this.periodPicker = page.locator('.bootstrap-select').nth(1);
    this.fromDate = page.locator('input[type="date"]').nth(0);
    this.toDate = page.locator('input[type="date"]').nth(1);
    this.reportButton = page.locator('.body-content').getByRole('button', { name: 'ออกรายงาน' }).or(page.locator('a.btn', { hasText: 'ออกรายงาน' })).first();
    this.barChart = page.locator('#barchart');
    this.trendChart = page.locator('#trendchart');
  }

  async open(): Promise<void> {
    await this.goto('/admin/dashboard/index');
    await this.heading.waitFor({ state: 'visible' });
  }

  /** Logout is implemented as a POST form + CSRF token, not a plain GET link. */
  async logout(): Promise<void> {
    await this.userMenu.click();
    await this.logoutButton.click();
  }

  /** The four counters: [{ value: '15', label: 'ผู้เข้าชมทั้งหมด' }, ...]. */
  async readStats(): Promise<Array<{ value: string; label: string }>> {
    return this.statCards.evaluateAll((cards) =>
      cards.map((card) => ({
        value: (card.querySelector('.stat-number')?.textContent ?? '').trim(),
        label: (card.querySelector('.stat-label')?.textContent ?? '').trim(),
      })),
    );
  }

  tab(name: string): Locator {
    return this.page.getByRole('tab', { name, exact: true });
  }

  /** The pane a tab controls (its data-bs-target). */
  async paneOf(name: string): Promise<Locator> {
    const target = await this.tab(name).getAttribute('data-bs-target');
    if (!target) throw new Error(`Tab "${name}" has no data-bs-target`);
    return this.page.locator(target);
  }

  /** Clicks a tab and waits until its pane is the shown one. */
  async openTab(name: string): Promise<Locator> {
    await this.tab(name).click();
    const pane = await this.paneOf(name);
    await pane.and(this.page.locator('.show.active')).waitFor({ state: 'visible' });
    return pane;
  }

  /** The table inside a pane as plain data. */
  async readTable(pane: Locator): Promise<DashboardTable> {
    return pane.locator('table').evaluate((table) => {
      const clean = (text: string | null): string => (text ?? '').replace(/\s+/g, ' ').trim();
      return {
        headers: [...table.querySelectorAll('thead th')].map((th) => clean(th.textContent)),
        rows: [...table.querySelectorAll('tbody tr')].map((tr) => [...tr.querySelectorAll('td')].map((td) => clean(td.textContent))),
      };
    });
  }

  /** The CoPs the picker offers (read from the underlying <select>, without opening the menu). */
  async copsOptions(): Promise<string[]> {
    return this.copsPicker.locator('select option').evaluateAll((options) => options.map((option) => (option.textContent ?? '').trim()));
  }

  /** What the two pickers currently show. */
  async pickerLabels(): Promise<{ cops: string; period: string }> {
    return {
      cops: (await this.copsPicker.locator('button.dropdown-toggle').innerText()).trim(),
      period: (await this.periodPicker.locator('button.dropdown-toggle').innerText()).trim(),
    };
  }

  /** Both pickers are multi-selects: an option is toggled and the menu closed again. */
  private async choose(picker: Locator, label: string): Promise<void> {
    await picker.locator('button.dropdown-toggle').click();
    await picker.locator('a[role="option"]').filter({ hasText: label }).first().click();
    await this.page.keyboard.press('Escape');
  }

  async choosePeriod(label: string): Promise<void> {
    await this.choose(this.periodPicker, label);
  }

  async chooseCops(label: string): Promise<void> {
    await this.choose(this.copsPicker, label);
  }

  /** Types the two dates (ISO "YYYY-MM-DD", what an <input type=date> accepts). */
  /**
   * "ออกรายงาน" submits #report-form (GET /admin/dashboard/report, target=_blank): the report opens in a new tab as a
   * print preview. Returns that tab, loaded. (Since the 2026-10-01 deploy; before, the button did nothing — DEF-33.)
   */
  async openReport(): Promise<Page> {
    const [report] = await Promise.all([this.page.context().waitForEvent('page'), this.reportButton.click()]);
    await report.waitForLoadState('load');
    return report;
  }

  async setDates(from: string, to: string): Promise<void> {
    await this.fromDate.fill(from);
    await this.toDate.fill(to);
  }

  /** Everything the filter should be able to change (cards, both charts' data, table rows, URL) but not the controls. */
  async readContent(): Promise<DashboardContent> {
    return this.page.evaluate(() => {
      const chart = (id: string): string => {
        const instance = (window as unknown as { Chart?: { getChart(id: string): { data: { labels: unknown[]; datasets: Array<{ data: unknown[] }> } } | undefined } }).Chart?.getChart(id);
        return instance ? `${instance.data.labels.join('|')}=${instance.data.datasets.map((set) => set.data.join(',')).join(';')}` : 'no chart';
      };
      return {
        stats: [...document.querySelectorAll('.stat-number')].map((el) => (el.textContent ?? '').trim()).join('/'),
        barChart: chart('barchart'),
        trendChart: chart('trendchart'),
        tables: [...document.querySelectorAll('table tbody')].map((body) => (body.textContent ?? '').replace(/\s+/g, ' ').trim()).join(' # '),
        url: location.pathname + location.search,
      };
    });
  }

  /**
   * Runs `action` and reports whether the dashboard REACTED: a request other than static files, a download, a popup, a
   * report panel opening, or any change of the content (`readContent`). `settleMs` is how long it waits for a reaction.
   */
  async observe(action: () => Promise<void>, settleMs = 2_000): Promise<{ reacted: boolean; requests: string[]; changed: boolean; panelOpened: boolean }> {
    const requests: string[] = [];
    const isStatic = /\.(png|jpe?g|gif|svg|webp|css|js|map|woff2?|ttf|ico)(\?|$)/i;
    const onRequest = (request: { method(): string; url(): string }): void => {
      if (!isStatic.test(request.url())) requests.push(`${request.method()} ${new URL(request.url()).pathname}`);
    };
    const onEvent = (name: string) => (): void => {
      requests.push(name);
    };
    const onDownload = onEvent('download');
    const onPopup = onEvent('popup');
    this.page.on('request', onRequest);
    this.page.on('download', onDownload);
    this.page.on('popup', onPopup);
    try {
      const before = await this.readContent();
      await action();
      await this.page.waitForTimeout(settleMs);
      const after = await this.readContent().catch(() => before);
      const changed = JSON.stringify(before) !== JSON.stringify(after);
      const panelOpened = (await this.page.locator('.offcanvas.show, .modal.show').count()) > 0;
      return { reacted: requests.length > 0 || changed || panelOpened, requests, changed, panelOpened };
    } finally {
      this.page.off('request', onRequest);
      this.page.off('download', onDownload);
      this.page.off('popup', onPopup);
    }
  }
}
