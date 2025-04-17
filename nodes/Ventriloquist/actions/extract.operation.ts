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
						displayName: "Enable AI Formatting",
						name: "enableAiFormatting",
						type: "boolean",
						default: false,
						description: "Whether to use AI to format and structure the extracted data",
					},
					{
						displayName: "Extraction Format",
						name: "extractionFormat",
						type: "options",
						displayOptions: {
							show: {
								enableAiFormatting: [true],
							},
						},
						options: [
							{
								name: "Auto-detect",
								value: "auto",
								description: "Automatically detect the format of the extracted data",
							},
							{
								name: "JSON",
								value: "json",
								description: "Extract data as JSON",
							},
							{
								name: "Text",
								value: "text",
								description: "Extract data as text",
							},
							{
								name: "CSV",
								value: "csv",
								description: "Extract data as CSV",
							},
							{
								name: "Table",
								value: "table",
								description: "Extract data as a table",
							},
							{
								name: "HTML",
								value: "html",
								description: "Extract data as HTML",
							},
						],
						default: "json",
						description: "Format to use for extracted data",
					},
					{
						displayName: "AI Model",
						name: "aiModel",
						type: "options",
						displayOptions: {
							show: {
								enableAiFormatting: [true],
							},
						},
						options: [
							{
								name: "GPT-4o",
								value: "gpt-4o",
								description: "Most advanced model with broader general knowledge and improved instruction following",
							},
							{
								name: "GPT-4",
								value: "gpt-4",
								description: "Most capable GPT-4 model for complex tasks",
							},
							{
								name: "GPT-3.5 Turbo",
								value: "gpt-3.5-turbo",
								description: "Most capable GPT-3.5 model, optimized for chat at 1/10th the cost of GPT-4",
							},
						],
						default: "gpt-4o",
						description: "AI model to use for formatting",
					},
					{
						displayName: "General Instructions",
						name: "generalInstructions",
						type: "string",
						displayOptions: {
							show: {
								enableAiFormatting: [true],
							},
						},
						default: "",
						description: "Additional instructions for the AI",
						typeOptions: {
							rows: 4,
						},
					},
					{
						displayName: "Strategy",
						name: "strategy",
						type: "options",
						displayOptions: {
							show: {
								enableAiFormatting: [true],
							},
						},
						options: [
							{
								name: "Auto",
								value: "auto",
								description: "Automatically determine fields from content",
							},
							{
								name: "Manual",
								value: "manual",
								description: "Define specific fields to extract",
							},
						],
						default: "auto",
						description: "Strategy to use for extraction",
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
								enableAiFormatting: [true],
								strategy: ["manual"],
							},
						},
						default: { items: [{ name: "", type: "string", instructions: "" }] },
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
											{
												name: "String",
												value: "string",
											},
											{
												name: "Number",
												value: "number",
											},
											{
												name: "Boolean",
												value: "boolean",
											},
											{
												name: "Object",
												value: "object",
											},
											{
												name: "Array",
												value: "array",
											},
										],
										default: "string",
										description: "Type of the field to extract",
									},
									{
										displayName: "Instructions",
										name: "instructions",
										type: "string",
										default: "",
										description: "Instructions for the AI on how to extract this field",
										typeOptions: {
											rows: 2,
										},
									},
								],
							},
						],
					},
					{
						displayName: "Include Schema",
						name: "includeSchema",
						type: "boolean",
						displayOptions: {
							show: {
								enableAiFormatting: [true],
							},
						},
						default: false,
						description: "Whether to include the generated schema in the output",
					},
					{
						displayName: "Include Raw Data",
						name: "includeRawData",
						type: "boolean",
						displayOptions: {
							show: {
								enableAiFormatting: [true],
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
		displayName: "Debug Page Content",
		name: "debugPageContent",
		type: "boolean",
		default: false,
		description: "Whether to include page information in debug logs",
		displayOptions: {
			show: {
				operation: ["extract"],
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
	const debugPageContent = this.getNodeParameter("debugPageContent", index, false) as boolean;
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
		if (debugPageContent) {
			await logPageDebugInfo(
				page,
				this.logger,
				{
					operation: "Extract",
					nodeName,
					nodeId,
					index,
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
			// Create AI formatting options from parameters
			const enableAiFormatting = this.getNodeParameter(`extractionItems.items[${extractionItems.indexOf(item)}].enableAiFormatting`, index, false) as boolean;

			let aiFields: IDataObject[] = [];
			let aiFormatting: {
				enabled: boolean;
				extractionFormat: string;
				aiModel: string;
				generalInstructions: string;
				strategy: string;
				includeSchema: boolean;
				includeRawData: boolean;
			} | undefined = undefined;

			if (enableAiFormatting) {
				// Get AI specific parameters only if enableAiFormatting is true
				const extractionFormat = this.getNodeParameter(
					`extractionItems.items[${extractionItems.indexOf(item)}].extractionFormat`,
					index,
					'json'
				) as string;

				const aiModel = this.getNodeParameter(
					`extractionItems.items[${extractionItems.indexOf(item)}].aiModel`,
					index,
					'gpt-4o'
				) as string;

				const generalInstructions = this.getNodeParameter(
					`extractionItems.items[${extractionItems.indexOf(item)}].generalInstructions`,
					index,
					''
				) as string;

				const strategy = this.getNodeParameter(
					`extractionItems.items[${extractionItems.indexOf(item)}].strategy`,
					index,
					'auto'
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

				// Get AI fields if manual strategy is selected
				if (strategy === 'manual') {
					try {
						aiFields = this.getNodeParameter(
							`extractionItems.items[${extractionItems.indexOf(item)}].aiFields.items`,
							index,
							[]
						) as IDataObject[];
					} catch (error) {
						// Handle the case where aiFields might not exist
						aiFields = [];
					}
				}

				aiFormatting = {
					enabled: true,
					extractionFormat,
					aiModel,
					generalInstructions,
					strategy,
					includeSchema,
					includeRawData
				};
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
				aiFormatting: enableAiFormatting ? aiFormatting : undefined,
				// Add AI fields if using manual strategy
				aiFields: enableAiFormatting && aiFormatting && aiFormatting.strategy === 'manual' ?
					aiFields.map((field) => ({
						name: field.name as string,
						description: field.instructions as string,
						type: field.type as string,
						required: field.format === 'required'
					})) : undefined,
				// Only set hasOpenAiApiKey when AI formatting is actually enabled for this item
				hasOpenAiApiKey: enableAiFormatting && !!openAiApiKey,
				// Add page and session information
				puppeteerPage: page,
				puppeteerSessionId: sessionId,
			};

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
				enableAiFormatting: true, // We handle enableAiFormatting per item in the typedExtractionItems array
			},
			this.logger,
			openAiApiKey
		);

		// Store all extraction results
		const extractionResults: IDataObject = {
			extractedData: extractionData,
			// Add a more easily accessible format for the actual extracted data values
			data: extractionData.reduce((result: IDataObject, item: IExtractItem) => {
				// Only include items that have extracted data
				if (item.extractedData !== undefined) {
					result[item.name] = item.extractedData;
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
			inputData: items[index].json,
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
			additionalData: {
				...items[index].json,
			},
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
