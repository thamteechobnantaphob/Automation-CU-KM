import { Page } from '@playwright/test';

/**
 * Records what the browser complained about while a page loaded: JS errors,
 * console errors and HTTP >= 400 responses (images, CSS, JS, fonts).
 * Attach BEFORE navigating, then read `problems` once the page has settled.
 *
 * Network-level failures (DNS/connection refused) are deliberately ignored:
 * they say something about the runner's connectivity (e.g. the public site
 * loads Owl Carousel and Font Awesome from cdnjs.cloudflare.com), not about
 * the application.
 */
export class PageDiagnostics {
  private readonly consoleErrors: string[] = [];
  private readonly pageErrors: string[] = [];
  private readonly badResponses: string[] = [];

  constructor(page: Page) {
    page.on('console', (message) => {
      if (message.type() === 'error') this.consoleErrors.push(message.text());
    });
    page.on('pageerror', (error) => this.pageErrors.push(error.message));
    page.on('response', (response) => {
      if (response.status() >= 400) {
        const { pathname } = new URL(response.url());
        this.badResponses.push(`HTTP ${response.status()} ${pathname}`);
      }
    });
  }

  /**
   * Human-readable list. "Failed to load resource" console lines are just the
   * browser echoing a bad response already listed, so they are folded away to
   * keep failure messages short.
   */
  get problems(): string[] {
    const console = this.consoleErrors.filter((text) => !/^Failed to load resource/.test(text));
    return [
      ...this.badResponses,
      ...this.pageErrors.map((text) => `JS error: ${text}`),
      ...console.map((text) => `console.error: ${text}`),
    ];
  }
}
