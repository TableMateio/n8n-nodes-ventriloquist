import type { Page } from 'puppeteer-core';
import type { ILogger } from './formOperations';

/**
 * Wait for an element to be visible/active on page with smart detection
 * This is more reliable than the standard waitForSelector when elements might
 * be in the DOM but not yet visible/interactive
 */
export async function smartWaitForSelector(
  page: Page,
  selector: string,
  timeout: number,
  logger: ILogger,
  earlyExitDelay = 500,
): Promise<boolean> {
  const startTime = Date.now();
  logger.info(`Smart waiting for selector: ${selector} (timeout: ${timeout}ms)`);

  // Check if already present immediately
  const elementExistsNow = await page.$(selector) !== null;
  if (elementExistsNow) {
    // Quick validate if it's also visible
    const isVisible = await page.evaluate((sel) => {
      const element = document.querySelector(sel);
      if (!element) return false;

      const style = window.getComputedStyle(element);
      const rect = element.getBoundingClientRect();
      return (
        style.display !== 'none' &&
        style.visibility !== 'hidden' &&
        style.opacity !== '0' &&
        rect.width > 0 &&
        rect.height > 0
      );
    }, selector);

    if (isVisible) {
      logger.info(`Element found immediately: ${selector}`);
      return true;
    }
  }

  try {
    // Wait for the element to be present in DOM first
    await page.waitForSelector(selector, { timeout });
    logger.info(`Element exists in DOM: ${selector}`);

    // Then check if it's visible
    const isVisibleAfterWait = await page.evaluate((sel) => {
      const element = document.querySelector(sel);
      if (!element) return false;

      const style = window.getComputedStyle(element);
      const rect = element.getBoundingClientRect();
      return (
        style.display !== 'none' &&
        style.visibility !== 'hidden' &&
        style.opacity !== '0' &&
        rect.width > 0 &&
        rect.height > 0
      );
    }, selector);

    if (isVisibleAfterWait) {
      logger.info(`Element is visible: ${selector}`);
      return true;
    }

    logger.warn(`Element exists but is not visible: ${selector}`);

    // Add a small delay to see if it becomes visible
    if (earlyExitDelay > 0) {
      logger.info(`Waiting ${earlyExitDelay}ms to see if element becomes visible`);
      await new Promise(resolve => setTimeout(resolve, earlyExitDelay));

      // Check visibility one last time
      const becameVisible = await page.evaluate((sel) => {
        const element = document.querySelector(sel);
        if (!element) return false;

        const style = window.getComputedStyle(element);
        const rect = element.getBoundingClientRect();
        return (
          style.display !== 'none' &&
          style.visibility !== 'hidden' &&
          style.opacity !== '0' &&
          rect.width > 0 &&
          rect.height > 0
        );
      }, selector);

      if (becameVisible) {
        logger.info(`Element became visible after delay: ${selector}`);
        return true;
      }
    }

    logger.warn(`Element exists but never became visible: ${selector}`);
    return false;
  } catch (error) {
    const timeElapsed = Date.now() - startTime;
    logger.warn(`Smart wait failed after ${timeElapsed}ms: ${(error as Error).message}`);
    return false;
  }
}

/**
 * Wait for navigation with advanced options and fallback mechanism
 */
export async function enhancedNavigationWait(
  page: Page,
  waitUntil: 'load' | 'domcontentloaded' | 'networkidle0' | 'networkidle2',
  timeout: number,
  logger: ILogger,
  logPrefix = '',
): Promise<boolean> {
  try {
    logger.info(`${logPrefix}Waiting for navigation event: ${waitUntil} (timeout: ${timeout}ms)`);

    await page.waitForNavigation({
      waitUntil: [waitUntil],
      timeout,
    });

    logger.info(`${logPrefix}Navigation completed successfully: ${waitUntil}`);
    return true;
  } catch (error) {
    logger.warn(`${logPrefix}Navigation wait failed: ${(error as Error).message}`);

    // Fallback: Try to detect if the page changed anyway
    try {
      // Check document readiness
      const documentState = await page.evaluate(() => ({
        readyState: document.readyState,
        url: window.location.href,
        title: document.title,
      }));

      logger.info(`${logPrefix}Document state after failed navigation wait: ${JSON.stringify(documentState)}`);

      // If readyState is at least interactive, we consider it a partial success
      if (documentState.readyState === 'interactive' || documentState.readyState === 'complete') {
        logger.info(`${logPrefix}Navigation may have completed despite timeout (readyState: ${documentState.readyState})`);
        return true;
      }

      return false;
    } catch (fallbackError) {
      logger.error(`${logPrefix}Fallback check also failed: ${(fallbackError as Error).message}`);
      return false;
    }
  }
}

