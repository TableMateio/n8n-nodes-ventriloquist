import type { Page } from 'puppeteer-core';
import type { Logger as ILogger } from 'n8n-workflow';
import { createPipeline, type IMiddlewareContext } from '../middleware';
import {
    type IEntityMatcherInput,
    type IEntityMatcherOutput,
    type IEntityMatcherExtractionInput,
    type IEntityMatcherComparisonInput,
    type IEntityMatcherActionInput
} from '../types/entityMatcherTypes';
import { initializeMiddlewareRegistry } from '../middlewareRegistration';
import { type IEntityMatcher } from './entityMatcher';
import { type IFieldComparisonConfig } from '../../comparisonUtils';
import { EntityMatcherExtractionMiddleware } from './entityMatcherExtractionMiddleware';
import { EntityMatcherComparisonMiddleware } from './entityMatcherComparisonMiddleware';
import { EntityMatcherActionMiddleware } from './entityMatcherActionMiddleware';

/**
 * Configuration for creating an entity matcher instance
 */
export interface IEntityMatcherConfig {
    // Source entity data
    sourceEntityFields: Record<string, string | null | undefined>;

    // Selectors and containers
    resultsSelector: string;
    itemSelector: string;
    waitForSelectors?: boolean;
    timeout?: number;
    autoDetectChildren?: boolean;

    // Field extraction configuration
    fields: Array<{
        name: string;
        selector: string;
        attribute?: string;
        weight: number;
        required?: boolean;
        dataFormat?: 'text' | 'number' | 'date' | 'address' | 'boolean' | 'attribute';
    }>;

    // Matching configuration
    threshold: number;
    matchMode?: 'best' | 'all' | 'firstAboveThreshold';
    limitResults?: number;
    maxItemsToProcess?: number;

    // Action configuration
    action?: 'click' | 'extract' | 'none';
    actionSelector?: string;
    actionAttribute?: string;
    waitAfterAction?: boolean;
    waitTime?: number;
    waitSelector?: string;
}

/**
 * Interface for entity matcher
 */
export interface IEntityMatcher {
    /**
     * Execute the entity matcher
     */
    execute(): Promise<IEntityMatcherOutput>;
}

/**
 * Factory for creating entity matchers
 */
export class EntityMatcherFactory {
    /**
     * Create an entity matcher instance
     */
    public static create(
        page: Page,
        config: IEntityMatcherConfig,
        context: IMiddlewareContext
    ): IEntityMatcher {
        // Initialize middleware registry and get registered middlewares
        const registry = initializeMiddlewareRegistry();

        // Extract extraction middleware (handle null case gracefully)
        const extractionMiddleware = registry.get<IEntityMatcherExtractionInput, any>('entityMatcherExtraction');
        if (!extractionMiddleware) {
            throw new Error('Entity matcher extraction middleware not registered');
        }

        // Extract comparison middleware (handle null case gracefully)
        const comparisonMiddleware = registry.get<IEntityMatcherComparisonInput, any>('entityMatcherComparison');
        if (!comparisonMiddleware) {
            throw new Error('Entity matcher comparison middleware not registered');
        }

        // Extract action middleware (handle null case gracefully)
        const actionMiddleware = registry.get<IEntityMatcherActionInput, any>('entityMatcherAction');
        if (!actionMiddleware) {
            throw new Error('Entity matcher action middleware not registered');
        }

        // Create pipeline
        const pipeline = createPipeline<IEntityMatcherInput, IEntityMatcherOutput>()
            .use(extractionMiddleware)
            .use(comparisonMiddleware)
            .use(actionMiddleware)
            .before(async (input, context) => {
                context.logger.debug(`Starting entity matcher with ${config.fields.length} fields, ` +
                    `results selector: ${config.resultsSelector}, item selector: ${config.itemSelector}`);
            })
            .after(async (result, context) => {
                context.logger.debug(`Entity matcher completed with ${result.matches.length} matches, ` +
                    `selected match: ${result.selectedMatch ? 'yes' : 'no'}, ` +
                    `action performed: ${result.actionPerformed ? 'yes' : 'no'}`);
            })
            .catch(async (error, ctx) => {
                ctx.logger.error(`Entity matcher error: ${error.message}`);
                return {
                    success: false,
                    matches: [],
                    error: error.message
                };
            });

        // Map config to input structure
        const input: IEntityMatcherInput = {
            page,
            sourceEntity: {
                fields: config.sourceEntityFields
            },
            extractionConfig: {
                resultsSelector: config.resultsSelector,
                itemSelector: config.itemSelector,
                fields: config.fields.map(field => ({
                    name: field.name,
                    selector: field.selector,
                    attribute: field.attribute,
                    weight: field.weight,
                    required: field.required,
                    dataFormat: field.dataFormat
                })),
                waitForSelectors: config.waitForSelectors,
                timeout: config.timeout,
                autoDetectChildren: config.autoDetectChildren
            },
            comparisonConfig: {
                fieldComparisons: config.fields.map(field => ({
                    field: field.name,
                    weight: field.weight,
                    algorithm: 'smart',
                    threshold: config.threshold,
                    mustMatch: field.required
                })),
                threshold: config.threshold,
                limitResults: config.limitResults,
                matchMode: config.matchMode || 'best'
            },
            actionConfig: {
                action: config.action || 'none',
                actionSelector: config.actionSelector,
                actionAttribute: config.actionAttribute,
                waitAfterAction: config.waitAfterAction,
                waitTime: config.waitTime,
                waitSelector: config.waitSelector
            }
        };

        return {
            execute: async (): Promise<IEntityMatcherOutput> => {
                try {
                    // Apply max items limit if specified
                    if (config.maxItemsToProcess && config.maxItemsToProcess > 0) {
                        context.logger.debug(`Limiting to ${config.maxItemsToProcess} items for processing`);
                        input.extractionConfig.maxItems = config.maxItemsToProcess;
                    }

                    // Execute the pipeline
                    return await pipeline.execute(input, context);
                } catch (error) {
                    context.logger.error(`Entity matcher execution error: ${(error as Error).message}`);
                    return {
                        success: false,
                        matches: [],
                        error: (error as Error).message
                    };
                }
            }
        };
    }
}

/**
 * Helper function to create an entity matcher
 */
export function createEntityMatcher(
    page: Page,
    config: IEntityMatcherConfig,
    context: IMiddlewareContext
): IEntityMatcher {
    return EntityMatcherFactory.create(page, config, context);
}
