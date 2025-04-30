import type { IDataObject } from 'n8n-workflow';
import type { Page } from 'puppeteer-core';
import type { ILogger } from './formOperations';
import { safeTakeScreenshot, safeGetPageInfo } from './errorUtils';
import { formatStandardLog } from './loggingUtils';

/**
 * Options for creating a standardized success response
 */
export interface SuccessResponseOptions {
  operation: string;
  sessionId: string;
  page: Page | null;
  logger: ILogger;
  startTime: number;
  takeScreenshot?: boolean;
  additionalData?: IDataObject;
  selector?: string;
  inputData?: IDataObject;
}

/**
 * Create a standardized success response with consistent structure
 * Used across operation files to maintain uniform successful responses
 */
export async function createSuccessResponse(options: SuccessResponseOptions): Promise<IDataObject> {
  const {
    operation,
    sessionId,
    page,
    logger,
    startTime,
    takeScreenshot = false,
    additionalData = {},
    selector = '',
    inputData = {},
  } = options;

  // Calculate duration
  const executionDuration = Date.now() - startTime;

  // Debug log for schema structure
  if (additionalData && typeof additionalData === 'object' && 'data' in additionalData && additionalData.data && typeof additionalData.data === 'object') {
    Object.keys(additionalData.data as Record<string, unknown>).forEach(key => {
      if (key.endsWith('_schema')) {
        const schemaData = (additionalData.data as Record<string, unknown>)[key];
        logger.debug(`Schema structure for ${key}: ${JSON.stringify(schemaData, null, 2)}`);
      }
    });
  }

  // Get current page information
  const { url, title } = await safeGetPageInfo(page, logger);

  // Create the base success response
  const successResponse: IDataObject = {
    success: true,
    operation,
    sessionId,
    url,
    title,
    timestamp: new Date().toISOString(),
    executionDuration: executionDuration,
    ...additionalData,
    ...inputData, // Pass through input data
  };

  // Add selector if provided
  if (selector) {
    successResponse.selector = selector;
  }

  // Take a screenshot if requested and page is available
  if (takeScreenshot && page) {
    const screenshot = await safeTakeScreenshot(page, logger);
    if (screenshot) {
      successResponse.screenshot = screenshot;
    }
  }

  return successResponse;
}

/**
 * Create a standard page details object with current URL and title
 */
export async function getPageDetails(
  page: Page | null,
  logger: ILogger
): Promise<IDataObject> {
  if (!page) {
    return {
      url: 'unknown',
      title: 'unknown',
    };
  }

  const { url, title } = await safeGetPageInfo(page, logger);

  return {
    url,
    title,
  };
}

/**
 * Format operation log message with consistent structure
 * @deprecated Use loggingUtils.formatStandardLog instead
 */
export function formatOperationLog(
  operation: string,
  nodeName: string,
  nodeId: string,
  index: number,
  message: string,
  component?: string,
  functionName?: string
): string {
  // Call the new standard format function for consistency
  return formatStandardLog(nodeName, operation, component || 'Core', functionName, message);
}

/**
 * Create a standardized timing log message
 */
export function createTimingLog(
  operation: string,
  startTime: number,
  logger: ILogger,
  nodeName: string = 'unknown',
  nodeId: string = 'unknown',
  index: number = 0,
  component?: string,
  functionName?: string
): void {
  const duration = Date.now() - startTime;
  logger.info(formatStandardLog(
    nodeName,
    operation,
    component || 'Core',
    functionName,
    `Operation completed in ${duration}ms`
  ));
}

/**
 * Standardized way to build response data
 * Centralizes the logic for creating proper n8n-compatible responses
 */
export function buildNodeResponse(data: IDataObject): { json: IDataObject } {
  return { json: data };
}
