import * as dotenv from 'dotenv';
import { test } from '@playwright/test';

dotenv.config();

function required(name: string, fallback = ''): string {
  const value = process.env[name] ?? fallback;
  return value;
}

export const env = {
  baseURL: required('BASE_URL', 'http://192.100.10.26:8081'),
  adminUser: required('ADMIN_USER'),
  adminPass: required('ADMIN_PASS'),
  staffUser: required('STAFF_USER'),
  staffPass: required('STAFF_PASS'),
  /** A second officer ("เจ้าหน้าที่") account — SRS cases where one officer touches another's content (UAT, CU NET). */
  staff2User: required('STAFF2_USER'),
  staff2Pass: required('STAFF2_PASS'),
  /**
   * Several forms under test (e.g. /admin/user/index) were assumed to have
   * no delete action in the UI (only "add"/"edit") based on the source
   * spec sheet — a 2026-09-24 run found a delete-confirmation dialog does
   * exist for at least non-system accounts, but nobody has confirmed it
   * end-to-end yet. Until that's verified, treat any successful submit as
   * creating a record that may not be cleanly removable. Those tests call
   * `requireDataCreatingTestsAllowed()` and skip themselves unless this is
   * explicitly turned on, so nobody floods the shared environment just by
   * running the default suite.
   */
  allowDataCreatingTests: required('ALLOW_DATA_CREATING_TESTS').toLowerCase() === 'true',
  /**
   * When true, screenshot + video are recorded for EVERY test (not just
   * failures) so `npm run test:evidence` can archive proof for passing
   * cases too. Off by default — it makes runs heavier and the captures
   * include real data (e.g. user emails visible in /admin/user/index).
   */
  evidence: required('EVIDENCE').toLowerCase() === 'true',
};

/**
 * Call this as the first line of any test that will submit a form with no
 * corresponding delete action in the UI (e.g. /admin/user/index). It skips
 * the test unless ALLOW_DATA_CREATING_TESTS=true is set in .env.
 */
export function requireDataCreatingTestsAllowed(reason: string): void {
  test.skip(
    !env.allowDataCreatingTests,
    `Set ALLOW_DATA_CREATING_TESTS=true in .env to run this test. ${reason}`,
  );
}
