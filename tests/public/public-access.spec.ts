import { test, expect, ANONYMOUS_SESSION } from '@fixtures/pages.fixtures';
import { PageDiagnostics } from '@utils/pageDiagnostics';
import { PUBLIC_PAGES } from '@utils/publicPages';

/**
 * KM-FEH / SC-FEH-03 — every public page, checked as an anonymous visitor.
 * Each case is data-driven over PUBLIC_PAGES: problems from all pages are
 * collected and reported together instead of stopping at the first one.
 */
test.use({ storageState: ANONYMOUS_SESSION });

test.describe('SC-FEH-03 การเข้าถึงและข้อมูลพื้นฐานของหน้า Public', () => {
  test('TC-FEH-03-01 [High] ทุกหน้า Public เข้าถึงได้โดยไม่ต้อง Login', async ({ page, publicPage }) => {
    const problems: string[] = [];

    for (const { path } of PUBLIC_PAGES) {
      const response = await publicPage.goto(path);
      const landedOn = new URL(page.url()).pathname;

      if (response?.status() !== 200) problems.push(`${path}: HTTP ${response?.status()}`);
      else if (landedOn !== path) problems.push(`${path}: redirected to ${landedOn}`);
      else if (await page.locator("input[type='password']").count()) problems.push(`${path}: shows a login form`);
      else if (!(await page.title()).trim()) problems.push(`${path}: page has no content/title`);
    }

    expect(problems).toEqual([]);
  });

  test('TC-FEH-03-02 [Low] Title, meta และภาษาของหน้า', async ({ page, publicPage, request }) => {
    // The favicon <link> pointed to a missing /image/logo.ico until the 2026-10-01 deploy (fixed, passed that day).
    test.setTimeout(120_000); // ten pages, each waiting for the page loader

    const problems: string[] = [];
    const pathsByTitle = new Map<string, string[]>();
    const withoutDescription: string[] = [];
    const checkedFavicons = new Set<string>();

    for (const { path } of PUBLIC_PAGES) {
      await publicPage.goto(path);
      const info = await page.evaluate(() => ({
        title: document.title.trim(),
        lang: document.documentElement.lang,
        description: document.querySelector('meta[name="description"]')?.getAttribute('content')?.trim() ?? '',
        favicon: (document.querySelector('link[rel~="icon"]') as HTMLLinkElement | null)?.href ?? '',
      }));

      if (!info.title) problems.push(`${path}: empty <title>`);
      pathsByTitle.set(info.title, [...(pathsByTitle.get(info.title) ?? []), path]);
      if (info.lang !== 'th') problems.push(`${path}: <html lang="${info.lang}"> (expected "th")`);
      if (!info.description) withoutDescription.push(path);

      if (!info.favicon) problems.push(`${path}: no favicon <link>`);
      else if (!checkedFavicons.has(info.favicon)) {
        checkedFavicons.add(info.favicon);
        const icon = await request.get(info.favicon);
        if (!icon.ok()) problems.push(`favicon ${info.favicon} → HTTP ${icon.status()}`);
      }
    }
    for (const [title, paths] of pathsByTitle) {
      if (title && paths.length > 1) problems.push(`title "${title}" is shared by ${paths.join(', ')}`);
    }

    // The sheet's script mentions <meta description> but its expected result
    // does not require one, so a missing description is noted, not failed.
    if (withoutDescription.length) {
      test.info().annotations.push({
        type: 'note',
        description: `No <meta name="description"> on: ${withoutDescription.join(', ')}`,
      });
    }
    expect(problems).toEqual([]);
  });

  test('TC-FEH-03-03 [Medium] ไม่มี error ใน Console และไม่มี request ล้มเหลว', async ({ page, publicPage }) => {
    test.setTimeout(120_000); // ten pages, each waiting for the page loader and network idle
    // KNOWN BUG — confirmed 2026-09-25: GET /image/bg.png → 404 on the home
    // page, and the news list's cover image (/storage/contents/covers/….png)
    // → 404. Every other public page is clean.
    test.fail(true, 'Known bug: missing static files — /image/bg.png (home) and a news cover image return HTTP 404.');

    const problems: string[] = [];
    for (const { path } of PUBLIC_PAGES) {
      const diagnostics = new PageDiagnostics(page);
      await publicPage.open(path);
      await page.waitForLoadState('networkidle');
      problems.push(...diagnostics.problems.map((problem) => `${path}: ${problem}`));
    }

    expect(problems).toEqual([]);
  });

  test('TC-FEH-03-04 [Medium] ผู้เยี่ยมชมต้องไม่เห็นลิงก์หรือเมนูของ admin', async ({ page, publicPage }) => {
    test.setTimeout(120_000); // ten pages, each waiting for the page loader
    const problems: string[] = [];

    for (const { path } of PUBLIC_PAGES) {
      await publicPage.goto(path);
      const adminTargets = await page.locator('a[href*="/admin"], form[action*="/admin"]').count();
      if (adminTargets) problems.push(`${path}: ${adminTargets} link/form pointing at /admin`);
      if (/\/admin\b/i.test(await page.locator('body').innerText())) problems.push(`${path}: visible text mentions /admin`);
    }

    expect(problems).toEqual([]);
  });
});
