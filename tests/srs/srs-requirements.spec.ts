import { test, expect, ANONYMOUS_SESSION } from '@fixtures/pages.fixtures';
import { env, requireDataCreatingTestsAllowed } from '@config/env';
import { AdminActivityLogPage } from '@pages/admin/AdminActivityLogPage';
import { AdminActivityPage } from '@pages/admin/AdminActivityPage';
import { AdminContactPage } from '@pages/admin/AdminContactPage';
import { AdminCopsPage } from '@pages/admin/AdminCopsPages';
import { AdminNewsListPage, KNOWLEDGE_MODULE } from '@pages/admin/AdminNewsPages';
import { DashboardPage } from '@pages/DashboardPage';
import { LoginPage } from '@pages/LoginPage';
import { ALBUM_IMAGE, albumMarker, byDescription, deleteAlbumsWhere, publicActivity, submitAlbum } from '@utils/activityFlows';
import { sheetTitle } from '@utils/caseTitles';
import { bySubject, contactMarker, deleteMessagesWhere, sendContact, VALID_CONTACT } from '@utils/contactFlows';
import { copDescription, deleteCopsByDescription, submitNewCop } from '@utils/copFlows';
import { createFaqCategory, deleteFaqCategories, deleteFaqWhere, faqMarker, publicFaq, submitFaq } from '@utils/faqFlows';
import { urlOf } from '@utils/lowPrivilege';
import { mailboxFromEnv, waitForMail } from '@utils/mailbox';
import { createNewsCategory, deleteNewsByExcerpt, deleteNewsCategory, fetchAsVisitor, publicContentDetail, submitNews } from '@utils/newsFlows';
import { roleStamp } from '@utils/roleFlows';
import { AUTO_TEST_FLAG } from '@utils/testData';
import { fixtureFile } from '@utils/uploadFiles';
import { Browser, BrowserContext, Locator, Page } from '@playwright/test';
import * as XLSX from 'xlsx';
import { ADMIN_AUTH_FILE } from '../../global-setup';

/**
 * SRS Rev.1 (06/10/2569) — the 20 cases added on 2026-10-15 for requirements no earlier case covered (scenarios
 * SC-ADMT-05, SC-FECT-05, SC-ADMD-06, SC-ADML-05, SC-FEF-03, SC-FEK-04, SC-KNOW-15, SC-AUTH-06, SC-FEN-04). Several
 * features the SRS asks for are not in the system yet (reply to an inquiry, Excel reports, log export, related
 * questions, search trends, officer approval): those cases look for the feature, and when it is missing they fail as
 * a "spec gap" (expected failure, no DEF until SA confirms the scope). Cases that need other accounts or a mailbox
 * read them from .env and wait (On hold) until they are set:
 *   STAFF_USER / STAFF_PASS, STAFF2_USER / STAFF2_PASS — officer ("เจ้าหน้าที่") CU NET accounts (UAT);
 *   MAILBOX_* — the inbox of the person who asks; SYSTEM_MAILBOX_* — the system's inbox (src/utils/mailbox.ts).
 * Everything a case saves carries "[Auto Test]" and is deleted again.
 */

const CREATES = 'Saves test content / messages / albums / FAQs (deleted again at the end of the case).';
const GAP = {
  REPLY: 'Spec gap (SRS FR-CT-003 / UC-CT-002, p.20): there is no way to reply to an inquiry (the admin can only read, mark read / unread and delete) — waiting for SA (no DEF yet).',
  EXCEL: 'Spec gap (SRS REP-01..04, p.26): "ออกรายงาน" gives a print preview / PDF only — no Excel file — waiting for SA (no DEF yet).',
  LOG_EXPORT: 'Spec gap (SRS UC-AM-006 step 5, p.13 / REP-04): the activity log has no export — waiting for SA (no DEF yet).',
  RELATED: 'Spec gap (SRS FR-FAQ-003, p.26): the FAQ page shows no related questions — waiting for SA (no DEF yet).',
  TRENDS: 'Spec gap (SRS UC-KM-005, p.17): the statistics have no search-term trends — waiting for SA (no DEF yet).',
  APPROVAL: 'Spec gap (SRS 2.3, p.9): an officer publishes directly — no review / approval before publishing — waiting for SA (no DEF yet).',
};
const KNOWN = {
  NOT_LOGGED: 'Known bug (DEF-86): editing content (here an album) is not recorded in "ประวัติการใช้งานระบบ".',
  NOT_RELEVANCE: 'Known bug (DEF-129): FAQ search results are listed newest first, not by relevance (a question match is not ranked above an answer match) — SRS UC-FAQ-001 step 6 (p.24).',
  SESSION_EXPIRED: 'Known bug (DEF-131): with an expired session, saving a form ends on the framework page "419 PAGE EXPIRED" and a menu goes to the login page with no message — SRS UC-AM-002 alt 1 (p.11) asks for a notice to sign in again.',
  NO_CREATOR_DATE:'Known bug (DEF-130): the album full-size view (and its page) shows no creator / publish date — SRS FR-IG-002, UC-IG-002 step 3 (p.22–23).',
};
const NEEDS_OFFICER = 'On hold (UAT): needs officer ("เจ้าหน้าที่") CU NET accounts — set STAFF_USER/STAFF_PASS (and STAFF2_USER/STAFF2_PASS) in .env.';
const NEEDS_MAILBOX = (prefix: string): string => `On hold (UAT): needs a mailbox to read — set ${prefix}_IMAP_HOST / _IMAP_PORT / _USER / _PASS / _ADDRESS in .env.`;

