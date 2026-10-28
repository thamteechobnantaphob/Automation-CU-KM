import { test, expect, ANONYMOUS_SESSION } from '@fixtures/pages.fixtures';
import { env, requireDataCreatingTestsAllowed } from '@config/env';
import { SESSION } from '@config/policy';
import { AdminActivityLogPage } from '@pages/admin/AdminActivityLogPage';
import { AdminNewsListPage, KNOWLEDGE_MODULE, NewsFormPage } from '@pages/admin/AdminNewsPages';
import { LoginPage } from '@pages/LoginPage';
import { sheetTitle } from '@utils/caseTitles';
import { urlOf } from '@utils/lowPrivilege';
import { deleteNewsByExcerpt, fetchAsVisitor, submitNews } from '@utils/newsFlows';
import { roleStamp } from '@utils/roleFlows';
import { QA_PREFIX } from '@utils/strings';
import { payload } from '@utils/uploadFiles';
import { Browser } from '@playwright/test';

/**
 * KM-AUTH / KM-NFR-02 / KM-SEC — session, cookies, upload hardening and IDOR cases (Auto:P), checked 2026-10-07.
 * Session limits are the OWASP-based proposals in src/config/policy.ts (idle 30 min). Failed logins use a made-up
 * qa_auto_ username so no real account is ever locked. Content a case saves carries "[Auto Test]" and is deleted.
 */

const KNOWN = {
  HEADERS: 'Known bug (DEF-29): security headers are missing (Content-Security-Policy, X-Content-Type-Options, Referrer-Policy, Permissions-Policy).',
  FRAMES: 'Known bug (DEF-30): no X-Frame-Options / CSP frame-ancestors (clickjacking).',
  BAD_ID_500: 'Known bug (DEF-54): an unknown / malformed id in an admin edit URL answers HTTP 500 instead of 404.',
  NO_ATTACHMENT: 'Spec mismatch (DEF-106): contact messages have no attachments — there is nothing to protect.',
  LONG_SESSION: 'Known bug (DEF-120): the admin session lasts 120 minutes (framework default) — the proposed idle limit is 30 minutes (SA to confirm).',
  FAILED_LOGIN_NOT_LOGGED: 'Known bug (DEF-121): a failed login is not recorded in "ประวัติการใช้งานระบบ" (the log knows only login / logout / create / update / delete).',
};

test.beforeEach(() => test.setTimeout(240_000));

function note(description: string): void {
  test.info().annotations.push({ type: 'note', description });
}

/** A fresh admin login in its own context; returns the context (logged in) — close it after use. */
async function freshAdmin(browser: Browser): Promise<import('@playwright/test').BrowserContext> {
  const context = await browser.newContext({ storageState: ANONYMOUS_SESSION });
  const page = await context.newPage();
  await new LoginPage(page).loginAndWaitForDashboard(env.adminUser, env.adminPass);
  return context;
}

// ---------------------------------------------------------------------------------------------------------------

test.describe('SC-AUTH เซสชันและการเข้าสู่ระบบ', () => {
  test(sheetTitle('TC-AUTH-03-04'), async ({ browser }) => {
    const context = await freshAdmin(browser);
    try {
      const session = (await context.cookies()).find((c) => /session/i.test(c.name));
      const minutes = session && session.expires > 0 ? Math.round((session.expires - Date.now() / 1000) / 60) : null;
      note(`Session cookie "${session?.name}" expires in ${minutes ?? '(browser session)'} min; proposed idle limit ${SESSION.idleTimeoutMinutes} min.`);
      expect(session, 'a session cookie').toBeDefined();
      test.fail((minutes ?? 0) > SESSION.idleTimeoutMinutes + 1, KNOWN.LONG_SESSION);
      expect(minutes ?? 0, `the session ends after at most ${SESSION.idleTimeoutMinutes} minutes idle`).toBeLessThanOrEqual(SESSION.idleTimeoutMinutes + 1);
      note('Waiting the full idle time on a live screen (and checking that typed data survives) is a manual check.');
    } finally {
      await context.close();
    }
  });

  test(sheetTitle('TC-AUTH-05-05'), async ({ browser }) => {
    const first = await freshAdmin(browser);
    const second = await freshAdmin(browser);
    try {
      const a = await first.newPage();
      const b = await second.newPage();
      const ra = await a.goto(urlOf('/admin/dashboard/index'));
      const rb = await b.goto(urlOf('/admin/dashboard/index'));
      const aIn = !/account\/index/.test(a.url());
      const bIn = !/account\/index/.test(b.url());
      note(`Browser A logged in: ${aIn} (${ra?.status()}); browser B: ${bIn} (${rb?.status()})`);
      expect(bIn, 'the newest login works').toBe(true);
      // "อนุญาตทั้งสอง หรือยกเลิก session เก่า" (TBD): either is fine; record which one.
      note(aIn ? 'Policy seen: both sessions stay valid.' : 'Policy seen: the older session is ended.');
    } finally {
      await first.close();
      await second.close();
    }
  });

  test(sheetTitle('TC-AUTH-05-08'), async ({ browser, page }) => {
    const username = `${QA_PREFIX}_nologin_${roleStamp()}`;
    const context = await browser.newContext({ storageState: ANONYMOUS_SESSION });
    try {
      const loginPage = await context.newPage();
      const login = new LoginPage(loginPage);
      await login.open();
      await login.login(username, 'Wrong#Password1');
      await loginPage.waitForLoadState('load');
    } finally {
      await context.close();
    }
    const log = new AdminActivityLogPage(page);
    await log.open();
    const rows = (await log.readRows()).filter((r) => r.item.includes(username) || r.user.includes(username));
    note(`Log rows for ${username}: ${JSON.stringify(rows)}`);
    test.fail(rows.length === 0, KNOWN.FAILED_LOGIN_NOT_LOGGED);
    expect(rows.length, 'the failed login is logged').toBeGreaterThan(0);
    expect(rows[0].ip, 'with the IP').toMatch(/\d+\.\d+\.\d+\.\d+|:/);
    expect(rows[0].time, 'and the time').not.toBe('');
  });
});

