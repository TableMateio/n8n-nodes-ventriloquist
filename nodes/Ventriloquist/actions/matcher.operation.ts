import {
	IDataObject,
	IExecuteFunctions,
	INodeExecutionData,
	INodeProperties,
	IWebhookResponseData,
	Logger as ILogger,
	INodeType
} from "n8n-workflow";
import puppeteer from 'puppeteer-core';
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
	IEntityMatchResult,
	IEntityMatcherExtractionConfig,
	IEntityMatcherComparisonConfig,
	IEntityMatcherActionConfig,
	ISourceEntity,
	IEntityMatcherOutput,
	IExtractedItem,
	IExtractedField,
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

// Add this interface near the top of the file with the other interfaces
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

// Simple string similarity function to replace the external dependency
const stringSimilarity = (a: string, b: string): number => {
	if (a === b) return 1.0;
	if (a.length === 0 || b.length === 0) return 0.0;

	// Simple contains check
	if (a.toLowerCase().includes(b.toLowerCase())) return 0.9;
	if (b.toLowerCase().includes(a.toLowerCase())) return 0.7;

	// Count matching words
	const aWords = a.toLowerCase().split(/\s+/);
	const bWords = b.toLowerCase().split(/\s+/);
	let matches = 0;

	for (const word of aWords) {
		if (word.length <= 2) continue; // Skip very short words
		if (bWords.some(bWord => bWord.includes(word) || word.includes(bWord))) {
			matches++;
		}
	}

	return aWords.length > 0 ? matches / aWords.length : 0;
};

