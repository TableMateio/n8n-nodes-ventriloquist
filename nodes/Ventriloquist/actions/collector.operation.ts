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
import { elementExists } from '../utils/navigationUtils';
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
		name: "selectionMethod",
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
		description: "How to select elements to collect",
		displayOptions: {
			show: {
				operation: ["collector"],
			},
		},
	},
	{
		displayName: "Results Container Selector",
		name: "resultsSelector",
		type: "string",
		default: "",
		placeholder: "ul.results, #search-results, table tbody",
		description: "CSS selector for container with all results",
		displayOptions: {
			show: {
				operation: ["collector"],
				selectionMethod: ["containerItems"],
			},
		},
	},
	{
		displayName: "Direct Item Selector",
		name: "directItemSelector",
		type: "string",
		default: "",
		placeholder: "li, .result, tr",
		description: "CSS selector for items to collect",
		displayOptions: {
			show: {
				operation: ["collector"],
				selectionMethod: ["directItems"],
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
						displayName: "Extraction Type",
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
						displayName: "Value",
						name: "value",
						type: "string",
						default: "",
						description: "Value to compare against. For 'Contains' and 'Not Contains' conditions, you can use comma-separated values (e.g., 'REMOVED,SOLD,EXPIRED').",
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

	// Visual marker to clearly indicate a new node is starting
	this.logger.info(`${'='.repeat(40)}`);
	this.logger.info(`[Ventriloquist][${nodeName}#${index}][Collector] Starting operation`);

	try {
		// Get common parameters
		const waitForSelectors = this.getNodeParameter('waitForSelectors', index, true) as boolean;
		const timeout = this.getNodeParameter('timeout', index, 10000) as number;
		const useHumanDelays = this.getNodeParameter('useHumanDelays', index, true) as boolean;
		const debugMode = this.getNodeParameter('debugMode', index, false) as boolean;
		const explicitSessionId = this.getNodeParameter('explicitSessionId', index, '') as string;
		const maxItemsPerPage = this.getNodeParameter('maxItemsPerPage', index, 50) as number;
		const maxTotalItems = this.getNodeParameter('maxTotalItems', index, 200) as number;
		const takeScreenshotOption = this.getNodeParameter('takeScreenshot', index, false) as boolean;
		const selectionMethod = this.getNodeParameter('selectionMethod', index, 'containerItems') as string;

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
		const enablePagination = this.getNodeParameter('enablePagination', index, false) as boolean;
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
			} else if (paginationStrategy === 'urlPattern') {
				urlPattern = this.getNodeParameter('urlPattern', index, '') as string;
				startPage = this.getNodeParameter('startPage', index, 1) as number;
				paginationState.currentPage = startPage;
			}

			if (lastPageDetection === 'selectorPresent') {
				lastPageSelector = this.getNodeParameter('lastPageSelector', index, '') as string;
			} else if (lastPageDetection === 'disabledState') {
				disabledButtonConfig = this.getNodeParameter('disabledButtonConfig.values', index, {}) as IDataObject;
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

				if (selectionMethod === 'containerItems') {
					selectorToWaitFor = this.getNodeParameter('resultsSelector', index, '') as string;
				} else {
					selectorToWaitFor = this.getNodeParameter('directItemSelector', index, '') as string;
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
			const pageItems = await collectItemsFromPage.call(
				this,
				page,
				{
					selectionMethod,
					containerSelector: selectionMethod === 'containerItems' ?
						this.getNodeParameter('resultsSelector', index, '') as string : '',
					itemSelector: selectionMethod === 'directItems' ?
						this.getNodeParameter('directItemSelector', index, '') as string : '',
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

			// Add items from this page to our collection
			collectedItems.push(...pageItems);

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

		// Convert collected items to N8N items
		const returnItems: INodeExecutionData[] = [];
		for (const item of collectedItems) {
			returnItems.push({
				json: {
					...item,
					sessionId,
					collectionSummary: {
						totalItems: collectedItems.length,
						pagesProcessed: paginationState.currentPage,
						maxPagesAllowed: maxPages,
						lastPageDetected: paginationState.lastPageDetected,
					}
				}
			});
		}

		// If no items were collected, return at least one item with collection info
		if (returnItems.length === 0) {
			returnItems.push({
				json: {
					success: true,
					message: 'No items collected',
					sessionId,
					collectionSummary: {
						totalItems: 0,
						pagesProcessed: paginationState.currentPage,
						maxPagesAllowed: maxPages,
						lastPageDetected: paginationState.lastPageDetected,
					}
				}
			});
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
): Promise<ICollectedItem[]> {
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
		actualItemSelector = `${containerSelector} > *`;

		// Check if container exists
		const containerExists = await page.evaluate((selector: string) => {
			return !!document.querySelector(selector);
		}, containerSelector);

		if (!containerExists) {
			this.logger.warn(
				formatOperationLog(
					'Collector',
					nodeName,
					nodeId,
					index,
					`Container selector not found: ${containerSelector}`
				)
			);
			return [];
		}
	} else {
		// For direct method, use the provided item selector
		actualItemSelector = itemSelector;
	}

	// Get link extraction configuration
	const linkSelector = linkConfig.linkSelector as string || 'a';
	const linkAttribute = linkConfig.linkAttribute as string || 'href';
	const urlTransformation = linkConfig.urlTransformation as boolean || false;
	const transformationType = linkConfig.transformationType as string || 'absolute';

	// Debug log the configuration
	if (debugMode) {
		this.logger.info(
			formatOperationLog(
				'Collector',
				nodeName,
				nodeId,
				index,
				`Link config: selector=${linkSelector}, attribute=${linkAttribute}, transform=${urlTransformation}, type=${transformationType}`
			)
		);

		this.logger.info(
			formatOperationLog(
				'Collector',
				nodeName,
				nodeId,
				index,
				`Additional fields: ${JSON.stringify(additionalFields)}`
			)
		);
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
			const maxSamples = Math.min(3, elements.length);

			for (let i = 0; i < maxSamples; i++) {
				const element = elements[i];
				samples.push({
					outerHTML: element.outerHTML.substring(0, 500) + (element.outerHTML.length > 500 ? '...' : ''),
					tagName: element.tagName,
					childElementCount: element.childElementCount,
					hasLinks: element.querySelectorAll('a').length > 0,
					linkHrefs: Array.from(element.querySelectorAll('a')).map(a => a.getAttribute('href')),
				});
			}

			return samples;
		}, actualItemSelector);

		this.logger.info(
			formatOperationLog(
				'Collector',
				nodeName,
				nodeId,
				index,
				`Item samples for debugging: ${JSON.stringify(itemSamples)}`
			)
		);
	}

	// Extract items based on selector
	const items = await page.evaluate(
		(params: {
			selector: string;
			maxItems: number;
			linkSelector: string;
			linkAttribute: string;
			additionalFields: IDataObject[];
			urlTransformation: boolean;
			transformationType: string;
			pageNumber: number;
			debug: boolean;
		}) => {
			const {
				selector,
				maxItems,
				linkSelector,
				linkAttribute,
				additionalFields,
				urlTransformation,
				transformationType,
				pageNumber,
				debug
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

			// Get all items
			const elements = Array.from(document.querySelectorAll(selector));
			const limitedElements = elements.slice(0, maxItems);

			// Debug function
			const debugLog = (message: string) => {
				if (debug) {
					console.log(`[Collector Debug] ${message}`);
				}
			};

			return limitedElements.map((element, idx) => {
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
							// First try to find it within this item
							const matchingElements = element.querySelectorAll(fieldSelector);
							if (matchingElements.length > 0) {
								fieldElement = matchingElements[0];
								debugLog(`Item #${idx}: Found element for field "${fieldName}" (${matchingElements.length} matches)`);
							} else {
								debugLog(`Item #${idx}: No elements found for field "${fieldName}" using selector "${fieldSelector}"`);
							}
						} catch (error) {
							// Invalid selector, skip this field
							debugLog(`Item #${idx}: Invalid selector for field "${fieldName}": ${fieldSelector}`);
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
							}
						} catch (error) {
							debugLog(`Item #${idx}: Error extracting field "${fieldName}": ${error}`);
							result[fieldName] = '';
						}
					}
				}

				return result;
			});
		},
		{
			selector: actualItemSelector,
			maxItems,
			linkSelector,
			linkAttribute,
			additionalFields,
			urlTransformation,
			transformationType,
			pageNumber,
			debug: debugMode
		}
	);

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
	}

	// Apply filters if needed
	let filteredItems = items;
	if (filterItems && filterCriteria.length > 0) {
		this.logger.info(
			formatOperationLog(
				'Collector',
				nodeName,
				nodeId,
				index,
				`Applying filters (${filterLogic}) to ${items.length} items`
			)
		);

		// Log filter criteria for debugging
		if (debugMode) {
			this.logger.info(
				formatOperationLog(
					'Collector',
					nodeName,
					nodeId,
					index,
					`Filter criteria: ${JSON.stringify(filterCriteria)}`
				)
			);
		}

		// Filter items directly based on the extracted data
		filteredItems = items.filter((item: IDataObject) => {
			// Process each filter criterion
			const results = filterCriteria.map((criterion: IDataObject) => {
				const fieldName = criterion.fieldName as string || criterion.name as string || (criterion.selector as string); // Use explicit field name, then name, then selector
				const condition = criterion.condition as string;
				const value = criterion.value as string;
				const caseSensitive = criterion.caseSensitive as boolean;

				// Get the field value from the item
				let itemValue = '';

				// First try exact match on the field name
				if (item[fieldName] !== undefined) {
					itemValue = String(item[fieldName] || '');
				} else {
					// Try case-insensitive match on any property
					const lowerFieldName = fieldName.toLowerCase();
					for (const key of Object.keys(item)) {
						if (key.toLowerCase() === lowerFieldName) {
							itemValue = String(item[key] || '');
							break;
						}
					}
				}

				if (debugMode) {
					console.log(`[Filter Debug] Item: ${JSON.stringify(item)}, Field: ${fieldName}, Value: ${itemValue}, Condition: ${condition}, Filter value: ${value}`);
				}

				// Handle empty values
				if (itemValue === undefined || itemValue === null) {
					itemValue = '';
				}

				// Normalize case if needed
				let compareValue = value;
				let compareItemValue = itemValue;

				if (!caseSensitive) {
					compareValue = value.toLowerCase();
					compareItemValue = itemValue.toLowerCase();
				}

				// Apply the condition
				switch (condition) {
					case 'contains':
						if (compareValue.includes(',')) {
							// Split by comma and check if any value is included
							const valuesToCheck = compareValue.split(',').map(v => v.trim());
							return valuesToCheck.some(val => compareItemValue.includes(val));
						}
						return compareItemValue.includes(compareValue);
					case 'notContains':
						if (compareValue.includes(',')) {
							// Split by comma and check that none of the values are included
							const valuesToCheck = compareValue.split(',').map(v => v.trim());
							return valuesToCheck.every(val => !compareItemValue.includes(val));
						}
						return !compareItemValue.includes(compareValue);
					case 'equals':
						return compareItemValue === compareValue;
					case 'startsWith':
						return compareItemValue.startsWith(compareValue);
					case 'endsWith':
						return compareItemValue.endsWith(compareValue);
					case 'regex':
						try {
							const regex = new RegExp(value, caseSensitive ? '' : 'i');
							return regex.test(itemValue);
						} catch (error) {
							console.error(`Invalid regex: ${value}`);
							return false;
						}
					case 'exists':
						return itemValue !== '';
					case 'notExists':
						return itemValue === '';
					default:
						return false;
				}
			});

			// Apply the filter logic
			if (filterLogic === 'and') {
				return results.every(Boolean);
			} else {
				return results.some(Boolean);
			}
		});

		this.logger.info(
			formatOperationLog(
				'Collector',
				nodeName,
				nodeId,
				index,
				`Filter applied: ${filteredItems.length} items passed the filter out of ${items.length} total`
			)
		);

		// Debug log the filtered items
		if (debugMode) {
			if (filteredItems.length > 0) {
				this.logger.info(
					formatOperationLog(
						'Collector',
						nodeName,
						nodeId,
						index,
						`First filtered item sample: ${JSON.stringify(filteredItems[0])}`
					)
				);
			} else {
				this.logger.info(
					formatOperationLog(
						'Collector',
						nodeName,
						nodeId,
						index,
						`No items passed the filter`
					)
				);
			}
		}
	}

	return filteredItems;
}
