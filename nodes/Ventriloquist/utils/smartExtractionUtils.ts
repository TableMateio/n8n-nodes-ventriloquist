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
      { nodeName, nodeId, index: itemIndex },
      options.debugMode === true
    );

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
  const isDebugMode = options.debugMode === true;

  // DIRECT DEBUG OUTPUT - Always use console.error for maximum visibility
  if (isDebugMode) {
    console.error(`!!! OPENAI API DEBUG !!! [${nodeName}/${nodeId}] Starting AI processing with model ${options.aiModel}`);
    console.error(`!!! OPENAI API DEBUG !!! [${nodeName}/${nodeId}] Debug mode: ${isDebugMode}, API key available: ${!!apiKey}`);
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

  // Always log with console.error if debug mode is enabled (Max visibility)
  if (isDebugMode) {
    console.error(`!!! OPENAI API DEBUG !!! [${nodeName}/${nodeId}] Process with API key length: ${apiKey.length}`);
  }

  // Log the start of AI processing with key information
  logger?.info(
    formatOperationLog(
      'aiProcessing',
      nodeName,
      nodeId,
      index,
      `Starting AI processing with ${options.strategy} strategy, model: ${options.aiModel}, API key available: true (length: ${apiKey.length})`
    )
  );

  try {
    // Try to dynamically import OpenAI - simplified approach to avoid import issues
    let OpenAI;
    try {
      // Add a direct console log here to verify the code is being executed
      if (isDebugMode) {
        logger?.error(formatOperationLog('aiProcessing', nodeName, nodeId, index,
          `ABOUT TO LOAD OPENAI LIBRARY AND MAKE API CALL TO ${options.aiModel.toUpperCase()}`));
        console.error(`!!! OPENAI API DEBUG !!! [${nodeName}/${nodeId}] About to load OpenAI library and call API`);
      }

      // First try CommonJS require if available
      try {
        OpenAI = require('openai');
        // The import structure changed in newer versions of the OpenAI package
        if (OpenAI.default) {
          OpenAI = OpenAI.default;
        }

        if (isDebugMode) {
          console.error(`!!! OPENAI API DEBUG !!! [${nodeName}/${nodeId}] Used require() to load OpenAI library`);
        }
      } catch (reqError) {
        // Fall back to dynamic import
        if (isDebugMode) {
          console.error(`!!! OPENAI API DEBUG !!! [${nodeName}/${nodeId}] Require failed, using dynamic import: ${reqError.message}`);
        }

        const openaiModule = await import('openai');
        OpenAI = openaiModule.default || openaiModule;

        if (isDebugMode) {
          console.error(`!!! OPENAI API DEBUG !!! [${nodeName}/${nodeId}] Used dynamic import to load OpenAI library`);
        }
      }

      if (!OpenAI) {
        if (isDebugMode) {
          console.error(`!!! OPENAI API DEBUG ERROR !!! [${nodeName}/${nodeId}] Failed to import OpenAI library`);
        }
        throw new Error('Failed to import OpenAI package');
      }

      if (isDebugMode) {
        logger?.error(formatOperationLog('aiProcessing', nodeName, nodeId, index,
          `OPENAI LIBRARY LOADED SUCCESSFULLY`));
        console.error(`!!! OPENAI API DEBUG !!! [${nodeName}/${nodeId}] OpenAI library loaded successfully`);
      }
    } catch (err) {
      logger?.error(formatOperationLog('aiProcessing', nodeName, nodeId, index,
        `Failed to import OpenAI: ${err.message}`));
      if (isDebugMode) {
        console.error(`!!! OPENAI API DEBUG ERROR !!! [${nodeName}/${nodeId}] Failed to import OpenAI: ${err.message}`);
      }
      throw new Error(`OpenAI package not installed. Please run: npm install openai`);
    }

    // Create an OpenAI instance - handle both newer and older API formats
    const openai = typeof OpenAI === 'function' ? new OpenAI({ apiKey }) : new OpenAI.OpenAI({ apiKey });

    if (isDebugMode) {
      console.error(`!!! OPENAI API DEBUG !!! [${nodeName}/${nodeId}] Created OpenAI client instance`);
    }

    // Convert content to string if needed
    const contentString = typeof content === 'string' ? content : JSON.stringify(content, null, 2);

    // Build the appropriate prompt based on strategy
    let prompt = '';
    if (options.strategy === 'auto') {
      prompt = buildAutoPrompt(contentString, options);
    } else {
      prompt = buildManualPrompt(contentString, options, fields);
    }

    // Log details about reference format if applicable
    if (options.includeReferenceContext && options.referenceContent) {
      logger?.debug(
        formatOperationLog(
          'aiProcessing',
          nodeName,
          nodeId,
          index,
          `Including reference context (${options.referenceName}) with format: ${options.referenceFormat || 'text'}`
        )
      );
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

    try {
      // Build the request payload to log it before sending
      const requestPayload: {
        model: string;
        messages: { role: string; content: string }[];
        response_format?: { type: string };
        functions?: any[];
        tools?: any[];
        [key: string]: any; // Allow for additional properties
      } = {
        model: options.aiModel,
        messages: [
          {
            role: 'system',
            content: `You are a data extraction and formatting assistant. Extract and format the provided content according to the instructions.
${options.referenceContent && options.referenceContent.includes('has href =') ? 'Pay special attention to URLs, links, and href attributes mentioned in the reference context.' : ''}
${options.referenceContent && options.referenceContent.includes('has src =') ? 'Pay special attention to image sources, src attributes, and media references mentioned in the reference context.' : ''}
${options.referenceContent && options.referenceContent.includes('has data-') ? 'Pay special attention to data attributes mentioned in the reference context.' : ''}
Always respond with valid JSON. Do not include code blocks or explanations in your response.`,
          },
          {
            role: 'user',
            content: prompt,
          },
        ],
        response_format: options.aiModel.includes('gpt-4-turbo') || options.aiModel.includes('gpt-3.5-turbo')
          ? { type: 'json_object' }
          : undefined,
      };

      // Always log with console.error if debug mode is enabled (Max visibility)
      if (isDebugMode) {
        console.error(`!!! OPENAI API DEBUG !!! [${nodeName}/${nodeId}] About to send request to ${options.aiModel}`);
        console.error(`!!! OPENAI API DEBUG !!! [${nodeName}/${nodeId}] Request: model=${requestPayload.model}, messages=${requestPayload.messages.length}`);

        // Log the full system and user messages for debugging
        console.error(`!!! OPENAI API DEBUG !!! [${nodeName}/${nodeId}] System message: ${requestPayload.messages[0].content}`);
        console.error(`!!! OPENAI API DEBUG !!! [${nodeName}/${nodeId}] User message: ${prompt}`);
      }

      // Log the OpenAI request in debug mode
      if (isDebugMode && logger) {
        // Extract schema information that might be in different formats
        const functionSchema = requestPayload.functions ?
          requestPayload.functions[0]?.parameters :
          requestPayload.tools && requestPayload.tools[0]?.function?.parameters;

        // First add a VERY visible marker in the logs using error level instead of info
        logger.error(
          formatOperationLog(
            'aiProcessing',
            nodeName,
            nodeId,
            index,
            `!!! OPENAI REQUEST DEBUGGING !!! Debug mode is ON. About to send request to ${options.aiModel}`
          )
        );

        // Also add console.error for maximum visibility
        console.error(`!!!! OPENAI DEBUG - ${nodeName}/${nodeId} - Sending request to ${options.aiModel}`);

        // Create a safe copy of the payload for logging that doesn't include the full messages
        const loggablePayload = {
          model: requestPayload.model,
          response_format: requestPayload.response_format,
          system_message_length: requestPayload.messages[0].content.length,
          user_message_length: requestPayload.messages[1].content.length,
          // Include the FULL prompt for debugging - not just a preview
          prompt_full: prompt,
          // Include information about functions or tools if present
          has_functions: !!requestPayload.functions,
          has_tools: !!requestPayload.tools,
          function_count: requestPayload.functions?.length || 0,
          tool_count: requestPayload.tools?.length || 0
        };

        logger.error(
          formatOperationLog(
            'aiProcessing',
            nodeName,
            nodeId,
            index,
            `!!! OpenAI API Request: ${JSON.stringify(loggablePayload, null, 2)}`
          )
        );

        // If there's a schema defined in functions, log it
        if (requestPayload.functions && requestPayload.functions.length > 0) {
          logger.error(
            formatOperationLog(
              'aiProcessing',
              nodeName,
              nodeId,
              index,
              `OpenAI API Function Schema: ${JSON.stringify(requestPayload.functions, null, 2)}`
            )
          );
        }

        // If there are tools defined, log them
        if (requestPayload.tools && requestPayload.tools.length > 0) {
          logger.error(
            formatOperationLog(
              'aiProcessing',
              nodeName,
              nodeId,
              index,
              `OpenAI API Tools Schema: ${JSON.stringify(requestPayload.tools, null, 2)}`
            )
          );
        }
      }

      // Direct debug log right before the API call
      if (isDebugMode) {
        console.error(`!!! OPENAI API DEBUG !!! [${nodeName}/${nodeId}] Calling OpenAI completions API NOW`);
      }

      // Create completion with OpenAI
      const response = await openai.chat.completions.create(requestPayload);

      // Direct debug log right after the API call
      if (isDebugMode) {
        console.error(`!!! OPENAI API DEBUG !!! [${nodeName}/${nodeId}] Received response from OpenAI API`);
      }

      // Log the response in debug mode
      if (isDebugMode && logger) {
        // Create a safe copy of the response for logging (without too much detail)
        const loggableResponse = {
          id: response.id,
          object: response.object,
          created: response.created,
          model: response.model,
          choices_count: response.choices?.length || 0,
          usage: response.usage,
        };

        logger.error(
          formatOperationLog(
            'aiProcessing',
            nodeName,
            nodeId,
            index,
            `!!! OpenAI API Response: ${JSON.stringify(loggableResponse, null, 2)}`
          )
        );

        // Log the FULL content response for debugging
        if (response.choices && response.choices.length > 0) {
          const contentFull = response.choices[0].message.content || '';
          logger.error(
            formatOperationLog(
              'aiProcessing',
              nodeName,
              nodeId,
              index,
              `OpenAI Response Content FULL: ${contentFull}`
            )
          );
        }

        // Also log directly to console for maximum visibility
        console.error(`!!! OPENAI API DEBUG !!! [${nodeName}/${nodeId}] Response received with ID: ${response.id}, ${response.choices?.length || 0} choices`);
        if (response.choices && response.choices.length > 0 && response.choices[0].message.content) {
          console.error(`!!! OPENAI API DEBUG !!! [${nodeName}/${nodeId}] FULL Response content: ${response.choices[0].message.content}`);
        }
      }

      // Check if we have a valid response
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

      // If we have a schema and this is manual mode with fields, enrich the schema with field descriptions
      let enrichedSchema = schema;
      if (schema) {
        if (options.strategy === 'manual' && fields.length > 0) {
          enrichedSchema = enrichSchemaWithFieldDescriptions(schema, fields);
        }

        // If we have attribute information in the reference content, add it to the schema
        if (options.referenceContent && options.referenceContent.includes('has ') && typeof enrichedSchema === 'object') {
          // Add attribute information to schema description if present
          const attributeMatch = options.referenceContent.match(/has (\w+) = "([^"]*)"/);
          if (attributeMatch && attributeMatch.length >= 3) {
            const [, attributeName, attributeValue] = attributeMatch;

            // Add attribute information to the schema description
            if (enrichedSchema.type === 'object' && enrichedSchema.properties) {
              // Find properties that might be related to this attribute
              Object.keys(enrichedSchema.properties).forEach(key => {
                // If property name contains words related to the attribute (URL, link, etc.)
                if (
                  (attributeName === 'href' && /url|link|href/i.test(key)) ||
                  (attributeName === 'src' && /src|image|picture|source/i.test(key)) ||
                  key.toLowerCase().includes(attributeName.toLowerCase())
                ) {
                  // Add attribute information to the property description
                  const propDesc = enrichedSchema.properties[key].description || '';
                  if (!propDesc.includes(`${attributeName} attribute`)) {
                    enrichedSchema.properties[key].description =
                      `${propDesc}${propDesc ? ' ' : ''}This value may come from the ${attributeName} attribute with value: "${attributeValue}".`;
                  }
                }
              });
            }
          }
        }
      }

      // Log success
      logger?.info(
        formatOperationLog(
          'aiProcessing',
          nodeName,
          nodeId,
          index,
          `AI processing completed successfully with model ${options.aiModel}`
        )
      );

      // Log the schema if present and debug mode is enabled
      if (isDebugMode && logger && enrichedSchema) {
        logger.error(
          formatOperationLog(
            'aiProcessing',
            nodeName,
            nodeId,
            index,
            `OpenAI Response Schema FULL: ${JSON.stringify(enrichedSchema, null, 2)}`
          )
        );

        // Log the field descriptions separately for easier debugging
        if (enrichedSchema.type === 'object' && enrichedSchema.properties) {
          const fieldDescriptions = Object.keys(enrichedSchema.properties).reduce((acc, key) => {
            acc[key] = enrichedSchema.properties[key].description || 'No description';
            return acc;
          }, {} as Record<string, string>);

          logger.error(
            formatOperationLog(
              'aiProcessing',
              nodeName,
              nodeId,
              index,
              `Schema Field Descriptions: ${JSON.stringify(fieldDescriptions, null, 2)}`
            )
          );
        }
      }

      return {
        success: true,
        data,
        schema: enrichedSchema,
      };
    } catch (error) {
      // Handle OpenAI API errors specifically
      if (error.response && error.response.status) {
        const statusCode = error.response.status;
        const message = error.response.data?.error?.message || 'Unknown OpenAI API error';
        throw new Error(`OpenAI API error (${statusCode}): ${message}`);
      }
      // Re-throw other errors
      throw error;
    }
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
