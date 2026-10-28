import { test, expect, ANONYMOUS_SESSION } from '@fixtures/pages.fixtures';
import { PageDiagnostics } from '@utils/pageDiagnostics';
import { DROPDOWN_MENU, DROPDOWN_TOGGLES, FOOTER_LINKS } from '@utils/publicPages';

/**
 * KM-FEH / SC-FEH-01 + SC-FEH-03 (menu, footer, back-to-top, keyboard, mobile).
 * The public site is read-only, so nothing here creates data. Runs logged out.
 *
 * Note: the site loads Owl Carousel and Font Awesome from cdnjs.cloudflare.com,
 * so the runner needs internet access for the carousel-dependent specs.
 */
test.use({ storageState: ANONYMOUS_SESSION });

test.describe('SC-FEH-01 เมนูและองค์ประกอบร่วมของเว็บไซต์', () => {
  test('TC-FEH-01-01 [High] โหลดหน้าหลักสำเร็จ', async ({ page, homePage }) => {
    // KNOWN BUG — confirmed 2026-09-25: the home page requests /image/bg.png,
    // which returns 404, and the browser logs it as a console error. The
    // console check is the LAST assertion so this test fails there (and not
    // earlier on the menu/logo checks) — verify that when re-running.
    test.fail(true, 'Known bug: GET /image/bg.png returns 404 on the home page (console error).');

    const diagnostics = new PageDiagnostics(page);
    const response = await homePage.open();

    expect(response?.status()).toBe(200);
    await expect(page).toHaveTitle('หน้าหลัก');
    await expect(homePage.logo).toBeVisible();
    await expect(homePage.navLink('หน้าหลัก')).toBeVisible();
    await expect(homePage.navLink('CoPs')).toBeVisible();
    for (const toggle of DROPDOWN_TOGGLES) await expect(homePage.dropdownToggle(toggle)).toBeVisible();
    await expect(homePage.searchIcon).toBeVisible();
    await expect(homePage.userIcon).toBeVisible();

    await page.waitForLoadState('networkidle');
    expect(diagnostics.problems, 'errors reported while loading /').toEqual([]);
  });

  test('TC-FEH-01-02 [High] เมนู Dropdown และลิงก์ปลายทาง', async ({ page, publicPage }) => {
    for (const { toggle, item, path } of DROPDOWN_MENU) {
      await test.step(`${toggle} › ${item} → ${path}`, async () => {
        await publicPage.open('/');
        await publicPage.dropdownToggle(toggle).click();

        const navigation = page.waitForResponse(
          (res) => res.request().isNavigationRequest() && new URL(res.url()).pathname === path,
        );
        await publicPage.dropdownItem(toggle, item).click();

        expect((await navigation).status()).toBe(200);
        await expect(page).toHaveURL(new RegExp(`${path}$`));
      });
    }
  });

  test('TC-FEH-01-03 [Medium] ไอคอนค้นหาและไอคอนผู้ใช้', async ({ page, publicPage }) => {
    await publicPage.open('/');
    await publicPage.searchIcon.click();
    await expect(page).toHaveURL(/\/frontend\/search\/index$/);

    await publicPage.open('/');
    await publicPage.userIcon.click();
    await expect(page).toHaveURL(/\/frontend\/account\/index$/);
  });

  test('TC-FEH-01-04 [Medium] Footer แสดงข้อมูลและลิงก์', async ({ page, publicPage }) => {
    // The footer links were href="#" until dev made the footer editable in the admin (fixed, passed 2026-10-01).

    await publicPage.open('/');
    await expect(publicPage.footer).toContainText('อาคารบรมราชชนนีศรีศตพรรษ');
    await expect(publicPage.footer).toContainText('0-2218-1128');
    await expect(publicPage.footer).toContainText(/ผู้เข้าชมทั้งหมด\s*:\s*[\d,]+/);

    for (const { label, path } of FOOTER_LINKS) {
      const link = publicPage.footerLink(label);
      await expect(link, `footer link "${label}"`).not.toHaveAttribute('href', '#');
      await link.click();
      await expect(page).toHaveURL(new RegExp(`${path}$`));
      await publicPage.open('/');
    }
  });

  test('TC-FEH-01-05 [Low] ปุ่ม Back to Top', async ({ publicPage }) => {
    // The site's script shows the button once scrollTop > 300 and hides it
    // again otherwise. (It is also visible on first paint before any scroll
    // event — reported as an observation, not asserted here.)
    await publicPage.open('/');

    await publicPage.scrollToBottom();
    await expect(publicPage.backToTop).toBeVisible();

    await publicPage.backToTop.click();
    await expect.poll(() => publicPage.scrollY(), { message: 'page scrolls back to the top' }).toBe(0);
    await expect(publicPage.backToTop).toBeHidden();
  });
});

