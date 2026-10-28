import { Page } from '@playwright/test';

/**
 * Helpers for the system-wide non-functional cases (KM-NFR): links, dates,
 * spelling, layout overflow and simple statistics. Everything here only READS
 * what a page shows.
 */

/** Thai month abbreviations as the app prints them (the dot after the month is matched separately). */
const THAI_MONTHS = 'ม\\.ค|ก\\.พ|มี\\.ค|เม\\.ย|พ\\.ค|มิ\\.ย|ก\\.ค|ส\\.ค|ก\\.ย|ต\\.ค|พ\\.ย|ธ\\.ค';

/** Every date/time string of the app: "23 ก.ย.. 26, 05:50", "10 มิ.ย 69", "26/09/2026 02:06:07" … */
export const DATE_PATTERN = new RegExp(
  `\\d{1,2}\\s?(?:${THAI_MONTHS})\\.*\\s?\\d{2,4}(?:,?\\s\\d{2}:\\d{2}(?::\\d{2})?)?|\\d{2}/\\d{2}/\\d{4}(?:\\s\\d{2}:\\d{2}(?::\\d{2})?)?`,
  'g',
);

/** The standard the sheet describes: "18 ก.ย. 2569" — day, month with ONE dot, four-digit Buddhist year (an optional "HH:mm" may follow). */
export const STANDARD_DATE = new RegExp(`^\\d{1,2} (?:${THAI_MONTHS})\\. 25\\d{2}(?:,? \\d{2}:\\d{2})?$`);

/** The date part of a string without its time ("23 ก.ย.. 26, 05:50" → "23 ก.ย.. 26"). */
export function dateOnly(text: string): string {
  return text.replace(/,?\s\d{2}:\d{2}(?::\d{2})?$/, '');
}

/** "23 ก.ย.. 26, 05:50" → "D MMM.. 99, 99:99": what a date looks like with the digits and the month taken out. */
export function dateShape(text: string): string {
  return text
    .replace(/^\d{1,2}/, 'D')
    .replace(new RegExp(THAI_MONTHS), 'MMM')
    .replace(/\d/g, '9');
}

/** All dates a page shows in its visible text. */
export async function pageDates(page: Page): Promise<string[]> {
  const text = await page.locator('body').innerText();
  return [...new Set(text.match(DATE_PATTERN) ?? [])];
}

/** The visible text of the page. */
export async function visibleText(page: Page): Promise<string> {
  return page.locator('body').innerText();
}

/** One link of a page as plain data. */
export interface PageLink {
  /** The href attribute as written ("#", "/frontend/news/index", "http://…"). */
  raw: string;
  /** The absolute URL the browser resolves it to. */
  url: string;
  text: string;
  /** A dropdown/collapse toggle — it opens something, it is not a destination. */
  toggle: boolean;
}

/** Every real link of the current page (icon-picker entries of the admin forms are not links a user follows). */
export async function readLinks(page: Page): Promise<PageLink[]> {
  return page.locator('a[href]').evaluateAll((anchors) =>
    anchors
      .filter((anchor) => !anchor.closest('.iconpicker-popover, .iconpicker-items, .iconpicker-container') && !anchor.classList.contains('iconpicker-item'))
      .map((anchor) => {
        const element = anchor as HTMLAnchorElement;
        const label = (element.innerText || '').replace(/\s+/g, ' ').trim() || element.getAttribute('aria-label') || element.getAttribute('title') || (element.querySelector('img') ? `img:${element.querySelector('img')?.getAttribute('alt') ?? ''}` : '');
        return {
          raw: element.getAttribute('href') ?? '',
          url: element.href,
          text: label.slice(0, 50),
          toggle: element.hasAttribute('data-bs-toggle') || element.classList.contains('dropdown-toggle'),
        };
      }),
  );
}

/** What a page has that reaches past the visible width without being clipped or scrolled by a container. */
export interface OverflowReport {
  viewport: number;
  /** document.scrollWidth — larger than the viewport means the page scrolls sideways. */
  pageWidth: number;
  /** Elements whose right edge is beyond the viewport and are neither in a scroll/clipping container nor fixed. */
  sticking: string[];
}

export async function overflowOf(page: Page): Promise<OverflowReport> {
  return page.evaluate(() => {
    const viewport = window.innerWidth;
    const clipped = (element: Element): boolean => {
      for (let parent = element.parentElement; parent && parent !== document.body && parent !== document.documentElement; parent = parent.parentElement) {
        const overflow = getComputedStyle(parent).overflowX;
        if (['auto', 'scroll', 'hidden', 'clip'].includes(overflow)) return true;
      }
      return false;
    };
    const visible = (element: Element): boolean => !!((element as HTMLElement).offsetWidth || (element as HTMLElement).offsetHeight);
    return {
      viewport,
      pageWidth: document.documentElement.scrollWidth,
      sticking: [...document.querySelectorAll('body *')]
        .filter((element) => visible(element) && getComputedStyle(element).position !== 'fixed' && element.getBoundingClientRect().right > viewport + 1 && !clipped(element))
        .slice(0, 5)
        .map((element) => `${element.tagName.toLowerCase()}.${String((element as HTMLElement).className).slice(0, 30)}`),
    };
  });
}

export function mean(values: number[]): number {
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

/** Nearest-rank percentile (p in 0..100). */
export function percentile(values: number[], p: number): number {
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.max(0, Math.ceil((p / 100) * sorted.length) - 1)];
}
