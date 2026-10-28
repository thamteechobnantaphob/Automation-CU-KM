import { Page } from '@playwright/test';
import { test, expect } from '@fixtures/pages.fixtures';
import { env } from '@config/env';
import { LoginPage } from '@pages/LoginPage';
import { urlOf } from '@utils/lowPrivilege';
import { rawGet } from '@utils/rawHttp';
import {
  ADMIN_PAGES,
  collectDialogs,
  CRLF_PAYLOAD,
  discoverProbes,
  Probe,
  PUBLIC_SECURITY_PAGES,
  rowsIn,
  SQL_ERROR_PATTERN,
  SQLI_PAYLOADS,
  withParam,
  XSS_PAYLOADS,
} from '@utils/security';

/**
 * KM-SEC / SC-SEC-01 — injection and XSS through URL parameters and the login
 * form (TC-SEC-01-02, -03, -04, -06). GET-only apart from the login attempts;
 * nothing is created. "Every parameter" = the fields of each page's GET forms
 * (search boxes, filters), `page`, and a few common names (see security.ts).
 *
 * Not here: TC-SEC-01-01/-05/-08 (stored payloads in every text field) — those
 * save data and live in stored-injection.spec.ts.
 */

const EMPTY_SESSION = { cookies: [], origins: [] };

/** Opens `url` and reports whether a script ran (dialog) or the payload became an element. */
async function executes(page: Page, url: string, dialogs: string[]): Promise<string | null> {
  dialogs.length = 0;
  await page.goto(url);
  await page.waitForLoadState('load');
  await page.waitForTimeout(200);
  const rendered = await page.locator('img[src="x"], svg[onload]').count();
  if (dialogs.length) return `a script ran (${dialogs.join('; ')})`;
  if (rendered) return `the payload was rendered as ${rendered} element(s)`;
  return null;
}

