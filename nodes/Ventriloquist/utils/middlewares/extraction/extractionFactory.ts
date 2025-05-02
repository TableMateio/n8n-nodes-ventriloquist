import type { Logger as ILogger } from 'n8n-workflow';
import type { Page } from 'puppeteer-core';
import type { IMiddleware, IMiddlewareContext } from '../middleware';
import { extractSmartContent, type ISmartExtractionOptions } from '../../smartExtractionUtils';
import { formatOperationLog } from '../../resultUtils';
import { IExtractItem } from '../../extractNodeUtils';
import { processWithAI, IAIFormattingOptions } from '../../smartExtractionUtils';
import { extractTableData } from '../../extractionUtils';
import { logWithDebug } from '../../loggingUtils';
import { TableExtraction } from './TableExtraction';
import { MultipleExtraction } from './TableExtraction';

/**
 * Extraction configuration interface
 */
export interface IExtractionConfig {
  id?: string;
  extractionType: string;
  selector: string;
  attributeName?: string;
  waitForSelector?: boolean;
  selectorTimeout?: number;
  debugMode?: boolean;
  preserveFieldStructure?: boolean;
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
    debugMode?: boolean;
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
          // Modified to handle BR tags and excessive newlines
          const textContent = await this.page.$eval(this.config.selector, (el) => {
            // Get the original HTML
            const originalHtml = el.innerHTML;

            // First, directly replace all <br> tags with newlines in the HTML
            // This is a more direct approach than using the document fragment
            let modifiedHtml = originalHtml.replace(/<br\s*\/?>/gi, '\n');

            // Create a temporary div to extract text
            const tempDiv = document.createElement('div');
            tempDiv.innerHTML = modifiedHtml;

            // Get text content
            let content = tempDiv.textContent || '';

            // Remove excessive whitespace at the beginning (common in HTML)
            content = content.replace(/^\s+/, '');

            // Normalize whitespace: replace multiple spaces with single space
            content = content.replace(/ {2,}/g, ' ');

            // Limit consecutive newlines to a maximum of 2
            content = content.replace(/\n{3,}/g, '\n\n');

            // Trim leading and trailing whitespace
            content = content.trim();

            return content;
          });

          // Store raw content
          rawContent = textContent;
          if (rawContent.length > 200) rawContent = rawContent.substring(0, 200) + '... [truncated]';

          // Set data to the extracted text
          data = textContent;

