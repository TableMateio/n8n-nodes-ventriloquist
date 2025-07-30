import {
	IDataObject,
	IExecuteFunctions,
	INodeExecutionData,
	INodeProperties,
	IWebhookResponseData,
	Logger as ILogger,
	INodeType
} from "n8n-workflow";
import type * as puppeteer from 'puppeteer-core';
import { SessionManager } from "../utils/sessionManager";
import { getActivePage as getActivePageFunc } from "../utils/sessionUtils";
import {
	formatOperationLog,
	createSuccessResponse,
	createTimingLog,
} from "../utils/resultUtils";
import { createErrorResponse } from "../utils/errorUtils";
import { logPageDebugInfo } from "../utils/debugUtils";
import { EntityMatcherFactory } from "../utils/middlewares/matching/entityMatcherFactory";
import {
	type IEntityMatchResult,
	type IEntityMatcherExtractionConfig,
	type IEntityMatcherComparisonConfig,
	type IEntityMatcherActionConfig,
	type ISourceEntity,
	type IEntityMatcherOutput,
	type IExtractedItem,
	type IExtractedField,
} from "../utils/middlewares/types/entityMatcherTypes";
import { ComparisonAlgorithm, IFieldComparisonConfig } from '../utils/comparisonUtils';
import { IBrowserSession } from '../utils/sessionManager';
import { EntityMatcherMiddleware } from '../utils/middlewares/matching/entityMatcherMiddleware';
import { IMiddlewareContext } from '../utils/middlewares/middleware';
import type { Page } from 'puppeteer-core';
import {
	smartWaitForSelector,
	detectElement,
	IDetectionOptions,
	IDetectionResult
} from '../utils/detectionUtils';
import { elementExists, transformUrl, isSupportedImageFormat } from '../utils/navigationUtils';
import { EntityMatcherComparisonMiddleware } from '../utils/middlewares/matching/entityMatcherComparisonMiddleware';
import {
	createEntityMatcher,
	type IEntityMatcherConfig
} from "../utils/middlewares/matching/entityMatcherFactory";
import { getHumanDelay } from "../utils/formOperations";

// Interface for container information
interface IContainerInfo {
	containerFound: boolean;
	tagName?: string;
	className?: string;
	childCount?: number;
	itemsFound?: number;
	suggestions?: any[];
	autoDetectEnabled?: boolean;
	documentState?: {
		readyState: DocumentReadyState;
		bodyChildCount: number;
	};
	availableClasses?: unknown[];
	listElements?: number;
	tables?: number;
	itemContainers?: number;
}

// Interface for collected item data
interface ICollectedItem {
	url?: string;
	title?: string;
	description?: string;
	imageUrl?: string;
	price?: string;
	metadata?: Record<string, any>;
	attributes?: Record<string, string>;
	uniqueSelector?: string;
	itemIndex?: number;
	pageNumber?: number;
	[key: string]: any;
}

// Interface for pagination state
interface IPaginationState {
	currentPage: number;
	totalPages?: number;
	hasNextPage: boolean;
	nextPageUrl?: string;
	lastPageDetected: boolean;
	// Track previously seen URLs to detect cycling
	visitedUrls: Set<string>;
	// Track consecutive pages with no new items
	consecutiveEmptyPages: number;
	// Count repeated URLs to detect cycling
	urlRepeatCount: Map<string, number>;
	// Maximum allowed URL repeats before detecting cycling
	maxUrlRepeats: number;
}

interface ICollectionResult {
	items: ICollectedItem[];
	itemsExtracted: number;
	itemsFiltered: number;
	debugInfo?: any;
}

/**
 * Collector operation description
 */
