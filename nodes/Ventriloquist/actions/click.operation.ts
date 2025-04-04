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
    // Use the centralized session management instead of duplicating code
    const sessionResult = await SessionManager.getOrCreatePageSession(this.logger, {
      explicitSessionId,
      websocketEndpoint,
      workflowId,
      operationName: 'Click',
      nodeId,
      nodeName,
      index,
    });

    page = sessionResult.page;
    sessionId = sessionResult.sessionId;

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
