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
    selector?: string; // Added to support target-specific element selection within items
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
    if (!html || typeof html !== 'string') return '';

    // Quick check if this is likely HTML or just plain text
    const containsHtml = /<[a-z][\s\S]*>/i.test(html);

    // If it's already clean text without HTML, just do whitespace normalization
    if (!containsHtml) {
        return normalizeWhitespace(html);
    }

    // STEP 1: Aggressively remove all invisible/embedded elements with their content
    let text = html;

    // Remove iframes completely - this is crucial
    text = text.replace(/<iframe\b[^<]*(?:(?!<\/iframe>)<[^<]*)*<\/iframe>/gi, '');

    // Remove all other non-visible elements
    const nonVisibleTags = [
        'script', 'style', 'meta', 'link', 'embed', 'object',
        'canvas', 'applet', 'noscript', 'svg', 'template',
        'command', 'keygen', 'source', 'param', 'track',
        'head', 'frame', 'frameset', 'video', 'audio'
    ];

    // Remove each tag type
    nonVisibleTags.forEach(tag => {
        const regex = new RegExp(`<${tag}\\b[^<]*(?:(?!<\\/${tag}>)<[^<]*)*<\\/${tag}>`, 'gi');
        text = text.replace(regex, '');
    });

    // STEP 2: Replace common structural elements with newlines
    const blockElements = [
        'div', 'p', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6',
        'ul', 'ol', 'li', 'table', 'tr', 'pre', 'blockquote',
        'header', 'footer', 'section', 'article', 'aside',
        'nav', 'form', 'fieldset', 'figure', 'figcaption',
        'details', 'summary', 'dd', 'dt'
    ];

    blockElements.forEach(tag => {
        const openRegex = new RegExp(`<${tag}[^>]*>`, 'gi');
        const closeRegex = new RegExp(`<\\/${tag}>`, 'gi');
        text = text.replace(openRegex, '\n');
        text = text.replace(closeRegex, '\n');
    });

    // STEP 3: Handle line breaks
    text = text.replace(/<br[^>]*>/gi, '\n');
    text = text.replace(/<hr[^>]*>/gi, '\n');

    // STEP 4: Remove ALL remaining HTML tags (including unclosed tags and attributes)
    text = text.replace(/<[^>]*>/g, '');

    // STEP 5: Decode HTML entities (comprehensive list)
    const htmlEntities: Record<string, string> = {
        '&nbsp;': ' ',
        '&amp;': '&',
        '&lt;': '<',
        '&gt;': '>',
        '&quot;': '"',
        '&#39;': "'",
        '&apos;': "'",
        '&mdash;': '—',
        '&ndash;': '–',
        '&hellip;': '...',
        '&lsquo;': "'",
        '&rsquo;': "'",
        '&ldquo;': '"',
        '&rdquo;': '"',
        '&bull;': '•',
        '&copy;': '©',
        '&reg;': '®',
        '&trade;': '™',
        '&cent;': '¢',
        '&pound;': '£',
        '&euro;': '€',
        '&yen;': '¥',
        '&deg;': '°',
        '&sect;': '§',
        '&para;': '¶',
        '&dagger;': '†',
        '&Dagger;': '‡',
        '&permil;': '‰',
        '&laquo;': '«',
        '&raquo;': '»',
        '&times;': '×',
        '&divide;': '÷',
        '&plusmn;': '±',
        '&micro;': 'µ',
        '&middot;': '·',
        '&frac14;': '¼',
        '&frac12;': '½',
        '&frac34;': '¾',
        '&prime;': '′',
        '&Prime;': '″',
        '&mu;': 'μ',
        '&pi;': 'π'
    };

    // Replace common entities
    Object.entries(htmlEntities).forEach(([entity, replacement]) => {
        text = text.replace(new RegExp(entity, 'g'), replacement);
    });

    // More comprehensive entity decoding for numeric entities
    text = text.replace(/&#(\d+);/g, (match, dec) => String.fromCharCode(parseInt(dec, 10)));
    text = text.replace(/&#[xX]([A-Fa-f0-9]+);/g, (match, hex) => String.fromCharCode(parseInt(hex, 16)));

    // STEP 6: Apply unified whitespace normalization
    return normalizeWhitespace(text);
}

/**
 * Apply consistent whitespace normalization rules
 * This is extracted to a separate function to ensure consistency
 */
function normalizeWhitespace(text: string): string {
    if (!text) return '';

    // Convert all whitespace characters to standard spaces or newlines
    let cleaned = text;

    // Convert tabs to spaces
    cleaned = cleaned.replace(/\t+/g, ' ');

    // Normalize Windows and Mac line breaks to Unix style
    cleaned = cleaned.replace(/\r\n?/g, '\n');

    // Replace consecutive spaces with a single space
    cleaned = cleaned.replace(/[ \xA0]+/g, ' ');

    // Remove any spaces before or after newlines
    cleaned = cleaned.replace(/ *\n */g, '\n');

    // Process lines individually
    const lines = cleaned.split('\n');
    const filteredLines: string[] = [];

    for (const line of lines) {
        const trimmedLine = line.trim();
        if (trimmedLine.length > 0) {
            filteredLines.push(trimmedLine);
        }
    }

    // Join non-empty lines with a single newline
    cleaned = filteredLines.join('\n');

    // Replace multiple consecutive newlines with a maximum of two (for paragraph breaks)
    cleaned = cleaned.replace(/\n{3,}/g, '\n\n');

    // Trim leading and trailing whitespace
    cleaned = cleaned.trim();

    // Final check for any remaining multiple spaces that might have been introduced
    cleaned = cleaned.replace(/[ ]{2,}/g, ' ');

    return cleaned;
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
 * Calculate information richness score - measures how much valuable data is in a string
 * This helps differentiate between similar matches by favoring the one with more information
 */
export function calculateInformationRichness(text: string): number {
    if (!text || typeof text !== 'string') return 0;

    const normalizedText = text.toLowerCase().trim();
    if (normalizedText.length === 0) return 0;

    // Calculate metrics that indicate rich information
    const metrics = {
        // Length is a basic indicator of more information
        length: Math.min(1, normalizedText.length / 500),

        // Count distinct numeric sequences (IDs, phone numbers, etc.)
        numericValues: 0,

        // Count potential identifiers (alphanumeric sequences that could be IDs)
        identifiers: 0,

        // Count field labels that indicate structured data
        dataLabels: 0,

        // Measure information density (ratio of unique words to total words)
        uniqueWordRatio: 0
    };

    // Extract words for analysis
    const words = normalizedText.split(/\s+/).filter(Boolean);
    const uniqueWords = new Set(words);

    // Calculate unique word ratio (information density)
    metrics.uniqueWordRatio = words.length > 0 ? uniqueWords.size / words.length : 0;

    // Count numeric sequences (like dates, IDs, etc.)
    const numericMatches = normalizedText.match(/\d+/g) || [];
    metrics.numericValues = Math.min(1, numericMatches.length / 10);

    // Count potential data labels (field names followed by data)
    const labelMatches = normalizedText.match(/\b(id|name|phone|address|email|ssn|dob|age|date|number|identifier)[\s\:]+/gi) || [];
    metrics.dataLabels = Math.min(1, labelMatches.length / 5);

    // Count alphanumeric identifiers (like "p239872868")
    const identifierMatches = normalizedText.match(/\b[a-z0-9]{6,}\b/gi) || [];
    metrics.identifiers = Math.min(1, identifierMatches.length / 3);

    // Calculate overall richness score with weights
    const richness =
        (metrics.length * 0.2) +
        (metrics.numericValues * 0.25) +
        (metrics.dataLabels * 0.25) +
        (metrics.identifiers * 0.15) +
        (metrics.uniqueWordRatio * 0.15);

    return Math.min(1, richness);
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

    // Extract potential key identifiers from reference (proper nouns, identifiers, etc.)
    const refWords = normalizedRef.split(/\s+/).filter(Boolean);
    const keySegments: string[] = [];

    // Look for potential key patterns (consecutive words, especially with capital letters)
    for (let i = 0; i < refWords.length - 1; i++) {
        // Check for 2-word combinations
        if (refWords[i].length > 1 && refWords[i+1].length > 1) {
            keySegments.push(`${refWords[i]} ${refWords[i+1]}`);
        }

        // Check for 3-word combinations if possible
        if (i < refWords.length - 2 && refWords[i].length > 1 &&
            refWords[i+1].length > 1 && refWords[i+2].length > 1) {
            keySegments.push(`${refWords[i]} ${refWords[i+1]} ${refWords[i+2]}`);
        }
    }

    // Special handling for numeric values - match them exactly
    const refNumerics = normalizedRef.match(/\d+/g) || [];

    // Check for key segment matches
    for (const segment of keySegments) {
        if (normalizedTarget.includes(segment)) {
            // Award high score for matching key segments
            return 0.9; // Very good match - found key segment
        }
    }

    // Check exact numeric matches
    let numericMatches = 0;
    for (const num of refNumerics) {
        // Only consider numbers longer than 3 digits as significant
        if (num.length > 3 && normalizedTarget.includes(num)) {
            numericMatches++;
        }
    }

    // If we found significant numeric matches, increase score
    if (numericMatches > 0 && refNumerics.length > 0) {
        const numericMatchRatio = numericMatches / refNumerics.length;
        if (numericMatchRatio > 0.5) {
            return 0.85; // Good match - found significant numeric identifiers
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

    // Cap at 0.85 - not as good as direct containment or segment match
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
        // Add a small richness bonus to differentiate between similar matches
        const richness = calculateInformationRichness(target);
        return 0.95 + (richness * 0.05); // Between 0.95 and 1.0 based on richness
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

    // 5. Calculate information richness to break ties between similar items
    const richness = calculateInformationRichness(target);

    // Base score from our standard algorithms
    let baseScore = 0;

    // Prioritize containment heavily
    if (containmentScore > 0.7) {
        // High containment - reference is mostly contained in target
        baseScore = Math.max(containmentScore, 0.7);
    } else if (jaccardScore > 0.6) {
        // Good word overlap - use a balanced approach favoring containment
        baseScore = Math.max((containmentScore * 0.7) + (jaccardScore * 0.3), 0.6);
    } else {
        // Lower match quality - still prioritize containment but consider other factors
        baseScore = (containmentScore * 0.7) + (jaccardScore * 0.2) + (levenshteinScore * 0.1);
    }

    // Add a small richness bonus to differentiate between similar matches
    // This will add 0-0.05 to the score based on information richness
    return Math.min(1, baseScore + (richness * 0.05));
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