test.describe('SC-SEC-01 Injection และ XSS (URL parameter)', () => {
  test('TC-SEC-01-02 [High] Reflected XSS ผ่านพารามิเตอร์ URL', async ({ request, playwright, browser, page }) => {
    test.setTimeout(600_000);
    const anonymous = await playwright.request.newContext({ baseURL: env.baseURL });
    const publicContext = await browser.newContext({ storageState: EMPTY_SESSION });
    try {
      const probes = await discoverProbes(anonymous, request);
      const problems: string[] = [];
      const reflected: Array<{ probe: Probe; url: string }> = [];
      let sent = 0;

      for (const probe of probes) {
        for (const param of probe.params) {
          for (const payload of XSS_PAYLOADS) {
            const url = withParam(probe.path, param, payload);
            const body = await (await probe.ctx.get(url)).text();
            sent++;
            if (body.includes(payload)) problems.push(`${probe.path}?${param}= echoes ${payload} unescaped`);
            else if (body.includes('alert(1)')) reflected.push({ probe, url });
          }
        }
      }

      // Escaped echoes are fine on paper; confirm in a real browser that nothing runs.
      const publicPage = await publicContext.newPage();
      const dialogsPublic = collectDialogs(publicPage);
      const dialogsAdmin = collectDialogs(page);
      for (const { probe, url } of reflected) {
        const verdict = await executes(probe.area === 'public' ? publicPage : page, urlOf(url), probe.area === 'public' ? dialogsPublic : dialogsAdmin);
        if (verdict) problems.push(`${url}: ${verdict}`);
      }

      test.info().annotations.push({
        type: 'note',
        description: `${sent} requests (${XSS_PAYLOADS.length} payloads) over ${probes.length} pages / ${probes.reduce((n, p) => n + p.params.length, 0)} parameters; ${reflected.length} echoed in escaped form and were re-checked in a browser.`,
      });
      expect(problems, 'no parameter may echo a payload as live HTML/script').toEqual([]);
    } finally {
      await publicContext.close();
      await anonymous.dispose();
    }
  });

  test('TC-SEC-01-03 [Medium] DOM XSS ผ่าน URL fragment', async ({ browser, page }) => {
    test.setTimeout(300_000);
    const publicContext = await browser.newContext({ storageState: EMPTY_SESSION });
    try {
      const publicPage = await publicContext.newPage();
      const fragment = '#<img src=x onerror=alert(1)>';
      const query = `?q=${encodeURIComponent('<img src=x onerror=alert(1)>')}`;
      const problems: string[] = [];

      for (const [target, paths] of [
        [publicPage, PUBLIC_SECURITY_PAGES],
        [page, ADMIN_PAGES],
      ] as Array<[Page, readonly string[]]>) {
        const dialogs = collectDialogs(target);
        for (const path of paths) {
          // Query AND fragment on load, then change the hash afterwards (a `hashchange` handler would run then).
          let verdict = await executes(target, urlOf(`${path}${query}${fragment}`), dialogs);
          if (!verdict) {
            await target.evaluate(() => {
              location.hash = '#<svg onload=alert(1)>';
            });
            await target.waitForTimeout(250);
            if (dialogs.length) verdict = `a script ran after the hash changed (${dialogs.join('; ')})`;
            else if ((await target.locator('img[src="x"], svg[onload]').count()) > 0) verdict = 'the fragment was written into the page as HTML';
          }
          if (verdict) problems.push(`${path}: ${verdict}`);
        }
      }
      expect(problems, 'the URL query/fragment must never be written into the DOM as HTML').toEqual([]);
    } finally {
      await publicContext.close();
    }
  });

  test('TC-SEC-01-04 [High] SQL Injection ทุกช่องและพารามิเตอร์', async ({ request, playwright, browser }) => {
    test.setTimeout(900_000);
    const anonymous = await playwright.request.newContext({ baseURL: env.baseURL });
    try {
      const probes = await discoverProbes(anonymous, request);
      const problems: string[] = [];
      const serverErrors: string[] = [];
      let sent = 0;

      for (const probe of probes) {
        const started = Date.now();
        const baseline = await probe.ctx.get(probe.path);
        const baselineMs = Date.now() - started;
        const baselineRows = rowsIn(await baseline.text());

        for (const param of probe.params) {
          for (const payload of SQLI_PAYLOADS) {
            const url = withParam(probe.path, param, payload);
            const begun = Date.now();
            const response = await probe.ctx.get(url, { timeout: 30_000 });
            const body = await response.text();
            const elapsed = Date.now() - begun;
            sent++;
            if (SQL_ERROR_PATTERN.test(body)) problems.push(`${url}: the response shows a SQL/server error`);
            if (elapsed - baselineMs > 4_000) problems.push(`${url}: took ${elapsed} ms vs ${baselineMs} ms without the payload (time-based injection?)`);
            if (rowsIn(body) > baselineRows) problems.push(`${url}: returned more rows (${rowsIn(body)}) than the unfiltered page (${baselineRows})`);
            if (response.status() >= 500) serverErrors.push(`${response.status()} ${url}`);
          }
        }
      }

      // The login form: nothing may let the payload in, leak an error, or wait.
      const context = await browser.newContext({ storageState: EMPTY_SESSION });
      try {
        const page = await context.newPage();
        const login = new LoginPage(page);
        const attempt = async (username: string, password: string): Promise<{ outcome: string; ms: number; text: string }> => {
          await login.open();
          const begun = Date.now();
          await login.login(username, password);
          const outcome = await Promise.race([
            page.waitForURL((url) => !url.pathname.includes('/frontend/account/index'), { timeout: 20_000 }).then(() => 'signed-in', () => 'none'),
            page.getByText('ชื่อผู้ใช้งานหรือรหัสผ่านไม่ถูกต้อง').waitFor({ timeout: 20_000 }).then(() => 'rejected', () => 'none'),
          ]);
          return { outcome, ms: Date.now() - begun, text: await page.locator('body').innerText() };
        };
        const control = await attempt('qa_auto_nobody', 'x');
        const attempts: Array<[string, string]> = [
          ["' OR '1'='1", 'x'],
          ["qa_auto_nobody'; SELECT SLEEP(5)--", 'x'],
          ['qa_auto_nobody', "' OR '1'='1"],
        ];
        for (const [username, password] of attempts) {
          const result = await attempt(username, password);
          const label = `login as ${JSON.stringify(username)} / ${JSON.stringify(password)}`;
          if (result.outcome === 'signed-in') problems.push(`${label}: SIGNED IN — authentication bypassed`);
          if (SQL_ERROR_PATTERN.test(result.text)) problems.push(`${label}: the page shows a SQL/server error`);
          if (result.ms - control.ms > 4_000) problems.push(`${label}: took ${result.ms} ms vs ${control.ms} ms for a normal wrong login`);
        }
      } finally {
        await context.close();
      }

      test.info().annotations.push({
        type: 'note',
        description: `${sent} requests (${SQLI_PAYLOADS.length} payloads) over ${probes.length} pages, plus 3 login attempts. HTTP 5xx answers (not SQL error text): ${serverErrors.length ? serverErrors.slice(0, 6).join(' | ') : 'none'}.`,
      });
      expect(problems, 'no SQL error text, no extra data, no delay, no login bypass').toEqual([]);
    } finally {
      await anonymous.dispose();
    }
  });

  test('TC-SEC-01-06 [Medium] Header/CRLF Injection', async () => {
    test.setTimeout(300_000);
    const paths = [...PUBLIC_SECURITY_PAGES, '/admin/dashboard/index'];
    const params = ['redirect', 'next', 'return', 'return_url', 'returnUrl', 'url', 'lang', 'locale', 'page', 'q', 'keyword', 'callback'];
    const targets = [
      ...paths.flatMap((path) => params.map((param) => `${path}?${param}=x${CRLF_PAYLOAD}`)),
      `/frontend/cops/x${CRLF_PAYLOAD}/index`,
      `/${CRLF_PAYLOAD}`,
    ];

    const problems: string[] = [];
    for (const target of targets) {
      const response = await rawGet(target);
      const cookies = response.headers['set-cookie'] ?? [];
      if (cookies.some((cookie) => /^x=1/.test(cookie)) || 'x' in response.headers) {
        problems.push(`${target} → a header was injected (${cookies.filter((c) => /^x=1/.test(c)).join(', ') || 'header "x"'})`);
      }
    }
    test.info().annotations.push({ type: 'note', description: `${targets.length} requests with ${CRLF_PAYLOAD} in ${params.length} parameter names, on ${paths.length} pages and in the path.` });
    expect(problems, 'no response header may be injected through a parameter or path').toEqual([]);
  });
});
