import type { Logger as ILogger } from 'n8n-workflow';
import type { Page } from 'puppeteer-core';
import { type IMiddleware, type IMiddlewareContext } from '../middleware';
import { IMiddlewareRegistration, MiddlewareType } from '../middlewareRegistry';
import {
  type IEntityMatcherActionInput,
  type IEntityMatcherActionOutput
} from '../types/entityMatcherTypes';

/**
 * Entity Matcher Action Middleware
 * Performs actions on matched entities, such as clicking or extracting data
 */
export class EntityMatcherActionMiddleware implements IMiddleware<IEntityMatcherActionInput, IEntityMatcherActionOutput> {
  /**
   * Execute the action process for matched entities
   */
  public async execute(
    input: IEntityMatcherActionInput,
    context: IMiddlewareContext
  ): Promise<IEntityMatcherActionOutput> {
    const { logger, nodeName, nodeId, index = 0 } = context;
    const { page, selectedMatch, actionConfig } = input;
    const logPrefix = `[EntityMatcherAction][${nodeName}][${nodeId}]`;

    try {
      // If no match or action is "none", return immediately
      if (!selectedMatch || actionConfig.action === 'none') {
        logger.info(`${logPrefix} No action to perform (${!selectedMatch ? 'no match selected' : 'action is none'})`);
        return {
          success: true,
          actionPerformed: false
        };
      }

      logger.info(`${logPrefix} Performing ${actionConfig.action} action on matched entity (index: ${selectedMatch.index})`);

      // Perform the appropriate action
      let actionResult: any;

      switch (actionConfig.action) {
        case 'click':
          actionResult = await this.performClickAction(
            page,
            selectedMatch,
            actionConfig,
            logger,
            logPrefix
          );
          break;

        case 'extract':
          actionResult = await this.performExtractAction(
            page,
            selectedMatch,
            actionConfig,
            logger,
            logPrefix
          );
          break;

        default:
          throw new Error(`Unsupported action: ${actionConfig.action}`);
      }

      logger.info(`${logPrefix} Action completed successfully`);

      return {
        success: true,
        actionPerformed: true,
        actionResult
      };
    } catch (error) {
      const errorMessage = (error as Error).message;
      logger.error(`${logPrefix} Error during action execution: ${errorMessage}`);

      return {
        success: false,
        actionPerformed: false,
        error: errorMessage
      };
    }
  }

  /**
   * Perform a click action on the matched element
   */
  private async performClickAction(
    page: Page,
    selectedMatch: IEntityMatcherActionInput['selectedMatch'],
    actionConfig: IEntityMatcherActionInput['actionConfig'],
    logger: ILogger,
    logPrefix: string
  ): Promise<any> {
    if (!selectedMatch) {
      throw new Error('No match selected for click action');
    }

    // Get the element to click on
    const element = selectedMatch.element;

    if (!element) {
      throw new Error('Selected match has no associated element');
    }

    logger.debug(`${logPrefix} Preparing to click on matched element`);

    // If a specific selector is provided, find that element relative to the match
    let targetElement = element;

    if (actionConfig.actionSelector) {
      logger.debug(`${logPrefix} Looking for action selector: ${actionConfig.actionSelector}`);
      targetElement = await element.$(actionConfig.actionSelector);

      if (!targetElement) {
        throw new Error(`Action selector not found: ${actionConfig.actionSelector}`);
      }
    }

    // Capture the current URL for comparison
    const beforeUrl = await page.url();

    // Click the element
    logger.debug(`${logPrefix} Clicking element`);
    await targetElement.click();

    // Handle waiting after action if configured
    if (actionConfig.waitAfterAction) {
      const waitTime = actionConfig.waitTime || 5000;

      if (actionConfig.waitSelector) {
        // Wait for a specific selector to appear
        logger.debug(`${logPrefix} Waiting for selector: ${actionConfig.waitSelector}`);
        await page.waitForSelector(actionConfig.waitSelector, { timeout: waitTime });
      } else {
        // Wait for navigation if no specific selector
        logger.debug(`${logPrefix} Waiting ${waitTime}ms for navigation`);

        try {
          await page.waitForNavigation({ timeout: waitTime });
        } catch (error) {
          // Check if the URL changed even if waitForNavigation timed out
          const afterUrl = await page.url();
          if (beforeUrl === afterUrl) {
            logger.warn(`${logPrefix} No navigation occurred after click`);
          } else {
            logger.info(`${logPrefix} URL changed to: ${afterUrl}`);
          }
        }
      }
    }

    // Capture the final URL and page title
    const afterUrl = await page.url();
    const afterTitle = await page.title();

    return {
      clicked: true,
      beforeUrl,
      afterUrl,
      urlChanged: beforeUrl !== afterUrl,
      afterTitle
    };
  }

  /**
   * Perform an extract action on the matched element
   */
  private async performExtractAction(
    page: Page,
    selectedMatch: IEntityMatcherActionInput['selectedMatch'],
    actionConfig: IEntityMatcherActionInput['actionConfig'],
    logger: ILogger,
    logPrefix: string
  ): Promise<any> {
    if (!selectedMatch) {
      throw new Error('No match selected for extract action');
    }

    // Get the element to extract from
    const element = selectedMatch.element;

    if (!element) {
      throw new Error('Selected match has no associated element');
    }

    logger.debug(`${logPrefix} Preparing to extract data from matched element`);

    // If a specific selector is provided, find that element relative to the match
    let targetElement = element;

    if (actionConfig.actionSelector) {
      logger.debug(`${logPrefix} Looking for action selector: ${actionConfig.actionSelector}`);
      targetElement = await element.$(actionConfig.actionSelector);

      if (!targetElement) {
        throw new Error(`Action selector not found: ${actionConfig.actionSelector}`);
      }
    }

    // Extract the data based on attribute or text content
    let extractedValue: string;

    if (actionConfig.actionAttribute) {
      // Extract attribute value
      logger.debug(`${logPrefix} Extracting attribute: ${actionConfig.actionAttribute}`);
      extractedValue = await page.evaluate(
        (el, attr) => el.getAttribute(attr) || '',
        targetElement,
        actionConfig.actionAttribute
      );
    } else {
      // Extract text content
      logger.debug(`${logPrefix} Extracting text content`);
      extractedValue = await page.evaluate(
        el => el.textContent || '',
        targetElement
      );
    }

    return {
      extracted: true,
      value: extractedValue.trim(),
      attribute: actionConfig.actionAttribute
    };
  }
}

/**
 * Create registration for action middleware
 */
export function createEntityMatcherActionMiddlewareRegistration(): Omit<IMiddlewareRegistration<IEntityMatcherActionInput, IEntityMatcherActionOutput>, 'middleware'> {
  return {
    type: MiddlewareType.ENTITY_MATCHER_ACTION,
    name: 'entityMatcherAction',
    description: 'Performs actions on matched entities',
    version: 1,
  };
}
