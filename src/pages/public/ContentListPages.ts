import { Locator, Page, Response } from '@playwright/test';
import { PublicPage } from './PublicPage';

/**
 * Public list pages that share one layout: a `.header.page` title, then either
 * cards (`a.card`) or a grey "ยังไม่มี…" placeholder paragraph.
 */
export class ContentListPage extends PublicPage {
  /** Every card in the list (each card is one `<a class="card">`). */
  readonly cards: Locator;
  readonly cardTitles: Locator;
  /** "ยังไม่มี…" placeholder shown when nothing is published. */
  readonly emptyState: Locator;

  constructor(page: Page, protected readonly path: string) {
    super(page);
    this.cards = page.locator('.body-content a.card');
    this.cardTitles = this.cards.locator('.card-title');
    this.emptyState = page.locator('.body-content p.text-gray').filter({ hasText: 'ยังไม่มี' });
  }

  async open(): Promise<Response | null> {
    return super.open(this.path);
  }

  async titles(): Promise<string[]> {
    return (await this.cardTitles.allInnerTexts()).map((title) => title.trim());
  }
}

/** /frontend/cops/index — ชุมชนนักปฏิบัติ. Card: label, "n บทความ/ข่าว", community name. */
export class CopsListPage extends ContentListPage {
  readonly articleCounts: Locator;
  readonly cardImages: Locator;
  /** "← ชุมชนนักปฏิบัติทั้งหมด" link on a community's detail page. */
  readonly backToListLink: Locator;

  constructor(page: Page) {
    super(page, '/frontend/cops/index');
    this.articleCounts = this.cards.locator('.text-small');
    this.cardImages = this.cards.locator('img');
    this.backToListLink = page.getByRole('link', { name: /ชุมชนนักปฏิบัติทั้งหมด/ });
  }
}

/** /frontend/news/index — ข่าวสาร KM. Card: cover image, date, title, snippet. */
export class NewsListPage extends ContentListPage {
  readonly dates: Locator;
  readonly snippets: Locator;

  constructor(page: Page) {
    super(page, '/frontend/news/index');
    this.dates = this.cards.locator('.text-small');
    this.snippets = this.cards.locator('.card-text');
  }
}

/** /frontend/activity/index — คลังกิจกรรม. Shows "ทั้งหมด n อัลบัม" above the albums. */
export class ActivityListPage extends ContentListPage {
  readonly albumTotal: Locator;

  constructor(page: Page) {
    super(page, '/frontend/activity/index');
    this.albumTotal = page.locator('.body-content h5').filter({ hasText: /ทั้งหมด\s*\d+\s*อัลบัม/ });
  }

  async albumTotalCount(): Promise<number> {
    return Number(/(\d+)/.exec(await this.albumTotal.innerText())?.[1] ?? NaN);
  }
}

export const newKnowledgeListPage = (page: Page) => new ContentListPage(page, '/frontend/knowledge/index');
export const newBestPracticeListPage = (page: Page) => new ContentListPage(page, '/frontend/bestpractice/index');
