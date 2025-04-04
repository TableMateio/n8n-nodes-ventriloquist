import type { IDataObject, Logger as ILogger } from 'n8n-workflow';
import type * as puppeteer from 'puppeteer-core';
import { formatOperationLog } from '../resultUtils';
import { waitAndClick } from '../clickOperations';

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
}

/**
 * Interface for click action result
 */
export interface IClickActionResult {
  success: boolean;
  details: IDataObject;
  error?: Error;
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
  const { nodeName, nodeId, index, selectorTimeout = 10000 } = options;

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
      await page.waitForNavigation({ timeout: waitTime });
    } else if (waitAfterAction === 'selector' && waitSelector) {
      await page.waitForSelector(waitSelector, { timeout: waitTime });
    }

    return {
      success: true,
      details: {
        selector,
        waitAfterAction,
        waitTime
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
