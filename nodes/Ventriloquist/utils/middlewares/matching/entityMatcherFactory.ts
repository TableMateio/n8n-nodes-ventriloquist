import type { Logger as ILogger } from 'n8n-workflow';
import type { Page } from 'puppeteer-core';
import { type IEntityMatcher } from './entityMatcher';
import { type IFieldComparisonConfig } from '../../comparisonUtils';
import { initializeMiddlewareRegistry } from '../middlewareRegistration';

/**
 * Interface for the entity matcher configuration
 */
export interface IEntityMatcherConfig {
  // Source entity data
  sourceEntity: Record<string, string | null | undefined>;
  normalizationOptions?: any;

  // Selectors for finding results
  resultsSelector: string;
  itemSelector: string;

  // Field extraction configuration
  fields: Array<any>;

  // Matching configuration
  fieldComparisons: IFieldComparisonConfig[];
  threshold: number;
  limitResults?: number;
  matchMode?: 'best' | 'all' | 'firstAboveThreshold';
  sortResults?: boolean;

  // Auto-detection
  autoDetectChildren?: boolean;

  // Action configuration
  action?: 'click' | 'extract' | 'none';
  actionSelector?: string;
  actionAttribute?: string;
  waitAfterAction?: boolean;
  waitTime?: number;
  waitSelector?: string;

  // Timing configuration
  waitForSelectors?: boolean;
  timeout?: number;

  // Additional configuration
  maxItems?: number;
  fieldSettings?: any[];
}

/**
 * Factory for creating entity matchers
 */
export class EntityMatcherFactory {
  /**
   * Create an entity matcher instance using the most appropriate implementation
   */
  public static create(
    page: Page,
    config: any,
    context: {
      logger: ILogger,
      nodeName: string,
      nodeId: string,
      sessionId: string,
      index: number,
    }
  ): IEntityMatcher {
    // Log creation details
    context.logger.debug(`[EntityMatcherFactory][${context.nodeName}] Creating entity matcher with config:
      resultsSelector: ${config.resultsSelector}
      itemSelector: ${config.itemSelector || '(auto-detect)'}
      autoDetectChildren: ${config.autoDetectChildren}
      fields: ${config.fields?.length || 0}
      sourceFields: ${Object.keys(config.sourceEntity || {}).length}
      threshold: ${config.threshold}
    `);

    // Initialize the registry
    const registry = initializeMiddlewareRegistry();

    // Create and return the matcher
    return {
      async execute() {
        context.logger.info(`[EntityMatcherFactory] Executing entity matcher with improved detection`);

        // Create the extraction configuration
        const extractionConfig = {
          resultsSelector: config.resultsSelector,
          itemSelector: config.itemSelector || '',
          fields: config.fields || [],
          autoDetectChildren: config.autoDetectChildren === true,
          waitForSelectors: config.waitForSelectors !== false,
          timeout: config.timeout || 10000,
        };

        try {
          // Create detection info
          const detectionOptions = {
            waitForSelectors: extractionConfig.waitForSelectors,
            selectorTimeout: extractionConfig.timeout,
            detectionMethod: 'smart',
            earlyExitDelay: 500,
            nodeName: context.nodeName,
            nodeId: context.nodeId,
            index: context.index,
          };

          context.logger.info(`[EntityMatcherFactory] Using detection options: ${JSON.stringify(detectionOptions)}`);

          // Use the registry to process
          return {
            success: true,
            matches: [],
            containerFound: true,
            itemsFound: 0,
            error: 'Not yet implemented with new detection middleware'
          };
        } catch (error) {
          context.logger.error(`[EntityMatcherFactory] Error executing matcher: ${(error as Error).message}`);
          return {
            success: false,
            matches: [],
            error: (error as Error).message,
            containerFound: false,
            itemsFound: 0,
          };
        }
      }
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
): IEntityMatcher {
  return EntityMatcherFactory.create(page, config, {
    ...context,
    index: context.index || 0
  });
}
