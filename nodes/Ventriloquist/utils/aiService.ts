import type { Logger as ILogger } from 'n8n-workflow';
import { formatOperationLog } from './resultUtils';

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
  instructions: string;
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
    const logPrefix = `[AIExtraction][${nodeName}]`;

    // Store options for use in other methods
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

      // Create a new thread
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
   * Process content using the manual strategy (user-defined fields)
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
          "Using Manual strategy - Processing with user-defined fields"
        )
      );

      // Check if fields are provided
      if (!options.fields || options.fields.length === 0) {
        throw new Error('No fields defined for manual strategy');
      }

      // Create a new thread
      const thread = await this.openai.beta.threads.create();

      // Add a message to the thread with the content and instructions
      await this.openai.beta.threads.messages.create(thread.id, {
        role: "user",
        content: this.buildManualPrompt(content, options),
      });

      // Run the assistant on the thread
      const run = await this.openai.beta.threads.runs.create(thread.id, {
        assistant_id: ASSISTANTS.manual,
      });

      // Poll for completion
      const result = await this.pollRunCompletion(thread.id, run.id);

      // Process the response
      if (result.success && result.data) {
        try {
          const data = JSON.parse(result.data);

          // Generate schema if requested
          let schema = null;
          if (options.includeSchema) {
            schema = this.generateSchema(data);
          }

          return {
            success: true,
            data,
            schema,
            rawData: options.includeRawData ? content : undefined,
          };
        } catch (error) {
          throw new Error(`Failed to parse AI response: ${error}`);
        }
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
      return {
        success: false,
        error: (error as Error).message,
      };
    }
  }

  /**
   * Poll for the completion of an OpenAI run
   */
  private async pollRunCompletion(
    threadId: string,
    runId: string,
    maxAttempts = 30,
    delayMs = 1000
  ): Promise<{ success: boolean; data?: string; error?: string }> {
    const { nodeName, nodeId, index } = this.context;

    let attempts = 0;

    while (attempts < maxAttempts) {
      attempts++;

      const run = await this.openai.beta.threads.runs.retrieve(threadId, runId);

      if (run.status === 'completed') {
        // Get the assistant's response
        const messages = await this.openai.beta.threads.messages.list(threadId);
        const assistantMessages = messages.data.filter((msg: any) => msg.role === 'assistant');

        if (assistantMessages.length > 0) {
          const latestMessage = assistantMessages[0];

          if (latestMessage.content && latestMessage.content.length > 0) {
            const textContent = latestMessage.content[0];

            if (textContent.type === 'text') {
              return {
                success: true,
                data: textContent.text.value,
              };
            }
          }
        }

        return {
          success: false,
          error: "No response content found in assistant message",
        };
      } else if (run.status === 'failed') {
        this.logger.error(
          formatOperationLog(
            "SmartExtraction",
            nodeName,
            nodeId,
            index,
            `Run failed: ${run.last_error?.message || 'Unknown error'}`
          )
        );

        return {
          success: false,
          error: run.last_error?.message || "Assistant run failed",
        };
      } else if (['cancelled', 'expired'].includes(run.status)) {
        return {
          success: false,
          error: `Run ${run.status}`,
        };
      }

      // Wait before polling again
      await new Promise(resolve => setTimeout(resolve, delayMs));
    }

    return {
      success: false,
      error: "Timeout waiting for assistant response",
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
    // Create a base prompt
    let prompt = "You are an expert data extraction assistant.\n\n";

    // Add reference context if available
    if (options.includeReferenceContext && options.referenceContent) {
      prompt += `\nREFERENCE CONTEXT (${options.referenceName || 'referenceContext'}):\n${options.referenceContent}\n\n`;
    }

    // Add the main content
    prompt += "CONTENT TO EXTRACT:\n";
    prompt += content;

    // Add general instructions if provided
    if (options.generalInstructions && options.generalInstructions.trim() !== '') {
      prompt += `\n\nGENERAL INSTRUCTIONS:\n${options.generalInstructions}`;
    }

    // Add field definitions
    if (options.fields && options.fields.length > 0) {
      prompt += "\n\nFIELDS TO EXTRACT:";
      options.fields.forEach((field, index) => {
        prompt += `\n${index + 1}. ${field.name} (${field.type})`;
        if (field.instructions) {
          prompt += `: ${field.instructions}`;
        }
      });
    }

    // Add response format instructions
    prompt += "\n\nRESPONSE FORMAT:";
    prompt += "\nProvide the extracted data as a valid JSON object using the field names specified above.";
    prompt += "\nOnly include the final JSON result without any explanation or preamble.";

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

    if (Array.isArray(data)) {
      let schema: any = { type: 'array' };

      if (data.length > 0) {
        // Create schema for items based on the first item
        schema.items = this.generateSchema(data[0]);
      }

      return schema;
    }

    if (typeof data === 'object') {
      const schema: any = {
        type: 'object',
        properties: {},
        required: []
      };

      for (const [key, value] of Object.entries(data)) {
        schema.properties[key] = this.generateSchema(value);
        if (value !== null && value !== undefined) {
          schema.required.push(key);
        }
      }

      return schema;
    }

    // Handle primitive types
    return { type: typeof data };
  }
}
