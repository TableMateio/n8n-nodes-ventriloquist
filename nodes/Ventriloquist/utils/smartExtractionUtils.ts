import { Logger } from 'n8n-workflow';
import { formatOperationLog } from './resultUtils';
import { IMiddlewareContext } from './middlewares/middleware';
import { AIService, IAIExtractionOptions, IField } from './aiService';
import { logWithDebug } from './loggingUtils';
import type * as puppeteer from 'puppeteer';
import { enhanceFieldsWithRelativeSelectorContent, processFieldsWithReferenceContent } from './processOpenAISchema';

type ILogger = Logger;

/**
 * Interface for smart extraction options
 */
export interface ISmartExtractionOptions {
  enabled: boolean;
  extractionFormat: string; // json, csv, table, etc.
  aiModel: string;
  generalInstructions: string;
  strategy: string; // auto or manual
  includeSchema: boolean;
  includeRawData: boolean;
  includeReferenceContext?: boolean;
  referenceSelector?: string;
  referenceName?: string;
  referenceFormat?: string;
  referenceAttribute?: string;
  selectorScope?: string;
  referenceContent?: string;
  debugMode?: boolean;
  tableSelector?: string;  // Add this for table extraction
  fields?: any[];        // Add this to store fields configuration
}

/**
 * Interface for AI field definition
 */
export interface IAIField {
  name: string;
  instructions?: string;  // This field contains the UI instructions which become OpenAI schema descriptions
  type?: string;
  required?: boolean;
  fieldOptions?: any;    // Add this to store field options
}

/**
 * Interface for AI formatting options
 */
export interface IAIFormattingOptions {
  enabled: boolean;
  extractionFormat: string;
  aiModel: string;
  generalInstructions: string;
  strategy: string;
  includeSchema: boolean;
  includeRawData: boolean;
  includeReferenceContext?: boolean;
  referenceSelector?: string;
  referenceName?: string;
  referenceFormat?: string;
  referenceAttribute?: string;
  selectorScope?: string;
  referenceContent?: string;
  debugMode?: boolean;
}

/**
 * Interface for AI formatting result
 */
export interface IAIFormattingResult {
  success: boolean;
  data?: any;
  schema?: any;
  error?: string;
}

/**
 * Interface for smart extraction result
 */
export interface ISmartExtractionResult {
  success: boolean;
  data?: any;
  schema?: any;
  rawData?: any;
  error?: string;
}

/**
 * Define a more flexible Page type to accommodate both puppeteer and puppeteer-core
 */
interface Page {
  evaluate: Function;
  $$eval: Function;
  $eval: Function;
  url: Function;
  screenshot: Function;
}

/**
 * Detects content type from a string
 * @param content The content to detect type from
 * @returns Detected content type (json, text, csv, table, html)
 */
export function detectContentType(content: any): string {
  // Handle null or undefined
  if (content === null || content === undefined) {
    return 'text';
  }

  // Convert to string if it's not already
  const stringContent = typeof content === 'string' ? content : JSON.stringify(content);

  // Check for empty content
  if (!stringContent || stringContent.trim() === '') {
    return 'text';
  }

  // Try to detect JSON
  try {
    if (stringContent.trim().startsWith('{') || stringContent.trim().startsWith('[')) {
      JSON.parse(stringContent);
      return 'json';
    }
  } catch (e) {
    // Not valid JSON
  }

  // Check for CSV (has commas and newlines)
  if (stringContent.includes(',') && stringContent.includes('\n')) {
    // Count commas in the first line
    const firstLine = stringContent.split('\n')[0];
    const commaCount = (firstLine.match(/,/g) || []).length;

    // If there are multiple commas and the same pattern continues, likely CSV
    if (commaCount > 0) {
      const secondLine = stringContent.split('\n')[1];
      if (secondLine && secondLine.match(/,/g) && secondLine.match(/,/g)!.length === commaCount) {
        return 'csv';
      }
    }
  }

  // Check for HTML
  if (stringContent.includes('<html') ||
      stringContent.includes('<body') ||
      (stringContent.includes('<') && stringContent.includes('</') && stringContent.includes('>'))) {
    return 'html';
  }

  // Check for table-like structure
  if (stringContent.includes('\n') && stringContent.includes('\t')) {
    return 'table';
  }

  // Default to text
  return 'text';
}

/**
 * Extracts content from a page using AI
 * @param page The Puppeteer page
 * @param selector The CSS selector to extract from
 * @param options Smart extraction options
 * @param fields Optional field definitions for structured extraction
 * @param openaiApiKey The OpenAI API key
 * @param context The middleware context
 * @returns The extracted content
 */
