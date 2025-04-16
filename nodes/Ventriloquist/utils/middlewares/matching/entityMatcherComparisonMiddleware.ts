import type { Logger as ILogger } from 'n8n-workflow';
import { type IMiddleware, type IMiddlewareContext } from '../middleware';
import { type IMiddlewareRegistration, type MiddlewareType } from '../middlewareRegistry';
import {
  type IEntityMatcherComparisonInput,
  type IEntityMatcherComparisonOutput,
  type IEntityMatchResult,
  type IExtractedItem
} from '../types/entityMatcherTypes';
import { compareEntities } from '../../comparisonUtils';

/**
 * Middleware for comparing extracted entities against source entity
 * This middleware is responsible for:
 * 1. Calculating similarity scores for each extracted item
 * 2. Filtering items based on similarity thresholds
 * 3. Sorting and selecting the best matches
 * 4. Supporting different match modes: 'best', 'all', 'firstAboveThreshold'
 */
export class EntityMatcherComparisonMiddleware implements IMiddleware<IEntityMatcherComparisonInput, IEntityMatcherComparisonOutput> {
  /**
   * Execute the comparison middleware
   */
  public async execute(
    input: IEntityMatcherComparisonInput,
    context: IMiddlewareContext
  ): Promise<IEntityMatcherComparisonOutput> {
    const { sourceEntity, extractedItems, comparisonConfig } = input;
    const logPrefix = `[EntityMatcherComparison][${context.sessionId}]`;

    context.logger.debug(`${logPrefix} Starting entity comparison with source entity and ${extractedItems.length} extracted items`);
    context.logger.debug(`${logPrefix} Comparison config: ${JSON.stringify({
      threshold: comparisonConfig.threshold,
      matchMode: comparisonConfig.matchMode || 'best',
      limitResults: comparisonConfig.limitResults,
      fieldComparisons: comparisonConfig.fieldComparisons?.map(f => f.field) || []
    })}`);

    try {
      // Handle case where no items were extracted
      if (!extractedItems || extractedItems.length === 0) {
        context.logger.warn(`${logPrefix} No items to compare`);
        return {
          success: false,
          matches: [],
          error: 'No items to compare'
        };
      }

      // Calculate similarity scores for each extracted item
      const matchResults: IEntityMatchResult[] = [];

      for (const item of extractedItems) {
        try {
          // Build a record of field values from the extracted item
          const extractedFieldValues: Record<string, string> = {};

          for (const [fieldName, fieldData] of Object.entries(item.fields)) {
            // Use normalized value for comparison
            extractedFieldValues[fieldName] = fieldData.normalized;
          }

          // Compare the extracted item with the source entity
          const comparison = compareEntities(
            sourceEntity.fields,
            extractedFieldValues,
            comparisonConfig.fieldComparisons,
            context.logger
          );

          // Check if required fields matched
          if (!comparison.requiredFieldsMatched) {
            context.logger.debug(`${logPrefix} Item #${item.index} - Required fields not matched, similarity: ${comparison.overallSimilarity.toFixed(4)}`);
            continue;
          }

          // Check if the overall similarity is above threshold
          if (comparison.overallSimilarity >= comparisonConfig.threshold) {
            context.logger.debug(`${logPrefix} Item #${item.index} - Match found with similarity: ${comparison.overallSimilarity.toFixed(4)}`);

            // Create match result
            matchResults.push({
              index: item.index,
              element: item.element,
              fields: extractedFieldValues,
              similarities: comparison.fieldSimilarities,
              overallSimilarity: comparison.overallSimilarity,
              selected: false // Will be updated later based on match mode
            });
          } else {
            context.logger.debug(`${logPrefix} Item #${item.index} - Below threshold: ${comparison.overallSimilarity.toFixed(4)} < ${comparisonConfig.threshold}`);
          }
        } catch (error) {
          context.logger.warn(`${logPrefix} Error comparing item #${item.index}: ${(error as Error).message}`);
        }
      }

      // If no matches found, return early
      if (matchResults.length === 0) {
        context.logger.warn(`${logPrefix} No matches found above threshold: ${comparisonConfig.threshold}`);
        return {
          success: false,
          matches: [],
          error: `No matches found above threshold: ${comparisonConfig.threshold}`
        };
      }

      // Sort matches by similarity score (highest first)
      matchResults.sort((a, b) => b.overallSimilarity - a.overallSimilarity);

      // Apply limit if specified
      let limitedResults = matchResults;
      if (comparisonConfig.limitResults && comparisonConfig.limitResults > 0 && matchResults.length > comparisonConfig.limitResults) {
        context.logger.info(`${logPrefix} Limiting results from ${matchResults.length} to ${comparisonConfig.limitResults} based on limit setting`);
        limitedResults = matchResults.slice(0, comparisonConfig.limitResults);
      }

      // Select match(es) based on the match mode
      const matchMode = comparisonConfig.matchMode || 'best';
      let selectedMatch: IEntityMatchResult | undefined;

      if (matchMode === 'best') {
        // Select the best match (highest similarity)
        if (limitedResults.length > 0) {
          selectedMatch = limitedResults[0];
          selectedMatch.selected = true;
          context.logger.info(`${logPrefix} Selected best match: index ${selectedMatch.index} with similarity ${selectedMatch.overallSimilarity.toFixed(4)}`);
        }
      } else if (matchMode === 'all') {
        // Select all matches
        for (const match of limitedResults) {
          match.selected = true;
        }
        context.logger.info(`${logPrefix} Selected all ${limitedResults.length} matches`);
      } else if (matchMode === 'firstAboveThreshold') {
        // Select the first match above threshold
        if (limitedResults.length > 0) {
          selectedMatch = limitedResults[0];
          selectedMatch.selected = true;
          context.logger.info(`${logPrefix} Selected first match above threshold: index ${selectedMatch.index} with similarity ${selectedMatch.overallSimilarity.toFixed(4)}`);
        }
      }

      // Log match results
      context.logger.info(`${logPrefix} Found ${limitedResults.length} matches above threshold ${comparisonConfig.threshold}`);

      // Return successful result
      return {
        success: true,
        matches: limitedResults,
        selectedMatch
      };
    } catch (error) {
      // Handle any unexpected errors
      context.logger.error(`${logPrefix} Comparison failed: ${(error as Error).message}`);
      return {
        success: false,
        matches: [],
        error: `Entity comparison failed: ${(error as Error).message}`
      };
    }
  }
}

/**
 * Create middleware registration for entity matcher comparison middleware
 */
export function createEntityMatcherComparisonMiddlewareRegistration(): Omit<any, 'middleware'> {
  return {
    id: 'entityMatcherComparison',
    type: 'comparison',
    description: 'Compare extracted entities against source entity',
  };
}
