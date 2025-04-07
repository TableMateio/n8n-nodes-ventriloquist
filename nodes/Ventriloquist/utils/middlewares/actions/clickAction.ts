import type { IDataObject, Logger as ILogger } from 'n8n-workflow';
import type * as puppeteer from 'puppeteer-core';
import { formatOperationLog } from '../../resultUtils';
import { clickAndWaitForNavigation, type INavigationWaitResult } from '../../navigationUtils';

// Add interface for the navigation result to match what clickAndWaitForNavigation returns
interface INavigationResult {
  success: boolean;
  finalUrl?: string;
  finalTitle?: string;
  newPage?: puppeteer.Page;
  contextDestroyed?: boolean;
  error?: string;
}

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
  contextDestroyed?: boolean;
  urlChanged?: boolean;
  navigationSuccessful?: boolean;
  pageReconnected?: boolean;
  reconnectedPage?: puppeteer.Page;
}

/**
 * Execute a click action on the page
 * Extracted as a middleware to be reused across different operations
 */
export async function executeClickAction(
  page: puppeteer.Page,
  parameters: IClickActionParameters,
  options: IClickActionOptions,
  logger: ILogger
): Promise<IClickActionResult> {
  const { selector, waitAfterAction = 'noWait', waitTime = 5000, waitSelector } = parameters;
  const { nodeName, nodeId, index } = options;

  // Get browser reference for potential reconnection
  const browser = page.browser();

  // Start executing the click action
  logger.info(formatOperationLog('ClickAction', nodeName, nodeId, index,
    `Executing click action on selector: "${selector}"`));

  try {
    // Store the initial URL and title before clicking
    const beforeUrl = await page.url();
    const beforeTitle = await page.title();

    logger.info(formatOperationLog('ClickAction', nodeName, nodeId, index,
      `Current page before click - URL: ${beforeUrl}, Title: ${beforeTitle}`));

    // Determine if we need to wait for navigation
    const shouldWaitForNav =
      waitAfterAction === 'urlChanged' ||
      waitAfterAction === 'anyUrlChange' ||
      waitAfterAction === 'navigationComplete';

    if (shouldWaitForNav) {
      // Use the simple navigation approach with Promise.all
      logger.info(formatOperationLog('ClickAction', nodeName, nodeId, index,
        `Using navigation handling for click with waitAfterAction: ${waitAfterAction}`));

      // Map the waitAfterAction to appropriate waitUntil option
      let waitUntil: puppeteer.PuppeteerLifeCycleEvent = 'domcontentloaded';
      if (waitAfterAction === 'navigationComplete') {
        waitUntil = 'networkidle0';
      }

      // Use our simplified navigation utility
      const navigationResult = await clickAndWaitForNavigation(
        page,
        selector,
        {
          timeout: waitTime,
          waitUntil,
          stabilizationDelay: 2000,
          logger
        }
      );

      if (navigationResult.success) {
        // Navigation was successful
        const finalUrl = navigationResult.finalUrl || '';
        logger.info(formatOperationLog('ClickAction', nodeName, nodeId, index,
          `Click with navigation successful - Final URL: ${finalUrl}`));

        // If we got a new page reference, track it
        let pageReconnected = false;
        const newPage = navigationResult.newPage;
        if (newPage) {
          pageReconnected = true;
          logger.info(formatOperationLog('ClickAction', nodeName, nodeId, index,
            'Using reconnected page after navigation'));
        }

        return {
          success: true,
          urlChanged: beforeUrl !== finalUrl,
          navigationSuccessful: true,
          contextDestroyed: navigationResult.contextDestroyed || false,
          pageReconnected,
          details: {
            selector,
            waitAfterAction,
            waitTime,
            beforeUrl,
            finalUrl,
            beforeTitle,
            finalTitle: navigationResult.finalTitle || '',
            urlChanged: beforeUrl !== finalUrl,
            navigationSuccessful: true,
            contextDestroyed: navigationResult.contextDestroyed || false,
            pageReconnected,
            reconnectedPage: newPage
          }
        };
      } else {
        // Navigation failed, but click might have succeeded
        logger.warn(formatOperationLog('ClickAction', nodeName, nodeId, index,
          `Click succeeded but navigation may not have occurred: ${navigationResult.error || 'Unknown error'}`));

        return {
          success: true, // The click itself was successful
          urlChanged: false,
          navigationSuccessful: false,
          details: {
            selector,
            waitAfterAction,
            waitTime,
            beforeUrl,
            beforeTitle,
            error: navigationResult.error || 'Navigation failed with no specific error',
            navigationSuccessful: false
          }
        };
      }
    }
    else if (waitAfterAction === 'fixedTime') {
      // Simple click with fixed time wait
      await page.click(selector);

      // Wait for the specified time
      logger.info(formatOperationLog('ClickAction', nodeName, nodeId, index,
        `Waiting fixed time after click: ${waitTime}ms`));

      await new Promise(resolve => setTimeout(resolve, waitTime));

      // Get the final URL and title
      const finalUrl = await page.url();
      const finalTitle = await page.title();

      // Log the action result
      logger.info(formatOperationLog('ClickAction', nodeName, nodeId, index,
        `Click with fixed wait completed - Final URL: ${finalUrl}, Title: ${finalTitle}`));

      return {
        success: true,
        urlChanged: beforeUrl !== finalUrl,
        details: {
          selector,
          waitAfterAction,
          waitTime,
          beforeUrl,
          finalUrl,
          beforeTitle,
          finalTitle,
          urlChanged: beforeUrl !== finalUrl
        }
      };
    }
    else if (waitAfterAction === 'selector' && waitSelector) {
      // Click and wait for a selector to appear
      await page.click(selector);

      logger.info(formatOperationLog('ClickAction', nodeName, nodeId, index,
        `Waiting for selector after click: ${waitSelector}, timeout: ${waitTime}ms`));

      await page.waitForSelector(waitSelector, { timeout: waitTime });

      // Get the final URL and title
      const finalUrl = await page.url();
      const finalTitle = await page.title();

      // Log the action result
      logger.info(formatOperationLog('ClickAction', nodeName, nodeId, index,
        `Click with selector wait completed - Final URL: ${finalUrl}, Title: ${finalTitle}`));

      return {
        success: true,
        urlChanged: beforeUrl !== finalUrl,
        details: {
          selector,
          waitAfterAction,
          waitSelector,
          waitTime,
          beforeUrl,
          finalUrl,
          beforeTitle,
          finalTitle,
          urlChanged: beforeUrl !== finalUrl
        }
      };
    }
    else {
      // Simple click with no wait
      await page.click(selector);

      // Get the final URL and title
      const finalUrl = await page.url();
      const finalTitle = await page.title();

      // Log the action result
      logger.info(formatOperationLog('ClickAction', nodeName, nodeId, index,
        `Click with no wait completed - Final URL: ${finalUrl}, Title: ${finalTitle}`));

      return {
        success: true,
        urlChanged: beforeUrl !== finalUrl,
        details: {
          selector,
          waitAfterAction,
          beforeUrl,
          finalUrl,
          beforeTitle,
          finalTitle,
          urlChanged: beforeUrl !== finalUrl
        }
      };
    }
  } catch (error) {
    // Handle click action errors
    logger.error(formatOperationLog('ClickAction', nodeName, nodeId, index,
      `Error during click action: ${(error as Error).message}`));

    return {
      success: false,
      details: {
        selector,
        waitAfterAction,
        waitTime,
        error: (error as Error).message
      },
      error: error as Error
    };
  }
}