export async function extractSmartContent(
  page: Page,
  selector: string,
  options: ISmartExtractionOptions,
  fields: IAIField[] = [],
  openaiApiKey?: string,
  context?: {
    logger?: Logger;
    nodeName?: string;
    nodeId?: string;
    index?: number;
  }
): Promise<ISmartExtractionResult> {
  const logger = context?.logger || console as any;
  const nodeName = context?.nodeName || 'Unknown';
  const nodeId = context?.nodeId || 'Unknown';
  const itemIndex = context?.index !== undefined ? context.index : 0;
  const isDebugMode = options.debugMode === true;
  const component = 'smartExtraction';
  const functionName = 'extractSmartContent';

  // Log debug information if enabled
  if (isDebugMode) {
    logger.error(
      formatOperationLog(
        'smartExtraction',
        nodeName,
        nodeId,
        itemIndex,
        `!!! IMPORTANT !!! Using AIService with OpenAI Assistants API path (not Chat Completions)`,
        component,
        functionName
      )
    );
    console.error(`!!! EXTRACTION DEBUG !!! [${nodeName}/${nodeId}] Using AIService with Assistants API path`);
  }

  // Extract raw content from the page
  let content = '';
  try {
    const extractedContent = await page.$$eval(selector, (elements: Element[]) => {
      if (elements.length === 0) return '';

      // Use only the first element found
      const element = elements[0];

      // Return the outer HTML including the element itself
      return element.outerHTML;
    });

    content = extractedContent;

    logger.info(
      formatOperationLog(
        'smartExtraction',
        nodeName,
        nodeId,
        itemIndex,
        `Extracted content (${content.length} chars): "${content.substring(0, 100)}${content.length > 100 ? '...' : ''}"`,
        component,
        functionName
      )
    );
  } catch (error) {
    logger.error(
      formatOperationLog(
        'smartExtraction',
        nodeName,
        nodeId,
        itemIndex,
        `Failed to extract content using selector ${selector}: ${(error as Error).message}`,
        component,
        functionName
      )
    );
    return {
      success: false,
      error: `Failed to extract content: ${(error as Error).message}`
    };
  }

  // Detect content type
  const contentType = detectContentType(content);
  logger.info(
    formatOperationLog(
      'smartExtraction',
      nodeName,
      nodeId,
      itemIndex,
      `Detected content type: ${contentType}`,
      component,
      functionName
    )
  );

  // Check if we need to process this as a table and need attribute extraction
  const isTable = contentType === 'table' || content.includes('<table');
  const hasAttributeFields = fields.some(field => {
    const fieldOptions = (field as any).fieldOptions || {};
    return fieldOptions.extractionType === 'attribute' && fieldOptions.attributeName;
  });

  // If this is a table with attribute fields, use our enhanced table processing
  if (isTable && hasAttributeFields) {
    logger.info(
      formatOperationLog(
        'smartExtraction',
        nodeName,
        nodeId,
        itemIndex,
        `Processing as table with attribute extraction (${fields.length} fields, ${hasAttributeFields ? 'with' : 'without'} attribute fields)`,
        component,
        functionName
      )
    );

    // Process the table to extract rows with preserved HTML structure
    const tableRows = extractTableRows(
      content,
      options,
      isDebugMode,
      { nodeName, nodeId, itemIndex },
      logger
    );

    // Update field instructions to reference the extracted attributes in each row
    const processedFields = enhanceFieldsWithAttributeReferences(
      fields.map(field => ({
        ...field,
        instructions: field.instructions || ''
      })) as IField[],
      true,
      logger,
      { nodeName, nodeId, index: itemIndex }
    );

    // Create AIService instance
    const aiService = new AIService(
      openaiApiKey || '',
      logger,
      { nodeName, nodeId, index: itemIndex },
      options.debugMode === true
    );

    // Process the table data with AI
    const aiOptions: IAIExtractionOptions = {
      strategy: options.strategy === 'auto' ? 'auto' : 'manual',
      extractionFormat: options.extractionFormat || 'json',
      aiModel: options.aiModel || 'gpt-4',
      generalInstructions: options.generalInstructions || '',
      includeSchema: options.includeSchema === true,
      includeRawData: options.includeRawData === true,
      referenceContent: options.referenceContent || '',
      debugMode: options.debugMode,
      fields: processedFields as any
    };

    // Process with AI
    const result = await aiService.processContent(JSON.stringify(tableRows), aiOptions);

    return {
      success: result.success,
      data: result.data,
      schema: result.schema,
      rawData: options.includeRawData ? content : undefined,
      error: result.error
    };
  }

  // For non-table content or tables without attribute extraction, continue with the original flow
  // Enhance fields with relative selector content if using manual strategy
  if (options.strategy === 'manual' && fields.length > 0) {
    try {
      // Enhance fields with relative selector content
      logger.info(
        formatOperationLog(
          'smartExtraction',
          nodeName,
          nodeId,
          itemIndex,
          `Enhancing ${fields.length} fields with relative selector content`,
          component,
          functionName
        )
      );

      // Ensure fields match the expected IOpenAIField[] type by providing instructions property
      const fieldsWithInstructions = fields.map(field => ({
        ...field,
        instructions: field.instructions || ''
      }));

      // Copy the fields array to avoid modifying the original
      const enhancedFields = await enhanceFieldsWithRelativeSelectorContent(
        page,
        fieldsWithInstructions as any, // Type assertion to bypass strict checking
        selector,
        logger,
        {
          nodeName,
          nodeId,
          index: itemIndex,
          component,
          functionName
        }
      );

      // Copy back the enhanced fields (now with reference content)
      fields = enhancedFields;
    } catch (error) {
      logger.error(
        formatOperationLog(
          'smartExtraction',
          nodeName,
          nodeId,
          itemIndex,
          `Error enhancing fields: ${(error as Error).message}`,
          component,
          functionName
        )
      );
    }
  }

  // Create AIService instance
  const aiService = new AIService(
    openaiApiKey || '',
    logger,
    { nodeName, nodeId, index: itemIndex },
    options.debugMode === true
  );

  // Log the AIService initialization
  if (isDebugMode) {
    logger.info(
      formatOperationLog(
        'smartExtraction',
        nodeName,
        nodeId,
        itemIndex,
        `Created AIService instance with API key (length: ${openaiApiKey?.length || 0}), model: ${options.aiModel}`,
        component,
        functionName
      )
    );
  }

  // Process content based on strategy
  const aiOptions: IAIExtractionOptions = {
    strategy: options.strategy === 'auto' ? 'auto' : 'manual',
    extractionFormat: options.extractionFormat || 'json',
    aiModel: options.aiModel || 'gpt-4',
    generalInstructions: options.generalInstructions || '',
    includeSchema: options.includeSchema === true,
    includeRawData: options.includeRawData === true,
    referenceContent: options.referenceContent || '',
    debugMode: options.debugMode
  };

  // Log field count if in manual strategy
  if (options.strategy === 'manual' && fields) {
    logger.debug(
      formatOperationLog(
        'smartExtraction',
        nodeName,
        nodeId,
        itemIndex,
        `Manual strategy with ${fields.length} fields: ${fields.map(f => f.name).join(', ')}`,
        component,
        functionName
      )
    );
  }

  // Log reference context if available
  if (options.includeReferenceContext && options.referenceContent) {
    logger.debug(
      formatOperationLog(
        'smartExtraction',
        nodeName,
        nodeId,
        itemIndex,
        `Using reference context (${options.referenceContent.length} chars): "${options.referenceContent.substring(0, 50)}${options.referenceContent.length > 50 ? '...' : ''}"`,
        component,
        functionName
      )
    );
  }

  // Add fields for manual strategy
  if (options.strategy === 'manual' && fields && fields.length > 0) {
    // Convert IAIField[] to IField[] by creating properly typed objects with all required properties
    const convertedFields = fields.map(field => {
      // Get field options if they exist
      const fieldOptions = (field as any).fieldOptions || {};

      // Extract important properties from field options
      const extractionType = fieldOptions.extractionType || 'text';
      const attributeName = fieldOptions.attributeName || '';
      const aiProcessingMode = fieldOptions.aiProcessingMode || 'standard';
      const threadManagement = fieldOptions.threadManagement || 'shared';

      // Check for reference content from enhanced fields
      const referenceContent = (field as any).referenceContent;
      const returnDirectAttribute = (field as any).returnDirectAttribute === true;

      // Log field options in debug mode
      if (isDebugMode) {
        console.error(
          `!!! OPENAI API DEBUG !!! [${nodeName}/${nodeId}] ` +
          `Field "${field.name}" options: extractionType=${extractionType}, ` +
          `attributeName=${attributeName}, aiMode=${aiProcessingMode}, ` +
          `threadMode=${threadManagement}, hasRefContent=${!!referenceContent}`
        );
      }

      return {
        name: field.name,
        type: field.type || 'string',
        instructions: field.instructions || '', // Instructions must be non-optional
        format: 'default', // Add required format property
        // Add correct extraction type and attribute name
        extractionType: extractionType,
        attributeName: attributeName,
        // Add thread management and processing mode flags
        useLogicAnalysis: aiProcessingMode === 'logical',
        useSeparateThread: threadManagement === 'separate',
        // Preserve the reference content if it exists
        referenceContent: referenceContent,
        // Preserve the direct attribute flag if it exists
        returnDirectAttribute: returnDirectAttribute
      };
    });
    aiOptions.fields = convertedFields;
  }

  // Process content with AI
  let stringContent = content;
  if (typeof stringContent !== 'string') {
    stringContent = JSON.stringify(stringContent);
  }

  // Log the string content to be sent to AI
  logger.debug(
    formatOperationLog(
      'smartExtraction',
      nodeName,
      nodeId,
      itemIndex,
      `Sending ${stringContent.length} chars to AI service`,
      component,
      functionName
    )
  );

  // Process with AI service
  const result = await aiService.processContent(stringContent, aiOptions);

  return {
    success: result.success,
    data: result.data,
    schema: result.schema,
    error: result.error
  };
}

