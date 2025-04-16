import type { Page } from 'puppeteer-core';
import type { IFieldComparisonConfig } from '../../comparisonUtils';
import type { ITextNormalizationOptions } from '../../textUtils';
import type { IAdvancedTextNormalizationOptions } from '../../advancedTextUtils';

/**
 * Entity field configuration for extraction
 */
export interface IEntityField {
  name: string;
  selector: string;
  attribute?: string;
  weight: number;
  comparisonAlgorithm?: string;
  normalizationOptions?: Partial<IAdvancedTextNormalizationOptions>;
  required?: boolean;
  dataFormat?: 'text' | 'number' | 'date' | 'address' | 'boolean' | 'attribute';
}

/**
 * Source entity configuration
 */
export interface ISourceEntity {
  fields: Record<string, string | null | undefined>;
  normalizationOptions?: Partial<IAdvancedTextNormalizationOptions>;
}

/**
 * Entity matcher extraction configuration
 */
export interface IEntityMatcherExtractionConfig {
  resultsSelector: string;
  itemSelector: string;
  fields: IEntityField[];
  waitForSelectors?: boolean;
  timeout?: number;
  autoDetectChildren?: boolean;
}

/**
 * Entity matcher comparison configuration
 */
export interface IEntityMatcherComparisonConfig {
  fieldComparisons: IFieldComparisonConfig[];
  threshold: number;
  normalizationOptions?: ITextNormalizationOptions;
  limitResults?: number;
  matchMode?: 'best' | 'all' | 'firstAboveThreshold';
  sortResults?: boolean;
}

/**
 * Entity matcher action configuration
 */
export interface IEntityMatcherActionConfig {
  action: 'click' | 'extract' | 'none';
  actionSelector?: string;
  actionAttribute?: string;
  waitAfterAction?: boolean;
  waitTime?: number;
  waitSelector?: string;
}

/**
 * Entity matcher result details
 */
export interface IEntityMatchResult {
  index: number;
  element?: any;
  fields: Record<string, string>;
  similarities: Record<string, number>;
  overallSimilarity: number;
  selected: boolean;
}

/**
 * Entity matcher extracted field
 */
export interface IExtractedField {
  name: string;
  value: string;
  original: string;
  normalized: string;
  similarity?: number;
}

/**
 * Entity matcher extracted item
 */
export interface IExtractedItem {
  index: number;
  element: any;
  fields: Record<string, IExtractedField>;
  overallSimilarity?: number;
  selected?: boolean;
}

/**
 * Entity matcher input for extraction middleware
 */
export interface IEntityMatcherExtractionInput {
  page: Page;
  extractionConfig: IEntityMatcherExtractionConfig;
}

/**
 * Entity matcher output from extraction middleware
 */
export interface IEntityMatcherExtractionOutput {
  success: boolean;
  items: IExtractedItem[];
  error?: string;
  containerFound?: boolean;
  itemsFound?: number;
  containerSelector?: string;
  itemSelector?: string;
}

/**
 * Entity matcher input for comparison middleware
 */
export interface IEntityMatcherComparisonInput {
  sourceEntity: ISourceEntity;
  extractedItems: IExtractedItem[];
  comparisonConfig: IEntityMatcherComparisonConfig;
}

/**
 * Entity matcher output from comparison middleware
 */
export interface IEntityMatcherComparisonOutput {
  success: boolean;
  matches: IEntityMatchResult[];
  selectedMatch?: IEntityMatchResult;
  error?: string;
}

/**
 * Entity matcher input for action middleware
 */
export interface IEntityMatcherActionInput {
  page: Page;
  selectedMatch?: IEntityMatchResult;
  actionConfig: IEntityMatcherActionConfig;
}

/**
 * Entity matcher output from action middleware
 */
export interface IEntityMatcherActionOutput {
  success: boolean;
  actionPerformed: boolean;
  actionResult?: any;
  error?: string;
}

/**
 * Complete entity matcher input
 */
export interface IEntityMatcherInput {
  page: Page;
  sourceEntity: ISourceEntity;
  extractionConfig: IEntityMatcherExtractionConfig;
  comparisonConfig: IEntityMatcherComparisonConfig;
  actionConfig: IEntityMatcherActionConfig;
}

/**
 * Complete entity matcher output
 */
export interface IEntityMatcherOutput {
  success: boolean;
  matches: IEntityMatchResult[];
  selectedMatch?: IEntityMatchResult;
  actionPerformed?: boolean;
  actionResult?: any;
  error?: string;
  containerSelector?: string;
  itemSelector?: string;
  containerFound?: boolean;
  itemsFound?: number;
  totalExtracted?: number;
  containerHtml?: string;
  extractedItems?: IExtractedItem[];
}
