import { expect, Page, test } from '@playwright/test';

/**
 * TinyMCE checks shared by the content-module form specs (KM-KNOW / KM-FKNO / …).
 *
 * "พิมพ์และจัดรูปแบบ 5 ครั้ง → Undo 5 ครั้ง แล้ว Redo 5 ครั้ง": types one sentence, then applies five formats from the
 * toolbar (each is exactly one undo level — typed text is not, TinyMCE may split it per keystroke), presses the
 * toolbar's "Undo" five times — back to the typed sentence, step by step — and "Redo" five times — every format back.
 */
export async function undoRedoFiveSteps(page: Page): Promise<void> {
  const html = (): Promise<string> =>
    page.evaluate(() => (window as unknown as { tinymce: { activeEditor: { getContent(): string } } }).tinymce.activeEditor.getContent());
  const tool = async (label: string): Promise<void> => {
    // "Bullet list" is a split button (main + arrow share the label): take the main one.
    const button = page.locator(`.tox-tinymce button[aria-label="${label}"]`).first();
    if (!(await button.isVisible())) await page.locator('.tox-tinymce button[aria-label="Reveal or hide additional toolbar items"]').click();
    await button.click();
  };

  await page.frameLocator('.tox-edit-area iframe').locator('body').click();
  await page.keyboard.type('ข้อความทดสอบ Undo Redo');
  await page.waitForTimeout(500);
  await page.keyboard.press('Control+A');
  const states = [await html()];
  for (const label of ['Bold', 'Italic', 'Underline', 'Align center', 'Bullet list']) {
    await tool(label);
    states.push(await html());
  }
  expect(new Set(states).size, 'each format changed the content').toBe(6);

  const afterUndo: string[] = [];
  for (let i = 0; i < 5; i++) {
    await tool('Undo');
    afterUndo.push(await html());
  }
  test.info().annotations.push({ type: 'note', description: `Steps: ${states.length - 1} formats; undo went back through ${afterUndo.filter((s, i) => s === states[4 - i]).length}/5 states in order.` });
  expect(afterUndo, 'each Undo goes back one step').toEqual([states[4], states[3], states[2], states[1], states[0]]);
  for (let i = 0; i < 5; i++) await tool('Redo');
  expect(await html(), 'five redos bring every format back').toBe(states[5]);
}
