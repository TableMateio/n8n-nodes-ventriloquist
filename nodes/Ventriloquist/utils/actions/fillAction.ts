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
  contextDestroyed?: boolean;
  pageReconnected?: boolean;
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
  // Store browser reference for potential reconnection
  const browser = page.browser();
  let reconnectedPage: puppeteer.Page | null = null;
  let contextDestroyed = false;

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

    try {
      const { success, fieldResult } = await processFormField(
        page,
        field,
        logger
      );

      if (!success) {
        throw new Error(`Failed to fill form field: ${selector} (type: ${fieldType})`);
      }

      // If we press Enter in a text field, this can cause navigation,
      // so we should add handling for context destruction
      if (fieldType === 'text' && pressEnter) {
        // Add a small delay to allow for any form submission to start
        logger.info(formatOperationLog('FillAction', nodeName, nodeId, index,
          'Adding stabilization delay after pressing Enter'));
        await new Promise(resolve => setTimeout(resolve, 1000));

        // Check if we can still access the page
        try {
          // Try to access page state to check if context is still valid
          const url = await page.url();
          logger.info(formatOperationLog('FillAction', nodeName, nodeId, index,
            `Page appears stable after pressing Enter - current URL: ${url}`));
        } catch (contextError) {
          // Check if the error indicates context destruction
          if ((contextError as Error).message.includes('context was destroyed') ||
              (contextError as Error).message.includes('Execution context')) {
            contextDestroyed = true;
            logger.info(formatOperationLog('FillAction', nodeName, nodeId, index,
              'Context was destroyed after pressing Enter - likely caused form submission and navigation'));

            // Add recovery delay
            const recoveryDelay = 5000;
            logger.info(formatOperationLog('FillAction', nodeName, nodeId, index,
              `Adding recovery delay (${recoveryDelay}ms)`));
            await new Promise(resolve => setTimeout(resolve, recoveryDelay));

            // Try to reconnect to the page
            try {
              const pages = await browser.pages();
              if (pages.length > 0) {
                // Use the last page as it's likely the one after navigation
                reconnectedPage = pages[pages.length - 1];
                logger.info(formatOperationLog('FillAction', nodeName, nodeId, index,
                  `Reconnected to page (${pages.length} pages found)`));

                // Try to get current URL of reconnected page
                try {
                  const newUrl = await reconnectedPage.url();
                  logger.info(formatOperationLog('FillAction', nodeName, nodeId, index,
                    `Page after reconnection - URL: ${newUrl}`));
                } catch (urlError) {
                  logger.warn(formatOperationLog('FillAction', nodeName, nodeId, index,
                    `Could not get URL after reconnection: ${(urlError as Error).message}`));
                }
              } else {
                logger.warn(formatOperationLog('FillAction', nodeName, nodeId, index,
                  'No pages found in browser after context destruction'));
              }
            } catch (reconnectError) {
              logger.warn(formatOperationLog('FillAction', nodeName, nodeId, index,
                `Failed to reconnect to page: ${(reconnectError as Error).message}`));
            }
          }
        }
      }

      return {
        success: true,
        details: {
          ...fieldResult,
          reconnectedPage: reconnectedPage
        },
        contextDestroyed,
        pageReconnected: !!reconnectedPage
      };
    } catch (processError) {
      // Check if the error indicates context destruction
      if ((processError as Error).message.includes('context was destroyed') ||
          (processError as Error).message.includes('Execution context')) {
        contextDestroyed = true;
        logger.info(formatOperationLog('FillAction', nodeName, nodeId, index,
          'Context was destroyed during form field processing - attempting to reconnect'));

        // Add recovery delay
        const recoveryDelay = 5000;
        logger.info(formatOperationLog('FillAction', nodeName, nodeId, index,
          `Adding recovery delay (${recoveryDelay}ms)`));
        await new Promise(resolve => setTimeout(resolve, recoveryDelay));

        // Try to reconnect to the page
        try {
          const pages = await browser.pages();
          if (pages.length > 0) {
            // Use the last page as it's likely the one after navigation
            reconnectedPage = pages[pages.length - 1];
            logger.info(formatOperationLog('FillAction', nodeName, nodeId, index,
              `Reconnected to page (${pages.length} pages found)`));

            // Try to get current URL of reconnected page
            try {
              const newUrl = await reconnectedPage.url();
              logger.info(formatOperationLog('FillAction', nodeName, nodeId, index,
                `Page after reconnection - URL: ${newUrl}`));
            } catch (urlError) {
              logger.warn(formatOperationLog('FillAction', nodeName, nodeId, index,
                `Could not get URL after reconnection: ${(urlError as Error).message}`));
            }
          } else {
            logger.warn(formatOperationLog('FillAction', nodeName, nodeId, index,
              'No pages found in browser after context destruction'));
          }
        } catch (reconnectError) {
          logger.warn(formatOperationLog('FillAction', nodeName, nodeId, index,
            `Failed to reconnect to page: ${(reconnectError as Error).message}`));
        }

        // Consider this a "success" if context was destroyed, as it likely
        // means the form fill triggered a navigation
        return {
          success: true,
          details: {
            selector,
            fieldType,
            value,
            info: 'Context was destroyed, likely due to navigation',
            reconnectedPage: reconnectedPage
          },
          contextDestroyed: true,
          pageReconnected: !!reconnectedPage
        };
      }

      // For other errors, rethrow
      throw processError;
    }
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
      error: error as Error,
      contextDestroyed,
      pageReconnected: !!reconnectedPage
    };
  }
}
