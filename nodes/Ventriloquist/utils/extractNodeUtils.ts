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
      `Processing ${extractionItems.length} extraction items with debug mode ON`,
      'error'
    );
  }

  logger.info(
    formatOperationLog(
      'extraction',
      nodeName,
      nodeId,
      0,
      `Processing ${extractionItems.length} extraction items with options: ${JSON.stringify({
        waitForSelector: extractionNodeOptions.waitForSelector,
        timeout: extractionNodeOptions.timeout,
        continueOnFail: extractionNodeOptions.continueOnFail,
        debugMode: extractionNodeOptions.debugMode,
      })}`,
      'extractNodeUtils',
      'processExtractionItems'
    )
  );

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
            // Add additional logging to see if fields have relativeSelectorOptional property
            const fieldsWithRelativeSelectors = extractionItem.aiFields.filter(f =>
              (f.relativeSelectorOptional && typeof f.relativeSelectorOptional === 'string' && f.relativeSelectorOptional.trim() !== '') ||
              (f.relativeSelector && typeof f.relativeSelector === 'string' && f.relativeSelector.trim() !== ''));

            logger.info(
              formatOperationLog(
                'aiFormatting',
                nodeName,
                nodeId,
                i,
                `Found ${fieldsWithRelativeSelectors.length} fields with relative selectors: ${fieldsWithRelativeSelectors.map(f =>
                  `${f.name}:${f.relativeSelectorOptional || f.relativeSelector}`).join(', ')}`,
                'extractNodeUtils',
                'processExtractionItems'
              )
            );

            // Transform the fields to ensure they match the IOpenAIField interface
            const transformedFields = extractionItem.aiFields.map(field => {
              // Get extraction type and attribute name from field options
              const fieldOptions = field.fieldOptions || {};
              const extractionType = fieldOptions.extractionType || 'text';
              const attributeName = fieldOptions.attributeName || '';
              // Check if this is an AI-assisted field by looking at relativeSelectorOptional instead of aiAssisted
              const aiAssisted = !!field.relativeSelectorOptional;

              // Log detailed information about the field
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

              return {
                ...field,
                instructions: field.instructions || field.description || '',
                // Explicitly pass both selector types to preserve field mode (AI vs non-AI)
                relativeSelectorOptional: field.relativeSelectorOptional || '',
                relativeSelector: field.relativeSelector || '',
                // Store the aiAssisted flag to help with processing
                aiAssisted: aiAssisted,
                format: fieldOptions.format || 'string',
                type: field.type || 'string',
                // Always pass the extraction type and attribute name from field options
                extractionType: extractionType,
                attributeName: attributeName,
              };
            });

            logger.debug(
              formatOperationLog(
                'aiFormatting',
                nodeName,
                nodeId,
                i,
                `Enhancing fields with relative selector content using selector: ${extractionItem.selector}`,
                'extractNodeUtils',
                'processExtractionItems'
              )
            );

            // Add more detailed logging for field options
            transformedFields.forEach(field => {
              if (field.relativeSelectorOptional) {
                logger.debug(
                  formatOperationLog(
                    'aiFormatting',
                    nodeName,
                    nodeId,
                    i,
                    `Field "${field.name}" config: ` +
                    `selector="${field.relativeSelectorOptional}", ` +
                    `type="${field.extractionType || 'text'}", ` +
                    `attribute="${field.attributeName || 'none'}", ` +
                    `AIMode=${!!field.relativeSelectorOptional}`,
                    'extractNodeUtils',
                    'processExtractionItems'
                  )
                );

                // TEMPORARY DEBUG: Log detailed field properties
                logWithDebug(
                  logger,
                  true,
                  nodeName,
                  'extraction',
                  'extractNodeUtils',
                  'processExtractionItems',
                  `Field "${field.name}" config for attribute extraction:`,
                  'error'
                );
                logWithDebug(
                  logger,
                  true,
                  nodeName,
                  'extraction',
                  'extractNodeUtils',
                  'processExtractionItems',
                  `selector="${field.relativeSelectorOptional}", type="${field.extractionType}", attribute="${field.attributeName}"`,
                  'error'
                );
                logWithDebug(
                  logger,
                  true,
                  nodeName,
                  'extraction',
                  'extractNodeUtils',
                  'processExtractionItems',
                  `instructions="${field.instructions?.substring(0, 50)}..."`,
                  'error'
                );
                logWithDebug(
                  logger,
                  true,
                  nodeName,
                  'extraction',
                  'extractNodeUtils',
                  'processExtractionItems',
                  `field object keys: ${Object.keys(field).join(', ')}`,
                  'error'
                );

                // CRITICAL DEBUG: Check specifically for attribute extraction type fields
                if (field.extractionType === 'attribute' && field.attributeName) {
                  logWithDebug(
                    logger,
                    true,
                    nodeName,
                    'extraction',
                    'extractNodeUtils',
                    'processExtractionItems',
                    `CRITICAL: Found attribute extraction field "${field.name}"`,
                    'error'
                  );
                  logWithDebug(
                    logger,
                    true,
                    nodeName,
                    'extraction',
                    'extractNodeUtils',
                    'processExtractionItems',
                    `attribute=${field.attributeName}, selector=${field.relativeSelectorOptional}`,
                    'error'
                  );
                  logWithDebug(
                    logger,
                    true,
                    nodeName,
                    'extraction',
                    'extractNodeUtils',
                    'processExtractionItems',
                    `Will test if element exists and has this attribute...`,
                    'error'
                  );

                  // Add immediate test to see if the selector can find the element and attribute
                  try {
                    extractionItem.puppeteerPage.evaluate(
                      (mainSel: string, relSel: string, attr: string) => {
                        const parent = document.querySelector(mainSel);
                        if (!parent) {
                          logWithDebug(
                            logger,
                            true,
                            nodeName,
                            'extraction',
                            'extractNodeUtils',
                            'processExtractionItems',
                            `CRITICAL: Parent element not found: ${mainSel}`,
                            'error'
                          );
                          return false;
                        }

                        const el = parent.querySelector(relSel);
                        if (!el) {
                          logWithDebug(
                            logger,
                            true,
                            nodeName,
                            'extraction',
                            'extractNodeUtils',
                            'processExtractionItems',
                            `CRITICAL: Element not found with selector: ${relSel}`,
                            'error'
                          );
                          return false;
                        }

                        if (!el.hasAttribute(attr)) {
                          logWithDebug(
                            logger,
                            true,
                            nodeName,
                            'extraction',
                            'extractNodeUtils',
                            'processExtractionItems',
                            `CRITICAL: Element found but doesn't have attribute: ${attr}`,
                            'error'
                          );
                          return false;
                        }

                        const value = el.getAttribute(attr);
                        logWithDebug(
                          logger,
                          true,
                          nodeName,
                          'extraction',
                          'extractNodeUtils',
                          'processExtractionItems',
                          `CRITICAL: Found element with ${attr}="${value}"`,
                          'error'
                        );
                        return true;
                      },
                      extractionItem.selector,
                      field.relativeSelectorOptional,
                      field.attributeName
                    ).then((result: boolean) => {
                      logWithDebug(
                        logger,
                        true,
                        nodeName,
                        'extraction',
                        'extractNodeUtils',
                        'processExtractionItems',
                        `Selector test result: ${result ? 'SUCCESS' : 'FAILURE'}`,
                        'error'
                      );
                    }).catch((err: Error) => {
                      logWithDebug(
                        logger,
                        true,
                        nodeName,
                        'extraction',
                        'extractNodeUtils',
                        'processExtractionItems',
                        `Selector test error: ${err.message}`,
                        'error'
                      );
                    });
                  } catch (e: any) {
                    logWithDebug(
                      logger,
                      true,
                      nodeName,
                      'extraction',
                      'extractNodeUtils',
                      'processExtractionItems',
                      `Selector test exception: ${e.message}`,
                      'error'
                    );
                  }
                }
              }
            });

            // Extract the HTML content of the main selector to pass to the enhancement function
            let rawHtml = '';
            try {
              // Define the response type
              interface HtmlEvaluateResult {
                html: string;
                success: boolean;
                message: string;
              }

              // Get the HTML content of the main selector
              const evalResult = await extractionItem.puppeteerPage.evaluate((selector: string) => {
                try {
                  const element = document.querySelector(selector);
                  if (element) {
                    // Don't use logWithDebug in browser context
                    return {
                      html: element.outerHTML,
                      success: true,
                      message: 'Found main selector element, getting HTML content'
                    };
                  } else {
                    // Don't use logWithDebug in browser context
                    return {
                      html: '',
                      success: false,
                      message: `Main selector element not found: ${selector}`
                    };
                  }
                } catch (error) {
                  // Don't use logWithDebug in browser context
                  return {
                    html: '',
                    success: false,
                    message: `Error getting HTML content: ${error}`
                  };
                }
              }, extractionItem.selector) as HtmlEvaluateResult;

              // Process the result from evaluate
              if (evalResult.success) {
                logger.debug(
                  formatOperationLog(
                    'aiFormatting',
                    nodeName,
                    nodeId,
                    i,
                    `Successfully extracted HTML content from main selector (${evalResult.html.length} chars)`,
                    'extractNodeUtils',
                    'processExtractionItems'
                  )
                );
                logWithDebug(
                  logger,
                  true,
                  nodeName,
                  'extraction',
                  'extractNodeUtils',
                  'processExtractionItems',
                  `Successfully extracted HTML content from main selector (${evalResult.html.length} chars)`,
                  'error'
                );
                // Assign the HTML content
                rawHtml = evalResult.html;
              } else {
                logger.warn(
                  formatOperationLog(
                    'aiFormatting',
                    nodeName,
                    nodeId,
                    i,
                    `Failed to extract HTML content from main selector: ${evalResult.message}`,
                    'extractNodeUtils',
                    'processExtractionItems'
                  )
                );
                logWithDebug(
                  logger,
                  true,
                  nodeName,
                  'extraction',
                  'extractNodeUtils',
                  'processExtractionItems',
                  `Failed to extract HTML content from main selector: ${evalResult.message}`,
                  'error'
                );
                rawHtml = '';
              }
            } catch (error) {
              logger.error(
                formatOperationLog(
                  'aiFormatting',
                  nodeName,
                  nodeId,
                  i,
                  `Error extracting HTML content from main selector: ${(error as Error).message}`,
                  'extractNodeUtils',
                  'processExtractionItems'
                )
              );
              logWithDebug(
                logger,
                true,
                nodeName,
                'extraction',
                'extractNodeUtils',
                'processExtractionItems',
                `Error extracting HTML content from main selector: ${(error as Error).message}`,
                'error'
              );
              rawHtml = '';
            }

            // Enhance fields with content from relative selectors
            const enhancedFields = await enhanceFieldsWithRelativeSelectorContent(
              transformedFields,
              extractionItem.puppeteerPage,
              extractionItem.selector,
              logger,
              { nodeName, nodeId, index: i, debugMode: isDebugMode },
              rawHtml // Pass the HTML content to the enhancement function
            );

            // Log the enhanced fields to check if content was properly added
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

            enhancedFields.forEach(field => {
              const hasRefContent = !!(field as any).referenceContent;
              const isDirectAttr = !!(field as any).returnDirectAttribute;

              logger.debug(
                formatOperationLog(
                  'aiFormatting',
                  nodeName,
                  nodeId,
                  i,
                  `Field "${field.name}": hasReferenceContent=${hasRefContent}, directAttribute=${isDirectAttr}, ` +
                  `instructionsLength=${field.instructions?.length || 0}`,
                  'extractNodeUtils',
                  'processExtractionItems'
                )
              );

              // TEMPORARY DEBUG: Log enhanced field details
              logWithDebug(
                logger,
                true,
                nodeName,
                'extraction',
                'extractNodeUtils',
                'processExtractionItems',
                `AFTER ENHANCEMENT - Field "${field.name}" enhancement results:`,
                'error'
              );
              logWithDebug(
                logger,
                true,
                nodeName,
                'extraction',
                'extractNodeUtils',
                'processExtractionItems',
                `hasReferenceContent=${hasRefContent}, directAttribute=${isDirectAttr}`,
                'error'
              );
              logWithDebug(
                logger,
                true,
                nodeName,
                'extraction',
                'extractNodeUtils',
                'processExtractionItems',
                `instructionsLength=${field.instructions?.length || 0}`,
                'error'
              );
              logWithDebug(
                logger,
                true,
                nodeName,
                'extraction',
                'extractNodeUtils',
                'processExtractionItems',
                `instructions="${field.instructions?.substring(0, 100)}..."`,
                'error'
              );
              if (hasRefContent) {
                logWithDebug(
                  logger,
                  true,
                  nodeName,
                  'extraction',
                  'extractNodeUtils',
                  'processExtractionItems',
                  `referenceContent="${(field as any).referenceContent?.substring(0, 50)}..."`,
                  'error'
                );
              }
            });

            // Copy the enhanced instructions back to the original aiFields
            for (let j = 0; j < extractionItem.aiFields.length; j++) {
              if (j < enhancedFields.length) {
                // Log when instructions are enhanced
                if (extractionItem.aiFields[j].instructions !== enhancedFields[j].instructions) {
                  logger.debug(
                    formatOperationLog(
                      'aiFormatting',
                      nodeName,
                      nodeId,
                      i,
                      `Field "${extractionItem.aiFields[j].name}" instructions were enhanced: ` +
                      `original length=${extractionItem.aiFields[j].instructions?.length || 0}, ` +
                      `new length=${enhancedFields[j].instructions?.length || 0}`,
                      'extractNodeUtils',
                      'processExtractionItems'
                    )
                  );
                }

                // ALWAYS copy these properties, regardless of whether it's an AI field or not
                // These properties are critical for both types of fields
                extractionItem.aiFields[j].instructions = enhancedFields[j].instructions;
                extractionItem.aiFields[j].referenceContent = enhancedFields[j].referenceContent;
                extractionItem.aiFields[j].returnDirectAttribute = enhancedFields[j].returnDirectAttribute;

                // Provide detailed log about what's being copied
                logger.debug(
                  formatOperationLog(
                    'aiFormatting',
                    nodeName,
                    nodeId,
                    i,
                    `Field "${extractionItem.aiFields[j].name}" properties:`,
                    'extractNodeUtils',
                    'processExtractionItems'
                  )
                );
              }
            }

            logger.debug(
              formatOperationLog(
                'aiFormatting',
                nodeName,
                nodeId,
                i,
                `Enhanced ${extractionItem.aiFields.length} fields with relative selector content`,
                'extractNodeUtils',
                'processExtractionItems'
              )
            );
          } catch (error) {
            logger.warn(
              formatOperationLog(
                'aiFormatting',
                nodeName,
                nodeId,
                i,
                `Error enhancing fields with relative selector content: ${(error as Error).message}`,
                'extractNodeUtils',
                'processExtractionItems'
              )
            );
          }
        }

        // Create extraction configuration based on AI formatting options
        const aiConfig: IExtractionConfig = {
          extractionType: extractionItem.extractionType, // Use the original extraction type (table, text, etc.)
          selector: extractionItem.selector || '',
          debugMode: extractionItem.aiFormatting?.smartOptions?.debugMode || false,
          smartOptions: {
            aiAssistance: true,
            extractionFormat: extractionItem.aiFormatting?.extractionFormat || 'json',
            aiModel: extractionItem.aiFormatting?.aiModel || 'gpt-3.5-turbo',
            generalInstructions: extractionItem.aiFormatting?.generalInstructions || '',
            strategy: extractionItem.aiFormatting?.strategy || 'manual',
            includeSchema: extractionItem.aiFormatting?.includeSchema || false,
            includeRawData: extractionItem.aiFormatting?.includeRawData || false,
            includeReferenceContext: extractionItem.aiFormatting?.includeReferenceContext || false,
            referenceSelector: extractionItem.aiFormatting?.referenceSelector || '',
            referenceName: extractionItem.aiFormatting?.referenceName || 'referenceContext',
            referenceFormat: extractionItem.aiFormatting?.referenceFormat || 'text',
            referenceAttribute: extractionItem.aiFormatting?.referenceAttribute || '',
            selectorScope: extractionItem.aiFormatting?.selectorScope || 'global',
            debugMode: extractionItem.aiFormatting?.smartOptions?.debugMode || false
          },
          openaiApiKey: extractionItem.openAiApiKey,
          waitForSelector: false,
          selectorTimeout: 5000,
          // Include table options if applicable
          ...(extractionItem.tableOptions && {
            includeHeaders: extractionItem.tableOptions.includeHeaders,
            rowSelector: extractionItem.tableOptions.rowSelector,
            cellSelector: extractionItem.tableOptions.cellSelector,
            outputFormat: extractionItem.tableOptions.outputFormat
          }),
          // Include HTML options if applicable
          ...(extractionItem.htmlOptions && {
            outputFormat: extractionItem.htmlOptions.outputFormat,
            includeMetadata: extractionItem.htmlOptions.includeMetadata
          }),
          // Include text options if applicable
          ...(extractionItem.textOptions && {
            cleanText: extractionItem.textOptions.cleanText
          }),
          // Include fields for AI processing
          fields: {
            items: extractionItem.aiFields?.map(field => ({
              name: field.name,
              type: field.type || 'string',
              instructions: field.instructions || '',
              format: (field.fieldOptions?.format as string) || 'default'
            })) || []
          }
        };

        const extraction = createExtraction(extractionItem.puppeteerPage, aiConfig, context);

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
