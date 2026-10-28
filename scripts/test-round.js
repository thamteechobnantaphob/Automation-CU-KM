#!/usr/bin/env node
// A test ROUND = every evidence/<run>/ folder since the last "new". Two ways to run:
//
//   npm run test:new                      Test ใหม่: delete ALL old evidence runs, then run the whole suite
//   npm run test:new -- tests/auth        ...or only these paths / Playwright args
//   npm run test:continue                 Continue: run only the tests this round has no result for yet
//                                         (interrupted run, new specs, cases that were skipped)
//   npm run test:continue -- --retry-failed   ...and also re-run Fail / Unexpected pass / Flaky
//   npm run test:round                    print the round's merged result, run nothing
//
// After every run the round is merged into evidence/round-results.csv and evidence/round-summary.md
// (latest real result per test case; a later Skip/Pending never hides an earlier real result).
// evidence/cleanup-*.md (logs of deleted test data) are kept by "new".
const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');
const { collectRows, assignFileIds } = require('./archive-evidence');

const ROOT = path.join(__dirname, '..');
const EVIDENCE = path.join(ROOT, 'evidence');
const ROUND_FILE = path.join(EVIDENCE, 'round.json');
const RUNNER = path.join(__dirname, 'run-with-evidence.js');
const RUN_DIR = /^\d{4}-\d{2}-\d{2}_\d{4}(-\d+)?$/;
const ROUND_OUTPUTS = ['round.json', 'round-results.csv', 'round-summary.md'];

/** Statuses that are not a result of running the test (it did not run, or is not written yet). */
const NOT_RUN = new Set(['Skip', 'Pending']);
const NEEDS_RETRY = new Set(['Fail', 'Unexpected pass', 'Flaky']);
const STATUS_ORDER = ['Fail', 'Unexpected pass', 'Flaky', 'Known bug', 'Pass', 'On hold', 'Skip', 'Pending'];

const pad = (n) => String(n).padStart(2, '0');
const stamp = (d = new Date()) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
const esc = (v) => {
  const s = String(v ?? '');
  return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
};
const mdCell = (s) => String(s ?? '').replace(/\r?\n/g, ' ').replace(/\|/g, '\\|');

function runFolders() {
  if (!fs.existsSync(EVIDENCE)) return [];
  return fs
    .readdirSync(EVIDENCE, { withFileTypes: true })
    .filter((d) => d.isDirectory() && RUN_DIR.test(d.name))
    .map((d) => d.name)
    .sort();
}

/** Test case ids QA retired (scripts/retired-cases.json): older runs of this round may still hold results for them. */
function retiredIds() {
  try {
    return new Set(Object.keys(JSON.parse(fs.readFileSync(path.join(__dirname, 'retired-cases.json'), 'utf-8'))));
  } catch {
    return new Set();
  }
}

/** Latest real result per test (keyed by file id, e.g. "TC-AUTH-03-03__01"), across the round's runs; retired cases left out. */
function mergeRound() {
  const retired = retiredIds();
  const merged = new Map();
  for (const run of runFolders()) {
    const file = path.join(EVIDENCE, run, 'results.json');
    if (!fs.existsSync(file)) continue;
    const rows = collectRows(JSON.parse(fs.readFileSync(file, 'utf-8')));
    assignFileIds(rows);
    for (const row of rows) {
      if (retired.has(row.tcId)) continue;
      const key = row.fileId;
      const previous = merged.get(key);
      if (previous && NOT_RUN.has(row.status) && !NOT_RUN.has(previous.row.status)) continue;
      merged.set(key, { row, run });
    }
  }
  return [...merged.values()];
}

function mediaPath(run, sub, fileId, ext) {
  const rel = path.join(run, sub, `${fileId}.${ext}`);
  return fs.existsSync(path.join(EVIDENCE, rel)) ? rel.replace(/\\/g, '/') : '';
}

