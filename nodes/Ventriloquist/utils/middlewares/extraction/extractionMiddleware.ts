import type { Logger as ILogger } from 'n8n-workflow';
import type * as puppeteer from 'puppeteer-core';
import { type IMiddleware, type IMiddlewareContext } from '../middleware';
import { type IMiddlewareRegistration, type MiddlewareType } from '../middlewareRegistry';

/**
 * Extraction options
 */
export interface IExtractOptions {
  extractionType: string;
  selector: string;
  attributeName?: string;
  outputFormat?: string;
  includeMetadata?: boolean;
  includeHeaders?: boolean;
  rowSelector?: string;
  cellSelector?: string;
  extractionProperty?: string;
  limit?: number;
  separator?: string;
  waitForSelector?: boolean;
  selectorTimeout?: number;
  nodeName: string;
  nodeId: string;
  index: number;
}

/**
 * Extraction input
 */
export interface IExtractInput {
  page: puppeteer.Page;
  options: IExtractOptions;
}

/**
 * Extraction result
 */
export interface IExtractResult {
  success: boolean;
  data: any;
  selector?: string;
  extractionType?: string;
  error?: Error;
}

/**
 * Extraction middleware for extracting data from pages
 */
export class ExtractionMiddleware implements IMiddleware<IExtractInput, IExtractResult> {
  /**
   * Execute the extraction
   */
  public async execute(
    input: IExtractInput,
    context: IMiddlewareContext
  ): Promise<IExtractResult> {
    const { logger } = context;
    const { page, options } = input;
    const {
      extractionType,
      selector,
      attributeName,
      outputFormat,
      includeMetadata,
      includeHeaders,
      rowSelector,
      cellSelector,
      extractionProperty,
      limit,
      separator,
      waitForSelector,
      selectorTimeout = 30000,
      nodeName,
      nodeId,
      index,
    } = options;

    // Log prefix to help with debugging
    const logPrefix = `[ExtractionMiddleware][${nodeName}][${nodeId}][${index}]`;

    try {
      logger.info(
        `${logPrefix} Executing ${extractionType} extraction on selector: ${selector}`
      );

      // Wait for selector if required
      if (waitForSelector) {
        logger.debug(`${logPrefix} Waiting for selector: ${selector}`);
        await page.waitForSelector(selector, { timeout: selectorTimeout });
      }

      // Check if the selector exists
      const elementExists = await page.$(selector);
      if (!elementExists) {
        throw new Error(`Element not found: ${selector}`);
      }

      // Extract data based on extraction type
      let extractedData: any = null;

      switch (extractionType) {
        case 'text':
          extractedData = await this.extractText(page, selector, logger, logPrefix);
          break;

        case 'html':
          extractedData = await this.extractHtml(page, selector, logger, logPrefix);
          break;

        case 'attribute':
          if (!attributeName) {
            throw new Error('Attribute name is required for attribute extraction');
          }
          extractedData = await this.extractAttribute(
            page,
            selector,
            attributeName,
            logger,
            logPrefix
          );
          break;

        case 'table':
          extractedData = await this.extractTable(
            page,
            selector,
            {
              includeHeaders: includeHeaders || false,
              rowSelector: rowSelector || 'tr',
              cellSelector: cellSelector || 'td,th',
              outputFormat: outputFormat || 'array',
            },
            logger,
            logPrefix
          );
          break;

        case 'multiple':
          extractedData = await this.extractMultiple(
            page,
            selector,
            {
              extractionProperty: extractionProperty || 'textContent',
              attributeName,
              limit: limit || 0,
            },
            logger,
            logPrefix
          );
          break;

        default:
          throw new Error(`Unsupported extraction type: ${extractionType}`);
      }

      logger.info(`${logPrefix} Extraction completed successfully`);

      return {
        success: true,
        data: extractedData,
        selector,
        extractionType,
      };
    } catch (error) {
      logger.error(`${logPrefix} Error in extraction: ${(error as Error).message}`);

      return {
        success: false,
        data: null,
        selector,
        extractionType,
        error: error as Error,
      };
    }
  }

  /**
   * Extract text content from an element
   */
  private async extractText(
    page: puppeteer.Page,
    selector: string,
    logger: ILogger,
    logPrefix: string
  ): Promise<string> {
    logger.debug(`${logPrefix} Extracting text from selector: ${selector}`);

    const text = await page.$eval(
      selector,
      (element) => (element as HTMLElement).textContent || ''
    );

    return text.trim();
  }

  /**
   * Extract HTML content from an element
   */
  private async extractHtml(
    page: puppeteer.Page,
    selector: string,
    logger: ILogger,
    logPrefix: string
  ): Promise<string> {
    logger.debug(`${logPrefix} Extracting HTML from selector: ${selector}`);

    const html = await page.$eval(selector, (element) => {
      return element.outerHTML;
    });

    return html;
  }

