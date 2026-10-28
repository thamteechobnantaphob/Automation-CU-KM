import { test, expect, ANONYMOUS_SESSION } from '@fixtures/pages.fixtures';
import { env, requireDataCreatingTestsAllowed } from '@config/env';
import { AdminActivityLogPage } from '@pages/admin/AdminActivityLogPage';
import { AdminContactPage } from '@pages/admin/AdminContactPage';
import { AdminRoleFormPage, AdminRoleListPage, RoleFormValues } from '@pages/admin/AdminRolePages';
import { UserFormValues } from '@pages/admin/AdminUserFormModal';
import { AdminUserListPage } from '@pages/admin/AdminUserListPage';
import { LoginPage } from '@pages/LoginPage';
import { sheetTitle } from '@utils/caseTitles';
import { urlOf } from '@utils/lowPrivilege';
import { AUTO_ROLE_DESCRIPTION, roleStamp } from '@utils/roleFlows';
import { QA_PREFIX } from '@utils/strings';
import { AUTO_TEST_FLAG } from '@utils/testData';
import { Page } from '@playwright/test';

/**
 * The "Manual (QA)" cases of group A (2026-10-15) about users, roles, the activity log, the contact messages and
 * sign-in. Sign-in is by CU NET / LDAP (DEF-49), so a user made here cannot log in: the "then log in as …" parts are
 * noted as UAT checks. A username that is not "qa_auto_…" (reserved / Thai / e-mail form) is only saved when no
 * account of that name exists, and deleted only when its row shows "[Auto Test]" (the default test name).
 */

const CREATES = 'Saves users / roles (deleted again at the end of the case).';
const KNOWN = {
  DUP_ROLE: 'Known bug (DEF-25): a role name that already exists (also differing only in letter case) is saved again — the role picker cannot tell them apart.',
  FAILED_LOGIN_NOT_LOGGED: 'Known bug (DEF-121): failed / refused attempts are not recorded in "ประวัติการใช้งานระบบ".',
  RAW_KEY: 'Known bug (DEF-66): the refusal message is the untranslated key (validation.*).',
  NO_LOGIN_THROTTLE: 'Known bug (DEF-132): repeated failed logins are not slowed down or locked — no lockout, CAPTCHA, delay or HTTP 429.',
};
const RAW = /\bvalidation\.[a-z_.]+/i;
const GAP = {
  CONTACT_EXPORT: 'Spec gap: the contact message list has no export (the case says "ถ้ามี") — waiting for SA (no DEF yet).',
};

test.beforeEach(() => test.setTimeout(240_000));

function note(description: string): void {
  test.info().annotations.push({ type: 'note', description });
}

const stampLabel = (tag: string): string => `${AUTO_TEST_FLAG} ${QA_PREFIX}_${roleStamp()}_${tag}`;
const flipCase = (text: string): string => text.replace(AUTO_TEST_FLAG, '\u0000').replace(/[a-z]/gi, (c) => (c === c.toUpperCase() ? c.toLowerCase() : c.toUpperCase())).replace('\u0000', AUTO_TEST_FLAG);

// --- users -------------------------------------------------------------------------------------------------------

async function saveUser(page: Page, values: UserFormValues): Promise<{ listed: boolean; messages: string }> {
  const list = new AdminUserListPage(page);
  await list.open();
  const modal = await list.openAddUserForm();
  await modal.fillWithDefaults(values);
  const response = page.waitForResponse((r) => r.request().method() === 'POST', { timeout: 30_000 }).catch(() => null);
  await modal.save();
  const status = (await response)?.status() ?? 0;
  await page.waitForLoadState('networkidle');
  const messages = ((await modal.root.locator('.text-danger, .invalid-feedback, .text-xsmall').allInnerTexts().catch(() => [])).join(' ') + ' ' + (await page.locator('.alert-danger').allInnerTexts()).join(' ')).trim();
  expect(status, 'no server error').toBeLessThan(500);
  return { listed: await list.isUserListed(values.username as string), messages };
}

/** Deletes a user the case made — only when its row shows "[Auto Test]". Never throws. */
async function removeUser(page: Page, username: string): Promise<boolean> {
  try {
    const list = new AdminUserListPage(page);
    const row = await list.locateUser(username);
    if (!((await row.innerText()) ?? '').includes(AUTO_TEST_FLAG)) return false;
    await row.locator('button').last().click();
    const dialog = page.getByRole('dialog').filter({ hasText: 'ต้องการลบข้อมูล?' });
    await Promise.all([page.waitForLoadState('load'), dialog.getByRole('button', { name: 'ยืนยันลบข้อมูล' }).click()]);
    await page.waitForTimeout(600);
    return !(await list.isUserListed(username));
  } catch {
    return false;
  }
}

