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
    type IEntityMatcherActionOutput,
    type IEntityMatchResult
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

    // Performance options
    performanceMode?: 'balanced' | 'speed' | 'accuracy';
    debugMode?: boolean;
}

/**
 * Sanitize the entity matcher output by removing element handles
 * that can't be properly serialized to JSON
 */
function sanitizeOutput(output: IEntityMatcherOutput): IEntityMatcherOutput {
    // Create a deep copy of the output
    const sanitized = { ...output };

    // Sanitize matches
    if (sanitized.matches && Array.isArray(sanitized.matches)) {
        sanitized.matches = sanitized.matches.map(match => {
            const { element, ...rest } = match;
            return { ...rest };
        });
    }

    // Sanitize selectedMatch
    if (sanitized.selectedMatch) {
        const { element, ...rest } = sanitized.selectedMatch;
        sanitized.selectedMatch = { ...rest };
    }

    return sanitized;
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

        // Log configuration details for debugging
        if (config.debugMode) {
            logger.info(`[EntityMatcherFactory] Configuration: ${JSON.stringify({
                resultsSelector: config.resultsSelector,
                itemSelector: config.itemSelector || '(auto-detect)',
                fieldCount: config.fields?.length || 0,
                comparisonCount: config.fieldComparisons?.length || 0,
                threshold: config.threshold,
                matchMode: config.matchMode || 'best',
                maxItems: config.maxItems,
                performanceMode: config.performanceMode || 'balanced'
            })}`);
        }

        // Return the entity matcher with execute method
        return {
            async execute(): Promise<IEntityMatcherOutput> {
                const startTime = Date.now();
                const middlewareContext: IMiddlewareContext = {
                    logger,
                    nodeName,
                    nodeId,
                    sessionId,
                    index,
                };

                try {
                    logger.info(`[EntityMatcherFactory] Starting entity matching process`);

                    // Check if source entity has valid fields
                    if (!config.sourceEntity || Object.keys(config.sourceEntity).length === 0) {
                        logger.warn(`[EntityMatcherFactory] Source entity is empty or missing`);
                        return sanitizeOutput({
                            success: false,
                            matches: [],
                            error: 'Source entity is empty or missing. Please provide reference values to match against.',
                            referenceValues: {},
                            threshold: config.threshold,
                            timings: {
                                total: Date.now() - startTime
                            }
                        });
                    }

                    // Check for empty source fields and log a warning
                    const emptyFields = Object.entries(config.sourceEntity)
                        .filter(([_, value]) => !value || (typeof value === 'string' && value.trim() === ''))
                        .map(([field]) => field);

                    if (emptyFields.length > 0) {
                        if (emptyFields.length === Object.keys(config.sourceEntity).length) {
                            logger.warn(`[EntityMatcherFactory] All source entity fields are empty`);
                            return sanitizeOutput({
                                success: false,
                                matches: [],
                                error: 'All source entity fields are empty. Please provide at least one non-empty reference value to match against.',
                                referenceValues: config.sourceEntity,
                                threshold: config.threshold,
                                timings: {
                                    total: Date.now() - startTime
                                }
                            });
                        } else {
                            logger.warn(`[EntityMatcherFactory] Some source entity fields are empty: ${emptyFields.join(', ')}`);
                        }
                    }

                    // 1. Create extraction input with maxItems limit
                    const extractionInput: IEntityMatcherExtractionInput = {
                        page,
                        extractionConfig: {
                            resultsSelector: config.resultsSelector,
                            itemSelector: config.itemSelector || '',
                            fields: config.fields || [],
                            waitForSelectors: config.waitForSelectors !== false,
                            timeout: config.timeout || 10000,
                            autoDetectChildren: config.autoDetectChildren === true,
                            maxItems: config.maxItems || 0 // Apply item limit at extraction phase
                        }
                    };

                    // Performance optimizations based on performance mode
                    if (config.performanceMode === 'speed') {
                        // Optimize for speed
                        extractionInput.extractionConfig.timeout = extractionInput.extractionConfig.timeout !== undefined
                            ? Math.min(extractionInput.extractionConfig.timeout, 5000)
                            : 5000;
                        if (!config.maxItems) {
                            extractionInput.extractionConfig.maxItems = 10; // Default limit for speed mode
                        }
                    }

                    // 2. Execute extraction
                    logger.info(`[EntityMatcherFactory] Executing extraction middleware`);
                    const extractionStart = Date.now();
                    const extractionResult = await extractionMiddleware.execute(extractionInput, middlewareContext);
                    const extractionDuration = Date.now() - extractionStart;

                    logger.info(`[EntityMatcherFactory] Extraction completed in ${extractionDuration}ms`);

                    if (!extractionResult.success || extractionResult.items.length === 0) {
                        logger.warn(`[EntityMatcherFactory] Extraction failed or no items found: ${extractionResult.error || 'No items found'}`);
                        return sanitizeOutput({
                            success: false,
                            matches: [],
                            containerFound: extractionResult.containerFound || false,
                            itemsFound: extractionResult.itemsFound || 0,
                            error: extractionResult.error || 'No items found',
                            containerSelector: config.resultsSelector,
                            itemSelector: config.itemSelector || '(auto-detect)',
                            timings: {
                                extraction: extractionDuration,
                                total: Date.now() - startTime
                            }
                        });
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
                    const comparisonStart = Date.now();
                    const comparisonResult = await comparisonMiddleware.execute(comparisonInput, middlewareContext);
                    const comparisonDuration = Date.now() - comparisonStart;

                    logger.info(`[EntityMatcherFactory] Comparison completed in ${comparisonDuration}ms`);

                    if (!comparisonResult.success || comparisonResult.matches.length === 0) {
                        logger.warn(`[EntityMatcherFactory] Comparison failed or no matches found above threshold: ${comparisonResult.error || 'No matches found'}`);
                        return sanitizeOutput({
                            success: false,
                            matches: comparisonResult.matches || [],
                            containerFound: extractionResult.containerFound || false,
                            itemsFound: extractionResult.itemsFound || 0,
                            error: comparisonResult.error || 'No matches found above threshold',
                            containerSelector: config.resultsSelector,
                            itemSelector: config.itemSelector || '(auto-detect)',
                            referenceValues: config.sourceEntity || {},
                            threshold: config.threshold,
                            timings: {
                                extraction: extractionDuration,
                                comparison: comparisonDuration,
                                total: Date.now() - startTime
                            }
                        });
                    }

                    logger.info(`[EntityMatcherFactory] Comparison succeeded: Found ${comparisonResult.matches.length} matches, selected: ${comparisonResult.selectedMatch ? 'Yes' : 'No'}`);

                    // 5. Execute action if we have a selected match and an action to perform
                    let actionResult = { success: false, actionPerformed: false } as IEntityMatcherActionOutput;
                    let actionDuration = 0;

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
                        const actionStart = Date.now();
                        actionResult = await actionMiddleware.execute(actionInput, middlewareContext);
                        actionDuration = Date.now() - actionStart;

                        logger.info(`[EntityMatcherFactory] Action ${actionResult.success ? 'succeeded' : 'failed'} in ${actionDuration}ms: ${actionResult.actionPerformed ? 'Action performed' : 'No action performed'}`);
                    } else if (comparisonResult.selectedMatch) {
                        logger.info(`[EntityMatcherFactory] No action to perform (action: ${config.action || 'none'})`);
                    } else {
                        logger.info(`[EntityMatcherFactory] No action performed because no match was selected`);
                    }

                    // Calculate total duration
                    const totalDuration = Date.now() - startTime;
                    logger.info(`[EntityMatcherFactory] Entity matching process completed in ${totalDuration}ms`);

                    // Return sanitized result
                    return sanitizeOutput({
                        success: true,
                        matches: comparisonResult.matches,
                        selectedMatch: comparisonResult.selectedMatch,
                        actionPerformed: actionResult.actionPerformed,
                        actionResult: actionResult.actionResult,
                        containerFound: extractionResult.containerFound,
                        itemsFound: extractionResult.itemsFound,
                        containerSelector: config.resultsSelector,
                        itemSelector: extractionResult.itemSelector,
                        referenceValues: config.sourceEntity || {},
                        threshold: config.threshold,
                        timings: {
                            extraction: extractionDuration,
                            comparison: comparisonDuration,
                            action: actionDuration,
                            total: totalDuration
                        }
                    });

                } catch (error) {
                    const errorMessage = (error as Error).message;
                    const stack = (error as Error).stack;
                    logger.error(`[EntityMatcherFactory] Error in entity matcher execution: ${errorMessage}`);

                    if (stack) {
                        logger.debug(`[EntityMatcherFactory] Error stack: ${stack}`);
                    }

                    // Return sanitized error response
                    return sanitizeOutput({
                        success: false,
                        matches: [],
                        error: errorMessage,
                        errorDetails: {
                            message: errorMessage,
                            stack: stack
                        },
                        containerSelector: config.resultsSelector,
                        itemSelector: config.itemSelector || '(auto-detect)',
                        referenceValues: config.sourceEntity || {},
                        threshold: config.threshold,
                        timings: {
                            total: Date.now() - startTime
                        }
                    });
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
