import type { IDataObject, Logger as ILogger } from 'n8n-workflow';
import type * as puppeteer from 'puppeteer-core';
import { formatOperationLog } from '../../resultUtils';
import { clickAndWaitForNavigation } from '../../navigationUtils';
import { SessionManager } from '../../sessionManager';

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
  sessionId: string;
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
}

/**
 * Execute a click action using SessionManager
 * This version is page-agnostic and relies on SessionManager for page references
 */
export async function executeClickAction(
  parameters: IClickActionParameters,
  options: IClickActionOptions,
  logger: ILogger
): Promise<IClickActionResult> {
  const { selector, waitAfterAction = 'noWait', waitTime = 5000, waitSelector } = parameters;
  const { sessionId, nodeName, nodeId, index } = options;

  // Add logging prefix to clearly identify source
  const logPrefix = '[ClickAction][executeClickAction]';

  // Log action start
  logger.info(formatOperationLog('ClickAction', nodeName, nodeId, index,
    `${logPrefix} Executing click action on selector: "${selector}" using session: ${sessionId}`));

  // First, verify the session exists and get the current page
  if (!await SessionManager.isSessionActive(sessionId)) {
    return {
      success: false,
      details: {
        error: `Session ${sessionId} is not active or has expired`,
        selector
      },
      error: new Error(`Session ${sessionId} is not active or has expired`)
    };
  }

  try {
    // Get the current page from session manager
    const page = SessionManager.getPage(sessionId);

    if (!page) {
      return {
        success: false,
        details: {
          error: `No page found for session ${sessionId}`,
          selector
        },
        error: new Error(`No page found for session ${sessionId}`)
      };
    }

    // Store the initial URL and title before clicking
    const beforeUrl = await page.url();
    const beforeTitle = await page.title();

    logger.info(formatOperationLog('ClickAction', nodeName, nodeId, index,
      `${logPrefix} Current page before click - URL: ${beforeUrl}, Title: ${beforeTitle}`));

    // Determine if we need to wait for navigation
    const shouldWaitForNav =
      waitAfterAction === 'urlChanged' ||
      waitAfterAction === 'anyUrlChange' ||
      waitAfterAction === 'navigationComplete';

    if (shouldWaitForNav) {
      // Use the simple navigation approach with Promise.all
      logger.info(formatOperationLog('ClickAction', nodeName, nodeId, index,
        `${logPrefix} Using navigation handling for click with waitAfterAction: ${waitAfterAction}`));

      // Map the waitAfterAction to appropriate waitUntil option
      let waitUntil: puppeteer.PuppeteerLifeCycleEvent = 'domcontentloaded';
      if (waitAfterAction === 'navigationComplete') {
        waitUntil = 'networkidle0';
      }

      // Use our simplified navigation utility with proper timeout
      logger.info(formatOperationLog('ClickAction', nodeName, nodeId, index,
        `${logPrefix} Calling clickAndWaitForNavigation with selector: "${selector}", timeout: ${waitTime}ms, waitUntil: ${waitUntil}`));

      const navigationResult = await clickAndWaitForNavigation(
        sessionId,
        selector,
        {
          timeout: waitTime,
          waitUntil,
          stabilizationDelay: 2000,
          logger
        }
      );

      logger.info(formatOperationLog('ClickAction', nodeName, nodeId, index,
        `${logPrefix} clickAndWaitForNavigation returned - success: ${navigationResult.success}, contextDestroyed: ${!!navigationResult.contextDestroyed}, urlChanged: ${!!navigationResult.urlChanged}`));

      if (navigationResult.success) {
        // Navigation was successful
        const finalUrl = navigationResult.finalUrl || '';
        logger.info(formatOperationLog('ClickAction', nodeName, nodeId, index,
          `${logPrefix} Click with navigation successful - Final URL: ${finalUrl}`));

        // If we got a new page reference, update the session manager
        if (navigationResult.newPage) {
          logger.info(formatOperationLog('ClickAction', nodeName, nodeId, index,
            `${logPrefix} Updating session manager with new page reference after navigation`));

          // Store the new page in the session manager with a timestamp-based ID
          const pageId = `page_${Date.now()}`;
          SessionManager.storePage(sessionId, pageId, navigationResult.newPage);
          logger.info(formatOperationLog('ClickAction', nodeName, nodeId, index,
            `${logPrefix} New page stored in SessionManager with ID: ${pageId}`));
        }

        return {
          success: true,
          urlChanged: beforeUrl !== finalUrl,
          navigationSuccessful: true,
          contextDestroyed: navigationResult.contextDestroyed || false,
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
            contextDestroyed: navigationResult.contextDestroyed || false
          }
        };
      }

      // Navigation failed, but click might have succeeded
      logger.warn(formatOperationLog('ClickAction', nodeName, nodeId, index,
        `${logPrefix} Click succeeded but navigation may not have occurred: ${navigationResult.error || 'Unknown error'}`));

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

    if (waitAfterAction === 'fixedTime') {
      // Simple click with fixed time wait
      await page.click(selector);

      // Wait for the specified time
      logger.info(formatOperationLog('ClickAction', nodeName, nodeId, index,
        `${logPrefix} Waiting fixed time after click: ${waitTime}ms`));

      await new Promise(resolve => setTimeout(resolve, waitTime));

      // Get the final URL and title - using the session to get the current page
      const currentPage = SessionManager.getPage(sessionId);

      if (!currentPage) {
        return {
          success: true, // Click succeeded but we lost the page reference
          details: {
            selector,
            waitAfterAction,
            waitTime,
            beforeUrl,
            beforeTitle,
            error: 'Could not get current page after click with fixed wait',
            sessionId
          }
        };
      }

      const finalUrl = await currentPage.url();
      const finalTitle = await currentPage.title();

      // Log the action result
      logger.info(formatOperationLog('ClickAction', nodeName, nodeId, index,
        `${logPrefix} Click with fixed wait completed - Final URL: ${finalUrl}, Title: ${finalTitle}`));

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
          urlChanged: beforeUrl !== finalUrl,
          sessionId
        }
      };
    }

    if (waitAfterAction === 'selector' && waitSelector) {
      // Click and wait for a selector to appear
      await page.click(selector);

      logger.info(formatOperationLog('ClickAction', nodeName, nodeId, index,
        `${logPrefix} Waiting for selector after click: ${waitSelector}, timeout: ${waitTime}ms`));

      await page.waitForSelector(waitSelector, { timeout: waitTime });

      // Get the final URL and title - using the session to get the current page
      const currentPage = SessionManager.getPage(sessionId);

      if (!currentPage) {
        return {
          success: true, // Click succeeded but we lost the page reference
          details: {
            selector,
            waitAfterAction,
            waitSelector,
            waitTime,
            beforeUrl,
            beforeTitle,
            error: 'Could not get current page after click with selector wait',
            sessionId
          }
        };
      }

      const finalUrl = await currentPage.url();
      const finalTitle = await currentPage.title();

      // Log the action result
      logger.info(formatOperationLog('ClickAction', nodeName, nodeId, index,
        `${logPrefix} Click with selector wait completed - Final URL: ${finalUrl}, Title: ${finalTitle}`));

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
          urlChanged: beforeUrl !== finalUrl,
          sessionId
        }
      };
    }

    // Simple click with no wait (default case)
    await page.click(selector);

    // Get the final URL and title - using the session to get the current page
    const currentPage = SessionManager.getPage(sessionId);

    if (!currentPage) {
      return {
        success: true, // Click succeeded but we lost the page reference
        details: {
          selector,
          waitAfterAction,
          beforeUrl,
          beforeTitle,
          error: 'Could not get current page after click with no wait',
          sessionId
        }
      };
    }

    const finalUrl = await currentPage.url();
    const finalTitle = await currentPage.title();

    // Log the action result
    logger.info(formatOperationLog('ClickAction', nodeName, nodeId, index,
      `${logPrefix} Click with no wait completed - Final URL: ${finalUrl}, Title: ${finalTitle}`));

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
        urlChanged: beforeUrl !== finalUrl,
        sessionId
      }
    };
  } catch (error) {
    // Handle click action errors
    logger.error(formatOperationLog('ClickAction', nodeName, nodeId, index,
      `${logPrefix} Error during click action: ${(error as Error).message}`));

    return {
      success: false,
      details: {
        selector,
        waitAfterAction,
        waitTime,
        error: (error as Error).message,
        sessionId
      },
      error: error as Error
    };
  }
}