test.beforeEach(() => test.setTimeout(300_000));

function note(description: string): void {
  test.info().annotations.push({ type: 'note', description });
}

async function visitorPage<T>(browser: Browser, work: (page: Page) => Promise<T>): Promise<T> {
  const context = await browser.newContext({ storageState: ANONYMOUS_SESSION });
  try {
    return await work(await context.newPage());
  } finally {
    await context.close();
  }
}

/** A fresh context signed in as `user` (an officer account); null when the login is refused. */
async function signedIn(browser: Browser, user: string, pass: string): Promise<{ context: BrowserContext; page: Page } | null> {
  const context = await browser.newContext({ storageState: ANONYMOUS_SESSION });
  const page = await context.newPage();
  const login = new LoginPage(page);
  await login.open();
  await login.login(user, pass);
  const left = await page.waitForURL((url) => !url.pathname.includes('/frontend/account/'), { timeout: 45_000 }).then(() => true, () => false);
  if (!left) {
    await context.close();
    return null;
  }
  return { context, page };
}

/** Controls that would give an Excel / export file on `page`, best match for `kind` first. */
async function exportControls(page: Page, kind?: RegExp): Promise<Locator[]> {
  const all = page.locator('a, button').filter({ hasText: /excel|xlsx|ส่งออก|export|ดาวน์โหลดรายงาน/i });
  const n = await all.count();
  const list = Array.from({ length: n }, (_, i) => all.nth(i));
  if (!kind) return list;
  const texts = await Promise.all(list.map((l) => l.innerText().catch(() => '')));
  return list.map((l, i) => ({ l, hit: kind.test(texts[i]) })).sort((a, b) => Number(b.hit) - Number(a.hit)).map((x) => x.l);
}

/** Clicks `control` and reads the downloaded workbook as rows (every sheet, header row included); null if no file. */
async function downloadRows(page: Page, control: Locator): Promise<{ name: string; rows: unknown[][]; workbook: XLSX.WorkBook } | null> {
  const download = await Promise.all([page.waitForEvent('download', { timeout: 30_000 }), control.click()]).then(([d]) => d, () => null);
  if (!download) return null;
  const file = await download.path();
  if (!file) return null;
  const workbook = XLSX.readFile(file);
  const rows = workbook.SheetNames.flatMap((s) => XLSX.utils.sheet_to_json<unknown[]>(workbook.Sheets[s], { header: 1, defval: '' }));
  return { name: download.suggestedFilename(), rows, workbook };
}

/** The Excel report of `kind` from the dashboard or its report page; null when the system offers none. */
async function excelReport(page: Page, kind: RegExp): Promise<{ name: string; rows: unknown[][]; workbook: XLSX.WorkBook } | null> {
  const dashboard = new DashboardPage(page);
  await dashboard.open();
  for (const [control] of [await exportControls(page, kind)].filter((c) => c.length)) return downloadRows(page, control);
  const report = await dashboard.openReport();
  try {
    const [control] = await exportControls(report, kind);
    note(`Export controls: dashboard none; report page ${control ? 'found' : 'none'} (${report.url()})`);
    return control ? await downloadRows(report, control) : null;
  } finally {
    await report.close();
  }
}

const flat = (rows: unknown[][]): string => rows.map((r) => r.join(' | ')).join('\n');
const stat = (stats: { value: string; label: string }[], label: RegExp): number => Number(stats.find((s) => label.test(s.label))?.value.replace(/,/g, '') ?? NaN);

// ---------------------------------------------------------------------------------------------------------------

