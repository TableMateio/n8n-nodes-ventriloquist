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
						description: "Name of the attribute to extract from the element",
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
								description: "Whether to clean up the text by replacing multiple consecutive newlines with a single newline",
								displayOptions: {
									show: {
										extractionProperty: ["textContent"],
									},
								},
							},
							{
								displayName: "Attribute Name",
								name: "attributeName",
								type: "string",
								default: "",
								placeholder: "href, src, data-ID",
								description:
									"Name of the attribute to extract (required when Content to Extract is set to Attribute Value)",
								displayOptions: {
									show: {
										extractionProperty: ["attribute"],
									},
								},
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
								description: "Character(s) used to join elements when Output Format is set to Joined String",
								displayOptions: {
									show: {
										outputFormat: ["string"],
									},
								},
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
									"Whether to output results as objects with a key-value structure instead of an array",
								displayOptions: {
									show: {
										outputFormat: ["array"],
									},
								},
							},
							{
								displayName: "Object Key Name",
								name: "propertyKey",
								type: "string",
								default: "value",
								description:
									"The name of the key to use in the output objects (when Output as Objects is enabled)",
								displayOptions: {
									show: {
										extractProperty: [true],
										outputFormat: ["array"],
									},
								},
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
		const typedExtractionItems: IExtractItem[] = extractionItems.map((item) => ({
			name: item.name as string,
			extractionType: item.extractionType as string,
			selector: item.selector as string,
			continueIfNotFound: item.continueIfNotFound as boolean | undefined,
			attributeName: item.attributeName as string | undefined,
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
		}));

		// Using our new utility to process all extraction items
		const extractionData = await processExtractionItems(
			page,
			typedExtractionItems,
			{
				waitForSelector,
				timeout,
				useHumanDelays,
				continueOnFail,
			},
			{
				logger: this.logger,
				nodeName,
				nodeId,
				sessionId,
				index,
			}
		);

		// Store all extraction results
		const extractionResults: IDataObject = {
			extractedData: extractionData,
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
