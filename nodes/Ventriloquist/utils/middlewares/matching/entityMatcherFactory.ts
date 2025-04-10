import type { Logger as ILogger } from 'n8n-workflow';
import type { Page } from 'puppeteer-core';
import {
  type IEntityMatcherInput,
  type IEntityMatcherResult,
  EntityMatcherMiddleware,
} from './entityMatcherMiddleware';
import { type IMiddlewareContext, createPipeline } from '../middleware';
import { type IFieldComparisonConfig } from '../../comparisonUtils';
import { type ITextNormalizationOptions } from '../../textUtils';

/**
 * Configuration for entity matcher factory
 */
export interface IEntityMatcherConfig {
  // Source entity data
  sourceEntity: Record<string, string | null | undefined>;

  // Selectors for finding results
  resultsSelector: string;
  itemSelector: string;

  // Field extraction configuration
  fields: Array<{
    name: string;
    selector: string;
    attribute?: string;
    weight: number;
    comparisonAlgorithm?: string;
  }>;

  // Matching configuration
  threshold: number;
  normalizationOptions?: ITextNormalizationOptions;
  limitResults?: number;

  // Action configuration
  action: 'click' | 'extract' | 'none';
  actionSelector?: string;
  actionAttribute?: string;
  waitAfterAction?: boolean;
  waitTime?: number;
}

/**
 * Factory for creating entity matchers
 */
export class EntityMatcherFactory {
  /**
   * Create an entity matcher
   */
  public static create(
    page: Page,
    config: IEntityMatcherConfig,
    context: {
      logger: ILogger;
      nodeName: string;
      nodeId: string;
      sessionId: string;
      index?: number;
    }
  ): {
    execute: () => Promise<IEntityMatcherResult>;
  } {
    // Create field comparison config from the fields
    const fieldComparisons: IFieldComparisonConfig[] = config.fields.map(field => ({
      field: field.name,
      weight: field.weight,
      algorithm: field.comparisonAlgorithm as any || 'levenshtein',
    }));

    // Create entity matcher input
    const input: IEntityMatcherInput = {
      page,
      sourceEntity: config.sourceEntity,
      resultsSelector: config.resultsSelector,
      itemSelector: config.itemSelector,
      extractionConfig: {
        fields: config.fields.map(field => ({
          name: field.name,
          selector: field.selector,
          attribute: field.attribute,
        })),
      },
      matchingConfig: {
        fieldComparisons,
        threshold: config.threshold,
        normalizationOptions: config.normalizationOptions,
        limitResults: config.limitResults,
      },
      actionConfig: {
        action: config.action,
        actionSelector: config.actionSelector,
        actionAttribute: config.actionAttribute,
        waitAfterAction: config.waitAfterAction,
        waitTime: config.waitTime,
      },
    };

    // Create middleware context
    const middlewareContext: IMiddlewareContext = {
      logger: context.logger,
      nodeName: context.nodeName,
      nodeId: context.nodeId,
      sessionId: context.sessionId,
      index: context.index,
    };

    // Create entity matcher middleware
    const middleware = new EntityMatcherMiddleware();

    // Create pipeline
    const pipeline = createPipeline<IEntityMatcherInput, IEntityMatcherResult>()
      .use(middleware)
      .before(async (input, ctx) => {
        ctx.logger.debug(
          `[EntityMatcherFactory][${ctx.nodeName}][${ctx.nodeId}] Starting entity matching process`
        );
      })
      .after(async (result, ctx) => {
        if (result.success) {
          ctx.logger.debug(
            `[EntityMatcherFactory][${ctx.nodeName}][${ctx.nodeId}] Entity matching completed successfully`
          );
        } else {
          ctx.logger.warn(
            `[EntityMatcherFactory][${ctx.nodeName}][${ctx.nodeId}] Entity matching failed: ${result.error}`
          );
        }
      })
      .catch(async (error, ctx) => {
        ctx.logger.error(
          `[EntityMatcherFactory][${ctx.nodeName}][${ctx.nodeId}] Error in entity matching: ${error.message}`
        );
        return {
          success: false,
          matches: [],
          error: error.message,
        };
      });

    // Return executor
    return {
      execute: async () => pipeline.execute(input, middlewareContext),
    };
  }
}

/**
 * Helper function to create an entity matcher
 */
export function createEntityMatcher(
  page: Page,
  config: IEntityMatcherConfig,
  context: {
    logger: ILogger;
    nodeName: string;
    nodeId: string;
    sessionId: string;
    index?: number;
  }
): {
  execute: () => Promise<IEntityMatcherResult>;
} {
  return EntityMatcherFactory.create(page, config, context);
}
