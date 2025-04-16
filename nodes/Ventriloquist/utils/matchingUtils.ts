// Re-export text normalization utilities
export * from './textUtils';

// Re-export advanced text normalization utilities
export * from './advancedTextUtils';

// Re-export comparison utilities
export * from './comparisonUtils';

// Re-export extraction patterns - select specific patterns to avoid duplicate exports
// with textUtils.ts which has similar extraction functions
export {
  EMAIL_PATTERN,
  PHONE_PATTERN,
  URL_PATTERN,
  US_ADDRESS_PATTERN,
  DATE_PATTERN,
  CURRENCY_PATTERN,
  // Export utility functions with specific names to avoid conflicts
  extractEmails,
  extractPhoneNumbers,
  extractUrls,
  extractDates,
  extractCurrencyValues
} from './extractionPatterns';

// Re-export entity matching middleware and factory
export * from './middlewares/matching';

// Re-export extraction middleware and factory
export * from './middlewares/extraction';
