import { BEST_PRACTICE_MODULE } from '@pages/admin/AdminNewsPages';
import { contentFormSuite } from '../content/contentFormSuite';

/**
 * KM-FBPR — the best-practice form (/admin/bestpractice/create) and its consistency with the knowledge form. The
 * cases are shared with KM-FNEW (tests/admin/content/contentFormSuite.ts).
 */
contentFormSuite({ module: BEST_PRACTICE_MODULE, prefix: 'FBPR', name: 'แนวทางปฏิบัติที่ดี', sampleTitle: 'AUTO_FBPR_001' });
