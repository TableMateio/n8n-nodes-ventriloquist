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

      // Handle data type conversion if specified
      if (field.dataFormat) {
        try {
          // Convert value based on data format
          const convertedValue = this.convertValueByFormat(originalValue.trim(), field.dataFormat, logger, logPrefix);

          // For numeric and date values, also update the normalized value for better comparison
          if (field.dataFormat === 'number' || field.dataFormat === 'date') {
            // Convert to string for consistent comparison
            normalizedValue = String(convertedValue);
            logger.debug(`${logPrefix} Converted field '${field.name}' to ${field.dataFormat}: ${originalValue} → ${normalizedValue}`);
          }
        } catch (error) {
          logger.warn(`${logPrefix} Error converting field '${field.name}' to ${field.dataFormat}: ${(error as Error).message}`);
        }
      }

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

  /**
   * Convert a value based on the specified data format
   */
  private convertValueByFormat(
    value: string,
    format: string,
    logger: ILogger,
    logPrefix: string
  ): any {
    if (!value) return value;

    switch (format) {
      case 'number':
        // First try direct conversion if it's already a clean number
        const directConversion = Number(value.trim());
        if (!isNaN(directConversion)) {
          return directConversion;
        }

        // Handle currency and other formatted numbers
        // First try assuming period as decimal separator (e.g. $1,234.56)
        let numericStr = value.replace(/[^0-9.-]/g, '');
        let numericValue = Number(numericStr);

        if (!isNaN(numericValue)) {
          logger.debug(`${logPrefix} Converted to number: ${value} → ${numericValue}`);
          return numericValue;
        }

        // Try handling European format (e.g. 1.234,56 €)
        const europeanFormatStr = value
          .replace(/[^0-9,.()-]/g, '')
          .replace(/\./g, '')
          .replace(/,/g, '.');

        numericValue = Number(europeanFormatStr);
        if (!isNaN(numericValue)) {
          logger.debug(`${logPrefix} Converted to number (EU format): ${value} → ${numericValue}`);
          return numericValue;
        }

        // Try handling parentheses for negative numbers: (123.45) → -123.45
        if (value.includes('(') && value.includes(')')) {
          const parenthesesStr = value
            .replace(/[^0-9.()-]/g, '')
            .replace(/[\(\)]/g, '')
            .trim();

          numericValue = -Math.abs(Number(parenthesesStr));
          if (!isNaN(numericValue)) {
            logger.debug(`${logPrefix} Converted to number (parentheses): ${value} → ${numericValue}`);
            return numericValue;
          }
        }

        logger.debug(`${logPrefix} Could not convert to number: ${value}`);
        return value;

      case 'date':
        // Try direct date parsing first (ISO format, etc.)
        const standardDate = new Date(value);
        if (!isNaN(standardDate.getTime())) {
          logger.debug(`${logPrefix} Converted to date: ${value} → ${standardDate.toISOString()}`);
          return standardDate;
        }

        const dateString = value.trim();

        // MM/DD/YYYY or DD/MM/YYYY
        const slashMatch = dateString.match(/^(\d{1,2})\/(\d{1,2})\/(\d{2,4})$/);
        if (slashMatch) {
          const [_, part1, part2, year] = slashMatch;
          const fullYear = year.length === 2 ? `20${year}` : year;

          // Try both MM/DD/YYYY and DD/MM/YYYY interpretations
          const mmddDate = new Date(`${part1}/${part2}/${fullYear}`);
          if (!isNaN(mmddDate.getTime())) {
            logger.debug(`${logPrefix} Converted to date (MM/DD/YYYY): ${value} → ${mmddDate.toISOString()}`);
            return mmddDate;
          }

          const ddmmDate = new Date(`${part2}/${part1}/${fullYear}`);
          if (!isNaN(ddmmDate.getTime())) {
            logger.debug(`${logPrefix} Converted to date (DD/MM/YYYY): ${value} → ${ddmmDate.toISOString()}`);
            return ddmmDate;
          }
        }

        // MM-DD-YYYY or DD-MM-YYYY with dashes
        const dashMatch = dateString.match(/^(\d{1,2})-(\d{1,2})-(\d{2,4})$/);
        if (dashMatch) {
          const [_, part1, part2, year] = dashMatch;
          const fullYear = year.length === 2 ? `20${year}` : year;

          // Try both MM-DD-YYYY and DD-MM-YYYY interpretations
          const mmddDate = new Date(`${part1}-${part2}-${fullYear}`);
          if (!isNaN(mmddDate.getTime())) {
            logger.debug(`${logPrefix} Converted to date (MM-DD-YYYY): ${value} → ${mmddDate.toISOString()}`);
            return mmddDate;
          }

          const ddmmDate = new Date(`${part2}-${part1}-${fullYear}`);
          if (!isNaN(ddmmDate.getTime())) {
            logger.debug(`${logPrefix} Converted to date (DD-MM-YYYY): ${value} → ${ddmmDate.toISOString()}`);
            return ddmmDate;
          }
        }

        // YYYY-MM-DD (ISO format)
        const isoMatch = dateString.match(/^(\d{4})-(\d{1,2})-(\d{1,2})$/);
        if (isoMatch) {
          const [_, year, month, day] = isoMatch;
          const isoDate = new Date(`${year}-${month.padStart(2, '0')}-${day.padStart(2, '0')}`);
          if (!isNaN(isoDate.getTime())) {
            logger.debug(`${logPrefix} Converted to date (ISO): ${value} → ${isoDate.toISOString()}`);
            return isoDate;
          }
        }

        // Month name formats (e.g., "January 1, 2023" or "1 Jan 2023")
        const monthNames = [
          'january', 'february', 'march', 'april', 'may', 'june',
          'july', 'august', 'september', 'october', 'november', 'december',
          'jan', 'feb', 'mar', 'apr', 'may', 'jun',
          'jul', 'aug', 'sep', 'oct', 'nov', 'dec'
        ];

        const lowercaseDate = dateString.toLowerCase();
        for (const monthName of monthNames) {
          if (lowercaseDate.includes(monthName)) {
            const textDate = new Date(dateString);
            if (!isNaN(textDate.getTime())) {
              logger.debug(`${logPrefix} Converted to date (text format): ${value} → ${textDate.toISOString()}`);
              return textDate;
            }
          }
        }

        logger.debug(`${logPrefix} Could not convert to date: ${value}`);
        return value;

      case 'boolean':
        // Convert to boolean
        const boolStr = value.toLowerCase().trim();
        if (['true', 'yes', '1', 'y', 'on'].includes(boolStr)) {
          return true;
        } else if (['false', 'no', '0', 'n', 'off'].includes(boolStr)) {
          return false;
        }
        return value;

      default:
        return value;
    }
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
