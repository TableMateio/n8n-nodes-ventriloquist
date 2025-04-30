import type { Logger as ILogger } from 'n8n-workflow';
import { formatOperationLog } from './resultUtils';
import { processFieldsWithReferenceContent } from './processOpenAISchema';

/**
 * Extended field interface to handle fields with direct attribute references
 */
interface IExtendedField extends IField {
  returnDirectAttribute?: boolean;
  referenceContent?: string;
}

/**
 * This is a workaround for TypeScript errors when importing OpenAI
 * We need to install the package with npm install openai first
 */
let OpenAI: any;
try {
  // We use dynamic import to avoid TypeScript errors during build
  // The actual import will happen at runtime
  OpenAI = require('openai').default;
} catch (error) {
  // Handle the case where the package is not installed
  console.error('OpenAI package not found. Please install it with: npm install openai');
}

/**
 * Assistant IDs for different extraction strategies
 */
const ASSISTANTS = {
  auto: 'asst_YOKjWiQPTTeg3OvDV6D8984n',   // Auto mode assistant
  manual: 'asst_p65Hrk79gidj5thHqgs4W1lK', // Manual mode assistant
  logic: 'asst_zTIRLcYVwLPgZ93XeVDzbufs',  // Logic/numerical analysis assistant
};

/**
 * Type for defining a field in manual strategy
 */
export interface IField {
  name: string;
  type: string;
  instructions: string;  // This becomes the "description" in the OpenAI schema
  format: string;
  formatString?: string;
  examples?: Array<{
    input: string;
    output: string;
  }>;
  useLogicAnalysis?: boolean;  // Flag to use the logic assistant for this field
  useSeparateThread?: boolean; // Flag to use a separate thread for this field
}

/**
 * Options for AI extraction
 */
export interface IAIExtractionOptions {
  strategy: 'auto' | 'manual' | 'template';
  model: string;
  generalInstructions: string;
  fields?: IField[];
  includeSchema: boolean;
  includeRawData: boolean;
  includeReferenceContext?: boolean;
  referenceName?: string;
  referenceFormat?: string;
  referenceAttribute?: string;
  selectorScope?: string;
  referenceContent?: string;
  debugMode?: boolean; // Whether debug mode is enabled
}

/**
 * Result from AI extraction
 */
export interface IAIExtractionResult {
  success: boolean;
  data?: any;
  schema?: any;
  rawData?: any;
  error?: string;
}

/**
 * Service for handling AI extraction operations
 */
export class AIService {
  private openai: any; // Using any to avoid TypeScript errors
  private logger: ILogger;
  private context: {
    nodeName: string;
    nodeId: string;
    index: number;
  };
  private options?: IAIExtractionOptions;

  /**
   * Create a new AI service
   */
  constructor(
    apiKey: string,
    logger: ILogger,
    context: {
      nodeName: string;
      nodeId: string;
      index: number;
    },
    debugMode: boolean = false
  ) {
    if (!OpenAI) {
      throw new Error('OpenAI package not found. Please install it with: npm install openai');
    }

    this.openai = new OpenAI({
      apiKey: apiKey,
    });
    this.logger = logger;
    this.context = context;

    // Initialize options with debugMode
    this.options = {
      strategy: 'auto',
      model: 'gpt-3.5-turbo',
      generalInstructions: '',
      includeSchema: false,
      includeRawData: false,
      debugMode: debugMode
    };
  }

