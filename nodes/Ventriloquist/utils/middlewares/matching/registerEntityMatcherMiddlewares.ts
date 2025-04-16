import { initializeMiddlewareRegistry, MiddlewareType } from '../middlewareRegistration';
import { EntityMatcherExtractionMiddleware } from './entityMatcherExtractionMiddleware';
import { EntityMatcherComparisonMiddleware } from './entityMatcherComparisonMiddleware';
import { EntityMatcherActionMiddleware } from './entityMatcherActionMiddleware';
import {
    type IEntityMatcherExtractionInput,
    type IEntityMatcherExtractionOutput,
    type IEntityMatcherComparisonInput,
    type IEntityMatcherComparisonOutput,
    type IEntityMatcherActionInput,
    type IEntityMatcherActionOutput
} from '../types/entityMatcherTypes';

/**
 * Register all entity matcher middlewares with the middleware registry
 */
export function registerEntityMatcherMiddlewares(): void {
    const registry = initializeMiddlewareRegistry();

    // Register extraction middleware
    registry.register<IEntityMatcherExtractionInput, IEntityMatcherExtractionOutput>(
        'entityMatcherExtraction',
        MiddlewareType.EXTRACTION,
        new EntityMatcherExtractionMiddleware(),
        'Extracts entities from web page elements'
    );

    // Register comparison middleware
    registry.register<IEntityMatcherComparisonInput, IEntityMatcherComparisonOutput>(
        'entityMatcherComparison',
        MiddlewareType.COMPARISON,
        new EntityMatcherComparisonMiddleware(),
        'Compares entities to find best matches'
    );

    // Register action middleware
    registry.register<IEntityMatcherActionInput, IEntityMatcherActionOutput>(
        'entityMatcherAction',
        MiddlewareType.ACTION,
        new EntityMatcherActionMiddleware(),
        'Performs actions on matched entities'
    );
}

/**
 * Initialize the entity matcher subsystem
 * This should be called early in the application lifecycle
 */
export function initializeEntityMatcher(): void {
    // Register all middlewares
    registerEntityMatcherMiddlewares();
}
