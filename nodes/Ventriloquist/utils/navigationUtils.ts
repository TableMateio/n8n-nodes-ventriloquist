// import type * as puppeteer from 'puppeteer-core';
import type { Page } from 'puppeteer-core';
import type { Logger as ILogger } from 'n8n-workflow';
// import { reconnectAfterNavigation } from './sessionUtils';

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
 * Wait for a URL change with improved detection of both hard and soft URL changes
 */
export async function waitForUrlChange(
  page: Page,
  currentUrl: string,
  timeout: number,
  logger: ILogger,
): Promise<boolean> {
  try {
    logger.info(`Waiting for URL to change from: ${currentUrl} (timeout: ${timeout}ms)`);

    // Store browser reference for potential reconnection after context destruction
    const browser = page.browser();

    // Add diagnostic logging for session state before URL change
    logger.info(`Session state before URL change - Connection status: ${page.isClosed() ? 'Closed' : 'Open'}`);

    // Add timestamp for timing analysis
    const startTime = Date.now();

    // Track if context was destroyed
    let contextDestroyed = false;

    // Create a polling function to detect URL changes (catches soft changes via History API)
    const pollForUrlChanges = async (pollInterval = 500): Promise<boolean> => {
      const startPollTime = Date.now();
      let currentPolledUrl = currentUrl;

      while (Date.now() - startPollTime < timeout) {
        try {
          // Wait for polling interval
          await new Promise(resolve => setTimeout(resolve, pollInterval));

          // Check current URL
          const newUrl = await page.url();

          // If URL has changed, we're done
          if (newUrl !== currentUrl) {
            logger.info(`URL change detected via polling after ${Date.now() - startPollTime}ms: ${currentUrl} → ${newUrl}`);
            return true;
          }

          // Save for reporting
          currentPolledUrl = newUrl;
        } catch (error) {
          // Check if this is context destruction
          if ((error as Error).message.includes('context was destroyed') ||
              (error as Error).message.includes('Execution context')) {
            contextDestroyed = true;
            logger.info('Context destroyed during URL polling - this indicates navigation');
            return true;
          }

          // For other errors, log and continue polling
          logger.warn(`Error during URL polling: ${(error as Error).message}`);
        }
      }

      // If we get here, polling timed out
      logger.warn(`URL polling timed out after ${timeout}ms, last URL: ${currentPolledUrl}`);
      return false;
    };

    // Use multiple detection strategies in parallel

    // 1. Traditional waitForFunction approach
    const waitFunctionPromise = page.waitForFunction(
      (url) => window.location.href !== url,
      { timeout },
      currentUrl
    ).then(() => true).catch(error => {
      if ((error as Error).message.includes('context was destroyed') ||
          (error as Error).message.includes('Execution context')) {
        contextDestroyed = true;
        logger.info('Context destruction detected during URL change wait - this indicates navigation');
        return true;
      }

      logger.warn(`waitForFunction error: ${(error as Error).message}`);
      return false;
    });

    // 2. Polling approach
    const pollingPromise = pollForUrlChanges();

    // 3. Context destroyed error handler
    const contextPromise = new Promise<boolean>((resolve) => {
      page.once('error', (error) => {
        if (error.message.includes('context was destroyed') ||
            error.message.includes('Execution context')) {
          contextDestroyed = true;
          logger.info('Context destruction event detected - this indicates navigation');
          resolve(true);
        }
      });

      // Ensure promise is resolved if context is never destroyed
      setTimeout(() => resolve(false), timeout);
    });

    // 4. Navigation listener for hard navigations
    const navigationPromise = new Promise<boolean>((resolve) => {
      page.once('navigation', () => {
        logger.info('Navigation event detected');
        resolve(true);
      });

      // Ensure promise is resolved if navigation event never fires
      setTimeout(() => resolve(false), timeout);
    });

    // Race all detection methods
    const urlChanged = await Promise.race([
      waitFunctionPromise,
      pollingPromise,
      contextPromise,
      navigationPromise
    ]);

    // If any method detected a change, consider it successful
    if (urlChanged) {
      const waitDuration = Date.now() - startTime;
      logger.info(`URL change detected after ${waitDuration}ms`);

      // Add stabilization delay after URL change detected
      const stabilizationDelay = 2000;
      logger.info(`Adding stabilization delay after URL change (${stabilizationDelay}ms)`);
      await new Promise(resolve => setTimeout(resolve, stabilizationDelay));

      // Use our centralized session/page reconnection logic to get a valid page
      try {
        // Check if context was destroyed or page needs reconnection
        if (contextDestroyed) {
          logger.info('Context was destroyed during URL change - checking browser state');

          try {
            // Try to get all pages from browser to find the active one
            const pages = await browser.pages();

            if (pages.length > 0) {
              // Use the last page as it's likely the active one
              const newPage = pages[pages.length - 1];

              try {
                const newUrl = await newPage.url();
                logger.info(`Page after navigation: ${newUrl}`);

                // Verify URL has changed
                if (newUrl !== currentUrl) {
                  logger.info(`URL changed confirmed: ${currentUrl} → ${newUrl}`);
                  return true;
                }

                logger.warn(`Page reconnected but URL didn't change: ${newUrl}`);
                return true; // Still return true since context was destroyed, which indicates navigation
              } catch (urlError) {
                logger.warn(`Could not get URL from new page: ${(urlError as Error).message}`);
                return true; // Still return true as context destruction indicates navigation
              }
            } else {
              logger.warn('No pages found in browser after context destruction');
              return true; // Still assume navigation happened since context was destroyed
            }
          } catch (reconnectError) {
            logger.warn(`Failed to reconnect after context destruction: ${(reconnectError as Error).message}`);
            return true; // Still assume navigation happened
          }
        } else {
          // Context wasn't destroyed, verify URL changed
          try {
            const newUrl = await page.url();
            const urlChanged = newUrl !== currentUrl;

            logger.info(`Current page URL: ${newUrl}, URL changed: ${urlChanged}`);
            return urlChanged;
          } catch (urlError) {
            // If we can't get the URL, assume something changed with the page
            logger.warn(`Could not get current URL: ${(urlError as Error).message}`);
            return true;
          }
        }
      } catch (finalError) {
        logger.warn(`Error during final URL verification: ${(finalError as Error).message}`);
        // If context was destroyed, assume navigation was successful
        return contextDestroyed;
      }
    }

    // If we reach here, no URL change was detected
    logger.warn(`No URL change detected after ${timeout}ms`);

    // Check once more to see if the URL has changed despite not detecting it earlier
    try {
      const finalUrl = await page.url();
      const finalChanged = finalUrl !== currentUrl;

      if (finalChanged) {
        logger.info(`URL change found at final check: ${currentUrl} → ${finalUrl}`);
        return true;
      }

      logger.info(`URL still unchanged at final check: ${finalUrl}`);
      return false;
    } catch (finalError) {
      // If we can't get the final URL, check if it's due to context destruction
      if ((finalError as Error).message.includes('context was destroyed') ||
          (finalError as Error).message.includes('Execution context')) {
        logger.info('Context destruction detected at final check - navigation likely successful');
        return true;
      }

      logger.warn(`Error getting final URL: ${(finalError as Error).message}`);
      return false;
    }
  } catch (error) {
    // This handles errors from the primary try block
    logger.warn(`URL change wait failed: ${(error as Error).message}`);

    // Handle context destruction
    if ((error as Error).message.includes('context was destroyed') ||
        (error as Error).message.includes('Execution context')) {
      logger.info('Context was destroyed during URL change wait - this is expected during hard navigations');
      return true; // Context destruction usually indicates navigation
    }

    return false;
  }
}

