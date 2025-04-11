import type { Logger as ILogger } from 'n8n-workflow';
import type { Page } from 'puppeteer-core';
import { type IMiddleware, type IMiddlewareContext } from '../middleware';
import { type IMiddlewareRegistration, type MiddlewareType } from '../middlewareRegistry';
import {
  type IEntityMatcherExtractionInput,
  type IEntityMatcherExtractionOutput,
  type IEntityField,
  type IExtractedField,
  type IExtractedItem
} from '../types/entityMatcherTypes';
import { normalizeText } from '../../textUtils';
import { normalizeCompanyName, normalizeProductIdentifier } from '../../advancedTextUtils';

/**
 * Entity Matcher Extraction Middleware
 * Handles extracting entity fields from elements on a page
 */
export class EntityMatcherExtractionMiddleware implements IMiddleware<IEntityMatcherExtractionInput, IEntityMatcherExtractionOutput> {
  /**
   * Execute the extraction process for entity matching
   */
  public async execute(
    input: IEntityMatcherExtractionInput,
    context: IMiddlewareContext
  ): Promise<IEntityMatcherExtractionOutput> {
    const { logger, nodeName, nodeId, index = 0 } = context;
    const { page, extractionConfig } = input;
    const logPrefix = `[EntityMatcherExtraction][${nodeName}][${nodeId}]`;

    try {
      logger.info(`${logPrefix} Starting entity field extraction with ${extractionConfig.fields.length} fields`);

      // Wait for results container if needed
      if (extractionConfig.waitForSelector) {
        const timeout = extractionConfig.selectorTimeout || 30000;
        logger.debug(`${logPrefix} Waiting for results container: ${extractionConfig.resultsSelector} (timeout: ${timeout}ms)`);

        try {
          await page.waitForSelector(extractionConfig.resultsSelector, { timeout });
        } catch (error) {
          throw new Error(`Timeout waiting for results container: ${extractionConfig.resultsSelector}`);
        }
      }

      // Get all items from the results container
      const items = await this.extractItems(
        page,
        extractionConfig.resultsSelector,
        extractionConfig.itemSelector,
        extractionConfig.fields,
        logger,
        logPrefix
      );

      if (items.length === 0) {
        logger.warn(`${logPrefix} No items found matching the selectors`);
        return {
          success: false,
          items: [],
          error: 'No items found matching the selectors'
        };
      }

      logger.info(`${logPrefix} Successfully extracted ${items.length} items with fields`);

      return {
        success: true,
        items
      };
    } catch (error) {
      const errorMessage = (error as Error).message;
      logger.error(`${logPrefix} Error during entity extraction: ${errorMessage}`);

      return {
        success: false,
        items: [],
        error: errorMessage
      };
    }
  }

  /**
   * Extract items from the page
   */
  private async extractItems(
    page: Page,
    resultsSelector: string,
    itemSelector: string,
    fields: IEntityField[],
    logger: ILogger,
    logPrefix: string
  ): Promise<IExtractedItem[]> {
    try {
      // Get elements from the container
      const fullSelector = `${resultsSelector} ${itemSelector}`;
      logger.debug(`${logPrefix} Extracting items using selector: ${fullSelector}`);

      // Get all elements that match the item selector
      const elements = await page.$$(fullSelector);
      logger.debug(`${logPrefix} Found ${elements.length} potential items`);

      if (elements.length === 0) {
        return [];
      }

      // Extract data from each element
      const extractedItems: IExtractedItem[] = [];

      for (let i = 0; i < elements.length; i++) {
        const element = elements[i];
        const extractedFields: Record<string, IExtractedField> = {};
        let missingRequiredField = false;

        // Process each field
        for (const field of fields) {
          try {
            // Extract the field value
            const { original, normalized } = await this.extractField(
              page,
              element,
              field,
              logger,
              logPrefix
            );

            // Store the extracted field
            extractedFields[field.name] = {
              name: field.name,
              value: normalized,
              original,
              normalized
            };
          } catch (error) {
            const errorMessage = (error as Error).message;
            logger.warn(`${logPrefix} Error extracting field '${field.name}' from item ${i}: ${errorMessage}`);

            // Handle required fields
            if (field.required) {
              logger.warn(`${logPrefix} Missing required field '${field.name}' for item ${i}`);
              missingRequiredField = true;
              break;
            }

            // Add empty field for non-required fields
            extractedFields[field.name] = {
              name: field.name,
              value: '',
              original: '',
              normalized: ''
            };
          }
        }

        // Skip items with missing required fields
        if (missingRequiredField) {
          continue;
        }

        // Add the item to the result
        extractedItems.push({
          index: i,
          element,
          fields: extractedFields
        });
      }

      return extractedItems;
    } catch (error) {
      logger.error(`${logPrefix} Error extracting items: ${(error as Error).message}`);
      throw error;
    }
  }

