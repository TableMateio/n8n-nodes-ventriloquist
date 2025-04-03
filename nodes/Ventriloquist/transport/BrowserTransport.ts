import * as puppeteer from 'puppeteer-core';

/**
 * Interface for browser transports
 */
export interface BrowserTransport {
  /**
   * Connect to browser service
   */
  connect(): Promise<puppeteer.Browser>;

  /**
   * Navigate to a URL
   * @param page - Puppeteer Page
   * @param url - URL to navigate to
   * @param options - Navigation options
   */
  navigateTo(
    page: puppeteer.Page,
    url: string,
    options: puppeteer.WaitForOptions & {
      waitUntil?: puppeteer.PuppeteerLifeCycleEvent | puppeteer.PuppeteerLifeCycleEvent[];
    },
  ): Promise<{ response: puppeteer.HTTPResponse | null; domain: string }>;

  /**
   * Get information about the page
   * @param page - Puppeteer Page
   * @param response - HTTP Response
   */
  getPageInfo(
    page: puppeteer.Page,
    response: puppeteer.HTTPResponse | null,
  ): Promise<{
    url: string;
    title: string;
    status: number | null;
  }>;

  /**
   * Take a screenshot of the page
   * @param page - Puppeteer Page
   */
  takeScreenshot(page: puppeteer.Page): Promise<string>;
}
