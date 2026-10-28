import { Browser, expect, Page, test } from '@playwright/test';
import { ANONYMOUS_SESSION } from '@fixtures/pages.fixtures';
import { AdminContactPage, ContactInfo, ContactMessage } from '@pages/admin/AdminContactPage';
import { Submitted, submitAndFollow } from '@pages/admin/AdminNewsPages';
import { ContactFormValues, ContactPage } from '@pages/public/ContactPage';
import { roleStamp } from '@utils/roleFlows';
import { collectDialogs } from '@utils/security';
import { AUTO_TEST_FLAG } from '@utils/testData';

/**
 * Shared steps for the contact specs (KM-ADMT / KM-FECT).
 * - The contact info is ONE shared record shown on the public site: every case that saves it restores the values it
 *   found (an all-empty save is accepted, checked 2026-10-05), and says so in a "Restore: …" note.
 * - Every contact message a case sends carries "[Auto Test]" + a stamp in its subject (the subject is never the field
 *   under test) and is deleted again by the same case. Messages without the marker are never touched.
 */

function note(description: string): void {
  test.info().annotations.push({ type: 'note', description });
}

/** "[Auto Test] หัวข้อทดสอบอัตโนมัติ <stamp>" — unique per call. */
export function contactMarker(label = 'หัวข้อทดสอบอัตโนมัติ'): string {
  return `${AUTO_TEST_FLAG} ${label} ${roleStamp()}`;
}

const sameInfo = (a: ContactInfo, b: ContactInfo): boolean => a.phone === b.phone && a.facebook === b.facebook && a.email === b.email && a.address === b.address;

/**
 * Saves `values` over the stored contact info, runs `checks`, then puts the original info (and map) back.
 * `checks` gets the post result; it may save again (the restore always goes back to what was there before).
 */
export async function withContactInfo(page: Page, values: Partial<ContactInfo>, checks: (saved: Submitted) => Promise<void>): Promise<void> {
  const admin = new AdminContactPage(page);
  const original = await admin.info();
  const originalMap = await admin.mapEmbed();
  try {
    const saved = await admin.saveInfo(values);
    expect(saved.final, 'saving is not a server error').toBeLessThan(500);
    await checks(saved);
  } finally {
    await restoreContact(page, original, originalMap);
  }
}

/** Saves `embed` as the map, runs `checks`, then restores the original map (and info). */
export async function withContactMap(page: Page, embed: string, checks: (saved: Submitted) => Promise<void>): Promise<void> {
  const admin = new AdminContactPage(page);
  const original = await admin.info();
  const originalMap = await admin.mapEmbed();
  try {
    const saved = await admin.saveMap(embed);
    expect(saved.final, 'saving is not a server error').toBeLessThan(500);
    await checks(saved);
  } finally {
    await restoreContact(page, original, originalMap);
  }
}

async function restoreContact(page: Page, original: ContactInfo, originalMap: string): Promise<void> {
  const admin = new AdminContactPage(page);
  try {
    if (!sameInfo(await admin.info(), original)) await admin.saveInfo(original);
    if ((await admin.mapEmbed()) !== originalMap) await admin.saveMap(originalMap);
    const info = await admin.info();
    const map = await admin.mapEmbed();
    note(sameInfo(info, original) && map === originalMap ? 'Restore: contact info and map are back to what they were.' : `Restore FAILED: now ${JSON.stringify({ ...info, map })}, was ${JSON.stringify({ ...original, map: originalMap })}`);
  } catch (error) {
    note(`Restore FAILED: ${String(error)}`);
  }
}

export interface PublicContact {
  status: number;
  /** label → value of the contact cards ("-" when empty). */
  info: Record<string, string>;
  text: string;
  /** Links inside the contact cards. */
  links: { href: string; text: string; target: string; rel: string }[];
  iframes: string[];
  dialogs: string[];
}

/** /frontend/contractus/index as a visitor sees it. */
export async function publicContact(browser: Browser): Promise<PublicContact> {
  const context = await browser.newContext({ storageState: ANONYMOUS_SESSION });
  try {
    const page = await context.newPage();
    const dialogs = collectDialogs(page);
    const contact = new ContactPage(page);
    const status = await contact.openContact();
    await page.waitForTimeout(300);
    return {
      status,
      info: await contact.info(),
      text: (await contact.infoCards.allInnerTexts()).join(' | ').replace(/\s+/g, ' '),
      links: await contact.infoCards.locator('a').evaluateAll((links) =>
        links.map((a) => ({ href: a.getAttribute('href') ?? '', text: (a.textContent ?? '').trim(), target: a.getAttribute('target') ?? '', rel: a.getAttribute('rel') ?? '' })),
      ),
      iframes: await page.locator('.body-content iframe').evaluateAll((frames) => frames.map((f) => f.getAttribute('src') ?? '')),
      dialogs,
    };
  } finally {
    await context.close();
  }
}

export interface Sent {
  /** Status of the post and of the page it redirected to (0 when no post was sent). */
  first: number;
  final: number;
  posted: boolean;
  success: boolean;
  errors: Record<string, string>;
  /** The form values after the round trip. */
  values: Required<ContactFormValues>;
}

export interface SendOptions {
  /** false: the post reaches the server even with an empty required field. */
  browserValidation?: boolean;
  /** Clicks on "ส่งแบบฟอร์ม" in one go (double-submit check). */
  clicks?: number;
}

