import { test, expect } from '@fixtures/pages.fixtures';
import { requireDataCreatingTestsAllowed } from '@config/env';
import { VALID_PASSWORD } from '@utils/testData';
import { uniqueUsername } from '@utils/strings';
import { AUTO_ROLE_DESCRIPTION, autoRoleLabel, createRole } from '@utils/roleFlows';
import { createUserWithRoles } from '@utils/userFlows';

/**
 * How giving users a role shows up in the role list's "จำนวนผู้ใช้" column:
 * TC-FROL-05-04 (KM-FROL) and TC-ADMR-05-07 (KM-ADMR).
 *
 * Each case seeds its own roles and users (all flagged, unique per run) and
 * leaves them behind: clean up with `npm run cleanup:data -- --delete` (users
 * are removed first, then the roles — a role can only be deleted once no user
 * holds it). Skipped unless the run allows data-creating tests.
 */

const REASON = 'Seeds roles and users that only `npm run cleanup:data` can remove.';

test.describe('SC-FROL-05 / SC-ADMR-05 จำนวนผู้ใช้ในรายการสิทธิ์', () => {
  test.setTimeout(150_000);
  test.beforeEach(() => requireDataCreatingTestsAllowed(REASON));

  test('TC-FROL-05-04 [Medium] จำนวนผู้ใช้ในรายการสิทธิ์อัปเดต', async ({ page, roleListPage, roleFormPage, userListPage }) => {
    const label = autoRoleLabel('05-04');
    await createRole(page, roleListPage, roleFormPage, { label, description: AUTO_ROLE_DESCRIPTION });
    expect((await roleListPage.findRole(label))?.users, 'a new role starts with no users').toBe('0');

    await createUserWithRoles(userListPage, { username: uniqueUsername('r0501') }, label);
    await createUserWithRoles(userListPage, { username: uniqueUsername('r0502') }, label);

    await roleListPage.open();
    expect((await roleListPage.findRole(label))?.users, `users holding "${label}"`).toBe('2');
  });

  test('TC-ADMR-05-07 [Medium] จำนวนผู้ใช้ในรายการสิทธิ์อัปเดตเมื่อย้ายผู้ใช้', async ({ page, roleListPage, roleFormPage, userListPage }) => {
    const roleA = autoRoleLabel('05-07A');
    const roleB = autoRoleLabel('05-07B');
    await createRole(page, roleListPage, roleFormPage, { label: roleA, description: AUTO_ROLE_DESCRIPTION });
    await createRole(page, roleListPage, roleFormPage, { label: roleB, description: AUTO_ROLE_DESCRIPTION });

    const username = uniqueUsername('r0507');
    await createUserWithRoles(userListPage, { username }, roleA);
    await roleListPage.open();
    const usersOfA = Number((await roleListPage.findRole(roleA))?.users);
    const usersOfB = Number((await roleListPage.findRole(roleB))?.users);
    expect(usersOfA, 'precondition: the user holds role A').toBe(1);
    expect(usersOfB, 'precondition: nobody holds role B').toBe(0);

    // Move the user from A to B: clicking A in the picker un-selects it, B selects it.
    const edit = await userListPage.openEditUserForm(username);
    await edit.selectRoles(roleA, roleB);
    // Password fields (gone since 2026-10-01) are filled so a "password required" rule can't be what stops the save.
    if (await edit.passwordInput.count()) {
      await edit.passwordInput.fill(VALID_PASSWORD);
      await edit.passwordConfirmationInput.fill(VALID_PASSWORD);
    }
    await edit.save();
    await edit.waitForClosed();

    await roleListPage.open();
    expect(Number((await roleListPage.findRole(roleA))?.users), 'role A lost the user').toBe(usersOfA - 1);
    expect(Number((await roleListPage.findRole(roleB))?.users), 'role B gained the user').toBe(usersOfB + 1);
  });
});
