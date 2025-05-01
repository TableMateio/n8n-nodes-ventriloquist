import type { Logger as ILogger } from 'n8n-workflow';
import { formatOperationLog } from './resultUtils';
import { processFieldsWithReferenceContent } from './processOpenAISchema';
import { logWithDebug } from './loggingUtils';

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
  model?: string;
  aiModel?: string;
  extractionFormat?: string;
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
  private debugMode: boolean;

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
    this.debugMode = debugMode;

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
   * Process content with OpenAI based on the provided options
   * @param content Content to process
   * @param options AI extraction options
   * @returns Processed data
   */
  public async processContent(
    content: string,
    options: IAIExtractionOptions
  ): Promise<IAIExtractionResult> {
    // Save options for internal use
    this.options = options;

    // Log processing start
    this.logDebug(`Starting AI processing with debug mode ${this.debugMode ? 'enabled' : 'disabled'}`, 'info', 'processContent');

    // Validate required options
    if (!options.strategy) {
      const error = 'Missing required option: strategy';
      this.logDebug(error, 'error', 'processContent');
      return { success: false, error };
    }

    if (!options.model) {
      const error = 'Missing required option: model';
      this.logDebug(error, 'error', 'processContent');
      return { success: false, error };
    }

    // Reference to OpenAI assistants IDs - hardcoded for now, but will be configurable in the future
    this.logDebug(`IMPORTANT: Using OpenAI Assistants API with IDs: auto=${ASSISTANTS.auto}, manual=${ASSISTANTS.manual}`, 'info', 'processContent');

    // Process content using the appropriate strategy
    try {
      switch (options.strategy) {
        case 'auto':
          return await this.processAutoStrategy(content, options);
        case 'manual':
          return await this.processManualStrategy(content, options);
        case 'template':
          // Not implemented yet
          this.logDebug('Template strategy not implemented yet', 'warn', 'processContent');
          return { success: false, error: 'Template strategy not implemented yet' };
        default:
          this.logDebug(`Unknown strategy: ${options.strategy}`, 'error', 'processContent');
          return { success: false, error: `Unknown strategy: ${options.strategy}` };
      }
    } catch (error) {
      const errorMessage = `Error in AI processing: ${(error as Error).message}`;
      this.logDebug(errorMessage, 'error', 'processContent');
      return { success: false, error: errorMessage };
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

      // Explicitly set the strategy to 'auto' for generateSchema method
      if (this.options) {
        this.options.strategy = 'auto';
      }

      // Log that we're using Assistants API with the provided constants
      if (isDebugMode) {
        this.logger.error(
          formatOperationLog(
            "SmartExtraction",
            nodeName,
            nodeId,
            index,
            `Using OpenAI Assistants API with assistant ID: ${ASSISTANTS.auto} for automatic extraction`
          )
        );
        this.logDebug(
          `Auto strategy uses OpenAI Assistants API with ID: ${ASSISTANTS.auto}`,
          'info',
          'processAutoStrategy'
        );
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
        this.logDebug(
          `!!!! OPENAI ASSISTANT DEBUG - ${nodeName}/${nodeId} - Sending Assistant API request`,
          'info',
          'processAutoStrategy'
        );

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

      // Poll for completion
      const result = await this.pollRunCompletion(thread.id, run.id);

      // Process the response
      if (result.success && result.data) {
        const data = JSON.parse(result.data);

        // Create a simple schema for auto mode
        let schema = null;
        if (options.includeSchema) {
          // In auto mode, we create a simple marker schema instead of analyzing the data
          schema = {
            type: "auto",
            description: "Schema automatically determined by AI assistant",
            mode: "auto",
            assistantId: ASSISTANTS.auto
          };

          // Log schema in debug mode
          if (isDebugMode) {
            this.logger.info(
              formatOperationLog(
                "SmartExtraction",
                nodeName,
                nodeId,
                index,
                `Auto strategy schema: ${JSON.stringify(schema, null, 2)}`
              )
            );
          }
        }

        return {
          success: true,
          data,
          schema,
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
   * Process content using the manual strategy (fields defined in UI)
   */
  private async processManualStrategy(
    content: string,
    options: IAIExtractionOptions
  ): Promise<IAIExtractionResult> {
    const { nodeName, nodeId, index } = this.context;
    const isDebugMode = options.debugMode === true;

    try {
      const fields = options.fields || [];

      // Validate fields
      if (!fields.length) {
        const error = 'Manual strategy requires fields to be defined';
        this.logDebug(error, 'error', 'processManualStrategy');
        return { success: false, error };
      }

      // Log field definitions
      this.logger.info(
        formatOperationLog(
          "SmartExtraction",
          nodeName,
          nodeId,
          index,
          `Using Manual strategy with ${fields.length} defined fields: ${fields.map(f => f.name).join(', ')}`
        )
      );

      // Generate schema for OpenAI function calling
      // NOTE: We directly use generateOpenAISchema here which uses the UI-defined fields
      // and don't use the generateSchema method that builds a schema from data
      const functionSchema = this.generateOpenAISchema(fields);

      // Log that we're using Assistants API with field-by-field extraction
      if (isDebugMode) {
        this.logger.error(
          formatOperationLog(
            "SmartExtraction",
            nodeName,
            nodeId,
            index,
            `Using OpenAI Assistants API for field-by-field extraction with IDs: manual=${ASSISTANTS.manual}, logic=${ASSISTANTS.logic}`
          )
        );
        this.logDebug(
          `Manual strategy uses OpenAI Assistants API with IDs: manual=${ASSISTANTS.manual}, logic=${ASSISTANTS.logic}`,
          'info',
          'processManualStrategy'
        );
      }

      // Clone fields array to avoid modifying the original
      const fieldsToProcess = options.fields ? [...options.fields] : [];

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
      fieldsToProcess.forEach(field => {
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
        ? processFieldsWithReferenceContent(fieldsToProcess, options.referenceContent, true, this.logger, this.context)
        : fieldsToProcess;

      // Check for nested field structures - if this is needed for nested field extraction
      // Group fields by their prefix (e.g., "AI Test Link.Field1" and "AI Test Link.Field2" belong to "AI Test Link")
      const fieldGroups: Record<string, IField[]> = {};
      const topLevelFields: IField[] = [];

      // Separate fields into groups for nested processing if they contain dot notation
      for (const field of processedFields) {
        if (field.name.includes('.')) {
          const [parent, child] = field.name.split('.', 2);
          if (!fieldGroups[parent]) {
            fieldGroups[parent] = [];
          }
          // Create a new field with the child name but keep all other properties
          const childField = { ...field, name: child };
          fieldGroups[parent].push(childField);
        } else {
          topLevelFields.push(field);
        }
      }

      // Check if the content is an array of objects (table data)
      // If it is, we should process it differently to maintain the array structure
      let isTableContent = false;
      let tableContent: any[] = [];

      try {
        // First try to parse content as JSON
        let parsedContent;
        try {
          parsedContent = JSON.parse(content);
        } catch (e) {
          // If it fails, it's likely not JSON, so we'll use it as-is
          parsedContent = content;
        }

        // Check if the parsed content is an array of objects
        if (Array.isArray(parsedContent) && parsedContent.length > 0 && typeof parsedContent[0] === 'object') {
          isTableContent = true;
          tableContent = parsedContent;

          // Log we detected table content
          this.logger.info(
            formatOperationLog(
              "SmartExtraction",
              nodeName,
              nodeId,
              index,
              `Detected table content with ${tableContent.length} rows. Using schema-aware table processing.`
            )
          );
        }
      } catch (e) {
        // Not a JSON array, continue with normal processing
        isTableContent = false;
      }

      // If we have table content (array of objects), use our improved table processing method
      if (isTableContent && tableContent.length > 0) {
        this.logger.info(
          formatOperationLog(
            "SmartExtraction",
            nodeName,
            nodeId,
            index,
            `Using schema-based table extraction with ${processedFields.length} fields`
          )
        );

        return await this.processTableContent(tableContent, processedFields);
      }

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

      // Process top-level fields first
      for (const field of topLevelFields) {
        // Cast to extended field type to handle attribute properties
        const extendedField = field as IExtendedField;

        // If this field has direct attribute content, use it directly
        if (extendedField.returnDirectAttribute === true && extendedField.referenceContent) {
          this.logger.info(
            formatOperationLog(
              "SmartExtraction",
              nodeName,
              nodeId,
              index,
              `Using direct attribute value for field "${field.name}": ${extendedField.referenceContent}`
            )
          );
          result[field.name] = extendedField.referenceContent;
          continue; // Skip AI processing for this field
        }

        // Check if this field has nested fields to process
        if (fieldGroups[field.name]) {
          this.logger.info(
            formatOperationLog(
              "SmartExtraction",
              nodeName,
              nodeId,
              index,
              `Field "${field.name}" has ${fieldGroups[field.name].length} nested fields to process`
            )
          );

          // Skip standard processing - we'll handle nested fields separately
          continue;
        }

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

      // Now process any nested field groups
      for (const [parentName, childFields] of Object.entries(fieldGroups)) {
        if (childFields.length > 0) {
          this.logger.info(
            formatOperationLog(
              "SmartExtraction",
              nodeName,
              nodeId,
              index,
              `Processing nested field group "${parentName}" with ${childFields.length} child fields`
            )
          );

          // Create an object to store child field results
          const nestedResult: Record<string, any> = {};

          // Process each child field
          for (const childField of childFields) {
            const needsSeparateThread = childField.useLogicAnalysis === true || childField.useSeparateThread === true;
            const threadToUse = needsSeparateThread ? null : sharedThread.id;

            this.logger.debug(
              formatOperationLog(
                "SmartExtraction",
                nodeName,
                nodeId,
                index,
                `Processing nested field "${parentName}.${childField.name}" (type: ${childField.type})`
              )
            );

            const fieldResult = await this.processFieldWithAI(threadToUse, content, childField);

            if (fieldResult.success && fieldResult.data) {
              try {
                let parsedValue;
                try {
                  parsedValue = JSON.parse(fieldResult.data);
                } catch (parseError) {
                  parsedValue = fieldResult.data;
                }

                nestedResult[childField.name] = parsedValue;

                this.logger.debug(
                  formatOperationLog(
                    "SmartExtraction",
                    nodeName,
                    nodeId,
                    index,
                    `Successfully extracted nested field "${parentName}.${childField.name}": ${
                      typeof parsedValue === 'string' ? parsedValue : JSON.stringify(parsedValue)
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
                    `Error parsing result for nested field "${parentName}.${childField.name}": ${(error as Error).message}`
                  )
                );
                nestedResult[childField.name] = fieldResult.data;
              }
            } else {
              this.logger.warn(
                formatOperationLog(
                  "SmartExtraction",
                  nodeName,
                  nodeId,
                  index,
                  `Failed to extract nested field "${parentName}.${childField.name}": ${fieldResult.error || 'Unknown error'}`
                )
              );
              nestedResult[childField.name] = null;
            }
          }

          // Store the nested results in the parent field
          result[parentName] = nestedResult;

          this.logger.info(
            formatOperationLog(
              "SmartExtraction",
              nodeName,
              nodeId,
              index,
              `Completed nested field group "${parentName}" with result: ${JSON.stringify(nestedResult)}`
            )
          );
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
          `Manual strategy error: ${(error as Error).message}`
        )
      );
      return {
        success: false,
        error: `Manual strategy error: ${(error as Error).message}`,
      };
    }
  }

  /**
   * Process table content (array of objects) with proper array structure preservation
   */
  private async processTableContent(
    tableContent: any[],
    fields: IField[]
  ): Promise<IAIExtractionResult> {
    const { nodeName, nodeId, index } = this.context;
    const isDebugMode = this.options?.debugMode === true;

    this.logger.info(
      formatOperationLog(
        "SmartExtraction",
        nodeName,
        nodeId,
        index,
        `Processing table content with ${tableContent.length} rows using field-based extraction with ${fields.length} fields`
      )
    );

    try {
      // Create a shared thread for AI processing
      const sharedThread = await this.openai.beta.threads.create();

      // Generate the OpenAI schema from the fields for proper structured extraction
      const schema = this.generateOpenAISchema(fields);

      // Log the schema being used
      if (isDebugMode) {
        this.logger.error(
          formatOperationLog(
            "SmartExtraction",
            nodeName,
            nodeId,
            index,
            `[Schema for Table] Using schema:\n${JSON.stringify(schema, null, 2)}`
          )
        );
      }

      // Build a more detailed prompt that passes our schema
      const arrayPrompt = `
TASK: Extract specific fields from each row in the table according to the field specifications below.

INPUT DATA:
\`\`\`json
${JSON.stringify(tableContent, null, 2)}
\`\`\`

FIELD SPECIFICATIONS:
${fields.map((field, index) => {
  let formatInstructions = '';
  switch (field.format) {
    case 'iso': formatInstructions = 'Format date values using ISO 8601 standard (YYYY-MM-DDTHH:mm:ss.sssZ)'; break;
    case 'friendly': formatInstructions = 'Format values in a human-friendly way'; break;
    case 'custom': formatInstructions = `Format using custom specification: ${field.formatString || ''}`; break;
    default: formatInstructions = 'Use default formatting appropriate for the data type';
  }

  return `${index + 1}. Name: ${field.name}
   Type: ${field.type}
   Description: ${field.instructions}
   Output Format: ${formatInstructions}`;
}).join('\n\n')}

IMPORTANT GUIDELINES:
1. Return a properly formatted array of objects, with each object representing a row.
2. Preserve the original data structure for all values - if the input contains arrays, they must remain arrays in the output.
3. Maintain the exact data types of all values - strings, numbers, booleans, arrays, objects should all be preserved.
4. Do not flatten or convert arrays to strings in the output.
5. Ensure your response is proper JSON that can be directly parsed.
`;

      // Add this message to the thread
      await this.openai.beta.threads.messages.create(
        sharedThread.id,
        {
          role: "user",
          content: arrayPrompt,
        }
      );

      // Create a run with the manual assistant, including the schema for function calling
      const run = await this.openai.beta.threads.runs.create(
        sharedThread.id,
        {
          assistant_id: ASSISTANTS.manual,
          tools: [{
            type: "function",
            function: schema
          }]
        }
      );

      // Poll for completion - use longer timeouts for larger tables
      const customMaxAttempts = tableContent.length > 10 ? 90 : 60; // More rows = more time
      const customDelayMs = tableContent.length > 20 ? 3000 : 2000; // Even more rows = even more time

      this.logDebug(
        `Using custom timeout settings for table with ${tableContent.length} rows: maxAttempts=${customMaxAttempts}, delayMs=${customDelayMs}`,
        'info',
        'processTableContent'
      );

      const result = await this.pollRunCompletion(sharedThread.id, run.id, customMaxAttempts, customDelayMs);

      if (result.success && result.data) {
        try {
          // Try to parse the result as JSON
          let extractedData;
          try {
            // Parse the result from OpenAI as JSON
            extractedData = JSON.parse(result.data);

            // Log the extracted data structure for debugging
            this.logDebug(
              `Successfully parsed result as JSON. Structure: ${this.describeDataStructure(extractedData)}`,
              'info',
              'processTableContent'
            );

            // Make sure we have an array of objects for table data
            if (!Array.isArray(extractedData)) {
              this.logDebug(
                `Expected array but got ${typeof extractedData}. Converting to array.`,
                'warn',
                'processTableContent'
              );
              // If not an array, wrap it in an array
              extractedData = [extractedData];
            }
          } catch (e) {
            // Handle the case where OpenAI might return a string or non-JSON format
            this.logger.warn(
              formatOperationLog(
                "SmartExtraction",
                nodeName,
                nodeId,
                index,
                `Failed to parse table result as JSON: ${e}`
              )
            );
            extractedData = result.data;
          }

          // Generate schema if needed
          let schema = null;
          if (this.options?.includeSchema) {
            // Use the UI-defined field schema for tables as well, instead of generating from data
            schema = fields.length > 0 ? this.generateOpenAISchema(fields) : null;
          }

          return {
            success: true,
            data: extractedData,
            schema,
            rawData: this.options?.includeRawData ? JSON.stringify(tableContent) : undefined,
          };
        } catch (error) {
          throw new Error(`Error processing table result: ${(error as Error).message}`);
        }
      } else {
        throw new Error(`Failed to process table content: ${result.error || 'Unknown error'}`);
      }
    } catch (error) {
      this.logger.error(
        formatOperationLog(
          "SmartExtraction",
          nodeName,
          nodeId,
          index,
          `Table processing error: ${(error as Error).message}`
        )
      );
      return {
        success: false,
        error: `Table processing error: ${(error as Error).message}`,
      };
    }
  }

  /**
   * Poll for run completion
   */
  private async pollRunCompletion(
    threadId: string,
    runId: string,
    maxAttempts = 60,
    delayMs = 2000
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
        } else if (run.status === 'requires_action' && run.required_action?.type === 'submit_tool_outputs') {
          // Handle the requires_action status for function calling
          const toolCalls = run.required_action.submit_tool_outputs.tool_calls;

          this.logger.info(
            formatOperationLog(
              "SmartExtraction",
              nodeName,
              nodeId,
              index,
              `[OpenAI API] Run requires action - handling ${toolCalls.length} tool call(s)`
            )
          );

          // Create an array to store our tool outputs
          const toolOutputs = toolCalls.map((toolCall: any) => {
            try {
              // Extract the function arguments
              const args = JSON.parse(toolCall.function.arguments);

              // Log the function being called
              if (isDebugMode) {
                this.logger.info(
                  formatOperationLog(
                    "SmartExtraction",
                    nodeName,
                    nodeId,
                    index,
                    `[OpenAI API] Function called: ${toolCall.function.name} with arguments: ${JSON.stringify(args, null, 2).substring(0, 200)}...`
                  )
                );
              }

              // Return a simple success response - this allows the AI to continue processing
              return {
                tool_call_id: toolCall.id,
                output: JSON.stringify({ success: true, data: args })
              };
            } catch (error) {
              this.logger.error(
                formatOperationLog(
                  "SmartExtraction",
                  nodeName,
                  nodeId,
                  index,
                  `[OpenAI API] Error processing function call: ${(error as Error).message}`
                )
              );

              // Return an error response
              return {
                tool_call_id: toolCall.id,
                output: JSON.stringify({ success: false, error: (error as Error).message })
              };
            }
          });

          // Submit the tool outputs back to OpenAI
          await this.openai.beta.threads.runs.submitToolOutputs(
            threadId,
            runId,
            { tool_outputs: toolOutputs }
          );

          // Add logging to confirm submission
          this.logger.info(
            formatOperationLog(
              "SmartExtraction",
              nodeName,
              nodeId,
              index,
              `[OpenAI API] Submitted ${toolOutputs.length} tool outputs for run ${runId}`
            )
          );

          // Wait before checking again
          await new Promise(resolve => setTimeout(resolve, delayMs));
          continue; // Skip to the next iteration
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
    // Create a structured prompt
    let prompt = "TASK: Extract and structure relevant information from the provided content.\n\n";

    // Add reference context if available
    if (this.options?.includeReferenceContext && this.options?.referenceContent) {
      prompt += `REFERENCE CONTEXT (${this.options.referenceName || 'referenceContext'}):\n${this.options.referenceContent}\n\n`;
    }

    // Add the main content
    prompt += "INPUT DATA:\n";
    prompt += content;

    // Add general instructions if provided
    if (generalInstructions && generalInstructions.trim() !== '') {
      prompt += `\n\nADDITIONAL INSTRUCTIONS:\n${generalInstructions}`;
    }

    // Add processing instructions
    prompt += "\n\nPROCESSING INSTRUCTIONS:";
    prompt += "\n1. Analyze the input data and identify the key information";
    prompt += "\n2. Determine a logical structure for organizing this information";
    prompt += "\n3. Extract and clean up the relevant content";
    prompt += "\n4. Structure the data in a meaningful and organized way";
    prompt += "\n5. Infer appropriate data types for each field";
    prompt += "\n6. Return a JSON object with the structured data";

    // Add output requirements
    prompt += "\n\nOUTPUT REQUIREMENTS:";
    prompt += "\n- Return ONLY a valid JSON object with no explanatory text";
    prompt += "\n- Ensure the JSON structure is logical and well-organized";
    prompt += "\n- Use appropriate data types (string, number, boolean, arrays, objects)";
    prompt += "\n- Use descriptive field names that reflect the content";
    prompt += "\n- Omit any fields that don't contain useful information";
    prompt += "\n- For empty or missing data, use null or appropriate empty structures";

    // Log the generated prompt for debugging
    this.logDebug(
      `Generated auto strategy prompt (${prompt.length} chars)`,
      'debug',
      'buildAutoPrompt'
    );

    return prompt;
  }

  /**
   * Build prompt for manual strategy
   */
  private buildManualPrompt(content: string, options: IAIExtractionOptions): string {
    // Create a base prompt with detailed instructions
    let prompt = "TASK: Extract structured information from the provided content according to the field specifications below.\n\n";

    // Add reference context if available
    if (options.includeReferenceContext && options.referenceContent) {
      prompt += `REFERENCE CONTEXT (${options.referenceName || 'referenceContext'}):\n${options.referenceContent}\n\n`;

      this.logDebug(
        `Added reference context to prompt (${options.referenceContent.length} chars)`,
        'debug',
        'buildManualPrompt'
      );
    }

    // Add the main content
    prompt += "INPUT DATA:\n";
    prompt += content;

    // Add field specifications in a more structured format
    if (options.fields && options.fields.length > 0) {
      prompt += "\n\nFIELD SPECIFICATIONS:";
      options.fields.forEach((field, index) => {
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

        prompt += `\n\n${index + 1}. Name: ${field.name}`;
        prompt += `\n   Type: ${field.type}`;
        prompt += `\n   Description: ${field.instructions || `Extract the ${field.name}`}`;
        prompt += `\n   Output Format: ${formatInstructions}`;
      });
    }

    // Add general instructions if provided
    if (options.generalInstructions && options.generalInstructions.trim() !== '') {
      prompt += `\n\nADDITIONAL INSTRUCTIONS:\n${options.generalInstructions}`;
    }

    // Log the generated prompt for debugging
    this.logDebug(
      `Generated manual strategy prompt (${prompt.length} chars)`,
      'debug',
      'buildManualPrompt'
    );

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
   * NOTE: This method is only used for auto mode, not for manual field-by-field extraction
   */
  private generateSchema(data: any): any {
    // Only process if we're in auto mode or if data needs to be analyzed
    // Skip schema generation entirely for manual mode
    if (this.options?.strategy === 'manual') {
      this.logDebug(
        'Skipping automatic schema generation for manual strategy - using UI-defined schema instead',
        'info',
        'generateSchema'
      );
      return null;
    }

    if (data === null || data === undefined) {
      return { type: 'null' };
    }

    // Debug the input data
    this.logDebug(
      'GENERATING SCHEMA FOR DATA:',
      'debug',
      'generateSchema'
    );
    this.logDebug(
      JSON.stringify(data, null, 2),
      'debug',
      'generateSchema'
    );

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
      this.logDebug(
        'GENERATED OBJECT SCHEMA:',
        'debug',
        'generateSchema'
      );
      this.logDebug(
        JSON.stringify(schema, null, 2),
        'debug',
        'generateSchema'
      );
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
    this.logDebug(
      'GENERATED PRIMITIVE SCHEMA:',
      'debug',
      'generateSchema'
    );
    this.logDebug(
      JSON.stringify(schema, null, 2),
      'debug',
      'generateSchema'
    );
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
   * Generate schema for OpenAI function calling based on field definitions from UI
   */
  private generateOpenAISchema(fields: IField[]): any {
    // Log incoming field definitions with more detail
    this.logDebug(
      `Generating OpenAI schema from ${fields.length} UI-defined fields`,
      'info',
      'generateOpenAISchema'
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

      // TEMPORARY DEBUG: Log more detailed field info
      this.logDebug(
        `SCHEMA GENERATION - Field: "${field.name}"`,
        'debug',
        'generateOpenAISchema'
      );
      this.logDebug(
        `Field type: ${field.type}`,
        'debug',
        'generateOpenAISchema'
      );
      this.logDebug(
        `Instructions length: ${field.instructions?.length || 0}`,
        'debug',
        'generateOpenAISchema'
      );
      this.logDebug(
        `Instructions preview: "${field.instructions?.substring(0, 150)}${field.instructions?.length > 150 ? '...' : ''}"`,
        'debug',
        'generateOpenAISchema'
      );
      this.logDebug(
        `Field properties: ${Object.keys(field).join(', ')}`,
        'debug',
        'generateOpenAISchema'
      );

      // Check for reference content (from IExtendedField)
      const extendedField = field as IExtendedField;
      if (extendedField.referenceContent) {
        this.logDebug(
          `Has reference content: YES, length=${extendedField.referenceContent.length}`,
          'debug',
          'generateOpenAISchema'
        );
        this.logDebug(
          `Is direct attribute: ${extendedField.returnDirectAttribute === true ? 'YES' : 'NO'}`,
          'debug',
          'generateOpenAISchema'
        );
      } else {
        this.logDebug(
          `Has reference content: NO`,
          'debug',
          'generateOpenAISchema'
        );
      }
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

      // Create a function schema specifically for this field
      const fieldSchema = {
        name: `extract_${field.name.replace(/[^a-zA-Z0-9_]/g, '_')}`,
        description: `Extract the ${field.name} data based on the provided instructions`,
        parameters: {
          type: "object",
          properties: {
            [field.name]: {
              type: this.mapFieldTypeToSchemaType(field.type),
              description: field.instructions || `The ${field.name} value`
            }
          },
          required: [field.name]
        }
      };

      // Log the schema that will be used
      this.logger.info(
        formatOperationLog(
          "SmartExtraction",
          nodeName,
          nodeId,
          index,
          `Using schema for field "${field.name}":\n${JSON.stringify(fieldSchema, null, 2)}`
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

      // Create a run with the function schema defined
      const run = await this.openai.beta.threads.runs.create(actualThreadId, {
        assistant_id: assistantId,
        tools: [{
          type: "function",
          function: fieldSchema
        }]
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

  /**
   * Map field types to JSON Schema types
   */
  private mapFieldTypeToSchemaType(fieldType: string): string {
    switch (fieldType.toLowerCase()) {
      case 'number':
      case 'integer':
        return fieldType.toLowerCase();
      case 'boolean':
        return 'boolean';
      case 'object':
        return 'object';
      case 'array':
        return 'array';
      default:
        return 'string';
    }
  }

  /**
   * Debug log utility function for AIService
   * @param message Message to log
   * @param level Log level (info, debug, warn, error)
   * @param functionName Optional function name
   */
  private logDebug(
    message: string,
    level: 'info' | 'debug' | 'warn' | 'error' = 'debug',
    functionName?: string
  ) {
    const { nodeName, nodeId, index } = this.context;
    const component = "aiService";
    const fn = functionName || "unknown";

    // Use our standardized logging helper
    logWithDebug(
      this.logger,
      this.debugMode,
      nodeName,
      'AIService',
      component,
      fn,
      message,
      level
    );
  }

  /**
   * Helper to describe data structure for debugging
   */
  private describeDataStructure(data: any): string {
    if (data === null) return 'null';
    if (data === undefined) return 'undefined';

    if (Array.isArray(data)) {
      const itemTypes = data.length > 0
        ? data.slice(0, 3).map(item => this.describeDataStructure(item)).join(', ')
        : 'empty';
      return `Array with ${data.length} items${data.length > 0 ? ' of types: [' + itemTypes + (data.length > 3 ? ', ...' : '') + ']' : ''}`;
    }

    if (typeof data === 'object') {
      const keys = Object.keys(data);
      return `Object with ${keys.length} keys${keys.length > 0 ? ': ' + keys.slice(0, 3).join(', ') + (keys.length > 3 ? ', ...' : '') : ''}`;
    }

    return typeof data;
  }
}