/** Tries each username (skipping any that already exist); records the policy seen and deletes what it saved. */
async function usernameCase(page: Page, usernames: string[], extra: UserFormValues = {}): Promise<void> {
  requireDataCreatingTestsAllowed(CREATES);
  const list = new AdminUserListPage(page);
  const made: string[] = [];
  const raw: string[] = [];
  try {
    for (const username of usernames) {
      if (await list.isUserListed(username)) {
        note(`"${username}": an account of that name already exists — not touched.`);
        continue;
      }
      const result = await saveUser(page, { ...extra, username });
      if (result.listed) made.push(username);
      note(`Policy seen for "${username}": ${result.listed ? 'accepted' : `refused (${result.messages || 'no message'})`}`);
      if (!result.listed && /unique/i.test(result.messages)) note(`"${username}" is refused as taken (validation.unique) although no such user is listed: a deleted account keeps its username and e-mail (DEF-133), so the rule could not be re-checked here.`);
      else if (!result.listed) expect(result.messages, 'a refusal says why').not.toBe('');
      if (RAW.test(result.messages)) raw.push(result.messages);
    }
    test.fail(raw.length > 0, KNOWN.RAW_KEY);
    expect(raw, 'no untranslated validation key').toEqual([]);
  } finally {
    let n = 0;
    for (const u of made) if (await removeUser(page, u)) n++;
    note(`Cleanup: deleted ${n} of ${made.length} user(s).`);
    expect(n, 'every saved test user is deleted again').toBe(made.length);
  }
}

test.describe('Manual → Auto: ชื่อผู้ใช้ / อีเมล', () => {
  for (const id of ['TC-ADMU-05-11', 'TC-FUSR-02-14']) {
    test(sheetTitle(id), async ({ page }) => usernameCase(page, ['root', 'administrator', 'system']));
  }

  test(sheetTitle('TC-FUSR-02-02'), async ({ page }) => usernameCase(page, [`${QA_PREFIX}.user-${roleStamp()}`]));

  test(sheetTitle('TC-FUSR-02-03'), async ({ page }) => {
    await usernameCase(page, [`${QA_PREFIX}_${roleStamp()}@chula.ac.th`]);
    note('Signing in with that CU NET (AD/LDAP) account is a UAT check (no LDAP account on Dev — DEF-49).');
  });

  test(sheetTitle('TC-FUSR-02-10'), async ({ page }) => {
    await usernameCase(page, [`ทดสอบ${roleStamp().replace(/\D/g, '').slice(-6)}`]);
    note('Related: DEF-24 (the username takes spaces, special characters and Thai).');
  });

  test(sheetTitle('TC-FUSR-04-08'), async ({ page }) => usernameCase(page, [`${QA_PREFIX}_mail_${roleStamp()}`], { email: `user${roleStamp()}@localhost` } /* a fresh address: a deleted account keeps its e-mail (DEF-133) */));
});

// --- roles -------------------------------------------------------------------------------------------------------

async function saveRole(page: Page, values: RoleFormValues): Promise<{ status: number; messages: string }> {
  const roles = new AdminRoleListPage(page);
  const form = new AdminRoleFormPage(page);
  await roles.open();
  await roles.openAddForm();
  await form.fill({ levels: { home: 'view' }, ...values });
  const status = (await form.save()).status();
  const messages = (await page.locator('.text-danger, .invalid-feedback, .text-xsmall, .alert-danger').allInnerTexts()).join(' ').trim();
  return { status, messages };
}

async function removeRoles(page: Page, labels: string[]): Promise<void> {
  const roles = new AdminRoleListPage(page);
  let n = 0;
  for (const label of labels) {
    for (let i = 0; i < 3; i++) {
      try {
        await roles.open();
        if (!(await roles.findRole(label))) break;
        const dialog = await roles.openDeleteDialog(label);
        await Promise.all([page.waitForLoadState('load'), dialog.confirm()]);
        n++;
      } catch {
        break;
      }
    }
  }
  note(`Cleanup: deleted ${n} role(s).`);
}

