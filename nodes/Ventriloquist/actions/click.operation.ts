import {
  IExecuteFunctions,
  INodeExecutionData,
  INodeProperties,
} from 'n8n-workflow';
import type { Page } from 'puppeteer-core';
import { robustClick, waitAndClick } from '../utils/clickOperations';
import { formatUrl } from '../utils/navigationUtils';
import { BrowserTransportFactory } from '../transport/BrowserTransportFactory';
import { SessionManager } from '../utils/sessionManager';

// Define the properties for the click operation
export const description: INodeProperties[] = [
  {
    displayName: 'Selector',
    name: 'selector',
    type: 'string',
    default: '',
    required: true,
    description: 'CSS selector of the element to click',
  },
  {
    displayName: 'Wait Before Click Selector',
    name: 'waitBeforeClickSelector',
    type: 'string',
    default: '',
    description: 'Wait for this element to appear before attempting click (optional)',
  },
  {
    displayName: 'Session ID',
    name: 'explicitSessionId',
    type: 'string',
    default: '',
    description: 'Session ID to use for this operation (leave empty to use ID from input or create new)',
  },
  {
    displayName: 'Timeout',
    name: 'timeout',
    type: 'number',
    default: 30000,
    description: 'Timeout in milliseconds',
  },
  {
    displayName: 'Retries',
    name: 'retries',
    type: 'number',
    default: 0,
    description: 'Number of retry attempts if click fails',
  },
  {
    displayName: 'Capture Screenshot',
    name: 'captureScreenshot',
    type: 'boolean',
    default: true,
    description: 'Whether to capture a screenshot after clicking',
  },
  {
    displayName: 'Continue On Fail',
    name: 'continueOnFail',
    type: 'boolean',
    default: true,
    description: 'Whether to continue execution even if the operation fails',
  },
];

/**
 * Execute the click operation
 */