function writeRoundFiles(entries) {
  const round = readRound();
  const sorted = [...entries].sort(
    (a, b) => STATUS_ORDER.indexOf(a.row.status) - STATUS_ORDER.indexOf(b.row.status) || a.row.fileId.localeCompare(b.row.fileId),
  );

  const header = ['Test Case ID', 'File ID', 'Module', 'Priority', 'Title', 'Status', 'Run', 'Reason (skip / known bug)', 'Error', 'Location', 'Screenshot', 'Video'];
  const lines = [header];
  for (const { row, run } of sorted) {
    lines.push([
      row.tcId, row.fileId, row.module, row.priority, row.title, row.status, run, row.reason, row.errorLine, row.location,
      mediaPath(run, 'screenshots', row.fileId, 'png'), mediaPath(run, 'videos', row.fileId, 'webm'),
    ]);
  }
  fs.writeFileSync(path.join(EVIDENCE, 'round-results.csv'), `﻿${lines.map((l) => l.map(esc).join(',')).join('\r\n')}\r\n`, 'utf-8');

  const count = (s) => entries.filter((e) => e.row.status === s).length;
  const L = [];
  L.push(`# ผลทดสอบรอบนี้ (round)`, '');
  L.push(`- เริ่มรอบ: ${round.startedAt || '-'}  |  อัปเดตล่าสุด: ${stamp()}`);
  L.push(`- จำนวนครั้งที่รันในรอบนี้: ${runFolders().length} (${runFolders().join(', ') || '-'})`, '');
  L.push('| สถานะ | จำนวน |', '|---|---:|');
  for (const s of STATUS_ORDER) L.push(`| ${s} | ${count(s)} |`);
  L.push(`| **รวม** | **${entries.length}** |`, '');
  const show = (title, statuses) => {
    const list = sorted.filter((e) => statuses.includes(e.row.status));
    if (!list.length) return;
    L.push(`## ${title} (${list.length})`, '', '| Test Case | สถานะ | รอบที่รัน | รายละเอียด |', '|---|---|---|---|');
    for (const { row, run } of list) L.push(`| ${row.fileId} | ${row.status} | ${run} | ${mdCell((row.errorLine || row.reason || '').slice(0, 200))} |`);
    L.push('');
  };
  show('ไม่ผ่าน / ต้องตรวจ', ['Fail', 'Unexpected pass', 'Flaky']);
  show('Known bug', ['Known bug']);
  show('ข้าม (ยังไม่ได้รันในรอบนี้)', ['Skip']);
  L.push('---', 'รายละเอียดทุกเคส: `round-results.csv` (คอลัมน์ Screenshot / Video ชี้ไปที่ไฟล์ในโฟลเดอร์รันของแต่ละเคส)');
  fs.writeFileSync(path.join(EVIDENCE, 'round-summary.md'), L.join('\n'), 'utf-8');

  console.log('\n──────── Round ────────');
  console.log(STATUS_ORDER.map((s) => `${s} ${count(s)}`).join(' | '));
  console.log(`evidence/round-summary.md, evidence/round-results.csv`);
}

function readRound() {
  try {
    return JSON.parse(fs.readFileSync(ROUND_FILE, 'utf-8'));
  } catch {
    return {};
  }
}

function runPlaywright(args) {
  const result = spawnSync(process.execPath, [RUNNER, ...args], { stdio: 'inherit', env: process.env });
  return result.status ?? 1;
}

function clearEvidence() {
  fs.mkdirSync(EVIDENCE, { recursive: true });
  const runs = runFolders();
  for (const run of runs) fs.rmSync(path.join(EVIDENCE, run), { recursive: true, force: true });
  for (const file of ROUND_OUTPUTS) fs.rmSync(path.join(EVIDENCE, file), { force: true });
  console.log(`ลบ evidence เก่า ${runs.length} รอบรัน (เก็บ cleanup-*.md ไว้)`);
}

function main() {
  const [mode, ...rest] = process.argv.slice(2);

  if (mode === 'new') {
    clearEvidence();
    fs.writeFileSync(ROUND_FILE, JSON.stringify({ startedAt: stamp(), args: rest }, null, 2));
    const code = runPlaywright(rest);
    writeRoundFiles(mergeRound());
    process.exit(code);
  }

  if (mode === 'continue') {
    if (!runFolders().length) {
      console.log('ยังไม่มีรอบที่เริ่มไว้ — ใช้ `npm run test:new` ก่อน');
      process.exit(1);
    }
    const retryFailed = rest.includes('--retry-failed');
    const args = rest.filter((a) => a !== '--retry-failed');
    const entries = mergeRound();
    // A test case counts as done only when every one of its tests (sub-cases share the id) has a result.
    const byId = new Map();
    for (const { row } of entries) {
      if (!row.tcId) continue;
      const done = !NOT_RUN.has(row.status) && !(retryFailed && NEEDS_RETRY.has(row.status));
      byId.set(row.tcId, (byId.get(row.tcId) ?? true) && done);
    }
    const doneIds = [...byId].filter(([, done]) => done).map(([id]) => id);
    console.log(`รอบนี้มีผลแล้ว ${doneIds.length} เคส — รันเฉพาะที่เหลือ${retryFailed ? ' (รวมเคสที่ไม่ผ่าน)' : ''}`);
    const grepInvert = doneIds.length ? ['--grep-invert', doneIds.join('|')] : [];
    const code = runPlaywright([...args, ...grepInvert]);
    writeRoundFiles(mergeRound());
    process.exit(code);
  }

  if (mode === 'status') {
    writeRoundFiles(mergeRound());
    return;
  }

  console.log('ใช้: node scripts/test-round.js <new|continue|status> [--retry-failed] [Playwright args]');
  process.exit(1);
}

main();
