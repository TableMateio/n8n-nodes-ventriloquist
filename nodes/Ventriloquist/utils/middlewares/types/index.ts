// Export entity matcher types
export * from './entityMatcherTypes';

// Export schema extractor types
export * from './schemaExtractorTypes';

// Common middleware types
export interface IMiddlewareConfig {
  id: string;
  type: string;
  [key: string]: any;
}

// Re-export middleware registry types
export { MiddlewareType } from '../middlewareRegistry';