  /**
   * Process content using AI with the specified options
   */
  async processContent(
    content: string,
    options: IAIExtractionOptions
  ): Promise<IAIExtractionResult> {
    const { nodeName, nodeId, index } = this.context;

    // Reset options for this run (no connection to previous runs)
    this.options = options;

    // Log debug mode state at the start of processing
    if (options.debugMode) {
      console.error(`!!! AISERVICE DEBUG !!! [${nodeName}/${nodeId}] Starting AI processing with debug mode enabled`);
      console.error(`!!! AISERVICE DEBUG !!! [${nodeName}/${nodeId}] IMPORTANT: Using OpenAI Chat Completions API, NOT Assistants API`);
    }

    try {
      this.logger.info(
        formatOperationLog(
          "SmartExtraction",
          nodeName,
          nodeId,
          index,
          `Processing content with AI (strategy: ${options.strategy}, model: ${options.model}, debugMode: ${options.debugMode === true})`
        )
      );

      // Explicitly log that we're using Chat Completions API
      this.logger.info(
        formatOperationLog(
          "SmartExtraction",
          nodeName,
          nodeId,
          index,
          `Using OpenAI Chat Completions API (not Assistants API) with model ${options.model}`
        )
      );

      // Log content length for debugging
      this.logger.debug(
        formatOperationLog(
          "SmartExtraction",
          nodeName,
          nodeId,
          index,
          `Content length: ${content.length} characters`
        )
      );

      // Log reference context if available
      if (options.includeReferenceContext && options.referenceContent) {
        this.logger.debug(
          formatOperationLog(
            "SmartExtraction",
            nodeName,
            nodeId,
            index,
            `Reference context included (${options.referenceName}): ${options.referenceContent?.substring(0, 50)}...`
          )
        );
      }

      let result: IAIExtractionResult;

      // Select processing method based on strategy
      if (options.strategy === 'auto') {
        result = await this.processAutoStrategy(content, options);
      } else if (options.strategy === 'manual') {
        result = await this.processManualStrategy(content, options);
      } else {
        throw new Error(`Strategy not implemented: ${options.strategy}`);
      }

      return result;
    } catch (error) {
      this.logger.error(
        formatOperationLog(
          "SmartExtraction",
          nodeName,
          nodeId,
          index,
          `AI extraction error: ${(error as Error).message}`
        )
      );
      return {
        success: false,
        error: (error as Error).message,
      };
    }
  }

  /**
   * Process content using the auto strategy (AI determines structure)
   */
  private async processAutoStrategy(
    content: string,
    options: IAIExtractionOptions
  ): Promise<IAIExtractionResult> {
    const { nodeName, nodeId, index } = this.context;
    const isDebugMode = options.debugMode === true;

    try {
      this.logger.info(
        formatOperationLog(
          "SmartExtraction",
          nodeName,
          nodeId,
          index,
          "Using Auto strategy - AI will determine data structure"
        )
      );

      // Log that we're using Chat Completions API, not the Assistants API referenced in the constants
      if (isDebugMode) {
        this.logger.error(
          formatOperationLog(
            "SmartExtraction",
            nodeName,
            nodeId,
            index,
            `NOTE: Despite 'ASSISTANTS' constant in code, we're using OpenAI Chat Completions API with model: ${options.model}`
          )
        );
        console.error(`!!! AISERVICE DEBUG !!! [${nodeName}/${nodeId}] Auto strategy uses Chat Completions API with model: ${options.model}`);
      }

      // Create a new thread (no tracking or management, just create a fresh one)
      const thread = await this.openai.beta.threads.create();

      // Log thread creation in debug mode
      if (isDebugMode) {
        this.logger.info(
          formatOperationLog(
            "SmartExtraction",
            nodeName,
            nodeId,
            index,
            `Created OpenAI thread: ${thread.id}`
          )
        );
      }

      // Create the message content
      const messageContent = this.buildAutoPrompt(content, options.generalInstructions);

      // Log the message in debug mode - Log FULL content in debug mode
      if (isDebugMode) {
        this.logger.error(
          formatOperationLog(
            "SmartExtraction",
            nodeName,
            nodeId,
            index,
            `!!! OPENAI ASSISTANT API DEBUGGING !!! Debug mode is ON, about to send request to assistant`
          )
        );

        // Also add console.error for maximum visibility
        console.error(`!!!! OPENAI ASSISTANT DEBUG - ${nodeName}/${nodeId} - Sending Assistant API request`);

        this.logger.error(
          formatOperationLog(
            "SmartExtraction",
            nodeName,
            nodeId,
            index,
            `!!! [OpenAI API Request] Full message content: ${JSON.stringify({
              role: "user",
              content: messageContent
            }, null, 2)}`
          )
        );
      }

      // Add a message to the thread with the content and instructions
      const message = await this.openai.beta.threads.messages.create(thread.id, {
        role: "user",
        content: messageContent,
      });

      // Log the created message ID
      if (isDebugMode) {
        this.logger.info(
          formatOperationLog(
            "SmartExtraction",
            nodeName,
            nodeId,
            index,
            `[OpenAI API] Created message with ID: ${message.id} for thread: ${thread.id}`
          )
        );
      }

      // Log the assistant ID that will be used
      if (isDebugMode) {
        this.logger.info(
          formatOperationLog(
            "SmartExtraction",
            nodeName,
            nodeId,
            index,
            `[OpenAI API Request] Using OpenAI Assistant ID: ${ASSISTANTS.auto}`
          )
        );
      }

      // Run the assistant on the thread
      const run = await this.openai.beta.threads.runs.create(thread.id, {
        assistant_id: ASSISTANTS.auto,
      });

      // Log run creation in debug mode
      if (isDebugMode) {
        this.logger.info(
          formatOperationLog(
            "SmartExtraction",
            nodeName,
            nodeId,
            index,
            `[OpenAI API] Created run: ${run.id} for thread: ${thread.id} with assistant: ${ASSISTANTS.auto}`
          )
        );
      }

      // Poll for completion
      const result = await this.pollRunCompletion(thread.id, run.id);

      // Process the response
      if (result.success && result.data) {
        const data = JSON.parse(result.data);

        // Generate schema if requested
        let schema = null;
        if (options.includeSchema) {
          schema = this.generateSchema(data);

          // Log schema in debug mode
          if (isDebugMode) {
            this.logger.info(
              formatOperationLog(
                "SmartExtraction",
                nodeName,
                nodeId,
                index,
                `Auto strategy generated schema: ${JSON.stringify(schema, null, 2)}`
              )
            );
          }
        }

        return {
          success: true,
          data,
          schema: schema,
          rawData: options.includeRawData ? content : undefined,
        };
      } else {
        throw new Error(result.error || 'Failed to get response from AI assistant');
      }
    } catch (error) {
      this.logger.error(
        formatOperationLog(
          "SmartExtraction",
          nodeName,
          nodeId,
          index,
          `Auto strategy processing error: ${(error as Error).message}`
        )
      );
      return {
        success: false,
        error: (error as Error).message,
      };
    }
  }