  /**
   * Extract a single field from an element
   */
  private async extractField(
    page: Page,
    parentElement: any,
    field: IEntityField,
    logger: ILogger,
    logPrefix: string
  ): Promise<{ original: string; normalized: string }> {
    try {
      // Find the element with the field selector relative to the parent
      const fieldElement = await parentElement.$(field.selector);

      if (!fieldElement) {
        throw new Error(`Field element not found with selector: ${field.selector}`);
      }

      // Extract the value based on attribute or text content
      let originalValue = '';

      if (field.attribute) {
        originalValue = await page.evaluate(
          (el, attr) => el.getAttribute(attr) || '',
          fieldElement,
          field.attribute
        );
      } else {
        originalValue = await page.evaluate(
          el => el.textContent || '',
          fieldElement
        );
      }

      // Apply field-specific normalization
      let normalizedValue = this.normalizeFieldValue(
        originalValue,
        field.name,
        field.normalizationOptions
      );

      return {
        original: originalValue.trim(),
        normalized: normalizedValue
      };
    } catch (error) {
      logger.warn(`${logPrefix} Error extracting field '${field.name}': ${(error as Error).message}`);
      throw error;
    }
  }

  /**
   * Normalize field value based on field name and options
   */
  private normalizeFieldValue(
    value: string,
    fieldName: string,
    options?: any
  ): string {
    // Determine the appropriate normalization method based on field name
    const lcFieldName = fieldName.toLowerCase();

    // Company name fields
    if (
      lcFieldName.includes('company') ||
      lcFieldName.includes('business') ||
      lcFieldName.includes('organization')
    ) {
      return normalizeCompanyName(value, {
        ...options,
        normalizeCompanyNames: true
      });
    }

    // Product identifier fields
    if (
      lcFieldName.includes('product') ||
      lcFieldName.includes('item') ||
      lcFieldName.includes('sku') ||
      lcFieldName.includes('id') ||
      lcFieldName.includes('code')
    ) {
      return normalizeProductIdentifier(value, 'auto', {
        ...options,
        normalizeProductIdentifiers: true
      });
    }

    // Default text normalization
    return normalizeText(value, options);
  }
}

/**
 * Create middleware registration for entity matcher extraction middleware
 */
export function createEntityMatcherExtractionMiddlewareRegistration(): IMiddlewareRegistration<IEntityMatcherExtractionInput, IEntityMatcherExtractionOutput> {
  return {
    id: 'entity-matcher-extraction',
    type: 'extraction' as MiddlewareType,
    name: 'Entity Matcher Extraction Middleware',
    description: 'Extracts entity fields from elements on a page for entity matching',
    middleware: new EntityMatcherExtractionMiddleware(),
    version: '1.0.0',
    tags: ['entity-matcher', 'extraction', 'fields'],
    configSchema: {
      type: 'object',
      properties: {
        extractionConfig: {
          type: 'object',
          properties: {
            resultsSelector: {
              type: 'string',
              description: 'CSS selector for the container of results'
            },
            itemSelector: {
              type: 'string',
              description: 'CSS selector for individual items within the results container'
            },
            fields: {
              type: 'array',
              items: {
                type: 'object',
                properties: {
                  name: {
                    type: 'string',
                    description: 'Field name'
                  },
                  selector: {
                    type: 'string',
                    description: 'CSS selector for the field relative to the item'
                  },
                  attribute: {
                    type: 'string',
                    description: 'Optional attribute to extract instead of text content'
                  },
                  required: {
                    type: 'boolean',
                    description: 'Whether the field is required'
                  }
                },
                required: ['name', 'selector']
              }
            },
            waitForSelector: {
              type: 'boolean',
              description: 'Whether to wait for the results container selector to appear'
            },
            selectorTimeout: {
              type: 'number',
              description: 'Timeout for waiting for selectors in milliseconds'
            }
          },
          required: ['resultsSelector', 'itemSelector', 'fields']
        }
      },
      required: ['extractionConfig']
    }
  };
}