test.describe('SC-NFR-02 คุกกี้และ header', () => {
  test(sheetTitle('TC-NFR-02-02'), async ({ browser }) => {
    const context = await freshAdmin(browser);
    try {
      const cookies = await context.cookies();
      const session = cookies.find((c) => /session/i.test(c.name));
      note(`Session cookie: ${JSON.stringify({ name: session?.name, httpOnly: session?.httpOnly, sameSite: session?.sameSite, secure: session?.secure })}`);
      expect(session?.httpOnly, 'HttpOnly').toBe(true);
      expect(session?.sameSite, 'SameSite set (Lax/Strict)').not.toBe('None');
      if (env.baseURL.startsWith('https')) expect(session?.secure, 'Secure on HTTPS').toBe(true);
      const response = await (await context.newPage()).goto(urlOf('/admin/dashboard/index'));
      const headers = response!.headers();
      const missing = [
        ['X-Frame-Options or CSP frame-ancestors', /DENY|SAMEORIGIN/i.test(headers['x-frame-options'] ?? '') || /frame-ancestors/i.test(headers['content-security-policy'] ?? '')],
        ['X-Content-Type-Options: nosniff', /nosniff/i.test(headers['x-content-type-options'] ?? '')],
        ['Referrer-Policy', Boolean(headers['referrer-policy'])],
      ].filter(([, ok]) => !ok).map(([name]) => name);
      note(`Missing headers: ${JSON.stringify(missing)}`);
      test.fail(missing.length > 0, `${KNOWN.HEADERS} ${KNOWN.FRAMES}`);
      expect(missing, 'the security headers are sent').toEqual([]);
    } finally {
      await context.close();
    }
  });
});

