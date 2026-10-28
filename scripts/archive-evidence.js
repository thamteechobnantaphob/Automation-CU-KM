#!/usr/bin/env node
// Archives the result of one Playwright run into evidence/<run start time>/:
//   summary.md   human-readable summary (failures, what they block, skips, known bugs)
//   results.csv  one row per test (Excel-friendly; also the source for a Notion table)
//   screenshots/ videos/ errors/   named by Test Case ID
//   report/      the HTML report      junit.xml / results.json   raw results
//
//   node scripts/archive-evidence.js            (after `npx playwright test`)
//   npm run test:evidence                       (runs the tests with EVIDENCE=true, then this)
//
// Options: --results <json> --report <dir> --junit <xml> --out-root <dir>
//          --setup-status <file|none> --no-report
//
// "Blocked" is NOT a hard dependency graph — Playwright tests are independent.
// It is reported from three observable signals: (1) several failures share the
// same error at the same source line (one broken page object/locator),
// (2) tests skipped because a precondition wasn't met, (3) the global-setup
// admin login failed.
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');

function parseArgs(argv) {
  const args = {};
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (!a.startsWith('--')) continue;
    const key = a.slice(2);
    const next = argv[i + 1];
    if (next === undefined || next.startsWith('--')) args[key] = true;
    else {
      args[key] = next;
      i++;
    }
  }
  return args;
}

