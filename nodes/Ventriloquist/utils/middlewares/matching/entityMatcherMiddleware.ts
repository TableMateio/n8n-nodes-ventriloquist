import type { IDataObject, Logger as ILogger } from 'n8n-workflow';
import type { Page } from 'puppeteer-core';
import { compareEntities, type IFieldComparisonConfig } from '../../comparisonUtils';
import { type IMiddleware, type IMiddlewareContext } from '../middleware';
import { normalizeText, type ITextNormalizationOptions } from '../../textUtils';

/**
 * Entity matcher input parameters
 */
export interface IEntityMatcherInput {
  page: Page;
  sourceEntity: Record<string, string | null | undefined>;
  resultsSelector: string;
  itemSelector: string;
  extractionConfig: {
    fields: Array<{
      name: string;
      selector: string;
      attribute?: string;
    }>;
  };
  matchingConfig: {
    fieldComparisons: IFieldComparisonConfig[];
    threshold: number;
    normalizationOptions?: ITextNormalizationOptions;
    limitResults?: number;
  };
  actionConfig: {
    action: 'click' | 'extract' | 'none';
    actionSelector?: string;
    actionAttribute?: string;
    waitAfterAction?: boolean;
    waitTime?: number;
  };
}

/**
 * Entity matcher result
 */
export interface IEntityMatcherResult {
  success: boolean;
  matches: Array<{
    index: number;
    fields: Record<string, string>;
    similarities: Record<string, number>;
    overallSimilarity: number;
    selected: boolean;
  }>;
  selectedMatch?: {
    index: number;
    fields: Record<string, string>;
    similarities: Record<string, number>;
    overallSimilarity: number;
  };
  actionPerformed?: boolean;
  actionResult?: any;
  error?: string;
}

/**
 * Entity Matcher Middleware
 * Extracts and compares entities from the webpage against a source entity
 */
export class EntityMatcherMiddleware implements IMiddleware<IEntityMatcherInput, IEntityMatcherResult> {

  /**
   * Execute the entity matching process
   */
  public async execute(
    input: IEntityMatcherInput,
    context: IMiddlewareContext
  ): Promise<IEntityMatcherResult> {
    const { logger, nodeName, nodeId } = context;
    const logPrefix = `[EntityMatcher][${nodeName}][${nodeId}]`;

    try {
      logger.info(`${logPrefix} Starting entity matching process`);

      // 1. Extract items from the page
      const items = await this.extractItems(input, logger, logPrefix);
      if (!items.length) {
        logger.warn(`${logPrefix} No items found with selector: ${input.resultsSelector} > ${input.itemSelector}`);
        return {
          success: false,
          matches: [],
          error: 'No items found on the page',
        };
      }

      logger.info(`${logPrefix} Found ${items.length} items for matching`);

      // 2. Compare each item with the source entity
      const matches = await this.compareItems(items, input, logger, logPrefix);

      // 3. Sort by similarity score
      matches.sort((a, b) => b.overallSimilarity - a.overallSimilarity);

      // 4. Select the best match if it meets the threshold
      const bestMatch = matches[0];
      const selectedMatch = bestMatch.overallSimilarity >= input.matchingConfig.threshold ? bestMatch : undefined;

      if (selectedMatch) {
        logger.info(
          `${logPrefix} Selected best match with similarity: ${selectedMatch.overallSimilarity.toFixed(4)}`
        );
        selectedMatch.selected = true;

        // 5. Perform action on selected match if configured
        if (input.actionConfig.action !== 'none') {
          await this.performAction(input, selectedMatch.index, logger, logPrefix);
        }
      } else {
        logger.warn(
          `${logPrefix} No matches met the threshold (${input.matchingConfig.threshold}). Best similarity: ${
            matches.length > 0 ? matches[0].overallSimilarity.toFixed(4) : 'N/A'
          }`
        );
      }

      return {
        success: true,
        matches,
        selectedMatch: selectedMatch ? {
          index: selectedMatch.index,
          fields: selectedMatch.fields,
          similarities: selectedMatch.similarities,
          overallSimilarity: selectedMatch.overallSimilarity,
        } : undefined,
        actionPerformed: selectedMatch && input.actionConfig.action !== 'none',
      };

    } catch (error) {
      logger.error(`${logPrefix} Error in entity matching: ${(error as Error).message}`);
      return {
        success: false,
        matches: [],
        error: (error as Error).message,
      };
    }
  }