test.describe('SC-SEC อัปโหลดไฟล์และ IDOR', () => {
  test(sheetTitle('TC-SEC-01-07'), async ({ page }) => {
    requireDataCreatingTestsAllowed('Saves a knowledge article with odd file / text values (deleted again at the end).');
    const pdf = payload('a.pdf', Buffer.from('%PDF-1.4\n%[Auto Test]\n1 0 obj <<>> endobj\ntrailer <<>>\n%%EOF'), 'application/pdf');
    const t0 = Date.now();
    const base = await submitNews(page, { title: `AUTO_CMD_BASE ${roleStamp()}`, documents: [pdf] }, KNOWLEDGE_MODULE);
    const baseline = Date.now() - t0;
    const t1 = Date.now();
    const evil = await submitNews(page, { title: `AUTO_CMD ${roleStamp()}`, excerpt: `[Auto Test] $(sleep 10) \`sleep 10\` | ping -n 10 127.0.0.1 ${roleStamp()}`, documents: [payload('report;sleep 10;.pdf', pdf.buffer, 'application/pdf'), payload('x$(sleep 10).pdf', pdf.buffer, 'application/pdf')] }, KNOWLEDGE_MODULE);
    const took = Date.now() - t1;
    try {
      note(`Save without payload ${baseline} ms; with payloads ${took} ms (HTTP ${evil.submitted.first} → ${evil.submitted.final})`);
      expect(evil.submitted.final, 'no server error').toBeLessThan(500);
      expect(took - baseline, 'no command runs (no 10 s delay)').toBeLessThan(8_000);
    } finally {
      await deleteNewsByExcerpt(page, base.excerpt, KNOWLEDGE_MODULE);
      await deleteNewsByExcerpt(page, evil.excerpt, KNOWLEDGE_MODULE);
    }
  });

  test(sheetTitle('TC-SEC-02-01'), async ({ page, browser }) => {
    requireDataCreatingTestsAllowed('Uploads web-shell files as documents / covers (the item is deleted again).');
    const php = Buffer.from('<?php echo "QA-SHELL-" . (6*7); ?>');
    const files = [payload('shell.php', php, 'application/x-php'), payload('shell.phtml', php, 'application/x-php'), payload('shell.php.pdf', php, 'application/pdf'), payload('shell.pdf.php', php, 'application/pdf')];
    const results: string[] = [];
    for (const file of files) {
      const saved = await submitNews(page, { title: `AUTO_SHELL ${roleStamp()}`, documents: [file], cover: payload(file.name.replace(/pdf/g, 'jpg'), php, 'image/jpeg') }, KNOWLEDGE_MODULE);
      try {
        const card = await new AdminNewsListPage(page, KNOWLEDGE_MODULE).findByExcerpt(saved.excerpt);
        if (!card) {
          results.push(`${file.name}: refused (${saved.submitted.first})`);
          continue;
        }
        const form = new NewsFormPage(page, KNOWLEDGE_MODULE);
        await form.openEdit(card.editHref);
        const stored = await page.locator('a[href*="/attachments/"], a[href*="/storage/"]').evaluateAll((as) => as.map((a) => (a as HTMLAnchorElement).href));
        for (const url of stored) {
          const got = await fetchAsVisitor(browser, url);
          const ran = got.body.toString().includes('QA-SHELL-42');
          results.push(`${file.name}: stored ${url.split('/').pop()} → ${got.status} ${got.type}${ran ? ' EXECUTED' : ''}`);
          expect.soft(ran, `${file.name}: the PHP code is never executed`).toBe(false);
        }
      } finally {
        await deleteNewsByExcerpt(page, saved.excerpt, KNOWLEDGE_MODULE);
      }
    }
    note(results.join(' | '));
  });

  test(sheetTitle('TC-SEC-02-02'), async ({ page, browser }) => {
    requireDataCreatingTestsAllowed('Uploads HTML / SVG files as documents (the item is deleted again).');
    const html = payload('page.html', Buffer.from('<html><body><script>document.title="QA-XSS"</script>[Auto Test]</body></html>'), 'text/html');
    const svg = payload('pic.svg', Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>'), 'image/svg+xml');
    const saved = await submitNews(page, { title: `AUTO_HTML_SVG ${roleStamp()}`, documents: [html, svg] }, KNOWLEDGE_MODULE);
    try {
      const card = await new AdminNewsListPage(page, KNOWLEDGE_MODULE).findByExcerpt(saved.excerpt);
      note(`Saved: ${Boolean(card)} (HTTP ${saved.submitted.first})`);
      if (!card) return; // refused: safe
      const form = new NewsFormPage(page, KNOWLEDGE_MODULE);
      await form.openEdit(card.editHref);
      const links = await page.locator('a[href*="/attachments/"]').evaluateAll((as) => as.map((a) => (a as HTMLAnchorElement).href));
      for (const url of links) {
        const got = await fetchAsVisitor(browser, url);
        note(`${url}: ${got.type}; ${got.disposition}`);
        expect.soft(/attachment/i.test(got.disposition) || !/html|svg/i.test(got.type), 'served as a download / not as HTML or SVG').toBe(true);
      }
    } finally {
      await deleteNewsByExcerpt(page, saved.excerpt, KNOWLEDGE_MODULE);
    }
  });

  test(sheetTitle('TC-SEC-02-03'), async ({ page }) => {
    test.fail(true, KNOWN.NO_ATTACHMENT);
    await page.goto(urlOf('/frontend/contractus/index'));
    expect(await page.locator('#contact-form input[type="file"]').count(), 'contact messages carry attachments').toBeGreaterThan(0);
  });

  test(sheetTitle('TC-SEC-03-01'), async ({ page }) => {
    const statuses: string[] = [];
    for (const path of ['/admin/knowledge/1/edit', '/admin/news/1/edit', '/admin/cops/1/posts', '/admin/role/detail/1', '/admin/user/1']) {
      const response = await page.goto(urlOf(path));
      statuses.push(`${path} → ${response?.status()}`);
    }
    note(statuses.join(' | '));
    const bad = statuses.filter((s) => !/→ (403|404|405|302)$/.test(s));
    test.fail(statuses.some((s) => /→ 500$/.test(s)), KNOWN.BAD_ID_500);
    expect(bad, 'every guessed id is refused (403 / 404), never shown and never a server error').toEqual([]);
  });
});