/**
 * Process content with AI to format it according to specified options
 * @param content The content to process
 * @param options AI processing options
 * @param fields Fields for manual strategy
 * @param apiKey OpenAI API key
 * @param context Logging context
 */
export async function processWithAI(
  content: any,
  options: ISmartExtractionOptions,
  fields: IAIField[] = [],
  apiKey?: string,
  context?: {
    logger?: Logger | undefined;
    nodeName: string;
    nodeId: string;
    sessionId?: string;
    index: number;
  }
): Promise<{ success: boolean; data?: any; error?: string; schema?: any }> {
  const component = "smartExtractionUtils";
  const functionName = "processWithAI";
  const logger = context?.logger;
  const nodeName = context?.nodeName || 'Extraction';
  const nodeId = context?.nodeId || 'unknown';
  const index = context?.index ?? 0;
  const isDebugMode = options.debugMode === true;

  try {
    // Log that we're processing with AI
    if (logger) {
      logger.info(
        formatOperationLog(
          'SmartExtraction',
          nodeName,
          nodeId,
          index,
          `Processing content with AI (strategy: ${options.strategy}, model: ${options.aiModel}, debugMode: ${isDebugMode})`,
          component,
          functionName
        )
      );
    }

    // Validate we have an API key
    if (!apiKey) {
      const error = 'Missing OpenAI API key for AI processing';
      if (logger) {
        logger.error(
          formatOperationLog(
            'SmartExtraction',
            nodeName,
            nodeId,
            index,
            error,
            component,
            functionName
          )
        );
      }
      return { success: false, error };
    }

    // Log the detection of content type
    const contentType = detectContentType(content);
    if (logger) {
      logger.debug(
        formatOperationLog(
          'SmartExtraction',
          nodeName,
          nodeId,
          index,
          `Detected content type: ${contentType}`,
          component,
          functionName
        )
      );
    }

    // Create AIService instance with the provided context
    const aiService = new AIService(
      apiKey,
      logger as Logger,
      {
        nodeName,
        nodeId,
        index,
      },
      isDebugMode
    );

    // Ensure content is a string
    const stringContent = typeof content === 'string' ? content : JSON.stringify(content);

    // Convert options to IAIExtractionOptions format
    const aiOptions: IAIExtractionOptions = {
      strategy: options.strategy === 'auto' ? 'auto' : 'manual',
      model: options.aiModel,
      generalInstructions: options.generalInstructions,
      includeSchema: options.includeSchema,
      includeRawData: options.includeRawData,
      includeReferenceContext: options.includeReferenceContext,
      referenceName: options.referenceName,
      referenceContent: options.referenceContent,
      debugMode: options.debugMode
    };

    // Add fields for manual strategy
    if (options.strategy === 'manual' && fields && fields.length > 0) {
      // Convert IAIField[] to IField[] by creating properly typed objects with all required properties
      const convertedFields = fields.map(field => {
        // Get field options if they exist
        const fieldOptions = (field as any).fieldOptions || {};

        // Extract important properties from field options
        const extractionType = fieldOptions.extractionType || 'text';
        const attributeName = fieldOptions.attributeName || '';
        const aiProcessingMode = fieldOptions.aiProcessingMode || 'standard';
        const threadManagement = fieldOptions.threadManagement || 'shared';

        // Check for reference content from enhanced fields
        const referenceContent = (field as any).referenceContent;
        const returnDirectAttribute = (field as any).returnDirectAttribute === true;

        // Log field options in debug mode
        if (isDebugMode) {
          logWithDebug(
            logger,
            true,
            nodeName,
            'SmartExtraction',
            component,
            functionName,
            `Field "${field.name}" options: extractionType=${extractionType}, attributeName=${attributeName}, aiMode=${aiProcessingMode}, threadMode=${threadManagement}, hasRefContent=${!!referenceContent}`,
            'error'
          );
        }

        // Create the field with all necessary properties
        return {
          name: field.name,
          type: field.type || 'string',
          instructions: field.instructions || '', // Instructions must be non-optional
          format: 'default', // Add required format property
          // Add correct extraction type and attribute name
          extractionType: extractionType,
          attributeName: attributeName,
          // Add thread management and processing mode flags
          useLogicAnalysis: aiProcessingMode === 'logical',
          useSeparateThread: threadManagement === 'separate',
          // Preserve the reference content if it exists
          referenceContent: referenceContent,
          // Preserve the direct attribute flag if it exists
          returnDirectAttribute: returnDirectAttribute
        };
      });
      aiOptions.fields = convertedFields;
    }

    // Log that we're using the AIService
    if (isDebugMode) {
      logWithDebug(
        logger,
        true,
        nodeName,
        'SmartExtraction',
        component,
        functionName,
        `Using AIService.processContent with ${fields.length} fields`,
        'error'
      );
    }

    // Process content with AIService
    const result = await aiService.processContent(stringContent, aiOptions);

    return {
      success: result.success,
      data: result.data,
      schema: result.schema,
      error: result.error,
    };
  } catch (error) {
    const errorMessage = `AI processing failed: ${(error as Error).message}`;
    logger?.error(formatOperationLog('aiProcessing', nodeName, nodeId, index, errorMessage));
    return {
      success: false,
      error: errorMessage,
    };
  }
}

