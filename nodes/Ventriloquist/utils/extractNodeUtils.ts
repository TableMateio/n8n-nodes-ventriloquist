import type { Logger as ILogger } from 'n8n-workflow';
import type * as puppeteer from 'puppeteer-core';
import { createExtraction, type IExtractionConfig } from './middlewares/extraction/extractionFactory';
import { formatExtractedDataForLog } from './extractionUtils';
import { formatOperationLog } from './resultUtils';
import { getHumanDelay } from './extractionUtils';
import { detectContentType, processWithAI } from './smartExtractionUtils';
import { Logger } from 'n8n-workflow';
import { v4 as uuidv4 } from 'uuid';
import { IMiddlewareContext } from './middlewares/middleware';
import { enhanceFieldsWithRelativeSelectorContent } from './processOpenAISchema';
import { logWithDebug } from './loggingUtils';

/**
 * Interface for extraction node options
 */
export interface IExtractionNodeOptions {
  nodeName?: string;
  nodeId?: string;
  aiAssistance?: boolean;
  extractionFormat?: string;
  aiModel?: string;
  generalInstructions?: string;
  strategy?: string;
  includeSchema?: boolean;
  includeRawData?: boolean;
  includeReferenceContext?: boolean;
  referenceSelector?: string;
  referenceName?: string;
  referenceFormat?: string;
  referenceAttribute?: string;
  selectorScope?: string;
  aiFields?: {
    items?: Array<{
      name: string;
      type: string;
      instructions: string;
    }>;
  };
  waitForSelector?: boolean;
  timeout?: number;
  useHumanDelays?: boolean;
  continueOnFail?: boolean;
  debugMode?: boolean;
  debugPageContent?: boolean;
}

/**
 * Interface for extract item configuration
 */
export interface IExtractItem {
  id: string;
  name: string;
  extractionType: string;
  extractedData?: any;
  rawData?: any;
  schema?: any;
  selector?: string;
  attribute?: string;
  regex?: string;
  cssPath?: string;
  jsonPath?: string;
  xpath?: string;
  puppeteer?: any;
  puppeteerSessionId?: string;
  puppeteerPage?: any;
  openAiApiKey?: string;
  hasOpenAiApiKey?: boolean;
  continueIfNotFound?: boolean;
  preserveFieldStructure?: boolean;
  textOptions?: {
    cleanText?: boolean;
  };
  htmlOptions?: {
    outputFormat?: string;
    includeMetadata?: boolean;
  };
  tableOptions?: {
    includeHeaders?: boolean;
    rowSelector?: string;
    cellSelector?: string;
    outputFormat?: string;
  };
  multipleOptions?: {
    attributeName?: string;
    extractionProperty?: string;
    outputLimit?: number;
    extractProperty?: boolean;
    propertyKey?: string;
    separator?: string;
    outputFormat?: string;
    cleanText?: boolean;
    limit?: number;
  };
  aiFormatting?: {
    enabled: boolean;
    extractionFormat?: string;
    aiModel?: string;
    generalInstructions?: string;
    strategy?: string;
    includeSchema?: boolean;
    includeRawData?: boolean;
    includeReferenceContext?: boolean;
    referenceSelector?: string;
    referenceName?: string;
    referenceFormat?: string;
    referenceAttribute?: string;
    selectorScope?: string;
    referenceContent?: string; // Will store the extracted reference content
    fieldProcessingMode?: string; // 'batch' or 'individual'
    smartOptions?: {
      extractionFormat?: string;
      aiAssistance?: boolean;
      aiModel?: string;
      generalInstructions?: string;
      strategy?: string;
      includeSchema?: boolean;
      includeRawData?: boolean;
      includeReferenceContext?: boolean;
      referenceSelector?: string;
      referenceName?: string;
      referenceFormat?: string;
      referenceAttribute?: string;
      selectorScope?: string;
      referenceContent?: string;
      debugMode?: boolean;
    };
  };
  aiFields?: Array<{
    name: string;
    description?: string;
    instructions?: string;
    type?: string;
    required?: boolean;
    relativeSelectorOptional?: string;
    relativeSelector?: string;       // For non-AI field extraction
    returnDirectAttribute?: boolean; // Flag to indicate the extracted value should be returned directly
    referenceContent?: string;      // Stores the extracted content for reference
    fieldOptions?: {
      aiProcessingMode?: 'standard' | 'logical';
      threadManagement?: 'shared' | 'separate';
      extractionType?: string;
      attributeName?: string;
      format?: string;
    };
  }>;
}

/**
 * Interface for extract operation configuration
 */