  /**
   * Process content using the manual strategy (field-by-field)
   */
  private async processManualStrategy(
    content: string,
    options: IAIExtractionOptions
  ): Promise<IAIExtractionResult> {
    const { nodeName, nodeId, index } = this.context;
    const isDebugMode = options.debugMode === true;

    try {
      this.logger.info(
        formatOperationLog(
          "SmartExtraction",
          nodeName,
          nodeId,
          index,
          "Using Manual strategy - extracting specific fields"
        )
      );

      // Log that we're using Chat Completions API, not the Assistants API referenced in the constants
      if (isDebugMode) {
        this.logger.error(
          formatOperationLog(
            "SmartExtraction",
            nodeName,
            nodeId,
            index,
            `NOTE: Despite 'ASSISTANTS' constant in code, we're using OpenAI Chat Completions API with model: ${options.model}`
          )
        );
        console.error(`!!! AISERVICE DEBUG !!! [${nodeName}/${nodeId}] Manual strategy uses Chat Completions API with model: ${options.model}`);
      }

      // Clone fields array to avoid modifying the original
      const fields = options.fields ? [...options.fields] : [];

      // Log reference context details
      if (options.includeReferenceContext) {
        this.logger.info(
          formatOperationLog(
            "SmartExtraction",
            nodeName,
            nodeId,
            index,
            `Reference context enabled: ${options.includeReferenceContext}, content length: ${options.referenceContent?.length || 0} chars`
          )
        );

        if (options.referenceContent) {
          this.logger.info(
            formatOperationLog(
              "SmartExtraction",
              nodeName,
              nodeId,
              index,
              `Reference content sample: ${options.referenceContent?.substring(0, 100)}${options.referenceContent && options.referenceContent?.length > 100 ? '...' : ''}`
            )
          );
        }
      }

      // Log original fields before processing
      fields.forEach(field => {
        this.logger.info(
          formatOperationLog(
            "SmartExtraction",
            nodeName,
            nodeId,
            index,
            `ORIGINAL Field "${field.name}" instructions (${field.instructions?.length || 0} chars): ${field.instructions?.substring(0, 100)}${field.instructions?.length > 100 ? '...' : ''}`
          )
        );
      });

      // Process fields with reference content if provided
      // This adds the reference content to the instructions for URL-related fields
      const processedFields = options.includeReferenceContext && options.referenceContent
        ? processFieldsWithReferenceContent(fields, options.referenceContent, true, this.logger, this.context)
        : fields;

      // Log the field instructions after processing to verify reference content is included
      this.logger.info(
        formatOperationLog(
          "SmartExtraction",
          nodeName,
          nodeId,
          index,
          `Field instructions after processing with reference content:`
        )
      );

      processedFields.forEach(field => {
        this.logger.info(
          formatOperationLog(
            "SmartExtraction",
            nodeName,
            nodeId,
            index,
            `PROCESSED Field "${field.name}" instructions (${field.instructions?.length || 0} chars): ${field.instructions?.substring(0, 100)}${field.instructions?.length > 100 ? '...' : ''}`
          )
        );

        // Log extended field properties
        const extendedField = field as IExtendedField;
        if (extendedField.returnDirectAttribute) {
          this.logger.info(
            formatOperationLog(
              "SmartExtraction",
              nodeName,
              nodeId,
              index,
              `Field "${field.name}" has returnDirectAttribute = true, reference content: ${extendedField.referenceContent?.substring(0, 50) || 'none'}`
            )
          );
        }
      });

      // Create a result object to store field-by-field responses
      const result: Record<string, any> = {};

      // Create a shared thread for fields that don't need separate threads
      const sharedThread = await this.openai.beta.threads.create();
      this.logger.debug(
        formatOperationLog(
          "SmartExtraction",
          nodeName,
          nodeId,
          index,
          `Created shared thread for standard fields: ${sharedThread.id}`
        )
      );

      // Process fields - logical analysis fields and fields that request a separate thread
      // will get their own threads, while others will share the thread
      for (const field of processedFields) {
        // Cast to extended field type to handle attribute properties
        const extendedField = field as IExtendedField;

        // Determine if this field needs a separate thread
        const needsSeparateThread = field.useLogicAnalysis === true || field.useSeparateThread === true;
        const threadToUse = needsSeparateThread ? null : sharedThread.id; // null means create a new thread

        this.logger.debug(
          formatOperationLog(
            "SmartExtraction",
            nodeName,
            nodeId,
            index,
            `Processing field "${field.name}" (type: ${field.type}, separate thread: ${needsSeparateThread})`
          )
        );

        // NOTE: We always process fields with AI when AI is enabled
        // Any attribute values from relative selectors are already included in the instructions
        // by the enhanceFieldsWithRelativeSelectorContent function

        // Process the field with the appropriate thread
        const fieldResult = await this.processFieldWithAI(threadToUse, content, field);

        if (fieldResult.success && fieldResult.data) {
          try {
            // Parse the result or use as is
            let parsedValue;
            try {
              parsedValue = JSON.parse(fieldResult.data);
            } catch (parseError) {
              // If not JSON, use as is
              parsedValue = fieldResult.data;
            }

            // Store the value
            result[field.name] = parsedValue;

            this.logger.debug(
              formatOperationLog(
                "SmartExtraction",
                nodeName,
                nodeId,
                index,
                `Successfully extracted field "${field.name}": ${
                  typeof parsedValue === 'string'
                    ? parsedValue
                    : JSON.stringify(parsedValue)
                }`
              )
            );
          } catch (error) {
            this.logger.warn(
              formatOperationLog(
                "SmartExtraction",
                nodeName,
                nodeId,
                index,
                `Error parsing result for field "${field.name}": ${(error as Error).message}`
              )
            );
            result[field.name] = fieldResult.data;
          }
        } else {
          this.logger.warn(
            formatOperationLog(
              "SmartExtraction",
              nodeName,
              nodeId,
              index,
              `Failed to extract field "${field.name}": ${fieldResult.error || 'Unknown error'}`
            )
          );
          result[field.name] = null;
        }
      }

      // Generate schema if requested
      let schema = null;
      if (options.includeSchema) {
        schema = this.generateOpenAISchema(processedFields);

        // Log the generated schema in debug mode (already logged in generateOpenAISchema, but adding here for clarity)
        if (isDebugMode) {
          this.logger.info(
            formatOperationLog(
              "SmartExtraction",
              nodeName,
              nodeId,
              index,
              `Manual strategy final schema (post-processing): ${JSON.stringify(schema, null, 2)}`
            )
          );
        }
      }

      return {
        success: true,
        data: result,
        schema,
        rawData: options.includeRawData ? content : undefined,
      };
    } catch (error) {
      this.logger.error(
        formatOperationLog(
          "SmartExtraction",
          nodeName,
          nodeId,
          index,
          `Manual strategy processing error: ${(error as Error).message}`
        )
      );
      return {
        success: false,
        error: (error as Error).message,
      };
    }
  }

