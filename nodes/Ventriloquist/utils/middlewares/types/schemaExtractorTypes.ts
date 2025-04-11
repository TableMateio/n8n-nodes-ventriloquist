import type { Page } from 'puppeteer-core';

/**
 * Schema field definition
 */
export interface ISchemaField {
  name: string;
  type: 'string' | 'number' | 'boolean' | 'date' | 'array' | 'object';
  description?: string;
  required?: boolean;
  example?: string;
  format?: string;
  enum?: string[];
  properties?: Record<string, ISchemaField>;
  items?: ISchemaField;
  default?: any;
}

/**
 * Schema definition for extraction
 */
export interface ISchema {
  title: string;
  description?: string;
  fields: Record<string, ISchemaField>;
  version?: string;
}

/**
 * AI Provider configuration
 */
export interface IAIProviderConfig {
  provider: 'openai' | 'local' | 'custom';
  model?: string;
  apiKey?: string;
  endpoint?: string;
  temperature?: number;
  maxTokens?: number;
  timeout?: number;
}

/**
 * Content extraction configuration
 */
export interface IContentExtractionConfig {
  selector?: string;
  attribute?: string;
  includeHtml?: boolean;
  extractionType: 'text' | 'html' | 'attribute' | 'fullPage';
  preprocessContent?: boolean;
  waitForSelector?: boolean;
  selectorTimeout?: number;
}

/**
 * Schema extraction configuration
 */
export interface ISchemaExtractionConfig {
  schema: ISchema;
  aiProvider: IAIProviderConfig;
  promptTemplate?: string;
  includeExamples?: boolean;
  fallbackToRules?: boolean;
  validateResults?: boolean;
}

/**
 * Validation rule for extracted schema data
 */
export interface IValidationRule {
  field: string;
  rule: 'required' | 'minLength' | 'maxLength' | 'pattern' | 'min' | 'max' | 'enum' | 'type' | 'custom';
  value?: any;
  message?: string;
  customValidator?: (value: any) => boolean;
}

/**
 * Validation configuration
 */
export interface IValidationConfig {
  rules: IValidationRule[];
  stopOnFirstError?: boolean;
  autoFix?: boolean;
}

/**
 * Schema extraction result field
 */
export interface IExtractedSchemaField {
  name: string;
  value: any;
  valid: boolean;
  error?: string;
}

/**
 * Schema extraction content input
 */
export interface ISchemaExtractorContentInput {
  page: Page;
  extractionConfig: IContentExtractionConfig;
}

/**
 * Schema extraction content output
 */
export interface ISchemaExtractorContentOutput {
  success: boolean;
  content?: string;
  html?: string;
  extractedFrom?: string;
  error?: string;
}

/**
 * Schema extraction AI input
 */
export interface ISchemaExtractorAIInput {
  content: string;
  schema: ISchema;
  aiConfig: IAIProviderConfig;
  promptTemplate?: string;
  includeExamples?: boolean;
}

/**
 * Schema extraction AI output
 */
export interface ISchemaExtractorAIOutput {
  success: boolean;
  extractedData?: Record<string, any>;
  rawResponse?: string;
  error?: string;
  usage?: {
    promptTokens: number;
    completionTokens: number;
    totalTokens: number;
  };
}

/**
 * Schema validation input
 */
export interface ISchemaValidationInput {
  extractedData: Record<string, any>;
  schema: ISchema;
  validationConfig?: IValidationConfig;
}

/**
 * Schema validation output
 */
export interface ISchemaValidationOutput {
  success: boolean;
  valid: boolean;
  validatedData: Record<string, any>;
  fields: Record<string, IExtractedSchemaField>;
  errors?: Record<string, string>;
}

/**
 * Complete schema extractor input
 */
export interface ISchemaExtractorInput {
  page: Page;
  contentExtractionConfig: IContentExtractionConfig;
  schemaExtractionConfig: ISchemaExtractionConfig;
  validationConfig?: IValidationConfig;
}

/**
 * Complete schema extractor output
 */
export interface ISchemaExtractorOutput {
  success: boolean;
  content?: {
    text?: string;
    html?: string;
    extractedFrom?: string;
  };
  extractedData?: Record<string, any>;
  validatedData?: Record<string, any>;
  valid?: boolean;
  errors?: Record<string, string>;
  aiUsage?: {
    promptTokens: number;
    completionTokens: number;
    totalTokens: number;
  };
  error?: string;
}