  /**
   * Extract items from the page based on the configured selectors
   */
  private async extractItems(
    input: IEntityMatcherInput,
    logger: ILogger,
    logPrefix: string
  ): Promise<Array<{ index: number; element: any; fields: Record<string, string> }>> {
    const { page, resultsSelector, itemSelector, extractionConfig, matchingConfig } = input;

    try {
      // Wait for the results container to be available
      await page.waitForSelector(resultsSelector, { timeout: 30000 });

      // Get all item elements
      const elements = await page.$$(`${resultsSelector} ${itemSelector}`);
      logger.debug(`${logPrefix} Found ${elements.length} elements matching selector`);

      // Limit the number of results if configured
      const limitedElements = matchingConfig.limitResults && matchingConfig.limitResults > 0
        ? elements.slice(0, matchingConfig.limitResults)
        : elements;

      // Extract data from each element
      const items: Array<{ index: number; element: any; fields: Record<string, string> }> = [];

      for (let i = 0; i < limitedElements.length; i++) {
        const element = limitedElements[i];
        const fields: Record<string, string> = {};

        // Extract each configured field
        for (const field of extractionConfig.fields) {
          try {
            // Find the element by selector
            const fieldElement = await element.$(field.selector);

            if (fieldElement) {
              let value = '';

              // Extract value based on attribute or text content
              if (field.attribute) {
                value = await page.evaluate(
                  (el, attr) => el.getAttribute(attr) || '',
                  fieldElement,
                  field.attribute
                );
              } else {
                value = await page.evaluate(el => el.textContent || '', fieldElement);
              }

              // Normalize the extracted text
              fields[field.name] = normalizeText(
                value,
                matchingConfig.normalizationOptions
              );
            } else {
              fields[field.name] = '';
            }
          } catch (fieldError) {
            logger.debug(
              `${logPrefix} Error extracting field ${field.name}: ${(fieldError as Error).message}`
            );
            fields[field.name] = '';
          }
        }

        items.push({
          index: i,
          element,
          fields,
        });
      }

      return items;
    } catch (error) {
      logger.error(`${logPrefix} Error extracting items: ${(error as Error).message}`);
      throw error;
    }
  }

  /**
   * Compare each extracted item with the source entity
   */
  private async compareItems(
    items: Array<{ index: number; element: any; fields: Record<string, string> }>,
    input: IEntityMatcherInput,
    logger: ILogger,
    logPrefix: string
  ): Promise<Array<{
    index: number;
    fields: Record<string, string>;
    similarities: Record<string, number>;
    overallSimilarity: number;
    selected: boolean;
  }>> {
    const { sourceEntity, matchingConfig } = input;

    return items.map(item => {
      // Compare the item with the source entity
      const comparison = compareEntities(
        sourceEntity,
        item.fields,
        matchingConfig.fieldComparisons,
        logger
      );

      return {
        index: item.index,
        fields: item.fields,
        similarities: comparison.fieldSimilarities,
        overallSimilarity: comparison.overallSimilarity,
        selected: false,
      };
    });
  }

  /**
   * Perform the configured action on the selected item
   */
  private async performAction(
    input: IEntityMatcherInput,
    itemIndex: number,
    logger: ILogger,
    logPrefix: string
  ): Promise<any> {
    try {
      const { page, resultsSelector, itemSelector, actionConfig } = input;

      // Get the element for the selected index
      const elements = await page.$$(`${resultsSelector} ${itemSelector}`);
      if (itemIndex >= elements.length) {
        throw new Error(`Selected index ${itemIndex} is out of bounds (${elements.length} elements)`);
      }

      const element = elements[itemIndex];

      // Perform the configured action
      switch (actionConfig.action) {
        case 'click': {
          let elementToClick;

          if (actionConfig.actionSelector) {
            // Find the specific element to click
            elementToClick = await element.$(actionConfig.actionSelector);
            if (!elementToClick) {
              throw new Error(`Action selector ${actionConfig.actionSelector} not found in element`);
            }
          } else {
            // Click the item element itself
            elementToClick = element;
          }

          // Perform the click
          await elementToClick.click();
          logger.info(`${logPrefix} Clicked on element at index ${itemIndex}`);

          // Wait after action if configured
          if (actionConfig.waitAfterAction) {
            const waitTime = actionConfig.waitTime || 1000;
            await new Promise(resolve => setTimeout(resolve, waitTime));
          }

          return { clicked: true, index: itemIndex };
        }

        case 'extract': {
          // Extract additional data if needed
          if (actionConfig.actionSelector) {
            const extractElement = await element.$(actionConfig.actionSelector);

            if (extractElement) {
              let value;

              if (actionConfig.actionAttribute) {
                value = await page.evaluate(
                  (el, attr) => el.getAttribute(attr) || '',
                  extractElement,
                  actionConfig.actionAttribute
                );
              } else {
                value = await page.evaluate(el => el.textContent || '', extractElement);
              }

              logger.info(`${logPrefix} Extracted value from element at index ${itemIndex}`);
              return { extracted: true, value, index: itemIndex };
            } else {
              throw new Error(`Action selector ${actionConfig.actionSelector} not found in element`);
            }
          } else {
            // Extract the entire element
            const html = await page.evaluate(el => el.outerHTML, element);
            logger.info(`${logPrefix} Extracted HTML from element at index ${itemIndex}`);
            return { extracted: true, html, index: itemIndex };
          }
        }

        default:
          return { action: 'none' };
      }
    } catch (error) {
      logger.error(`${logPrefix} Error performing action: ${(error as Error).message}`);
      throw error;
    }
  }
}