  /**
   * Extract attribute value from an element
   */
  private async extractAttribute(
    page: puppeteer.Page,
    selector: string,
    attributeName: string,
    logger: ILogger,
    logPrefix: string
  ): Promise<string> {
    logger.debug(
      `${logPrefix} Extracting attribute '${attributeName}' from selector: ${selector}`
    );

    const attributeValue = await page.$eval(
      selector,
      (element, attr) => element.getAttribute(attr) || '',
      attributeName
    );

    return attributeValue;
  }

  /**
   * Extract a table as an array or object
   */
  private async extractTable(
    page: puppeteer.Page,
    selector: string,
    options: {
      includeHeaders: boolean;
      rowSelector: string;
      cellSelector: string;
      outputFormat: string;
    },
    logger: ILogger,
    logPrefix: string
  ): Promise<any> {
    const { includeHeaders, rowSelector, cellSelector, outputFormat } = options;

    logger.debug(`${logPrefix} Extracting table from selector: ${selector}`);

    const tableData = await page.evaluate(
      (sel, rowSel, cellSel, inclHeaders) => {
        const table = document.querySelector(sel);
        if (!table) return null;

        const rows = table.querySelectorAll(rowSel);
        const result: any[] = [];
        let headers: string[] = [];

        // Extract headers if needed
        if (inclHeaders && rows.length > 0) {
          const headerRow = rows[0];
          const headerCells = headerRow.querySelectorAll(cellSel);
          headers = Array.from(headerCells).map((cell) => cell.textContent?.trim() || '');
        }

        // Start from index 1 if headers are included, otherwise from 0
        const startIndex = inclHeaders ? 1 : 0;

        // Extract data rows
        for (let i = startIndex; i < rows.length; i++) {
          const row = rows[i];
          const cells = row.querySelectorAll(cellSel);
          const rowData: any = inclHeaders ? {} : [];

          cells.forEach((cell, j) => {
            const cellValue = cell.textContent?.trim() || '';
            if (inclHeaders) {
              const headerKey = headers[j] || `column${j}`;
              rowData[headerKey] = cellValue;
            } else {
              rowData.push(cellValue);
            }
          });

          result.push(rowData);
        }

        return {
          headers: inclHeaders ? headers : undefined,
          data: result,
        };
      },
      selector,
      rowSelector,
      cellSelector,
      includeHeaders
    );

    if (!tableData) {
      throw new Error(`Table not found with selector: ${selector}`);
    }

    if (outputFormat === 'object') {
      return {
        headers: tableData.headers,
        rows: tableData.data,
      };
    }

    return tableData.data;
  }

  /**
   * Extract multiple elements
   */
  private async extractMultiple(
    page: puppeteer.Page,
    selector: string,
    options: {
      extractionProperty: string;
      attributeName?: string;
      limit: number;
    },
    logger: ILogger,
    logPrefix: string
  ): Promise<string[]> {
    const { extractionProperty, attributeName, limit } = options;

    logger.debug(
      `${logPrefix} Extracting multiple elements from selector: ${selector} (property: ${extractionProperty})`
    );

    const values = await page.evaluate(
      (sel, property, attr, lim) => {
        const elements = document.querySelectorAll(sel);
        const result: string[] = [];

        // Apply limit if provided
        const max = lim > 0 ? Math.min(elements.length, lim) : elements.length;

        for (let i = 0; i < max; i++) {
          const element = elements[i];
          let value = '';

          if (property === 'textContent') {
            value = element.textContent || '';
          } else if (property === 'innerHTML') {
            value = element.innerHTML;
          } else if (property === 'outerHTML') {
            value = element.outerHTML;
          } else if (property === 'attribute' && attr) {
            value = element.getAttribute(attr) || '';
          }

          result.push(value.trim());
        }

        return result;
      },
      selector,
      extractionProperty,
      attributeName,
      limit
    );

    return values;
  }
}

/**
 * Create middleware registration for extraction middleware
 */
export function createExtractionMiddlewareRegistration(): IMiddlewareRegistration<IExtractInput, IExtractResult> {
  return {
    id: 'extraction',
    type: 'extraction' as MiddlewareType,
    name: 'Extraction Middleware',
    description: 'Middleware for extracting data from web pages',
    middleware: new ExtractionMiddleware(),
    version: '1.0.0',
    tags: ['extraction', 'content', 'data'],
    configSchema: {
      type: 'object',
      properties: {
        extractionType: {
          type: 'string',
          enum: ['text', 'html', 'attribute', 'table', 'multiple'],
          description: 'Type of extraction to perform',
        },
        selector: {
          type: 'string',
          description: 'CSS selector for the element to extract',
        },
        attributeName: {
          type: 'string',
          description: 'Name of the attribute to extract (for attribute extraction)',
        },
        waitForSelector: {
          type: 'boolean',
          description: 'Whether to wait for the selector to appear',
          default: true,
        },
        selectorTimeout: {
          type: 'number',
          description: 'Timeout for waiting for the selector (in ms)',
          default: 30000,
        },
      },
      required: ['extractionType', 'selector'],
    },
  };
}
