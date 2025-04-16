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
    debugMode?: boolean; // Added to enable detailed logging for important comparisons
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
    if (!reference && !target) return 0;
    if (!reference) return 0; // Empty reference shouldn't match anything
    if (!target) return 0;

    // Normalize inputs
    const normalizedRef = reference.toLowerCase().trim();
    const normalizedTarget = target.toLowerCase().trim();

    // First check: direct full containment (highest priority)
    if (normalizedTarget.includes(normalizedRef)) {
        // Perfect match - award high score
        return 0.95; // Almost perfect
    }

    // Extract potential name entities from reference (2-3 word sequences)
    const refWords = normalizedRef.split(/\s+/).filter(Boolean);
    const nameSegments: string[] = [];

    // Look for potential name patterns (2-3 consecutive words)
    for (let i = 0; i < refWords.length - 1; i++) {
        // Check for 2-word names
        if (refWords[i].length > 1 && refWords[i+1].length > 1) {
            nameSegments.push(`${refWords[i]} ${refWords[i+1]}`);
        }

        // Check for 3-word names if possible
        if (i < refWords.length - 2 && refWords[i].length > 1 &&
            refWords[i+1].length > 1 && refWords[i+2].length > 1) {
            nameSegments.push(`${refWords[i]} ${refWords[i+1]} ${refWords[i+2]}`);
        }
    }

    // Check for entity matches (names, etc.)
    for (const segment of nameSegments) {
        if (normalizedTarget.includes(segment)) {
            // Award high score for matching name entities
            return 0.90; // Very good match - found entity name
        }
    }

    // Word-level matching with position bonuses
    let totalWords = refWords.length;
    let matchedWords = 0;
    let positionBonus = 0;
    let lastPosition = -1;

    // Check each word from reference
    for (let i = 0; i < refWords.length; i++) {
        const word = refWords[i];

        // Skip very short words (unless they're numbers)
        if (word.length < 3 && !/^\d+$/.test(word)) continue;

        const targetWords = normalizedTarget.split(/\s+/).filter(Boolean);
        let bestPosition = -1;

        // Find this word in target
        for (let j = 0; j < targetWords.length; j++) {
            if (targetWords[j] === word ||
                targetWords[j].includes(word) ||
                word.includes(targetWords[j])) {
                bestPosition = j;
                break;
            }
        }

        if (bestPosition !== -1) {
            matchedWords++;

            // Bonus for words appearing in sequence
            if (lastPosition !== -1 && bestPosition > lastPosition) {
                positionBonus += 0.1; // Bonus for sequential words
            }

            lastPosition = bestPosition;
        }
    }

    // Calculate base containment score
    let matchRatio = totalWords > 0 ? matchedWords / totalWords : 0;

    // Boost score if we matched a significant portion of words
    if (matchRatio > 0.5) {
        matchRatio += positionBonus;

        // Additional boost for matching most words
        if (matchRatio > 0.7) {
            matchRatio += 0.1;
        }
    }

    // Cap at 0.85 - not as good as direct containment or entity match
    return Math.min(0.85, matchRatio);
}

/**
 * Smart comparison that combines multiple approaches for best results
 * Particularly useful for comparing jumbled text content from web pages
 * The "Smart all" approach prioritizes finding reference text contained within a larger target
 */
export function smartSimilarity(reference: string, target: string): number {
    // Explicitly handle empty reference case - empty references should match nothing
    if (!reference || reference.trim().length === 0) {
        return 0; // Empty reference shouldn't match anything
    }

    // Handle cases where both are empty
    if (!reference && !target) return 0;
    if (!target) return 0;

    // For very short inputs, prioritize exact matching
    if (reference.length < 5 || target.length < 5) {
        if (reference === target) return 1;
        if (target.includes(reference)) return 0.95;
        if (reference.includes(target)) return 0.9;
        return 0.5;
    }

    // Normalize for comparison
    const normalizedRef = reference.toLowerCase().trim();
    const normalizedTarget = target.toLowerCase().trim();

    // 1. Check for direct containment (highest priority)
    if (normalizedTarget.includes(normalizedRef)) {
        // Target fully contains reference - this is ideal
        return 0.95;
    }

    // 2. Calculate advanced containment score (most important)
    const containmentScore = containmentSimilarity(reference, target);

    // 3. Check for word-level overlap as backup
    const jaccardScore = jaccardSimilarity(reference, target);

    // 4. Only use Levenshtein for very close matches or short strings
    let levenshteinScore = 0;
    if (reference.length < 30 && target.length < 30) {
        levenshteinScore = levenshteinSimilarity(reference, target);
    }

    // Prioritize containment heavily
    if (containmentScore > 0.7) {
        // High containment - reference is mostly contained in target
        return Math.max(containmentScore, 0.7);
    } else if (jaccardScore > 0.6) {
        // Good word overlap - use a balanced approach favoring containment
        return Math.max((containmentScore * 0.7) + (jaccardScore * 0.3), 0.6);
    } else {
        // Lower match quality - still prioritize containment but consider other factors
        return (containmentScore * 0.7) + (jaccardScore * 0.2) + (levenshteinScore * 0.1);
    }
}

