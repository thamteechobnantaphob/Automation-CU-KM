#!/usr/bin/env node
/**
 * Removes the data the automation created on the target environment:
 *   - USERS  (/admin/user/index): usernames starting with "qa_auto_" (see QA_PREFIX in src/utils/strings.ts)
 *   - ROLES  (/admin/role/index): roles whose name or description contains "[Auto Test]"
 *   - CATEGORIES (/admin/group/index, all six tabs): categories whose name or "หัวข้อย่อย" contains "[Auto Test]"
 *     (QA's own AUTO_CAT_001 cards have no marker and are kept)
 * Users are handled first, because a role can only be deleted once no user has it.
 *
 *   node scripts/cleanup-test-data.js                   DRY RUN (default) — only lists what it would do
 *   node scripts/cleanup-test-data.js --delete          really deletes what it listed under "ลบ"
 *   node scripts/cleanup-test-data.js --delete --limit 1    deletes at most one (a cautious first run)
 *   node scripts/cleanup-test-data.js --only users|roles|categories    handle just one kind (default: all)
 *   node scripts/cleanup-test-data.js --delete --include-role "<exact role name>"   an extra role by name
 *
 * Safety rules (all enforced in code, not by convention):
 *   - Nothing is deleted without --delete.
 *   - Only the shapes of username the automation itself generates are deleted:
 *       qa_auto_<stamp>_<suffix>                       (every data-creating test)
 *       QA_AUTO_… / ทดสอบ<stamp> with an "[Auto Test]" name  (the uppercase copy made
 *                                                       by the case-sensitivity bug tests, and TC-ADMU-05-08's Thai user)
 *     "admin" (and ADMIN_USER from .env) is protected, and so is any row that
 *     has no delete button.
 *   - Other look-alikes (e.g. "ADMIN", or a username that is itself an XSS
 *     string) are only REPORTED under "ตรวจสอบเอง"; delete one by naming it
 *     explicitly: --include "ADMIN" (repeatable, exact match, still needs --delete).
 *   - The row is found by the exact `data-username` of its edit button, so a
 *     similar-looking name can never be clicked by mistake.
 *
 * Why it sweeps repeatedly: the list is sorted by name only, and many test
 * users share a name, so its pagination is unstable (some users are missing
 * from a walk of all pages). Deleting shrinks the tie, which reveals users that
 * were hidden — so it sweeps until a sweep deletes nothing.
 *
 * Roles: only roles that HAVE a delete button (the built-in ones and QA's own
 * "ตรวจสอบข้อมูลระบบ" role are never touched unless named with --include-role),
 * carry the [Auto Test] marker and have no user left. The row is re-read right
 * before the click.
 *
 * A log of every run is written to evidence/cleanup-<date_time>.md.
 */
const fs = require('fs');
const path = require('path');
const { chromium } = require('@playwright/test');
require('dotenv').config({ path: path.join(__dirname, '..', '.env'), quiet: true });

const BASE = process.env.BASE_URL || 'http://192.100.10.26:8081';
const ADMIN_USER = process.env.ADMIN_USER || '';
const ADMIN_PASS = process.env.ADMIN_PASS || '';
const PREFIX = 'qa_auto_';
const PAGE_SIZE = 20;
const MAX_SWEEPS = 8;
const MAX_DELETES = 300;

const args = process.argv.slice(2);
const DELETE = args.includes('--delete');
const limitIndex = args.indexOf('--limit');
const LIMIT = limitIndex >= 0 ? Number(args[limitIndex + 1]) : Infinity;
if (limitIndex >= 0 && !(LIMIT >= 1)) {
  console.error('--limit ต้องตามด้วยตัวเลขตั้งแต่ 1 ขึ้นไป');
  process.exit(2);
}

