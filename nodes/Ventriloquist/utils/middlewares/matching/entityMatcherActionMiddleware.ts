import type { Logger as ILogger } from 'n8n-workflow';
import type { Page, ElementHandle } from 'puppeteer-core';
import { type IMiddleware, type IMiddlewareContext } from '../middleware';
import { type IMiddlewareRegistration, type MiddlewareType } from '../middlewareRegistry';
import {
  type IEntityMatcherActionInput,
  type IEntityMatcherActionOutput,
  type IEntityMatchResult
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

    logger.debug(`${logPrefix} Starting action with config: ${JSON.stringify({
      action: actionConfig.action,
      actionSelector: actionConfig.actionSelector || '(use match element)',
      actionAttribute: actionConfig.actionAttribute || '(none)',
      waitAfterAction: actionConfig.waitAfterAction,
      waitTime: actionConfig.waitTime,
      waitSelector: actionConfig.waitSelector
    })}`);

    try {
      // If no action or no selected match, return early
      if (actionConfig.action === 'none' || !selectedMatch) {
        logger.info(`${logPrefix} No action performed: ${!selectedMatch ? 'No selected match' : 'Action type is none'}`);
        return {
          success: true,
          actionPerformed: false
        };
      }

      logger.info(`${logPrefix} Performing ${actionConfig.action} action on matched entity (index: ${selectedMatch.index})`);

      // Get the element to perform action on
      let actionElement: ElementHandle<Element> | null = null;

      if (actionConfig.actionSelector) {
        // If an action selector is provided, use it with the match element as context
        try {
          const matchElement = selectedMatch.element as ElementHandle<Element>;
          actionElement = await matchElement.$(actionConfig.actionSelector);

          if (!actionElement) {
            // Try with page context as fallback
            logger.debug(`${logPrefix} Action element not found within match element, trying with page context`);
            actionElement = await page.$(actionConfig.actionSelector);
          }
        } catch (error) {
          logger.warn(`${logPrefix} Error finding action element with selector "${actionConfig.actionSelector}": ${(error as Error).message}`);
          actionElement = null;
        }
      } else {
        // If no action selector provided, use the match element itself
        actionElement = selectedMatch.element as ElementHandle<Element>;
      }

      // If no action element found, return error
      if (!actionElement) {
        const errorMessage = actionConfig.actionSelector
          ? `Action element not found with selector: ${actionConfig.actionSelector}`
          : 'No valid element to perform action on';

        logger.warn(`${logPrefix} ${errorMessage}`);
        return {
          success: false,
          actionPerformed: false,
          error: errorMessage
        };
      }

      // Perform the specified action
      let actionResult: any = null;

      if (actionConfig.action === 'click') {
        // Perform click action
        logger.debug(`${logPrefix} Clicking element`);
        await actionElement.click();
        actionResult = { clicked: true };
        logger.info(`${logPrefix} Click action performed successfully`);
      } else if (actionConfig.action === 'extract') {
        // Extract data from element
        logger.debug(`${logPrefix} Extracting data from element`);

        if (actionConfig.actionAttribute) {
          // Extract attribute value
          actionResult = await page.evaluate(
            (el, attr) => el.getAttribute(attr) || '',
            actionElement,
            actionConfig.actionAttribute
          );

          logger.debug(`${logPrefix} Extracted attribute "${actionConfig.actionAttribute}" value: ${actionResult}`);
        } else {
          // Extract text content
          actionResult = await page.evaluate(
            el => el.textContent || '',
            actionElement
          );

          logger.debug(`${logPrefix} Extracted text content: ${actionResult}`);
        }

        logger.info(`${logPrefix} Extract action performed successfully`);
      }

      // Handle wait behavior after action
      if (actionConfig.waitAfterAction) {
        if (actionConfig.waitSelector) {
          // Wait for a specific selector to appear
          logger.debug(`${logPrefix} Waiting for selector after action: ${actionConfig.waitSelector}`);

          try {
            const timeout = actionConfig.waitTime || 5000;
            await page.waitForSelector(actionConfig.waitSelector, { timeout });
            logger.debug(`${logPrefix} Wait selector condition met`);
          } catch (error) {
            logger.warn(`${logPrefix} Timeout waiting for selector "${actionConfig.waitSelector}": ${(error as Error).message}`);
          }
        } else if (actionConfig.waitTime && actionConfig.waitTime > 0) {
          // Wait for a specific amount of time
          logger.debug(`${logPrefix} Waiting for ${actionConfig.waitTime}ms after action`);
          await new Promise(resolve => setTimeout(resolve, actionConfig.waitTime));
          logger.debug(`${logPrefix} Wait time completed`);
        } else {
          // Default wait - just a short pause
          logger.debug(`${logPrefix} Waiting for default time (500ms) after action`);
          await new Promise(resolve => setTimeout(resolve, 500));
        }
      }

      // Return successful result
      return {
        success: true,
        actionPerformed: true,
        actionResult
      };
    } catch (error) {
      // Handle any unexpected errors
      logger.error(`${logPrefix} Action failed: ${(error as Error).message}`);
      return {
        success: false,
        actionPerformed: false,
        error: `Entity action failed: ${(error as Error).message}`
      };
    }
  }
}

/**
 * Create middleware registration for entity matcher action middleware
 */
export function createEntityMatcherActionMiddlewareRegistration(): IMiddlewareRegistration<IEntityMatcherActionInput, IEntityMatcherActionOutput> {
  return {
    id: 'entity-matcher-action',
    type: 'action' as MiddlewareType,
    name: 'Entity Matcher Action Middleware',
    description: 'Performs actions on matched entities',
    middleware: new EntityMatcherActionMiddleware(),
    version: '1.0.0',
    tags: ['entity-matcher', 'action', 'click', 'extract'],
    configSchema: {
      type: 'object',
      properties: {
        selectedMatch: {
          type: 'object',
          description: 'The selected match to perform an action on'
        },
        actionConfig: {
          type: 'object',
          properties: {
            action: {
              type: 'string',
              enum: ['click', 'extract', 'none'],
              description: 'Action to perform on the matched entity'
            },
            actionSelector: {
              type: 'string',
              description: 'CSS selector for the element to act on relative to the matched item'
            },
            actionAttribute: {
              type: 'string',
              description: 'Attribute to extract when action is "extract"'
            },
            waitAfterAction: {
              type: 'boolean',
              description: 'Whether to wait after performing the action'
            },
            waitTime: {
              type: 'number',
              description: 'Time to wait in milliseconds'
            },
            waitSelector: {
              type: 'string',
              description: 'CSS selector to wait for after action'
            }
          },
          required: ['action']
        }
      },
      required: ['actionConfig']
    }
  };
}
