import type { Logger as ILogger } from 'n8n-workflow';
import { normalizeText, type ITextNormalizationOptions } from './textUtils';

/**
 * Advanced text normalization options
 */
export interface IAdvancedTextNormalizationOptions extends ITextNormalizationOptions {
  normalizeCompanyNames?: boolean;
  normalizeProductIdentifiers?: boolean;
  applyMultilingualNormalization?: boolean;
  languageCode?: string;
  prepareForAI?: boolean;
}

/**
 * Default advanced normalization options
 */
export const DEFAULT_ADVANCED_NORMALIZATION_OPTIONS: IAdvancedTextNormalizationOptions = {
  lowercase: true,
  trimWhitespace: true,
  removeExtraSpaces: true,
  removePunctuation: false,
  removeSpecialChars: false,
  removeAccents: false,
  removeDiacritics: false,
  normalizeAddresses: false,
  normalizeCompanyNames: false,
  normalizeProductIdentifiers: false,
  applyMultilingualNormalization: false,
  prepareForAI: false,
};

/**
 * Company name suffix patterns to standardize
 */
const COMPANY_SUFFIX_PATTERNS: Record<string, string> = {
  // US and international business entities
  'incorporated': 'inc',
  'inc\\.?': 'inc',
  'corporation': 'corp',
  'corp\\.?': 'corp',
  'company': 'co',
  'co\\.?': 'co',
  'limited': 'ltd',
  'ltd\\.?': 'ltd',
  'llc': 'llc',
  'l\\.?l\\.?c\\.?': 'llc',
  'lp': 'lp',
  'l\\.?p\\.?': 'lp',
  'llp': 'llp',
  'l\\.?l\\.?p\\.?': 'llp',
  'partnership': 'ptnrs',
  'ptnrs\\.?': 'ptnrs',
  'p\\.?c\\.?': 'pc',
  'professional corporation': 'pc',
  'gmbh': 'gmbh',
  'g\\.?m\\.?b\\.?h\\.?': 'gmbh',
  's\\.?a\\.?': 'sa',
  'sociedad an[oó]nima': 'sa',
  's\\.?a\\.?r\\.?l\\.?': 'sarl',
  'societe a responsabilite limitee': 'sarl',
  'pty': 'pty',
  'pty\\.? ltd\\.?': 'pty ltd',
  'proprietary limited': 'pty ltd',
  // Add more company suffixes as needed
};

/**
 * Common business words to standardize
 */
const BUSINESS_TERMS: Record<string, string> = {
  '&': 'and',
  'intl': 'international',
  'international': 'international',
  'global': 'global',
  'world': 'world',
  'worldwide': 'worldwide',
  'holdings': 'holdings',
  'holding': 'holdings',
  'group': 'group',
  'enterprise': 'enterprise',
  'enterprises': 'enterprises',
  'technology': 'technology',
  'technologies': 'technologies',
  'tech': 'tech',
  'solutions': 'solutions',
  'services': 'services',
  'systems': 'systems',
  // Add more business terms as needed
};

/**
 * Normalize company name
 * Standardizes suffixes and common terms
 */
export function normalizeCompanyName(
  companyName: string | null | undefined,
  options: Partial<IAdvancedTextNormalizationOptions> = {},
  logger?: ILogger,
): string {
  if (!companyName) {
    return '';
  }

  try {
    // First apply basic normalization
    const mergedOptions = {
      ...DEFAULT_ADVANCED_NORMALIZATION_OPTIONS,
      ...options,
    };

    let normalizedName = normalizeText(companyName, mergedOptions, logger);

    if (mergedOptions.normalizeCompanyNames) {
      // Standardize company suffixes
      Object.entries(COMPANY_SUFFIX_PATTERNS).forEach(([pattern, replacement]) => {
        const regex = new RegExp(`\\b${pattern}\\b`, 'gi');
        normalizedName = normalizedName.replace(regex, replacement);
      });

      // Standardize business terms
      Object.entries(BUSINESS_TERMS).forEach(([term, replacement]) => {
        const regex = new RegExp(`\\b${term}\\b`, 'gi');
        normalizedName = normalizedName.replace(regex, replacement);
      });

      // Remove common filler words (the, of, etc.)
      const fillerWords = ['the', 'of', 'for', 'a', 'an'];
      fillerWords.forEach(word => {
        const regex = new RegExp(`\\b${word}\\b`, 'gi');
        normalizedName = normalizedName.replace(regex, '');
      });

      // Clean up multiple spaces again after replacements
      normalizedName = normalizedName.replace(/\s+/g, ' ').trim();
    }

    return normalizedName;
  } catch (error) {
    if (logger) {
      logger.error(`[AdvancedTextUtils] Error normalizing company name: ${(error as Error).message}`);
    }
    return companyName || '';
  }
}

