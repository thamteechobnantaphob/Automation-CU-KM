import { test, expect } from '@fixtures/pages.fixtures';
import { requireDataCreatingTestsAllowed } from '@config/env';
import { AdminRoleFormPage, AdminRoleListPage, RoleFormValues } from '@pages/admin/AdminRolePages';
import {
  AUTO_ROLE_DESCRIPTION,
  autoRoleLabel,
  collectDialogs,
  createRole,
  expectRoleRejected,
  pageLeaksServerDetails,
  stampedLabel,
  submitNewRole,
} from '@utils/roleFlows';
import { Page } from '@playwright/test';

/**
 * KM-FROL / SC-FROL-02 (name + description of a role) and KM-ADMR / SC-ADMR-04
 * (name of a role). Both sheets drive the SAME form (/admin/role/detail), so
 * each scenario is written once and run for both case ids.
 *
 * These cases SAVE roles, and roles can only be removed by
 * `npm run cleanup:roles`, so:
 *   - `requireDataCreatingTestsAllowed()` skips them unless the run allows it;
 *   - every role carries "[Auto Test]" (in the name, or in the description when
 *     the name is the field under test) and a time stamp, so it is unique per run.
 *
 * NOT implemented (sheet uses {MAX}, which nobody has defined; the form has no
 * maxlength): TC-FROL-02-04/05/14/15, TC-ADMR-04-03/04.
 */

interface Ctx {
  page: Page;
  roleListPage: AdminRoleListPage;
  roleFormPage: AdminRoleFormPage;
}

const REASON = 'Submitting the form creates a role that only `npm run cleanup:roles` can remove.';

const HTML_PAYLOAD = '<b>bold</b><script>alert(1)</script>';
const SQL_PAYLOAD = "' OR 1=1; DROP TABLE users;--";
const BUILT_IN_ROLES = ['ผู้ดูแลระบบ', 'บุคลากรที่ได้รับมอบหมาย'];

// ------------------------------------------------------------------ scenarios (name)

/** A plain value must be saved and shown exactly as typed in the list and on the edit form. */
async function savesLabel({ page, roleListPage, roleFormPage }: Ctx, sample: string): Promise<void> {
  const label = stampedLabel(sample);
  const row = await createRole(page, roleListPage, roleFormPage, { label, description: AUTO_ROLE_DESCRIPTION });

  expect(row.name).toBe(label);
  expect(row.users).toBe('0');
  const form = await roleListPage.openEditForm(label);
  await expect(form.labelInput).toHaveValue(label);
  await expect(form.descriptionInput).toHaveValue(AUTO_ROLE_DESCRIPTION);
}

/**
 * A payload that could hurt (script, SQL, emoji) is either saved as plain text or
 * rejected — never a server error, never executed. Returns what happened.
 */
async function submitPayload(
  ctx: Ctx,
  values: RoleFormValues & { label: string },
  dialogs: string[],
): Promise<'saved' | 'rejected'> {
  const { page, roleListPage, roleFormPage } = ctx;
  const before = await roleListPage.roleCount();
  const response = await submitNewRole(roleListPage, roleFormPage, values);
  expect(response.status(), 'the payload must not cause a server error').toBeLessThan(500);
  expect(await pageLeaksServerDetails(page), 'no SQL/stack-trace text on the page').toBe(false);

  const after = await roleListPage.roleCount();
  expect(after, 'at most one role is created').toBeLessThanOrEqual(before + 1);
  const saved = after === before + 1;

  if (saved) {
    // Shown as text exactly as typed (a rendered <b> or a run script would change the cell text).
    const row = await roleListPage.findRole(values.label);
    expect(row, `saved "${values.label}" must be listed as plain text (not rendered)`).toBeDefined();
    if (values.description !== undefined) expect(row?.description).toBe(values.description.trim());
    const form = await roleListPage.openEditForm(values.label);
    await expect(form.labelInput).toHaveValue(values.label);
  }
  expect(dialogs, 'no script may run (no alert/confirm/prompt)').toEqual([]);
  return saved ? 'saved' : 'rejected';
}

async function labelWithHtml(ctx: Ctx): Promise<void> {
  const dialogs = collectDialogs(ctx.page);
  const outcome = await submitPayload(
    ctx,
    { label: stampedLabel(HTML_PAYLOAD), description: AUTO_ROLE_DESCRIPTION },
    dialogs,
  );
  test.info().annotations.push({ type: 'note', description: `HTML in the name was ${outcome === 'saved' ? 'saved and shown as text' : 'rejected'}.` });
}

