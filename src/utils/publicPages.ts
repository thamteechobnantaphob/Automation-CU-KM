/**
 * Reference data for the public (no-login) site — KM-FEH / KM-FEC / KM-FEK /
 * KM-FEN. Kept in one place because several test cases are "data-driven over
 * the same table" (see the Remarks column of the source sheet).
 */

/** Every public URL — TC-FEH-03-01 ("ทุกหน้า Public เข้าถึงได้โดยไม่ต้อง Login"). */
export const PUBLIC_PAGES: ReadonlyArray<{ name: string; path: string }> = [
  { name: 'หน้าหลัก', path: '/' },
  { name: 'ชุมชนนักปฏิบัติ', path: '/frontend/cops/index' },
  { name: 'คลังความรู้', path: '/frontend/knowledge/index' },
  { name: 'แนวปฏิบัติที่ดี', path: '/frontend/bestpractice/index' },
  { name: 'ข่าวสาร KM', path: '/frontend/news/index' },
  { name: 'คลังกิจกรรม', path: '/frontend/activity/index' },
  { name: 'ติดต่อสอบถาม', path: '/frontend/contractus/index' },
  { name: 'คำถามที่พบบ่อย', path: '/frontend/faq/index' },
  { name: 'ค้นหา', path: '/frontend/search/index' },
];

/** Pages that list content and could be paginated with ?page=N. */
export const PUBLIC_LIST_PATHS = [
  '/frontend/cops/index',
  '/frontend/knowledge/index',
  '/frontend/bestpractice/index',
  '/frontend/news/index',
  '/frontend/activity/index',
  '/frontend/faq/index',
] as const;

/**
 * Header dropdown menu → link → destination (TC-FEH-01-02, TC-FEH-03-07).
 * Labels are copied verbatim from the UI, including the app's own spelling
 * "แนวปฎิบัติที่ดี" (ฎ) in the header vs "แนวปฏิบัติที่ดี" (ฏ) in the footer.
 */
export const DROPDOWN_MENU: ReadonlyArray<{ toggle: string; item: string; path: string }> = [
  { toggle: 'Knowledge', item: 'องค์ความรู้ทั่วไป (Knowledge)', path: '/frontend/knowledge/index' },
  { toggle: 'Knowledge', item: 'แนวปฎิบัติที่ดี (Best Practice)', path: '/frontend/bestpractice/index' },
  { toggle: 'คลังกิจกรรม', item: 'ข่าวสาร KM', path: '/frontend/news/index' },
  { toggle: 'คลังกิจกรรม', item: 'คลังกิจกรรม', path: '/frontend/activity/index' },
  { toggle: 'ติดต่อสอบถาม', item: 'ติดต่อสอบถาม', path: '/frontend/contractus/index' },
  { toggle: 'ติดต่อสอบถาม', item: 'คำถามที่พบบ่อย', path: '/frontend/faq/index' },
];

export const DROPDOWN_TOGGLES = ['Knowledge', 'คลังกิจกรรม', 'ติดต่อสอบถาม'] as const;

/** Footer links → where each should lead (TC-FEH-01-04). */
export const FOOTER_LINKS: ReadonlyArray<{ label: string; path: string }> = [
  { label: 'องค์ความรู้ทั่วไป (Knowledge)', path: '/frontend/knowledge/index' },
  { label: 'แนวปฏิบัติที่ดี (Best Practice)', path: '/frontend/bestpractice/index' },
  { label: 'ข่าวสาร KM', path: '/frontend/news/index' },
  { label: 'คลังกิจกรรม', path: '/frontend/activity/index' },
  { label: 'ติดต่อสอบถาม', path: '/frontend/contractus/index' },
  { label: 'คำถามที่พบบ่อย (FAQ)', path: '/frontend/faq/index' },
];

/**
 * Thai date as the source sheet expects it (พ.ศ., abbreviated month with a
 * single dot, four-digit year) — e.g. "18 ก.ย. 2569" (TC-FEN-03-03).
 */
export const THAI_SHORT_DATE = /^\d{1,2} (ม\.ค\.|ก\.พ\.|มี\.ค\.|เม\.ย\.|พ\.ค\.|มิ\.ย\.|ก\.ค\.|ส\.ค\.|ก\.ย\.|ต\.ค\.|พ\.ย\.|ธ\.ค\.) 25\d{2}$/;

/** Text in the responses that means the server leaked internals or crashed. */
export const SERVER_LEAK_PATTERN = /SQLSTATE|Stack trace|Whoops|vendor\/laravel|\/var\/www|root:.*:0:0|Fatal error/i;
