import type { IDataObject, Logger as ILogger } from 'n8n-workflow';
import type { Page } from 'puppeteer-core';
import { compareEntities, type IFieldComparisonConfig } from '../../comparisonUtils';
import { type IMiddleware, type IMiddlewareContext } from '../middleware';
import { normalizeText, type ITextNormalizationOptions } from '../../textUtils';
import { smartWaitForSelector, detectElement, IDetectionOptions } from '../../detectionUtils';

/**
 * Entity matcher input parameters
 */
export interface IEntityMatcherInput {
    page: Page;
    sourceEntity: Record<string, string | null | undefined>;
    resultsSelector: string;
    itemSelector: string;
    extractionConfig: {
        fields: Array<{
            name: string;
            selector: string;
            attribute?: string;
        }>;
        waitForSelectors?: boolean;
        timeout?: number;
    };
    matchingConfig: {
        fieldComparisons: IFieldComparisonConfig[];
        threshold: number;
        normalizationOptions?: ITextNormalizationOptions;
        limitResults?: number;
    };
    actionConfig: {
        action: 'click' | 'extract' | 'none';
        actionSelector?: string;
        actionAttribute?: string;
        waitAfterAction?: boolean;
        waitTime?: number;
    };
}

/**
 * Entity matcher result
 */
export interface IEntityMatcherResult {
    success: boolean;
    matches: Array<{
        index: number;
        fields: Record<string, string>;
        similarities: Record<string, number>;
        overallSimilarity: number;
        selected: boolean;
    }>;
    selectedMatch?: {
        index: number;
        fields: Record<string, string>;
        similarities: Record<string, number>;
        overallSimilarity: number;
    };
    actionPerformed?: boolean;
    actionResult?: any;
    error?: string;
}

/**
 * Entity Matcher Middleware
 * Extracts and compares entities from the webpage against a source entity
 */
export class EntityMatcherMiddleware implements IMiddleware<IEntityMatcherInput, IEntityMatcherResult> {

    /**
     * Execute the entity matching process
     */
    public async execute(
        input: IEntityMatcherInput,
        context: IMiddlewareContext
    ): Promise<IEntityMatcherResult> {
        const { logger, nodeName, nodeId } = context;
        const logPrefix = `[EntityMatcher][${nodeName}][${nodeId}]`;

        try {
            logger.info(`${logPrefix} Starting entity matching process`);

            // 1. Extract items from the page
            const items = await this.extractItems(input, logger, logPrefix);
            if (!items.length) {
                logger.warn(`${logPrefix} No items found with selector: ${input.resultsSelector} > ${input.itemSelector}`);
                return {
                    success: false,
                    matches: [],
                    error: 'No items found on the page',
                };
            }

            logger.info(`${logPrefix} Found ${items.length} items for matching`);

            // 2. Compare each item with the source entity
            const matches = await this.compareItems(items, input, logger, logPrefix);

            // 3. Sort by similarity score
            matches.sort((a, b) => b.overallSimilarity - a.overallSimilarity);

            // 4. Select the best match if it meets the threshold
            const bestMatch = matches[0];
            const selectedMatch = bestMatch.overallSimilarity >= input.matchingConfig.threshold ? bestMatch : undefined;

            if (selectedMatch) {
                logger.info(
                    `${logPrefix} Selected best match with similarity: ${selectedMatch.overallSimilarity.toFixed(4)}`
                );
                selectedMatch.selected = true;

                // 5. Perform action on selected match if configured
                if (input.actionConfig.action !== 'none') {
                    await this.performAction(input, selectedMatch.index, logger, logPrefix);
                }
            } else {
                logger.warn(
                    `${logPrefix} No matches met the threshold (${input.matchingConfig.threshold}). Best similarity: ${matches.length > 0 ? matches[0].overallSimilarity.toFixed(4) : 'N/A'
                    }`
                );
            }

            return {
                success: true,
                matches,
                selectedMatch: selectedMatch ? {
                    index: selectedMatch.index,
                    fields: selectedMatch.fields,
                    similarities: selectedMatch.similarities,
                    overallSimilarity: selectedMatch.overallSimilarity,
                } : undefined,
                actionPerformed: selectedMatch && input.actionConfig.action !== 'none',
            };

        } catch (error) {
            logger.error(`${logPrefix} Error in entity matching: ${(error as Error).message}`);
            return {
                success: false,
                matches: [],
                error: (error as Error).message,
            };
        }
    }