/**
 * On `page` (a visitor), opens the contact page, fills the form and presses "ส่งแบบฟอร์ม". When the browser blocks
 * the post (empty required field), `posted` is false.
 * The contact page is rate limited (HTTP 429 "Too Many Requests" after a burst of posts, seen 2026-10-05): on a 429
 * the helper waits for Retry-After (60 s when absent) and sends again, at most twice, with a "Throttled" note.
 */
export async function sendContact(page: Page, values: ContactFormValues, options: SendOptions = {}): Promise<Sent> {
  let retryAfter = 0;
  const onResponse = (response: { status(): number; headers(): Record<string, string> }): void => {
    if (response.status() === 429) retryAfter = Number(response.headers()['retry-after']) || 60;
  };
  page.on('response', onResponse);
  try {
    for (let attempt = 0; ; attempt++) {
      retryAfter = 0;
      const sent = await sendOnce(page, values, options);
      if (!retryAfter || attempt >= 2) return sent;
      note(`Throttled (429): waited ${retryAfter + 1} s and sent again.`);
      await page.waitForTimeout((retryAfter + 1) * 1_000);
    }
  } finally {
    page.off('response', onResponse);
  }
}

async function sendOnce(page: Page, values: ContactFormValues, options: SendOptions): Promise<Sent> {
  const contact = new ContactPage(page);
  const status = await contact.openContact();
  if (status === 429) return { first: 0, final: 429, posted: false, success: false, errors: {}, values: { name: '', email: '', subject: '', message: '' } };
  await contact.fill(values);
  if (options.browserValidation === false) await contact.disableBrowserValidation();
  const posts: string[] = [];
  const onRequest = (r: { method(): string; url(): string }): void => {
    if (r.method() === 'POST') posts.push(r.url());
  };
  page.on('request', onRequest);
  let first = 0;
  let final = 0;
  const blocked = await contact.form.evaluate((form: HTMLFormElement) => !form.noValidate && !form.checkValidity());
  if (blocked) {
    await contact.submitButton.click();
    await page.waitForTimeout(500);
  } else {
    const clicks = options.clicks ?? 1;
    const result = await submitAndFollow(page, () =>
      clicks === 1
        ? contact.submitButton.click()
        : page.evaluate((n) => {
            const button = document.querySelector<HTMLButtonElement>('#contact-form button[type="submit"]');
            for (let i = 0; i < n; i++) button?.click();
          }, clicks),
    );
    first = result.first;
    final = result.final;
    await page.waitForTimeout(1_000); // a duplicate post would have been sent by now
  }
  page.off('request', onRequest);
  if (first === 429 || final === 429) return { first, final, posted: true, success: false, errors: {}, values: { name: '', email: '', subject: '', message: '' } };
  const success = await contact.successModal.isVisible();
  return { first, final, posted: posts.length > 0, success, errors: await contact.fieldErrors(), values: await contact.values() };
}

/** A logged-in admin page in its own context (for checks and cleanup next to a visitor `page`). */
export async function adminSession(browser: Browser, authFile: string): Promise<{ page: Page; close: () => Promise<void> }> {
  const context = await browser.newContext({ storageState: authFile });
  return { page: await context.newPage(), close: () => context.close() };
}

/** Deletes every contact message that matches (marker required). Never throws; returns how many went. */
export async function deleteMessagesWhere(page: Page, match: (message: ContactMessage) => boolean): Promise<number> {
  const admin = new AdminContactPage(page);
  let deleted = 0;
  for (let attempt = 0; attempt < 10; attempt++) {
    try {
      if (!(await admin.findMessage(match))) break;
      const dialog = await admin.openDeleteDialog(match);
      const result = await submitAndFollow(page, () => dialog.confirm());
      if (result.first >= 400 || result.final >= 400) break;
      deleted++;
    } catch {
      break;
    }
  }
  return deleted;
}

/** The messages a case sent: their subject is its marker. */
export const bySubject = (subject: string) => (message: ContactMessage): boolean => message.subject === subject;

/** Valid values for the fields a case is not about (the subject is always the case's marker). */
export const VALID_CONTACT: Required<Omit<ContactFormValues, 'subject'>> = {
  name: `${AUTO_TEST_FLAG} ผู้ติดต่อทดสอบ`,
  email: 'qa.auto@example.com',
  message: `${AUTO_TEST_FLAG} ข้อความทดสอบ`,
};

/**
 * Sends a contact message from the visitor page (subject = a fresh marker; the other fields valid unless given), runs
 * `checks`, then deletes every message with that subject through the admin page. Writes a "Cleanup: …" note.
 */
export async function withContactMessage(
  visitor: Page,
  admin: Page,
  values: ContactFormValues,
  checks: (sent: Sent, subject: string) => Promise<void>,
  options: SendOptions = {},
): Promise<void> {
  const subject = values.subject ?? contactMarker();
  try {
    const sent = await sendContact(visitor, { ...VALID_CONTACT, ...values, subject }, options);
    expect(sent.final, 'sending is not a server error').toBeLessThan(500);
    await checks(sent, subject);
  } finally {
    note(`Cleanup: deleted ${await deleteMessagesWhere(admin, bySubject(subject))} message(s).`);
  }
}
