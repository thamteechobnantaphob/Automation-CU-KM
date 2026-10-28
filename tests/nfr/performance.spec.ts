import type { Page, Response } from '@playwright/test';
import { test, expect, ANONYMOUS_SESSION } from '@fixtures/pages.fixtures';
import { env } from '@config/env';
import { mean, percentile } from '@utils/nfr';
import { urlOf } from '@utils/lowPrivilege';

/**
 * KM-NFR / SC-NFR-05 — response time, page weight, caching and compression. Read-only.
 *
 * The sheet leaves the limits TBD ("เสนอ 500 ms / 1 s", "ไม่เกิน 3 MB"); the values below are the ones proposed there
 * and agreed with the user on 2026-09-26. Change the constants, not the tests, when SA sets the real limits.
 */
const TTFB_AVG_MS = 500;
const TTFB_P95_MS = 1000;
const PAGE_WEIGHT_BYTES = 3 * 1024 * 1024;
const BIG_IMAGE_BYTES = 500 * 1024;

/** Text formats a server should compress. */
const COMPRESSIBLE = /(text\/|javascript|json|xml|svg)/i;

interface Asset {
  url: string;
  type: string;
  status: number;
  transfer: number;
  decoded: number;
  encoding: string;
  cacheControl: string;
  etag: string;
  lastModified: string;
  sameOrigin: boolean;
}

/** Loads `path` in a clean page and records every response with its transfer size and caching headers. */
async function loadAndMeasure(page: Page, path: string): Promise<Asset[]> {
  const origin = new URL(env.baseURL).origin;
  const pending: Array<Promise<Asset | null>> = [];
  const onResponse = (response: Response): void => {
    pending.push(
      (async () => {
        try {
          const sizes = await response.request().sizes();
          const headers = response.headers();
          const decoded = (await response.body().catch(() => Buffer.alloc(0))).length;
          return {
            url: response.url(),
            type: headers['content-type'] ?? '',
            status: response.status(),
            transfer: sizes.responseBodySize + sizes.responseHeadersSize,
            decoded,
            encoding: headers['content-encoding'] ?? '',
            cacheControl: headers['cache-control'] ?? '',
            etag: headers.etag ?? '',
            lastModified: headers['last-modified'] ?? '',
            sameOrigin: new URL(response.url()).origin === origin,
          };
        } catch {
          return null;
        }
      })(),
    );
  };
  page.on('response', onResponse);
  try {
    await page.goto(urlOf(path), { waitUntil: 'networkidle' });
    await page.waitForTimeout(1_500);
  } finally {
    page.off('response', onResponse);
  }
  return (await Promise.all(pending)).filter((asset): asset is Asset => asset !== null);
}

const kb = (bytes: number): string => `${Math.round(bytes / 1024)} KB`;

