import { KNOWLEDGE_MODULE } from '@pages/admin/AdminNewsPages';
import { contentWorkflowSuite, KNOWLEDGE_IDS } from '../content/contentWorkflowSuite';

/**
 * KM-KNOW Auto:P cases (shared with KM-NEWS / KM-BP, plus the knowledge-only rich-text, category, link, Word paste,
 * image + table and attachment cases: tests/admin/content/contentWorkflowSuite.ts).
 * NOT implemented: TC-KNOW-10-05 (cover {MAX_MB} not given), TC-KNOW-14-01 / 14-04 (need a second account that can log in).
 */
contentWorkflowSuite({ module: KNOWLEDGE_MODULE, prefix: 'KNOW', name: 'บทความ/คลังความรู้', ids: KNOWLEDGE_IDS });
