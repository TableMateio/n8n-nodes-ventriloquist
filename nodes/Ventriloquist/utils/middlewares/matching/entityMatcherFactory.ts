import type { Logger as ILogger } from 'n8n-workflow';
import type { Page } from 'puppeteer-core';
import { type IEntityMatcher } from './entityMatcher';
import { type IFieldComparisonConfig } from '../../comparisonUtils';
import { getMiddlewareRegistry } from '../middlewareRegistry';
import {
    EntityMatcherExtractionMiddleware,
    EntityMatcherComparisonMiddleware,
    EntityMatcherActionMiddleware
} from './';
import { MiddlewareType } from '../middlewareRegistry';
import { type IMiddlewareContext } from '../middleware';
import {
    type IEntityMatcherExtractionInput,
    type IEntityMatcherComparisonInput,
    type IEntityMatcherActionInput,
    type IEntityMatcherOutput,
    type IEntityMatcherActionOutput
} from '../types/entityMatcherTypes';

/**
 * Interface for the entity matcher configuration
 */
export interface IEntityMatcherConfig {
    // Source entity data
    sourceEntity: Record<string, string | null | undefined>;
    normalizationOptions?: any;

    // Selectors for finding results
    resultsSelector: string;
    itemSelector: string;

    // Field extraction configuration
    fields: Array<any>;

    // Matching configuration
    fieldComparisons: IFieldComparisonConfig[];
    threshold: number;
    limitResults?: number;
    matchMode?: 'best' | 'all' | 'firstAboveThreshold';
    sortResults?: boolean;

    // Auto-detection
    autoDetectChildren?: boolean;

    // Action configuration
    action?: 'click' | 'extract' | 'none';
    actionSelector?: string;
    actionAttribute?: string;
    waitAfterAction?: boolean;
    waitTime?: number;
    waitSelector?: string;

    // Timing configuration
    waitForSelectors?: boolean;
    timeout?: number;

    // Additional configuration
    maxItems?: number;
    fieldSettings?: any[];

    // Output format
    outputFormat?: 'text' | 'html' | 'smart';
}

/**
 * Factory for creating entity matchers
 */