test.describe('SC-ADMT-05 / SC-FECT-05 ตอบกลับเรื่องสอบถามและอีเมลแจ้ง (SRS 3.3)', () => {
  /** Sends a marked inquiry as a visitor, opens it in the admin; returns the subject and the reply controls. */
  async function openInquiry(page: Page, browser: Browser, email = VALID_CONTACT.email): Promise<{ subject: string; box: Locator; send: Locator }> {
    const subject = contactMarker();
    await visitorPage(browser, async (p) => {
      expect((await sendContact(p, { ...VALID_CONTACT, email, subject })).success, 'the inquiry is sent').toBe(true);
    });
    const contact = new AdminContactPage(page);
    await contact.open('?tab=messages');
    await contact.viewMessage(bySubject(subject));
    const panel = contact.viewPanel;
    return {
      subject,
      box: panel.locator('textarea[name*="reply" i], textarea[name*="answer" i], textarea[name*="response" i], textarea[placeholder*="ตอบ"]').first(),
      send: panel.locator('button, a').filter({ hasText: /ตอบกลับ|ส่งคำตอบ|reply/i }).first(),
    };
  }

  test(sheetTitle('TC-ADMT-05-01', '[Positive] เจ้าหน้าที่ตอบกลับเรื่องสอบถาม'), async ({ page, browser }) => {
    requireDataCreatingTestsAllowed(CREATES);
    let subject = '';
    try {
      const inquiry = await openInquiry(page, browser);
      subject = inquiry.subject;
      const available = (await inquiry.box.count()) > 0 && (await inquiry.send.count()) > 0;
      note(`Reply form in the message panel: ${available}`);
      test.fail(!available, GAP.REPLY);
      expect(available, 'the message panel offers a reply').toBe(true);
      const answer = `${AUTO_TEST_FLAG} คำตอบทดสอบ ${roleStamp()}`;
      await inquiry.box.fill(answer);
      const file = inquiry.box.locator('xpath=ancestor::form').locator('input[type="file"]');
      if (await file.count()) await file.first().setInputFiles(fixtureFile('sample.pdf', 'คำตอบ.pdf'));
      await Promise.all([page.waitForLoadState('load'), inquiry.send.click()]);
      const contact = new AdminContactPage(page);
      await contact.open('?tab=messages');
      const message = (await contact.readMessages()).find((m) => m.subject === subject);
      note(`Status after the reply: "${message?.status}"`);
      expect(message?.status, 'the status is "ตอบกลับแล้ว"').toMatch(/ตอบกลับแล้ว/);
      const shown = await contact.viewMessage(bySubject(subject));
      expect(JSON.stringify(shown) + (await contact.viewPanel.innerText()), 'the answer is kept with the inquiry').toContain(answer);
    } finally {
      if (subject) await deleteMessagesWhere(page, bySubject(subject));
    }
  });

  test(sheetTitle('TC-ADMT-05-02', '[Positive] ผู้ถามได้รับอีเมลแจ้งเมื่อเรื่องถูกตอบกลับ'), async ({ page, browser }) => {
    const mailbox = mailboxFromEnv('MAILBOX');
    test.fixme(!mailbox, NEEDS_MAILBOX('MAILBOX'));
    requireDataCreatingTestsAllowed(CREATES);
    let subject = '';
    try {
      const since = new Date();
      const inquiry = await openInquiry(page, browser, mailbox!.address);
      subject = inquiry.subject;
      const available = (await inquiry.box.count()) > 0 && (await inquiry.send.count()) > 0;
      test.fail(!available, GAP.REPLY);
      expect(available, 'the message panel offers a reply').toBe(true);
      const stamp = roleStamp();
      await inquiry.box.fill(`${AUTO_TEST_FLAG} คำตอบทางอีเมล ${stamp}`);
      await Promise.all([page.waitForLoadState('load'), inquiry.send.click()]);
      const mail = await waitForMail(mailbox!, since, (m) => m.text.includes(stamp));
      note(mail ? `Mail "${mail.subject}" from ${mail.from} at ${mail.date}` : 'No mail with the reply within 5 minutes');
      expect(mail, 'the person who asked gets the answer by e-mail within 5 minutes').toBeTruthy();
      expect(`${mail!.subject} ${mail!.text}`, 'it names the inquiry').toContain(subject.replace(/^.*?(mu[a-z0-9]+)$/, '$1'));
      expect(mail!.text, 'Thai text is readable (UTF-8)').toMatch(/คำตอบทางอีเมล/);
    } finally {
      if (subject) await deleteMessagesWhere(page, bySubject(subject));
    }
  });

  test(sheetTitle('TC-ADMT-05-03', '[Negative] ส่งคำตอบว่าง'), async ({ page, browser }) => {
    requireDataCreatingTestsAllowed(CREATES);
    let subject = '';
    try {
      const inquiry = await openInquiry(page, browser);
      subject = inquiry.subject;
      const available = (await inquiry.box.count()) > 0 && (await inquiry.send.count()) > 0;
      test.fail(!available, GAP.REPLY);
      expect(available, 'the message panel offers a reply').toBe(true);
      await inquiry.box.fill('');
      await inquiry.box.evaluate((el) => el.closest('form')?.setAttribute('novalidate', 'novalidate'));
      await inquiry.send.click();
      await page.waitForLoadState('load');
      const shown = (await page.locator('.text-danger, .invalid-feedback, .text-xsmall, .alert-danger').allInnerTexts()).join(' ');
      const contact = new AdminContactPage(page);
      await contact.open('?tab=messages');
      const message = (await contact.readMessages()).find((m) => m.subject === subject);
      note(`Message "${shown}"; status "${message?.status}"`);
      expect(shown, 'a Thai message says the answer is required').toMatch(/[฀-๿]/);
      expect(message?.status, 'the inquiry stays unanswered').not.toMatch(/ตอบกลับแล้ว/);
    } finally {
      if (subject) await deleteMessagesWhere(page, bySubject(subject));
    }
  });

  test(sheetTitle('TC-FECT-05-01', '[Positive] ส่งแบบฟอร์มแล้วระบบแจ้งไปที่อีเมลของระบบ'), async ({ page, browser }) => {
    const mailbox = mailboxFromEnv('SYSTEM_MAILBOX');
    test.fixme(!mailbox, NEEDS_MAILBOX('SYSTEM_MAILBOX'));
    requireDataCreatingTestsAllowed(CREATES);
    const subject = contactMarker();
    const stamp = subject.split(' ').pop()!;
    const since = new Date();
    try {
      await visitorPage(browser, async (p) => {
        expect((await sendContact(p, { ...VALID_CONTACT, subject })).success, 'the inquiry is sent').toBe(true);
      });
      const mail = await waitForMail(mailbox!, since, (m) => `${m.subject} ${m.text}`.includes(stamp));
      note(mail ? `Mail "${mail.subject}" to ${mail.to} at ${mail.date}` : 'No notification within 5 minutes');
      expect(mail, 'the system inbox is notified within 5 minutes').toBeTruthy();
      for (const value of [VALID_CONTACT.name, VALID_CONTACT.email, stamp]) expect.soft(`${mail!.subject} ${mail!.text}`, `the mail carries "${value}"`).toContain(value);
      expect.soft(mail!.text, 'and the message text').toContain(VALID_CONTACT.message);
    } finally {
      await deleteMessagesWhere(page, bySubject(subject));
    }
  });
});

