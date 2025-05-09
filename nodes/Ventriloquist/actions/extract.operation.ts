import type {
	IExecuteFunctions,
	IDataObject,
	INodeExecutionData,
	INodeProperties,
} from "n8n-workflow";
import type * as puppeteer from "puppeteer-core";
import { SessionManager } from "../utils/sessionManager";
import { getActivePage } from "../utils/sessionUtils";
import {
	formatOperationLog,
	createSuccessResponse,
	createTimingLog,
} from "../utils/resultUtils";
import { createErrorResponse } from "../utils/errorUtils";
import { processExtractionItems, type IExtractItem } from "../utils/extractNodeUtils";
import { logPageDebugInfo } from "../utils/debugUtils";
import { v4 as uuidv4 } from 'uuid';
import { logWithDebug } from '../utils/loggingUtils';

/**
 * Extract operation description
 */
export const description: INodeProperties[] = [
	{
		displayName: "Session ID",
		name: "explicitSessionId",
		type: "string",
		default: "",
		description:
			"Session ID to use (leave empty to use ID from input or create new)",
		displayOptions: {
			show: {
				operation: ["extract"],
			},
		},
	},
	{
		displayName: "Extractions",
		name: "extractionItems",
		type: "fixedCollection",
		typeOptions: {
			multipleValues: true,
			sortable: true,
		},
		default: {
			items: [
				{
					name: "main",
					extractionType: "text",
					selector: ""
				}
			]
		},
		description: "Data to extract from the page",
		displayOptions: {
			show: {
				operation: ["extract"],
			},
		},
		options: [
			{
				name: "items",
				displayName: "Items",
				values: [
					{
						displayName: "Name",
						name: "name",
						type: "string",
						default: "",
						placeholder: "e.g., title, price, description",
						description: "A name to identify this extraction in the output",
						required: true,
					},
					{
						displayName: "Extraction Type",
						name: "extractionType",
						type: "options",
						options: [
							{
								name: "Attribute",
								value: "attribute",
								description: "Extract specific attribute from an element",
							},
							{
								name: "HTML",
								value: "html",
								description: "Extract HTML content from an element",
							},
							{
								name: "Input Value",
								value: "value",
								description: "Extract value from input, select or textarea",
							},
							{
								name: "Multiple Elements",
								value: "multiple",
								description: "Extract data from multiple elements matching a selector",
							},
							{
								name: "Table",
								value: "table",
								description: "Extract data from a table",
							},
							{
								name: "Text Content",
								value: "text",
								description: "Extract text content from an element",
							},
						],
						default: "text",
						description: "What type of data to extract from the page",
						required: true,
					},
					{
						displayName: "Selector",
						name: "selector",
						type: "string",
						default: "",
						placeholder: "#main-content, .result-title, table.data",
						description:
							'CSS selector to target the element. Use "#ID" for IDs, ".class" for classes, "tag" for HTML elements, or "tag[attr=value]" for attributes.',
						required: true,
					},
					{
						displayName: "Continue If Not Found",
						name: "continueIfNotFound",
						type: "boolean",
						default: false,
						description: "Whether to continue with other extractions if this selector isn't found on the page",
					},
					{
						displayName: "Text Options",
						name: "textOptions",
						type: "collection",
						placeholder: "Add Option",
						default: {},
						typeOptions: {
							multipleValues: false,
						},
						displayOptions: {
							show: {
								extractionType: ["text"],
							},
						},
						options: [
							{
								displayName: "Clean Text",
								name: "cleanText",
								type: "boolean",
								default: false,
								description: "Whether to clean up the text by replacing multiple consecutive newlines with a single newline",
							},
						],
					},
					{
						displayName: "Attribute Name",
						name: "attributeName",
						type: "string",
						default: "",
						placeholder: "href, src, data-ID",
						description: "Name of the attribute to extract (only needed when Content to Extract is set to Attribute Value)",
						displayOptions: {
							show: {
								extractionType: ["attribute"],
							},
						},
						required: true,
					},
					{
						displayName: "HTML Options",
						name: "htmlOptions",
						type: "collection",
						placeholder: "Add Option",
						default: {},
						typeOptions: {
							multipleValues: false,
						},
						displayOptions: {
							show: {
								extractionType: ["html"],
							},
						},
						options: [
							{
								displayName: "Output Format",
								name: "outputFormat",
								type: "options",
								options: [
									{
										name: "HTML (String)",
										value: "html",
										description: "Return the HTML as a raw string",
									},
									{
										name: "JSON",
										value: "json",
										description: "Return the HTML wrapped in a JSON object",
									},
								],
								default: "html",
								description: "Format of the output data",
							},
							{
								displayName: "Include Metadata",
								name: "includeMetadata",
								type: "boolean",
								default: false,
								description:
									"Whether to include metadata about the HTML (length, structure info)",
							},
						],
					},
					{
						displayName: "Schema",
						name: "schema",
						type: "options",
						options: [
							{ name: "No Schema", value: "none", description: "No schema or AI assistance" },
							{ name: "Auto-Schema", value: "auto", description: "AI-assisted schema extraction (auto)" },
							{ name: "Field-by-Field Schema", value: "manual", description: "Field-by-field schema extraction (manual)" },
						],
						default: "none",
						description: "Schema extraction method to use",
					},
					{
						displayName: "Output Structure",
						name: "outputStructure",
						type: "options",
						options: [
							{ name: "Single Object", value: "object", description: "Extract as a single object" },
							{ name: "Array of Objects", value: "array", description: "Extract as an array of objects" },
						],
						default: "object",
						description: "Structure of the extracted data",
						displayOptions: {
							show: {
								schema: ["manual"],
							},
						},
					},
					{
						displayName: "Field Processing Mode",
						name: "fieldProcessingMode",
						type: "options",
						options: [
							{ name: "Process fields simultaneously", value: "batch", description: "Process all fields in one request (faster + cheaper)" },
							{ name: "Process fields one after the next", value: "individual", description: "Process each field separately (more diligent but expensive)" },
						],
						default: "batch",
						description: "How to process extraction fields",
						displayOptions: {
							show: {
								schema: ["manual"],
							},
						},
					},
					{
						displayName: "General Instructions",
						name: "generalInstructions",
						type: "string",
						displayOptions: {
							show: {
								schema: ["auto", "manual"],
							},
						},
						default: "",
						description: "Additional instructions for the AI",
						typeOptions: {
							rows: 4,
						},
					},
					{
						displayName: "Include Additional Context for Reference",
						name: "includeReferenceContext",
						type: "boolean",
						displayOptions: {
							show: {
								schema: ["auto", "manual"],
							},
						},
						default: false,
						description: "Whether to include additional context from another element on the page",
					},
					{
						displayName: "Reference Selector",
						name: "referenceSelector",
						type: "string",
						displayOptions: {
							show: {
								schema: ["auto", "manual"],
								includeReferenceContext: [true],
							},
						},
						default: "",
						placeholder: "#header_info, .context-element",
						description: "CSS selector for the element containing reference context",
						required: true,
					},
					{
						displayName: "Selector Scope",
						name: "selectorScope",
						type: "options",
						options: [
							{
								name: "Global (Whole Page)",
								value: "global",
								description: "Search for the reference selector in the entire page",
							},
							{
								name: "Relative (Within Parent Element)",
								value: "relative",
								description: "Search for the reference selector only within the parent/comparison element",
							},
						],
						displayOptions: {
							show: {
								schema: ["auto", "manual"],
								includeReferenceContext: [true],
							},
						},
						default: "global",
						description: "Scope for the reference selector",
					},
					{
						displayName: "Reference Name",
						name: "referenceName",
						type: "string",
						displayOptions: {
							show: {
								schema: ["auto", "manual"],
								includeReferenceContext: [true],
							},
						},
						default: "referenceContext",
						placeholder: "header_info, pageContext",
						description: "Name to use for the reference context in the AI prompt",
						required: true,
					},
					{
						displayName: "Reference Format",
						name: "referenceFormat",
						type: "options",
						options: [
							{
								name: "Text",
								value: "text",
								description: "Extract plain text content",
							},
							{
								name: "HTML",
								value: "html",
								description: "Extract HTML content",
							},
							{
								name: "Attribute",
								value: "attribute",
								description: "Extract a specific attribute value",
							},
						],
						displayOptions: {
							show: {
								schema: ["auto", "manual"],
								includeReferenceContext: [true],
							},
						},
						default: "text",
						description: "Format to extract from the reference element",
					},
					{
						displayName: "Attribute Name",
						name: "referenceAttribute",
						type: "string",
						displayOptions: {
							show: {
								schema: ["auto", "manual"],
								includeReferenceContext: [true],
								referenceFormat: ["attribute"],
							},
						},
						default: "href",
						placeholder: "href, src, data-url",
						description: "Name of the attribute to extract",
					},
					{
						displayName: "Fields",
						name: "aiFields",
						placeholder: "Add Field",
						type: "fixedCollection",
						typeOptions: {
							multipleValues: true,
							sortable: true,
						},
						displayOptions: {
							show: {
								schema: ["manual"],
							},
						},
						default: { items: [{ name: "", type: "string", aiAssisted: true, instructions: "" }] },
						options: [
							{
								name: "items",
								displayName: "Items",
								values: [
									{
										displayName: "Name",
										name: "name",
										type: "string",
										default: "",
										description: "Name of the field to extract",
										required: true,
									},
									{
										displayName: "Type",
										name: "type",
										type: "options",
										options: [
											{ name: "String", value: "string" },
											{ name: "Number", value: "number" },
											{ name: "Boolean", value: "boolean" },
											{ name: "Object", value: "object" },
											{ name: "Array", value: "array" },
										],
										default: "string",
										description: "Type of the field to extract",
									},
									{
										displayName: "Array Item Type",
										name: "arrayItemType",
										type: "options",
										displayOptions: {
											show: {
												type: ["array"], // Show only if 'type' is 'array'
											},
										},
										options: [
											{ name: "String", value: "string" },
											{ name: "Number", value: "number" },
											{ name: "Boolean", value: "boolean" },
										],
										default: "string",
										description: "Specifies the data type of items in the array when 'Type' is set to 'Array'.",
										// required: true, // Consider making this true if type is 'array' via a function or more complex show/hide logic if N8N supports it
									},
									{
										displayName: "AI Assisted",
										name: "aiAssisted",
										type: "boolean",
										default: true,
										description: "Enable AI assistance for this field (shows Instructions field)",
									},
									{
										displayName: "Relative Selector",
										name: "relativeSelector",
										type: "string",
										default: "",
										placeholder: ".price, .title, span.value",
										description: "CSS selector to extract data relative to the parent element",
										displayOptions: {
											show: {
												aiAssisted: [false],
											},
										},
										required: true,
									},
									{
										displayName: "Relative Selector (Optional)",
										name: "relativeSelectorOptional",
										type: "string",
										default: "",
										placeholder: ".price, .title, span.value",
										description: "Optional CSS selector to extract data relative to the parent element (AI Assisted)",
										displayOptions: {
											show: {
												aiAssisted: [true],
											},
										},
									},
									{
										displayName: "Instructions",
										name: "instructions",
										type: "string",
										default: "",
										description: "Instructions for the AI on how to extract this field",
										typeOptions: { rows: 2 },
										displayOptions: {
											show: {
												aiAssisted: [true],
											},
										},
									},
									{
										displayName: "Options",
										name: "fieldOptions",
										type: "collection",
										placeholder: "Add Option",
										default: {},
										typeOptions: { multipleValues: false },
										options: [
											{
												displayName: "Extraction Type",
												name: "extractionType",
												type: "options",
												options: [
													{ name: "Text Content", value: "text" },
													{ name: "HTML", value: "html" },
													{ name: "Attribute", value: "attribute" },
													{ name: "Value", value: "value" },
												],
												default: "text",
												description: "Requires a selector to be set for this option to take effect"
											},
											{
												displayName: "Attribute Name",
												name: "attributeName",
												type: "string",
												default: "",
												placeholder: "href, src, data-ID",
												description: "Name of the attribute to extract. When AI Assisted is enabled, the attribute value will be included in the instructions as 'The value of the [attribute] attribute is: [value]'.",
											},
											{
												displayName: "Format",
												name: "format",
												type: "options",
												options: [
													{ name: "Default", value: "default" },
													{ name: "Trimmed", value: "trimmed" },
													{ name: "Raw", value: "raw" },
													{ name: "Custom", value: "custom" },
												],
												default: "default",
												description: "Requires a selector to be set for this option to take effect"
											},
											{
												displayName: "AI Processing Mode",
												name: "aiProcessingMode",
												type: "options",
												options: [
													{ name: "Standard Processing", value: "standard" },
													{ name: "Logical/Numerical Analysis", value: "logical" },
												],
												default: "standard",
												description: "Use specialized reasoning model for logical or numerical analysis"
											},
											{
												displayName: "Thread Management",
												name: "threadManagement",
												type: "options",
												options: [
													{ name: "Use Shared Thread", value: "shared" },
													{ name: "Use Separate Thread", value: "separate" },
												],
												default: "shared",
												description: "Controls whether to use a shared thread or a separate thread for this field's processing"
											},
										],
									},
								],
							},
						],
					},
					{
						displayName: "Output Schema",
						name: "includeSchema",
						type: "boolean",
						displayOptions: {
							show: {
								schema: ["auto", "manual"],
							},
						},
						default: false,
						description: "Whether to include the generated schema in the output",
					},
					{
						displayName: "Output Raw Data",
						name: "includeRawData",
						type: "boolean",
						displayOptions: {
							show: {
								schema: ["auto", "manual"],
							},
						},
						default: false,
						description: "Whether to include the raw data in the output",
					},
					{
						displayName: "Table Options",
						name: "tableOptions",
						type: "collection",
						placeholder: "Add Option",
						default: {},
						typeOptions: {
							multipleValues: false,
						},
						displayOptions: {
							show: {
								extractionType: ["table"],
							},
						},
						options: [
							{
								displayName: "Include Headers",
								name: "includeHeaders",
								type: "boolean",
								default: true,
								description: "Whether to use the first row as headers in the output",
							},
							{
								displayName: "Row Selector",
								name: "rowSelector",
								type: "string",
								default: "tr",
								description:
									"CSS selector for table rows relative to table selector (default: tr)",
							},
							{
								displayName: "Cell Selector",
								name: "cellSelector",
								type: "string",
								default: "td, th",
								description:
									"CSS selector for table cells relative to row selector (default: td, th)",
							},
							{
								displayName: "Output Format",
								name: "outputFormat",
								type: "options",
								options: [
									{
										name: "JSON Objects",
										value: "json",
										description: "Return an array of objects with header keys",
									},
									{
										name: "2D Array",
										value: "array",
										description: "Return a two-dimensional array of cells",
									},
								],
								default: "json",
								description: "Format of the extracted table data",
							},
							{
								displayName: "Extract Attributes",
								name: "extractAttributes",
								type: "boolean",
								default: false,
								description: "Whether to extract attributes from cells (like href from links)",
							},
							{
								displayName: "Attribute Name",
								name: "attributeName",
								type: "string",
								default: "href",
								placeholder: "href, src, data-id",
								description: "Name of the attribute to extract from cells (href is common for links)",
								displayOptions: {
									show: {
										extractAttributes: [true],
									},
								},
							},
						],
					},
					{
						displayName: "Multiple Options",
						name: "multipleOptions",
						type: "collection",
						placeholder: "Add Option",
						default: {},
						typeOptions: {
							multipleValues: false,
						},
						displayOptions: {
							show: {
								extractionType: ["multiple"],
							},
						},
						options: [
							{
								displayName: "Content to Extract",
								name: "extractionProperty",
								type: "options",
								options: [
									{
										name: "Text Content",
										value: "textContent",
										description: "Extract text content from each element",
									},
									{
										name: "Inner HTML",
										value: "innerHTML",
										description: "Extract HTML content from each element",
									},
									{
										name: "Outer HTML",
										value: "outerHTML",
										description:
											"Extract outer HTML (including the element itself) from each element",
									},
									{
										name: "Attribute Value",
										value: "attribute",
										description: "Extract a specific attribute value from each element",
									},
								],
								default: "textContent",
								description: "What content to extract from each matched element",
							},
							{
								displayName: "Clean Text",
								name: "cleanText",
								type: "boolean",
								default: false,
								description: "Whether to clean up the text by replacing multiple consecutive newlines with a single newline (only applies when Content to Extract is set to Text Content)",
							},
							{
								displayName: "Attribute Name",
								name: "attributeName",
								type: "string",
								default: "",
								placeholder: "href, src, data-ID",
								description:
									"Name of the attribute to extract (only needed when Content to Extract is set to Attribute Value)",
							},
							{
								displayName: "Output Format",
								name: "outputFormat",
								type: "options",
								options: [
									{
										name: "Array",
										value: "array",
										description: "Return a simple array of values",
									},
									{
										name: "JSON Objects",
										value: "object",
										description: "Return an array of JSON objects with key-value pairs",
									},
									{
										name: "Joined String",
										value: "string",
										description: "Return a single string with elements joined by separator",
									},
								],
								default: "array",
								description: "Format of the extracted data",
							},
							{
								displayName: "Separator",
								name: "separator",
								type: "string",
								default: ", ",
								description: "Character(s) used to join elements (only applies when Output Format is set to Joined String)",
							},
							{
								displayName: "Output Limit",
								name: "outputLimit",
								type: "number",
								default: 0,
								description:
									"Maximum number of elements to extract (0 = no limit)",
							},
							{
								displayName: "Output as Objects",
								name: "extractProperty",
								type: "boolean",
								default: false,
								description:
									"Whether to output results as objects with a key-value structure instead of an array (only applies when Output Format is set to Array)",
							},
							{
								displayName: "Object Key Name",
								name: "propertyKey",
								type: "string",
								default: "value",
								description:
									"The name of the key to use in the output objects (only applies when Output as Objects is enabled and Output Format is set to Array)",
							},
						],
					},
				],
			},
		],
	},
	// --- Common fields for both modes ---
	{
		displayName: "Wait For Selector",
		name: "waitForSelector",
		type: "boolean",
		default: true,
		description: "Whether to wait for the selector to appear in page",
		displayOptions: {
			show: {
				operation: ["extract"],
			},
		},
	},
	{
		displayName: "Timeout",
		name: "timeout",
		type: "number",
		default: 30000,
		description: "Maximum time to wait for the selector in milliseconds",
		displayOptions: {
			show: {
				operation: ["extract"],
				waitForSelector: [true],
			},
		},
	},
	{
		displayName: "Use Human-Like Delays",
		name: "useHumanDelays",
		type: "boolean",
		default: false,
		description: "Whether to add random human-like pauses during extraction to appear more natural",
		displayOptions: {
			show: {
				operation: ["extract"],
			},
		},
	},
	{
		displayName: "Continue On Error",
		name: "continueOnFail",
		type: "boolean",
		default: true,
		description: "Whether to continue execution even when extraction fails",
		displayOptions: {
			show: {
				operation: ["extract"],
			},
		},
	},
	{
		displayName: "Take Screenshot",
		name: "takeScreenshot",
		type: "boolean",
		default: false,
		description: "Whether to capture a screenshot of the page after extraction",
		displayOptions: {
			show: {
				operation: ["extract"],
			},
		},
	},
	{
		displayName: "Debug Mode",
		name: "debugMode",
		type: "boolean",
		default: false,
		description:
			"Whether to include technical details in the output, page information in debug logs, and verbose console logging. When disabled, only extracted data and essential fields are returned.",
		displayOptions: {
			show: {
				operation: ["extract"],
			},
		},
	},
];

