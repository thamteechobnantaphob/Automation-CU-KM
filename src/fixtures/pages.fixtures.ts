import { test as base } from '@playwright/test';
import { LoginPage } from '@pages/LoginPage';
import { DashboardPage } from '@pages/DashboardPage';
import { AdminUserListPage } from '@pages/admin/AdminUserListPage';
import { AdminRoleFormPage, AdminRoleListPage } from '@pages/admin/AdminRolePages';
import { AdminGroupPage } from '@pages/admin/AdminGroupPage';
import { AdminActivityLogPage } from '@pages/admin/AdminActivityLogPage';
import { PublicPage } from '@pages/public/PublicPage';
import { installOnBrowser, installOnContext, installPageLoaderWait } from '@utils/pageLoader';
import { HomePage } from '@pages/public/HomePage';
import {
  ActivityListPage,
  CopsListPage,
  NewsListPage,
  ContentListPage,
  newBestPracticeListPage,
  newKnowledgeListPage,
} from '@pages/public/ContentListPages';

type PageFixtures = {
  loginPage: LoginPage;
  dashboardPage: DashboardPage;
  userListPage: AdminUserListPage;
  roleListPage: AdminRoleListPage;
  roleFormPage: AdminRoleFormPage;
  groupPage: AdminGroupPage;
  activityLogPage: AdminActivityLogPage;
  publicPage: PublicPage;
  homePage: HomePage;
  copsListPage: CopsListPage;
  newsListPage: NewsListPage;
  activityListPage: ActivityListPage;
  knowledgeListPage: ContentListPage;
  bestPracticeListPage: ContentListPage;
};

/**
 * Empty browser session. Every spec that must run logged out (login screen,
 * the public site) opts in with `test.use({ storageState: ANONYMOUS_SESSION })`,
 * because playwright.config.ts starts all other tests as the admin.
 */
export const ANONYMOUS_SESSION = { cookies: [], origins: [] };

/**
 * Extends the base Playwright test with ready-to-use Page Objects so spec
 * files don't repeat `new LoginPage(page)` everywhere. Add one line here
 * whenever a new Page Object is introduced.
 */
export const test = base.extend<PageFixtures>({
  // Wait for the "รอสักครู่ กำลังเตรียมข้อมูล" loader before acting, on every page of every context
  // (also browser.newContext() ones), so screenshots/videos show the page — see src/utils/pageLoader.ts.
  browser: [
    async ({ browser }, use) => {
      installOnBrowser(browser);
      await use(browser);
    },
    { scope: 'worker' },
  ],
  context: async ({ context, javaScriptEnabled }, use) => {
    installOnContext(context, { javaScriptEnabled });
    await use(context);
  },
  page: async ({ page, javaScriptEnabled }, use) => {
    if (javaScriptEnabled !== false) await installPageLoaderWait(page);
    await use(page);
  },
  loginPage: async ({ page }, use) => {
    await use(new LoginPage(page));
  },
  dashboardPage: async ({ page }, use) => {
    await use(new DashboardPage(page));
  },
  userListPage: async ({ page }, use) => {
    await use(new AdminUserListPage(page));
  },
  roleListPage: async ({ page }, use) => {
    await use(new AdminRoleListPage(page));
  },
  roleFormPage: async ({ page }, use) => {
    await use(new AdminRoleFormPage(page));
  },
  activityLogPage: async ({ page }, use) => {
    await use(new AdminActivityLogPage(page));
  },
  groupPage: async ({ page }, use) => {
    await use(new AdminGroupPage(page));
  },
  publicPage: async ({ page }, use) => {
    await use(new PublicPage(page));
  },
  homePage: async ({ page }, use) => {
    await use(new HomePage(page));
  },
  copsListPage: async ({ page }, use) => {
    await use(new CopsListPage(page));
  },
  newsListPage: async ({ page }, use) => {
    await use(new NewsListPage(page));
  },
  activityListPage: async ({ page }, use) => {
    await use(new ActivityListPage(page));
  },
  knowledgeListPage: async ({ page }, use) => {
    await use(newKnowledgeListPage(page));
  },
  bestPracticeListPage: async ({ page }, use) => {
    await use(newBestPracticeListPage(page));
  },
});

export { expect } from '@playwright/test';
