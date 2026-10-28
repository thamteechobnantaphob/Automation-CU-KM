/**
 * Limits the tests assume where the sheets write {MAX}/{MIN}/TBD. Agreed with QA on 2026-10-07: until SA/Dev give
 * the real values, the cases use these proposals (OWASP-based, see docs/policy-assumptions.md). When SA decides other
 * values, change them here only — every case reads its limit from this file and says so in its notes.
 */
export const POLICY_SOURCE = 'ค่าตามข้อเสนอ OWASP (docs/policy-assumptions.md) — รอ SA/Dev ยืนยัน';

/** Maximum lengths (characters) per field; minimums where the sheet asks for one. */
export const MAX_LENGTH = {
  username: 50,
  usernameMin: 3,
  personName: 100,
  contactName: 100,
  authorName: 100,
  categoryName: 100,
  roleLabel: 100,
  footerLinkName: 100,
  department: 150,
  position: 150,
  source: 150,
  communityName: 150,
  title: 255,
  albumTitle: 255,
  excerpt: 500,
  description: 500,
  faqQuestion: 500,
  address: 500,
  contactMessage: 5000,
  faqAnswer: 10000,
  email: 254,
  url: 2048,
} as const;

/** Upload limits. */
export const UPLOAD = {
  documentMaxMB: 10,
  documentsPerItem: 10,
  imageMaxMB: 5,
  imageTypes: ['jpg', 'jpeg', 'png'],
  imagesPerUpload: 20,
  videoMaxMB: 50,
  requestMaxMB: 60,
  displayNameMax: 255,
} as const;

/** Session, throttling and logging expectations. */
export const SESSION = {
  idleTimeoutMinutes: 30,
  absoluteTimeoutHours: 12,
  loginFailuresBeforeThrottle: 5,
  loginWindowMinutes: 15,
  maxFailuresPerHour: 100,
  contactPostsPer10Minutes: 5,
} as const;

/** Characters that must be neutralised at the start of an exported CSV/Excel cell. */
export const CSV_FORMULA_PREFIXES = ['=', '+', '-', '@', '\t', '\r', '\n'] as const;
