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
		displayName: "Session Configuration",
		name: "sessionConfigSection",
		type: "notice",
		default: "",
		displayOptions: {
			show: {
				operation: ["matcher"],
			},
		},
	},
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
		displayName: "Match Configuration",
		name: "matchConfigSection",
		type: "notice",
		default: "",
		displayOptions: {
			show: {
				operation: ["matcher"],
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
		description: "CSS selector for the container holding all potential matches",
		displayOptions: {
			show: {
				operation: ["matcher"],
				selectionMethod: ["containerItems"],
			},
		},
	},
	{
		displayName: "Item Selector",
		name: "itemSelector",
		type: "string",
		default: "",
		placeholder: "li, .result-item",
		description: "CSS selector for individual items within the container (leave empty for auto-detection)",
		displayOptions: {
			show: {
				operation: ["matcher"],
				selectionMethod: ["containerItems"],
			},
		},
	},
	{
		displayName: "Auto-Detect Children",
		name: "autoDetectChildren",
		type: "boolean",
		default: true,
		description: "Automatically detect repeating child elements if no item selector is provided",
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
		displayName: "Match Results Mode",
		name: "matchMode",
		type: "options",
		options: [
			{
				name: "Best Match",
				value: "best",
				description: "Return only the best matching result",
			},
			{
				name: "All Above Threshold",
				value: "all",
				description: "Return all results above the similarity threshold",
			},
			{
				name: "First Above Threshold",
				value: "firstAboveThreshold",
				description: "Return the first result above the threshold",
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
		displayName: "Similarity Threshold",
		name: "threshold",
		type: "number",
		typeOptions: {
			minValue: 0,
			maxValue: 1,
		},
		default: 0.7,
		description: "Minimum similarity score (0-1) required for a match",
		displayOptions: {
			show: {
				operation: ["matcher"],
			},
		},
	},
	{
		displayName: "Maximum Items to Process",
		name: "maxItemsToProcess",
		type: "number",
		default: 0,
		description: "Maximum number of items to process (0 for all items)",
		displayOptions: {
			show: {
				operation: ["matcher"],
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

	// ==================== 3. COMPARISON CRITERIA ====================
	{
		displayName: "Comparison Criteria",
		name: "comparisonCriteriaSection",
		type: "notice",
		default: "",
		displayOptions: {
			show: {
				operation: ["matcher"],
			},
		},
	},
	{
		displayName: "Matching Approach",
		name: "matchingApproach",
		type: "options",
		options: [
			{
				name: "Smart Match (All Text)",
				value: "smartAll",
				description: "Compare using all visible text in the element",
			},
			{
				name: "Field by Field",
				value: "fieldByField",
				description: "Compare specific fields",
			},
		],
		default: "smartAll",
		description: "Approach to use for matching entities",
		displayOptions: {
			show: {
				operation: ["matcher"],
			},
		},
	},

	// Smart Match approach fields
	{
		displayName: "Reference Value",
		name: "referenceValue",
		type: "string",
		default: "",
		description: "The reference value to match against (usually from a previous node)",
		displayOptions: {
			show: {
				operation: ["matcher"],
				matchingApproach: ["smartAll"],
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
		],
		default: "smart",
		description: "Algorithm to use for calculating similarity",
		displayOptions: {
			show: {
				operation: ["matcher"],
				matchingApproach: ["smartAll"],
			},
		},
	},
	{
		displayName: "Match Threshold",
		name: "matchThreshold",
		type: "number",
		typeOptions: {
			minValue: 0,
			maxValue: 1,
		},
		default: 0.1,
		description: "Minimum score required for this specific match",
		displayOptions: {
			show: {
				operation: ["matcher"],
				matchingApproach: ["smartAll"],
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
				operation: ["matcher"],
				matchingApproach: ["smartAll"],
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
				operation: ["matcher"],
				matchingApproach: ["smartAll"],
			},
		},
	},

	// Field by Field approach fields
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
				operation: ["matcher"],
				matchingApproach: ["fieldByField"],
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

	// ==================== 4. ACTION HANDLING ====================
	{
		displayName: "Action Configuration",
		name: "actionConfigSection",
		type: "notice",
		default: "",
		displayOptions: {
			show: {
				operation: ["matcher"],
			},
		},
	},
	{
		displayName: "Action After Match",
		name: "action",
		type: "options",
		options: [
			{
				name: "None",
				value: "none",
				description: "Just return match results, don't perform any action",
			},
			{
				name: "Click",
				value: "click",
				description: "Click on the matched element",
			},
			{
				name: "Extract Data",
				value: "extract",
				description: "Extract additional data from the matched element",
			},
		],
		default: "none",
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
		placeholder: "a.details, button.select",
		description: "CSS selector for the element to click or extract from (relative to matched item)",
		displayOptions: {
			show: {
				operation: ["matcher"],
				action: ["click", "extract"],
			},
		},
	},
	{
		displayName: "Attribute to Extract",
		name: "actionAttribute",
		type: "string",
		default: "",
		placeholder: "href, data-ID",
		description: "Attribute to extract (leave empty for text content)",
		displayOptions: {
			show: {
				operation: ["matcher"],
				action: ["extract"],
			},
		},
	},
	{
		displayName: "Wait After Action",
		name: "waitAfterAction",
		type: "boolean",
		default: true,
		description: "Wait after performing the action",
		displayOptions: {
			show: {
				operation: ["matcher"],
				action: ["click"],
			},
		},
	},
	{
		displayName: "Wait Time (Ms)",
		name: "waitTime",
		type: "number",
		default: 5000,
		description: "How long to wait after action in milliseconds",
		displayOptions: {
			show: {
				operation: ["matcher"],
				action: ["click"],
				waitAfterAction: [true],
			},
		},
	},
	{
		displayName: "Wait for Selector",
		name: "waitSelector",
		type: "string",
		default: "",
		placeholder: "#details, .confirmation",
		description: "Wait for this selector to appear after action (empty to just wait for time)",
		displayOptions: {
			show: {
				operation: ["matcher"],
				action: ["click"],
				waitAfterAction: [true],
			},
		},
	},
];

/**
 * Entity Matcher execute function
 */
export async function execute(
	this: IExecuteFunctions,
	index: number,
	websocketEndpoint: string,
	workflowId: string
): Promise<INodeExecutionData> {
	const startTime = Date.now();
	const logPrefix = `[EntityMatcher][${this.getNode().name}]`;

	try {
		// Get input data
		const items = this.getInputData();

		// Get session ID (from parameter or input)
		const explicitSessionId = this.getNodeParameter('explicitSessionId', index, '') as string;
		let sessionId: string;

		if (explicitSessionId) {
			sessionId = explicitSessionId;
		} else if (items[index]?.json?.sessionId) {
			sessionId = items[index].json.sessionId as string;
		} else {
			sessionId = `session_${workflowId}`;
		}

		// Use the centralized session management
		const sessionResult = await SessionManager.getOrCreatePageSession(
			this.logger,
			{
				explicitSessionId: sessionId,
				websocketEndpoint,
				workflowId,
				operationName: "Matcher",
				nodeId: this.getNode().id,
				nodeName: this.getNode().name,
				index,
			},
		);
		sessionId = sessionResult.sessionId;

		// Get the page
		let page = sessionResult.page;
		if (!page) {
			const currentSession = SessionManager.getSession(sessionId);
			if (currentSession?.browser?.isConnected()) {
				page = await getActivePageFunc(currentSession.browser, this.logger);
			} else {
				throw new Error("Failed to get session or browser is disconnected");
			}
		}

		if (!page) {
			throw new Error("Failed to get or create a page");
		}

		// Log debug info about the page
		await logPageDebugInfo(page, this.logger, {
			operation: "Matcher",
			nodeName: this.getNode().name,
			nodeId: this.getNode().id,
			index,
		});

		// Create entity matcher configuration
		const matcherConfig = await buildEntityMatcherConfig.call(this, index);

		// Create matcher context
		const context = {
			logger: this.logger,
			nodeName: this.getNode().name,
			nodeId: this.getNode().id,
			sessionId,
			index,
		};

		// Create and execute the entity matcher
		const matcher = createEntityMatcher(page, matcherConfig, context);
		const result = await matcher.execute();

		const endTime = Date.now();
		const executionDuration = endTime - startTime;

		// Return the matching results with enhanced information
		return {
			json: {
				success: true,
				sessionId,
				matches: result.matches,
				selectedMatch: result.selectedMatch,
				matchCount: result.matches?.length || 0,
				hasMatch: !!result.selectedMatch,
				actionPerformed: result.actionPerformed || false,
				actionResult: result.actionResult,
				itemsFound: result.itemsFound,
				containerFound: result.containerFound,
				executionDuration,
				performance: {
					...result.timings,
					total: executionDuration // Use the full operation time
				},
				containerInfo: {
					containerSelector: result.containerSelector,
					itemSelector: result.itemSelector,
					containerFound: result.containerFound || false,
					itemsFound: result.itemsFound || 0
				}
			}
		};
	} catch (error) {
		const errorMessage = error instanceof Error ? error.message : String(error);
		const stack = error instanceof Error ? error.stack : undefined;
		this.logger.error(`${logPrefix} Error in matcher operation: ${errorMessage}`);

		if (stack) {
			this.logger.debug(`${logPrefix} Error stack: ${stack}`);
		}

		// Use proper error response format with extended error information
		return {
			json: {
				success: false,
				error: errorMessage,
				errorDetails: stack ? { message: errorMessage, stack } : undefined,
				executionDuration: Date.now() - startTime
			}
		};
	}
}

/**
 * Build the entity matcher configuration from node parameters
 */
async function buildEntityMatcherConfig(this: IExecuteFunctions, index: number): Promise<IEntityMatcherConfig> {
	// Get selection method and selectors
	const selectionMethod = this.getNodeParameter('selectionMethod', index, 'containerItems') as string;

	let resultsSelector = '';
	let itemSelector = '';

	if (selectionMethod === 'containerItems') {
		resultsSelector = this.getNodeParameter('resultsSelector', index, '') as string;
		itemSelector = this.getNodeParameter('itemSelector', index, '') as string;
	} else {
		// For direct items, use the direct selector but keep container selector empty
		itemSelector = this.getNodeParameter('directItemSelector', index, '') as string;
	}

	// Get auto-detection settings
	const autoDetectChildren = this.getNodeParameter('autoDetectChildren', index, true) as boolean;

	// Get timing settings
	const waitForSelectors = this.getNodeParameter('waitForSelectors', index, true) as boolean;
	const timeout = this.getNodeParameter('timeout', index, 10000) as number;

	// Get matching settings
	const matchMode = this.getNodeParameter('matchMode', index, 'best') as 'best' | 'all' | 'firstAboveThreshold';
	const limitResults = this.getNodeParameter('limitResults', index, 5) as number;
	const threshold = this.getNodeParameter('threshold', index, 0.7) as number;
	const maxItems = this.getNodeParameter('maxItemsToProcess', index, 0) as number;
	const outputFormat = this.getNodeParameter('outputFormat', index, 'smart') as 'text' | 'html' | 'smart';

	// Get advanced performance settings
	const performanceMode = this.getNodeParameter('performanceMode', index, 'balanced') as 'balanced' | 'speed' | 'accuracy';
	const debugMode = this.getNodeParameter('enableDetailedLogs', index, false) as boolean;

	// Get action configuration
	const action = this.getNodeParameter('action', index, 'none') as 'click' | 'extract' | 'none';
	const actionSelector = this.getNodeParameter('actionSelector', index, '') as string;
	const actionAttribute = this.getNodeParameter('actionAttribute', index, '') as string;
	const waitAfterAction = this.getNodeParameter('waitAfterAction', index, true) as boolean;
	const waitTime = this.getNodeParameter('waitTime', index, 5000) as number;
	const waitSelector = this.getNodeParameter('waitSelector', index, '') as string;

	// Build source entity and field comparisons based on matching approach
	const matchingApproach = this.getNodeParameter('matchingApproach', index, 'smartAll') as string;

	let sourceEntity: Record<string, string | null | undefined> = {};
	let fieldComparisons: IFieldComparisonConfig[] = [];
	let fields: Array<any> = [];

	if (matchingApproach === 'smartAll') {
		// For smart matching, we use a single reference value
		const referenceValue = this.getNodeParameter('referenceValue', index, '') as string;
		sourceEntity = { text: referenceValue };

		// Get the comparison algorithm
		const algorithm = this.getNodeParameter('similarityAlgorithm', index, 'smart') as ComparisonAlgorithm;
		const matchThreshold = this.getNodeParameter('matchThreshold', index, 0.1) as number;
		const mustMatch = this.getNodeParameter('mustMatch', index, false) as boolean;
		const importance = this.getNodeParameter('importance', index, 0.5) as number;

		// Create a single field comparison for all text
		fieldComparisons = [
			{
				field: 'text',
				weight: importance,
				algorithm,
				threshold: matchThreshold,
				mustMatch,
			}
		];

		// For smart matching, create a field definition for extraction
		fields = [
			{
				name: 'text',
				selector: '',
				weight: importance,
				required: mustMatch,
				dataFormat: 'text'
			}
		];
	} else {
		// For field-by-field matching, get all field configurations
		const fieldComparisonsList = this.getNodeParameter('fieldComparisons.fields', index, []) as IDataObject[];

		// Build source entity and field comparisons from field list
		sourceEntity = {};
		fieldComparisons = [];
		fields = [];

		for (const field of fieldComparisonsList) {
			const fieldName = field.name as string;
			const referenceValue = field.referenceValue as string;
			const selector = field.selector as string;
			const algorithm = field.algorithm as ComparisonAlgorithm;
			const weight = field.weight as number;
			const mustMatch = field.mustMatch as boolean;
			const threshold = field.threshold as number;
			const attribute = field.attribute as string;

			// Add to source entity
			sourceEntity[fieldName] = referenceValue;

			// Add to field comparisons
			fieldComparisons.push({
				field: fieldName,
				weight,
				algorithm,
				threshold,
				mustMatch,
			});

			// Add to fields for extraction (separate from fieldComparisons)
			fields.push({
				name: fieldName,
				selector,
				attribute: attribute || undefined,
				weight,
				required: mustMatch,
				dataFormat: 'text'
			});
		}
	}

	// Build the complete config
	return {
		// Source entity data
		sourceEntity,

		// Selectors for finding results
		resultsSelector,
		itemSelector,

		// Field extraction configuration
		fields,

		// Matching configuration
		fieldComparisons,
		threshold,
		limitResults,
		matchMode,
		maxItems,

		// Auto-detection
		autoDetectChildren,

		// Action configuration
		action,
		actionSelector,
		actionAttribute,
		waitAfterAction,
		waitTime,
		waitSelector,

		// Timing configuration
		waitForSelectors,
		timeout,

		// Performance options
		performanceMode,
		debugMode,
	};
}