test.describe('SC-ADMD-06 รายงาน Excel และรายงานตาม SRS (SRS 3.2, ข้อ 4)', () => {
  test(sheetTitle('TC-ADMD-06-01', '[Positive] ดาวน์โหลดรายงานสถิติการสร้างเนื้อหาเป็น Excel'), async ({ page }) => {
    const file = await excelReport(page, /สร้างเนื้อหา|เนื้อหา|content/i);
    note(file ? `File ${file.name}: ${file.rows.length} row(s)` : 'No Excel file offered');
    test.fail(!file, GAP.EXCEL);
    expect(file, 'an Excel file is downloaded').toBeTruthy();
    expect(file!.name, 'an .xlsx file').toMatch(/\.xlsx$/i);
    expect(file!.rows.length, 'with data rows').toBeGreaterThan(1);
    expect(flat(file!.rows), 'Thai text is readable').toMatch(/[฀-๿]/);
    const dashboard = new DashboardPage(page);
    await dashboard.open();
    const content = stat(await dashboard.readStats(), /เนื้อหา/);
    expect(flat(file!.rows), `the total ${content} of the dashboard is in the report`).toContain(String(content));
  });

  test(sheetTitle('TC-ADMD-06-02', '[Positive] ดาวน์โหลดรายงานสถิติผู้เข้าชมเป็น Excel'), async ({ page }) => {
    const file = await excelReport(page, /ผู้เข้าชม|visitor/i);
    test.fail(!file, GAP.EXCEL);
    expect(file, 'an Excel file is downloaded').toBeTruthy();
    expect(file!.name).toMatch(/\.xlsx$/i);
    const dashboard = new DashboardPage(page);
    await dashboard.open();
    const visitors = stat(await dashboard.readStats(), /ผู้เข้าชม/);
    note(`File ${file!.name}; dashboard visitors ${visitors}`);
    expect(flat(file!.rows), `the visitor total ${visitors} is in the report`).toContain(String(visitors));
  });

  test(sheetTitle('TC-ADMD-06-03', '[Positive] ดาวน์โหลดรายงานสถิติยอดดาวน์โหลดเป็น Excel'), async ({ page, browser }) => {
    requireDataCreatingTestsAllowed(CREATES);
    const title = `AUTO_REP_DL ${roleStamp()}`;
    const { excerpt } = await submitNews(page, { title, status: 'publish', documents: [fixtureFile('sample.pdf', 'report.pdf')] }, KNOWLEDGE_MODULE);
    try {
      const detail = await publicContentDetail(browser, excerpt, title, KNOWLEDGE_MODULE);
      for (let i = 0; i < 2; i++) expect((await fetchAsVisitor(browser, detail!.media.documents[0].href)).status).toBe(200);
      const file = await excelReport(page, /ดาวน์โหลด|download/i);
      test.fail(!file, GAP.EXCEL);
      expect(file, 'an Excel file is downloaded').toBeTruthy();
      const row = file!.rows.find((r) => r.join(' ').includes(title));
      note(`Row for the article: ${JSON.stringify(row)}`);
      expect(row, 'the article is in the report').toBeTruthy();
      expect(row!.map(String), 'with 2 downloads').toContain('2');
    } finally {
      await deleteNewsByExcerpt(page, excerpt, KNOWLEDGE_MODULE);
    }
  });

  test(sheetTitle('TC-ADMD-06-04', '[Negative] ค่าที่ขึ้นต้นด้วย = + - @ ไม่กลายเป็นสูตรในไฟล์ Excel'), async ({ page }) => {
    requireDataCreatingTestsAllowed(CREATES);
    const name = `=HYPERLINK("http://evil.example","x") ${roleStamp()}`;
    const cops = new AdminCopsPage(page);
    const description = copDescription();
    try {
      expect((await submitNewCop(cops, { name, description })).status()).toBeLessThan(400);
      const file = await excelReport(page, /ชุมชน|cops|เนื้อหา/i);
      test.fail(!file, GAP.EXCEL);
      expect(file, 'an Excel file is downloaded').toBeTruthy();
      const cells = file!.workbook.SheetNames.flatMap((s) => Object.entries(file!.workbook.Sheets[s]).filter(([k]) => !k.startsWith('!')).map(([, c]) => c as XLSX.CellObject));
      const risky = cells.filter((c) => c.f || (typeof c.v === 'string' && /^[=+\-@\t\r]/.test(c.v)));
      note(`Cells with the name: ${JSON.stringify(cells.filter((c) => String(c.v).includes('evil.example')).map((c) => ({ v: c.v, f: c.f })))}`);
      expect(risky.map((c) => c.f ?? c.v), 'no formula and no cell starting with = + - @').toEqual([]);
    } finally {
      await deleteCopsByDescription(cops, page, description);
    }
  });

  test(sheetTitle('TC-ADMD-06-05', '[Positive] รายงานแนวโน้มการค้นหา'), async ({ page, browser }) => {
    const a = `qaterm${roleStamp()}`;
    const b = `qaterm${roleStamp()}`;
    await visitorPage(browser, async (p) => {
      for (const [term, times] of [[a, 3], [b, 1]] as const) for (let i = 0; i < times; i++) await p.goto(urlOf(`/frontend/search/index?q=${term}`));
    });
    const dashboard = new DashboardPage(page);
    await dashboard.open();
    let text = (await page.locator('body').innerText()).replace(/\s+/g, ' ');
    if (!text.includes(a)) {
      const report = await dashboard.openReport();
      text += ' ' + (await report.locator('body').innerText()).replace(/\s+/g, ' ');
      await report.close();
    }
    const shown = text.includes(a);
    note(`Search terms on the dashboard / report: ${shown ? 'shown' : 'not shown'}`);
    test.fail(!shown, GAP.TRENDS);
    expect(shown, 'the statistics list the searched terms').toBe(true);
    expect(text.indexOf(a), 'the term searched 3 times comes before the one searched once').toBeLessThan(text.indexOf(b) < 0 ? Infinity : text.indexOf(b));
    expect(text, 'with its count').toMatch(new RegExp(`${a}\\D{0,40}3`));
  });

  test(sheetTitle('TC-ADMD-06-06', '[Positive] เจ้าหน้าที่เห็นรายงานเฉพาะส่วนที่ตนรับผิดชอบ'), async ({ page, browser }) => {
    test.fixme(!env.staffUser || !env.staffPass, NEEDS_OFFICER);
    requireDataCreatingTestsAllowed(CREATES);
    const officer = await signedIn(browser, env.staffUser, env.staffPass);
    expect(officer, 'the officer can sign in').toBeTruthy();
    const category = await createNewsCategory(page, `${AUTO_TEST_FLAG} หมวดนอกความรับผิดชอบ`, KNOWLEDGE_MODULE);
    let excerpt = '';
    try {
      const officerTotal = async (): Promise<number> => {
        const d = new DashboardPage(officer!.page);
        await officer!.page.goto(urlOf('/admin/dashboard/index'));
        return stat(await d.readStats(), /เนื้อหา/);
      };
      const before = await officerTotal();
      ({ excerpt } = await submitNews(page, { title: `AUTO_SCOPE ${roleStamp()}`, category, status: 'publish' }, KNOWLEDGE_MODULE));
      const after = await officerTotal();
      const admin = new DashboardPage(page);
      await admin.open();
      note(`Officer "เนื้อหาทั้งหมด" ${before} → ${after} after the admin added an article in a category the officer does not own; admin sees ${stat(await admin.readStats(), /เนื้อหา/)}`);
      expect(after, 'content outside the officer\'s categories is not counted for the officer').toBe(before);
    } finally {
      await officer?.context.close();
      if (excerpt) await deleteNewsByExcerpt(page, excerpt, KNOWLEDGE_MODULE);
      await deleteNewsCategory(page, category, KNOWLEDGE_MODULE);
    }
  });
});

