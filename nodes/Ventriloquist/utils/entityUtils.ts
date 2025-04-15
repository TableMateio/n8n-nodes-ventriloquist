import type { Logger as ILogger } from 'n8n-workflow';
import type * as puppeteer from 'puppeteer-core';
import { createEntityMatcher, type IEntityMatcherConfig } from './middlewares/matching/entityMatcherFactory';
import { createExtraction, type IExtractionConfig } from './middlewares/extraction/extractionFactory';
import { normalizeText, formatPersonName, formatAddress } from './textUtils';
import { compareStrings, compareEntities, type IFieldComparisonConfig, type ComparisonAlgorithm } from './comparisonUtils';
import { extractWithPattern, extractAllWithPattern } from './extractionPatterns';

/**
 * Combined input for entity matching with extraction
 */
export interface IEntityMatchingWithExtractionConfig {
  sourceEntity: Record<string, string | null | undefined>;
  resultsSelector: string;
  itemSelector: string;
  extractionConfigs: Array<{
    field: string;
    extractionType: string;
    selector: string;
    attribute?: string;
    weight: number;
    comparisonAlgorithm?: string;
  }>;
  threshold: number;
  limitResults?: number;
  action: 'click' | 'extract' | 'none';
  actionSelector?: string;
  actionAttribute?: string;
  waitAfterAction?: boolean;
}

/**
 * Extract and match entities on a page
 */
export async function extractAndMatchEntities(
  page: puppeteer.Page,
  config: IEntityMatchingWithExtractionConfig,
  context: {
    logger: ILogger;
    nodeName: string;
    nodeId: string;
    sessionId: string;
    index: number;
  }
): Promise<any> {
  const { logger, nodeName, nodeId } = context;
  const logPrefix = `[EntityUtils][${nodeName}][${nodeId}]`;

  try {
    logger.info(`${logPrefix} Starting entity extraction and matching process`);

    // Create entity matcher config
    const entityMatcherConfig: IEntityMatcherConfig = {
      sourceEntity: config.sourceEntity,
      resultsSelector: config.resultsSelector,
      itemSelector: config.itemSelector,
      fields: config.extractionConfigs.map(extractionConfig => ({
        name: extractionConfig.field,
        selector: extractionConfig.selector,
        attribute: extractionConfig.attribute,
        weight: extractionConfig.weight,
        comparisonAlgorithm: extractionConfig.comparisonAlgorithm,
      })),
      fieldComparisons: config.extractionConfigs.map(extractionConfig => ({
        field: extractionConfig.field,
        weight: extractionConfig.weight,
        algorithm: (extractionConfig.comparisonAlgorithm || 'levenshtein') as ComparisonAlgorithm,
      })),
      threshold: config.threshold,
      limitResults: config.limitResults,
      action: config.action,
      actionSelector: config.actionSelector,
      actionAttribute: config.actionAttribute,
      waitAfterAction: config.waitAfterAction,
    };

    // Create and execute entity matcher
    const entityMatcher = createEntityMatcher(page, entityMatcherConfig, context);
    const result = await entityMatcher.execute();

    return result;
  } catch (error) {
    logger.error(`${logPrefix} Error in extractAndMatchEntities: ${(error as Error).message}`);
    throw error;
  }
}

/**
 * Extract text or attribute from page and normalize it
 */
export async function extractAndNormalizeText(
  page: puppeteer.Page,
  selector: string,
  options: {
    extractionType?: string;
    attribute?: string;
    normalizationOptions?: {
      lowercase?: boolean;
      trimWhitespace?: boolean;
      removeExtraSpaces?: boolean;
    };
  },
  context: {
    logger: ILogger;
    nodeName: string;
    nodeId: string;
    sessionId: string;
    index: number;
  }
): Promise<string> {
  try {
    // Create extraction config
    const extractionConfig: IExtractionConfig = {
      extractionType: options.extractionType || 'text',
      selector,
      attributeName: options.attribute,
      waitForSelector: true,
      selectorTimeout: 5000,
    };

    // Create and execute extraction
    const extraction = createExtraction(page, extractionConfig, context);
    const result = await extraction.execute();

    if (!result.success || !result.data) {
      throw new Error(`Extraction failed: ${result.error?.message || 'No data extracted'}`);
    }

    // Normalize extracted text
    const extractedText = String(result.data);
    return normalizeText(extractedText, options.normalizationOptions);
  } catch (error) {
    context.logger.error(`[EntityUtils] Error in extractAndNormalizeText: ${(error as Error).message}`);
    return '';
  }
}

// Export all relevant utilities
export {
  // Text utilities
  normalizeText,
  formatPersonName,
  formatAddress,

  // Comparison utilities
  compareStrings,
  compareEntities,

  // Pattern utilities
  extractWithPattern,
  extractAllWithPattern,

  // Entity matcher factory
  createEntityMatcher,

  // Extraction factory
  createExtraction,
};