test.describe('SC-FEH-03 การเข้าถึงและข้อมูลพื้นฐานของหน้า Public', () => {
  test('TC-FEH-03-07 [Low] ใช้เมนูด้วยคีย์บอร์ด', async ({ page, publicPage }) => {
    // KNOWN BUG — confirmed 2026-09-25: the "Knowledge" toggle is an <a>
    // without href, so Tab skips it (order is logo, หน้าหลัก, CoPs, then
    // straight to คลังกิจกรรม). The other two dropdowns work fully by
    // keyboard (Enter opens, ArrowDown moves into the items, Esc closes and
    // returns focus). All three are checked and every problem is reported
    // together, so the failure message shows exactly what is broken.
    test.fail(true, 'Known bug: the "Knowledge" menu toggle has no href, so keyboard users cannot reach or open it.');

    const problems: string[] = [];
    for (const label of DROPDOWN_TOGGLES) {
      await publicPage.open('/');
      const toggle = publicPage.dropdownToggle(label);

      if (!(await publicPage.tabTo(toggle))) {
        problems.push(`${label}: Tab never reaches the menu toggle`);
        continue;
      }
      const outline = await toggle.evaluate((el) => {
        const style = getComputedStyle(el);
        return { outline: style.outlineStyle, shadow: style.boxShadow };
      });
      if (outline.outline === 'none' && outline.shadow === 'none') problems.push(`${label}: no visible focus indicator`);

      await page.keyboard.press('Enter');
      const opened = await expect
        .poll(() => publicPage.openDropdownMenu.count(), { timeout: 2_000 })
        .toBe(1)
        .then(() => true, () => false);
      if (!opened) {
        problems.push(`${label}: Enter does not open the dropdown`);
        continue;
      }

      await page.keyboard.press('ArrowDown');
      const firstItem = publicPage.openDropdownMenu.locator('.dropdown-item').first();
      if (!(await firstItem.evaluate((el) => el === document.activeElement))) {
        problems.push(`${label}: ArrowDown does not move focus into the dropdown items`);
      }

      await page.keyboard.press('Escape');
      const closed = await expect
        .poll(() => publicPage.openDropdownMenu.count(), { timeout: 2_000 })
        .toBe(0)
        .then(() => true, () => false);
      if (!closed) problems.push(`${label}: Esc does not close the dropdown`);
    }

    expect(problems).toEqual([]);
  });

  test('TC-FEH-03-08 [Low] ไอคอนค้นหาและไอคอนผู้ใช้ต้องมีชื่อสำหรับโปรแกรมอ่านหน้าจอ', async ({ publicPage }) => {
    // KNOWN BUG — noted in the sheet on 2026-09-21, re-confirmed 2026-09-25:
    // both links wrap only <img alt="Search"> / <img alt="User">: no
    // aria-label and no text, and the alt text is English in a Thai UI.
    test.fail(true, 'Known bug: search/user icon links have no aria-label or text (only img alt "Search"/"User").');

    await publicPage.open('/');
    for (const [name, link] of [
      ['search icon', publicPage.searchIcon],
      ['user icon', publicPage.userIcon],
    ] as const) {
      const label = ((await link.getAttribute('aria-label')) ?? '').trim();
      const text = (await link.innerText()).trim();
      expect(label || text, `${name} link needs an aria-label or visible text`).toBeTruthy();
    }
  });

  test('TC-FEH-03-09 [Medium] เมนูแบบมือถือ (ความกว้าง 375px)', async ({ page, publicPage }) => {
    await page.setViewportSize({ width: 375, height: 812 });
    await publicPage.open('/');
    expect(await publicPage.hasHorizontalScroll(), 'no horizontal scroll at 375px').toBe(false);

    // Open, then close with the close button.
    await expect(publicPage.menuToggler).toBeVisible();
    await publicPage.menuToggler.click();
    await expect(publicPage.offcanvas).toHaveClass(/\bshow\b/);
    await expect(publicPage.navLink('CoPs')).toBeVisible();
    await publicPage.menuCloseButton.click();
    await expect(publicPage.offcanvas).not.toHaveClass(/\bshow\b/);

    // Open again and pick a link: it navigates (and the new page starts with the menu closed).
    await publicPage.menuToggler.click();
    await publicPage.navLink('CoPs').click();
    await expect(page).toHaveURL(/\/frontend\/cops\/index$/);
    await expect(publicPage.offcanvas).not.toHaveClass(/\bshow\b/);
    expect(await publicPage.hasHorizontalScroll(), 'no horizontal scroll at 375px').toBe(false);
  });
});
