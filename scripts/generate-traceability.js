#!/usr/bin/env node
// Regenerates TRACEABILITY.md and traceability.csv from the two source xlsx
// files + scripts/implemented-cases.json, so there's always an up-to-date
// map from original Test Case ID -> automation status -> spec file.
//
//   node scripts/generate-traceability.js
const fs = require('fs');
const path = require('path');
const { extractAllCases } = require('./lib/extract-cases');

const ROOT = path.join(__dirname, '..');
const IMPLEMENTED_FILE = path.join(__dirname, 'implemented-cases.json');
const POLICY_CASES = JSON.parse(fs.readFileSync(path.join(__dirname, 'policy-cases.json'), 'utf-8'));

// Auto:P case ids (filled in main) — their specs live in separate files from the Auto:Y ones of the same module.
let P_IDS = new Set();
const isP = (id, prefix) => P_IDS.has(id) && id.startsWith(prefix);

// Where each implemented case actually lives, for the "Spec file" column.
// Update this when you add/move a real (non-pending) spec file.
const SPEC_FILE_BY_PREFIX = [
  // Policy-value / Auto:P batches from 2026-10-07 (limits from src/config/policy.ts): scripts/policy-cases.json maps spec file -> ids.
  ...Object.entries(POLICY_CASES).map(([file, ids]) => ({ test: (id) => ids.includes(id), file })),
  // Auto:P extension (2026-10-06): content modules.
  { test: (id) => isP(id, 'TC-NEWS-'), file: 'tests/admin/news/news-workflow.spec.ts (suite: tests/admin/content/contentWorkflowSuite.ts)' },
  { test: (id) => isP(id, 'TC-BP-'), file: 'tests/admin/bestpractice/bestpractice-workflow.spec.ts (suite: tests/admin/content/contentWorkflowSuite.ts)' },
  { test: (id) => isP(id, 'TC-KNOW-'), file: 'tests/admin/knowledge/knowledge-workflow.spec.ts (suite: tests/admin/content/contentWorkflowSuite.ts)' },
  { test: (id) => isP(id, 'TC-FNEW-'), file: 'tests/admin/news/news-form-files.spec.ts (suite: tests/admin/content/contentFilesSuite.ts)' },
  { test: (id) => isP(id, 'TC-FBPR-'), file: 'tests/admin/bestpractice/bestpractice-form-files.spec.ts (suite: tests/admin/content/contentFilesSuite.ts)' },
  { test: (id) => isP(id, 'TC-FKNO-'), file: 'tests/admin/knowledge/knowledge-files.spec.ts' },
  // The rest of KM-AUTH (must come before the generic AUTH rules below).
  { test: (id) => ['TC-AUTH-01-03', 'TC-AUTH-04-01', 'TC-AUTH-04-02', 'TC-AUTH-05-03', 'TC-AUTH-05-06', 'TC-AUTH-05-07'].includes(id), file: 'tests/auth/login-extra.spec.ts' },
  // System-wide non-functional cases (KM-NFR) — tests/nfr/
  { test: (id) => ['TC-NFR-01-01', 'TC-NFR-01-02', 'TC-NFR-01-03', 'TC-NFR-07-07'].includes(id) || id === 'TC-NFR-04-01' || id === 'TC-NFR-04-02' || id === 'TC-NFR-04-03', file: 'tests/nfr/consistency.spec.ts' },
  { test: (id) => ['TC-NFR-04-08', 'TC-NFR-04-09', 'TC-NFR-04-10', 'TC-NFR-04-11', 'TC-NFR-04-12'].includes(id), file: 'tests/nfr/ui-behaviour.spec.ts' },
  { test: (id) => ['TC-NFR-03-01', 'TC-NFR-03-04', 'TC-NFR-06-02', 'TC-NFR-06-03', 'TC-NFR-06-05'].includes(id), file: 'tests/nfr/compatibility.spec.ts' },
  { test: (id) => id.startsWith('TC-NFR-05-'), file: 'tests/nfr/performance.spec.ts' },
  { test: (id) => id === 'TC-NFR-02-01', file: 'tests/nfr/csrf-basics.spec.ts' },
  // Dashboard (KM-ADMD) — tests/admin/dashboard/
  { test: (id) => id.startsWith('TC-ADMD-'), file: 'tests/admin/dashboard/dashboard.spec.ts' },
  // Activity log (KM-ADML) — tests/admin/activity-log/
  { test: (id) => id.startsWith('TC-ADML-'), file: 'tests/admin/activity-log/activity-log.spec.ts' },
  // Site map (KM-ADMS) — tests/admin/sitemap/
  { test: (id) => id.startsWith('TC-ADMS-'), file: 'tests/admin/sitemap/sitemap.spec.ts' },
  { test: (id) => id.startsWith('TC-ADMC-'), file: 'tests/admin/cops/cops.spec.ts' },
  { test: (id) => id.startsWith('TC-NEWS-'), file: 'tests/admin/news/news.spec.ts' },
  { test: (id) => id.startsWith('TC-FNEW-'), file: 'tests/admin/news/news-form.spec.ts' },
  { test: (id) => id.startsWith('TC-KNOW-'), file: 'tests/admin/knowledge/knowledge.spec.ts' },
  { test: (id) => id.startsWith('TC-FKNO-'), file: 'tests/admin/knowledge/knowledge-form.spec.ts' },
  { test: (id) => id.startsWith('TC-BP-'), file: 'tests/admin/bestpractice/bestpractice.spec.ts' },
  { test: (id) => id.startsWith('TC-FBPR-'), file: 'tests/admin/bestpractice/bestpractice-form.spec.ts' },
  { test: (id) => id.startsWith('TC-ADMF-') || id.startsWith('TC-FFAQ-'), file: 'tests/admin/faq/faq.spec.ts' },
  { test: (id) => id.startsWith('TC-FEF-'), file: 'tests/public/faq.spec.ts' },
  { test: (id) => id.startsWith('TC-ADMT-'), file: 'tests/admin/contact/contact.spec.ts' },
  { test: (id) => id.startsWith('TC-FECT-'), file: 'tests/public/contact.spec.ts' },
  { test: (id) => id.startsWith('TC-ADMA-') || id.startsWith('TC-FALB-'), file: 'tests/admin/activity/activity.spec.ts' },
  { test: (id) => id.startsWith('TC-ADMH-') || id.startsWith('TC-FSLD-'), file: 'tests/admin/home/home-slides.spec.ts' },
  { test: (id) => id.startsWith('TC-FFTR-'), file: 'tests/admin/home/footer-menu.spec.ts' },
  { test: (id) => id.startsWith('TC-FES-'), file: 'tests/public/search.spec.ts' },
  { test: (id) => id.startsWith('TC-AUTH-0') && Number(id.split('-')[2]) <= 2, file: 'tests/auth/login.spec.ts' },
  { test: (id) => id.startsWith('TC-AUTH-05-01') || id.startsWith('TC-AUTH-05-02') || id.startsWith('TC-AUTH-04'), file: 'tests/auth/login.spec.ts' },
  { test: (id) => id.startsWith('TC-AUTH-'), file: 'tests/auth/session-security.spec.ts' },
  { test: (id) => id.startsWith('TC-FUSR-01'), file: 'tests/admin/user-management/user-form-modal.spec.ts' },
  { test: (id) => id.startsWith('TC-FUSR-02'), file: 'tests/admin/user-management/user-form-username-validation.spec.ts' },
  { test: (id) => id.startsWith('TC-FUSR-03'), file: 'tests/admin/user-management/user-form-name-validation.spec.ts' },
  { test: (id) => id.startsWith('TC-FUSR-04'), file: 'tests/admin/user-management/user-form-email-validation.spec.ts' },
  { test: (id) => id.startsWith('TC-FUSR-05'), file: 'tests/admin/user-management/user-form-department-position-validation.spec.ts' },
  // User management page (KM-ADMU) — tests/admin/user-list/
  { test: (id) => id.startsWith('TC-ADMU-04') || id.startsWith('TC-ADMU-05'), file: 'tests/admin/user-list/user-name-username.spec.ts' },
  { test: (id) => id.startsWith('TC-ADMU-06'), file: 'tests/admin/user-list/user-email.spec.ts' },
  { test: (id) => id.startsWith('TC-ADMU-'), file: 'tests/admin/user-list/user-list.spec.ts' },
  // Roles (KM-ADMR list, KM-FROL form) — tests/admin/roles/
  { test: (id) => id.startsWith('TC-FROL-06'), file: 'tests/admin/roles/role-security.spec.ts' },
  { test: (id) => id.startsWith('TC-FROL-02') || id.startsWith('TC-ADMR-04'), file: 'tests/admin/roles/role-name-description.spec.ts' },
  { test: (id) => ['TC-FROL-05-04', 'TC-ADMR-05-07'].includes(id), file: 'tests/admin/roles/role-user-assignment.spec.ts' },
  { test: (id) => id.startsWith('TC-FROL-05') || id === 'TC-ADMR-02-02', file: 'tests/admin/roles/role-save-and-edit.spec.ts' },
  { test: (id) => id.startsWith('TC-ADMR-') || id.startsWith('TC-FROL-'), file: 'tests/admin/roles/role-list-and-form.spec.ts' },
  // Categories (KM-ADMG) — tests/admin/categories/
  { test: (id) => id === 'TC-ADMG-01-01', file: 'tests/admin/categories/category-tabs.spec.ts' },
  { test: (id) => id.startsWith('TC-ADMG-'), file: 'tests/admin/categories/category-name.spec.ts' },
  // System-wide security (KM-SEC) — tests/security/
  { test: (id) => ['TC-SEC-01-01', 'TC-SEC-01-05', 'TC-SEC-01-08'].includes(id), file: 'tests/security/stored-injection.spec.ts' },
  { test: (id) => id === 'TC-SEC-03-03', file: 'tests/security/csrf-all-actions.spec.ts' },
  { test: (id) => id.startsWith('TC-SEC-01'), file: 'tests/security/injection.spec.ts' },
  { test: (id) => id.startsWith('TC-SEC-02'), file: 'tests/security/exposure.spec.ts' },
  { test: (id) => id.startsWith('TC-SEC-'), file: 'tests/security/browser-protections.spec.ts' },
  // Public site (KM-FEH / KM-FEC / KM-FEK / KM-FEN) — tests/public/
  { test: (id) => ['TC-FEH-01-01', 'TC-FEH-01-02', 'TC-FEH-01-03', 'TC-FEH-01-04', 'TC-FEH-01-05', 'TC-FEH-03-07', 'TC-FEH-03-08', 'TC-FEH-03-09'].includes(id), file: 'tests/public/site-chrome.spec.ts' },
  { test: (id) => id.startsWith('TC-FEH-02'), file: 'tests/public/home-content.spec.ts' },
  { test: (id) => ['TC-FEH-03-01', 'TC-FEH-03-02', 'TC-FEH-03-03', 'TC-FEH-03-04'].includes(id), file: 'tests/public/public-access.spec.ts' },
  { test: (id) => id.startsWith('TC-FEH-04') || id === 'TC-FEC-01-04', file: 'tests/public/url-handling.spec.ts' },
  { test: (id) => id.startsWith('TC-FEC-'), file: 'tests/public/cops.spec.ts' },
  { test: (id) => /^TC-FE[KN]-/.test(id), file: 'tests/public/content-lists.spec.ts' },
];