export const description: INodeProperties[] = [
	// ==================== 1. SESSION CONFIGURATION ====================
	{
		displayName: "Session ID",
		name: "explicitSessionId",
		type: "string",
		default: "",
		description:
			"Session ID to use (leave empty to use ID from input or create new)",
		displayOptions: {
			show: {
				operation: ["collector"],
			},
		},
	},

	// ==================== 2. ITEM SELECTION CONFIGURATION ====================
	{
		displayName: "Selection Method",
		name: "containerSelectionMethod",
		type: "options",
		options: [
			{
				name: "Container with auto-detected children",
				value: "containerItems",
				description: "Select a container element whose children will be auto-detected for collection",
			},
			{
				name: "Direct Items",
				value: "directItems",
				description: "Select items directly with a specific selector (no auto-detection)",
			},
		],
		default: "containerItems",
		required: true,
		description: "How to select elements to collect",
		displayOptions: {
			show: {
				operation: ["collector"],
			},
		},
	},
	{
		displayName: "Item Selector",
		name: "itemSelector",
		type: "string",
		default: "",
		placeholder: "ul.results, #search-results, table tbody, li, .result, tr",
		description: "CSS selector for items to collect. For 'Container with auto-detected children' mode: select the container element. For 'Direct Items' mode: select the items directly.",
		displayOptions: {
			show: {
				operation: ["collector"],
			},
		},
	},
	{
		displayName: "Maximum Items Per Page",
		name: "maxItemsPerPage",
		type: "number",
		typeOptions: {
			minValue: 1,
			maxValue: 1000,
		},
		default: 50,
		description: "Maximum number of items to collect per page",
		displayOptions: {
			show: {
				operation: ["collector"],
			},
		},
	},
	{
		displayName: "Maximum Total Items",
		name: "maxTotalItems",
		type: "number",
		typeOptions: {
			minValue: 1,
		},
		default: 200,
		description: "Maximum total number of items to collect across all pages",
		displayOptions: {
			show: {
				operation: ["collector"],
			},
		},
	},
	{
		displayName: "Wait For Selectors",
		name: "waitForSelectors",
		type: "boolean",
		default: true,
		description: "Wait for selectors to appear before processing",
		displayOptions: {
			show: {
				operation: ["collector"],
			},
		},
	},
	{
		displayName: "Timeout (ms)",
		name: "timeout",
		type: "number",
		default: 10000,
		description: "How long to wait for selectors in milliseconds",
		displayOptions: {
			show: {
				operation: ["collector"],
				waitForSelectors: [true],
			},
		},
	},

	// ==================== 3. ITEM EXTRACTION CONFIGURATION ====================
	{
		displayName: "Link Configuration",
		name: "linkConfiguration",
		type: "fixedCollection",
		default: {},
		placeholder: "Add Link Configuration",
		typeOptions: {
			multipleValues: false,
		},
		options: [
			{
				name: "values",
				displayName: "Link Configuration",
				values: [
					{
						displayName: "Link Selector",
						name: "linkSelector",
						type: "string",
						default: "a",
						placeholder: "a, a.product-link, .card a",
						description: "CSS selector for the link element within each item",
					},
					{
						displayName: "Link Attribute",
						name: "linkAttribute",
						type: "string",
						default: "href",
						description: "Attribute to extract from the link element (usually 'href')",
					},
					{
						displayName: "URL Transformation",
						name: "urlTransformation",
						type: "boolean",
						default: false,
						description: "Apply transformation to extracted URLs (useful for relative URLs)",
					},
					{
						displayName: "Transformation Type",
						name: "transformationType",
						type: "options",
						options: [
							{
								name: "Convert to Absolute URL",
								value: "absolute",
								description: "Convert relative URLs to absolute URLs based on current page",
							},
							{
								name: "Add Base Domain",
								value: "addDomain",
								description: "Add domain to URLs that start with '/'",
							},
							{
								name: "Custom Replacement",
								value: "replace",
								description: "Replace part of URL with another string",
							},
						],
						default: "absolute",
						description: "Type of URL transformation to apply",
						displayOptions: {
							show: {
								urlTransformation: [true],
							},
						},
					},
				],
			},
		],
		description: "Configure how to extract links from items",
		displayOptions: {
			show: {
				operation: ["collector"],
			},
		},
	},

	// ==================== 4. ADDITIONAL DATA FIELDS CONFIGURATION ====================
	{
		displayName: "Additional Data Fields",
		name: "additionalFields",
		type: "fixedCollection",
		typeOptions: {
			multipleValues: true,
			sortable: true,
		},
		default: {},
		placeholder: "Add Field",
		options: [
			{
				name: "fields",
				displayName: "Fields",
				values: [
					{
						displayName: "Field Name",
						name: "name",
						type: "string",
						default: "",
						placeholder: "title, price, description",
						description: "Name of the field to extract",
					},
					{
						displayName: "Field Selector",
						name: "selector",
						type: "string",
						default: "",
						placeholder: ".title, .price, span.description",
						description: "CSS selector for the field within each item",
					},
					{
						displayName: "Extraction Type",
						name: "extractionType",
						type: "options",
						options: [
							{
								name: "Text Content",
								value: "text",
								description: "Extract text content from the element",
							},
							{
								name: "Attribute",
								value: "attribute",
								description: "Extract a specific attribute from the element",
							},
							{
								name: "HTML",
								value: "html",
								description: "Extract HTML content from the element",
							},
							{
								name: "Image",
								value: "image",
								description: "Extract image data (URL and/or binary)",
							},
						],
						default: "text",
						description: "Type of data to extract",
					},
					{
						displayName: "Attribute Name",
						name: "attributeName",
						type: "string",
						default: "",
						placeholder: "src, data-id, alt",
						description: "Attribute name to extract when extraction type is 'attribute'",
						displayOptions: {
							show: {
								extractionType: ["attribute"],
							},
						},
					},
					{
						displayName: "Image Options",
						name: "imageOptions",
						type: "collection",
						placeholder: "Add Option",
						default: {},
						typeOptions: {
							multipleValues: false,
						},
						displayOptions: {
							show: {
								extractionType: ["image"],
							},
						},
						options: [
							{
								displayName: "Extraction Mode",
								name: "extractionMode",
								type: "options",
								options: [
									{
										name: "URL Only",
										value: "url",
										description: "Extract only the image URL",
									},
									{
										name: "Binary Data",
										value: "binary",
										description: "Download and extract image binary data",
									},
									{
										name: "Both",
										value: "both",
										description: "Extract both URL and binary data",
									},
								],
								default: "url",
								description: "What type of image data to extract",
							},
							{
								displayName: "Source Attribute",
								name: "sourceAttribute",
								type: "string",
								default: "src",
								placeholder: "src, data-src, data-original",
								description: "HTML attribute containing the image URL",
							},
							{
								displayName: "URL Transformation",
								name: "urlTransformation",
								type: "boolean",
								default: true,
								description: "Whether to transform relative URLs to absolute URLs",
							},
							{
								displayName: "Transformation Type",
								name: "transformationType",
								type: "options",
								options: [
									{
										name: "Convert to Absolute URL",
										value: "absolute",
										description: "Convert relative URLs to absolute URLs using current page",
									},
									{
										name: "Add Base Domain",
										value: "addDomain",
										description: "Add the base domain to URLs that start with /",
									},
									{
										name: "Custom String Replacement",
										value: "custom",
										description: "Replace part of the URL with custom text",
									},
								],
								default: "absolute",
								description: "How to transform URLs",
								displayOptions: {
									show: {
										urlTransformation: [true],
									},
								},
							},
							{
								displayName: "Replace From",
								name: "replaceFrom",
								type: "string",
								default: "",
								placeholder: "text to replace",
								description: "Text to replace in URL (for custom transformation)",
								displayOptions: {
									show: {
										transformationType: ["custom"],
									},
								},
							},
							{
								displayName: "Replace To",
								name: "replaceTo",
								type: "string",
								default: "",
								placeholder: "replacement text",
								description: "Replacement text (for custom transformation)",
								displayOptions: {
									show: {
										transformationType: ["custom"],
									},
								},
							},
							{
								displayName: "Format Checking",
								name: "formatChecking",
								type: "boolean",
								default: false,
								description: "Whether to check file formats before extraction (enable for stricter validation of static image files)",
							},
							{
								displayName: "Supported Formats",
								name: "supportedFormats",
								type: "multiOptions",
								options: [
									{
										name: "JPEG/JPG",
										value: "jpg",
									},
									{
										name: "PNG",
										value: "png",
									},
									{
										name: "GIF",
										value: "gif",
									},
									{
										name: "WebP",
										value: "webp",
									},
									{
										name: "SVG",
										value: "svg",
									},
									{
										name: "PDF",
										value: "pdf",
									},
									{
										name: "BMP",
										value: "bmp",
									},
									{
										name: "TIFF",
										value: "tiff",
									},
								],
								default: ["jpg", "png", "gif", "webp"],
								description: "File formats to extract (others will be ignored)",
								displayOptions: {
									show: {
										formatChecking: [true],
									},
								},
							},
							{
								displayName: "Download Timeout",
								name: "downloadTimeout",
								type: "number",
								default: 30000,
								description: "Maximum time to wait for image download in milliseconds",
								displayOptions: {
									show: {
										extractionMode: ["binary", "both"],
									},
								},
							},
						],
					},
				],
			},
		],
		description: "Additional data fields to extract from each item",
		displayOptions: {
			show: {
				operation: ["collector"],
			},
		},
	},

	// ==================== 5. FILTER CONFIGURATION ====================
	{
		displayName: "Filter Items",
		name: "filterItems",
		type: "boolean",
		default: false,
		description: "Whether to filter items based on criteria",
		displayOptions: {
			show: {
				operation: ["collector"],
			},
		},
	},
	{
		displayName: "Filter Criteria",
		name: "filterCriteria",
		type: "fixedCollection",
		typeOptions: {
			multipleValues: true,
			sortable: true,
		},
		default: {},
		placeholder: "Add Filter",
		options: [
			{
				name: "criteria",
				displayName: "Criteria",
				values: [
					{
						displayName: "Field Selector",
						name: "selector",
						type: "string",
						default: "",
						placeholder: ".price, .status",
						description: "CSS selector for the element to check within each item",
					},
					{
						displayName: "Field Name",
						name: "fieldName",
						type: "string",
						default: "",
						placeholder: "Location, Price, Title",
						description: "Name of the field to filter on (must match the name of an extracted field)",
					},
					{
						displayName: "Filter Type",
						name: "extractionType",
						type: "options",
						options: [
							{
								name: "Text Content",
								value: "text",
								description: "Check text content of the element",
							},
							{
								name: "Attribute",
								value: "attribute",
								description: "Check a specific attribute of the element",
							},
							{
								name: "Element Exists",
								value: "exists",
								description: "Check if the element exists",
							},
						],
						default: "text",
						description: "Type of check to perform",
					},
					{
						displayName: "Attribute Name",
						name: "attributeName",
						type: "string",
						default: "",
						placeholder: "class, data-status",
						description: "Attribute name to check when extraction type is 'attribute'",
						displayOptions: {
							show: {
								extractionType: ["attribute"],
							},
						},
					},
					{
						displayName: "Condition",
						name: "condition",
						type: "options",
						options: [
							{
								name: "Contains",
								value: "contains",
								description: "Check if the value contains the specified text",
							},
							{
								name: "Not Contains",
								value: "notContains",
								description: "Check if the value does not contain the specified text",
							},
							{
								name: "Equals",
								value: "equals",
								description: "Check if the value equals the specified text",
							},
							{
								name: "Starts With",
								value: "startsWith",
								description: "Check if the value starts with the specified text",
							},
							{
								name: "Ends With",
								value: "endsWith",
								description: "Check if the value ends with the specified text",
							},
							{
								name: "Matches Regex",
								value: "regex",
								description: "Check if the value matches the specified regex pattern",
							},
							{
								name: "Exists",
								value: "exists",
								description: "Check if the element exists",
							},
							{
								name: "Not Exists",
								value: "notExists",
								description: "Check if the element does not exist",
							},
						],
						default: "contains",
						description: "Condition to check",
						displayOptions: {
							hide: {
								extractionType: ["exists"],
							},
						},
					},
					{
						displayName: "Condition",
						name: "condition",
						type: "options",
						options: [
							{
								name: "Exists",
								value: "exists",
								description: "Check if the element exists",
							},
							{
								name: "Not Exists",
								value: "notExists",
								description: "Check if the element does not exist",
							},
						],
						default: "exists",
						description: "Condition to check",
						displayOptions: {
							show: {
								extractionType: ["exists"],
							},
						},
					},
					{
						displayName: "Value",
						name: "value",
						type: "string",
						default: "",
						placeholder: "SOLD or /\\w+\\.bad/i or VALUE1,VALUE2",
						description: "Value to compare against. Supports: • Simple text: 'SOLD' • Comma-separated: 'REMOVED,SOLD,EXPIRED' • Regex patterns: '/pattern/flags' (e.g., '/\\w+/i' for case-insensitive word matching)",
						displayOptions: {
							hide: {
								condition: ["exists", "notExists"],
								extractionType: ["exists"],
							},
						},
					},
					{
						displayName: "Case Sensitive",
						name: "caseSensitive",
						type: "boolean",
						default: false,
						description: "Whether the comparison should be case sensitive",
						displayOptions: {
							hide: {
								condition: ["exists", "notExists", "regex"],
								extractionType: ["exists"],
							},
						},
					},
				],
			},
		],
		description: "Criteria to filter items",
		displayOptions: {
			show: {
				operation: ["collector"],
				filterItems: [true],
			},
		},
	},
	{
		displayName: "Filter Logic",
		name: "filterLogic",
		type: "options",
		options: [
			{
				name: "Match All Criteria (AND)",
				value: "and",
				description: "Item must match all criteria to be included",
			},
			{
				name: "Match Any Criterion (OR)",
				value: "or",
				description: "Item must match at least one criterion to be included",
			},
		],
		default: "and",
		description: "Logic to apply when multiple filter criteria are specified",
		displayOptions: {
			show: {
				operation: ["collector"],
				filterItems: [true],
			},
		},
	},

	// ==================== 6. PAGINATION CONFIGURATION ====================
	{
		displayName: "Enable Pagination",
		name: "enablePagination",
		type: "boolean",
		default: false,
		description: "Whether to collect items across multiple pages",
		displayOptions: {
			show: {
				operation: ["collector"],
			},
		},
	},
	{
		displayName: "Pagination Strategy",
		name: "paginationStrategy",
		type: "options",
		options: [
			{
				name: "Click Next Button",
				value: "clickNext",
				description: "Click on a 'Next' button or link to navigate to the next page",
			},
			{
				name: "URL Pattern",
				value: "urlPattern",
				description: "Navigate to URLs following a pattern (e.g., page=1, page=2)",
			},
		],
		default: "clickNext",
		description: "Method to use for paginating through results",
		displayOptions: {
			show: {
				operation: ["collector"],
				enablePagination: [true],
			},
		},
	},
	{
		displayName: "Next Page Selector",
		name: "nextPageSelector",
		type: "string",
		default: "",
		placeholder: "a.next, button.pagination-next",
		description: "CSS selector for the next page button or link",
		displayOptions: {
			show: {
				operation: ["collector"],
				enablePagination: [true],
				paginationStrategy: ["clickNext"],
			},
		},
	},
	{
		displayName: "URL Pattern",
		name: "urlPattern",
		type: "string",
		default: "",
		placeholder: "https://example.com/search?page={page}",
		description: "URL pattern for pagination (use {page} as placeholder for page number)",
		displayOptions: {
			show: {
				operation: ["collector"],
				enablePagination: [true],
				paginationStrategy: ["urlPattern"],
			},
		},
	},
	{
		displayName: "Start Page",
		name: "startPage",
		type: "number",
		default: 1,
		description: "Page number to start from",
		displayOptions: {
			show: {
				operation: ["collector"],
				enablePagination: [true],
				paginationStrategy: ["urlPattern"],
			},
		},
	},
	{
		displayName: "Maximum Pages",
		name: "maxPages",
		type: "number",
		default: 5,
		description: "Maximum number of pages to process",
		displayOptions: {
			show: {
				operation: ["collector"],
				enablePagination: [true],
			},
		},
	},
	{
		displayName: "Last Page Detection",
		name: "lastPageDetection",
		type: "options",
		options: [
			{
				name: "None (Use Max Pages Only)",
				value: "none",
				description: "Only use the maximum pages setting to stop pagination",
			},
			{
				name: "Next Button Missing/Disabled",
				value: "buttonMissing",
				description: "Stop when the next button is missing or disabled",
			},
			{
				name: "Custom Selector Present",
				value: "selectorPresent",
				description: "Stop when a specific element is present on the page",
			},
			{
				name: "No More Results",
				value: "noResults",
				description: "Stop when no more results are found on the page",
			},
			{
				name: "Detect Page Cycling",
				value: "detectCycling",
				description: "Stop when the same pages are being visited repeatedly (prevents infinite loops)",
			},
			{
				name: "Detect Disabled Button State",
				value: "disabledState",
				description: "Stop when the next button has disabled attributes or classes",
			},
		],
		default: "buttonMissing",
		description: "Method to detect when there are no more pages",
		displayOptions: {
			show: {
				operation: ["collector"],
				enablePagination: [true],
			},
		},
	},
	{
		displayName: "Last Page Selector",
		name: "lastPageSelector",
		type: "string",
		default: "",
		placeholder: ".no-more-results, .last-page",
		description: "CSS selector that indicates the last page has been reached",
		displayOptions: {
			show: {
				operation: ["collector"],
				enablePagination: [true],
				lastPageDetection: ["selectorPresent"],
			},
		},
	},
	{
		displayName: "Wait After Pagination",
		name: "waitAfterPagination",
		type: "boolean",
		default: true,
		description: "Whether to wait after navigating to a new page",
		displayOptions: {
			show: {
				operation: ["collector"],
				enablePagination: [true],
			},
		},
	},
	{
		displayName: "Wait Time After Pagination (ms)",
		name: "waitTimeAfterPagination",
		type: "number",
		default: 2000,
		description: "Time to wait after pagination in milliseconds",
		displayOptions: {
			show: {
				operation: ["collector"],
				enablePagination: [true],
				waitAfterPagination: [true],
			},
		},
	},

	// ==================== 7. ADVANCED OPTIONS ====================
	{
		displayName: "Use Human-Like Delays",
		name: "useHumanDelays",
		type: "boolean",
		default: true,
		description: "Whether to use random delays between actions to simulate human behavior",
		displayOptions: {
			show: {
				operation: ["collector"],
			},
		},
	},
	{
		displayName: "Take Screenshot",
		name: "takeScreenshot",
		type: "boolean",
		default: false,
		description: "Whether to take a screenshot after collection (useful for debugging)",
		displayOptions: {
			show: {
				operation: ["collector"],
			},
		},
	},
	{
		displayName: "Debug Mode",
		name: "debugMode",
		type: "boolean",
		default: false,
		description: "Whether to enable debug logging",
		displayOptions: {
			show: {
				operation: ["collector"],
			},
		},
	},
	{
		displayName: "Continue On Fail",
		name: "continueOnFail",
		type: "boolean",
		default: true,
		description: "Whether to continue execution even when errors occur",
		displayOptions: {
			show: {
				operation: ["collector"],
			},
		},
	},
	{
		displayName: "Disabled Button Detection",
		name: "disabledButtonConfig",
		type: "fixedCollection",
		default: {},
		placeholder: "Add Disabled Button Detection Configuration",
		typeOptions: {
			multipleValues: false,
		},
		options: [
			{
				name: "values",
				displayName: "Disabled Button Configuration",
				values: [
					{
						displayName: "Disabled Classes",
						name: "disabledClasses",
						type: "string",
						default: "disabled,disable,inactive",
						description: "Comma-separated list of class names that indicate a disabled button",
					},
					{
						displayName: "Disabled Attributes",
						name: "disabledAttributes",
						type: "string",
						default: "disabled,aria-disabled",
						description: "Comma-separated list of attributes that indicate a disabled button",
					},
					{
						displayName: "Check Button Text",
						name: "checkButtonText",
						type: "boolean",
						default: false,
						description: "Check if the button text changes (e.g., 'Next' to 'Last Page')",
					},
				],
			},
		],
		description: "Configure how to detect when a pagination button is disabled",
		displayOptions: {
			show: {
				operation: ["collector"],
				enablePagination: [true],
				lastPageDetection: ["disabledState"],
			},
		},
	},
	{
		displayName: "Output Input Data",
		name: "outputInputData",
		type: "boolean",
		default: true,
		description: "Whether to include the input data in the output",
		displayOptions: {
			show: {
				operation: ["collector"],
			},
		},
	},
];

/**
 * Execute the collector operation
 */
