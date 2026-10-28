import { NEWS_MODULE } from '@pages/admin/AdminNewsPages';
import { contentFormSuite } from '../content/contentFormSuite';

/**
 * KM-FNEW — the news form (/admin/news/create) and its consistency with the knowledge form. The cases are shared
 * with KM-FBPR and live in tests/admin/content/contentFormSuite.ts.
 */
contentFormSuite({ module: NEWS_MODULE, prefix: 'FNEW', name: 'ข่าวกิจกรรม KM', sampleTitle: 'AUTO_FNEW_001' });