export interface IExtractConfig {
  waitForSelector: boolean;
  timeout: number;
  useHumanDelays: boolean;
  continueOnFail: boolean;
}

/**
 * Helper function to extract reference content using specified format
 */
async function extractReferenceContent(
  page: any,
  selector: string,
  format: string = 'text',
  attribute: string = '',
  parentSelector: string = '',
  selectorScope: string = 'global',
  logger: Logger,
  nodeOptions: IExtractionNodeOptions
): Promise<string> {
  try {
    // Extract based on format and scope
    if (selectorScope === 'global') {
      // Global selector - search in the entire page
      if (format === 'text') {
        return await page.evaluate((selector: string) => {
          const element = document.querySelector(selector);
          return element ? element.textContent || '' : '';
        }, selector);
      } else if (format === 'html') {
        return await page.evaluate((selector: string) => {
          const element = document.querySelector(selector);
          return element ? element.outerHTML || '' : '';
        }, selector);
      } else if (format === 'attribute' && attribute) {
        return await page.evaluate((selector: string, attr: string) => {
          const element = document.querySelector(selector);
          return element ? element.getAttribute(attr) || '' : '';
        }, selector, attribute);
      }
    } else if (selectorScope === 'relative' && parentSelector) {
      // Relative selector - search within the parent element
      if (format === 'text') {
        return await page.evaluate((parentSel: string, childSel: string) => {
          const parent = document.querySelector(parentSel);
          if (!parent) return '';
          const element = parent.querySelector(childSel);
          return element ? element.textContent || '' : '';
        }, parentSelector, selector);
      } else if (format === 'html') {
        return await page.evaluate((parentSel: string, childSel: string) => {
          const parent = document.querySelector(parentSel);
          if (!parent) return '';
          const element = parent.querySelector(childSel);
          return element ? element.outerHTML || '' : '';
        }, parentSelector, selector);
      } else if (format === 'attribute' && attribute) {
        return await page.evaluate((parentSel: string, childSel: string, attr: string) => {
          const parent = document.querySelector(parentSel);
          if (!parent) return '';
          const element = parent.querySelector(childSel);
          return element ? element.getAttribute(attr) || '' : '';
        }, parentSelector, selector, attribute);
      }
    }
    return '';
  } catch (error) {
    logWithDebug(
      logger,
      nodeOptions.debugMode || false,
      nodeOptions.nodeName || 'Ventriloquist',
      'extraction',
      'extractNodeUtils',
      'extractReferenceContent',
      `Error extracting reference content (${format}, scope: ${selectorScope}): ${error}`,
      'error'
    );
    return '';
  }
}

/**
 * Process all extraction items using our middleware architecture
 */