    /**
     * Extract items from the page based on the configured selectors
     */
    private async extractItems(
        input: IEntityMatcherInput,
        logger: ILogger,
        logPrefix: string
    ): Promise<Array<{ index: number; element: any; fields: Record<string, string> }>> {
        const { page, resultsSelector, itemSelector, extractionConfig, matchingConfig } = input;

        try {
            // Create detection options for smart element detection
            const detectionOptions: IDetectionOptions = {
                waitForSelectors: extractionConfig.waitForSelectors ?? true,
                selectorTimeout: extractionConfig.timeout ?? 30000,
                detectionMethod: 'smart',
                earlyExitDelay: 500,
                nodeName: logPrefix.split('[')[1]?.split(']')[0] || 'EntityMatcher',
                nodeId: logPrefix.split('[')[2]?.split(']')[0] || '',
                index: 0,
            };

            // Use smarter element detection from detectionUtils
            const containerDetectionResult = await detectElement(
                page,
                resultsSelector,
                detectionOptions,
                logger
            );

            if (!containerDetectionResult.success) {
                logger.warn(`${logPrefix} Container element not found with selector: ${resultsSelector}`);
                return [];
            }

            logger.info(`${logPrefix} Container element found successfully with selector: ${resultsSelector}`);

            // Get all item elements using improved detection
            let elements: any[] = [];

            if (itemSelector && itemSelector.trim() !== '') {
                // Use the combined selector approach for better reliability
                const combinedSelector = `${resultsSelector} ${itemSelector}`;

                // First check if items exist
                const itemsDetectionResult = await detectElement(
                    page,
                    combinedSelector,
                    detectionOptions,
                    logger
                );

                if (!itemsDetectionResult.success) {
                    logger.warn(`${logPrefix} No items found with combined selector: ${combinedSelector}`);
                    return [];
                }

                // Get all elements matching the selector
                elements = await page.$$(combinedSelector);
            } else {
                // If no item selector provided, get direct children of container
                const containerElement = await page.$(resultsSelector);
                if (!containerElement) {
                    logger.warn(`${logPrefix} Container element no longer available: ${resultsSelector}`);
                    return [];
                }

                // Get direct children
                elements = await containerElement.$$(':scope > *');
            }

            logger.debug(`${logPrefix} Found ${elements.length} elements matching selector`);

            // Limit the number of results if configured
            const limitedElements = matchingConfig.limitResults && matchingConfig.limitResults > 0
                ? elements.slice(0, matchingConfig.limitResults)
                : elements;

            // Extract data from each element
            const items: Array<{ index: number; element: any; fields: Record<string, string> }> = [];

            for (let i = 0; i < limitedElements.length; i++) {
                const element = limitedElements[i];
                const fields: Record<string, string> = {};

                // Extract each configured field
                for (const field of extractionConfig.fields) {
                    try {
                        // Find the element by selector
                        const fieldElement = await element.$(field.selector);

                        if (fieldElement) {
                            let value = '';

                            // Extract value based on attribute or text content
                            if (field.attribute) {
                                value = await page.evaluate(
                                    (el, attr) => el.getAttribute(attr) || '',
                                    fieldElement,
                                    field.attribute
                                );
                            } else {
                                value = await page.evaluate(el => el.textContent || '', fieldElement);
                            }

                            // Normalize the extracted text
                            fields[field.name] = normalizeText(
                                value,
                                matchingConfig.normalizationOptions
                            );
                        } else {
                            fields[field.name] = '';
                        }
                    } catch (fieldError) {
                        logger.debug(
                            `${logPrefix} Error extracting field ${field.name}: ${(fieldError as Error).message}`
                        );
                        fields[field.name] = '';
                    }
                }

                items.push({
                    index: i,
                    element,
                    fields,
                });
            }

            return items;
        } catch (error) {
            logger.error(`${logPrefix} Error extracting items: ${(error as Error).message}`);
            throw error;
        }
    }

