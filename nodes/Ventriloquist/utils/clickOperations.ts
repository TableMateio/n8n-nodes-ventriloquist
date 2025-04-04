import type { Page } from 'puppeteer-core';
import type { ILogger } from './formOperations';

/**
 * Enhanced click function with multiple fallback methods
 * Combines the best of both existing click implementations
 */
export async function robustClick(
  page: Page,
  selector: string,
  options: {
    retries?: number;
    waitBetweenRetries?: number;
    logger?: ILogger;
  } = {}
): Promise<{ success: boolean; error?: Error }> {
  const {
    retries = 3,
    waitBetweenRetries = 1000,
    logger,
  } = options;

  let attempt = 0;
  let success = false;
  let lastError: Error | undefined;

  const logInfo = (message: string) => {
    if (logger) logger.info(message);
  };

  const logWarn = (message: string) => {
    if (logger) logger.warn(message);
  };

  const logError = (message: string) => {
    if (logger) logger.error(message);
  };

  logInfo(`Starting robust click on selector "${selector}" (max retries: ${retries})`);

  while (!success && attempt <= retries) {
    try {
      // First try to check if the element exists
      const selectorExists = await page.evaluate((sel) => {
        const element = document.querySelector(sel);
        return element !== null;
      }, selector);

      if (!selectorExists) {
        throw new Error(`Element with selector "${selector}" not found on page`);
      }

      // Method 1: Standard click
      logInfo(`Attempt ${attempt + 1}: Standard click on "${selector}"`);
      await page.click(selector);
      logInfo('Standard click was successful');
      success = true;
    } catch (error1) {
      logWarn(`Standard click failed: ${(error1 as Error).message}, trying alternative methods...`);

      try {
        // Method 2: JavaScript click via evaluate
        logInfo(`Attempt ${attempt + 1}: JavaScript click method on "${selector}"`);
        const jsClickSuccess = await page.evaluate((sel) => {
          const element = document.querySelector(sel);
          if (!element) return false;

          // Try different approaches
          try {
            // 1. Use click() method
            (element as HTMLElement).click();
            return true;
          } catch (e) {
            try {
              // 2. Create and dispatch mouse events
              const event = new MouseEvent('click', {
                view: window,
                bubbles: true,
                cancelable: true,
                buttons: 1
              });
              element.dispatchEvent(event);
              return true;
            } catch (e2) {
              return false;
            }
          }
        }, selector);

        if (jsClickSuccess) {
          logInfo('JavaScript click was successful');
          success = true;
        } else {
          // Method 3: Try mousedown + mouseup events sequence
          logInfo(`Attempt ${attempt + 1}: MouseEvent sequence on "${selector}"`);
          const mouseEventsSuccess = await page.evaluate((sel) => {
            const element = document.querySelector(sel);
            if (!element) return false;

            try {
              const events = ['mousedown', 'mouseup', 'click'];
              for (const eventType of events) {
                const event = new MouseEvent(eventType, {
                  view: window,
                  bubbles: true,
                  cancelable: true,
                  buttons: 1
                });
                element.dispatchEvent(event);
              }
              return true;
            } catch (e) {
              return false;
            }
          }, selector);

          if (mouseEventsSuccess) {
            logInfo('MouseEvent sequence was successful');
            success = true;
          } else {
            lastError = new Error('All click methods failed');
            logWarn(`Click attempt ${attempt + 1} failed: All methods failed`);
            attempt++;

            // If there are more retries, wait a bit before retrying
            if (attempt <= retries) {
              logInfo(`Waiting ${waitBetweenRetries}ms before next attempt`);
              await new Promise((resolve) => setTimeout(resolve, waitBetweenRetries));
            }
          }
        }
      } catch (error2) {
        lastError = error2 as Error;
        logError(`Error during alternative click methods: ${(error2 as Error).message}`);
        attempt++;

        // If there are more retries, wait a bit before retrying
        if (attempt <= retries) {
          logInfo(`Waiting ${waitBetweenRetries}ms before next attempt`);
          await new Promise((resolve) => setTimeout(resolve, waitBetweenRetries));
        }
      }
    }
  }

  if (!success) {
    logError(`Failed to click element after ${retries + 1} attempts`);
  }

  return {
    success,
    error: success ? undefined : lastError
  };
}

/**
 * Wait for an element to be ready and then click it
 */
export async function waitAndClick(
  page: Page,
  selector: string,
  options: {
    waitTimeout?: number;
    retries?: number;
    waitBetweenRetries?: number;
    logger?: ILogger;
  } = {}
): Promise<{ success: boolean; error?: Error }> {
  const {
    waitTimeout = 30000,
    retries = 2,
    waitBetweenRetries = 1000,
    logger,
  } = options;

  const logInfo = (message: string) => {
    if (logger) logger.info(message);
  };

  const logWarn = (message: string) => {
    if (logger) logger.warn(message);
  };

  try {
    // Wait for the selector to be ready
    logInfo(`Waiting for selector "${selector}" (timeout: ${waitTimeout}ms)`);
    await page.waitForSelector(selector, { timeout: waitTimeout });

    // Then click it with our robust click
    return await robustClick(page, selector, {
      retries,
      waitBetweenRetries,
      logger,
    });
  } catch (error) {
    logWarn(`Wait for selector "${selector}" failed: ${(error as Error).message}`);
    return {
      success: false,
      error: error as Error
    };
  }
}
