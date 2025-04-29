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
    }
  ) {
    if (!OpenAI) {
      throw new Error('OpenAI package not found. Please install it with: npm install openai');
    }

    this.openai = new OpenAI({
      apiKey: apiKey,
    });
    this.logger = logger;
    this.context = context;
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

    try {
      this.logger.info(
        formatOperationLog(
          "SmartExtraction",
          nodeName,
          nodeId,
          index,
          `Processing content with AI (strategy: ${options.strategy}, model: ${options.model})`
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

      // Create a new thread (no tracking or management, just create a fresh one)
      const thread = await this.openai.beta.threads.create();

      // Add a message to the thread with the content and instructions
      await this.openai.beta.threads.messages.create(thread.id, {
        role: "user",
        content: this.buildAutoPrompt(content, options.generalInstructions),
      });

      // Run the assistant on the thread
      const run = await this.openai.beta.threads.runs.create(thread.id, {
        assistant_id: ASSISTANTS.auto,
      });

      // Poll for completion
      const result = await this.pollRunCompletion(thread.id, run.id);

      // Process the response
      if (result.success && result.data) {
        const data = JSON.parse(result.data);

        // Generate schema if requested
        let schema = null;
        if (options.includeSchema) {
          schema = this.generateSchema(data);
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

    try {
      this.logger.info(
        formatOperationLog(
          "SmartExtraction",
          nodeName,
          nodeId,
          index,
          `Using Manual strategy with ${options.fields?.length || 0} fields`
        )
      );

      // Clone fields array to avoid modifying the original
      const fields = options.fields ? [...options.fields] : [];

      // Process fields with reference content if provided
      // This adds the reference content to the instructions for URL-related fields
      const processedFields = options.includeReferenceContext && options.referenceContent
        ? processFieldsWithReferenceContent(fields, options.referenceContent, true)
        : fields;

      // Log the field instructions after processing to verify reference content is included
      this.logger.debug(
        formatOperationLog(
          "SmartExtraction",
          nodeName,
          nodeId,
          index,
          `Field instructions after processing with reference content:`
        )
      );
      processedFields.forEach(field => {
        this.logger.debug(
          formatOperationLog(
            "SmartExtraction",
            nodeName,
            nodeId,
            index,
            `Field "${field.name}" instructions: ${field.instructions?.substring(0, 50)}${field.instructions?.length > 50 ? '...' : ''}`
          )
        );
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

        // Check if this field has a direct attribute value to return (from enhanceFieldsWithRelativeSelectorContent)
        if (extendedField.returnDirectAttribute === true && extendedField.referenceContent) {
          const directValue = extendedField.referenceContent;
          this.logger.info(
            formatOperationLog(
              "SmartExtraction",
              nodeName,
              nodeId,
              index,
              `Using direct attribute value for field "${field.name}": ${directValue}`
            )
          );

          // Store the direct value without processing through AI
          result[field.name] = directValue;
          continue; // Skip AI processing for this field
        }

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

    for (let attempt = 0; attempt < maxAttempts; attempt++) {
      try {
        // Get run status
      const run = await this.openai.beta.threads.runs.retrieve(threadId, runId);

        // Check if completed
      if (run.status === 'completed') {
          // Get messages from the thread (newest first)
          const messages = await this.openai.beta.threads.messages.list(threadId, {
            order: 'desc',
            limit: 5,
          });

          // Check for function call results
          const lastMessage = messages.data[0];
          if (lastMessage && lastMessage.role === 'assistant') {
            // Check for function calls
            if (lastMessage.content && lastMessage.content.length > 0) {
              for (const content of lastMessage.content) {
                // Handle function call responses
                if (content.type === 'function_call' && content.function_call) {
                  this.logger.debug(
                    formatOperationLog(
                      "SmartExtraction",
                      nodeName,
                      nodeId,
                      index,
                      `Received function call response: ${content.function_call.name}`
                    )
                  );

                  // Log the arguments for debugging
                  this.logger.debug(
                    formatOperationLog(
                      "SmartExtraction",
                      nodeName,
                      nodeId,
                      index,
                      `Function arguments: ${content.function_call.arguments}`
                    )
                  );

                  return {
                    success: true,
                    data: content.function_call.arguments
                  };
                }

                // Handle text responses
                if (content.type === 'text') {
              return {
                success: true,
                    data: content.text.value,
              };
            }
          }
        }

            // No usable content found
            return {
              success: false,
              error: 'No usable content in assistant response',
            };
          }

          return {
            success: false,
            error: 'No response from assistant',
          };
        }

        // Check for failures
        if (['failed', 'cancelled', 'expired'].includes(run.status)) {
        return {
          success: false,
            error: `Run ${run.status}: ${run.last_error?.message || 'Unknown error'}`,
          };
        }

        // Check for tool calls that need responses
        if (run.status === 'requires_action' && run.required_action?.type === 'submit_tool_outputs') {
          // Get the tool calls
          const toolCalls = run.required_action.submit_tool_outputs.tool_calls;

          // This shouldn't happen in our case since we don't have interactive tools,
          // but we'll handle it gracefully anyway
          this.logger.warn(
            formatOperationLog(
              "SmartExtraction",
              nodeName,
              nodeId,
              index,
              `Run requires tool outputs, but this isn't currently supported`
            )
          );

          // Submit empty tool outputs to allow the run to continue
          await this.openai.beta.threads.runs.submitToolOutputs(threadId, runId, {
            tool_outputs: toolCalls.map((tc: any) => ({
              tool_call_id: tc.id,
              output: "{}",
            })),
          });
        }

        // Wait before next attempt
        await new Promise(resolve => setTimeout(resolve, delayMs));
      } catch (error) {
        this.logger.error(
          formatOperationLog(
            "SmartExtraction",
            nodeName,
            nodeId,
            index,
            `Error polling run: ${(error as Error).message}`
          )
        );

        // Wait before retry
      await new Promise(resolve => setTimeout(resolve, delayMs));
      }
    }

    return {
      success: false,
      error: `Timed out after ${maxAttempts} attempts`,
    };
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
    // Log incoming field definitions
    console.log('FIELDS RECEIVED BY generateOpenAISchema:');
    fields.forEach(field => {
      console.log(`Field: ${field.name}, Type: ${field.type}, Instructions: "${field.instructions || 'none'}"`);
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
    return {
      name: "extract_data",
      description: "Extract structured information from the provided text content according to the specified fields",
      parameters: {
        type: "object",
        properties: properties,
        required: required
      }
    };
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

      // Add a message to the thread with the content and instructions
      await this.openai.beta.threads.messages.create(actualThreadId, {
        role: "user",
        content: this.buildFieldPrompt(content, field),
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
