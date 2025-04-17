import type { Logger as ILogger } from 'n8n-workflow';
import type { Page } from 'puppeteer-core';
import type { IMiddleware, IMiddlewareContext } from '../middleware';

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
  // Additional properties needed for multiple extraction
  extractionProperty?: string;
  limit?: number;
  separator?: string;
  // Additional properties for HTML extraction
  includeMetadata?: boolean;
  // Additional properties for Text extraction
  cleanText?: boolean;
}

/**
 * Result of the extraction operation
 */
export interface IExtractionResult {
  success: boolean;
  data?: any;
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
class BasicExtraction implements IExtraction {
  private page: Page;
  private config: IExtractionConfig;
  private context: IMiddlewareContext;

  constructor(page: Page, config: IExtractionConfig, context: IMiddlewareContext) {
    this.page = page;
    this.config = config;
    this.context = context;
  }

  async execute(): Promise<IExtractionResult> {
    const { logger, nodeName } = this.context;
    const logPrefix = `[Extraction][${nodeName}]`;

    try {
      logger.debug(`${logPrefix} Extracting data with config: ${JSON.stringify(this.config)}`);

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

      switch (this.config.extractionType) {
        case 'text':
          data = await this.page.$eval(this.config.selector, (el) => el.textContent?.trim() || '');

          // Clean text if the option is enabled
          if (this.config.cleanText) {
            logger.info(`${logPrefix} Cleaning text content (replacing multiple newlines with single newline)`);
            // Replace 2 or more consecutive newlines with a single newline
            data = data.replace(/\n{2,}/g, '\n');
          }
          break;

        case 'attribute':
          if (!this.config.attributeName) {
            throw new Error('Attribute name is required for attribute extraction');
          }
          data = await this.page.$eval(
            this.config.selector,
            (el, attr) => el.getAttribute(attr) || '',
            this.config.attributeName
          );
          break;

        case 'html':
          data = await this.page.$eval(this.config.selector, (el) => el.innerHTML);
          break;

        case 'outerHtml':
          data = await this.page.$eval(this.config.selector, (el) => el.outerHTML);
          break;

        case 'table':
          // Handle table extraction
          const includeHeaders = this.config.includeHeaders !== false;
          const rowSelector = this.config.rowSelector || 'tr';
          const cellSelector = this.config.cellSelector || 'td, th';
          const tableOutputFormat = this.config.outputFormat || 'json';

          logger.info(`${logPrefix} Table extraction starting: selector=${this.config.selector}, rowSelector=${rowSelector}, cellSelector=${cellSelector}, includeHeaders=${includeHeaders}, outputFormat=${tableOutputFormat}`);

          try {
            if (tableOutputFormat === 'html') {
              // Just return the HTML if that's what was requested
              logger.info(`${logPrefix} Extracting table as HTML`);
              data = await this.page.$eval(this.config.selector, (el) => el.outerHTML);
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

              data = await this.page.$$eval(
                `${this.config.selector} ${rowSelector}`,
                (rows, cellSel) => {
                  // Get all rows
                  const tableData = Array.from(rows).map((row) => {
                    const cells = Array.from(row.querySelectorAll(cellSel as string));
                    return cells.map((cell) => cell.textContent?.trim() || '');
                  });
                  return tableData;
                },
                cellSelector
              );

              logger.info(`${logPrefix} Table data extracted: ${data.length} rows found`);

              // If outputFormat is 'json' and we have headers, convert to objects
              if (tableOutputFormat === 'json' && includeHeaders && data.length > 1) {
                const headers = data[0];
                logger.info(`${logPrefix} Converting to JSON objects with headers: ${headers.join(', ')}`);

                const jsonData = data.slice(1).map((row: string[]) => {
                  const obj: { [key: string]: string } = {};
                  headers.forEach((header: string, index: number) => {
                    if (header && header.trim()) {
                      obj[header] = row[index] || '';
                    }
                  });
                  return obj;
                });
                data = jsonData;
                logger.info(`${logPrefix} Converted to ${data.length} JSON objects`);
              }
            }
          } catch (error) {
            logger.error(`${logPrefix} Table extraction failed: ${(error as Error).message}`);
            throw error;
          }
          break;

        case 'value':
          // Handle input value extraction
          data = await this.page.$eval(this.config.selector, (el) => {
            if (el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement || el instanceof HTMLSelectElement) {
              return el.value;
            }
            return '';
          });
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
            break;
          }

          logger.info(`${logPrefix} Found ${elements.length} elements matching selector`);

          // Limit the number of elements if requested
          const limitedElements = limit > 0 ? elements.slice(0, limit) : elements;

          // Extract the requested property from each element
          const extractedValues = await Promise.all(
            limitedElements.map(async (element) => {
              if (extractionProperty === 'textContent') {
                return await element.evaluate((el) => el.textContent?.trim() || '');
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

      return {
        success: true,
        data,
      };
    } catch (error) {
      logger.error(`${logPrefix} Extraction failed: ${(error as Error).message}`);

      return {
        success: false,
        error: {
          message: (error as Error).message,
          details: error,
        },
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
