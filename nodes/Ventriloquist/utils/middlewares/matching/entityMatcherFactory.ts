import type { Logger as ILogger } from 'n8n-workflow';
import type { Page } from 'puppeteer-core';
import {
  type IEntityMatcherInput,
  type IEntityMatcherOutput,
  type IEntityMatcherExtractionInput,
  type IEntityMatcherExtractionOutput,
  type IEntityMatcherComparisonInput,
  type IEntityMatcherComparisonOutput,
  type IEntityMatcherActionInput,
  type IEntityMatcherActionOutput,
  type IEntityField,
  type ISourceEntity
} from '../types/entityMatcherTypes';
import { MiddlewareComposer } from '../middlewareRegistry';
import { type IMiddlewareContext } from '../middleware';
import { type IFieldComparisonConfig } from '../../comparisonUtils';

/**
 * Simplified configuration for entity matcher factory
 */
export interface IEntityMatcherConfig {
  // Source entity data
  sourceEntity: Record<string, string | null | undefined>;
  normalizationOptions?: any;

  // Selectors for finding results
  resultsSelector: string;
  itemSelector: string;

  // Field extraction configuration
  fields: Array<{
    name: string;
    selector: string;
    attribute?: string;
    weight: number;
    required?: boolean;
    comparisonAlgorithm?: string;
    normalizationOptions?: any;
  }>;

  // Matching configuration
  threshold: number;
  matchMode?: 'best' | 'all' | 'firstAboveThreshold';
  limitResults?: number;
  sortResults?: boolean;

  // Action configuration
  action: 'click' | 'extract' | 'none';
  actionSelector?: string;
  actionAttribute?: string;
  waitAfterAction?: boolean;
  waitTime?: number;
  waitSelector?: string;

  // Timing configuration
  waitForSelector?: boolean;
  selectorTimeout?: number;
}

/**
 * Factory for creating complete entity matchers using the middleware system
 */
