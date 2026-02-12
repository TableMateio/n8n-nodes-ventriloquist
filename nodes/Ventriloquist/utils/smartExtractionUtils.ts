import { Logger } from 'n8n-workflow';
import { formatOperationLog } from './resultUtils';
import { IMiddlewareContext } from './middlewares/middleware';
import { AIService, IAIExtractionOptions } from './aiService';
import { logWithDebug } from './loggingUtils';
import type * as puppeteer from 'puppeteer-core';
import { enhanceFieldsWithRelativeSelectorContent } from './processOpenAISchema';

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
  outputStructure?: 'object' | 'array';
  fieldProcessingMode?: 'batch' | 'individual'; // Add field processing mode
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
  // Set up default logger if not provided
  const logger = context?.logger || console;
  const nodeName = context?.nodeName || 'Ventriloquist';
  const nodeId = context?.nodeId || 'unknown';
  const itemIndex = context?.index !== undefined ? context.index : 0;
  const isDebugMode = options.debugMode === true;
  const component = 'smartExtractionUtils';
  const functionName = 'extractSmartContent';

  try {
    // Log the start of extraction
    logger.info(
      formatOperationLog(
        'smartExtraction',
        nodeName,
        nodeId,
        itemIndex,
        `Starting smart extraction using selector: ${selector}`,
        component,
        functionName
      )
    );

    // Log that we're using the Assistants API path
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

        // Get all elements that match the selector
        // Build combined content from all matched elements
        return elements.map(element => element.outerHTML).join('\n');
      });

      content = extractedContent;

      logger.info(
        formatOperationLog(
          'smartExtraction',
          nodeName,
          nodeId,
          itemIndex,
          `Extracted content from ${content.split('\n').filter(line => line.trim().startsWith('<')).length} elements (${content.length} chars): "${content.substring(0, 100)}${content.length > 100 ? '...' : ''}"`,
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
      outputStructure: (options.outputStructure || 'object') as 'object' | 'array',
      fieldProcessingMode: options.fieldProcessingMode || 'batch',
      debugMode: options.debugMode
    };

    // Add explicit logging for the outputStructure
    if (isDebugMode) {
      logger.error(
        formatOperationLog(
          'smartExtraction',
          nodeName,
          nodeId,
          itemIndex,
          `[CRITICAL] Using outputStructure=${aiOptions.outputStructure} (from options.outputStructure=${options.outputStructure || 'undefined'})`,
          component,
          functionName
        )
      );
    }

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

      // Add explicit logging for outputStructure just before the API call
      logger.error(
        formatOperationLog(
          'SmartExtraction',
          nodeName,
          nodeId,
          itemIndex,
          `CRITICAL: About to call AIService.processContent with outputStructure=${aiOptions.outputStructure} and fieldProcessingMode=${aiOptions.fieldProcessingMode}`,
          component,
          functionName
        )
      );
    }

    // Process content with AIService
    const result = await aiService.processContent(stringContent, aiOptions);

    return {
      success: result.success,
      data: result.data,
      schema: result.schema,
      error: result.error
    };
  } catch (error) {
    const errorMessage = `AI processing failed: ${(error as Error).message}`;
    logger.error(formatOperationLog('aiProcessing', nodeName, nodeId, itemIndex, errorMessage));

    return {
      success: false,
      error: errorMessage
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

    // Explicitly log the outputStructure value for debugging
    if (isDebugMode && logger) {
      logger.error(
        formatOperationLog(
          'SmartExtraction',
          nodeName,
          nodeId,
          index,
          `OUTPUT STRUCTURE TRACKING: Processing with outputStructure=${options.outputStructure || 'object'} and fieldProcessingMode=${options.fieldProcessingMode || 'batch'}`,
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
      outputStructure: (options.outputStructure || 'object') as 'object' | 'array',
      fieldProcessingMode: options.fieldProcessingMode || 'batch',
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
