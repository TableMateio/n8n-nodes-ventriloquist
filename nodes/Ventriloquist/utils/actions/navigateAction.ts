import type { IDataObject, Logger as ILogger } from 'n8n-workflow';
import type * as puppeteer from 'puppeteer-core';
import { formatOperationLog } from '../resultUtils';
import { navigateWithRetry } from '../navigationUtils';

/**
 * Interface for navigation action parameters
 */
export interface INavigateActionParameters {
  url: string;
  waitUntil?: string;
  waitTime?: number;
}

/**
 * Interface for navigation action options
 */
export interface INavigateActionOptions {
  nodeName: string;
  nodeId: string;
  index: number;
}

/**
 * Interface for navigation action result
 */
export interface INavigateActionResult {
  success: boolean;
  details: IDataObject;
  error?: Error;
}

/**
 * Execute a navigation action on the page
 */
export async function executeNavigateAction(
  page: puppeteer.Page,
  parameters: INavigateActionParameters,
  options: INavigateActionOptions,
  logger: ILogger
): Promise<INavigateActionResult> {
  const { url, waitUntil = 'domcontentloaded', waitTime = 30000 } = parameters;
  const { nodeName, nodeId, index } = options;

  if (!url) {
    return {
      success: false,
      details: { error: 'No URL provided for navigation action' },
      error: new Error('No URL provided for navigation action')
    };
  }

  try {
    logger.info(formatOperationLog('NavigateAction', nodeName, nodeId, index,
      `Executing navigation to "${url}" (waitUntil: ${waitUntil}, timeout: ${waitTime}ms)`));

    // Use navigation with retry utility
    const navigationResult = await navigateWithRetry(
      page,
      url,
      {
        waitUntil: waitUntil as 'load' | 'domcontentloaded' | 'networkidle0' | 'networkidle2',
        timeout: waitTime as number,
        maxRetries: 2,
        retryDelay: 1000,
      },
      logger
    );

    if (!navigationResult) {
      throw new Error(`Navigation to "${url}" failed or timed out`);
    }

    logger.info(formatOperationLog('NavigateAction', nodeName, nodeId, index,
      `Navigation successful to "${url}"`));

    return {
      success: true,
      details: {
        url,
        waitUntil,
        waitTime
      }
    };
  } catch (error) {
    logger.error(formatOperationLog('NavigateAction', nodeName, nodeId, index,
      `Error during navigation action: ${(error as Error).message}`));

    return {
      success: false,
      details: {
        url,
        waitUntil,
        waitTime
      },
      error: error as Error
    };
  }
}
