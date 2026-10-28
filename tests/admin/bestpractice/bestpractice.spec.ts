import { BEST_PRACTICE_MODULE } from '@pages/admin/AdminNewsPages';
import { contentListSuite } from '../content/contentListSuite';

/**
 * KM-BP — "แนวทางปฎิบัติที่ดี (Best Practice)" in the admin (/admin/bestpractice/index). Same list, search and form as
 * news/knowledge (recon 2026-10-02): flash "เพิ่ม/ลบแนวทางปฏิบัติที่ดีเรียบร้อยแล้ว", public list
 * /frontend/bestpractice/index, detail /frontend/bestpractice/detail/<slug>. The list is empty on Dev; every case
 * creates and deletes its own items. The cases are shared with KM-NEWS (tests/admin/content/contentListSuite.ts).
 *
 * NOT implemented ({MAX} undefined, no maxlength — DEF-52): TC-BP-05-02/03, 06-01/02.
 */
contentListSuite({ module: BEST_PRACTICE_MODULE, prefix: 'BP', name: 'แนวทางปฏิบัติที่ดี (Best Practice)', noun: 'แนวปฏิบัติ' });
