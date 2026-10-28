import { test, expect } from '@fixtures/pages.fixtures';
import { requireDataCreatingTestsAllowed } from '@config/env';
import { MAX_LENGTH, POLICY_SOURCE, UPLOAD } from '@config/policy';
import { Browser, Page } from '@playwright/test';
import { AdminNewsListPage, ContentModule, NewsFormPage, NewsFormValues } from '@pages/admin/AdminNewsPages';
import { sheetTitle } from '@utils/caseTitles';
import { roleStamp } from '@utils/roleFlows';
import { AUTO_TEST_FLAG } from '@utils/testData';
import { drawImage, MB, paddedFile } from '@utils/uploadFiles';
import { cleanupItems, COVER_MESSAGE, itemExcerpt, itemTitle, note, publicDetailOf, saveItem, storedFiles, trackItemWhere } from './contentCases';

/**
 * The {MAX}/{MIN} cases of the content modules (KM-NEWS / KM-BP / KM-KNOW / KM-FKNO): a value of exactly the maximum
 * is saved and shown whole, the maximum + 1 is refused with a length message (or the input does not take it), and
 * no case ends in a server error. The sheets give no numbers — QA agreed on 2026-10-07 to use the OWASP-based
 * proposals in src/config/policy.ts until SA/Dev decide (docs/policy-assumptions.md).
 */
export type LimitCase = 'titleMax' | 'titleOver' | 'excerptMax' | 'excerptOver' | 'sourceMax' | 'sourceOver' | 'authorMax' | 'authorOver' | 'coverMax' | 'coverOver';

export interface LimitsSuite {
  module: ContentModule;
  prefix: string;
  ids: Partial<Record<LimitCase, string>>;
}

/** Thai text of exactly `length` characters starting with `head` (the stamp that finds the item again). */
export function textOfLength(head: string, length: number): string {
  if (head.length > length) throw new Error(`"${head}" is longer than ${length}`);
  return (head + ' ' + 'ทดสอบความยาวข้อความ'.repeat(Math.ceil(length / 19) + 1)).slice(0, length);
}

const LENGTH_MESSAGE = /ต้องไม่เกิน|ไม่เกิน\s*\d+|ยาวเกิน|ความยาว|\bvalidation\.max/;

/** Fields the server takes at any length (found 2026-10-07): the over-maximum case fails at "not saved". */
const UNLIMITED: Partial<Record<'title' | 'excerpt' | 'source' | 'authorName', string>> = {
  excerpt: 'Known bug (DEF-52): the excerpt has no length limit — 501 characters (proposed maximum 500) are saved.',
  source: 'Known bug (DEF-101): "แหล่งที่มา" has no length limit — 151 characters (proposed maximum 150) are saved.',
  authorName: 'Known bug (DEF-101): "ชื่อผู้เขียน" has no length limit — 101 characters (proposed maximum 100) are saved.',
};
const EXCERPT_HIDDEN = 'Known bug (DEF-87): the public detail page does not show the excerpt (its block is commented out in the HTML).';

