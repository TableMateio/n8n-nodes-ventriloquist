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
  };
  aiFields?: Array<{
    name: string;
    description?: string;
    instructions?: string;
    type?: string;
    required?: boolean;
    relativeSelectorOptional?: string;
    returnDirectAttribute?: boolean;
    referenceContent?: string;
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
  context: string = ''
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
    console.error(`Error extracting reference content (${format}, scope: ${selectorScope}): ${error}`);
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

  // Log global extraction options
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
      })}`
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
        `Processing extraction item [${extractionItem.name}] with type [${extractionItem.extractionType}]`
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
          `Item ${extractionItem.name} has AI formatting enabled, API key available: ${!!extractionItem.openAiApiKey}`
        )
      );
    }

    // Create extraction configuration based on the extraction type
    let extractionConfig: IExtractionConfig = {
      extractionType: extractionItem.extractionType,
      selector: extractionItem.selector || '',
      attributeName: extractionItem.attribute,
      waitForSelector: extractionNodeOptions.waitForSelector,
      selectorTimeout: extractionNodeOptions.timeout,
      cleanText: extractionItem.textOptions?.cleanText,
      // Initialize smartOptions based on the item's own AI formatting setting, not the node-level setting
      smartOptions: extractionItem.aiFormatting?.enabled === true ? {
        aiAssistance: true, // Explicitly set to true
        extractionFormat: extractionItem.aiFormatting.extractionFormat || 'json',
        aiModel: extractionItem.aiFormatting.aiModel || 'gpt-3.5-turbo',
        generalInstructions: extractionItem.aiFormatting.generalInstructions || '',
        strategy: extractionItem.aiFormatting.strategy || 'auto',
        includeSchema: extractionItem.aiFormatting.includeSchema === true,
        includeRawData: extractionItem.aiFormatting.includeRawData === true,
        includeReferenceContext: extractionItem.aiFormatting.includeReferenceContext === true,
        referenceSelector: extractionItem.aiFormatting.referenceSelector || '',
        referenceName: extractionItem.aiFormatting.referenceName || 'referenceContext',
        referenceFormat: extractionItem.aiFormatting.referenceFormat || 'text',
        referenceAttribute: extractionItem.aiFormatting.referenceAttribute || '',
        selectorScope: extractionItem.aiFormatting.selectorScope || 'global',
        referenceContent: extractionItem.aiFormatting.referenceContent || ''
      } : undefined,
      // Directly set the OpenAI API key in the extraction config
      openaiApiKey: (extractionItem.aiFormatting?.enabled && openAiApiKey) ? openAiApiKey : undefined
    };

    // IMPORTANT: Handle attribute extraction for link fields even when AI is disabled
    // Check if this is a href attribute extraction
    if (extractionItem.extractionType === 'attribute' && extractionItem.attribute === 'href') {
      // Set up field information for direct attribute handling
      if (!extractionItem.aiFields) {
        extractionItem.aiFields = [];
      }

      // Only add if not already in aiFields
      const hasHrefField = extractionItem.aiFields.some(f =>
        f.fieldOptions?.extractionType === 'attribute' &&
        f.fieldOptions?.attributeName === 'href');

      if (!hasHrefField) {
        // Add a special field for href attribute handling
        extractionItem.aiFields.push({
          name: extractionItem.name,
          type: 'string',
          instructions: `Extract the href attribute from the element.`,
          returnDirectAttribute: true, // This is a special property we'll look for later
          relativeSelectorOptional: '', // We don't need this for non-AI extraction
        });

        logger.debug(
          formatOperationLog(
            'extraction',
            nodeName,
            nodeId,
            i,
            `Added special href field handling for non-AI extraction: ${extractionItem.name}`
          )
        );
      }
    }

    // Configure the smart extraction options
    // Map extractionType to extractionFormat for AI Assistance
    const extractionTypeToFormat: Record<string, string> = {
      text: 'text',
      html: 'html',
      table: 'table',
      csv: 'csv',
      multiple: 'array',
      attribute: 'attribute',
      value: 'value',
    };
    const mappedExtractionFormat = extractionTypeToFormat[extractionItem.extractionType] || 'json';
    logger.debug(
      formatOperationLog(
        'aiFormatting',
        nodeName,
        nodeId,
        i,
        `Mapped extractionType '${extractionItem.extractionType}' to extractionFormat '${mappedExtractionFormat}'`
      )
    );

    // Make sure AI is only enabled when specifically requested
    if (extractionItem.aiFormatting?.enabled === true) {
      logger.info(
        formatOperationLog(
          'aiFormatting',
          nodeName,
          nodeId,
          i,
          `Setting up AI formatting for item ${extractionItem.name} (strategy: ${extractionItem.aiFormatting.strategy || 'auto'})`
        )
      );

      // Add fields for manual strategy
      if (extractionItem.aiFields && extractionItem.aiFormatting.strategy === 'manual') {
        logger.debug(
          formatOperationLog(
            'aiFormatting',
            nodeName,
            nodeId,
            i,
            `Using manual strategy with ${extractionItem.aiFields.length} fields`
          )
        );

        extractionConfig.fields = {
          items: extractionItem.aiFields.map(field => {
            return {
              name: field.name,
              type: field.type || 'string',
              // Map field.instructions directly to instructions property in the IField interface
              // which will become the description in the OpenAI schema
              instructions: field.instructions || field.description || '',
              format: field.required ? 'required' : 'default',
              // Update to use the new field options
              useLogicAnalysis: field.fieldOptions?.aiProcessingMode === 'logical',
              useSeparateThread: field.fieldOptions?.threadManagement === 'separate'
            };
          })
        };
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
            `OpenAI API key provided for extraction (length: ${openAiApiKey.length})`
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
            `No OpenAI API key provided - AI processing will be skipped`
          )
        );
      }
    } else {
      // Ensure AI processing is disabled when not explicitly enabled
      extractionConfig.smartOptions = undefined;
      extractionItem.hasOpenAiApiKey = false;
    }

    // Add specific options for different extraction types
    if (extractionItem.extractionType === 'table' && extractionItem.tableOptions) {
      extractionConfig = {
        ...extractionConfig,
        includeHeaders: extractionItem.tableOptions.includeHeaders,
        rowSelector: extractionItem.tableOptions.rowSelector,
        cellSelector: extractionItem.tableOptions.cellSelector,
        outputFormat: extractionItem.tableOptions.outputFormat
      };
    } else if (extractionItem.extractionType === 'multiple' && extractionItem.multipleOptions) {
      extractionConfig = {
        ...extractionConfig,
        extractionProperty: extractionItem.multipleOptions.extractionProperty,
        limit: extractionItem.multipleOptions.outputLimit,
        separator: extractionItem.multipleOptions.separator,
        outputFormat: extractionItem.multipleOptions.outputFormat,
        cleanText: extractionItem.multipleOptions.cleanText
      };
    } else if (extractionItem.extractionType === 'html' && extractionItem.htmlOptions) {
      extractionConfig = {
        ...extractionConfig,
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
                    `Using current page URL as reference context: ${referenceContent}`
                  )
                );
              } catch (urlError) {
                logger.warn(
                  formatOperationLog(
                    'aiFormatting',
                    nodeName,
                    nodeId,
                    i,
                    `Error getting current page URL: ${(urlError as Error).message}`
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
                  `Extracting reference context using selector "${referenceSelector}" (format: ${referenceFormat}, scope: ${selectorScope}${referenceFormat === 'attribute' ? `, attribute: ${referenceAttribute}` : ''})`
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
                        console.error('Error in text extraction:', err);
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
                        console.error('Error in HTML extraction:', err);
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
                        console.error('Error in attribute extraction:', err);
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
                        console.error('Error in relative text extraction:', err);
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
                        console.error('Error in relative HTML extraction:', err);
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
                          console.error('Error in relative attribute extraction:', err);
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
                    `Error in reference extraction (${referenceFormat}): ${(extractionError as Error).message}`
                  )
                );
              }
            }

            // Store the reference content in the AI formatting options if we got any
            if (referenceContent) {
              extractionItem.aiFormatting.referenceContent = referenceContent.trim();

              // Add reference content to extraction config
              if (extractionConfig.smartOptions) {
                extractionConfig.smartOptions.referenceContent = referenceContent.trim();
              }

              // Log more detailed info for attribute extractions
              if (referenceFormat === 'attribute') {
                logger.info(
                  formatOperationLog(
                    'aiFormatting',
                    nodeName,
                    nodeId,
                    i,
                    `Attribute "${referenceAttribute}" extracted successfully: ${referenceContent.substring(0, 100)}${referenceContent.length > 100 ? '...' : ''}`
                  )
                );
              } else {
                logger.debug(
                  formatOperationLog(
                    'aiFormatting',
                    nodeName,
                    nodeId,
                    i,
                    `Reference context extracted successfully as ${referenceSelector ? referenceFormat : 'URL'} (${referenceContent.length} chars)`
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
                    : 'Failed to get URL for reference context'
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
                `Error extracting reference context: ${(error as Error).message}`
              )
            );
          }
        }

        // If we have aiFields and relativeSelectorOptional values, enhance them with extracted content
        if (extractionItem.aiFields && extractionItem.aiFields.length > 0 && extractionItem.puppeteerPage && extractionItem.selector) {
          try {
            // Add additional logging to see if fields have relativeSelectorOptional property
            const fieldsWithRelativeSelectors = extractionItem.aiFields.filter(f =>
              f.relativeSelectorOptional && typeof f.relativeSelectorOptional === 'string' && f.relativeSelectorOptional.trim() !== '');

            logger.info(
              formatOperationLog(
                'aiFormatting',
                nodeName,
                nodeId,
                i,
                `Found ${fieldsWithRelativeSelectors.length} fields with relative selectors: ${fieldsWithRelativeSelectors.map(f =>
                  `${f.name}:${f.relativeSelectorOptional}`).join(', ')}`
              )
            );

            // Transform the fields to ensure they match the IOpenAIField interface
            const transformedFields = extractionItem.aiFields.map(field => ({
              ...field,
              instructions: field.instructions || field.description || '',
              relativeSelectorOptional: field.relativeSelectorOptional || '',
              format: field.fieldOptions?.format || 'string',
              type: field.type || 'string',
            }));

            logger.debug(
              formatOperationLog(
                'aiFormatting',
                nodeName,
                nodeId,
                i,
                `Enhancing fields with relative selector content using selector: ${extractionItem.selector}`
              )
            );

            // Enhance fields with content from relative selectors
            const enhancedFields = await enhanceFieldsWithRelativeSelectorContent(
              transformedFields,
              extractionItem.puppeteerPage,
              extractionItem.selector
            );

            // Copy the enhanced instructions back to the original aiFields
            for (let i = 0; i < extractionItem.aiFields.length; i++) {
              if (i < enhancedFields.length) {
                if (extractionItem.aiFields[i].instructions !== enhancedFields[i].instructions) {
                  logger.info(
                    formatOperationLog(
                      'aiFormatting',
                      nodeName,
                      nodeId,
                      i,
                      `Field "${extractionItem.aiFields[i].name}" instructions were enhanced with content`
                    )
                  );
                }
                extractionItem.aiFields[i].instructions = enhancedFields[i].instructions;
              }
            }

            logger.debug(
              formatOperationLog(
                'aiFormatting',
                nodeName,
                nodeId,
                i,
                `Enhanced ${extractionItem.aiFields.length} fields with relative selector content`
              )
            );
          } catch (error) {
            logger.warn(
              formatOperationLog(
                'aiFormatting',
                nodeName,
                nodeId,
                i,
                `Error enhancing fields with relative selector content: ${(error as Error).message}`
              )
            );
          }
        }

        // Create and execute the extraction
        const extraction = createExtraction(extractionItem.puppeteerPage, extractionConfig, context);

        try {
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
                `Extraction successful for [${extractionItem.name}]`
              )
            );

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
                  `Schema found for [${extractionItem.name}]`
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
                `Extraction failed for [${extractionItem.name}]`
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
              `Error executing extraction: ${(error as Error).message}`
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
            `Error processing extraction item: ${(error as Error).message}`
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
          `No puppeteer page available for extraction item: ${extractionItem.name}`
        )
      );
    }

    typedExtractionItems.push(extractionItem);
  }

  return typedExtractionItems;
}
