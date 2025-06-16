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

  if (!selector) {
    return {
      success: false,
      details: { error: 'No selector provided for click action' },
      error: new Error('No selector provided for click action')
    };
  }

  // Split selectors by comma, trim whitespace
  const selectors = selector.split(',').map(sel => sel.trim()).filter(Boolean);
  let lastResult: IClickActionResult = {
    success: false,
    details: { error: 'No selectors provided or all failed' },
    error: new Error('No selectors provided or all failed')
  };
  let navigationDetected = false;

  for (const sel of selectors) {
    if (navigationDetected) break;
    try {
      logger.info(formatOperationLog('ClickAction', nodeName, nodeId, index,
        `Attempting click on selector: "${sel}"`));
      // Use the waitAndClick utility which handles both waiting for the selector and clicking it
      const clickResult = await waitAndClick(
        page,
        sel,
        {
          waitTimeout: selectorTimeout,
          retries: 2,
          waitBetweenRetries: 1000,
          logger: logger
        }
      );
      if (!clickResult.success) {
        logger.warn(formatOperationLog('ClickAction', nodeName, nodeId, index,
          `Could not click element "${sel}": ${clickResult.error?.message || 'Unknown error'}`));
        lastResult = {
          success: false,
          details: { selector: sel, error: clickResult.error?.message || 'Unknown error' },
          error: clickResult.error || new Error('Unknown error')
        };
        continue;
      }
      logger.info(formatOperationLog('ClickAction', nodeName, nodeId, index,
        `Click successful on "${sel}"`));
      // Handle post-click waiting
      if (waitAfterAction === 'fixedTime') {
        await new Promise(resolve => setTimeout(resolve, waitTime));
      } else if (waitAfterAction === 'urlChanged') {
        try {
          const browser = page.browser();
          const currentUrl = await page.url();
          logger.info(formatOperationLog('ClickAction', nodeName, nodeId, index,
            'Adding initial stabilization delay (1000ms)'));
          await new Promise(resolve => setTimeout(resolve, 1000));
          let contextDestroyed = false;
          let reconnectedPage: puppeteer.Page | null = null;
          try {
            const urlChanged = await waitForUrlChange(
              sessionId,
              currentUrl,
              waitTime,
              logger
            );
            if (urlChanged) {
              logger.info(formatOperationLog('ClickAction', nodeName, nodeId, index,
                'Navigation after click completed successfully - URL changed'));
              navigationDetected = true;
              lastResult = {
                success: true,
                details: { selector: sel, waitAfterAction, waitTime, contextDestroyed, pageReconnected: !!reconnectedPage, reconnectedPage },
                urlChanged: true,
                navigationSuccessful: true
              };
              break;
            } else {
              logger.warn(formatOperationLog('ClickAction', nodeName, nodeId, index,
                `Navigation after click may not have completed - URL did not change from ${currentUrl}`));
            }
          } catch (navigationError) {
            if ((navigationError as Error).message.includes('context was destroyed') ||
                (navigationError as Error).message.includes('Execution context')) {
              contextDestroyed = true;
              logger.info(formatOperationLog('ClickAction', nodeName, nodeId, index,
                'Navigation context was destroyed, which likely indicates successful navigation'));
              // Try to reconnect to the page
              try {
                logger.info(formatOperationLog('ClickAction', nodeName, nodeId, index,
                  'Context destroyed - attempting to reconnect to the active page'));
                const recoveryDelay = 3000;
                logger.info(formatOperationLog('ClickAction', nodeName, nodeId, index,
                  `Adding recovery delay (${recoveryDelay}ms)`));
                await new Promise(resolve => setTimeout(resolve, recoveryDelay));
                const pages = await browser.pages();
                if (pages.length > 0) {
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
              navigationDetected = true;
              lastResult = {
                success: true,
                details: { selector: sel, waitAfterAction, waitTime, contextDestroyed, pageReconnected: !!reconnectedPage, reconnectedPage },
                contextDestroyed: true,
                navigationSuccessful: true
              };
              break;
            } else {
              logger.warn(formatOperationLog('ClickAction', nodeName, nodeId, index,
                `Navigation after click encountered an issue: ${(navigationError as Error).message}`));
            }
          }
        } catch (error) {
          logger.warn(formatOperationLog('ClickAction', nodeName, nodeId, index,
            `Error during URL change handling: ${(error as Error).message}`));
        }
      } else if (waitAfterAction === 'selector' && waitSelector) {
        await page.waitForSelector(waitSelector, { timeout: waitTime });
      }
      // If we get here, click was successful and no navigation detected
      lastResult = {
        success: true,
        details: { selector: sel, waitAfterAction, waitTime, contextDestroyed: false },
        navigationSuccessful: false
      };
    } catch (error) {
      logger.warn(formatOperationLog('ClickAction', nodeName, nodeId, index,
        `Error during click action for selector "${sel}": ${(error as Error).message}`));
      lastResult = {
        success: false,
        details: { selector: sel, error: (error as Error).message },
        error: error as Error
      };
      continue;
    }
  }
  return lastResult;
}