          // Apply additional text cleaning if the option is enabled
          if (this.config.cleanText) {
            logger.info(`${logPrefix} Applying additional text cleaning`);

            if (Array.isArray(data)) {
              // Clean each element in the array
              data = data.map(item => {
                // Replace any remaining excessive whitespace
                let cleaned = item.replace(/ {2,}/g, ' ');
                // Ensure single newlines are preserved
                cleaned = cleaned.replace(/\n{3,}/g, '\n\n');
                return cleaned.trim();
              });
            } else if (typeof data === 'string') {
              // Replace any remaining excessive whitespace
              data = data.replace(/ {2,}/g, ' ');
              // Ensure single newlines are preserved
              data = data.replace(/\n{3,}/g, '\n\n');
              data = data.trim();
            }

            // Update rawContent to reflect cleaned data
            if (Array.isArray(data)) {
              rawContent = data.join('\n');
            } else {
              rawContent = data;
            }
            if (rawContent.length > 200) rawContent = rawContent.substring(0, 200) + '... [truncated]';

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
              referenceContent: this.config.smartOptions.referenceContent || '',
              debugMode: this.config.smartOptions.debugMode === true,
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

          logWithDebug(
            logger,
            this.config.debugMode || false,
            this.context.nodeName,
            'Extraction',
            'extractionFactory',
            'execute',
            `Table extraction starting: selector=${this.config.selector}, rowSelector=${rowSelector}, cellSelector=${cellSelector}, includeHeaders=${includeHeaders}, outputFormat=${tableOutputFormat}, extractAttributes=${extractAttributes}`,
            'info'
          );

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
              logWithDebug(
                logger,
                this.config.debugMode || false,
                this.context.nodeName,
                'Extraction',
                'extractionFactory',
                'execute',
                `Extracting table as structured data`,
                'info'
              );

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

              // Log extraction information including whether attributes are extracted
              logWithDebug(
                logger,
                this.config.debugMode || false,
                this.context.nodeName,
                'Extraction',
                'extractionFactory',
                'execute',
                `Table data extracted: ${Array.isArray(data) ? data.length : 'object'} rows found, extracting attributes: ${extractAttributes ? attributeName : 'none'}`,
                'info'
              );

              // Check if smartOptions are enabled and we're using AI processing
              if (this.config.smartOptions && this.config.smartOptions.aiAssistance && data) {
                // Log that we're preserving data structures for AI processing
                logWithDebug(
                  logger,
                  this.config.debugMode || false,
                  this.context.nodeName,
                  'Extraction',
                  'extractionFactory',
                  'execute',
                  `Preserving original data structures for AI processing to maintain integrity of arrays, objects, and primitive values`,
                  'info'
                );
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
        logWithDebug(
          logger,
          this.config.debugMode || false,
          this.context.nodeName,
          'Extraction',
          'extractionFactory',
          'execute',
          `Using OpenAI API key for AI processing. Key length: ${this.config.openaiApiKey.length}`,
          'info'
        );

        // Log debug mode state for maximum visibility
        const isDebugMode = this.config.smartOptions?.debugMode === true;
        if (isDebugMode) {
          logWithDebug(
            this.context.logger,
            this.config.debugMode || false,
            this.context.nodeName,
            'extraction',
            'extractionFactory',
            'processWithAI',
            `AI processing requested with debug mode ON`,
            'error'
          );
        }

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
          referenceContent: this.config.smartOptions.referenceContent || '',
          debugMode: isDebugMode  // Pass debug mode flag explicitly
        };

        logWithDebug(
          logger,
          this.config.debugMode || false,
          this.context.nodeName,
          'Extraction',
          'extractionFactory',
          'execute',
          `Applying AI formatting with ${aiFormattingOptions.strategy} strategy, format: ${aiFormattingOptions.extractionFormat}`,
          'info'
        );
        logWithDebug(
          logger,
          this.config.debugMode || false,
          this.context.nodeName,
          'Extraction',
          'extractionFactory',
          'execute',
          `AI options: includeSchema=${aiFormattingOptions.includeSchema}, includeRawData=${aiFormattingOptions.includeRawData}, debugMode=${aiFormattingOptions.debugMode}`,
          'info'
        );

        // Direct console log if debug mode is enabled
        if (isDebugMode) {
          logWithDebug(
            this.context.logger,
            this.config.debugMode || false,
            this.context.nodeName,
            'extraction',
            'extractionFactory',
            'processWithAI',
            `Calling processWithAI with model ${aiFormattingOptions.aiModel}`,
            'error'
          );
        }

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
            logWithDebug(
              logger,
              this.config.debugMode || false,
              this.context.nodeName,
              'Extraction',
              'extractionFactory',
              'execute',
              `AI formatting successful`,
              'info'
            );

            // Make sure we return the schema even if there's no data
            if (aiResult.schema) {
              logWithDebug(
                logger,
                this.config.debugMode || false,
                this.context.nodeName,
                'Extraction',
                'extractionFactory',
                'execute',
                `Schema provided by AI processing, including in result`,
                'info'
              );
            }

            return {
              success: true,
              data: aiResult.data,
              schema: aiResult.schema,
              rawContent
            };
          } else {
            // Log AI processing error but return error status instead of original content
            logWithDebug(
              logger,
              this.config.debugMode || false,
              this.context.nodeName,
              'Extraction',
              'extractionFactory',
              'execute',
              `AI formatting failed: ${aiResult.error}. Not falling back to original content.`,
              'warn'
            );
            return {
              success: false,
              error: {
                message: `AI formatting failed: ${aiResult.error}`,
                details: aiResult.error
              },
              // Include the raw content for debugging
              rawContent
            };
          }
        } catch (error) {
          // If AI processing fails, log the error and return error instead of original data
          logWithDebug(
            logger,
            this.config.debugMode || false,
            this.context.nodeName,
            'Extraction',
            'extractionFactory',
            'execute',
            `AI processing error: ${(error as Error).message}`,
            'error'
          );
          return {
            success: false,
            error: {
              message: `AI processing failed: ${(error as Error).message}`,
              details: error
            },
            // Include the raw content for debugging
            rawContent
          };
        }
      } else if (this.config.smartOptions?.aiAssistance === true) {
        // Log that we're missing the API key
        logWithDebug(
          logger,
          this.config.debugMode || false,
          this.context.nodeName,
          'Extraction',
          'extractionFactory',
          'execute',
          `AI processing was requested but no OpenAI API key was provided`,
          'warn'
        );
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
 * Create an extraction instance based on the configuration
 */
export function createExtraction(page: Page, config: IExtractionConfig, context: IMiddlewareContext): IExtraction {
  const { logger, nodeName, nodeId } = context;
  const { extractionType, smartOptions } = config;

  // Check for AI formatting and OpenAI API key
  const hasAiFormatting = smartOptions && smartOptions.aiAssistance && config.openaiApiKey;

  // Check for manual fields definition
  const hasManualFields = config.fields && config.fields.items && config.fields.items.length > 0;

  // Check if field structure needs to be preserved
  const preserveFieldStructure = config.preserveFieldStructure === true;

  // Log the extraction type and any special handling
  logger.debug(`[ExtractFactory][${nodeName}] Creating extraction with type: ${extractionType}, AI: ${hasAiFormatting ? 'enabled' : 'disabled'}, Manual fields: ${hasManualFields ? 'yes' : 'no'}, Preserve structure: ${preserveFieldStructure ? 'yes' : 'no'}`);

  // Prioritize field-by-field extraction in several cases:
  // 1. When manual fields are defined with AI formatting
  // 2. When preserveFieldStructure flag is explicitly set (e.g. for nested fields)
  // 3. When using manual strategy and fields are defined
  // 4. When it's a table extraction with manual fields defined (to ensure proper field structure)
  if ((hasAiFormatting && smartOptions?.strategy === 'manual' && hasManualFields) ||
      preserveFieldStructure ||
      (extractionType === 'table' && hasManualFields)) {
    // When manual fields are defined with AI formatting, prioritize field-by-field extraction
    // over special extraction types like table
    logger.info(
      formatOperationLog(
        'ExtractFactory',
        nodeName,
        nodeId,
        context.index !== undefined ? context.index : 0,
        `Using field-by-field extraction for ${preserveFieldStructure ? 'field structure preservation' :
         extractionType === 'table' ? 'table with manual fields' : 'manual schema'} (overriding ${extractionType} extraction type)`
      )
    );

    return new BasicExtraction(page, config, context);
  }

  // Otherwise, use extraction type-specific implementations
  switch (extractionType) {
    case 'text':
      return new BasicExtraction(page, config, context);
    case 'attribute':
      return new BasicExtraction(page, config, context);
    case 'value':
      return new BasicExtraction(page, config, context);
    case 'html':
      return new BasicExtraction(page, config, context);
    case 'multiple':
      return new MultipleExtraction(page, config, context);
    case 'table':
      return new TableExtraction(page, config, context);
    default:
      logger.warn(`[ExtractFactory][${nodeName}] Unknown extraction type: ${extractionType}, falling back to BasicExtraction`);
      return new BasicExtraction(page, config, context);
  }
}
