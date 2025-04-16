/**
 * Common extraction patterns for various types of data
 * Used for extracting structured information from unstructured text
 */

/**
 * Email patterns
 */
export const EMAIL_PATTERN = /\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/i;

/**
 * Phone number patterns
 */
export const PHONE_PATTERN = /(?:\+\d{1,3}[\s.-]?)?\(?\d{3}\)?[\s.-]?\d{3}[\s.-]?\d{4}/;

/**
 * URL patterns
 */
export const URL_PATTERN = /https?:\/\/(?:www\.)?[-a-zA-Z0-9@:%._\+~#=]{1,256}\.[a-zA-Z0-9()]{1,6}\b(?:[-a-zA-Z0-9()@:%_\+.~#?&\/=]*)/;

/**
 * US Address patterns
 */
export const US_ADDRESS_PATTERN = /\d+\s+([a-zA-Z]+\s){1,}\s*(?:st(?:\.|reet)?|rd|road|ave(?:\.|nue)?|avenue|dr(?:\.|ive)?|drive|blvd|boulevard|ln|lane|court|ct|way|parkway|pkwy|circle|cir|plaza|plz|square|sq|highway|hwy|route|rt)\s+(?:[a-zA-Z]+\s*)+,\s*(?:[a-zA-Z]+\s*)+,\s*(?:[a-zA-Z]+\s*)+\s+\d{5}(?:-\d{4})?/i;

/**
 * Date patterns (various formats)
 */
export const DATE_PATTERN = /(?:\d{1,2}[-\/]\d{1,2}[-\/]\d{2,4})|(?:(?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)[a-z]*[\s.-]?\d{1,2}[\s,.-]?\d{2,4})/i;

/**
 * Currency patterns
 */
export const CURRENCY_PATTERN = /(?:[\$\€\£\¥]\s?[0-9,]+(?:\.\d{2})?)|(?:[0-9,]+(?:\.\d{2})?\s?(?:USD|EUR|GBP|JPY))/;

/**
 * Extract a pattern from text
 */
export function extractWithPattern(text: string, pattern: RegExp): string | null {
  if (!text) return null;

  const match = text.match(pattern);
  return match ? match[0] : null;
}

/**
 * Extract all matches of a pattern from text
 */
export function extractAllWithPattern(text: string, pattern: RegExp): string[] {
  if (!text) return [];

  const globalPattern = new RegExp(pattern.source, pattern.flags.includes('g') ? pattern.flags : pattern.flags + 'g');
  const matches = text.match(globalPattern);

  return matches || [];
}

/**
 * Extract email addresses from text
 */
export function extractEmails(text: string): string[] {
  return extractAllWithPattern(text, EMAIL_PATTERN);
}

/**
 * Extract phone numbers from text
 */
export function extractPhoneNumbers(text: string): string[] {
  return extractAllWithPattern(text, PHONE_PATTERN);
}

/**
 * Extract URLs from text
 */
export function extractUrls(text: string): string[] {
  return extractAllWithPattern(text, URL_PATTERN);
}

/**
 * Extract dates from text
 */
export function extractDates(text: string): string[] {
  return extractAllWithPattern(text, DATE_PATTERN);
}

/**
 * Extract currency values from text
 */
export function extractCurrencyValues(text: string): string[] {
  return extractAllWithPattern(text, CURRENCY_PATTERN);
}
