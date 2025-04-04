import type {
  IExecuteFunctions,
  INodeExecutionData,
  INodeProperties,
} from 'n8n-workflow';
import type { Page } from 'puppeteer-core';
import { robustClick, waitAndClick } from '../utils/clickOperations';
import { formatUrl, takeScreenshot } from '../utils/navigationUtils';
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
  let page: Page | null = null;
  let error: Error | undefined;
  let success = false;
  let pageTitle = '';
  let pageUrl = '';

  // Added for better logging
  const nodeName = this.getNode().name;
  const nodeId = this.getNode().id;

  // Visual marker to clearly indicate a new node is starting
  this.logger.info("============ STARTING NODE EXECUTION ============");
  this.logger.info(`[Ventriloquist][${nodeName}#${index}][Click][${nodeId}] Starting execution`);

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
    // Log session state for debugging
    const sessionsInfo = SessionManager.getAllSessions();
    this.logger.info(`[Ventriloquist][${nodeName}#${index}][Click][${nodeId}] Available sessions: ${JSON.stringify(sessionsInfo)}`);

    // If using an explicit session ID, try to get that page first
    if (explicitSessionId) {
      this.logger.info(`[Ventriloquist][${nodeName}#${index}][Click][${nodeId}] Looking for explicitly provided session ID: ${explicitSessionId}`);

      // Get the session with the provided ID
      const existingSession = SessionManager.getSession(explicitSessionId);

      if (existingSession) {
        // Get the page from the session
        const existingPage = SessionManager.getPage(explicitSessionId);
        if (existingPage) {
          page = existingPage;
          sessionId = explicitSessionId;
          this.logger.info(`[Ventriloquist][${nodeName}#${index}][Click][${nodeId}] Found existing session with ID: ${sessionId}`);
        } else if (existingSession.browser) {
          // No page found in session, create a new one
          this.logger.info(`[Ventriloquist][${nodeName}#${index}][Click][${nodeId}] No page found in session, creating a new one`);
          page = await existingSession.browser.newPage();

          // Generate a page ID and store it
          const pageId = `page_${Date.now()}_${Math.random().toString(36).substring(2, 9)}`;
          SessionManager.storePage(explicitSessionId, pageId, page);
          sessionId = explicitSessionId;
        }
      } else {
        // Try to connect to the session
        this.logger.info(`[Ventriloquist][${nodeName}#${index}][Click][${nodeId}] Session not found locally, attempting to connect to: ${explicitSessionId}`);

        try {
          // Try to connect to the session
          const result = await SessionManager.connectToSession(
            this.logger,
            explicitSessionId,
            websocketEndpoint
          );

          sessionId = explicitSessionId;

          // If we got a browser but no page, create one
          if (result.browser) {
            if (result.page) {
              page = result.page;
            } else {
              page = await result.browser.newPage();
              // Store the page in the session
              const pageId = `page_${Date.now()}_${Math.random().toString(36).substring(2, 9)}`;
              SessionManager.storePage(sessionId, pageId, page);
            }

            this.logger.info(`[Ventriloquist][${nodeName}#${index}][Click][${nodeId}] Successfully connected to session: ${sessionId}`);
          }
        } catch (connectError) {
          this.logger.warn(`[Ventriloquist][${nodeName}#${index}][Click][${nodeId}] Could not connect to session: ${(connectError as Error).message}`);
        }
      }
    }

    // If we don't have a page yet, check for existing sessions or create a new one
    if (!page) {
      // Get all active sessions
      const allSessions = SessionManager.getAllSessions();

      if (allSessions.length > 0) {
        this.logger.info(`[Ventriloquist][${nodeName}#${index}][Click][${nodeId}] Found ${allSessions.length} existing sessions`);

        // Try to get a page from any session
        for (const sessionInfo of allSessions) {
          // Try to get the session
          const session = SessionManager.getSession(sessionInfo.sessionId);
          if (session && session.pages.size > 0) {
            // Use the first page from this session
            const existingPage = SessionManager.getPage(sessionInfo.sessionId);
            if (existingPage) {
              page = existingPage;
              sessionId = sessionInfo.sessionId;
              this.logger.info(`[Ventriloquist][${nodeName}#${index}][Click][${nodeId}] Using existing page from session: ${sessionId}`);
              break;
            }
          }
        }

        // If still no page, try to create one in the first available session
        if (!page) {
          const firstSessionId = allSessions[0].sessionId;
          const firstSession = SessionManager.getSession(firstSessionId);

          if (firstSession && firstSession.browser) {
            try {
              page = await firstSession.browser.newPage();
              // Store the page in the session
              const pageId = `page_${Date.now()}_${Math.random().toString(36).substring(2, 9)}`;
              SessionManager.storePage(firstSessionId, pageId, page);
              sessionId = firstSessionId;

              this.logger.info(`[Ventriloquist][${nodeName}#${index}][Click][${nodeId}] Created new page in existing session: ${sessionId}`);
            } catch (pageError) {
              this.logger.error(`[Ventriloquist][${nodeName}#${index}][Click][${nodeId}] Failed to create new page: ${(pageError as Error).message}`);
            }
          }
        }
      }

      // If we still don't have a page, create a new session
      if (!page && websocketEndpoint) {
        this.logger.info(`[Ventriloquist][${nodeName}#${index}][Click][${nodeId}] Creating new browser session`);

        try {
          // Create a new session
          const result = await SessionManager.createSession(this.logger, websocketEndpoint, {
            workflowId, // Store workflowId for backwards compatibility
          });

          sessionId = result.sessionId;

          // Create a new page
          if (result.browser) {
            page = await result.browser.newPage();
            // Store the page in the session
            const pageId = `page_${Date.now()}_${Math.random().toString(36).substring(2, 9)}`;
            SessionManager.storePage(sessionId, pageId, page);

            this.logger.info(`[Ventriloquist][${nodeName}#${index}][Click][${nodeId}] Created new session with ID: ${sessionId}`);

            // Navigate to a blank page to initialize it
            await page.goto('about:blank');
          }
        } catch (sessionError) {
          throw new Error(`Failed to create browser session: ${(sessionError as Error).message}`);
        }
      } else if (!page) {
        // No existing session and no websocket endpoint
        throw new Error('Cannot create a new session without a valid websocket endpoint. Please connect this node to an Open node or provide an explicit session ID.');
      }
    }

    // At this point we must have a valid page
    if (!page) {
      throw new Error('Failed to get or create a page');
    }

    // Get page info for debugging
    pageTitle = await page.title();
    pageUrl = page.url();
    this.logger.info(`[Ventriloquist][${nodeName}#${index}][Click][${nodeId}] Current page URL: ${formatUrl(pageUrl)}, title: ${pageTitle}`);

    // Perform the click operation
    if (waitBeforeClickSelector) {
      this.logger.info(`[Ventriloquist][${nodeName}#${index}][Click][${nodeId}] Waiting for selector "${waitBeforeClickSelector}" before clicking`);

      // Use the waitAndClick utility
      const clickResult = await waitAndClick(page, selector, {
        waitTimeout: timeout,
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
    if (captureScreenshot && page) {
      try {
        const screenshotResult = await takeScreenshot(page, this.logger);
        if (screenshotResult) {
          screenshot = screenshotResult;
        }
      } catch (screenshotError) {
        this.logger.warn(`[Ventriloquist][${nodeName}#${index}][Click][${nodeId}] Failed to take screenshot: ${(screenshotError as Error).message}`);
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
