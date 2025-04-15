import type { Logger as ILogger } from 'n8n-workflow';
import type { Page } from 'puppeteer-core';
import { type IEntityMatcher } from './entityMatcher';
import { type IFieldComparisonConfig } from '../../comparisonUtils';
import { initializeMiddlewareRegistry } from '../middlewareRegistration';

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
   * Create an entity matcher instance using the most appropriate implementation
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
    // Log creation details
    context.logger.debug(`[EntityMatcherFactory][${context.nodeName}] Creating entity matcher with config:
      resultsSelector: ${config.resultsSelector}
      itemSelector: ${config.itemSelector || '(auto-detect)'}
      autoDetectChildren: ${config.autoDetectChildren}
      fields: ${config.fields?.length || 0}
      sourceFields: ${Object.keys(config.sourceEntity || {}).length}
      threshold: ${config.threshold}
    `);

    // Initialize the registry
    const registry = initializeMiddlewareRegistry();

    // Create and return the matcher
    return {
      async execute() {
        context.logger.info(`[EntityMatcherFactory] Executing entity matcher with improved detection`);

        // Create the extraction configuration
        const extractionConfig = {
          resultsSelector: config.resultsSelector,
          itemSelector: config.itemSelector || '',
          fields: config.fields || [],
          autoDetectChildren: config.autoDetectChildren === true,
          waitForSelectors: config.waitForSelectors !== false,
          timeout: config.timeout || 10000,
        };

        try {
          // Create detection options
          const detectionOptions = {
            waitForSelectors: extractionConfig.waitForSelectors,
            selectorTimeout: extractionConfig.timeout,
            detectionMethod: 'smart',
            earlyExitDelay: 500,
            nodeName: context.nodeName,
            nodeId: context.nodeId,
            index: context.index,
          };

          context.logger.info(`[EntityMatcherFactory] Using detection options: ${JSON.stringify(detectionOptions)}`);

          // 1. Find the container element
          const containerElement = await page.$(config.resultsSelector);
          if (!containerElement) {
            context.logger.warn(`[EntityMatcherFactory] Container element not found with selector: ${config.resultsSelector}`);
            return {
              success: false,
              matches: [],
              containerFound: false,
              itemsFound: 0,
              error: `Container element not found with selector: ${config.resultsSelector}`
            };
          }

          // Get container HTML for debugging
          const containerHTML = await page.evaluate(el => el.outerHTML.substring(0, 1000) + '...', containerElement);
          context.logger.debug(`[EntityMatcherFactory] Container HTML preview: ${containerHTML}`);

          // 2. Extract container child elements
          let itemElements = [];

          // Check if we have a specific item selector or need to auto-detect
          if (config.itemSelector && config.itemSelector.trim() !== '') {
            // Use the specified item selector
            context.logger.info(`[EntityMatcherFactory] Using provided item selector: ${config.itemSelector}`);

            // Try with container scope
            itemElements = await containerElement.$$(config.itemSelector);
            context.logger.info(`[EntityMatcherFactory] Found ${itemElements.length} items using item selector within container`);

            // If no items found within container scope, try with combined selector
            if (itemElements.length === 0) {
              const combinedSelector = `${config.resultsSelector} ${config.itemSelector}`;
              context.logger.info(`[EntityMatcherFactory] Trying combined selector: ${combinedSelector}`);
              itemElements = await page.$$(combinedSelector);
              context.logger.info(`[EntityMatcherFactory] Found ${itemElements.length} items using combined selector`);
            }
          } else if (config.autoDetectChildren) {
            // Auto-detect child elements
            context.logger.info(`[EntityMatcherFactory] Auto-detecting child elements`);

            // First, try direct children
            itemElements = await containerElement.$$(':scope > *');
            context.logger.info(`[EntityMatcherFactory] Found ${itemElements.length} direct children`);

            // Get tag names of first few elements for debugging
            if (itemElements.length > 0) {
              const tagDetails = await Promise.all(
                itemElements.slice(0, Math.min(3, itemElements.length)).map(async (el, i) => {
                  const tagInfo = await page.evaluate(elem => {
                    return {
                      tagName: elem.tagName.toLowerCase(),
                      className: elem.className,
                      id: elem.id,
                      textContent: elem.textContent ? elem.textContent.substring(0, 50) : '',
                      childCount: elem.childNodes.length
                    };
                  }, el);
                  return `Element ${i}: ${JSON.stringify(tagInfo)}`;
                })
              );
              context.logger.debug(`[EntityMatcherFactory] First few elements: ${tagDetails.join('\n')}`);
            }

            // If no direct children or too many, try list items which are common in search results
            if (itemElements.length === 0 || itemElements.length > 50) {
              const liElements = await containerElement.$$('li');
              if (liElements.length > 0) {
                itemElements = liElements;
                context.logger.info(`[EntityMatcherFactory] Using ${liElements.length} list items instead of direct children`);
              }
            }
          } else {
            // No selector and no auto-detect - get all direct children as fallback
            itemElements = await containerElement.$$('*');
            context.logger.info(`[EntityMatcherFactory] No item selector or auto-detect. Found ${itemElements.length} elements with fallback '*' selector`);
          }

          // Check if we found any items
          if (itemElements.length === 0) {
            // If no items found, check if there are any elements at all in the container
            const anyElements = await containerElement.$$('*');
            context.logger.warn(`[EntityMatcherFactory] No items found with configured selectors. Container has ${anyElements.length} total elements inside.`);

            // Get container inner HTML to see what's actually in there
            const containerInnerHTML = await page.evaluate(el => el.innerHTML.substring(0, 500) + '...', containerElement);
            context.logger.debug(`[EntityMatcherFactory] Container inner HTML: ${containerInnerHTML}`);

            return {
              success: false,
              matches: [],
              containerFound: true,
              itemsFound: 0,
              containerHtml: containerInnerHTML,
              error: `Container found but no items were detected within it`
            };
          }

          // Limit the number of items if configured
          const maxItems = config.limitResults || config.maxItems || itemElements.length;
          const limitedItems = itemElements.slice(0, maxItems);
          context.logger.info(`[EntityMatcherFactory] Processing ${limitedItems.length} out of ${itemElements.length} found items`);

          // 3. Extract data from each item
          const extractedItems = [];
          for (let i = 0; i < limitedItems.length; i++) {
            const itemElement = limitedItems[i];
            const extractedFields: Record<string, string> = {};

            // Extract the full HTML of the item for debugging
            const itemHtml = await page.evaluate(el => el.outerHTML, itemElement);
            // Get both textContent and innerHTML for comprehensive matching
            const itemText = await page.evaluate(el => el.textContent?.trim() || '', itemElement);
            const itemInnerHtml = await page.evaluate(el => el.innerHTML || '', itemElement);

            // Add debug logging for each item
            context.logger.info(`[EntityMatcherFactory] Item ${i+1} HTML preview: ${itemHtml.substring(0, 200)}...`);
            context.logger.info(`[EntityMatcherFactory] Item ${i+1} text content: ${itemText.substring(0, 200)}...`);
            context.logger.info(`[EntityMatcherFactory] Item ${i+1} inner HTML: ${itemInnerHtml.substring(0, 200)}...`);

            // Store both full text and HTML in special fields for Smart Match
            extractedFields['__fullText'] = itemText;
            extractedFields['__fullHtml'] = itemInnerHtml;
            extractedFields['__outerHtml'] = itemHtml;
            extractedFields['__itemIndex'] = `${i+1}`;

            // Process each field from the configuration
            for (const field of config.fields || []) {
              try {
                // Find the element for this field
                let fieldValue = '';

                // Smart Match implementation - use full text content by default
                if (field.name === 'fullItem' || !field.selector || field.selector.trim() === '') {
                  // For smart extraction, use the innerHTML content which contains all the formatting
                  // If outputFormat is explicitly set to 'text', use textContent instead
                  const useHtmlForSmartMatch = !field.outputFormat || field.outputFormat === 'html' || field.outputFormat === 'smart';
                  fieldValue = useHtmlForSmartMatch ? itemInnerHtml : itemText;
                  context.logger.debug(`[EntityMatcherFactory] Using Smart Match with ${useHtmlForSmartMatch ? 'HTML' : 'text'} for field: ${field.name}`);
                } else if (field.selector) {
                  // Get element using the selector relative to the item
                  const fieldElement = await itemElement.$(field.selector);

                  if (fieldElement) {
                    // Extract based on attribute or text content
                    if (field.attribute) {
                      fieldValue = await page.evaluate(
                        (el, attr) => el.getAttribute(attr) || '',
                        fieldElement,
                        field.attribute
                      );
                      context.logger.debug(`[EntityMatcherFactory] Extracted attribute '${field.attribute}' value: ${fieldValue.substring(0, 50)}...`);
                    } else {
                      fieldValue = await page.evaluate(el => el.textContent || '', fieldElement);
                      context.logger.debug(`[EntityMatcherFactory] Extracted text from selector '${field.selector}': ${fieldValue.substring(0, 50)}...`);
                    }
                  } else {
                    context.logger.warn(`[EntityMatcherFactory] Selector '${field.selector}' not found in item ${i+1}`);
                  }
                } else {
                  // If no selector, use the item element's text
                  fieldValue = await page.evaluate(el => el.textContent || '', itemElement);
                }

                extractedFields[field.name] = fieldValue.trim();
              } catch (error) {
                context.logger.warn(`[EntityMatcherFactory] Error extracting field ${field.name}: ${(error as Error).message}`);
                extractedFields[field.name] = '';
              }
            }

            extractedItems.push({
              index: i,
              fields: extractedFields,
              element: itemElement
            });
          }

          context.logger.info(`[EntityMatcherFactory] Extracted data from ${extractedItems.length} items`);

          // 4. Compare with source entity
          const sourceEntity = config.sourceEntity || {};
          const matches = [];

          // Log the source entity for debugging comparison
          context.logger.info(`[EntityMatcherFactory] Source entity to match against: ${JSON.stringify(sourceEntity)}`);

          for (const item of extractedItems) {
            // Calculate similarity between source entity and this item
            const similarities: Record<string, number> = {};
            let totalWeight = 0;
            let weightedSimilarity = 0;

            // Log source entity for debugging
            context.logger.info(`[EntityMatcherFactory] Source entity to match against: ${JSON.stringify(sourceEntity)}`);

            for (const comparison of config.fieldComparisons || []) {
              const sourceValue = sourceEntity[comparison.field] || '';
              const fieldName = comparison.field;

              // Add improved logging of source values for debugging
              context.logger.info(`[EntityMatcherFactory] Source field value for "${fieldName}": "${sourceValue}"`);

              // Try using the field directly, then fallback to fullText for Smart Match
              const itemValue = item.fields[fieldName] ||
                                // Use either HTML or text depending on outputFormat
                                (config.outputFormat === 'text' ? item.fields['__fullText'] :
                                 config.outputFormat === 'html' ? item.fields['__fullHtml'] :
                                 item.fields['__fullText']) || '';
              const weight = comparison.weight || 1;

              // Calculate similarity based on algorithm
              let similarity = 0;
              if (sourceValue && itemValue) {
                // Simple contains check as fallback
                const normalizedSourceValue = sourceValue.toLowerCase();
                const normalizedItemValue = itemValue.toLowerCase();

                context.logger.info(`[EntityMatcherFactory] Comparing field "${fieldName}" - "${normalizedSourceValue}" vs item text "${normalizedItemValue.substring(0, 50)}..."`);

                // For text comparison, check contains first (higher similarity score)
                if (normalizedItemValue.includes(normalizedSourceValue)) {
                  similarity = 0.9; // 90% match for contains
                  context.logger.debug(`[EntityMatcherFactory] High similarity (contains): ${fieldName} = ${similarity}`);
                } else if (normalizedSourceValue.includes(normalizedItemValue)) {
                  similarity = 0.7; // 70% match if source contains item
                  context.logger.debug(`[EntityMatcherFactory] Medium similarity (partial): ${fieldName} = ${similarity}`);
                } else {
                  // Calculate word-based similarity for more fuzzy matching
                  const sourceWords = normalizedSourceValue.split(/\s+/);
                  const itemWords = normalizedItemValue.split(/\s+/);
                  let wordMatches = 0;

                  for (const word of sourceWords) {
                    if (word.length <= 2) continue; // Skip very short words
                    if (itemWords.some(itemWord => itemWord.includes(word) || word.includes(itemWord))) {
                      wordMatches++;
                    }
                  }

                  similarity = sourceWords.length > 0 ? wordMatches / sourceWords.length : 0;
                  context.logger.debug(`[EntityMatcherFactory] Word-based similarity: ${fieldName} = ${similarity} (${wordMatches}/${sourceWords.length} words)`);
                }
              }

              // Log the comparison for debugging
              context.logger.info(`[EntityMatcherFactory] Field comparison - ${fieldName}: '${sourceValue}' vs '${itemValue.substring(0, 50)}...' = ${similarity}`);

              similarities[fieldName] = similarity;
              totalWeight += weight;
              weightedSimilarity += similarity * weight;
            }

            // Calculate overall similarity
            const overallSimilarity = totalWeight > 0 ? weightedSimilarity / totalWeight : 0;

            context.logger.info(`[EntityMatcherFactory] Item ${item.index+1} overall similarity: ${overallSimilarity} (threshold: ${config.threshold || 0.6})`);

            // Add to matches if above threshold
            if (overallSimilarity >= (config.threshold || 0.6)) {
              matches.push({
                index: item.index,
                fields: item.fields,
                similarities,
                overallSimilarity,
                selected: false
              });
            }
          }

          // Sort matches by similarity (descending)
          matches.sort((a, b) => b.overallSimilarity - a.overallSimilarity);

          // Select the best match
          if (matches.length > 0) {
            matches[0].selected = true;
          }

          context.logger.info(`[EntityMatcherFactory] Found ${matches.length} matches above threshold`);

          // Return the result with all extracted items
          return {
            success: matches.length > 0,
            matches,
            selectedMatch: matches.length > 0 ? matches[0] : undefined,
            containerFound: true,
            itemsFound: extractedItems.length,
            totalExtracted: extractedItems.length,
            containerSelector: config.resultsSelector,
            extractedItems: extractedItems // Make sure to include all extracted items in the result
          };

        } catch (error) {
          context.logger.error(`[EntityMatcherFactory] Error executing matcher: ${(error as Error).message}`);
          return {
            success: false,
            matches: [],
            error: (error as Error).message,
            containerFound: false,
            itemsFound: 0,
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