test.describe('SC-NFR-05 ประสิทธิภาพและความเสถียร', () => {
  test('TC-NFR-05-01 [Medium] เวลาตอบสนอง TTFB ของหน้าสำคัญ', async ({ browser, page }) => {
    test.setTimeout(240_000);
    const targets = [
      { path: '/', scope: 'public' },
      { path: '/frontend/search/index', scope: 'public' },
      { path: '/admin/dashboard/index', scope: 'admin' },
    ] as const;
    const ttfb = async (target: Page, path: string): Promise<number> => {
      await target.goto(urlOf(path), { waitUntil: 'load' });
      return target.evaluate(() => {
        const navigation = performance.getEntriesByType('navigation')[0] as PerformanceNavigationTiming;
        return navigation.responseStart - navigation.startTime;
      });
    };

    const anonymous = await browser.newContext({ storageState: ANONYMOUS_SESSION });
    const summary: string[] = [];
    try {
      const publicPage = await anonymous.newPage();
      for (const { path, scope } of targets) {
        const samples: number[] = [];
        for (let run = 0; run < 10; run++) samples.push(await ttfb(scope === 'public' ? publicPage : page, path));
        const average = mean(samples);
        const p95 = percentile(samples, 95);
        summary.push(`${path}: avg ${Math.round(average)} ms, P95 ${Math.round(p95)} ms (limits ${TTFB_AVG_MS} / ${TTFB_P95_MS})`);
        expect(average, `${path}: average TTFB over 10 loads`).toBeLessThanOrEqual(TTFB_AVG_MS);
        expect(p95, `${path}: P95 TTFB over 10 loads`).toBeLessThanOrEqual(TTFB_P95_MS);
      }
    } finally {
      await anonymous.close();
    }
    test.info().annotations.push({ type: 'note', description: `10 loads each, LAN to Dev. ${summary.join(' | ')}` });
  });

  test('TC-NFR-05-02 [Low] น้ำหนักหน้าและการเพิ่มประสิทธิภาพรูป', async ({ browser }) => {
    test.setTimeout(240_000);
    const pages = ['/', '/frontend/news/index', '/frontend/knowledge/index', '/frontend/cops/index'];
    const heavy: string[] = [];
    const bigImages = new Set<string>();
    const summary: string[] = [];
    let external = '';
    let lazy = '';

    for (const path of pages) {
      const context = await browser.newContext({ storageState: ANONYMOUS_SESSION });
      try {
        const page = await context.newPage();
        const assets = await loadAndMeasure(page, path);
        const total = assets.reduce((sum, asset) => sum + asset.transfer, 0);
        summary.push(`${path}: ${(total / 1024 / 1024).toFixed(1)} MB in ${assets.length} requests`);
        if (total > PAGE_WEIGHT_BYTES) heavy.push(`${path}: ${(total / 1024 / 1024).toFixed(1)} MB`);
        for (const asset of assets.filter((entry) => /image\/(png|jpe?g|gif|bmp)/i.test(entry.type) && entry.transfer > BIG_IMAGE_BYTES)) {
          bigImages.add(`${new URL(asset.url).pathname.split('/').pop()} ${kb(asset.transfer)}${asset.sameOrigin ? '' : ` (hot-linked from ${new URL(asset.url).host})`}`);
        }
        if (path === '/') {
          external = [...new Set(assets.filter((asset) => !asset.sameOrigin).map((asset) => new URL(asset.url).host))].join(', ');
          const modes = await page.evaluate(() => [...document.images].map((image) => image.loading));
          lazy = `${modes.filter((mode) => mode === 'lazy').length} of ${modes.length} images on the home page use loading="lazy"`;
        }
      } finally {
        await context.close();
      }
    }

    test.info().annotations.push({
      type: 'note',
      description: `Weight (transfer, cold cache): ${summary.join(' | ')}. Raster images over ${kb(BIG_IMAGE_BYTES)}: ${[...bigImages].join(', ') || 'none'}. Third-party hosts on the home page: ${external}. ${lazy}.`,
    });
    // KNOWN BUG: the home page transfers ~6.3 MB (a 3.3 MB PNG hero, two ~0.8 MB PNG backgrounds, a 1.7 MB SVG mascot, an image hot-linked from another site); list pages are ~2.6 MB.
    test.fail(heavy.length > 0 || bigImages.size > 0, 'Known bug (DEF-43): the home page is ~6.3 MB (3.3 MB PNG hero, 0.8 MB PNG backgrounds, 1.7 MB SVG, a hot-linked image) — over the 3 MB limit; images are not optimised or lazy-loaded.');
    expect(heavy, `every page transfers at most ${PAGE_WEIGHT_BYTES / 1024 / 1024} MB`).toEqual([]);
    expect([...bigImages], `no raster image is larger than ${kb(BIG_IMAGE_BYTES)}`).toEqual([]);
  });

  test('TC-NFR-05-03 [Low] Caching และการบีบอัดของ static assets', async ({ browser }) => {
    test.setTimeout(120_000);
    const context = await browser.newContext({ storageState: ANONYMOUS_SESSION });
    const problems: string[] = [];
    const summary = new Map<string, { count: number; cache: Set<string>; encodings: Set<string> }>();
    try {
      const assets = (await loadAndMeasure(await context.newPage(), '/')).filter((asset) => asset.sameOrigin && asset.status === 200);
      const statics = assets.filter((asset) => /(css|javascript|image|font|woff)/i.test(asset.type) || /\.(css|js|png|jpe?g|svg|woff2?|ttf|ico)(\?|$)/i.test(asset.url));
      expect(statics.length, 'the home page loads static assets').toBeGreaterThan(5);

      for (const asset of statics) {
        const kind = /css/i.test(asset.type) ? 'css' : /javascript/i.test(asset.type) ? 'js' : /image/i.test(asset.type) ? 'image' : 'font';
        const entry = summary.get(kind) ?? { count: 0, cache: new Set<string>(), encodings: new Set<string>() };
        entry.count++;
        entry.cache.add(asset.cacheControl || '—');
        entry.encodings.add(asset.encoding || 'none');
        summary.set(kind, entry);

        const name = new URL(asset.url).pathname;
        const maxAge = Number(/max-age=(\d+)/i.exec(asset.cacheControl)?.[1] ?? 0);
        if (!(maxAge > 0 || /immutable/i.test(asset.cacheControl))) problems.push(`${name}: no cache lifetime (Cache-Control: "${asset.cacheControl || 'none'}")`);
        if (!asset.etag && !asset.lastModified) problems.push(`${name}: no ETag / Last-Modified to revalidate with`);
        if (COMPRESSIBLE.test(asset.type) && asset.decoded > 1024 && !/gzip|br|zstd|deflate/i.test(asset.encoding)) problems.push(`${name}: ${asset.type.split(';')[0]} ${kb(asset.decoded)} sent uncompressed`);
      }
    } finally {
      await context.close();
    }
    test.info().annotations.push({
      type: 'note',
      description: [...summary.entries()].map(([kind, entry]) => `${kind} ×${entry.count}: Cache-Control ${[...entry.cache].join(' / ')}, encoding ${[...entry.encodings].join('/')}`).join(' | '),
    });
    expect(problems, 'static assets are cacheable and text assets are compressed').toEqual([]);
  });
});
