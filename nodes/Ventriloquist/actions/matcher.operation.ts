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
		],
		default: "similarity",
		description: "Method to use for matching entities",
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
				matchMethod: ["similarity"],
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
				matchMethod: ["similarity"],
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
				operation: ["matcher"],
				matchMethod: ["similarity"],
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
				matchMethod: ["similarity"],
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
				matchMethod: ["similarity"],
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
				matchMethod: ["similarity"],
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
				matchMethod: ["similarity"],
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

	// Rules-based matching approach
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
				operation: ["matcher"],
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
						description: "Operation to perform",
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
