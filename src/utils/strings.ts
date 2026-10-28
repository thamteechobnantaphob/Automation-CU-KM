/** Repeats a character to build boundary-length strings, e.g. longString(1000). */
export function longString(length: number, char = 'ก'): string {
  return char.repeat(length);
}

/**
 * Case-sensitive, whole-text match for locators' `hasText` / `getByText`.
 * Needed on the public menus where labels repeat ("คลังกิจกรรม" is both a
 * dropdown toggle and one of its items) and substring matching would hit both.
 */
export function exactText(text: string): RegExp {
  return new RegExp(`^\\s*${text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\s*$`);
}

/**
 * A username/email prefix used by every automated test that creates data
 * through the UI, so seeded records are easy to find and are never mistaken
 * for real users. Together with AUTO_TEST_FLAG ("[Auto Test]" in name and
 * department, see testData.ts) this is what to search for when cleaning up
 * — see README section 5 (nothing deletes these records automatically).
 */
export const QA_PREFIX = 'qa_auto';

export function uniqueUsername(suffix = ''): string {
  const stamp = Date.now().toString(36);
  return `${QA_PREFIX}_${stamp}${suffix ? `_${suffix}` : ''}`;
}

export function uniqueEmail(suffix = ''): string {
  return `${uniqueUsername(suffix)}@example.com`;
}
