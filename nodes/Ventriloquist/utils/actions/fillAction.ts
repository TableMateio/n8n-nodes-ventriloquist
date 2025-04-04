import type { IDataObject, Logger as ILogger } from 'n8n-workflow';
import type * as puppeteer from 'puppeteer-core';
import { formatOperationLog } from '../resultUtils';
import { processFormField } from '../formOperations';

/**
 * Interface for fill action parameters
 */
export interface IFillActionParameters {
  selector: string;
  value?: string;
  fieldType?: string;
  clearField?: boolean;
  pressEnter?: boolean;
  checkState?: string;
  checked?: boolean;
  filePath?: string;
}

/**
 * Interface for fill action options
 */
export interface IFillActionOptions {
  nodeName: string;
  nodeId: string;
  index: number;
  useHumanDelays?: boolean;
}

/**
 * Interface for fill action result
 */
export interface IFillActionResult {
  success: boolean;
  details: IDataObject;
  error?: Error;
}

/**
 * Execute a form fill action on the page
 */
export async function executeFillAction(
  page: puppeteer.Page,
  parameters: IFillActionParameters,
  options: IFillActionOptions,
  logger: ILogger
): Promise<IFillActionResult> {
  const {
    selector,
    value = '',
    fieldType = 'text',
    clearField = true,
    pressEnter = false,
    checkState = 'check',
    checked = true,
    filePath = ''
  } = parameters;
  const { nodeName, nodeId, index, useHumanDelays = false } = options;

  if (!selector) {
    return {
      success: false,
      details: { error: 'No selector provided for fill action' },
      error: new Error('No selector provided for fill action')
    };
  }

  try {
    logger.info(formatOperationLog('FillAction', nodeName, nodeId, index,
      `Executing form fill on "${selector}" (type: ${fieldType})`));

    // Process the form field using our utility function
    const field: IDataObject = {
      fieldType,
      selector,
      value,
      // Add options based on field type
      ...(fieldType === 'text' || fieldType === 'textarea' ? {
        clearField,
        humanLike: useHumanDelays,
        pressEnter
      } : {}),
      ...(fieldType === 'checkbox' ? {
        checked
      } : {}),
      ...(fieldType === 'radio' ? {
        checkState
      } : {}),
      ...(fieldType === 'file' ? {
        filePath
      } : {})
    };

    const { success, fieldResult } = await processFormField(
      page,
      field,
      logger
    );

    if (!success) {
      throw new Error(`Failed to fill form field: ${selector} (type: ${fieldType})`);
    }

    return {
      success: true,
      details: {
        ...fieldResult
      }
    };
  } catch (error) {
    logger.error(formatOperationLog('FillAction', nodeName, nodeId, index,
      `Error during fill action: ${(error as Error).message}`));

    return {
      success: false,
      details: {
        selector,
        fieldType,
        value
      },
      error: error as Error
    };
  }
}