export async function execute(
	this: IExecuteFunctions,
	index: number,
	workflowId: string,
	websocketEndpoint: string,
): Promise<INodeExecutionData[]> {
	// Get operation start time for performance logging
	const startTime = Date.now();
	const items = this.getInputData();
	let sessionId = "";
	let page: puppeteer.Page | null = null;

	// Added for better logging
	const nodeName = this.getNode().name;
	const nodeId = this.getNode().id;
	const collectedItems: ICollectedItem[] = [];
	let paginationState: IPaginationState = {
		currentPage: 1,
		hasNextPage: false,
		lastPageDetected: false,
		visitedUrls: new Set<string>(),
		consecutiveEmptyPages: 0,
		urlRepeatCount: new Map<string, number>(),
		maxUrlRepeats: 2 // Allow each URL to be seen maximum 2 times before flagging as cycling
	};

		// Track filtering statistics
	let totalItemsExtracted = 0;
	let totalItemsFiltered = 0;

	// Track debug information for output
	let debugInfo: any = null;

	// Visual marker to clearly indicate a new node is starting
	this.logger.info(`${'='.repeat(40)}`);
	this.logger.info(`[Ventriloquist][${nodeName}#${index}][Collector] Starting operation`);

	// Get common parameters (moved outside try block so they're accessible in catch)
	const waitForSelectors = this.getNodeParameter('waitForSelectors', index, true) as boolean;
	const timeout = this.getNodeParameter('timeout', index, 10000) as number;
	const useHumanDelays = this.getNodeParameter('useHumanDelays', index, true) as boolean;
	const debugMode = this.getNodeParameter('debugMode', index, false) as boolean;
	const explicitSessionId = this.getNodeParameter('explicitSessionId', index, '') as string;
	const maxItemsPerPage = this.getNodeParameter('maxItemsPerPage', index, 50) as number;
	const maxTotalItems = this.getNodeParameter('maxTotalItems', index, 200) as number;
	const takeScreenshotOption = this.getNodeParameter('takeScreenshot', index, false) as boolean;
	const selectionMethod = this.getNodeParameter('containerSelectionMethod', index, 'containerItems') as string;
	const outputInputData = this.getNodeParameter('outputInputData', index, true) as boolean;

	try {

		// Get session information from input if available
		let sessionIdFromInput = '';
		if (items[index]?.json?.sessionId) {
			sessionIdFromInput = items[index].json.sessionId as string;
		}

		// Use the provided ID, or the one from input, or generate a new one
		sessionId = explicitSessionId || sessionIdFromInput || '';

		// Initialize session
		this.logger.info(
			formatOperationLog(
				'Collector',
				nodeName,
				nodeId,
				index,
				`Using session ID: ${sessionId || 'new session'}`
			)
		);

		// Use the centralized session management
		const sessionResult = await SessionManager.getOrCreatePageSession(
			this.logger,
			{
				explicitSessionId: sessionId,
				websocketEndpoint,
				workflowId,
				operationName: 'Collector',
				nodeId,
				nodeName,
				index,
			}
		);

		// Get the page and session ID
		page = sessionResult.page;
		sessionId = sessionResult.sessionId;

		if (!page) {
			throw new Error('Failed to get or create a page');
		}

		// Get current URL
		const currentUrl = await page.url();
		this.logger.info(
			formatOperationLog(
				'Collector',
				nodeName,
				nodeId,
				index,
				`Current page URL: ${currentUrl}`
			)
		);

		// Debug page content if enabled
		if (debugMode) {
			await logPageDebugInfo(
				page,
				this.logger,
				{
					operation: 'Collector',
					nodeName,
					nodeId,
					index,
				},
				{
					debugMode
				}
			);
		}

		// Get pagination configuration
		let enablePagination = this.getNodeParameter('enablePagination', index, false) as boolean;
		let maxPages = 1;
		let paginationStrategy = '';
		let nextPageSelector = '';
		let urlPattern = '';
		let startPage = 1;
		let lastPageDetection = '';
		let lastPageSelector = '';
		let waitAfterPagination = false;
		let waitTimeAfterPagination = 2000;
		let disabledButtonConfig: IDataObject = {};

		if (enablePagination) {
			paginationStrategy = this.getNodeParameter('paginationStrategy', index, 'clickNext') as string;
			maxPages = this.getNodeParameter('maxPages', index, 5) as number;
			lastPageDetection = this.getNodeParameter('lastPageDetection', index, 'buttonMissing') as string;
			waitAfterPagination = this.getNodeParameter('waitAfterPagination', index, true) as boolean;

			if (waitAfterPagination) {
				waitTimeAfterPagination = this.getNodeParameter('waitTimeAfterPagination', index, 2000) as number;
			}

			if (paginationStrategy === 'clickNext') {
				nextPageSelector = this.getNodeParameter('nextPageSelector', index, '') as string;
				// If next page selector is empty or just whitespace, disable pagination
				if (!nextPageSelector || nextPageSelector.trim() === '') {
					this.logger.info(
						formatOperationLog(
							'Collector',
							nodeName,
							nodeId,
							index,
							'Next page selector is empty - disabling pagination'
						)
					);
					enablePagination = false;
				}
			} else if (paginationStrategy === 'urlPattern') {
				urlPattern = this.getNodeParameter('urlPattern', index, '') as string;
				startPage = this.getNodeParameter('startPage', index, 1) as number;
				paginationState.currentPage = startPage;
				// If URL pattern is empty or just whitespace, disable pagination
				if (!urlPattern || urlPattern.trim() === '') {
					this.logger.info(
						formatOperationLog(
							'Collector',
							nodeName,
							nodeId,
							index,
							'URL pattern is empty - disabling pagination'
						)
					);
					enablePagination = false;
				}
			}

			if (lastPageDetection === 'selectorPresent') {
				lastPageSelector = this.getNodeParameter('lastPageSelector', index, '') as string;
			} else if (lastPageDetection === 'disabledState') {
				disabledButtonConfig = this.getNodeParameter('disabledButtonConfig.values', index, {}) as IDataObject;
			}
		}

		// Debug mode: Validate pagination selectors
		if (debugMode && enablePagination) {
			this.logger.info(
				formatOperationLog(
					'Collector',
					nodeName,
					nodeId,
					index,
					`🔄 PAGINATION SELECTOR VALIDATION:`
				)
			);

			if (paginationStrategy === 'clickNext' && nextPageSelector) {
				// Check if next page selector exists
				const nextPageValidation = await page.evaluate((selector: string) => {
					const elements = document.querySelectorAll(selector);
					const result = {
						selector,
						found: elements.length > 0,
						count: elements.length,
						isDisabled: false,
						buttonText: '',
						attributes: {} as Record<string, string>
					};

					if (elements.length > 0) {
						const firstElement = elements[0] as HTMLElement;
						result.isDisabled = firstElement.hasAttribute('disabled') ||
							firstElement.classList.contains('disabled') ||
							firstElement.classList.contains('disable');
						result.buttonText = firstElement.textContent?.trim() || '';

						// Capture some key attributes
						for (let i = 0; i < firstElement.attributes.length; i++) {
							const attr = firstElement.attributes[i];
							if (['class', 'disabled', 'aria-disabled', 'href'].includes(attr.name)) {
								result.attributes[attr.name] = attr.value;
							}
						}
					}

					return result;
				}, nextPageSelector);

				const nextPageStatus = nextPageValidation.found ? '✅' : '❌';
				const disabledText = nextPageValidation.isDisabled ? ' (DISABLED)' : '';
				this.logger.info(
					formatOperationLog(
						'Collector',
						nodeName,
						nodeId,
						index,
						`${nextPageStatus} Next Page: "${nextPageValidation.selector}" → ${nextPageValidation.count} elements found${disabledText}`
					)
				);

				if (nextPageValidation.found && debugMode) {
					this.logger.info(
						formatOperationLog(
							'Collector',
							nodeName,
							nodeId,
							index,
							`   Text: "${nextPageValidation.buttonText}" | Attributes: ${JSON.stringify(nextPageValidation.attributes)}`
						)
					);
				}
			}

			if (lastPageDetection === 'selectorPresent' && lastPageSelector) {
				// Check if last page indicator exists
				const lastPageValidation = await page.evaluate((selector: string) => {
					const elements = document.querySelectorAll(selector);
					return {
						selector,
						found: elements.length > 0,
						count: elements.length,
						sampleText: elements.length > 0 ? elements[0].textContent?.substring(0, 50) : null
					};
				}, lastPageSelector);

				const lastPageStatus = lastPageValidation.found ? '✅' : '❌';
				this.logger.info(
					formatOperationLog(
						'Collector',
						nodeName,
						nodeId,
						index,
						`${lastPageStatus} Last Page Indicator: "${lastPageValidation.selector}" → ${lastPageValidation.count} elements found`
					)
				);
			}
		}

		// Store information about the next button for comparison between pages
		let previousButtonState: { classes: string, attributes: Record<string, string>, text: string } | null = null;

		// Initialize pagination state
		paginationState = {
			currentPage: startPage,
			totalPages: maxPages,
			hasNextPage: enablePagination,
			lastPageDetected: false,
			visitedUrls: new Set<string>(),
			consecutiveEmptyPages: 0,
			urlRepeatCount: new Map<string, number>(),
			maxUrlRepeats: 2 // Allow each URL to be seen maximum 2 times before flagging as cycling
		};

		// Process pages until we reach the maximum or detect the last page
		do {
			// Log current page
			this.logger.info(
				formatOperationLog(
					'Collector',
					nodeName,
					nodeId,
					index,
					`Processing page ${paginationState.currentPage} of ${maxPages} max pages`
				)
			);

			// Wait for content to load
			if (waitForSelectors) {
				let selectorToWaitFor = '';

				if (selectionMethod === 'containerItems' || selectionMethod === 'directItems') {
					selectorToWaitFor = this.getNodeParameter('itemSelector', index, '') as string;
				}

				if (selectorToWaitFor) {
					this.logger.info(
						formatOperationLog(
							'Collector',
							nodeName,
							nodeId,
							index,
							`Waiting for selector: ${selectorToWaitFor}`
						)
					);

					try {
						await page.waitForSelector(selectorToWaitFor, { timeout });
					} catch (error) {
						this.logger.warn(
							formatOperationLog(
								'Collector',
								nodeName,
								nodeId,
								index,
								`Timeout waiting for selector: ${selectorToWaitFor}`
							)
						);

						// If this is the first page and we can't find the selector, it's an error
						if (paginationState.currentPage === startPage) {
							throw new Error(`Selector not found: ${selectorToWaitFor}`);
						} else {
							// Otherwise, we've probably reached the end of pagination
							paginationState.lastPageDetected = true;
							break;
						}
					}
				}
			}

			// Collect items from the current page
			const pageResult = await collectItemsFromPage.call(
				this,
				page,
				{
					selectionMethod,
					containerSelector: '', // This is deprecated, we'll use itemSelector for both cases
					itemSelector: this.getNodeParameter('itemSelector', index, '') as string,
					maxItems: maxItemsPerPage,
					pageNumber: paginationState.currentPage,
					linkConfig: (this.getNodeParameter('linkConfiguration.values', index, {}) as IDataObject) || {},
					additionalFields: (this.getNodeParameter('additionalFields.fields', index, []) as IDataObject[]) || [],
					filterItems: this.getNodeParameter('filterItems', index, false) as boolean,
					filterCriteria: this.getNodeParameter('filterCriteria.criteria', index, []) as IDataObject[],
					filterLogic: this.getNodeParameter('filterLogic', index, 'and') as string,
					useHumanDelays,
					debugMode
				},
				nodeName,
				nodeId,
				index
			);

			// Extract items and update statistics
			const pageItems = pageResult.items;
			totalItemsExtracted += pageResult.itemsExtracted;
			totalItemsFiltered += pageResult.itemsFiltered;

			// Capture debug info from first page (if available)
			if (!debugInfo && pageResult.debugInfo) {
				debugInfo = pageResult.debugInfo;
			}

			// Add items from this page to our collection
			collectedItems.push(...pageItems);

						// Debug mode: Log each collected item with complete extracted data
			if (debugMode && pageItems.length > 0) {
				this.logger.info(
					formatOperationLog(
						'Collector',
						nodeName,
						nodeId,
						index,
						`🎯 EXTRACTED DATA FOR COLLECTED ITEMS FROM PAGE ${paginationState.currentPage}:`
					)
				);

				pageItems.forEach((item, itemIndex) => {
					this.logger.info(
						formatOperationLog(
							'Collector',
							nodeName,
							nodeId,
							index,
							`\n📦 COLLECTED ITEM ${itemIndex + 1} EXTRACTED DATA:\n${JSON.stringify(item, null, 2)}\n${'-'.repeat(60)}`
						)
					);
				});
			}

			this.logger.info(
				formatOperationLog(
					'Collector',
					nodeName,
					nodeId,
					index,
					`Collected ${pageItems.length} items from page ${paginationState.currentPage}, total: ${collectedItems.length}`
				)
			);

			// Check if we've collected enough items
			if (collectedItems.length >= maxTotalItems) {
				this.logger.info(
					formatOperationLog(
						'Collector',
						nodeName,
						nodeId,
						index,
						`Reached maximum total items (${maxTotalItems}), stopping pagination`
					)
				);

				// Trim the collection to the exact maxTotalItems
				if (collectedItems.length > maxTotalItems) {
					collectedItems.length = maxTotalItems;
					this.logger.info(
						formatOperationLog(
							'Collector',
							nodeName,
							nodeId,
							index,
							`Trimmed collection to exactly ${maxTotalItems} items`
						)
					);
				}

				break;
			}

			// Check if we've reached the last page
			if (enablePagination && paginationState.currentPage < maxPages) {
				// Get current URL for all detection methods
				const currentUrl = await page.url();

				// Track the current URL visit for all detection methods
				const repeatCount = paginationState.urlRepeatCount.get(currentUrl) || 0;
				const newRepeatCount = repeatCount + 1;
				paginationState.urlRepeatCount.set(currentUrl, newRepeatCount);
				paginationState.visitedUrls.add(currentUrl);

				// Check for last page indicators
				if (lastPageDetection === 'buttonMissing' && paginationStrategy === 'clickNext') {
					// Skip check if nextPageSelector is empty (should have been caught earlier)
					if (!nextPageSelector || nextPageSelector.trim() === '') {
						this.logger.info(
							formatOperationLog(
								'Collector',
								nodeName,
								nodeId,
								index,
								'Next page selector is empty - treating as last page reached'
							)
						);
						paginationState.lastPageDetected = true;
						break;
					}

					const nextButtonExists = await elementExists(page, nextPageSelector);
					if (!nextButtonExists) {
						this.logger.info(
							formatOperationLog(
								'Collector',
								nodeName,
								nodeId,
								index,
								`Next button not found (${nextPageSelector}), reached last page`
							)
						);
						paginationState.lastPageDetected = true;
						break;
					}
				} else if (lastPageDetection === 'disabledState' && paginationStrategy === 'clickNext') {
					// Skip check if nextPageSelector is empty (should have been caught earlier)
					if (!nextPageSelector || nextPageSelector.trim() === '') {
						this.logger.info(
							formatOperationLog(
								'Collector',
								nodeName,
								nodeId,
								index,
								'Next page selector is empty - treating as last page reached'
							)
						);
						paginationState.lastPageDetected = true;
						break;
					}

					// Enhanced detection of disabled button states
					const disabledClasses = ((disabledButtonConfig.disabledClasses as string) || 'disabled,disable,inactive').split(',').map(c => c.trim());
					const disabledAttributes = ((disabledButtonConfig.disabledAttributes as string) || 'disabled,aria-disabled').split(',').map(a => a.trim());
					const checkButtonText = disabledButtonConfig.checkButtonText as boolean || false;

					// Get current button state
					const currentButtonState = await page.evaluate(
						(params: {
							selector: string;
							disabledClasses: string[];
							disabledAttributes: string[];
							checkButtonText: boolean;
						}) => {
							const button = document.querySelector(params.selector);
							if (!button) return null;

							// Check for disabled classes
							const classList = Array.from(button.classList);
							const hasDisabledClass = classList.some(cls =>
								params.disabledClasses.some(disabledCls =>
									cls.toLowerCase().includes(disabledCls.toLowerCase())
								)
							);

							// Check for disabled attributes
							const attributes: Record<string, string> = {};
							let hasDisabledAttribute = false;

							for (const attr of Array.from(button.attributes)) {
								attributes[attr.name] = attr.value;

								// Check if this is a disabled attribute
								if (params.disabledAttributes.some(a => attr.name.toLowerCase() === a.toLowerCase())) {
									if (attr.value === '' || attr.value === 'true') {
										hasDisabledAttribute = true;
									}
								}

								// Check if any attribute contains "disabled" in its value
								if (attr.value.toLowerCase().includes('disabled') ||
									attr.value.toLowerCase().includes('disable')) {
									hasDisabledAttribute = true;
								}
							}

							// Get button text if needed
							const buttonText = params.checkButtonText ? button.textContent || '' : '';

							return {
								classes: classList.join(' '),
								attributes,
								text: buttonText,
								hasDisabledClass,
								hasDisabledAttribute,
								isDisabled: hasDisabledClass || hasDisabledAttribute,
							};
						},
						{
							selector: nextPageSelector,
							disabledClasses,
							disabledAttributes,
							checkButtonText
						}
					);

					if (currentButtonState) {
						if (currentButtonState.isDisabled) {
							this.logger.info(
								formatOperationLog(
									'Collector',
									nodeName,
									nodeId,
									index,
									`Next button (${nextPageSelector}) is disabled, reached last page`
								)
							);
							paginationState.lastPageDetected = true;
							break;
						}

						// Compare with previous button state if we have one
						if (previousButtonState && checkButtonText) {
							// Check if the button text has changed significantly
							if (previousButtonState.text !== currentButtonState.text &&
								previousButtonState.text.trim() !== '' &&
								currentButtonState.text.trim() !== '') {
								this.logger.info(
									formatOperationLog(
										'Collector',
										nodeName,
										nodeId,
										index,
										`Next button text changed from "${previousButtonState.text}" to "${currentButtonState.text}", might indicate last page`
									)
								);
							}

							// Advanced detection: check if ng-class or similar directives have added disabled classes
							// This specifically targets the example you provided with ng-class="{disable: nextPageDisabled()}"
							const previousClassList = previousButtonState.classes.split(' ');
							const currentClassList = currentButtonState.classes.split(' ');

							// Check if a disabled class was added
							const newClasses = currentClassList.filter(cls => !previousClassList.includes(cls));
							const disabledClassAdded = newClasses.some(cls =>
								disabledClasses.some(disabledCls => cls.toLowerCase().includes(disabledCls.toLowerCase()))
							);

							if (disabledClassAdded) {
								this.logger.info(
									formatOperationLog(
										'Collector',
										nodeName,
										nodeId,
										index,
										`Next button has new disabled class added: ${newClasses.join(', ')}, reached last page`
									)
								);
								paginationState.lastPageDetected = true;
								break;
							}
						}

						// Store current state for next comparison
						previousButtonState = {
							classes: currentButtonState.classes,
							attributes: currentButtonState.attributes,
							text: currentButtonState.text
						};
					} else {
						// Button not found
						this.logger.info(
							formatOperationLog(
								'Collector',
								nodeName,
								nodeId,
								index,
								`Next button not found (${nextPageSelector}), reached last page`
							)
						);
						paginationState.lastPageDetected = true;
						break;
					}
				} else if (lastPageDetection === 'selectorPresent') {
					const lastPageIndicatorExists = await elementExists(page, lastPageSelector);
					if (lastPageIndicatorExists) {
						this.logger.info(
							formatOperationLog(
								'Collector',
								nodeName,
								nodeId,
								index,
								`Last page indicator found (${lastPageSelector}), reached last page`
							)
						);
						paginationState.lastPageDetected = true;
						break;
					}
				} else if (lastPageDetection === 'noResults' && pageItems.length === 0) {
					// Increment consecutive empty pages counter
					paginationState.consecutiveEmptyPages += 1;

					// If we've seen 2 consecutive empty pages, stop pagination
					if (paginationState.consecutiveEmptyPages >= 2) {
						this.logger.info(
							formatOperationLog(
								'Collector',
								nodeName,
								nodeId,
								index,
								`No items found on ${paginationState.consecutiveEmptyPages} consecutive pages, reached last page`
							)
						);
						paginationState.lastPageDetected = true;
						break;
					}

					this.logger.info(
						formatOperationLog(
							'Collector',
							nodeName,
							nodeId,
							index,
							`No items found on current page, but continuing to check more pages`
						)
					);
				} else if (lastPageDetection === 'detectCycling') {
					// Using the repeatCount we already calculated above

					// If we've seen this URL too many times, stop pagination
					if (newRepeatCount > paginationState.maxUrlRepeats) {
						this.logger.info(
							formatOperationLog(
								'Collector',
								nodeName,
								nodeId,
								index,
								`Detected page cycling - URL "${currentUrl}" has been visited ${newRepeatCount} times, stopping pagination`
							)
						);
						paginationState.lastPageDetected = true;
						break;
					}

					// If we've seen a high number of pages with the same items (regardless of URL),
					// we might be in a cycling situation
					if (pageItems.length > 0 &&
						paginationState.visitedUrls.size > 5 &&
						paginationState.currentPage > 10 &&
						paginationState.urlRepeatCount.size < paginationState.currentPage / 2) {
						this.logger.info(
							formatOperationLog(
								'Collector',
								nodeName,
								nodeId,
								index,
								`Possible pagination cycling detected - visited ${paginationState.visitedUrls.size} unique URLs in ${paginationState.currentPage} pages`
							)
						);
						paginationState.lastPageDetected = true;
						break;
					}
				}

				// Reset consecutive empty pages counter if we found items
				if (pageItems.length > 0) {
					paginationState.consecutiveEmptyPages = 0;
				}

				// Safety mechanism: If we see the same URL too many times, stop pagination
				// This runs regardless of the selected last page detection method
				const maxSafeRepeats = 3; // Maximum safe repeats of the same URL
				if (newRepeatCount > maxSafeRepeats) {
					this.logger.warn(
						formatOperationLog(
							'Collector',
							nodeName,
							nodeId,
							index,
							`Safety: URL "${currentUrl}" has been visited ${newRepeatCount} times, stopping pagination to prevent infinite loops`
						)
					);
					paginationState.lastPageDetected = true;
					break;
				}

				// Safety mechanism: If we've visited too many pages compared to unique URLs
				// This helps catch cycling where the URLs include changing parameters
				if (paginationState.currentPage > 20 && paginationState.visitedUrls.size < paginationState.currentPage / 4) {
					this.logger.warn(
						formatOperationLog(
							'Collector',
							nodeName,
							nodeId,
							index,
							`Safety: Only ${paginationState.visitedUrls.size} unique URLs seen in ${paginationState.currentPage} pages, likely in a pagination loop`
						)
					);
					paginationState.lastPageDetected = true;
					break;
				}

				// Absolute safety: Never exceed 50 pages unless explicitly allowed
				const absoluteMaxPages = 50;
				if (paginationState.currentPage >= absoluteMaxPages && maxPages > absoluteMaxPages) {
					this.logger.warn(
						formatOperationLog(
							'Collector',
							nodeName,
							nodeId,
							index,
							`Safety: Reached ${absoluteMaxPages} pages which is unusually high, stopping pagination`
						)
					);
					paginationState.lastPageDetected = true;
					break;
				}

				// Navigate to the next page
				if (paginationStrategy === 'clickNext') {
					// Check if nextPageSelector is empty (should have been caught earlier)
					if (!nextPageSelector || nextPageSelector.trim() === '') {
						this.logger.info(
							formatOperationLog(
								'Collector',
								nodeName,
								nodeId,
								index,
								'Next page selector is empty - stopping pagination'
							)
						);
						paginationState.lastPageDetected = true;
						break;
					}

					// Click the next button
					this.logger.info(
						formatOperationLog(
							'Collector',
							nodeName,
							nodeId,
							index,
							`Clicking next page button: ${nextPageSelector}`
						)
					);

					try {
						// Add human-like delay before clicking
						if (useHumanDelays) {
							await new Promise(resolve => setTimeout(resolve, getHumanDelay()));
						}

						await page.click(nextPageSelector);

						// Wait after pagination if needed
						if (waitAfterPagination) {
							await new Promise(resolve => setTimeout(resolve, waitTimeAfterPagination));
						}

						// Increment page counter
						paginationState.currentPage++;

					} catch (error) {
						this.logger.warn(
							formatOperationLog(
								'Collector',
								nodeName,
								nodeId,
								index,
								`Error clicking next page button: ${(error as Error).message}`
							)
						);
						paginationState.lastPageDetected = true;
						break;
					}
				} else if (paginationStrategy === 'urlPattern') {
					// Navigate to the next page URL
					paginationState.currentPage++;
					const nextPageUrl = urlPattern.replace('{page}', paginationState.currentPage.toString());

					this.logger.info(
						formatOperationLog(
							'Collector',
							nodeName,
							nodeId,
							index,
							`Navigating to next page URL: ${nextPageUrl}`
						)
					);

					try {
						await page.goto(nextPageUrl, { waitUntil: 'networkidle0' });

						// Wait after pagination if needed
						if (waitAfterPagination) {
							await new Promise(resolve => setTimeout(resolve, waitTimeAfterPagination));
						}
					} catch (error) {
						this.logger.warn(
							formatOperationLog(
								'Collector',
								nodeName,
								nodeId,
								index,
								`Error navigating to next page URL: ${(error as Error).message}`
							)
						);
						paginationState.lastPageDetected = true;
						break;
					}
				}
			} else {
				// Reached maximum pages
				if (enablePagination && paginationState.currentPage >= maxPages) {
					this.logger.info(
						formatOperationLog(
							'Collector',
							nodeName,
							nodeId,
							index,
							`Reached maximum number of pages (${maxPages}), stopping pagination`
						)
					);
				}
				break;
			}
		} while (enablePagination && !paginationState.lastPageDetected);

		// Take screenshot if requested
		let screenshotData = '';
		if (takeScreenshotOption && page) {
			try {
				screenshotData = await page.screenshot({ encoding: 'base64' }) as string;
				this.logger.info(
					formatOperationLog(
						'Collector',
						nodeName,
						nodeId,
						index,
						`Screenshot taken (${screenshotData.length} bytes)`
					)
				);
			} catch (error) {
				this.logger.warn(
					formatOperationLog(
						'Collector',
						nodeName,
						nodeId,
						index,
						`Error taking screenshot: ${(error as Error).message}`
					)
				);
			}
		}

		// Extract filter configuration for debug info
		const filterConfiguration = {
			filterItems: this.getNodeParameter('filterItems', index, false) as boolean,
			filterCriteria: this.getNodeParameter('filterCriteria.criteria', index, []) as IDataObject[],
			filterLogic: this.getNodeParameter('filterLogic', index, 'and') as string
		};

		// Create collection-level debug info (only if debug mode is enabled)
		let collectionDebugInfo = null;
		if (debugMode) {
			collectionDebugInfo = {
				collectionSummary: {
					totalItems: collectedItems.length,
					totalItemsExtracted: totalItemsExtracted,
					totalItemsFiltered: totalItemsFiltered,
					pagesProcessed: paginationState.currentPage,
					maxPagesAllowed: maxPages,
					lastPageDetected: paginationState.lastPageDetected,
					executionTime: Date.now() - startTime,
					filterCriteria: filterConfiguration.filterItems ? filterConfiguration.filterCriteria : null,
					filterLogic: filterConfiguration.filterItems ? filterConfiguration.filterLogic : null,
				},
				...(debugInfo && { selectorValidation: debugInfo })
			};
		}

		// Convert collected items to N8N items
		const returnItems: INodeExecutionData[] = [];

		// Add collection debug info as the first item if debug mode is enabled
		if (debugMode && collectionDebugInfo) {
			returnItems.push({
				json: {
					...(outputInputData && items[index]?.json ? items[index].json : {}),
					_collectionDebug: true,
					_debugType: 'collection',
					sessionId,
					...collectionDebugInfo
				}
			});
		}

		// Process binary data for image fields before returning items
		const globalBinaryData: { [key: string]: any } = {};
		let hasBinaryData = false;

		// Helper function to get file extension from content type
		function getFileExtensionFromContentType(contentType: string): string {
			const typeMap: { [key: string]: string } = {
				'image/jpeg': 'jpg',
				'image/jpg': 'jpg',
				'image/png': 'png',
				'image/gif': 'gif',
				'image/webp': 'webp',
				'image/svg+xml': 'svg',
				'image/bmp': 'bmp',
				'image/tiff': 'tiff',
				'application/pdf': 'pdf'
			};
			return typeMap[contentType.toLowerCase()] || 'bin';
		}

		// Process each collected item for binary downloads
		for (let itemIndex = 0; itemIndex < collectedItems.length; itemIndex++) {
			const item = collectedItems[itemIndex];

			// Check each field for binary download needs
			for (const [fieldName, fieldValue] of Object.entries(item)) {
				if (fieldValue && typeof fieldValue === 'object' && fieldValue.needsBinaryDownload) {
					// Transform relative URL to absolute URL before downloading
					let downloadUrl = fieldValue.url;

					try {
						if (downloadUrl && !downloadUrl.startsWith('http')) {
							// Get current page URL to use as base
							const currentPageUrl = await page.url();
							try {
								downloadUrl = new URL(downloadUrl, currentPageUrl).href;
							} catch (urlError) {
								this.logger.warn(formatOperationLog('Collector', nodeName, nodeId, index,
									`Failed to convert relative URL to absolute: ${downloadUrl}, using relative URL`));
							}
						}

						this.logger.info(formatOperationLog('Collector', nodeName, nodeId, index,
							`Downloading binary data for item ${itemIndex}, field "${fieldName}": ${downloadUrl}`));

						// Create a new page for downloading to avoid interfering with the main page
						const browser = SessionManager.getSession(sessionId)?.browser;
						if (browser && browser.isConnected()) {
							const downloadPage = await browser.newPage();

							try {
								// Set a reasonable user agent
								await downloadPage.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36');

								// Navigate to the image URL (now absolute)
								const response = await downloadPage.goto(downloadUrl, {
									waitUntil: 'networkidle0',
									timeout: fieldValue.downloadTimeout
								});

								if (response && response.ok()) {
									// Get the image as buffer
									const buffer = await response.buffer();

									// Convert to base64
									const base64Data = buffer.toString('base64');

									// Get content type
									const contentType = response.headers()['content-type'] || 'image/unknown';

									// Create unique key for this binary item
									const binaryKey = `item_${itemIndex}_${fieldName}`;
									const fileName = `${binaryKey}_${Date.now()}.${getFileExtensionFromContentType(contentType)}`;

									// Add to global binary data
									globalBinaryData[binaryKey] = {
										data: base64Data,
										mimeType: contentType,
										fileName: fileName,
										fileSize: buffer.length
									};
									hasBinaryData = true;

									this.logger.info(formatOperationLog('Collector', nodeName, nodeId, index,
										`Successfully downloaded binary data for "${fieldName}": ${fileName} (${contentType}, ${buffer.length} bytes)`));

									// Update the item field to only include metadata (remove binary data)
									if (fieldValue.extractionMode === 'binary') {
										// For binary-only mode, replace with metadata object
										item[fieldName] = {
											url: downloadUrl,
											contentType: contentType,
											size: buffer.length,
											binaryKey: binaryKey
										};
									} else {
										// For 'both' mode, update existing object
										item[fieldName] = {
											url: downloadUrl,
											contentType: contentType,
											size: buffer.length,
											binaryKey: binaryKey
										};
									}
								} else {
									this.logger.warn(formatOperationLog('Collector', nodeName, nodeId, index,
										`Failed to download image for "${fieldName}", HTTP status: ${response?.status()}`));
									// Fall back to URL-only mode (use absolute URL)
									item[fieldName] = downloadUrl;
								}
							} finally {
								await downloadPage.close();
							}
						} else {
							this.logger.warn(formatOperationLog('Collector', nodeName, nodeId, index,
								`Browser session not available for binary download of "${fieldName}"`));
							// Fall back to URL-only mode (use absolute URL)
							item[fieldName] = downloadUrl;
						}
					} catch (downloadError) {
						this.logger.warn(formatOperationLog('Collector', nodeName, nodeId, index,
							`Error downloading binary data for "${fieldName}": ${(downloadError as Error).message}`));
						// Fall back to URL-only mode (use absolute URL)
						item[fieldName] = downloadUrl;
					}
				}
			}
		}

		// Add individual items without collection debug duplication
		for (const item of collectedItems) {
			const itemData: INodeExecutionData = {
				json: {
					...(outputInputData && items[index]?.json ? items[index].json : {}),
					...item,
					sessionId,
					// Individual item debug info can go here if needed
					...(debugMode && item.itemDebug && { itemDebug: item.itemDebug })
				}
			};

			// Add binary data if this item has any
			if (hasBinaryData) {
				const itemBinary: { [key: string]: any } = {};
				const itemIndex = collectedItems.indexOf(item);

				// Find binary data for this specific item
				for (const [binaryKey, binaryValue] of Object.entries(globalBinaryData)) {
					if (binaryKey.startsWith(`item_${itemIndex}_`)) {
						// Extract field name from binary key
						const fieldName = binaryKey.replace(`item_${itemIndex}_`, '');
						itemBinary[fieldName] = binaryValue;
					}
				}

				// Only add binary if this specific item has binary data
				if (Object.keys(itemBinary).length > 0) {
					itemData.binary = itemBinary;
				}
			}

			returnItems.push(itemData);
		}

		// If no items were collected, return collection info and a message item
		if (collectedItems.length === 0) {
			let message = 'No items collected';
			if (totalItemsExtracted > 0 && totalItemsFiltered > 0) {
				message = `No items collected - ${totalItemsExtracted} items found but all ${totalItemsFiltered} were filtered out`;
			} else if (totalItemsExtracted === 0) {
				message = 'No items collected - no items found on page(s)';
			}

			// If debug mode wasn't enabled above, we still need to add collection info
			if (!debugMode) {
				returnItems.push({
					json: {
						...(outputInputData && items[index]?.json ? items[index].json : {}),
						_collectionResult: true,
						success: true,
						message,
						sessionId,
						totalItems: 0,
						pagesProcessed: paginationState.currentPage
					}
				});
			} else {
				// Add a message item alongside the debug info
				returnItems.push({
					json: {
						...(outputInputData && items[index]?.json ? items[index].json : {}),
						_messageItem: true,
						success: true,
						message,
						sessionId
					}
				});
			}
		}

		// Add timing information
		const executionTime = Date.now() - startTime;
		this.logger.info(
			formatOperationLog(
				'Collector',
				nodeName,
				nodeId,
				index,
				`Operation completed in ${executionTime}ms, collected ${collectedItems.length} items from ${paginationState.currentPage} pages`
			)
		);

		return returnItems;
	} catch (error) {
		// Log the error
		this.logger.error(
			formatOperationLog(
				'Collector',
				nodeName,
				nodeId,
				index,
				`Error: ${(error as Error).message}`
			)
		);

		// Take error screenshot if requested
		let errorScreenshotData = '';
		if (this.getNodeParameter('takeScreenshot', index, false) as boolean && page) {
			try {
				errorScreenshotData = await page.screenshot({ encoding: 'base64' }) as string;
			} catch (screenshotError) {
				// Just log but don't escalate the error
				this.logger.warn(
					formatOperationLog(
						'Collector',
						nodeName,
						nodeId,
						index,
						`Failed to take error screenshot: ${(screenshotError as Error).message}`
					)
				);
			}
		}

		// If continue on fail is enabled, return an error item
		if (this.getNodeParameter('continueOnFail', index, true) as boolean) {
			return [{
				json: {
					...(outputInputData && items[index]?.json ? items[index].json : {}),
					success: false,
					error: (error as Error).message,
					sessionId,
					executionTime: Date.now() - startTime,
					errorScreenshot: errorScreenshotData || undefined,
				}
			}];
		}

		// Otherwise, throw the error
		throw error;
	}
}