/**
 * Build a prompt for the auto strategy
 * @param content Content to process
 * @param options Processing options
 */
function buildAutoPrompt(content: string, options: ISmartExtractionOptions): string {
  // Base instructions
  let prompt = `
Extract and format the following content as ${options.extractionFormat.toUpperCase()}.
${options.generalInstructions ? options.generalInstructions + '\n' : ''}

${options.includeSchema ? 'Include a "schema" field in your response that describes the structure of the data.\n' : ''}`;

  // Add reference context if available
  if (options.includeReferenceContext && options.referenceContent) {
    prompt += `
Additional reference context (${options.referenceName || 'referenceContext'}):
\`\`\`
${options.referenceContent}
\`\`\`
`;
  }

  prompt += `
Please format your response as a valid JSON object, with the extracted data in a "data" field.

Content to extract:
\`\`\`
${content}
\`\`\`
`;

  return prompt;
}

/**
 * Build a prompt for the manual strategy
 * @param content Content to process
 * @param options Processing options
 * @param fields Fields for manual strategy
 */
function buildManualPrompt(content: string, options: ISmartExtractionOptions, fields: IAIField[]): string {
  // Base instructions
  let prompt = `
Extract and format the following content as ${options.extractionFormat.toUpperCase()}.
${options.generalInstructions ? options.generalInstructions + '\n' : ''}

${options.includeSchema ? 'Include a "schema" field in your response that describes the structure of the data.\n' : ''}`;

  // Add reference context if available
  if (options.includeReferenceContext && options.referenceContent) {
    prompt += `
Additional reference context (${options.referenceName || 'referenceContext'}):
\`\`\`
${options.referenceContent}
\`\`\`
`;
  }

  prompt += `
Please format your response as a valid JSON object, with the extracted data in a "data" field.

Content to extract:
\`\`\`
${content}
\`\`\`
`;

  return prompt;
}