test.describe('SC-ADML-05 ส่งออกและประวัติการแก้ไข (SRS 3.1.2.6, 3.4)', () => {
  test(sheetTitle('TC-ADML-05-01', '[Positive] ส่งออกประวัติการเข้าใช้งานเป็น Excel ตามตัวกรอง'), async ({ page }) => {
    const log = new AdminActivityLogPage(page);
    const today = new Date().toISOString().slice(0, 10);
    await log.open(`?user=1&from=${today}&to=${today}`);
    const [control] = await exportControls(page);
    note(`Export control on the activity log: ${control ? await control.innerText() : 'none'}`);
    test.fail(!control, GAP.LOG_EXPORT);
    expect(control, 'the activity log offers an export').toBeTruthy();
    const file = await downloadRows(page, control!);
    expect(file, 'a file is downloaded').toBeTruthy();
    expect(file!.name, 'an .xlsx file').toMatch(/\.xlsx$/i);
    const [header, ...rows] = file!.rows;
    expect(header.join(' '), 'columns เวลา ผู้ใช้งาน การกระทำ รายการ IP').toMatch(/เวลา[\s\S]*ผู้ใช้[\s\S]*การกระทำ[\s\S]*รายการ[\s\S]*IP/);
    expect(rows.length, 'rows of the filter').toBeGreaterThan(0);
    expect(rows.every((r) => r.join(' ').includes('ผู้ดูแลระบบ')), 'only the filtered user').toBe(true);
  });

  test(sheetTitle('TC-ADML-05-02', '[Positive] แก้ไขอัลบัมแล้วบันทึกประวัติการแก้ไข'), async ({ page }) => {
    requireDataCreatingTestsAllowed(CREATES);
    const description = albumMarker();
    const renamed = `AUTO_LOG_ALBUM ${roleStamp()}`;
    try {
      expect((await submitAlbum(page, { title: `AUTO_ALBUM ${roleStamp()}`, description, images: [ALBUM_IMAGE], status: 'publish' })).final).toBeLessThan(500);
      const albums = new AdminActivityPage(page);
      await albums.open();
      await albums.openEditForm(byDescription(description));
      await albums.fill({ title: renamed });
      expect((await albums.save()).final).toBeLessThan(500);
      const log = new AdminActivityLogPage(page);
      await log.open();
      const rows = (await log.readRows()).filter((r) => r.item.includes(renamed));
      note(`Log rows naming "${renamed}": ${JSON.stringify(rows)}`);
      test.fail(!rows.some((r) => /update|แก้/i.test(r.action)), KNOWN.NOT_LOGGED);
      const row = rows.find((r) => /update|แก้/i.test(r.action));
      expect(row, 'the edit is logged').toBeTruthy();
      expect(row!.user, 'with the user').not.toBe('');
      expect(row!.ip, 'and the IP').toMatch(/\d+\.\d+\.\d+\.\d+|:/);
    } finally {
      note(`Cleanup: deleted ${await deleteAlbumsWhere(page, byDescription(description))} album(s).`);
    }
  });
});

