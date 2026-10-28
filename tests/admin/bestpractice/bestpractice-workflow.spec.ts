import { BEST_PRACTICE_MODULE } from '@pages/admin/AdminNewsPages';
import { contentWorkflowSuite, LIST_MODULE_IDS } from '../content/contentWorkflowSuite';

/**
 * KM-BP Auto:P cases (shared with KM-NEWS and KM-KNOW: tests/admin/content/contentWorkflowSuite.ts).
 * NOT implemented: TC-BP-10-03 (cover {MAX_MB} not given), TC-BP-13-01 / 13-04 (need a second account that can log in).
 */
contentWorkflowSuite({ module: BEST_PRACTICE_MODULE, prefix: 'BP', name: 'แนวทางปฏิบัติที่ดี (Best Practice)', ids: LIST_MODULE_IDS });