  /**
   * Poll for run completion
   */
  private async pollRunCompletion(
    threadId: string,
    runId: string,
    maxAttempts = 30,
    delayMs = 1000
  ): Promise<{ success: boolean; data?: string; error?: string }> {
    const { nodeName, nodeId, index } = this.context;
    const isDebugMode = this.options?.debugMode === true;

    for (let attempt = 0; attempt < maxAttempts; attempt++) {
      try {
        // Check the run status
        const run = await this.openai.beta.threads.runs.retrieve(threadId, runId);

        // Log the run status in debug mode
        if (isDebugMode) {
          this.logger.error(
            formatOperationLog(
              "SmartExtraction",
              nodeName,
              nodeId,
              index,
              `[OpenAI API] Run status for ${runId}: ${run.status} (attempt ${attempt + 1}/${maxAttempts})`
            )
          );
        }

        if (run.status === 'completed') {
          // Get the messages from the thread, specifying we want only those after the assistant's response
          const response = await this.openai.beta.threads.messages.list(threadId, {
            limit: 1,
            order: 'desc',
          });

          // Log the full response in debug mode
          if (isDebugMode) {
            this.logger.error(
              formatOperationLog(
                "SmartExtraction",
                nodeName,
                nodeId,
                index,
                `[OpenAI API Response] Messages response data: ${JSON.stringify({
                  first_id: response.data[0]?.id,
                  message_count: response.data.length,
                  response_preview: response.data[0]?.content[0]?.type === 'text' ?
                    (response.data[0]?.content[0] as any).text.value.substring(0, 200) + '...' :
                    'Non-text content'
                }, null, 2)}`
              )
            );
          }

          // Extract the message content
          if (response.data.length > 0 && response.data[0].role === 'assistant') {
            const messageContent = response.data[0].content;

            if (messageContent.length > 0) {
              const content = messageContent[0];

              if (content.type === 'text') {
                const textContent = (content as any).text.value;

                // Log the full text content in debug mode
                if (isDebugMode) {
                  this.logger.error(
                    formatOperationLog(
                      "SmartExtraction",
                      nodeName,
                      nodeId,
                      index,
                      `[OpenAI API Response] Full text content: ${JSON.stringify(textContent, null, 2)}`
                    )
                  );
                }

                return { success: true, data: textContent };
              }
            }
          }

          return { success: false, error: 'No valid response content found' };
        } else if (run.status === 'failed') {
          return { success: false, error: `Run failed: ${run.last_error?.message || 'Unknown error'}` };
        } else if (run.status === 'expired') {
          return { success: false, error: 'Run expired' };
        } else if (run.status === 'cancelled') {
          return { success: false, error: 'Run was cancelled' };
        }

        // Wait before checking again
        await new Promise(resolve => setTimeout(resolve, delayMs));
      } catch (error) {
        if (isDebugMode) {
          this.logger.error(
            formatOperationLog(
              "SmartExtraction",
              nodeName,
              nodeId,
              index,
              `[OpenAI API Error] Error polling run completion: ${(error as Error).message}`
            )
          );
        }

        // If we're on the last attempt, throw the error
        if (attempt === maxAttempts - 1) {
          return { success: false, error: (error as Error).message };
        }

        // Otherwise wait and try again
        await new Promise(resolve => setTimeout(resolve, delayMs));
      }
    }

    return { success: false, error: `Timed out after ${maxAttempts} attempts` };
  }

