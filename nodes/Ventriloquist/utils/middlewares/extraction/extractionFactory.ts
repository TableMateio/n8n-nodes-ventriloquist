import type { Logger as ILogger } from 'n8n-workflow';
import type { Page } from 'puppeteer-core';
import type { IMiddleware, IMiddlewareContext } from '../middleware';
import { extractSmartContent, type ISmartExtractionOptions } from '../../smartExtractionUtils';
import { formatOperationLog } from '../../resultUtils';
import { IExtractItem } from '../../extractNodeUtils';
import { processWithAI, IAIFormattingOptions } from '../../smartExtractionUtils';
import { extractTableData } from '../../extractionUtils';

/**
 * Extraction configuration interface
 */
export interface IExtractionConfig {
  extractionType: string;
  selector: string;
  attributeName?: string;
  waitForSelector?: boolean;
  selectorTimeout?: number;
  // Additional properties needed for table extraction
  includeHeaders?: boolean;
  rowSelector?: string;
  cellSelector?: string;
  outputFormat?: string;
  extractAttributes?: boolean;
  // Additional properties needed for multiple extraction
  extractionProperty?: string;
  limit?: number;
  separator?: string;
  // Additional properties for HTML extraction
  includeMetadata?: boolean;
  // Additional properties for Text extraction
  cleanText?: boolean;
  // Additional properties for Smart extraction
  smartOptions?: {
    extractionFormat?: string;
    aiAssistance?: boolean;
    aiModel?: string;
    generalInstructions?: string;
    strategy?: string;
    includeSchema?: boolean;
    includeRawData?: boolean;
    includeReferenceContext?: boolean;
    referenceSelector?: string;
    referenceName?: string;
    referenceFormat?: string;
    referenceAttribute?: string;
    selectorScope?: string;
    referenceContent?: string;
  };
  // Fields for manual strategy in smart extraction
  fields?: {
    items?: Array<{
      name: string;
      type: string;
      instructions: string;
      format: string;
      formatString?: string;
      examples?: {
        items?: Array<{
          input: string;
          output: string;
        }>;
      };
    }>;
  };
  // API key for OpenAI access
  openaiApiKey?: string;
}

/**
 * Result of the extraction operation
 */
export interface IExtractionResult {
  success: boolean;
  data?: any;
  schema?: any;
  rawContent?: string;
  error?: {
    message: string;
    details?: any;
  };
}

/**
 * Extraction interface for extracting data from the page
 */
export interface IExtraction {
  execute(): Promise<IExtractionResult>;
}

