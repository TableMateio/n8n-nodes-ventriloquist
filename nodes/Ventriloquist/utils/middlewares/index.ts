// Export middleware base interfaces
export * from './middleware';

// Export middleware registry
export * from './middlewareRegistry';

// Export middleware type definitions
export * from './types';

// Re-export extraction middleware
export * from './extraction';

// Selective import and export from matching to avoid name conflicts
import {
    createEntityMatcher,
    EntityMatcherExtractionMiddleware,
    EntityMatcherComparisonMiddleware,
    EntityMatcherActionMiddleware,
    createEntityMatcherExtractionMiddleware,
    createEntityMatcherExtractionMiddlewareRegistration,
    createEntityMatcherComparisonMiddlewareRegistration,
    createEntityMatcherActionMiddlewareRegistration
} from './matching';

export {
    createEntityMatcher,
    EntityMatcherExtractionMiddleware,
    EntityMatcherComparisonMiddleware,
    EntityMatcherActionMiddleware,
    createEntityMatcherExtractionMiddleware,
    createEntityMatcherExtractionMiddlewareRegistration,
    createEntityMatcherComparisonMiddlewareRegistration,
    createEntityMatcherActionMiddlewareRegistration
};

// TODO: Add action middleware exports once implemented
// export * from './actions';

// TODO: Add fallback middleware exports once implemented
// export * from './fallback';