test.describe('Manual → Auto: สิทธิ์การใช้งาน', () => {
  for (const id of ['TC-ADMR-04-09', 'TC-FROL-02-12']) {
    test(sheetTitle(id), async ({ page }) => {
      requireDataCreatingTestsAllowed(CREATES);
      const label = stampLabel('Dup');
      const other = flipCase(label);
      try {
        expect((await saveRole(page, { label, description: AUTO_ROLE_DESCRIPTION })).status).toBeLessThan(400);
        const again = await saveRole(page, { label: other, description: AUTO_ROLE_DESCRIPTION });
        expect(again.status, 'no server error').toBeLessThan(500);
        const roles = new AdminRoleListPage(page);
        await roles.open();
        const same = (await roles.readRoles()).filter((r) => r.name.toLowerCase() === label.toLowerCase());
        note(`Roles named "${label}" (any case): ${same.length}; message "${again.messages}"`);
        test.fail(same.length > 1, KNOWN.DUP_ROLE);
        expect(same.length, 'the duplicate name is refused').toBe(1);
      } finally {
        await removeRoles(page, [label, other]);
      }
    });
  }

  test(sheetTitle('TC-FROL-04-09'), async ({ page }) => {
    requireDataCreatingTestsAllowed(CREATES);
    const label = stampLabel('ROLE_EMPTY');
    try {
      const saved = await saveRole(page, { label, description: AUTO_ROLE_DESCRIPTION, levels: {} });
      expect(saved.status, 'no server error').toBeLessThan(500);
      const roles = new AdminRoleListPage(page);
      await roles.open();
      const row = await roles.findRole(label);
      note(`Policy seen: ${row ? 'a role with no permission at all is saved' : `refused (${saved.messages || 'no message'})`}`);
      if (!row) expect(saved.messages, 'the refusal asks for at least one permission').not.toBe('');
      else {
        const form = await roles.openEditForm(label);
        await form.expectLevels({ user: 'none', role: 'none', home: 'none', content: 'none', knowledge: 'none', faq: 'none', contact: 'none' });
        note('Signing in with a user holding this role (to see that nothing opens) is a UAT check (LDAP — DEF-49; see DEF-22).');
      }
    } finally {
      await removeRoles(page, [label]);
    }
  });

  test(sheetTitle('TC-FROL-04-10'), async ({ page }) => {
    requireDataCreatingTestsAllowed(CREATES);
    const roles = new AdminRoleListPage(page);
    await roles.open();
    await roles.openAddForm();
    const rows = await page.locator('[name^="module_permissions["]').evaluateAll((els) => [...new Set(els.map((e) => (e.getAttribute('name') ?? '').replace(/^module_permissions\[|\]$/g, '')))]);
    const labels = (await page.locator('table tbody tr').allInnerTexts()).map((t) => t.replace(/\s+/g, ' ').trim());
    note(`Permission rows: ${JSON.stringify(rows)}`);
    for (const [key, text] of [['infographic', 'คลังกิจกรรม'], ['bestpractice', 'แนวทางปฏิบัติที่ดี'], ['contact', 'ติดต่อสอบถาม']] as const) {
      expect(rows, `"${text}" has its own permission row`).toContain(key);
      expect(labels.some((l) => l.includes(text)), `labelled "${text}"`).toBe(true);
    }
    const label = stampLabel('NEWS_ONLY');
    try {
      expect((await saveRole(page, { label, description: AUTO_ROLE_DESCRIPTION, levels: { content: 'full' } })).status).toBeLessThan(400);
      const form = await roles.openEditForm(label);
      await form.expectLevels({ content: 'full', infographic: 'none', bestpractice: 'none', knowledge: 'none', contact: 'none' });
      note('"ข่าวกิจกรรม KM = full" alone leaves คลังกิจกรรม / แนวทางปฏิบัติที่ดี at "none" — they are separate rows. What the menu shows to a user signing in with this role is a UAT check (LDAP — DEF-49).');
    } finally {
      await removeRoles(page, [label]);
    }
  });
});

// --- log, contact export, sign-in --------------------------------------------------------------------------------

