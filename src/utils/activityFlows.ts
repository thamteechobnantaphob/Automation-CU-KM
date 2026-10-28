import path from 'path';
import { Browser, expect, Page, test } from '@playwright/test';
import { ANONYMOUS_SESSION } from '@fixtures/pages.fixtures';
import { AdminActivityPage, AlbumCard, AlbumValues } from '@pages/admin/AdminActivityPage';
import { Submitted, submitAndFollow } from '@pages/admin/AdminNewsPages';
import { urlOf } from '@utils/lowPrivilege';
import { roleStamp } from '@utils/roleFlows';
import { collectDialogs } from '@utils/security';
import { AUTO_TEST_FLAG } from '@utils/testData';

/**
 * Shared steps for the album specs (KM-ADMA / KM-FALB). Every album a case saves is deleted again by the same case,
 * found by the "[Auto Test]" marker + stamp it carries in its description (or its title when the description is under
 * test). Albums without the marker (e.g. QA's "ทดสอบ" / "test" on Dev) are never touched.
 */

/** A 1200 × 675 PNG (the size the panel asks for: width 1,000–1,200 px). */
export const ALBUM_IMAGE = path.join(__dirname, '..', '..', 'tests', 'fixtures', 'auto-cover.png');

/** "[Auto Test] อัลบัมทดสอบอัตโนมัติ <stamp>" — unique per call ("[Auto Test] <stamp>" with an empty label). */
export function albumMarker(label = 'อัลบัมทดสอบอัตโนมัติ'): string {
  return [AUTO_TEST_FLAG, label, roleStamp()].filter(Boolean).join(' ');
}

/** Opens the add panel, fills it (one image and status publish unless given) and saves. */
export async function submitAlbum(page: Page, values: AlbumValues): Promise<Submitted> {
  const activity = new AdminActivityPage(page);
  await activity.open();
  await activity.openAddForm();
  await activity.fill({ images: [ALBUM_IMAGE], status: 'publish', ...values });
  return activity.save();
}

/** Deletes every album that matches (marker required). Never throws; returns how many went. */
export async function deleteAlbumsWhere(page: Page, match: (card: AlbumCard) => boolean): Promise<number> {
  const activity = new AdminActivityPage(page);
  let deleted = 0;
  for (let attempt = 0; attempt < 8; attempt++) {
    try {
      if (!(await activity.find(match))) break;
      const dialog = await activity.openDeleteDialog(match);
      const result = await submitAndFollow(page, () => dialog.confirm());
      if (result.first >= 400 || result.final >= 400) break;
      deleted++;
    } catch {
      break;
    }
  }
  return deleted;
}

export interface PanelError {
  text: string;
  /** Whether the admin can see it (a red text inside the closed panel cannot be seen). */
  visible: boolean;
}

/** Validation texts on the page after a save (the panel's width hint left out), with their visibility. */
export async function panelErrors(page: Page): Promise<PanelError[]> {
  return page.locator('#activityMod .text-xsmall, #activityMod .invalid-feedback, #activityMod .text-danger, .alert-danger').evaluateAll((elements) =>
    elements
      .map((e) => ({ text: (e.textContent ?? '').replace(/\s+/g, ' ').trim(), visible: (e as HTMLElement).offsetParent !== null && getComputedStyle(e).visibility === 'visible' }))
      .filter((e) => e.text && !e.text.includes('ความกว้างภาพ')),
  );
}

export const byDescription =(description: string) => (card: AlbumCard): boolean => card.editDescription === description;

/**
 * Saves an album (description = a fresh marker unless given; one image), runs `checks`, then deletes it. Pass `match`
 * when the description is under test (put the marker in the title then). Writes a "Cleanup: …" note.
 */
export async function withAlbum(
  page: Page,
  values: AlbumValues,
  checks: (description: string, saved: Submitted, errors: PanelError[]) => Promise<void>,
  match?: (card: AlbumCard) => boolean,
): Promise<void> {
  const description = values.description ?? albumMarker();
  try {
    const saved = await submitAlbum(page, { ...values, description });
    // Read the messages on the page the post landed on — before any check reloads the list.
    const errors = await panelErrors(page);
    expect(saved.final, 'saving is not a server error').toBeLessThan(500);
    await checks(description, saved, errors);
  } finally {
    const deleted = await deleteAlbumsWhere(page, match ?? byDescription(description));
    test.info().annotations.push({ type: 'note', description: `Cleanup: deleted ${deleted} album(s).` });
  }
}

export interface PublicAlbum {
  title: string;
  description: string;
  counters: number[];
  href: string;
  image: string;
  /** Whether the card image actually loaded (naturalWidth > 0). */
  imageLoaded: boolean;
}

export interface PublicActivity {
  status: number;
  /** "ทั้งหมด n อัลบัม" → n. */
  total: number | null;
  albums: PublicAlbum[];
  html: string;
  dialogs: string[];
}

/** /frontend/activity/index as a visitor sees it. */
export async function publicActivity(browser: Browser): Promise<PublicActivity> {
  const context = await browser.newContext({ storageState: ANONYMOUS_SESSION });
  try {
    const page = await context.newPage();
    const dialogs = collectDialogs(page);
    const response = await page.goto(urlOf('/frontend/activity/index'));
    await page.waitForLoadState('load');
    await page.waitForTimeout(300);
    const total = /ทั้งหมด\s*(\d+)\s*อัลบัม/.exec((await page.locator('.body-content').innerText()).replace(/\s+/g, ' '));
    return {
      status: response?.status() ?? 0,
      total: total ? Number(total[1]) : null,
      albums: await page.locator('.body-content a.card').evaluateAll((cards) =>
        cards.map((card) => {
          const img = card.querySelector('img.img-fluid, img.act-h-100') as HTMLImageElement | null;
          return {
            title: (card.querySelector('.card-title')?.textContent ?? '').replace(/\s+/g, ' ').trim(),
            description: (card.querySelector('.card-text')?.textContent ?? '').replace(/\s+/g, ' ').trim(),
            counters: [...card.querySelectorAll('.text-small')].map((s) => Number((s.textContent ?? '').trim()) || 0),
            href: card.getAttribute('href') ?? '',
            image: img?.getAttribute('src') ?? '',
            imageLoaded: !!img && img.complete && img.naturalWidth > 0,
          };
        }),
      ),
      html: await page.locator('.body-content').innerHTML(),
      dialogs,
    };
  } finally {
    await context.close();
  }
}

/** An album's public detail page (opened from its card) as a visitor sees it. */
export async function publicAlbumDetail(browser: Browser, href: string): Promise<{ status: number; text: string; images: string[]; dialogs: string[] }> {
  const context = await browser.newContext({ storageState: ANONYMOUS_SESSION });
  try {
    const page = await context.newPage();
    const dialogs = collectDialogs(page);
    const response = await page.goto(href);
    await page.waitForLoadState('load');
    await page.waitForTimeout(300);
    return {
      status: response?.status() ?? 0,
      text: (await page.locator('.body-content').innerText()).replace(/\s+/g, ' '),
      images: await page.locator('.body-content img').evaluateAll((imgs) => imgs.map((i) => i.getAttribute('src') ?? '').filter((src) => /\/storage\//.test(src))),
      dialogs,
    };
  } finally {
    await context.close();
  }
}
