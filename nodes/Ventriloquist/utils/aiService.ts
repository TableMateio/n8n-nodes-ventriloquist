import type { Logger as ILogger } from 'n8n-workflow';
import type { IDataObject } from 'n8n-workflow';
import { formatOperationLog } from './resultUtils';
import { logWithDebug } from './loggingUtils';
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
 * Interface for OpenAI field definition
 */
export interface IOpenAIField {
  name: string;
  instructions: string;
  type: string;
  required?: boolean;
  format?: string; // 'required' or 'optional'
}

/**
 * Interface for AI field definition
 */
export interface IField {
  name: string;
  instructions?: string;
  type?: string;
  required?: boolean;
  format?: string; // 'required' or 'optional'
  formatString?: string;
  examples?: Array<{
    input: string;
    output: string;
  }>;
  useLogicAnalysis?: boolean;  // Flag to use the logic assistant for this field
  useSeparateThread?: boolean; // Flag to use a separate thread for this field
  arrayItemType?: string;
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
  fieldProcessingMode?: 'batch' | 'individual';
  outputStructure?: 'object' | 'array';
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

    // Log the output structure immediately when options are processed
    const { nodeName, nodeId, index } = this.context;
    const isDebugMode = options.debugMode === true || this.debugMode;

    if (isDebugMode) {
      this.logger.error(
        formatOperationLog(
          "SmartExtraction",
          nodeName,
          nodeId,
          index,
          `CRITICAL: Initial options.outputStructure=${options.outputStructure}, this.options.outputStructure=${this.options.outputStructure}`
        )
      );
    }

    // Log processing start
    this.logDebug(`Starting AI processing with debug mode ${this.debugMode ? 'enabled' : 'disabled'}`, 'info', 'processContent');

    // Make sure output structure is set properly
    const outputStructure = options.outputStructure || 'object';

    // Ensure outputStructure is properly set in our stored options
    if (this.options) {
      this.options.outputStructure = outputStructure;
    }