/**
 * Execute the extract operation
 */
export async function execute(
	this: IExecuteFunctions,
	index: number,
	websocketEndpoint: string,
	workflowId: string,
	openAiApiKey?: string,
): Promise<INodeExecutionData> {
	const startTime = Date.now();
	const items = this.getInputData();
	let sessionId = "";
	let page: puppeteer.Page | null = null;

	// Added for better logging
	const nodeName = this.getNode().name;
	const nodeId = this.getNode().id;

	// Visual marker to clearly indicate a new node is starting
	this.logger.info("============ STARTING NODE EXECUTION ============");
	this.logger.info(
		formatOperationLog(
			"Extract",
			nodeName,
			nodeId,
			index,
			"Starting execution",
		),
	);

	// Get common parameters
	const waitForSelector = this.getNodeParameter("waitForSelector", index, true) as boolean;
	const timeout = this.getNodeParameter("timeout", index, 30000) as number;
	const useHumanDelays = this.getNodeParameter("useHumanDelays", index, false) as boolean;
	const takeScreenshotOption = this.getNodeParameter("takeScreenshot", index, false) as boolean;
	const continueOnFail = this.getNodeParameter("continueOnFail", index, true) as boolean;
	const debugMode = this.getNodeParameter("debugMode", index, false) as boolean;
	const explicitSessionId = this.getNodeParameter("explicitSessionId", index, "") as string;

	this.logger.info(
		formatOperationLog(
			"Extract",
			nodeName,
			nodeId,
			index,
			`Parameters: waitForSelector=${waitForSelector}, timeout=${timeout}ms`,
		),
	);

	// Log debug information about OpenAI API usage
	if (debugMode) {
		logWithDebug(
			this.logger,
			true,
			nodeName,
			'Extract',
			'extract.operation',
			'execute',
			`DEBUG MODE ENABLED - OPENAI API REQUEST LOGGING WILL BE ACTIVE`,
			'error'
		);

		// Explicitly mark the beginning of a debug session with proper format
		logWithDebug(
			this.logger,
			true,
			nodeName,
			'Extract',
			'extract.operation',
			'execute',
			`Debug mode ON - OpenAI API key available: ${!!openAiApiKey} (length: ${openAiApiKey?.length || 0})`,
			'error'
		);

		logWithDebug(
			this.logger,
			true,
			nodeName,
			'Extract',
			'extract.operation',
			'execute',
			`Debug flags: debugMode=${debugMode}`,
			'error'
		);

		// Make it clear we're using OpenAI Assistants API
		logWithDebug(
			this.logger,
			true,
			nodeName,
			'Extract',
			'extract.operation',
			'execute',
			`IMPORTANT: Using OpenAI Assistants API with the AIService implementation`,
			'error'
		);

		if (openAiApiKey) {
			logWithDebug(
				this.logger,
				true,
				nodeName,
				'Extract',
				'extract.operation',
				'execute',
				`Using OpenAI Assistants API with valid API key (${openAiApiKey.length} chars)`,
				'error'
			);
		} else {
			logWithDebug(
				this.logger,
				true,
				nodeName,
				'Extract',
				'extract.operation',
				'execute',
				`No OpenAI API key provided - AI processing will be skipped`,
				'error'
			);
		}
	}

	try {
		// Use the centralized session management
		const sessionResult = await SessionManager.getOrCreatePageSession(
			this.logger,
			{
				explicitSessionId,
				websocketEndpoint,
				workflowId,
				operationName: "Extract",
				nodeId,
				nodeName,
				index,
			},
		);
		sessionId = sessionResult.sessionId;

		// Get the page
		page = sessionResult.page;
		if (!page) {
			const currentSession = SessionManager.getSession(sessionId);
			if (currentSession?.browser?.isConnected()) {
				page = await getActivePage(currentSession.browser, this.logger);
			} else {
				throw new Error(
					"Failed to get session or browser is disconnected after getOrCreatePageSession",
				);
			}
		}

		if (!page) {
			throw new Error("Failed to get or create a page");
		}

		// Debug page content if enabled
		if (debugMode) {
			await logPageDebugInfo(
				page,
				this.logger,
				{
					operation: "Extract",
					nodeName,
					nodeId,
					index,
				},
				{
					debugMode // Pass debugMode to enable all debug features
				}
			);
		}

		// Get all extraction items
		const extractionItems = this.getNodeParameter(
			"extractionItems.items",
			index,
			[],
		) as IDataObject[];

		if (!extractionItems.length) {
			throw new Error("No extraction items defined");
		}

		// Convert extraction items to properly typed items
		const typedExtractionItems: IExtractItem[] = extractionItems.map((item) => {
			// Log debug information about the item
			this.logger.debug(`Processing extraction item with name: ${item.name}, type: ${item.extractionType}, schema: ${item.schema}`);

			// Check if AI formatting is enabled based on Schema selection
			let schema = this.getNodeParameter(
				`extractionItems.items[${extractionItems.indexOf(item)}].schema`,
				index,
				"none",
			) as string;

			let aiFormatting: any = undefined;
			let aiFields: IDataObject[] = [];
			let fieldProcessingMode = "batch";

			// Additional parameters for AI formatting
			if (schema === "auto" || schema === "manual") {
				// Get common AI formatting parameters
				const extractionFormat =
					(this.getNodeParameter(
						`extractionItems.items[${extractionItems.indexOf(item)}].extractionFormat`,
						index,
						"json"
					) as string) || "json";

				const generalInstructions = this.getNodeParameter(
					`extractionItems.items[${extractionItems.indexOf(item)}].generalInstructions`,
					index,
					""
				) as string;

				const includeSchema = this.getNodeParameter(
					`extractionItems.items[${extractionItems.indexOf(item)}].includeSchema`,
					index,
					false
				) as boolean;

				const includeRawData = this.getNodeParameter(
					`extractionItems.items[${extractionItems.indexOf(item)}].includeRawData`,
					index,
					false
				) as boolean;

				// Check if we need reference context
				const includeReferenceContext = this.getNodeParameter(
					`extractionItems.items[${extractionItems.indexOf(item)}].includeReferenceContext`,
					index,
					false
				) as boolean;

				// Get reference context parameters if enabled
				let referenceSelector = "";
				let referenceName = "reference";
				let referenceFormat = "text";
				let referenceAttribute = "";
				let selectorScope = "global";

				if (includeReferenceContext) {
					// Get reference selector
					referenceSelector = this.getNodeParameter(
						`extractionItems.items[${extractionItems.indexOf(item)}].referenceSelector`,
						index,
						""
					) as string;

					// Get reference name
					referenceName = this.getNodeParameter(
						`extractionItems.items[${extractionItems.indexOf(item)}].referenceName`,
						index,
						"reference"
					) as string;

					// Get reference format
					referenceFormat = this.getNodeParameter(
						`extractionItems.items[${extractionItems.indexOf(item)}].referenceFormat`,
						index,
						"text"
					) as string;

					// Get attribute name if using attribute format
					if (referenceFormat === "attribute") {
						referenceAttribute = this.getNodeParameter(
							`extractionItems.items[${extractionItems.indexOf(
								item,
							)}].referenceAttribute`,
							index,
							""
						) as string;
					}

					// Get selector scope
					selectorScope = this.getNodeParameter(
						`extractionItems.items[${extractionItems.indexOf(item)}].selectorScope`,
						index,
						"global"
					) as string;
				}

				// Get AI fields if manual strategy is selected
				if (schema === 'manual') {
					try {
						aiFields = this.getNodeParameter(
							`extractionItems.items[${extractionItems.indexOf(item)}].aiFields.items`,
							index,
							[]
						) as IDataObject[];

						// Log the number of AI fields found
						this.logger.debug(`Found ${aiFields.length} AI fields for item ${item.name}`);

						// TEMPORARY DEBUG: Examine fields with attribute extraction type
						aiFields.forEach(field => {
							const fieldOptions = field.fieldOptions as IDataObject || {};
							if (fieldOptions.extractionType === 'attribute') {
								logWithDebug(
									this.logger,
									true,
									nodeName,
									'Extract',
									'extract.operation',
									'execute',
									`ATTRIBUTE EXTRACTION FIELD FOUND: "${field.name}"`,
									'error'
								);
								logWithDebug(
									this.logger,
									true,
									nodeName,
									'Extract',
									'extract.operation',
									'execute',
									`Field details: attributeName=${fieldOptions.attributeName}, selector=${field.relativeSelectorOptional || field.relativeSelector}`,
									'error'
								);
								logWithDebug(
									this.logger,
									true,
									nodeName,
									'Extract',
									'extract.operation',
									'execute',
									`Field object: ${JSON.stringify(field)}`,
									'error'
								);
							}
						});
					} catch (error) {
						// Handle the case where aiFields might not exist
						this.logger.warn(`Error getting AI fields for item ${item.name}: ${(error as Error).message}`);
						aiFields = [];
					}
				}

				// Get the field processing mode if using manual strategy
				let fieldProcessingMode = 'batch';

				// Get output structure for manual mode
				let outputStructure = 'object';

				// Default to batch mode
				if (schema === 'manual') {
					try {
						fieldProcessingMode = this.getNodeParameter(
							`extractionItems.items[${extractionItems.indexOf(item)}].fieldProcessingMode`,
							index,
							'batch'
						) as string;

						outputStructure = this.getNodeParameter(
							`extractionItems.items[${extractionItems.indexOf(item)}].outputStructure`,
							index,
							'object'
						) as string;

						// Add high-visibility logging when in debug mode
						if (debugMode) {
							logWithDebug(
								this.logger,
								true,
								nodeName,
								'Extract',
								'extract.operation',
								'execute',
								`OUTPUT STRUCTURE SPECIFIED: "${outputStructure}" for item "${item.name}"`,
								'error'
							);
						}

						this.logger.debug(`Using field processing mode: ${fieldProcessingMode} for item ${item.name}`);
						this.logger.debug(`Using output structure: ${outputStructure} for item ${item.name}`);
					} catch (error) {
						// If parameter doesn't exist yet, use default
						this.logger.debug(`Field processing mode not found, using default: batch for item ${item.name}`);
						this.logger.debug(`Output structure not found, using default: object for item ${item.name}`);
					}
				}

				aiFormatting = {
					enabled: true,
					extractionFormat,
					generalInstructions,
					strategy: schema, // 'manual' or 'auto'
					includeSchema,
					includeRawData,
					includeReferenceContext,
					referenceSelector,
					referenceName,
					referenceFormat,
					referenceAttribute,
					selectorScope,
					fieldProcessingMode, // Add the field processing mode
					outputStructure, // Add the output structure
				};

				// Add more detailed logging for aiFormatting when in debug mode
				if (debugMode) {
					logWithDebug(
						this.logger,
						true,
						nodeName,
						'Extract',
						'extract.operation',
						'execute',
						`AI FORMATTING OBJECT: outputStructure=${outputStructure}, strategy=${schema}, fieldProcessingMode=${fieldProcessingMode}`,
						'error'
					);
				}

				// Log AI formatting settings
				this.logger.debug(`AI formatting enabled for ${item.name} - strategy: ${schema}, format: ${extractionFormat}, structure: ${outputStructure}`);
			} else {
				this.logger.debug(`AI formatting not enabled for ${item.name} - schema: ${schema}`);
			}

			const extractItem: IExtractItem = {
				id: uuidv4(),
				name: item.name as string,
				extractionType: item.extractionType as string,
				selector: item.selector as string,
				continueIfNotFound: item.continueIfNotFound as boolean | undefined,
				attribute: item.attributeName as string | undefined,
				textOptions: item.textOptions as {
					cleanText?: boolean;
				} | undefined,
				htmlOptions: item.htmlOptions as {
					outputFormat?: string;
					includeMetadata?: boolean;
				} | undefined,
				tableOptions: item.tableOptions as {
					includeHeaders?: boolean;
					rowSelector?: string;
					cellSelector?: string;
					outputFormat?: string;
				} | undefined,
				multipleOptions: item.multipleOptions as {
					attributeName?: string;
					extractionProperty?: string;
					outputLimit?: number;
					extractProperty?: boolean;
					propertyKey?: string;
					separator?: string;
					outputFormat?: string;
					cleanText?: boolean;
				} | undefined,
				// Add AI formatting options if enabled
				aiFormatting: schema === "manual" || schema === "auto" ? aiFormatting : undefined,
				// Add AI fields if using manual strategy
				aiFields: schema === "manual" ?
					aiFields.map((field) => {
						// Get relativeSelectorOptional or relativeSelector for this field if they exist
						const relativeSelectorOptional = field.relativeSelectorOptional as string;
						const relativeSelector = field.relativeSelector as string;

						// For non-AI fields, we need to properly capture and use the relativeSelector value
						// For AI fields, we use relativeSelectorOptional
						// This ensures proper handling regardless of AI mode
						const aiAssisted = field.aiAssisted as boolean;
						const actualSelector = aiAssisted ? relativeSelectorOptional : relativeSelector;

						// Get the field options for extraction type and attribute name
						const fieldOptions = field.fieldOptions as IDataObject || {};
						const extractionType = fieldOptions.extractionType as string || 'text';
						const attributeName = fieldOptions.attributeName as string || '';

						// Check if this is a nested field (contains dots in the name) and handle it
						let fieldName = field.name as string;
						let isNestedField = false;

						const arrayItemTypeValue = field.arrayItemType as string | undefined; // Get it from the IDataObject

						// Log all field information for debugging
						if (debugMode) {
							logWithDebug(
								this.logger,
								true,
								nodeName,
								'extraction',
								'extract.operation',
								'execute',
								`Processing field "${fieldName}" with type: ${field.type}, AI assisted: ${aiAssisted}, ArrayItemType from param: ${arrayItemTypeValue}`,
								'error'
							);
						}

						// Add more debug information for better visibility
						this.logger.debug(`Field ${fieldName} AI=${aiAssisted}, using selector=${actualSelector}` +
							(fieldOptions && fieldOptions.extractionType === 'attribute' ? `, attribute=${fieldOptions.attributeName || ''}` : ''));

						return {
							name: fieldName,
							instructions: field.instructions as string || '',
							type: field.type as string,
							arrayItemType: arrayItemTypeValue,
							required: field.format === 'required',
							// Pass BOTH selector types to ensure compatibility
							relativeSelectorOptional: relativeSelectorOptional,
							relativeSelector: relativeSelector,
							// Pass the AI mode flag for clarity in processing
							aiAssisted: aiAssisted,
							// Add the extraction type and attribute name for proper handling
							extractionType: extractionType,
							attributeName: attributeName,
							// Pass other field options as needed
							fieldOptions: fieldOptions
						};
					}) : undefined,
				// Only set hasOpenAiApiKey when AI formatting is actually enabled for this item
				hasOpenAiApiKey: (schema === "manual" || schema === "auto") && !!openAiApiKey,
				// Add page and session information
				puppeteerPage: page,
				puppeteerSessionId: sessionId,
			};

			// If we have an OpenAI API key and AI is enabled, store the key for use in processing
			if (openAiApiKey && (schema === "manual" || schema === "auto")) {
				extractItem.openAiApiKey = openAiApiKey;
			}

			// Log the extract item configuration (without sensitive info)
			this.logger.debug(`Extract item ${extractItem.name} config: AI enabled=${!!extractItem.aiFormatting?.enabled}, hasKey=${extractItem.hasOpenAiApiKey}, strategy=${extractItem.aiFormatting?.strategy || 'none'}`);

			return extractItem;
		});

		// Using our new utility to process all extraction items
		const extractionData = await processExtractionItems(
			typedExtractionItems,
			{
				waitForSelector,
				timeout,
				useHumanDelays,
				continueOnFail,
				nodeName,
				nodeId,
				// Add AI formatting options - these get checked for each item individually
				debugMode: debugMode, // Single debug mode toggle
			},
			this.logger,
			openAiApiKey
		);

		// Add direct logging about extraction items that had AI formatting enabled
		if (debugMode) {
			const aiEnabledItems = typedExtractionItems.filter(item => item.aiFormatting?.enabled);
			logWithDebug(
				this.logger,
				true,
				nodeName,
				'Extract',
				'extract.operation',
				'execute',
				`${aiEnabledItems.length} items had AI formatting enabled out of ${typedExtractionItems.length} total items`,
				'error'
			);
			logWithDebug(
				this.logger,
				true,
				nodeName,
				'Extract',
				'extract.operation',
				'execute',
				`AI-enabled items: ${aiEnabledItems.map(i => i.name).join(', ')}`,
				'error'
			);
		}

		// Store all extraction results
		const extractionResults: IDataObject = {
			// Only include extractedData array in debug mode
			...(debugMode ? {
				extractedData: extractionData.map(item => ({
					id: item.id,
					name: item.name,
					extractionType: item.extractionType,
					selector: item.selector,
					extractedData: item.extractedData,
					rawData: item.rawData,
					schema: item.schema
				}))
			} : {}),
			// Instead of passing all data as is, create a properly mapped output based on the extraction configuration
			data: extractionData.reduce((result: IDataObject, item: IExtractItem) => {
				// Add detailed debug logs
				if (debugMode) {
					logWithDebug(
						this.logger,
						true,
						nodeName,
						'extraction',
						'extract.operation',
						'execute',
						`DEBUG: Processing item [${item.name}], type: ${item.extractionType}, has data: ${item.extractedData !== undefined}`,
						'error'
					);
				}

				// Only include items that have extracted data
				if (item.extractedData !== undefined) {
					// Check if AI formatting is enabled but also prioritize direct attribute values
					// Only use direct attribute extraction if preserveFieldStructure flag is not set
					// AND we only have a single field that's a direct attribute
					const shouldUseDirect = !item.preserveFieldStructure &&
						Array.isArray(item.aiFields) &&
						item.aiFields.length === 1 && // Only apply direct extraction when there's exactly one field
						item.aiFields.some(field => {
							const enhancedField = field as {
								returnDirectAttribute?: boolean;
								referenceContent?: string;
							};
							return enhancedField.returnDirectAttribute === true && enhancedField.referenceContent !== undefined;
						});

					if (shouldUseDirect) {
						// Find the field with direct attribute and use its value
						const directField = (item.aiFields as any[]).find(field =>
							field.returnDirectAttribute === true && field.referenceContent !== undefined
						);

						this.logger.info(
							formatOperationLog(
								'extraction',
								nodeName,
								nodeId,
								index,
								`Using direct attribute value for [${item.name}]: ${directField.referenceContent}`
							)
						);

						result[item.name] = directField.referenceContent;
					}
					// Special handling for array data to maintain object structure
					else if (Array.isArray(item.extractedData) && item.extractionType === 'table') {
						this.logger.info(
							formatOperationLog(
								'extraction',
								nodeName,
								nodeId,
								index,
								`Using structured table data for [${item.name}] (${item.extractedData.length} rows)`
							)
						);

						// Preserve array structure when it's a table
						result[item.name] = item.extractedData;
					}
					// Handle AI-processed data - preserve nested structure
					else if (item.aiFormatting?.enabled) {
						this.logger.info(
							formatOperationLog(
								'extraction',
								nodeName,
								nodeId,
								index,
								`Using AI-processed data for [${item.name}]`
							)
						);

						// If AI formatting is enabled, outputStructure is 'array', and extractedData is actually an array,
						// use the extractedData directly.
						if (item.aiFormatting.outputStructure === 'array' && Array.isArray(item.extractedData)) {
							this.logger.info(
								formatOperationLog(
									'extraction',
									nodeName,
									nodeId,
									index,
									`Output structure for [${item.name}] is 'array' and AI returned an array. Using AI data directly.`
								)
							);
							result[item.name] = item.extractedData;
						}
						// Check if the data needs to maintain field structure (and not handled by the array case above)
						else if (item.preserveFieldStructure) {
							// If we have the preserved field structure flag, we need to construct a field-based object
							const fieldBasedResult: Record<string, any> = {};

							if (Array.isArray(item.aiFields) && item.aiFields.length > 0) {
								// Log the field structure we're processing
								this.logger.info(
									formatOperationLog(
										'extraction',
										nodeName,
										nodeId,
										index,
										`Processing ${item.aiFields.length} fields with structure preservation for [${item.name}]`
									)
								);

								// Check if we have dot notation fields that need to be handled specially
								const hasNestedFields = item.aiFields.some(field => field.name.includes('.'));

								if (hasNestedFields) {
									// If we have nested fields, we'll build a hierarchy
									for (const field of item.aiFields) {
										// Skip processing if this is a nested field - we'll handle it through its parent
										if (field.name.includes('.')) {
											continue;
										}

										// For each top-level field, check if it has nested fields
										const fieldName = field.name;
										const nestedFields: typeof item.aiFields = item.aiFields.filter(f =>
											f.name.startsWith(fieldName + '.') && f.name !== fieldName
										);

										if (nestedFields.length > 0) {
											// This field has nested children - create an object structure
											const nestedObject: Record<string, any> = {};

											// Process each nested field
											for (const nestedField of nestedFields) {
												// Get the child field name (part after the dot)
												const childName = nestedField.name.split('.')[1];

												// Try to get the value from the extracted data
												if (typeof item.extractedData === 'object' &&
													item.extractedData !== null &&
													item.extractedData[nestedField.name] !== undefined) {
													// Store the value in the nested object using the child name
													nestedObject[childName] = item.extractedData[nestedField.name];
												} else {
													// If not found, set to null
													nestedObject[childName] = null;
												}
											}

											// Try to get the value for the parent field itself
											let parentValue = null;
											if (typeof item.extractedData === 'object' &&
												item.extractedData !== null &&
												item.extractedData[fieldName] !== undefined) {
												parentValue = item.extractedData[fieldName];
											}

											// If parent value is an object, merge it with nested values
											if (parentValue !== null && typeof parentValue === 'object') {
												fieldBasedResult[fieldName] = { ...parentValue, ...nestedObject };
											} else {
												// Otherwise, just use the nested structure
												fieldBasedResult[fieldName] = nestedObject;
											}
										} else {
											// Regular non-nested field
											const extField = field as any;
											if (extField.returnDirectAttribute === true && extField.referenceContent !== undefined) {
												fieldBasedResult[fieldName] = extField.referenceContent;
											} else if (typeof item.extractedData === 'object' &&
													   item.extractedData !== null &&
													   item.extractedData[fieldName] !== undefined) {
												fieldBasedResult[fieldName] = item.extractedData[fieldName];
											} else {
												fieldBasedResult[fieldName] = null;
											}
										}
									}
								} else {
									// Regular field processing without nested fields
									for (const field of item.aiFields) {
										const fieldName = field.name;

										// If this field has direct attribute extraction
										const extField = field as any;
										if (extField.returnDirectAttribute === true && extField.referenceContent !== undefined) {
											fieldBasedResult[fieldName] = extField.referenceContent;

											this.logger.info(
												formatOperationLog(
													'extraction',
													nodeName,
													nodeId,
													index,
													`Using direct attribute for field [${item.name}.${fieldName}]: ${extField.referenceContent?.substring(0, 30)}...`
												)
											);
										}
										// Otherwise, try to get the value from AI-processed data if it exists
										else if (typeof item.extractedData === 'object' && item.extractedData !== null) {
											// Check if the AI result contains this field
											if (item.extractedData[fieldName] !== undefined) {
												fieldBasedResult[fieldName] = item.extractedData[fieldName];

												this.logger.info(
													formatOperationLog(
														'extraction',
														nodeName,
														nodeId,
														index,
														`Using AI-processed value for field [${item.name}.${fieldName}]`
													)
												);
											} else {
												this.logger.warn(
													formatOperationLog(
														'extraction',
														nodeName,
														nodeId,
														index,
														`Field [${fieldName}] not found in AI-processed data for [${item.name}]`
													)
												);

												// Set to null to ensure the field exists in the output
												fieldBasedResult[fieldName] = null;
											}
										} else {
											// AI data is not an object, set null for this field
											fieldBasedResult[fieldName] = null;

											this.logger.warn(
												formatOperationLog(
													'extraction',
													nodeName,
													nodeId,
													index,
													`No object data available for field [${fieldName}] in [${item.name}]`
												)
											);
										}
									}
								}

								// Use the field-based result instead of the raw AI result
								result[item.name] = fieldBasedResult;

								this.logger.info(
									formatOperationLog(
										'extraction',
										nodeName,
										nodeId,
										index,
										`Created field-based object for [${item.name}] with ${Object.keys(fieldBasedResult).length} fields`
									)
								);
							} else {
								// No fields defined, use the AI-processed data as-is
								result[item.name] = item.extractedData;
							}
						}
						// Check if the AI-processed data is a complex object or nested structure
						else if (typeof item.extractedData === 'object' && item.extractedData !== null) {
							const dataKeys = Object.keys(item.extractedData);

							this.logger.info(
								formatOperationLog(
									'extraction',
									nodeName,
									nodeId,
									index,
									`Data for [${item.name}] is a complex object with properties: ${dataKeys.join(', ')}`
								)
							);

							// If this is a manually-processed field-by-field extraction and we have a manual schema
							if (item.aiFormatting.strategy === 'manual' && Array.isArray(item.aiFields) && item.aiFields.length > 0) {
								// Extra validation to ensure object structure matches field structure
								const hasMatchingFields = item.aiFields.some(field => dataKeys.includes(field.name));

								if (hasMatchingFields || dataKeys.length > 0) {
									// Preserve the structure completely - this is the key fix that maintains nested data
									result[item.name] = item.extractedData;

									// Additional logging to verify the structure is maintained
									logWithDebug(
										this.logger,
										true,
										nodeName,
										'extraction',
										'extract.operation',
										'execute',
										`STRUCTURE CHECK: Field [${item.name}] contains structured data with properties: ${Object.keys(item.extractedData).join(', ')}`,
										'error'
									);
								} else {
									// Structure doesn't match field definitions, just use as-is
									result[item.name] = item.extractedData;
								}
							} else {
								// For auto-processed data or data with an unexpected structure
								result[item.name] = item.extractedData;
							}
						} else {
							// Simple value or null
							result[item.name] = item.extractedData;
						}
					}
					// Regular extraction without AI
					else {
						this.logger.info(
							formatOperationLog(
								'extraction',
								nodeName,
								nodeId,
								index,
								`Using raw extracted data for [${item.name}]`
							)
						);
						result[item.name] = item.extractedData;
					}

					// Always include schema if it exists
					if (item.schema && item.aiFormatting?.includeSchema) {
						this.logger.info(
							formatOperationLog(
								'extraction',
								nodeName,
								nodeId,
								index,
								`Including schema for [${item.name}]`
							)
						);
						result[`${item.name}_schema`] = item.schema;
					}

					// Include raw data only if includeRawData option is enabled
					if (item.rawData !== undefined && item.aiFormatting?.includeRawData) {
						this.logger.info(
							formatOperationLog(
								'extraction',
								nodeName,
								nodeId,
								index,
								`Including raw data for [${item.name}]`
							)
						);
						result[`${item.name}_raw`] = item.rawData;
					}
				} else {
					// Log warning for missing data
					this.logger.warn(
						formatOperationLog(
							'extraction',
							nodeName,
							nodeId,
							index,
							`No extracted data found for [${item.name}]`
						)
					);
					// Set a placeholder for missing data
					result[item.name] = null;
				}
				return result;
			}, {}),
		};

		// Log timing information
		createTimingLog("Extract", startTime, this.logger, nodeName, nodeId, index);

		// Create success response with the extracted data
		// Get potentially updated page for response
		let pageForResponse: puppeteer.Page | null = null;
		const currentSession = SessionManager.getSession(sessionId);
		if (currentSession?.browser?.isConnected()) {
			pageForResponse = await getActivePage(
				currentSession.browser,
				this.logger,
			);
		}

		// We'll let createSuccessResponse handle the screenshot
		const successResponse = await createSuccessResponse({
			operation: "extract",
			sessionId,
			page: pageForResponse || page, // Use updated page, fallback to original if needed
			logger: this.logger,
			startTime,
			takeScreenshot: takeScreenshotOption,
			additionalData: {
				...extractionResults,
			},
			// Do not include input data to avoid exposing previous node data
		});

		return { json: successResponse };
	} catch (error) {
		// Use the standardized error response utility
		const errorResponse = await createErrorResponse({
			error: error as Error,
			operation: "extract",
			sessionId,
			nodeId,
			nodeName,
			selector: "multiple",
			page,
			logger: this.logger,
			takeScreenshot: takeScreenshotOption,
			startTime,
			// Do not include input data to avoid exposing previous node data
		});

		if (!continueOnFail) {
			// Attach context before throwing
			if (error instanceof Error) {
				(error as Error & { context: object }).context = {
					sessionId,
					errorResponse,
				};
			}
			throw error;
		}

		// Return error as response with continue on fail
		return {
			json: errorResponse,
		};
	}
}


