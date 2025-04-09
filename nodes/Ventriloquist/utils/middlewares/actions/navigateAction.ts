import type { IDataObject, Logger as ILogger } from 'n8n-workflow';
import type * as puppeteer from 'puppeteer-core';
import { formatOperationLog } from '../../resultUtils';

/**
 * Interface for navigate action parameters
 */
export interface INavigateActionParameters {
  page: puppeteer.Page;
  url: string;
  waitUntil?: 'load' | 'domcontentloaded' | 'networkidle0' | 'networkidle2';
  waitTime?: number;
  detectUrlChangeType?: string; // 'hard' (default), 'any' (both hard and soft changes)
  referer?: string;
  headers?: Record<string, string>;
  nodeName: string;
  nodeId: string;
  index: number;
  logger: ILogger;
  timeout?: number;
}

/**
 * Interface for navigate action result
 */
export interface INavigateActionResult {
  success: boolean;
  navigationSuccessful?: boolean;
  contextDestroyed?: boolean;
  pageReconnected?: boolean;
  urlChanged?: boolean;
  navigatedUrl?: string;
  pageTitle?: string;
  details: IDataObject;
  error?: Error;
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
 * Execute a navigation action on the page
 * Extracted as a middleware to be reused across different operations
 */
export async function executeNavigateAction(
  params: INavigateActionParameters
): Promise<INavigateActionResult> {
  const {
    page,
    url,
    waitUntil = 'networkidle0',
    referer,
    headers,
    nodeName,
    nodeId,
    index,
    logger,
    timeout = 30000,
  } = params;

  let navigatedUrl = '';
  let navigationSuccessful = false;
  let pageTitle = '';
  let contextDestroyed = false;
  let pageReconnected = false;

  // Log navigation starting
  logger.info(formatOperationLog('NavigateAction', nodeName, nodeId, index,
    `Navigating to: ${url} with waitUntil: ${waitUntil}, timeout: ${timeout}ms`));

  try {
    // Determine the navigation options
    const navigationOptions: puppeteer.WaitForOptions & { referer?: string } = {
      waitUntil: waitUntil as puppeteer.PuppeteerLifeCycleEvent,
      timeout
    };

    if (referer || headers) {
      const extraHeaders: Record<string, string> = {};
      if (referer) extraHeaders.Referer = referer;
      if (headers) Object.assign(extraHeaders, headers as Record<string, string>);

      navigationOptions.referer = referer;
      if (Object.keys(extraHeaders).length > 0) {
        await page.setExtraHTTPHeaders(extraHeaders);
      }
    }

    // Begin navigation and log the process
    logger.info(formatOperationLog('NavigateAction', nodeName, nodeId, index,
      `Starting navigation to: ${url}`));

    // Perform navigation
    await page.goto(url, navigationOptions);

    // Add a small delay after navigation to ensure the page is settled
    await new Promise(resolve => setTimeout(resolve, 2000));

    // Get final URL and title
    navigatedUrl = await page.url();
    pageTitle = await page.title();

    // Check if navigation was successful
    navigationSuccessful = true;

    // Log navigation success
    logger.info(formatOperationLog('NavigateAction', nodeName, nodeId, index,
      `Navigation completed successfully to: ${navigatedUrl}, page title: ${pageTitle}`));

    return {
      success: true,
      navigationSuccessful,
      navigatedUrl,
      pageTitle,
      details: {
        url,
        navigatedUrl,
        pageTitle,
        waitUntil,
        timeout,
        referer,
        headers
      }
    };
  } catch (error) {
    // Check if the error is due to context destruction
    contextDestroyed = (error as Error).message.includes('context was destroyed') ||
                      (error as Error).message.includes('Execution context');

    if (contextDestroyed) {
      logger.info(formatOperationLog('NavigateAction', nodeName, nodeId, index,
        'Navigation context was destroyed, which likely indicates successful navigation'));

      try {
        // Try to get a new page reference
        const browser = page.browser();
        const pages = await browser.pages();
        if (pages.length > 0) {
          const newPage = pages[pages.length - 1];
          navigatedUrl = await newPage.url();
          pageTitle = await newPage.title();
          pageReconnected = true;
          navigationSuccessful = true;

          logger.info(formatOperationLog('NavigateAction', nodeName, nodeId, index,
            `Reconnected to new page after context destruction: ${navigatedUrl}, title: ${pageTitle}`));

          return {
            success: true,
            navigationSuccessful,
            navigatedUrl,
            pageTitle,
            contextDestroyed,
            pageReconnected,
            details: {
              url,
              navigatedUrl,
              pageTitle,
              waitUntil,
              timeout,
              referer,
              headers,
              contextDestroyed,
              pageReconnected,
              info: 'Navigation succeeded but destroyed the context'
            }
          };
        }
      } catch (reconnectionError) {
        logger.warn(formatOperationLog('NavigateAction', nodeName, nodeId, index,
          `Error reconnecting to page after context destruction: ${(reconnectionError as Error).message}`));
      }

      // Even if we couldn't reconnect, consider this a successful navigation
      return {
        success: true,
        navigationSuccessful: true,
        contextDestroyed,
        details: {
          url,
          waitUntil,
          timeout,
          referer,
          headers,
          contextDestroyed,
          info: 'Navigation succeeded but destroyed the context and could not reconnect'
        }
      };
    }

    // Handle other navigation errors
    logger.error(formatOperationLog('NavigateAction', nodeName, nodeId, index,
      `Navigation error: ${(error as Error).message}`));

    return {
      success: false,
      navigationSuccessful: false,
      error: error as Error,
      details: {
        url,
        waitUntil,
        timeout,
        referer,
        headers,
        error: (error as Error).message
      }
    };
  }
}
