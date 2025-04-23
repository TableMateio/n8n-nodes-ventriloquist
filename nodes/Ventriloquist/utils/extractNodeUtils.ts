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

/**
 * Interface for extraction node options
 */
export interface IExtractionNodeOptions {
  nodeName?: string;
  nodeId?: string;
  enableAiFormatting?: boolean;
  extractionFormat?: string;
  aiModel?: string;
  generalInstructions?: string;
  strategy?: string;
  includeSchema?: boolean;
  includeRawData?: boolean;
  includeReferenceContext?: boolean;
  referenceSelector?: string;
  referenceName?: string;
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
    referenceContent?: string; // Will store the extracted reference content
  };
  aiFields?: Array<{
    name: string;
    description?: string;
    type?: string;
    required?: boolean;
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
  logger.debug(formatOperationLog('extraction', nodeName, nodeId, 0, `Starting extraction process with ${extractionItems.length} items`));

  // Return early if there are no extraction items
  if (!extractionItems || extractionItems.length === 0) {
    logger.debug(formatOperationLog('extraction', nodeName, nodeId, 0, 'No extraction items to process'));
    return [];
  }

  // Process each extraction item
  const typedExtractionItems: IExtractItem[] = [];

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
        enableAiFormatter: true,
        extractionFormat: 'json',
        aiModel: 'gpt-3.5-turbo',
        generalInstructions: '',
        strategy: 'auto',
        includeSchema: false,
        includeRawData: false
      } : undefined
    };

    // Handle AI formatting settings if enabled - fix indentation
    if (extractionItem.aiFormatting?.enabled === true) {
      // Ensure the AI formatting settings are properly set
      extractionItem.aiFormatting = {
        enabled: true,
        extractionFormat: extractionItem.aiFormatting.extractionFormat || extractionNodeOptions.extractionFormat || 'json',
        aiModel: extractionItem.aiFormatting.aiModel || extractionNodeOptions.aiModel || 'gpt-3.5-turbo',
        generalInstructions: extractionItem.aiFormatting.generalInstructions || extractionNodeOptions.generalInstructions || '',
        strategy: extractionItem.aiFormatting.strategy || extractionNodeOptions.strategy || 'auto',
        includeSchema: extractionItem.aiFormatting.includeSchema === true || extractionNodeOptions.includeSchema === true,
        includeRawData: extractionItem.aiFormatting.includeRawData === true || extractionNodeOptions.includeRawData === true,
        includeReferenceContext: extractionItem.aiFormatting.includeReferenceContext === true || extractionNodeOptions.includeReferenceContext === true,
        referenceSelector: extractionItem.aiFormatting.referenceSelector || extractionNodeOptions.referenceSelector || '',
        referenceName: extractionItem.aiFormatting.referenceName || extractionNodeOptions.referenceName || 'referenceContext'
      };

      // Add AI fields if provided
      if (extractionNodeOptions.aiFields && extractionNodeOptions.aiFields.items) {
        extractionItem.aiFields = extractionNodeOptions.aiFields.items;
      }

      // Configure the smart extraction options
      extractionConfig.smartOptions = {
        extractionFormat: extractionItem.aiFormatting.extractionFormat,
        enableAiFormatter: true,
        aiModel: extractionItem.aiFormatting.aiModel,
        generalInstructions: extractionItem.aiFormatting.generalInstructions,
        strategy: extractionItem.aiFormatting.strategy,
        includeSchema: extractionItem.aiFormatting.includeSchema,
        includeRawData: extractionItem.aiFormatting.includeRawData,
        includeReferenceContext: extractionItem.aiFormatting.includeReferenceContext,
        referenceSelector: extractionItem.aiFormatting.referenceSelector,
        referenceName: extractionItem.aiFormatting.referenceName
      };

      // Add fields for manual strategy
      if (extractionItem.aiFields && extractionItem.aiFormatting.strategy === 'manual') {
        extractionConfig.fields = {
          items: extractionItem.aiFields.map(field => ({
            name: field.name,
            type: field.type || 'string',
            instructions: field.description || '',
            format: 'default'
          }))
        };
      }

      // Auto-detect content type if set to 'auto'
      if (extractionItem.aiFormatting.extractionFormat === 'auto' && extractionItem.extractedData) {
        const detectedType = detectContentType(extractionItem.extractedData);
        logger.debug(
          formatOperationLog(
            'aiFormatting',
            nodeName,
            nodeId,
            i,
            `Auto-detected content type: ${detectedType}`
          )
        );
        extractionItem.aiFormatting.extractionFormat = detectedType;
      }

      // Set OpenAI API key for processing (not for output)
      // The actual key should not be exposed in the result
      if (openAiApiKey) {
        // Only store a boolean flag in the extractionItem for output
        // Only set hasOpenAiApiKey when AI formatting is enabled for this specific item
        extractionItem.hasOpenAiApiKey = true;
        // Use the actual key only in the extraction config which won't be included in output
        extractionConfig.openaiApiKey = openAiApiKey;
      }
    } else {
      // Ensure hasOpenAiApiKey is not set when AI formatting is not enabled
      extractionItem.hasOpenAiApiKey = false;
      // Also ensure aiFormatting is properly set to disabled
      extractionItem.aiFormatting = { enabled: false };
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
            extractionItem.aiFormatting?.includeReferenceContext &&
            extractionItem.aiFormatting?.referenceSelector) {
          try {
            logger.debug(
              formatOperationLog(
                'aiFormatting',
                nodeName,
                nodeId,
                i,
                `Extracting reference context using selector: ${extractionItem.aiFormatting.referenceSelector}`
              )
            );

            // Extract the reference content as text
            const referenceContent = await extractionItem.puppeteerPage.evaluate(
              (selector: string) => {
                const element = document.querySelector(selector);
                if (element) {
                  return element.textContent || '';
                }
                return '';
              },
              extractionItem.aiFormatting.referenceSelector
            );

            // Store the reference content in the AI formatting options
            if (referenceContent) {
              extractionItem.aiFormatting.referenceContent = referenceContent.trim();

              // Add reference content to extraction config
              if (extractionConfig.smartOptions) {
                extractionConfig.smartOptions.referenceContent = referenceContent.trim();
              }

              logger.debug(
                formatOperationLog(
                  'aiFormatting',
                  nodeName,
                  nodeId,
                  i,
                  `Reference context extracted successfully (${referenceContent.length} chars)`
                )
              );
            } else {
              logger.warn(
                formatOperationLog(
                  'aiFormatting',
                  nodeName,
                  nodeId,
                  i,
                  `No reference context found for selector: ${extractionItem.aiFormatting.referenceSelector}`
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

        // Create and execute the extraction
        const extraction = createExtraction(extractionItem.puppeteerPage, extractionConfig, context);
        const result = await extraction.execute();

        if (result.success) {
          // Store the original raw text before AI processing if raw data is requested
          if (extractionItem.aiFormatting?.includeRawData) {
            extractionItem.rawData = result.rawContent;
          }

          // Store the extracted data in the extraction item
          extractionItem.extractedData = result.data;

          // Store schema if available and includeSchema is true
          if (result.schema && extractionItem.aiFormatting?.includeSchema) {
            extractionItem.schema = result.schema;
          }

          logger.debug(
            formatOperationLog(
              'extraction',
              nodeName,
              nodeId,
              i,
              `Extraction successful for [${extractionItem.name}]`
            )
          );
        } else {
          // Log extraction failure
          logger.warn(
            formatOperationLog(
              'extraction',
              nodeName,
              nodeId,
              i,
              `Extraction failed for [${extractionItem.name}]: ${result.error?.message}`
            )
          );

          // Store error message if extraction failed
          extractionItem.extractedData = { error: result.error?.message };
        }
      } catch (error) {
        logger.error(
          formatOperationLog(
            'extraction',
            nodeName,
            nodeId,
            i,
            `Error during extraction for [${extractionItem.name}]: ${(error as Error).message}`
          )
        );

        // Store error message if exception occurred
        extractionItem.extractedData = { error: (error as Error).message };
      }
    } else {
      logger.warn(
        formatOperationLog(
          'extraction',
          nodeName,
          nodeId,
          i,
          `No puppeteer page available for [${extractionItem.name}]`
        )
      );

      // Store error message if no puppeteer page
      extractionItem.extractedData = { error: 'No puppeteer page available' };
    }

    // Remove API key from the output
    if (extractionItem.openAiApiKey) {
      delete extractionItem.openAiApiKey;
    }

    // Add extraction item to the list of typed extraction items
    typedExtractionItems.push(extractionItem);

    logger.debug(
      formatOperationLog(
        'extraction',
        nodeName,
        nodeId,
        i,
        `Successfully processed extraction item [${extractionItem.name}]`
      )
    );
  }

  // Clean up any redundant data before returning
  typedExtractionItems.forEach(item => {
    // Remove aiFields from output as they're redundant with schema
    if (item.aiFields) {
      delete item.aiFields;
    }
  });

  // If debug mode is not enabled, remove technical details from the output
  // Note: debugPageContent is checked for backward compatibility
  if (!extractionNodeOptions.debugMode && !extractionNodeOptions.debugPageContent) {
    typedExtractionItems.forEach(item => {
      // Keep essential data but remove technical details
      const extractedData = item.extractedData;
      const schema = item.schema;
      const name = item.name;

      // Create a clean version with only essential properties
      Object.keys(item).forEach(key => {
        if (!['name', 'extractedData', 'schema'].includes(key)) {
          // Use type assertion to fix the TypeScript error
          delete (item as {[key: string]: any})[key];
        }
      });

      // Restore essential data
      item.name = name;
      item.extractedData = extractedData;
      if (schema) {
        item.schema = schema;
      }
    });
  }

  logger.debug(
    formatOperationLog(
      'extraction',
      nodeName,
      nodeId,
      0,
      `Completed extraction process for ${typedExtractionItems.length} items`
    )
  );

  return typedExtractionItems;
}
