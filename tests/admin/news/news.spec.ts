import { NEWS_MODULE } from '@pages/admin/AdminNewsPages';
import { ensureNews, SEED_NEWS } from '@utils/seedContent';
import { contentListSuite } from '../content/contentListSuite';

/**
 * KM-NEWS — "ข่าวสารกิจกรรม KM" in the admin (/admin/news/index, form #content-module-form). The cases are shared with
 * KM-BP (same numbers and steps) and live in tests/admin/content/contentListSuite.ts.
 * Recon 2026-10-02: card list, slug-based public detail pages (/frontend/news/detail/<slug>), only the title is
 * required, no field has a maxlength, the activity log does not record news actions.
 *
 * Data: AUTO_NEWS_001 (seeded as in TC-NEWS-02-01) is never changed.
 * NOT implemented ({MAX} undefined, no maxlength — DEF-52): TC-NEWS-05-02/03, 06-01/02.
 */
contentListSuite({
  module: NEWS_MODULE,
  prefix: 'NEWS',
  name: 'ข่าวกิจกรรม KM',
  noun: 'ข่าว',
  seed: { name: SEED_NEWS, ensure: ensureNews },
});
