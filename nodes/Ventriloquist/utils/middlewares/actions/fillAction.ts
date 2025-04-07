import type { IDataObject, Logger as ILogger } from 'n8n-workflow';
import type * as puppeteer from 'puppeteer-core';
import { formatOperationLog } from '../../resultUtils';
import { processFormField } from '../../formOperations';
import { submitFormAndWaitForNavigation } from '../../navigationUtils';

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
  waitAfterAction?: string;
  waitTime?: number;
  waitSelector?: string;
}

/**
 * Interface for fill action options
 */
export interface IFillActionOptions {
  nodeName: string;
  nodeId: string;
  index: number;
  useHumanDelays?: boolean;
  selectorTimeout?: number;
  sessionId: string;
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
  urlChanged?: boolean;
  navigationSuccessful?: boolean;
}

/**
 * Execute a form fill action on the page
 * Extracted as a middleware to be reused across different operations
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
  let urlChanged = false;

  const {
    selector,
    value = '',
    fieldType = 'text',
    clearField = true,
    pressEnter = false,
    checkState = 'check',
    checked = true,
    filePath = '',
    waitAfterAction = 'noWait',
    waitTime = 15000,
    waitSelector
  } = parameters;

  const {
    nodeName,
    nodeId,
    index,
    useHumanDelays = false,
    sessionId
  } = options;

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

    // Get current URL before the action - this is our "before" state
    const beforeUrl = await page.url();
    const beforeTitle = await page.title();

    logger.info(formatOperationLog('FillAction', nodeName, nodeId, index,
      `Current page before fill action - URL: ${beforeUrl}, Title: ${beforeTitle}`));

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

      logger.info(formatOperationLog('FillAction', nodeName, nodeId, index,
        `Successfully filled form field: ${selector} (type: ${fieldType})`));

      // If we're not waiting for anything after the fill, return immediately
      if (waitAfterAction === 'noWait' && !pressEnter) {
        return {
          success: true,
          details: {
            ...fieldResult,
            beforeUrl,
            beforeTitle
          }
        };
      }

      // If enter is pressed, this might cause navigation, so we need additional handling
      if (pressEnter) {
        logger.info(formatOperationLog('FillAction', nodeName, nodeId, index,
          'Enter key pressed - this may trigger form submission or navigation'));

        if (waitAfterAction === 'urlChanged' || waitAfterAction === 'anyUrlChange') {
          try {
            // Store the initial URL for comparison
            const initialUrl = await page.url();

            // Use the simpler navigation approach
            logger.info(`Using submitFormAndWaitForNavigation utility with ${pressEnter ? 'Enter key' : 'direct action'}`);

            const navigationResult = await submitFormAndWaitForNavigation(sessionId, {
              timeout: 30000,
              waitUntil: 'networkidle0',
              stabilizationDelay: 2000,
              logger
            });

            if (navigationResult.success) {
              let finalUrl = '';
              let finalTitle = '';
              let urlChanged = false;
              let contextDestroyed = false;
              let pageReconnected = false;

              try {
                // Get the page state - use new page reference if provided
                const activePage = navigationResult.newPage || page;
                pageReconnected = !!navigationResult.newPage;

                finalUrl = await activePage.url();
                finalTitle = await activePage.title();
                urlChanged = finalUrl !== initialUrl;

                logger.info(formatOperationLog('FillAction', nodeName, nodeId, index,
                  `Navigation after form fill completed - URL changed: ${urlChanged}, New URL: ${finalUrl}`));

                return {
                  success: true,
                  urlChanged,
                  navigationSuccessful: true,
                  pageReconnected,
                  details: {
                    selector,
                    fieldType,
                    value,
                    pressEnter,
                    waitAfterAction,
                    waitTime,
                    beforeUrl: initialUrl,
                    finalUrl,
                    beforeTitle,
                    finalTitle,
                    urlChanged,
                    navigationSuccessful: true,
                    reconnectedPage: pageReconnected
                  }
                };
              } catch (stateError) {
                // Handle context destruction
                contextDestroyed = (stateError as Error).message.includes('context was destroyed') ||
                                  (stateError as Error).message.includes('Execution context');

                logger.warn(formatOperationLog('FillAction', nodeName, nodeId, index,
                  `Could not get page state after navigation: ${(stateError as Error).message}`));

                // Try to get a fallback page
                try {
                  const pages = await browser.pages();
                  if (pages.length > 0) {
                    const newPage = pages[pages.length - 1];
                    finalUrl = await newPage.url();
                    urlChanged = finalUrl !== initialUrl;

                    logger.info(formatOperationLog('FillAction', nodeName, nodeId, index,
                      `Using fallback page after navigation - URL: ${finalUrl}, URL changed: ${urlChanged}`));

                    return {
                      success: true,
                      contextDestroyed,
                      urlChanged,
                      navigationSuccessful: true,
                      pageReconnected: true,
                      details: {
                        selector,
                        fieldType,
                        value,
                        pressEnter,
                        waitAfterAction,
                        waitTime,
                        beforeUrl: initialUrl,
                        finalUrl,
                        urlChanged,
                        navigationSuccessful: true,
                        reconnectedPage: true
                      }
                    };
                  }
                } catch (pageError) {
                  logger.warn(formatOperationLog('FillAction', nodeName, nodeId, index,
                    `Error getting browser pages: ${(pageError as Error).message}`));
                }

                // Return success even if we couldn't get page state
                return {
                  success: true,
                  contextDestroyed,
                  urlChanged: true, // Assume URL changed since context was destroyed
                  navigationSuccessful: true,
                  details: {
                    selector,
                    fieldType,
                    value,
                    pressEnter,
                    waitAfterAction,
                    waitTime,
                    beforeUrl: initialUrl,
                    contextDestroyed,
                    urlChanged: true,
                    navigationSuccessful: true
                  }
                };
              }
            } else {
              // Navigation failed
              logger.warn(formatOperationLog('FillAction', nodeName, nodeId, index,
                'Form submission did not result in navigation'));

              return {
                success: true,
                urlChanged: false,
                navigationSuccessful: false,
                details: {
                  selector,
                  fieldType,
                  value,
                  pressEnter,
                  waitAfterAction,
                  waitTime,
                  beforeUrl: initialUrl,
                  urlChanged: false,
                  navigationSuccessful: false,
                  info: 'Form fill succeeded but did not result in navigation'
                }
              };
            }
          } catch (navigationError) {
            logger.error(formatOperationLog('FillAction', nodeName, nodeId, index,
              `Error during navigation after form fill: ${(navigationError as Error).message}`));

            // Still return success for the form fill itself
            return {
              success: true,
              details: {
                selector,
                fieldType,
                value,
                pressEnter,
                waitAfterAction,
                waitTime,
                error: (navigationError as Error).message
              }
            };
          }
        }
        // Handle fixed time waiting
        else if (waitAfterAction === 'fixedTime') {
          logger.info(formatOperationLog('FillAction', nodeName, nodeId, index,
            `Waiting fixed time after form fill: ${waitTime}ms`));

          await new Promise(resolve => setTimeout(resolve, waitTime));

          // Try to get the current URL after fixed time wait
          try {
            const afterUrl = await page.url();
            const afterTitle = await page.title();

            // Check if URL changed during fixed time wait
            urlChanged = afterUrl !== beforeUrl;

            logger.info(formatOperationLog('FillAction', nodeName, nodeId, index,
              `After fixed time wait - URL: ${afterUrl}, Title: ${afterTitle}, URL changed: ${urlChanged}`));
          } catch (contextError) {
            // Handle context destruction during fixed time wait
            if ((contextError as Error).message.includes('context was destroyed') ||
                (contextError as Error).message.includes('Execution context')) {
              contextDestroyed = true;
              urlChanged = true; // Assume URL changed if context was destroyed

              logger.info(formatOperationLog('FillAction', nodeName, nodeId, index,
                'Context destruction detected during fixed time wait - navigation likely successful'));
            } else {
              logger.warn(formatOperationLog('FillAction', nodeName, nodeId, index,
                `Error checking state after fixed time wait: ${(contextError as Error).message}`));
            }
          }
        }

        // If context was destroyed, attempt to reconnect
        if (contextDestroyed) {
          // Add a recovery delay
          const recoveryDelay = 5000;
          logger.info(formatOperationLog('FillAction', nodeName, nodeId, index,
            `Adding recovery delay (${recoveryDelay}ms)`));
          await new Promise(resolve => setTimeout(resolve, recoveryDelay));

          // Try to reconnect to the page
          try {
            logger.info(formatOperationLog('FillAction', nodeName, nodeId, index,
              'Attempting to reconnect to active page after context destruction'));

            const pages = await browser.pages();
            if (pages.length > 0) {
              // Use the last page as it's likely the one after navigation
              reconnectedPage = pages[pages.length - 1];
              logger.info(formatOperationLog('FillAction', nodeName, nodeId, index,
                `Successfully reconnected to page (${pages.length} pages found)`));

              // Try to get URL of reconnected page
              try {
                const reconnectedUrl = await reconnectedPage.url();
                const reconnectedTitle = await reconnectedPage.title();

                // Compare with before URL to confirm change
                urlChanged = reconnectedUrl !== beforeUrl;

                logger.info(formatOperationLog('FillAction', nodeName, nodeId, index,
                  `Reconnected page state - URL: ${reconnectedUrl}, Title: ${reconnectedTitle}, URL changed: ${urlChanged}`));
              } catch (urlError) {
                logger.warn(formatOperationLog('FillAction', nodeName, nodeId, index,
                  `Could not get URL of reconnected page: ${(urlError as Error).message}`));
              }
            } else {
              logger.warn(formatOperationLog('FillAction', nodeName, nodeId, index,
                'No pages found in browser after navigation'));
            }
          } catch (reconnectError) {
            logger.warn(formatOperationLog('FillAction', nodeName, nodeId, index,
              `Failed to reconnect to page: ${(reconnectError as Error).message}`));
          }
        }

        // Try to get final page state
        let finalUrl = '';
        let finalTitle = '';
        let stateRecovered = false;

        try {
          // Use the reconnected page if available, otherwise the original page
          const activePage = reconnectedPage || page;

          finalUrl = await activePage.url();
          finalTitle = await activePage.title();
          stateRecovered = true;

          // Update URL changed flag based on final URL
          if (finalUrl !== beforeUrl) {
            urlChanged = true;
            logger.info(formatOperationLog('FillAction', nodeName, nodeId, index,
              `URL change confirmed: ${beforeUrl} → ${finalUrl}`));
          }

          logger.info(formatOperationLog('FillAction', nodeName, nodeId, index,
            `Final page state - URL: ${finalUrl}, Title: ${finalTitle}`));
        } catch (stateError) {
          logger.warn(formatOperationLog('FillAction', nodeName, nodeId, index,
            `Could not get final page state: ${(stateError as Error).message}`));
        }

        // Handle specific selector waiting if needed
        if (waitAfterAction === 'waitForSelector' && waitSelector) {
          try {
            logger.info(formatOperationLog('FillAction', nodeName, nodeId, index,
              `Waiting for selector "${waitSelector}" (timeout: ${waitTime}ms)`));

            await page.waitForSelector(waitSelector, { timeout: waitTime });

            logger.info(formatOperationLog('FillAction', nodeName, nodeId, index,
              `Successfully found selector "${waitSelector}"`));
          } catch (selectorError) {
            // Check if this is context destruction
            if ((selectorError as Error).message.includes('context was destroyed') ||
                (selectorError as Error).message.includes('Execution context')) {
              contextDestroyed = true;

              logger.info(formatOperationLog('FillAction', nodeName, nodeId, index,
                'Context destruction detected during selector wait - navigation likely successful'));

              // No need to do anything else as we'll handle this in the return below
            } else {
              logger.warn(formatOperationLog('FillAction', nodeName, nodeId, index,
                `Error waiting for selector "${waitSelector}": ${(selectorError as Error).message}`));
            }
          }
        }

        // Determine navigation success based on context destruction or URL change
        const navigationSuccessful = contextDestroyed || urlChanged;

        if (navigationSuccessful) {
          logger.info(formatOperationLog('FillAction', nodeName, nodeId, index,
            `Navigation successful - URL Changed: ${urlChanged}, Context Destroyed: ${contextDestroyed}`));
        } else {
          logger.info(formatOperationLog('FillAction', nodeName, nodeId, index,
            'No navigation detected after form fill with Enter key'));
        }

        return {
          success: true,
          contextDestroyed,
          urlChanged,
          navigationSuccessful,
          pageReconnected: !!reconnectedPage,
          details: {
            selector,
            fieldType,
            value,
            pressEnter,
            waitAfterAction,
            waitTime,
            beforeUrl,
            finalUrl: stateRecovered ? finalUrl : 'unknown',
            beforeTitle,
            finalTitle: stateRecovered ? finalTitle : 'unknown',
            contextDestroyed,
            urlChanged,
            navigationSuccessful,
            reconnectedPage: !!reconnectedPage
          }
        };
      }

      // For non-Enter key form fills, just return success
      return {
        success: true,
        details: {
          ...fieldResult,
          beforeUrl,
          beforeTitle
        }
      };
    } catch (processError) {
      // Check if the error indicates context destruction
      if ((processError as Error).message.includes('context was destroyed') ||
          (processError as Error).message.includes('Execution context')) {
        contextDestroyed = true;
        logger.info(formatOperationLog('FillAction', nodeName, nodeId, index,
          'Context was destroyed during form field processing - this indicates navigation'));

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
              const reconnectedUrl = await reconnectedPage.url();

              // Compare with before URL to confirm change
              urlChanged = reconnectedUrl !== beforeUrl;

              logger.info(formatOperationLog('FillAction', nodeName, nodeId, index,
                `Page after reconnection - URL: ${reconnectedUrl}, URL changed: ${urlChanged}`));
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
          contextDestroyed,
          urlChanged,
          navigationSuccessful: true,
          pageReconnected: !!reconnectedPage,
          details: {
            selector,
            fieldType,
            value,
            beforeUrl,
            info: 'Navigation likely successful due to context destruction',
            contextDestroyed: true,
            urlChanged,
            navigationSuccessful: true
          }
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
        value,
        error: (error as Error).message
      },
      error: error as Error
    };
  }
}
