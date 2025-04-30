// Look for a method that uses aiFields (like execute() or similar) and add debug logs there

import { Logger } from 'n8n-workflow';
import { Page } from 'puppeteer-core';
import { IMiddlewareContext } from '../middleware';
import { IExtraction, IExtractionConfig, IExtractionResult } from './extractionFactory';
import { formatOperationLog } from '../../resultUtils';
import { extractTextContent, extractHtmlContent, extractAttributeValue, extractTableData, extractMultipleElements, extractInputValue } from '../../extractionUtils';
import { processWithAI } from '../../smartExtractionUtils';
import { enhanceFieldsWithRelativeSelectorContent } from '../../processOpenAISchema';

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

      // Perform extraction based on type
      switch (this.config.extractionType) {
        case 'text':
          // Extract text content from the element
          const cleanText = this.config.cleanText === true;
          data = await extractTextContent(this.page, this.config.selector, logger, nodeName, nodeId);

          // Store raw content
          rawContent = data;

          if (cleanText) {
            logger.info(`${logPrefix} Cleaning text content - original length: ${data.length}`);
            // First replace all whitespace (including non-breaking spaces, tabs, etc.) with regular spaces
            data = data.replace(/[\s\n\r\t\f\v]+/g, ' ');
            // Then replace multiple consecutive spaces with a single space
            data = data.replace(/ {2,}/g, ' ');
            // Replace newlines around spaces/whitespace
            data = data.replace(/\s*\n\s*/g, '\n');
            // Finally replace multiple consecutive newlines
            data = data.replace(/\n{2,}/g, '\n');
            logger.info(`${logPrefix} Text cleaned - new length: ${data.length}`);
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

            // Store raw content as string
            if (typeof data === 'string') {
              rawContent = data;
            } else if (data && typeof data === 'object' && data.html) {
              rawContent = data.html as string;
            }

            if (rawContent.length > 200) rawContent = rawContent.substring(0, 200) + '... [truncated]';
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

          // Store raw content
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
            console.error(`[EXTRACTION FACTORY DEBUG] AI processing requested with debug mode ON in ${nodeName}/${nodeId}`);

            // Log if OpenAI API key is available
            if (this.config.openaiApiKey) {
              console.error(`[EXTRACTION FACTORY DEBUG] OpenAI API key available (length: ${this.config.openaiApiKey.length})`);
            } else {
              console.error(`[EXTRACTION FACTORY DEBUG] No OpenAI API key provided - AI processing will fail`);
            }
          }

          try {
            // First extract the text or HTML content
            const content = await this.page.$eval(this.config.selector, (el) => {
              return el.textContent?.trim() || el.innerHTML;
            });

            // Store raw content
            rawContent = content;
            if (rawContent.length > 200) rawContent = rawContent.substring(0, 200) + '... [truncated]';

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
            console.error(`[EXTRACTION FACTORY DEBUG] Calling processWithAI with model ${smartOptions.aiModel}`);

            const smartResult = await processWithAI(
              content,
              {
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
              // Just return the HTML if that's what was requested
              logger.info(`${logPrefix} Extracting table as HTML`);
              rawContent = await this.page.$eval(this.config.selector, (el) => el.outerHTML);
              if (rawContent.length > 200) rawContent = rawContent.substring(0, 200) + '... [truncated]';
              data = rawContent;
              logger.info(`${logPrefix} Table HTML extracted successfully, length: ${data.length}`);
            } else {
              // Extract as array of rows and cells
              logger.info(`${logPrefix} Extracting table as structured data`);

              // First check if the selector exists
              const tableExists = await this.page.$(this.config.selector);
              if (!tableExists) {
                logger.warn(`${logPrefix} Table selector not found: ${this.config.selector}`);
                throw new Error(`Table selector not found: ${this.config.selector}`);
              }

              // Then check if rows exist
              const rowsExist = await this.page.$(`${this.config.selector} ${rowSelector}`);
              if (!rowsExist) {
                logger.warn(`${logPrefix} No rows found in table with rowSelector: ${rowSelector}`);
              }

              // Get the raw HTML for raw content
              rawContent = await this.page.$eval(this.config.selector, (el) => el.outerHTML);
              if (rawContent.length > 200) rawContent = rawContent.substring(0, 200) + '... [truncated]';

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
                const fullHtmlContent = await this.page.$eval(this.config.selector, (el) => el.outerHTML);

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
                    console.error(`[EXTRACTION FACTORY DEBUG] Found ${fieldsWithPotentialSelectors.length} fields that might need relative selector enhancement`);
                    fieldsWithPotentialSelectors.forEach(field => {
                      console.error(`[EXTRACTION FACTORY DEBUG] Field "${field.name}" might need enhancement based on instructions: "${field.instructions.substring(0, 50)}..."`);
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
                        console.error(`[EXTRACTION FACTORY DEBUG] Extracted selector "${field.relativeSelectorOptional}" and attribute "${field.attributeName}" for field "${field.name}"`);
                      }
                    }

                    // Call the enhancement function with the full HTML content
                    const enhancedFields = await enhanceFieldsWithRelativeSelectorContent(
                      convertedFields,
                      this.page,
                      this.config.selector,
                      logger,
                      {
                        nodeName: nodeName || 'Ventriloquist',
                        nodeId: nodeId || 'unknown',
                        index: 0
                      },
                      fullHtmlContent // Pass the full HTML content to avoid selector search
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
                    console.error(`[EXTRACTION FACTORY DEBUG] Error enhancing fields: ${(enhanceError as Error).message}`);
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
          rawContent = await this.page.evaluate((selector) => {
            const elements = document.querySelectorAll(selector);
            return Array.from(elements).map(el => el.outerHTML).join('\n');
          }, this.config.selector);
          if (rawContent.length > 200) rawContent = rawContent.substring(0, 200) + '... [truncated]';

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
          console.error(`[EXTRACTION FACTORY DEBUG] AI processing requested with debug mode ON in ${nodeName}/${nodeId}`);
          console.error(`[EXTRACTION FACTORY DEBUG] OpenAI API key available (length: ${this.config.openaiApiKey.length})`);
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
          console.error(`[EXTRACTION FACTORY DEBUG] Calling processWithAI with model ${this.config.smartOptions.aiModel}`);

          const result = await processWithAI(
            // Pass the raw data for formatting
            rawContent,
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
