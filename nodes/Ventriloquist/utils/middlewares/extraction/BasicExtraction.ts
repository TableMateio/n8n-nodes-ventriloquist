// Look for a method that uses aiFields (like execute() or similar) and add debug logs there

import { Logger } from 'n8n-workflow';
import { Page } from 'puppeteer-core';
import { IMiddlewareContext } from '../middleware';
import { IExtraction, IExtractionConfig, IExtractionResult } from './extractionFactory';
import { formatOperationLog } from '../../resultUtils';
import { extractTextContent, extractHtmlContent, extractAttributeValue, extractTableData, extractMultipleElements, extractInputValue } from '../../extractionUtils';
import { processWithAI } from '../../smartExtractionUtils';
import { enhanceFieldsWithRelativeSelectorContent } from '../../processOpenAISchema';
import { logWithDebug } from '../../loggingUtils';
import { extractTextFromHtml } from '../../comparisonUtils';

/**
 * Extract numeric values from currency/price strings
 * Examples: "$21,000.00 –" -> "21000.00", "€1,234.56" -> "1234.56", "Price: $99.99" -> "99.99"
 */
function extractNumericValue(text: string): string {
  if (typeof text !== 'string') {
    return text;
  }

  // Remove common currency symbols and prefixes
  let cleaned = text
    .replace(/[^\d.,\-\s]/g, ' ') // Keep only digits, commas, periods, hyphens, and spaces
    .trim();

  // Find the first number-like pattern in the string
  // This regex matches patterns like: 1,234.56, 1234.56, 1,234, 1234, .56, etc.
  const numberPattern = /(\d{1,3}(?:,\d{3})*(?:\.\d{1,2})?|\d+(?:\.\d{1,2})?)/;
  const match = cleaned.match(numberPattern);

  if (match) {
    // Remove commas from the matched number and return it
    return match[1].replace(/,/g, '');
  }

  // If no clear number pattern found, return the original text
  return text;
}

/**
 * Implements basic extraction functionality for common operations
 */
export class BasicExtraction implements IExtraction {
  private page: Page;
  private config: IExtractionConfig;
  private context: IMiddlewareContext;

  constructor(page: Page, config: IExtractionConfig, context: IMiddlewareContext) {
    this.page = page;
    this.config = config;
    this.context = context;
  }

