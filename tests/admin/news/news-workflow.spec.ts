import { NEWS_MODULE } from '@pages/admin/AdminNewsPages';
import { contentWorkflowSuite, LIST_MODULE_IDS } from '../content/contentWorkflowSuite';

/**
 * KM-NEWS Auto:P cases — add / edit / publish / unpublish, sanitising, the cover, draft → publish, counters,
 * last-modified, paging and the activity log (shared with KM-BP and KM-KNOW: tests/admin/content/contentWorkflowSuite.ts).
 * NOT implemented: TC-NEWS-10-03 (cover {MAX_MB} not given), TC-NEWS-13-01 / 13-04 (need a second account that can log in).
 */
contentWorkflowSuite({ module: NEWS_MODULE, prefix: 'NEWS', name: 'ข่าวกิจกรรม KM', ids: LIST_MODULE_IDS });