/**
 * Entity Matcher operation description
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
				operation: ["matcher"],
			},
		},
	},

	// ==================== 2. MATCH CONFIGURATION ====================
	{
		displayName: "Match Type",
		name: "matchMode",
		type: "options",
		options: [
			{
				name: "Find Best Match",
				value: "best",
				description: "Return only the best matching result",
			},
			{
				name: "Find All Matches",
				value: "all",
				description: "Return all results above their similarity thresholds",
			},
			{
				name: "Find First Match",
				value: "firstAboveThreshold",
				description: "Return the first result above its threshold",
			},
			{
				name: "Find N Matches",
				value: "nMatches",
				description: "Return a specific number of top matches",
			},
		],
		default: "best",
		description: "How to select and return matches",
		displayOptions: {
			show: {
				operation: ["matcher"],
			},
		},
	},
	{
		displayName: "Limit Number of Matches",
		name: "limitMatches",
		type: "boolean",
		default: false,
		description: "Whether to limit the number of matches to return",
		displayOptions: {
			show: {
				operation: ["matcher"],
				matchMode: ["nMatches"],
			},
		},
	},
	{
		displayName: "Number of Matches to Find",
		name: "maxMatches",
		type: "number",
		default: 5,
		description: "Maximum number of matches to return",
		displayOptions: {
			show: {
				operation: ["matcher"],
				matchMode: ["nMatches"],
				limitMatches: [true],
			},
		},
	},
	{
		displayName: "Selection Method",
		name: "selectionMethod",
		type: "options",
		options: [
			{
				name: "Container with Items",
				value: "containerItems",
				description: "Select a container element that contains multiple item elements",
			},
			{
				name: "Direct Item Selection",
				value: "directItems",
				description: "Select items directly with a single selector",
			},
		],
		default: "containerItems",
		description: "How to select elements to compare on the page",
		displayOptions: {
			show: {
				operation: ["matcher"],
			},
		},
	},
	{
		displayName: "Results Container Selector",
		name: "resultsSelector",
		type: "string",
		default: "",
		placeholder: "#search-results, .results-container",
		description: "CSS selector for the container holding all potential matches. Children will be auto-detected.",
		displayOptions: {
			show: {
				operation: ["matcher"],
				selectionMethod: ["containerItems"],
			},
		},
	},
	{
		displayName: "Direct Items Selector",
		name: "directItemSelector",
		type: "string",
		default: "",
		placeholder: "#search-results li, .results-container .result-item",
		description: "CSS selector that directly targets all items to compare",
		displayOptions: {
			show: {
				operation: ["matcher"],
				selectionMethod: ["directItems"],
			},
		},
	},
	{
		displayName: "Maximum Items to Process",
		name: "maxItemsToProcess",
		type: "number",
		default: 0,
		description: "Maximum number of items to process from the page (0 for all items)",
		displayOptions: {
			show: {
				operation: ["matcher"],
			},
		},
	},
	{
		displayName: "Wait for Elements",
		name: "waitForSelectors",
		type: "boolean",
		default: true,
		description: "Wait for selectors to be present in DOM before processing",
		displayOptions: {
			show: {
				operation: ["matcher"],
			},
		},
	},
	{
		displayName: "Selector Timeout (Ms)",
		name: "timeout",
		type: "number",
		default: 10000,
		description: "Maximum time to wait for selectors in milliseconds",
		displayOptions: {
			show: {
				operation: ["matcher"],
				waitForSelectors: [true],
			},
		},
	},
	{
		displayName: "Output Format",
		name: "outputFormat",
		type: "options",
		options: [
			{
				name: "Smart (Auto-Detect Best Format)",
				value: "smart",
				description: "Automatically detect the best format for each element",
			},
			{
				name: "Text Only",
				value: "text",
				description: "Extract only text content",
			},
			{
				name: "HTML",
				value: "html",
				description: "Include HTML structure",
			},
		],
		default: "smart",
		description: "How to format extracted content",
		displayOptions: {
			show: {
				operation: ["matcher"],
			},
		},
	},
	{
		displayName: "Performance Mode",
		name: "performanceMode",
		type: "options",
		options: [
			{
				name: "Balanced",
				value: "balanced",
				description: "Balance between accuracy and performance"
			},
			{
				name: "Speed",
				value: "speed",
				description: "Faster but may be less accurate (useful for large pages)"
			},
			{
				name: "Accuracy",
				value: "accuracy",
				description: "More thorough matching but may be slower"
			}
		],
		default: "balanced",
		description: "Controls the performance vs. accuracy tradeoff.",
		displayOptions: {
			show: {
				operation: ["matcher"],
			},
		},
	},
	{
		displayName: "Enable Detailed Logs",
		name: "enableDetailedLogs",
		type: "boolean",
		default: false,
		description: "Enable more detailed logging for debugging",
		displayOptions: {
			show: {
				operation: ["matcher"],
			},
		},
	},

	// ==================== 3. CRITERIA COLLECTION ====================
	{
		displayName: "Match Criteria",
		name: "matchCriteria",
		type: "fixedCollection",
		typeOptions: {
			multipleValues: true,
			sortable: true,
		},
		default: {
			criteria: [
				{
					name: "Default Criterion",
					comparisonApproach: "smartAll",
					referenceValue: "",
					matchMethod: "similarity",
					similarityAlgorithm: "smart",
					matchThreshold: 0.7,
					mustMatch: false,
					importance: 0.5,
				}
			]
		},
		description: "Define criteria to match items against",
		displayOptions: {
			show: {
				operation: ["matcher"],
			},
		},
		options: [
			{
				name: "criteria",
				displayName: "Criteria",
				values: [
					{
						displayName: "Criterion Name",
						name: "name",
						type: "string",
						default: "",
						description: "A name to identify this criterion",
					},
					{
						displayName: "Comparison Approach",
						name: "comparisonApproach",
						type: "options",
						options: [
							{
								name: "Smart Match (All Text)",
								value: "smartAll",
								description: "Intelligently compare using all visible text (best for simple matching)",
							},
							{
								name: "Match All",
								value: "matchAll",
								description: "Compare whole item using selected method",
							},
							{
								name: "Field by Field",
								value: "fieldByField",
								description: "Compare specific fields",
							},
						],
						default: "smartAll",
						description: "Approach to use for matching entities",
					},
					// Only show method for Match All and Field by Field
					{
						displayName: "Match Method",
						name: "matchMethod",
						type: "options",
						options: [
							{
								name: "Similarity",
								value: "similarity",
								description: "Compare using text similarity algorithms",
							},
							{
								name: "Rules",
								value: "rules",
								description: "Compare using exact rule-based methods",
							},
							{
								name: "AI (Coming Soon)",
								value: "ai",
								description: "Use AI to compare elements intelligently",
							},
						],
						default: "similarity",
						description: "Method to use for matching entities",
						displayOptions: {
							show: {
								comparisonApproach: ["matchAll", "fieldByField"],
							},
						},
					},
					// Smart Match (All) and Match All approach fields
					{
						displayName: "Reference Value",
						name: "referenceValue",
						type: "string",
						default: "",
						description: "The reference value to match against (usually from a previous node)",
						displayOptions: {
							show: {
								comparisonApproach: ["smartAll", "matchAll"],
							},
						},
					},
					{
						displayName: "Similarity Algorithm",
						name: "similarityAlgorithm",
						type: "options",
						options: [
							{
								name: "Smart (Combines Multiple Algorithms)",
								value: "smart",
								description: "Uses a combined approach for best results",
							},
							{
								name: "Containment (Reference in Target)",
								value: "containment",
								description: "Check if reference is contained within target",
							},
							{
								name: "Word Overlap (Jaccard)",
								value: "jaccard",
								description: "Best for comparing sets of keywords or terms",
							},
							{
								name: "Edit Distance (Levenshtein)",
								value: "levenshtein",
								description: "Best for comparing similar texts with small variations",
							},
							{
								name: "Exact Match",
								value: "exact",
								description: "Requires exact match between texts",
							},
							{
								name: "Flexible Matching (Fuzzy)",
								value: "fuzzy",
								description: "Flexible matching with fuzzy logic",
							},
						],
						default: "smart",
						description: "Algorithm to use for calculating similarity",
						displayOptions: {
							show: {
								comparisonApproach: ["smartAll", "matchAll"],
								matchMethod: ["similarity"],
							},
						},
					},
					{
						displayName: "Similarity Threshold",
						name: "matchThreshold",
						type: "number",
						typeOptions: {
							minValue: 0,
							maxValue: 1,
						},
						default: 0.7,
						description: "Minimum similarity score (0-1) required for this match criterion",
						displayOptions: {
							show: {
								comparisonApproach: ["smartAll", "matchAll"],
								matchMethod: ["similarity"],
							},
						},
					},
					{
						displayName: "Must Match",
						name: "mustMatch",
						type: "boolean",
						default: false,
						description: "If this criterion must match for the overall match to be valid",
						displayOptions: {
							show: {
								comparisonApproach: ["smartAll", "matchAll"],
								matchMethod: ["similarity"],
							},
						},
					},
					{
						displayName: "Importance",
						name: "importance",
						type: "number",
						typeOptions: {
							minValue: 0,
							maxValue: 1,
						},
						default: 0.5,
						description: "How important this criterion is in the overall match (0-1)",
						displayOptions: {
							show: {
								comparisonApproach: ["smartAll", "matchAll"],
								matchMethod: ["similarity"],
							},
						},
					},
					// Field by Field comparisons
					{
						displayName: "Field Comparisons",
						name: "fieldComparisons",
						type: "fixedCollection",
						typeOptions: {
							multipleValues: true,
							sortable: true,
						},
						default: {
							fields: [
								{
									name: "field1",
									referenceValue: "",
									selector: "",
									algorithm: "smart",
									weight: 0.5,
									mustMatch: false,
								}
							]
						},
						description: "Define field-by-field comparison criteria",
						displayOptions: {
							show: {
								comparisonApproach: ["fieldByField"],
								matchMethod: ["similarity"],
							},
						},
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
										placeholder: "e.g., name, price, location",
										description: "Name for this field comparison",
										required: true,
									},
									{
										displayName: "Reference Value",
										name: "referenceValue",
										type: "string",
										default: "",
										description: "The reference value to match (usually from previous node)",
										required: true,
									},
									{
										displayName: "Target Selector",
										name: "selector",
										type: "string",
										default: "",
										placeholder: "h3 a, .price, span.location",
										description: "CSS selector to extract the value to compare against",
										required: true,
									},
									{
										displayName: "Data Format",
										name: "dataFormat",
										type: "options",
										options: [
											{
												name: "Text",
												value: "text",
												description: "Plain text",
											},
											{
												name: "Number",
												value: "number",
												description: "Numeric value",
											},
											{
												name: "Date",
												value: "date",
												description: "Date value",
											},
											{
												name: "Address",
												value: "address",
												description: "Physical address",
											},
											{
												name: "Boolean",
												value: "boolean",
												description: "True/false value",
											},
										],
										default: "text",
										description: "The data type for this field",
									},
									{
										displayName: "Comparison Algorithm",
										name: "algorithm",
										type: "options",
										options: [
											{
												name: "Smart (Combines Multiple Algorithms)",
												value: "smart",
												description: "Uses a combined approach for best results",
											},
											{
												name: "Containment (Reference in Target)",
												value: "containment",
												description: "Check if reference is contained within target",
											},
											{
												name: "Word Overlap (Jaccard)",
												value: "jaccard",
												description: "Best for comparing sets of keywords or terms",
											},
											{
												name: "Edit Distance (Levenshtein)",
												value: "levenshtein",
												description: "Best for comparing similar texts with small variations",
											},
											{
												name: "Exact Match",
												value: "exact",
												description: "Requires exact match between texts",
											},
											{
												name: "Flexible Matching (Fuzzy)",
												value: "fuzzy",
												description: "Flexible matching with fuzzy logic",
											},
										],
										default: "smart",
										description: "Algorithm to use for calculating similarity",
									},
									{
										displayName: "Attribute",
										name: "attribute",
										type: "string",
										default: "",
										placeholder: "href, textContent, value",
										description: "Element attribute to extract (leave empty for text content)",
									},
									{
										displayName: "Weight",
										name: "weight",
										type: "number",
										typeOptions: {
											minValue: 0,
											maxValue: 1,
										},
										default: 0.5,
										description: "How important this field is in the overall match (0-1)",
									},
									{
										displayName: "Must Match",
										name: "mustMatch",
										type: "boolean",
										default: false,
										description: "If this field must match for the overall match to be valid",
									},
									{
										displayName: "Field Threshold",
										name: "threshold",
										type: "number",
										typeOptions: {
											minValue: 0,
											maxValue: 1,
										},
										default: 0.7,
										description: "Minimum similarity for this specific field to be considered a match",
									},
								],
							},
						],
					},
					// Rule-based matching
					{
						displayName: "Rules Configuration",
						name: "rulesConfig",
						type: "fixedCollection",
						typeOptions: {
							multipleValues: true,
							sortable: true,
						},
						default: {
							rules: [
								{
									field: "field1",
									operation: "contains",
									value: "",
									caseSensitive: false,
								}
							]
						},
						description: "Define rules for matching",
						displayOptions: {
							show: {
								comparisonApproach: ["matchAll", "fieldByField"],
								matchMethod: ["rules"],
							},
						},
						options: [
							{
								name: "rules",
								displayName: "Rules",
								values: [
									{
										displayName: "Field",
										name: "field",
										type: "string",
										default: "",
										description: "Field name to check",
										required: true,
									},
									{
										displayName: "Selector",
										name: "selector",
										type: "string",
										default: "",
										description: "CSS selector to target element",
										required: true,
									},
									{
										displayName: "Operation",
										name: "operation",
										type: "options",
										noDataExpression: true,
										options: [
											{
												name: "Contains",
												value: "contains",
												description: "Field contains the specified value",
											},
											{
												name: "Equals",
												value: "equals",
												description: "Field exactly equals the value",
											},
											{
												name: "Starts With",
												value: "startsWith",
												description: "Field starts with the value",
											},
											{
												name: "Ends With",
												value: "endsWith",
												description: "Field ends with the value",
											},
											{
												name: "Regex Match",
												value: "regex",
												description: "Field matches the regex pattern",
											},
										],
										default: "contains",
									},
									{
										displayName: "Value",
										name: "value",
										type: "string",
										default: "",
										description: "Value to compare against",
										required: true,
									},
									{
										displayName: "Case Sensitive",
										name: "caseSensitive",
										type: "boolean",
										default: false,
										description: "Match is case sensitive",
									},
									{
										displayName: "Required",
										name: "required",
										type: "boolean",
										default: false,
										description: "This rule must match for the overall match to be valid",
									},
								],
							},
						],
					},
				]
			}
		]
	},

	// Action Configuration section
	{
		displayName: "Action on Match",
		name: "actionOnMatch",
		type: "options",
		options: [
			{
				name: "None",
				value: "none",
				description: "Don't perform any action on matches",
			},
			{
				name: "Click",
				value: "click",
				description: "Click on the matched element",
			},
			{
				name: "Extract Additional Data",
				value: "extract",
				description: "Extract additional data from the matched element",
			},
		],
		default: "none",
		description: "Action to perform on matched elements",
		displayOptions: {
			show: {
				operation: ["matcher"],
			},
		},
	},
	{
		displayName: "Action Selector",
		name: "actionSelector",
		type: "string",
		default: "",
		placeholder: "button.details, a.view-more",
		description: "CSS selector for the element to interact with (leave empty to use the matched element)",
		displayOptions: {
			show: {
				operation: ["matcher"],
				actionOnMatch: ["click", "extract"],
			},
		},
	},
	{
		displayName: "Wait After Action",
		name: "waitAfterAction",
		type: "boolean",
		default: true,
		description: "Whether to wait after performing the action",
		displayOptions: {
			show: {
				operation: ["matcher"],
				actionOnMatch: ["click"],
			},
		},
	},
	{
		displayName: "Wait For",
		name: "waitFor",
		type: "options",
		options: [
			{
				name: "Navigation",
				value: "navigation",
				description: "Wait for navigation to complete",
			},
			{
				name: "DOM Content Loaded",
				value: "domContentLoaded",
				description: "Wait for DOM content loaded event",
			},
			{
				name: "Load Event",
				value: "load",
				description: "Wait for page load event",
			},
			{
				name: "Specific Element",
				value: "element",
				description: "Wait for a specific element to appear",
			},
			{
				name: "Network Idle",
				value: "networkIdle",
				description: "Wait for network to be idle",
			},
			{
				name: "Time Delay",
				value: "delay",
				description: "Wait for a specific time period",
			},
		],
		default: "navigation",
		description: "What to wait for after the action",
		displayOptions: {
			show: {
				operation: ["matcher"],
				actionOnMatch: ["click"],
				waitAfterAction: [true],
			},
		},
	},
	{
		displayName: "Wait Selector",
		name: "waitSelector",
		type: "string",
		default: "",
		placeholder: "#content, .results-loaded",
		description: "CSS selector to wait for (if waiting for element)",
		displayOptions: {
			show: {
				operation: ["matcher"],
				actionOnMatch: ["click"],
				waitAfterAction: [true],
				waitFor: ["element"],
			},
		},
	},
	{
		displayName: "Wait Timeout (ms)",
		name: "waitTimeout",
		type: "number",
		default: 30000,
		description: "Maximum wait time in milliseconds",
		displayOptions: {
			show: {
				operation: ["matcher"],
				actionOnMatch: ["click"],
				waitAfterAction: [true],
			},
		},
	},
	{
		displayName: "Wait Time (ms)",
		name: "waitTime",
		type: "number",
		default: 2000,
		description: "Time to wait in milliseconds",
		displayOptions: {
			show: {
				operation: ["matcher"],
				actionOnMatch: ["click"],
				waitAfterAction: [true],
				waitFor: ["delay"],
			},
		},
	},
];

/**
 * Execute the matcher operation
 */