  /**
   * Build prompt for auto strategy
   */
  private buildAutoPrompt(content: string, generalInstructions: string): string {
    // Create a base prompt
    let prompt = "You are an expert data extraction assistant.\n\n";

    // Add reference context if available
    if (this.options?.includeReferenceContext && this.options?.referenceContent) {
      prompt += `\nREFERENCE CONTEXT (${this.options.referenceName || 'referenceContext'}):\n${this.options.referenceContent}\n\n`;
    }

    // Add the main content and instructions
    prompt += "CONTENT TO EXTRACT:\n";
    prompt += content;
    prompt += "\n\nTASK:";
    prompt += "\nExtract and structure the relevant data from the above content.";

    // Add general instructions if provided
    if (generalInstructions && generalInstructions.trim() !== '') {
      prompt += `\n\nADDITIONAL INSTRUCTIONS:\n${generalInstructions}`;
    }

    // Add format instructions
    prompt += "\n\nRESPONSE FORMAT:";
    prompt += "\nProvide the extracted data as a valid JSON object.";
    prompt += "\nEnsure the structure is consistent and logically organized.";
    prompt += "\nOnly include the final JSON result without any explanation or preamble.";

    return prompt;
  }

  /**
   * Build prompt for manual strategy
   */
  private buildManualPrompt(content: string, options: IAIExtractionOptions): string {
    // Create a base prompt with clearer instructions
    let prompt = "You are an expert data extraction assistant.\n\n";

    // Add reference context if available
    if (options.includeReferenceContext && options.referenceContent) {
      prompt += `\nREFERENCE CONTEXT (${options.referenceName || 'referenceContext'}):\n${options.referenceContent}\n\n`;
      console.log(`=== [buildManualPrompt] Adding reference context ===`);
      console.log(`Reference name: ${options.referenceName || 'referenceContext'}`);
      console.log(`Reference content: ${options.referenceContent}`);
    } else if (options.includeReferenceContext) {
      console.log(`=== [buildManualPrompt] Reference context enabled but content is empty ===`);
    }

    // Add the main content
    prompt += "CONTENT TO EXTRACT:\n";
    prompt += content;

    // Add general instructions if provided
    if (options.generalInstructions && options.generalInstructions.trim() !== '') {
      prompt += `\n\nGENERAL INSTRUCTIONS:\n${options.generalInstructions}`;
    }

    // Add field definitions with more prominence
    if (options.fields && options.fields.length > 0) {
      prompt += "\n\nFIELDS TO EXTRACT (Important - follow these instructions carefully):\n";
      options.fields.forEach((field, index) => {
        prompt += `\n${index + 1}. ${field.name} (${field.type})`;
        if (field.instructions && field.instructions.trim()) {
          prompt += `:\n   INSTRUCTIONS: ${field.instructions}\n`;

          // Note: The reference content is now included directly in the field instructions
          // by the enhanceFieldsWithRelativeSelectorContent function, so we don't need
          // special handling for URL fields anymore
        } else {
          prompt += '\n';
        }
      });
    }

    // Add emphasis on data types and formatting
    prompt += "\n\nDATA TYPE REQUIREMENTS:";
    prompt += "\n- Ensure you return proper data types (string, number, boolean, etc.) as specified for each field";
    prompt += "\n- For boolean fields, return actual boolean values (true/false), not strings";
    prompt += "\n- For empty fields, return empty strings \"\" or appropriate default values";

    // Add response format instructions
    prompt += "\n\nRESPONSE FORMAT:";
    prompt += "\n- Provide the extracted data as a valid JSON object using the field names specified above.";
    prompt += "\n- Only include the final JSON result without any explanation or preamble.";
    prompt += "\n- Ensure your response is properly formatted with the correct data types.";

    return prompt;
  }

