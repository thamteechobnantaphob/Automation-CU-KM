import { APIRequestContext, Page } from '@playwright/test';
import { PUBLIC_PAGES, SERVER_LEAK_PATTERN } from '@utils/publicPages';

/**
 * Shared data and helpers for the system-wide security cases (KM-SEC, tests/security/).
 * Everything here is used by GET-only checks unless a spec says otherwise.
 */

/** XSS payloads for URL parameters (TC-SEC-01-02). */
export const XSS_PAYLOADS = ['<script>alert(1)</script>', '<svg onload=alert(1)>', '"><img src=x onerror=alert(1)>'] as const;

/** SQL injection payloads of TC-SEC-01-04 (the last one is time-based: a vulnerable query would wait 5 s). */
export const SQLI_PAYLOADS = ["'", "' OR '1'='1", "'; SELECT SLEEP(5)--"] as const;

/** Header-injection payload of TC-SEC-01-06 (already percent-encoded, sent as-is). */
export const CRLF_PAYLOAD = '%0d%0aSet-Cookie:%20x=1';

/** Text in a response that shows a database or server error leaked to the user. */
export const SQL_ERROR_PATTERN = new RegExp(
  `${SERVER_LEAK_PATTERN.source}|You have an error in your SQL syntax|PDOException|QueryException|mysqli?_|SQLite3|ORA-\\d{5}|Unclosed quotation mark|pg_query`,
  'i',
);

/** Admin pages every security sweep visits (all exist on Dev; the admin session is needed). */
export const ADMIN_PAGES = [
  '/admin/dashboard/index',
  '/admin/user/index',
  '/admin/role/index',
  '/admin/activity-log',
  '/admin/home/index',
  '/admin/cops/index',
  '/admin/knowledge/index',
  '/admin/news/index',
  '/admin/faq/index',
  '/admin/contractus/index',
  '/admin/group/index',
  '/admin/sitemap/index',
  '/admin/activity/index',
  '/admin/bestpractice/index',
] as const;

/** Public pages (the ten of PUBLIC_PAGES plus the login page). */
export const PUBLIC_SECURITY_PAGES = [...PUBLIC_PAGES.map((page) => page.path), '/frontend/account/index'];

/** Parameters worth trying on a page although no visible GET form uses them. */
export const EXTRA_PARAMS: Record<string, string[]> = {
  '/': ['q', 'lang'],
  '/frontend/search/index': ['keyword', 'q'],
  '/frontend/account/index': ['redirect', 'next', 'return_url', 'returnUrl', 'url'],
};

/** Records every JS dialog (alert/confirm/prompt) the page opens — an XSS payload that ran would show up here — and dismisses it. */
export function collectDialogs(page: Page): string[] {
  const dialogs: string[] = [];
  page.on('dialog', (dialog) => {
    dialogs.push(`${dialog.type()}: ${dialog.message()}`);
    void dialog.dismiss();
  });
  return dialogs;
}

/** Names of the fields of the page's GET forms — the parameters the UI itself sends (search boxes, filters). */
export function getFormParams(html: string): string[] {
  const names = new Set<string>();
  for (const chunk of html.split(/<form\b/i).slice(1)) {
    const form = chunk.split(/<\/form>/i)[0];
    const tag = /^[^>]*>/.exec(form)?.[0] ?? '';
    const method = /method\s*=\s*["']?(\w+)/i.exec(tag)?.[1]?.toLowerCase() ?? 'get';
    if (method !== 'get') continue;
    for (const match of form.matchAll(/<(?:input|select|textarea)\b[^>]*\bname\s*=\s*["']([^"']+)["']/gi)) {
      if (!/^_/.test(match[1])) names.add(match[1]);
    }
  }
  return [...names];
}

/** `path` with `?name=<value>` appended (value percent-encoded). */
export function withParam(path: string, name: string, value: string): string {
  return `${path}${path.includes('?') ? '&' : '?'}${encodeURIComponent(name)}=${encodeURIComponent(value)}`;
}

/** A page (with the request context that may fetch it) and the URL parameters to try on it. */
export interface Probe {
  area: 'public' | 'admin';
  path: string;
  params: string[];
  ctx: APIRequestContext;
}

/**
 * Every page × the parameters it takes: those of its GET forms, `page`, and the
 * extra names in EXTRA_PARAMS. Public pages are fetched anonymously, admin pages
 * with the admin session.
 */
export async function discoverProbes(anonymous: APIRequestContext, admin: APIRequestContext): Promise<Probe[]> {
  const probes: Probe[] = [];
  const add = async (area: Probe['area'], path: string, ctx: APIRequestContext): Promise<void> => {
    const response = await ctx.get(path);
    const found = response.status() === 200 ? getFormParams(await response.text()) : [];
    probes.push({ area, path, ctx, params: [...new Set([...found, 'page', ...(EXTRA_PARAMS[path] ?? [])])] });
  };
  for (const path of PUBLIC_SECURITY_PAGES) await add('public', path, anonymous);
  for (const path of ADMIN_PAGES) await add('admin', path, admin);
  return probes;
}

/** Number of table rows / list items in a response body — a crude "how much data came back". */
export function rowsIn(body: string): number {
  return (body.match(/<tr[\s>]/gi) ?? []).length;
}