/**
 * Take a screenshot of the page
 * @param page - Puppeteer Page
 * @param logger - Logger instance
 */
export async function takeScreenshot(page: Page | null, logger: ILogger): Promise<string | null> {
  if (!page) {
    logger.warn('Cannot take screenshot: page is null');
    return null;
  }

  try {
    const screenshot = await page.screenshot({
      encoding: 'base64',
      fullPage: true,
      type: 'jpeg',
      quality: 70
    });
    return `data:image/jpeg;base64,${screenshot}`;
  } catch (error) {
    logger.warn(`Error taking screenshot: ${(error as Error).message}`);
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

/**
 * Format a URL to mask sensitive information (like API tokens)
 */
export function formatUrl(url: string): string {
  if (!url) return '';

  try {
    const urlObj = new URL(url);

    // Mask tokens and API keys in query parameters
    for (const [key, value] of urlObj.searchParams.entries()) {
      if (key.toLowerCase().includes('token') ||
          key.toLowerCase().includes('key') ||
          key.toLowerCase().includes('api') ||
          key.toLowerCase().includes('auth') ||
          key.toLowerCase().includes('secret') ||
          key.toLowerCase().includes('password')) {
        if (value.length > 4) {
          urlObj.searchParams.set(key, `${value.substring(0, 4)}***`);
        }
      }
    }

    return urlObj.toString();
  } catch (error) {
    // If URL parsing fails, do simple regex-based masking
    return url.replace(/([?&](token|key|api|auth|secret|password)=)([^&]+)/gi, '$1***');
  }
}

// Update the clickAndWaitForNavigation function definition to have a clear return type
export interface INavigationWaitResult {
  success: boolean;
  finalUrl?: string;
  finalTitle?: string;
  newPage?: Page;
  contextDestroyed?: boolean;
  error?: string;
}

export async function clickAndWaitForNavigation(
  page: Page,
  selector: string,
  options: {
    timeout?: number;
    waitUntil?: 'load' | 'domcontentloaded' | 'networkidle0' | 'networkidle2';
    stabilizationDelay?: number;
    logger?: ILogger;
  } = {}
): Promise<INavigationWaitResult> {
  const {
    timeout = 30000,
    waitUntil = 'domcontentloaded',
    stabilizationDelay = 2000,
    logger
  } = options;

  // Create a no-op logger if none provided
  const log = logger || {
    debug: () => {},
    info: () => {},
    warn: () => {},
    error: () => {}
  };

  try {
    // Try to find the element to click
    log.info(`Attempting to click ${selector} and wait for navigation`);

    const element = await page.$(selector);
    if (!element) {
      log.warn('Element not found: ' + selector);
      return { success: false, error: 'Element not found: ' + selector };
    }

    // Store initial URL for comparison
    const initialUrl = await page.url();
    log.info('Current URL before navigation: ' + initialUrl);

    // Use Promise.all to wait for navigation while clicking
    log.info('Starting navigation...');

    await Promise.all([
      page.waitForNavigation({ waitUntil, timeout }),
      element.click()
    ]);

    // Add stabilization delay after navigation
    log.info('Adding stabilization delay: ' + stabilizationDelay + 'ms');
    await new Promise(resolve => setTimeout(resolve, stabilizationDelay));

    // Get the final URL and title
    const finalUrl = await page.url();
    const finalTitle = await page.title();

    // Log success
    log.info('Navigation completed successfully after clicking ' + selector);
    return {
      success: true,
      finalUrl,
      finalTitle
    };
  } catch (error) {
    // Handle context destruction - this is normal during navigation
    if ((error as Error).message.includes('context was destroyed') ||
        (error as Error).message.includes('Execution context')) {
      log.info('Navigation context was destroyed, which is normal during page transitions');

      try {
        // Try to get a new page - often the last page in the browser
        const browser = page.browser();
        const pages = await browser.pages();

        if (pages.length > 0) {
          const newPage = pages[pages.length - 1];
          const finalUrl = await newPage.url();
          const finalTitle = await newPage.title();

          log.info('Reconnected to new page after context destruction');

          return {
            success: true,
            finalUrl,
            finalTitle,
            newPage,
            contextDestroyed: true
          };
        }
      } catch (reconnectError) {
        log.warn('Failed to reconnect after context destruction: ' + (reconnectError as Error).message);
      }

      // Add recovery delay
      await new Promise(resolve => setTimeout(resolve, stabilizationDelay * 2));
      return {
        success: true,
        contextDestroyed: true
      };
    }

    log.warn('Navigation error: ' + (error as Error).message);
    return {
      success: false,
      error: (error as Error).message
    };
  }
}

/**
 * Simple function to handle form submission and navigation
 * Uses the press Enter approach with navigation wait
 */
export async function submitFormAndWaitForNavigation(
  page: Page,
  options: {
    timeout?: number;
    waitUntil?: 'load' | 'domcontentloaded' | 'networkidle0' | 'networkidle2';
    stabilizationDelay?: number;
    logger: ILogger;
  }
): Promise<{
  success: boolean;
  newPage?: Page;
}> {
  const {
    timeout = 30000,
    waitUntil = 'networkidle0',
    stabilizationDelay = 2000,
    logger
  } = options;

  try {
    logger.info(`Pressing Enter and waiting for navigation (waitUntil: ${waitUntil}, timeout: ${timeout}ms)`);

    // Use Promise.all to wait for navigation while pressing Enter
    await Promise.all([
      page.waitForNavigation({
        waitUntil: [waitUntil],
        timeout
      }),
      page.keyboard.press('Enter')
    ]);

    // Add stabilization delay
    if (stabilizationDelay > 0) {
      logger.info(`Adding stabilization delay after navigation: ${stabilizationDelay}ms`);
      await new Promise(resolve => setTimeout(resolve, stabilizationDelay));
    }

    // Log success
    logger.info(`Navigation completed successfully after pressing Enter`);
    return { success: true };
  } catch (error) {
    // Handle context destruction - this is normal during navigation
    if ((error as Error).message.includes('context was destroyed') ||
        (error as Error).message.includes('Execution context')) {
      logger.info('Context destroyed during navigation - this is expected behavior');

      // Add recovery delay
      await new Promise(resolve => setTimeout(resolve, stabilizationDelay * 2));

      // Try to get a new page reference
      try {
        const browser = page.browser();
        const pages = await browser.pages();
        if (pages.length > 0) {
          const newPage = pages[pages.length - 1];
          logger.info('Successfully acquired new page reference after context destruction');
          return { success: true, newPage };
        }
      } catch (browserError) {
        logger.warn(`Error getting browser pages: ${(browserError as Error).message}`);
      }

      // Even without a new page reference, navigation likely succeeded
      return { success: true };
    }

    logger.warn(`Navigation error: ${(error as Error).message}`);
    return { success: false };
  }
}
