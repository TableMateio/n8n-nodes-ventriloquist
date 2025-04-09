import type { IDataObject, Logger as ILogger } from 'n8n-workflow';
import type * as puppeteer from 'puppeteer-core';
import { formatOperationLog } from '../../resultUtils';
import { waitAndClick } from '../../clickOperations';
import { navigateWithRetry } from '../../navigationUtils';
import { takeScreenshot } from '../../navigationUtils';
import type { ActionType, IActionOptions, IActionParameters } from '../../actions/actionUtils';
import { executeAction } from '../../actions/actionUtils';

/**
 * Interface for fallback options
 */
export interface IFallbackOptions {
  enableFallback: boolean;
  fallbackAction: string;
  fallbackSelector?: string;
  fallbackUrl?: string;
  fallbackTimeout?: number;
  fallbackInputType?: string;
  fallbackText?: string;
  fallbackCheckState?: string;
  fallbackClearField?: boolean;
  fallbackPressEnter?: boolean;
  fallbackFilePath?: string;
  sessionId?: string;
}

/**
 * Interface for execute fallback result
 */
export interface IFallbackResult {
  success: boolean;
  actionType?: string;
  details?: IDataObject;
  error?: Error;
}

/**
 * Execute fallback actions using middleware pattern
 * This extracts the fallback logic from fallbackUtils.ts into a reusable middleware
 */
