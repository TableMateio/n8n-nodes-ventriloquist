import { ITextNormalizationOptions, normalizeText } from './textUtils';

/**
 * Advanced text normalization options
 */
export interface IAdvancedTextNormalizationOptions extends ITextNormalizationOptions {
  removeCommonWords?: boolean;
  removeStopWords?: boolean;
  stemWords?: boolean;
  extractKeyPhrases?: boolean;
  synonymReplacement?: boolean;
  synonymMap?: Record<string, string[]>;
  extractHtmlText?: boolean;
  dataType?: 'text' | 'number' | 'date' | 'address' | 'boolean';
  dateFormat?: string;
  locale?: string;
}

/**
 * Common English stop words to filter out
 */
const STOP_WORDS = new Set([
  'a', 'an', 'and', 'are', 'as', 'at', 'be', 'but', 'by', 'for', 'if', 'in',
  'into', 'is', 'it', 'no', 'not', 'of', 'on', 'or', 'such', 'that', 'the',
  'their', 'then', 'there', 'these', 'they', 'this', 'to', 'was', 'will', 'with'
]);

/**
 * Advanced text normalization for better comparison
 */
export function advancedNormalizeText(
  text: string,
  options: Partial<IAdvancedTextNormalizationOptions> = {}
): string {
  // First apply basic normalization
  let normalized = normalizeText(text, options);

  // Extract text from HTML if needed
  if (options.extractHtmlText) {
    normalized = extractTextFromHtml(normalized);
  }

  // Handle specific data types
  if (options.dataType) {
    switch (options.dataType) {
      case 'number':
        return normalizeNumber(normalized);
      case 'date':
        return normalizeDate(normalized, options.dateFormat, options.locale);
      case 'address':
        return normalizeAddress(normalized);
      case 'boolean':
        return normalizeBoolean(normalized);
      default:
        // Continue with text normalization
        break;
    }
  }

  // Split into words for advanced processing
  let words = normalized.split(/\s+/);

  // Remove stop words if enabled
  if (options.removeStopWords) {
    words = words.filter(word => !STOP_WORDS.has(word.toLowerCase()));
  }

  // Apply stemming (simple implementation)
  if (options.stemWords) {
    words = words.map(simpleStem);
  }

  // Synonym replacement if enabled
  if (options.synonymReplacement && options.synonymMap) {
    words = words.map(word => {
      const synonyms = options.synonymMap?.[word.toLowerCase()];
      return synonyms && synonyms.length > 0 ? synonyms[0] : word;
    });
  }

  return words.join(' ');
}

/**
 * Normalize a number string by removing non-numeric characters except decimal point
 */
export function normalizeNumber(text: string): string {
  if (!text) return '';

  // Extract first number from text
  const match = text.match(/-?[\d,.]+(e[-+]?\d+)?/i);
  if (!match) return '';

  // Clean up the number format - keep only digits, decimal point, and optional negative sign
  let cleanNumber = match[0].replace(/[^\d.-]/g, '');

  // Handle multiple decimal points (keep only the first one)
  const parts = cleanNumber.split('.');
  if (parts.length > 2) {
    cleanNumber = parts[0] + '.' + parts.slice(1).join('');
  }

  return cleanNumber;
}

/**
 * Normalize a date string to ISO format where possible
 */
export function normalizeDate(text: string, format?: string, locale: string = 'en-US'): string {
  if (!text) return '';

  try {
    // Try to create a date object from the text
    const dateObj = new Date(text);

    // Check if date is valid
    if (!isNaN(dateObj.getTime())) {
      // Return ISO format by default
      return dateObj.toISOString().split('T')[0];
    }

    // If we have a specified format, try to parse using that
    // This would require a date-fns or similar library for advanced formatting

    // Fallback: just return cleaned text
    return text.replace(/[^\d/\-.:\s]/g, '');
  } catch (e) {
    // If any error, return the original text
    return text;
  }
}

/**
 * Normalize an address string
 */
