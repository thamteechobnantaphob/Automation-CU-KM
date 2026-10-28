import { expect, Page, Response } from '@playwright/test';
import { AdminRoleFormPage, AdminRoleListPage, RoleFormValues, RoleRow } from '@pages/admin/AdminRolePages';
import { SERVER_LEAK_PATTERN } from '@utils/publicPages';
import { AUTO_TEST_FLAG } from '@utils/testData';
import { QA_PREFIX } from '@utils/strings';

/**
 * Shared steps for the role specs (KM-ADMR / KM-FROL). Roles cannot be removed
 * by the tests, so every value that gets saved must be findable and unique:
 *
 *  - a role is unique per run (its name gets a time stamp) because the app is
 *    expected to reject a duplicate name;
 *  - the "[Auto Test]" marker sits in the NAME when the name is not what the
 *    test is about, and in the DESCRIPTION when it is (a name under test can't
 *    carry extra text). `npm run cleanup:roles` deletes roles with the marker
 *    in either field.
 */

/** Description that marks a role created while its NAME is the field under test. */
export const AUTO_ROLE_DESCRIPTION = `${AUTO_TEST_FLAG} สิทธิ์ทดสอบอัตโนมัติ`;

export function roleStamp(): string {
  return `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 4)}`;
}

/** Name for a role whose name is not under test: "[Auto Test] qa_auto_<stamp>_<tag>". */
export function autoRoleLabel(tag: string): string {
  return `${AUTO_TEST_FLAG} ${QA_PREFIX}_${roleStamp()}_${tag}`;
}

/** The sheet's sample name made unique for this run: "<sample> <stamp>". */
export function stampedLabel(sample: string): string {
  return `${sample} ${roleStamp()}`;
}

/** Opens the add form from the list, fills it and presses "บันทึก". Returns the response of the submit. */
export async function submitNewRole(
  roleListPage: AdminRoleListPage,
  roleFormPage: AdminRoleFormPage,
  values: RoleFormValues,
): Promise<Response> {
  await roleListPage.open();
  await roleListPage.openAddForm();
  await roleFormPage.fill({ levels: { home: 'view' }, ...values });
  return roleFormPage.save();
}

/** Where a successful save lands. */
export const ROLE_LIST_URL = /\/admin\/role(\/index)?\/?$/;

/** Creates a role and checks it went to the list and is listed; returns its row. */
export async function createRole(
  page: Page,
  roleListPage: AdminRoleListPage,
  roleFormPage: AdminRoleFormPage,
  values: RoleFormValues,
): Promise<RoleRow> {
  const response = await submitNewRole(roleListPage, roleFormPage, values);
  expect(response.status(), 'a valid role is saved without a server error').toBeLessThan(500);
  await expect(page).toHaveURL(ROLE_LIST_URL);
  const label = (values.label as string).trim();
  const row = await roleListPage.findRole(label);
  expect(row, `role "${label}" should be in the list`).toBeDefined();
  return row as RoleRow;
}

/**
 * Submits the form and asserts nothing was saved: no server error, the count
 * of roles is unchanged, and (when `expectMessage`) the page says why.
 */
export async function expectRoleRejected(
  page: Page,
  roleListPage: AdminRoleListPage,
  roleFormPage: AdminRoleFormPage,
  values: RoleFormValues,
): Promise<void> {
  const before = await roleListPage.roleCount();
  const response = await submitNewRole(roleListPage, roleFormPage, values);
  expect(response.status(), 'a rejected role must not be a server error').toBeLessThan(500);
  expect(await roleListPage.roleCount(), 'no role should have been created').toBe(before);
}

/** Re-exported: now lives in security.ts, which the KM-SEC specs share. */
export { collectDialogs } from '@utils/security';

/** True when the page text shows a server/SQL error (stack trace, SQLSTATE …). */
export async function pageLeaksServerDetails(page: Page): Promise<boolean> {
  return SERVER_LEAK_PATTERN.test(await page.locator('body').innerText());
}