/**
 * Enrich a schema with field descriptions
 * @param schema The schema to enrich
 * @param fields The field definitions
 * @returns The enriched schema
 */
function enrichSchemaWithFieldDescriptions(schema: any, fields: IAIField[]): any {
  if (schema.type === 'object' && schema.properties) {
    Object.keys(schema.properties).forEach(key => {
      const field = fields.find(f => f.name === key);
      if (field) {
        schema.properties[key].description = field.instructions || '';
      }
    });
  }
  return schema;
}

/**
 * Extract rows from an HTML table and convert to JSON array
 * This implementation preserves the original HTML for each row to enable attribute extraction
 */
function extractTableRows(tableHtml: string, options: ISmartExtractionOptions, isDebugMode: boolean = false, context: { nodeName: string, nodeId: string, itemIndex: number }, logger: ILogger): any[] {
  const { nodeName, nodeId, itemIndex } = context;
  const component = 'smartExtraction';
  const functionName = 'extractTableRows';

  try {
    const cheerio = require('cheerio');
    const $ = cheerio.load(tableHtml);

    // Find the table rows
    const rows: any[] = [];
    const tableSelector = options.tableSelector || 'table';
    const tableElement = $(tableSelector);

    if (tableElement.length === 0) {
      logger.warn(
        formatOperationLog(
          'smartExtraction',
          nodeName,
          nodeId,
          itemIndex,
          `Table not found using selector: ${tableSelector}`,
          component,
          functionName
        )
      );
      return [];
    }

    // Get table headers (usually from th elements, but could be from first row td elements)
    const headers: string[] = [];
    tableElement.find('thead th, thead td').each((index: number, element: any) => {
      headers.push($(element).text().trim());
    });

    // If no headers found in thead, try using the first row
    if (headers.length === 0) {
      tableElement.find('tr:first-child th, tr:first-child td').each((index: number, element: any) => {
        headers.push($(element).text().trim());
      });
    }

    // If we still don't have headers, generate them (col0, col1, etc.)
    if (headers.length === 0) {
      const firstRowCellCount = tableElement.find('tr:first-child td, tr:first-child th').length;
      for (let i = 0; i < firstRowCellCount; i++) {
        headers.push(`col${i}`);
      }
    }

    if (isDebugMode) {
      logger.info(
        formatOperationLog(
          'smartExtraction',
          nodeName,
          nodeId,
          itemIndex,
          `Extracted ${headers.length} table headers: ${headers.join(', ')}`,
          component,
          functionName
        )
      );
    }

    // Skip the header row if we have headers
    const startRow = headers.length > 0 ? 1 : 0;

    // Check what attributes we need to extract from the fields
    // This ensures we only extract attributes that are explicitly requested
    const attributesToExtract: Set<string> = new Set();
    // Map to track field names to their attribute configurations
    const fieldAttributeMap: Map<string, { attributeName: string, fieldName: string, cleanFieldName: string }> = new Map();

    if (options.fields && options.fields.length > 0) {
      options.fields.forEach(field => {
        const fieldOptions = (field as any).fieldOptions || {};
        if (fieldOptions.extractionType === 'attribute' && fieldOptions.attributeName) {
          const attributeName = fieldOptions.attributeName;
          attributesToExtract.add(attributeName);

          // Create a clean field name for this attribute
          const fieldDisplayName = field.name.replace(/[^a-zA-Z0-9_]/g, '_');
          let cleanFieldName = fieldDisplayName;

          // For common attributes, use more intuitive names
          if (attributeName === 'href') {
            cleanFieldName = `${fieldDisplayName}_url`;
          } else if (attributeName === 'src') {
            cleanFieldName = `${fieldDisplayName}_source`;
          } else {
            cleanFieldName = `${fieldDisplayName}_${attributeName}`;
          }

          // Store mapping between field name and attribute config
          fieldAttributeMap.set(field.name, {
            attributeName,
            fieldName: field.name,
            cleanFieldName
          });
        }
      });

      if (isDebugMode && attributesToExtract.size > 0) {
        logger.info(
          formatOperationLog(
            'smartExtraction',
            nodeName,
            nodeId,
            itemIndex,
            `Will extract the following attributes: ${Array.from(attributesToExtract).join(', ')}`,
            component,
            functionName
          )
        );
      }
    }

    // Process each data row
    tableElement.find('tr').each((rowIndex: number, rowElement: any) => {
      // Skip header row
      if (rowIndex < startRow) return;

      const $row = $(rowElement);
      const rowData: any = {};

      // Store the original HTML for this row
      rowData._html = $.html($row);
      rowData._rowIndex = rowIndex - startRow; // Store 0-based index for reference

      // Process cells
      $row.find('td, th').each((cellIndex: number, cellElement: any) => {
        const $cell = $(cellElement);
        const headerName = headers[cellIndex] || `col${cellIndex}`;

        // Store text content
        rowData[headerName] = $cell.text().trim();

        // Also store cell-specific HTML for potential attribute extraction later
        rowData[`_${headerName}_html`] = $.html($cell);

        // Only extract specified attributes
        if (attributesToExtract.size > 0) {
          attributesToExtract.forEach(attrName => {
            // For href attributes, look for links
            if (attrName === 'href') {
              const links = $cell.find('a');
              if (links.length > 0) {
                const hrefs = links.map((i: number, link: any) => $(link).attr('href')).get().filter(Boolean);
                if (hrefs.length > 0) {
                  // Store internal reference with technical name
                  rowData[`_${headerName}_${attrName}`] = hrefs.length === 1 ? hrefs[0] : hrefs;

                  // Also store directly in the row data with a clean name for each configured field
                  fieldAttributeMap.forEach(config => {
                    if (config.attributeName === attrName) {
                      // For column-specific matches
                      if (headerName.toLowerCase() === config.fieldName.toLowerCase() ||
                          headerName.replace(/\s+/g, '').toLowerCase() === config.fieldName.replace(/\s+/g, '').toLowerCase()) {
                        // Direct match between column header and field name
                        rowData[config.cleanFieldName] = hrefs.length === 1 ? hrefs[0] : hrefs;

                        if (isDebugMode) {
                          logger.info(
                            formatOperationLog(
                              'smartExtraction',
                              nodeName,
                              nodeId,
                              itemIndex,
                              `Direct attribute mapping for ${headerName} -> ${config.cleanFieldName} with value: ${hrefs.length === 1 ? hrefs[0] : 'multiple values'}`,
                              component,
                              functionName
                            )
                          );
                        }
                      }
                    }
                  });
                }
              }
            }
            // For other attributes, look for elements with that attribute
            else {
              const elements = $cell.find(`[${attrName}]`);
              if (elements.length > 0) {
                const attrValues = elements.map((i: number, el: any) => $(el).attr(attrName)).get().filter(Boolean);
                if (attrValues.length > 0) {
                  // Store internal reference with technical name
                  rowData[`_${headerName}_${attrName}`] = attrValues.length === 1 ? attrValues[0] : attrValues;

                  // Add direct attribute values to the row data for configured fields
                  fieldAttributeMap.forEach(config => {
                    if (config.attributeName === attrName) {
                      // For column-specific matches
                      if (headerName.toLowerCase() === config.fieldName.toLowerCase() ||
                          headerName.replace(/\s+/g, '').toLowerCase() === config.fieldName.replace(/\s+/g, '').toLowerCase()) {
                        // Direct match between column header and field name
                        rowData[config.cleanFieldName] = attrValues.length === 1 ? attrValues[0] : attrValues;
                      }
                    }
                  });
                }
              }
            }
          });
        }
      });

      // Only check row-level elements for specified attributes
      if (attributesToExtract.size > 0) {
        attributesToExtract.forEach(attrName => {
          // For href attributes, look for links directly in the row
          if (attrName === 'href') {
            const rowLinks = $row.find('a');
            if (rowLinks.length > 0) {
              const rowHrefs = rowLinks.map((i: number, link: any) => $(link).attr('href')).get().filter(Boolean);
              if (rowHrefs.length > 0) {
                // Store internal reference with technical name
                rowData[`_row_${attrName}`] = rowHrefs.length === 1 ? rowHrefs[0] : rowHrefs;

                // Store as fallback for any fields that didn't find a direct column match
                fieldAttributeMap.forEach(config => {
                  if (config.attributeName === attrName && !rowData[config.cleanFieldName]) {
                    // Use as fallback if not already set from column-specific match
                    rowData[config.cleanFieldName] = rowHrefs.length === 1 ? rowHrefs[0] : rowHrefs;

                    if (isDebugMode) {
                      logger.info(
                        formatOperationLog(
                          'smartExtraction',
                          nodeName,
                          nodeId,
                          itemIndex,
                          `Fallback row-level attribute mapping for ${config.fieldName} -> ${config.cleanFieldName}`,
                          component,
                          functionName
                        )
                      );
                    }
                  }
                });
              }
            }
          }
          // For other attributes, look for elements with that attribute directly in the row
          else {
            const elements = $row.find(`[${attrName}]`);
            if (elements.length > 0) {
              const attrValues = elements.map((i: number, el: any) => $(el).attr(attrName)).get().filter(Boolean);
              if (attrValues.length > 0) {
                // Store internal reference with technical name
                rowData[`_row_${attrName}`] = attrValues.length === 1 ? attrValues[0] : attrValues;

                // Use as fallback for any fields that didn't find a direct column match
                fieldAttributeMap.forEach(config => {
                  if (config.attributeName === attrName && !rowData[config.cleanFieldName]) {
                    rowData[config.cleanFieldName] = attrValues.length === 1 ? attrValues[0] : attrValues;
                  }
                });
              }
            }
          }
        });
      }

      rows.push(rowData);
    });

    if (isDebugMode) {
      logger.info(
        formatOperationLog(
          'smartExtraction',
          nodeName,
          nodeId,
          itemIndex,
          `Extracted ${rows.length} rows from table`,
          component,
          functionName
        )
      );
    }

    return rows;
  } catch (error) {
    logger.error(
      formatOperationLog(
        'smartExtraction',
        nodeName,
        nodeId,
        itemIndex,
        `Error extracting table rows: ${(error as Error).message}`,
        component,
        functionName
      )
    );
    return [];
  }
}