async function labelWithSql(ctx: Ctx): Promise<void> {
  const dialogs = collectDialogs(ctx.page);
  const outcome = await submitPayload(
    ctx,
    { label: stampedLabel(SQL_PAYLOAD), description: AUTO_ROLE_DESCRIPTION },
    dialogs,
  );

  // "ข้อมูลอื่นไม่ถูกกระทบ": the built-in roles are still there, and the users table still exists.
  await ctx.roleListPage.open();
  const names = (await ctx.roleListPage.readRoles()).map((role) => role.name);
  for (const name of BUILT_IN_ROLES) expect(names, `role "${name}" is untouched`).toContain(name);
  const users = await ctx.page.request.get('/admin/user/index');
  expect(users.status(), 'the user list still loads').toBe(200);
  expect(await users.text()).toContain('admin');
  test.info().annotations.push({ type: 'note', description: `SQL text in the name was ${outcome === 'saved' ? 'saved as plain text' : 'rejected'}.` });
}

/** The browser (required) must stop an empty name: still on the form, values already typed stay. */
async function labelEmptyBlockedByBrowser({ page, roleListPage, roleFormPage }: Ctx): Promise<void> {
  const before = await roleListPage.roleCount();
  await roleListPage.openAddForm();
  await roleFormPage.fill({ label: '', description: AUTO_ROLE_DESCRIPTION, levels: { home: 'view' } });
  await roleFormPage.saveButton.click();

  await expect(page).toHaveURL(/\/admin\/role\/detail$/);
  const message = await roleFormPage.labelInput.evaluate((el: HTMLInputElement) => el.validationMessage);
  expect(message, 'browser validation message on the name').not.toBe('');
  await expect(roleFormPage.descriptionInput, 'what was already typed is kept').toHaveValue(AUTO_ROLE_DESCRIPTION);
  await expect(roleFormPage.radio('home', 'view')).toBeChecked();

  expect(await roleListPage.roleCount(), 'nothing was saved').toBe(before);
}

/** Five spaces pass the browser's `required`; the SERVER must treat them as empty. */
async function labelSpacesOnlyRejected({ page, roleListPage, roleFormPage }: Ctx): Promise<void> {
  await expectRoleRejected(page, roleListPage, roleFormPage, { label: '     ', description: AUTO_ROLE_DESCRIPTION });
}

test.describe('SC-FROL-02 ชื่อและคำอธิบายสิทธิ์ — ชื่อสิทธิ์ (label)', () => {
  test.setTimeout(60_000);
  test.beforeEach(() => requireDataCreatingTestsAllowed(REASON));

  test('TC-FROL-02-01 [High] ชื่อสิทธิ์: ข้อความภาษาไทยปกติ', async ({ page, roleListPage, roleFormPage }) => {
    await savesLabel({ page, roleListPage, roleFormPage }, 'ระบบจัดการความรู้ทดสอบ');
  });

  test('TC-FROL-02-02 [Medium] ชื่อสิทธิ์: ภาษาอังกฤษและตัวเลข', async ({ page, roleListPage, roleFormPage }) => {
    await savesLabel({ page, roleListPage, roleFormPage }, 'Test Case 001');
  });

  test('TC-FROL-02-03 [Medium] ชื่อสิทธิ์: ผสมไทย/อังกฤษ/ตัวเลข/สัญลักษณ์ทั่วไป', async ({ page, roleListPage, roleFormPage }) => {
    // "&" must come back as "&", not "&amp;" (double escaping).
    await savesLabel({ page, roleListPage, roleFormPage }, 'KM-Day 2569: SHOW & SHARE (รอบ 1)');
  });

  test('TC-FROL-02-06 [Low] ชื่อสิทธิ์: มีช่องว่างหน้า-หลังข้อความ', async ({ page, roleListPage, roleFormPage }) => {
    const core = stampedLabel('ทดสอบ');
    const row = await createRole(page, roleListPage, roleFormPage, { label: `  ${core}  `, description: AUTO_ROLE_DESCRIPTION });

    // TBD in the sheet whether the server trims; either is fine as long as the text itself is intact.
    expect(row.name).toBe(core);
    const form = await roleListPage.openEditForm(core);
    const stored = await form.labelInput.inputValue();
    expect(stored.trim()).toBe(core);
    test.info().annotations.push({
      type: 'note',
      description: stored === core ? 'The server trims leading/trailing spaces.' : `The server keeps the spaces as typed (stored ${JSON.stringify(stored)}).`,
    });
  });

  test('TC-FROL-02-07 [High] ชื่อสิทธิ์: แท็ก HTML และสคริปต์', async ({ page, roleListPage, roleFormPage }) => {
    await labelWithHtml({ page, roleListPage, roleFormPage });
  });

  test('TC-FROL-02-08 [High] ชื่อสิทธิ์: อักขระ SQL', async ({ page, roleListPage, roleFormPage }) => {
    await labelWithSql({ page, roleListPage, roleFormPage });
  });

  test('TC-FROL-02-09 [Low] ชื่อสิทธิ์: อีโมจิและ Unicode พิเศษ', async ({ page, roleListPage, roleFormPage }) => {
    const label = stampedLabel('ทดสอบ 😀 ✓ ①');
    const dialogs = collectDialogs(page);
    const outcome = await submitPayload({ page, roleListPage, roleFormPage }, { label, description: AUTO_ROLE_DESCRIPTION }, dialogs);
    // Saved → shown exactly (checked in submitPayload: no "?" / mojibake); rejected → clear, no HTTP 500.
    test.info().annotations.push({ type: 'note', description: `Emoji/Unicode in the name was ${outcome === 'saved' ? 'saved and displayed intact' : 'rejected without a server error'}.` });
  });

  test('TC-FROL-02-10 [High] ชื่อสิทธิ์: เว้นว่าง', async ({ page, roleListPage, roleFormPage }) => {
    await labelEmptyBlockedByBrowser({ page, roleListPage, roleFormPage });
  });

  test('TC-FROL-02-11 [Medium] ชื่อสิทธิ์: ช่องว่างล้วน (เว้นวรรค 5 ตัว)', async ({ page, roleListPage, roleFormPage }) => {
    await labelSpacesOnlyRejected({ page, roleListPage, roleFormPage });
  });
});