/**
 * Helper function to collect items from the current page
 */
async function collectItemsFromPage(
	this: IExecuteFunctions,
	page: puppeteer.Page,
	options: {
		selectionMethod: string;
		containerSelector: string;
		itemSelector: string;
		maxItems: number;
		pageNumber: number;
		linkConfig: IDataObject;
		additionalFields: IDataObject[];
		filterItems: boolean;
		filterCriteria: IDataObject[];
		filterLogic: string;
		useHumanDelays: boolean;
		debugMode: boolean;
	},
	nodeName: string,
	nodeId: string,
	index: number
): Promise<ICollectionResult> {
	const {
		selectionMethod,
		containerSelector,
		itemSelector,
		maxItems,
		pageNumber,
		linkConfig,
		additionalFields,
		filterItems,
		filterCriteria,
		filterLogic,
		useHumanDelays,
		debugMode
	} = options;

	// Log what we're about to do
	this.logger.info(
		formatOperationLog(
			'Collector',
			nodeName,
			nodeId,
			index,
			`Collecting items from page ${pageNumber} (method: ${selectionMethod})`
		)
	);

	// Define the selector to use based on selection method
	let actualItemSelector: string;

	if (selectionMethod === 'containerItems') {
		// For container method, we need to extract child elements
		actualItemSelector = `${itemSelector} > *`;

		// Check if container exists
		const containerExists = await page.evaluate((selector: string) => {
			return !!document.querySelector(selector);
		}, itemSelector);

		if (!containerExists) {
			this.logger.warn(
				formatOperationLog(
					'Collector',
					nodeName,
					nodeId,
					index,
					`Container selector not found: ${itemSelector}`
				)
			);
			return {
				items: [],
				itemsExtracted: 0,
				itemsFiltered: 0
			};
		}

		// Log the container's children count for debugging
		if (debugMode) {
			const containerInfo = await page.evaluate((selector: string) => {
				const container = document.querySelector(selector);
				if (!container) return null;
				return {
					tagName: container.tagName,
					className: container.className,
					childCount: container.children.length,
					childTags: Array.from(container.children).map(child => child.tagName)
				};
			}, itemSelector);

			if (containerInfo) {
				this.logger.info(
					formatOperationLog(
						'Collector',
						nodeName,
						nodeId,
						index,
						`Container found: ${containerInfo.tagName}${containerInfo.className ? '.' + containerInfo.className : ''} with ${containerInfo.childCount} children (${containerInfo.childTags.join(', ')})`
					)
				);
			}
		}
	} else {
		// For direct method, use the provided item selector directly
		actualItemSelector = itemSelector;
	}

	// Get link extraction configuration
	const linkSelector = linkConfig.linkSelector as string || 'a';
	const linkAttribute = linkConfig.linkAttribute as string || 'href';
	const urlTransformation = linkConfig.urlTransformation as boolean || false;
	const transformationType = linkConfig.transformationType as string || 'absolute';

	// Debug validation results to include in output
	let selectorValidationResults: any = null;

	// Debug mode: Comprehensive selector validation
	if (debugMode) {
		this.logger.info(
			formatOperationLog(
				'Collector',
				nodeName,
				nodeId,
				index,
				`🔍 SELECTOR VALIDATION REPORT:`
			)
		);

		// Validate all selectors used in this operation
		const selectorValidation = await page.evaluate(
			(selectors: {
				containerSelector: string;
				itemSelector: string;
				actualItemSelector: string;
				linkSelector: string;
				additionalFields: IDataObject[];
				filterCriteria: IDataObject[];
				selectionMethod: string;
			}) => {
				const results: any = {};

				// Check container selector (if using containerItems method)
				if (selectors.selectionMethod === 'containerItems' && selectors.containerSelector) {
					const containerElements = document.querySelectorAll(selectors.containerSelector);
					results.container = {
						selector: selectors.containerSelector,
						found: containerElements.length > 0,
						count: containerElements.length,
						containerElementTag: containerElements.length > 0 ? containerElements[0].tagName : null,
						firstChildElementTag: containerElements.length > 0 && containerElements[0].children.length > 0 ? containerElements[0].children[0].tagName : null,
						childrenCount: containerElements.length > 0 ? containerElements[0].children.length : 0
					};
				}

				// Check item selector
				const itemElements = document.querySelectorAll(selectors.actualItemSelector);
				results.items = {
					selector: selectors.actualItemSelector,
					method: selectors.selectionMethod,
					found: itemElements.length > 0,
					count: itemElements.length,
					firstItemElementTag: itemElements.length > 0 ? itemElements[0].tagName : null,
					// Add detailed HTML structure for first few items
					sampleItemsHtml: itemElements.length > 0 ? Array.from(itemElements).slice(0, 3).map((el, idx) => ({
						itemIndex: idx + 1,
						tagName: el.tagName,
						className: el.className || null,
						id: el.id || null,
						outerHTML: el.outerHTML.length > 2000 ? el.outerHTML.substring(0, 2000) + '...[truncated]' : el.outerHTML,
						            textContent: el.textContent ? el.textContent.substring(0, 800) + (el.textContent.length > 800 ? '...[truncated]' : '') : null,
						childElementCount: el.children.length,
						hasLinks: el.querySelectorAll('a').length > 0,
						linkCount: el.querySelectorAll('a').length
					})) : []
				};

								// Check link selector within first item (if items exist)
				if (itemElements.length > 0) {
					const firstItem = itemElements[0];
					const linkElements = firstItem.querySelectorAll(selectors.linkSelector);
					const anyLinks = firstItem.querySelectorAll('a');

					results.links = {
						selector: selectors.linkSelector,
						found: linkElements.length > 0,
						count: linkElements.length,
						fallbackLinksCount: anyLinks.length,
						targetLinkElementTag: linkElements.length > 0 ? linkElements[0].tagName : null,
						sampleHrefs: Array.from(linkElements).slice(0, 3).map(el => el.getAttribute('href')).filter(Boolean),
						// Detailed analysis for debugging
						firstItemStructure: {
							tagName: firstItem.tagName,
							className: firstItem.className || null,
							childElements: Array.from(firstItem.children).map(child => ({
								tagName: child.tagName,
								className: child.className || null,
								textContent: child.textContent ? child.textContent.substring(0, 100) + (child.textContent.length > 100 ? '...' : '') : null,
								hasLinks: child.querySelectorAll('a').length > 0,
								linkCount: child.querySelectorAll('a').length
							})),
							allLinksInItem: Array.from(anyLinks).map(link => ({
								tagName: link.tagName,
								href: link.getAttribute('href'),
								textContent: link.textContent ? link.textContent.substring(0, 50) + (link.textContent.length > 50 ? '...' : '') : null,
								className: link.className || null,
								parentPath: (() => {
									let path = [];
									let current = link.parentElement;
									while (current && current !== firstItem && path.length < 5) {
										path.push(`${current.tagName}${current.className ? '.' + current.className.split(' ').join('.') : ''}`);
										current = current.parentElement;
									}
									return path.reverse().join(' > ');
								})()
							}))
						}
					};
				} else {
					results.links = {
						selector: selectors.linkSelector,
						found: false,
						count: 0,
						note: 'No items found to check links within'
					};
				}

								// Check additional field selectors
				results.additionalFields = [];
				if (selectors.additionalFields && selectors.additionalFields.length > 0 && itemElements.length > 0) {
					const firstItem = itemElements[0];
					for (const field of selectors.additionalFields) {
						const fieldSelector = field.selector as string;
						if (fieldSelector) {
							const fieldElements = firstItem.querySelectorAll(fieldSelector);
							results.additionalFields.push({
								name: field.name,
								selector: fieldSelector,
								found: fieldElements.length > 0,
								count: fieldElements.length,
								targetElementTag: fieldElements.length > 0 ? fieldElements[0].tagName : null,
								sampleText: fieldElements.length > 0 ? fieldElements[0].textContent?.substring(0, 50) : null
							});
						}
					}
				}

				// Check filter criteria selectors
				results.filterSelectors = [];
				if (selectors.filterCriteria && selectors.filterCriteria.length > 0 && itemElements.length > 0) {
					const firstItem = itemElements[0];
					for (const criterion of selectors.filterCriteria) {
						const filterSelector = criterion.selector as string;
						if (filterSelector) {
							const filterElements = firstItem.querySelectorAll(filterSelector);
							results.filterSelectors.push({
								fieldName: criterion.fieldName || criterion.name,
								selector: filterSelector,
								found: filterElements.length > 0,
								count: filterElements.length,
								targetElementTag: filterElements.length > 0 ? filterElements[0].tagName : null,
								sampleText: filterElements.length > 0 ? filterElements[0].textContent?.substring(0, 50) : null
							});
						}
					}
				}

				return results;
			},
			{
				containerSelector,
				itemSelector,
				actualItemSelector,
				linkSelector,
				additionalFields,
				filterCriteria,
				selectionMethod
			}
		);

		// Log container validation
		if (selectorValidation.container) {
			const containerStatus = selectorValidation.container.found ? '✅' : '❌';
			this.logger.info(
				formatOperationLog(
					'Collector',
					nodeName,
					nodeId,
					index,
					`${containerStatus} Container: "${selectorValidation.container.selector}" → ${selectorValidation.container.count} elements found`
				)
			);
		}

		// Log item validation
		const itemStatus = selectorValidation.items.found ? '✅' : '❌';
		this.logger.info(
			formatOperationLog(
				'Collector',
				nodeName,
				nodeId,
				index,
				`${itemStatus} Items: "${selectorValidation.items.selector}" → ${selectorValidation.items.count} elements found`
			)
		);

		// Log link validation
		const linkStatus = selectorValidation.links.found ? '✅' : '❌';
		this.logger.info(
			formatOperationLog(
				'Collector',
				nodeName,
				nodeId,
				index,
				`${linkStatus} Links: "${selectorValidation.links.selector}" → ${selectorValidation.links.count} elements found in first item`
			)
		);

		// Log additional fields validation
		if (selectorValidation.additionalFields.length > 0) {
			this.logger.info(
				formatOperationLog(
					'Collector',
					nodeName,
					nodeId,
					index,
					`📋 Additional Fields (${selectorValidation.additionalFields.length}):`
				)
			);
			for (const field of selectorValidation.additionalFields) {
				const fieldStatus = field.found ? '✅' : '❌';
				this.logger.info(
					formatOperationLog(
						'Collector',
						nodeName,
						nodeId,
						index,
						`${fieldStatus} "${field.name}": "${field.selector}" → ${field.count} elements`
					)
				);
			}
		}

		// Log filter selectors validation
		if (selectorValidation.filterSelectors.length > 0) {
			this.logger.info(
				formatOperationLog(
					'Collector',
					nodeName,
					nodeId,
					index,
					`🔍 Filter Selectors (${selectorValidation.filterSelectors.length}):`
				)
			);
			for (const filter of selectorValidation.filterSelectors) {
				const filterStatus = filter.found ? '✅' : '❌';
				this.logger.info(
					formatOperationLog(
						'Collector',
						nodeName,
						nodeId,
						index,
						`${filterStatus} "${filter.fieldName}": "${filter.selector}" → ${filter.count} elements`
					)
				);
			}
		}

		this.logger.info(
			formatOperationLog(
				'Collector',
				nodeName,
				nodeId,
				index,
				`Link config: selector=${linkSelector}, attribute=${linkAttribute}, transform=${urlTransformation}, type=${transformationType}`
			)
		);

		// Store validation results for output
		selectorValidationResults = selectorValidation;
	}

	// Count the number of items
	const itemCount = await page.evaluate((selector: string) => {
		return document.querySelectorAll(selector).length;
	}, actualItemSelector);

	this.logger.info(
		formatOperationLog(
			'Collector',
			nodeName,
			nodeId,
			index,
			`Found ${itemCount} items matching selector: ${actualItemSelector}`
		)
	);

	// If in debug mode, examine the first few items to help debugging
	if (debugMode) {
		const itemSamples = await page.evaluate((selector: string) => {
			const samples = [];
			const elements = document.querySelectorAll(selector);
			const maxSamples = Math.min(5, elements.length); // Show up to 5 items

			for (let i = 0; i < maxSamples; i++) {
				const element = elements[i];
				samples.push({
					itemIndex: i + 1,
					tagName: element.tagName,
					className: element.className || null,
					id: element.id || null,
					childElementCount: element.childElementCount,
					hasLinks: element.querySelectorAll('a').length > 0,
					linkCount: element.querySelectorAll('a').length,
					linkHrefs: Array.from(element.querySelectorAll('a')).map(a => a.getAttribute('href')),
					// COMPLETE HTML - no truncation
					completeOuterHTML: element.outerHTML
				});
			}

			return samples;
		}, actualItemSelector);

		// Log each item sample with complete HTML
		this.logger.info(
			formatOperationLog(
				'Collector',
				nodeName,
				nodeId,
				index,
				`🔍 COMPLETE HTML FOR EACH ITEM (showing ${itemSamples.length} items):`
			)
		);

		itemSamples.forEach((sample, idx) => {
			this.logger.info(
				formatOperationLog(
					'Collector',
					nodeName,
					nodeId,
					index,
					`\n📋 ITEM ${sample.itemIndex} COMPLETE HTML:\n` +
					`Tag: ${sample.tagName}, Class: ${sample.className || 'none'}, ID: ${sample.id || 'none'}\n` +
					`Child Elements: ${sample.childElementCount}, Links: ${sample.linkCount}\n` +
					`Link HREFs: ${JSON.stringify(sample.linkHrefs)}\n` +
					`COMPLETE HTML:\n${sample.completeOuterHTML}\n` +
					`${'='.repeat(80)}`
				)
			);
		});
	}

	// Execute field extraction and filtering in browser context
	const extractionResult = await page.evaluate(
		(params: {
			selector: string;
			linkSelector: string;
			linkAttribute: string;
			additionalFields: IDataObject[];
			urlTransformation: boolean;
			transformationType: string;
			pageNumber: number;
			debug: boolean;
			filterItems: boolean;
			filterCriteria: IDataObject[];
			filterLogic: string;
		}): { items: any[]; debugMessages: string[] } => {
			const {
				selector,
				linkSelector,
				linkAttribute,
				additionalFields,
				urlTransformation,
				transformationType,
				pageNumber,
				debug,
				filterItems,
				filterCriteria,
				filterLogic
			} = params;

			// Helper function to get absolute URL
			const getAbsoluteUrl = (url: string): string => {
				try {
					return new URL(url, window.location.href).href;
				} catch {
					return url;
				}
			};

			// Helper function to transform URL
			const transformUrl = (url: string): string => {
				if (!url) return '';

				if (!urlTransformation) return url;

				if (transformationType === 'absolute') {
					return getAbsoluteUrl(url);
				} else if (transformationType === 'addDomain') {
					if (url.startsWith('/')) {
						return `${window.location.origin}${url}`;
					}
					return url;
				} else if (transformationType === 'replace') {
					// This would need additional parameters to implement
					return url;
				}

				return url;
			};

			// Get all items - don't limit here
			const elements = Array.from(document.querySelectorAll(selector));

			// Debug function
			const debugLog = (message: string) => {
				if (debug) {
					debugMessages.push(message);
				}
			};

			// Collect debug messages to return them
			const debugMessages: string[] = [];

			const items = elements.map((element, idx) => {
				// Extract link
				let url = '';

				try {
					// First try the specified linkSelector
					const linkElements = element.querySelectorAll(linkSelector);
					debugLog(`Item #${idx}: Found ${linkElements.length} potential link elements matching "${linkSelector}"`);

					if (linkElements.length > 0) {
						// Get the first matching link element
						const linkElement = linkElements[0];
						url = linkElement.getAttribute(linkAttribute) || '';
						debugLog(`Item #${idx}: Raw URL from ${linkAttribute}: "${url}"`);
					} else {
						// If no links found with the specific selector, try any anchor tags
						const anyLinks = element.querySelectorAll('a');
						if (anyLinks.length > 0) {
							url = anyLinks[0].getAttribute('href') || '';
							debugLog(`Item #${idx}: Fallback - found ${anyLinks.length} generic links, using first href: "${url}"`);
						}
					}

					// Transform URL if needed
					if (url) {
						url = transformUrl(url);
						debugLog(`Item #${idx}: Transformed URL: "${url}"`);
					}
				} catch (error) {
					debugLog(`Item #${idx}: Error extracting URL: ${error}`);
				}

				// Extract additional fields
				const result: any = {
					url,
					itemIndex: idx,
					pageNumber,
				};

				// Add item-level debug info if debug mode is enabled
				if (debug) {
					result.itemDebug = {
						tagName: element.tagName?.toLowerCase() || 'unknown',
						className: element.className || null,
						id: element.id || null,
						childElementCount: element.children?.length || 0,
						textContentLength: element.textContent?.length || 0,
						outerHTMLLength: element.outerHTML?.length || 0
					};
				}

				// Process additional fields
				if (additionalFields && additionalFields.length > 0) {
					debugLog(`Item #${idx}: Processing ${additionalFields.length} additional fields`);

					for (const field of additionalFields) {
						const fieldName = field.name as string;
						const fieldSelector = field.selector as string;
						const extractionType = field.extractionType as string || 'text';
						const attributeName = field.attributeName as string;

						if (!fieldName || !fieldSelector) {
							debugLog(`Item #${idx}: Skipping field with missing name or selector`);
							continue;
						}

						debugLog(`Item #${idx}: Processing field "${fieldName}" with selector "${fieldSelector}"`);

						// Find the element
						let fieldElement = null;
						try {
							// Check if the selector has nth-of-type/nth-child at the end (like "a:nth-of-type(2)")
							// vs in the middle (like "td:nth-of-type(3) a")
							const endNthMatch = fieldSelector.match(/^(.+?):nth-(?:of-type|child)\((\d+)\)$/);
							if (endNthMatch) {
								// Pattern: "a:nth-of-type(2)" - get all "a" elements and take the nth one
								const baseSelector = endNthMatch[1];
								const elementIndex = parseInt(endNthMatch[2]) - 1; // Convert to 0-based index

								debugLog(`Item #${idx}: Detected nth selector at end, using base selector "${baseSelector}" with index ${elementIndex}`);

								const matchingElements = element.querySelectorAll(baseSelector);
								debugLog(`Item #${idx}: Field "${fieldName}" selector "${baseSelector}" found ${matchingElements.length} elements`);

								if (matchingElements.length > elementIndex) {
									fieldElement = matchingElements[elementIndex];
									debugLog(`Item #${idx}: Found element for field "${fieldName}" (${matchingElements.length} matches, using index ${elementIndex})`);
									debugLog(`Item #${idx}: Selected element text: "${fieldElement.textContent?.trim()}", tag: ${fieldElement.tagName}`);
								} else {
									debugLog(`Item #${idx}: Not enough elements for field "${fieldName}" using selector "${baseSelector}" (found ${matchingElements.length}, needed index ${elementIndex})`);
								}
							} else {
								// No nth-of-type at the end, use the selector as-is (handles cases like "td:nth-of-type(3) a")
								debugLog(`Item #${idx}: Using selector as-is: "${fieldSelector}"`);

								const matchingElements = element.querySelectorAll(fieldSelector);
								debugLog(`Item #${idx}: Field "${fieldName}" selector "${fieldSelector}" found ${matchingElements.length} elements`);

								if (matchingElements.length > 0) {
									// If we have multiple elements, prefer one with text content
									fieldElement = matchingElements[0];
									if (matchingElements.length > 1) {
										// Find the first element with non-empty text content
										const elementWithText = Array.from(matchingElements).find(el => el.textContent && el.textContent.trim() !== '');
										if (elementWithText) {
											fieldElement = elementWithText;
											debugLog(`Item #${idx}: Found element for field "${fieldName}" (${matchingElements.length} matches, using element with text content)`);
										} else {
											debugLog(`Item #${idx}: Found element for field "${fieldName}" (${matchingElements.length} matches, no element with text, using first)`);
										}
									} else {
										debugLog(`Item #${idx}: Found element for field "${fieldName}" (${matchingElements.length} matches, using first)`);
									}
									debugLog(`Item #${idx}: Selected element text: "${fieldElement.textContent?.trim()}", tag: ${fieldElement.tagName}`);
								} else {
									debugLog(`Item #${idx}: No elements found for field "${fieldName}" using selector "${fieldSelector}"`);
								}
							}

							// Debug: show all "a" elements in this item for comparison
							if (fieldSelector.includes('a')) {
								const allAs = element.querySelectorAll('a');
								debugLog(`Item #${idx}: Total "a" elements in item: ${allAs.length}`);
								if (allAs.length > 0) {
									allAs.forEach((a, aIdx) => {
										debugLog(`Item #${idx}: a[${aIdx}] text: "${a.textContent?.trim()}", href: "${a.getAttribute('href')}"`);
									});
								} else {
									// If no 'a' elements found, let's debug the item structure
									debugLog(`Item #${idx}: No 'a' elements found. Item structure debug:`);
									debugLog(`Item #${idx}: Item tag: ${element.tagName}, class: "${element.className || 'none'}"`);
									debugLog(`Item #${idx}: Item HTML (first 300 chars): ${element.outerHTML.substring(0, 300)}...`);
									debugLog(`Item #${idx}: Item children count: ${element.children.length}`);

									// Show all child elements and their structure
									Array.from(element.children).slice(0, 10).forEach((child, childIdx) => {
										const childAs = child.querySelectorAll('a');
										debugLog(`Item #${idx}: Child[${childIdx}] tag: ${child.tagName}, class: "${child.className || 'none'}", 'a' count: ${childAs.length}`);
										if (childAs.length > 0) {
											childAs.forEach((a, aIdx) => {
												debugLog(`Item #${idx}: Child[${childIdx}] a[${aIdx}] text: "${a.textContent?.trim()}", href: "${a.getAttribute('href')}"`);
											});
										}
									});

									// Special check for td elements if this might be a table row
									if (element.tagName.toLowerCase() === 'tr') {
										const tds = element.querySelectorAll('td');
										debugLog(`Item #${idx}: Table row detected, td count: ${tds.length}`);
										tds.forEach((td, tdIdx) => {
											const tdAs = td.querySelectorAll('a');
											debugLog(`Item #${idx}: td[${tdIdx}] 'a' count: ${tdAs.length}, text: "${td.textContent?.trim().substring(0, 50) || 'empty'}"`);
											if (tdAs.length > 0) {
												tdAs.forEach((a, aIdx) => {
													debugLog(`Item #${idx}: td[${tdIdx}] a[${aIdx}] text: "${a.textContent?.trim()}", href: "${a.getAttribute('href')}"`);
												});
											}
										});

										// Test the specific selector that's failing
										if (fieldSelector === 'td:nth-of-type(3) a') {
											const thirdTd = element.querySelector('td:nth-of-type(3)');
											if (thirdTd) {
												const thirdTdAs = thirdTd.querySelectorAll('a');
												debugLog(`Item #${idx}: SPECIFIC SELECTOR TEST - td:nth-of-type(3) found: YES, 'a' count in 3rd td: ${thirdTdAs.length}`);
												if (thirdTdAs.length > 0) {
													thirdTdAs.forEach((a, aIdx) => {
														debugLog(`Item #${idx}: SPECIFIC SELECTOR TEST - 3rd td a[${aIdx}] text: "${a.textContent?.trim()}", href: "${a.getAttribute('href')}"`);
													});
												} else {
													debugLog(`Item #${idx}: SPECIFIC SELECTOR TEST - 3rd td HTML: ${thirdTd.outerHTML}`);
												}
											} else {
												debugLog(`Item #${idx}: SPECIFIC SELECTOR TEST - td:nth-of-type(3) NOT FOUND`);
											}
										}
									}
								}
							}
						} catch (error) {
							// Invalid selector, skip this field
							debugLog(`Item #${idx}: Invalid selector for field "${fieldName}": ${fieldSelector} - Error: ${error}`);
							result[fieldName] = '';
							continue;
						}

						if (!fieldElement) {
							debugLog(`Item #${idx}: No element found for field "${fieldName}"`);
							result[fieldName] = '';
							continue;
						}

						// Extract value based on extraction type
						try {
							if (extractionType === 'text') {
								result[fieldName] = fieldElement.textContent?.trim() || '';
								debugLog(`Item #${idx}: Extracted text for "${fieldName}": "${result[fieldName]}"`);
							} else if (extractionType === 'attribute' && attributeName) {
								result[fieldName] = fieldElement.getAttribute(attributeName) || '';
								debugLog(`Item #${idx}: Extracted attribute "${attributeName}" for "${fieldName}": "${result[fieldName]}"`);

								// Transform URL if it's a URL attribute
								if ((attributeName === 'href' || attributeName === 'src') && result[fieldName]) {
									result[fieldName] = transformUrl(result[fieldName]);
									debugLog(`Item #${idx}: Transformed URL for "${fieldName}": "${result[fieldName]}"`);
								}
							} else if (extractionType === 'html') {
								result[fieldName] = fieldElement.innerHTML || '';
								debugLog(`Item #${idx}: Extracted HTML for "${fieldName}" (${result[fieldName].length} chars)`);
							} else if (extractionType === 'image') {
								// Handle image extraction
								const imageOptions = field.imageOptions as any || {};
								const extractionMode = imageOptions.extractionMode || 'url';
								const sourceAttribute = imageOptions.sourceAttribute || 'src';
								const urlTransformation = imageOptions.urlTransformation !== false;
								const transformationType = imageOptions.transformationType || 'absolute';
								const formatChecking = imageOptions.formatChecking === true;
								const supportedFormats = imageOptions.supportedFormats || ['jpg', 'png', 'gif', 'webp'];

								debugLog(`Item #${idx}: Starting image extraction for "${fieldName}" with mode: ${extractionMode}`);

								// First, try to get the image URL from the current element or find img elements within
								let imageUrl = '';
								let actualImageElement = fieldElement;

								// Try to get the attribute directly (if it's an img element)
								imageUrl = fieldElement.getAttribute(sourceAttribute) || '';

								// If no URL found, check if this is a container with img elements inside
								if (!imageUrl) {
									debugLog(`Item #${idx}: No ${sourceAttribute} on selected element, searching for img elements within container`);
									const imgElements = fieldElement.querySelectorAll('img');
									if (imgElements.length > 0) {
										debugLog(`Item #${idx}: Found ${imgElements.length} img elements within container`);
										actualImageElement = imgElements[0] as Element;
										imageUrl = actualImageElement.getAttribute(sourceAttribute) || '';
									}
								}

								// If still no URL, try alternative attributes
								if (!imageUrl && sourceAttribute === 'src') {
									const alternativeAttrs = ['data-src', 'data-original', 'data-lazy', 'data-url'];
									for (const attr of alternativeAttrs) {
										imageUrl = actualImageElement.getAttribute(attr) || '';
										if (imageUrl) {
											debugLog(`Item #${idx}: Found image URL using alternative attribute '${attr}': ${imageUrl}`);
											break;
										}
									}
								}

								if (!imageUrl) {
									debugLog(`Item #${idx}: No image URL found for "${fieldName}"`);
									result[fieldName] = null;
								} else {
									// Apply URL transformation if enabled
									if (urlTransformation) {
										imageUrl = transformUrl(imageUrl);
									}

																	// Simple format checking in browser context (if enabled)
								let skipUnsupportedFormat = false;
								if (formatChecking && supportedFormats && supportedFormats.length > 0) {
									// Simple format checking using URL extension
									const urlLower = imageUrl.toLowerCase();
									const hasValidExtension = supportedFormats.some((format: string) => {
										const formatLower = format.toLowerCase();
										return urlLower.includes(`.${formatLower}`) ||
											   (formatLower === 'jpg' && urlLower.includes('.jpeg'));
									});

									// Also check for common dynamic image handlers
									const isDynamicHandler = /imageviewer|image\.(aspx|ashx)|solutionviewer|documentviewer|getimage|showimage|renderimage|thumbnail|preview/i.test(imageUrl);

									if (!hasValidExtension && !isDynamicHandler) {
										debugLog(`Item #${idx}: Skipping unsupported image format for "${fieldName}": ${imageUrl}`);
										skipUnsupportedFormat = true;
									}
								}

								if (!skipUnsupportedFormat) {
									debugLog(`Item #${idx}: Processing image for "${fieldName}": ${imageUrl}`);

									// Prepare result object
									const imageResult: any = { url: imageUrl };

									// For URL-only mode, just return the URL
									if (extractionMode === 'url') {
										result[fieldName] = imageUrl;
									} else {
										// For binary or both modes, store the image result object
										// Note: We'll handle binary download in the post-processing step
										// to avoid blocking the collector loop
										imageResult.extractionMode = extractionMode;
										imageResult.downloadTimeout = imageOptions.downloadTimeout || 30000;
										imageResult.needsBinaryDownload = (extractionMode === 'binary' || extractionMode === 'both');
										result[fieldName] = imageResult;
									}

									debugLog(`Item #${idx}: Image extraction result for "${fieldName}": ${extractionMode === 'url' ? imageUrl : 'object with URL and download info'}`);
								} else {
									result[fieldName] = null;
								}
								}
							}
						} catch (error) {
							debugLog(`Item #${idx}: Error extracting field "${fieldName}": ${error}`);
							result[fieldName] = '';
						}
					}
				}

				// Apply filtering within the browser context
				if (filterItems && filterCriteria && filterCriteria.length > 0) {
					// Add filter debug info to item
					if (debug && !result.itemDebug) {
						result.itemDebug = {};
					}
					if (debug) {
						result.itemDebug.filterTests = [];
					}

					debugLog(`Item #${idx}: Starting filter evaluation with ${filterCriteria.length} criteria`);

					const filterResults = filterCriteria.map((criterion: any, criterionIdx: number) => {
						const selector = criterion.selector as string;
						const fieldName = criterion.fieldName as string;
						const extractionType = criterion.extractionType as string || 'text';
						const condition = criterion.condition as string;
						const value = criterion.value as string || '';
						const caseSensitive = criterion.caseSensitive as boolean;
						const attributeName = criterion.attributeName as string;

						debugLog(`Item #${idx}: Processing criterion ${criterionIdx}: selector="${selector}", fieldName="${fieldName}", extractionType="${extractionType}", condition="${condition}"`);

						let itemValue = '';

						// First check if we should use field name (already extracted data)
						if (fieldName && result[fieldName] !== undefined) {
							itemValue = String(result[fieldName] || '');
							debugLog(`Item #${idx}: Using field "${fieldName}" value: "${itemValue}"`);
						}
						// Otherwise use CSS selector to extract value from DOM
						else if (selector) {
							try {
								if (extractionType === 'exists') {
									// For exists check, just see if element exists
									const elements = element.querySelectorAll(selector);
									itemValue = elements.length > 0 ? 'exists' : '';
									debugLog(`Item #${idx}: Selector "${selector}" exists: ${elements.length > 0} (found ${elements.length} elements)`);
								} else {
									// Extract value using selector
									const targetElements = element.querySelectorAll(selector);
									if (targetElements.length > 0) {
										const targetElement = targetElements[0];

										if (extractionType === 'text') {
											itemValue = targetElement.textContent?.trim() || '';
										} else if (extractionType === 'attribute' && attributeName) {
											itemValue = targetElement.getAttribute(attributeName) || '';
										} else {
											itemValue = targetElement.textContent?.trim() || '';
										}
									}
									debugLog(`Item #${idx}: Extracted "${itemValue}" from selector "${selector}"`);
								}
							} catch (error) {
								debugLog(`Item #${idx}: Error with selector "${selector}": ${error}`);
								itemValue = '';
							}
						} else {
							debugLog(`Item #${idx}: No selector or fieldName provided for criterion ${criterionIdx}`);
						}

						let conditionResult = false;

						// Apply condition
						if (extractionType === 'exists') {
							if (condition === 'exists') {
								conditionResult = itemValue !== '';
							} else if (condition === 'notExists') {
								conditionResult = itemValue === '';
							} else {
								conditionResult = itemValue !== ''; // default to exists
							}
							debugLog(`Item #${idx}: Exists condition "${condition}" result: ${conditionResult} (itemValue: "${itemValue}")`);
						} else {
							// Handle other conditions
							const compareValue = caseSensitive ? value : (value || '').toLowerCase();
							const compareItemValue = caseSensitive ? itemValue : itemValue.toLowerCase();

							switch (condition) {
								case 'contains':
									if (compareValue.includes(',')) {
										const valuesToCheck = compareValue.split(',').map(v => v.trim());
										conditionResult = valuesToCheck.some(val => compareItemValue.includes(val));
									} else {
										conditionResult = compareItemValue.includes(compareValue);
									}
									break;
								case 'notContains':
									if (compareValue.includes(',')) {
										const valuesToCheck = compareValue.split(',').map(v => v.trim());
										conditionResult = valuesToCheck.every(val => !compareItemValue.includes(val));
									} else {
										conditionResult = !compareItemValue.includes(compareValue);
									}
									break;
								case 'equals':
									conditionResult = compareItemValue === compareValue;
									break;
								case 'startsWith':
									conditionResult = compareItemValue.startsWith(compareValue);
									break;
								case 'endsWith':
									conditionResult = compareItemValue.endsWith(compareValue);
									break;
								case 'exists':
									conditionResult = itemValue !== '';
									break;
								case 'notExists':
									conditionResult = itemValue === '';
									break;
								case 'regex':
									try {
										const regex = new RegExp(value, caseSensitive ? '' : 'i');
										conditionResult = regex.test(itemValue);
										debugLog(`Item #${idx}: Regex test with pattern "${value}" (flags: ${caseSensitive ? 'none' : 'i'}) against "${itemValue}": ${conditionResult}`);
									} catch (error) {
										debugLog(`Item #${idx}: Invalid regex pattern "${value}": ${error}`);
										conditionResult = false;
									}
									break;
								default:
									conditionResult = false;
									break;
							}
							debugLog(`Item #${idx}: Condition "${condition}" result: ${conditionResult} (itemValue: "${itemValue}", compareValue: "${compareValue}")`);
						}

						// Add filter test debug info
						if (debug) {
							result.itemDebug.filterTests.push({
								selector: selector || 'field:' + fieldName,
								extractionType,
								condition,
								value: value || '',
								extractedValue: itemValue,
								result: conditionResult
							});
						}

						return conditionResult;
					});

					// Apply filter logic
					const passesFilter = filterLogic === 'and'
						? filterResults.every(Boolean)
						: filterResults.some(Boolean);

					debugLog(`Item #${idx}: Filter results: ${JSON.stringify(filterResults)}, logic: ${filterLogic}, passes: ${passesFilter}`);

					// Add final filter result to debug
					if (debug) {
						result.itemDebug.filterResult = {
							logic: filterLogic,
							individualResults: filterResults,
							finalResult: passesFilter
						};
					}

					if (!passesFilter) {
						debugLog(`Item #${idx}: Filtered out by criteria`);
						return null; // Mark item for filtering
					}
				}

				return result;
			}).filter(item => item !== null); // Remove filtered items

			// Return both items and debug messages
			return {
				items: items,
				debugMessages: debug ? debugMessages : []
			};
		},
		{
			selector: actualItemSelector,
			linkSelector,
			linkAttribute,
			additionalFields,
			urlTransformation,
			transformationType,
			pageNumber,
			debug: debugMode,
			filterItems,
			filterCriteria,
			filterLogic
		}
	);

	// Log debug messages from browser context
	if (debugMode && extractionResult.debugMessages && extractionResult.debugMessages.length > 0) {
		this.logger.info(
			formatOperationLog(
				'Collector',
				nodeName,
				nodeId,
				index,
				`🔍 FIELD EXTRACTION DEBUG (from browser context):`
			)
		);
		extractionResult.debugMessages.forEach(message => {
			this.logger.info(
				formatOperationLog(
					'Collector',
					nodeName,
					nodeId,
					index,
					`[Browser] ${message}`
				)
			);
		});
	}

	const items = extractionResult.items;

	// Log the extracted items for debugging
	if (debugMode) {
		this.logger.info(
			formatOperationLog(
				'Collector',
				nodeName,
				nodeId,
				index,
				`Extracted ${items.length} items. First item sample: ${JSON.stringify(items[0])}`
			)
		);

		// Log HTML for collected items (after filtering)
		if (items.length > 0) {
			const collectedItemsHtml = await page.evaluate(
				(params: { selector: string; collectedItemIndexes: number[]; maxItems: number }) => {
					const { selector, collectedItemIndexes, maxItems } = params;
					const allElements = Array.from(document.querySelectorAll(selector));

					return collectedItemIndexes.slice(0, maxItems).map((originalIndex, collectedIndex) => {
						const element = allElements[originalIndex];
						if (!element) return null;

						const links = Array.from(element.querySelectorAll('a'));
						return {
							collectedIndex: collectedIndex + 1,
							originalIndex: originalIndex,
							tagName: element.tagName,
							className: element.className || null,
							id: element.id || null,
							childElementCount: element.children.length,
							linkCount: links.length,
							linkHrefs: links.map(link => link.getAttribute('href')).filter(Boolean),
							completeOuterHTML: element.outerHTML
						};
					}).filter(Boolean);
				},
				{
					selector: actualItemSelector,
					collectedItemIndexes: items.map(item => item.itemIndex),
					maxItems: 10
				}
			);

			this.logger.info(
				formatOperationLog(
					'Collector',
					nodeName,
					nodeId,
					index,
					`🎯 COLLECTED ITEMS HTML (showing first ${Math.min(collectedItemsHtml.length, 10)} collected items):`
				)
			);

			collectedItemsHtml.forEach((item, idx) => {
				if (!item) return; // Skip null items

				this.logger.info(
					formatOperationLog(
						'Collector',
						nodeName,
						nodeId,
						index,
						`\n📦 COLLECTED ITEM ${item.collectedIndex} (originally item #${item.originalIndex + 1}):\n` +
						`Tag: ${item.tagName}, Class: ${item.className || 'none'}, ID: ${item.id || 'none'}\n` +
						`Child Elements: ${item.childElementCount}, Links: ${item.linkCount}\n` +
						`Link HREFs: ${JSON.stringify(item.linkHrefs)}\n` +
						`COMPLETE HTML:\n${item.completeOuterHTML}\n` +
						`${'='.repeat(80)}`
					)
				);
			});
		}
	}

	// Filtering is now done in the browser evaluation phase
	let filteredItems = items;

	// Log filtering results
	if (filterItems && filterCriteria.length > 0) {
		this.logger.info(
				formatOperationLog(
					'Collector',
						nodeName,
						nodeId,
						index,
						`Filter applied in browser: ${items.length} items returned after filtering`
				)
		);
	}

	// Calculate filtering statistics using the itemCount we already have
	const totalItemsFound = itemCount; // Items found before filtering
	const totalItemsAfterFilter = items.length; // Items remaining after filtering

	const itemsExtracted = totalItemsAfterFilter; // Items we're returning
	const itemsFiltered = totalItemsFound - totalItemsAfterFilter; // Items that were filtered out

	// Log clear statistics for debugging
	this.logger.info(
		formatOperationLog(
			'Collector',
			nodeName,
			nodeId,
			index,
			`📊 Collection Statistics: Found ${totalItemsFound} → Filtered out ${itemsFiltered} → Returning ${itemsExtracted}`
		)
	);

	// Now apply the maxItems limit AFTER filtering
	if (filteredItems.length > maxItems) {
		this.logger.info(
			formatOperationLog(
				'Collector',
				nodeName,
				nodeId,
				index,
				`Limiting filtered items from ${filteredItems.length} to max ${maxItems} per page`
			)
		);
		filteredItems = filteredItems.slice(0, maxItems);
	}

	return {
		items: filteredItems,
		itemsExtracted,
		itemsFiltered,
		...(selectorValidationResults && { debugInfo: selectorValidationResults })
	};
}