export async function execute(
	this: IExecuteFunctions,
	index: number,
	websocketEndpoint: string,
	workflowId: string,
): Promise<INodeExecutionData> {
	// Record start time for execution duration tracking
	const startTime = Date.now();

	// Get parameters
	const selectionMethod = this.getNodeParameter('selectionMethod', index, 'containerItems') as string;
	const matchMode = this.getNodeParameter('matchMode', index, 'best') as string;

	// Handle different match modes
	let maxResults: number | undefined;
	if (matchMode === 'nMatches') {
		maxResults = this.getNodeParameter('maxMatches', index, 5) as number;
	} else if (matchMode === 'all') {
		const limitMatches = this.getNodeParameter('limitMatches', index, false) as boolean;
		if (limitMatches) {
			maxResults = this.getNodeParameter('maxMatches', index, 5) as number;
		}
	}

	const maxItemsToProcess = this.getNodeParameter('maxItemsToProcess', index, 0) as number;
	const outputFormat = this.getNodeParameter('outputFormat', index, 'smart') as string;
	const performanceMode = this.getNodeParameter('performanceMode', index, 'balanced') as string;
	const enableDetailedLogs = this.getNodeParameter('enableDetailedLogs', index, false) as boolean;

	// Get match criteria
	const matchCriteria = this.getNodeParameter('matchCriteria.criteria', index, []) as IDataObject[];
	if (matchCriteria.length === 0) {
		throw new Error('At least one match criterion is required');
	}

	let resultsSelector = '';
	let itemSelector = '';
	let autoDetectChildren = true; // Always auto-detect children for container
	let directItemSelector = '';

	if (selectionMethod === 'containerItems') {
		resultsSelector = this.getNodeParameter('resultsSelector', index, '') as string;
	} else {
		directItemSelector = this.getNodeParameter('directItemSelector', index, '') as string;
	}

	const waitForSelectors = this.getNodeParameter('waitForSelectors', index, true) as boolean;
	const timeout = waitForSelectors ? this.getNodeParameter('timeout', index, 10000) as number : 0;

	// Added for better logging
	const nodeName = this.getNode().name;
	const nodeId = this.getNode().id;

	// Visual marker to clearly indicate a new node is starting
	this.logger.info("============ STARTING NODE EXECUTION ============");
	this.logger.info(
		`[Ventriloquist][${nodeName}#${index}][Matcher][${nodeId}] Starting execution`,
	);

	// Check if an explicit session ID was provided
	const explicitSessionId = this.getNodeParameter(
		"explicitSessionId",
		index,
		"",
	) as string;

	// Get or create browser session
	let page: Page | null = null;
	let sessionId = "";

	try {
		// Use the centralized session management instead of duplicating code
		const sessionResult = await SessionManager.getOrCreatePageSession(
			this.logger,
			{
				explicitSessionId,
				websocketEndpoint,
				workflowId,
				operationName: "Matcher",
				nodeId,
				nodeName,
				index,
			},
		);

		page = sessionResult.page;
		sessionId = sessionResult.sessionId;

		if (!page) {
			throw new Error("Failed to get or create a page");
		}

		this.logger.info(
			`[Ventriloquist][${nodeName}#${index}][Matcher][${nodeId}] Starting matcher operation with method: ${selectionMethod}, match mode: ${matchMode}`,
		);

		// Initialize container info for debugging
		let containerInfo: IContainerInfo = {
			containerFound: false
		};

		// Wait for selectors if required
		if (waitForSelectors) {
			this.logger.info(
				`[Ventriloquist][${nodeName}#${index}][Matcher][${nodeId}] Waiting for selectors with timeout: ${timeout}ms`,
			);

			// Apply appropriate early exit delay based on performance mode
			const earlyExitDelay = performanceMode === 'speed' ? 100 :
				(performanceMode === 'accuracy' ? 500 : 250);

			if (selectionMethod === 'containerItems' && resultsSelector) {
				try {
					await smartWaitForSelector(
						page,
						resultsSelector,
						timeout,
						earlyExitDelay,
						this.logger,
						nodeName,
						nodeId
					);
					containerInfo.containerFound = true;

					// Get additional info about the container
					containerInfo = await page.evaluate((selector) => {
						const container = document.querySelector(selector);
						if (!container) return { containerFound: false };

						return {
							containerFound: true,
							tagName: container.tagName,
							className: container.className,
							childCount: container.childElementCount,
							documentState: {
								readyState: document.readyState,
								bodyChildCount: document.body.childElementCount
							}
						};
					}, resultsSelector);

					this.logger.info(
						`[Ventriloquist][${nodeName}#${index}][Matcher][${nodeId}] Container found: ${JSON.stringify(containerInfo)}`,
					);
				} catch (error) {
					this.logger.warn(
						`[Ventriloquist][${nodeName}#${index}][Matcher][${nodeId}] Error waiting for container: ${(error as Error).message}`,
					);
					containerInfo.containerFound = false;
				}
			} else if (selectionMethod === 'directItems' && directItemSelector) {
				try {
					await smartWaitForSelector(
						page,
						directItemSelector,
						timeout,
						earlyExitDelay,
						this.logger,
						nodeName,
						nodeId
					);
					containerInfo.containerFound = true;
				} catch (error) {
					this.logger.warn(
						`[Ventriloquist][${nodeName}#${index}][Matcher][${nodeId}] Error waiting for direct items: ${(error as Error).message}`,
					);
					containerInfo.containerFound = false;
				}
			}
		}

		// Create entity matcher configuration based on criteria
		let matcherConfig: IEntityMatcherConfig = {
			// Common configuration for all methods
			resultsSelector: selectionMethod === 'containerItems' ? resultsSelector : '',
			itemSelector: selectionMethod === 'containerItems' ? itemSelector : directItemSelector,
			autoDetectChildren,
			maxItems: maxItemsToProcess || undefined,
			outputFormat: outputFormat as 'text' | 'html' | 'smart',
			waitForSelectors,
			timeout,
			performanceMode: performanceMode as 'balanced' | 'speed' | 'accuracy',
			debugMode: enableDetailedLogs,
			threshold: 0.7, // Default threshold, will be overridden by criteria
			matchMode: matchMode === 'nMatches' ? 'best' : matchMode as 'best' | 'all' | 'firstAboveThreshold',
			limitResults: maxResults,
			sourceEntity: {},
			fieldComparisons: [],
			fields: [],
		};

		// Process the first criterion for basic info
		// More advanced handling for multiple criteria can be added
		if (matchCriteria.length > 0) {
			const firstCriterion = matchCriteria[0];
			const comparisonApproach = firstCriterion.comparisonApproach as string;
			const matchMethod = firstCriterion.matchMethod as string || 'similarity';

			if (matchMethod === 'similarity') {
				if (comparisonApproach === 'smartAll' || comparisonApproach === 'matchAll') {
					const referenceValue = firstCriterion.referenceValue as string;
					const similarityAlgorithm = firstCriterion.similarityAlgorithm as ComparisonAlgorithm || 'smart';
					const matchThreshold = firstCriterion.matchThreshold as number || 0.7;
					const mustMatch = firstCriterion.mustMatch as boolean || false;
					const importance = firstCriterion.importance as number || 0.5;

					// Configure for smart all-text comparison
					matcherConfig.sourceEntity = { text: referenceValue };
					matcherConfig.fieldComparisons = [{
						field: 'text',
						algorithm: similarityAlgorithm,
						weight: importance,
						mustMatch,
						threshold: matchThreshold
					}];

					// Use the criterion threshold as the main threshold
					matcherConfig.threshold = matchThreshold;
				} else if (comparisonApproach === 'fieldByField') {
					// Field by field comparison
					const fieldComparisonData = firstCriterion.fieldComparisons as IDataObject;
					const fieldComparisons = fieldComparisonData && typeof fieldComparisonData === 'object' &&
						fieldComparisonData.fields ? fieldComparisonData.fields as IDataObject[] : [];

					// Convert each field configuration
					matcherConfig.fieldComparisons = fieldComparisons.map(field => {
						// Create the field configuration with only valid properties
						const fieldConfig: IFieldComparisonConfig = {
							field: field.name as string,
							weight: (field.weight as number) || 0.5,
							algorithm: field.algorithm as ComparisonAlgorithm || 'smart',
							threshold: (field.threshold as number) || 0.7,
							mustMatch: (field.mustMatch as boolean) || false
						};
						return fieldConfig;
					});

					// Also store additional field metadata in the source entity
					const sourceEntityFields: Record<string, string> = {};
					fieldComparisons.forEach(field => {
						sourceEntityFields[field.name as string] = field.referenceValue as string;
					});
					matcherConfig.sourceEntity = sourceEntityFields;
				}
			} else if (matchMethod === 'rules') {
				// Rules-based matching
				const rulesConfigData = firstCriterion.rulesConfig as IDataObject;
				const rulesConfig = rulesConfigData && typeof rulesConfigData === 'object' &&
					rulesConfigData.rules ? rulesConfigData.rules as IDataObject[] : [];

				// Convert rule configurations and set fields
				matcherConfig.fields = rulesConfig.map(rule => ({
					name: rule.field as string,
					selector: rule.selector as string,
					operation: rule.operation as string,
					value: rule.value as string,
					caseSensitive: (rule.caseSensitive as boolean) || false,
					required: (rule.required as boolean) || false,
				}));
			}
		}

		// Handle action configuration if specified
		const actionOnMatch = this.getNodeParameter('actionOnMatch', index, 'none') as string;
		if (actionOnMatch !== 'none') {
			matcherConfig.action = actionOnMatch as 'click' | 'extract' | 'none';
			matcherConfig.actionSelector = this.getNodeParameter('actionSelector', index, '') as string;

			if (actionOnMatch === 'click') {
				const waitAfterAction = this.getNodeParameter('waitAfterAction', index, true) as boolean;
				matcherConfig.waitAfterAction = waitAfterAction;

				if (waitAfterAction) {
					// Add custom wait parameters to the config (not in the interface)
					const waitForValue = this.getNodeParameter('waitFor', index, 'navigation') as string;
					const waitTimeValue = this.getNodeParameter('waitTime', index, 2000) as number;

					// Set waitTime from interface
					matcherConfig.waitTime = waitTimeValue;

					// Handle waitSelector if needed
					if (waitForValue === 'element') {
						matcherConfig.waitSelector = this.getNodeParameter('waitSelector', index, '') as string;
					}

					// Add additional properties for custom handling in the execution
					(matcherConfig as any).waitFor = waitForValue;
				}
			}
		}

		// Create and execute entity matcher
		const entityMatcher = createEntityMatcher(
			page,
			matcherConfig,
			{
				logger: this.logger,
				nodeName,
				nodeId,
				sessionId,
				index
			}
		);

		const matchResults = await entityMatcher.execute();

		// Format results
		this.logger.info(
			`[Ventriloquist][${nodeName}#${index}][Matcher][${nodeId}] Operation completed with ${matchResults?.matches?.length || 0} matches`
		);

		// Return results
		return {
			json: {
				success: true,
				sessionId,
				containerInfo,
				results: matchResults,
				executionDuration: Date.now() - startTime,
			}
		};

	} catch (error: any) {
		this.logger.error(
			`[Ventriloquist][${nodeName}#${index}][Matcher][${nodeId}] Error: ${error.message}`,
		);

		if (page) {
			try {
				// Log additional page debug info
				await logPageDebugInfo(page, this.logger, {
					operation: 'matcher',
					nodeName,
					nodeId,
					index
				});
			} catch (debugError) {
				// Ignore debug errors
			}
		}

		// Return error response
		return {
			json: await createErrorResponse({
				error,
				operation: "matcher",
				sessionId,
				nodeId,
				nodeName,
				startTime,
				logger: this.logger,
				page
			})
		};
	}
}