function specFileFor(tcId, implemented) {
  if (!implemented) return '';
  const match = SPEC_FILE_BY_PREFIX.find((rule) => rule.test(tcId));
  return match ? match.file : '(see implemented-cases.json)';
}

function csvEscape(value) {
  const s = String(value ?? '');
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

function main() {
  const implementedSet = new Set(JSON.parse(fs.readFileSync(IMPLEMENTED_FILE, 'utf-8')));
  const all = extractAllCases(ROOT);
  const autoY = all.filter((c) => c.autoFlag === 'Y' && !c.retired);
  const autoP = all.filter((c) => c.autoFlag === 'P' && !c.retired);
  P_IDS = new Set(autoP.map((c) => c.tcId));
  const retired = all.filter((c) => c.retired);

  const byModule = new Map();
  for (const c of autoY) {
    if (!byModule.has(c.moduleCode)) byModule.set(c.moduleCode, { title: c.moduleTitle, path: c.modulePath, cases: [] });
    byModule.get(c.moduleCode).cases.push(c);
  }

  // ---- Markdown ----
  const mdLines = [];
  mdLines.push('# Test Automation Traceability (Auto: Y only)');
  mdLines.push('');
  mdLines.push(
    `Generated by \`node scripts/generate-traceability.js\` from the two source xlsx files. ` +
      `Do not hand-edit — update \`scripts/implemented-cases.json\` and re-run instead.`,
  );
  mdLines.push('');

  const totalImplemented = autoY.filter((c) => implementedSet.has(c.tcId)).length;
  mdLines.push(`**Total Auto:Y cases: ${autoY.length} — Implemented: ${totalImplemented} — Pending: ${autoY.length - totalImplemented}**`);
  mdLines.push('');
  mdLines.push('| Module | Implemented | Pending | Total |');
  mdLines.push('|---|---:|---:|---:|');
  for (const [code, { cases }] of byModule) {
    const impl = cases.filter((c) => implementedSet.has(c.tcId)).length;
    mdLines.push(`| ${code} | ${impl} | ${cases.length - impl} | ${cases.length} |`);
  }
  mdLines.push('');

  for (const [code, { title, path: modulePath, cases }] of byModule) {
    mdLines.push(`## ${code} — ${title}`);
    mdLines.push('');
    mdLines.push(`Path(s): \`${modulePath}\``);
    mdLines.push('');
    mdLines.push('| Test Case ID | Priority | Description | Status | Spec file |');
    mdLines.push('|---|---|---|---|---|');
    for (const c of cases) {
      const implemented = implementedSet.has(c.tcId);
      const status = implemented ? 'Implemented' : c.deferred ? c.deferred.status : 'Pending';
      const specFile = implemented
        ? specFileFor(c.tcId, implemented)
        : `tests/pending/${code.toLowerCase()}.pending.spec.ts`;
      mdLines.push(`| ${c.tcId} | ${c.priority} | ${c.tcDesc.replace(/\|/g, '\\|')} | ${status} | \`${specFile}\` |`);
    }
    mdLines.push('');
  }

  // Auto:P extension: cases that need data from other modules — automated module by module on request.
  const pImplemented = autoP.filter((c) => implementedSet.has(c.tcId));
  if (pImplemented.length) {
    const pByModule = new Map();
    for (const c of autoP) {
      if (!pByModule.has(c.moduleCode)) pByModule.set(c.moduleCode, []);
      pByModule.get(c.moduleCode).push(c);
    }
    mdLines.push('## Auto: P — extension (automated on request)');
    mdLines.push('');
    mdLines.push(`**Auto:P cases: ${autoP.length} — Implemented: ${pImplemented.length}** (only modules with implemented cases are listed)`);
    mdLines.push('');
    mdLines.push('| Module | Implemented | Not automated | Total Auto:P |');
    mdLines.push('|---|---:|---:|---:|');
    for (const [code, cases] of pByModule) {
      const impl = cases.filter((c) => implementedSet.has(c.tcId)).length;
      if (impl) mdLines.push(`| ${code} | ${impl} | ${cases.length - impl} | ${cases.length} |`);
    }
    mdLines.push('');
    mdLines.push('| Test Case ID | Priority | Description | Status | Spec file |');
    mdLines.push('|---|---|---|---|---|');
    for (const [, cases] of pByModule) {
      if (!cases.some((c) => implementedSet.has(c.tcId))) continue;
      for (const c of cases) {
        const implemented = implementedSet.has(c.tcId);
        mdLines.push(`| ${c.tcId} | ${c.priority} | ${c.tcDesc.replace(/\|/g, '\\|')} | ${implemented ? 'Implemented' : 'Not automated'} | ${implemented ? `\`${specFileFor(c.tcId, true)}\`` : ''} |`);
      }
    }
    mdLines.push('');
  }

  if (retired.length) {
    mdLines.push('## Retired (dropped by QA — not tested)');
    mdLines.push('');
    mdLines.push('| Test Case ID | Description | Reason |');
    mdLines.push('|---|---|---|');
    for (const c of retired) mdLines.push(`| ${c.tcId} | ${c.tcDesc.replace(/\|/g, '\\|')} | ${c.retired.replace(/\|/g, '\\|')} |`);
    mdLines.push('');
  }

  fs.writeFileSync(path.join(ROOT, 'TRACEABILITY.md'), mdLines.join('\n'), 'utf-8');

  // ---- CSV ----
  const csvRows = [
    ['Module', 'Module Title', 'Scenario ID', 'Scenario', 'Test Case ID', 'Priority', 'Description', 'Status', 'Spec File', 'Source File'],
  ];
  for (const c of autoY) {
    const implemented = implementedSet.has(c.tcId);
    csvRows.push([
      c.moduleCode,
      c.moduleTitle,
      c.scenarioId,
      c.scenarioDesc,
      c.tcId,
      c.priority,
      c.tcDesc,
      implemented ? 'Implemented' : 'Pending',
      implemented ? specFileFor(c.tcId, implemented) : `tests/pending/${c.moduleCode.toLowerCase()}.pending.spec.ts`,
      c.sourceFile,
    ]);
  }
  for (const c of autoP.filter((p) => implementedSet.has(p.tcId))) {
    csvRows.push([c.moduleCode, c.moduleTitle, c.scenarioId, c.scenarioDesc, c.tcId, c.priority, c.tcDesc, 'Implemented (Auto:P)', specFileFor(c.tcId, true), c.sourceFile]);
  }
  const csvContent = csvRows.map((row) => row.map(csvEscape).join(',')).join('\n');
  fs.writeFileSync(path.join(ROOT, 'traceability.csv'), csvContent, 'utf-8');

  console.log(`Wrote TRACEABILITY.md and traceability.csv`);
  console.log(`Total Auto:Y: ${autoY.length} | Implemented: ${totalImplemented} | Pending: ${autoY.length - totalImplemented}`);
}

main();
