// Export middleware base interfaces
export * from './middleware';

// Export middleware registry
export * from './middlewareRegistry';

// Export middleware registration utilities - selectively to avoid conflicts
// with the same names exported from middlewareRegistry
export {
  registerMiddleware,
  unregisterMiddleware,
  createMiddlewarePipeline
} from './middlewareRegistration';

// Export middleware type definitions
export * from './types';

// Re-export extraction middleware
export * from './extraction';

// Selective import from matching to avoid name conflicts
import { createEntityMatcher } from './matching/entityMatcherFactory';
export { createEntityMatcher };

// TODO: Add action middleware exports once implemented
// export * from './actions';

// TODO: Add fallback middleware exports once implemented
// export * from './fallback';
