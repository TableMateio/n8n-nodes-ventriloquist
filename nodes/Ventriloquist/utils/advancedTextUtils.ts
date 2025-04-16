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