const stripAnsi = (s) => String(s || '').replace(/\u001b\[[0-9;]*m/g, '');
const pad = (n) => String(n).padStart(2, '0');
const mdCell = (s) => String(s ?? '').replace(/\r?\n/g, ' ').replace(/\|/g, '\\|');
const truncate = (s, n) => (s.length > n ? `${s.slice(0, n - 1)}…` : s);
const safeName = (s) => s.replace(/[<>:"/\\|?*\u0000-\u001f]/g, '_').replace(/\s+/g, '_').slice(0, 80);

function collectRows(report) {
  const rows = [];
  const walk = (suite, titles, isFile) => {
    const t = isFile || !suite.title ? titles : [...titles, suite.title];
    for (const spec of suite.specs || []) {
      for (const test of spec.tests) rows.push(toRow(spec, test, [...t, spec.title]));
    }
    for (const child of suite.suites || []) walk(child, t, false);
  };
  for (const top of report.suites || []) walk(top, [], true);
  return rows;
}

function toRow(spec, test, titlePath) {
  const result = test.results[test.results.length - 1] || { status: 'skipped', errors: [], attachments: [] };
  const annotations = test.annotations || [];
  const failAnn = annotations.find((a) => a.type === 'fail');
  const skipAnn = annotations.find((a) => a.type === 'skip');
  const fixmeAnn = annotations.find((a) => a.type === 'fixme');

  let status;
  // test.fixme(title, fn) scaffolds have no description => "Pending" (not
  // written yet). test.fixme(true, 'reason') inside a real test carries a
  // reason => "On hold" (written, deliberately parked, e.g. awaiting a
  // dev/SA decision).
  if (test.status === 'skipped') status = fixmeAnn ? (fixmeAnn.description ? 'On hold' : 'Pending') : 'Skip';
  else if (failAnn && test.status === 'expected') status = 'Known bug';
  // test.fail() only counts as an expected failure for a normal assertion
  // failure. A timeout (or other abnormal end) is still a real failure —
  // only a run that actually PASSED means "fixed, remove test.fail()".
  else if (failAnn) status = result.status === 'passed' ? 'Unexpected pass' : 'Fail';
  else if (test.status === 'flaky') status = 'Flaky';
  else if (test.status === 'expected') status = 'Pass';
  else status = 'Fail';

  const fullTitle = titlePath.join(' › ');
  const tcId = (fullTitle.match(/TC-[A-Z0-9]+-\d+-\d+/) || [''])[0];
  const priority = (fullTitle.match(/\[(High|Medium|Low)\]/) || ['', ''])[1];
  const scenario = titlePath.find((p) => /^SC-/.test(p)) || '';

  const errors = result.errors && result.errors.length ? result.errors : result.error ? [result.error] : [];
  const mainError = errors.find((e) => e.location) || errors[0];
  let errorLine = '';
  let location = '';
  if (mainError) {
    const message = stripAnsi(mainError.message);
    errorLine = (message.split('\n').find((l) => l.trim()) || '').trim();
    if (mainError.location) location = `${path.basename(mainError.location.file)}:${mainError.location.line}`;
  }

  return {
    tcId,
    module: tcId ? `KM-${tcId.split('-')[1]}` : '',
    priority,
    scenario,
    title: fullTitle,
    status,
    durationSec: ((result.duration || 0) / 1000).toFixed(1),
    reason: failAnn?.description || fixmeAnn?.description || skipAnn?.description || (skipAnn ? '(no reason given)' : ''),
    errorLine,
    location,
    signature: errorLine ? `${errorLine} @ ${location || 'unknown location'}` : '',
    attachments: result.attachments || [],
    rootCause: '',
    // test.fail() present but the run ended abnormally (e.g. timedOut)
    knownBugFailedAbnormally: Boolean(failAnn) && status === 'Fail' ? result.status : '',
    files: { screenshot: '', video: '', errorContext: '', extras: [] },
  };
}

function assignFileIds(rows) {
  const counts = new Map();
  for (const r of rows) counts.set(r.tcId || r.title, (counts.get(r.tcId || r.title) || 0) + 1);
  const seen = new Map();
  for (const r of rows) {
    const key = r.tcId || r.title;
    const base = r.tcId || safeName(r.title);
    if (counts.get(key) > 1) {
      const n = (seen.get(key) || 0) + 1;
      seen.set(key, n);
      r.fileId = `${base}__${pad(n)}`;
    } else r.fileId = base;
  }
}

function groupRootCauses(rows) {
  const bySignature = new Map();
  for (const r of rows.filter((x) => x.status === 'Fail' && x.signature)) {
    if (!bySignature.has(r.signature)) bySignature.set(r.signature, []);
    bySignature.get(r.signature).push(r);
  }
  const shared = [...bySignature.entries()]
    .filter(([, list]) => list.length > 1)
    .sort((a, b) => b[1].length - a[1].length);
  return shared.map(([signature, list], i) => {
    const id = `RC-${i + 1}`;
    list.forEach((r) => (r.rootCause = id));
    return { id, signature, rows: list };
  });
}

function copyEvidence(rows, outDir) {
  for (const sub of ['screenshots', 'videos', 'errors', 'attachments']) {
    fs.mkdirSync(path.join(outDir, sub), { recursive: true });
  }
  for (const r of rows) {
    if (['Pending', 'Skip', 'On hold'].includes(r.status)) continue;
    for (const a of r.attachments) {
      const contentType = a.contentType || '';
      const isImage = contentType.startsWith('image/');
      // JSON / text attachments added with test.info().attach() — e.g. the
      // status codes of an API-only test that has no page to screenshot.
      // (Traces are deliberately not copied: they can contain typed passwords.)
      const isTextual = contentType === 'application/json' || contentType.startsWith('text/');
      let target = '';
      if (a.name === 'screenshot' && isImage) target = path.join('screenshots', `${r.fileId}.png`);
      else if (isImage) target = path.join('screenshots', `${r.fileId}__${safeName(a.name)}.png`);
      else if (a.name === 'video') target = path.join('videos', `${r.fileId}.webm`);
      else if (a.name === 'error-context') target = path.join('errors', `${r.fileId}.md`);
      else if (isTextual) {
        const ext = contentType === 'application/json' ? 'json' : 'txt';
        target = path.join('attachments', `${r.fileId}__${safeName(a.name)}.${ext}`);
      }
      if (!target) continue;

      const dest = path.join(outDir, target);
      if (a.path && fs.existsSync(a.path)) fs.copyFileSync(a.path, dest);
      else if (a.body) fs.writeFileSync(dest, Buffer.from(a.body, 'base64'));
      else continue;

      const rel = target.split(path.sep).join('/');
      if (a.name === 'screenshot') r.files.screenshot = rel;
      else if (a.name === 'video') r.files.video = rel;
      else if (a.name === 'error-context') r.files.errorContext = rel;
      else if (isTextual || isImage) r.files.extras.push({ name: a.name, rel });
    }
  }
}

function writeCsv(rows, file) {
  const header = [
    'Test Case ID', 'Module', 'Priority', 'Scenario', 'Title', 'Status', 'Duration (s)',
    'Root cause group', 'Reason (skip / known bug)', 'Error', 'Location', 'Screenshot', 'Video', 'Error context', 'Other attachments',
  ];
  const esc = (v) => {
    const s = String(v ?? '');
    return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  const lines = [header, ...rows.map((r) => [
    r.tcId, r.module, r.priority, r.scenario, r.title, r.status, r.durationSec,
    r.rootCause, r.reason, r.errorLine, r.location, r.files.screenshot, r.files.video, r.files.errorContext,
    r.files.extras.map((e) => e.rel).join(' ; '),
  ])];
  // BOM so Excel opens the Thai text correctly.
  fs.writeFileSync(file, `﻿${lines.map((l) => l.map(esc).join(',')).join('\r\n')}\r\n`, 'utf-8');
}

function readSetupStatus(file, runStart) {
  if (!file || file === 'none' || !fs.existsSync(file)) return null;
  try {
    const status = JSON.parse(fs.readFileSync(file, 'utf-8'));
    status.stale = Math.abs(new Date(status.at).getTime() - runStart) > 10 * 60 * 1000;
    return status;
  } catch {
    return null;
  }
}

function evidenceLinks(r) {
  const links = [];
  if (r.files.screenshot) links.push(`[ภาพ](${r.files.screenshot})`);
  if (r.files.video) links.push(`[วิดีโอ](${r.files.video})`);
  if (r.files.errorContext) links.push(`[error](${r.files.errorContext})`);
  for (const extra of r.files.extras) links.push(`[${mdCell(extra.name)}](${extra.rel})`);
  return links.join(' · ') || '-';
}

const idList = (rows, max = 12) =>
  rows.slice(0, max).map((r) => r.tcId || r.title).join(', ') + (rows.length > max ? ` … (+${rows.length - max})` : '');

function buildSummary({ rows, rootCauses, setup, runStart, baseUrl, folderName }) {
  const by = (s) => rows.filter((r) => r.status === s);
  const counts = {
    Pass: by('Pass').length, Fail: by('Fail').length, 'Known bug': by('Known bug').length,
    'Unexpected pass': by('Unexpected pass').length, Flaky: by('Flaky').length,
    Skip: by('Skip').length, 'On hold': by('On hold').length, Pending: by('Pending').length,
  };
  const executed = rows.length - counts.Skip - counts.Pending - counts['On hold'];
  const L = [];
  const started = new Date(runStart);
  L.push(`# ผลการรันทดสอบ — ${started.getFullYear()}-${pad(started.getMonth() + 1)}-${pad(started.getDate())} ${pad(started.getHours())}:${pad(started.getMinutes())}`, '');
  L.push(`- โฟลเดอร์ evidence: \`${folderName}\``);
  if (baseUrl) L.push(`- ระบบที่ทดสอบ: ${baseUrl}`);
  if (!setup) L.push('- Global setup (login admin): ไม่มีข้อมูลสถานะ');
  else if (setup.state === 'ok') L.push(`- Global setup (login admin): ✅ สำเร็จ${setup.stale ? ' (ข้อมูลสถานะอาจเป็นของรอบเก่า)' : ''}`);
  else L.push(`- Global setup (login admin): ⚠️ **${setup.state}** — ${truncate(stripAnsi(setup.reason).split('\n')[0], 160)}${setup.stale ? ' (ข้อมูลสถานะอาจเป็นของรอบเก่า)' : ''}`);
  L.push('');

  if (setup && setup.state !== 'ok') {
    L.push('> ⚠️ **login ของ global setup ไม่สำเร็จ** เคสที่ใช้ session admin ทั้งหมดถูกกระทบ (รันด้วย session เก่า/ไม่มี session) ให้แก้จุดนี้ก่อนดูผลเคสอื่น', '');
  }

  L.push('## สรุป', '');
  L.push('| ผ่าน | ไม่ผ่าน | Known bug | ผ่านโดยไม่คาดคิด | Flaky | ข้าม (Skip) | พักไว้ (On hold) | ยังไม่ทำ (Pending) | รันจริง |');
  L.push('|---:|---:|---:|---:|---:|---:|---:|---:|---:|');
  L.push(`| ${counts.Pass} | ${counts.Fail} | ${counts['Known bug']} | ${counts['Unexpected pass']} | ${counts.Flaky} | ${counts.Skip} | ${counts['On hold']} | ${counts.Pending} | ${executed} |`, '');

  const fails = by('Fail');
  L.push(`## ❌ เคสที่ไม่ผ่าน (${fails.length})`, '');
  if (!fails.length) L.push('ไม่มี', '');
  else {
    L.push('| Test Case | Priority | สาเหตุ | ตำแหน่งโค้ด | สาเหตุร่วม | หลักฐาน |', '|---|---|---|---|---|---|');
    for (const r of fails) {
      const knownBugNote = r.knownBugFailedAbnormally
        ? ` (ตั้ง test.fail ไว้ แต่ล้มแบบ ${r.knownBugFailedAbnormally} ไม่ใช่ assertion — ยังไม่ได้พิสูจน์บั๊ก)`
        : '';
      L.push(`| ${mdCell(r.tcId || r.title)} | ${r.priority} | ${mdCell(truncate(r.errorLine, 110))}${mdCell(knownBugNote)} | ${mdCell(r.location)} | ${r.rootCause || '-'} | ${evidenceLinks(r)} |`);
    }
    L.push('');
  }

  if (rootCauses.length) {
    L.push('### 🔗 เคสที่ถูกกระทบจากสาเหตุเดียวกัน (โดนบล็อกพร้อมกัน)', '');
    L.push('เคสในกลุ่มเดียวกันพังที่ error เดียวกัน ณ บรรทัดโค้ดเดียวกัน — แก้จุดเดียวมักทำให้ผ่านพร้อมกันทั้งกลุ่ม', '');
    for (const rc of rootCauses) {
      L.push(`- **${rc.id}** — กระทบ ${rc.rows.length} เคส: \`${mdCell(truncate(rc.signature, 160))}\``);
      L.push(`  - ${idList(rc.rows, 30)}`);
    }
    L.push('');
  }

  const skipped = by('Skip');
  L.push(`## ⛔ เคสที่ไม่ได้รัน เพราะเงื่อนไขไม่ครบ (${skipped.length})`, '');
  if (!skipped.length) L.push('ไม่มี', '');
  else {
    const byReason = new Map();
    for (const r of skipped) {
      const k = r.reason || '(no reason given)';
      if (!byReason.has(k)) byReason.set(k, []);
      byReason.get(k).push(r);
    }
    for (const [reason, list] of byReason) {
      L.push(`- **${list.length} เคส** — ${mdCell(truncate(reason, 200))}`, `  - ${idList(list, 30)}`);
    }
    L.push('');
  }

  const onHold = by('On hold');
  if (onHold.length) {
    L.push(`## ⏸️ พักไว้ รอตัดสินใจ (${onHold.length}) — เขียนเทสแล้วแต่ยังไม่รัน`, '');
    for (const r of onHold) L.push(`- **${r.tcId || r.title}** — ${mdCell(r.reason)}`);
    L.push('');
  }

  const known = by('Known bug');
  L.push(`## 🟡 Known bug — คาดว่าจะไม่ผ่าน (${known.length})`, '');
  if (!known.length) L.push('ไม่มี', '');
  else {
    for (const r of known) L.push(`- ${r.tcId || r.title} — ${mdCell(r.reason)} (${evidenceLinks(r)})`);
    L.push('');
  }

  const unexpected = by('Unexpected pass');
  if (unexpected.length) {
    L.push(`## ⚠️ ผ่านโดยไม่คาดคิด (${unexpected.length}) — บั๊กอาจถูกแก้แล้ว ให้ลองเอา \`test.fail()\` ออก`, '');
    for (const r of unexpected) L.push(`- ${r.tcId || r.title} — ${mdCell(r.reason)} (${evidenceLinks(r)})`);
    L.push('');
  }

  const passed = by('Pass');
  L.push(`## ✅ เคสที่ผ่าน (${passed.length})`, '');
  if (passed.length) {
    L.push('| Test Case | Priority | หลักฐาน |', '|---|---|---|');
    for (const r of passed) {
      L.push(`| ${mdCell(r.tcId || r.title)} | ${r.priority} | ${evidenceLinks(r)} |`);
    }
    L.push('');
  }

  L.push(`## ยังไม่ได้เขียนเทส (Pending): ${counts.Pending} เคส`, '', 'ดูรายละเอียดใน `TRACEABILITY.md` ของโปรเจกต์ ไม่มี evidence เพราะยังไม่ได้รัน', '');
  L.push('---', 'ไฟล์ทั้งหมดมีชื่อตาม Test Case ID ใน `screenshots/`, `videos/`, `errors/` — `results.csv` มีครบทุกเคสรวมทั้งสถานะและสาเหตุ');
  return L.join('\n');
}

function archive(options = {}) {
  const resultsFile = options.results || path.join(ROOT, 'test-results', 'results.json');
  if (!fs.existsSync(resultsFile)) {
    throw new Error(
      `ไม่พบ ${resultsFile}\n  ต้องรัน \`npx playwright test\` ก่อน และห้ามใช้ --reporter ทับ (ต้องมี json reporter จาก playwright.config.ts)`,
    );
  }
  const report = JSON.parse(fs.readFileSync(resultsFile, 'utf-8'));
  const runStart = new Date(report.stats.startTime).getTime();
  const rows = collectRows(report);
  assignFileIds(rows);
  const rootCauses = groupRootCauses(rows);

  const d = new Date(runStart);
  const stamp = `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}_${pad(d.getHours())}${pad(d.getMinutes())}`;
  const outRoot = options['out-root'] || path.join(ROOT, 'evidence');
  let outDir = path.join(outRoot, stamp);
  for (let n = 2; fs.existsSync(outDir); n++) outDir = path.join(outRoot, `${stamp}-${n}`);
  fs.mkdirSync(outDir, { recursive: true });

  copyEvidence(rows, outDir);

  const reportDir = options.report || path.join(ROOT, 'playwright-report');
  if (!options['no-report'] && fs.existsSync(reportDir)) fs.cpSync(reportDir, path.join(outDir, 'report'), { recursive: true });
  const junit = options.junit || path.join(path.dirname(resultsFile), 'junit.xml');
  if (fs.existsSync(junit)) fs.copyFileSync(junit, path.join(outDir, 'junit.xml'));
  fs.copyFileSync(resultsFile, path.join(outDir, 'results.json'));

  writeCsv(rows, path.join(outDir, 'results.csv'));

  const setupFile = options['setup-status'] || path.join(ROOT, 'playwright', '.auth', 'setup-status.json');
  const setup = readSetupStatus(setupFile, runStart);
  let baseUrl = options['base-url'] || '';
  if (!baseUrl) {
    try {
      require('dotenv').config({ path: path.join(ROOT, '.env'), quiet: true });
      baseUrl = process.env.BASE_URL || '';
    } catch {
      /* dotenv optional here */
    }
  }
  const relFolder = path.relative(ROOT, outDir);
  const folderName = relFolder && !relFolder.startsWith('..') ? relFolder : outDir;
  const summary = buildSummary({ rows, rootCauses, setup, runStart, baseUrl, folderName });
  fs.writeFileSync(path.join(outDir, 'summary.md'), summary, 'utf-8');

  return { outDir, rows, rootCauses, setup };
}

function printConsole({ outDir, rows, rootCauses, setup }) {
  const n = (s) => rows.filter((r) => r.status === s).length;
  const fails = rows.filter((r) => r.status === 'Fail');
  console.log('\n──────── Evidence ────────');
  console.log(`ผ่าน ${n('Pass')} | ไม่ผ่าน ${fails.length} | Known bug ${n('Known bug')} | ผ่านโดยไม่คาดคิด ${n('Unexpected pass')} | ข้าม ${n('Skip')} | พักไว้ ${n('On hold')} | ยังไม่ทำ ${n('Pending')}`);
  if (setup && setup.state !== 'ok') console.log(`⚠️  Global setup login: ${setup.state} — เคสที่ใช้ session admin ถูกกระทบทั้งหมด`);
  if (fails.length) {
    console.log('\n❌ เคสที่ไม่ผ่าน:');
    for (const r of fails) console.log(`  - ${r.tcId || r.title}  ${truncate(r.errorLine, 90)}${r.rootCause ? `  [${r.rootCause}]` : ''}`);
  }
  for (const rc of rootCauses) {
    console.log(`\n🔗 ${rc.id}: ${rc.rows.length} เคสพังที่จุดเดียวกัน → ${truncate(rc.signature, 120)}`);
  }
  const skipped = rows.filter((r) => r.status === 'Skip');
  if (skipped.length) console.log(`\n⛔ ข้ามเพราะเงื่อนไขไม่ครบ ${skipped.length} เคส (ดูเหตุผลใน summary.md)`);
  console.log(`\nเก็บไว้ที่: ${outDir}\n  เปิด summary.md ก่อน`);
}

module.exports = { archive, printConsole, collectRows, assignFileIds };

if (require.main === module) {
  try {
    printConsole(archive(parseArgs(process.argv.slice(2))));
  } catch (error) {
    console.error(error.message);
    process.exit(1);
  }
}
