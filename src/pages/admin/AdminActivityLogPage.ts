import { Locator, Page, Response } from '@playwright/test';
import { BasePage } from '../BasePage';

/** One line of the log as shown on screen. */
export interface LogRow {
  /** "25/09/2026 16:07:21" — DD/MM/YYYY (Gregorian) HH:mm:ss, exactly as the page prints it. */
  time: string;
  user: string;
  action: string;
  item: string;
  ip: string;
}

export const LOG_HEADERS = ['เวลา', 'ผู้ใช้งาน', 'การกระทำ', 'รายการ', 'IP'] as const;

/** The page shows 30 rows at a time. */
export const LOG_PAGE_SIZE = 30;

/** "25/09/2026 16:07:21" → its pieces (no time-zone is applied here). */
export function splitLogTime(text: string): { date: string; iso: string; hour: number; minute: number; second: number; epochAs: (utcOffsetHours: number) => number } {
  const match = /^(\d{2})\/(\d{2})\/(\d{4}) (\d{2}):(\d{2}):(\d{2})$/.exec(text.trim());
  if (!match) throw new Error(`Unexpected log time format: "${text}"`);
  const [, day, month, year, hour, minute, second] = match;
  return {
    date: `${day}/${month}/${year}`,
    iso: `${year}-${month}-${day}`,
    hour: Number(hour),
    minute: Number(minute),
    second: Number(second),
    /** The instant these digits denote when they are a wall clock at `utcOffsetHours` (7 = Asia/Bangkok, 0 = UTC). */
    epochAs: (utcOffsetHours: number) => Date.UTC(Number(year), Number(month) - 1, Number(day), Number(hour) - utcOffsetHours, Number(minute), Number(second)),
  };
}

/**
 * /admin/activity-log — "ประวัติการใช้งานระบบ". A GET form (user, action, from,
 * to; "กรอง" submits it, "ล้าง" is a link back to the bare page) above a table of
 * 30 rows per page, newest first, with "แสดง1-30 รายการ จาก N รายการ" as counter.
 * The user and action pickers are bootstrap-select dropdowns.
 */
export class AdminActivityLogPage extends BasePage {
  readonly heading: Locator;
  readonly form: Locator;
  readonly userToggle: Locator;
  readonly actionToggle: Locator;
  readonly fromInput: Locator;
  readonly toInput: Locator;
  readonly filterButton: Locator;
  readonly clearLink: Locator;
  readonly rows: Locator;
  readonly emptyMessage: Locator;

  constructor(page: Page) {
    super(page);
    this.heading = page.locator('.body-content h2').first();
    this.form = page.locator('form[action$="/admin/activity-log"]');
    this.userToggle = this.pickerOf('ผู้ใช้งาน');
    this.actionToggle = this.pickerOf('การกระทำ');
    this.fromInput = this.form.locator('input[name="from"]');
    this.toInput = this.form.locator('input[name="to"]');
    this.filterButton = this.form.getByRole('button', { name: 'กรอง' });
    this.clearLink = this.form.getByRole('link', { name: 'ล้าง' });
    this.rows = page.locator('table tbody tr');
    this.emptyMessage = page.getByText('ไม่พบประวัติการใช้งาน');
  }

  private pickerOf(label: string): Locator {
    return this.page.locator('.form-group', { has: this.page.locator('label', { hasText: label }) }).locator('button.dropdown-toggle');
  }

  /** Opens the log; `query` is appended as is ("?action=login"). */
  async open(query = ''): Promise<void> {
    await this.goto(`/admin/activity-log${query}`);
    await this.heading.waitFor({ state: 'visible' });
  }

  /** The rows on screen (the "ไม่พบประวัติการใช้งาน" line is one cell wide and is skipped). */
  async readRows(): Promise<LogRow[]> {
    return this.rows.evaluateAll((trs) =>
      trs
        .map((tr) => [...tr.querySelectorAll('td')].map((td) => (td.textContent ?? '').replace(/\s+/g, ' ').trim()))
        .filter((cells) => cells.length >= 5)
        .map(([time, user, action, item, ip]) => ({ time, user, action, item, ip })),
    );
  }

  /** "แสดง1-30 รายการ จาก 434 รายการ" → numbers (0/0/0 on an empty result). */
  async counter(): Promise<{ from: number; to: number; total: number } | null> {
    const match = /แสดง\s*(\d+)\s*-\s*(\d+)\s*รายการ\s*จาก\s*(\d+)\s*รายการ/.exec(await this.page.locator('body').innerText());
    return match ? { from: Number(match[1]), to: Number(match[2]), total: Number(match[3]) } : null;
  }

  async total(query = ''): Promise<number> {
    await this.open(query);
    return (await this.counter())?.total ?? 0;
  }

  /** What the two pickers currently show ("ทั้งหมด" when nothing is chosen). */
  async selectedUser(): Promise<string> {
    return (await this.userToggle.innerText()).trim();
  }

  async selectedAction(): Promise<string> {
    return (await this.actionToggle.innerText()).trim();
  }

  private async choose(toggle: Locator, label: string): Promise<void> {
    await toggle.click();
    // Several accounts can share a display name (test users do): the first matching option is enough.
    // Any run of spaces in the label matches any run of white space (names saved with doubled spaces).
    const pattern = new RegExp(`^\\s*${label.trim().split(/\s+/).map((word) => word.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('\\s+')}\\s*$`);
    await this.page.locator('.dropdown-menu.show a[role="option"]').filter({ hasText: pattern }).first().click();
  }

  async selectUser(label: string): Promise<void> {
    await this.choose(this.userToggle, label);
  }

  async selectAction(label: string): Promise<void> {
    await this.choose(this.actionToggle, label);
  }

  /** The choices a picker offers (opens and closes it). */
  private async optionsOf(toggle: Locator): Promise<string[]> {
    await toggle.click();
    const options = (await this.page.locator('.dropdown-menu.show a[role="option"]').allInnerTexts()).map((text) => text.trim());
    await toggle.click();
    return options;
  }

  userOptions(): Promise<string[]> {
    return this.optionsOf(this.userToggle);
  }

  actionOptions(): Promise<string[]> {
    return this.optionsOf(this.actionToggle);
  }

  /** Presses "กรอง", waits for the reloaded page and returns the response of that GET (its status can be a server error). */
  async applyFilter(): Promise<Response> {
    const [response] = await Promise.all([
      this.page.waitForResponse((r) => r.request().isNavigationRequest() && r.url().includes('/admin/activity-log')),
      this.filterButton.click(),
    ]);
    await this.page.waitForLoadState('load');
    return response;
  }

  /** Presses "ล้าง" and waits for the reloaded page. */
  async clear(): Promise<void> {
    await Promise.all([this.page.waitForLoadState('load'), this.clearLink.click()]);
    await this.heading.waitFor({ state: 'visible' });
  }
}