test.describe('SC-FEF-03 คำถามที่เกี่ยวข้องและการเรียงผลค้นหา FAQ (SRS 3.5)', () => {
  test(sheetTitle('TC-FEF-03-01', '[Positive] แสดงคำถามที่เกี่ยวข้องพร้อมคำตอบ'), async ({ page, browser }) => {
    requireDataCreatingTestsAllowed(CREATES);
    const category = await createFaqCategory(page, `${AUTO_TEST_FLAG} หมวดเกี่ยวข้อง`);
    const answers = [faqMarker(), faqMarker(), faqMarker()];
    // The questions must not contain "เกี่ยวข้อง" themselves — the case looks for a block titled with that word.
    const questions = answers.map((_, i) => `${AUTO_TEST_FLAG} คำถามชุดทดสอบ ${i + 1} ${roleStamp()}`);
    try {
      for (let i = 0; i < 3; i++) expect((await submitFaq(page, { question: questions[i], answer: answers[i], category })).final).toBeLessThan(500);
      const related = await visitorPage(browser, async (p) => {
        await p.goto(urlOf('/frontend/faq/index'));
        await p.locator('.accordion-button').filter({ hasText: questions[0] }).first().click();
        await p.waitForTimeout(800);
        // A heading / label "คำถามที่เกี่ยวข้อง" and the links next to it.
        const heading = p.locator('h1, h2, h3, h4, h5, h6, strong, .title, p, span').filter({ hasText: /^\s*(คำถาม)?ที่เกี่ยวข้อง/ }).first();
        if (!(await heading.count())) return '';
        return (await heading.locator('xpath=..').innerText()).replace(/\s+/g, ' ');
      });
      note(`Related block: "${related.slice(0, 300)}"`);
      const shown = questions.slice(1).some((q) => related.includes(q));
      test.fail(!shown, GAP.RELATED);
      expect(shown, 'the other questions of the category are listed as related').toBe(true);
    } finally {
      for (const answer of answers) await deleteFaqWhere(page, (c) => c.editAnswer === answer);
      await deleteFaqCategories(page, category);
    }
  });

  test(sheetTitle('TC-FEF-03-02', '[Positive] ผลค้นหา FAQ เรียงตามความเกี่ยวข้อง'), async ({ page, browser }) => {
    requireDataCreatingTestsAllowed(CREATES);
    const word = `qarel${roleStamp()}`;
    const category = await createFaqCategory(page, `${AUTO_TEST_FLAG} หมวดค้นหา`);
    const inAnswer = { question: `${AUTO_TEST_FLAG} คำถามที่คำตอบมีคำค้น ${roleStamp()}`, answer: `${AUTO_TEST_FLAG} คำตอบมีคำว่า ${word} ${roleStamp()}` };
    const inQuestion = { question: `${AUTO_TEST_FLAG} คำถามเรื่อง ${word}`, answer: faqMarker() };
    try {
      // Saved answer-match first so a plain "newest first" order would put it on top.
      for (const f of [inAnswer, inQuestion]) expect((await submitFaq(page, { ...f, category })).final).toBeLessThan(500);
      const found = await publicFaq(browser, `?q=${word}`);
      const order = found.questions.filter((q) => q.includes('คำถามเรื่อง') || q.includes('คำตอบมีคำค้น'));
      note(`Questions for "${word}": ${JSON.stringify(order)}`);
      expect(order.length, 'both FAQs are found').toBe(2);
      test.fail(!order[0].includes(word), KNOWN.NOT_RELEVANCE);
      expect(order[0], 'the one whose question matches comes first').toContain(word);
      const none = await publicFaq(browser, `?q=qanone${roleStamp()}`);
      expect(none.text, 'no hit: "ไม่พบคำถามที่ค้นหา"').toMatch(/ไม่พบ/);
    } finally {
      for (const f of [inAnswer, inQuestion]) await deleteFaqWhere(page, (c) => c.editAnswer === f.answer);
      await deleteFaqCategories(page, category);
    }
  });
});

