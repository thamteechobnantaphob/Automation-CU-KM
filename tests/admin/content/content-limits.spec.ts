import { test } from '@fixtures/pages.fixtures';
import { BEST_PRACTICE_MODULE, KNOWLEDGE_MODULE, NEWS_MODULE } from '@pages/admin/AdminNewsPages';
import { contentLimitsSuite } from './contentLimitsSuite';

/**
 * The {MAX} cases of the content modules, run against the limits agreed with QA on 2026-10-07 (src/config/policy.ts,
 * docs/policy-assumptions.md — OWASP-based proposals until SA/Dev decide).
 */
test.describe('KM-NEWS — ความยาว / ขนาดรูปปก', () => {
  contentLimitsSuite({ module: NEWS_MODULE, prefix: 'NEWS', ids: { titleMax: '05-02', titleOver: '05-03', excerptMax: '06-01', excerptOver: '06-02', coverOver: '10-03' } });
});
test.describe('KM-BP — ความยาว / ขนาดรูปปก', () => {
  contentLimitsSuite({ module: BEST_PRACTICE_MODULE, prefix: 'BP', ids: { titleMax: '05-02', titleOver: '05-03', excerptMax: '06-01', excerptOver: '06-02', coverOver: '10-03' } });
});
test.describe('KM-KNOW — ความยาว / ขนาดรูปปก', () => {
  contentLimitsSuite({ module: KNOWLEDGE_MODULE, prefix: 'KNOW', ids: { titleMax: '05-04', titleOver: '05-05', excerptMax: '06-02', excerptOver: '06-03', coverOver: '10-05' } });
});
test.describe('KM-FKNO — ความยาวข้อมูลอ้างอิง / ขนาดรูปปก', () => {
  contentLimitsSuite({ module: KNOWLEDGE_MODULE, prefix: 'FKNO', ids: { sourceMax: '05-02', sourceOver: '05-03', authorMax: '05-07', authorOver: '05-08', coverOver: '07-15', coverMax: '07-16' } });
});