/**
 * Navigate to a URL with retry mechanism
 */
export async function navigateWithRetry(
  page: Page,
  url: string,
  options: {
    waitUntil?: 'load' | 'domcontentloaded' | 'networkidle0' | 'networkidle2';
    timeout?: number;
    maxRetries?: number;
    retryDelay?: number;
  },
  logger: ILogger,
): Promise<boolean> {
  const waitUntil = options.waitUntil || 'domcontentloaded';
  const timeout = options.timeout || 30000;
  const maxRetries = options.maxRetries || 2;
  const retryDelay = options.retryDelay || 1000;

  let retryCount = 0;
  let success = false;

  while (retryCount <= maxRetries && !success) {
    try {
      if (retryCount > 0) {
        logger.info(`Retry ${retryCount}/${maxRetries} navigating to: ${url}`);
        await new Promise(resolve => setTimeout(resolve, retryDelay));
      } else {
        logger.info(`Navigating to: ${url} (waitUntil: ${waitUntil}, timeout: ${timeout}ms)`);
      }

      await page.goto(url, {
        waitUntil: [waitUntil],
        timeout,
      });

      success = true;
      logger.info(`Successfully navigated to: ${url}`);
    } catch (error) {
      retryCount++;

      if (retryCount <= maxRetries) {
        logger.warn(`Navigation failed: ${(error as Error).message} - will retry`);
      } else {
        logger.error(`Navigation failed after ${maxRetries} retries: ${(error as Error).message}`);
      }
    }
  }

  return success;
}

/**
 * Check if an element exists in the page
 */
export async function elementExists(page: Page, selector: string): Promise<boolean> {
  return await page.$(selector) !== null;
}

/**
 * Check if an element is visible on the page
 */
export async function isElementVisible(page: Page, selector: string): Promise<boolean> {
  const element = await page.$(selector);

  if (!element) {
    return false;
  }

  return page.evaluate((sel) => {
    const el = document.querySelector(sel);
    if (!el) return false;

    const style = window.getComputedStyle(el);
    const rect = el.getBoundingClientRect();

    return (
      style.display !== 'none' &&
      style.visibility !== 'hidden' &&
      style.opacity !== '0' &&
      rect.width > 0 &&
      rect.height > 0
    );
  }, selector);
}

/**
 * Wait for a URL change
 */
export async function waitForUrlChange(
  page: Page,
  currentUrl: string,
  timeout: number,
  logger: ILogger,
): Promise<boolean> {
  try {
    logger.info(`Waiting for URL to change from: ${currentUrl} (timeout: ${timeout}ms)`);

    await page.waitForFunction(
      (url) => window.location.href !== url,
      { timeout },
      currentUrl
    );

    const newUrl = await page.url();
    logger.info(`URL changed: ${currentUrl} → ${newUrl}`);
    return true;
  } catch (error) {
    logger.warn(`URL change wait failed: ${(error as Error).message}`);
    return false;
  }
}

/**
 * Take a screenshot with proper error handling
 */
export async function takeScreenshot(
  page: Page,
  logger: ILogger,
): Promise<string | null> {
  try {
    logger.info('Taking screenshot');
    const screenshot = await page.screenshot({ encoding: 'base64' });
    return screenshot;
  } catch (error) {
    logger.error(`Failed to take screenshot: ${(error as Error).message}`);
    return null;
  }
}

/**
 * Get page details (title, URL, etc.)
 */
export async function getPageDetails(page: Page): Promise<{
  url: string;
  title: string;
  readyState: string;
  bodyText: string;
}> {
  return page.evaluate(() => ({
    url: window.location.href,
    title: document.title,
    readyState: document.readyState,
    bodyText: document.body?.innerText.slice(0, 500) || '',
  }));
}
