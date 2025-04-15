import type { Logger as ILogger } from 'n8n-workflow';
import type { Page, ElementHandle } from 'puppeteer-core';
import { type IMiddleware, type IMiddlewareContext } from '../middleware';
import { type IMiddlewareRegistration, type MiddlewareType } from '../middlewareRegistry';
import {
  type IEntityMatcherExtractionInput,
  type IEntityMatcherExtractionOutput,
  type IExtractedItem,
  type IExtractedField,
  type IEntityField
} from '../types/entityMatcherTypes';
import { normalizeText } from '../../textUtils';
import {
  smartWaitForSelector,
  detectElement,
  IDetectionOptions,
  IDetectionResult
} from '../../detectionUtils';
import { elementExists, isElementVisible } from '../../navigationUtils';

/**
 * Entity Matcher Extraction Middleware
 * Extracts items from a webpage based on configuration
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
    const logPrefix = `[EntityMatcherExtraction][${nodeName}][${nodeId}]`;

    try {
      // Validate extraction config existence
      if (!input) {
        logger.error(`${logPrefix} Missing input object completely`);
        return {
          success: false,
          items: [],
          error: 'Missing input object completely',
          containerFound: false,
          itemsFound: 0,
        };
      }

      const { page, extractionConfig } = input;

      // Validate extraction config
      if (!extractionConfig) {
        logger.error(`${logPrefix} Missing extraction configuration`);
        return {
          success: false,
          items: [],
          error: 'Missing extraction configuration',
          containerFound: false,
          itemsFound: 0,
        };
      }

      // Check the critical properties with more detail
      if (!extractionConfig.resultsSelector) {
        logger.error(`${logPrefix} Missing resultsSelector in extraction configuration`);
        logger.error(`${logPrefix} Full extraction config: ${JSON.stringify(extractionConfig)}`);
        return {
          success: false,
          items: [],
          error: 'Missing resultsSelector in extraction configuration',
          containerFound: false,
          itemsFound: 0,
        };
      }

      logger.info(`${logPrefix} Starting entity extraction with config: ${JSON.stringify({
        resultsSelector: extractionConfig.resultsSelector,
        itemSelector: extractionConfig.itemSelector || '(auto-detect)',
        fieldsCount: extractionConfig.fields?.length || 0,
        autoDetect: extractionConfig.autoDetectChildren
      })}`);

      // Create detection options for smart element detection
      const detectionOptions: IDetectionOptions = {
        waitForSelectors: extractionConfig.waitForSelectors ?? true,
        selectorTimeout: extractionConfig.timeout ?? 10000,
        detectionMethod: 'smart',
        earlyExitDelay: 500,
        nodeName,
        nodeId,
        index,
      };

      // Use the improved detection utility to find the container
      const containerDetectionResult = await detectElement(
        page,
        extractionConfig.resultsSelector,
        detectionOptions,
        logger
      );

      // Log detection result
      logger.info(`${logPrefix} Container detection result: ${containerDetectionResult.success ? 'FOUND' : 'NOT FOUND'}`);

      if (!containerDetectionResult.success) {
        logger.warn(`${logPrefix} Container element not found with selector: ${extractionConfig.resultsSelector}`);
        return {
          success: false,
          items: [],
          error: `Container element not found with selector: ${extractionConfig.resultsSelector}`,
          containerFound: false,
          itemsFound: 0,
          containerSelector: extractionConfig.resultsSelector,
          itemSelector: extractionConfig.itemSelector || '(auto-detect)'
        };
      }

      // Extract items from the page
      const items = await this.extractItems(
        page,
        extractionConfig,
        detectionOptions,
        logger,
        logPrefix
      );

      // Be very explicit about what was found
      logger.info(`${logPrefix} Extraction completed. Container found: ${containerDetectionResult.success}, Items found: ${items.length}`);

      if (containerDetectionResult.success && items.length === 0) {
        logger.warn(`${logPrefix} Container was found but no items were extracted. This may indicate an issue with the item selector or auto-detection.`);
      }

      return {
        success: items.length > 0,
        items,
        containerFound: containerDetectionResult.success,
        itemsFound: items.length,
        containerSelector: extractionConfig.resultsSelector,
        itemSelector: extractionConfig.itemSelector || '(auto-detected)',
      };
    } catch (error) {
      const errorMessage = (error as Error).message;
      logger.error(`${logPrefix} Error during entity extraction: ${errorMessage}`);

      return {
        success: false,
        items: [],
        error: errorMessage,
        containerFound: false,
        itemsFound: 0,
        containerSelector: input?.extractionConfig?.resultsSelector || 'unknown',
        itemSelector: input?.extractionConfig?.itemSelector || '(auto-detect)',
      };
    }
  }

  /**
   * Extract items from the page based on configuration
   */
  private async extractItems(
    page: Page,
    config: IEntityMatcherExtractionInput['extractionConfig'],
    detectionOptions: IDetectionOptions,
    logger: ILogger,
    logPrefix: string
  ): Promise<IExtractedItem[]> {
    // Container should be found at this point since we already checked in execute
    const containerElement = await page.$(config.resultsSelector);

    if (!containerElement) {
      logger.warn(`${logPrefix} Container element not accessible even though detection passed: ${config.resultsSelector}`);
      return [];
    }

    // Log container details for debugging
    const containerDetails = await this.getElementDetails(page, containerElement);
    logger.debug(`${logPrefix} Container details: ${JSON.stringify(containerDetails)}`);

    // Find item elements
    let itemElements: ElementHandle<Element>[] = [];

    if (config.itemSelector && config.itemSelector.trim() !== '') {
      // Use the provided selector with improved detection
      try {
        // Try to detect items using detection utilities
        const combinedSelector = `${config.resultsSelector} ${config.itemSelector}`;
        logger.info(`${logPrefix} Detecting items with combined selector: ${combinedSelector}`);

        const itemsDetectionResult = await detectElement(
          page,
          combinedSelector,
          detectionOptions,
          logger
        );

        if (itemsDetectionResult.success) {
          logger.info(`${logPrefix} Items found with combined selector: ${combinedSelector}`);
          itemElements = await page.$$(combinedSelector);
          logger.info(`${logPrefix} Found ${itemElements.length} items using combined selector detection`);
        } else {
          logger.warn(`${logPrefix} No items found with combined selector: ${combinedSelector}`);

          // Try with container scope for better targeting
          logger.info(`${logPrefix} Trying to find items within container scope using: ${config.itemSelector}`);

          // Check if there are items within the container first
          const hasItems = await containerElement.evaluate((container, selector) => {
            return container.querySelectorAll(selector).length > 0;
          }, config.itemSelector);

          if (hasItems) {
            logger.info(`${logPrefix} Items found within container using selector: ${config.itemSelector}`);
            itemElements = await containerElement.$$(config.itemSelector);
            logger.info(`${logPrefix} Found ${itemElements.length} items within container scope`);
          } else {
            logger.warn(`${logPrefix} No items found within container using selector: ${config.itemSelector}`);
          }
        }
      } catch (itemDetectionError) {
        logger.warn(`${logPrefix} Error in item detection: ${(itemDetectionError as Error).message}, falling back to standard method`);
        itemElements = await containerElement.$$(config.itemSelector);
      }
    } else if (config.autoDetectChildren === true) {
      // Get direct children of the container for auto-detection
      const directChildren = await containerElement.$$(':scope > *');
      logger.debug(`${logPrefix} Container has ${directChildren.length} direct children for auto-detection`);

      // Use the direct children as item elements
      itemElements = directChildren;
    }

    // If no items found, return empty array
    if (itemElements.length === 0) {
      logger.warn(`${logPrefix} No item elements found`);
      return [];
    }

    // Extract data from item elements
    const items: IExtractedItem[] = [];

    for (let i = 0; i < itemElements.length; i++) {
      try {
        const element = itemElements[i];

        // Extract fields from the item element
        const fields = await this.extractFields(
          page,
          element,
          config.fields,
          logger,
          `${logPrefix} [Item ${i}]`
        );

        // Add to items array
        items.push({
          index: i,
          element: element,
          fields,
        });
      } catch (error) {
        logger.warn(`${logPrefix} Error extracting item ${i}: ${(error as Error).message}`);
      }
    }

    return items;
  }

  /**
   * Extract fields from an item element
   */
  private async extractFields(
    page: Page,
    itemElement: ElementHandle<Element>,
    fieldConfigs: IEntityField[],
    logger: ILogger,
    logPrefix: string
  ): Promise<Record<string, IExtractedField>> {
    const fields: Record<string, IExtractedField> = {};

    // If no fields defined, extract full item text
    if (!fieldConfigs || fieldConfigs.length === 0) {
      try {
        const fullText = await this.getElementText(page, itemElement);
        const normalized = normalizeText(fullText);

        fields.fullItem = {
          name: 'fullItem',
          value: fullText,
          original: fullText,
          normalized,
        };
      } catch (error) {
        logger.warn(`${logPrefix} Error extracting full item text: ${(error as Error).message}`);
      }

      return fields;
    }

    // Extract each configured field
    for (const fieldConfig of fieldConfigs) {
      try {
        let fieldValue = '';
        let fieldElement = null;

        if (fieldConfig.selector && fieldConfig.selector.trim() !== '') {
          // Try to find the field element
          fieldElement = await itemElement.$(fieldConfig.selector);

          if (fieldElement) {
            // Extract based on the attribute or text
            if (fieldConfig.attribute) {
              fieldValue = await page.evaluate(
                (el, attr) => el.getAttribute(attr) || '',
                fieldElement,
                fieldConfig.attribute
              );
            } else {
              fieldValue = await this.getElementText(page, fieldElement);
            }
          } else {
            logger.debug(`${logPrefix} Field element not found: ${fieldConfig.selector}`);
          }
        } else {
          // Use the full item text if no selector specified
          fieldValue = await this.getElementText(page, itemElement);
        }

        // Normalize the field value
        let normalizedValue = normalizeText(fieldValue);

        // Handle data conversions based on data format
        let convertedValue = fieldValue;

        if (fieldConfig.dataFormat) {
          try {
            convertedValue = this.convertValueByFormat(
              fieldValue,
              fieldConfig.dataFormat,
              logger,
              logPrefix
            );

            // For numeric and date values, also update the normalized value for better comparison
            if (fieldConfig.dataFormat === 'number' || fieldConfig.dataFormat === 'date') {
              // Normalize as a string representation, preserving the converted value
              normalizedValue = String(convertedValue);
            }
          } catch (error) {
            logger.warn(`${logPrefix} Error converting field '${fieldConfig.name}' to ${fieldConfig.dataFormat}: ${(error as Error).message}`);
          }
        }

        // Store the field
        fields[fieldConfig.name] = {
          name: fieldConfig.name,
          value: convertedValue,
          original: fieldValue,
          normalized: normalizedValue,
        };
      } catch (error) {
        logger.warn(`${logPrefix} Error extracting field '${fieldConfig.name}': ${(error as Error).message}`);

        // Add an empty field to ensure the field exists in the result
        fields[fieldConfig.name] = {
          name: fieldConfig.name,
          value: '',
          original: '',
          normalized: '',
        };
      }
    }

    return fields;
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
        // Extract numeric value, handling currency, etc.
        try {
          // First try direct conversion if it's already a clean number
          const directConversion = Number(value.trim());
          if (!isNaN(directConversion)) {
            return directConversion;
          }

          // Handle currency and other formatted numbers
          // This regex matches numbers that may include:
          // - Currency symbols ($, €, etc.)
          // - Thousands separators (commas, spaces, dots depending on locale)
          // - Decimal separators (dots or commas depending on locale)
          // - Negative signs and parentheses for negative values

          // First try assuming period as decimal separator (e.g. $1,234.56)
          let numericStr = value.replace(/[^0-9.-]/g, '');
          let numericValue = Number(numericStr);

          if (!isNaN(numericValue)) {
            logger.debug(`${logPrefix} Converted to number (US format): ${value} → ${numericValue}`);
            return numericValue;
          }

          // Try handling European format (e.g. 1.234,56 €)
          // For European format, we need to:
          // 1. Remove all non-digit chars except comma and period
          // 2. Replace period (thousand separator) with nothing
          // 3. Replace comma (decimal separator) with period
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
        } catch (error) {
          logger.debug(`${logPrefix} Error converting to number: ${error.message}`);
          return value;
        }

      case 'date':
        // Try to parse as a date
        try {
          // Try direct date parsing first (ISO format, etc.)
          const standardDate = new Date(value);
          if (!isNaN(standardDate.getTime())) {
            logger.debug(`${logPrefix} Converted to date (standard): ${value} → ${standardDate.toISOString()}`);
            return standardDate;
          }

          const dateString = value.trim();

          // Handle common date formats with regex

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
        } catch (error) {
          logger.debug(`${logPrefix} Error converting to date: ${error.message}`);
          return value;
        }

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

  /**
   * Get text content from an element
   */
  private async getElementText(
    page: Page,
    element: ElementHandle<Element>
  ): Promise<string> {
    return page.evaluate(el => {
      // Get all text content, including from child elements
      return el.textContent || '';
    }, element);
  }

  /**
   * Get element details for debugging
   */
  private async getElementDetails(
    page: Page,
    element: ElementHandle<Element>
  ): Promise<any> {
    return page.evaluate(el => {
      return {
        tagName: el.tagName.toLowerCase(),
        id: el.id || null,
        className: el.className || null,
        childCount: el.childElementCount,
        html: el.outerHTML.substring(0, 100) + (el.outerHTML.length > 100 ? '...' : ''),
      };
    }, element);
  }
}

