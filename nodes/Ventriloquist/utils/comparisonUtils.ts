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
        extractTextOnly?: boolean; // Extract only text content from HTML
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
        extractTextOnly: true
    }
};

/**
 * Extract visible text content from HTML
 * Removes all HTML tags while preserving text structure
 */
export function extractTextFromHtml(html: string): string {
    if (!html) return '';

    // Replace common block elements with newlines to preserve structure
    let text = html
        .replace(/<(\/?)(?:div|p|h[1-6]|br|tr|ul|ol|li|blockquote|pre|header|footer|section|article)[^>]*>/gi,
                 (_, closing) => closing ? '\n' : '\n')
        .replace(/<[^>]+>/g, '') // Remove all remaining HTML tags
        .replace(/&nbsp;/g, ' ') // Replace non-breaking spaces with regular spaces
        .replace(/&lt;/g, '<')   // Replace common HTML entities
        .replace(/&gt;/g, '>')
        .replace(/&amp;/g, '&')
        .replace(/&quot;/g, '"')
        .replace(/&#39;/g, "'");

    // Normalize multiple newlines to a single newline
    text = text.replace(/\n{2,}/g, '\n');

    return text.trim();
}

/**
 * Normalize text for better comparison
 * - Extracts text from HTML if specified
 * - Trims whitespace
 * - Normalizes spaces (removes consecutive spaces)
 * - Normalizes newlines (replaces multiple newlines with a single one)
 * - Converts to lowercase if specified
 */
export function normalizeTextForComparison(text: string, options: IStringComparisonOptions = DEFAULT_COMPARISON_OPTIONS): string {
    if (!text) return '';

    let normalized = text;
    const normOpts = options.normalization || DEFAULT_COMPARISON_OPTIONS.normalization;

    // Extract only text from HTML if specified (for "Smart all" method)
    if (normOpts?.extractTextOnly) {
        normalized = extractTextFromHtml(normalized);
    }

    if (normOpts?.trimWhitespace) {
        normalized = normalized.trim();
    }

    if (normOpts?.normalizeNewlines) {
        normalized = normalized.replace(/\n{2,}/g, '\n');
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
 * Based on word overlap - better for comparing text with jumbled word order
 */
export function jaccardSimilarity(a: string, b: string): number {
    if (!a && !b) return 1;
    if (!a || !b) return 0;

    // Split into words and filter empty strings
    const aSet = new Set(a.split(/\s+/).filter(Boolean));
    const bSet = new Set(b.split(/\s+/).filter(Boolean));

    if (aSet.size === 0 && bSet.size === 0) return 1;
    if (aSet.size === 0 || bSet.size === 0) return 0;

    // Count matching words (intersection)
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
    // Handle empty reference case - empty references should match nothing
    if (!reference || reference.trim().length === 0) {
        return 0; // Empty reference shouldn't match anything
    }

    // Handle other empty cases
    if (!reference && !target) return 0; // Changed from 1 to 0
    if (!reference) return 0; // Empty reference shouldn't match anything
    if (!target) return 0;

    // First check for direct containment
    if (target.includes(reference)) {
        // Perfect containment - the reference appears exactly in the target
        // Return a high score but scale it based on relative size to prevent
        // tiny references from matching too easily
        const sizeRatio = Math.min(1, reference.length / Math.max(20, target.length * 0.1));
        return 0.9 + (sizeRatio * 0.1); // Between 0.9 and 1.0 based on size ratio
    }

    // Calculate word-level containment
    const referenceWords = reference.split(/\s+/).filter(Boolean);
    if (referenceWords.length === 0) return 0;

    const targetWords = target.split(/\s+/).filter(Boolean);

    // Count matching words and their positions
    let matchedWords = 0;
    let sequentialMatches = 0;
    let lastMatchIndex = -1;

    for (const word of referenceWords) {
        if (word.length <= 2) {
            // For very short words, require exact matches
            const matchIndex = targetWords.findIndex(tw => tw === word);
            if (matchIndex >= 0) {
                matchedWords++;

                // Check if words are appearing in sequence
                if (matchIndex > lastMatchIndex) {
                    sequentialMatches++;
                    lastMatchIndex = matchIndex;
                }
            }
        } else {
            // For longer words, check for containment or exact matches
            let found = false;
            for (let i = 0; i < targetWords.length; i++) {
                const tw = targetWords[i];
                if (tw === word || tw.includes(word) || word.includes(tw)) {
                    matchedWords++;

                    // Check if words are appearing in sequence
                    if (i > lastMatchIndex) {
                        sequentialMatches++;
                        lastMatchIndex = i;
                    }

                    found = true;
                    break;
                }
            }
        }
    }

    // Calculate containment score with weighted components
    const matchRatio = matchedWords / referenceWords.length;
    const sequenceRatio = referenceWords.length > 1 ? sequentialMatches / referenceWords.length : 1;

    // Weight the raw match count higher than sequence order
    const weightedScore = (matchRatio * 0.7) + (sequenceRatio * 0.3);

    // Bonus for matching a significant portion of words
    return matchRatio > 0.8 ? weightedScore * 1.1 : weightedScore;
}

/**
 * Smart comparison that combines multiple approaches for best results
 * Particularly useful for comparing jumbled text content from web pages
 * The "Smart all" approach prioritizes finding reference text contained within a larger target
 */
export function smartSimilarity(reference: string, target: string): number {
    // Explicitly handle empty reference case - empty references should match nothing or very little
    if (!reference || reference.trim().length === 0) {
        return 0; // Empty reference shouldn't match anything
    }

    // Handle cases where both are empty
    if (!reference && !target) return 0; // Changed from 1 to 0 - empty shouldn't match empty
    if (!target) return 0;

    // For very short inputs, prioritize exact matching
    if (reference.length < 5 || target.length < 5) {
        if (reference === target) return 1;
        if (target.includes(reference) || reference.includes(target)) return 0.9;
        return 0.5;
    }

    // 1. Check for exact containment (highest priority for Smart All matching)
    if (target.includes(reference)) {
        // Calculate how much of the target is matched
        const ratio = reference.length / target.length;

        // If reference is too short compared to target, reduce score slightly
        if (ratio < 0.05 && reference.length < 20) {
            return 0.85 + (ratio * 0.15); // Scale between 0.85 and 1.0
        }

        return 0.9 + (ratio * 0.1); // Between 0.9 and 1.0 based on coverage
    }

    // 2. Check for word-level containment (most important for Smart All)
    const containmentScore = containmentSimilarity(reference, target);

    // 3. Calculate word overlap with Jaccard (good for jumbled text)
    const jaccardScore = jaccardSimilarity(reference, target);

    // 4. Check edit distance for close matches (lowest priority in Smart All)
    const levenshteinScore = levenshteinSimilarity(reference, target);

    // Determine if there's high containment (reference terms mostly found in target)
    if (containmentScore > 0.8) {
        // High containment gets more weight
        return (containmentScore * 0.7) + (jaccardScore * 0.25) + (levenshteinScore * 0.05);
    } else if (jaccardScore > 0.7) {
        // High word overlap gets balanced weights
        return (containmentScore * 0.4) + (jaccardScore * 0.5) + (levenshteinScore * 0.1);
    } else {
        // Lower containment, use a more balanced approach
        return (containmentScore * 0.4) + (jaccardScore * 0.4) + (levenshteinScore * 0.2);
    }
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
        if (!normalizedStr1 && !normalizedStr2) return 0; // Changed from 1 to 0 - empty shouldn't match empty

        // Special case: reference string empty - this is important for matching!
        if (!normalizedStr1) return 0; // If reference is empty, it shouldn't match anything

        // Special case: one string empty
        if (!normalizedStr2) return 0;

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
                logger?.warn('Custom comparator not provided, falling back to Levenshtein');
                return levenshteinSimilarity(normalizedStr1, normalizedStr2);

            default:
                logger?.warn(`Unknown comparison algorithm: ${mergedOptions.algorithm}, falling back to Levenshtein`);
                return levenshteinSimilarity(normalizedStr1, normalizedStr2);
        }
    } catch (error) {
        logger?.error(`Error comparing strings: ${(error as Error).message}`);
        return 0;
    }
}

/**
 * Check if a similarity score meets the threshold
 */
export function meetsThreshold(similarity: number, threshold?: number): boolean {
    // Ensure we have a valid threshold value, using DEFAULT_COMPARISON_OPTIONS.threshold as fallback
    const thresholdValue = threshold !== undefined
        ? threshold
        : (DEFAULT_COMPARISON_OPTIONS.threshold || 0.7);

    return similarity >= thresholdValue;
}

/**
 * Compare two entities across multiple fields
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
    let totalWeight = 0;
    let weightedSum = 0;
    let requiredFieldsMet = true;

    // Check for empty source fields and log a warning
    const emptyFields = Object.entries(sourceEntity)
        .filter(([_, value]) => !value || (typeof value === 'string' && value.trim() === ''))
        .map(([field]) => field);

    if (emptyFields.length > 0 && logger) {
        logger.debug(`Empty source fields detected: ${emptyFields.join(', ')}. These won't contribute positively to matches.`);
    }

    for (const config of fieldConfigs) {
        const sourceValue = sourceEntity[config.field] || '';
        const targetValue = targetEntity[config.field] || '';

        // Skip fields with empty references if logging is enabled
        if ((!sourceValue || (typeof sourceValue === 'string' && sourceValue.trim() === '')) && logger) {
            logger.debug(`Field "${config.field}" has empty reference value and won't contribute to matching.`);
        }

        const similarity = compareStrings(
            sourceValue,
            targetValue,
            {
                algorithm: config.algorithm || 'smart',
                threshold: config.threshold,
                customComparator: config.customComparator,
            },
            logger
        );

        fieldSimilarities[config.field] = similarity;

        if (config.mustMatch && !meetsThreshold(similarity, config.threshold)) {
            requiredFieldsMet = false;
        }

        totalWeight += config.weight;
        weightedSum += similarity * config.weight;
    }

    const overallSimilarity = totalWeight > 0 ? weightedSum / totalWeight : 0;

    return {
        overallSimilarity,
        fieldSimilarities,
        meetsThreshold: meetsThreshold(overallSimilarity),
        requiredFieldsMet,
    };
}

/**
 * Options for HTML content extraction
 */
export interface IHtmlExtractionOptions {
    preserveFormatting?: boolean;
    removeNewlines?: boolean;
}

/**
 * Get visible text content from HTML
 * More advanced than simple tag removal, handles block elements properly
 */
export function getVisibleTextFromHtml(html: string, options: IHtmlExtractionOptions = {}): string {
    if (!html) return '';

    // Create a temporary div to parse HTML (browser environment only)
    // In Node.js we use a simpler regex-based approach
    let text = html
        // Replace common block elements with newlines
        .replace(/<(div|p|h[1-6]|br|tr|li|blockquote|pre|header|section)[^>]*>/gi, '\n')
        // Remove remaining HTML tags
        .replace(/<[^>]+>/g, '')
        // Replace common HTML entities
        .replace(/&nbsp;/g, ' ')
        .replace(/&lt;/g, '<')
        .replace(/&gt;/g, '>')
        .replace(/&amp;/g, '&')
        .replace(/&quot;/g, '"')
        .replace(/&#39;/g, "'");

    // Normalize newlines and spaces
    text = text.replace(/\n+/g, '\n').replace(/\s+/g, ' ').trim();

    if (options.removeNewlines) {
        text = text.replace(/\n/g, ' ');
    }

    return text;
}
