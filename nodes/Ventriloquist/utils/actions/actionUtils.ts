import type { IDataObject, Logger as ILogger } from 'n8n-workflow';
import type * as puppeteer from 'puppeteer-core';
import { formatOperationLog } from '../resultUtils';
import { executeClickAction } from './clickAction';
import type { IClickActionParameters, IClickActionOptions } from './clickAction';
import { executeFillAction } from './fillAction';
import type { IFillActionParameters, IFillActionOptions } from './fillAction';
import { executeNavigateAction } from './navigateAction';
import type { INavigateActionParameters, INavigateActionOptions } from './navigateAction';

/**
 * Action types supported by the action utilities
 */
export type ActionType = 'click' | 'fill' | 'extract' | 'navigate' | 'none';

/**
 * Interface for general action parameters
 */
export interface IActionParameters {
  // Common parameters - each specialized action interface defines its specific parameters
  selector?: string;
  [key: string]: unknown;
}

/**
 * Interface for general action options
 */
export interface IActionOptions {
  nodeName: string;
  nodeId: string;
  index: number;
  waitForSelector?: boolean;
  selectorTimeout?: number;
  detectionMethod?: string;
  earlyExitDelay?: number;
  useHumanDelays?: boolean;
}

/**
 * Interface for action results
 */
export interface IActionResult {
  success: boolean;
  actionType: ActionType;
  details: IDataObject;
  error?: Error | string;
}

/**
 * Execute an action based on its type
 * This is the main entry point for all action operations
 */
export async function executeAction(
  page: puppeteer.Page,
  actionType: ActionType,
  parameters: IActionParameters,
  options: IActionOptions,
  logger: ILogger
): Promise<IActionResult> {
  // Log action start
  logger.debug(formatOperationLog('ActionUtils', options.nodeName, options.nodeId, options.index,
    `Starting action execution: ${actionType}`));

  try {
    // Execute based on action type
    switch (actionType) {
      case 'click': {
        // Create click-specific parameters
        const clickParams: IClickActionParameters = {
          selector: parameters.selector as string,
          waitAfterAction: parameters.waitAfterAction as string,
          waitTime: parameters.waitTime as number,
          waitSelector: parameters.waitSelector as string
        };

        // Create click-specific options
        const clickOptions: IClickActionOptions = {
          nodeName: options.nodeName,
          nodeId: options.nodeId,
          index: options.index,
          selectorTimeout: options.selectorTimeout
        };

        // Execute the click action
        const result = await executeClickAction(page, clickParams, clickOptions, logger);

        // Convert to generic action result
        return {
          success: result.success,
          actionType: 'click',
          details: result.details,
          error: result.error
        };
      }

      case 'fill': {
        // Create fill-specific parameters
        const fillParams: IFillActionParameters = {
          selector: parameters.selector as string,
          value: parameters.value as string,
          fieldType: parameters.fieldType as string,
          clearField: parameters.clearField as boolean,
          pressEnter: parameters.pressEnter as boolean,
          checkState: parameters.checkState as string,
          checked: parameters.checked as boolean,
          filePath: parameters.filePath as string
        };

        // Create fill-specific options
        const fillOptions: IFillActionOptions = {
          nodeName: options.nodeName,
          nodeId: options.nodeId,
          index: options.index,
          useHumanDelays: options.useHumanDelays
        };

        // Execute the fill action
        const result = await executeFillAction(page, fillParams, fillOptions, logger);

        // Convert to generic action result
        return {
          success: result.success,
          actionType: 'fill',
          details: result.details,
          error: result.error
        };
      }

      case 'extract': {
        // For extraction, use a dynamic import to avoid circular dependencies
        const { executeExtraction } = await import('../middlewares/extractMiddleware');

        // Create extraction options
        const extractOptions = {
          extractionType: parameters.extractionType as string,
          selector: parameters.selector as string,
          attributeName: parameters.attributeName as string,
          outputFormat: parameters.outputFormat as string,
          includeMetadata: parameters.includeMetadata === true,
          includeHeaders: parameters.includeHeaders === true,
          rowSelector: parameters.rowSelector as string,
          cellSelector: parameters.cellSelector as string,
          extractionProperty: parameters.extractionProperty as string,
          limit: Number(parameters.limit) || 0,
          separator: parameters.separator as string,
          waitForSelector: options.waitForSelector === true,
          selectorTimeout: Number(options.selectorTimeout) || 5000,
          detectionMethod: options.detectionMethod as string,
          earlyExitDelay: Number(options.earlyExitDelay) || 500,
          nodeName: options.nodeName,
          nodeId: options.nodeId,
          index: options.index
        };

        // Execute the extraction
        const extractResult = await executeExtraction(page, extractOptions, logger);

        // Convert to generic action result
        return {
          success: extractResult.success,
          actionType: 'extract',
          details: {
            ...(extractResult.details || {}),
            data: extractResult.data,
            selector: extractResult.selector,
            extractionType: extractResult.extractionType
          },
          error: extractResult.error
        };
      }

      case 'navigate': {
        // Create navigate-specific parameters
        const navigateParams: INavigateActionParameters = {
          url: parameters.url as string,
          waitUntil: parameters.waitUntil as string,
          waitTime: parameters.waitTime as number
        };

        // Create navigate-specific options
        const navigateOptions: INavigateActionOptions = {
          nodeName: options.nodeName,
          nodeId: options.nodeId,
          index: options.index
        };

        // Execute the navigate action
        const result = await executeNavigateAction(page, navigateParams, navigateOptions, logger);

        // Convert to generic action result
        return {
          success: result.success,
          actionType: 'navigate',
          details: result.details,
          error: result.error
        };
      }

      case 'none':
        logger.debug(formatOperationLog('ActionUtils', options.nodeName, options.nodeId, options.index,
          'No action requested (action type: none)'));

        return {
          success: true,
          actionType: 'none',
          details: { message: 'No action performed' }
        };

      default:
        logger.error(formatOperationLog('ActionUtils', options.nodeName, options.nodeId, options.index,
          `Unknown action type: ${actionType}`));

        return {
          success: false,
          actionType: actionType,
          details: { error: `Unknown action type: ${actionType}` },
          error: `Unknown action type: ${actionType}`
        };
    }
  } catch (error) {
    logger.error(formatOperationLog('ActionUtils', options.nodeName, options.nodeId, options.index,
      `Error during action execution: ${(error as Error).message}`));

    return {
      success: false,
      actionType,
      details: { error: (error as Error).message },
      error: error as Error
    };
  }
}
