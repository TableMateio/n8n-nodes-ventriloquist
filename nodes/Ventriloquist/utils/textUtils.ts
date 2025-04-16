/**
 * Text normalization options
 */
export interface ITextNormalizationOptions {
  lowercase?: boolean;
  trimWhitespace?: boolean;
  removeExtraSpaces?: boolean;
  normalizeNewlines?: boolean;
  removePunctuation?: boolean;
  removeSpecialChars?: boolean;
}

/**
 * Default text normalization options
 */
export const DEFAULT_TEXT_NORMALIZATION_OPTIONS: ITextNormalizationOptions = {
  lowercase: true,
  trimWhitespace: true,
  removeExtraSpaces: true,
  normalizeNewlines: true,
  removePunctuation: false,
  removeSpecialChars: false,
};

/**
 * Normalize text for better comparison and display
 */
export function normalizeText(
  text: string,
  options: Partial<ITextNormalizationOptions> = DEFAULT_TEXT_NORMALIZATION_OPTIONS
): string {
  if (!text) return '';

  const mergedOptions = { ...DEFAULT_TEXT_NORMALIZATION_OPTIONS, ...options };
  let normalized = text;

  if (mergedOptions.trimWhitespace) {
    normalized = normalized.trim();
  }

  if (mergedOptions.normalizeNewlines) {
    normalized = normalized.replace(/\n+/g, '\n');
  }

  if (mergedOptions.removeExtraSpaces) {
    normalized = normalized.replace(/\s+/g, ' ');
  }

  if (mergedOptions.removePunctuation) {
    normalized = normalized.replace(/[.,\/#!$%\^&\*;:{}=\-_`~()]/g, '');
  }

  if (mergedOptions.removeSpecialChars) {
    normalized = normalized.replace(/[^\w\s]/g, '');
  }

  if (mergedOptions.lowercase) {
    normalized = normalized.toLowerCase();
  }

  return normalized;
}

/**
 * Format a person's name for better matching
 */
export function formatPersonName(name: string): string {
  if (!name) return '';

  // Normalize the name
  const normalized = normalizeText(name, {
    lowercase: true,
    trimWhitespace: true,
    removeExtraSpaces: true,
  });

  // Split into words
  const parts = normalized.split(/\s+/);

  // Handle special cases
  if (parts.length === 1) return parts[0];

  // Remove common titles/prefixes/suffixes for better matching
  const filteredParts = parts.filter(part =>
    !['mr', 'mrs', 'ms', 'miss', 'dr', 'prof', 'jr', 'sr', 'esq', 'phd', 'md'].includes(part)
  );

  return filteredParts.join(' ');
}

/**
 * Format an address for better matching
 */
export function formatAddress(address: string): string {
  if (!address) return '';

  // Normalize the address
  let normalized = normalizeText(address, {
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
 * Extracts a pattern from text using regex
 */
export function extractWithPattern(text: string, pattern: RegExp | string): string | null {
  if (!text) return null;

  const regex = typeof pattern === 'string' ? new RegExp(pattern) : pattern;
  const match = text.match(regex);

  return match ? match[0] : null;
}

/**
 * Extracts all matches of a pattern from text
 */
export function extractAllWithPattern(text: string, pattern: RegExp | string): string[] {
  if (!text) return [];

  const regex = typeof pattern === 'string' ? new RegExp(pattern, 'g') : new RegExp(pattern.source, pattern.flags + (pattern.flags.includes('g') ? '' : 'g'));
  const matches = text.match(regex);

  return matches || [];
}
