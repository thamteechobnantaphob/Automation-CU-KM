import { APIRequestContext } from '@playwright/test';
import { test, expect } from '@fixtures/pages.fixtures';
import { env } from '@config/env';
import { ADMIN_AUTH_FILE } from '../../global-setup';
import { loginAs, urlOf } from '@utils/lowPrivilege';
import { PUBLIC_SECURITY_PAGES } from '@utils/security';
import { AUTO_ROLE_DESCRIPTION, autoRoleLabel, createRole } from '@utils/roleFlows';

/**
 * KM-SEC / SC-SEC-03 (clickjacking, CORS, verb tampering) and SC-SEC-04 (security
 * headers, personal data on the public site). Read-only, except the optional
 * second half of TC-SEC-03-06 (see there). Runs with the admin session by default
 * (`request`, `page`); anonymous contexts are made where a case needs them.
 *
 * Not here: TC-SEC-03-03 (CSRF on every state-changing action) — it posts
 * forms and lives in csrf-all-actions.spec.ts.
 */

const EVIL_ORIGIN = 'https://evil.example';
const EMPTY_SESSION = { cookies: [], origins: [] };

/** Pages whose response headers are inspected: public home, the login page, the admin dashboard. */
const HEADER_TARGETS = [
  { name: 'หน้า Public (/)', path: '/', admin: false },
  { name: 'หน้า Login', path: '/frontend/account/index', admin: false },
  { name: 'Dashboard (admin)', path: '/admin/dashboard/index', admin: true },
] as const;