export async function processExtractionItems(
  extractionItems: IExtractItem[],
  extractionNodeOptions: IExtractionNodeOptions,
  logger: Logger,
  openAiApiKey?: string
): Promise<IExtractItem[]> {
  const nodeName = extractionNodeOptions.nodeName || 'Ventriloquist';
  const nodeId = extractionNodeOptions.nodeId || 'unknown';
  const typedExtractionItems: IExtractItem[] = [];
  const isDebugMode = extractionNodeOptions.debugMode === true;

  // Log global extraction options with direct console output for maximum visibility
  if (isDebugMode) {
    logWithDebug(
      logger,
      true,
      nodeName,
      'extraction',
      'extractNodeUtils',
      'processExtractionItems',
      `Processing ${extractionItems.length} extraction items with options: ${JSON.stringify({
        waitForSelector: extractionNodeOptions.waitForSelector,
        timeout: extractionNodeOptions.timeout,
        useHumanDelays: extractionNodeOptions.useHumanDelays,
        continueOnFail: extractionNodeOptions.continueOnFail,
        debugMode: extractionNodeOptions.debugMode
      })}`,
      'info'
    );
  }

  for (let i = 0; i < extractionItems.length; i++) {
    const extractionItem = extractionItems[i];
    logger.debug(
      formatOperationLog(
        'extraction',
        nodeName,
        nodeId,
        i,
        `Processing extraction item [${extractionItem.name}] with type [${extractionItem.extractionType}]`,
        'extractNodeUtils',
        'processExtractionItems'
      )
    );

    // Check if we should preserve field structure for this extraction item
    // This happens when:
    // 1. The extraction uses manual schema with multiple fields
    // 2. There are fields with nested structure (containing dots in field names)
    // 3. The fields don't use direct attribute extraction exclusively
    if (extractionItem.aiFormatting?.strategy === 'manual' &&
        Array.isArray(extractionItem.aiFields) &&
        extractionItem.aiFields.length > 0) {

      // Check for multiple fields or nested fields (containing dots)
      const hasMultipleFields = extractionItem.aiFields.length > 1;
      const hasNestedFields = extractionItem.aiFields.some(field => field.name.includes('.'));

      // Also check if this is a table extraction, which should always preserve structure when fields are defined
      const isTableExtraction = extractionItem.extractionType === 'table';

      // Always set preserveFieldStructure flag for manual extraction with multiple or nested fields
      // or when it's a table extraction with defined fields
      if (hasMultipleFields || hasNestedFields || isTableExtraction) {
        logger.info(
          formatOperationLog(
            'extraction',
            nodeName,
            nodeId,
            i,
            `Setting preserveFieldStructure=true for item "${extractionItem.name}" - ` +
            `hasMultipleFields=${hasMultipleFields}, hasNestedFields=${hasNestedFields}, isTableExtraction=${isTableExtraction}`,
            'extractNodeUtils',
            'processExtractionItems'
          )
        );
        extractionItem.preserveFieldStructure = true;
      }

      // Additional debug logging for complex field structures
      if (hasNestedFields) {
        // Group fields by parent name for better logging
        const fieldGroups: Record<string, string[]> = {};
        for (const field of extractionItem.aiFields) {
          if (field.name.includes('.')) {
            const [parent] = field.name.split('.');
            if (!fieldGroups[parent]) {
              fieldGroups[parent] = [];
            }
            fieldGroups[parent].push(field.name);
          }
        }

        // Log the nested field structure
        for (const [parent, fields] of Object.entries(fieldGroups)) {
          logger.info(
            formatOperationLog(
              'extraction',
              nodeName,
              nodeId,
              i,
              `Detected nested field group "${parent}" with fields: ${fields.join(', ')}`,
              'extractNodeUtils',
              'processExtractionItems'
            )
          );
        }
      }
    }

    // Log if this item has AI formatting enabled and API key
    if (extractionItem.aiFormatting?.enabled) {
      logger.debug(
        formatOperationLog(
          'aiFormatting',
          nodeName,
          nodeId,
          i,
          `Setting up AI formatting for item ${extractionItem.name} (strategy: ${extractionItem.aiFormatting.strategy})`,
          'extractNodeUtils',
          'processExtractionItems'
        )
      );

      // Log debug mode for this item with direct console output for maximum visibility
      if (isDebugMode) {
        logWithDebug(
          logger,
          true,
          nodeName,
          'extraction',
          'extractNodeUtils',
          'processExtractionItems',
          `Item ${extractionItem.name} has AI formatting enabled (${extractionItem.aiFormatting.strategy} strategy)`,
          'error'
        );
      }

      // Add fields for manual strategy
      if (extractionItem.aiFields && extractionItem.aiFormatting.strategy === 'manual') {
        logger.debug(
          formatOperationLog(
            'aiFormatting',
            nodeName,
            nodeId,
            i,
            `Using manual strategy with ${extractionItem.aiFields.length} fields`,
            'extractNodeUtils',
            'processExtractionItems'
          )
        );

        extractionItem.aiFields.forEach(field => {
          logger.debug(
            formatOperationLog(
              'aiFormatting',
              nodeName,
              nodeId,
              i,
              `Field "${field.name}": ` +
              `selector="${field.relativeSelectorOptional || field.relativeSelector || ''}", ` +
              `type="${field.type || 'string'}", ` +
              `attribute="${(field.fieldOptions && field.fieldOptions.attributeName) || 'none'}", ` +
              `aiAssisted=${!!field.relativeSelectorOptional}`,
              'extractNodeUtils',
              'processExtractionItems'
            )
          );
        });
      }

      // Log API key status
      if (openAiApiKey) {
        extractionItem.hasOpenAiApiKey = true;
        // Store a copy of the API key directly in the extraction item for use in later processing
        extractionItem.openAiApiKey = openAiApiKey;
        logger.info(
          formatOperationLog(
            'aiFormatting',
            nodeName,
            nodeId,
            i,
            `OpenAI API key provided for extraction (length: ${openAiApiKey.length})`,
            'extractNodeUtils',
            'processExtractionItems'
          )
        );
      } else {
        // Log a warning if no API key is available
        logger.warn(
          formatOperationLog(
            'aiFormatting',
            nodeName,
            nodeId,
            i,
            `No OpenAI API key provided - AI processing will be skipped`,
            'extractNodeUtils',
            'processExtractionItems'
          )
        );
      }
    } else {
      // Ensure AI processing is disabled when not explicitly enabled
      extractionItem.hasOpenAiApiKey = false;
    }

    // Add specific options for different extraction types
    if (extractionItem.extractionType === 'table' && extractionItem.tableOptions) {
      extractionItem.tableOptions = {
        ...extractionItem.tableOptions,
        includeHeaders: extractionItem.tableOptions.includeHeaders,
        rowSelector: extractionItem.tableOptions.rowSelector,
        cellSelector: extractionItem.tableOptions.cellSelector,
        outputFormat: extractionItem.tableOptions.outputFormat
      };
    } else if (extractionItem.extractionType === 'multiple' && extractionItem.multipleOptions) {
      extractionItem.multipleOptions = {
        ...extractionItem.multipleOptions,
        extractionProperty: extractionItem.multipleOptions.extractionProperty,
        limit: extractionItem.multipleOptions.outputLimit,
        separator: extractionItem.multipleOptions.separator,
        outputFormat: extractionItem.multipleOptions.outputFormat,
        cleanText: extractionItem.multipleOptions.cleanText
      };
    } else if (extractionItem.extractionType === 'html' && extractionItem.htmlOptions) {
      extractionItem.htmlOptions = {
        ...extractionItem.htmlOptions,
        outputFormat: extractionItem.htmlOptions.outputFormat,
        includeMetadata: extractionItem.htmlOptions.includeMetadata
      };
    }

    // Perform the extraction if there's a puppeteer page available
    if (extractionItem.puppeteerPage) {
      try {
        // Create the extraction middleware context
        const context: IMiddlewareContext = {
          logger,
          nodeName,
          nodeId,
          sessionId: extractionItem.puppeteerSessionId || 'unknown',
          index: i
        };

        // Extract reference context if enabled
        if (extractionItem.aiFormatting?.enabled &&
          extractionItem.aiFormatting?.includeReferenceContext) {
          try {
            const referenceSelector = extractionItem.aiFormatting.referenceSelector;
            const referenceFormat = extractionItem.aiFormatting.referenceFormat || 'text';
            const referenceAttribute = extractionItem.aiFormatting.referenceAttribute || '';
            const selectorScope = extractionItem.aiFormatting.selectorScope || 'global';

            // Initialize referenceContent to empty string
            let referenceContent = '';

            // If no selector is provided, use the current page URL as reference content
            if (!referenceSelector || referenceSelector.trim() === '') {
              try {
                // Get the current page URL
                referenceContent = await extractionItem.puppeteerPage.url();

                logger.debug(
                  formatOperationLog(
                    'aiFormatting',
                    nodeName,
                    nodeId,
                    i,
                    `Using current page URL as reference context: ${referenceContent}`,
                    'extractNodeUtils',
                    'processExtractionItems'
                  )
                );
              } catch (urlError) {
                logger.warn(
                  formatOperationLog(
                    'aiFormatting',
                    nodeName,
                    nodeId,
                    i,
                    `Error getting current page URL: ${(urlError as Error).message}`,
                    'extractNodeUtils',
                    'processExtractionItems'
                  )
                );
              }
            } else {
              // If a selector is provided, use it to extract reference content
              logger.debug(
                formatOperationLog(
                  'aiFormatting',
                  nodeName,
                  nodeId,
                  i,
                  `Extracting reference context using selector "${referenceSelector}" (format: ${referenceFormat}, scope: ${selectorScope}${referenceFormat === 'attribute' ? `, attribute: ${referenceAttribute}` : ''})`,
                  'extractNodeUtils',
                  'processExtractionItems'
                )
              );

              try {
                if (selectorScope === 'global') {
                  // Global selector - search in the entire page
                  if (referenceFormat === 'text') {
                    // Extract as text content
                    referenceContent = await extractionItem.puppeteerPage.evaluate((selector: string) => {
                      try {
                        const element = document.querySelector(selector);
                        if (element) {
                          return element.textContent || '';
                        }
                      } catch (err) {
                        logWithDebug(
                          logger,
                          isDebugMode,
                          nodeName,
                          'extraction',
                          'extractNodeUtils',
                          'extractText',
                          `Error in text extraction: ${err}`,
                          'error'
                        );
                      }
                      return '';
                    }, referenceSelector);
                  } else if (referenceFormat === 'html') {
                    // Extract as HTML
                    referenceContent = await extractionItem.puppeteerPage.evaluate((selector: string) => {
                      try {
                        const element = document.querySelector(selector);
                        if (element) {
                          return element.outerHTML || '';
                        }
                      } catch (err) {
                        logWithDebug(
                          logger,
                          isDebugMode,
                          nodeName,
                          'extraction',
                          'extractNodeUtils',
                          'extractText',
                          `Error in HTML extraction: ${err}`,
                          'error'
                        );
                      }
                      return '';
                    }, referenceSelector);
                  } else if (referenceFormat === 'attribute' && referenceAttribute) {
                    // Extract attribute value
                    referenceContent = await extractionItem.puppeteerPage.evaluate((selector: string, attribute: string) => {
                      try {
                        const element = document.querySelector(selector);
                        if (element) {
                          const attributeValue = element.getAttribute(attribute) || '';
                          // Add context information about the attribute
                          return `Element <${element.tagName.toLowerCase()}> "${element.textContent?.trim()}" has ${attribute} = "${attributeValue}"`;
                        }
                      } catch (err) {
                        logWithDebug(
                          logger,
                          isDebugMode,
                          nodeName,
                          'extraction',
                          'extractNodeUtils',
                          'extractAttribute',
                          `Error in attribute extraction: ${err}`,
                          'error'
                        );
                      }
                      return '';
                    }, referenceSelector, referenceAttribute);
                  }
                } else {
                  // Relative selector - search within the parent element
                  // First get the main selector element
                  const mainSelector = extractionItem.selector;

                  if (referenceFormat === 'text') {
                    // Extract as text content relative to main selector
                    referenceContent = await extractionItem.puppeteerPage.evaluate((mainSel: string, refSel: string) => {
                      try {
                        const parentElement = document.querySelector(mainSel);
                        if (parentElement) {
                          const element = parentElement.querySelector(refSel);
                          if (element) {
                            return element.textContent || '';
                          }
                        }
                      } catch (err) {
                        logWithDebug(
                          logger,
                          isDebugMode,
                          nodeName,
                          'extraction',
                          'extractNodeUtils',
                          'extractRelativeText',
                          `Error in relative text extraction: ${err}`,
                          'error'
                        );
                      }
                      return '';
                    }, mainSelector, referenceSelector);
                  } else if (referenceFormat === 'html') {
                    // Extract as HTML relative to main selector
                    referenceContent = await extractionItem.puppeteerPage.evaluate((mainSel: string, refSel: string) => {
                      try {
                        const parentElement = document.querySelector(mainSel);
                        if (parentElement) {
                          const element = parentElement.querySelector(refSel);
                          if (element) {
                            return element.outerHTML || '';
                          }
                        }
                      } catch (err) {
                        logWithDebug(
                          logger,
                          isDebugMode,
                          nodeName,
                          'extraction',
                          'extractNodeUtils',
                          'extractRelativeText',
                          `Error in relative HTML extraction: ${err}`,
                          'error'
                        );
                      }
                      return '';
                    }, mainSelector, referenceSelector);
                  } else if (referenceFormat === 'attribute' && referenceAttribute) {
                    // Extract attribute value relative to main selector
                    referenceContent = await extractionItem.puppeteerPage.evaluate(
                      (mainSel: string, refSel: string, attribute: string) => {
                        try {
                          const parentElement = document.querySelector(mainSel);
                          if (parentElement) {
                            const element = parentElement.querySelector(refSel);
                            if (element) {
                              const attributeValue = element.getAttribute(attribute) || '';
                              // Add context about the element and its attribute
                              return `Within parent element, found <${element.tagName.toLowerCase()}> "${element.textContent?.trim()}" with ${attribute} = "${attributeValue}"`;
                            }
                          }
                        } catch (err) {
                          logWithDebug(
                            logger,
                            isDebugMode,
                            nodeName,
                            'extraction',
                            'extractNodeUtils',
                            'extractRelativeAttribute',
                            `Error in relative attribute extraction: ${err}`,
                            'error'
                          );
                        }
                        return '';
                      },
                      mainSelector,
                      referenceSelector,
                      referenceAttribute
                    );
                  }
                }
              } catch (extractionError) {
                logger.warn(
                  formatOperationLog(
                    'aiFormatting',
                    nodeName,
                    nodeId,
                    i,
                    `Error in reference extraction (${referenceFormat}): ${(extractionError as Error).message}`,
                    'extractNodeUtils',
                    'processExtractionItems'
                  )
                );
              }
            }

            // Store the reference content in the AI formatting options if we got any
            if (referenceContent) {
              extractionItem.aiFormatting.referenceContent = referenceContent.trim();

              // Add reference content to extraction config
              if (extractionItem.aiFormatting.smartOptions) {
                extractionItem.aiFormatting.smartOptions.referenceContent = referenceContent.trim();
              }

              // Log more detailed info for attribute extractions
              if (referenceFormat === 'attribute') {
                logger.info(
                  formatOperationLog(
                    'aiFormatting',
                    nodeName,
                    nodeId,
                    i,
                    `Attribute "${referenceAttribute}" extracted successfully: ${referenceContent.substring(0, 100)}${referenceContent.length > 100 ? '...' : ''}`,
                    'extractNodeUtils',
                    'processExtractionItems'
                  )
                );
              } else {
                logger.debug(
                  formatOperationLog(
                    'aiFormatting',
                    nodeName,
                    nodeId,
                    i,
                    `Reference context extracted successfully as ${referenceSelector ? referenceFormat : 'URL'} (${referenceContent.length} chars)`,
                    'extractNodeUtils',
                    'processExtractionItems'
                  )
                );
              }
            } else {
              logger.warn(
                formatOperationLog(
                  'aiFormatting',
                  nodeName,
                  nodeId,
                  i,
                  referenceSelector
                    ? `No reference context found for selector: ${referenceSelector}`
                    : 'No reference context found',
                  'extractNodeUtils',
                  'processExtractionItems'
                )
              );
            }
          } catch (error) {
            logger.warn(
              formatOperationLog(
                'aiFormatting',
                nodeName,
                nodeId,
                i,
                `Error extracting reference context: ${(error as Error).message}`,
                'extractNodeUtils',
                'processExtractionItems'
              )
            );
          }
        }

        // If we have aiFields and relativeSelectorOptional values, enhance them with extracted content
        if (extractionItem.aiFields && extractionItem.aiFields.length > 0 && extractionItem.puppeteerPage && extractionItem.selector) {
          try {
            // Flag to track if we've already enhanced fields for this item
            let fieldsAlreadyEnhanced = extractionItem.aiFields.some(field => {
              const extField = field as any;
              return extField.referenceContent !== undefined || extField.returnDirectAttribute === true;
            });

            if (fieldsAlreadyEnhanced) {
              logger.info(
                formatOperationLog(
                  'aiFormatting',
                  nodeName,
                  nodeId,
                  i,
                  `Fields for item ${extractionItem.name} already enhanced, skipping enhancement`,
                  'extractNodeUtils',
                  'processExtractionItems'
                )
              );
            } else {
              // Only enhance if not already enhanced
              // Force cast aiFields to ensure it matches the expected type
              const fieldsWithInstructions = extractionItem.aiFields.map(field => ({
                ...field,
                instructions: field.instructions || ''
              }));

              const enhancedFields = await enhanceFieldsWithRelativeSelectorContent(
                extractionItem.puppeteerPage,
                fieldsWithInstructions as any[], // Use type assertion to bypass strict checking
                extractionItem.selector,
                logger,
                {
                  nodeName,
                  nodeId,
                  index: i,
                  component: 'extractNodeUtils',
                  functionName: 'processExtractionItems'
                }
              );

              // Replace the fields with enhanced versions
              extractionItem.aiFields = enhancedFields;

              // Log how many fields were enhanced
              logger.info(
                formatOperationLog(
                  'aiFormatting',
                  nodeName,
                  nodeId,
                  i,
                  `Enhanced fields result: ${enhancedFields.length} fields processed`,
                  'extractNodeUtils',
                  'processExtractionItems'
                )
              );

              // Add detailed logs about each field's enhancement
              for (const field of enhancedFields) {
                const extField = field as any;
                const hasReferenceContent = extField.referenceContent !== undefined;
                const hasDirectAttribute = extField.returnDirectAttribute === true;

                logger.info(
                  formatOperationLog(
                    'extraction',
                    nodeName,
                    nodeId,
                    i,
                    `AFTER ENHANCEMENT - Field "${field.name}" enhancement results:`,
                    'extractNodeUtils',
                    'processExtractionItems'
                  )
                );

                logger.info(
                  formatOperationLog(
                    'extraction',
                    nodeName,
                    nodeId,
                    i,
                    `hasReferenceContent=${hasReferenceContent}, directAttribute=${hasDirectAttribute}`,
                    'extractNodeUtils',
                    'processExtractionItems'
                  )
                );

                logger.info(
                  formatOperationLog(
                    'extraction',
                    nodeName,
                    nodeId,
                    i,
                    `instructionsLength=${field.instructions?.length || 0}`,
                    'extractNodeUtils',
                    'processExtractionItems'
                  )
                );

                logger.info(
                  formatOperationLog(
                    'extraction',
                    nodeName,
                    nodeId,
                    i,
                    `instructions="${field.instructions?.substring(0, 20)}..."`,
                    'extractNodeUtils',
                    'processExtractionItems'
                  )
                );
              }

              // NEW SECTION: Check for presence of at least one field with returnDirectAttribute=false
              // This ensures we don't rely exclusively on direct attribute extraction when there are
              // fields that need AI processing
              const hasNonDirectFields = extractionItem.aiFields.some(field => {
                const extField = field as any;
                return extField.returnDirectAttribute !== true;
              });

              if (hasNonDirectFields) {
                logger.info(
                  formatOperationLog(
                    'extraction',
                    nodeName,
                    nodeId,
                    i,
                    `Item ${extractionItem.name} has fields requiring AI processing - will maintain field structure`,
                    'extractNodeUtils',
                    'processExtractionItems'
                  )
                );

                // Set a flag to indicate we should preserve field structure
                extractionItem.preserveFieldStructure = true;
              } else if (extractionItem.aiFields.length > 1) {
                // If all fields are direct attributes but we have multiple, we should still preserve structure
                logger.info(
                  formatOperationLog(
                    'extraction',
                    nodeName,
                    nodeId,
                    i,
                    `Item ${extractionItem.name} has multiple direct attribute fields - will maintain field structure`,
                    'extractNodeUtils',
                    'processExtractionItems'
                  )
                );

                // Set a flag to indicate we should preserve field structure
                extractionItem.preserveFieldStructure = true;
              }
            }
          } catch (error) {
            logger.error(
              formatOperationLog(
                'aiFormatting',
                nodeName,
                nodeId,
                i,
                `Error enhancing fields: ${(error as Error).message}`,
                'extractNodeUtils',
                'processExtractionItems'
              )
            );
          }
        }

        // Set up extraction configuration
        const extractionConfig: IExtractionConfig = {
          id: extractionItem.id,
          extractionType: extractionItem.extractionType,
          selector: extractionItem.selector || '',
          attributeName: extractionItem.attribute,
          waitForSelector: extractionNodeOptions.waitForSelector,
          selectorTimeout: extractionNodeOptions.timeout,
          debugMode: isDebugMode,
          preserveFieldStructure: extractionItem.preserveFieldStructure || false,
        };

        // Add ai formatting options if they exist
        if (extractionItem.aiFormatting?.enabled) {
          extractionConfig.smartOptions = {
            ...extractionItem.aiFormatting,
            extractionFormat: extractionItem.aiFormatting.extractionFormat || 'json',
            aiAssistance: true,
            aiModel: extractionItem.aiFormatting.aiModel || 'gpt-3.5-turbo',
            generalInstructions: extractionItem.aiFormatting.generalInstructions || '',
            strategy: extractionItem.aiFormatting.strategy || 'auto',
            includeSchema: extractionItem.aiFormatting.includeSchema || false,
            includeRawData: extractionItem.aiFormatting.includeRawData || false,
            includeReferenceContext: extractionItem.aiFormatting.includeReferenceContext || false,
            referenceSelector: extractionItem.aiFormatting.referenceSelector || '',
            referenceName: extractionItem.aiFormatting.referenceName || 'reference',
            referenceFormat: extractionItem.aiFormatting.referenceFormat || 'text',
            referenceAttribute: extractionItem.aiFormatting.referenceAttribute || '',
            selectorScope: extractionItem.aiFormatting.selectorScope || 'global',
            referenceContent: extractionItem.aiFormatting.referenceContent || '',
            debugMode: isDebugMode
          };

          // Add API key if available
          if (extractionItem.openAiApiKey) {
            extractionConfig.openaiApiKey = extractionItem.openAiApiKey;
          }

          // Add fields if using manual strategy
          if (extractionItem.aiFormatting.strategy === 'manual' && Array.isArray(extractionItem.aiFields)) {
            extractionConfig.fields = {
              items: extractionItem.aiFields.map(field => ({
                name: field.name,
                type: field.type || 'string',
                instructions: field.instructions || '',
                format: field.required ? 'required' : 'optional',
                // Include additional field properties as needed
              }))
            };
          }
        }

        const extraction = createExtraction(extractionItem.puppeteerPage, extractionConfig, context);

        try {
          // Add direct logging before extraction execution
          if (isDebugMode) {
            logWithDebug(
              logger,
              true,
              nodeName,
              'extraction',
              'extractNodeUtils',
              'processExtractionItems',
              `Executing extraction for item ${extractionItem.name}, type: ${extractionItem.extractionType}`,
              'error'
            );
            if (extractionItem.aiFormatting?.smartOptions?.aiAssistance) {
              // Add info about the model and debug mode
              // Add info about the model and debug mode if available
              const aiModel = extractionItem.aiFormatting?.smartOptions?.aiModel || 'unknown';
              const debugMode = extractionItem.aiFormatting?.smartOptions?.debugMode || false;

              logger.debug(
                formatOperationLog(
                  'extraction',
                  nodeName,
                  nodeId,
                  i,
                  `AI is enabled for this extraction with model: ${aiModel}, debugMode: ${debugMode}`,
                  'extractNodeUtils',
                  'processExtractionItems'
                )
              );
            }
          }

          // Execute the extraction
          const result = await extraction.execute();

          // Store the raw data before any AI processing
          extractionItem.rawData = result.rawContent;

          if (result.success) {
            // Log extraction success
            logger.info(
              formatOperationLog(
                'extraction',
                nodeName,
                nodeId,
                i,
                `Extraction successful for [${extractionItem.name}]`,
                'extractNodeUtils',
                'processExtractionItems'
              )
            );

            // Direct log for visibility in debug mode
            if (isDebugMode) {
              logWithDebug(
                logger,
                true,
                nodeName,
                'extraction',
                'extractNodeUtils',
                'processExtractionItems',
                `Extraction successful for [${extractionItem.name}]`,
                'error'
              );
              // Log the actual result data for debugging
              logWithDebug(
                logger,
                true,
                nodeName,
                'extraction',
                'extractNodeUtils',
                'processExtractionItems',
                `Extracted data: ${JSON.stringify(result.data).substring(0, 200)}${result.data && JSON.stringify(result.data).length > 200 ? '...' : ''}`,
                'error'
              );
              if (result.schema) {
                logWithDebug(
                  logger,
                  true,
                  nodeName,
                  'extraction',
                  'extractNodeUtils',
                  'processExtractionItems',
                  `Schema was returned for [${extractionItem.name}]`,
                  'error'
                );
              }
            }

            // Before storing the extracted data, check if it has a proper structure
            if (result.data !== null && typeof result.data === 'object' && !Array.isArray(result.data)) {
              // Check if this might be a nested object structure from field-by-field extraction
              // This is to ensure we maintain hierarchical structures from AI-processed data
              logger.info(
                formatOperationLog(
                  'extraction',
                  nodeName,
                  nodeId,
                  i,
                  `Processed object data for [${extractionItem.name}] with properties: ${Object.keys(result.data).join(', ')}`,
                  'extractNodeUtils',
                  'processExtractionItems'
                )
              );
            }

            // Store extracted data
            extractionItem.extractedData = result.data;

            // If we have a schema from the extraction, store it
            if (result.schema) {
              logger.debug(
                formatOperationLog(
                  'extraction',
                  nodeName,
                  nodeId,
                  i,
                  `Schema found for [${extractionItem.name}]`,
                  'extractNodeUtils',
                  'processExtractionItems'
                )
              );
              extractionItem.schema = result.schema;
            }
          } else {
            logger.warn(
              formatOperationLog(
                'extraction',
                nodeName,
                nodeId,
                i,
                `Extraction failed for [${extractionItem.name}]: ${result.error?.message || 'Unknown error'}`,
                'extractNodeUtils',
                'processExtractionItems'
              )
            );

            // Log detailed error in debug mode
            if (isDebugMode && result.error) {
              logWithDebug(
                logger,
                true,
                nodeName,
                'extraction',
                'extractNodeUtils',
                'processExtractionItems',
                `Extraction error details: ${JSON.stringify(result.error)}`,
                'error'
              );
            }
          }
        } catch (error) {
          logger.warn(
            formatOperationLog(
              'extraction',
              nodeName,
              nodeId,
              i,
              `Error executing extraction: ${(error as Error).message}`,
              'extractNodeUtils',
              'processExtractionItems'
            )
          );
        }
      } catch (error) {
        logger.warn(
          formatOperationLog(
            'extraction',
            nodeName,
            nodeId,
            i,
            `Error processing extraction item: ${(error as Error).message}`,
            'extractNodeUtils',
            'processExtractionItems'
          )
        );
      }
    } else {
      logger.warn(
        formatOperationLog(
          'extraction',
          nodeName,
          nodeId,
          i,
          `No puppeteer page available for extraction item: ${extractionItem.name}`,
          'extractNodeUtils',
          'processExtractionItems'
        )
      );
    }

    typedExtractionItems.push(extractionItem);
  }

  return typedExtractionItems;
}
