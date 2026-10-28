import { NEWS_MODULE } from '@pages/admin/AdminNewsPages';
import { contentFilesSuite } from '../content/contentFilesSuite';

/** KM-FNEW Auto:P cases — the news form is the knowledge form (tests/admin/content/contentFilesSuite.ts). */
contentFilesSuite({ module: NEWS_MODULE, prefix: 'FNEW', name: 'ข่าวกิจกรรม KM' });
