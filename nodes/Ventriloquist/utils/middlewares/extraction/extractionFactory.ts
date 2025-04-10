import type { Logger as ILogger } from 'n8n-workflow';
import type * as puppeteer from 'puppeteer-core';
import { createPipeline, type IMiddlewareContext } from '../middleware';
import {
  ExtractionMiddleware,
  type IExtractInput,
  type IExtractResult,
  type IExtractOptions
} from './extractMiddleware';

/**
 * Configuration for extraction factory
 */
export interface IExtractionConfig {
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
}

/**
 * Factory for creating extraction operations
 */
export class ExtractionFactory {
  /**
   * Create an extraction operation
   */
  public static create(
    page: puppeteer.Page,
    config: IExtractionConfig,
    context: {
      logger: ILogger;
      nodeName: string;
      nodeId: string;
      sessionId: string;
      index: number;
    }
  ): {
    execute: () => Promise<IExtractResult>;
  } {
    // Create extraction options
    const options: IExtractOptions = {
      extractionType: config.extractionType,
      selector: config.selector,
      attributeName: config.attributeName,
      outputFormat: config.outputFormat,
      includeMetadata: config.includeMetadata,
      includeHeaders: config.includeHeaders,
      rowSelector: config.rowSelector,
      cellSelector: config.cellSelector,
      extractionProperty: config.extractionProperty,
      limit: config.limit,
      separator: config.separator,
      waitForSelector: config.waitForSelector,
      selectorTimeout: config.selectorTimeout,
      nodeName: context.nodeName,
      nodeId: context.nodeId,
      index: context.index,
    };

    // Create middleware input
    const input: IExtractInput = {
      page,
      options,
    };

    // Create middleware context
    const middlewareContext: IMiddlewareContext = {
      logger: context.logger,
      nodeName: context.nodeName,
      nodeId: context.nodeId,
      sessionId: context.sessionId,
      index: context.index,
    };

    // Create extraction middleware
    const middleware = new ExtractionMiddleware();

    // Create pipeline
    const pipeline = createPipeline<IExtractInput, IExtractResult>()
      .use(middleware)
      .before(async (input: IExtractInput, ctx: IMiddlewareContext) => {
        ctx.logger.debug(
          `[ExtractionFactory][${ctx.nodeName}][${ctx.nodeId}] Starting extraction process for ${input.options.extractionType} on selector: ${input.options.selector}`
        );
      })
      .after(async (result: IExtractResult, ctx: IMiddlewareContext) => {
        if (result.success) {
          ctx.logger.debug(
            `[ExtractionFactory][${ctx.nodeName}][${ctx.nodeId}] Extraction completed successfully`
          );
        } else {
          ctx.logger.warn(
            `[ExtractionFactory][${ctx.nodeName}][${ctx.nodeId}] Extraction failed: ${result.error?.message}`
          );
        }
      })
      .catch(async (error: Error, ctx: IMiddlewareContext) => {
        ctx.logger.error(
          `[ExtractionFactory][${ctx.nodeName}][${ctx.nodeId}] Error in extraction: ${error.message}`
        );
        return {
          success: false,
          data: null,
          selector: config.selector,
          extractionType: config.extractionType,
          error: error,
        };
      });

    // Return executor
    return {
      execute: async () => pipeline.execute(input, middlewareContext),
    };
  }
}

/**
 * Helper function to create an extraction operation
 */
export function createExtraction(
  page: puppeteer.Page,
  config: IExtractionConfig,
  context: {
    logger: ILogger;
    nodeName: string;
    nodeId: string;
    sessionId: string;
    index: number;
  }
): {
  execute: () => Promise<IExtractResult>;
} {
  return ExtractionFactory.create(page, config, context);
}
