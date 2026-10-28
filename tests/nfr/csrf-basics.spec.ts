import { test, expect } from '@fixtures/pages.fixtures';
import { env } from '@config/env';
import { loginAs, urlOf } from '@utils/lowPrivilege';

/**
 * TC-NFR-02-01 — CSRF on the forms that change data, WITHOUT touching any data.
 *
 * KM-SEC (TC-SEC-03-03) already proves it on real records, but that one needs ALLOW_DATA_CREATING_TESTS. This is the
 * read-only version for the NFR sheet. Every request is sent with the admin's cookies and no token (or a wrong one):
 *   - logout runs in a throwaway session;
 *   - the "create" posts carry an EMPTY form, so even a server without CSRF protection would only answer with a
 *     validation error and create nothing;
 *   - the "delete" posts aim at the id "abc", which no record has.
 * A protected server answers 419/403 to all of them before it looks at the form.
 */
test.describe('SC-NFR-02 ความปลอดภัยพื้นฐาน', () => {
  test('TC-NFR-02-01 [High] ป้องกัน CSRF ในฟอร์มที่แก้ไขข้อมูล', async ({ browser }) => {
    test.skip(!env.adminUser || !env.adminPass, 'ADMIN_USER/ADMIN_PASS not set in .env');
    test.setTimeout(120_000);

    const { context, page } = await loginAs(browser, env.adminUser, env.adminPass);
    try {
      const attempts: Array<{ label: string; path: string; form: Record<string, string> }> = [
        { label: 'logout, no token', path: '/admin/logout', form: {} },
        { label: 'logout, wrong token', path: '/admin/logout', form: { _token: 'wrong-token' } },
        { label: 'create user, empty form', path: '/admin/user', form: {} },
        { label: 'create role, empty form', path: '/admin/role', form: {} },
        { label: 'create category, empty form', path: '/admin/group', form: {} },
        { label: 'delete user "abc"', path: '/admin/user/abc', form: { _method: 'DELETE' } },
        { label: 'delete role "abc"', path: '/admin/role/abc', form: { _method: 'DELETE' } },
        { label: 'edit user "abc"', path: '/admin/user/abc', form: { _method: 'PUT', name: 'x' } },
      ];
      const seen: string[] = [];
      const notRefused: string[] = [];
      for (const { label, path, form } of attempts) {
        const response = await context.request.post(urlOf(path), { form, maxRedirects: 0 });
        seen.push(`${label} → ${response.status()}`);
        if (![403, 419].includes(response.status())) notRefused.push(`${label} → HTTP ${response.status()}`);
      }
      test.info().annotations.push({ type: 'note', description: seen.join(' | ') });
      expect(notRefused, 'every state-changing POST without a valid token is refused with 419/403').toEqual([]);

      // Nothing was changed and the session is still alive (the logout attempts did not log anyone out).
      const dashboard = await page.goto(urlOf('/admin/dashboard/index'));
      expect(dashboard?.status()).toBe(200);
      expect(page.url()).toContain('/admin/dashboard/index');
    } finally {
      await context.close();
    }
  });
});