export function contentLimitsSuite(cfg: LimitsSuite): void {
  const { module: M, prefix: P, ids } = cfg;
  const CREATES = `Saves ${M.key} items (deleted again after the case).`;
  const list = (page: Page): AdminNewsListPage => new AdminNewsListPage(page, M);
  const tcase = (key: LimitCase, body: (args: { page: Page; browser: Browser }, id: string) => Promise<void>): void => {
    const n = ids[key];
    if (!n) return;
    const id = `TC-${P}-${n}`;
    test(sheetTitle(id), async ({ page, browser }) => {
      requireDataCreatingTestsAllowed(CREATES);
      note(`Limit used: ${POLICY_SOURCE}`);
      await body({ page, browser }, id);
    });
  };

  test.beforeEach(() => test.setTimeout(180_000));
  test.afterEach(async ({ page }) => cleanupItems(page));

  /** Saves `values` with a field of exactly `max` characters: saved whole, shown whole, page not wider than the window. */
  async function atMax(page: Page, browser: Browser, id: string, field: 'title' | 'excerpt' | 'source' | 'authorName', max: number): Promise<void> {
    const stamp = roleStamp();
    const title = field === 'title' ? textOfLength(`AUTO_${stamp}`, max) : itemTitle(id);
    const excerpt = field === 'excerpt' ? textOfLength(`${AUTO_TEST_FLAG} ${stamp}`, max) : itemExcerpt();
    const value = field === 'title' ? title : field === 'excerpt' ? excerpt : textOfLength(stamp, max);
    trackItemWhere(M, (card) => card.title.includes(stamp) || card.excerpt.includes(stamp) || card.excerpt === excerpt);
    const values: NewsFormValues = { title, excerpt, [field]: value };
    const saved = await saveItem(page, M, id, values);
    note(`${field}: ${value.length} characters; save ${saved.submitted.first} → ${saved.submitted.final}`);
    expect(saved.submitted.final, 'no server error').toBeLessThan(500);
    expect(saved.submitted.first, `a ${field} of exactly ${max} characters is saved`).toBeLessThan(400);
    const card = await list(page).locate((c) => c.title.includes(stamp.slice(0, 8)) || c.excerpt.includes(stamp));
    expect(card, 'the item is listed').toBeTruthy();
    const form = new NewsFormPage(page, M);
    const input = field === 'title' ? form.titleInput : field === 'excerpt' ? form.excerptInput : form.form.locator(`input[name="${field === 'source' ? 'source' : 'author_name'}"]`);
    await form.openEdit((card as NonNullable<typeof card>).card.editHref);
    expect(await input.inputValue(), `the ${field} comes back whole`).toBe(value);
    const detail = await publicDetailOf(browser, M, { excerpt: field === 'excerpt' ? stamp : excerpt, title });
    note(`Public page overflow: ${detail.media.overflowX}px`);
    expect(detail.media.overflowX, 'the layout does not break (no sideways scroll)').toBeLessThanOrEqual(1);
    const shown = detail.text.replace(/\s+/g, ' ').includes(field === 'excerpt' ? value.slice(0, 60) : value.replace(/\s+/g, ' '));
    test.fail(field === 'excerpt' && !shown, EXCERPT_HIDDEN);
    expect(shown, `the public page shows the whole ${field}`).toBe(true);
  }

  /** `max` + 1 characters: refused with a length message, or the input takes at most `max`; never a server error. */
  async function overMax(page: Page, id: string, field: 'title' | 'excerpt' | 'source' | 'authorName', max: number): Promise<void> {
    const stamp = roleStamp();
    const value = field === 'title' ? textOfLength(`AUTO_${stamp}`, max + 1) : field === 'excerpt' ? textOfLength(`${AUTO_TEST_FLAG} ${stamp}`, max + 1) : textOfLength(stamp, max + 1);
    const title = field === 'title' ? value : itemTitle(id);
    const excerpt = field === 'excerpt' ? value : itemExcerpt();
    trackItemWhere(M, (card) => card.title.includes(stamp) || card.excerpt.includes(stamp) || card.excerpt === excerpt);
    const form = new NewsFormPage(page, M);
    await form.openCreate();
    const input = field === 'title' ? form.titleInput : field === 'excerpt' ? form.excerptInput : form.form.locator(`input[name="${field === 'source' ? 'source' : 'author_name'}"]`);
    const maxlength = await input.getAttribute('maxlength');
    note(`maxlength on the ${field} input: ${maxlength ?? '(none)'}`);
    if (maxlength && Number(maxlength) <= max) {
      await input.pressSequentially(value.slice(0, max) + 'ก', { delay: 0 }).catch(() => undefined);
      expect((await input.inputValue()).length, 'the input stops at the maximum').toBeLessThanOrEqual(max);
      return;
    }
    const saved = await saveItem(page, M, id, { title, excerpt, [field]: value });
    note(`${field}: ${value.length} characters; save ${saved.submitted.first} → ${saved.submitted.final} (${page.url()})`);
    expect(saved.submitted.final, 'no server error').toBeLessThan(500);
    const messages = await form.messages().catch(() => []);
    note(`Messages: ${messages.map((m) => m.text).join(' | ') || '(none)'}`);
    const card = await list(page).locate((c) => c.title.includes(stamp.slice(0, 8)) || c.excerpt.includes(stamp));
    test.fail(Boolean(card && UNLIMITED[field]), UNLIMITED[field]);
    expect(card, `${max + 1} characters are not saved`).toBeUndefined();
    expect(messages.some((m) => LENGTH_MESSAGE.test(m.text)), 'a message about the length').toBe(true);
    // The refusal works; the wording is checked last (a raw key is DEF-66).
    const raw = messages.some((m) => /\bvalidation\.[a-z_.]+/i.test(m.text));
    test.fail(raw, 'Known bug (DEF-66): the length is refused but the message is the raw key "validation.max.string".');
    expect(raw, 'a readable message, not a raw key').toBe(false);
  }

  tcase('titleMax', ({ page, browser }, id) => atMax(page, browser, id, 'title', MAX_LENGTH.title));
  tcase('titleOver', ({ page }, id) => overMax(page, id, 'title', MAX_LENGTH.title));
  tcase('excerptMax', ({ page, browser }, id) => atMax(page, browser, id, 'excerpt', MAX_LENGTH.excerpt));
  tcase('excerptOver', ({ page }, id) => overMax(page, id, 'excerpt', MAX_LENGTH.excerpt));
  tcase('sourceMax', ({ page, browser }, id) => atMax(page, browser, id, 'source', MAX_LENGTH.source));
  tcase('sourceOver', ({ page }, id) => overMax(page, id, 'source', MAX_LENGTH.source));
  tcase('authorMax', ({ page, browser }, id) => atMax(page, browser, id, 'authorName', MAX_LENGTH.authorName));
  tcase('authorOver', ({ page }, id) => overMax(page, id, 'authorName', MAX_LENGTH.authorName));

  tcase('coverMax', async ({ page }, id) => {
    const base = await drawImage(page, 'cover-max.png', { width: 1920, height: 1080, type: 'image/png' });
    const file = paddedFile(base, UPLOAD.imageMaxMB * MB, 'cover-max.png');
    const saved = await saveItem(page, M, id, { cover: file });
    trackItemWhere(M, (card) => card.excerpt === saved.excerpt);
    note(`Cover of exactly ${UPLOAD.imageMaxMB} MB: save ${saved.submitted.first} → ${saved.submitted.final}`);
    expect(saved.submitted.final, 'no server error').toBeLessThan(500);
    expect(saved.submitted.first, `a ${UPLOAD.imageMaxMB} MB cover is accepted`).toBeLessThan(400);
    expect((await storedFiles(page, M, saved.excerpt)).cover, 'the cover is saved').not.toBe('');
  });

  tcase('coverOver', async ({ page }, id) => {
    const base = await drawImage(page, 'cover-big.png', { width: 1920, height: 1080, type: 'image/png' });
    const file = paddedFile(base, UPLOAD.imageMaxMB * MB + 1024, 'cover-big.png');
    const saved = await saveItem(page, M, id, { cover: file });
    trackItemWhere(M, (card) => card.excerpt === saved.excerpt);
    note(`Cover of ${UPLOAD.imageMaxMB} MB + 1 KB: save ${saved.submitted.first} → ${saved.submitted.final}`);
    expect(saved.submitted.final, 'no server error / no timeout').toBeLessThan(500);
    const messages = await new NewsFormPage(page, M).messages().catch(() => []);
    note(`Messages: ${messages.map((m) => m.text).join(' | ') || '(none)'}`);
    expect(await list(page).findByExcerpt(saved.excerpt), 'the item is not saved with an oversized cover').toBeUndefined();
    expect(messages.some((m) => /ขนาด|MB|COVER/.test(m.text) || COVER_MESSAGE.test(m.text)), 'a message about the size').toBe(true);
  });
}