test.describe('SC-FEK-04 / SC-KNOW-15 บทความ: ผู้เขียน และเจ้าหน้าที่ (SRS 2.3, 3.2)', () => {
  test(sheetTitle('TC-FEK-04-01', '[Positive] หน้ารายละเอียดบทความแสดงผู้เขียน'), async ({ page, browser }) => {
    requireDataCreatingTestsAllowed(CREATES);
    const category = await createNewsCategory(page, `${AUTO_TEST_FLAG} หมวดผู้เขียน`, KNOWLEDGE_MODULE);
    const author = `ผู้เขียนทดสอบ ${roleStamp()}`;
    const title = `AUTO_AUTHOR ${roleStamp()}`;
    const { excerpt } = await submitNews(page, { title, category, tags: ['autotestauthor'], authorName: author, documents: [fixtureFile('sample.pdf', 'author.pdf')], status: 'publish' }, KNOWLEDGE_MODULE);
    try {
      const detail = await publicContentDetail(browser, excerpt, title, KNOWLEDGE_MODULE);
      expect(detail?.status, 'the article page opens').toBe(200);
      note(`Detail text: "${detail!.text.slice(0, 400)}"`);
      expect.soft(detail!.text, 'the author').toContain(author);
      expect.soft(detail!.text, 'the date').toMatch(/\d{1,2}\s*\S+\s*\d{2,4}/);
      expect.soft(detail!.text, 'the category').toContain(category);
      expect.soft(detail!.text, 'the tag').toContain('autotestauthor');
      expect.soft(detail!.media.documents.length, 'the attachment').toBe(1);
    } finally {
      await deleteNewsByExcerpt(page, excerpt, KNOWLEDGE_MODULE);
      await deleteNewsCategory(page, category, KNOWLEDGE_MODULE);
    }
  });

  test(sheetTitle('TC-KNOW-15-01', '[Positive] เนื้อหาของเจ้าหน้าที่ต้องผ่านการตรวจก่อนเผยแพร่'), async ({ page, browser }) => {
    test.fixme(!env.staffUser || !env.staffPass, NEEDS_OFFICER);
    requireDataCreatingTestsAllowed(CREATES);
    const officer = await signedIn(browser, env.staffUser, env.staffPass);
    expect(officer, 'the officer can sign in').toBeTruthy();
    let excerpt = '';
    const title = `AUTO_OFFICER ${roleStamp()}`;
    try {
      ({ excerpt } = await submitNews(officer!.page, { title, status: 'publish' }, KNOWLEDGE_MODULE));
      const card = await new AdminNewsListPage(page, KNOWLEDGE_MODULE).findByExcerpt(excerpt);
      const publicList = await visitorPage(browser, async (p) => {
        await p.goto(urlOf(KNOWLEDGE_MODULE.publicIndex));
        return (await p.locator('body').innerText()).includes(title);
      });
      note(`Status in the admin list "${card?.status}"; on the public list ${publicList}`);
      test.fail(publicList || /เผยแพร่/.test(card?.status ?? ''), GAP.APPROVAL);
      expect(card?.status, 'waiting for review').toMatch(/รอ|ตรวจ|อนุมัติ/);
      expect(publicList, 'not public before it is approved').toBe(false);
    } finally {
      await officer?.context.close();
      if (excerpt) await deleteNewsByExcerpt(page, excerpt, KNOWLEDGE_MODULE);
    }
  });

  test(sheetTitle('TC-KNOW-15-02', '[Negative] เจ้าหน้าที่แก้ไข/ลบบทความของผู้อื่นไม่ได้'), async ({ page, browser }) => {
    test.fixme(!env.staffUser || !env.staffPass || !env.staff2User || !env.staff2Pass, NEEDS_OFFICER);
    requireDataCreatingTestsAllowed(CREATES);
    const a = await signedIn(browser, env.staffUser, env.staffPass);
    const b = await signedIn(browser, env.staff2User, env.staff2Pass);
    expect(a && b, 'both officers can sign in').toBeTruthy();
    let excerpt = '';
    const title = `AUTO_OWNER_B ${roleStamp()}`;
    try {
      ({ excerpt } = await submitNews(b!.page, { title, status: 'draft' }, KNOWLEDGE_MODULE));
      const list = new AdminNewsListPage(page, KNOWLEDGE_MODULE);
      const card = await list.findByExcerpt(excerpt);
      expect(card, "B's article exists").toBeTruthy();
      const deleteUrl = await page.locator('.article-card').filter({ hasText: excerpt }).locator('[data-delete-url]').first().getAttribute('data-delete-url');
      // Officer A: open B's edit page, then try B's delete URL with A's own token.
      const edit = await a!.page.goto(new URL(card!.editHref, env.baseURL).href);
      const editStatus = edit?.status() ?? 0;
      const opened = /\/edit/.test(a!.page.url()) && (await a!.page.locator('#content-module-form').count()) > 0;
      const token = await a!.page.locator('meta[name="csrf-token"]').getAttribute('content').catch(() => '');
      const del = deleteUrl ? await a!.page.request.post(deleteUrl, { form: { _token: token ?? '', _method: 'DELETE' }, maxRedirects: 0 }) : null;
      const still = await list.findByExcerpt(excerpt);
      note(`A opens B's edit page: HTTP ${editStatus}, form shown ${opened}; A's delete: HTTP ${del?.status()}; article still there ${!!still}`);
      expect(opened, "A cannot open B's article for editing").toBe(false);
      expect(still, "B's article is not deleted by A").toBeTruthy();
    } finally {
      await a?.context.close();
      await b?.context.close();
      if (excerpt) await deleteNewsByExcerpt(page, excerpt, KNOWLEDGE_MODULE);
    }
  });
});

test.describe('SC-AUTH-06 session หมดอายุ (SRS 3.1.2.2)', () => {
  test(sheetTitle('TC-AUTH-06-01', '[Negative] session หมดอายุแล้วแจ้งให้เข้าสู่ระบบใหม่'), async ({ page }) => {
    // The server forgets the session after the idle time (120 min now — DEF-120). Dropping the session cookie gives the
    // server the same view of the next request (no session), so the case does not wait two hours.
    // The album panel needs only its title (the article form also needs a category the browser checks first).
    const albums = new AdminActivityPage(page);
    await albums.openAddForm();
    const title = `${AUTO_TEST_FLAG} ฟอร์มค้าง ${roleStamp()}`;
    await albums.titleInput.fill(title);
    await page.context().clearCookies();
    const responses: number[] = [];
    page.on('response', (r) => r.request().resourceType() === 'document' && responses.push(r.status()));
    await Promise.all([page.waitForNavigation({ timeout: 30_000 }).catch(() => undefined), albums.saveButton.click()]);
    await page.waitForLoadState('load');
    const afterSave = { url: page.url(), text: (await page.locator('body').innerText()).replace(/\s+/g, ' ').slice(0, 200), statuses: [...responses] };
    responses.length = 0;
    await page.goto(urlOf('/admin/news/index'));
    const afterMenu = { url: page.url(), text: (await page.locator('body').innerText()).replace(/\s+/g, ' ').slice(0, 200), statuses: [...responses] };
    note(`Save with the expired session: ${JSON.stringify(afterSave)}`);
    note(`Menu with the expired session: ${JSON.stringify(afterMenu)}`);
    const handled = !afterSave.statuses.some((s) => s === 419 || s >= 500) && /หมดอายุ|เข้าสู่ระบบ(ใหม่|อีกครั้ง)/.test(`${afterSave.text} ${afterMenu.text}`);
    test.fail(!handled, KNOWN.SESSION_EXPIRED);
    expect.soft(afterSave.statuses.filter((s) => s === 419 || s >= 500), 'saving does not end on "419 Page Expired" / a server error').toEqual([]);
    expect.soft(afterSave.url, 'saving leads to the login page').toContain('/frontend/account/');
    expect(afterMenu.url, 'a menu leads to the login page').toContain('/frontend/account/');
    expect(`${afterSave.text} ${afterMenu.text}`, 'a Thai message asks to sign in again').toMatch(/หมดอายุ|เข้าสู่ระบบ(ใหม่|อีกครั้ง)/);
    // Nothing may have been saved without a session.
    const admin = await page.context().browser()!.newContext({ storageState: ADMIN_AUTH_FILE });
    const adminPage = await admin.newPage();
    try {
      const check = new AdminActivityPage(adminPage);
      await check.open();
      const saved = (await check.readCards()).filter((c) => c.title === title);
      for (const c of saved) note(`Saved without a session: album "${c.title}" (id ${c.id})`);
      expect(saved.length, 'no album is saved without a session').toBe(0);
    } finally {
      await deleteAlbumsWhere(adminPage, (c) => c.title === title);
      await admin.close();
    }
  });
});

