import { test, expect } from '@fixtures/pages.fixtures';
import { NEEDS_LDAP_ACCOUNT } from '@utils/testData';
import { requireDataCreatingTestsAllowed } from '@config/env';
import { collectDialogs } from '@utils/security';
import { Mode, seedRecords, sweepPages, TEXT_FIELDS } from '@utils/storedInjection';

/**
 * KM-SEC / SC-SEC-01 — payloads STORED in text fields (TC-SEC-01-01 XSS, -05
 * template/expression injection, -08 unclosed HTML). The same sweep runs for the
 * three payload families (see src/utils/storedInjection.ts): a role and a user
 * carry the payload in every text field the automation can create, then the
 * admin pages, the user's own session, the activity log and the public site are
 * opened and inspected.
 *
 * COVERAGE: users (name, department, position) and roles (name, description).
 * The sheet says "every field of every module"; the other modules' forms have no
 * page object yet, so their fields are added to the sweep as those modules are
 * automated. Not covered by any page: report files (the app has no export).
 *
 * Creates a user (`qa_auto_…`) and a role ("[Auto Test]") per case; skipped unless
 * data-creating tests are allowed. Clean up with `npm run cleanup:data -- --delete`.
 */

const REASON = 'Creates a user and a role that only `npm run cleanup:data` can remove.';

const CASES: Array<{ id: string; mode: Mode; title: string; expectation: string }> = [
  { id: 'TC-SEC-01-01 [High]', mode: 'xss', title: 'Stored XSS ในทุกช่องข้อความ', expectation: 'no script runs and the payload is shown as escaped text' },
  { id: 'TC-SEC-01-05 [Medium]', mode: 'template', title: 'Template/Expression Injection', expectation: '{{7*7}}, ${7*7}, <%= 7*7 %> and #{7*7} are shown literally, never evaluated' },
  { id: 'TC-SEC-01-08 [Medium]', mode: 'broken', title: 'HTML ที่ปิดแท็กไม่ครบไม่ทำให้เลย์เอาต์พัง', expectation: 'the text is escaped, the layout stays intact and nothing covers the screen' },
];

test.describe('SC-SEC-01 Payload ที่ถูกเก็บลงข้อมูล (Stored)', () => {
  test.beforeEach(() => requireDataCreatingTestsAllowed(REASON));

  for (const { id, mode, title, expectation } of CASES) {
    test(`${id} ${title}`, async ({ browser, page, roleListPage, roleFormPage, userListPage }) => {
      test.setTimeout(360_000);
      // The seeded user must sign in to check its own dashboard — needs an LDAP account, so on hold until UAT.
      test.fixme(true, NEEDS_LDAP_ACCOUNT);
      const dialogs = collectDialogs(page);
      const pages = { browser, page, roleListPage, roleFormPage, userListPage };
      const problems: string[] = [];

      const seed = await seedRecords(mode, pages, problems);
      problems.push(...(await sweepPages(mode, seed, pages, dialogs)));

      test.info().annotations.push({
        type: 'note',
        description: `Coverage: user (${TEXT_FIELDS.filter((f) => !f.startsWith('role')).join(', ')}) and role (name, description); role ${seed.roleAssigned ? 'assigned to' : 'not assigned to'} the user. Pages: user list + edit form, role list + edit form, role picker, activity log, the user's own dashboard, 10 public pages.`,
      });
      expect(problems, `stored payload (${mode}) — expected: ${expectation}`).toEqual([]);
    });
  }
});
