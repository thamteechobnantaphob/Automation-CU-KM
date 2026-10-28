import { APIRequestContext } from '@playwright/test';
import { test, expect, ANONYMOUS_SESSION } from '@fixtures/pages.fixtures';
import { env } from '@config/env';
import { ADMIN_AUTH_FILE } from '../../global-setup';
import { rawGet } from '@utils/rawHttp';
import { ADMIN_PAGES, PUBLIC_SECURITY_PAGES } from '@utils/security';

/**
 * KM-SEC / SC-SEC-02 — what the server exposes by accident: directory listings,
 * sensitive files, debug endpoints, source maps and comments, robots/sitemap,
 * path traversal. Plain HTTP checks, read-only, anonymous unless a case needs the
 * admin pages' HTML (TC-SEC-02-07).
 */
test.use({ storageState: ANONYMOUS_SESSION });

const LISTING_MARKERS = /<title>\s*Index of|Parent Directory|Directory listing for/i;
const SECRET_MARKERS = /APP_KEY|DB_PASSWORD|DB_USERNAME|MAIL_PASSWORD|\[core\]|repositoryformatversion|"require"\s*:|"dependencies"\s*:|<\?php|CREATE TABLE|INSERT INTO|phpinfo\(\)|PHP Version/i;

const ASSET_EXTENSIONS = /\.(?:png|jpe?g|gif|svg|webp|ico|css|js|woff2?|ttf|eot|map)(?:\?|$)/i;

