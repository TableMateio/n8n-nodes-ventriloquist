import type { Logger as ILogger } from 'n8n-workflow';
import { formatOperationLog } from './resultUtils';
import { processFieldsWithReferenceContent } from './processOpenAISchema';

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
   * Process content using the manual strategy (fields defined by user)
   */
  private async processManualStrategy(
    content: string,
    options: IAIExtractionOptions
  ): Promise<IAIExtractionResult> {
    const { nodeName, nodeId, index } = this.context;

    // Debug: Entry and input
    console.log('=== [processManualStrategy] Entered function ===');
    console.log('Options:', JSON.stringify(options, null, 2));
    console.log('Fields:', JSON.stringify(options.fields, null, 2));
    console.log('Content:', typeof content === 'string' ? content.substring(0, 500) : '[non-string content]');

    try {
      this.logger.info(
        formatOperationLog(
          "SmartExtraction",
          nodeName,
          nodeId,
          index,
          "Using Manual strategy - Processing with user-defined fields"
        )
      );

      if (!options.fields || options.fields.length === 0) {
        throw new Error('Manual strategy requires at least one field definition');
      }

      // Process fields with reference content if provided
      if (options.includeReferenceContext && options.referenceContent) {
        // Transform IField array to ensure compatibility with IOpenAIField
        const fieldsForProcessing = options.fields.map(field => ({
          ...field,
          instructions: field.instructions || '',
        }));

        // Process the fields with reference content
        const processedFields = processFieldsWithReferenceContent(
          fieldsForProcessing,
          options.referenceContent,
          options.includeReferenceContext
        );

        // Copy enhanced instructions back to the original fields
        for (let i = 0; i < options.fields.length; i++) {
          if (i < processedFields.length) {
            options.fields[i].instructions = processedFields[i].instructions;
          }
        }
      }

      // Create a new thread (no tracking or management, just create a fresh one)
      const thread = await this.openai.beta.threads.create();

      // Add a message to the thread with the content and instructions
      const manualPrompt = this.buildManualPrompt(content, options);
      console.log('=== [processManualStrategy] Prompt sent to OpenAI ===');
      console.log(manualPrompt);
      await this.openai.beta.threads.messages.create(thread.id, {
        role: "user",
        content: manualPrompt,
      });

      // Generate schema for function calling with the processed fields
      if (!options.fields) {
        throw new Error('Field definitions required for manual strategy');
      }

      const functionDef = this.generateOpenAISchema(options.fields);

      // More detailed logging to see exactly what's being sent to OpenAI
      console.log('OPENAI FUNCTION SCHEMA - FULL DETAILS:');
      console.log('-------------------------------------');
      console.log(JSON.stringify(functionDef, null, 2));

      if (functionDef && functionDef.parameters && functionDef.parameters.properties) {
        console.log('FIELD DESCRIPTIONS IN SCHEMA:');
        Object.entries(functionDef.parameters.properties).forEach(([fieldName, fieldDef]: [string, any]) => {
          console.log(`${fieldName}: "${fieldDef.description}"`);
        });
      }

      // Log the function definition for debugging
      this.logger.debug(
        formatOperationLog(
          "SmartExtraction",
          nodeName,
          nodeId,
          index,
          `Function definition: ${JSON.stringify(functionDef, null, 2)}`
        )
      );

      // Run the assistant on the thread with the schema
      const run = await this.openai.beta.threads.runs.create(thread.id, {
        assistant_id: ASSISTANTS.manual,
        tools: [{
          type: "function",
          function: functionDef
        }]
      });

      // Poll for completion
      const result = await this.pollRunCompletion(thread.id, run.id);

      // Debug: Log the raw AI response
      console.log('=== [processManualStrategy] Raw AI response from pollRunCompletion ===');
      console.log(JSON.stringify(result, null, 2));

      // Process the response
      if (result.success && result.data) {
        const data = JSON.parse(result.data);

        // Debug: Log the parsed result
        console.log('=== [processManualStrategy] Parsed AI response ===');
        console.log(JSON.stringify(data, null, 2));

        // Log the parsed result for debugging
        this.logger.debug(
          formatOperationLog(
            "SmartExtraction",
            nodeName,
            nodeId,
            index,
            `Parsed result data: ${JSON.stringify(data, null, 2)}`
          )
        );

        // Generate schema if requested
        let outputSchema: any = null;
        if (options.includeSchema && options.fields) {
          // Make sure descriptions from fields are available
          this.options = options; // Set options to include field definitions

          // Generate the schema with field descriptions
          outputSchema = this.generateSchema(data);

          // Ensure all fields from the schema definition are properly described
          if (outputSchema && outputSchema.type === 'object' && outputSchema.properties) {
            options.fields.forEach(field => {
              if (outputSchema.properties[field.name]) {
                // Make sure every field has a description from the field definition
                outputSchema.properties[field.name].description = field.instructions || `Extract the ${field.name}`;
              }
            });
          }

          // Log the generated schema for debugging
          this.logger.debug(
            formatOperationLog(
              "SmartExtraction",
              nodeName,
              nodeId,
              index,
              `Generated schema: ${JSON.stringify(outputSchema, null, 2)}`
            )
          );
        }

        return {
          success: true,
          data,
          schema: outputSchema,
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
          `Manual strategy processing error: ${(error as Error).message}`
        )
      );
      // Debug: Log the error
      console.log('=== [processManualStrategy] Error ===');
      console.log((error as Error).message);
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

          // Check if this is a URL field and we have reference content
          const isUrlField = field.name.toLowerCase().includes('url') ||
                           field.name.toLowerCase().includes('link') ||
                           field.instructions.toLowerCase().includes('url') ||
                           field.instructions.toLowerCase().includes('link');

          if (isUrlField && options.includeReferenceContext && options.referenceContent) {
            console.log(`=== [buildManualPrompt] Field ${field.name} identified as URL field ===`);
            prompt += `   REFERENCE: Use this URL as reference: "${options.referenceContent}"\n`;
          }
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

    return `
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

      // Create the property definition with description directly at the field level
      const property: Record<string, any> = {
        type: schemaType,
        description: field.instructions || `Extract the ${field.name}`
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
}
