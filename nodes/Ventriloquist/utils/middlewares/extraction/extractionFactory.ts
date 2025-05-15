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
    outputStructure?: 'object' | 'array';
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
          // Extract text content with improved HTML handling and whitespace normalization
          logger.info(`${logPrefix} Extracting text content from selector: ${this.config.selector}`);

          try {
            const textContent = await this.page.$eval(this.config.selector, (el) => {
              // Try to get innerText first, which has better handling of visibility
              const innerText = (el as HTMLElement).innerText || '';

              // Get outerHTML as fallback, especially useful for debugging
              const outerHTML = el.outerHTML || '';

              return {
                innerText,
                outerHTML
              };
            });

            // Strongly prefer innerText, as it already handles browser-level rendering
            let processedText = textContent.innerText && textContent.innerText.trim().length > 0
              ? textContent.innerText
              : textContent.outerHTML;

            // Store raw content before any cleaning
            rawContent = processedText;

            // Log the raw extraction
            logger.info(`${logPrefix} Raw extracted content type: ${typeof processedText}, length: ${processedText.length}`);
            if (processedText.length > 100) {
              logger.info(`${logPrefix} Raw extracted content preview: ${processedText.substring(0, 100)}...`);
            }

            // Basic cleaning that happens regardless of cleanText option
            // Remove problematic and invisible HTML elements that commonly cause issues
            if (processedText.includes('<iframe') ||
                processedText.includes('<script') ||
                processedText.includes('<style')) {

              logger.info(`${logPrefix} Detected HTML elements in content, applying basic removal...`);

              // Remove iframes completely - these often create the biggest problems
              processedText = processedText.replace(/<iframe\b[^<]*(?:(?!<\/iframe>)<[^<]*)*<\/iframe>/gi, '');

              // Remove scripts
              processedText = processedText.replace(/<script\b[^<]*(?:(?!<\/script>)<[^<]*)*<\/script>/gi, '');

              // Remove styles
              processedText = processedText.replace(/<style\b[^<]*(?:(?!<\/style>)<[^<]*)*<\/style>/gi, '');
            }

            // Apply enhanced text cleaning if enabled
            if (this.config.cleanText) {
              logger.info(`${logPrefix} CleanText enabled, applying enhanced text cleaning`);

              // First handle <br> tags properly before any other HTML cleaning
              processedText = processedText.replace(/<br\s*\/?>/gi, '\n');

              // Remove all other HTML tags
              processedText = processedText.replace(/<[^>]*>/g, '');

              // Decode common HTML entities
              const htmlEntities: Record<string, string> = {
                '&nbsp;': ' ',
                '&amp;': '&',
                '&lt;': '<',
                '&gt;': '>',
                '&quot;': '"',
                '&#39;': "'",
                '&apos;': "'",
                '&mdash;': '—',
                '&ndash;': '–'
              };

              for (const [entity, replacement] of Object.entries(htmlEntities)) {
                processedText = processedText.replace(new RegExp(entity, 'g'), replacement);
              }

              // Handle numeric HTML entities
              processedText = processedText.replace(/&#(\d+);/g, (match, dec) =>
                String.fromCharCode(parseInt(dec, 10)));

              // Handle hex HTML entities
              processedText = processedText.replace(/&#[xX]([A-Fa-f0-9]+);/g, (match, hex) =>
                String.fromCharCode(parseInt(hex, 16)));

              // Advanced whitespace normalization

              // First handle tabs
              processedText = processedText.replace(/\t+/g, ' ');

              // Normalize line breaks
              processedText = processedText.replace(/\r\n?/g, '\n');

              // Replace multiple spaces with a single space
              processedText = processedText.replace(/[ \xA0]+/g, ' ');

              // Remove spaces before and after newlines
              processedText = processedText.replace(/ *\n */g, '\n');

              // Split by lines, trim each line, and remove empty lines
              const lines = processedText.split('\n');
              const nonEmptyLines = lines
                .map((line: string) => line.trim())
                .filter((line: string) => line.length > 0);

              // Join lines with single newlines
              processedText = nonEmptyLines.join('\n');

              // Final pass to replace more than 2 consecutive newlines with just 2
              processedText = processedText.replace(/\n{3,}/g, '\n\n');

              logger.info(`${logPrefix} Text cleaned successfully, reduced from ${rawContent.length} to ${processedText.length} chars`);
            } else {
              // Even without cleanText enabled, apply minimal cleanup for consistent behavior
              logger.info(`${logPrefix} CleanText disabled, applying minimal cleanup`);

              // Basic tab handling
              processedText = processedText.replace(/\t+/g, ' ');

              // Replace multiple consecutive spaces
              processedText = processedText.replace(/[ ]{3,}/g, ' ');

              // Handle excessive newlines but preserve more formatting than full clean
              processedText = processedText.replace(/\n{5,}/g, '\n\n\n\n');
            }

            // Store full content in data
            data = processedText;

            // Only truncate for logging purposes
            if (processedText.length > 200) {
              rawContent = processedText.substring(0, 200) + '... [truncated]';
            } else {
              rawContent = processedText;
            }
          } catch (error) {
            logger.error(`${logPrefix} Error extracting text content: ${(error as Error).message}`);
            throw error;
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

              // Store full data
              data = hrefValues.length === 1 ? hrefValues[0] : hrefValues;

              // Only truncate for logging purposes
              rawContent = hrefValues.join('\n');
              if (rawContent.length > 200) rawContent = rawContent.substring(0, 200) + '... [truncated]';
            } else {
              // Standard attribute extraction for other cases
              // Changed from $eval to $$eval to get all matching elements
              const attributeValues = await this.page.$$eval(
                this.config.selector,
                (els, attr) => els.map(el => el.getAttribute(attr) || ''),
                this.config.attributeName
              );

              // Store full data
              data = attributeValues.length === 1 ? attributeValues[0] : attributeValues;

              // Only truncate for logging purposes
              rawContent = attributeValues.join('\n');
              if (rawContent.length > 200) rawContent = rawContent.substring(0, 200) + '... [truncated]';
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

          // Store full data
          data = htmlContents.length === 1 ? htmlContents[0] : htmlContents;

          // Only truncate for logging purposes
          rawContent = htmlContents.join('\n');
          if (rawContent.length > 200) rawContent = rawContent.substring(0, 200) + '... [truncated]';
          break;

        case 'outerHtml':
          // Changed from $eval to $$eval to get all matching elements
          const outerHtmlContents = await this.page.$$eval(this.config.selector, (els) =>
            els.map(el => el.outerHTML)
          );

          // Store full data
          data = outerHtmlContents.length === 1 ? outerHtmlContents[0] : outerHtmlContents;

          // Only truncate for logging purposes
          rawContent = outerHtmlContents.join('\n');
          if (rawContent.length > 200) rawContent = rawContent.substring(0, 200) + '... [truncated]';
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
            const fullContent = await this.page.$eval(this.config.selector, (el) => el.textContent?.trim() || '');

            // Store the full content, only truncate for logging
            if (fullContent.length > 200) {
              rawContent = fullContent.substring(0, 200) + '... [truncated]';
            } else {
              rawContent = fullContent;
            }

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
              outputStructure: this.config.smartOptions.outputStructure as 'object' | 'array' || 'object',
            };

            // Log reference context if available
            if (smartOptions.includeReferenceContext && smartOptions.referenceContent) {
              logger.debug(`${logPrefix} Reference context provided for smart extraction: ${smartOptions.referenceName}`);
            }

            // Create properly typed context object for processing with AI
            const aiContext = {
              logger: this.context.logger,
              nodeName: this.context.nodeName,
              nodeId: this.context.nodeId,
              sessionId: this.context.sessionId || 'unknown',
              index: this.context.index || 0
            };

            // Log fields for debugging
            if (this.config.fields?.items && this.config.fields.items.length > 0) {
              logger.debug(`${logPrefix} Using ${this.config.fields.items.length} field definitions for manual strategy`);
            }

            // Use processWithAI directly with the content we already extracted
            const aiResult = await processWithAI(
              fullContent,
              smartOptions,
              this.config.fields?.items,
              this.config.openaiApiKey,
              aiContext
            );

            // Set the data from the AI processing result
            data = aiResult.data;
            // Don't set schema here as we don't have it defined

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

          try {
            if (tableOutputFormat === 'html') {
              // Extract full HTML without truncation
              const fullHtml = await this.page.$eval(this.config.selector, (el) => el.outerHTML);

              // Store full HTML in data
              data = fullHtml;

              // Only truncate for logging purposes
              if (fullHtml.length > 200) {
                rawContent = fullHtml.substring(0, 200) + '... [truncated]';
              } else {
                rawContent = fullHtml;
              }
            } else {
              // Extract structured data
              data = await this.page.evaluate(
                (
                  selector: string,
                  rowSel: string,
                  cellSel: string,
                  includeHead: boolean,
                  extractAttrs: boolean,
                  attrName: string,
                ) => {
                  const table = document.querySelector(selector);
                  if (!table) return { rows: [], headers: [] };

                  // Find all rows
                  const rowNodes = table.querySelectorAll(rowSel);
                  const rows: any[][] = [];
                  let headers: string[] = [];

                  // Process rows
                  rowNodes.forEach((row, rowIndex) => {
                    // Skip the first row if we're using it as headers
                    if (rowIndex === 0 && includeHead) {
                      const headerCells = row.querySelectorAll(cellSel);
                      headerCells.forEach((cell) => {
                        headers.push(cell.textContent?.trim() || '');
                      });
                      return;
                    }

                    // Process regular rows
                    const cells = row.querySelectorAll(cellSel);
                    const rowData: any[] = [];

                    cells.forEach((cell) => {
                      // Handle text or attribute extraction
                      if (extractAttrs) {
                        const link = cell.querySelector('a');
                        if (link && link.getAttribute(attrName)) {
                          rowData.push(link.getAttribute(attrName));
                        } else {
                          rowData.push(cell.textContent?.trim() || '');
                        }
                      } else {
                        rowData.push(cell.textContent?.trim() || '');
                      }
                    });

                    if (rowData.length > 0) {
                      rows.push(rowData);
                    }
                  });

                  return { rows, headers };
                },
                this.config.selector,
                rowSelector,
                cellSelector,
                includeHeaders,
                extractAttributes,
                this.config.attributeName || 'href',
              );

              // Generate raw content representation for logging
              let tableString = '';

              if (data.headers && data.headers.length) {
                tableString += data.headers.join(', ') + '\n';
              }

              if (data.rows && data.rows.length) {
                tableString += data.rows.map((row: any[]) => row.join(', ')).join('\n');
              }

              // Only truncate for logging purposes
              if (tableString.length > 200) {
                rawContent = tableString.substring(0, 200) + '... [truncated]';
              } else {
                rawContent = tableString;
              }
            }
          } catch (error) {
            logger.error(`${logPrefix} Table extraction failed: ${(error as Error).message}`);
            throw error;
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

                  // First check for HTML content that needs special handling
                  if (textContent.includes('<iframe') ||
                      textContent.includes('<script') ||
                      textContent.includes('<style')) {

                    // Remove problematic HTML elements
                    textContent = textContent.replace(/<iframe\b[^<]*(?:(?!<\/iframe>)<[^<]*)*<\/iframe>/gi, '');
                    textContent = textContent.replace(/<script\b[^<]*(?:(?!<\/script>)<[^<]*)*<\/script>/gi, '');
                    textContent = textContent.replace(/<style\b[^<]*(?:(?!<\/style>)<[^<]*)*<\/style>/gi, '');
                  }

                  // Handle <br> tags properly
                  textContent = textContent.replace(/<br\s*\/?>/gi, '\n');

                  // Remove all other HTML tags
                  textContent = textContent.replace(/<[^>]*>/g, '');

                  // First handle tabs and other whitespace characters
                  textContent = textContent.replace(/[\t\f\v]+/g, ' ');

                  // Normalize line breaks
                  textContent = textContent.replace(/\r\n?/g, '\n');

                  // Replace multiple spaces with a single space
                  textContent = textContent.replace(/[ \xA0]+/g, ' ');

                  // Remove spaces before and after newlines
                  textContent = textContent.replace(/ *\n */g, '\n');

                  // Split by lines, trim each line, and remove empty lines
                  const lines = textContent.split('\n');
                  const nonEmptyLines = lines
                    .map((line: string) => line.trim())
                    .filter((line: string) => line.length > 0);

                  // Join lines with single newlines
                  textContent = nonEmptyLines.join('\n');

                  // Final pass to replace more than 2 consecutive newlines with just 2
                  textContent = textContent.replace(/\n{3,}/g, '\n\n');

                  logger.info(`${logPrefix} Text cleaned - new length: ${textContent.length}`);
                } else {
                  // Even without cleanText, do basic cleaning
                  textContent = textContent.replace(/\t+/g, ' ');
                  textContent = textContent.replace(/[ ]{3,}/g, ' ');
                  textContent = textContent.replace(/\n{5,}/g, '\n\n\n\n');
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

      // Check if AI formatting should be applied
      const aiFormattingOptions = this.config.smartOptions;

      // Corrected Condition: Check for valid strategy and API key, not non-existent aiAssistance
      if (aiFormattingOptions &&
          (aiFormattingOptions.strategy === 'manual' || aiFormattingOptions.strategy === 'auto') &&
          this.config.openaiApiKey) {
        // AI processing should happen

        // Define isDebugMode safely within this block
        const isDebugMode = aiFormattingOptions.debugMode === true;

        // Cast aiFormattingOptions to ensure type checker recognizes its properties
        const confirmedSmartOptions = aiFormattingOptions as ISmartExtractionOptions;

        logWithDebug(
          logger,
          this.config.debugMode || false,
          this.context.nodeName,
          'Extraction',
          'extractionFactory',
          'execute',
          `Applying AI formatting with ${confirmedSmartOptions.strategy} strategy, format: ${confirmedSmartOptions.extractionFormat}`,
          'info'
        );
        logWithDebug(
          logger,
          this.config.debugMode || false,
          this.context.nodeName,
          'Extraction',
          'extractionFactory',
          'execute',
          // Use aiFormattingOptions here, as it's guaranteed to exist
          `AI options: includeSchema=${confirmedSmartOptions.includeSchema}, includeRawData=${confirmedSmartOptions.includeRawData}, debugMode=${confirmedSmartOptions.debugMode}`,
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
            // Use aiFormattingOptions here, as it's guaranteed to exist
            `Calling processWithAI with model ${confirmedSmartOptions.aiModel}`,
            'error'
          );
        }

        // Determine what content to send to AI based on extraction type and strategy
        let contentForAI = data;

        // For HTML content, sometimes we need the raw HTML instead of parsed text
        // Important: rawContent may contain truncated text, we should never use it for AI processing
        if (this.config.extractionType === 'html' ||
            (this.config.extractionType === 'multiple' &&
             this.config.extractionProperty === 'outerHTML')) {

            // For HTML content, we need to ensure we're using the full content
            // Re-extract the full HTML content if needed to avoid using truncated content
            try {
                // Re-fetch the full HTML to ensure we're not using truncated content
                if (this.config.extractionType === 'html') {
                    const fullHtml = await this.page.$$eval(this.config.selector, (els) =>
                        els.map(el => el.innerHTML).join('\n')
                    );
                    contentForAI = fullHtml.length === 1 ? fullHtml[0] : fullHtml;
                    logger.info(`${logPrefix} Re-extracted full HTML content for AI processing, length: ${typeof contentForAI === 'string' ? contentForAI.length : 'array'}`);
                } else if (this.config.extractionType === 'multiple') {
                    const fullHtml = await this.page.evaluate((selector) => {
                        const elements = document.querySelectorAll(selector);
                        return Array.from(elements).map(el => el.outerHTML).join('\n');
                    }, this.config.selector);
                    contentForAI = fullHtml;
                    logger.info(`${logPrefix} Re-extracted full HTML content for multiple items, length: ${fullHtml.length}`);
                }
            } catch (error) {
                // If re-extraction fails, fall back to data but log the issue
                logger.warn(`${logPrefix} Failed to re-extract full HTML content: ${(error as Error).message}. Using original data instead.`);
            }
        }

        // Add debug logging to see what's being sent to the AI
        if (isDebugMode) {
            const contentPreview = typeof contentForAI === 'string'
                ? (contentForAI.length > 100 ? contentForAI.substring(0, 100) + '...' : contentForAI)
                : (Array.isArray(contentForAI) ? `Array with ${contentForAI.length} items` : typeof contentForAI);

            logWithDebug(
                this.context.logger,
                true, // Force display this debug message
                this.context.nodeName,
                'extraction',
                'extractionFactory',
                'processWithAI',
                `Content being sent to AI: ${contentPreview}`,
                'info'
            );
        }

        // Log the field definitions for manual strategy
        if (confirmedSmartOptions.strategy === 'manual' && this.config.fields?.items) {
          logger.info(`${logPrefix} Using manual strategy with ${this.config.fields.items.length} field definitions`);
        }

        try {
          // Process with AI - ensure we're passing the API key correctly
          const apiKey = this.config.openaiApiKey; // API key is confirmed present by the outer if

          // Construct the options object for processWithAI, ensuring it matches ISmartExtractionOptions
          const optionsForProcessWithAI: ISmartExtractionOptions = {
            enabled: true, // Required property
            extractionFormat: confirmedSmartOptions.extractionFormat || 'json', // Default if needed
            aiModel: confirmedSmartOptions.aiModel || 'gpt-3.5-turbo', // Default if needed
            generalInstructions: confirmedSmartOptions.generalInstructions || '',
            strategy: confirmedSmartOptions.strategy, // Already checked this is 'manual' or 'auto'
            includeSchema: confirmedSmartOptions.includeSchema === true,
            includeRawData: confirmedSmartOptions.includeRawData === true,
            debugMode: isDebugMode,
            outputStructure: confirmedSmartOptions.outputStructure, // Pass through (can be undefined)
            fieldProcessingMode: confirmedSmartOptions.fieldProcessingMode, // Pass through (can be undefined)
            includeReferenceContext: confirmedSmartOptions.includeReferenceContext,
            referenceSelector: confirmedSmartOptions.referenceSelector,
            referenceName: confirmedSmartOptions.referenceName,
            referenceFormat: confirmedSmartOptions.referenceFormat,
            referenceAttribute: confirmedSmartOptions.referenceAttribute,
            selectorScope: confirmedSmartOptions.selectorScope,
            referenceContent: confirmedSmartOptions.referenceContent,
          };

          const aiResult = await processWithAI(
            contentForAI,
            optionsForProcessWithAI, // Pass the well-typed object
            this.config.fields?.items || [],
            apiKey,
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
      } else if (aiFormattingOptions && (aiFormattingOptions.strategy === 'manual' || aiFormattingOptions.strategy === 'auto')) {
        // Log that AI processing is skipped (e.g., no API key or strategy is 'none')
        logWithDebug(
          logger,
          this.config.debugMode || false,
          this.context.nodeName,
          'Extraction',
          'extractionFactory',
          'execute',
          `AI processing was requested (strategy: ${aiFormattingOptions.strategy}) but no OpenAI API key was provided. Skipping AI.`,
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