  /**
   * Build prompt for a specific field in manual strategy
   */
  private buildFieldPrompt(content: string, field: IField): string {
    const { nodeName, nodeId, index } = this.context;

    // Log the field instructions for debugging
    this.logger.debug(
      formatOperationLog(
        "SmartExtraction",
        nodeName,
        nodeId,
        index,
        `Building prompt for field "${field.name}" with instructions: ${field.instructions?.substring(0, 100)}${field.instructions?.length > 100 ? '...' : ''}`
      )
    );

    // Check for reference content
    const hasReferenceContent = field.instructions &&
      field.instructions.includes('Use this as reference:');

    if (hasReferenceContent) {
      this.logger.info(
        formatOperationLog(
          "SmartExtraction",
          nodeName,
          nodeId,
          index,
          `Field "${field.name}" contains reference content in instructions`
        )
      );
    }

    // Build examples section if examples exist
    let examplesSection = '';

    if (field.examples && field.examples.length > 0) {
      examplesSection = 'EXAMPLES:\n';

      field.examples.forEach((example, index) => {
        examplesSection += `Input: "${example.input}"\n`;
        examplesSection += `Expected Output: ${example.output}\n\n`;
      });
    } else {
      examplesSection = `EXAMPLES:
- You may receive examples formatted like this below to help you understand the format expected, the transformation needed, or how to handle edge cases.
- If no example is provided, than do your best based on the other instructions above how to format the text, transform it, and handle edge cases.`;
    }

    // Determine format instructions based on field format
    let formatInstructions = '';

    switch (field.format) {
      case 'iso':
        formatInstructions = 'Format date values using ISO 8601 standard (YYYY-MM-DDTHH:mm:ss.sssZ)';
        break;
      case 'friendly':
        formatInstructions = 'Format values in a human-friendly way';
        break;
      case 'custom':
        formatInstructions = `Format using custom specification: ${field.formatString || ''}`;
        break;
      default:
        formatInstructions = 'Use default formatting appropriate for the data type';
    }

    const prompt = `
TASK: Convert the provided extracted data into properly structured JSON according to the specifications below.

INPUT DATA:
${content}

FIELD SPECIFICATION:
- Name: ${field.name}
- Type: ${field.type} (string, number, object, array, date, etc.)
- Description: ${field.instructions}
- Output Format: ${formatInstructions}

PROCESSING INSTRUCTIONS:
1. Carefully analyze the input data
2. Extract only the information relevant to the field specification
3. Clean up any unnecessary formatting, tags, or irrelevant content
4. Convert the data to the specified type
5. Apply any specified formatting requirements
6. Return ONLY valid JSON that matches the field specification

OUTPUT REQUIREMENTS:
- Return ONLY the transformed data value, not wrapped in any explanations or additional text
- Ensure the output is valid JSON that can be parsed directly
- Match the exact type specified (e.g., numbers should be numeric not strings)
- If data cannot be found or processed, return null or an appropriate empty structure ([] for arrays, {} for objects)

${examplesSection}
`;

    // Log the final prompt for debugging
    this.logger.debug(
      formatOperationLog(
        "SmartExtraction",
        nodeName,
        nodeId,
        index,
        `Generated prompt for field "${field.name}" (length: ${prompt.length} chars)`
      )
    );

    return prompt;
  }

