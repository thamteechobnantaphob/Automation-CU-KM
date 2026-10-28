import { test, expect } from '@fixtures/pages.fixtures';
import { GROUP_TABS, SHEET_TAB_KEYS } from '@pages/admin/AdminGroupPage';

/**
 * KM-ADMG / SC-ADMG-01 — the tabs of /admin/group/index (หมวดหมู่). Read-only:
 * nothing is saved. Runs as admin (default storageState).
 *
 * Spec note: the sheet says "5 ประเภท" (ข่าวกิจกรรม KM, คลังความรู้, ชุมชนนักปฏิบัติ,
 * อินโฟกราฟิก, แนวทางปฏิบัติที่ดี); the app has a sixth tab, "คำถามยอดฮิต" (faq).
 * All six are checked and the extra one is recorded as a spec mismatch.
 */

test.describe('SC-ADMG-01 แท็บประเภทหมวดหมู่', () => {
  test('TC-ADMG-01-01 [Medium] สลับแท็บประเภทหมวดหมู่ทั้ง 5 ประเภท', async ({ page, groupPage }) => {
    await groupPage.open('cms');
    await expect(groupPage.pageHeading).toHaveText('จัดการหมวดหมู่');
    for (const key of SHEET_TAB_KEYS) await expect(groupPage.tabLink(key), `tab "${key}" of the sheet`).toBeVisible();

    const summary: string[] = [];
    for (const tab of GROUP_TABS) {
      await groupPage.tabLink(tab.key).click();
      await expect(page).toHaveURL(new RegExp(`module=${tab.key}(&|$)`));
      await expect(groupPage.tabLink(tab.key), `tab "${tab.label}" is marked active`).toHaveClass(/active/);
      await expect(groupPage.tabHeading).toHaveText(`หมวดหมู่${tab.label}`);
      await expect(groupPage.addButton, `"เพิ่มหมวดหมู่" on tab "${tab.label}"`).toBeVisible();

      // Data on Dev changes (QA keeps a couple of categories on one tab), so an empty tab must show the empty state
      // and a filled one must show a counter that matches its cards.
      const cards = await groupPage.readCards();
      const counter = await groupPage.counter();
      if (cards.length === 0) {
        await expect(groupPage.emptyState(tab.label), `empty state of "${tab.label}"`).toBeVisible();
        expect(counter, `counter of the empty tab "${tab.label}"`).toEqual({ from: 0, to: 0, total: 0 });
      } else {
        expect(counter, `counter of tab "${tab.label}"`).not.toBeNull();
        expect((counter?.to ?? 0) - (counter?.from ?? 0) + 1, `cards shown vs counter on "${tab.label}"`).toBe(cards.length);
      }
      summary.push(`${tab.label}: ${cards.length === 0 ? 'ว่าง' : `${cards.length} รายการ`}`);
    }

    const extra = GROUP_TABS.filter((tab) => !SHEET_TAB_KEYS.includes(tab.key)).map((tab) => tab.label);
    test.info().annotations.push({
      type: 'note',
      description: `The sheet lists ${SHEET_TAB_KEYS.length} tabs; the app has ${GROUP_TABS.length} (extra: ${extra.join(', ')}). ${summary.join(' | ')}`,
    });
  });
});