/**
 * Create middleware registration for entity matcher extraction middleware
 */
export function createEntityMatcherExtractionMiddlewareRegistration(): IMiddlewareRegistration<IEntityMatcherExtractionInput, IEntityMatcherExtractionOutput> {
  return {
    id: 'entity-matcher-extraction',
    type: 'matching' as MiddlewareType,
    name: 'Entity Matcher Extraction Middleware',
    description: 'Extracts entities from a webpage',
    middleware: new EntityMatcherExtractionMiddleware(),
    version: '1.0.0',
    tags: ['entity-matcher', 'extraction', 'matching'],
    configSchema: {
      type: 'object',
      properties: {
        page: {
          type: 'object',
          description: 'Puppeteer Page object'
        },
        extractionConfig: {
          type: 'object',
          properties: {
            resultsSelector: {
              type: 'string',
              description: 'CSS selector for the container element'
            },
            itemSelector: {
              type: 'string',
              description: 'CSS selector for the item elements'
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
                    description: 'CSS selector for the field element'
                  },
                  attribute: {
                    type: 'string',
                    description: 'HTML attribute to extract'
                  }
                },
                required: ['name']
              }
            }
          },
          required: ['resultsSelector']
        }
      },
      required: ['page', 'extractionConfig']
    }
  };
}
