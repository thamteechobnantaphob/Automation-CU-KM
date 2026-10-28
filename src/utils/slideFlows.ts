import path from 'path';
import { Browser, expect, Page, test } from '@playwright/test';
import { ANONYMOUS_SESSION } from '@fixtures/pages.fixtures';
import { AdminHomePage, SlideCard, SlideValues } from '@pages/admin/AdminHomePage';
import { Submitted, submitAndFollow } from '@pages/admin/AdminNewsPages';
import { urlOf } from '@utils/lowPrivilege';
import { roleStamp } from '@utils/roleFlows';
import { collectDialogs } from '@utils/security';

/**
 * Shared steps for the slide specs (KM-ADMH / KM-FSLD).
 * A slide has no text field (image + link + status only), so it cannot carry the "[Auto Test]" marker. A case deletes
 * ONLY the slides that appeared while it ran (section id not in the list taken before) AND that are provably its own:
 * the image path its own upload returned, or a link with its stamp. Slides that were there before are never touched.
 */

/** A 1920 × 1080 PNG (the size the panel recommends). */
export const SLIDE_IMAGE = path.join(__dirname, '..', '..', 'tests', 'fixtures', 'auto-slide.png');

/** "https://www.example.com/auto-test-<stamp>" — a link that identifies the case's slide. */
export function slideLink(): string {
  return `https://www.example.com/auto-test-${roleStamp()}`;
}

function note(description: string): void {
  test.info().annotations.push({ type: 'note', description });
}

export interface SlideRun {
  saved: Submitted;
  /** The path the panel's upload returned ('' without an image). */
  imagePath: string;
  /** The slides this case created (new section ids that are provably its own). */
  created: SlideCard[];
  /** Validation texts on the page right after the save. */
  errors: SlideError[];
}

export interface SlideError {
  text: string;
  /** Whether the admin can see it (a red text inside the closed panel cannot be seen). */
  visible: boolean;
}

/** Validation texts on the page after a save (the size hint left out), with their visibility. */
export async function slideErrors(page: Page): Promise<SlideError[]> {
  return page.locator('#slideMod .text-xsmall, #slideMod .invalid-feedback, #slideMod .text-danger, .alert-danger').evaluateAll((elements) =>
    elements
      .map((e) => ({ text: (e.textContent ?? '').replace(/\s+/g, ' ').trim(), visible: (e as HTMLElement).offsetParent !== null && getComputedStyle(e).visibility === 'visible' }))
      .filter((e) => e.text && !e.text.includes('ขนาดที่แนะนำ')),
  );
}

/** The messages the admin can see. */
export const shownErrors = (errors: SlideError[]): string => errors.filter((e) => e.visible).map((e) => e.text).join(' ');

/**
 * What makes a new slide the case's own: its uploaded image path, its stamped link, or — only for the case that saves a
 * slide with neither (FSLD-02-17) — being a new slide with no image and no link.
 */
export interface OwnSlide {
  imagePath?: string;
  link?: string;
  blank?: boolean;
}

/** Section ids of the slides there now. */
export async function slideIds(page: Page): Promise<Set<string>> {
  return new Set((await new AdminHomePage(page).slides()).map((s) => s.sectionId));
}

/** The new slides (not in `before`) that match the case's own image path / link. */
export async function ownSlides(page: Page, before: Set<string>, own: OwnSlide): Promise<SlideCard[]> {
  const slides = await new AdminHomePage(page).slides();
  return slides.filter((s) => !before.has(s.sectionId) && ((own.imagePath && s.editImagePath === own.imagePath) || (own.link && s.editLink === own.link) || (own.blank && !s.editImagePath && !s.editLink)));
}

/** Deletes the case's own new slides (see ownSlides). Never throws; returns how many went. */
export async function deleteOwnSlides(page: Page, before: Set<string>, own: OwnSlide): Promise<number> {
  const home = new AdminHomePage(page);
  let deleted = 0;
  for (let attempt = 0; attempt < 8; attempt++) {
    try {
      const [slide] = await ownSlides(page, before, own);
      if (!slide) break;
      const dialog = await home.openDeleteDialog(slide.sectionId);
      const result = await submitAndFollow(page, () => dialog.confirm());
      if (result.first >= 400 || result.final >= 400) break;
      deleted++;
    } catch {
      break;
    }
  }
  return deleted;
}

/**
 * Saves a slide (the 1920 × 1080 image and a stamped link unless given), runs `checks`, then deletes the slides it
 * created. Writes a "Cleanup: …" note.
 */
export async function withSlide(page: Page, values: SlideValues, checks: (run: SlideRun) => Promise<void>): Promise<void> {
  const home = new AdminHomePage(page);
  const before = await slideIds(page);
  const link = values.link ?? slideLink();
  let imagePath = '';
  try {
    await home.openAddSlide();
    imagePath = await home.fill({ image: SLIDE_IMAGE, status: 'publish', ...values, link });
    const saved = await home.save();
    // Read the messages on the page the post landed on — ownSlides reloads the list.
    const errors = await slideErrors(page);
    expect(saved.final, 'saving is not a server error').toBeLessThan(500);
    const created = await ownSlides(page, before, { imagePath, link });
    await checks({ saved, imagePath, created, errors });
  } finally {
    note(`Cleanup: deleted ${await deleteOwnSlides(page, before, { imagePath, link })} slide(s).`);
  }
}

export interface PublicSlide {
  href: string;
  target: string;
  rel: string;
  image: string;
  alt: string | null;
  imageLoaded: boolean;
}

/** The home page hero as a visitor sees it: the real slides (owl clones left out) or the static default image. */
export async function publicHero(browser: Browser): Promise<{ slides: PublicSlide[]; defaultImage: boolean; html: string; dialogs: string[] }> {
  const context = await browser.newContext({ storageState: ANONYMOUS_SESSION });
  try {
    const page = await context.newPage();
    const dialogs = collectDialogs(page);
    await page.goto(urlOf('/'));
    await page.waitForLoadState('load');
    await page.waitForTimeout(800);
    const hero = page.locator('.hero-banner-section');
    const slides = await hero.locator('.card').evaluateAll((cards) => {
      const real = cards.filter((c) => !c.closest('.owl-item.cloned'));
      return real
        .filter((c) => c.querySelector('img'))
        .map((card) => {
          const a = card.querySelector('a');
          const img = card.querySelector('img') as HTMLImageElement;
          return { href: a?.getAttribute('href') ?? '', target: a?.getAttribute('target') ?? '', rel: a?.getAttribute('rel') ?? '', image: img.getAttribute('src') ?? '', alt: img.getAttribute('alt'), imageLoaded: img.complete && img.naturalWidth > 0 };
        });
    });
    const real = slides.filter((s) => s.image !== '/images/img.png');
    return { slides: real, defaultImage: slides.some((s) => s.image === '/images/img.png'), html: await hero.innerHTML(), dialogs };
  } finally {
    await context.close();
  }
}
