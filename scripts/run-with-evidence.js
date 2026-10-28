#!/usr/bin/env node
// Runs the Playwright suite with EVIDENCE=true (screenshot + video for every
// test, passing or not), then archives the run into evidence/<time>/.
// Any extra arguments go straight to Playwright:
//
//   npm run test:evidence
//   npm run test:evidence -- tests/auth
//   npm run test:evidence -- -g "TC-FUSR-02"
//
// Exits with Playwright's own exit code, so CI still fails when tests fail.
const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');
const { archive, printConsole } = require('./archive-evidence');

const ROOT = path.join(__dirname, '..');
const RESULTS_JSON = path.join(ROOT, 'test-results', 'results.json');
const PLAYWRIGHT_CLI = path.join(ROOT, 'node_modules', '@playwright', 'test', 'cli.js');

// If Playwright never starts (bad arguments, crash before the run), a stale
// results.json from the PREVIOUS run would otherwise be archived again as if
// it were this run's result. Remove it first so that case fails loudly.
fs.rmSync(RESULTS_JSON, { force: true });

// Launch the Playwright CLI with node directly, NOT through a shell: a shell
// (cmd.exe on Windows) re-parses the arguments, so a grep like
// -g "TC-FUSR-02|TC-FUSR-01-07" gets split at the "|" as a pipe.
const result = spawnSync(process.execPath, [PLAYWRIGHT_CLI, 'test', ...process.argv.slice(2)], {
  stdio: 'inherit',
  env: { ...process.env, EVIDENCE: 'true' },
});

try {
  printConsole(archive());
} catch (error) {
  console.error(`\nสร้าง evidence ไม่สำเร็จ: ${error.message}`);
  process.exit(result.status || 1);
}

process.exit(result.status ?? 1);
