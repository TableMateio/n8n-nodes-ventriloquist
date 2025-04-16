import type { Logger as ILogger } from 'n8n-workflow';
import { type IMiddleware, type IMiddlewareContext } from '../middleware';
import { IMiddlewareRegistration, MiddlewareType } from '../middlewareRegistry';
import {
  type IEntityMatcherComparisonInput,
  type IEntityMatcherComparisonOutput,
  type IEntityMatchResult,
  type IExtractedItem
} from '../types/entityMatcherTypes';
import { compareStrings, compareEntities } from '../../comparisonUtils';

/**
 * Entity Matcher Comparison Middleware
 * Compares extracted items against a source entity using configurable algorithms
 */
export class EntityMatcherComparisonMiddleware implements IMiddleware<IEntityMatcherComparisonInput, IEntityMatcherComparisonOutput> {
  /**
   * Execute the comparison process for entity matching
   */
  public async execute(
    input: IEntityMatcherComparisonInput,
    context: IMiddlewareContext
  ): Promise<IEntityMatcherComparisonOutput> {
    const { logger, nodeName, nodeId, index = 0 } = context;
    const { sourceEntity, extractedItems, comparisonConfig } = input;
    const logPrefix = `[EntityMatcherComparison][${nodeName}][${nodeId}]`;

    try {
      logger.info(`${logPrefix} Starting entity comparison with ${extractedItems.length} items`);

      if (extractedItems.length === 0) {
        logger.warn(`${logPrefix} No items to compare`);
        return {
          success: true,
          matches: [],
        };
      }

      // Convert the field comparison configs for the comparison utility
      const matches: IEntityMatchResult[] = await this.compareItems(
        sourceEntity.fields,
        extractedItems,
        comparisonConfig,
        logger,
        logPrefix
      );

      // Apply match mode and sorting
      const finalMatches = this.processMatchResults(
        matches,
        comparisonConfig,
        logger,
        logPrefix
      );

      // Select the best match if available
      const selectedMatch = finalMatches.find(match => match.selected);

      logger.info(
        `${logPrefix} Comparison completed. Found ${finalMatches.length} matches, ${selectedMatch ? 'with' : 'without'} selected match`
      );

      return {
        success: true,
        matches: finalMatches,
        selectedMatch,
      };
    } catch (error) {
      const errorMessage = (error as Error).message;
      logger.error(`${logPrefix} Error during entity comparison: ${errorMessage}`);

      return {
        success: false,
        matches: [],
        error: errorMessage,
      };
    }
  }

  /**
   * Compare source entity with extracted items
   */
  private async compareItems(
    sourceFields: Record<string, string | null | undefined>,
    extractedItems: IExtractedItem[],
    comparisonConfig: IEntityMatcherComparisonInput['comparisonConfig'],
    logger: ILogger,
    logPrefix: string
  ): Promise<IEntityMatchResult[]> {
    const matches: IEntityMatchResult[] = [];
    const threshold = comparisonConfig.threshold;

    // Process each extracted item
    for (const item of extractedItems) {
      try {
        // Create a record of normalized field values for comparison
        const itemFields: Record<string, string> = {};

        // First, build a map of fields for this item
        for (const [fieldName, fieldData] of Object.entries(item.fields)) {
          itemFields[fieldName] = fieldData.normalized || '';
        }

        // Perform the comparison using our utility
        const comparisonResult = compareEntities(
          sourceFields,
          itemFields,
          comparisonConfig.fieldComparisons,
          logger
        );

        // Store the comparison results
        matches.push({
          index: item.index,
          element: item.element,
          fields: itemFields,
          similarities: comparisonResult.fieldSimilarities,
          overallSimilarity: comparisonResult.overallSimilarity,
          selected: false, // Will be set later based on sorting and selection
        });

        logger.debug(
          `${logPrefix} Item ${item.index} similarity: ${comparisonResult.overallSimilarity.toFixed(4)} (threshold: ${threshold})`
        );
      } catch (error) {
        logger.warn(
          `${logPrefix} Error comparing item ${item.index}: ${(error as Error).message}`
        );
      }
    }

    return matches;
  }

  /**
   * Process match results based on configuration
   */
  private processMatchResults(
    matches: IEntityMatchResult[],
    comparisonConfig: IEntityMatcherComparisonInput['comparisonConfig'],
    logger: ILogger,
    logPrefix: string
  ): IEntityMatchResult[] {
    // Sort results if needed
    if (comparisonConfig.sortResults !== false) {
      matches.sort((a, b) => b.overallSimilarity - a.overallSimilarity);
    }

    // Apply limit if specified
    const limitedMatches = comparisonConfig.limitResults && comparisonConfig.limitResults > 0
      ? matches.slice(0, comparisonConfig.limitResults)
      : matches;

    // Select matches based on the match mode
    const matchMode = comparisonConfig.matchMode || 'best';
    const threshold = comparisonConfig.threshold;

    switch (matchMode) {
      case 'all':
        // All matches above threshold are selected
        for (const match of limitedMatches) {
          match.selected = match.overallSimilarity >= threshold;
        }
        break;

      case 'firstAboveThreshold':
        // First match above threshold is selected
        for (const match of limitedMatches) {
          if (match.overallSimilarity >= threshold) {
            match.selected = true;
            break;
          }
        }
        break;

      case 'best':
      default:
        // Only the best match is selected if it's above threshold
        if (limitedMatches.length > 0 && limitedMatches[0].overallSimilarity >= threshold) {
          limitedMatches[0].selected = true;
        }
        break;
    }

    return limitedMatches;
  }
}

/**
 * Create registration for comparison middleware
 */
export function createEntityMatcherComparisonMiddlewareRegistration(): Omit<IMiddlewareRegistration<IEntityMatcherComparisonInput, IEntityMatcherComparisonOutput>, 'middleware'> {
  return {
    type: MiddlewareType.ENTITY_MATCHER_COMPARISON,
    name: 'entityMatcherComparison',
    description: 'Compares extracted items with a source entity',
    version: 1,
  };
}