test.describe('SC-FROL-02 ชื่อและคำอธิบายสิทธิ์ — คำอธิบาย (description)', () => {
  test.setTimeout(60_000);
  test.beforeEach(() => requireDataCreatingTestsAllowed(REASON));

  test('TC-FROL-02-13 [High] คำอธิบาย: ข้อความภาษาไทยปกติ', async ({ page, roleListPage, roleFormPage }) => {
    const label = autoRoleLabel('02-13');
    const description = 'ระบบจัดการความรู้ทดสอบ';
    const row = await createRole(page, roleListPage, roleFormPage, { label, description });

    expect(row.description).toBe(description);
    const form = await roleListPage.openEditForm(label);
    await expect(form.descriptionInput).toHaveValue(description);
  });

  test('TC-FROL-02-16 [High] คำอธิบาย: แท็ก HTML และสคริปต์', async ({ page, roleListPage, roleFormPage }) => {
    const dialogs = collectDialogs(page);
    const label = autoRoleLabel('02-16');
    const outcome = await submitPayload({ page, roleListPage, roleFormPage }, { label, description: HTML_PAYLOAD }, dialogs);

    if (outcome === 'saved') {
      const form = await roleListPage.openEditForm(label);
      await expect(form.descriptionInput, 'the description round-trips as text').toHaveValue(HTML_PAYLOAD);
      expect(dialogs, 'no script may run on the list or the edit form').toEqual([]);
    }
    test.info().annotations.push({ type: 'note', description: `HTML in the description was ${outcome === 'saved' ? 'saved and shown as text' : 'rejected'}.` });
  });

  test('TC-FROL-02-17 [Medium] คำอธิบาย: เว้นว่าง (ไม่บังคับ)', async ({ page, roleListPage, roleFormPage }) => {
    const label = autoRoleLabel('02-17');
    const row = await createRole(page, roleListPage, roleFormPage, { label, description: '' });

    expect(row.description).toBe('');
    // No placeholder text such as "null"/"undefined" where the description would be.
    const cell = roleListPage.rowByName(label).locator('td').nth(1);
    await expect(cell).not.toContainText(/null|undefined/i);
    const form = await roleListPage.openEditForm(label);
    await expect(form.descriptionInput).toHaveValue('');
  });
});

test.describe('SC-ADMR-04 สิทธิ์: ตรวจชื่อ', () => {
  test.setTimeout(60_000);
  test.beforeEach(() => requireDataCreatingTestsAllowed(REASON));

  test('TC-ADMR-04-01 [High] ชื่อสิทธิ์: ข้อความภาษาไทยปกติ', async ({ page, roleListPage, roleFormPage }) => {
    await savesLabel({ page, roleListPage, roleFormPage }, 'ระบบจัดการความรู้ทดสอบ');
  });

  test('TC-ADMR-04-02 [Medium] ชื่อสิทธิ์: ภาษาอังกฤษและตัวเลข', async ({ page, roleListPage, roleFormPage }) => {
    await savesLabel({ page, roleListPage, roleFormPage }, 'Test Case 001');
  });

  test('TC-ADMR-04-05 [High] ชื่อสิทธิ์: แท็ก HTML และสคริปต์', async ({ page, roleListPage, roleFormPage }) => {
    await labelWithHtml({ page, roleListPage, roleFormPage });
  });

  test('TC-ADMR-04-06 [High] ชื่อสิทธิ์: อักขระ SQL', async ({ page, roleListPage, roleFormPage }) => {
    await labelWithSql({ page, roleListPage, roleFormPage });
  });

  test('TC-ADMR-04-07 [High] ชื่อสิทธิ์: เว้นว่าง', async ({ page, roleListPage, roleFormPage }) => {
    await labelEmptyBlockedByBrowser({ page, roleListPage, roleFormPage });
  });

  test('TC-ADMR-04-08 [Medium] ชื่อสิทธิ์: ช่องว่างล้วน (เว้นวรรค 5 ตัว)', async ({ page, roleListPage, roleFormPage }) => {
    await labelSpacesOnlyRejected({ page, roleListPage, roleFormPage });
  });
});