test.describe('SC-SEC-03 การป้องกันฝั่งเบราว์เซอร์และ HTTP', () => {
  test('TC-SEC-03-04 [Medium] Clickjacking: เปิดหน้าในกรอบ iframe ต่างโดเมน', async ({ request, playwright, browser }) => {
    // KNOWN BUG — confirmed 2026-09-25: neither the login page nor the admin pages send X-Frame-Options or a CSP
    // frame-ancestors directive, and a page from another origin really does load them inside an <iframe>.
    test.fail(true, 'Known bug: no X-Frame-Options / CSP frame-ancestors — the login page and admin pages can be framed by any site (clickjacking).');

    const anonymous = await playwright.request.newContext({ baseURL: env.baseURL });
    const context = await browser.newContext({ storageState: ADMIN_AUTH_FILE });
    try {
      // 1) The headers that tell a browser not to let another site frame the page.
      const problems: string[] = [];
      const frameTargets = HEADER_TARGETS.filter((target) => target.path !== '/');
      for (const target of frameTargets) {
        const response = await (target.admin ? request : anonymous).get(target.path);
        const frameOptions = (response.headers()['x-frame-options'] ?? '').trim().toUpperCase();
        const csp = response.headers()['content-security-policy'] ?? '';
        const protectedByHeader = /^(DENY|SAMEORIGIN)\b/.test(frameOptions) || /frame-ancestors/i.test(csp);
        if (!protectedByHeader) problems.push(`${target.name}: no X-Frame-Options (DENY/SAMEORIGIN) and no CSP frame-ancestors`);
      }

      // 2) What a browser really does: a page from another origin embeds both.
      const page = await context.newPage();
      await page.goto('about:blank');
      await page.setContent(
        `<h3>attacker.example — page that frames the app</h3>${frameTargets
          .map((target, index) => `<iframe name="victim${index}" src="${urlOf(target.path)}" width="640" height="420"></iframe>`)
          .join('')}`,
      );
      await page.waitForLoadState('load');
      await page.waitForTimeout(1_500);
      frameTargets.forEach((target, index) => {
        const frame = page.frame({ name: `victim${index}` });
        // A blocked frame turns into Chrome's error page (chrome-error://…), never the app's own URL.
        if (frame && frame.url().startsWith(env.baseURL)) problems.push(`${target.name}: a page from another origin can embed it in an iframe (loaded ${frame.url().replace(env.baseURL, '')})`);
      });
      await test.info().attach('page from another origin framing the app', { body: await page.screenshot(), contentType: 'image/png' });

      expect(problems, 'the browser must refuse to show these pages inside another site').toEqual([]);
    } finally {
      await context.close();
      await anonymous.dispose();
    }
  });

  test('TC-SEC-03-05 [Medium] CORS: เรียกจากโดเมนอื่นพร้อม credentials', async ({ request, playwright, browser }) => {
    const anonymous = await playwright.request.newContext({ baseURL: env.baseURL });
    const context = await browser.newContext({ storageState: ADMIN_AUTH_FILE });
    try {
      const problems: string[] = [];
      const seen: string[] = [];
      const judge = (label: string, headers: Record<string, string>): void => {
        const allowOrigin = headers['access-control-allow-origin'];
        const allowCredentials = headers['access-control-allow-credentials'];
        seen.push(`${label}: ${allowOrigin ?? 'no CORS header'}`);
        if (!allowOrigin) return;
        if (allowOrigin === '*' && allowCredentials === 'true') problems.push(`${label}: Access-Control-Allow-Origin: * together with credentials`);
        else if (allowOrigin === EVIL_ORIGIN) problems.push(`${label}: reflects the foreign origin${allowCredentials === 'true' ? ' AND allows credentials' : ''}`);
        else if (allowOrigin === 'null' && allowCredentials === 'true') problems.push(`${label}: allows the "null" origin with credentials`);
      };

      // Simple requests carrying an Origin header (public pages anonymously, admin pages with the session).
      for (const target of HEADER_TARGETS) {
        const response = await (target.admin ? request : anonymous).get(target.path, { headers: { Origin: EVIL_ORIGIN } });
        judge(`GET ${target.path}`, response.headers());
      }
      const adminRole = await request.get('/admin/role/index', { headers: { Origin: EVIL_ORIGIN } });
      judge('GET /admin/role/index', adminRole.headers());
      // Preflights for the state-changing routes.
      for (const path of ['/admin/role', '/admin/user']) {
        const response = await request.fetch(path, {
          method: 'OPTIONS',
          headers: { Origin: EVIL_ORIGIN, 'Access-Control-Request-Method': 'POST', 'Access-Control-Request-Headers': 'x-csrf-token,content-type' },
        });
        judge(`OPTIONS ${path}`, response.headers());
      }

      // What a browser does: a page on another origin fetches the app WITH the admin's cookies.
      const page = await context.newPage();
      await page.route('http://evil.example/**', (route) => route.fulfill({ contentType: 'text/html', body: '<html><body>attacker page</body></html>' }));
      await page.goto('http://evil.example/');
      for (const path of ['/admin/dashboard/index', '/admin/user/index']) {
        const outcome = await page.evaluate(async (url) => {
          try {
            const response = await fetch(url, { credentials: 'include' });
            return `readable (HTTP ${response.status})`;
          } catch {
            return 'blocked';
          }
        }, urlOf(path));
        seen.push(`browser fetch ${path}: ${outcome}`);
        if (outcome !== 'blocked') problems.push(`a page from another origin can read ${path} with the admin's cookies (${outcome})`);
      }

      test.info().annotations.push({ type: 'note', description: seen.join(' | ') });
      expect(problems, 'no response may let another origin read it with credentials').toEqual([]);
    } finally {
      await context.close();
      await anonymous.dispose();
    }
  });

  test('TC-SEC-03-06 [Medium] Verb tampering: ใช้ GET แทน POST/DELETE', async ({ browser, request, roleListPage, roleFormPage, page }) => {
    test.setTimeout(150_000);
    const problems: string[] = [];
    const seen: string[] = [];

    // GET on routes that exist only for POST. Logout is tried in a THROWAWAY admin session, so if a GET did log out the
    // shared session the other tests use would survive.
    const { context, page: throwaway } = await loginAs(browser, env.adminUser, env.adminPass);
    try {
      const expectRefused = async (ctx: APIRequestContext, path: string): Promise<void> => {
        const response = await ctx.get(urlOf(path), { maxRedirects: 0 });
        seen.push(`GET ${path} → ${response.status()}`);
        if (![404, 405].includes(response.status())) problems.push(`GET ${path} → HTTP ${response.status()} (expected 405/404)`);
      };
      for (const path of ['/admin/role/create', '/admin/role', '/admin/user', '/admin/user/create']) await expectRefused(request, path);

      await expectRefused(throwaway.request, '/admin/logout');
      const after = await throwaway.request.get(urlOf('/admin/dashboard/index'), { maxRedirects: 0 });
      seen.push(`dashboard after GET /admin/logout → ${after.status()}`);
      if (after.status() !== 200) problems.push('GET /admin/logout ended the session (logout must be POST-only)');
    } finally {
      await context.close();
    }

    // `?_method=DELETE` on a list must change nothing.
    const rolesBefore = await roleListPage.roleCount();
    const spoof = await request.get('/admin/role/index?_method=DELETE');
    seen.push(`GET /admin/role/index?_method=DELETE → ${spoof.status()}`);
    expect(await roleListPage.roleCount(), 'a spoofed GET must not delete a role').toBe(rolesBefore);

    // Second half needs a record to aim at, so it only runs when data-creating tests are allowed.
    if (env.allowDataCreatingTests) {
      const label = autoRoleLabel('03-06');
      await createRole(page, roleListPage, roleFormPage, { label, description: AUTO_ROLE_DESCRIPTION });
      const action = await (await roleListPage.openEditForm(label)).action();
      for (const path of [`${action}?_method=DELETE`, `${action}?_method=PUT&label=CHANGED`, `${action}/delete`]) {
        const response = await request.get(path, { maxRedirects: 0 });
        seen.push(`GET <role>${path.replace(action, '')} → ${response.status()}`);
        if (![404, 405].includes(response.status())) problems.push(`GET <role>${path.replace(action, '')} → HTTP ${response.status()} (expected 405/404)`);
      }
      await roleListPage.open();
      const row = await roleListPage.findRole(label);
      if (!row) problems.push('the test role disappeared after GET requests with _method=DELETE');
      else if (row.description !== AUTO_ROLE_DESCRIPTION) problems.push('the test role changed after GET requests with _method=PUT');
      seen.push('data-creating half: ran on a test role');
    } else {
      seen.push('data-creating half (GET with _method=DELETE/PUT aimed at a real role): skipped — ALLOW_DATA_CREATING_TESTS is off');
    }

    test.info().annotations.push({ type: 'note', description: seen.join(' | ') });
    expect(problems, 'a GET must never delete, change or log out').toEqual([]);
  });
});

