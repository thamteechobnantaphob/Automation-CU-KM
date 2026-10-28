import path from 'path';

/**
 * Test titles taken from the QA workbooks: "TC-FKNO-02-01 [High] [Positive] ไฟล์เอกสาร: …" — the case id, its
 * priority (the evidence tools read Priority from the title) and the sheet's own description. Read once per worker
 * with the same parser the generators use (scripts/lib/extract-cases.js).
 */
interface SheetCase {
  tcId: string;
  priority: string;
  tcDesc: string;
}

let byId: Map<string, SheetCase> | undefined;

function cases(): Map<string, SheetCase> {
  if (!byId) {
    const root = path.resolve(__dirname, '../..');
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { extractAllCases } = require(path.join(root, 'scripts/lib/extract-cases.js')) as { extractAllCases: (root: string) => SheetCase[] };
    byId = new Map(extractAllCases(root).map((c) => [c.tcId, c]));
  }
  return byId;
}

/** "<id> [<priority>] <description>" from the sheet; `fallback` (or the bare id) when the id is not in the sheet. */
export function sheetTitle(id: string, fallback = ''): string {
  const c = cases().get(id);
  if (!c) return `${id} ${fallback}`.trim();
  return `${id} [${c.priority}] ${c.tcDesc.replace(/\s+/g, ' ').trim()}`;
}