    /**
     * Compare each extracted item with the source entity
     */
    private async compareItems(
        items: Array<{ index: number; element: any; fields: Record<string, string> }>,
        input: IEntityMatcherInput,
        logger: ILogger,
        logPrefix: string
    ): Promise<Array<{
        index: number;
        fields: Record<string, string>;
        similarities: Record<string, number>;
        overallSimilarity: number;
        selected: boolean;
    }>> {
        try {
            const { sourceEntity, matchingConfig } = input;
            const results = [];

            // Use the improved compareEntities from comparisonUtils
            const { compareEntities } = require('../../comparisonUtils');

            for (const item of items) {
                try {
                    // Convert field comparison config to the format expected by compareEntities
                    const fieldConfigs = matchingConfig.fieldComparisons.map(fc => ({
                        field: fc.field,
                        weight: fc.weight || 1,
                        algorithm: fc.algorithm || 'smart',
                        threshold: fc.threshold || matchingConfig.threshold || 0.7,
                        mustMatch: fc.mustMatch || false
                    }));

                    // Compare the current item with the source entity
                    const comparisonResult = compareEntities(
                        sourceEntity,
                        item.fields,
                        fieldConfigs,
                        logger
                    );

                    // Add detailed logging for debugging
                    logger.debug(
                        `${logPrefix} Item ${item.index} comparison result: ` +
                        `overall=${comparisonResult.overallSimilarity.toFixed(4)}, ` +
                        `meetsThreshold=${comparisonResult.meetsThreshold}, ` +
                        `requiredFieldsMet=${comparisonResult.requiredFieldsMet}, ` +
                        `fields=${JSON.stringify(comparisonResult.fieldSimilarities)}`
                    );

                    // Add to results if meets threshold or we're collecting all matches
                    if (comparisonResult.meetsThreshold && comparisonResult.requiredFieldsMet) {
                        results.push({
                            index: item.index,
                            fields: item.fields,
                            similarities: comparisonResult.fieldSimilarities,
                            overallSimilarity: comparisonResult.overallSimilarity,
                            selected: false,
                        });
                    }
                } catch (error) {
                    logger.error(`${logPrefix} Error comparing item ${item.index}: ${(error as Error).message}`);
                }
            }

            return results;
        } catch (error) {
            logger.error(`${logPrefix} Error in compareItems: ${(error as Error).message}`);
            return [];
        }
    }

    /**
     * Perform the configured action on the selected item
     */
    private async performAction(
        input: IEntityMatcherInput,
        itemIndex: number,
        logger: ILogger,
        logPrefix: string
    ): Promise<any> {
        try {
            const { page, resultsSelector, itemSelector, actionConfig } = input;

            // Get the element for the selected index
            const elements = await page.$$(`${resultsSelector} ${itemSelector}`);
            if (itemIndex >= elements.length) {
                throw new Error(`Selected index ${itemIndex} is out of bounds (${elements.length} elements)`);
            }

            const element = elements[itemIndex];

            // Perform the configured action
            switch (actionConfig.action) {
                case 'click': {
                    let elementToClick;

                    if (actionConfig.actionSelector) {
                        // Find the specific element to click
                        elementToClick = await element.$(actionConfig.actionSelector);
                        if (!elementToClick) {
                            throw new Error(`Action selector ${actionConfig.actionSelector} not found in element`);
                        }
                    } else {
                        // Click the item element itself
                        elementToClick = element;
                    }

                    // Perform the click
                    await elementToClick.click();
                    logger.info(`${logPrefix} Clicked on element at index ${itemIndex}`);

                    // Wait after action if configured
                    if (actionConfig.waitAfterAction) {
                        const waitTime = actionConfig.waitTime || 1000;
                        await new Promise(resolve => setTimeout(resolve, waitTime));
                    }

                    return { clicked: true, index: itemIndex };
                }

                case 'extract': {
                    // Extract additional data if needed
                    if (actionConfig.actionSelector) {
                        const extractElement = await element.$(actionConfig.actionSelector);

                        if (extractElement) {
                            let value;

                            if (actionConfig.actionAttribute) {
                                value = await page.evaluate(
                                    (el, attr) => el.getAttribute(attr) || '',
                                    extractElement,
                                    actionConfig.actionAttribute
                                );
                            } else {
                                value = await page.evaluate(el => el.textContent || '', extractElement);
                            }

                            logger.info(`${logPrefix} Extracted value from element at index ${itemIndex}`);
                            return { extracted: true, value, index: itemIndex };
                        } else {
                            throw new Error(`Action selector ${actionConfig.actionSelector} not found in element`);
                        }
                    } else {
                        // Extract the entire element
                        const html = await page.evaluate(el => el.outerHTML, element);
                        logger.info(`${logPrefix} Extracted HTML from element at index ${itemIndex}`);
                        return { extracted: true, html, index: itemIndex };
                    }
                }

                default:
                    return { action: 'none' };
            }
        } catch (error) {
            logger.error(`${logPrefix} Error performing action: ${(error as Error).message}`);
            throw error;
        }
    }
}
