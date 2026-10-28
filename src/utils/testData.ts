export const VALID_PASSWORD = 'Km@2569Test!';

/** Email of the built-in admin account (seen in /admin/user/index, 2026-09-25). */
export const ADMIN_EMAIL = 'admin@cu-km-nurse.local';

/**
 * Marker put on EVERY record the automation creates (the tests run against
 * the Dev environment, but nothing removes these records automatically), so
 * they can be found and deleted later: search the user list for
 * "Auto Test" or "qa_auto". Users get it in name and department by default
 * (a field a test overrides is the one being tested, so it can't carry the
 * marker — the other fields and the `qa_auto_` username prefix still do).
 */
export const AUTO_TEST_FLAG = '[Auto Test]';

/** Full name used by tests that don't care about the name field itself. */
export const DEFAULT_TEST_NAME = `${AUTO_TEST_FLAG} ผู้ใช้ทดสอบอัตโนมัติ`;

/** Department used by tests that don't care about the department field itself. */
export const DEFAULT_TEST_DEPARTMENT = `${AUTO_TEST_FLAG} ทดสอบอัตโนมัติ`;

/** Admin /admin/* pages that must never be reachable without a session (TC-AUTH-03-03). */
export const PROTECTED_ADMIN_URLS = [
  '/admin/dashboard/index',
  '/admin/home/index',
  '/admin/cops/index',
  '/admin/knowledge/index',
  '/admin/activity/index',
  '/admin/bestpractice/index',
  '/admin/news/index',
  '/admin/sitemap/index',
  '/admin/group/index',
  '/admin/contractus/index',
  '/admin/faq/index',
  '/admin/user/index',
  '/admin/role/index',
  '/admin/activity-log',
];

/**
 * By design (QA, 2026-10-02): users sign in through LDAP (CU NET) and no password is stored — the admin looks the
 * person up and assigns roles. A user created by the tests therefore cannot sign in on Dev, so the cases that need
 * a freshly created user to log in are on hold until they can run at UAT with a CU NET/LDAP test account (DEF-49).
 */
export const NEEDS_LDAP_ACCOUNT =
  'On hold (UAT): needs a CU NET/LDAP test account — users created in the admin have no local password by design (DEF-49).';