test.describe('Manual → Auto: ประวัติการใช้งาน / ส่งออก / การเข้าสู่ระบบ', () => {
  test(sheetTitle('TC-ADML-04-05'), async ({ page, browser }) => {
    const username = `${QA_PREFIX}_denied_${roleStamp()}`;
    const context = await browser.newContext({ storageState: ANONYMOUS_SESSION });
    try {
      const visitor = await context.newPage();
      const denied = await visitor.goto(urlOf('/admin/user/index'));
      note(`Anonymous /admin/user/index → HTTP ${denied?.status()} at ${visitor.url()}`);
      const login = new LoginPage(visitor);
      await login.open();
      await login.login(username, 'Wrong#Password1');
      await visitor.waitForLoadState('load');
    } finally {
      await context.close();
    }
    const log = new AdminActivityLogPage(page);
    await log.open();
    const rows = (await log.readRows()).filter((r) => Object.values(r).join(' ').includes(username) || /ปฏิเสธ|ล้มเหลว|ไม่สำเร็จ|denied|failed/i.test(r.action));
    note(`Log rows for the refused attempts: ${JSON.stringify(rows.slice(0, 3))}`);
    note('A signed-in user without the right opening /admin/user/index is a UAT check (LDAP — DEF-49).');
    test.fail(rows.length === 0, KNOWN.FAILED_LOGIN_NOT_LOGGED);
    expect(rows.length, 'refused / failed attempts are logged').toBeGreaterThan(0);
  });

  test(sheetTitle('TC-ADMT-04-07'), async ({ page }) => {
    const contact = new AdminContactPage(page);
    expect(await contact.open()).toBe(200);
    await contact.messagesTab.click();
    await page.waitForTimeout(500);
    const controls = page.locator('#pills-message a:visible, #pills-message button:visible, a:visible, button:visible').filter({ hasText: /excel|xlsx|csv|ส่งออก|export|ดาวน์โหลด/i });
    const n = await controls.count();
    note(`Export controls on the contact messages tab: ${n}`);
    test.fail(n === 0, GAP.CONTACT_EXPORT);
    expect(n, 'the message list offers an export').toBeGreaterThan(0);
    const download = await Promise.all([page.waitForEvent('download', { timeout: 30_000 }), controls.first().click()]).then(([d]) => d);
    const file = await download.path();
    const text = file ? (await import('fs')).readFileSync(file).toString('utf8') : '';
    note(`Downloaded ${download.suggestedFilename()} (${text.length} chars)`);
    expect(text, 'Thai text is readable (not mojibake)').not.toMatch(/à¸/);
    expect(text.split(/\r?\n/).some((l) => /^[=+\-@]/.test(l.split(',').find((c) => /^[=+\-@]/.test(c)) ?? '')), 'cells starting with = + - @ are escaped (CSV injection)').toBe(false);
  });

  test(sheetTitle('TC-AUTH-02-06'), async ({ browser }) => {
    test.setTimeout(300_000);
    // A made-up username: a lockout must never hit the real admin account.
    const username = `${QA_PREFIX}_lock_${roleStamp()}`;
    const context = await browser.newContext({ storageState: ANONYMOUS_SESSION });
    const tries: string[] = [];
    let throttled = false;
    try {
      const page = await context.newPage();
      const login = new LoginPage(page);
      for (let i = 1; i <= 7; i++) {
        await login.open();
        const started = Date.now();
        const answer = page.waitForResponse((r) => r.request().method() === 'POST', { timeout: 60_000 }).catch(() => null);
        await login.login(username, `Wrong#Password${i}`);
        const status = (await answer)?.status() ?? 0;
        await page.waitForLoadState('load');
        const message = (await page.locator('.alert, .invalid-feedback, [role="alert"], .text-danger').allInnerTexts()).join(' ').replace(/\s+/g, ' ').trim();
        const captcha = (await page.locator('iframe[src*="captcha"], .g-recaptcha, .h-captcha, [name*="captcha" i]').count()) > 0;
        const seconds = (Date.now() - started) / 1000;
        tries.push(`#${i}: HTTP ${status}, ${seconds.toFixed(1)} s, "${message}"${captcha ? ', CAPTCHA' : ''}`);
        if (status === 429 || captcha || /ลองใหม่.*(วินาที|นาที)|seconds|minutes|ล็อก|ระงับ|too many|มากเกินไป/i.test(message)) throttled = true;
      }
    } finally {
      await context.close();
    }
    note(`Attempts with a wrong password:\n${tries.join('\n')}`);
    // The real admin can still sign in (the lockout, if any, is per account — not per address).
    const admin = await browser.newContext({ storageState: ANONYMOUS_SESSION });
    try {
      const page = await admin.newPage();
      const ok = await new LoginPage(page).loginAndWaitForDashboard(env.adminUser, env.adminPass).then(() => true, () => false);
      note(`Admin sign-in from the same address afterwards: ${ok ? 'works' : 'blocked'}`);
      expect.soft(ok, 'other accounts are not locked out').toBe(true);
    } finally {
      await admin.close();
    }
    test.fail(!throttled, KNOWN.NO_LOGIN_THROTTLE);
    expect(throttled, 'after 5–6 failures the login is slowed down / locked (policy: 5 tries per 15 min)').toBe(true);
  });
});