  /**
   * Generate a JSON schema from data
   */
  private generateSchema(data: any): any {
    if (data === null || data === undefined) {
      return { type: 'null' };
    }

    // Debug the input data
    console.log('GENERATING SCHEMA FOR DATA:', JSON.stringify(data, null, 2));

    if (Array.isArray(data)) {
      let schema: any = { type: 'array' };

      if (data.length > 0) {
        // Create schema for items based on the first item
        schema.items = this.generateSchema(data[0]);
      }

      return schema;
    }

    if (typeof data === 'object') {
      // Get the field descriptions from the configuration if available
      const fieldDescriptions: Record<string, string> = {};
      if (this.options?.fields) {
        this.options.fields.forEach(field => {
          fieldDescriptions[field.name] = field.instructions || `Extract the ${field.name}`;
        });
      }

      const schema: any = {
        type: 'object',
        properties: {},
        required: []
      };

      for (const [key, value] of Object.entries(data)) {
        schema.properties[key] = this.generateSchema(value);

        // Include the description if available
        if (fieldDescriptions[key]) {
          schema.properties[key].description = fieldDescriptions[key];
        } else {
          // Add a default description if none was provided
          schema.properties[key].description = `The ${key} field`;
        }

        if (value !== null && value !== undefined) {
          schema.required.push(key);
        }
      }

      // Debug the generated object schema
      console.log('GENERATED OBJECT SCHEMA:', JSON.stringify(schema, null, 2));
      return schema;
    }

    // Handle primitive types with more detail
    const type = typeof data;
    const schema: any = { type };

    // Add format for specific types
    if (type === 'string' && this.looksLikeDate(data)) {
      schema.format = 'date-time';
    }

    // Include an example value
    schema.example = data;

    // Add a description for primitive types too
    schema.description = `A ${type} value`;

    // Debug the generated primitive schema
    console.log('GENERATED PRIMITIVE SCHEMA:', JSON.stringify(schema, null, 2));
    return schema;
  }

  /**
   * Check if a string looks like a date
   */
  private looksLikeDate(value: string): boolean {
    if (typeof value !== 'string') return false;

    // Check for ISO date format
    if (/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/.test(value)) return true;

    // Check for other common date formats
    if (/^\d{4}-\d{2}-\d{2}/.test(value)) return true;

    return false;
  }