    // Log the output structure being used
    if (isDebugMode) {
      this.logger.error(
        formatOperationLog(
          "SmartExtraction",
          nodeName,
          nodeId,
          index,
          `Using output structure: ${outputStructure}`
        )
      );
      this.logDebug(`OUTPUT STRUCTURE TRACKING: options.outputStructure=${options.outputStructure}, using ${outputStructure} for schema generation`, 'error', 'processContent');
    }

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
   * Process content using the manual strategy (field-by-field)
   */
  private async processManualStrategy(
    content: string,
    options: IAIExtractionOptions
  ): Promise<IAIExtractionResult> {
    const { nodeName, nodeId, index } = this.context;
    const isDebugMode = options.debugMode === true;

    // ==== NEW LOGGING START ====
    this.logDebug(
      `PROCESSMANUALSTRATEGY_DEBUG: Entered. options.referenceContent='${options.referenceContent}'. Checking initial options.fields...`,
      'error', // High visibility
      'processManualStrategy'
    );
    if (options.fields && options.fields.length > 0) {
      options.fields.forEach(field => {
        this.logDebug(
          `PROCESSMANUALSTRATEGY_DEBUG: Initial option field: "${field.name}", type: '${field.type}', arrayItemType: '${field.arrayItemType}'`,
          'error',
          'processManualStrategy'
        );
      });
    } else {
      this.logDebug(
        `PROCESSMANUALSTRATEGY_DEBUG: Initial options.fields is undefined or empty.`,
        'error',
        'processManualStrategy'
      );
    }
    // ==== NEW LOGGING END ====

    try {
      // Save options for the class and ensure outputStructure is properly preserved
      if (options) {
        // Log the original outputStructure directly from incoming options
        if (isDebugMode) {
          this.logger.error(
            formatOperationLog(
              "SmartExtraction",
              nodeName,
              nodeId,
              index,
              `CRITICAL: Starting processManualStrategy with incoming options.outputStructure=${options.outputStructure}`
            )
          );
        }

        // Store the options
        this.options = options;
      }

      // If output structure mode is not explicitly set, default to 'object'
      const outputStructure = options.outputStructure || 'object';

      // Add critical debug logging for output structure
      if (isDebugMode) {
        this.logger.error(
          formatOperationLog(
            "SmartExtraction",
            nodeName,
            nodeId,
            index,
            `OUTPUT STRUCTURE TRACKING: options.outputStructure=${options.outputStructure}, using ${outputStructure} for schema generation`
          )
        );
      }

      // Validate required fields
      if (!options.fields || options.fields.length === 0) {
        this.logger.error(
          formatOperationLog(
            "SmartExtraction",
            nodeName,
            nodeId,
            index,
            "No fields provided for manual strategy"
          )
        );
        return { success: false, error: "No fields provided for manual strategy" };
      }

      this.logger.info(
        formatOperationLog(
          "SmartExtraction",
          nodeName,
          nodeId,
          index,
          `Using Manual strategy with ${options.fields.length} fields and output structure: ${outputStructure}`
        )
      );

      // Get fields from options or create default
      let fieldsToProcess: IField[] = options.fields || [];

      // Validate fields
      if (!fieldsToProcess.length) {
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
          `Using Manual strategy with ${fieldsToProcess.length} defined fields: ${fieldsToProcess.map(f => f.name).join(', ')}`
        )
      );

      // Log the processing mode
      this.logger.info(
        formatOperationLog(
          "SmartExtraction",
          nodeName,
          nodeId,
          index,
          `Using ${options.fieldProcessingMode || 'batch'} processing mode`
        )
      );

      // Log that we're using Assistants API with field-by-field extraction
      if (isDebugMode) {
        this.logger.error(
          formatOperationLog(
            "SmartExtraction",
            nodeName,
            nodeId,
            index,
            `Using OpenAI Assistants API for ${options.fieldProcessingMode || 'batch'} extraction with IDs: manual=${ASSISTANTS.manual}, logic=${ASSISTANTS.logic}`
          )
        );
        this.logDebug(
          `Manual strategy uses OpenAI Assistants API with IDs: manual=${ASSISTANTS.manual}, logic=${ASSISTANTS.logic}`,
          'info',
          'processManualStrategy'
        );
      }

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
            `ORIGINAL Field "${field.name}" instructions (${field.instructions ? field.instructions.length : 0} chars): ${field.instructions ? field.instructions.substring(0, 100) + (field.instructions.length > 100 ? '...' : '') : 'No instructions'}`
          )
        );
      });

      // Process fields with reference content if available
      // However, for batch mode, we want to handle global reference at the top level
      // so we skip adding reference content to individual fields in that case
      const shouldAddReferenceToFields = options.referenceContent &&
        !(options.fieldProcessingMode === 'batch' && options.includeReferenceContext);

      fieldsToProcess = shouldAddReferenceToFields
        ? processFieldsWithReferenceContent(
            fieldsToProcess.map(field => ({
              name: field.name,
              instructions: field.instructions || `Extract the ${field.name}`,
              type: field.type || 'string',
              required: field.required,
              format: field.format,
              arrayItemType: field.arrayItemType, // Added this line
            })),
            options.referenceContent,
            true,
            this.logger,
            this.context
          )
        : fieldsToProcess.map(field => ({
            name: field.name,
            instructions: field.instructions || `Extract the ${field.name}`,
            type: field.type || 'string',
            required: field.required,
            format: field.format,
            arrayItemType: field.arrayItemType,
          }));

      // Check for nested field structures - if this is needed for nested field extraction
      // Group fields by their prefix (e.g., "AI Test Link.Field1" and "AI Test Link.Field2" belong to "AI Test Link")
      const fieldGroups: Record<string, IField[]> = {};
      const topLevelFields: IField[] = [];

      // Separate fields into groups for nested processing if they contain dot notation
      for (const field of fieldsToProcess) {
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
            `Using schema-based table extraction with ${fieldsToProcess.length} fields`
          )
        );

        // ==== NEW LOGGING START ====
        this.logDebug(
          `PROCESSMANUALSTRATEGY_DEBUG: About to call processTableContent. Checking fieldsToProcess...`,
          'error', // High visibility
          'processManualStrategy'
        );
        if (fieldsToProcess && fieldsToProcess.length > 0) {
          fieldsToProcess.forEach(field => {
            this.logDebug(
              `PROCESSMANUALSTRATEGY_DEBUG: Field for processTableContent: "${field.name}", type: '${field.type}', arrayItemType: '${field.arrayItemType}'`,
              'error',
              'processManualStrategy'
            );
          });
        } else {
          this.logDebug(
            `PROCESSMANUALSTRATEGY_DEBUG: fieldsToProcess for processTableContent is undefined or empty.`,
            'error',
            'processManualStrategy'
          );
        }
        // ==== NEW LOGGING END ====

        return await this.processTableContent(tableContent, fieldsToProcess);
      }

      // Create a result object to store field-by-field responses
      let result: Record<string, any> = {};

      // First, let's identify fields that need special processing (separate threads or logic assistant)
      const standardFields: IField[] = [];
      const specialFields: IField[] = [];

      topLevelFields.forEach(field => {
        const extendedField = field as IExtendedField;

        // Skip fields with direct attribute content
        if (extendedField.returnDirectAttribute === true && extendedField.referenceContent) {
          // Ensure result is an object before assigning properties
          if (Array.isArray(result)) {
            result = {};
          }
          result[field.name] = extendedField.referenceContent;
          return; // Skip AI processing for this field
        }

        // Skip fields with nested fields
        if (fieldGroups[field.name]) {
          return; // Skip processing - we'll handle nested fields separately
        }

        // Check if the field needs special processing
        if (field.useLogicAnalysis === true || field.useSeparateThread === true) {
          specialFields.push(field);
        } else {
          standardFields.push(field);
        }
      });

      // Log the field distribution for debugging
      this.logger.info(
        formatOperationLog(
          "SmartExtraction",
          nodeName,
          nodeId,
          index,
          `Field distribution: ${standardFields.length} standard fields, ${specialFields.length} special fields`
        )
      );

      // Process standard fields based on the field processing mode
      if (standardFields.length > 0) {
        if (options.fieldProcessingMode === 'batch') {
          // Process all standard fields in a single batch
          this.logger.info(
            formatOperationLog(
              "SmartExtraction",
              nodeName,
              nodeId,
              index,
              `Processing ${standardFields.length} standard fields in batch mode`
            )
          );

          const batchResult = await this.batchProcessFields(content, standardFields);

          if (batchResult.success && batchResult.data) {
            // Process the result based on the output structure
            const processedData = this.handleFunctionResult(batchResult.data, outputStructure);

            // Merge batch results into the main result object
            if (outputStructure === 'array') {
              // For array structure, initialize result as an array
              if (!Array.isArray(result)) {
                result = processedData;
              } else {
                // Merge arrays
                Object.assign(result, processedData);
              }
            } else {
              // Ensure result is an object before merging
              if (typeof result !== 'object' || Array.isArray(result)) {
                result = {};
              }
              // For object structure, merge objects
              Object.assign(result, processedData);
            }
          } else {
            this.logger.error(
              formatOperationLog(
                "SmartExtraction",
                nodeName,
                nodeId,
                index,
                `Batch processing failed: ${batchResult.error || 'Unknown error'}`
              )
            );
          }
        } else {
          // Process standard fields individually (original behavior)
          this.logger.info(
            formatOperationLog(
              "SmartExtraction",
              nodeName,
              nodeId,
              index,
              `Processing ${standardFields.length} standard fields individually`
            )
          );

          // Create a shared thread for standard fields
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

          // Process each standard field individually
          for (const field of standardFields) {
            const fieldResult = await this.processFieldWithAI(sharedThread.id, content, field);

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

                // Ensure result is an object before assigning properties
                if (Array.isArray(result)) {
                  result = {};
                }

                // Extract just the field value from the parsedValue object
                if (typeof parsedValue === 'object' && parsedValue !== null && field.name in parsedValue) {
                  result[field.name] = parsedValue[field.name];
                } else {
                  // If we can't extract the field value, use the parsed value as is
                  result[field.name] = parsedValue;
                }
              } catch (e) {
                this.logger.error(
                  formatOperationLog(
                    "SmartExtraction",
                    nodeName,
                    nodeId,
                    index,
                    `Error parsing field "${field.name}" result: ${(e as Error).message}`
                  )
                );

                // Ensure result is an object before assigning properties
                if (Array.isArray(result)) {
                  result = {};
                }
                result[field.name] = null;
              }
            } else {
              this.logger.error(
                formatOperationLog(
                  "SmartExtraction",
                  nodeName,
                  nodeId,
                  index,
                  `Failed to extract field "${field.name}": ${fieldResult.error || 'Unknown error'}`
                )
              );

              // Ensure result is an object before assigning properties
              if (Array.isArray(result)) {
                result = {};
              }
              result[field.name] = null;
            }
          }
        }
      }

      // Process special fields (always individually)
      for (const field of specialFields) {
        this.logger.info(
          formatOperationLog(
            "SmartExtraction",
            nodeName,
            nodeId,
            index,
            `Processing special field "${field.name}" with separate thread (logic: ${field.useLogicAnalysis === true})`
          )
        );

        // These fields always need a new thread
        const fieldResult = await this.processFieldWithAI(null, content, field);

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

            // Ensure result is an object before assigning properties
            if (Array.isArray(result)) {
              result = {};
            }

            // Extract just the field value from the parsedValue object
            if (typeof parsedValue === 'object' && parsedValue !== null && field.name in parsedValue) {
              result[field.name] = parsedValue[field.name];
            } else {
              // If we can't extract the field value, use the parsed value as is
              result[field.name] = parsedValue;
            }
          } catch (e) {
            this.logger.error(
              formatOperationLog(
                "SmartExtraction",
                nodeName,
                nodeId,
                index,
                `Error parsing special field "${field.name}" result: ${(e as Error).message}`
              )
            );

            // Ensure result is an object before assigning properties
            if (Array.isArray(result)) {
              result = {};
            }
            result[field.name] = null;
          }
        } else {
          this.logger.error(
            formatOperationLog(
              "SmartExtraction",
              nodeName,
              nodeId,
              index,
              `Failed to extract special field "${field.name}": ${fieldResult.error || 'Unknown error'}`
            )
          );

          // Ensure result is an object before assigning properties
          if (Array.isArray(result)) {
            result = {};
          }
          result[field.name] = null;
        }
      }

      // Process nested fields (fields with dot notation)
      for (const parentName in fieldGroups) {
        const nestedFields = fieldGroups[parentName];
        const nestedObject: Record<string, any> = {};

        this.logger.info(
          formatOperationLog(
            "SmartExtraction",
            nodeName,
            nodeId,
            index,
            `Processing ${nestedFields.length} nested fields for parent "${parentName}"`
          )
        );

        // Create a shared thread for this nested field group
        let nestedThread = null;
        if (options.fieldProcessingMode === 'individual') {
          const thread = await this.openai.beta.threads.create();
          nestedThread = thread.id;
          this.logger.debug(
            formatOperationLog(
              "SmartExtraction",
              nodeName,
              nodeId,
              index,
              `Created shared thread for nested fields of "${parentName}": ${nestedThread}`
            )
          );
        }

        // For batch mode with nested fields
        if (options.fieldProcessingMode === 'batch') {
          // Process all nested fields in a single batch
          const batchResult = await this.batchProcessFields(content, nestedFields);

          if (batchResult.success && batchResult.data) {
            // Assign all nested fields to the nested object
            Object.assign(nestedObject, batchResult.data);
          } else {
            this.logger.error(
              formatOperationLog(
                "SmartExtraction",
                nodeName,
                nodeId,
                index,
                `Batch processing failed for nested fields of "${parentName}": ${batchResult.error || 'Unknown error'}`
              )
            );
          }
        } else {
          // Process each nested field individually (original behavior)
          for (const childField of nestedFields) {
            const childResult = await this.processFieldWithAI(nestedThread, content, childField);

            if (childResult.success && childResult.data) {
              try {
                // Parse the result or use as is
                let parsedValue;
                try {
                  parsedValue = JSON.parse(childResult.data);
                } catch (parseError) {
                  // If not JSON, use as is
                  parsedValue = childResult.data;
                }

                // Extract just the field value from the parsedValue object
                if (typeof parsedValue === 'object' && parsedValue !== null && childField.name in parsedValue) {
                  nestedObject[childField.name] = parsedValue[childField.name];
                } else {
                  // If we can't extract the field value, use the parsed value as is
                  nestedObject[childField.name] = parsedValue;
                }
              } catch (e) {
                this.logger.error(
                  formatOperationLog(
                    "SmartExtraction",
                    nodeName,
                    nodeId,
                    index,
                    `Error parsing nested field "${parentName}.${childField.name}" result: ${(e as Error).message}`
                  )
                );
                nestedObject[childField.name] = null;
              }
            } else {
              this.logger.error(
                formatOperationLog(
                  "SmartExtraction",
                  nodeName,
                  nodeId,
                  index,
                  `Failed to extract nested field "${parentName}.${childField.name}": ${childResult.error || 'Unknown error'}`
                )
              );
              nestedObject[childField.name] = null;
            }
          }
        }

        // Ensure result is an object before assigning the nested object
        if (Array.isArray(result)) {
          result = {};
        }

        // Assign the nested object to the parent field in the result
        result[parentName] = nestedObject;
      }

      // Log the complete result structure
      this.logger.info(
        formatOperationLog(
          "SmartExtraction",
          nodeName,
          nodeId,
          index,
          `Extraction complete with ${Object.keys(typeof result === 'object' && !Array.isArray(result) ? result : {}).length} top-level fields`
        )
      );

      // Generate schema if needed
      let schema = null;
      if (options.includeSchema) {
        schema = this.generateOpenAISchema(options.fields);
      }

      // Handle the result according to outputStructure
      // If we're supposed to return an array and result is not an array, wrap it
      if (outputStructure === 'array' && !Array.isArray(result)) {
        // If result is an object with properties, put it in an array
        if (result && typeof result === 'object') {
          result = [result];

          // Log the conversion
          this.logger.info(
            formatOperationLog(
              "SmartExtraction",
              nodeName,
              nodeId,
              index,
              `Converted object result to array for 'array' output structure`
            )
          );
        }
      }

      // Log the final result structure
      if (isDebugMode) {
        this.logger.error(
          formatOperationLog(
            "SmartExtraction",
            nodeName,
            nodeId,
            index,
            `FINAL RESULT: Using outputStructure=${outputStructure}, returning ${typeof result} type${Array.isArray(result) ? ' (array)' : ''}`
          )
        );
      }

      // Return the result
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

      // Log the schema structure
      const outputStructure = this.options?.outputStructure || 'object';
      this.logDebug(
        `Using output structure: ${outputStructure}`,
        'info',
        'processTableContent'
      );

      // Generate the OpenAI schema from the fields for proper structured extraction
      // The `generateOpenAISchema` method will use `this.options.outputStructure` which is already correctly set.
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
      // Prompt needs to be conditional based on outputStructure
      const jsonFence = '```'; // Define the fence
      let tablePrompt = `
TASK: Extract specific fields from the table according to the field specifications below.

INPUT DATA:
${jsonFence}json
${JSON.stringify(tableContent, null, 2)}
${jsonFence}

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
1. Adhere strictly to the JSON schema provided to you for the overall output structure (single object or array of objects).
2. For each field defined in the schema, extract and provide the data as specified by the field's type and description.
`;

      if (outputStructure === 'object') {
        tablePrompt += `3. If consolidating data from multiple table rows into a single object (when the schema asks for a single object):
    - For each field, provide a single, consolidated value.
    - If a field inherently represents multiple distinct values from the source (e.g., multiple similar items from different rows intended for a single field name), use an array of those distinct values for that specific field IF the field's schema type is 'array'. Otherwise, provide the most representative single value.
`;
      } else { // outputStructure is 'array'
        tablePrompt += `3. If generating an array of objects (when the schema asks for an array):
    - Each object in the array should correspond to a logical item (e.g., a row) from the input data.
`;
      }

      tablePrompt += `4. Maintain data types as specified in the schema (string, number, boolean, array, object).
5. Ensure your entire response is a single, valid JSON that can be directly parsed and matches the provided schema.`;

      // Add this message to the thread
      await this.openai.beta.threads.messages.create(
        sharedThread.id,
        {
          role: "user",
          content: tablePrompt, // Use the dynamically generated prompt
        }
      );

      // Create a run with the function definition for OpenAI function calling
      const run = await this.openai.beta.threads.runs.create(
        sharedThread.id,
        {
          assistant_id: ASSISTANTS.manual,
          tools: [{
            type: "function",
            function: {
              name: "extract_data",
              description: "Extract structured information from the provided text content according to the specified fields",
              parameters: schema
            }
          }]
        }
      );

      // Additional debugging log
      this.logger.info(
        formatOperationLog(
          "SmartExtraction",
          nodeName,
          nodeId,
          index,
          `Created function run with schema for ${this.options?.outputStructure || 'object'} structure`
        )
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
            extractedData = this.handleFunctionResult(JSON.parse(result.data), this.options?.outputStructure || 'object');

            // Log the extracted data structure for debugging
            this.logDebug(
              `Successfully parsed result as JSON. Structure: ${this.describeDataStructure(extractedData)}`,
              'info',
              'processTableContent'
            );

            // Conditional array wrapping based on outputStructure
            if (outputStructure === 'array' && !Array.isArray(extractedData)) {
              this.logDebug(
                `Output structure is array, but got ${typeof extractedData}. Converting to array.`,
                'warn',
                'processTableContent'
              );
              extractedData = [extractedData];
            } else if (outputStructure === 'object' && Array.isArray(extractedData) && extractedData.length === 1) {
              // If expecting an object and AI returned an array of one, take the first element.
              // This can happen if the AI still wraps a single object result in an array.
              this.logDebug(
                `Output structure is object, but got an array of one. Taking first element.`,
                'warn',
                'processTableContent'
              );
              extractedData = extractedData[0];
            } else if (outputStructure === 'object' && Array.isArray(extractedData)) {
              // Expecting object, got array of multiple items. This is a mismatch.
              this.logDebug(
                `Output structure is object, but AI returned an array of multiple items. This is unexpected. Using array as is.`,
                'warn',
                'processTableContent'
              );
              // Keep extractedData as is (an array) and let downstream handle or log error further.
            }
            // If outputStructure is 'object' and extractedData is already an object, do nothing.

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
   * Poll for completion of an OpenAI Assistant run and handle any required actions
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

                // Clean the text content - remove potential markdown fences
                let cleanedTextContent = textContent.trim();
                if (cleanedTextContent.startsWith('```json')) {
                  cleanedTextContent = cleanedTextContent.substring(7); // Remove ```json
                }
                if (cleanedTextContent.startsWith('```')) {
                  cleanedTextContent = cleanedTextContent.substring(3);
                }
                if (cleanedTextContent.endsWith('```')) {
                  cleanedTextContent = cleanedTextContent.substring(0, cleanedTextContent.length - 3);
                }
                cleanedTextContent = cleanedTextContent.trim(); // Trim again after removing fences

                return { success: true, data: cleanedTextContent }; // Return cleaned content
              }
            }
          }

          return { success: false, error: 'No valid response content found' };
        } else if (run.status === 'requires_action') {
          // The assistant is waiting for us to execute the required tool calls
          if (isDebugMode) {
            this.logger.info(
              formatOperationLog(
                "SmartExtraction",
                nodeName,
                nodeId,
                index,
                `[OpenAI API] Run requires action: ${JSON.stringify(run.required_action, null, 2)}`
              )
            );
          }

          // Make sure we have required actions of type 'submit_tool_outputs'
          if (run.required_action && run.required_action.type === 'submit_tool_outputs') {
            const toolCalls = run.required_action.submit_tool_outputs.tool_calls;

            if (toolCalls && toolCalls.length > 0) {
              const toolOutputs = [];

              // Process each tool call
              for (const toolCall of toolCalls) {
                if (toolCall.type === 'function') {
                  const functionName = toolCall.function.name;
                  const functionArgs = JSON.parse(toolCall.function.arguments);

                  this.logger.info(
                    formatOperationLog(
                      "SmartExtraction",
                      nodeName,
                      nodeId,
                      index,
                      `[OpenAI API] Processing function call: ${functionName} with args: ${JSON.stringify(functionArgs, null, 2)}`
                    )
                  );

                  // Here we would normally actually execute the function
                  // But for extraction functions, we're just going to return the parsed args directly
                  // This effectively tells the assistant "yes, I extracted this data"
                  toolOutputs.push({
                    tool_call_id: toolCall.id,
                    output: JSON.stringify(functionArgs)
                  });
                }
              }

              // Submit the tool outputs back to the API
              if (toolOutputs.length > 0) {
                this.logger.info(
                  formatOperationLog(
                    "SmartExtraction",
                    nodeName,
                    nodeId,
                    index,
                    `[OpenAI API] Submitting ${toolOutputs.length} tool outputs`
                  )
                );

                await this.openai.beta.threads.runs.submitToolOutputs(
                  threadId,
                  runId,
                  { tool_outputs: toolOutputs }
                );

                // Continue polling for completion after submitting tool outputs
                continue;
              }
            }
          }

          // If we get here, there was an issue with the required actions
          return { success: false, error: 'Invalid required actions format' };
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
   * Handle function result processing, especially for array-based results
   */
  private handleFunctionResult(
    result: any,
    outputStructure: 'object' | 'array' = 'object'
  ): any {
    const { nodeName, nodeId, index } = this.context;
    const isDebugMode = this.options?.debugMode === true;

    try {
      // If result is already a parsed object, use it directly; otherwise try to parse it
      let data: any;
      if (typeof result === 'string') {
        try {
          data = JSON.parse(result);
        } catch (parseError) {
          // If parsing fails, use result as-is (might be a non-JSON string)
          data = result;
        }
      } else {
        data = result;
      }

      // Enhanced debug logging for function result processing
      if (isDebugMode) {
        this.logger.error(
          formatOperationLog(
            "SmartExtraction",
            nodeName,
            nodeId,
            index,
            `[handleFunctionResult] Processing result with outputStructure=${outputStructure}, data type=${typeof data}, isArray=${Array.isArray(data)}`
          )
        );
      }

      // Log the parsed data structure
      if (isDebugMode) {
        this.logger.info(
          formatOperationLog(
            "SmartExtraction",
            nodeName,
            nodeId,
            index,
            `[Function Result] Parsed result structure: ${this.describeDataStructure(data)}`
          )
        );
      }

      // Handle array output structure
      if (outputStructure === 'array') {
        this.logger.info(
          formatOperationLog(
            "SmartExtraction",
            nodeName,
            nodeId,
            index,
            `Processing result for array output structure: ${this.describeDataStructure(data)}`
          )
        );
        if (isDebugMode) {
           this.logger.error(`[ARRAY HANDLING] Raw data: ${JSON.stringify(data).substring(0, 100)}...`);
        }

        // If data is an object with an 'items' array (matching the schema)
        if (typeof data === 'object' && data !== null && Array.isArray(data.items)) {
            this.logger.info(
                formatOperationLog(
                    "SmartExtraction", nodeName, nodeId, index,
                    `Found 'items' array with ${data.items.length} elements, returning directly.`
                )
            );
            return data.items; // Return the items array
        }
        // If data is already an array
        else if (Array.isArray(data)) {
            this.logger.info(
                formatOperationLog(
                    "SmartExtraction", nodeName, nodeId, index,
                    `Data is already an array with ${data.length} elements, returning directly`
                )
            );
          return data; // Return the data array directly
        } else {
          // If data is not an array and doesn't have items, log error and return empty array
          this.logger.warn(
            formatOperationLog(
              "SmartExtraction",
              nodeName,
              nodeId,
              index,
              `Expected array structure but received ${typeof data}. Returning empty array.`
            )
          );
          return []; // Return empty array instead of wrapping string
        }
      } else { // outputStructure is 'object'
        // For object structure, check if we received an array but need an object
        this.logger.info(
          formatOperationLog(
            "SmartExtraction",
            nodeName,
            nodeId,
            index,
            `Processing result for object output structure: ${this.describeDataStructure(data)}`
          )
        );

        // Special handling for arrays when object output is expected
        if (Array.isArray(data)) {
          this.logger.info(
            formatOperationLog(
              "SmartExtraction",
              nodeName,
              nodeId,
              index,
              `Received array data but object output structure was requested. Converting to object.`
            )
          );

          // If it's an array with just one item, use that item directly
          if (data.length === 1) {
            this.logger.info(
              formatOperationLog(
                "SmartExtraction",
                nodeName,
                nodeId,
                index,
                `Array has single item, using it directly as the object.`
              )
            );
            return data[0];
          }
          // If it's an empty array, return empty object
          else if (data.length === 0) {
            this.logger.warn(
              formatOperationLog(
                "SmartExtraction",
                nodeName,
                nodeId,
                index,
                `Received empty array, returning empty object.`
              )
            );
            return {};
          }
          // For arrays with multiple items, convert to object with indices as keys
          else {
            this.logger.info(
              formatOperationLog(
                "SmartExtraction",
                nodeName,
                nodeId,
                index,
                `Converting array with ${data.length} items to indexed object.`
              )
            );
            return data.reduce((obj: Record<string, any>, item: any, idx: number) => {
              obj[idx.toString()] = item;
              return obj;
            }, {});
          }
        }

        // Log the parsed data structure
        if (isDebugMode) {
          this.logger.info(
            formatOperationLog(
              "SmartExtraction",
              nodeName,
              nodeId,
              index,
              `[Function Result] Parsed result structure: ${this.describeDataStructure(data)}`
            )
          );
        }

        return data;
      }
    }
    catch (error) {
      this.logger.error(
        formatOperationLog(
          "SmartExtraction",
          nodeName,
          nodeId,
          index,
          `Error processing function result: ${(error as Error).message}`
        )
      );
      // Return original result in case of error
      return result;
    }
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
        `Building prompt for field "${field.name}" with instructions: ${field.instructions ? field.instructions.substring(0, 100) + (field.instructions.length > 100 ? '...' : '') : 'No instructions'}`
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
   * Generate schema for OpenAI function calls
   */
  private generateOpenAISchema(fields: IField[]): any {
    // Log incoming field definitions with more detail
    this.logDebug(
      `Generating OpenAI schema for ${fields.length} fields`,
      'info',
      'generateOpenAISchema'
    );

    // Get the output structure directly from options
    const outputStructure = this.options?.outputStructure || 'object';

    // Add critical logging for the output structure being used
    const { nodeName, nodeId, index } = this.context;
    const isDebugMode = this.options?.debugMode || this.debugMode;

    if (isDebugMode) {
      this.logger.error(
        formatOperationLog(
          "SmartExtraction",
          nodeName,
          nodeId,
          index,
          `SCHEMA GENERATION: Using outputStructure=${outputStructure} for schema generation`
        )
      );
    }

    // Log all field details in debug mode for better visibility
    fields.forEach(field => {
      const extendedField = field as any;

      this.logger.info(
        formatOperationLog(
          'AIFormatting',
          this.context.nodeName,
          this.context.nodeId,
          this.context.index,
          `Field "${field.name}" (${field.type || 'string'}): ${field.instructions ? field.instructions.substring(0, 50) + (field.instructions.length > 50 ? '...' : '') : 'No instructions'}`
        )
      );

      // Check if the field has reference content
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

      // Default to string if type is undefined
      const fieldType = field.type || 'string';

      switch (fieldType.toLowerCase()) {
        case 'number':
        case 'integer':
          schemaType = fieldType.toLowerCase();
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
          // Log the incoming arrayItemType for this field
          this.logDebug(
            `Field "${field.name}" (array): incoming field.arrayItemType='${field.arrayItemType}', typeof=${typeof field.arrayItemType}`,
            'error', // Using 'error' for high visibility
            'generateOpenAISchema'
          );
          // If the field has arrayItemType defined, use it (lowercase), otherwise default to 'string'
          additionalProps.items = { type: field.arrayItemType?.trim().toLowerCase() || 'string' };
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
        description: field.instructions || `Extract the ${field.name}`
      };

      // Add format if specified
      if (schemaFormat) {
        property.format = schemaFormat;
      }

      // Add any additional properties
      Object.assign(property, additionalProps);

      // Add to properties map
      properties[field.name] = property;

      // Add to required array if marked as required
      if (field.format === 'required' || field.required === true) {
        required.push(field.name);
      }
    });

    // Log the output structure
    this.logDebug(
      `Using output structure: ${outputStructure}`,
      'info',
      'generateOpenAISchema'
    );

    // Create our schema object
    let schema: Record<string, any>;

    if (outputStructure === 'array') {
      // Create array schema for array output structure
      schema = {
        type: 'object',
        properties: {
          items: {
            type: 'array',
            description: 'Array of extracted items',
            items: {
              type: 'object',
              properties,
              ...(required.length > 0 ? { required } : {})
            }
          }
        },
        required: ['items']
      };

      // Log the schema structure for debugging
      this.logDebug(
        `Generated ARRAY schema structure with ${Object.keys(properties).length} properties`,
        'info',
        'generateOpenAISchema'
      );
    } else {
      // Create object schema for object output structure (default)
      schema = {
        type: 'object',
        properties,
        ...(required.length > 0 ? { required } : {})
      };

      // Log the schema structure for debugging
      this.logDebug(
        `Generated OBJECT schema structure with ${Object.keys(properties).length} properties`,
        'info',
        'generateOpenAISchema'
      );
    }

    // Log the schema structure for debugging
    this.logDebug(
      `Generated ${outputStructure.toUpperCase()} schema structure with ${Object.keys(properties).length} properties`,
      'info',
      'generateOpenAISchema'
    );

    // Add more detailed schema logging
    if (this.options?.debugMode || this.debugMode) {
      const { nodeName, nodeId, index } = this.context;
      this.logger.error(
        formatOperationLog(
          "SmartExtraction",
          nodeName,
          nodeId,
          index,
          `FINAL SCHEMA: ${JSON.stringify(schema).substring(0, 300)}...`
        )
      );
    }

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
      const result = await this.pollRunCompletion(actualThreadId, run.id);

      if (result.success && result.data) {
        // Clean up the result in case it's wrapped in Markdown code blocks
        try {
          let cleanedData = result.data;

          // Log the raw response for debugging
          this.logger.debug(
            formatOperationLog(
              "SmartExtraction",
              nodeName,
              nodeId,
              index,
              `Raw response from OpenAI for field "${field.name}": ${cleanedData}`
            )
          );

          // Remove markdown code block markers if present
          if (cleanedData.includes("```")) {
            // Extract content between markdown code blocks
            const codeBlockMatch = cleanedData.match(/```(?:json)?\s*([\s\S]*?)\s*```/);
            if (codeBlockMatch && codeBlockMatch[1]) {
              cleanedData = codeBlockMatch[1];
              this.logger.debug(
                formatOperationLog(
                  "SmartExtraction",
                  nodeName,
                  nodeId,
                  index,
                  `Extracted content from code block for field "${field.name}": ${cleanedData}`
                )
              );
            } else {
              // If we can't extract from the code block, strip all code block markers
              cleanedData = cleanedData.replace(/```(?:json)?|```/g, "").trim();
              this.logger.debug(
                formatOperationLog(
                  "SmartExtraction",
                  nodeName,
                  nodeId,
                  index,
                  `Removed code block markers for field "${field.name}": ${cleanedData}`
                )
              );
            }
          }

          return { success: true, data: cleanedData };
        } catch (error) {
          // If there's an error cleaning the data, return the original result
          this.logger.warn(
            formatOperationLog(
              "SmartExtraction",
              nodeName,
              nodeId,
              index,
              `Error cleaning response for field "${field.name}": ${(error as Error).message}. Using original response.`
            )
          );
          return { success: true, data: result.data };
        }
      }

      return result;
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
      return { success: false, error: (error as Error).message };
    }
  }

  /**
   * Map field type to schema type
   */
  private mapFieldTypeToSchemaType(type?: string): string {
    if (!type) return 'string';

    switch (type.toLowerCase()) {
      case 'number':
      case 'integer':
        return 'number';
      case 'boolean':
        return 'boolean';
      case 'date':
        return 'string';
      case 'datetime':
        return 'string';
      case 'array':
        return 'array';
      case 'object':
        return 'object';
      default:
        return 'string';
    }
  }

  /**
   * Describe data structure
   */
  private describeDataStructure(data: any): string {
    if (typeof data === 'object' && data !== null) {
      if (Array.isArray(data)) {
        return `Array of ${data.length} items`;
      } else {
        return `Object with ${Object.keys(data).length} properties`;
      }
    } else if (typeof data === 'string') {
      return `String (${data.length} characters)`;
    } else if (typeof data === 'number') {
      return 'Number';
    } else if (typeof data === 'boolean') {
      return 'Boolean';
    } else if (typeof data === 'undefined') {
      return 'Undefined';
    } else if (typeof data === 'function') {
      return 'Function';
    } else if (typeof data === 'symbol') {
      return 'Symbol';
    } else {
      return 'Unknown';
    }
  }

  /**
   * Debug log utility function for AIService
   * @param message Message to log
   * @param level Log level (info, debug, warn, error)
   * @param functionName Optional function name
   */
  private logDebug(
    message: string | Error,
    level: 'info' | 'debug' | 'warn' | 'error' = 'debug',
    functionName?: string
  ) {
    const { nodeName, nodeId, index } = this.context;
    const component = "aiService";
    const fn = functionName || "unknown";

    // Format error objects
    const formattedMessage = message instanceof Error
      ? `${message.message}\n${message.stack || ''}`
      : message;

    // Use our standardized logging helper
    logWithDebug(
      this.logger,
      this.debugMode,
      nodeName,
      'AIService',
      component,
      fn,
      formattedMessage,
      level
    );
  }

  /**
   * Process all fields at once in a single batch
   * This is more efficient than processing fields individually
   */
  private async batchProcessFields(
    content: string,
    fields: IField[]
  ): Promise<{ success: boolean; data?: Record<string, any>; error?: string }> {
    const { nodeName, nodeId, index } = this.context;
    const outputStructure = this.options?.outputStructure || 'object';
    const isDebugMode = this.options?.debugMode === true;

    try {
      // Log which fields we're processing in batch mode
      this.logger.info(
        formatOperationLog(
          "SmartExtraction",
          nodeName,
          nodeId,
          index,
          `Processing ${fields.length} fields in batch mode with output structure: ${outputStructure}`
        )
      );

      // Create a new thread for batch processing
      const thread = await this.openai.beta.threads.create();

      // Generate schema that respects the output structure
      const schema = this.generateOpenAISchema(fields);

      // Build a comprehensive prompt that includes all fields
      // For batch mode, we want to clean field instructions from global reference content
      // since we'll add it at the top level instead
      let cleanFields = fields;
      let hasGlobalReference = false;

      // Check if we have global reference content that should be at the top level
      if (this.options?.includeReferenceContext && this.options?.referenceContent) {
        hasGlobalReference = true;

        // Clean the fields by removing the appended reference content from instructions
        cleanFields = fields.map(field => {
          const referenceNote = `\n\nUse this as reference: "${this.options?.referenceContent}"`;
          let cleanInstructions = field.instructions || '';

          // Remove the reference content that was appended to the field
          if (cleanInstructions.includes(referenceNote)) {
            cleanInstructions = cleanInstructions.replace(referenceNote, '');
          }

          return {
            ...field,
            instructions: cleanInstructions
          };
        });
      }

      let fieldDescriptions = cleanFields.map((field, index) => {
        return `${index + 1}. ${field.name}: ${field.instructions || `Extract the ${field.name}`}`;
      }).join("\n");

      // Build the batch prompt with proper structure
      let batchPrompt = `TASK: Extract all the specified fields from the provided content.\n`;

      // Add input data first
      batchPrompt += `\nINPUT DATA:\n${content}\n`;

      // Add global reference content after input data if available
      if (hasGlobalReference && this.options?.referenceContent) {
        const referenceName = this.options?.referenceName || 'reference';
        batchPrompt += `\nHere is additional reference material to extract data from. This reference is named '${referenceName}': "${this.options.referenceContent}"\n`;
      }

      // Add fields section
      batchPrompt += `\nFIELDS TO EXTRACT:\n${fieldDescriptions}`;

      // Add additional instructions if provided
      if (this.options?.generalInstructions && this.options.generalInstructions.trim() !== '') {
        batchPrompt += `\n\nADDITIONAL INSTRUCTIONS:\n${this.options.generalInstructions}`;
      }

      // Add processing instructions
      batchPrompt += `\n\nINSTRUCTIONS:
1. Analyze the content carefully
2. Extract each field according to its specifications
3. Return the data in a ${outputStructure === 'array' ? 'properly formatted array of objects' : 'properly formatted object'}
${outputStructure === 'array' ? '4. The response should be an array containing objects with the field properties, even if there is only one object' : ''}
${outputStructure === 'object' ? '4. CRITICAL: Since output structure is "object", you must extract data for exactly ONE entity/record only. Call the extract_data function ONLY ONCE. Do not make multiple function calls.' : ''}
5. Use appropriate data types for each field (string, number, boolean, etc.)
6. If a field is not found, set its value to null
${outputStructure === 'object' ? '\n7. IMPORTANT: Make only ONE function call to extract_data, not multiple calls. Return data for the single most relevant entity based on the instructions.' : ''}

Ensure that your response is valid JSON that can be parsed directly.`;

      // Send the prompt to the thread
      await this.openai.beta.threads.messages.create(
        thread.id,
        {
          role: "user",
          content: batchPrompt,
        }
      );

      this.logger.info(
        formatOperationLog(
          "SmartExtraction",
          nodeName,
          nodeId,
          index,
          `Sent batch request to OpenAI for ${fields.length} fields with output structure: ${outputStructure}`
        )
      );

      // Log the schema being used
      if (isDebugMode) {
        this.logger.error(
          formatOperationLog(
            "SmartExtraction",
            nodeName,
            nodeId,
            index,
            `[Batch Processing] Using schema for ${fields.length} fields: ${JSON.stringify(schema, null, 2)}`
          )
        );

        // Add very explicit logging for outputStructure value
        this.logger.error(
          formatOperationLog(
            "SmartExtraction",
            nodeName,
            nodeId,
            index,
            `[CRITICAL DEBUG] BEFORE API CALL: outputStructure=${outputStructure}, this.options.outputStructure=${this.options?.outputStructure}, schema type=${schema.type}`
          )
        );

        // If schema is for array output, log the array schema details
        if (outputStructure === 'array' && schema.properties?.items?.type === 'array') {
          this.logger.error(
            formatOperationLog(
              "SmartExtraction",
              nodeName,
              nodeId,
              index,
              `[ARRAY SCHEMA DETAIL] items property exists: ${!!schema.properties.items}, type: ${schema.properties.items.type}`
            )
          );
        }
      }

      // Create a run with the function definition for OpenAI function calling
      const run = await this.openai.beta.threads.runs.create(
        thread.id,
        {
          assistant_id: ASSISTANTS.manual,
          tools: [{
            type: "function",
            function: {
              name: "extract_data",
              description: "Extract structured information from the provided text content according to the specified fields",
              parameters: schema
            }
          }]
        }
      );

      // Additional debugging log
      this.logger.info(
        formatOperationLog(
          "SmartExtraction",
          nodeName,
          nodeId,
          index,
          `Created function run with schema for ${outputStructure} structure`
        )
      );

      // Poll for completion
      const result = await this.pollRunCompletion(thread.id, run.id);

      if (result.success && result.data) {
        try {
          // Process the result based on output structure
          const processedData = this.handleFunctionResult(result.data, outputStructure);

          // Log the processed data structure
          this.logger.info(
            formatOperationLog(
              "SmartExtraction",
              nodeName,
              nodeId,
              index,
              `Batch processing successful - Output structure: ${this.describeDataStructure(processedData)}`
            )
          );

          return { success: true, data: processedData };
        } catch (error) {
          const errorMsg = `Error processing batch result: ${(error as Error).message}`;
          this.logger.error(
            formatOperationLog(
              "SmartExtraction",
              nodeName,
              nodeId,
              index,
              errorMsg
            )
          );
          return { success: false, error: errorMsg };
        }
      } else {
        const errorMsg = `Batch processing failed: ${result.error || 'Unknown error'}`;
        this.logger.error(
          formatOperationLog(
            "SmartExtraction",
            nodeName,
            nodeId,
            index,
            errorMsg
          )
        );
        return { success: false, error: errorMsg };
      }
    } catch (error) {
      const errorMsg = `Error in batch processing: ${(error as Error).message}`;
      this.logger.error(
        formatOperationLog(
          "SmartExtraction",
          nodeName,
          nodeId,
          index,
          errorMsg
        )
      );
      return { success: false, error: errorMsg };
    }
  }
}
