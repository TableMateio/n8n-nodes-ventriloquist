import type { Logger as ILogger } from 'n8n-workflow';

/**
 * Pattern type definitions
 */
export type PatternType = 'name' | 'address' | 'phone' | 'email' | 'date' | 'ssn' | 'money' | 'custom';

/**
 * Pattern definition interface
 */
export interface IPatternDefinition {
  name: string;
  type: PatternType;
  description: string;
  regex: RegExp;
  formatOutput?: (match: RegExpMatchArray) => string | Record<string, string | number>;
}

/**
 * Pattern library containing common extraction patterns
 */
export const extractionPatterns: Record<string, IPatternDefinition> = {
  // Name patterns
  fullName: {
    name: 'fullName',
    type: 'name',
    description: 'Extract full name in "First Middle Last" format',
    regex: /([A-Z][a-z]+)(?:\s+([A-Z][a-z]+))?\s+([A-Z][a-z]+)/,
    formatOutput: (match) => ({
      firstName: match[1] || '',
      middleName: match[2] || '',
      lastName: match[3] || '',
    }),
  },

  // Address patterns
  usAddress: {
    name: 'usAddress',
    type: 'address',
    description: 'Extract US address with street, city, state, zip',
    regex: /([0-9]+\s+[A-Za-z\s]+(?:Street|St|Avenue|Ave|Road|Rd|Boulevard|Blvd|Drive|Dr|Lane|Ln|Place|Pl|Court|Ct|Way|Terrace|Ter))(?:\s*(?:Apt|Suite|Unit|#)\s*([A-Za-z0-9]+))?,?\s*([A-Za-z\s]+),\s*([A-Z]{2})\s*(\d{5}(?:-\d{4})?)/i,
    formatOutput: (match) => ({
      street: `${match[1]}${match[2] ? ` ${match[2]}` : ''}`,
      city: match[3] || '',
      state: match[4] || '',
      zip: match[5] || '',
    }),
  },

  // Phone number patterns
  usPhone: {
    name: 'usPhone',
    type: 'phone',
    description: 'Extract US phone number in various formats',
    regex: /(?:\+1-?)?(?:\(\d{3}\)|\d{3})[-\s.]?\d{3}[-\s.]?\d{4}/,
    formatOutput: (match) => {
      // Normalize to ###-###-#### format
      const digits = match[0].replace(/\D/g, '');
      const normalizedPhone = digits.replace(/^1?(\d{3})(\d{3})(\d{4})$/, '$1-$2-$3');
      return normalizedPhone;
    },
  },

  // Email patterns
  email: {
    name: 'email',
    type: 'email',
    description: 'Extract email address',
    regex: /[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/,
  },

  // Date patterns
  usDate: {
    name: 'usDate',
    type: 'date',
    description: 'Extract date in MM/DD/YYYY format',
    regex: /(\d{1,2})\/(\d{1,2})\/(\d{4})/,
    formatOutput: (match) => {
      const month = match[1].padStart(2, '0');
      const day = match[2].padStart(2, '0');
      const year = match[3];
      return `${year}-${month}-${day}`; // ISO format
    },
  },

  // SSN patterns
  ssn: {
    name: 'ssn',
    type: 'ssn',
    description: 'Extract Social Security Number',
    regex: /\b(?:\d{3}-\d{2}-\d{4}|\d{9})\b/,
    formatOutput: (match) => {
      // Normalize to ###-##-#### format
      const digits = match[0].replace(/\D/g, '');
      return digits.replace(/^(\d{3})(\d{2})(\d{4})$/, '$1-$2-$3');
    },
  },

  // Money patterns
  usMoney: {
    name: 'usMoney',
    type: 'money',
    description: 'Extract US currency amount',
    regex: /\$\s?([0-9,]+(?:\.[0-9]{2})?)/,
    formatOutput: (match) => {
      // Convert to numeric value and return as a string or in an object
      const value = parseFloat(match[1].replace(/,/g, ''));
      return { amount: value, currency: 'USD' };
    },
  },
};

/**
 * Extract data using a pattern
 */
export function extractWithPattern(
  text: string,
  patternKey: string,
  logger?: ILogger
): string | Record<string, string | number> | null {
  try {
    const pattern = extractionPatterns[patternKey];
    if (!pattern) {
      throw new Error(`Pattern '${patternKey}' not found in pattern library`);
    }

    const match = text.match(pattern.regex);
    if (!match) {
      return null; // No match found
    }

    // Format the output if a formatter exists
    if (pattern.formatOutput) {
      return pattern.formatOutput(match);
    }

    // Return the first match group, or the entire match if no groups
    return match[1] || match[0];
  } catch (error) {
    if (logger) {
      logger.error(`[ExtractionPatterns] Error extracting with pattern '${patternKey}': ${(error as Error).message}`);
    }
    return null;
  }
}

/**
 * Extract all occurrences of a pattern
 */
export function extractAllWithPattern(
  text: string,
  patternKey: string,
  logger?: ILogger
): Array<string | Record<string, string | number>> {
  try {
    const pattern = extractionPatterns[patternKey];
    if (!pattern) {
      throw new Error(`Pattern '${patternKey}' not found in pattern library`);
    }

    const regex = new RegExp(pattern.regex, 'g');
    const matches = Array.from(text.matchAll(regex));

    if (!matches.length) {
      return []; // No matches found
    }

    // Format each match with the output formatter if it exists
    return matches.map(match => {
      if (pattern.formatOutput) {
        return pattern.formatOutput(match);
      }
      return match[1] || match[0];
    });
  } catch (error) {
    if (logger) {
      logger.error(`[ExtractionPatterns] Error extracting all with pattern '${patternKey}': ${(error as Error).message}`);
    }
    return [];
  }
}

/**
 * Add a custom pattern to the pattern library
 */
export function addCustomPattern(
  key: string,
  pattern: IPatternDefinition,
  logger?: ILogger
): boolean {
  try {
    if (extractionPatterns[key]) {
      throw new Error(`Pattern with key '${key}' already exists`);
    }

    extractionPatterns[key] = {
      ...pattern,
      type: pattern.type || 'custom',
    };

    return true;
  } catch (error) {
    if (logger) {
      logger.error(`[ExtractionPatterns] Error adding custom pattern '${key}': ${(error as Error).message}`);
    }
    return false;
  }
}