  async execute(): Promise<IExtractionResult> {
    const logger = this.context.logger as Logger;
    const nodeName = this.context.nodeName;
    const nodeId = this.context.nodeId;
    const index = this.context.index || 0;

    // Construct a log prefix for consistent logging
    const logPrefix = `[Extraction][${nodeName}]`;

    try {
      // Initialize result variables
      let data: any = null;
      let rawContent: string = '';
      let schema: any = null;
      // Store full content for multiple extraction types that might truncate
      let fullMultipleContent: string = '';

      // Perform extraction based on type
      switch (this.config.extractionType) {
        case 'text':
          // Extract text content from the element
          const cleanText = this.config.cleanText === true;
          const convertType = this.config.convertType || 'none';
          data = await extractTextContent(this.page, this.config.selector, logger, nodeName, nodeId);

          // Store raw content before any cleaning
          // It's important to distinguish between the raw data from extractTextContent
          // and the data after cleaning for logging and debugging.
          const rawExtractedData = Array.isArray(data) ? [...data] : data;

          // Log initial extraction results
          logger.info(`${logPrefix} [TextExtraction] Initial extraction complete. Data type: ${typeof data}, isArray: ${Array.isArray(data)}, convertType: ${convertType}`);
          if (typeof data === 'string') {
            logger.info(`${logPrefix} [TextExtraction] Extracted string: "${data.substring(0, 100)}${data.length > 100 ? '...' : ''}" (length: ${data.length})`);
          }

          if (cleanText) {
            logger.info(`${logPrefix} [CleanText] Starting text cleaning for selector ${this.config.selector}. Initial data type: ${typeof data}, isArray: ${Array.isArray(data)}`);
            const logCleaningInfo = (original: any, modified: any, stage: string) => {
              const originalLength = typeof original === 'string' ? original.length : (Array.isArray(original) ? original.map(s => String(s).length).join(',') : 'N/A');
              const modifiedLength = typeof modified === 'string' ? modified.length : (Array.isArray(modified) ? modified.map(s => String(s).length).join(',') : 'N/A');
              logger.info(`${logPrefix} [CleanText - ${stage}] Original length(s): ${originalLength}, New length(s): ${modifiedLength}`);
            };

            let processedData;
            if (typeof data === 'string') {
              logger.info(`${logPrefix} [CleanText] Data is a string. BEFORE extractTextFromHtml: ${data.substring(0, 100)}... (length: ${data.length})`);

              // Step 1: First use our HTML cleaner to get all tags/entities handled
              processedData = extractTextFromHtml(data);

              // Step 2: Apply additional whitespace cleanup
              if (typeof processedData === 'string') {
                // Replace all tab characters with spaces
                processedData = processedData.replace(/\t+/g, ' ');

                // Replace multiple spaces with single spaces
                processedData = processedData.replace(/[ \xA0]+/g, ' ');

                // Remove spaces before and after newlines
                processedData = processedData.replace(/[ ]*\n[ ]*/g, '\n');

                // Replace leading/trailing spaces on each line
                const lines = processedData.split('\n');
                processedData = lines
                  .map((line: string) => line.trim())
                  .filter((line: string) => line.length > 0)
                  .join('\n');

                // Final cleanup to ensure no multi-line breaks (more than 2)
                processedData = processedData.replace(/\n{3,}/g, '\n\n');
              }

              logger.info(`${logPrefix} [CleanText] Data is a string. AFTER extractTextFromHtml: ${(processedData as string).substring(0, 100)}... (length: ${(processedData as string).length})`);
              logCleaningInfo(data, processedData, 'extractTextFromHtml');
            } else if (Array.isArray(data)) {
              logger.info(`${logPrefix} [CleanText] Data is an array. Length: ${data.length}`);
              processedData = data.map((item, itemIndex) => {
                if (typeof item === 'string') {
                  logger.info(`${logPrefix} [CleanText] Array item[${itemIndex}] is a string. BEFORE extractTextFromHtml: ${item.substring(0, 100)}... (length: ${item.length})`);

                  // First clean HTML
                  let cleanedItem = extractTextFromHtml(item);

                  // Additional whitespace cleanup
                  cleanedItem = cleanedItem.replace(/\t+/g, ' ');
                  cleanedItem = cleanedItem.replace(/[ \xA0]+/g, ' ');
                  cleanedItem = cleanedItem.replace(/[ ]*\n[ ]*/g, '\n');

                  const lines = cleanedItem.split('\n');
                  cleanedItem = lines
                    .map((line: string) => line.trim())
                    .filter((line: string) => line.length > 0)
                    .join('\n');

                  cleanedItem = cleanedItem.replace(/\n{3,}/g, '\n\n');

                  logger.info(`${logPrefix} [CleanText] Array item[${itemIndex}] is a string. AFTER extractTextFromHtml: ${cleanedItem.substring(0, 100)}... (length: ${cleanedItem.length})`);
                  return cleanedItem;
                }
                logger.warn(`${logPrefix} [CleanText] Array item[${itemIndex}] is NOT a string (type: ${typeof item}). Skipping.`);
                return item;
              });
              // For array logging, we might log total length changes or skip detailed per-item logging here
              logCleaningInfo(data, processedData, 'extractTextFromHtml (Array)');
            } else {
              processedData = data; // If not string or array, do nothing
            }

            data = processedData;
            logger.info(`${logPrefix} Text cleaning finished.`);
          } else {
            // Even without clean text option, apply minimal cleaning to handle most problematic cases
            // This is important for text content extraction so we get consistent behavior
            logger.info(`${logPrefix} [CleanText] Applying minimal text cleaning for text content extraction`);

            if (typeof data === 'string') {
              // Remove iframes at minimum
              data = data.replace(/<iframe\b[^<]*(?:(?!<\/iframe>)<[^<]*)*<\/iframe>/gi, '');

              // Remove clearly invisible elements like scripts
              data = data.replace(/<script\b[^<]*(?:(?!<\/script>)<[^<]*)*<\/script>/gi, '');
              data = data.replace(/<style\b[^<]*(?:(?!<\/style>)<[^<]*)*<\/style>/gi, '');

              // Basic cleanup of whitespace
              data = data.replace(/\t+/g, ' ');
              data = data.replace(/[ ]{3,}/g, ' ');

              // Remove empty lines and normalize consecutive newlines
              const lines = data.split('\n');
              data = lines
                .map((line: string) => line.trim())
                .filter((line: string) => line.length > 0)
                .join('\n');

              data = data.replace(/\n{3,}/g, '\n\n');

              logger.info(`${logPrefix} [CleanText] Applied minimal cleaning to text content`);
            } else if (Array.isArray(data)) {
              data = data.map(item => {
                if (typeof item === 'string') {
                  // Apply the same minimal cleaning to each item
                  let cleaned = item;
                  cleaned = cleaned.replace(/<iframe\b[^<]*(?:(?!<\/iframe>)<[^<]*)*<\/iframe>/gi, '');
                  cleaned = cleaned.replace(/<script\b[^<]*(?:(?!<\/script>)<[^<]*)*<\/script>/gi, '');
                  cleaned = cleaned.replace(/<style\b[^<]*(?:(?!<\/style>)<[^<]*)*<\/style>/gi, '');
                  cleaned = cleaned.replace(/\t+/g, ' ');
                  cleaned = cleaned.replace(/[ ]{3,}/g, ' ');

                  // Split into lines, trim, filter out empty lines, and rejoin
                  const lines = cleaned.split('\n');
                  cleaned = lines
                    .map((line: string) => line.trim())
                    .filter((line: string) => line.length > 0)
                    .join('\n');

                  cleaned = cleaned.replace(/\n{3,}/g, '\n\n');

                  return cleaned;
                }
                return item;
              });
            }
          }

          // Apply number extraction if enabled
          if (convertType === 'toNumber') {
            logger.info(`${logPrefix} [ExtractNumbers] Starting number extraction for selector ${this.config.selector}. Data type: ${typeof data}, isArray: ${Array.isArray(data)}`);

            if (typeof data === 'string') {
              const originalData = data;
              data = extractNumericValue(data);
              logger.info(`${logPrefix} [ExtractNumbers] String conversion: "${originalData}" -> "${data}"`);
            } else if (Array.isArray(data)) {
              data = data.map((item, itemIndex) => {
                if (typeof item === 'string') {
                  const originalItem = item;
                  const extractedNumber = extractNumericValue(item);
                  logger.info(`${logPrefix} [ExtractNumbers] Array item[${itemIndex}] conversion: "${originalItem}" -> "${extractedNumber}"`);
                  return extractedNumber;
                }
                logger.warn(`${logPrefix} [ExtractNumbers] Array item[${itemIndex}] is NOT a string (type: ${typeof item}). Skipping.`);
                return item;
              });
            }

            logger.info(`${logPrefix} Number extraction finished.`);
          }
          break;

        case 'html':
          // Extract HTML content from the element
          try {
            const outputFormat = this.config.outputFormat || 'html';
            const includeMetadata = this.config.includeMetadata === true;

            data = await extractHtmlContent(
              this.page,
              this.config.selector,
              { outputFormat, includeMetadata },
              logger,
              nodeName,
              nodeId
            );

            // Store raw content as string for logging
            let fullContent = '';
            if (typeof data === 'string') {
              fullContent = data;
            } else if (data && typeof data === 'object' && data.html) {
              fullContent = data.html as string;
            }

            // Only truncate for logging purposes
            if (fullContent.length > 200) {
              rawContent = fullContent.substring(0, 200) + '... [truncated]';
            } else {
              rawContent = fullContent;
            }
          } catch (err) {
            logger.error(`${logPrefix} HTML extraction failed: ${(err as Error).message}`);
            throw err;
          }
          break;

        case 'attribute':
          // Extract attribute value from the element
          data = await extractAttributeValue(
            this.page,
            this.config.selector,
            this.config.attributeName || 'href',
            logger,
            nodeName,
            nodeId
          );

          // Store raw content for logging - data remains untruncated
          rawContent = data;
          break;

        case 'ai':
          // Use AI to extract data from the content
          const smartOptions = this.config.smartOptions;
          if (!smartOptions || !smartOptions.aiAssistance) {
            throw new Error('AI extraction options not provided');
          }

          // Log if debug mode is enabled
          if (smartOptions.debugMode) {
            logger.info(`${logPrefix} AI extraction starting with debug mode enabled`);
            logWithDebug(
              this.context.logger,
              this.config.debugMode || false,
              nodeName,
              'Extraction',
              'BasicExtraction',
              'processWithAI',
              `AI processing requested with debug mode ON in ${nodeName}/${nodeId}`,
              'info'
            );

            // Log if OpenAI API key is available
            if (this.config.openaiApiKey) {
              logWithDebug(
                this.context.logger,
                this.config.debugMode || false,
                nodeName,
                'Extraction',
                'BasicExtraction',
                'processWithAI',
                `OpenAI API key available (length: ${this.config.openaiApiKey.length})`,
                'info'
              );
            } else {
              logWithDebug(
                this.context.logger,
                this.config.debugMode || false,
                nodeName,
                'Extraction',
                'BasicExtraction',
                'processWithAI',
                'No OpenAI API key provided - AI processing will fail',
                'error'
              );
            }
          }

          try {
            // First extract the full text or HTML content
            const content = await this.page.$eval(this.config.selector, (el) => {
              return el.textContent?.trim() || el.innerHTML;
            });

            // Store full content for processing
            // Only truncate for logging purposes
            if (content.length > 200) {
              rawContent = content.substring(0, 200) + '... [truncated]';
            } else {
              rawContent = content;
            }

            // Prepare the extraction context for AI processing
            const extractContext = {
              logger,
              nodeName,
              nodeId,
              sessionId: this.context.sessionId || 'unknown',
              index
            };

            // Log AI formatting settings
            logger.info(`${logPrefix} Applying AI formatting with ${smartOptions.strategy} strategy, format: ${smartOptions.extractionFormat}`);
            logger.info(`${logPrefix} AI options: includeSchema=${smartOptions.includeSchema}, includeRawData=${smartOptions.includeRawData}, debugMode=${smartOptions.debugMode}`);

            // Log fields if using manual strategy
            if (smartOptions.strategy === 'manual' && this.config.fields && this.config.fields.items) {
              logger.info(`${logPrefix} Using manual strategy with ${this.config.fields.items.length} field definitions`);
            }

            // Log when we're calling the AI service
            logWithDebug(
              this.context.logger,
              this.config.debugMode || false,
              nodeName,
              'Extraction',
              'BasicExtraction',
              'processWithAI',
              `Calling processWithAI with model ${smartOptions.aiModel}`,
              'info'
            );

            const smartResult = await processWithAI(
              content, // Pass the single content string
              { // These are the ISmartExtractionOptions
                enabled: true,
                extractionFormat: smartOptions.extractionFormat || 'json',
                aiModel: smartOptions.aiModel || 'gpt-3.5-turbo',
                generalInstructions: smartOptions.generalInstructions || '',
                strategy: smartOptions.strategy || 'auto',
                includeSchema: smartOptions.includeSchema === true,
                includeRawData: smartOptions.includeRawData === true,
                includeReferenceContext: smartOptions.includeReferenceContext === true,
                referenceSelector: smartOptions.referenceSelector || '',
                referenceName: smartOptions.referenceName || 'referenceContext',
                referenceFormat: smartOptions.referenceFormat || 'text',
                referenceAttribute: smartOptions.referenceAttribute || '',
                selectorScope: smartOptions.selectorScope || 'global',
                referenceContent: smartOptions.referenceContent || '',
                debugMode: smartOptions.debugMode === true
              },
              this.config.fields?.items || [],
              this.config.openaiApiKey,
              extractContext
            );

            // Set the data from the smart extraction result
            data = smartResult.data;
            schema = smartResult.schema;
            logger.info(`${logPrefix} AI formatting successful`);
          } catch (error) {
            logger.error(`${logPrefix} AI formatting failed: ${(error as Error).message}`);
            throw error;
          }
          break;

        case 'table':
          // Handle table extraction
          const includeHeaders = this.config.includeHeaders !== false;
          const rowSelector = this.config.rowSelector || 'tr';
          const cellSelector = this.config.cellSelector || 'td, th';
          const tableOutputFormat = this.config.outputFormat || 'json';
          const extractAttributes = this.config.extractAttributes === true;
          const attributeName = this.config.attributeName || 'href';

          logger.info(`${logPrefix} Table extraction starting: selector=${this.config.selector}, rowSelector=${rowSelector}, cellSelector=${cellSelector}, includeHeaders=${includeHeaders}, outputFormat=${tableOutputFormat}, extractAttributes=${extractAttributes}`);

          try {
            if (tableOutputFormat === 'html') {
              // Get full HTML content
              const fullHtmlContent = await this.page.$eval(this.config.selector, (el) => el.outerHTML);

              // Store full HTML as data
              data = fullHtmlContent;

              // Only truncate for logging purposes
              if (fullHtmlContent.length > 200) {
                rawContent = fullHtmlContent.substring(0, 200) + '... [truncated]';
              } else {
                rawContent = fullHtmlContent;
              }

              logger.info(`${logPrefix} Table HTML extracted successfully, length: ${fullHtmlContent.length}`);
            } else {
              // Extract as array of rows and cells
              logger.info(`${logPrefix} Extracting table as structured data`);

              // First check if the selector exists more thoroughly with content logging
              const selectorInfo = await this.page.evaluate((selector) => {
                // Test if the selector exists
                const el = document.querySelector(selector);

                if (!el) {
                  // Try to get the HTML content of the page to help debug
                  const bodyContent = document.body ? document.body.innerHTML.substring(0, 1000) : 'No body element';
                  return {
                    exists: false,
                    message: `Selector '${selector}' not found on page.`,
                    bodyPreview: bodyContent,
                    html: '' // Add empty html property for type safety
                  };
                }

                // Test if it's a table
                const isTable = el.tagName.toLowerCase() === 'table';
                const hasRows = el.querySelectorAll('tr').length > 0;

                return {
                  exists: true,
                  isTable: isTable,
                  hasRows: hasRows,
                  rowCount: el.querySelectorAll('tr').length,
                  html: el.outerHTML.substring(0, 200) + '...',
                  tagName: el.tagName.toLowerCase()
                };
              }, this.config.selector);

              // Log detailed selector information for debugging
              if (selectorInfo.exists) {
                logger.info(`${logPrefix} Table selector found: ${this.config.selector}`);
                logger.info(`${logPrefix} Is table: ${selectorInfo.isTable}, Has rows: ${selectorInfo.hasRows}, Row count: ${selectorInfo.rowCount}`);
                logger.debug(`${logPrefix} Element preview: ${selectorInfo.html}`);
              } else {
                logger.warn(`${logPrefix} Table selector not found: ${this.config.selector}`);
                logger.debug(`${logPrefix} Page content preview: ${selectorInfo.bodyPreview}`);
                throw new Error(`Table selector not found: ${this.config.selector}`);
              }

              // Get the raw HTML for raw content
              rawContent = selectorInfo.exists ? selectorInfo.html : '';
              // Make sure rawContent is not undefined/falsy
              if (!rawContent) {
                rawContent = ''; // Ensure it's an empty string, not undefined
                throw new Error(`Could not extract HTML content from table`);
              }

              // Use the extractTableData utility function from extractionUtils.ts
              data = await extractTableData(
                this.page,
                this.config.selector,
                {
                  includeHeaders,
                  rowSelector,
                  cellSelector,
                  outputFormat: tableOutputFormat,
                  extractAttributes,
                  attributeName: extractAttributes ? attributeName : undefined,
                },
                logger,
                nodeName || 'Ventriloquist',
                nodeId || 'unknown'
              );

              logger.info(`${logPrefix} Table data extracted: ${Array.isArray(data) ? data.length : 'object'} rows found`);

              // NEW CODE: If there are aiFields with relative selectors in the config
              // and we've successfully extracted the table, use the full HTML content
              // to enhance the fields at this point - when we know the table exists
              if (this.config.fields?.items &&
                  this.config.smartOptions?.aiAssistance === true &&
                  this.config.openaiApiKey) {

                // Get the full HTML content (not truncated) for field enhancement
                const fullHtmlContent = selectorInfo.exists ? await this.page.$eval(this.config.selector, (el) => el.outerHTML) : '';

                // Convert config fields to IOpenAIField format for the enhancement function
                const convertedFields = this.config.fields.items.map(field => {
                  return {
                    name: field.name,
                    type: field.type,
                    instructions: field.instructions,
                    // These properties don't exist in the config fields but are needed for enhancement
                    relativeSelectorOptional: '',
                    relativeSelector: '',
                    extractionType: 'text',
                    attributeName: '',
                  };
                });

                // Check if any fields have relative selectors defined in their instructions
                // This is a workaround since our config fields don't have the relativeSelector properties
                const fieldsWithPotentialSelectors = convertedFields.filter(field =>
                  field.instructions.includes('selector') ||
                  field.instructions.includes('css') ||
                  field.instructions.includes('a') ||
                  field.instructions.includes('href') ||
                  field.instructions.includes('attribute')
                );

                if (fieldsWithPotentialSelectors.length > 0) {
                  // Only process if we have fields that might need enhancement
                  logger.info(
                    `${logPrefix} Found ${fieldsWithPotentialSelectors.length} fields that might need relative selector enhancement`
                  );

                  // If in debug mode, log more details
                  if (this.config.smartOptions.debugMode) {
                    logWithDebug(
                      this.context.logger,
                      this.config.debugMode || false,
                      nodeName,
                      'Extraction',
                      'BasicExtraction',
                      'processWithAI',
                      `Found ${fieldsWithPotentialSelectors.length} fields that might need relative selector enhancement`,
                      'info'
                    );
                    fieldsWithPotentialSelectors.forEach(field => {
                      logWithDebug(
                        this.context.logger,
                        this.config.debugMode || false,
                        nodeName,
                        'Extraction',
                        'BasicExtraction',
                        'processWithAI',
                        `Field "${field.name}" might need enhancement based on instructions: "${field.instructions.substring(0, 50)}..."`,
                        'info'
                      );
                    });
                  }

                  try {
                    // Check if we need to parse selectors from the instructions
                    for (const field of convertedFields) {
                      // Look for "selector: X" pattern in instructions
                      const selectorMatch = field.instructions.match(/selector\s*:\s*([^\s,]+)/i);
                      if (selectorMatch && selectorMatch[1]) {
                        field.relativeSelectorOptional = selectorMatch[1];
                      }

                      // Look for "attribute: X" pattern in instructions
                      const attributeMatch = field.instructions.match(/attribute\s*:\s*([^\s,]+)/i);
                      if (attributeMatch && attributeMatch[1]) {
                        field.attributeName = attributeMatch[1];
                        field.extractionType = 'attribute';
                      }

                      // Special case for href
                      if (field.instructions.toLowerCase().includes('href')) {
                        field.attributeName = 'href';
                        field.extractionType = 'attribute';

                        // If we find a reference to 'a' tag and href attribute
                        if (field.instructions.includes('a') && !field.relativeSelectorOptional) {
                          field.relativeSelectorOptional = 'a';
                        }
                      }

                      if (this.config.smartOptions.debugMode && (field.relativeSelectorOptional || field.attributeName)) {
                        logWithDebug(
                          this.context.logger,
                          this.config.debugMode || false,
                          nodeName,
                          'Extraction',
                          'BasicExtraction',
                          'processWithAI',
                          `Extracted selector "${field.relativeSelectorOptional}" and attribute "${field.attributeName}" for field "${field.name}"`,
                          'info'
                        );
                      }
                    }

                    // Call the enhancement function with the full HTML content
                    const enhancedFields = await enhanceFieldsWithRelativeSelectorContent(
                      this.page,
                      convertedFields,
                      this.config.selector,
                      this.context.logger,
                      {
                        nodeName: this.context.nodeName,
                        nodeId: this.context.nodeId,
                        index: this.context.index,
                        component: 'BasicExtraction',
                        functionName: 'extractWithManualStrategy'
                      }
                    );

                    // Copy enhanced instructions back to the original fields
                    for (let i = 0; i < this.config.fields.items.length; i++) {
                      if (i < enhancedFields.length) {
                        this.config.fields.items[i].instructions = enhancedFields[i].instructions;
                      }
                    }

                    logger.info(`${logPrefix} Successfully enhanced fields with relative selector content`);
                  } catch (enhanceError) {
                    // Log error but continue with the extraction - don't interrupt the flow
                    logger.warn(`${logPrefix} Error enhancing fields with relative selector content: ${(enhanceError as Error).message}`);
                    logWithDebug(
                      this.context.logger,
                      this.config.debugMode || false,
                      nodeName,
                      'Extraction',
                      'BasicExtraction',
                      'processWithAI',
                      `Error enhancing fields: ${(enhanceError as Error).message}`,
                      'error'
                    );
                  }
                }
              }
            }
          } catch (err) {
            logger.error(`${logPrefix} Table extraction failed: ${(err as Error).message}`);
            throw err;
          }
          break;

        case 'value':
          // Handle input value extraction
          const inputValues = await this.page.$$eval(this.config.selector, (els) => {
            return els.map(el => {
              if (el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement || el instanceof HTMLSelectElement) {
                return el.value;
              }
              return '';
            });
          });

          // Store all raw content joined together for compatibility
          rawContent = inputValues.join('\n');
          if (rawContent.length > 200) rawContent = rawContent.substring(0, 200) + '... [truncated]';

          // If only one result was found, keep backwards compatibility by returning a string
          // Otherwise, return an array of results
          data = inputValues.length === 1 ? inputValues[0] : inputValues;
          break;

        case 'multiple':
          // Handle multiple elements extraction
          const extractionProperty = this.config.extractionProperty || 'textContent';
          const limit = this.config.limit || 0;
          const multipleOutputFormat = this.config.outputFormat || 'array';
          const separator = this.config.separator || ', ';

          logger.info(`${logPrefix} Multiple extraction starting: selector=${this.config.selector}, property=${extractionProperty}, limit=${limit}, outputFormat=${multipleOutputFormat}`);

          const elements = await this.page.$$(this.config.selector);

          if (elements.length === 0) {
            logger.warn(`${logPrefix} No elements found matching selector: ${this.config.selector}`);
            data = [];
            rawContent = '';
            break;
          }

          logger.info(`${logPrefix} Found ${elements.length} elements matching selector`);

          // Get raw content as outer HTML of all matching elements
          fullMultipleContent = await this.page.evaluate((selector) => {
            const elements = document.querySelectorAll(selector);
            return Array.from(elements).map(el => el.outerHTML).join('\n');
          }, this.config.selector);

          // Store the full content for processing, only truncate for logging
          if (fullMultipleContent.length > 200) {
            rawContent = fullMultipleContent.substring(0, 200) + '... [truncated]';
          } else {
            rawContent = fullMultipleContent;
          }

          // Limit the number of elements if requested
          const limitedElements = limit > 0 ? elements.slice(0, limit) : elements;

          // Extract the requested property from each element
          const extractedValues = await Promise.all(
            limitedElements.map(async (element) => {
              if (extractionProperty === 'textContent') {
                let textContent = await element.evaluate((el) => el.textContent?.trim() || '');

                // Clean text if the option is enabled
                if (this.config.cleanText) {
                  logger.info(`${logPrefix} Cleaning text content - original length: ${textContent.length}`);
                  // First replace all whitespace (including non-breaking spaces, tabs, etc.) with regular spaces
                  textContent = textContent.replace(/[\s\n\r\t\f\v]+/g, ' ');
                  // Then replace multiple consecutive spaces with a single space
                  textContent = textContent.replace(/ {2,}/g, ' ');
                  // Replace newlines around spaces/whitespace
                  textContent = textContent.replace(/\s*\n\s*/g, '\n');
                  // Finally replace multiple consecutive newlines
                  textContent = textContent.replace(/\n{2,}/g, '\n');
                  logger.info(`${logPrefix} Text cleaned - new length: ${textContent.length}`);
                }

                return textContent;
              } else if (extractionProperty === 'innerHTML') {
                return await element.evaluate((el) => el.innerHTML);
              } else if (extractionProperty === 'outerHTML') {
                return await element.evaluate((el) => el.outerHTML);
              } else if (this.config.attributeName) {
                return await element.evaluate(
                  (el, attr) => el.getAttribute(attr) || '',
                  this.config.attributeName
                );
              } else {
                return await element.evaluate((el) => el.textContent?.trim() || '');
              }
            })
          );

          // Format the output according to the selected format
          if (multipleOutputFormat === 'object') {
            const propertyKey = this.config.separator || 'value'; // Use separator as propertyKey (legacy behavior)
            logger.info(`${logPrefix} Formatting as objects with key: ${propertyKey}`);

            data = extractedValues.map(value => ({ [propertyKey]: value }));
          } else if (multipleOutputFormat === 'string') {
            logger.info(`${logPrefix} Joining as string with separator: "${separator}"`);
            data = extractedValues.join(separator);
          } else {
            // Default: array format
            data = extractedValues;
          }

          logger.info(`${logPrefix} Multiple extraction completed: ${extractedValues.length} items extracted`);
          break;

        default:
          throw new Error(`Unsupported extraction type: ${this.config.extractionType}`);
      }

      logger.debug(`${logPrefix} Extraction successful:`, typeof data === 'string' ? data.substring(0, 50) + '...' : data);

      // Apply AI formatting if enabled and API key is provided
      if (this.config.smartOptions?.aiAssistance === true && this.config.openaiApiKey) {
        // Log the presence of the API key for debugging
        logger.info(`${logPrefix} Using OpenAI API key for AI processing. Key length: ${this.config.openaiApiKey.length}`);

        // Log debug mode state for maximum visibility
        if (this.config.smartOptions.debugMode) {
          logWithDebug(
            this.context.logger,
            this.config.debugMode || false,
            nodeName,
            'Extraction',
            'BasicExtraction',
            'processWithAI',
            `AI processing requested with debug mode ON in ${nodeName}/${nodeId}`,
            'error'
          );
          logWithDebug(
            this.context.logger,
            this.config.debugMode || false,
            nodeName,
            'Extraction',
            'BasicExtraction',
            'processWithAI',
            `OpenAI API key available (length: ${this.config.openaiApiKey.length})`,
            'info'
          );
        }

        try {
          // Apply AI formatting with the specified options
          logger.info(`${logPrefix} Applying AI formatting with ${this.config.smartOptions.strategy} strategy, format: ${this.config.smartOptions.extractionFormat}`);
          logger.info(`${logPrefix} AI options: includeSchema=${this.config.smartOptions.includeSchema}, includeRawData=${this.config.smartOptions.includeRawData}, debugMode=${this.config.smartOptions.debugMode}`);

          // Log fields if using manual strategy
          if (this.config.smartOptions.strategy === 'manual' && this.config.fields && this.config.fields.items) {
            logger.info(`${logPrefix} Using manual strategy with ${this.config.fields.items.length} field definitions`);
          }

          // Log debug info when calling the processWithAI function
          logWithDebug(
            this.context.logger,
            this.config.debugMode || false,
            nodeName,
            'Extraction',
            'BasicExtraction',
            'processWithAI',
            `Calling processWithAI with model ${this.config.smartOptions.aiModel}`,
            'info'
          );

          // Always use the full data for AI processing, never truncated content
          // The actual data to send depends on the extraction type
          let contentForAI = data; // Default to using the data

          if (this.config.extractionType === 'multiple' && fullMultipleContent) {
            // For multiple extraction, use the full content we saved earlier
            contentForAI = fullMultipleContent;
            logger.info(`${logPrefix} Using fullMultipleContent for AI processing, length: ${fullMultipleContent.length}`);
          } else if (typeof data === 'string' && data.includes('[truncated]')) {
            // If data somehow still contains truncation, try to use a different source
            if (typeof rawContent === 'string' && !rawContent.includes('[truncated]')) {
              contentForAI = rawContent;
              logger.info(`${logPrefix} Detected truncation in data, using rawContent instead`);
            }
          }

          // Log what content is being sent to the AI
          logWithDebug(
            this.context.logger,
            this.config.debugMode || false,
            nodeName,
            'Extraction',
            'BasicExtraction',
            'processWithAI',
            `Sending content to AI - Type: ${typeof contentForAI}, Length: ${
              typeof contentForAI === 'string'
                ? contentForAI.length
                : (Array.isArray(contentForAI) ? contentForAI.length : 'unknown')
            }`,
            'info'
          );

          const result = await processWithAI(
            // Pass the appropriate content for formatting
            contentForAI,
            // Convert the smartOptions to the format expected by processWithAI
            {
              enabled: true,
              extractionFormat: this.config.smartOptions.extractionFormat || 'json',
              aiModel: this.config.smartOptions.aiModel || 'gpt-3.5-turbo',
              generalInstructions: this.config.smartOptions.generalInstructions || '',
              strategy: this.config.smartOptions.strategy || 'auto',
              includeSchema: this.config.smartOptions.includeSchema === true,
              includeRawData: this.config.smartOptions.includeRawData === true,
              includeReferenceContext: this.config.smartOptions.includeReferenceContext === true,
              referenceSelector: this.config.smartOptions.referenceSelector || '',
              referenceName: this.config.smartOptions.referenceName || 'referenceContext',
              referenceFormat: this.config.smartOptions.referenceFormat || 'text',
              referenceAttribute: this.config.smartOptions.referenceAttribute || '',
              selectorScope: this.config.smartOptions.selectorScope || 'global',
              referenceContent: this.config.smartOptions.referenceContent || '',
              debugMode: this.config.smartOptions.debugMode === true
            },
            // Pass configured fields for manual strategy
            this.config.fields?.items || [],
            this.config.openaiApiKey,
            {
              logger,
              nodeName,
              nodeId,
              sessionId: this.context.sessionId || 'unknown',
              index
            }
          );

          if (result.success) {
            data = result.data;
            if (result.schema) {
              schema = result.schema;
              logger.info(`${logPrefix} Schema provided by AI processing, including in result`);
            }
            logger.info(`${logPrefix} AI formatting successful`);
          } else {
            logger.warn(`${logPrefix} AI formatting failed: ${result.error}`);
          }
        } catch (error) {
          logger.error(`${logPrefix} Error in AI processing: ${(error as Error).message}`);
          // Continue with the original data if AI processing fails
        }
      }

      // Return the extracted data
      return {
        success: true,
        data,
        schema,
        rawContent
      };
    } catch (error) {
      logger.error(`${logPrefix} Extraction failed: ${(error as Error).message}`);
      return {
        success: false,
        error: {
          message: (error as Error).message,
          details: error
        }
      };
    }
  }
}
