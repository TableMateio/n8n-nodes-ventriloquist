// import type * as puppeteer from 'puppeteer-core';
import type { Page } from 'puppeteer-core';
import type { Logger as ILogger } from 'n8n-workflow';
// import { reconnectAfterNavigation } from './sessionUtils';
import { SessionManager } from './sessionManager';

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
 * Modified to use sessionId instead of page directly
 */
export async function waitForUrlChange(
  sessionId: string,
  currentUrl: string,
  timeout: number,
  logger: ILogger,
): Promise<boolean> {
  const logPrefix = '[NavigationUtils][waitForUrlChange]';
  logger.info(`${logPrefix} Called with sessionId: ${sessionId}, currentUrl: ${currentUrl}, timeout: ${timeout}ms`);

  try {
    logger.info(`${logPrefix} Starting URL change detection from: ${currentUrl}`);

    // Get the current page from SessionManager
    let page = SessionManager.getPage(sessionId);
    if (!page) {
      logger.error(`${logPrefix} No page found for session ${sessionId}`);
      return false;
    }

    // Store browser reference for potential reconnection after context destruction
    const browser = page.browser();
    logger.info(`${logPrefix} Retrieved browser reference for potential reconnection`);

    // Add diagnostic logging for session state before URL change
    logger.info(`${logPrefix} Session state before URL change - Connection status: ${page.isClosed() ? 'Closed' : 'Open'}`);

    // Add timestamp for timing analysis
    const startTime = Date.now();

    // Track if context was destroyed
    let contextDestroyed = false;

    // Create a polling function to detect URL changes (catches soft changes via History API)
    const pollForUrlChanges = async (pollInterval = 500): Promise<boolean> => {
      const startPollTime = Date.now();
      let currentPolledUrl = currentUrl;
      logger.info(`${logPrefix} Starting URL polling with interval: ${pollInterval}ms`);

      while (Date.now() - startPollTime < timeout) {
        try {
          // Get fresh page reference before each check
          page = SessionManager.getPage(sessionId);
          if (!page) {
            logger.warn(`${logPrefix} No page found for session ${sessionId} during URL polling`);
            return false;
          }

          // Wait for polling interval
          await new Promise(resolve => setTimeout(resolve, pollInterval));

          // Check current URL
          const newUrl = await page.url();

          // If URL has changed, we're done
          if (newUrl !== currentUrl) {
            logger.info(`${logPrefix} URL change detected via polling after ${Date.now() - startPollTime}ms: ${currentUrl} → ${newUrl}`);
            return true;
          }

          // Save for reporting
          currentPolledUrl = newUrl;
        } catch (error) {
          // Check if this is context destruction
          if ((error as Error).message.includes('context was destroyed') ||
              (error as Error).message.includes('Execution context')) {
            contextDestroyed = true;
            logger.info(`${logPrefix} Context destroyed during URL polling - this indicates navigation`);
            return true;
          }

          // For other errors, log and continue polling
          logger.warn(`${logPrefix} Error during URL polling: ${(error as Error).message}`);
        }
      }

      // If we get here, polling timed out
      logger.warn(`${logPrefix} URL polling timed out after ${timeout}ms, last URL: ${currentPolledUrl}`);
      return false;
    };

    // Use multiple detection strategies in parallel
    logger.info(`${logPrefix} Setting up multiple URL change detection strategies`);

    // Always get a fresh page reference before setting up detection
    page = SessionManager.getPage(sessionId) || page;

    // 1. Traditional waitForFunction approach
    logger.info(`${logPrefix} Setting up waitForFunction detection`);
    const waitFunctionPromise = page ? page.waitForFunction(
      (url) => window.location.href !== url,
      { timeout },
      currentUrl
    ).then(() => {
      logger.info(`${logPrefix} URL change detected via waitForFunction`);
      return true;
    }).catch(error => {
      if ((error as Error).message.includes('context was destroyed') ||
          (error as Error).message.includes('Execution context')) {
        contextDestroyed = true;
        logger.info(`${logPrefix} Context destruction detected during waitForFunction - this indicates navigation`);
        return true;
      }

      logger.warn(`${logPrefix} waitForFunction error: ${(error as Error).message}`);
      return false;
    }) : Promise.resolve(false);

    // 2. Polling approach
    logger.info(`${logPrefix} Setting up polling detection`);
    const pollingPromise = pollForUrlChanges();

    // 3. Context destroyed error handler
    logger.info(`${logPrefix} Setting up context destruction event listener`);
    const contextPromise = new Promise<boolean>((resolve) => {
      if (page) {
        page.once('error', (error) => {
          if (error.message.includes('context was destroyed') ||
              error.message.includes('Execution context')) {
            contextDestroyed = true;
            logger.info(`${logPrefix} Context destruction event detected - this indicates navigation`);
            resolve(true);
          }
        });
      }

      // Ensure promise is resolved if context is never destroyed
      setTimeout(() => resolve(false), timeout);
    });

    // 4. Navigation listener for hard navigations
    logger.info(`${logPrefix} Setting up navigation event listener`);
    const navigationPromise = new Promise<boolean>((resolve) => {
      if (page) {
        page.once('navigation', () => {
          logger.info(`${logPrefix} Navigation event detected`);
          resolve(true);
        });
      }

      // Ensure promise is resolved if navigation event never fires
      setTimeout(() => resolve(false), timeout);
    });

    // Race all detection methods
    logger.info(`${logPrefix} Starting race between all URL change detection methods`);
    const urlChanged = await Promise.race([
      waitFunctionPromise,
      pollingPromise,
      contextPromise,
      navigationPromise
    ]);

    // If any method detected a change, consider it successful
    if (urlChanged) {
      const waitDuration = Date.now() - startTime;
      logger.info(`${logPrefix} URL change detected after ${waitDuration}ms`);

      // Add stabilization delay after URL change detected
      const stabilizationDelay = 2000;
      logger.info(`${logPrefix} Adding stabilization delay after URL change (${stabilizationDelay}ms)`);
      await new Promise(resolve => setTimeout(resolve, stabilizationDelay));

      // Use our centralized session/page reconnection logic to get a valid page
      try {
        // Get a fresh page reference
        logger.info(`${logPrefix} Getting fresh page reference after URL change`);
        page = SessionManager.getPage(sessionId);

        // Check if context was destroyed or page needs reconnection
        if (contextDestroyed) {
          logger.info(`${logPrefix} Context was destroyed during URL change - checking browser state`);

          try {
            // Try to get all pages from browser to find the active one
            logger.info(`${logPrefix} Getting all pages from browser after context destruction`);
            const pages = await browser.pages();
            logger.info(`${logPrefix} Found ${pages.length} pages in browser after context destruction`);

            if (pages.length > 0) {
              // Use the last page as it's likely the active one
              const newPage = pages[pages.length - 1];
              logger.info(`${logPrefix} Using most recent page (index: ${pages.length - 1})`);

              try {
                const newUrl = await newPage.url();
                logger.info(`${logPrefix} Page after navigation - URL: ${newUrl}`);

                // Important: Store the new page in SessionManager
                const pageId = `page_${Date.now()}`;
                logger.info(`${logPrefix} Storing new page with ID: ${pageId}`);
                SessionManager.storePage(sessionId, pageId, newPage);
                logger.info(`${logPrefix} Updated SessionManager with new page after URL change`);

                // Verify URL has changed
                if (newUrl !== currentUrl) {
                  logger.info(`${logPrefix} URL change confirmed: ${currentUrl} → ${newUrl}`);
                  return true;
                }

                logger.warn(`${logPrefix} Page reconnected but URL didn't change: ${newUrl}`);
                return true; // Still return true since context was destroyed, which indicates navigation
              } catch (urlError) {
                logger.warn(`${logPrefix} Could not get URL from new page: ${(urlError as Error).message}`);
                return true; // Still return true as context destruction indicates navigation
              }
            } else {
              logger.warn(`${logPrefix} No pages found in browser after context destruction`);
              return true; // Still assume navigation happened since context was destroyed
            }
          } catch (reconnectError) {
            logger.warn(`${logPrefix} Failed to reconnect after context destruction: ${(reconnectError as Error).message}`);
            return true; // Still assume navigation happened
          }
        } else {
          // Context wasn't destroyed, verify URL changed
          try {
            // Get fresh page reference
            logger.info(`${logPrefix} Getting fresh page reference for final URL check`);
            page = SessionManager.getPage(sessionId);
            if (!page) {
              logger.warn(`${logPrefix} No page found for session ${sessionId} after URL change check`);
              return false;
            }

            const newUrl = await page.url();
            const urlChanged = newUrl !== currentUrl;

            logger.info(`${logPrefix} Current page URL: ${newUrl}, URL changed: ${urlChanged}`);
            return urlChanged;
          } catch (urlError) {
            // If we can't get the URL, assume something changed with the page
            logger.warn(`${logPrefix} Could not get current URL: ${(urlError as Error).message}`);
            return true;
          }
        }
      } catch (finalError) {
        logger.warn(`${logPrefix} Error during final URL verification: ${(finalError as Error).message}`);
        // If context was destroyed, assume navigation was successful
        return contextDestroyed;
      }
    }

    // If we reach here, no URL change was detected
    logger.warn(`${logPrefix} No URL change detected after ${timeout}ms`);

    // Check once more to see if the URL has changed despite not detecting it earlier
    try {
      // Get fresh page reference for final check
      logger.info(`${logPrefix} Performing final URL check`);
      page = SessionManager.getPage(sessionId);
      if (!page) {
        logger.warn(`${logPrefix} No page found for session ${sessionId} at final URL check`);
        return false;
      }

      const finalUrl = await page.url();
      const finalChanged = finalUrl !== currentUrl;

      if (finalChanged) {
        logger.info(`${logPrefix} URL change found at final check: ${currentUrl} → ${finalUrl}`);
        return true;
      }

      logger.info(`${logPrefix} URL still unchanged at final check: ${finalUrl}`);
      return false;
    } catch (finalError) {
      // If we can't get the final URL, check if it's due to context destruction
      if ((finalError as Error).message.includes('context was destroyed') ||
          (finalError as Error).message.includes('Execution context')) {
        logger.info(`${logPrefix} Context destruction detected at final check - navigation likely successful`);
        return true;
      }

      logger.warn(`${logPrefix} Error getting final URL: ${(finalError as Error).message}`);
      return false;
    }
  } catch (error) {
    // This handles errors from the primary try block
    logger.warn(`${logPrefix} URL change wait failed: ${(error as Error).message}`);

    // Handle context destruction
    if ((error as Error).message.includes('context was destroyed') ||
        (error as Error).message.includes('Execution context')) {
      logger.info(`${logPrefix} Context was destroyed during URL change wait - this is expected during hard navigations`);
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

// Update the interface to include urlChanged property
export interface INavigationWaitResult {
  success: boolean;
  finalUrl?: string;
  finalTitle?: string;
  newPage?: Page;
  contextDestroyed?: boolean;
  urlChanged?: boolean;
  error?: string;
}

/**
 * Improved function to click an element and wait for navigation
 * Modified to use sessionId instead of direct page references
 */
export async function clickAndWaitForNavigation(
  sessionId: string,
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
    waitUntil = 'networkidle0',
    stabilizationDelay = 2000,
    logger
  } = options;

  const log = logger || { debug: () => {}, info: () => {}, warn: () => {}, error: () => {} };
  const logPrefix = '[NavigationUtils][clickAndWaitForNavigation]';
  log.info(`${logPrefix} Called with selector: "${selector}", sessionId: ${sessionId}`);

  // Declare page and initialUrl here, but assign inside the try block
  let page: Page | undefined;
  let initialUrl = '';

  // Outer try for general errors and specific handling below
  try {
    page = SessionManager.getPage(sessionId);
    if (!page) {
      log.warn(`${logPrefix} No page found for session ${sessionId}`);
      return { success: false, error: `No page found for session ${sessionId}` };
    }

    const element = await page.$(selector);
    if (!element) {
      log.warn(`${logPrefix} Element not found: "${selector}"`);
      return { success: false, error: `Element not found: ${selector}` };
    }

    initialUrl = await page.url(); // Assign initialUrl here
    log.info(`${logPrefix} Current URL before navigation: ${initialUrl}`);

    // Get browser for disconnection listener
    const session = SessionManager.getSession(sessionId);
    const browser = session?.browser;

    // Add disconnection listeners
    if (page) {
      page.once('close', () => {
        log.warn(`${logPrefix} >>>>> PAGE CLOSED EVENT RECEIVED <<<<<`);
      });
      page.once('error', (err) => {
        log.warn(`${logPrefix} >>>>> PAGE ERROR EVENT RECEIVED: ${err.message} <<<<<`);
      });
    }
    if (browser) {
      browser.once('disconnected', () => {
        log.warn(`${logPrefix} >>>>> BROWSER DISCONNECTED EVENT RECEIVED <<<<<`);
      });
    }

    // Inner try-catch specifically for the Promise.all block
    try {
      log.info(`${logPrefix} Step 1: Setting up navigation wait (waitUntil: ${waitUntil}, timeout: ${timeout}ms)`);
      const navigationPromise = page.waitForNavigation({ waitUntil, timeout });

      log.info(`${logPrefix} Step 2: Performing click action on "${selector}"`);
      const clickPromise = element.click();

      log.info(`${logPrefix} Step 3: Executing click and waiting for navigation simultaneously`);
      await Promise.all([navigationPromise, clickPromise]);
      log.info(`${logPrefix} Click and navigation wait completed successfully`);

    } catch (promiseAllError) {
      // Log ANY error from Promise.all before specific checks
      log.warn(`${logPrefix} >>>>> ERROR CAUGHT FROM PROMISE.ALL BLOCK <<<<<`);
      log.warn(`${logPrefix} Promise.all error type: ${typeof promiseAllError}, message: ${(promiseAllError as Error)?.message}`);
      log.warn(`${logPrefix} Raw Promise.all error object: ${JSON.stringify(promiseAllError)}`);
      // Rethrow the error to be handled by the outer catch block's logic
      throw promiseAllError;
    }

    // 4. Add stabilization delay after navigation
    log.info(`${logPrefix} Step 4: Adding stabilization delay: ${stabilizationDelay}ms`);
    await new Promise(resolve => setTimeout(resolve, stabilizationDelay));
    log.info(`${logPrefix} Stabilization delay completed`);

    // 5. Get the final URL and title - Using the same page reference since navigation was successful
    log.info(`${logPrefix} Step 5: Getting final URL and title`);
    const finalUrl = await page.url(); // Re-get page just in case, though likely unnecessary if no error occurred
    const finalTitle = await page.title();
    log.info(`${logPrefix} Final URL: ${finalUrl}, Title: ${finalTitle}`);

    // 6. Log success
    log.info(`${logPrefix} Navigation completed successfully after clicking "${selector}"`);
    return {
      success: true,
      finalUrl,
      finalTitle,
      urlChanged: finalUrl !== initialUrl
    };

  } catch (navigationError) { // Outer catch block to handle specific errors
    // Log the error caught (either from Promise.all or elsewhere)
    log.warn(`${logPrefix} Navigation error type: ${typeof navigationError}, message: ${(navigationError as Error).message}`);
    log.warn(`${logPrefix} Raw navigationError object (in outer catch): ${JSON.stringify(navigationError)}`);

    // Handle context destruction - this is normal during navigation
    if ((navigationError as Error).message.includes('context was destroyed') ||
        (navigationError as Error).message.includes('Execution context') ||
        (navigationError as Error).message.includes('Target closed')) {
      log.info(`${logPrefix} Context destruction detected during navigation - this is normal during page transitions`);
      log.info(`${logPrefix} >>>>> ENTERING RECONNECTION BLOCK`);

      try {
        // Get a fresh browser reference to find the active page
        log.info(`${logPrefix} Attempting to reconnect after context destruction`);
        log.info(`${logPrefix} >>>>> RECONNECT: Getting session...`);
        const session = SessionManager.getSession(sessionId);
        if (!session || !session.browser) {
          log.warn(`${logPrefix} Could not find browser for session ${sessionId}`);
          log.warn(`${logPrefix} >>>>> RECONNECT: Failed - No session or browser found`);
          return {
            success: true, // Treat as success because navigation likely happened
            contextDestroyed: true,
            error: 'Context destroyed but could not reconnect to browser',
            urlChanged: true // Assume URL changed
          };
        }

        const browser = session.browser;
        log.info(`${logPrefix} Successfully retrieved browser from session`);
        log.info(`${logPrefix} >>>>> RECONNECT: Got browser, getting pages...`);

        // Get all pages and use the most recently active one
        log.info(`${logPrefix} Getting all browser pages`);
        const pages = await browser.pages();
        log.info(`${logPrefix} Found ${pages.length} pages in browser`);
        log.info(`${logPrefix} >>>>> RECONNECT: Got ${pages.length} pages`);

        if (pages.length === 0) {
          log.warn(`${logPrefix} No pages found in browser after context destruction`);
          log.warn(`${logPrefix} >>>>> RECONNECT: Failed - No pages found`);
          return {
            success: true, // Treat as success
            contextDestroyed: true,
            error: 'Context destroyed but no pages found',
            urlChanged: true // Assume URL changed
          };
        }

        // Use the last page (most likely the active one)
        const newPage = pages[pages.length - 1];
        log.info(`${logPrefix} Using most recent page (index: ${pages.length - 1})`);
        log.info(`${logPrefix} >>>>> RECONNECT: Using page index ${pages.length - 1}`);

        // Store the new page in SessionManager
        const pageId = `page_${Date.now()}`;
        log.info(`${logPrefix} Storing new page with ID: ${pageId}`);
        log.info(`${logPrefix} >>>>> RECONNECT: Storing page ${pageId}...`);
        SessionManager.storePage(sessionId, pageId, newPage);
        log.info(`${logPrefix} Successfully updated session with new page after context destruction`);
        log.info(`${logPrefix} >>>>> RECONNECT: Page stored`);

        // Get URL and title from the new page
        log.info(`${logPrefix} Getting URL and title from reconnected page`);
        log.info(`${logPrefix} >>>>> RECONNECT: Getting new page URL...`);
        const finalUrl = await newPage.url();
        log.info(`${logPrefix} >>>>> RECONNECT: Getting new page title...`);
        const finalTitle = await newPage.title();
        log.info(`${logPrefix} Reconnected page URL: ${finalUrl}, Title: ${finalTitle}`);
        log.info(`${logPrefix} >>>>> RECONNECT: Got new page details`);

        log.info(`${logPrefix} Successfully reconnected after context destruction`);
        log.info(`${logPrefix} >>>>> EXITING RECONNECTION BLOCK (Success)`);
        return {
          success: true,
          finalUrl,
          finalTitle,
          contextDestroyed: true,
          newPage,
          urlChanged: true
        };
      } catch (reconnectError) {
        log.warn(`${logPrefix} Failed to reconnect after context destruction: ${(reconnectError as Error).message}`);
        log.warn(`${logPrefix} >>>>> RECONNECT: Error during reconnection: ${JSON.stringify(reconnectError)}`);

        // Still consider it successful since context destruction usually means navigation happened
        log.info(`${logPrefix} >>>>> EXITING RECONNECTION BLOCK (Failure, but assuming success)`);
        return {
          success: true, // Treat as success
          contextDestroyed: true,
          error: `Failed to reconnect: ${(reconnectError as Error).message}`,
          urlChanged: true
        };
      }
    }

    // Handle navigation timeout
    if ((navigationError as Error).message.includes('timeout')) {
      log.warn(`${logPrefix} Navigation timed out after ${timeout}ms - checking if URL changed anyway`);

      try {
        // Even with a timeout, the page might have navigated
        log.info(`${logPrefix} Checking if URL changed despite timeout`);
        // Get the current page reference again - might be null if outer try failed early
        // Also check if page object is defined before accessing url()
        const currentPage = page; // Use page declared in outer scope
        if (!currentPage) {
            log.warn(`${logPrefix} No page object available after timeout check`);
            // Can't check URL if page object is gone
            return { success: false, error: 'Navigation timed out and page object became unavailable', urlChanged: false };
        }
        const currentUrl = await currentPage.url();
        log.info(`${logPrefix} Current URL after timeout: ${currentUrl}, Initial URL: ${initialUrl}`); // initialUrl is accessible here

        if (currentUrl !== initialUrl) {
          log.info(`${logPrefix} URL changed despite timeout: ${initialUrl} -> ${currentUrl}`);
          return {
            success: true,
            finalUrl: currentUrl,
            urlChanged: true
          };
        }

        log.warn(`${logPrefix} Navigation timed out and URL did not change`);
        return {
          success: false,
          error: 'Navigation timed out',
          urlChanged: false
        };
      } catch (urlCheckError) {
        log.warn(`${logPrefix} Error checking URL after timeout: ${(urlCheckError as Error).message}`);

        // Check if context was destroyed during the URL check
        if ((urlCheckError as Error).message.includes('context was destroyed') ||
            (urlCheckError as Error).message.includes('Target closed')) {
          log.info(`${logPrefix} Context destroyed while checking URL after timeout - assuming navigation occurred`);
          // Similar reconnection logic as above could be added here if needed, but for now, assume success
          return {
            success: true, // Treat as success
            contextDestroyed: true,
            urlChanged: true, // Assume URL changed
            error: 'Context destroyed checking URL after timeout'
          };
        }

        log.error(`${logPrefix} Error checking URL after timeout: ${(urlCheckError as Error).message}`);
        return {
          success: false,
          error: `Navigation timed out and error checking URL: ${(urlCheckError as Error).message}`,
          urlChanged: false
        };
      }
    }

    // Other navigation errors (neither context destruction nor timeout)
    log.warn(`${logPrefix} Unhandled navigation error in outer catch: ${(navigationError as Error).message}`);
    return {
      success: false,
      error: (navigationError as Error).message,
      urlChanged: false // Assume no change if error is unknown
    };
  }
}

/**
 * Simple function to handle form submission and navigation
 * Uses the press Enter approach with navigation wait
 * Modified to use sessionId instead of direct page references
 */
export async function submitFormAndWaitForNavigation(
  sessionId: string,
  options: {
    timeout?: number;
    waitUntil?: 'load' | 'domcontentloaded' | 'networkidle0' | 'networkidle2';
    stabilizationDelay?: number;
    logger: ILogger;
  }
): Promise<{
  success: boolean;
  newPage?: Page;
  contextDestroyed?: boolean;
  urlChanged?: boolean;
  error?: string;
  finalUrl?: string;
  finalTitle?: string;
}> {
  const {
    timeout = 30000,
    waitUntil = 'networkidle0',
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

  const logPrefix = '[NavigationUtils][submitFormAndWaitForNavigation]';
  log.info(`${logPrefix} Called with sessionId: ${sessionId}`);

  try {
    // Get the current page from SessionManager
    const page = SessionManager.getPage(sessionId);
    if (!page) {
      log.error(`${logPrefix} No page found for session ${sessionId}`);
      return { success: false, error: `No page found for session ${sessionId}` };
    }

    // Store initial URL for comparison
    const initialUrl = await page.url();
    log.info(`${logPrefix} Current URL before form submission: ${initialUrl}`);

    log.info(`${logPrefix} Preparing to press Enter and wait for navigation (waitUntil: ${waitUntil}, timeout: ${timeout}ms)`);

    // SIMPLIFIED APPROACH: Separate keyboard press and navigation
    try {
      // 1. First, perform the keyboard press independently
      log.info(`${logPrefix} Step 1: Pressing Enter to submit form...`);
      await page.keyboard.press('Enter');
      log.info(`${logPrefix} Enter key pressed successfully`);

      // 2. Separately wait for navigation to complete
      log.info(`${logPrefix} Step 2: Waiting for navigation after form submission (timeout: ${timeout}ms)...`);
      await page.waitForNavigation({
        waitUntil: [waitUntil],
        timeout
      });
      log.info(`${logPrefix} Navigation wait completed successfully`);

      // 3. Add stabilization delay
      if (stabilizationDelay > 0) {
        log.info(`${logPrefix} Step 3: Adding stabilization delay: ${stabilizationDelay}ms`);
        await new Promise(resolve => setTimeout(resolve, stabilizationDelay));
        log.info(`${logPrefix} Stabilization delay completed`);
      }

      // 4. Get final URL to check if it changed
      log.info(`${logPrefix} Step 4: Getting final URL and title`);
      const finalUrl = await page.url();
      const urlChanged = finalUrl !== initialUrl;
      const finalTitle = await page.title();
      log.info(`${logPrefix} Final URL: ${finalUrl}, Title: ${finalTitle}, URL changed: ${urlChanged}`);

      // 5. Log success
      log.info(`${logPrefix} Navigation completed successfully after pressing Enter`);
      return {
        success: true,
        urlChanged,
        finalUrl,
        finalTitle
      };
    } catch (navigationError) {
      log.warn(`${logPrefix} Navigation error: ${(navigationError as Error).message}`);

      // Handle context destruction - this is normal during navigation
      if ((navigationError as Error).message.includes('context was destroyed') ||
          (navigationError as Error).message.includes('Execution context') ||
          (navigationError as Error).message.includes('Target closed')) {
        log.info(`${logPrefix} Context destruction detected during navigation - this is expected behavior`);

        try {
          // Get the session and browser reference
          log.info(`${logPrefix} Attempting to reconnect after context destruction`);
          const session = SessionManager.getSession(sessionId);
          if (!session || !session.browser) {
            log.warn(`${logPrefix} Session ${sessionId} no longer exists or has no browser`);
            return {
              success: true,
              contextDestroyed: true,
              urlChanged: true  // Assume URL changed even without session
            };
          }

          const browser = session.browser;
          log.info(`${logPrefix} Successfully retrieved browser from session`);

          log.info(`${logPrefix} Getting all browser pages`);
          const pages = await browser.pages();
          log.info(`${logPrefix} Found ${pages.length} pages in browser`);

          if (pages.length > 0) {
            // Use the most recently active page (usually the last one)
            const newPage = pages[pages.length - 1];
            log.info(`${logPrefix} Using most recent page (index: ${pages.length - 1})`);

            // Store the new page in SessionManager
            const pageId = `page_${Date.now()}`;
            log.info(`${logPrefix} Storing new page with ID: ${pageId}`);
            SessionManager.storePage(sessionId, pageId, newPage);
            log.info(`${logPrefix} Successfully updated session with new page after context destruction`);

            // Get the new URL to confirm it changed
            log.info(`${logPrefix} Getting URL from reconnected page`);
            const newUrl = await newPage.url();
            const urlChanged = newUrl !== initialUrl;
            log.info(`${logPrefix} Reconnected page URL: ${newUrl}, URL changed: ${urlChanged}`);

            return {
              success: true,
              newPage,
              contextDestroyed: true,
              urlChanged,
              finalUrl: newUrl
            };
          }

          // No pages found, but still consider it successful since context was destroyed
          log.warn(`${logPrefix} No pages found after context destruction, but navigation likely succeeded`);
          return {
            success: true,
            contextDestroyed: true,
            urlChanged: true  // Assume URL changed
          };
        } catch (browserError) {
          log.warn(`${logPrefix} Error getting browser pages: ${(browserError as Error).message}`);

          // Even without a new page reference, navigation likely succeeded
          return {
            success: true,
            contextDestroyed: true,
            error: `Failed to reconnect: ${(browserError as Error).message}`,
            urlChanged: true  // Assume URL changed
          };
        }
      }

      // Handle navigation timeout
      if ((navigationError as Error).message.includes('timeout')) {
        log.warn(`${logPrefix} Navigation timed out after ${timeout}ms - checking if URL changed anyway`);

        try {
          // Check if the page URL changed despite the timeout
          log.info(`${logPrefix} Checking if URL changed despite timeout`);
          const currentPage = SessionManager.getPage(sessionId);
          if (!currentPage) {
            log.warn(`${logPrefix} Could not get page after timeout - session may be invalid`);
            return {
              success: false,
              error: 'Navigation timed out and session is invalid',
              urlChanged: false
            };
          }

          const currentUrl = await currentPage.url();
          const urlChanged = currentUrl !== initialUrl;
          log.info(`${logPrefix} Current URL after timeout: ${currentUrl}, Initial URL: ${initialUrl}, URL changed: ${urlChanged}`);

          if (urlChanged) {
            log.info(`${logPrefix} URL changed despite timeout: ${initialUrl} -> ${currentUrl}`);
            return {
              success: true,
              urlChanged: true,
              finalUrl: currentUrl
            };
          }

          log.warn(`${logPrefix} Navigation timed out and URL did not change`);
          return {
            success: false,
            urlChanged: false,
            error: 'Navigation timed out and URL did not change'
          };
        } catch (urlError) {
          log.warn(`${logPrefix} Error checking URL after timeout: ${(urlError as Error).message}`);

          // If the error is context destroyed, handle it specially
          if ((urlError as Error).message.includes('context was destroyed') ||
              (urlError as Error).message.includes('Target closed')) {
            log.info(`${logPrefix} Context destruction detected when checking URL - attempting reconnection`);

            try {
              // Try to reconnect using the same approach as above
              log.info(`${logPrefix} Attempting reconnection after context destruction during timeout check`);
              const session = SessionManager.getSession(sessionId);
              if (!session || !session.browser) {
                log.warn(`${logPrefix} No session or browser available for reconnection`);
                return {
                  success: true,
                  contextDestroyed: true,
                  urlChanged: true,
                  error: 'Context destroyed but session unavailable'
                };
              }

              const browser = session.browser;
              log.info(`${logPrefix} Getting pages from browser after context destruction`);
              const pages = await browser.pages();
              log.info(`${logPrefix} Found ${pages.length} pages after context destruction`);

              if (pages.length > 0) {
                const newPage = pages[pages.length - 1];
                log.info(`${logPrefix} Using most recent page (index: ${pages.length - 1})`);

                const pageId = `page_${Date.now()}`;
                log.info(`${logPrefix} Storing new page with ID: ${pageId}`);
                SessionManager.storePage(sessionId, pageId, newPage);

                const finalUrl = await newPage.url();
                log.info(`${logPrefix} Reconnected page URL: ${finalUrl}`);

                return {
                  success: true,
                  contextDestroyed: true,
                  urlChanged: true,
                  newPage,
                  finalUrl
                };
              }

              log.warn(`${logPrefix} No pages found during reconnection attempt`);
              return {
                success: true,
                contextDestroyed: true,
                urlChanged: true,
                error: 'Context destroyed but no pages found'
              };
            } catch (reconnectError) {
              log.warn(`${logPrefix} Failed to reconnect: ${(reconnectError as Error).message}`);
              return {
                success: true,
                contextDestroyed: true,
                urlChanged: true,
                error: `Reconnection error: ${(reconnectError as Error).message}`
              };
            }
          }

          log.error(`${logPrefix} Error checking URL after timeout: ${(urlError as Error).message}`);
          return {
            success: false,
            error: `Navigation timed out and error checking URL: ${(urlError as Error).message}`,
            urlChanged: false
          };
        }
      }

      log.error(`${logPrefix} Unhandled navigation error: ${(navigationError as Error).message}`);
      return {
        success: false,
        error: (navigationError as Error).message,
        urlChanged: false
      };
    }
  } catch (error) {
    log.error(`${logPrefix} Outer form submission error: ${(error as Error).message}`);
    return {
      success: false,
      error: (error as Error).message,
      urlChanged: false
    };
  }
}
