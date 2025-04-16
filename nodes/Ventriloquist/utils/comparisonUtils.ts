import type { Logger as ILogger } from 'n8n-workflow';

/**
 * Comparison algorithm types supported by the system
 */
export type ComparisonAlgorithm = 'exact' | 'contains' | 'containment' | 'levenshtein' | 'jaccard' | 'smart' | 'smartAll' | 'custom';

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
 * This is especially important for "Smart All" text matching
 */
export function extractTextFromHtml(html: string): string {
    if (!html) return '';

    // Replace common block elements with newlines to preserve structure
    let text = html
        .replace(/<(\/?)(?:div|p|h[1-6]|br|tr|ul|ol|li|blockquote|pre|header|footer|section|article|table|thead|tbody)[^>]*>/gi,
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

    // Remove leading/trailing whitespace from each line
    text = text.split('\n')
        .map(line => line.trim())
        .filter(line => line.length > 0)
        .join('\n');

    return text.trim();
}

/**
 * Normalize text for better comparison
 * - Extracts text from HTML if specified
 * - Trims whitespace
 * - Normalizes spaces (removes consecutive spaces)
 * - Normalizes newlines (replaces multiple newlines with a single one)
 * - Converts to lowercase if specified
 *
 * This is critical for the "Smart All" method to work properly
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
        // Replace all sequences of newlines with a single newline
        normalized = normalized.replace(/\n{2,}/g, '\n');

        // Remove leading/trailing whitespace from each line
        normalized = normalized.split('\n')
            .map(line => line.trim())
            .filter(line => line.length > 0)
            .join('\n');
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
    const aSet = new Set(a.toLowerCase().split(/\s+/).filter(Boolean));
    const bSet = new Set(b.toLowerCase().split(/\s+/).filter(Boolean));

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
 *
 * Enhanced version with better text chunking and proximity scoring
 */
export function containmentSimilarity(reference: string, target: string): number {
    if (!reference && !target) return 1;
    if (!reference) return 0.5; // Empty reference with content in target is a partial match
    if (!target) return 0;

    // First check for direct containment (highest priority)
    if (target.includes(reference)) {
        // Perfect containment - the reference appears exactly in the target
        // Return a high score but scale it based on relative size to prevent
        // tiny references from matching too easily
        const sizeRatio = Math.min(1, reference.length / Math.max(20, target.length * 0.1));
        return 0.95 + (sizeRatio * 0.05); // Between 0.95 and 1.0 based on size ratio
    }

    // Split into words (ignoring very common words)
    const stopWords = new Set(['the', 'and', 'or', 'a', 'an', 'in', 'on', 'at', 'to', 'for', 'with', 'by', 'of']);
    const referenceWords = reference.toLowerCase().split(/\s+/)
        .filter(word => word.length > 0 && (!stopWords.has(word) || word.length > 3));

    if (referenceWords.length === 0) return 0;

    const targetWords = target.toLowerCase().split(/\s+/)
        .filter(word => word.length > 0);

    // Count matching words and their positions
    let matchedWords = 0;
    let sequentialMatches = 0;
    let lastMatchIndex = -1;
    const matchedIndices: number[] = [];

    for (const word of referenceWords) {
        if (word.length <= 2) {
            // For very short words, require exact matches
            const matchIndex = targetWords.findIndex((tw, i) =>
                !matchedIndices.includes(i) && tw === word);

            if (matchIndex >= 0) {
                matchedWords++;
                matchedIndices.push(matchIndex);

                // Check if words are appearing in sequence
                if (matchIndex > lastMatchIndex) {
                    sequentialMatches++;
                    lastMatchIndex = matchIndex;
                }
            }
        } else {
            // For longer words, look for inclusion (partial matches)
            let bestMatchIndex = -1;
            for (let i = 0; i < targetWords.length; i++) {
                if (!matchedIndices.includes(i) &&
                    (targetWords[i].includes(word) || word.includes(targetWords[i]))) {
                    bestMatchIndex = i;
                    break;
                }
            }

            if (bestMatchIndex >= 0) {
                matchedWords++;
                matchedIndices.push(bestMatchIndex);

                // Check if words are appearing in sequence
                if (bestMatchIndex > lastMatchIndex) {
                    sequentialMatches++;
                    lastMatchIndex = bestMatchIndex;
                }
            }
        }
    }

    // Calculate basic containment score
    const containmentScore = referenceWords.length > 0 ?
        matchedWords / referenceWords.length : 0;

    // Calculate sequence bonus (words appearing in the same order get a bonus)
    const sequenceBonus = sequentialMatches > 1 ?
        0.2 * (sequentialMatches / Math.max(2, referenceWords.length)) : 0;

    // Calculate density bonus (clustered matches get a bonus over scattered matches)
    const densityBonus = matchedIndices.length > 1 ?
        0.1 * (1 - (Math.max(...matchedIndices) - Math.min(...matchedIndices)) / targetWords.length) : 0;

    return Math.min(1, containmentScore + sequenceBonus + densityBonus);
}

/**
 * Smart match for "Smart All" comparison, specially designed for comparing a reference text
 * against a larger body of potentially jumbled text while focusing on content matching
 * rather than exact structure or order
 */
export function smartAllMatch(reference: string, target: string, logger?: ILogger): number {
    // Always normalize for smartAll matching (extract text, normalize whitespace, etc.)
    const normalizedReference = normalizeTextForComparison(reference, {
        algorithm: 'smartAll',
        normalization: {
            extractTextOnly: true,
            trimWhitespace: true,
            removeExtraSpaces: true,
            normalizeNewlines: true,
            toLowerCase: true
        }
    });

    const normalizedTarget = normalizeTextForComparison(target, {
        algorithm: 'smartAll',
        normalization: {
            extractTextOnly: true,
            trimWhitespace: true,
            removeExtraSpaces: true,
            normalizeNewlines: true,
            toLowerCase: true
        }
    });

    if (logger) {
        logger.debug('Smart All Match - Normalized Reference: ' + normalizedReference.substring(0, 100) +
                   (normalizedReference.length > 100 ? '...' : ''));
        logger.debug('Smart All Match - Normalized Target: ' + normalizedTarget.substring(0, 100) +
                   (normalizedTarget.length > 100 ? '...' : ''));
    }

    // First try containment approach (prioritizing if reference is contained in target)
    const containmentScore = containmentSimilarity(normalizedReference, normalizedTarget);

    // Also calculate Jaccard similarity for word overlap
    const jaccardScore = jaccardSimilarity(normalizedReference, normalizedTarget);

    // Combine scores, weighting containment more heavily since it's better for finding
    // when the reference is contained within a larger body of text
    const combinedScore = containmentScore * 0.7 + jaccardScore * 0.3;

    if (logger) {
        logger.debug(`Smart All Match - Containment Score: ${containmentScore.toFixed(4)}, Jaccard Score: ${jaccardScore.toFixed(4)}, Combined: ${combinedScore.toFixed(4)}`);
    }

    return combinedScore;
}

/**
 * Compare two strings using the specified algorithm
 */
export function compareStrings(
    reference: string,
    target: string,
    options: IStringComparisonOptions = DEFAULT_COMPARISON_OPTIONS,
    logger?: ILogger
): number {
    // Handle empty strings
    if (!reference && !target) return 1; // Both empty = perfect match
    if (!reference || !target) return 0; // One empty = no match

    // Normalize both strings according to options
    const normalizedReference = normalizeTextForComparison(reference, options);
    const normalizedTarget = normalizeTextForComparison(target, options);

    // If both strings are empty after normalization, they're equivalent
    if (!normalizedReference && !normalizedTarget) return 1;
    if (!normalizedReference || !normalizedTarget) return 0;

    if (logger) {
        logger.debug(`Comparing with algorithm: ${options.algorithm}`);
        logger.debug(`Normalized reference: "${normalizedReference.substring(0, 50)}${normalizedReference.length > 50 ? '...' : ''}"`);
        logger.debug(`Normalized target: "${normalizedTarget.substring(0, 50)}${normalizedTarget.length > 50 ? '...' : ''}"`);
    }

    // Use the appropriate algorithm
    switch (options.algorithm) {
        case 'exact':
            return normalizedReference === normalizedTarget ? 1 : 0;

        case 'contains':
            return normalizedTarget.includes(normalizedReference) ? 1 : 0;

        case 'containment':
            return containmentSimilarity(normalizedReference, normalizedTarget);

        case 'levenshtein':
            return levenshteinSimilarity(normalizedReference, normalizedTarget);

        case 'jaccard':
            return jaccardSimilarity(normalizedReference, normalizedTarget);

        case 'smartAll':
            return smartAllMatch(reference, target, logger);

        case 'smart':
            // Use a combination of algorithms based on text length
            if (normalizedReference.length < 5 || normalizedTarget.length < 5) {
                // For very short strings, exact matching is more appropriate
                return normalizedReference === normalizedTarget ? 1 : 0;
            } else if (normalizedReference.length < 20 && normalizedTarget.length < 20) {
                // For short strings, Levenshtein works well
                return levenshteinSimilarity(normalizedReference, normalizedTarget);
            } else {
                // For longer strings, use a weighted combination of Jaccard and containment
                const jaccardScore = jaccardSimilarity(normalizedReference, normalizedTarget);
                const containmentScore = containmentSimilarity(normalizedReference, normalizedTarget);
                return jaccardScore * 0.6 + containmentScore * 0.4;
            }

        case 'custom':
            if (options.customComparator) {
                return options.customComparator(normalizedReference, normalizedTarget);
            }
            // Fall back to levenshtein if no custom comparator is provided
            return levenshteinSimilarity(normalizedReference, normalizedTarget);

        default:
            // Default to levenshtein for unknown algorithms
            return levenshteinSimilarity(normalizedReference, normalizedTarget);
    }
}

/**
 * Compare two entities based on field comparisons
 */
export function compareEntities(
    sourceEntity: Record<string, string | null | undefined>,
    targetEntity: Record<string, string | null | undefined>,
    fieldComparisons: IFieldComparisonConfig[],
    logger?: ILogger
): {
    overallSimilarity: number;
    fieldSimilarities: Record<string, number>;
    matchedFields: number;
    requiredFieldsMatched: boolean;
} {
    // Initialize result
    const fieldSimilarities: Record<string, number> = {};
    let totalWeight = 0;
    let weightedSimilarity = 0;
    let matchedFields = 0;
    let requiredFieldsMatched = true;

    if (logger) {
        logger.debug(`Comparing entities with ${fieldComparisons.length} field configurations`);
    }

    // Process each field
    for (const fieldConfig of fieldComparisons) {
        const { field, weight, algorithm = 'levenshtein', threshold = 0.7, mustMatch = false } = fieldConfig;

        // Get field values
        const sourceValue = sourceEntity[field] || '';
        const targetValue = targetEntity[field] || '';

        // Compare this field
        const similarity = compareStrings(
            sourceValue.toString(),
            targetValue.toString(),
            { algorithm: algorithm as ComparisonAlgorithm, threshold },
            logger
        );

        // Store result for this field
        fieldSimilarities[field] = similarity;

        // Update weighted similarity calculation
        totalWeight += weight;
        weightedSimilarity += similarity * weight;

        // Check if this field is considered a match
        const isMatch = similarity >= threshold;
        if (isMatch) {
            matchedFields++;
        }

        // Check required fields
        if (mustMatch && !isMatch) {
            requiredFieldsMatched = false;
            if (logger) {
                logger.debug(`Required field "${field}" failed to match: ${similarity.toFixed(4)} < ${threshold}`);
            }
        }

        if (logger) {
            logger.debug(`Field "${field}" (weight: ${weight}) similarity: ${similarity.toFixed(4)}`);
        }
    }

    // Calculate overall similarity
    const overallSimilarity = totalWeight > 0 ? weightedSimilarity / totalWeight : 0;

    if (logger) {
        logger.debug(`Overall similarity: ${overallSimilarity.toFixed(4)}, Matched fields: ${matchedFields}/${fieldComparisons.length}, Required fields matched: ${requiredFieldsMatched}`);
    }

    return {
        overallSimilarity,
        fieldSimilarities,
        matchedFields,
        requiredFieldsMatched
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
 * Critical for the "Smart All" text extraction
 */
export function getVisibleTextFromHtml(html: string, options: IHtmlExtractionOptions = {}): string {
    if (!html) return '';

    // Create a temporary div to parse HTML (browser environment only)
    // In Node.js we use a simpler regex-based approach
    let text = html
        // Replace common block elements with newlines
        .replace(/<(div|p|h[1-6]|br|tr|li|blockquote|pre|header|section|article|table|thead|tbody)[^>]*>/gi, '\n')
        // Remove remaining HTML tags
        .replace(/<[^>]+>/g, '')
        // Replace common HTML entities
        .replace(/&nbsp;/g, ' ')
        .replace(/&lt;/g, '<')
        .replace(/&gt;/g, '>')
        .replace(/&amp;/g, '&')
        .replace(/&quot;/g, '"')
        .replace(/&#39;/g, "'");

    // Normalize newlines and spaces - exactly one newline between paragraphs
    text = text.split('\n')
        .map(line => line.trim())
        .filter(line => line.length > 0)
        .join('\n');

    if (options.removeNewlines) {
        text = text.replace(/\n/g, ' ');
    }

    return text.trim();
}