export async function execute(
  this: IExecuteFunctions,
  index: number,
  websocketEndpoint: string,
  workflowId: string,
): Promise<INodeExecutionData> {
  const startTime = Date.now();
  const items = this.getInputData();
  let sessionId = '';
  let page: Page | undefined;
  let error: Error | undefined;
  let success = false;
  let pageTitle = '';
  let pageUrl = '';

  // Operation parameters
  const selector = this.getNodeParameter('selector', index) as string;
  const waitBeforeClickSelector = this.getNodeParameter(
    'waitBeforeClickSelector',
    index,
    ''
  ) as string;
  const explicitSessionId = this.getNodeParameter('explicitSessionId', index, '') as string;
  const timeout = this.getNodeParameter('timeout', index, 30000) as number;
  const retries = this.getNodeParameter('retries', index, 0) as number;
  const captureScreenshot = this.getNodeParameter('captureScreenshot', index, true) as boolean;
  const continueOnFail = this.getNodeParameter('continueOnFail', index, true) as boolean;

  try {
    // Try to get sessionId from different sources
    if (explicitSessionId) {
      sessionId = explicitSessionId;
      this.logger.info(`Using explicitly provided session ID: ${sessionId}`);
    }
    // If not explicit ID provided, try to get sessionId from the current item
    else if (items[index].json?.sessionId) {
      sessionId = items[index].json.sessionId as string;
    }
    // For backward compatibility, also check for pageId
    else if (items[index].json?.pageId) {
      sessionId = items[index].json.pageId as string;
      this.logger.info('Using legacy pageId as sessionId for compatibility');
    }

    // If no sessionId in current item, look at all input items for a sessionId
    if (!sessionId) {
      for (const item of items) {
        if (item.json?.sessionId) {
          sessionId = item.json.sessionId as string;
          break;
        }
        // For backward compatibility
        else if (item.json?.pageId) {
          sessionId = item.json.pageId as string;
          this.logger.info('Using legacy pageId as sessionId for compatibility');
          break;
        }
      }
    }

    // Get credentials for the session
    const credentialType = this.getNodeParameter('credentialType', 0) as string;
    const credentials = await this.getCredentials(credentialType);

    // Double timeout for Bright Data as recommended in their docs
    const adjustedTimeout = credentialType === 'brightDataApi' ? timeout * 2 : timeout;

    // Get or create a page to work with
    if (sessionId) {
      // Try to get the page from the sessionId
      this.logger.info(`Attempting to get page for session ID: ${sessionId}`);
      page = SessionManager.getPage(sessionId);

      if (page) {
        this.logger.info(`Found existing page for session ID: ${sessionId}`);

        // Verify the page is still connected
        try {
          await page.evaluate(() => document.readyState);
          this.logger.info('Page is still connected');
        } catch (connectionError) {
          this.logger.warn(`Page appears disconnected: ${(connectionError as Error).message}`);
          page = undefined; // Reset so we try reconnection
        }
      }

      // If page not found or disconnected, try to reconnect or create new
      if (!page) {
        this.logger.info(`No active page found for session ID: ${sessionId}, reconnecting or creating new`);

        // Create transport to handle reconnection
        const transportFactory = new BrowserTransportFactory();
        const browserTransport = transportFactory.createTransport(
          credentialType,
          this.logger,
          credentials
        );

        try {
          // Try to reconnect if the transport supports it
          if (browserTransport.reconnect) {
            this.logger.info(`Attempting to reconnect to session: ${sessionId}`);
            const browser = await browserTransport.reconnect(sessionId);

            // Get the existing pages or create a new one
            const pages = await browser.pages();
            page = pages.length > 0 ? pages[0] : await browser.newPage();

            // Store the page in the session manager
            SessionManager.storePage(sessionId, 'default', page);
            this.logger.info(`Successfully reconnected to session: ${sessionId}`);
          } else {
            throw new Error('Transport does not support reconnection');
          }
        } catch (reconnectError) {
          this.logger.warn(`Reconnection failed: ${(reconnectError as Error).message}`);
          this.logger.info('Creating new session as fallback');

          // Get WebSocket URL from credentials
          const websocketUrl = SessionManager.getWebSocketUrlFromCredentials(
            this.logger,
            credentialType,
            credentials
          );

          // Create a new session
          const { browser, sessionId: newSessionId } = await SessionManager.createSession(
            this.logger,
            websocketUrl,
            {
              workflowId,
              credentialType
            }
          );

          // Get the first page or create a new one
          const pages = await browser.pages();
          page = pages.length > 0 ? pages[0] : await browser.newPage();

          // Update session ID to new one
          sessionId = newSessionId;

          // Store the page
          SessionManager.storePage(sessionId, 'default', page);
          this.logger.info(`Created new session with ID: ${sessionId}`);
        }
      }
    } else {
      // No session ID provided, create a new session
      this.logger.info('No session ID provided, creating new session');

      // Get WebSocket URL from credentials
      const websocketUrl = SessionManager.getWebSocketUrlFromCredentials(
        this.logger,
        credentialType,
        credentials
      );

      // Create a new session
      const { browser, sessionId: newSessionId } = await SessionManager.createSession(
        this.logger,
        websocketUrl,
        {
          workflowId,
          credentialType
        }
      );

      // Get the first page or create a new one
      const pages = await browser.pages();
      page = pages.length > 0 ? pages[0] : await browser.newPage();

      // Set the session ID
      sessionId = newSessionId;

      // Store the page
      SessionManager.storePage(sessionId, 'default', page);
      this.logger.info(`Created new session with ID: ${sessionId}`);
    }

    // Get page info for debugging
    pageTitle = await page.title();
    pageUrl = page.url();
    this.logger.info(`Current page URL: ${formatUrl(pageUrl)}, title: ${pageTitle}`);

    // Perform the click operation
    if (waitBeforeClickSelector) {
      this.logger.info(`Waiting for selector "${waitBeforeClickSelector}" before clicking`);

      // Use the waitAndClick utility
      const clickResult = await waitAndClick(page, selector, {
        waitTimeout: adjustedTimeout,
        retries,
        waitBetweenRetries: 1000,
        logger: this.logger
      });

      success = clickResult.success;
      error = clickResult.error;
    } else {
      // Directly use the robustClick utility
      const clickResult = await robustClick(page, selector, {
        retries,
        waitBetweenRetries: 1000,
        logger: this.logger
      });

      success = clickResult.success;
      error = clickResult.error;
    }

    // Get updated page info after click
    const updatedPageTitle = await page.title();
    const updatedPageUrl = page.url();

    // Take screenshot if requested
    let screenshot = '';
    if (captureScreenshot && page && success) {
      try {
        const buffer = await page.screenshot({
          encoding: 'base64',
          type: 'jpeg',
          quality: 80,
        });
        screenshot = `data:image/jpeg;base64,${buffer}`;
      } catch (screenshotError) {
        this.logger.warn(`Failed to take screenshot: ${(screenshotError as Error).message}`);
      }
    }

    // Prepare the result
    if (success) {
      // Click operation successful
      return {
        json: {
          ...items[index].json, // Pass through input data
          success: true,
          operation: 'click',
          selector,
          sessionId,
          url: updatedPageUrl,
          title: updatedPageTitle,
          timestamp: new Date().toISOString(),
          executionDuration: Date.now() - startTime,
          ...(screenshot ? { screenshot } : {}),
        },
      };
    } else {
      // Click operation failed
      const errorMessage = error?.message || 'Click operation failed for an unknown reason';

      if (!continueOnFail) {
        // If continueOnFail is false, throw the error to fail the node
        throw new Error(`Click operation failed: ${errorMessage}`);
      }

      // Otherwise, return an error response but continue execution
      return {
        json: {
          ...items[index].json, // Pass through input data
          success: false,
          operation: 'click',
          error: errorMessage,
          selector,
          sessionId,
          url: updatedPageUrl,
          title: updatedPageTitle,
          timestamp: new Date().toISOString(),
          executionDuration: Date.now() - startTime,
          ...(screenshot ? { screenshot } : {}),
        },
      };
    }
  } catch (catchError: any) {
    const errorMessage = catchError.message || 'An unknown error occurred';

    if (!continueOnFail) {
      throw catchError;
    }

    // Return error as response with continue on fail
    return {
      json: {
        ...items[index].json, // Pass through input data
        success: false,
        operation: 'click',
        error: errorMessage,
        selector,
        sessionId,
        timestamp: new Date().toISOString(),
        executionDuration: Date.now() - startTime,
      },
    };
  }
}
