import { expect, Locator, Page, Response } from '@playwright/test';
import { PublicPage } from './PublicPage';

/**
 * "/" — หน้าหลัก.
 *
 * The "สำรวจชุมชนนักปฏิบัติ" carousel is Owl Carousel with `loop` on, which
 * renders every real slide plus cloned copies (`.owl-item.cloned`) around it.
 * The clones are NOT duplicate data — always count `:not(.cloned)`. (The QA
 * sheet's "2 communities but 6 cards" observation was exactly this.)
 */
export class HomePage extends PublicPage {
  readonly copsHeading: Locator;
  /** The "n กลุ่มชุมชน CoPs" statistic next to the carousel. */
  readonly copsStat: Locator;
  readonly copsCarousel: Locator;
  readonly copsSlides: Locator;
  readonly copsNext: Locator;
  readonly copsPrev: Locator;
  readonly copsArticlesEmptyState: Locator;
  readonly latestKnowledgeEmptyState: Locator;

  constructor(page: Page) {
    super(page);
    this.copsHeading = page.getByRole('heading', { name: 'สำรวจชุมชนนักปฏิบัติ' });
    this.copsStat = page.locator('.section-cops-hero div.display-6').first();
    this.copsCarousel = page.locator('.explore-carousel');
    this.copsSlides = this.copsCarousel.locator('.owl-item:not(.cloned) a.card-item-type');
    this.copsNext = this.copsCarousel.locator('.owl-next');
    this.copsPrev = this.copsCarousel.locator('.owl-prev');
    // Owl clones the placeholder too (it sits inside another carousel), hence .first().
    this.copsArticlesEmptyState = page.locator('.section-cops').getByText('ยังไม่มีข่าว/บทความจากชุมชนนักปฏิบัติ').first();
    this.latestKnowledgeEmptyState = page.locator('.section-knowledge-latest').getByText('ยังไม่มีคลังความรู้ที่เผยแพร่');
  }

  async open(): Promise<Response | null> {
    const response = await super.open('/');
    // Slides only exist once the Owl script (from cdnjs) has initialised.
    await expect(this.copsCarousel).toHaveClass(/owl-loaded/, { timeout: 10_000 });
    return response;
  }

  async copsSlideTitles(): Promise<string[]> {
    return (await this.copsSlides.locator('.item-title').allInnerTexts()).map((title) => title.trim());
  }

  async copsStatCount(): Promise<number> {
    return Number((await this.copsStat.innerText()).replace(/[^\d]/g, ''));
  }
}
