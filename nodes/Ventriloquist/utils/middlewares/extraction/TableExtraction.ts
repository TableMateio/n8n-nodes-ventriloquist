import type { Page } from 'puppeteer-core';
import type { IDataObject } from 'n8n-workflow';
import type { IMiddlewareContext } from '../middleware';
import { IExtraction, IExtractionConfig, IExtractionResult } from './extractionFactory';
import { BasicExtraction } from './BasicExtraction';
import { formatOperationLog } from '../../resultUtils';
import { extractTableData } from '../../extractionUtils';
import { processWithAI } from '../../smartExtractionUtils';
import { logWithDebug } from '../../loggingUtils';

/**
 * TableExtraction implementation
 */
export class TableExtraction implements IExtraction {
  private page: Page;
  private config: IExtractionConfig;
  private context: IMiddlewareContext;

  constructor(page: Page, config: IExtractionConfig, context: IMiddlewareContext) {
    this.page = page;
    this.config = config;
    this.context = context;
  }

  /**
   * Execute the table extraction
   */
  async execute(): Promise<IExtractionResult> {
    const { page, config, context } = this;
    const { logger } = context;
    const {
      selector,
      includeHeaders = true,
      rowSelector = 'tr',
      cellSelector = 'td, th',
      outputFormat = 'json',
      smartOptions,
      preserveFieldStructure = false,
    } = config;

    try {
      logger.info(
        formatOperationLog(
          'TableExtraction',
          context.nodeName,
          context.nodeId,
          context.index !== undefined ? context.index : 0,
          `Extracting table as structured data${preserveFieldStructure ? ' (preserving field structure)' : ''}`
        )
      );

      // Use utility to extract table data
      const result = await extractTableData(
        page,
        selector,
        {
          includeHeaders,
          rowSelector,
          cellSelector,
          outputFormat,
        },
        logger,
        context.nodeName,
        context.nodeId
      );

      // Get raw HTML for rawContent
      const rawHtml = await page.$eval(selector, (el) => el.outerHTML);

      // Log info about table extraction
      const resultData = typeof result === 'string' ? [] : Array.isArray(result) && Array.isArray(result[0]) ? result : (result as IDataObject[]);
      const rowCount = Array.isArray(resultData) ? resultData.length : 0;

      logger.info(
        formatOperationLog(
          'TableExtraction',
          context.nodeName,
          context.nodeId,
          context.index !== undefined ? context.index : 0,
          `Table data extracted: ${rowCount} rows found`
        )
      );

      // If AI formatting is enabled, process it
      if (smartOptions && smartOptions.aiAssistance && config.openaiApiKey) {
        logger.info(
          formatOperationLog(
            'TableExtraction',
            context.nodeName,
            context.nodeId,
            context.index !== undefined ? context.index : 0,
            `Using OpenAI API key for AI processing. Key length: ${config.openaiApiKey.length}`
          )
        );

        logger.info(
          formatOperationLog(
            'TableExtraction',
            context.nodeName,
            context.nodeId,
            context.index !== undefined ? context.index : 0,
            `Applying AI formatting with ${smartOptions.strategy || 'auto'} strategy, format: ${smartOptions.extractionFormat}`
          )
        );

        // Do we have fields defined for manual schema?
        if ((smartOptions.strategy === 'manual' && config.fields && config.fields.items && config.fields.items.length > 0) ||
            preserveFieldStructure) {
          logger.info(
            formatOperationLog(
              'TableExtraction',
              context.nodeName,
              context.nodeId,
              context.index !== undefined ? context.index : 0,
              `Manual strategy with ${config.fields?.items?.length} fields - prioritizing field structure`
            )
          );

          // Special handling for nested fields if they exist
          const fields = config.fields?.items || [];
          const hasNestedFields = fields.some(field => field.name.includes('.'));

          if (hasNestedFields) {
            // Group fields by their parent name
            const fieldGroups: Record<string, any[]> = {};
            const topLevelFields: any[] = [];

            for (const field of fields) {
              if (field.name.includes('.')) {
                const [parent, child] = field.name.split('.', 2);
                if (!fieldGroups[parent]) {
                  fieldGroups[parent] = [];
                }
                // Create child field with modified name
                fieldGroups[parent].push({
                  ...field,
                  originalName: field.name,
                  name: child
                });
              } else {
                topLevelFields.push(field);
              }
            }

            // Process each row of the table for structured output
            const processedRows: Record<string, any>[] = [];
            const tableData = typeof result === 'string' ? [] : Array.isArray(result) ?
              (Array.isArray(result[0]) ? result : (result as IDataObject[])) : [];

            if (Array.isArray(tableData)) {
              for (const row of tableData) {
                const processedRow: Record<string, any> = {};

                // Process top-level fields
                for (const field of topLevelFields) {
                  const fieldResult = await processWithAI(
                    JSON.stringify(row),
                    {
                      enabled: true,
                      extractionFormat: smartOptions.extractionFormat || 'json',
                      aiModel: smartOptions.aiModel || 'gpt-3.5-turbo',
                      generalInstructions: `Extract "${field.name}" from this row data: ${field.instructions || ''}`,
                      strategy: 'manual',
                      includeSchema: false,
                      includeRawData: false,
                      debugMode: smartOptions.debugMode || false
                    },
                    [field],
                    config.openaiApiKey,
                    {
                      logger: context.logger,
                      nodeName: context.nodeName,
                      nodeId: context.nodeId,
                      index: context.index || 0,
                      sessionId: context.sessionId
                    }
                  );

                  if (fieldResult.success && fieldResult.data) {
                    processedRow[field.name] = fieldResult.data;
                  } else {
                    processedRow[field.name] = null;
                  }
                }

                // Process nested field groups
                for (const [parent, childFields] of Object.entries(fieldGroups)) {
                  const nestedObject: Record<string, any> = {};

                  for (const childField of childFields) {
                    const fieldResult = await processWithAI(
                      JSON.stringify(row),
                      {
                        enabled: true,
                        extractionFormat: smartOptions.extractionFormat || 'json',
                        aiModel: smartOptions.aiModel || 'gpt-3.5-turbo',
                        generalInstructions: `Extract "${childField.originalName}" from this row data: ${childField.instructions || ''}`,
                        strategy: 'manual',
                        includeSchema: false,
                        includeRawData: false,
                        debugMode: smartOptions.debugMode || false
                      },
                      [childField],
                      config.openaiApiKey,
                      {
                        logger: context.logger,
                        nodeName: context.nodeName,
                        nodeId: context.nodeId,
                        index: context.index || 0,
                        sessionId: context.sessionId
                      }
                    );

                    if (fieldResult.success && fieldResult.data) {
                      nestedObject[childField.name] = fieldResult.data;
                    } else {
                      nestedObject[childField.name] = null;
                    }
                  }

                  // Add the nested object to the row
                  processedRow[parent] = nestedObject;
                }

                processedRows.push(processedRow);
              }
            }

            return {
              success: true,
              data: processedRows,
              rawContent: rawHtml,
            };
          } else {
            // Create a field-based result using the defined fields
            const fieldBasedResult: Record<string, any> = {};

            // Process each field according to its definition
            for (const field of config.fields?.items || []) {
              logger.info(
                formatOperationLog(
                  'TableExtraction',
                  context.nodeName,
                  context.nodeId,
                  context.index !== undefined ? context.index : 0,
                  `Processing field "${field.name}" with type ${field.type}`
                )
              );

              // For each field, we'll pass the table data as content to the AI service
              const aiOptions = {
                strategy: 'manual' as const,
                model: smartOptions.aiModel,
                generalInstructions: `Extract from the following table data: ${field.instructions || ''}`,
                fields: [field],
                includeSchema: smartOptions.includeSchema,
                includeRawData: smartOptions.includeRawData,
                debugMode: smartOptions.debugMode
              };

              // Process this field
              try {
                // For table data, we'll convert to JSON string to keep structure
                const tableContent = JSON.stringify(typeof result === 'string' ? [] : result);

                // Process with AI
                const aiResult = await processWithAI(
                  tableContent,
                  {
                    enabled: true,
                    extractionFormat: smartOptions.extractionFormat || 'json',
                    aiModel: smartOptions.aiModel || 'gpt-3.5-turbo',
                    generalInstructions: smartOptions.generalInstructions || '',
                    strategy: 'manual',
                    includeSchema: smartOptions.includeSchema || false,
                    includeRawData: smartOptions.includeRawData || false,
                    debugMode: smartOptions.debugMode || false
                  },
                  [field],
                  config.openaiApiKey,
                  {
                    logger: context.logger,
                    nodeName: context.nodeName,
                    nodeId: context.nodeId,
                    index: context.index || 0,
                    sessionId: context.sessionId
                  }
                );

                if (aiResult.success && aiResult.data) {
                  // Check if the field name contains dots, indicating a nested structure
                  if (field.name.includes('.')) {
                    // Split by dots to create nested structure
                    const parts = field.name.split('.');
                    let current = fieldBasedResult;

                    // Create nested objects for each part except the last one
                    for (let i = 0; i < parts.length - 1; i++) {
                      const part = parts[i];
                      if (!current[part]) {
                        current[part] = {};
                      }
                      current = current[part];
                    }

                    // Set the value at the deepest level
                    current[parts[parts.length - 1]] = aiResult.data;

                    logger.info(
                      formatOperationLog(
                        'TableExtraction',
                        context.nodeName,
                        context.nodeId,
                        context.index !== undefined ? context.index : 0,
                        `Created nested structure for field "${field.name}"`
                      )
                    );
                  } else {
                    // Normal field assignment
                    fieldBasedResult[field.name] = aiResult.data;
                  }
                } else {
                  logger.warn(
                    formatOperationLog(
                      'TableExtraction',
                      context.nodeName,
                      context.nodeId,
                      context.index !== undefined ? context.index : 0,
                      `Failed to process field "${field.name}": ${aiResult.error || 'Unknown error'}`
                    )
                  );
                  fieldBasedResult[field.name] = null;
                }
              } catch (error) {
                logger.warn(
                  formatOperationLog(
                    'TableExtraction',
                    context.nodeName,
                    context.nodeId,
                    context.index !== undefined ? context.index : 0,
                    `Error processing field "${field.name}": ${(error as Error).message}`
                  )
                );
                fieldBasedResult[field.name] = null;
              }
            }

            // Return the field-based result
            return {
              success: true,
              data: fieldBasedResult,
              rawContent: rawHtml,
            };
          }
        } else {
          // Use the default process with AI for the whole table
          const aiResult = await processWithAI(
            typeof result === 'string' ? result : JSON.stringify(result),
            {
              enabled: true,
              extractionFormat: smartOptions.extractionFormat || 'json',
              aiModel: smartOptions.aiModel || 'gpt-3.5-turbo',
              generalInstructions: smartOptions.generalInstructions || '',
              strategy: 'manual',
              includeSchema: smartOptions.includeSchema || false,
              includeRawData: smartOptions.includeRawData || false,
              debugMode: smartOptions.debugMode || false
            },
            config.fields ? config.fields.items : [],
            config.openaiApiKey,
            {
              logger: context.logger,
              nodeName: context.nodeName,
              nodeId: context.nodeId,
              index: context.index || 0,
              sessionId: context.sessionId
            }
          );

          // Log AI result status
          logger.info(
            formatOperationLog(
              'TableExtraction',
              context.nodeName,
              context.nodeId,
              context.index !== undefined ? context.index : 0,
              `AI formatting ${aiResult.success ? 'successful' : 'failed'}`
            )
          );

          if (aiResult.success) {
            // If we have a schema, use it
            if (aiResult.schema) {
              logger.info(
                formatOperationLog(
                  'TableExtraction',
                  context.nodeName,
                  context.nodeId,
                  context.index !== undefined ? context.index : 0,
                  `Schema provided by AI processing, including in result`
                )
              );
            }

            return {
              success: true,
              data: aiResult.data || result,
              rawContent: rawHtml,
              schema: aiResult.schema,
            };
          } else {
            logger.warn(
              formatOperationLog(
                'TableExtraction',
                context.nodeName,
                context.nodeId,
                context.index !== undefined ? context.index : 0,
                `AI formatting failed: ${aiResult.error || 'Unknown error'}`
              )
            );
          }
        }
      }

      // Return the extracted table data
      return {
        success: true,
        data: result,
        rawContent: rawHtml,
      };
    } catch (error) {
      logger.error(
        formatOperationLog(
          'TableExtraction',
          context.nodeName,
          context.nodeId,
          context.index !== undefined ? context.index : 0,
          `Table extraction failed: ${(error as Error).message}`
        )
      );

      return {
        success: false,
        error: {
          message: `Table extraction failed: ${(error as Error).message}`,
          details: error
        }
      };
    }
  }
}

/**
 * MultipleExtraction implementation
 */
export class MultipleExtraction implements IExtraction {
  private page: Page;
  private config: IExtractionConfig;
  private context: IMiddlewareContext;

  constructor(page: Page, config: IExtractionConfig, context: IMiddlewareContext) {
    this.page = page;
    this.config = config;
    this.context = context;
  }

  /**
   * Execute the multiple extraction
   */
  async execute(): Promise<IExtractionResult> {
    // For now, use BasicExtraction implementation
    const basic = new BasicExtraction(this.page, this.config, this.context);
    return basic.execute();
  }
}
