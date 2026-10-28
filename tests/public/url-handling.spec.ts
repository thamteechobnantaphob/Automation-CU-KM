import { test, expect, ANONYMOUS_SESSION } from '@fixtures/pages.fixtures';
import { rawGet } from '@utils/rawHttp';
import { longString } from '@utils/strings';
import { PUBLIC_LIST_PATHS, SERVER_LEAK_PATTERN } from '@utils/publicPages';

/**
 * KM-FEH / SC-FEH-04 (+ TC-FEC-01-04) — malformed URLs and parameters on the
 * public site. These are plain HTTP checks (status code + body), so they use
 * the `request` fixture instead of a browser; path-traversal cases use Node's
 * http module because browsers normalise "../" away before sending.
 * Read-only.
 */
test.use({ storageState: ANONYMOUS_SESSION });

test.describe('SC-FEH-04 พารามิเตอร์ URL และการแบ่งหน้า (Public)', () => {
  test('TC-FEH-04-01 [High] รหัสในเส้นทางไม่ถูกต้อง (id ไม่มี/ไม่ใช่ตัวเลข/มี SQL)', async ({ request }) => {
    // KNOWN BUG — confirmed 2026-09-25: community ids in the URL are opaque
    // encrypted tokens. Purely numeric bad ids ("0", "-1") get a clean 404,
    // but any other malformed value ("abc", SQL text, an unknown token)
    // makes the server throw → HTTP 500 "Server Error".
    test.fail(true, 'Known bug: a malformed community id ("abc", SQL text) returns HTTP 500 instead of 404.');

    const paths = [
      '/frontend/cops/abc/index',
      '/frontend/cops/0/index',
      '/frontend/cops/-1/index',
      "/frontend/cops/1'%20OR%20'1'='1/index",
    ];
    const problems: string[] = [];
    for (const path of paths) {
      const response = await request.get(path, { maxRedirects: 0 });
      if (![400, 404].includes(response.status())) problems.push(`${path} → HTTP ${response.status()} (expected 404)`);
      else if (SERVER_LEAK_PATTERN.test(await response.text())) problems.push(`${path} → response leaks server details`);
    }

    expect(problems).toEqual([]);
  });

  test('TC-FEH-04-02 [Medium] พารามิเตอร์ ?page ไม่ถูกต้อง', async ({ request }) => {
    // None of the public lists is paginated with today's data, so today this
    // proves "no crash"; it starts checking real paging once lists grow.
    const problems: string[] = [];
    for (const path of PUBLIC_LIST_PATHS) {
      for (const page of ['0', '-1', 'abc', '999999']) {
        const response = await request.get(`${path}?page=${page}`, { maxRedirects: 0 });
        const body = await response.text();
        if (response.status() >= 500) problems.push(`${path}?page=${page} → HTTP ${response.status()}`);
        else if (SERVER_LEAK_PATTERN.test(body)) problems.push(`${path}?page=${page} → response leaks server details`);
      }
    }

    expect(problems).toEqual([]);
  });

  test('TC-FEH-04-04 [Low] พารามิเตอร์ซ้ำและค่ายาวมาก', async ({ request }) => {
    const urls = [
      '/frontend/search/index?keyword=a&keyword=b',
      `/frontend/search/index?keyword=${longString(5000, 'x')}`,
    ];
    const problems: string[] = [];
    for (const url of urls) {
      const response = await request.get(url, { maxRedirects: 0 });
      // Any handled outcome (page, 400, 414…) is fine — only a crash is not.
      if (response.status() >= 500) problems.push(`${url.slice(0, 60)}… → HTTP ${response.status()}`);
      else if (SERVER_LEAK_PATTERN.test(await response.text())) problems.push(`${url.slice(0, 60)}… → response leaks server details`);
    }

    expect(problems).toEqual([]);
  });

  test('TC-FEH-04-05 [Low] ตัวพิมพ์ใหญ่-เล็กและเครื่องหมาย / ท้าย URL', async ({ request }) => {
    const problems: string[] = [];
    for (const path of ['/Frontend/Cops/Index', '/frontend/cops/index/']) {
      const response = await request.get(path, { maxRedirects: 0 });
      const status = response.status();
      if (status >= 500) problems.push(`${path} → HTTP ${status}`);
      else if ([301, 302, 307, 308].includes(status) && !/\/frontend\/cops\/index\/?$/.test(response.headers()['location'] ?? '')) {
        problems.push(`${path} → redirects to ${response.headers()['location']} (expected the canonical URL)`);
      }
    }

    expect(problems).toEqual([]);
  });

  test('TC-FEH-04-06 [High] Path traversal และ URL encoding', async () => {
    const paths = ['/frontend/../../etc/passwd', '/frontend/%2e%2e/%2e%2e/etc/passwd', '/frontend/cops/1%00'];
    const problems: string[] = [];
    for (const path of paths) {
      const response = await rawGet(path);
      if (![400, 403, 404].includes(response.status)) problems.push(`${path} → HTTP ${response.status}`);
      else if (SERVER_LEAK_PATTERN.test(response.body)) problems.push(`${path} → response leaks server details/files`);
    }

    expect(problems).toEqual([]);
  });
});

test.describe('SC-FEC-01 รายการและรายละเอียดชุมชน', () => {
  test('TC-FEC-01-04 [Medium] เข้า URL ชุมชนที่ไม่มีอยู่จริง', async ({ request }) => {
    // KNOWN BUG — same root cause as TC-FEH-04-01: an unknown community id
    // is not a clean 404, it is HTTP 500.
    test.fail(true, 'Known bug: an unknown community id (…/cops/99999/index) returns HTTP 500 instead of 404.');

    const response = await request.get('/frontend/cops/99999/index', { maxRedirects: 0 });
    expect([400, 404], `HTTP ${response.status()}`).toContain(response.status());
    expect(await response.text()).not.toMatch(SERVER_LEAK_PATTERN);
  });
});