test.describe('SC-FEN-04 อินโฟกราฟิก / อัลบัม (SRS 3.4)', () => {
  test(sheetTitle('TC-FEN-04-01', '[Positive] ค้นหาอัลบัม / อินโฟกราฟิกด้วยคำค้น'), async ({ page, browser }) => {
    requireDataCreatingTestsAllowed(CREATES);
    const description = albumMarker();
    const word = `qaalbum${roleStamp()}`;
    const title = `AUTO_INFOGRAPHIC ${word}`;
    try {
      expect((await submitAlbum(page, { title, description, images: [ALBUM_IMAGE], status: 'publish' })).final).toBeLessThan(500);
      const hits = await visitorPage(browser, async (p) => {
        const where: string[] = [];
        for (const path of [`/frontend/search/index?q=${word}`, `/frontend/activity/index?q=${word}`]) {
          await p.goto(urlOf(path));
          const card = p.locator('a, .card').filter({ hasText: title }).first();
          if ((await card.count()) && (await card.locator('img').count())) where.push(path);
        }
        await p.goto(urlOf(`/frontend/search/index?q=qanone${roleStamp()}`));
        return { where, none: (await p.locator('body').innerText()).replace(/\s+/g, ' ') };
      });
      note(`Album found with a preview at: ${JSON.stringify(hits.where)}`);
      expect(hits.where.length, 'the album is found by its name, with a preview image').toBeGreaterThan(0);
      expect(hits.none, 'no hit: "ไม่พบข้อมูลที่ค้นหา"').toMatch(/ไม่พบ/);
    } finally {
      note(`Cleanup: deleted ${await deleteAlbumsWhere(page, byDescription(description))} album(s).`);
    }
  });

  test(sheetTitle('TC-FEN-04-02', '[Positive] ภาพเต็มแสดงผู้จัดทำและวันที่เผยแพร่'), async ({ page, browser }) => {
    requireDataCreatingTestsAllowed(CREATES);
    const description = albumMarker();
    const title = `AUTO_FULLIMAGE ${roleStamp()}`;
    try {
      expect((await submitAlbum(page, { title, description, images: [ALBUM_IMAGE], status: 'publish' })).final).toBeLessThan(500);
      const href = (await publicActivity(browser)).albums.find((a) => a.title === title)!.href;
      const shown = await visitorPage(browser, async (p) => {
        await p.goto(href);
        await p.locator('.pop-img').first().click();
        const modal = p.locator('#imagePreviewModal');
        await modal.waitFor({ state: 'visible', timeout: 10_000 });
        const img = modal.locator('img#previewImage, img').first();
        return {
          full: await img.evaluate((i: HTMLImageElement) => i.naturalWidth),
          modal: (await modal.innerText()).replace(/\s+/g, ' '),
          page: (await p.locator('body').innerText()).replace(/\s+/g, ' '),
        };
      });
      // The creator / date may sit in the preview or on the album page around it.
      const albumText = shown.page.slice(Math.max(0, shown.page.indexOf(title) - 200), shown.page.indexOf(title) + 400);
      note(`Preview: natural width ${shown.full}px; preview text "${shown.modal.slice(0, 200)}"; album page around the title "${albumText}"`);
      expect(shown.full, 'the full-size image (1,000 px or more)').toBeGreaterThanOrEqual(1000);
      const both = `${shown.modal} ${albumText}`;
      const complete = /ผู้จัดทำ|โดย|ผู้ดูแลระบบ|Admin/.test(both) && /\d{1,2}\s*\S+\s*\d{2,4}/.test(both);
      test.fail(!complete, KNOWN.NO_CREATOR_DATE);
      expect.soft(both, 'the creator').toMatch(/ผู้จัดทำ|โดย|ผู้ดูแลระบบ|Admin/);
      expect.soft(both, 'the date published').toMatch(/\d{1,2}\s*\S+\s*\d{2,4}/);
    } finally {
      note(`Cleanup: deleted ${await deleteAlbumsWhere(page, byDescription(description))} album(s).`);
    }
  });
});
