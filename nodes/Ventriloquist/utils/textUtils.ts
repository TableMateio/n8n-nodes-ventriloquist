import type { Logger as ILogger } from 'n8n-workflow';

/**
 * Text normalization options
 */
export interface ITextNormalizationOptions {
  lowercase?: boolean;
  trimWhitespace?: boolean;
  removeExtraSpaces?: boolean;
  removePunctuation?: boolean;
  removeSpecialChars?: boolean;
  removeAccents?: boolean;
  removeDiacritics?: boolean;
  normalizeAddresses?: boolean;
}

/**
 * Default normalization options
 */
const DEFAULT_NORMALIZATION_OPTIONS: ITextNormalizationOptions = {
  lowercase: true,
  trimWhitespace: true,
  removeExtraSpaces: true,
  removePunctuation: false,
  removeSpecialChars: false,
  removeAccents: false,
  removeDiacritics: false,
  normalizeAddresses: false,
};

/**
 * Normalize text for comparison
 */
export function normalizeText(
  text: string,
  options: ITextNormalizationOptions = DEFAULT_NORMALIZATION_OPTIONS,
  logger?: ILogger,
): string {
  if (!text) {
    return '';
  }

  try {
    let normalized = text;

    // Convert to lowercase
    if (options.lowercase) {
      normalized = normalized.toLowerCase();
    }

    // Trim whitespace
    if (options.trimWhitespace) {
      normalized = normalized.trim();
    }

    // Remove extra spaces
    if (options.removeExtraSpaces) {
      normalized = normalized.replace(/\s+/g, ' ');
    }

    // Remove punctuation
    if (options.removePunctuation) {
      normalized = normalized.replace(/[.,\/#!$%\^&\*;:{}=\-_`~()]/g, '');
    }

    // Remove special characters
    if (options.removeSpecialChars) {
      normalized = normalized.replace(/[^\w\s]/gi, '');
    }

    // Remove accents/diacritics
    if (options.removeAccents || options.removeDiacritics) {
      normalized = normalized.normalize('NFD').replace(/[\u0300-\u036f]/g, '');
    }

    // Normalize address format
    if (options.normalizeAddresses) {
      // Replace common address abbreviations
      const addressReplacements: Record<string, string> = {
        'st\\.': 'street',
        'st\\b': 'street',
        'rd\\.': 'road',
        'rd\\b': 'road',
        'ave\\.': 'avenue',
        'ave\\b': 'avenue',
        'blvd\\.': 'boulevard',
        'blvd\\b': 'boulevard',
        'apt\\.': 'apartment',
        'apt\\b': 'apartment',
        'ste\\.': 'suite',
        'ste\\b': 'suite',
        '#': 'number',
      };

      // Apply all replacements
      Object.entries(addressReplacements).forEach(([pattern, replacement]) => {
        const regex = new RegExp(pattern, 'gi');
        normalized = normalized.replace(regex, replacement);
      });
    }

    return normalized;
  } catch (error) {
    if (logger) {
      logger.error(`[TextUtils] Error normalizing text: ${(error as Error).message}`);
    }
    return text; // Return original text on error
  }
}

/**
 * Combine fields into a single string for comparison
 */
export function combineFields(
  fields: Record<string, string | undefined | null>,
  separator: string = ' ',
  options: ITextNormalizationOptions = DEFAULT_NORMALIZATION_OPTIONS,
): string {
  // Filter out empty/null/undefined values and join with separator
  const combined = Object.values(fields)
    .filter(Boolean)
    .join(separator);

  // Normalize the combined text
  return normalizeText(combined, options);
}

/**
 * Format a name for comparison (first, middle, last)
 */
export function formatPersonName(
  firstName?: string | null,
  middleName?: string | null,
  lastName?: string | null,
  options: ITextNormalizationOptions = DEFAULT_NORMALIZATION_OPTIONS,
): string {
  return combineFields(
    { firstName, middleName, lastName },
    ' ',
    options
  );
}

/**
 * Format an address for comparison
 */
export function formatAddress(
  street?: string | null,
  city?: string | null,
  state?: string | null,
  zip?: string | null,
  options: ITextNormalizationOptions = { ...DEFAULT_NORMALIZATION_OPTIONS, normalizeAddresses: true },
): string {
  return combineFields(
    { street, city, state, zip },
    ', ',
    options
  );
}