test.describe('SC-SEC-04 ส่วนหัวความปลอดภัยและข้อมูลส่วนบุคคล', () => {
  test('TC-SEC-04-03 [Medium] Security headers ครบ', async ({ request, playwright }) => {
    // KNOWN BUG — confirmed 2026-09-25: the public pages, the login page and the admin dashboard send none of
    // Content-Security-Policy, X-Content-Type-Options, Referrer-Policy, Permissions-Policy (only "Server: nginx", which
    // correctly hides the version, and no X-Powered-By).
    test.fail(true, 'Known bug: Content-Security-Policy, X-Content-Type-Options, Referrer-Policy and Permissions-Policy are all missing.');

    const anonymous = await playwright.request.newContext({ baseURL: env.baseURL });
    try {
      const problems: string[] = [];
      for (const target of HEADER_TARGETS) {
        const headers = (await (target.admin ? request : anonymous).get(target.path)).headers();
        const missing = [
          ['Content-Security-Policy', !headers['content-security-policy']],
          ['X-Content-Type-Options: nosniff', !/nosniff/i.test(headers['x-content-type-options'] ?? '')],
          ['Referrer-Policy', !headers['referrer-policy']],
          ['Permissions-Policy', !headers['permissions-policy']],
        ]
          .filter(([, isMissing]) => isMissing)
          .map(([name]) => name);
        if (missing.length) problems.push(`${target.name}: missing ${missing.join(', ')}`);
        if (headers['x-powered-by']) problems.push(`${target.name}: X-Powered-By: ${headers['x-powered-by']} reveals the stack`);
        if (/\d+\.\d+/.test(headers['server'] ?? '')) problems.push(`${target.name}: Server: ${headers['server']} reveals a version`);
      }
      expect(problems, 'the security headers must be present and the stack/version hidden').toEqual([]);
    } finally {
      await anonymous.dispose();
    }
  });

  test('TC-SEC-04-06 [Medium] อีเมลผู้ใช้และข้อมูลส่วนบุคคลไม่รั่วบนหน้า Public', async ({ request, playwright }) => {
    test.setTimeout(180_000);
    const anonymous = await playwright.request.newContext({ baseURL: env.baseURL });
    try {
      // Who the users are (admin's view): e-mails and usernames from the user list's edit buttons.
      const emails = new Set<string>();
      const usernames = new Set<string>();
      for (let pageNo = 1; pageNo <= 15; pageNo++) {
        const html = await (await request.get(pageNo > 1 ? `/admin/user/index?page=${pageNo}` : '/admin/user/index')).text();
        const found = [...html.matchAll(/data-username="([^"]*)"[^>]*?data-email="([^"]*)"|data-email="([^"]*)"[^>]*?data-username="([^"]*)"/g)];
        if (!found.length && pageNo > 1) break;
        for (const match of found) {
          const username = match[1] ?? match[4];
          const email = match[2] ?? match[3];
          if (username) usernames.add(username);
          if (email) emails.add(email.toLowerCase());
        }
      }

      // The public pages and the detail pages they link to (one level).
      const pages = new Map<string, string>();
      for (const path of PUBLIC_SECURITY_PAGES) {
        const response = await anonymous.get(path);
        pages.set(path, response.status() === 200 ? await response.text() : '');
      }
      const details = new Set<string>();
      for (const html of pages.values()) {
        for (const match of html.matchAll(/href="((?:https?:\/\/[^"/]+)?\/frontend\/[^"#?]+)"/gi)) {
          const path = match[1].replace(/^https?:\/\/[^/]+/, '');
          if (!pages.has(path)) details.add(path);
        }
      }
      for (const path of [...details].slice(0, 40)) {
        const response = await anonymous.get(path);
        pages.set(path, response.status() === 200 ? await response.text() : '');
      }

      const problems: string[] = [];
      const publicEmails = new Set<string>();
      for (const [path, html] of pages) {
        for (const match of html.matchAll(/[\w.+-]+@[\w-]+(?:\.[\w-]+)+/g)) publicEmails.add(match[0].toLowerCase());
        const lower = html.toLowerCase();
        for (const email of emails) if (lower.includes(email)) problems.push(`${path}: contains the user e-mail ${email}`);
        for (const username of usernames) {
          // Test accounts named like a markup payload match the same payload in test content, not a leaked username.
          if (/[<>]|&lt;|&gt;/.test(username)) continue;
          if (username.length >= 6 && new RegExp(`(?<![\\w-])${username.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}(?![\\w-])`, 'i').test(html)) problems.push(`${path}: contains the username ${username}`);
        }
        if (/data-user-id|"user_id"|name="user_id"/i.test(html)) problems.push(`${path}: exposes an internal user id`);
      }

      test.info().annotations.push({
        type: 'note',
        description: `${pages.size} public pages read; ${emails.size} user e-mails and ${usernames.size} usernames compared. E-mail addresses that appear on public pages at all: ${publicEmails.size ? [...publicEmails].join(', ') : 'none'}.`,
      });
      expect(problems, 'the public site must not show user e-mails, usernames or internal user ids').toEqual([]);
    } finally {
      await anonymous.dispose();
    }
  });
});
