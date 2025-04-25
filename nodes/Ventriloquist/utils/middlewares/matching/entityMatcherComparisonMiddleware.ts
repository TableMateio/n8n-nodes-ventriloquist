import type { Logger as ILogger } from 'n8n-workflow';
import { type IMiddleware, type IMiddlewareContext } from '../middleware';
import { IMiddlewareRegistration, MiddlewareType } from '../middlewareRegistry';
import {
  type IEntityMatcherComparisonInput,
  type IEntityMatcherComparisonOutput,
  type IEntityMatchResult,
  type IExtractedItem
} from '../types/entityMatcherTypes';
import {
  compareStrings,
  compareEntities,
  IStringComparisonOptions,
  containmentSimilarity,
  smartSimilarity,
  calculateInformationRichness
} from '../../comparisonUtils';

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
      logger.info(`${logPrefix} Starting entity comparison with ${extractedItems.length} items and ${comparisonConfig.fieldComparisons.length} comparison fields`);

      if (extractedItems.length === 0) {
        logger.warn(`${logPrefix} No items to compare`);
        return {
          success: true,
          matches: [],
        };
      }

      // Log comparison config for debugging
      logger.debug(`${logPrefix} Comparison config: threshold=${comparisonConfig.threshold}, matchMode=${comparisonConfig.matchMode || 'best'}`);

      // Log source entity fields for debugging
      logger.debug(`${logPrefix} Source entity fields: ${Object.keys(sourceEntity.fields).join(', ')}`);

      // Validate field comparisons
      if (!comparisonConfig.fieldComparisons || comparisonConfig.fieldComparisons.length === 0) {
        logger.warn(`${logPrefix} No field comparisons configured, will compare based on available fields`);

        // Auto-generate field comparisons from source entity fields
        comparisonConfig.fieldComparisons = Object.keys(sourceEntity.fields).map(field => ({
          field,
          weight: 1,
          algorithm: 'smart',
          threshold: comparisonConfig.threshold
        }));
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
        `${logPrefix} Comparison completed. Found ${finalMatches.length} matches ${selectedMatch ? 'with best match score: ' + selectedMatch.overallSimilarity.toFixed(4) : 'but no match selected'}`
      );

      // Log details about the selected match if available
      if (selectedMatch) {
        logger.debug(`${logPrefix} Best match (index: ${selectedMatch.index}) similarities: ${
          Object.entries(selectedMatch.similarities)
            .map(([field, score]) => `${field}: ${score.toFixed(4)}`)
            .join(', ')
        }`);
      }

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
    const threshold = comparisonConfig.threshold || 0.7;
    const hasRequiredFields = comparisonConfig.fieldComparisons.some(fc => fc.mustMatch);

    logger.debug(`${logPrefix} Starting comparison of ${extractedItems.length} items against source fields with threshold ${threshold}`);

    // Process each extracted item
    for (const item of extractedItems) {
      try {
        // Create a record of normalized field values for comparison
        const itemFields: Record<string, string> = {};

        // First, build a map of fields for this item
        for (const [fieldName, fieldData] of Object.entries(item.fields)) {
          itemFields[fieldName] = fieldData.normalized || '';
        }

        // Log which fields we're comparing for debugging
        const fieldsToBeTested = Object.keys(itemFields);
        logger.debug(`${logPrefix} Item #${item.index} fields: ${fieldsToBeTested.join(', ')}`);

        // For each field comparison with a selector, get the targeted content from the item's field
        for (const fieldComparison of comparisonConfig.fieldComparisons) {
          if (fieldComparison.selector && fieldComparison.selector.trim() !== '' && item.element) {
            try {
              // Try to get the element using the target selector
              const targetValue = await this.getTargetContent(
                item.element,
                fieldComparison.selector,
                logger,
                logPrefix
              );

              if (targetValue) {
                // Override the field value with the targeted content
                itemFields[fieldComparison.field] = targetValue;
                logger.debug(`${logPrefix} Applied target selector "${fieldComparison.selector}" for field "${fieldComparison.field}"`);
              }
            } catch (error) {
              logger.warn(`${logPrefix} Error applying target selector "${fieldComparison.selector}": ${(error as Error).message}`);
            }
          }
        }

        // Perform the comparison using our utility
        const comparisonResult = compareEntities(
          sourceFields,
          itemFields,
          comparisonConfig.fieldComparisons,
          logger
        );

        // Check if required fields are met
        if (hasRequiredFields && !comparisonResult.requiredFieldsMet) {
          logger.debug(`${logPrefix} Item #${item.index} skipped: required fields did not meet threshold`);
          continue;
        }

        // Debug individual field comparisons
        for (const [field, similarity] of Object.entries(comparisonResult.fieldSimilarities)) {
          const matchConfig = comparisonConfig.fieldComparisons.find(fc => fc.field === field);
          const fieldThreshold = matchConfig?.threshold || threshold;
          const sourceValue = sourceFields[field] || '';

          logger.debug(
            `${logPrefix} Item #${item.index} - Field "${field}" similarity: ${similarity.toFixed(4)} ${
              similarity >= fieldThreshold ? '✓' : '✗'
            }${matchConfig?.mustMatch ? ' (required)' : ''} (source value: ${sourceValue ? '"' + sourceValue + '"' : 'empty'})`
          );
        }

        // Store the comparison results
        matches.push({
          index: item.index,
          element: item.element,
          fields: itemFields,
          similarities: comparisonResult.fieldSimilarities,
          overallSimilarity: comparisonResult.overallSimilarity,
          selected: false, // Will be set later based on sorting and selection
        });

        logger.info(
          `${logPrefix} Item #${item.index} overall similarity: ${comparisonResult.overallSimilarity.toFixed(4)} (threshold: ${threshold})${
            comparisonResult.overallSimilarity >= threshold ? ' - MATCHES' : ' - BELOW THRESHOLD'
          }`
        );
      } catch (error) {
        logger.warn(
          `${logPrefix} Error comparing item #${item.index}: ${(error as Error).message}`
        );
      }
    }

    return matches;
  }

  /**
   * Extract text content using a selector from an element
   */
  private async getTargetContent(
    element: any,
    selector: string,
    logger: ILogger,
    logPrefix: string
  ): Promise<string> {
    try {
      // Find the element using the selector
      const targetElement = await element.$(selector);

      if (!targetElement) {
        logger.debug(`${logPrefix} Target selector "${selector}" did not match any elements`);
        return '';
      }

      // Get the text content
      const textContent = await targetElement.evaluate((el: Element) => el.textContent || '');
      return textContent.trim();
    } catch (error) {
      logger.warn(`${logPrefix} Error extracting content with selector "${selector}": ${(error as Error).message}`);
      return '';
    }
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
    // Log initial matches count
    logger.debug(`${logPrefix} Processing ${matches.length} matches`);

    // Add information richness scores to help differentiate similar matches
    for (const match of matches) {
      // Calculate information richness for the concatenated fields
      const allText = Object.values(match.fields).join(' ');
      match.informationRichness = calculateInformationRichness(allText);

      // Adjust overall similarity slightly based on information richness
      // This will help break ties between otherwise identical matches
      if (match.informationRichness > 0.5) {
        // Only adjust if there's significant richness
        const adjustedSimilarity = Math.min(1, match.overallSimilarity + (match.informationRichness * 0.02));

        // Log the adjustment
        if (adjustedSimilarity > match.overallSimilarity) {
          logger.debug(`${logPrefix} Match #${match.index} adjusted for richness: ${match.overallSimilarity.toFixed(4)} → ${adjustedSimilarity.toFixed(4)} (richness: ${match.informationRichness.toFixed(4)})`);
          match.overallSimilarity = adjustedSimilarity;
        }
      }
    }

    // Sort results if needed
    if (comparisonConfig.sortResults !== false) {
      matches.sort((a, b) => {
        // First sort by overall similarity
        const similarityDiff = b.overallSimilarity - a.overallSimilarity;

        // If similarities are very close, use information richness as a tiebreaker
        if (Math.abs(similarityDiff) < 0.02) {
          const richnessA = a.informationRichness || 0;
          const richnessB = b.informationRichness || 0;
          return richnessB - richnessA;
        }

        return similarityDiff;
      });

      logger.debug(`${logPrefix} Sorted matches by similarity score and information richness`);
    }

    // Apply limit if specified
    const limitedMatches = comparisonConfig.limitResults && comparisonConfig.limitResults > 0
      ? matches.slice(0, comparisonConfig.limitResults)
      : matches;

    if (comparisonConfig.limitResults && comparisonConfig.limitResults > 0) {
      logger.debug(`${logPrefix} Limited to ${limitedMatches.length} matches (from ${matches.length} total)`);
    }

    // Select matches based on the match mode
    const matchMode = comparisonConfig.matchMode || 'best';
    const threshold = comparisonConfig.threshold;

    logger.info(`${logPrefix} Applying match mode: ${matchMode} with threshold: ${threshold}`);

    // Make sure all items are initially not selected
    for (const match of limitedMatches) {
      match.selected = false;
    }

    // Count how many matches are above threshold for logging
    const matchesAboveThreshold = limitedMatches.filter(m => m.overallSimilarity >= threshold).length;
    logger.info(`${logPrefix} Found ${matchesAboveThreshold} matches above threshold out of ${limitedMatches.length} total`);

    // If no matches above threshold, return with no selected items
    if (matchesAboveThreshold === 0) {
      logger.info(`${logPrefix} No matches above threshold (${threshold}), not selecting any items`);
      return limitedMatches;
    }

    // Filter matches above threshold for selection
    const matchesAboveThresholdArray = limitedMatches.filter(m => m.overallSimilarity >= threshold);

    switch (matchMode) {
      case 'all':
        // All matches above threshold are selected
        for (const match of limitedMatches) {
          if (match.overallSimilarity >= threshold) {
            match.selected = true;
            logger.debug(`${logPrefix} Selected match #${match.index} with score: ${match.overallSimilarity.toFixed(4)}, richness: ${(match.informationRichness || 0).toFixed(4)}`);
          }
        }
        break;

      case 'firstAboveThreshold':
        // First match above threshold is selected
        if (matchesAboveThresholdArray.length > 0) {
          matchesAboveThresholdArray[0].selected = true;
          logger.debug(
            `${logPrefix} Selected first match #${matchesAboveThresholdArray[0].index} with score: ${matchesAboveThresholdArray[0].overallSimilarity.toFixed(4)}, richness: ${(matchesAboveThresholdArray[0].informationRichness || 0).toFixed(4)}`
          );
        }
        break;

      case 'best':
      default:
        // Only the best match is selected if it's above threshold
        if (matchesAboveThresholdArray.length > 0) {
          // Since we already sorted, the best match is the first one above threshold
          matchesAboveThresholdArray[0].selected = true;
          logger.debug(
            `${logPrefix} Selected best match #${matchesAboveThresholdArray[0].index} with score: ${matchesAboveThresholdArray[0].overallSimilarity.toFixed(4)}, richness: ${(matchesAboveThresholdArray[0].informationRichness || 0).toFixed(4)}`
          );
        } else {
          logger.debug(`${logPrefix} No matches above threshold, not selecting any match`);
        }
        break;
    }

    // Count selected matches for logging
    const selectedMatches = limitedMatches.filter(m => m.selected).length;
    logger.info(`${logPrefix} Selected ${selectedMatches} matches based on match mode: ${matchMode}`);

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