const ONLY = args.includes('--only') ? args[args.indexOf('--only') + 1] : 'all';
if (!['all', 'users', 'roles', 'categories'].includes(ONLY)) {
  console.error('--only ต้องเป็น users, roles หรือ categories');
  process.exit(2);
}
const FLAG = '[Auto Test]';
const INCLUDE_ROLES = [];
const shared = { deleted: 0 }; // deletions so far across users and roles (for --limit)
const INCLUDE = [];
args.forEach((arg, i) => {
  if (arg === '--include' && args[i + 1]) INCLUDE.push(args[i + 1]);
  if (arg === '--include-role' && args[i + 1]) INCLUDE_ROLES.push(args[i + 1]);
});

const stamp = new Date().toISOString().replace(/[-:]/g, '').replace('T', '_').slice(0, 13);
const logLines = [];
function log(line = '') {
  console.log(line);
  logLines.push(line);
}

/** ลบ / ตรวจสอบเอง / เก็บไว้ */
function classify(user) {
  const name = user.username;
  if (name === 'admin' || (ADMIN_USER && name === ADMIN_USER)) return { kind: 'keep', why: 'บัญชีผู้ดูแลระบบ (ป้องกันไว้)' };
  if (!user.hasDelete) return { kind: 'keep', why: 'แถวนี้ไม่มีปุ่มลบ (บัญชีระบบ)' };
  if (name.startsWith(PREFIX)) return { kind: 'delete', why: `username ขึ้นต้นด้วย ${PREFIX}` };
  const flagged = user.name.includes('[Auto Test]');
  if (flagged && /^qa_auto_/i.test(name)) return { kind: 'delete', why: 'สำเนาตัวพิมพ์ใหญ่ของ username ทดสอบ (จากเทสบั๊กชื่อซ้ำ)' };
  if (flagged && /^ทดสอบ[0-9a-z]+$/.test(name)) return { kind: 'delete', why: 'username ภาษาไทยที่ TC-ADMU-05-08 สร้าง' };
  if (INCLUDE.includes(name)) return { kind: 'delete', why: 'ระบุเองด้วย --include' };
  if (name.toLowerCase() === 'admin' || (ADMIN_USER && name.toLowerCase() === ADMIN_USER.toLowerCase())) {
    return { kind: 'review', why: 'username คล้าย admin แต่ต่างตัวพิมพ์ (มาจากบั๊กชื่อซ้ำ)' };
  }
  if (flagged || /ทดสอบอัตโนมัติ/.test(user.name)) {
    return { kind: 'review', why: 'ชื่อเป็นชื่อทดสอบของ automation แต่ username ไม่ตรงรูปแบบที่ลบให้อัตโนมัติ' };
  }
  return { kind: 'keep', why: 'ไม่ใช่ข้อมูลที่ automation สร้าง' };
}

async function login(page) {
  await page.goto(`${BASE}/frontend/account/index`);
  await page.getByPlaceholder('Username').fill(ADMIN_USER);
  await page.locator("input[type='password']").fill(ADMIN_PASS);
  await page.locator("button[type='submit']").click();
  await page.waitForURL('**/admin/dashboard/index', { timeout: 60_000 });
}

/** Opens a list page; false when it has no rows (e.g. a page past the end after deletions). */
async function openList(page, pageNo) {
  await page.goto(`${BASE}/admin/user/index${pageNo > 1 ? `?page=${pageNo}` : ''}`, { waitUntil: 'load' });
  return page
    .locator('table tbody tr')
    .first()
    .waitFor({ timeout: pageNo > 1 ? 10_000 : 30_000 })
    .then(() => true, () => false);
}

async function readTotal(page) {
  const text = await page.locator('body').innerText();
  const match = /จาก\s*(\d+)\s*รายการ/.exec(text);
  if (!match) throw new Error('อ่านยอดรวม "จาก N รายการ" ไม่ได้');
  return Number(match[1]);
}

/** Users shown on the current page, read from each row's edit button (data-* attributes). */
async function readRows(page) {
  return page.locator('table tbody tr').evaluateAll((trs) =>
    trs.map((tr) => {
      const edit = tr.querySelector('button.js-edit-user');
      return {
        username: edit ? edit.dataset.username || '' : '',
        name: edit ? edit.dataset.name || '' : '',
        email: edit ? edit.dataset.email || '' : '',
        hasDelete: !!tr.querySelector('button.delete'),
      };
    }),
  );
}