/**
 * Common product identifier patterns
 */
const PRODUCT_IDENTIFIER_PATTERNS: Record<string, RegExp> = {
  upc: /\b\d{12}\b/,
  ean13: /\b\d{13}\b/,
  isbn10: /\b\d{9}[\dX]\b/,
  isbn13: /\b978\d{10}\b/,
  asin: /\b[A-Z0-9]{10}\b/,
  sku: /\b[A-Z0-9]{6,14}\b/,
  model: /\b[A-Z]{1,5}[-_]?[A-Z0-9]{2,10}\b/i,
};

/**
 * Normalize product identifier
 */
export function normalizeProductIdentifier(
  identifier: string | null | undefined,
  identifierType?: 'upc' | 'ean' | 'isbn' | 'asin' | 'sku' | 'model' | 'auto',
  options: Partial<IAdvancedTextNormalizationOptions> = {},
  logger?: ILogger,
): string {
  if (!identifier) {
    return '';
  }

  try {
    // Basic cleaning, but maintain case for certain ID types
    const normalized = identifier.trim().replace(/\s+/g, '');

    if (!options.normalizeProductIdentifiers) {
      return normalized;
    }

    // If type is specified, apply specific normalization rules
    switch (identifierType) {
      case 'upc':
      case 'ean':
        // Numeric only, fixed length
        return normalized.replace(/\D/g, '');

      case 'isbn':
        // Allow X at end for ISBN-10
        return normalized.replace(/[^0-9X]/g, '');

      case 'asin':
        // Uppercase alphanumeric
        return normalized.toUpperCase();

      case 'sku':
      case 'model':
        // Generally preserve case, remove special chars
        return normalized.replace(/[^A-Za-z0-9-_]/g, '');

      case 'auto':
        // Try to detect the type and apply rules
        for (const [type, pattern] of Object.entries(PRODUCT_IDENTIFIER_PATTERNS)) {
          if (pattern.test(normalized)) {
            return normalizeProductIdentifier(normalized, type as any, options, logger);
          }
        }
        return normalized;

      default:
        // If no specific type, just do basic cleaning
        return normalized;
    }
  } catch (error) {
    if (logger) {
      logger.error(`[AdvancedTextUtils] Error normalizing product identifier: ${(error as Error).message}`);
    }
    return identifier || '';
  }
}

/**
 * Multilingual normalization map for specific languages
 * Maps language codes to their normalization rules
 */
const MULTILINGUAL_NORMALIZATION: Record<string, (text: string) => string> = {
  // German
  de: (text: string) => {
    return text
      .replace(/[äÄ]/g, 'ae')
      .replace(/[öÖ]/g, 'oe')
      .replace(/[üÜ]/g, 'ue')
      .replace(/ß/g, 'ss');
  },

  // Spanish
  es: (text: string) => {
    return text
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '') // Remove diacritics
      .replace(/ñ/g, 'n')
      .replace(/Ñ/g, 'N');
  },

  // French
  fr: (text: string) => {
    return text
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '') // Remove diacritics
      .replace(/œ/g, 'oe')
      .replace(/æ/g, 'ae')
      .replace(/ç/g, 'c');
  },

  // Add more languages as needed
};

/**
 * Apply language-specific normalization
 */
export function normalizeMultilingualText(
  text: string | null | undefined,
  languageCode: string = 'en',
  options: Partial<IAdvancedTextNormalizationOptions> = {},
  logger?: ILogger,
): string {
  if (!text) {
    return '';
  }

  try {
    // First apply basic normalization
    const mergedOptions = {
      ...DEFAULT_ADVANCED_NORMALIZATION_OPTIONS,
      ...options,
    };

    let normalizedText = normalizeText(text, mergedOptions, logger);

    // Apply language-specific normalizations if enabled
    if (mergedOptions.applyMultilingualNormalization && languageCode !== 'en') {
      const languageNormalizer = MULTILINGUAL_NORMALIZATION[languageCode.toLowerCase()];
      if (languageNormalizer) {
        normalizedText = languageNormalizer(normalizedText);
      } else if (logger) {
        logger.warn(`[AdvancedTextUtils] No multilingual normalization defined for language code: ${languageCode}`);
      }
    }

    return normalizedText;
  } catch (error) {
    if (logger) {
      logger.error(`[AdvancedTextUtils] Error in multilingual normalization: ${(error as Error).message}`);
    }
    return text || '';
  }
}