/** Same-origin asset URLs (img/script/link) referenced by a page, as paths. */
function assetPaths(html: string): string[] {
  const paths = new Set<string>();
  for (const match of html.matchAll(/(?:src|href)\s*=\s*["']([^"']+)["']/gi)) {
    let path: string;
    try {
      const url = new URL(match[1], env.baseURL);
      if (url.origin !== new URL(env.baseURL).origin) continue;
      path = url.pathname;
    } catch {
      continue;
    }
    if (ASSET_EXTENSIONS.test(path) && !/^\/(?:frontend|admin)\//.test(path)) paths.add(path);
  }
  return [...paths];
}

async function fetchHtml(ctx: APIRequestContext, path: string): Promise<string> {
  const response = await ctx.get(path);
  return response.status() === 200 ? response.text() : '';
}

test.describe('SC-SEC-02 การเปิดเผยข้อมูลโดยไม่ตั้งใจ', () => {
  test('TC-SEC-02-04 [Medium] Directory listing ปิดอยู่', async ({ request }) => {
    // The four folders of the sheet, plus every folder the public pages' images/scripts/styles live in.
    const dirs = new Set(['/uploads/', '/storage/', '/assets/', '/images/']);
    for (const path of PUBLIC_SECURITY_PAGES) {
      for (const asset of assetPaths(await fetchHtml(request, path))) {
        const parts = asset.split('/').slice(0, -1); // drop the file name
        for (let depth = 2; depth <= parts.length; depth++) dirs.add(`${parts.slice(0, depth).join('/')}/`);
      }
    }

    const problems: string[] = [];
    for (const dir of dirs) {
      const response = await request.get(dir, { maxRedirects: 0 });
      const body = await response.text();
      if (![401, 403, 404].includes(response.status()) || LISTING_MARKERS.test(body)) {
        problems.push(`${dir} → HTTP ${response.status()}${LISTING_MARKERS.test(body) ? ' and shows a file listing' : ''}`);
      }
    }
    test.info().annotations.push({ type: 'note', description: `${dirs.size} folders checked: ${[...dirs].join(' ')}` });
    expect(problems, 'folders must answer 403/404 and never list their files').toEqual([]);
  });

  test('TC-SEC-02-05 [High] ไฟล์สำคัญและไฟล์สำรองเข้าถึงไม่ได้', async ({ request }) => {
    const files = [
      '/.env', '/.git/config', '/composer.json', '/package.json', '/backup.sql', '/phpinfo.php', '/web.config', // the sheet
      '/.env.example', '/.env.backup', '/.git/HEAD', '/composer.lock', '/package-lock.json', '/artisan', '/.htaccess', '/storage/logs/laravel.log', '/database.sqlite', '/dump.sql', '/backup.zip',
    ];
    const problems: string[] = [];
    for (const file of files) {
      const response = await request.get(file, { maxRedirects: 0 });
      const body = await response.text();
      if (![403, 404].includes(response.status()) || SECRET_MARKERS.test(body)) {
        problems.push(`${file} → HTTP ${response.status()}${SECRET_MARKERS.test(body) ? ' and the body looks like the real file' : ''}`);
      }
    }
    expect(problems, 'sensitive files must answer 403/404 without their content').toEqual([]);
  });

  test('TC-SEC-02-06 [High] Debug/Profiler endpoint ปิดอยู่', async ({ request }) => {
    const endpoints = ['/_profiler', '/debug', '/telescope', '/actuator', '/server-status', '/_ignition/health-check', '/horizon', '/phpmyadmin', '/adminer.php', '/info.php'];
    const problems: string[] = [];
    for (const endpoint of endpoints) {
      const response = await request.get(endpoint, { maxRedirects: 0 });
      if (![403, 404].includes(response.status())) problems.push(`${endpoint} → HTTP ${response.status()}`);
    }
    expect(problems, 'debug and monitoring endpoints must not be reachable').toEqual([]);
  });

  test('TC-SEC-02-07 [Low] Source map และคอมเมนต์ไม่เปิดเผยข้อมูลภายใน', async ({ request, playwright }) => {
    test.setTimeout(180_000);
    const admin = await playwright.request.newContext({ baseURL: env.baseURL, storageState: ADMIN_AUTH_FILE });
    try {
      const pages: Array<{ path: string; html: string }> = [];
      for (const path of PUBLIC_SECURITY_PAGES) pages.push({ path, html: await fetchHtml(request, path) });
      for (const path of ADMIN_PAGES) pages.push({ path, html: await fetchHtml(admin, path) });

      // Source maps: one .map per script/stylesheet of this origin. Libraries under /lib/ are third-party open-source
      // (their maps show only public code); anything else would be the application's own source.
      const assets = new Set<string>();
      for (const { html } of pages) assetPaths(html).filter((path) => /\.(?:js|css)$/i.test(path)).forEach((path) => assets.add(path));
      const appMaps: string[] = [];
      const libMaps: string[] = [];
      for (const asset of assets) {
        const response = await request.get(`${asset}.map`);
        if (response.status() !== 200 || !/"version"\s*:\s*3/.test(await response.text())) continue;
        (asset.startsWith('/lib/') ? libMaps : appMaps).push(`${asset}.map`);
      }

      // Comments: nothing that reads like a credential, a file-system path or SQL.
      const sensitive = /password|passwd|secret|api[_-]?key|credential|BEGIN (?:RSA |PRIVATE)|\/var\/www|\/home\/\w+|\/etc\/|[A-Z]:\\|\bSELECT\b[^>]{0,80}\bFROM\b|DB_(?:HOST|PASSWORD)/i;
      const problems: string[] = appMaps.map((map) => `application source map published: ${map}`);
      let comments = 0;
      for (const { path, html } of pages) {
        for (const match of html.matchAll(/<!--([\s\S]*?)-->/g)) {
          comments++;
          const text = match[1].trim().replace(/\s+/g, ' ');
          if (sensitive.test(text)) problems.push(`${path}: comment "${text.slice(0, 100)}"`);
        }
      }

      test.info().annotations.push({
        type: 'note',
        description: `${assets.size} scripts/styles and ${comments} HTML comments checked. Third-party library source maps published: ${libMaps.length ? libMaps.join(', ') : 'none'} (public open-source code, not counted as a leak). Some admin pages carry commented-out <link> tags with the server's full URL (informational).`,
      });
      expect(problems, 'no application source map, and no comment with credentials, server paths or SQL').toEqual([]);
    } finally {
      await admin.dispose();
    }
  });

  test('TC-SEC-02-08 [Low] robots.txt และ sitemap.xml ไม่เผย path ผู้ดูแล', async ({ request }) => {
    const problems: string[] = [];
    const seen: string[] = [];
    for (const file of ['/robots.txt', '/sitemap.xml']) {
      const response = await request.get(file);
      seen.push(`${file} → ${response.status()}`);
      if (response.status() === 200) {
        const body = await response.text();
        if (/\/admin/i.test(body)) problems.push(`${file} mentions /admin`);
        if (SERVER_INTERNALS.test(body)) problems.push(`${file} shows internal information`);
      } else if (response.status() !== 404) {
        problems.push(`${file} → HTTP ${response.status()} (expected the file or a plain 404)`);
      }
    }
    test.info().annotations.push({ type: 'note', description: seen.join(' | ') });
    expect(problems, 'robots.txt / sitemap.xml must not list admin paths or internals').toEqual([]);
  });

  test('TC-SEC-02-09 [High] ดาวน์โหลดไฟล์ด้วย path traversal', async () => {
    // The app has no attachment-download endpoint yet (no page links to one), so the traversal is tried on the routes
    // that DO serve files: the storage folder (uploaded images) and the static folders. Node's http keeps the path
    // exactly as written; browsers/Playwright would normalise "../" away.
    const roots = ['/storage', '/images', '/lib', '/css', '/js'];
    const tails = [
      '/../../../../etc/passwd',
      '/..%2f..%2f..%2f..%2fetc%2fpasswd',
      '/%2e%2e/%2e%2e/%2e%2e/%2e%2e/etc/passwd',
      '/..%252f..%252f..%252fetc%252fpasswd',
      '/....//....//....//....//etc/passwd',
      '/..%c0%af..%c0%af..%c0%afetc/passwd',
    ];
    const problems: string[] = [];
    for (const root of roots) {
      for (const tail of tails) {
        const response = await rawGet(`${root}${tail}`);
        if (![400, 403, 404].includes(response.status) || /root:.*:0:0/.test(response.body)) {
          problems.push(`${root}${tail} → HTTP ${response.status}${/root:.*:0:0/.test(response.body) ? ' and returned /etc/passwd' : ''}`);
        }
      }
    }
    test.info().annotations.push({ type: 'note', description: `${roots.length * tails.length} traversal attempts on ${roots.join(', ')}. No attachment-download endpoint exists yet — add one to this list when files can be attached.` });
    expect(problems, 'traversal must answer 400/403/404 and never return a file outside the folder').toEqual([]);
  });
});

const SERVER_INTERNALS = /\/var\/www|C:\\|password|192\.168\.|10\.\d+\.\d+\.\d+/i;
