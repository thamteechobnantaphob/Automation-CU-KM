import { Browser, BrowserContext, BrowserContextOptions, Page } from '@playwright/test';

/**
 * The full-screen "รอสักครู่ กำลังเตรียมข้อมูล" loader (#pageLoader) of the public
 * site and the login page. It gets class "hidden" on window.load (or after a 3 s
 * safety timeout) and then fades out over 0.4 s. Admin pages have none (2026-10-01).
 *
 * Tests used to act while it was still up, so the evidence videos showed only
 * the loader (QA, 2026-10-01). Everything here makes the test wait until the
 * page is really visible; it never fails a test by itself — a loader that never
 * closes is left for the test's own assertions (and TC-NFR-04-08) to report.
 */
const LOADER_SELECTOR = '#pageLoader';
const LOADER_TIMEOUT_MS = 20_000;

const installedPages = new WeakSet<Page>();
const patchedContexts = new WeakSet<BrowserContext>();

/** Resolves once the loader is gone (absent, display:none, faded to visibility:hidden or opacity 0). */
export async function waitForPageLoader(page: Page, timeout = LOADER_TIMEOUT_MS): Promise<void> {
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      await page.waitForFunction(
        (selector) => {
          const loader = document.querySelector(selector);
          if (!loader) return true;
          const style = getComputedStyle(loader);
          return style.display === 'none' || style.visibility === 'hidden' || style.opacity === '0';
        },
        LOADER_SELECTOR,
        { timeout, polling: 100 },
      );
      return;
    } catch (error) {
      // A navigation in between replaces the document: check the new one. Anything else (timeout, closed page): give up quietly.
      if (page.isClosed() || !/context was destroyed|navigation/i.test(String(error))) return;
    }
  }
}

/**
 * Makes `page` wait for the loader (1) after every goto/reload/back/forward and
 * (2) before any action or auto-waiting assertion while the loader is visible
 * (covers navigations started by a click or a form submit).
 */
export async function installPageLoaderWait(page: Page): Promise<void> {
  if (installedPages.has(page)) return;
  installedPages.add(page);

  for (const method of ['goto', 'reload', 'goBack', 'goForward'] as const) {
    const original = page[method].bind(page) as (...args: unknown[]) => ReturnType<Page['reload']>;
    (page as unknown as Record<string, unknown>)[method] = async (...args: unknown[]) => {
      const response = await original(...args);
      await waitForPageLoader(page);
      return response;
    };
  }

  await page
    .addLocatorHandler(page.locator(LOADER_SELECTOR), async () => waitForPageLoader(page), { noWaitAfter: true })
    .catch(() => undefined);
}

/** Installs the wait on every current and future page of `context` — unless JavaScript is off (the loader never closes there). */
export function installOnContext(context: BrowserContext, options?: BrowserContextOptions): void {
  if (patchedContexts.has(context) || options?.javaScriptEnabled === false) return;
  patchedContexts.add(context);
  for (const page of context.pages()) void installPageLoaderWait(page);
  context.on('page', (page) => void installPageLoaderWait(page));
}

/** Patches browser.newContext (browser.newPage uses it too) so hand-made contexts get the wait as well. */
export function installOnBrowser(browser: Browser): void {
  const marker = browser as Browser & { __pageLoaderPatched?: boolean };
  if (marker.__pageLoaderPatched) return;
  marker.__pageLoaderPatched = true;
  const original = browser.newContext.bind(browser);
  browser.newContext = async (options?: BrowserContextOptions) => {
    const context = await original(options);
    installOnContext(context, options);
    return context;
  };
}
