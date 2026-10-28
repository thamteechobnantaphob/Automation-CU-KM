import { Browser, BrowserContext, Page } from '@playwright/test';
import { env } from '@config/env';
import { LoginPage } from '@pages/LoginPage';

/**
 * Helpers for tests that act as a NON-admin user (KM-FROL SC-FROL-06). The
 * admin session the test runs in is left untouched: the low-privilege user
 * lives in its own brand-new browser context.
 */

/** Absolute URL for a path on the target environment (contexts made by hand have no reliable baseURL). */
export function urlOf(path: string): string {
  return path.startsWith('http') ? path : `${env.baseURL}${path}`;
}

/**
 * Signs `username` in inside a brand-new anonymous context and returns it. The
 * caller must close the context. Throws when the login page is not left within
 * 45 s (wrong password, or the user cannot sign in at all).
 *
 * The context is explicitly anonymous: browser.newContext() inherits the
 * config's admin storageState, which would make the login page redirect away.
 */
export async function loginAs(
  browser: Browser,
  username: string,
  password: string,
): Promise<{ context: BrowserContext; page: Page }> {
  const context = await browser.newContext({ storageState: { cookies: [], origins: [] } });
  try {
    const page = await context.newPage();
    const loginPage = new LoginPage(page);
    await loginPage.open();
    await loginPage.login(username, password);
    await page.waitForURL((url) => !url.pathname.includes('/frontend/account/index'), { timeout: 45_000 });
    return { context, page };
  } catch (error) {
    await context.close();
    throw new Error(`Could not sign in as "${username}": ${(error as Error).message}`);
  }
}

/**
 * The CSRF token of the session on `page`. The admin layout carries it as
 * <meta name="csrf-token"> (and in a hidden `_token` of its logout form). A user
 * with few rights may be bounced away from some pages, so it tries the page the
 * login landed on, then the dashboard, then the home admin page.
 */
export async function csrfTokenOf(page: Page): Promise<string> {
  const read = async (): Promise<string | null> => {
    const fromMeta = await page.locator('meta[name="csrf-token"]').first().getAttribute('content');
    if (fromMeta) return fromMeta;
    const hidden = page.locator('input[name="_token"]').first();
    return (await hidden.count()) > 0 ? hidden.getAttribute('value') : null;
  };

  const tried: string[] = [page.url()];
  let token = await read();
  for (const path of ['/admin/dashboard/index', '/admin/home/index']) {
    if (token) break;
    await page.goto(urlOf(path));
    tried.push(page.url());
    token = await read();
  }
  if (!token) throw new Error(`No CSRF token found on: ${tried.join(', ')}`);
  return token;
}