export function processTableData(tableHtml: string, options: ISmartExtractionOptions, isDebugMode: boolean = false, context: { nodeName: string, nodeId: string, itemIndex: number } = { nodeName: 'Unknown', nodeId: 'Unknown', itemIndex: 0 }, logger: ILogger): any[] {
  const { nodeName, nodeId, itemIndex } = context;
  const component = 'smartExtraction';
  const functionName = 'processTableData';

  // Extract table rows and convert to JSON with internal metadata
  const rowsWithMetadata = extractTableRows(tableHtml, options, isDebugMode, context, logger);

  // Process rows to create clean output for different formats
  let finalRows: any[] = [];

  // Get the output format preference
  const outputFormat = options.extractionFormat || 'json';

  // Define a mapping function based on output format to create the final row objects
  const createCleanRowObject = (row: any, format: string) => {
    // For any format, start with a clean object
    const cleanRow: any = {};

    // Copy all non-internal fields (those not starting with underscore)
    Object.keys(row).forEach(key => {
      if (!key.startsWith('_')) {
        cleanRow[key] = row[key];
      }
    });

    // If attribute extraction is enabled, process accordingly
    if (options.fields && options.fields.length > 0) {
      // Process each field with attribute extraction
      options.fields.forEach(field => {
        const fieldOptions = (field as any).fieldOptions || {};
        if (fieldOptions.extractionType === 'attribute' && fieldOptions.attributeName) {
          const attributeName = fieldOptions.attributeName;
          const fieldDisplayName = field.name.replace(/[^a-zA-Z0-9_]/g, '_');

          // Create a clean field name for this attribute based on the output format
          let cleanFieldName = '';

          // Handle different output formats
          if (format === 'json') {
            // For JSON format, use camelCase or snake_case naming
            if (attributeName === 'href') {
              cleanFieldName = `${fieldDisplayName}_url`;
            } else if (attributeName === 'src') {
              cleanFieldName = `${fieldDisplayName}_source`;
            } else {
              cleanFieldName = `${fieldDisplayName}_${attributeName}`;
            }
          } else if (format === 'csv' || format === 'text') {
            // For CSV and text formats, use human-readable names with spaces
            if (attributeName === 'href') {
              cleanFieldName = `${field.name} URL`;
            } else if (attributeName === 'src') {
              cleanFieldName = `${field.name} Source`;
            } else {
              cleanFieldName = `${field.name} ${attributeName.toUpperCase()}`;
            }
          } else if (format === 'html') {
            // For HTML format, use HTML5 data attributes style
            if (attributeName === 'href') {
              cleanFieldName = `${fieldDisplayName}-url`;
            } else if (attributeName === 'src') {
              cleanFieldName = `${fieldDisplayName}-source`;
            } else {
              cleanFieldName = `${fieldDisplayName}-${attributeName}`;
            }
          } else {
            // Default fallback - use underscore naming
            cleanFieldName = `${fieldDisplayName}_${attributeName}`;
          }

          // First check for column-specific attributes
          let attributeFound = false;

          // Look through all keys that might contain this attribute
          Object.keys(row).forEach(key => {
            // Match internal keys with this attribute
            if (key.startsWith('_') && key.endsWith(`_${attributeName}`)) {
              if (!attributeFound) {
                // Only use the first match to avoid duplicates
                cleanRow[cleanFieldName] = row[key];
                attributeFound = true;

                if (isDebugMode) {
                  logger.info(
                    formatOperationLog(
                      'smartExtraction',
                      nodeName,
                      nodeId,
                      itemIndex,
                      `Added ${attributeName} attribute as "${cleanFieldName}" from key "${key}" (format: ${format})`,
                      component,
                      functionName
                    )
                  );
                }
              }
            }
          });

          // If not found, try extracting from HTML as fallback
          if (!attributeFound && row._html) {
            try {
              const relativeSelector = fieldOptions.relativeSelector || '';
              const relativeSelectorOptional = fieldOptions.relativeSelectorOptional || false;

              // Try to extract from HTML
              const attributeValue = extractAttributeFromHtml(
                row._html,
                relativeSelector,
                attributeName,
                relativeSelectorOptional
              );

              if (attributeValue !== null) {
                cleanRow[cleanFieldName] = attributeValue;

                if (isDebugMode) {
                  logger.info(
                    formatOperationLog(
                      'smartExtraction',
                      nodeName,
                      nodeId,
                      itemIndex,
                      `Extracted ${attributeName} attribute as "${cleanFieldName}" from HTML using selector "${relativeSelector}" (format: ${format})`,
                      component,
                      functionName
                    )
                  );
                }
              }
            } catch (error) {
              if (isDebugMode) {
                logger.warn(
                  formatOperationLog(
                    'smartExtraction',
                    nodeName,
                    nodeId,
                    itemIndex,
                    `Failed to extract ${attributeName} from HTML: ${(error as Error).message}`,
                    component,
                    functionName
                  )
                );
              }
            }
          }
        }
      });
    }

    return cleanRow;
  };

  // Process each row and create clean output objects based on the desired format
  finalRows = rowsWithMetadata.map(row => createCleanRowObject(row, outputFormat));

  // For formats other than JSON, we may need additional post-processing
  if (outputFormat === 'html') {
    // For HTML format, convert rows to a table structure
    const htmlRows = finalRows.map(row => {
      const cells = Object.entries(row).map(([key, value]) => {
        // Add data attributes for any attribute fields
        let dataAttrs = '';
        if (key.includes('-')) {
          dataAttrs = ` data-${key}="${value}"`;
        }
        return `<td${dataAttrs}>${value}</td>`;
      }).join('');
      return `<tr>${cells}</tr>`;
    });

    // Extract column headers
    const headers = finalRows.length > 0 ?
      Object.keys(finalRows[0]).map(key => `<th>${key}</th>`).join('') : '';

    // Wrap in a table (we'll keep the array structure but with HTML content)
    finalRows = [`<table><thead><tr>${headers}</tr></thead><tbody>${htmlRows.join('')}</tbody></table>`];
  } else if (outputFormat === 'csv') {
    // For CSV, keep structure as is - will be converted to CSV later
  } else if (outputFormat === 'text') {
    // For text format, convert to readable string format
    const textRows = finalRows.map(row => {
      return Object.entries(row)
        .map(([key, value]) => `${key}: ${value}`)
        .join('\n');
    });

    finalRows = textRows.map(row => row + '\n------------------\n');
  }

  if (isDebugMode) {
    logger.info(
      formatOperationLog(
        'smartExtraction',
        nodeName,
        nodeId,
        itemIndex,
        `Created ${finalRows.length} ${outputFormat} row objects with format: ${outputFormat}`,
        component,
        functionName
      )
    );
  }

  return finalRows;
}

