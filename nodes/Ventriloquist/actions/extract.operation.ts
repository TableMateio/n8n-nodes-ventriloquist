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
	formatExtractedDataForLog,
	getHumanDelay,
	getPageInfo,
} from "../utils/extractionUtils";
import {
	formatOperationLog,
	createSuccessResponse,
	createTimingLog,
} from "../utils/resultUtils";
import { createErrorResponse } from "../utils/errorUtils";
import { executeExtraction } from "../utils/middlewares/extraction/extractMiddleware";
import type { IExtractOptions, IExtractResult } from "../utils/middlewares/extraction/extractMiddleware";

/**
 * Extended PageInfo interface with bodyText
 */
interface PageInfo {
	url: string;
	title: string;
	bodyText: string;
}

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
								displayName: "Extraction Property",
								name: "extractionProperty",
								type: "options",
								options: [
									{
										name: "Text Content",
										value: "textContent",
										description: "Extract text content from each element",
									},
									{
										name: "HTML",
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
										name: "Attribute",
										value: "attribute",
										description: "Extract a specific attribute from each element",
									},
								],
								default: "textContent",
								description: "What property to extract from each matched element",
							},
							{
								displayName: "Attribute Name",
								name: "attributeName",
								type: "string",
								default: "",
								placeholder: "href, src, data-ID",
								description:
									"Name of the attribute to extract (required when Extraction Property is set to Attribute)",
								displayOptions: {
									show: {
										extractionProperty: ["attribute"],
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
								displayName: "Extract Property",
								name: "extractProperty",
								type: "boolean",
								default: false,
								description:
									"Whether to extract the property as field/value format",
							},
							{
								displayName: "Property Key",
								name: "propertyKey",
								type: "string",
								default: "value",
								description:
									"The name of the property key (when extractProperty is enabled)",
								displayOptions: {
									show: {
										extractProperty: [true],
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
		displayName: "Use Human-like Delays",
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

		// --- START REFACTOR: Correctly get browser before getting page ---
		page = sessionResult.page; // Use page from result first
		if (!page) {
			// If page wasn't returned directly (e.g., existing session)
			const currentSession = SessionManager.getSession(sessionId);
			if (currentSession?.browser?.isConnected()) {
				page = await getActivePage(currentSession.browser, this.logger);
			} else {
				throw new Error(
					"Failed to get session or browser is disconnected after getOrCreatePageSession",
				);
			}
		}
		// --- END REFACTOR ---

		if (!page) {
			throw new Error("Failed to get or create a page");
		}

		// Debug page content if enabled
		if (debugPageContent) {
			try {
				const pageInfo = (await getPageInfo(page)) as PageInfo;
				this.logger.info(
					formatOperationLog(
						"Extract",
						nodeName,
						nodeId,
						index,
						`Page info: URL=${pageInfo.url}, title=${pageInfo.title}`,
					),
				);
				this.logger.info(
					formatOperationLog(
						"Extract",
						nodeName,
						nodeId,
						index,
						"Page body preview: " +
							pageInfo.bodyText.substring(0, 200) +
							"...",
					),
				);
			} catch (pageInfoError) {
				this.logger.warn(
					formatOperationLog(
						"Extract",
						nodeName,
						nodeId,
						index,
						`Error getting page info for debug: ${(pageInfoError as Error).message}`,
					),
				);
			}
		}

		// Add a human-like delay if enabled
		if (useHumanDelays) {
			const delay = getHumanDelay();
			this.logger.info(
				formatOperationLog(
					"Extract",
					nodeName,
					nodeId,
					index,
					`Adding human-like delay: ${delay}ms`,
				),
			);
			await new Promise((resolve) => setTimeout(resolve, delay));
		}

		// Initialize extraction results container
		let extractionResults: IDataObject = {};

		// Get all extraction items
		const extractionItems = this.getNodeParameter(
			"extractionItems.items",
			index,
			[],
		) as IDataObject[];

		if (!extractionItems.length) {
			throw new Error("No extraction items defined");
		}

		this.logger.info(
			formatOperationLog(
				"Extract",
				nodeName,
				nodeId,
				index,
				`Starting extraction operation with ${extractionItems.length} item(s)`,
			),
		);

		// Process each extraction item
		const extractionData: IDataObject = {};
		for (let i = 0; i < extractionItems.length; i++) {
			const item = extractionItems[i];
			const itemName = item.name as string;
			const extractionType = item.extractionType as string;
			const selector = item.selector as string;

			this.logger.info(
				formatOperationLog(
					"Extract",
					nodeName,
					nodeId,
					index,
					`Processing extraction item ${i+1}/${extractionItems.length}: ${itemName} (${extractionType}) with selector: ${selector}`,
				),
			);

			// Wait for the selector if needed
			if (waitForSelector) {
				this.logger.info(
					formatOperationLog(
						"Extract",
						nodeName,
						nodeId,
						index,
						`Waiting for selector: ${selector} (timeout: ${timeout}ms)`,
					),
				);
				try {
					await page.waitForSelector(selector, { timeout });
				} catch (error) {
					this.logger.error(
						formatOperationLog(
							"Extract",
							nodeName,
							nodeId,
							index,
							`Selector timeout for ${itemName}: ${selector} after ${timeout}ms`,
						),
					);
					// Continue with next item instead of throwing
					if (continueOnFail) {
						extractionData[itemName] = { error: `Selector not found: ${selector}` };
						continue;
					} else {
						throw error;
					}
				}
			}

			// Get extraction-specific parameters based on type
			let extractionParams: IDataObject = {};

			// Get parameters based on extraction type
			if (extractionType === "html") {
				const htmlOptions = (item.htmlOptions as IDataObject) || {};
				extractionParams = {
					outputFormat: (htmlOptions.outputFormat as string) || "html",
					includeMetadata: htmlOptions.includeMetadata === true,
				};
			} else if (extractionType === "attribute") {
				extractionParams = {
					attributeName: item.attributeName as string,
				};
			} else if (extractionType === "table") {
				const tableOptions = (item.tableOptions as IDataObject) || {};
				extractionParams = {
					includeHeaders: tableOptions.includeHeaders !== false,
					rowSelector: (tableOptions.rowSelector as string) || "tr",
					cellSelector: (tableOptions.cellSelector as string) || "td, th",
					outputFormat: (tableOptions.outputFormat as string) || "json",
				};
			} else if (extractionType === "multiple") {
				const multipleOptions = (item.multipleOptions as IDataObject) || {};
				extractionParams = {
					attributeName: (multipleOptions.attributeName as string) || "",
					extractionProperty: (multipleOptions.extractionProperty as string) || "textContent",
					limit: (multipleOptions.outputLimit as number) || 0,
					outputFormat: multipleOptions.extractProperty === true ? "object" : "array",
					separator: (multipleOptions.propertyKey as string) || "value",
				};
			}

			// Create extraction options
			const extractOptions: IExtractOptions = {
				extractionType,
				selector,
				waitForSelector: false, // We already waited above
				selectorTimeout: timeout,
				detectionMethod: "standard",
				earlyExitDelay: 500,
				nodeName,
				nodeId,
				index,
				...extractionParams,
			};

			try {
				// Execute extraction
				const extractResult = await executeExtraction(page, extractOptions, this.logger);

				if (extractResult.success) {
					const extractedData = extractResult.data;

					// Format the data for logging
					const logSafeData = formatExtractedDataForLog(extractedData, extractionType);

					this.logger.info(
						formatOperationLog(
							"Extract",
							nodeName,
							nodeId,
							index,
							`Extraction result for ${itemName} (${extractionType}): ${logSafeData}`,
						),
					);

					// Store result under the item name
					extractionData[itemName] = extractedData;
				} else {
					this.logger.error(
						formatOperationLog(
							"Extract",
							nodeName,
							nodeId,
							index,
							`Extraction failed for ${itemName}: ${extractResult.error?.message || "Unknown error"}`,
						),
					);

					if (continueOnFail) {
						extractionData[itemName] = { error: extractResult.error?.message || "Extraction failed" };
					} else {
						throw extractResult.error || new Error(`Extraction failed for item "${itemName}"`);
					}
				}
			} catch (error) {
				this.logger.error(
					formatOperationLog(
						"Extract",
						nodeName,
						nodeId,
						index,
						`Error processing extraction item ${itemName}: ${(error as Error).message}`,
					),
				);

				if (continueOnFail) {
					extractionData[itemName] = { error: (error as Error).message };
				} else {
					throw error;
				}
			}
		}

		// Store all extraction results
		extractionResults = {
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
				// --- START FIX: Use proper type casting ---
				(error as Error & { context: object }).context = {
					sessionId,
					errorResponse,
				};
				// --- END FIX ---
			}
			throw error;
		}

		// Return error as response with continue on fail
		return {
			json: errorResponse,
		};
	}
}