export class EntityMatcherFactory {
    /**
     * Create an entity matcher instance using the middleware pipeline approach
     */
    public static create(
        page: Page,
        config: any,
        context: {
            logger: ILogger,
            nodeName: string,
            nodeId: string,
            sessionId: string,
            index: number,
        }
    ): IEntityMatcher {
        const { logger, nodeName, nodeId, sessionId, index = 0 } = context;

        // Get middleware registry instance
        const registry = getMiddlewareRegistry();

        // Set logger for better debugging
        registry.setLogger(logger);

        // Create middleware instances
        const extractionMiddleware = new EntityMatcherExtractionMiddleware();
        const comparisonMiddleware = new EntityMatcherComparisonMiddleware();
        const actionMiddleware = new EntityMatcherActionMiddleware();

        // Register middlewares if not already registered
        try {
            registry.register({
                id: 'entityMatcherExtraction',
                type: MiddlewareType.ENTITY_MATCHER_EXTRACTION,
                name: 'entityMatcherExtraction',
                description: 'Extracts items from a webpage for entity matching',
                middleware: extractionMiddleware,
                version: 1,
            });

            registry.register({
                id: 'entityMatcherComparison',
                type: MiddlewareType.ENTITY_MATCHER_COMPARISON,
                name: 'entityMatcherComparison',
                description: 'Compares extracted items with a source entity',
                middleware: comparisonMiddleware,
                version: 1,
            });

            registry.register({
                id: 'entityMatcherAction',
                type: MiddlewareType.ENTITY_MATCHER_ACTION,
                name: 'entityMatcherAction',
                description: 'Performs actions on matched entities',
                middleware: actionMiddleware,
                version: 1,
            });
        } catch (error) {
            // Log the error but continue - middleware might already be registered
            logger.debug(`[EntityMatcherFactory] Error registering middleware: ${(error as Error).message}`);
        }

        // Return the entity matcher with execute method
        return {
            async execute(): Promise<IEntityMatcherOutput> {
                const middlewareContext: IMiddlewareContext = {
                    logger,
                    nodeName,
                    nodeId,
                    sessionId,
                    index,
                };

                try {
                    logger.info(`[EntityMatcherFactory] Starting entity matching process`);

                    // 1. Create extraction input
                    const extractionInput: IEntityMatcherExtractionInput = {
                        page,
                        extractionConfig: {
                            resultsSelector: config.resultsSelector,
                            itemSelector: config.itemSelector || '',
                            fields: config.fields || [],
                            waitForSelectors: config.waitForSelectors !== false,
                            timeout: config.timeout || 10000,
                            autoDetectChildren: config.autoDetectChildren === true,
                        }
                    };

                    // 2. Execute extraction
                    logger.info(`[EntityMatcherFactory] Executing extraction middleware`);
                    const extractionResult = await extractionMiddleware.execute(extractionInput, middlewareContext);

                    if (!extractionResult.success || extractionResult.items.length === 0) {
                        logger.warn(`[EntityMatcherFactory] Extraction failed or no items found: ${extractionResult.error || 'No items found'}`);
                        return {
                            success: false,
                            matches: [],
                            containerFound: extractionResult.containerFound || false,
                            itemsFound: extractionResult.itemsFound || 0,
                            error: extractionResult.error || 'No items found',
                            containerSelector: config.resultsSelector,
                            itemSelector: config.itemSelector || '(auto-detect)',
                        };
                    }

                    logger.info(`[EntityMatcherFactory] Extraction succeeded: Found ${extractionResult.items.length} items`);

                    // 3. Create comparison input
                    const comparisonInput: IEntityMatcherComparisonInput = {
                        sourceEntity: {
                            fields: config.sourceEntity,
                            normalizationOptions: config.normalizationOptions,
                        },
                        extractedItems: extractionResult.items,
                        comparisonConfig: {
                            fieldComparisons: config.fieldComparisons,
                            threshold: config.threshold,
                            limitResults: config.limitResults,
                            matchMode: config.matchMode,
                            sortResults: config.sortResults !== false,
                        }
                    };

                    // 4. Execute comparison
                    logger.info(`[EntityMatcherFactory] Executing comparison middleware`);
                    const comparisonResult = await comparisonMiddleware.execute(comparisonInput, middlewareContext);

                    if (!comparisonResult.success || comparisonResult.matches.length === 0) {
                        logger.warn(`[EntityMatcherFactory] Comparison failed or no matches found above threshold: ${comparisonResult.error || 'No matches found'}`);
                        return {
                            success: false,
                            matches: comparisonResult.matches || [],
                            containerFound: extractionResult.containerFound || false,
                            itemsFound: extractionResult.itemsFound || 0,
                            error: comparisonResult.error || 'No matches found above threshold',
                            containerSelector: config.resultsSelector,
                            itemSelector: config.itemSelector || '(auto-detect)',
                        };
                    }

                    logger.info(`[EntityMatcherFactory] Comparison succeeded: Found ${comparisonResult.matches.length} matches, selected: ${comparisonResult.selectedMatch ? 'Yes' : 'No'}`);

                    // 5. Execute action if we have a selected match and an action to perform
                    let actionResult = { success: false, actionPerformed: false } as IEntityMatcherActionOutput;

                    if (comparisonResult.selectedMatch && config.action && config.action !== 'none') {
                        // Create action input
                        const actionInput: IEntityMatcherActionInput = {
                            page,
                            selectedMatch: comparisonResult.selectedMatch,
                            actionConfig: {
                                action: config.action as 'click' | 'extract' | 'none',
                                actionSelector: config.actionSelector,
                                actionAttribute: config.actionAttribute,
                                waitAfterAction: config.waitAfterAction === true,
                                waitTime: config.waitTime,
                                waitSelector: config.waitSelector,
                            }
                        };

                        // Execute action
                        logger.info(`[EntityMatcherFactory] Executing action middleware: ${config.action}`);
                        actionResult = await actionMiddleware.execute(actionInput, middlewareContext);

                        logger.info(`[EntityMatcherFactory] Action ${actionResult.success ? 'succeeded' : 'failed'}: ${actionResult.actionPerformed ? 'Action performed' : 'No action performed'}`);
                    }

                    // 6. Return combined result
                    return {
                        success: true,
                        matches: comparisonResult.matches,
                        selectedMatch: comparisonResult.selectedMatch,
                        actionPerformed: actionResult.actionPerformed,
                        actionResult: actionResult.actionResult,
                        containerFound: extractionResult.containerFound,
                        itemsFound: extractionResult.itemsFound,
                        containerSelector: config.resultsSelector,
                        itemSelector: extractionResult.itemSelector,
                    };

                } catch (error) {
                    const errorMessage = (error as Error).message;
                    logger.error(`[EntityMatcherFactory] Error in entity matcher execution: ${errorMessage}`);

                    return {
                        success: false,
                        matches: [],
                        error: errorMessage,
                        containerSelector: config.resultsSelector,
                        itemSelector: config.itemSelector || '(auto-detect)',
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
    context: {
        logger: ILogger;
        nodeName: string;
        nodeId: string;
        sessionId: string;
        index?: number;
    }
): IEntityMatcher {
    return EntityMatcherFactory.create(page, config, {
        ...context,
        index: context.index || 0
    });
}
