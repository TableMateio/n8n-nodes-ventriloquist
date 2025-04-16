import type { Logger as ILogger } from 'n8n-workflow';

/**
 * Comparison algorithm types supported by the system
 */
export type ComparisonAlgorithm = 'exact' | 'contains' | 'containment' | 'levenshtein' | 'jaccard' | 'smart' | 'custom';

/**
 * String comparison options
 */
export interface IStringComparisonOptions {
    algorithm: ComparisonAlgorithm;
    caseSensitive?: boolean;
    threshold?: number;
    customComparator?: (a: string, b: string) => number;
    normalization?: {
        trimWhitespace?: boolean;
        removeExtraSpaces?: boolean;
        normalizeNewlines?: boolean;
        toLowerCase?: boolean;
    };
}

/**
 * Field comparison configuration
 */
export interface IFieldComparisonConfig {
    field: string;
    weight: number;
    algorithm?: ComparisonAlgorithm;
    threshold?: number;
    customComparator?: (a: string, b: string) => number;
    mustMatch?: boolean;
}

/**
 * Default comparison options
 */
export const DEFAULT_COMPARISON_OPTIONS: IStringComparisonOptions = {
    algorithm: 'levenshtein',
    caseSensitive: false,
    threshold: 0.7,
    normalization: {
        trimWhitespace: true,
        removeExtraSpaces: true,
        normalizeNewlines: true,
        toLowerCase: true,
    }
};

/**
 * Normalize text for better comparison
 * - Trims whitespace
 * - Normalizes spaces (removes consecutive spaces)
 * - Normalizes newlines (replaces multiple newlines with a single one)
 * - Converts to lowercase if specified
 */
export function normalizeTextForComparison(text: string, options: IStringComparisonOptions = DEFAULT_COMPARISON_OPTIONS): string {
    if (!text) return '';

    let normalized = text;

    const normOpts = options.normalization || DEFAULT_COMPARISON_OPTIONS.normalization;

    if (normOpts?.trimWhitespace) {
        normalized = normalized.trim();
    }

    if (normOpts?.normalizeNewlines) {
        normalized = normalized.replace(/\n+/g, '\n');
    }

    if (normOpts?.removeExtraSpaces) {
        normalized = normalized.replace(/\s+/g, ' ');
    }

    if (!options.caseSensitive || normOpts?.toLowerCase) {
        normalized = normalized.toLowerCase();
    }

    return normalized;
}

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
                matrix[i - 1][j] + 1,      // deletion
                matrix[i][j - 1] + 1,      // insertion
                matrix[i - 1][j - 1] + cost // substitution
            );
        }
    }

    return matrix[b.length][a.length];
}

/**
 * Calculate Levenshtein similarity (0-1 scale)
 */
export function levenshteinSimilarity(a: string, b: string): number {
    if (!a && !b) return 1;
    if (!a || !b) return 0;

    const distance = levenshteinDistance(a, b);
    const maxLength = Math.max(a.length, b.length);

    return maxLength === 0 ? 1 : 1 - distance / maxLength;
}

/**
 * Calculate Jaccard similarity between two strings
 * Based on word overlap
 */
export function jaccardSimilarity(a: string, b: string): number {
    if (!a && !b) return 1;
    if (!a || !b) return 0;

    const aSet = new Set(a.split(/\s+/).filter(Boolean));
    const bSet = new Set(b.split(/\s+/).filter(Boolean));

    const intersection = new Set([...aSet].filter(x => bSet.has(x)));
    const union = new Set([...aSet, ...bSet]);

    return union.size === 0 ? 1 : intersection.size / union.size;
}

/**
 * Calculate containment similarity - how much of reference is contained in target
 * This is especially useful for "Smart all" matching where we want to see if the
 * reference text is fully contained within a possibly much larger target text
 */
export function containmentSimilarity(reference: string, target: string): number {
    if (!reference && !target) return 1;
    if (!reference) return 0.5; // Empty reference with content in target is a partial match
    if (!target) return 0;

    // First check for direct containment
    if (target.includes(reference)) {
        // Perfect containment - the reference appears exactly in the target
        // We want a high similarity score, but also account for how much of the target is matched
        // Ratio of reference length to target length, with minimum of 0.8 to prioritize containment
        const ratio = reference.length / target.length;
        return Math.max(0.8, ratio);
    }

    // Check for word-level containment (percentage of reference words found in target)
    const referenceWords = reference.split(/\s+/).filter(word => word.length > 2);
    if (referenceWords.length === 0) return 0;

    const targetWords = new Set(target.split(/\s+/).filter(Boolean));
    let matchedWords = 0;

    for (const word of referenceWords) {
        if (targetWords.has(word) || [...targetWords].some(tw => tw.includes(word) || word.includes(tw))) {
            matchedWords++;
        }
    }

    return matchedWords / referenceWords.length;
}

/**
 * Smart comparison that combines multiple approaches for best results
 * Particularly useful for comparing jumbled text content
 */
