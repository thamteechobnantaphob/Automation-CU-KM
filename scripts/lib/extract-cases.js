// Shared Excel-parsing logic for scripts/generate-pending-tests.js and
// scripts/generate-traceability.js. Kept separate from those two so both
// stay in sync with the *same* parsing rules as the source test-case files
// change over time.
const fs = require('fs');
const path = require('path');
const XLSX = require('xlsx');

const SOURCES = [
  { file: 'Test_Case_KM-Portal_CU-Nurse_v2.xlsx', sheet: 'Test Case' },
  { file: 'Test_Case_KM-Portal_CU-Nurse_v2_Supplement_Forms.xlsx', sheet: 'แผนทดสอบ ' },
];

function parseModule(reqId) {
  const parts = String(reqId || '').split(/\r?\n/).filter(Boolean);
  return {
    moduleCode: parts[0] || '',
    moduleTitle: parts[1] || '',
    modulePath: parts.slice(2).join(' | '),
  };
}

function parseRemarks(remarks) {
  const remarksStr = String(remarks || '');
  const firstLine = remarksStr.split(/\r?\n/)[0].trim();
  const autoMatch = firstLine.match(/^Auto:\s*([YPM])/i);
  return {
    remarksStr,
    autoFlag: autoMatch ? autoMatch[1].toUpperCase() : null,
  };
}

/**
 * Cases QA has dropped from the sheet's scope ({ "TC-ID": "reason" }). They stay in the xlsx but are
 * neither implemented nor generated as pending; TRACEABILITY.md lists them under "Retired".
 */
function loadRetired(projectRoot) {
  const file = path.join(projectRoot, 'scripts', 'retired-cases.json');
  return fs.existsSync(file) ? JSON.parse(fs.readFileSync(file, 'utf-8')) : {};
}

/** Reads every row from both xlsx test-case sources into a flat, typed list. */
function extractAllCases(projectRoot) {
  const all = [];
  const retired = loadRetired(projectRoot);
  const deferredFile = path.join(projectRoot, 'scripts', 'deferred-cases.json');
  // Cases QA put aside for now ({ id: { status, reason } }): On hold (UAT), Deferred (UAT), Manual (QA).
  const deferred = fs.existsSync(deferredFile) ? JSON.parse(fs.readFileSync(deferredFile, 'utf-8')) : {};

  for (const source of SOURCES) {
    const filePath = path.join(projectRoot, source.file);
    const wb = XLSX.readFile(filePath);
    const sheet = wb.Sheets[source.sheet];
    const rows = XLSX.utils.sheet_to_json(sheet, { header: 1, defval: '' });

    let current = { reqId: '', scenarioId: '', scenarioDesc: '' };
    for (let i = 1; i < rows.length; i++) {
      const r = rows[i];
      if (!r || r.length === 0) continue;
      const [reqId, scenarioId, scenarioDesc, tcId, tcDesc, script, expected, , priority, , , remarks] = r;

      if (reqId && String(reqId).trim() !== '') current.reqId = reqId;
      if (scenarioId && String(scenarioId).trim() !== '') current.scenarioId = scenarioId;
      if (scenarioDesc && String(scenarioDesc).trim() !== '') current.scenarioDesc = scenarioDesc;
      if (!tcId || String(tcId).trim() === '') continue;

      const { remarksStr, autoFlag } = parseRemarks(remarks);
      const { moduleCode, moduleTitle, modulePath } = parseModule(current.reqId);

      all.push({
        sourceFile: source.file,
        moduleCode,
        moduleTitle,
        modulePath,
        scenarioId: current.scenarioId,
        scenarioDesc: current.scenarioDesc,
        tcId: String(tcId).trim(),
        tcDesc: String(tcDesc || '').trim(),
        script: String(script || '').trim(),
        expected: String(expected || '').trim(),
        priority: String(priority || '').trim(),
        remarks: remarksStr.trim(),
        autoFlag,
        retired: retired[String(tcId).trim()] || '',
        deferred: deferred[String(tcId).trim()] || null,
      });
    }
  }

  return all;
}

module.exports = { extractAllCases };
