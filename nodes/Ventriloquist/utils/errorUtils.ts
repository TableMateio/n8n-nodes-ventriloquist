import type { Page } from 'puppeteer-core';
import type { IDataObject } from 'n8n-workflow';
import type { ILogger } from './formOperations';
import { takeScreenshot as screenshotUtil } from './navigationUtils';

/**
 * Options for creating a standardized error response
 */
export interface ErrorResponseOptions {
  error: Error | string;
  operation: string;
  sessionId?: string;
  nodeId?: string;
  nodeName?: string;
  url?: string;
  title?: string;
  selector?: string;
  page?: Page | null;
  logger?: ILogger;
  takeScreenshot?: boolean;
  startTime?: number;
  continueOnFail?: boolean;
  additionalData?: IDataObject;
}

/**
 * Create a standardized error response with consistent structure
 * Used across operation files to maintain uniform error responses
 */
export async function createErrorResponse(options: ErrorResponseOptions): Promise<IDataObject> {
  const {
    error,
    operation,
    sessionId = '',
    nodeId = '',
    nodeName = '',
    url = '',
    title = '',
    selector = '',
    page = null,
    logger,
    takeScreenshot = true,
    startTime,
    additionalData = {},
  } = options;

  // Log the error with operation context
  if (logger) {
    const errorMessage = error instanceof Error ? error.message : error;
    logger.error(`[Ventriloquist][${nodeName}][${nodeId}][${operation}] Error: ${errorMessage}`);
  }

  // Create the base error response
  const errorResponse: IDataObject = {
    success: false,
    operation,
    error: error instanceof Error ? error.message : error,
    timestamp: new Date().toISOString(),
    ...(sessionId ? { sessionId } : {}),
    ...(url ? { url } : {}),
    ...(title ? { title } : {}),
    ...(selector ? { selector } : {}),
    ...(startTime ? { executionDuration: Date.now() - startTime } : {}),
    ...additionalData,
  };

  // Add stack trace if available (for debugging)
  if (error instanceof Error && error.stack) {
    errorResponse.errorStack = error.stack;
  }

  // Take a screenshot if requested and page is available
  if (takeScreenshot && page && logger) {
    try {
      const screenshot = await screenshotUtil(page, logger);
      if (screenshot) {
        errorResponse.screenshot = screenshot;
      }
    } catch (screenshotError) {
      if (logger) {
        logger.warn(`Failed to capture error screenshot: ${(screenshotError as Error).message}`);
      }
    }
  }

  return errorResponse;
}

/**
 * Execute a function with proper error handling
 * Centralizes try/catch logic and error response creation
 */
export async function safeExecute<T>(
  fn: () => Promise<T>,
  options: {
    operation: string;
    continueOnFail: boolean;
    logger?: ILogger;
    errorContext?: Partial<ErrorResponseOptions>;
  }
): Promise<{ success: boolean; result?: T; errorResponse?: IDataObject }> {
  const { operation, continueOnFail, logger, errorContext = {} } = options;

  try {
    // Execute the function
    const result = await fn();
    return { success: true, result };
  } catch (error) {
    // Create standardized error response
    const errorResponse = await createErrorResponse({
      error: error as Error,
      operation,
      ...errorContext
    });

    if (logger) {
      logger.error(`Operation "${operation}" failed: ${(error as Error).message}`);
    }

    if (continueOnFail) {
      // Return error response if continueOnFail is true
      return { success: false, errorResponse };
    }

    // Otherwise re-throw the error
    throw error;
  }
}

/**
 * Safe screenshot capture that won't throw if it fails
 */
export async function safeTakeScreenshot(
  page: Page | null,
  logger: ILogger
): Promise<string | null> {
  if (!page) return null;

  try {
    return await screenshotUtil(page, logger);
  } catch (error) {
    logger.warn(`Failed to take screenshot: ${(error as Error).message}`);
    return null;
  }
}

/**
 * Format error message with optional context
 */
export function formatErrorMessage(
  error: Error | string,
  context?: string
): string {
  const errorMessage = error instanceof Error ? error.message : error;
  return context ? `${context}: ${errorMessage}` : errorMessage;
}

/**
 * Safely get current page information (URL and title)
 * Won't throw even if page operations fail
 */
export async function safeGetPageInfo(
  page: Page | null,
  logger?: ILogger
): Promise<{ url: string; title: string }> {
  if (!page) {
    return { url: 'unknown', title: 'unknown' };
  }

  try {
    const url = await page.url();
    const title = await page.title();
    return { url, title };
  } catch (error) {
    if (logger) {
      logger.warn(`Failed to get page info: ${(error as Error).message}`);
    }
    return { url: 'error', title: 'error' };
  }
}