export class EntityMatcherFactory {
  /**
   * Create an entity matcher using all the specialized middleware components
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
    execute: () => Promise<IEntityMatcherOutput>;
  } {
    // Create the middleware context
    const middlewareContext: IMiddlewareContext = {
      logger: context.logger,
      nodeName: context.nodeName,
      nodeId: context.nodeId,
      sessionId: context.sessionId,
      index: context.index ?? 0,
    };

    // Convert config to middleware inputs
    const extractionConfig = this.createExtractionConfig(config);
    const comparisonConfig = this.createComparisonConfig(config);
    const actionConfig = this.createActionConfig(config);

    // Create the middleware composer
    const composer = new MiddlewareComposer<IEntityMatcherInput, IEntityMatcherOutput>();

    // Add logging before hooks
    composer.before(async (input, ctx) => {
      ctx.logger.info(
        `[EntityMatcherFactory][${ctx.nodeName}][${ctx.nodeId}] Starting entity matching process`
      );
    });

    // Add extraction middleware
    composer.use('entity-matcher-extraction');

    // Add comparison middleware
    composer.use('entity-matcher-comparison');

    // Add action middleware
    composer.use('entity-matcher-action');

    // Add logging after hooks
    composer.after(async (result, ctx) => {
      if (result.success) {
        ctx.logger.info(
          `[EntityMatcherFactory][${ctx.nodeName}][${ctx.nodeId}] Entity matching completed successfully with ${result.matches.length} matches`
        );
      } else {
        ctx.logger.warn(
          `[EntityMatcherFactory][${ctx.nodeName}][${ctx.nodeId}] Entity matching failed: ${result.error}`
        );
      }
    });

    // Add error handling
    composer.catch(async (error, ctx) => {
      ctx.logger.error(
        `[EntityMatcherFactory][${ctx.nodeName}][${ctx.nodeId}] Error in entity matching: ${error.message}`
      );
      return {
        success: false,
        matches: [],
        error: error.message,
      };
    });

    // Build the middleware pipeline executor
    const executor = composer.createExecutor();

    // Create a custom execute function that adapts inputs and outputs
    return {
      execute: async () => {
        try {
          // Standard inputs for all middlewares
          const extractionInput: IEntityMatcherExtractionInput = {
            page,
            extractionConfig,
          };

          // Execute extraction middleware
          const extractionResult = await executor.execute(
            {
              type: 'extraction',
              input: extractionInput
            } as any,
            middlewareContext
          );

          if (!extractionResult.success) {
            return {
              success: false,
              matches: [],
              error: extractionResult.error || 'Extraction failed'
            };
          }

          // Ensure we have the extraction output shape we expect
          if (!isExtractionOutput(extractionResult)) {
            return {
              success: false,
              matches: [],
              error: 'Invalid extraction result format'
            };
          }

          // Prepare comparison input
          const comparisonInput: IEntityMatcherComparisonInput = {
            sourceEntity: {
              fields: config.sourceEntity,
              normalizationOptions: config.normalizationOptions,
            },
            extractedItems: extractionResult.items,
            comparisonConfig,
          };

          // Execute comparison middleware
          const comparisonResult = await executor.execute(
            {
              type: 'comparison',
              input: comparisonInput
            } as any,
            middlewareContext
          );

          if (!comparisonResult.success) {
            return {
              success: false,
              matches: [],
              error: comparisonResult.error || 'Comparison failed'
            };
          }

          // Ensure we have the comparison output shape we expect
          if (!isComparisonOutput(comparisonResult)) {
            return {
              success: false,
              matches: [],
              error: 'Invalid comparison result format'
            };
          }

          // Prepare action input
          const actionInput: IEntityMatcherActionInput = {
            page,
            selectedMatch: comparisonResult.selectedMatch,
            actionConfig,
          };

          // Execute action middleware
          const actionResult = await executor.execute(
            {
              type: 'action',
              input: actionInput
            } as any,
            middlewareContext
          );

          // Ensure we have the action output shape we expect
          if (!isActionOutput(actionResult)) {
            return {
              success: actionResult.success,
              matches: comparisonResult.matches,
              selectedMatch: comparisonResult.selectedMatch,
              error: 'Invalid action result format'
            };
          }

          // Combine the results
          return {
            success: actionResult.success,
            matches: comparisonResult.matches,
            selectedMatch: comparisonResult.selectedMatch,
            actionPerformed: actionResult.actionPerformed,
            actionResult: actionResult.actionResult,
            error: actionResult.error,
          };
        } catch (error) {
          context.logger.error(
            `[EntityMatcherFactory][${context.nodeName}][${context.nodeId}] Unexpected error in entity matcher execution: ${(error as Error).message}`
          );

          return {
            success: false,
            matches: [],
            error: (error as Error).message,
          };
        }
      },
    };
  }

  /**
   * Convert the simplified config to extraction middleware config
   */
  private static createExtractionConfig(config: IEntityMatcherConfig): IEntityMatcherExtractionInput['extractionConfig'] {
    const fields: IEntityField[] = config.fields.map(field => ({
      name: field.name,
      selector: field.selector,
      attribute: field.attribute,
      weight: field.weight,
      comparisonAlgorithm: field.comparisonAlgorithm,
      normalizationOptions: field.normalizationOptions,
      required: field.required,
    }));

    return {
      resultsSelector: config.resultsSelector,
      itemSelector: config.itemSelector,
      fields,
      waitForSelector: config.waitForSelector,
      selectorTimeout: config.selectorTimeout,
    };
  }

  /**
   * Convert the simplified config to comparison middleware config
   */
  private static createComparisonConfig(config: IEntityMatcherConfig): IEntityMatcherComparisonInput['comparisonConfig'] {
    const fieldComparisons: IFieldComparisonConfig[] = config.fields.map(field => ({
      field: field.name,
      weight: field.weight,
      algorithm: field.comparisonAlgorithm as any || 'levenshtein',
    }));

    return {
      fieldComparisons,
      threshold: config.threshold,
      matchMode: config.matchMode,
      limitResults: config.limitResults,
      sortResults: config.sortResults !== false,
      normalizationOptions: config.normalizationOptions,
    };
  }

  /**
   * Convert the simplified config to action middleware config
   */
  private static createActionConfig(config: IEntityMatcherConfig): IEntityMatcherActionInput['actionConfig'] {
    return {
      action: config.action,
      actionSelector: config.actionSelector,
      actionAttribute: config.actionAttribute,
      waitAfterAction: config.waitAfterAction,
      waitTime: config.waitTime,
      waitSelector: config.waitSelector,
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
  execute: () => Promise<IEntityMatcherOutput>;
} {
  return EntityMatcherFactory.create(page, config, context);
}

// Type guards to verify the shape of results
function isExtractionOutput(obj: any): obj is IEntityMatcherExtractionOutput {
  return obj && Array.isArray(obj.items);
}

function isComparisonOutput(obj: any): obj is IEntityMatcherComparisonOutput {
  return obj && Array.isArray(obj.matches);
}

function isActionOutput(obj: any): obj is IEntityMatcherActionOutput {
  return obj && typeof obj.actionPerformed === 'boolean';
}