/**
 * Basic extraction implementation
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
    const { logger, nodeName, nodeId } = this.context;
    const logPrefix = `[Extraction][${nodeName}]`;

    try {
      logger.debug(`${logPrefix} Extracting data with config: ${JSON.stringify(this.config)}`);

      // Check and log field definitions for manual strategy if present
      if (this.config.smartOptions?.strategy === 'manual' && this.config.fields?.items && this.config.fields.items.length > 0) {
        logger.debug(`${logPrefix} Using ${this.config.fields.items.length} field definitions for manual strategy`);

        // Map field.instructions to instructions property for OpenAI schema (not through description)
        if (this.config.fields.items.some(field => typeof field.instructions !== 'string')) {
          logger.warn(`${logPrefix} Some fields have missing instructions, ensure all fields have instructions for optimal extraction`);
        }
      }

      // Wait for selector if configured
      if (this.config.waitForSelector) {
        logger.debug(`${logPrefix} Waiting for selector: ${this.config.selector}`);
        try {
          await this.page.waitForSelector(this.config.selector, {
            timeout: this.config.selectorTimeout || 5000,
          });
        } catch (error) {
          logger.warn(`${logPrefix} Selector not found: ${this.config.selector}`);
          return {
            success: false,
            error: {
              message: `Selector not found: ${this.config.selector}`,
              details: error,
            },
          };
        }
      }

      // Extract data based on extraction type
      let data: any;
      let rawContent: string = '';

      switch (this.config.extractionType) {
        case 'text':
          // Changed from $eval to $$eval to get all matching elements
          const textElements = await this.page.$$eval(this.config.selector, (els) =>
            els.map(el => el.textContent?.trim() || '')
          );

          // Store all raw content joined together for compatibility
          rawContent = textElements.join('\n');
          if (rawContent.length > 200) rawContent = rawContent.substring(0, 200) + '... [truncated]';

          // If only one result was found, keep backwards compatibility by returning a string
          // Otherwise, return an array of results
          data = textElements.length === 1 ? textElements[0] : textElements;

          // Clean text if the option is enabled
          if (this.config.cleanText) {
            logger.info(`${logPrefix} Cleaning text content`);

            if (Array.isArray(data)) {
              // Clean each element in the array
              data = data.map(item => {
                // First replace all whitespace with regular spaces
                let cleaned = item.replace(/[\s\n\r\t\f\v]+/g, ' ');
                // Then replace multiple consecutive spaces with a single space
                cleaned = cleaned.replace(/ {2,}/g, ' ');
                // Replace newlines around spaces/whitespace
                cleaned = cleaned.replace(/\s*\n\s*/g, '\n');
                // Finally replace multiple consecutive newlines
                cleaned = cleaned.replace(/\n{2,}/g, '\n');
                return cleaned;
              });

              // Update rawContent to reflect cleaned data
              rawContent = data.join('\n');
            } else {
              // First replace all whitespace with regular spaces
              data = data.replace(/[\s\n\r\t\f\v]+/g, ' ');
              // Then replace multiple consecutive spaces with a single space
              data = data.replace(/ {2,}/g, ' ');
              // Replace newlines around spaces/whitespace
              data = data.replace(/\s*\n\s*/g, '\n');
              // Finally replace multiple consecutive newlines
              data = data.replace(/\n{2,}/g, '\n');

              // Update rawContent
              rawContent = data;
            }

            logger.info(`${logPrefix} Text cleaned successfully`);
          }
          break;

        case 'attribute':
          if (!this.config.attributeName) {
            throw new Error('Attribute name is required for attribute extraction');
          }

          try {
            // More targeted extraction when selector is for an anchor and attribute is href
            // This is a special case optimization for the common use case
            if (this.config.attributeName === 'href' &&
                (this.config.selector.toLowerCase().includes('a[') ||
                 this.config.selector.toLowerCase().includes('a.') ||
                 this.config.selector.toLowerCase() === 'a')) {

              logger.info(
                formatOperationLog(
                  'extraction',
                  nodeName,
                  nodeId,
                  0,
                  `Special handling for href attribute on anchor element using selector: ${this.config.selector}`
                )
              );

              // Try to get direct href from anchor elements
              const hrefValues = await this.page.$$eval(
                this.config.selector,
                (els) => els.map(el => el.getAttribute('href') || '')
              );

              // Store all raw content joined together for compatibility
              rawContent = hrefValues.join('\n');
              if (rawContent.length > 200) rawContent = rawContent.substring(0, 200) + '... [truncated]';

              // If only one result was found, keep backwards compatibility by returning a string
              // Otherwise, return an array of results
              data = hrefValues.length === 1 ? hrefValues[0] : hrefValues;
            } else {
              // Standard attribute extraction for other cases
              // Changed from $eval to $$eval to get all matching elements
              const attributeValues = await this.page.$$eval(
                this.config.selector,
                (els, attr) => els.map(el => el.getAttribute(attr) || ''),
                this.config.attributeName
              );

              // Store all raw content joined together for compatibility
              rawContent = attributeValues.join('\n');
              if (rawContent.length > 200) rawContent = rawContent.substring(0, 200) + '... [truncated]';

              // If only one result was found, keep backwards compatibility by returning a string
              // Otherwise, return an array of results
              data = attributeValues.length === 1 ? attributeValues[0] : attributeValues;
            }
          } catch (error) {
            logger.error(
              formatOperationLog(
                'extraction',
                nodeName,
                nodeId,
                0,
                `Error during attribute extraction: ${(error as Error).message}`
              )
            );
            throw error;
          }
          break;

        case 'html':
          // Changed from $eval to $$eval to get all matching elements
          const htmlContents = await this.page.$$eval(this.config.selector, (els) =>
            els.map(el => el.innerHTML)
          );

          // Store all raw content joined together for compatibility
          rawContent = htmlContents.join('\n');
          if (rawContent.length > 200) rawContent = rawContent.substring(0, 200) + '... [truncated]';

          // If only one result was found, keep backwards compatibility by returning a string
          // Otherwise, return an array of results
          data = htmlContents.length === 1 ? htmlContents[0] : htmlContents;
          break;

        case 'outerHtml':
          // Changed from $eval to $$eval to get all matching elements
          const outerHtmlContents = await this.page.$$eval(this.config.selector, (els) =>
            els.map(el => el.outerHTML)
          );

          // Store all raw content joined together for compatibility
          rawContent = outerHtmlContents.join('\n');
          if (rawContent.length > 200) rawContent = rawContent.substring(0, 200) + '... [truncated]';

          // If only one result was found, keep backwards compatibility by returning a string
          // Otherwise, return an array of results
          data = outerHtmlContents.length === 1 ? outerHtmlContents[0] : outerHtmlContents;
          break;

        case 'smart':
          // Handle smart extraction using the new utility
          logger.info(`${logPrefix} Using smart extraction for selector: ${this.config.selector}`);

          if (!this.config.smartOptions) {
            throw new Error('Smart options are required for smart extraction');
          }

          // Check if OpenAI API key is provided
          if (!this.config.openaiApiKey) {
            throw new Error('OpenAI API key is required for smart extraction');
          }

          try {
            // Get raw content from the element
            rawContent = await this.page.$eval(this.config.selector, (el) => el.textContent?.trim() || '');
            if (rawContent.length > 200) rawContent = rawContent.substring(0, 200) + '... [truncated]';

            // Create properly typed smart options
            const smartOptions: ISmartExtractionOptions = {
              enabled: true,
              extractionFormat: (this.config.smartOptions.extractionFormat as 'json' | 'csv' | 'text' | 'auto') || 'json',
              aiModel: this.config.smartOptions.aiModel || 'gpt-4',
              generalInstructions: this.config.smartOptions.generalInstructions || '',
              strategy: (this.config.smartOptions.strategy as 'auto' | 'manual') || 'auto',
              includeSchema: this.config.smartOptions.includeSchema === true,
              includeRawData: this.config.smartOptions.includeRawData === true,
              includeReferenceContext: this.config.smartOptions.includeReferenceContext === true,
              referenceSelector: this.config.smartOptions.referenceSelector || '',
              referenceName: this.config.smartOptions.referenceName || 'referenceContext',
              referenceFormat: this.config.smartOptions.referenceFormat || '',
              referenceAttribute: this.config.smartOptions.referenceAttribute || '',
              selectorScope: this.config.smartOptions.selectorScope || '',
              referenceContent: this.config.smartOptions.referenceContent || ''
            };

            // Log reference context if available
            if (smartOptions.includeReferenceContext && smartOptions.referenceContent) {
              logger.debug(`${logPrefix} Reference context provided for smart extraction: ${smartOptions.referenceName}`);
            }

            // Create a context object with the required properties
            const extractContext: IMiddlewareContext = {
              logger: this.context.logger,
              nodeName: this.context.nodeName,
              nodeId: this.context.nodeId,
              index: this.context.index || 0, // Provide a default value for index
              sessionId: this.context.sessionId || 'unknown' // Add the sessionId
            };

            // Log fields for debugging
            if (this.config.fields?.items && this.config.fields.items.length > 0) {
              logger.debug(`${logPrefix} Using ${this.config.fields.items.length} field definitions for manual strategy`);
            }

            const smartResult = await extractSmartContent(
              this.page,
              this.config.selector,
              smartOptions,
              this.config.fields?.items,
              this.config.openaiApiKey,
              extractContext
            );

            // Set the data from the smart extraction result
            data = smartResult;
            logger.info(`${logPrefix} Smart extraction successful`);
          } catch (error) {
            logger.error(`${logPrefix} Smart extraction failed: ${(error as Error).message}`);
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

        // Verify API key is valid (sufficient length)
        if (this.config.openaiApiKey.length < 20) {
          logger.warn(`${logPrefix} OpenAI API key appears to be invalid (length: ${this.config.openaiApiKey.length}) - skipping AI processing`);
          return {
            success: true,
            data,
            rawContent
          };
        }

        // Prepare AI formatting options
        const aiFormattingOptions: IAIFormattingOptions = {
          enabled: true,
          extractionFormat: this.config.smartOptions.extractionFormat || 'json',
          aiModel: this.config.smartOptions.aiModel || 'gpt-4',
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
          referenceContent: this.config.smartOptions.referenceContent || ''
        };

        logger.info(`${logPrefix} Applying AI formatting with ${aiFormattingOptions.strategy} strategy, format: ${aiFormattingOptions.extractionFormat}`);
        logger.info(`${logPrefix} AI options: includeSchema=${aiFormattingOptions.includeSchema}, includeRawData=${aiFormattingOptions.includeRawData}`);

        // Determine what content to send to AI based on extraction type and strategy
        let contentForAI = data;

        // For HTML content, sometimes we need the raw HTML instead of parsed text
        if (this.config.extractionType === 'html' ||
            (this.config.extractionType === 'multiple' &&
             this.config.extractionProperty === 'outerHTML')) {
          contentForAI = rawContent;
          logger.info(`${logPrefix} Using raw HTML content for AI processing`);
        }

        // Log the field definitions for manual strategy
        if (aiFormattingOptions.strategy === 'manual' && this.config.fields?.items) {
          logger.info(`${logPrefix} Using manual strategy with ${this.config.fields.items.length} field definitions`);
        }

        try {
          // Process with AI - ensure we're passing the API key correctly
          const apiKey = this.config.openaiApiKey;
          if (!apiKey) {
            logger.error(`${logPrefix} OpenAI API key is missing before AI processing`);
          }

          const aiResult = await processWithAI(
            contentForAI,
            aiFormattingOptions,
            this.config.fields?.items || [],
            apiKey, // Explicitly use the local variable to ensure it's passed correctly
            {
              logger,
              nodeName,
              nodeId: this.context.nodeId,
              index: this.context.index || 0
            }
          );

          // Check if AI processing was successful
          if (aiResult.success) {
            logger.info(`${logPrefix} AI formatting successful`);

            // Make sure we return the schema even if there's no data
            if (aiResult.schema) {
              logger.info(`${logPrefix} Schema provided by AI processing, including in result`);
            }

            return {
              success: true,
              data: aiResult.data,
              schema: aiResult.schema,
              rawContent
            };
          } else {
            // Log AI processing error but return original content
            logger.warn(`${logPrefix} AI formatting failed: ${aiResult.error}. Returning original extracted content.`);
            return {
              success: true,
              data,
              rawContent
            };
          }
        } catch (error) {
          // If AI processing fails, log the error but continue with the original data
          logger.error(`${logPrefix} AI processing error: ${(error as Error).message}`);
          return {
            success: true,
            data,
            rawContent,
            error: {
              message: `AI processing failed: ${(error as Error).message}`,
              details: error
            }
          };
        }
      } else if (this.config.smartOptions?.aiAssistance === true) {
        // Log that we're missing the API key
        logger.warn(`${logPrefix} AI processing was requested but no OpenAI API key was provided`);
      }

      return {
        success: true,
        data,
        rawContent
      };
    } catch (error) {
      logger.error(`${logPrefix} Extraction failed: ${(error as Error).message}`);

      return {
        success: false,
        error: {
          message: (error as Error).message,
          details: error,
        },
        rawContent: ''
      };
    }
  }
}

/**
 * Create an extraction instance
 */
export function createExtraction(
  page: Page,
  config: IExtractionConfig,
  context: {
    logger: ILogger;
    nodeName: string;
    nodeId: string;
    sessionId: string;
    index?: number;
  }
): IExtraction {
  // Convert to IMiddlewareContext
  const middlewareContext: IMiddlewareContext = {
    logger: context.logger,
    nodeName: context.nodeName,
    nodeId: context.nodeId,
    sessionId: context.sessionId,
    index: context.index,
  };

  return new BasicExtraction(page, config, middlewareContext);
}
