import { Page, Response } from '@playwright/test';
import { env } from '@config/env';

export class BasePage {
  constructor(protected readonly page: Page) {}

  /**
   * Navigate to a path relative to BASE_URL (e.g. "/admin/user/index").
   * Returns the main-frame response so callers can assert on the HTTP status.
   */
  async goto(path: string): Promise<Response | null> {
    const url = path.startsWith('http') ? path : `${env.baseURL}${path}`;
    return this.page.goto(url);
  }
}
