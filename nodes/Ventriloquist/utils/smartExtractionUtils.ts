import { Logger } from 'n8n-workflow';
import { formatOperationLog } from './resultUtils';
import { IMiddlewareContext } from './middlewares/middleware';
import { AIService, IAIExtractionOptions } from './aiService';

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
}

/**
 * Interface for AI field definition
 */
export interface IAIField {
  name: string;
  instructions?: string;  // This field contains the UI instructions which become OpenAI schema descriptions
  type?: string;
  required?: boolean;
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
  page: any,
  selector: string,
  options: ISmartExtractionOptions,
  fields?: any[],
  openaiApiKey?: string,
  context?: IMiddlewareContext
): Promise<any> {
  const logger = context?.logger as Logger;
  const nodeName = context?.nodeName || 'Ventriloquist';
  const nodeId = context?.nodeId || 'unknown';
  const itemIndex = context?.index !== undefined ? context.index : 0;
  const isDebugMode = options.debugMode === true;

  try {
    // Log the start of extraction
    logger?.debug(
      formatOperationLog(
        'smartExtraction',
        nodeName,
        nodeId,
        itemIndex,
        `Starting smart extraction with selector: ${selector}`
      )
    );

    // Log that we're using the Assistants API path
    if (isDebugMode) {
      logger?.error(
        formatOperationLog(
          'smartExtraction',
          nodeName,
          nodeId,
          itemIndex,
          `!!! IMPORTANT !!! Using AIService with OpenAI Assistants API path (not Chat Completions)`
        )
      );
      console.error(`!!! EXTRACTION DEBUG !!! [${nodeName}/${nodeId}] Using AIService with Assistants API path`);
    }

    // Extract raw content from the page
    let content = '';
    try {
      content = await page.evaluate((sel: string) => {
        const element = document.querySelector(sel);
        return element ? element.textContent : '';
      }, selector);
    } catch (error) {
      logger?.error(
        formatOperationLog(
          'smartExtraction',
          nodeName,
          nodeId,
          itemIndex,
          `Error extracting content: ${error}`
        )
      );
      throw new Error(`Failed to extract content from selector '${selector}': ${error}`);
    }

    // If no content was found, log an error and return empty result
    if (!content || content.trim() === '') {
      logger?.error(
        formatOperationLog(
          'smartExtraction',
          nodeName,
          nodeId,
          itemIndex,
          `No content found for selector: ${selector}`
        )
      );
      return { data: null, error: 'No content found' };
    }

    // Detect content type if set to auto
    let extractionFormat = options.extractionFormat;
    if (extractionFormat === 'auto') {
      extractionFormat = detectContentType(content);
      logger?.debug(
        formatOperationLog(
          'smartExtraction',
          nodeName,
          nodeId,
          itemIndex,
          `Detected content type: ${extractionFormat}`
        )
      );
    }

    // Initialize AI service
    const aiService = new AIService(
      openaiApiKey || '',
      logger || console,
      { nodeName, nodeId, index: itemIndex },
      options.debugMode === true
    );

    // Log the AIService initialization
    if (isDebugMode) {
      logger?.info(
        formatOperationLog(
          'smartExtraction',
          nodeName,
          nodeId,
          itemIndex,
          `Created AIService instance with API key (length: ${openaiApiKey?.length || 0}), model: ${options.aiModel}`
        )
      );
    }

    // Process content based on strategy
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

    // Log field count if in manual strategy
    if (options.strategy === 'manual' && fields) {
      logger?.debug(
        formatOperationLog(
          'smartExtraction',
          nodeName,
          nodeId,
          itemIndex,
          `Manual strategy with ${fields.length} fields: ${fields.map(f => f.name).join(', ')}`
        )
      );
    }

    // Log reference context if available
    if (options.includeReferenceContext && options.referenceContent) {
      logger?.debug(
        formatOperationLog(
          'smartExtraction',
          nodeName,
          nodeId,
          itemIndex,
          `Including reference context: ${options.referenceName || 'referenceContext'} (${options.referenceContent.length} chars)`
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

    // Process content with AI
    logger?.info(
      formatOperationLog(
        'smartExtraction',
        nodeName,
        nodeId,
        itemIndex,
        `Calling AIService.processContent with ${content.length} chars, strategy: ${aiOptions.strategy}`
      )
    );

    const result = await aiService.processContent(content, aiOptions);

    // Log result
    if (isDebugMode) {
      logger?.info(
        formatOperationLog(
          'smartExtraction',
          nodeName,
          nodeId,
          itemIndex,
          `AIService.processContent result: success=${result.success}, dataSize=${result.data ? JSON.stringify(result.data).length : 0}, hasSchema=${!!result.schema}`
        )
      );
    }

    return result;
  } catch (error) {
    // Log error
    logger?.error(
      formatOperationLog(
        'smartExtraction',
        nodeName,
        nodeId,
        itemIndex,
        `Smart extraction failed: ${error}`
      )
    );

    // Return error result
    return {
      data: null,
      error: `Smart extraction failed: ${error}`,
    };
  }
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
    logger: Logger;
    nodeName: string;
    nodeId: string;
    sessionId?: string;
    index: number;
  }
): Promise<{ success: boolean; data?: any; error?: string; schema?: any }> {
  const logger = context?.logger;
  const nodeName = context?.nodeName || 'Ventriloquist';
  const nodeId = context?.nodeId || 'unknown';
  const index = context?.index ?? 0;
  const isDebugMode = options.debugMode === true;

  // DIRECT DEBUG OUTPUT - Always use console.error for maximum visibility
  if (isDebugMode) {
    console.error(`!!! OPENAI API DEBUG !!! [${nodeName}/${nodeId}] Starting AI processing with model ${options.aiModel}`);
    console.error(`!!! OPENAI API DEBUG !!! [${nodeName}/${nodeId}] Debug mode: ${isDebugMode}, API key available: ${!!apiKey}`);
    console.error(`!!! OPENAI API DEBUG !!! [${nodeName}/${nodeId}] IMPORTANT: REDIRECTING TO USE ASSISTANTS API INSTEAD OF CHAT COMPLETIONS`);
  }

  // Attempt to recover API key from options if not provided directly
  if (!apiKey && options.hasOwnProperty('openaiApiKey')) {
    logger?.debug(formatOperationLog('aiProcessing', nodeName, nodeId, index,
      'Recovered API key from options object'));
    apiKey = (options as any).openaiApiKey;
  }

  // More robust API key validation - check if it's a string and has a minimum length
  if (!apiKey || typeof apiKey !== 'string' || apiKey.length < 10) {
    const error = `OpenAI API key is ${!apiKey ? 'missing' : 'invalid'} - length: ${apiKey ? apiKey.length : 0}`;
    logger?.error(formatOperationLog('aiProcessing', nodeName, nodeId, index, error));

    if (isDebugMode) {
      console.error(`!!! OPENAI API DEBUG ERROR !!! [${nodeName}/${nodeId}] ${error}`);
    }

    return { success: false, error };
  }

  // Log the API redirect to ensure it's visible in the logs
  logger?.info(
    formatOperationLog(
      'aiProcessing',
      nodeName,
      nodeId,
      index,
      `Redirecting to use AIService with Assistants API instead of direct Chat Completions API calls`
    )
  );

  try {
    // Convert content to string if needed
    const contentString = typeof content === 'string' ? content : JSON.stringify(content, null, 2);

    // Initialize AI service with the same context
    const aiService = new AIService(
      apiKey,
      logger || console,
      { nodeName, nodeId, index },
      isDebugMode
    );

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
          console.error(
            `!!! OPENAI API DEBUG !!! [${nodeName}/${nodeId}] ` +
            `Field "${field.name}" options: extractionType=${extractionType}, ` +
            `attributeName=${attributeName}, aiMode=${aiProcessingMode}, ` +
            `threadMode=${threadManagement}, hasRefContent=${!!referenceContent}`
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
      console.error(`!!! OPENAI API DEBUG !!! [${nodeName}/${nodeId}] Using AIService.processContent with ${fields.length} fields`);
    }

    // Process content with AIService
    const result = await aiService.processContent(contentString, aiOptions);

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
