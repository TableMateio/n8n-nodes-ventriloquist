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
  // Additional properties needed by extractNodeUtils.ts
  outputFormat?: string;
  includeMetadata?: boolean;
  includeHeaders?: boolean;
  rowSelector?: string;
  cellSelector?: string;
  extractionProperty?: string;
  limit?: number;
  separator?: string;
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
