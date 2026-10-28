#!/usr/bin/env node
// Prepares the current test round (evidence/round-results.csv) for the Google Sheet "Runtest"
// and the Drive folder KM-nurs, synced locally by Google Drive for Desktop.
//
//   node scripts/export-round-to-drive.js [--drive "G:/My Drive/Zenith comp/KM-nurs"] [--clear]
//
//   --clear   Test ใหม่: first deletes every old file under <drive>/screenshots and <drive>/videos
//             (Drive keeps them in its trash for 30 days).
//
// Copies each case's latest screenshot/video to <drive>/screenshots/<folder>/<file id>.png and
// <drive>/videos/<folder>/<file id>.webm ("TC-AUTH-03-03__01" -> folder "TC-AUTH-03-03_01").
// Copies get a fresh modified time, so the uploads can be found on Drive by time afterwards.
// Writes evidence/round-sheet.json: one row per case in the Runtest column order (no links yet;
// the links need the Drive file ids, which only exist once Drive has synced the files).
// Pending (not written yet) cases are left out, as before.
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const EVIDENCE = path.join(ROOT, 'evidence');

function parseArgs(argv) {
  const args = { drive: 'G:/My Drive/Zenith comp/KM-nurs', clear: false };
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === '--drive') args.drive = argv[++i];
    else if (argv[i] === '--clear') args.clear = true;
  }
  return args;
}

function parseCsv(text) {
  const rows = [];
  let row = [];
  let field = '';
  let quoted = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (quoted) {
      if (c === '"' && text[i + 1] === '"') {
        field += '"';
        i++;
      } else if (c === '"') quoted = false;
      else field += c;
    } else if (c === '"') quoted = true;
    else if (c === ',') {
      row.push(field);
      field = '';
    } else if (c === '\n') {
      row.push(field.replace(/\r$/, ''));
      rows.push(row);
      row = [];
      field = '';
    } else field += c;
  }
  const header = rows.shift();
  return rows.filter((r) => r.length === header.length).map((r) => Object.fromEntries(header.map((h, i) => [h, r[i]])));
}

/** "2026-10-01_1312" (Bangkok time) -> "2026-10-01T06:12:00+00:00". */
function runDateUtc(run) {
  const m = /^(\d{4})-(\d{2})-(\d{2})_(\d{2})(\d{2})/.exec(run);
  if (!m) return '';
  const utc = new Date(Date.UTC(+m[1], +m[2] - 1, +m[3], +m[4] - 7, +m[5]));
  return utc.toISOString().replace('.000Z', '+00:00');
}

function emptyDir(dir) {
  if (!fs.existsSync(dir)) return 0;
  let removed = 0;
  for (const entry of fs.readdirSync(dir)) {
    if (entry.toLowerCase() === 'desktop.ini') continue;
    fs.rmSync(path.join(dir, entry), { recursive: true, force: true });
    removed++;
  }
  return removed;
}

function copyFresh(from, to) {
  fs.mkdirSync(path.dirname(to), { recursive: true });
  fs.writeFileSync(to, fs.readFileSync(from)); // not copyFileSync: a new mtime marks this upload
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  require('dotenv').config({ path: path.join(ROOT, '.env'), quiet: true });
  const env = process.env.BASE_URL || '';
  const rows = parseCsv(fs.readFileSync(path.join(EVIDENCE, 'round-results.csv'), 'utf-8').replace(/^\uFEFF/, ''));

  if (args.clear) {
    const shots = emptyDir(path.join(args.drive, 'screenshots'));
    const videos = emptyDir(path.join(args.drive, 'videos'));
    console.log(`ลบไฟล์เก่าบน Drive: screenshots ${shots} โฟลเดอร์, videos ${videos} โฟลเดอร์`);
  }

  const out = [];
  let shots = 0;
  let videos = 0;
  for (const r of rows.filter((x) => x.Status !== 'Pending')) {
    const folder = r['File ID'].replace('__', '_');
    const shotName = r.Screenshot ? `${r['File ID']}.png` : '';
    if (r.Screenshot) {
      copyFresh(path.join(EVIDENCE, r.Screenshot), path.join(args.drive, 'screenshots', folder, shotName));
      shots++;
    }
    const videoName = r.Video ? `${r['File ID']}.webm` : '';
    if (r.Video) {
      copyFresh(path.join(EVIDENCE, r.Video), path.join(args.drive, 'videos', folder, videoName));
      videos++;
    }
    out.push({
      'Test Case ID': r['File ID'].replace('__', ' #'),
      Status: r.Status,
      Module: r.Module,
      Priority: r.Priority,
      Run: r.Run,
      'Run Date (UTC)': runDateUtc(r.Run),
      Env: env,
      Note: r['Reason (skip / known bug)'] || r.Error || '',
      'Root Cause': '',
      'Has Screenshot': shotName ? 'Y' : 'N',
      'Screenshot File Name': shotName,
      videoFile: videoName,
    });
  }
  fs.writeFileSync(path.join(EVIDENCE, 'round-sheet.json'), JSON.stringify(out, null, 1));
  console.log(`แถวสำหรับชีต: ${out.length} | คัดลอกภาพ ${shots} ไฟล์, วิดีโอ ${videos} ไฟล์ ไปที่ ${args.drive}`);
}

main();