/**
 * Enhance fields with per-row attribute reference instructions
 */
export function enhanceFieldsWithAttributeReferences(
  fields: IField[],
  doDeepClone: boolean = true,
  logger?: ILogger,
  context?: { nodeName: string, nodeId: string, index: number }
): IField[] {
  // Clone the fields to avoid modifying the original
  const processedFields = doDeepClone ? JSON.parse(JSON.stringify(fields)) : [...fields];

  processedFields.forEach((field: IField) => {
    // Get field options if they exist
    const fieldOptions = (field as any).fieldOptions || {};

    // Check if this field is configured for attribute extraction
    if (fieldOptions.extractionType === 'attribute' && fieldOptions.attributeName && fieldOptions.attributeName.trim() !== '') {
      const attributeName = fieldOptions.attributeName;
      const fieldDisplayName = field.name.replace(/[^a-zA-Z0-9_]/g, '_');

      // Determine field names based on common attribute types for clearer instructions
      let mainFieldName = `${fieldDisplayName}_${attributeName}`;
      let alternateFieldName = '';

      // For common attributes, provide friendly alternate names
      if (attributeName === 'href') {
        mainFieldName = `${fieldDisplayName}_url`; // Make the URL version the primary name
        alternateFieldName = `${fieldDisplayName}_${attributeName}`;
      } else if (attributeName === 'src') {
        mainFieldName = `${fieldDisplayName}_source`; // Make the source version the primary name
        alternateFieldName = `${fieldDisplayName}_${attributeName}`;
      }

      // Add instructions to look for the attribute directly in the data structure
      const existingInstructions = field.instructions || '';
      let attributeInstructions = `\n\nIMPORTANT: Look for the field "${mainFieldName}" directly in the data`;

      // If we have alternate names, include those too
      if (alternateFieldName) {
        attributeInstructions += ` (or alternatively "${alternateFieldName}")`;
      }

      attributeInstructions += `. This field contains the extracted ${attributeName} attribute value and should be used directly. DO NOT try to extract the attribute from HTML content.`;

      // If we already have some reference content instructions, don't duplicate
      if (!existingInstructions.includes(mainFieldName) &&
          (!alternateFieldName || !existingInstructions.includes(alternateFieldName))) {
        field.instructions = existingInstructions + attributeInstructions;

        if (logger && context) {
          logger.info(
            formatOperationLog(
              'SmartExtraction',
              context.nodeName,
              context.nodeId,
              context.index,
              `Enhanced field "${field.name}" with direct attribute reference instructions for "${attributeName}"`
            )
          );
        }
      }
    }
  });

  return processedFields;
}

/**
 * Helper function to extract an attribute from HTML content
 */
function extractAttributeFromHtml(html: string, relativeSelector: string, attributeName: string, isOptional: boolean = false): string | null {
  try {
    // Use cheerio or similar library to extract the attribute
    // This is a placeholder - the actual implementation would depend on your HTML parsing approach

    // Example implementation:
    const cheerio = require('cheerio');
    const $ = cheerio.load(html);

    const element = relativeSelector ? $(relativeSelector) : $('*').first();

    if (element.length === 0) {
      if (isOptional) {
        return null;
      }
      throw new Error(`Element not found using selector: ${relativeSelector}`);
    }

    const attributeValue = element.attr(attributeName);
    return attributeValue || null;
  } catch (error) {
    if (isOptional) {
      return null;
    }
    throw error;
  }
}