/**
 * Compare strings using the selected algorithm with improved logging
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

        // Log normalized strings for debugging if enabled
        if (logger && mergedOptions.debugMode) {
            logger.debug(`Comparing strings:
            - Original 1: "${str1?.substring(0, 50)}${str1?.length > 50 ? '...' : ''}"
            - Original 2: "${str2?.substring(0, 50)}${str2?.length > 50 ? '...' : ''}"
            - Normalized 1: "${normalizedStr1?.substring(0, 50)}${normalizedStr1?.length > 50 ? '...' : ''}"
            - Normalized 2: "${normalizedStr2?.substring(0, 50)}${normalizedStr2?.length > 50 ? '...' : ''}"`);
        }

        // Special case: both strings empty
        if (!normalizedStr1 && !normalizedStr2) return 0.5; // Changed - empty should partially match empty (neutral)

        // Special case: reference string empty - this is important for matching!
        if (!normalizedStr1) return 0; // If reference is empty, it shouldn't match anything

        // Special case: one string empty
        if (!normalizedStr2) return 0;

        // Apply selected algorithm
        let similarity = 0;
        switch (mergedOptions.algorithm) {
            case 'exact':
                similarity = normalizedStr1 === normalizedStr2 ? 1 : 0;
                break;

            case 'contains':
                // Check if either string contains the other, with higher score if target contains reference
                if (normalizedStr2.includes(normalizedStr1)) similarity = 0.9;
                else if (normalizedStr1.includes(normalizedStr2)) similarity = 0.7;
                else similarity = 0;
                break;

            case 'containment':
                // Use improved containment logic that's better at finding references in targets
                similarity = containmentSimilarity(normalizedStr1, normalizedStr2);
                break;

            case 'levenshtein':
                similarity = levenshteinSimilarity(normalizedStr1, normalizedStr2);
                break;

            case 'jaccard':
                similarity = jaccardSimilarity(normalizedStr1, normalizedStr2);
                break;

            case 'smart':
                // Use improved smart algorithm that's better at finding entities
                similarity = smartSimilarity(normalizedStr1, normalizedStr2);

                // Log additional details for smart algorithm if debugging
                if (logger && mergedOptions.debugMode) {
                    // Calculate individual scores for insight
                    const cScore = containmentSimilarity(normalizedStr1, normalizedStr2);
                    const jScore = jaccardSimilarity(normalizedStr1, normalizedStr2);
                    const lScore = levenshteinSimilarity(normalizedStr1, normalizedStr2);

                    logger.debug(`Smart similarity components:
                    - Containment: ${cScore.toFixed(4)}
                    - Jaccard: ${jScore.toFixed(4)}
                    - Levenshtein: ${lScore.toFixed(4)}`);
                }
                break;

            case 'custom':
                if (mergedOptions.customComparator) {
                    similarity = mergedOptions.customComparator(normalizedStr1, normalizedStr2);
                } else {
                    logger?.warn('Custom comparator not provided, falling back to Levenshtein');
                    similarity = levenshteinSimilarity(normalizedStr1, normalizedStr2);
                }
                break;

            default:
                logger?.warn(`Unknown comparison algorithm: ${mergedOptions.algorithm}, falling back to Levenshtein`);
                similarity = levenshteinSimilarity(normalizedStr1, normalizedStr2);
                break;
        }

        // Ensure similarity is a valid number between 0 and 1
        if (isNaN(similarity)) {
            logger?.warn('Similarity calculation returned NaN, defaulting to 0');
            similarity = 0;
        }

        // Clamp to valid range
        similarity = Math.max(0, Math.min(1, similarity));

        // Log result if debug is enabled
        if (logger && mergedOptions.debugMode) {
            logger.debug(`Similarity result (${mergedOptions.algorithm}): ${similarity.toFixed(4)}`);
        }

        return similarity;
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
 * Compare two entities across multiple fields with improved default handling
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

    // If no field configs provided, generate default ones from source entity fields
    if (!fieldConfigs || fieldConfigs.length === 0) {
        fieldConfigs = Object.keys(sourceEntity).map(field => ({
            field,
            weight: 1,
            algorithm: 'smart' as ComparisonAlgorithm,
            threshold: DEFAULT_COMPARISON_OPTIONS.threshold,
            mustMatch: false
        }));

        if (logger) {
            logger.debug(`No field configurations provided, generated ${fieldConfigs.length} default configs from source entity fields`);
        }
    }

    // Check for empty source fields and log a warning
    const emptyFields = Object.entries(sourceEntity)
        .filter(([_, value]) => !value || (typeof value === 'string' && value.trim() === ''))
        .map(([field]) => field);

    if (emptyFields.length > 0 && logger) {
        logger.debug(`Empty source fields detected: ${emptyFields.join(', ')}. These won't contribute positively to matches.`);
    }

    // If all fields are empty, we can't make a meaningful comparison
    const allFieldsEmpty = Object.keys(sourceEntity).length > 0 &&
                           Object.keys(sourceEntity).every(key =>
                               !sourceEntity[key] ||
                               (typeof sourceEntity[key] === 'string' &&
                                sourceEntity[key]!.trim() === ''));

    if (allFieldsEmpty) {
        if (logger) {
            logger.warn('All source fields are empty, can\'t perform meaningful comparison');
        }
        return {
            overallSimilarity: 0,
            fieldSimilarities: {},
            meetsThreshold: false,
            requiredFieldsMet: false
        };
    }

    // Process each field configuration
    for (const config of fieldConfigs) {
        const sourceValue = sourceEntity[config.field] || '';
        const targetValue = targetEntity[config.field] || '';

        // Skip fields with empty references unless they're required
        if ((!sourceValue || (typeof sourceValue === 'string' && sourceValue.trim() === ''))) {
            if (logger) {
                logger.debug(`Field "${config.field}" has empty reference value and won't contribute to matching.`);
            }

            // For empty required fields, default to 0 similarity
            if (config.mustMatch) {
                fieldSimilarities[config.field] = 0;
                requiredFieldsMet = false;

                if (logger) {
                    logger.warn(`Required field "${config.field}" has empty reference value and fails automatic matching`);
                }
            }

            continue;
        }

        // Check if we have a single criterion with a "smart" algorithm and all content
        // (This is our special case for whole record containment)
        const isSingleSmartField = fieldConfigs.length === 1 && config.algorithm === 'smart';
        const debugMode = config.weight > 0.8 || config.mustMatch || isSingleSmartField;

        // Create combined entity strings for better name matching when using smart algorithm
        let finalSourceValue = sourceValue;
        let finalTargetValue = targetValue;

        // Special handling for smart single-field case - concatenate all fields for richer comparison
        if (isSingleSmartField) {
            // Use all source and target fields concatenated for a holistic match
            finalSourceValue = Object.values(sourceEntity)
                .filter(v => v && typeof v === 'string' && v.trim() !== '')
                .join(' ');

            finalTargetValue = Object.values(targetEntity)
                .filter(v => v && typeof v === 'string' && v.trim() !== '')
                .join(' ');

            if (logger && debugMode) {
                logger.debug(`Using combined entity values for smart matching:
                - Source: ${finalSourceValue.substring(0, 50)}${finalSourceValue.length > 50 ? '...' : ''}
                - Target: ${finalTargetValue.substring(0, 50)}${finalTargetValue.length > 50 ? '...' : ''}`);
            }
        }

        // Use different algorithm weights for smart matching
        const algorithm = config.algorithm || 'smart';

        // For single criterion smart matching, we need to boost containment
        const comparisonOptions: Partial<IStringComparisonOptions> = {
            algorithm,
            threshold: config.threshold,
            customComparator: config.customComparator,
            debugMode
        };

        // For our smart algorithm, ensure we normalize properly
        if (algorithm === 'smart' || algorithm === 'containment') {
            comparisonOptions.normalization = {
                trimWhitespace: true,
                removeExtraSpaces: true,
                normalizeNewlines: true,
                toLowerCase: true,
                extractTextOnly: true
            };
        }

        const similarity = compareStrings(
            finalSourceValue,
            finalTargetValue,
            comparisonOptions,
            logger
        );

        fieldSimilarities[config.field] = similarity;

        if (config.mustMatch && !meetsThreshold(similarity, config.threshold)) {
            requiredFieldsMet = false;

            if (logger) {
                logger.debug(`Required field "${config.field}" with value "${sourceValue}" failed to match "${targetValue}" with similarity ${similarity.toFixed(4)} (needed ${config.threshold})`);
            }
        }

        totalWeight += config.weight;
        weightedSum += similarity * config.weight;
    }

    // Calculate overall similarity, ensuring we don't divide by zero
    const overallSimilarity = totalWeight > 0 ? weightedSum / totalWeight : 0;
    const thresholdValue = DEFAULT_COMPARISON_OPTIONS.threshold || 0.3;

    if (logger) {
        logger.debug(`Overall similarity: ${overallSimilarity.toFixed(4)} (threshold: ${thresholdValue}) - Required fields met: ${requiredFieldsMet}`);
    }

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
