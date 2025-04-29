import type { IDataObject, Logger as ILogger } from 'n8n-workflow';
import type * as puppeteer from 'puppeteer-core';
import { formatOperationLog } from '../resultUtils';
import { waitAndClick } from '../clickOperations';
import { waitForUrlChange } from '../navigationUtils';

/**
 * Interface for click action parameters
 */
export interface IClickActionParameters {
  selector: string;
  waitAfterAction?: string;
  waitTime?: number;
  waitSelector?: string;
}

/**
 * Interface for click action options
 */
export interface IClickActionOptions {
  nodeName: string;
  nodeId: string;
  index: number;
  selectorTimeout?: number;
  sessionId: string;
}

/**
 * Interface for click action result
 */
export interface IClickActionResult {
  success: boolean;
  details: IDataObject;
  error?: Error;
  contextDestroyed?: boolean;
  urlChanged?: boolean;
  navigationSuccessful?: boolean;
}

/**
 * Execute a click action on the page
 */
export async function executeClickAction(
  page: puppeteer.Page,
  parameters: IClickActionParameters,
  options: IClickActionOptions,
  logger: ILogger
): Promise<IClickActionResult> {
  const { selector, waitAfterAction = 'domContentLoaded', waitTime = 5000, waitSelector } = parameters;
  const { nodeName, nodeId, index, sessionId, selectorTimeout = 10000 } = options;

  // Variables to track navigation state
  let contextDestroyed = false;
  let reconnectedPage: puppeteer.Page | null = null;

  if (!selector) {
    return {
      success: false,
      details: { error: 'No selector provided for click action' },
      error: new Error('No selector provided for click action')
    };
  }

  try {
    logger.info(formatOperationLog('ClickAction', nodeName, nodeId, index,
      `Executing click on "${selector}" (wait: ${waitAfterAction}, timeout: ${waitTime}ms)`));

    // Use the waitAndClick utility which handles both waiting for the selector and clicking it
    const clickResult = await waitAndClick(
      page,
      selector,
      {
        waitTimeout: selectorTimeout,
        retries: 2,
        waitBetweenRetries: 1000,
        logger: logger
      }
    );

    // Handle click failures
    if (!clickResult.success) {
      throw new Error(`Action failed: Could not click element "${selector}": ${clickResult.error?.message || 'Unknown error'}`);
    }

    logger.info(formatOperationLog('ClickAction', nodeName, nodeId, index,
      `Click successful on "${selector}"`));

    // Handle post-click waiting
    if (waitAfterAction === 'fixedTime') {
      await new Promise(resolve => setTimeout(resolve, waitTime));
    } else if (waitAfterAction === 'urlChanged') {
      try {
        // Store browser reference for potential reconnection
        const browser = page.browser();

        // Get current URL to detect changes
        const currentUrl = await page.url();

        // Add initial stabilization delay
        logger.info(formatOperationLog('ClickAction', nodeName, nodeId, index,
          'Adding initial stabilization delay (1000ms)'));
        await new Promise(resolve => setTimeout(resolve, 1000));

        // Track if context gets destroyed
        contextDestroyed = false;
        reconnectedPage = null;

        try {
          // Use waitForUrlChange utility from navigationUtils instead of waitForNavigation
          const urlChanged = await waitForUrlChange(
            sessionId,
            currentUrl,
            waitTime,
            logger
          );

          if (urlChanged) {
            logger.info(formatOperationLog('ClickAction', nodeName, nodeId, index,
              'Navigation after click completed successfully - URL changed'));
          } else {
            logger.warn(formatOperationLog('ClickAction', nodeName, nodeId, index,
              `Navigation after click may not have completed - URL did not change from ${currentUrl}`));
          }
        } catch (navigationError) {
          // This is expected in many cases when URL changes - the navigation destroys the execution context
          if ((navigationError as Error).message.includes('context was destroyed') ||
              (navigationError as Error).message.includes('Execution context')) {
            contextDestroyed = true;
            logger.info(formatOperationLog('ClickAction', nodeName, nodeId, index,
              'Navigation context was destroyed, which likely indicates successful navigation'));

            // When context is destroyed, try to reconnect to the page
            try {
              logger.info(formatOperationLog('ClickAction', nodeName, nodeId, index,
                'Context destroyed - attempting to reconnect to the active page'));

              // Add a recovery delay
              const recoveryDelay = 3000;
              logger.info(formatOperationLog('ClickAction', nodeName, nodeId, index,
                `Adding recovery delay (${recoveryDelay}ms)`));
              await new Promise(resolve => setTimeout(resolve, recoveryDelay));

              // Get all browser pages and find the active one
              const pages = await browser.pages();

              if (pages.length > 0) {
                // Use the last page as it's likely the one after navigation
                reconnectedPage = pages[pages.length - 1];
                logger.info(formatOperationLog('ClickAction', nodeName, nodeId, index,
                  `Reconnected to page (${pages.length} pages found)`));
              } else {
                logger.warn(formatOperationLog('ClickAction', nodeName, nodeId, index,
                  'No pages found in browser after navigation'));
              }
            } catch (reconnectError) {
              logger.warn(formatOperationLog('ClickAction', nodeName, nodeId, index,
                `Failed to reconnect to page: ${(reconnectError as Error).message}`));
            }
          } else {
            // For other navigation errors, log but don't fail the action
            logger.warn(formatOperationLog('ClickAction', nodeName, nodeId, index,
              `Navigation after click encountered an issue: ${(navigationError as Error).message}`));
          }
        }

        // Try to get new page info for diagnostics
        try {
          // Use the reconnected page if available, otherwise the original page
          const activePage = reconnectedPage || page;

          const newUrl = await activePage.url();
          const pageTitle = await activePage.title();
          logger.info(formatOperationLog('ClickAction', nodeName, nodeId, index,
            `Page after navigation - URL: ${newUrl}, Title: ${pageTitle}`));

          return {
            success: true,
            details: {
              selector,
              waitAfterAction,
              waitTime,
              contextDestroyed,
              pageReconnected: !!reconnectedPage,
              reconnectedPage: reconnectedPage  // Include the actual reconnected page object
            }
          };
        } catch (pageInfoError) {
          logger.warn(formatOperationLog('ClickAction', nodeName, nodeId, index,
            `Could not get page info after navigation: ${(pageInfoError as Error).message}`));

          return {
            success: true,
            details: {
              selector,
              waitAfterAction,
              waitTime,
              contextDestroyed,
              pageReconnected: !!reconnectedPage,
              reconnectedPage: reconnectedPage  // Include even in error case
            }
          };
        }
      } catch (error) {
        // Log but don't fail the action for URL change errors
        logger.warn(formatOperationLog('ClickAction', nodeName, nodeId, index,
          `Error during URL change handling: ${(error as Error).message}`));
      }
    } else if (waitAfterAction === 'selector' && waitSelector) {
      await page.waitForSelector(waitSelector, { timeout: waitTime });
    }

    return {
      success: true,
      details: {
        selector,
        waitAfterAction,
        waitTime,
        contextDestroyed: contextDestroyed ?? false
      }
    };
  } catch (error) {
    logger.error(formatOperationLog('ClickAction', nodeName, nodeId, index,
      `Error during click action: ${(error as Error).message}`));

    return {
      success: false,
      details: {
        selector,
        waitAfterAction,
        waitTime
      },
      error: error as Error
    };
  }
}