/** Walks every list page; users are keyed by username, so duplicates the unstable paging shows are collapsed. */
async function scan(page) {
  if (!(await openList(page, 1))) throw new Error('หน้าแรกของรายการผู้ใช้ไม่มีแถวเลย');
  const total = await readTotal(page);
  const pages = Math.max(1, Math.ceil(total / PAGE_SIZE));
  const users = new Map();
  let rowsRead = 0;
  for (let p = 1; p <= pages; p++) {
    if (p > 1 && !(await openList(page, p))) continue;
    for (const row of await readRows(page)) {
      rowsRead++;
      if (row.username && !users.has(row.username)) users.set(row.username, { ...row, page: p });
    }
  }
  return { total, rowsRead, users: [...users.values()] };
}

const esc = (s) => s.replace(/\\/g, '\\\\').replace(/"/g, '\\"');

/** Deletes one automation user found on `pageNo`. Returns true when the total went down by one. */
async function deleteOne(page, target) {
  const username = target.username;
  if (classify(target).kind !== 'delete') throw new Error(`ปฏิเสธการลบ "${username}": ไม่เข้ากติกาที่ลบให้อัตโนมัติ`);
  const before = await readTotal(page);
  const row = page.locator('table tbody tr').filter({ has: page.locator(`button.js-edit-user[data-username="${esc(username)}"]`) });
  if ((await row.count()) !== 1) return false; // moved to another page meanwhile — the next sweep will retry
  // Re-read the row from the page right before clicking, and re-apply the rule to what is really there.
  const live = (await readRows(page)).find((r) => r.username === username);
  if (!live || classify(live).kind !== 'delete') throw new Error(`ปฏิเสธการลบ "${username}": ข้อมูลในหน้าจอไม่ตรงกับที่ตรวจไว้`);
  await row.locator('button.delete').click();
  const dialog = page.getByRole('dialog').filter({ hasText: 'ต้องการลบข้อมูล?' });
  await dialog.waitFor({ state: 'visible', timeout: 15_000 });
  await Promise.all([page.waitForLoadState('load'), dialog.getByRole('button', { name: 'ยืนยันลบข้อมูล' }).click()]);
  await openList(page, 1); // page 1 always exists, unlike the page just emptied
  return (await readTotal(page)) === before - 1;
}

async function runUsers(page) {
  log('## ผู้ใช้ (users)');
  log();
  // ---- report ----
  const first = await scan(page);
  const groups = { delete: [], review: [], keep: [] };
  for (const user of first.users) groups[classify(user).kind].push({ ...user, ...classify(user) });

  log(`- ยอดรวมที่ระบบแจ้ง: **${first.total}** | อ่านได้ ${first.rowsRead} แถว | ไม่ซ้ำกัน ${first.users.length} คน`);
  if (first.users.length < first.total) {
    log(`- ⚠️ มี ${first.total - first.users.length} คนที่ "ไม่โผล่" ในหน้าใดเลย (รายการแบ่งหน้าไม่นิ่งเมื่อชื่อซ้ำ) — จะโผล่ขึ้นมาเมื่อลบชุดที่เห็นออกไปแล้ว`);
  }
  log(`- ลบ: **${groups.delete.length}** | ตรวจสอบเอง (ไม่ลบ): **${groups.review.length}** | เก็บไว้: **${groups.keep.length}**`);
  if (INCLUDE.length) log(`- --include: ${INCLUDE.join(', ')}`);
  log();
  log(`### ลบ (${groups.delete.length})`);
  for (const u of groups.delete) log(`- ${u.username}  |  ${u.name}${u.why.startsWith('username ขึ้นต้น') ? '' : `  → ${u.why}`}`);
  if (!groups.delete.length) log('- ไม่มี');
  log();
  log(`### ตรวจสอบเอง (${groups.review.length}) — สคริปต์จะไม่ลบ`);
  for (const u of groups.review) log(`- ${u.username}  |  ${u.name}  |  ${u.email || '—'}  → ${u.why}`);
  if (!groups.review.length) log('- ไม่มี');
  log();
  log(`### เก็บไว้ (${groups.keep.length})`);
  for (const u of groups.keep) log(`- ${u.username}  |  ${u.name}  → ${u.why}`);
  log();
  if (!DELETE) return;

  // ---- delete ----
  log('### ผลการลบผู้ใช้');
  let deleted = 0;
  let failures = 0;
  sweeps: for (let sweep = 1; sweep <= MAX_SWEEPS; sweep++) {
    const deletedBefore = deleted;
    let pageNo = 1;
    for (let step = 0; step < 500; step++) {
      if (!(await openList(page, pageNo))) {
        if (pageNo > 1) {
          pageNo--; // the last page was emptied by the deletions
          continue;
        }
        break;
      }
      const total = await readTotal(page);
      const candidate = (await readRows(page)).find((row) => classify(row).kind === 'delete');
      if (candidate) {
        if (shared.deleted >= LIMIT || shared.deleted >= MAX_DELETES) break sweeps;
        const ok = await deleteOne(page, candidate);
        if (ok) {
          deleted++;
          shared.deleted++;
          log(`- ✅ ลบแล้ว: ${candidate.username}`);
          failures = 0;
        } else if (++failures >= 3) {
          log('- ❌ ลบไม่สำเร็จติดกัน 3 ครั้ง หยุดทำงาน (ดูหน้าจอ Dev ว่าเกิดอะไรขึ้น)');
          break sweeps;
        }
        continue; // same page again: the list shifted up
      }
      if (pageNo * PAGE_SIZE >= total) break;
      pageNo++;
    }
    if (deleted === deletedBefore) break; // a whole sweep deleted nothing: done
  }

  const after = await scan(page);
  const leftDelete = after.users.filter((u) => classify(u).kind === 'delete');
  log();
  log(`- ลบผู้ใช้ **${deleted}** ราย | ยอดรวมตอนนี้ ${after.total} (อ่านได้ ${after.users.length} คนไม่ซ้ำ)`);
  log(`- ที่ยังเหลือและเข้าข่ายลบ: ${leftDelete.length}${shared.deleted >= LIMIT ? ' (หยุดเพราะครบ --limit)' : ''}`);
  if (after.users.length < after.total) {
    log(`- ⚠️ ยังมี ${after.total - after.users.length} คนที่ไม่โผล่ในรายการ (อาจต้องรันซ้ำ หรือเป็นชื่อซ้ำของข้อมูลจริง)`);
  }
  log();
}

// ---------------------------------------------------------------- roles
function classifyRole(role) {
  if (!role.hasDelete) return { kind: 'keep', why: 'สิทธิ์ของระบบ (ไม่มีปุ่มลบ)' };
  if (role.name.includes(FLAG) || role.description.includes(FLAG)) return { kind: 'delete', why: `ชื่อหรือคำอธิบายมี ${FLAG}` };
  if (INCLUDE_ROLES.includes(role.name)) return { kind: 'delete', why: 'ระบุเองด้วย --include-role' };
  return { kind: 'keep', why: 'ไม่ใช่ข้อมูลที่ automation สร้าง' };
}

async function openRoles(page) {
  await page.goto(`${BASE}/admin/role/index`, { waitUntil: 'load' });
  await page.locator('table tbody tr').first().waitFor({ timeout: 30_000 });
}

/** Roles on the list (it has no pager): name, description, user count and whether the row has a delete button. */
async function readRoleRows(page) {
  return page.locator('table tbody tr').evaluateAll((trs) =>
    trs.map((tr) => {
      const cells = tr.querySelectorAll('td');
      const nameCell = cells[1];
      return {
        name: [...nameCell.childNodes].filter((n) => n.nodeType === 3).map((n) => n.textContent || '').join('').trim(),
        description: (nameCell.querySelector('div') && nameCell.querySelector('div').textContent.trim()) || '',
        users: (cells[2].textContent || '').trim(),
        hasDelete: !!tr.querySelector('button.delete'),
      };
    }),
  );
}

async function deleteRoleAt(page, index, role) {
  const before = (await readRoleRows(page)).length;
  const live = (await readRoleRows(page))[index];
  if (!live || live.name !== role.name || classifyRole(live).kind !== 'delete') {
    throw new Error(`ปฏิเสธการลบสิทธิ์ "${role.name}": ข้อมูลในหน้าจอไม่ตรงกับที่ตรวจไว้`);
  }
  await page.locator('table tbody tr').nth(index).locator('button.delete').click();
  const dialog = page.getByRole('dialog').filter({ hasText: 'ต้องการลบข้อมูล?' });
  await dialog.waitFor({ state: 'visible', timeout: 15_000 });
  await Promise.all([page.waitForLoadState('load'), dialog.getByRole('button', { name: 'ยืนยันลบข้อมูล' }).click()]);
  await openRoles(page);
  return (await readRoleRows(page)).length === before - 1;
}

async function runRoles(page) {
  log('## สิทธิ์การใช้งาน (roles)');
  log();
  await openRoles(page);
  const rows = await readRoleRows(page);
  const groups = { delete: [], keep: [] };
  for (const role of rows) groups[classifyRole(role).kind].push({ ...role, ...classifyRole(role) });
  log(`- ทั้งหมด **${rows.length}** สิทธิ์ | ลบ: **${groups.delete.length}** | เก็บไว้: **${groups.keep.length}**`);
  if (INCLUDE_ROLES.length) log(`- --include-role: ${INCLUDE_ROLES.join(', ')}`);
  log();
  log(`### ลบ (${groups.delete.length})`);
  for (const r of groups.delete) {
    log(`- ${r.name}  |  ${r.description || '—'}  |  ผู้ใช้ ${r.users}${r.users !== '0' ? '  ⚠️ ยังมีผู้ใช้ใช้สิทธิ์นี้ จะข้ามไป' : ''}`);
  }
  if (!groups.delete.length) log('- ไม่มี');
  log();
  log(`### เก็บไว้ (${groups.keep.length})`);
  for (const r of groups.keep) log(`- ${r.name}  |  ผู้ใช้ ${r.users}  → ${r.why}`);
  log();
  if (!DELETE) return;

  log('### ผลการลบสิทธิ์');
  let deleted = 0;
  let failures = 0;
  for (let step = 0; step < 200; step++) {
    await openRoles(page);
    const current = await readRoleRows(page);
    const index = current.findIndex((r) => classifyRole(r).kind === 'delete' && r.users === '0');
    if (index < 0) break;
    if (shared.deleted >= LIMIT || shared.deleted >= MAX_DELETES) break;
    const ok = await deleteRoleAt(page, index, current[index]);
    if (ok) {
      deleted++;
      shared.deleted++;
      failures = 0;
      log(`- ✅ ลบแล้ว: ${current[index].name}`);
    } else if (++failures >= 3) {
      log('- ❌ ลบไม่สำเร็จติดกัน 3 ครั้ง หยุดทำงาน (ดูหน้าจอ Dev ว่าเกิดอะไรขึ้น)');
      break;
    }
  }
  await openRoles(page);
  const after = await readRoleRows(page);
  const left = after.filter((r) => classifyRole(r).kind === 'delete');
  log();
  log(`- ลบสิทธิ์ **${deleted}** รายการ | เหลือสิทธิ์ทั้งหมด ${after.length}`);
  log(`- ที่ยังเหลือและเข้าข่ายลบ: ${left.length}${left.some((r) => r.users !== '0') ? ' (บางรายการยังมีผู้ใช้ใช้อยู่)' : ''}`);
  log();
}

// ---------------------------------------------------------------- categories
const CATEGORY_TABS = [
  ['cms', 'ข่าวกิจกรรม KM'],
  ['knowledge', 'คลังความรู้'],
  ['cop', 'ชุมชนนักปฏิบัติ'],
  ['infographic', 'อินโฟกราฟิก'],
  ['best_practice', 'แนวทางปฏิบัติที่ดี'],
  ['faq', 'คำถามยอดฮิต'],
];

/** delete = the "[Auto Test]" marker is in the name or the description and the card has a delete control; QA's own cards have no marker. */
function classifyCategory(card) {
  if (!card.hasDelete) return { kind: 'keep', why: 'ไม่มีปุ่มลบ' };
  if (card.name.includes(FLAG) || card.description.includes(FLAG)) return { kind: 'delete', why: `ชื่อหรือหัวข้อย่อยมี ${FLAG}` };
  return { kind: 'keep', why: 'ไม่ใช่ข้อมูลที่ automation สร้าง' };
}

async function openCategories(page, tab, pageNo = 1) {
  await page.goto(`${BASE}/admin/group/index?module=${tab}${pageNo > 1 ? `&page=${pageNo}` : ''}`, { waitUntil: 'load' });
  await page.locator('.body-content h4').first().waitFor({ timeout: 30_000 });
}

/** Category cards of the open tab page: name, description, and whether the card has a delete control. */
async function readCategoryCards(page) {
  return page.locator('.card.vertical').evaluateAll((cards) =>
    cards.map((card) => {
      const text = (selector) => (card.querySelector(selector) ? card.querySelector(selector).textContent.trim() : '');
      const description = text('.card-body .text-gray');
      return { name: text('.card-body .fw-bold'), description: description === '—' ? '' : description, hasDelete: !!card.querySelector('[data-delete-url]') };
    }),
  );
}

/** "แสดง10-14 รายการ จาก 14 รายการ" of the open page → { to, total } (null when absent). */
async function readCategoryCounter(page) {
  const match = /แสดง\s*(\d+)\s*-\s*(\d+)\s*รายการ\s*จาก\s*(\d+)\s*รายการ/.exec(await page.locator('body').innerText());
  return match ? { to: Number(match[2]), total: Number(match[3]) } : null;
}

/** Every card of a tab, across all its pages (a tab shows 9 per page, oldest first): [{ pageNo, index, ...card }]. */
async function readTabCards(page, tab) {
  const all = [];
  for (let pageNo = 1; pageNo <= 100; pageNo++) {
    await openCategories(page, tab, pageNo);
    const cards = await readCategoryCards(page);
    cards.forEach((card, index) => all.push({ pageNo, index, ...card }));
    const counter = await readCategoryCounter(page);
    if (!counter || counter.to >= counter.total || cards.length === 0) break;
  }
  return all;
}

async function deleteCategoryAt(page, tab, target) {
  await openCategories(page, tab, target.pageNo);
  const live = (await readCategoryCards(page))[target.index];
  if (!live || live.name !== target.name || classifyCategory(live).kind !== 'delete') {
    throw new Error(`ปฏิเสธการลบหมวดหมู่ "${target.name}": ข้อมูลในหน้าจอไม่ตรงกับที่ตรวจไว้`);
  }
  const before = (await readTabCards(page, tab)).length;
  await openCategories(page, tab, target.pageNo);
  await page.locator('.card.vertical').nth(target.index).locator('[data-delete-url]').click();
  const dialog = page.getByRole('dialog').filter({ hasText: 'ต้องการลบข้อมูล?' });
  await dialog.waitFor({ state: 'visible', timeout: 15_000 });
  await Promise.all([page.waitForLoadState('load'), dialog.getByRole('button', { name: 'ยืนยันลบข้อมูล' }).click()]);
  return (await readTabCards(page, tab)).length === before - 1;
}

async function runCategories(page) {
  log('## หมวดหมู่ (categories)');
  log();
  // Report: every card of every tab, across all pages.
  const found = [];
  for (const [tab, label] of CATEGORY_TABS) {
    for (const card of await readTabCards(page, tab)) found.push({ tab, label, ...card, ...classifyCategory(card) });
  }
  const toDelete = found.filter((c) => c.kind === 'delete');
  log(`- ทั้งหมด **${found.length}** หมวดหมู่ใน ${CATEGORY_TABS.length} แท็บ | ลบ: **${toDelete.length}** | เก็บไว้: **${found.length - toDelete.length}**`);
  log();
  log(`### ลบ (${toDelete.length})`);
  for (const c of toDelete) log(`- [${c.label}] ${c.name}  |  ${c.description || '—'}`);
  if (!toDelete.length) log('- ไม่มี');
  log();
  log(`### เก็บไว้ (${found.length - toDelete.length})`);
  for (const c of found.filter((x) => x.kind !== 'delete')) log(`- [${c.label}] ${c.name}  → ${c.why}`);
  log();
  if (!DELETE) return;

  log('### ผลการลบหมวดหมู่');
  let deleted = 0;
  let failures = 0;
  for (const [tab, label] of CATEGORY_TABS) {
    for (let step = 0; step < 200; step++) {
      const target = (await readTabCards(page, tab)).find((c) => classifyCategory(c).kind === 'delete');
      if (!target) break;
      if (shared.deleted >= LIMIT || shared.deleted >= MAX_DELETES) break;
      const ok = await deleteCategoryAt(page, tab, target);
      if (ok) {
        deleted++;
        shared.deleted++;
        failures = 0;
        log(`- ✅ ลบแล้ว: [${label}] ${target.name}`);
      } else if (++failures >= 3) {
        log('- ❌ ลบไม่สำเร็จติดกัน 3 ครั้ง หยุดทำงาน (ดูหน้าจอ Dev ว่าเกิดอะไรขึ้น)');
        return;
      }
    }
  }
  let left = 0;
  for (const [tab] of CATEGORY_TABS) left += (await readTabCards(page, tab)).filter((c) => classifyCategory(c).kind === 'delete').length;
  log();
  log(`- ลบหมวดหมู่ **${deleted}** รายการ | ที่ยังเหลือและเข้าข่ายลบ: ${left}`);
  log();
}

async function main() {
  if (!ADMIN_USER || !ADMIN_PASS) {
    console.error('ไม่พบ ADMIN_USER / ADMIN_PASS ใน .env');
    process.exit(2);
  }
  log(`# ล้างข้อมูลทดสอบ — ${stamp}`);
  log(`- ระบบ: ${BASE}`);
  log(`- ขอบเขต: ${{ all: 'ผู้ใช้ + สิทธิ์ + หมวดหมู่', users: 'ผู้ใช้เท่านั้น', roles: 'สิทธิ์เท่านั้น', categories: 'หมวดหมู่เท่านั้น' }[ONLY]}`);
  log(`- โหมด: ${DELETE ? `ลบจริง (--delete${Number.isFinite(LIMIT) ? `, สูงสุด ${LIMIT} รายการ` : ''})` : 'ดูรายการเฉย ๆ (dry run) — ยังไม่ลบอะไร'}`);
  log();

  const browser = await chromium.launch();
  const page = await (await browser.newContext()).newPage();
  try {
    await login(page);
    if (ONLY === 'all' || ONLY === 'users') await runUsers(page);
    if (ONLY === 'all' || ONLY === 'roles') await runRoles(page);
    if (ONLY === 'all' || ONLY === 'categories') await runCategories(page);
    if (!DELETE) {
      log('> นี่คือ dry run ยังไม่ได้ลบอะไร ถ้ารายการ "ลบ" ถูกต้อง สั่งลบจริงด้วย `npm run cleanup:data -- --delete`');
      log('> (ลองลบ 1 รายการก่อนได้ด้วย `--delete --limit 1`)');
    }
  } finally {
    await browser.close();
    const outDir = path.join(__dirname, '..', 'evidence');
    fs.mkdirSync(outDir, { recursive: true });
    const file = path.join(outDir, `cleanup-${stamp}${DELETE ? '' : '-dryrun'}.md`);
    fs.writeFileSync(file, logLines.join('\n') + '\n', 'utf8');
    console.log(`\nบันทึก log ไว้ที่ ${file}`);
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