/**
 * Prepare text for AI processing
 * This does minimal normalization while preserving semantic information
 */
export function prepareTextForAI(
  text: string | null | undefined,
  options: Partial<IAdvancedTextNormalizationOptions> = {},
  logger?: ILogger,
): string {
  if (!text) {
    return '';
  }

  try {
    // For AI, we want to do minimal normalization to preserve meaning
    const aiPreparationOptions: ITextNormalizationOptions = {
      lowercase: false, // Preserve case for entity recognition
      trimWhitespace: true,
      removeExtraSpaces: true,
      removePunctuation: false, // Keep punctuation for sentence structure
      removeSpecialChars: false, // Keep special chars
      removeAccents: false, // Keep accents/diacritics
      removeDiacritics: false,
      normalizeAddresses: false,
    };

    // Allow overriding the default AI preparation options
    const mergedOptions = {
      ...aiPreparationOptions,
      ...options,
    };

    let preparedText = normalizeText(text, mergedOptions, logger);

    // Ensure the text ends with proper punctuation for better AI understanding
    if (mergedOptions.prepareForAI && !preparedText.match(/[.!?]$/)) {
      const lastChar = preparedText.slice(-1);
      if (lastChar !== '.' && lastChar !== '!' && lastChar !== '?') {
        preparedText += '.';
      }
    }

    return preparedText;
  } catch (error) {
    if (logger) {
      logger.error(`[AdvancedTextUtils] Error preparing text for AI: ${(error as Error).message}`);
    }
    return text || '';
  }
}

/**
 * Combine multiple fields with advanced normalization
 */
export function combineFieldsAdvanced(
  fields: Record<string, string | undefined | null>,
  separator: string = ' ',
  options: Partial<IAdvancedTextNormalizationOptions> = {},
  logger?: ILogger,
): string {
  try {
    // Filter out empty/null/undefined values and join with separator
    const combined = Object.entries(fields)
      .filter(([_, value]) => Boolean(value))
      .map(([key, value]) => {
        // Apply specialized normalization based on field name
        if (key.toLowerCase().includes('company') && options.normalizeCompanyNames) {
          return normalizeCompanyName(value, options, logger);
        }
        if ((key.toLowerCase().includes('product') || key.toLowerCase().includes('id')) && options.normalizeProductIdentifiers) {
          return normalizeProductIdentifier(value, 'auto', options, logger);
        }
        if (options.applyMultilingualNormalization) {
          return normalizeMultilingualText(value, options.languageCode, options, logger);
        }
        // Default normalization
        return normalizeText(value || '', options, logger);
      })
      .join(separator);

    return combined;
  } catch (error) {
    if (logger) {
      logger.error(`[AdvancedTextUtils] Error combining fields: ${(error as Error).message}`);
    }
    return '';
  }
}

/**
 * Format industry-specific identifiers like product codes, model numbers, etc.
 */
export function formatIndustryIdentifier(
  identifier: string | null | undefined,
  format: 'sku' | 'model' | 'part' | 'custom',
  customPattern?: string,
  logger?: ILogger,
): string {
  if (!identifier) {
    return '';
  }

  try {
    const cleaned = identifier.replace(/\s+/g, '');

    switch (format) {
      case 'sku':
        // Typically alphanumeric, uppercase
        return cleaned.toUpperCase();

      case 'model':
        // Often includes hyphens, preserve case
        return cleaned;

      case 'part':
        // Part numbers often have specific formatting
        return cleaned.toUpperCase().replace(/[^A-Z0-9-]/g, '');

      case 'custom':
        if (customPattern) {
          // Allow custom regex pattern to format the identifier
          const matches = cleaned.match(new RegExp(customPattern));
          if (matches && matches.length > 0) {
            return matches[0];
          }
        }
        return cleaned;

      default:
        return cleaned;
    }
  } catch (error) {
    if (logger) {
      logger.error(`[AdvancedTextUtils] Error formatting industry identifier: ${(error as Error).message}`);
    }
    return identifier || '';
  }
}
