import type { Logger as ILogger } from 'n8n-workflow';

/**
 * Comparison algorithm options
 */
export type ComparisonAlgorithm = 'exact' | 'contains' | 'levenshtein' | 'jaccard' | 'custom';

/**
 * Options for string comparison
 */
export interface IComparisonOptions {
  algorithm: ComparisonAlgorithm;
  caseSensitive?: boolean;
  threshold?: number;
  customComparator?: (a: string, b: string) => number;
}

/**
 * Default comparison options
 */
export const DEFAULT_COMPARISON_OPTIONS: IComparisonOptions = {
  algorithm: 'levenshtein',
  caseSensitive: false,
  threshold: 0.7,
};

/**
 * Calculate Levenshtein distance between two strings
 */
export function levenshteinDistance(a: string, b: string): number {
  const matrix: number[][] = [];

  // Initialize matrix
  for (let i = 0; i <= b.length; i++) {
    matrix[i] = [i];
  }
  for (let j = 0; j <= a.length; j++) {
    matrix[0][j] = j;
  }

  // Fill matrix
  for (let i = 1; i <= b.length; i++) {
    for (let j = 1; j <= a.length; j++) {
      const cost = a[j - 1] === b[i - 1] ? 0 : 1;
      matrix[i][j] = Math.min(
        matrix[i - 1][j] + 1, // deletion
        matrix[i][j - 1] + 1, // insertion
        matrix[i - 1][j - 1] + cost // substitution
      );
    }
  }

  return matrix[b.length][a.length];
}

/**
 * Calculate normalized Levenshtein similarity (0-1 scale)
 */
export function levenshteinSimilarity(a: string, b: string): number {
  if (!a && !b) return 1; // Both empty = perfect match
  if (!a || !b) return 0; // One empty = no match

  const distance = levenshteinDistance(a, b);
  const maxLength = Math.max(a.length, b.length);

  // Convert distance to similarity (0-1)
  return maxLength === 0 ? 1 : 1 - distance / maxLength;
}

/**
 * Calculate Jaccard similarity between two strings
 * Jaccard = (intersection size) / (union size)
 */
export function jaccardSimilarity(a: string, b: string): number {
  if (!a && !b) return 1; // Both empty = perfect match
  if (!a || !b) return 0; // One empty = no match

  // Convert strings to word sets
  const aSet = new Set(a.split(/\s+/).filter(Boolean));
  const bSet = new Set(b.split(/\s+/).filter(Boolean));

  // Calculate intersection
  const intersection = new Set([...aSet].filter(x => bSet.has(x)));

  // Calculate union
  const union = new Set([...aSet, ...bSet]);

  // Calculate Jaccard similarity
  return union.size === 0 ? 1 : intersection.size / union.size;
}

/**
 * Compare two strings using the specified algorithm
 */
export function compareStrings(
  a: string,
  b: string,
  options: Partial<IComparisonOptions> = {},
  logger?: ILogger
): number {
  try {
    // Merge with default options
    const mergedOptions: IComparisonOptions = {
      ...DEFAULT_COMPARISON_OPTIONS,
      ...options,
    };

    // Handle case sensitivity
    let str1 = a || '';
    let str2 = b || '';

    if (!mergedOptions.caseSensitive) {
      str1 = str1.toLowerCase();
      str2 = str2.toLowerCase();
    }

    // Apply the selected algorithm
    switch (mergedOptions.algorithm) {
      case 'exact':
        return str1 === str2 ? 1 : 0;

      case 'contains':
        if (str1 === str2) return 1;
        if (str1.includes(str2)) return 0.9;
        if (str2.includes(str1)) return 0.8;
        return 0;

      case 'levenshtein':
        return levenshteinSimilarity(str1, str2);

      case 'jaccard':
        return jaccardSimilarity(str1, str2);

      case 'custom':
        if (mergedOptions.customComparator) {
          return mergedOptions.customComparator(str1, str2);
        }
        throw new Error('Custom comparator function not provided');

      default:
        throw new Error(`Unsupported comparison algorithm: ${mergedOptions.algorithm}`);
    }
  } catch (error) {
    if (logger) {
      logger.error(`[ComparisonUtils] Error comparing strings: ${(error as Error).message}`);
    }
    return 0; // Return no match on error
  }
}

/**
 * Check if similarity meets the threshold
 */
export function meetsThreshold(
  similarity: number,
  threshold: number = DEFAULT_COMPARISON_OPTIONS.threshold!
): boolean {
  return similarity >= threshold;
}

/**
 * Compare multiple fields between two entities
 */
export interface IFieldComparisonConfig {
  field: string;
  weight: number;
  algorithm?: ComparisonAlgorithm;
  threshold?: number;
  customComparator?: (a: string, b: string) => number;
}

/**
 * Compare two entities across multiple fields
 */
export function compareEntities(
  sourceEntity: Record<string, string | undefined | null>,
  targetEntity: Record<string, string | undefined | null>,
  fieldConfigs: IFieldComparisonConfig[],
  logger?: ILogger
): {
  overallSimilarity: number;
  fieldSimilarities: Record<string, number>;
  meetsThreshold: boolean;
} {
  // Initialize results
  const fieldSimilarities: Record<string, number> = {};
  let weightSum = 0;
  let weightedSimilaritySum = 0;

  // Calculate similarity for each field
  for (const config of fieldConfigs) {
    const sourceValue = sourceEntity[config.field] || '';
    const targetValue = targetEntity[config.field] || '';

    const similarity = compareStrings(
      sourceValue.toString(),
      targetValue.toString(),
      {
        algorithm: config.algorithm || DEFAULT_COMPARISON_OPTIONS.algorithm,
        threshold: config.threshold || DEFAULT_COMPARISON_OPTIONS.threshold,
        customComparator: config.customComparator,
      },
      logger
    );

    fieldSimilarities[config.field] = similarity;
    weightSum += config.weight;
    weightedSimilaritySum += similarity * config.weight;
  }

  // Calculate overall weighted similarity
  const overallSimilarity = weightSum > 0 ? weightedSimilaritySum / weightSum : 0;

  // Check if overall similarity meets threshold
  const overallThreshold = fieldConfigs.reduce(
    (sum, config) => sum + (config.threshold || DEFAULT_COMPARISON_OPTIONS.threshold!) * config.weight,
    0
  ) / weightSum;

  return {
    overallSimilarity,
    fieldSimilarities,
    meetsThreshold: overallSimilarity >= overallThreshold,
  };
}
