import type { Page } from 'puppeteer-core';
import type { ILogger } from './formOperations';

/**
 * Enhanced click function with multiple fallback methods
 * Uses direct DOM manipulation first, then falls back to other methods
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
      // First try direct DOM manipulation (similar to how checkbox handling works)
      logInfo(`Attempt ${attempt + 1}: Using direct DOM manipulation on "${selector}"`);

      // Add small delay before click operations (helps with timing issues)
      await new Promise(resolve => setTimeout(resolve, 100));

      // Pre-click: scroll element into view and validate visibility
      const preClickCheck = await page.evaluate((sel) => {
        const element = document.querySelector(sel);
        if (!element) return { found: false, error: 'Element not found in DOM' };

        // Scroll into view first
        element.scrollIntoView({ block: 'center', behavior: 'instant' });

        // Check bounding box — zero dimensions means not visible
        const rect = element.getBoundingClientRect();
        if (rect.width === 0 && rect.height === 0) {
          return { found: true, visible: false, error: 'Element has zero dimensions (not visible)' };
        }

        // Check if element is in viewport after scroll
        const inViewport = rect.top >= 0 && rect.top < window.innerHeight;
        if (!inViewport) {
          return { found: true, visible: false, error: `Element outside viewport (top: ${rect.top}, viewport: ${window.innerHeight})` };
        }

        // Check computed visibility
        const style = window.getComputedStyle(element);
        if (style.display === 'none' || style.visibility === 'hidden' || style.opacity === '0') {
          return { found: true, visible: false, error: `Element hidden via CSS (display: ${style.display}, visibility: ${style.visibility}, opacity: ${style.opacity})` };
        }

        // Check for overlay — get element at the click point and see if it's our element or an ancestor
        const centerX = rect.left + rect.width / 2;
        const centerY = rect.top + rect.height / 2;
        const topElement = document.elementFromPoint(centerX, centerY);
        if (topElement && topElement !== element && !element.contains(topElement) && !topElement.closest(sel)) {
          const overlayTag = topElement.tagName.toLowerCase();
          const overlayClass = topElement.className ? `.${String(topElement.className).split(' ')[0]}` : '';
          return {
            found: true,
            visible: true,
            blocked: true,
            error: `Element blocked by overlay (${overlayTag}${overlayClass} at ${Math.round(centerX)},${Math.round(centerY)})`
          };
        }

        return { found: true, visible: true, blocked: false };
      }, selector);

      if (!preClickCheck?.found) {
        logWarn(`Pre-click check: element not found — ${preClickCheck?.error}`);
        throw new Error(preClickCheck?.error || 'Element not found');
      }

      if (preClickCheck && !preClickCheck.visible) {
        logWarn(`Pre-click check: element not visible — ${preClickCheck.error}`);
        // Still attempt click after scrollIntoView, but log the warning
      }

      if (preClickCheck?.blocked) {
        logWarn(`Pre-click check: element blocked — ${preClickCheck.error}`);
        // Still attempt click, but log the overlay info for diagnostics
      }

      // Small pause after scroll to let layout settle
      await new Promise(resolve => setTimeout(resolve, 150));

      const directSuccess = await page.evaluate((sel) => {
        const element = document.querySelector(sel);
        if (!element) return { success: false, error: 'Element not found after scroll' };

        try {
          // Handle checkbox/radio special case
          if (element instanceof HTMLInputElement &&
              (element.type === 'checkbox' || element.type === 'radio')) {
            // Toggle the checked state for checkboxes or set to true for radio
            if (element.type === 'checkbox') {
              element.checked = !element.checked;
            } else {
              element.checked = true;
            }

            // Dispatch events
            element.dispatchEvent(new Event('change', { bubbles: true }));
            element.dispatchEvent(new Event('input', { bubbles: true }));
            return { success: true };
          }

          // Handle option element within select special case
          if (element instanceof HTMLOptionElement) {
            const select = element.parentElement;
            if (select instanceof HTMLSelectElement) {
              // Set the select's value to the option's value
              select.value = element.value;
              // Dispatch change event on the select element
              select.dispatchEvent(new Event('change', { bubbles: true }));
              select.dispatchEvent(new Event('input', { bubbles: true }));
              return { success: true };
            }
          }

          // For other elements, scroll into view again (in case layout shifted) and click
          if (element instanceof HTMLElement) {
            element.scrollIntoView({ block: 'center', behavior: 'instant' });
            element.click();
            return { success: true };
          }

          return { success: false, error: 'Not clickable element' };
        } catch (err) {
          return {
            success: false,
            error: err instanceof Error ? err.message : String(err)
          };
        }
      }, selector);

      if (directSuccess?.success) {
        logInfo('Direct DOM manipulation was successful');
        success = true;
        break;
      }

      // Fallback to standard click
      logInfo(`Direct manipulation failed, trying standard click on "${selector}"`);
      await page.click(selector);
      logInfo('Standard click was successful');
      success = true;
    } catch (error) {
      lastError = error as Error;
      logWarn(`Click attempt ${attempt + 1} failed: ${(error as Error).message}`);
      attempt++;

      // If there are more retries, wait before retrying
      if (attempt <= retries) {
        logInfo(`Waiting ${waitBetweenRetries}ms before next attempt`);
        await new Promise((resolve) => setTimeout(resolve, waitBetweenRetries));
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
