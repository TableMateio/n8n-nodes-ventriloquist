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
}

/**
 * Interface for AI field definition
 */
export interface IAIField {
  name: string;
  description?: string;
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
      { nodeName, nodeId, index: itemIndex }
    );

    // Process content based on strategy
    const aiOptions: IAIExtractionOptions = {
      strategy: options.strategy === 'auto' ? 'auto' : 'manual',
      model: options.aiModel,
      generalInstructions: options.generalInstructions,
      includeSchema: options.includeSchema,
      includeRawData: options.includeRawData
    };

    // Add fields for manual strategy
    if (options.strategy === 'manual' && fields) {
      aiOptions.fields = fields;
    }

    // Process content with AI
    const result = await aiService.processContent(content, aiOptions);

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

  // Check if API key is provided
  if (!apiKey) {
    const error = 'OpenAI API key is required for AI processing';
    logger?.error(formatOperationLog('aiProcessing', nodeName, nodeId, index, error));
    return { success: false, error };
  }

  // Log the start of AI processing
  logger?.debug(
    formatOperationLog(
      'aiProcessing',
      nodeName,
      nodeId,
      index,
      `Starting AI processing with ${options.strategy} strategy, format: ${options.extractionFormat}`
    )
  );

  try {
    // Try to dynamically import OpenAI
    let OpenAI;
    try {
      const { default: openai } = await import('openai');
      OpenAI = openai;
    } catch (err) {
      throw new Error(`OpenAI package not installed. Please run: npm install openai`);
    }

    // Create an OpenAI instance
    const openai = new OpenAI({
      apiKey,
    });

    // Convert content to string if needed
    const contentString = typeof content === 'string' ? content : JSON.stringify(content, null, 2);

    // Build the appropriate prompt based on strategy
    let prompt = '';
    if (options.strategy === 'auto') {
      prompt = buildAutoPrompt(contentString, options);
    } else {
      prompt = buildManualPrompt(contentString, options, fields);
    }

    logger?.debug(
      formatOperationLog(
        'aiProcessing',
        nodeName,
        nodeId,
        index,
        `Sending content to ${options.aiModel} with ${contentString.length} characters`
      )
    );

    // Create completion with OpenAI
    const response = await openai.chat.completions.create({
      model: options.aiModel,
      messages: [
        {
          role: 'system',
          content: 'You are a data extraction and formatting assistant. Extract and format the provided content according to the instructions. Always respond with valid JSON. Do not include code blocks or explanations in your response.',
        },
        {
          role: 'user',
          content: prompt,
        },
      ],
      response_format: options.aiModel.includes('gpt-4-turbo') || options.aiModel.includes('gpt-3.5-turbo')
        ? { type: 'json_object' }
        : undefined,
    });

    // Process the response
    if (!response.choices || response.choices.length === 0) {
      throw new Error('Invalid response from OpenAI API');
    }

    const aiResponse = response.choices[0].message.content;
    if (!aiResponse) {
      throw new Error('Empty response from OpenAI API');
    }

    // Parse the JSON response
    let parsedResponse;
    try {
      parsedResponse = JSON.parse(aiResponse);
    } catch (error) {
      // If the response is not valid JSON, try to extract JSON from the text
      // This handles cases where the model might include explanations
      const jsonMatch = aiResponse.match(/\{[\s\S]*\}/);
      if (jsonMatch) {
        try {
          parsedResponse = JSON.parse(jsonMatch[0]);
        } catch {
          throw new Error(`Failed to parse AI response as JSON: ${(error as Error).message}`);
        }
      } else {
        throw new Error(`Failed to parse AI response as JSON: ${(error as Error).message}`);
      }
    }

    // Extract data and schema from the response
    let data = parsedResponse.data || parsedResponse;
    const schema = parsedResponse.schema;

    // Log success
    logger?.debug(
      formatOperationLog(
        'aiProcessing',
        nodeName,
        nodeId,
        index,
        `AI processing completed successfully`
      )
    );

    return {
      success: true,
      data,
      schema,
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

${options.includeSchema ? 'Include a "schema" field in your response that describes the structure of the data.\n' : ''}

Please format your response as a valid JSON object, with the extracted data in a "data" field.

Content to extract:
\`\`\`
${content}
\`\`\`
`;

  return prompt;
}

/**
 * Build a prompt for the manual strategy with field definitions
 * @param content Content to process
 * @param options Processing options
 * @param fields Field definitions
 */
function buildManualPrompt(content: string, options: ISmartExtractionOptions, fields: IAIField[]): string {
  // Base instructions with field definitions
  let prompt = `
Extract the following fields from the content below, using the format ${options.extractionFormat.toUpperCase()}.
${options.generalInstructions ? options.generalInstructions + '\n' : ''}

Fields to extract:
`;

  // Add each field definition
  fields.forEach((field) => {
    prompt += `- ${field.name}${field.required ? ' (Required)' : ''}: ${field.description || ''} (Type: ${field.type || 'string'})\n`;
  });

  prompt += `\n${options.includeSchema ? 'Include a "schema" field in your response that describes the structure of the data.\n' : ''}

Please format your response as a valid JSON object, with the extracted data in a "data" field.

Content to extract:
\`\`\`
${content}
\`\`\`
`;

  return prompt;
}