export async function executeFallbackAction(
  page: puppeteer.Page,
  options: IFallbackOptions,
  context: {
    nodeName: string;
    nodeId: string;
    index: number;
    resultData: IDataObject;
    sessionId: string;
  },
  logger: ILogger
): Promise<IFallbackResult> {
  const { nodeName, nodeId, index, resultData, sessionId } = context;

  // Quick return if fallback is disabled
  if (!options.enableFallback) {
    return {
      success: false,
      details: { reason: 'Fallback is disabled' }
    };
  }

  const fallbackAction = options.fallbackAction || 'none';

  // If fallback action is none, then nothing to do
  if (fallbackAction === 'none') {
    logger.debug(formatOperationLog('FallbackMiddleware', nodeName, nodeId, index,
      'No fallback action specified, skipping fallback'));
    return {
      success: false,
      details: { reason: 'No fallback action specified' }
    };
  }

  // Default timeout for fallback operations
  const fallbackTimeout = options.fallbackTimeout || 30000;

  logger.info(formatOperationLog('FallbackMiddleware', nodeName, nodeId, index,
    `Executing fallback action: ${fallbackAction}`));

  try {
    // Execute the appropriate fallback action
    switch (fallbackAction) {
      case 'click': {
        // Validate required parameters
        if (!options.fallbackSelector) {
          throw new Error('Missing required parameter: fallbackSelector');
        }

        const fallbackSelector = options.fallbackSelector;

        logger.info(formatOperationLog('FallbackMiddleware', nodeName, nodeId, index,
          `Attempting fallback click on selector: ${fallbackSelector}`));

        // Perform click - using the correct signature
        const clickResult = await waitAndClick(
          page,
          fallbackSelector,
          {
            waitTimeout: fallbackTimeout,
            logger: logger
          }
        );

        if (!clickResult.success) {
          throw new Error(`Failed to click on selector: ${fallbackSelector} - ${clickResult.error?.message || 'Unknown error'}`);
        }

        logger.info(formatOperationLog('FallbackMiddleware', nodeName, nodeId, index,
          'Fallback click action completed successfully'));

        // Store the fallback action in the result data
        resultData.fallbackAction = {
          type: 'click',
          selector: fallbackSelector,
          success: true,
        };

        // Take a screenshot after the fallback action
        try {
          const screenshot = await takeScreenshot(page, logger);
          if (screenshot) {
            resultData.fallbackActionScreenshot = screenshot;
          }
        } catch (screenshotError) {
          logger.warn(formatOperationLog('FallbackMiddleware', nodeName, nodeId, index,
            `Failed to take screenshot after fallback action: ${(screenshotError as Error).message}`));
        }

        return {
          success: true,
          actionType: 'click',
          details: {
            selector: fallbackSelector
          }
        };
      }

      case 'navigate': {
        // Validate required parameters
        if (!options.fallbackUrl) {
          throw new Error('Missing required parameter: fallbackUrl');
        }

        const fallbackUrl = options.fallbackUrl;

        logger.info(formatOperationLog('FallbackMiddleware', nodeName, nodeId, index,
          `Attempting fallback navigation to: ${fallbackUrl}`));

        // Perform navigation with correct signature
        const navigationResult = await navigateWithRetry(
          page,
          fallbackUrl,
          {
            waitUntil: 'domcontentloaded',
            timeout: fallbackTimeout as number,
            maxRetries: 2,
            retryDelay: 1000,
          },
          logger
        );

        if (!navigationResult) {
          logger.warn(formatOperationLog('FallbackMiddleware', nodeName, nodeId, index,
            'Fallback navigation may have encountered issues, but continuing execution'));
        } else {
          logger.info(formatOperationLog('FallbackMiddleware', nodeName, nodeId, index,
            `Fallback navigation completed successfully to ${fallbackUrl}`));
        }

        // Store the fallback action in the result data
        resultData.fallbackAction = {
          type: 'navigate',
          url: fallbackUrl,
          success: !!navigationResult,
        };

        // Take a screenshot after the fallback action
        try {
          const screenshot = await takeScreenshot(page, logger);
          if (screenshot) {
            resultData.fallbackActionScreenshot = screenshot;
          }
        } catch (screenshotError) {
          logger.warn(formatOperationLog('FallbackMiddleware', nodeName, nodeId, index,
            `Failed to take screenshot after fallback action: ${(screenshotError as Error).message}`));
        }

        return {
          success: !!navigationResult,
          actionType: 'navigate',
          details: {
            url: fallbackUrl
          }
        };
      }

      case 'fill': {
        // Validate required parameters
        if (!options.fallbackSelector) {
          throw new Error('Missing required parameter: fallbackSelector');
        }

        const fallbackSelector = options.fallbackSelector;
        const fallbackInputType = options.fallbackInputType || 'text';
        const fallbackText = options.fallbackText || '';

        // Prepare field options based on input type
        let checked = true;
        let checkState = 'check';
        let clearField = false;
        let pressEnter = false;
        let filePath = '';

        // Extract the appropriate parameters based on input type
        if (fallbackInputType === 'checkbox' || fallbackInputType === 'radio') {
          checkState = options.fallbackCheckState || 'check';
          checked = checkState === 'check';
        } else if (fallbackInputType === 'text') {
          clearField = options.fallbackClearField || false;
          pressEnter = options.fallbackPressEnter || false;
        } else if (fallbackInputType === 'file') {
          filePath = options.fallbackFilePath || '';
        }

        logger.info(formatOperationLog('FallbackMiddleware', nodeName, nodeId, index,
          `Attempting fallback fill on selector: ${fallbackSelector} with type: ${fallbackInputType}`));

        // Create action parameters
        const actionParameters: IActionParameters = {
          selector: fallbackSelector,
          fieldType: fallbackInputType,
          value: fallbackText,
          clearField,
          pressEnter,
          checked,
          checkState,
          filePath
        };

        // Create action options
        const actionOptions: IActionOptions = {
          waitForSelector: true,
          selectorTimeout: fallbackTimeout,
          detectionMethod: 'standard',
          earlyExitDelay: 500,
          nodeName,
          nodeId,
          index,
          useHumanDelays: false,
          sessionId
        };

        // Execute the fill action using the action utils
        const actionResult = await executeAction(
          sessionId,
          'fill' as ActionType,
          actionParameters,
          actionOptions,
          logger
        );

        // Handle result
        if (!actionResult.success) {
          const errorMessage = actionResult.error instanceof Error ?
            actionResult.error.message :
            String(actionResult.error || 'Unknown error');

          logger.warn(formatOperationLog('FallbackMiddleware', nodeName, nodeId, index,
            `Fallback fill action failed: ${errorMessage}`));
        } else {
          logger.info(formatOperationLog('FallbackMiddleware', nodeName, nodeId, index,
            'Fallback fill action completed successfully'));
        }

        // Store the fallback action in the result data
        resultData.fallbackAction = {
          type: 'fill',
          selector: fallbackSelector,
          inputType: fallbackInputType,
          success: actionResult.success,
          details: actionResult.details
        };

        // Take a screenshot after the fallback action
        try {
          const screenshot = await takeScreenshot(page, logger);
          if (screenshot) {
            resultData.fallbackActionScreenshot = screenshot;
          }
        } catch (screenshotError) {
          logger.warn(formatOperationLog('FallbackMiddleware', nodeName, nodeId, index,
            `Failed to take screenshot after fallback action: ${(screenshotError as Error).message}`));
        }

        return {
          success: actionResult.success,
          actionType: 'fill',
          details: actionResult.details,
          error: actionResult.error instanceof Error ?
            actionResult.error :
            actionResult.error ? new Error(String(actionResult.error)) : undefined
        };
      }

      default:
        logger.warn(formatOperationLog('FallbackMiddleware', nodeName, nodeId, index,
          `Unknown fallback action: ${fallbackAction}`));
        return {
          success: false,
          details: { error: `Unknown fallback action: ${fallbackAction}` }
        };
    }
  } catch (error) {
    // Log the error but return a result object rather than throwing
    logger.error(formatOperationLog('FallbackMiddleware', nodeName, nodeId, index,
      `Error executing fallback action: ${(error as Error).message}`));

    // Store the fallback action error in the result data
    resultData.fallbackActionError = {
      message: (error as Error).message,
      stack: (error as Error).stack,
    };

    return {
      success: false,
      actionType: fallbackAction,
      details: {
        action: fallbackAction,
        selector: options.fallbackSelector,
        url: options.fallbackUrl
      },
      error: error as Error
    };
  }
}