  /**
   * Generate OpenAI function schema from field definitions
   */
  private generateOpenAISchema(fields: IField[]): any {
    // Log incoming field definitions with more detail
    this.logger.info(
      formatOperationLog(
        "SmartExtraction",
        this.context.nodeName,
        this.context.nodeId,
        this.context.index,
        `FIELDS RECEIVED BY generateOpenAISchema:`
      )
    );

    fields.forEach(field => {
      this.logger.info(
        formatOperationLog(
          "SmartExtraction",
          this.context.nodeName,
          this.context.nodeId,
          this.context.index,
          `Field: "${field.name}", Type: "${field.type}", Instructions: "${field.instructions?.substring(0, 100)}${field.instructions?.length > 100 ? '...' : ''}"`
        )
      );
    });

    // Create properties object for the schema
    const properties: Record<string, any> = {};
    const required: string[] = [];

    // Add each field to the properties
    fields.forEach(field => {
      // Determine JSON Schema type based on field type
      let schemaType = 'string';
      let schemaFormat = undefined;
      let additionalProps: Record<string, any> = {};

      switch (field.type.toLowerCase()) {
        case 'number':
        case 'integer':
          schemaType = field.type.toLowerCase();
          break;
        case 'boolean':
          schemaType = 'boolean';
          break;
        case 'date':
          schemaType = 'string';
          schemaFormat = 'date';
          break;
        case 'datetime':
          schemaType = 'string';
          schemaFormat = 'date-time';
          break;
        case 'array':
          schemaType = 'array';
          additionalProps.items = { type: 'string' };
          break;
        case 'object':
          schemaType = 'object';
          additionalProps.additionalProperties = true;
          break;
        default:
          schemaType = 'string';
      }

      // Create the property definition with description directly from instructions
      // Preserve the complete instructions including any reference content
      const property: Record<string, any> = {
        type: schemaType,
        description: field.instructions
      };

      // Add format if applicable
      if (schemaFormat) {
        property.format = schemaFormat;
      }

      // Add additional properties
      Object.assign(property, additionalProps);

      // Add to properties object
      properties[field.name] = property;

      // Add to required list (all fields are considered required unless explicitly marked optional)
      required.push(field.name);
    });

    // Create a function definition for OpenAI function calling
    const schema = {
      name: "extract_data",
      description: "Extract structured information from the provided text content according to the specified fields",
      parameters: {
        type: "object",
        properties: properties,
        required: required
      }
    };

    // Log the complete schema being sent to OpenAI
    this.logger.info(
      formatOperationLog(
        "SmartExtraction",
        this.context.nodeName,
        this.context.nodeId,
        this.context.index,
        `COMPLETE SCHEMA for OpenAI:\n${JSON.stringify(schema, null, 2)}`
      )
    );

    return schema;
  }

  /**
   * Process content using field-by-field extraction (manual strategy)
   */
  private async processFieldWithAI(
    threadId: string | null,
    content: string,
    field: IField
  ): Promise<{ success: boolean; data?: any; error?: string }> {
    const { nodeName, nodeId, index } = this.context;

    try {
      // Create a new thread if threadId is null or if we need a separate thread
      let actualThreadId: string;
      let createdNewThread = false;

      if (threadId === null) {
        const thread = await this.openai.beta.threads.create();
        actualThreadId = thread.id;
        createdNewThread = true;

        this.logger.debug(
          formatOperationLog(
            "SmartExtraction",
            nodeName,
            nodeId,
            index,
            `Created new thread for field "${field.name}": ${actualThreadId}`
          )
        );
      } else {
        actualThreadId = threadId;
      }

      // Build the field prompt
      const fieldPrompt = this.buildFieldPrompt(content, field);

      // Log the complete prompt being sent to the AI for debugging
      this.logger.info(
        formatOperationLog(
          "SmartExtraction",
          nodeName,
          nodeId,
          index,
          `FULL AI PROMPT for field "${field.name}":\n${'-'.repeat(80)}\n${fieldPrompt}\n${'-'.repeat(80)}`
        )
      );

      // Add a message to the thread with the content and instructions
      await this.openai.beta.threads.messages.create(actualThreadId, {
        role: "user",
        content: fieldPrompt,
      });

      // Run the assistant on the thread - select appropriate assistant based on field options
      const assistantId = field.useLogicAnalysis ? ASSISTANTS.logic : ASSISTANTS.manual;

      this.logger.debug(
        formatOperationLog(
          "SmartExtraction",
          nodeName,
          nodeId,
          index,
          `Using ${field.useLogicAnalysis ? 'LOGIC' : 'MANUAL'} assistant for field "${field.name}" (assistant ID: ${assistantId}${createdNewThread ? ', with new thread' : ', with shared thread'})`
        )
      );

      const run = await this.openai.beta.threads.runs.create(actualThreadId, {
        assistant_id: assistantId,
      });

      // Poll for completion
      return await this.pollRunCompletion(actualThreadId, run.id);
    } catch (error) {
      this.logger.error(
        formatOperationLog(
          "SmartExtraction",
          nodeName,
          nodeId,
          index,
          `Error processing field "${field.name}": ${(error as Error).message}`
        )
      );
      return {
        success: false,
        error: (error as Error).message,
      };
    }
  }
}