export function normalizeAddress(text: string): string {
  if (!text) return '';

  // Basic normalization
  let normalized = normalizeText(text, {
    lowercase: true,
    trimWhitespace: true,
    removeExtraSpaces: true,
  });

  // Replace common abbreviations
  const replacements: [RegExp, string][] = [
    [/\bst\b/g, 'street'],
    [/\brd\b/g, 'road'],
    [/\bave\b/g, 'avenue'],
    [/\bblvd\b/g, 'boulevard'],
    [/\bln\b/g, 'lane'],
    [/\bct\b/g, 'court'],
    [/\bapt\b/g, 'apartment'],
    [/\bste\b/g, 'suite'],
    [/\bunit\b/g, 'unit'],
    [/\bn\b/g, 'north'],
    [/\bs\b/g, 'south'],
    [/\be\b/g, 'east'],
    [/\bw\b/g, 'west'],
  ];

  for (const [pattern, replacement] of replacements) {
    normalized = normalized.replace(pattern, replacement);
  }

  return normalized;
}

/**
 * Normalize a boolean value
 */
export function normalizeBoolean(text: string): string {
  if (!text) return 'false';

  const normalized = text.toLowerCase().trim();

  // True values
  if (
    normalized === 'true' ||
    normalized === 'yes' ||
    normalized === 'y' ||
    normalized === '1' ||
    normalized === 'on' ||
    normalized === 'checked'
  ) {
    return 'true';
  }

  // False values
  return 'false';
}

/**
 * Very simple stemming function (for demonstration)
 * A proper implementation would use a library like snowball or porter stemmer
 */
function simpleStem(word: string): string {
  const lowerWord = word.toLowerCase();

  // Simple suffix removal
  if (lowerWord.endsWith('ing')) return lowerWord.slice(0, -3);
  if (lowerWord.endsWith('ed')) return lowerWord.slice(0, -2);
  if (lowerWord.endsWith('s') && !lowerWord.endsWith('ss')) return lowerWord.slice(0, -1);
  if (lowerWord.endsWith('ly')) return lowerWord.slice(0, -2);
  if (lowerWord.endsWith('ment')) return lowerWord.slice(0, -4);

  return lowerWord;
}

/**
 * Extract key phrases from text
 * This is a very simple implementation that just counts word frequency
 */
export function extractKeyPhrases(text: string, maxPhrases = 5): string[] {
  // Normalize and split the text
  const normalized = normalizeText(text, {
    lowercase: true,
    trimWhitespace: true,
    removeExtraSpaces: true
  });

  const words = normalized.split(/\s+/).filter(word =>
    word.length > 3 && !STOP_WORDS.has(word.toLowerCase())
  );

  // Count word frequency
  const wordCounts: Record<string, number> = {};
  for (const word of words) {
    wordCounts[word] = (wordCounts[word] || 0) + 1;
  }

  // Sort by frequency and return top phrases
  return Object.entries(wordCounts)
    .sort((a, b) => b[1] - a[1])
    .slice(0, maxPhrases)
    .map(([word]) => word);
}

/**
 * Calculate text readability score (Flesch-Kincaid)
 */
export function calculateReadabilityScore(text: string): number {
  // Normalize the text
  const normalized = normalizeText(text, {
    normalizeNewlines: true,
    removeExtraSpaces: true
  });

  // Count sentences, words, and syllables
  const sentences = normalized.split(/[.!?]+/).filter(Boolean).length;
  const words = normalized.split(/\s+/).filter(Boolean).length;
  const syllables = countSyllables(normalized);

  if (words === 0 || sentences === 0) return 0;

  // Flesch-Kincaid formula
  return 206.835 - (1.015 * (words / sentences)) - (84.6 * (syllables / words));
}

/**
 * Count syllables in text (approximate)
 */
function countSyllables(text: string): number {
  // This is a very rough approximation
  const words = text.toLowerCase().split(/\s+/);
  let count = 0;

  for (const word of words) {
    // Count vowel groupings as syllables
    const vowelGroups = word.match(/[aeiouy]+/g) || [];
    count += vowelGroups.length;

    // Subtract for silent 'e' at the end
    if (word.endsWith('e') && word.length > 2) {
      count -= 1;
    }

    // Ensure at least one syllable per word
    if (count === 0) count = 1;
  }

  return count;
}

/**
 * Extract readable text from HTML content
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