export function smartSimilarity(reference: string, target: string): number {
    if (!reference && !target) return 1;
    if (!reference || !target) return 0;

    // 1. Check for exact containment
    if (target.includes(reference)) {
        return 0.95; // Almost perfect match if target contains reference exactly
    }

    // 2. Check word-level containment
    const containmentScore = containmentSimilarity(reference, target);

    // 3. Check word overlap with Jaccard
    const jaccardScore = jaccardSimilarity(reference, target);

    // 4. Check edit distance for close matches
    const levenshteinScore = levenshteinSimilarity(reference, target);

    // Combine scores with weights prioritizing containment for "Smart all" method
    return (containmentScore * 0.6) + (jaccardScore * 0.3) + (levenshteinScore * 0.1);
}

/**
 * Compare two strings using the specified algorithm
 */
export function compareStrings(
    str1: string,
    str2: string,
    options: Partial<IStringComparisonOptions> = {},
    logger?: ILogger
): number {
    try {
        const mergedOptions: IStringComparisonOptions = {
            ...DEFAULT_COMPARISON_OPTIONS,
            ...options,
            normalization: {
                ...DEFAULT_COMPARISON_OPTIONS.normalization,
                ...options.normalization
            }
        };

        // Normalize strings for comparison
        const normalizedStr1 = normalizeTextForComparison(str1, mergedOptions);
        const normalizedStr2 = normalizeTextForComparison(str2, mergedOptions);

        // Special case: both strings empty
        if (!normalizedStr1 && !normalizedStr2) return 1;

        // Special case: one string empty
        if (!normalizedStr1 || !normalizedStr2) return 0;

        // Apply selected algorithm
        switch (mergedOptions.algorithm) {
            case 'exact':
                return normalizedStr1 === normalizedStr2 ? 1 : 0;

            case 'contains':
                if (normalizedStr1.includes(normalizedStr2)) return 0.9;
                if (normalizedStr2.includes(normalizedStr1)) return 0.8;
                return 0;

            case 'containment':
                return containmentSimilarity(normalizedStr1, normalizedStr2);

            case 'levenshtein':
                return levenshteinSimilarity(normalizedStr1, normalizedStr2);

            case 'jaccard':
                return jaccardSimilarity(normalizedStr1, normalizedStr2);

            case 'smart':
                return smartSimilarity(normalizedStr1, normalizedStr2);

            case 'custom':
                if (mergedOptions.customComparator) {
                    return mergedOptions.customComparator(normalizedStr1, normalizedStr2);
                }
                throw new Error('Custom comparator function not provided');

            default:
                throw new Error(`Unsupported comparison algorithm: ${mergedOptions.algorithm}`);
        }
    } catch (error) {
        if (logger) {
            logger.error(`[ComparisonUtils] Error comparing strings: ${(error as Error).message}`);
        }
        return 0;
    }
}

/**
 * Check if a similarity score meets the threshold
 */
export function meetsThreshold(similarity: number, threshold?: number): boolean {
    const actualThreshold = threshold ?? DEFAULT_COMPARISON_OPTIONS.threshold ?? 0.7;
    return similarity >= actualThreshold;
}

/**
 * Compare two entities based on field configurations
 */
export function compareEntities(
    sourceEntity: Record<string, string | null | undefined>,
    targetEntity: Record<string, string | null | undefined>,
    fieldConfigs: IFieldComparisonConfig[],
    logger?: ILogger
): {
    overallSimilarity: number;
    fieldSimilarities: Record<string, number>;
    meetsThreshold: boolean;
    requiredFieldsMet: boolean;
} {
    const fieldSimilarities: Record<string, number> = {};
    let weightSum = 0;
    let weightedSimilaritySum = 0;
    let allRequiredFieldsMet = true;

    for (const config of fieldConfigs) {
        const sourceValue = sourceEntity[config.field] || '';
        const targetValue = targetEntity[config.field] || '';

        const similarity = compareStrings(
            sourceValue.toString(),
            targetValue.toString(),
            {
                algorithm: config.algorithm || DEFAULT_COMPARISON_OPTIONS.algorithm,
                threshold: config.threshold ?? DEFAULT_COMPARISON_OPTIONS.threshold,
                customComparator: config.customComparator,
            },
            logger
        );

        fieldSimilarities[config.field] = similarity;
        weightSum += config.weight;
        weightedSimilaritySum += similarity * config.weight;

        // Check if required field meets threshold
        const fieldThreshold = (config.threshold ?? DEFAULT_COMPARISON_OPTIONS.threshold)!;
        if (config.mustMatch && similarity < fieldThreshold) {
            allRequiredFieldsMet = false;
        }
    }

    const overallSimilarity = weightSum > 0 ? weightedSimilaritySum / weightSum : 0;

    // Calculate overall threshold with strict type safety
    let overallThreshold = DEFAULT_COMPARISON_OPTIONS.threshold!; // Default if no weights
    if (weightSum > 0) {
        overallThreshold = fieldConfigs.reduce(
            (sum, config) => {
                const threshold = (config.threshold ?? DEFAULT_COMPARISON_OPTIONS.threshold)!;
                return sum + threshold * config.weight;
            },
            0
        ) / weightSum;
    }

    return {
        overallSimilarity,
        fieldSimilarities,
        meetsThreshold: overallSimilarity >= overallThreshold,
        requiredFieldsMet: allRequiredFieldsMet,
    };
}
