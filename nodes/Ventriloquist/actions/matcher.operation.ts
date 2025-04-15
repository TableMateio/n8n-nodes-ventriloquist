import {
	IDataObject,
	IExecuteFunctions,
	INodeExecutionData,
	INodeProperties,
	IWebhookResponseData,
	Logger as ILogger,
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
	IEntityMatcherOutput
} from "../utils/middlewares/types/entityMatcherTypes";
import { ComparisonAlgorithm } from '../utils/comparisonUtils';
import { IBrowserSession } from '../utils/sessionManager';
import { EntityMatcherMiddleware } from '../utils/middlewares/matching/entityMatcherMiddleware';
import { INodeType } from 'n8n-workflow';
import type { Page } from 'puppeteer-core';
import {
	smartWaitForSelector,
	detectElement,
	IDetectionOptions,
	IDetectionResult
} from '../utils/detectionUtils';
import { elementExists } from '../utils/navigationUtils';

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
		displayName: "Results",
		name: "matchResultType",
		type: "options",
		options: [
			{
				name: "Best Match",
				value: "best",
				description: "Return only the top match"
			},
			{
				name: "Multiple Matches",
				value: "multiple",
				description: "Return multiple matches based on configuration"
			},
		],
		default: "best",
		description: "How many results to return from the matcher",
		displayOptions: {
			show: {
				operation: ["matcher"],
			},
		},
	},
	{
		displayName: "Multiple Match Selection",
		name: "multipleMatchSelection",
		type: "options",
		options: [
			{
				name: "Top N Results",
				value: "topN",
				description: "Return a specific number of top matches"
			},
			{
				name: "All Above Threshold",
				value: "allAboveThreshold",
				description: "Return all matches above a specified threshold"
			},
		],
		default: "topN",
		description: "How to select multiple matches",
		displayOptions: {
			show: {
				operation: ["matcher"],
				matchResultType: ["multiple"],
			},
		},
	},
	{
		displayName: "Number of Results",
		name: "topNResults",
		type: "number",
		default: 3,
		description: "Maximum number of top matches to return",
		displayOptions: {
			show: {
				operation: ["matcher"],
				matchResultType: ["multiple"],
				multipleMatchSelection: ["topN"],
			},
		},
	},
	{
		displayName: "Limit Candidates Compared",
		name: "limitCandidatesCompared",
		type: "boolean",
		default: false,
		description: "Whether to limit the number of candidates to compare",
		displayOptions: {
			show: {
				operation: ["matcher"],
			},
		},
	},
	{
		displayName: "Maximum Candidates",
		name: "maxCandidates",
		type: "number",
		default: 10,
		description: "Maximum number of candidates to evaluate for matches",
		displayOptions: {
			show: {
				operation: ["matcher"],
				limitCandidatesCompared: [true],
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
		placeholder: "ol.co_searchResult_list",
		description: "CSS selector for the container holding all potential matches",
		displayOptions: {
			show: {
				operation: ["matcher"],
				selectionMethod: ["containerItems"],
			},
		},
	},
	{
		displayName: "Items Selector",
		name: "itemSelector",
		type: "string",
		default: "",
		placeholder: "li",
		description: "CSS selector for individual items within the container (leave empty to auto-detect children)",
		displayOptions: {
			show: {
				operation: ["matcher"],
				selectionMethod: ["containerItems"],
			},
			hide: {
				autoDetectChildren: [true],
			},
		},
	},
	{
		displayName: "Auto-Detect Children",
		name: "autoDetectChildren",
		type: "boolean",
		default: true,
		description: "Automatically detect children of the container element",
		displayOptions: {
			show: {
				operation: ["matcher"],
				selectionMethod: ["containerItems"],
			},
		},
	},
	{
		displayName: "Items Selector",
		name: "directItemSelector",
		type: "string",
		default: "",
		placeholder: "ol.co_searchResult_list > li",
		description: "CSS selector that directly selects all items to compare",
		displayOptions: {
			show: {
				operation: ["matcher"],
				selectionMethod: ["directItems"],
			},
		},
	},
	{
		displayName: "Wait for Elements",
		name: "waitForSelector",
		type: "boolean",
		default: true,
		description: "Wait for the selectors to appear before attempting extraction",
		displayOptions: {
			show: {
				operation: ["matcher"],
			},
		},
	},
	{
		displayName: "Selector Timeout (Ms)",
		name: "selectorTimeout",
		type: "number",
		default: 10000,
		description: "Maximum time to wait for selectors to appear (in milliseconds)",
		displayOptions: {
			show: {
				operation: ["matcher"],
				waitForSelector: [true],
			},
		},
	},

	// ==================== 3. COMPARISON CRITERIA ====================
	{
		displayName: "Comparison Criteria",
		name: "comparisonCriteria",
		placeholder: "Add Match Criterion",
		type: "fixedCollection",
		typeOptions: {
			multipleValues: true,
		},
		default: {},
		options: [
			{
				name: "values",
				displayName: "Match Criteria",
				values: [
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
								name: "Rule",
								value: "ruleBased",
								description: "Use exact rules like contains, starts with, regex, etc",
							},
							{
								name: "AI",
								value: "ai",
								description: "Use AI to determine if items match semantically",
							},
						],
						default: "similarity",
						description: "Method to use for this match criterion",
					},
					// SIMILARITY METHOD FIELDS
					{
						displayName: "Matching Approach",
						name: "matchingApproach",
						type: "options",
						options: [
							{
								name: "Smart Match (All Text)",
								value: "smart",
								description: "Automatically extract all text from the element and match intelligently",
							},
							{
								name: "Match All Element Text",
								value: "all",
								description: "Use all text from the element with specific format handling",
							},
							{
								name: "Select Specific Element",
								value: "specific",
								description: "Choose a specific sub-element to extract text from",
							},
						],
						default: "smart",
						description: "How to extract text from the element for comparison",
						displayOptions: {
							show: {
								matchMethod: ["similarity"],
							},
						},
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
								description: "Address format",
							},
						],
						default: "text",
						description: "Data format for comparison",
						displayOptions: {
							show: {
								matchMethod: ["similarity"],
								matchingApproach: ["all", "specific"],
							},
						},
					},
					{
						displayName: "Reference Value",
						name: "referenceValue",
						type: "string",
						default: "",
						description: "Value to compare against (typically from input data)",
						displayOptions: {
							show: {
								matchMethod: ["similarity"],
							},
						},
					},
					{
						displayName: "Sub-Item Selector to Compare",
						name: "selector",
						type: "string",
						default: "",
						placeholder: "h3 a, .title, .name",
						description: "CSS selector to extract data from within each item",
						displayOptions: {
							show: {
								matchMethod: ["similarity"],
								matchingApproach: ["specific"],
							},
						},
					},
					{
						displayName: "Output",
						name: "outputFormat",
						type: "options",
						options: [
							{
								name: "Smart Extraction",
								value: "smart",
								description: "Gets all text within HTML objects and child elements",
							},
							{
								name: "Text",
								value: "text",
								description: "Extract plain text content",
							},
							{
								name: "HTML Object",
								value: "html",
								description: "Extract HTML structure",
							},
							{
								name: "JSON",
								value: "json",
								description: "Extract structured JSON data",
							},
						],
						default: "smart",
						description: "How to extract and process content from the element",
						displayOptions: {
							show: {
								matchMethod: ["similarity"],
								matchingApproach: ["specific"],
							},
						},
					},
					{
						displayName: "Similarity Algorithm",
						name: "comparisonType",
						type: "options",
						options: [
							{
								name: "Basic Text Comparison (Levenshtein)",
								value: "levenshtein",
								description: "Standard text comparison based on character differences",
							},
							{
								name: "Flexible Matching (Fuzzy)",
								value: "fuzzy",
								description: "Finds similar text even with typos or small variations",
							},
							{
								name: "Meaning-Based Matching (Semantic)",
								value: "semantic",
								description: "Compares the meaning of text rather than exact characters",
							},
						],
						default: "levenshtein",
						description: "Algorithm to use for similarity comparison",
						displayOptions: {
							show: {
								matchMethod: ["similarity"],
							},
						},
					},
					{
						displayName: "Match Threshold",
						name: "threshold",
						type: "number",
						typeOptions: {
							minValue: 0,
							maxValue: 1,
						},
						default: 0.7,
						description: "Minimum similarity score required for this criterion (0-1)",
						displayOptions: {
							show: {
								matchMethod: ["similarity"],
							},
						},
					},
					{
						displayName: "Must Match",
						name: "mustMatch",
						type: "boolean",
						default: false,
						description: "Whether this criterion must match for an overall successful result",
						displayOptions: {
							show: {
								matchMethod: ["similarity"],
							},
						},
					},
					{
						displayName: "Importance",
						name: "weight",
						type: "number",
						typeOptions: {
							minValue: 0,
							maxValue: 1,
						},
						default: 0.5,
						description: "How important this criterion is (0 = least important, 1 = most important)",
						displayOptions: {
							show: {
								matchMethod: ["similarity"],
							},
						},
					},

					// RULE-BASED METHOD FIELDS
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
								description: "Address format",
							},
						],
						default: "text",
						description: "Data format for comparison",
						displayOptions: {
							show: {
								matchMethod: ["ruleBased"],
							},
						},
					},
					{
						displayName: "Reference Value",
						name: "referenceValue",
						type: "string",
						default: "",
						description: "Value to compare against (typically from input data)",
						displayOptions: {
							show: {
								matchMethod: ["ruleBased"],
							},
						},
					},
					{
						displayName: "Rule Type",
						name: "ruleType",
						type: "options",
						options: [
							{
								name: "Exact Match",
								value: "exact",
								description: "Element text exactly matches reference value",
							},
							{
								name: "Contains",
								value: "contains",
								description: "Element text contains the reference value",
							},
							{
								name: "Starts With",
								value: "startsWith",
								description: "Element text starts with reference value",
							},
							{
								name: "Ends With",
								value: "endsWith",
								description: "Element text ends with reference value",
							},
							{
								name: "Regex",
								value: "regex",
								description: "Reference value is a regex pattern to test against element text",
							},
						],
						default: "exact",
						description: "Type of rule to apply",
						displayOptions: {
							show: {
								matchMethod: ["ruleBased"],
								dataFormat: ["text", "address"],
							},
						},
					},
					{
						displayName: "Rule Type",
						name: "ruleType",
						type: "options",
						options: [
							{
								name: "Equal To",
								value: "equal",
								description: "Element value equals reference value",
							},
							{
								name: "Greater Than",
								value: "greaterThan",
								description: "Element value is greater than reference value",
							},
							{
								name: "Less Than",
								value: "lessThan",
								description: "Element value is less than reference value",
							},
							{
								name: "Greater Than or Equal",
								value: "greaterThanEqual",
								description: "Element value is greater than or equal to reference value",
							},
							{
								name: "Less Than or Equal",
								value: "lessThanEqual",
								description: "Element value is less than or equal to reference value",
							},
						],
						default: "equal",
						description: "Type of numeric comparison to apply",
						displayOptions: {
							show: {
								matchMethod: ["ruleBased"],
								dataFormat: ["number"],
							},
						},
					},
					{
						displayName: "Rule Type",
						name: "ruleType",
						type: "options",
						options: [
							{
								name: "Equal To",
								value: "equal",
								description: "Element date equals reference date",
							},
							{
								name: "After",
								value: "after",
								description: "Element date is after reference date",
							},
							{
								name: "Before",
								value: "before",
								description: "Element date is before reference date",
							},
							{
								name: "Same or After",
								value: "sameOrAfter",
								description: "Element date is same as or after reference date",
							},
							{
								name: "Same or Before",
								value: "sameOrBefore",
								description: "Element date is same as or before reference date",
							},
						],
						default: "equal",
						description: "Type of date comparison to apply",
						displayOptions: {
							show: {
								matchMethod: ["ruleBased"],
								dataFormat: ["date"],
							},
						},
					},
					{
						displayName: "Sub-Item Selector to Compare",
						name: "selector",
						type: "string",
						default: "",
						placeholder: "h3 a, .title, .name",
						description: "CSS selector to extract data from within each item",
						displayOptions: {
							show: {
								matchMethod: ["ruleBased"],
							},
						},
					},
					{
						displayName: "Must Match",
						name: "mustMatch",
						type: "boolean",
						default: false,
						description: "Whether this criterion must match for an overall successful result",
						displayOptions: {
							show: {
								matchMethod: ["ruleBased"],
							},
						},
					},
					{
						displayName: "Importance",
						name: "weight",
						type: "number",
						typeOptions: {
							minValue: 0,
							maxValue: 1,
						},
						default: 0.5,
						description: "How important this criterion is (0 = least important, 1 = most important)",
						displayOptions: {
							show: {
								matchMethod: ["ruleBased"],
							},
						},
					},
					{
						displayName: "Numeric Tolerance",
						name: "tolerance",
						type: "number",
						default: 0.01,
						description: "Tolerance for numeric comparison (e.g., 0.01 = ±1%)",
						displayOptions: {
							show: {
								matchMethod: ["ruleBased"],
								dataFormat: ["number"],
							},
						},
					},
					{
						displayName: "Date Tolerance (Days)",
						name: "dateTolerance",
						type: "number",
						default: 0,
						description: "Tolerance in days for date comparison",
						displayOptions: {
							show: {
								matchMethod: ["ruleBased"],
								dataFormat: ["date"],
							},
						},
					},

					// AI-POWERED METHOD FIELDS
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
								description: "Address format",
							},
						],
						default: "text",
						description: "Data format for reference value",
						displayOptions: {
							show: {
								matchMethod: ["ai"],
							},
						},
					},
					{
						displayName: "AI Question",
						name: "referenceValue",
						type: "string",
						default: "",
						placeholder: "Does the person work in {{ $json.industry }}?",
						description: "Question for AI to determine if items match (can include expressions)",
						displayOptions: {
							show: {
								matchMethod: ["ai"],
							},
						},
					},
					{
						displayName: "Sub-Item Selector to Compare",
						name: "selector",
						type: "string",
						default: "",
						placeholder: "h3 a, .title, .name",
						description: "CSS selector to extract data from within each item",
						displayOptions: {
							show: {
								matchMethod: ["ai"],
							},
						},
					},
					{
						displayName: "Must Match",
						name: "mustMatch",
						type: "boolean",
						default: false,
						description: "Whether this criterion must match for an overall successful result",
						displayOptions: {
							show: {
								matchMethod: ["ai"],
							},
						},
					},
					{
						displayName: "Importance",
						name: "weight",
						type: "number",
						typeOptions: {
							minValue: 0,
							maxValue: 1,
						},
						default: 0.5,
						description: "How important this criterion is (0 = least important, 1 = most important)",
						displayOptions: {
							show: {
								matchMethod: ["ai"],
							},
						},
					},
				],
			},
		],
		description: "Criteria for matching and comparing elements",
		displayOptions: {
			show: {
				operation: ["matcher"],
			},
		},
	},

	// ==================== 4. ACTION HANDLING ====================
	{
		displayName: "Action Type",
		name: "actionType",
		type: "options",
		options: [
			{
				name: "Click",
				value: "click",
				description: "Click on an element within the matched item",
			},
			{
				name: "Extract",
				value: "extract",
				description: "Extract additional data from the matched item",
			},
			{
				name: "None",
				value: "none",
				description: "Just identify matches without taking action",
			},
		],
		default: "click",
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
		placeholder: "input.pr_createReport, .view-details",
		description: "CSS selector for the element to interact with",
		displayOptions: {
			show: {
				operation: ["matcher"],
				actionType: ["click", "extract"],
			},
		},
	},
	{
		displayName: "Attribute to Extract",
		name: "actionAttribute",
		type: "string",
		default: "",
		placeholder: "href, data-value",
		description: "Attribute to extract (leave empty for text content)",
		displayOptions: {
			show: {
				operation: ["matcher"],
				actionType: ["extract"],
			},
		},
	},
	{
		displayName: "Wait After Action",
		name: "waitAfterAction",
		type: "boolean",
		default: true,
		description: "Wait for navigation or new element to appear after action",
		displayOptions: {
			show: {
				operation: ["matcher"],
				actionType: ["click"],
			},
		},
	},
	{
		displayName: "Wait Time (Milliseconds)",
		name: "waitTime",
		type: "number",
		default: 5000,
		description: "Time to wait after action (in milliseconds)",
		displayOptions: {
			show: {
				operation: ["matcher"],
				actionType: ["click"],
				waitAfterAction: [true],
			},
		},
	},
	{
		displayName: "Wait for Selector",
		name: "waitSelector",
		type: "string",
		default: "",
		placeholder: ".confirmation, #details-content",
		description: "Wait for this selector to appear after action (leave empty to just wait for timeout)",
		displayOptions: {
			show: {
				operation: ["matcher"],
				actionType: ["click"],
				waitAfterAction: [true],
			},
		},
	},
	{
		displayName: "Take Screenshot",
		name: "takeScreenshot",
		type: "boolean",
		default: false,
		description: "Whether to take a screenshot during the matcher operation to help debug",
		displayOptions: {
			show: {
				operation: ["matcher"],
			},
		},
	},
	{
		displayName: "Continue On Fail",
		name: "continueOnFail",
		type: "boolean",
		default: true,
		description: "Whether to continue workflow execution even when the operation fails",
		displayOptions: {
			show: {
				operation: ["matcher"],
			},
		},
	},
	{
		displayName: 'Match Output Format',
		name: 'outputFormat',
		type: 'options',
		default: 'smart',
		description: 'Format to use for the extracted content when matching',
		options: [
			{
				name: 'Smart Extraction',
				value: 'smart',
				description: 'Use HTML for better matching but return cleaner text in results',
			},
			{
				name: 'Text',
				value: 'text',
				description: 'Extract plain text content only (textContent)',
			},
			{
				name: 'HTML',
				value: 'html',
				description: 'Extract HTML content (innerHTML)',
			},
		],
		displayOptions: {
			show: {
				operation: ["matcher"],
			},
		},
	},
];

/**
 * Builds a source entity from comparison criteria
 */
function buildSourceEntity(this: IExecuteFunctions, index: number): ISourceEntity {
	const sourceFields: Record<string, string | null | undefined> = {};

	// Extract fields from the comparisonCriteria parameter
	const criteria = this.getNodeParameter('comparisonCriteria.values', index, []) as IDataObject[];

	for (const criterion of criteria) {
		const name = criterion.selector as string;
		const value = criterion.referenceValue as string;
		if (name && value !== undefined) {
			// Use the selector as the field name to maintain traceability
			sourceFields[name] = value;
		}
	}

	return {
		fields: sourceFields,
		normalizationOptions: {},
	};
}

/**
 * Helper function to build extraction fields from comparison criteria
 */
function buildExtractionFields(this: IExecuteFunctions, index: number): Array<any> {
	// Get field extraction configurations from comparison criteria
	const criteria = this.getNodeParameter('comparisonCriteria.values', index, []) as IDataObject[];

	return criteria.map(criterion => {
		const matchMethod = criterion.matchMethod as string;
		let selector = criterion.selector as string;
		let attribute: string | undefined = undefined;

		// For similarity with smart approach, we don't need a selector
		if (matchMethod === 'similarity') {
			const matchingApproach = criterion.matchingApproach as string || 'smart';

			if (matchingApproach === 'smart' || matchingApproach === 'all') {
				// For smart and all approaches, we don't use a specific selector
				selector = '';
			}

			// For dataFormat=number or dataFormat=date, we need to convert the value
			const dataFormat = criterion.dataFormat as string;
			if ((dataFormat === 'number' || dataFormat === 'date') &&
				(matchingApproach === 'all' || matchingApproach === 'specific')) {
				attribute = dataFormat;
			}
		} else if (criterion.dataFormat === 'attribute') {
			attribute = criterion.attribute as string;
		}

		return {
			name: selector || 'fullItem', // Use 'fullItem' as a fallback name
			selector,
			attribute,
			weight: criterion.weight as number || 1,
			required: criterion.mustMatch as boolean,
		};
	});
}

/**
 * Builds extraction configuration from input parameters
 */
function buildExtractionConfig(this: IExecuteFunctions, index: number): IEntityMatcherExtractionConfig {
	// Get parameters for extraction
	const selectionMethod = this.getNodeParameter('selectionMethod', index, 'containerItems') as string;
	const autoDetectChildren = this.getNodeParameter('autoDetectChildren', index, false) as boolean;
	const waitForSelector = this.getNodeParameter('waitForSelector', index, true) as boolean;
	const timeout = this.getNodeParameter('timeout', index, 10000) as number;

	let resultsSelector: string;
	let itemSelector: string;

	// Get the appropriate selectors based on selection method
	if (selectionMethod === 'containerItems') {
		resultsSelector = this.getNodeParameter('resultsSelector', index, '') as string;
		itemSelector = autoDetectChildren ? '' : this.getNodeParameter('itemSelector', index, '') as string;
	} else {
		// For direct item selection, we'll use a dummy container selector (html or body)
		// and put the full selector in the itemSelector
		resultsSelector = 'body';
		itemSelector = this.getNodeParameter('directItemSelector', index, '') as string;
	}

	// Get comparison fields for extraction configuration
	const fields = buildExtractionFields.call(this, index);

	return {
		resultsSelector,
		itemSelector,
		fields,
		autoDetectChildren,
		waitForSelectors: waitForSelector,
		timeout,
	};
}

/**
 * Builds comparison configuration from input parameters
 */
function buildComparisonConfig(this: IExecuteFunctions, index: number): IEntityMatcherComparisonConfig {
	// Get match result type and selection
	const matchResultType = this.getNodeParameter('matchResultType', index, 'best') as 'best' | 'multiple';

	// Determine actual match mode based on match type and selection
	let matchMode: 'best' | 'all' | 'firstAboveThreshold';
	let matchesToReturn = 1;

	if (matchResultType === 'best') {
		matchMode = 'best';
	} else {
		const multipleMatchSelection = this.getNodeParameter('multipleMatchSelection', index, 'topN') as 'topN' | 'allAboveThreshold';
		if (multipleMatchSelection === 'topN') {
			matchMode = 'all'; // Use 'all' but limit the results count
			matchesToReturn = this.getNodeParameter('topNResults', index, 3) as number;
		} else {
			matchMode = 'all';
			matchesToReturn = 0; // 0 means return all that pass threshold
		}
	}

	// Get comparison criteria
	const criteria = this.getNodeParameter('comparisonCriteria.values', index, []) as IDataObject[];

	// Build field comparisons
	const fieldComparisons = criteria.map(criterion => {
		const matchMethod = criterion.matchMethod as string || 'similarity';

		// Determine which algorithm to use based on the match method
		let algorithm: ComparisonAlgorithm = 'levenshtein';

		if (matchMethod === 'similarity') {
			// Convert similarity methods to valid comparison algorithms
			const simType = criterion.comparisonType as string || 'levenshtein';
			algorithm = (simType === 'fuzzy' || simType === 'semantic')
				? 'levenshtein'
				: simType as ComparisonAlgorithm;
		} else if (matchMethod === 'ruleBased') {
			// Map rule types to comparison algorithms
			const ruleType = criterion.ruleType as string || 'exact';
			if (['exact', 'contains'].includes(ruleType)) {
				algorithm = ruleType as ComparisonAlgorithm;
			} else if (['numeric', 'date', 'startsWith', 'endsWith', 'regex'].includes(ruleType)) {
				algorithm = 'custom';
			} else {
				algorithm = 'exact';
			}
		} else if (matchMethod === 'ai') {
			algorithm = 'custom';
		}

		return {
			field: criterion.selector as string,
			algorithm,
			weight: criterion.weight as number || 1,
		};
	});

	// Use a default threshold since we removed the global threshold
	const defaultThreshold = 0.5;

	return {
		fieldComparisons,
		threshold: defaultThreshold,
		matchMode,
		limitResults: matchesToReturn,
		sortResults: true,
	};
}

/**
 * Builds action configuration from input parameters
 */
function buildActionConfig(this: IExecuteFunctions, index: number): IEntityMatcherActionConfig {
	// Get action parameters
	const actionType = this.getNodeParameter('actionType', index, 'click') as 'click' | 'extract' | 'none';
	const actionSelector = this.getNodeParameter('actionSelector', index, '') as string;
	const actionAttribute = this.getNodeParameter('actionAttribute', index, '') as string;
	const waitAfterAction = this.getNodeParameter('waitAfterAction', index, true) as boolean;
	const waitTime = this.getNodeParameter('waitTime', index, 5000) as number;
	const waitSelector = this.getNodeParameter('waitSelector', index, '') as string;

	return {
		action: actionType,
		actionSelector,
		actionAttribute,
		waitAfterAction,
		waitTime,
		waitSelector,
	};
}

/**
 * Get additional matcher configuration
 */
function getAdditionalMatcherConfig(this: IExecuteFunctions, index: number): any {
	const limitCandidatesCompared = this.getNodeParameter('limitCandidatesCompared', index, false) as boolean;
	const maxItemsToCompare = limitCandidatesCompared
		? this.getNodeParameter('maxCandidates', index, 10) as number
		: 0; // 0 means no limit

	// Always include scoring details
	const includeScoreDetails = true;

	// Get criteria for custom configurations
	const criteria = this.getNodeParameter('comparisonCriteria.values', index, []) as IDataObject[];

	// Extract per-field settings that don't fit in the standard interfaces
	const fieldSettings = criteria.map(criterion => {
		const matchMethod = criterion.matchMethod as string || 'similarity';

		// Get comparison type based on match method
		let comparisonType = '';
		let tolerance = 0.01;
		let outputFormat = 'smart';

		if (matchMethod === 'similarity') {
			comparisonType = criterion.comparisonType as string || 'levenshtein';

			// Set appropriate output format based on matching approach
			const matchingApproach = criterion.matchingApproach as string || 'smart';
			if (matchingApproach === 'smart') {
				outputFormat = 'smart';
			} else if (matchingApproach === 'all') {
				outputFormat = 'text';
			} else if (matchingApproach === 'specific') {
				outputFormat = criterion.outputFormat as string || 'smart';
			}

		} else if (matchMethod === 'ruleBased') {
			comparisonType = criterion.ruleType as string || 'exact';

			// Use appropriate tolerance based on data format
			const dataFormat = criterion.dataFormat as string || 'text';
			if (dataFormat === 'number') {
				tolerance = criterion.tolerance as number || 0.01;
			} else if (dataFormat === 'date') {
				tolerance = criterion.dateTolerance as number || 0;
			}
		} else {
			comparisonType = matchMethod;
		}

		return {
			field: criterion.selector as string || 'fullItem',
			threshold: criterion.threshold as number || 0.7,
			tolerance,
			dataFormat: criterion.dataFormat as string || 'text',
			required: criterion.mustMatch as boolean || false,
			matchMethod,
			comparisonType,
			outputFormat,
			matchingApproach: criterion.matchingApproach as string || 'smart',
		};
	});

	return {
		maxItems: maxItemsToCompare,
		fieldSettings,
		includeScoreDetails,
	};
}

/**
 * Build the complete entity matcher configuration
 */
function buildEntityMatcherConfig(
	sourceEntity: ISourceEntity,
	extractionConfig: IEntityMatcherExtractionConfig,
	comparisonConfig: IEntityMatcherComparisonConfig,
	actionConfig: IEntityMatcherActionConfig,
	additionalConfig: any
) {
	return {
		// Settings from input parameters
		resultsSelector: extractionConfig.resultsSelector,
		itemSelector: extractionConfig.itemSelector,
		waitForSelectors: extractionConfig.waitForSelectors,
		timeout: extractionConfig.timeout,
		autoDetectChildren: extractionConfig.autoDetectChildren,
		fields: extractionConfig.fields,
		sourceEntity: sourceEntity.fields,
		normalizationOptions: sourceEntity.normalizationOptions,
		fieldComparisons: comparisonConfig.fieldComparisons,
		threshold: comparisonConfig.threshold,
		sortResults: comparisonConfig.sortResults !== false,
		action: actionConfig.action || 'none',
		actionSelector: actionConfig.actionSelector,
		actionAttribute: actionConfig.actionAttribute,
		waitAfterAction: actionConfig.waitAfterAction,
		waitTime: actionConfig.waitTime,

		// Advanced items from additional config
		...additionalConfig,
	};
}

/**
 * Process match results to ensure proper data type conversion
 */
function processMatchResult(
	matchResult: any,
	fieldSettings: any[],
	logger: ILogger,
	logPrefix: string
): any {
	// If no match, return empty object
	if (!matchResult) {
		return null;
	}

	// Start with the regular fields
	const result: Record<string, any> = { ...matchResult.fields };

	// Add metadata about the match
	result._similarity = matchResult.overallSimilarity;
	result._matchIndex = matchResult.index;

	// Set the proper type for each field based on fieldSettings
	for (const setting of fieldSettings) {
		const fieldName = setting.field;
		const dataFormat = setting.dataFormat || 'text';

		// Skip if field is not present
		if (!(fieldName in result)) {
			continue;
		}

		// Get the raw value
		const rawValue = matchResult.fields[fieldName];

		// Convert based on data format
		try {
			if (dataFormat === 'number') {
				// Try to convert to number if not already a number
				if (typeof rawValue !== 'number') {
					// Use a more robust number extraction regex that handles different formats
					const numValue = rawValue !== undefined && rawValue !== null ?
						Number(String(rawValue).replace(/[^\d.-]/g, '')) : null;

					if (!isNaN(numValue as number)) {
						result[fieldName] = numValue;
						logger.debug(`${logPrefix} Converted field ${fieldName} to number: ${numValue}`);
					}
				}
			} else if (dataFormat === 'date') {
				// Try to convert to date if not already a Date
				if (typeof rawValue === 'string') {
					try {
						// Check if it's a date string
						const parsedDate = new Date(rawValue);
						// Check if the parsed date is valid (not Invalid Date)
						if (!isNaN(parsedDate.getTime())) {
							result[fieldName] = parsedDate.toISOString();
						}
					} catch (e) {
						// If conversion fails, return as is
						result[fieldName] = rawValue;
					}
				}
			} else if (dataFormat === 'boolean') {
				// Convert to boolean
				if (typeof rawValue !== 'boolean') {
					const strValue = String(rawValue).toLowerCase().trim();
					result[fieldName] = ['true', 'yes', '1', 'y', 'on'].includes(strValue);
				}
			}
		} catch (error) {
			logger.warn(`${logPrefix} Error converting field ${fieldName}: ${(error as Error).message}`);
		}
	}

	return result;
}

/**
 * Current version of applyResultTransformations function called by execute
 */
export function applyResultTransformations(
	results: any,
	additionalConfig: any,
	logger: ILogger,
	nodeName: string,
	nodeId: string
): INodeExecutionData {
	const now = new Date();
	const outputObj: IDataObject = {};
	const logPrefix = `[Matcher][${nodeName}][${nodeId}]`;

	// Calculate execution duration
	const startTime = additionalConfig.startTime || now.getTime();
	const executionDuration = now.getTime() - startTime;

	// Get source entity data for comparison details
	const sourceEntity = additionalConfig.sourceEntity || {};
	const fieldSettings = additionalConfig.fieldSettings || [];

	// Create detailed comparison information
	const comparisonDetails: IDataObject = {
		criteria: [] as IDataObject[],
		itemsFound: results?.itemsFound || results?.totalExtracted || 0,
		itemsCompared: results?.extractedItems?.length || 0,
		comparisonMethod: additionalConfig.comparisonMethod || 'smart',
		threshold: additionalConfig.threshold || 0.7,
		format: additionalConfig.outputFormat || 'smart',
		executionDuration
	};

	// Add all criteria used for comparison
	if (fieldSettings && fieldSettings.length > 0) {
		fieldSettings.forEach((setting: any) => {
			(comparisonDetails.criteria as IDataObject[]).push({
				field: setting.field,
				referenceValue: sourceEntity[setting.field] || '',
				matchMethod: setting.matchMethod || 'similarity',
				comparisonType: setting.comparisonType || 'levenshtein',
				weight: setting.weight || 1,
				required: setting.required || false,
				dataFormat: setting.dataFormat || 'text',
				outputFormat: setting.outputFormat || 'smart'
			});
		});
	}

	// Extract all comparison objects
	const comparisonObjects: IDataObject[] = [];

	// If we have extracted items, add them all to the comparison objects
	if (results?.extractedItems && results.extractedItems.length > 0) {
		results.extractedItems.forEach((item: any, index: number) => {
			// Create a comparison object with all details
			const compObj: IDataObject = {
				index,
				content: {
					fullText: item.fields?.__fullText?.substring(0, 300) || "No text content",
					fullHtml: item.fields?.__fullHtml?.substring(0, 300) || "No HTML content",
					outerHtml: item.fields?.__outerHtml?.substring(0, 300) || "No outer HTML"
				},
				extractedFields: {} as IDataObject,
				wasCompared: true
			};

			// Add all extracted fields except internal ones
			if (item.fields) {
				Object.entries(item.fields).forEach(([key, value]) => {
					if (!key.startsWith('__')) {
						(compObj.extractedFields as IDataObject)[key] = value as string | number | boolean | IDataObject | IDataObject[] | null;
					}
				});
			}

			// Add similarity scores if available
			if (results.matches && results.matches.find((m: any) => m.index === index)) {
				const match = results.matches.find((m: any) => m.index === index);
				compObj.similarity = match.overallSimilarity;
				compObj.fieldSimilarities = match.similarities || {};
				compObj.aboveThreshold = (match.overallSimilarity >= (additionalConfig.threshold || 0.7));
				compObj.selected = match.selected || false;
			} else {
				compObj.similarity = 0;
				compObj.aboveThreshold = false;
				compObj.selected = false;
			}

			comparisonObjects.push(compObj);
		});
	}
	// If we have additionalConfig.extractedItemsData, use that as fallback
	else if (additionalConfig.extractedItemsData && additionalConfig.extractedItemsData.length > 0) {
		additionalConfig.extractedItemsData.forEach((item: any, index: number) => {
			const compObj: IDataObject = {
				index,
				content: {
					textPreview: item.textPreview || "No text preview available",
					fields: item.fields || {}
				},
				similarity: item.similarity || 0,
				aboveThreshold: item.similarity >= (additionalConfig.threshold || 0.7),
				selected: false
			};

			if (item.similarities) {
				compObj.fieldSimilarities = item.similarities;
			}

			comparisonObjects.push(compObj);
		});
	}

	// If no results or matches, handle accordingly
	if (!results || !results.success) {
		outputObj.found = false;
		outputObj.containerFound = results?.containerFound || false;
		outputObj.itemsFound = results?.itemsFound || 0;
		outputObj.match = null;
		outputObj.allMatches = [];
		outputObj.similarity = 0;
		outputObj.count = 0;
		outputObj.reason = results?.error || 'No matching items found';

		// Add detailed comparison information
		outputObj.comparisonDetails = comparisonDetails;
		outputObj.comparisonObjects = comparisonObjects;

		// Add diagnostic information
		outputObj.matchDetails = {
			executionDuration,
			executedAt: now.toISOString(),
			containerFound: results?.containerFound || false,
			containerHtml: results?.containerHtml || '',
			diagnostics: {
				possibleIssues: [
					results?.containerFound ? 'No items matched the comparison criteria' : 'The container element was not found',
					'The selectors may be incorrect',
					'The page structure may have changed'
				],
				suggestions: [
					'Check the container and item selectors',
					'Try a more general selector',
					'Lower the match threshold'
				]
			}
		};

		// Add extracted items data if available for diagnostics
		if (additionalConfig.extractedItemsData) {
			(outputObj.matchDetails as IDataObject).extractedItems = additionalConfig.extractedItemsData;
		}

		// Add page info for diagnostics if available
		if (additionalConfig.pageInfo) {
			(outputObj.matchDetails as IDataObject).pageInfo = additionalConfig.pageInfo;
		}

		// Add execution duration
		outputObj.executionDuration = executionDuration;

		return {
			json: outputObj
		};
	}

	// Extract matches
	const matches = results.matches || [];

	// Process matches and add to output
	if (matches.length > 0) {
		// Process the best match (highest similarity)
		const bestMatch = matches[0];

		// Process the best match with type conversions
		const processedMatch = processMatchResult(bestMatch, fieldSettings, logger, logPrefix);

		// Build all matches for output
		const processedMatches = matches.map((match: any) =>
			processMatchResult(match, fieldSettings, logger, logPrefix)
		);

		outputObj.found = true;
		outputObj.containerFound = true;
		outputObj.itemsFound = results.itemsFound || results.totalExtracted || matches.length;
		outputObj.match = processedMatch;
		outputObj.allMatches = processedMatches;
		outputObj.similarity = bestMatch.overallSimilarity;
		outputObj.count = matches.length;

		// Add detailed comparison information
		outputObj.comparisonDetails = comparisonDetails;
		outputObj.comparisonObjects = comparisonObjects;

		// Add match details
		outputObj.matchDetails = {
			executionDuration,
			executedAt: now.toISOString(),
			containerFound: true,
			matchCount: matches.length,
			bestMatchSimilarity: bestMatch.overallSimilarity,
			itemsExtracted: results.itemsFound || results.totalExtracted || 0
		};

		logger.info(`${logPrefix} Successfully found ${matches.length} matches. Best match similarity: ${bestMatch.overallSimilarity}`);
	} else {
		// No matches found but container was found
		outputObj.found = false;
		outputObj.containerFound = true;
		outputObj.itemsFound = results.itemsFound || results.totalExtracted || 0;
		outputObj.match = null;
		outputObj.allMatches = [];
		outputObj.similarity = 0;
		outputObj.count = 0;
		outputObj.reason = 'Items were found but none matched the comparison criteria';

		// Add detailed comparison information
		outputObj.comparisonDetails = comparisonDetails;
		outputObj.comparisonObjects = comparisonObjects;

		// Add diagnostic information
		outputObj.matchDetails = {
			executionDuration,
			executedAt: now.toISOString(),
			containerFound: true,
			itemsExtracted: results.itemsFound || results.totalExtracted || 0,
			diagnostics: {
				possibleIssues: [
					'The threshold may be too high',
					'The comparison criteria may not match the content structure',
					'The extracted items may not contain the expected content'
				],
				suggestions: [
					'Lower the match threshold',
					'Check the comparison criteria fields',
					'Inspect the extracted items to verify content'
				]
			}
		};

		// Add extracted items data if available for diagnostics
		if (additionalConfig.extractedItemsData) {
			(outputObj.matchDetails as IDataObject).extractedItems = additionalConfig.extractedItemsData;
		}

		logger.warn(`${logPrefix} No matches found among ${results.itemsFound || results.totalExtracted || 0} extracted items`);
	}

	// Add page info for diagnostics if available
	if (additionalConfig.pageInfo) {
		(outputObj.matchDetails as IDataObject).pageInfo = additionalConfig.pageInfo;
	}

	// Add execution duration
	outputObj.executionDuration = executionDuration;

	return {
		json: outputObj
	};
}

/**
 * Execute the entity matcher operation
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

	// Added for better logging
	const nodeName = this.getNode().name;
	const nodeId = this.getNode().id;

	try {
		// Get parameters
		const explicitSessionId = this.getNodeParameter('explicitSessionId', index, '') as string;
		const takeScreenshot = this.getNodeParameter('takeScreenshot', index, false) as boolean;
		const continueOnFail = this.getNodeParameter('continueOnFail', index, false) as boolean;
		const waitForSelector = this.getNodeParameter('waitForSelector', index, true) as boolean;
		const timeout = this.getNodeParameter('timeout', index, 10000) as number;

		// Use the centralized session management
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
		sessionId = sessionResult.sessionId;

		// Try to get the page
		let page = sessionResult.page;
		if (!page) {
			const currentSession = SessionManager.getSession(sessionId);
			if (currentSession?.browser?.isConnected()) {
				page = await getActivePageFunc(currentSession.browser, this.logger) as unknown as Page;
			} else {
				throw new Error(
					"Could not get browser session or connection is closed"
				);
			}
		}

		if (!page) {
			throw new Error("Failed to get or create a page");
		}

		// Log debug information about the page state
		await logPageDebugInfo(
			page,
			this.logger,
			{
				operation: "Matcher",
				nodeName,
				nodeId,
				index,
			}
		);

		// Build configuration objects
		const sourceEntity = buildSourceEntity.call(this, index);
		const extractionConfig = buildExtractionConfig.call(this, index);

		// Verify container selector exists and is non-empty
		if (!extractionConfig.resultsSelector || extractionConfig.resultsSelector.trim() === '') {
			throw new Error("Container selector is empty. Please provide a valid CSS selector for the results container.");
		}

		// Add debug logging for extraction config
		this.logger.debug(
			`[Matcher][${nodeName}][${nodeId}] Extraction config:
			- Container selector: ${extractionConfig.resultsSelector}
			- Item selector: ${extractionConfig.itemSelector || '(None)'}
			- Auto-detect children: ${!!extractionConfig.autoDetectChildren}
			- Field count: ${extractionConfig.fields?.length || 0}
			- First field: ${extractionConfig.fields?.length > 0 ? JSON.stringify(extractionConfig.fields[0]) : 'N/A'}
			`
		);

		// Create detection options like in detect operation
		const detectionOptions: IDetectionOptions = {
			waitForSelectors: waitForSelector,
			selectorTimeout: timeout,
			detectionMethod: 'smart',
			earlyExitDelay: 500,
			nodeName,
			nodeId,
			index,
		};

		// Pre-check if container exists on the page using detection middleware
		const containerDetectionResult = await detectElement(
			page,
			extractionConfig.resultsSelector,
			detectionOptions,
			this.logger
		);

		this.logger.info(`[Matcher][${nodeName}][${nodeId}] Pre-check for container selector "${extractionConfig.resultsSelector}": ${containerDetectionResult.success ? 'FOUND' : 'NOT FOUND'}`);

		if (!containerDetectionResult.success) {
			// Let's try to get all available selectors on the page for diagnostic purposes
			const topSelectors = await page.evaluate(() => {
				const elements = Array.from(document.querySelectorAll('body > *'));
				return elements.slice(0, 5).map(el => {
					const tag = el.tagName.toLowerCase();
					const id = el.id ? `#${el.id}` : '';
					const classes = Array.from(el.classList).map(c => `.${c}`).join('');
					return `${tag}${id}${classes}`;
				});
			});

			this.logger.info(`[Matcher][${nodeName}][${nodeId}] Top-level selectors on the page that might help: ${JSON.stringify(topSelectors)}`);
		}

		const comparisonConfig = buildComparisonConfig.call(this, index);
		const actionConfig = buildActionConfig.call(this, index);
		const additionalConfig = getAdditionalMatcherConfig.call(this, index);

		// Add startTime to additionalConfig for accurate timing
		additionalConfig.startTime = startTime;

		// Store detection result in additionalConfig for use by the matcher
		additionalConfig.containerDetectionResult = containerDetectionResult;

		// Add page info for diagnostics
		try {
			additionalConfig.pageInfo = {
				url: await page.url(),
				title: await page.title(),
				contentSnapshot: await page.evaluate(() => document.body.innerHTML.substring(0, 500) + '...')
			};
		} catch (infoError) {
			this.logger.warn(`[Matcher][${nodeName}] Could not gather page info: ${(infoError as Error).message}`);
		}

		// Build combined config for the entity matcher
		const entityMatcherConfig = buildEntityMatcherConfig(
			sourceEntity,
			extractionConfig,
			comparisonConfig,
			actionConfig,
			additionalConfig
		);

		// Log complete configuration for debugging
		this.logger.debug(`[Matcher][${nodeName}][${nodeId}] Complete entityMatcherConfig: ${JSON.stringify(entityMatcherConfig)}`);

		// Add detailed logging for debugging
		this.logger.debug(
			`[Matcher][${nodeName}][${nodeId}] Entity matcher config:
			- Container selector: ${entityMatcherConfig.resultsSelector}
			- Item selector: ${entityMatcherConfig.itemSelector || '(None - using auto-detection)'}
			- Auto-detect children: ${!!(extractionConfig?.autoDetectChildren)}
			- Field count: ${entityMatcherConfig.fields?.length || 0}
			- Source entity fields: ${JSON.stringify(Object.keys(entityMatcherConfig.sourceEntity || {}))}
			`
		);

		// Verify selectors before execution
		this.logger.info(`[Matcher][${nodeName}] Starting match operation with container selector: ${entityMatcherConfig.resultsSelector}`);

		// Create entity matcher using the static factory method
		const entityMatcher = EntityMatcherFactory.create(
			page,
			entityMatcherConfig,
			{
				logger: this.logger,
				nodeName,
				nodeId,
				sessionId,
				index,
			}
		);

		// Execute the entity matcher
		try {
			this.logger.debug(`[Matcher][${nodeName}][${nodeId}] About to execute entity matcher`);
			const result = await entityMatcher.execute();
			this.logger.debug(`[Matcher][${nodeName}][${nodeId}] Entity matcher execution completed: success=${result.success}, matches=${result.matches?.length || 0}`);

			// Add explicit detection logs here
			if (result.containerFound) {
				this.logger.info(`[Matcher][${nodeName}][${nodeId}] Container found with selector: ${result.containerSelector}`);

				if (result.itemsFound && result.itemsFound > 0) {
					this.logger.info(`[Matcher][${nodeName}][${nodeId}] Extracted ${result.itemsFound} items`);

					// Collect extracted items data for debug output
					const extractedItemsData = [];
					if (result.matches && result.matches.length > 0) {
						this.logger.info(`[Matcher][${nodeName}][${nodeId}] Found ${result.matches.length} matches above threshold`);

						// Add match data to extracted items
						for (const match of result.matches) {
							extractedItemsData.push({
								index: match.index,
								textPreview: match.fields.__fullText?.substring(0, 100) || "No text preview available",
								fields: match.fields,
								similarity: match.overallSimilarity,
								similarities: match.similarities
							});
						}
					} else {
						this.logger.warn(`[Matcher][${nodeName}][${nodeId}] No items matched the comparison criteria`);

						// Try to collect text from the items even if no matches
						if (result.extractedItems && result.extractedItems.length > 0) {
							for (const item of result.extractedItems) {
								extractedItemsData.push({
									index: item.index,
									textPreview: item.fields?.__fullText?.substring(0, 100) || "No text preview available",
									fields: item.fields
								});
							}
						}
					}

					// Add to additionalConfig for output
					additionalConfig.extractedItemsData = extractedItemsData;
				} else {
					this.logger.warn(`[Matcher][${nodeName}][${nodeId}] Container found but no items could be extracted from it`);
				}
			} else {
				this.logger.warn(`[Matcher][${nodeName}][${nodeId}] Container not found with selector: ${result.containerSelector}`);
			}

			// Apply transformations to the results
			const returnData = applyResultTransformations(
				result,
				additionalConfig,
				this.logger,
				nodeName,
				nodeId
			);

			return returnData;
		} catch (error) {
			this.logger.error(`[Matcher][${nodeName}][${nodeId}] Error executing entity matcher: ${(error as Error).message}`);
			throw error;
		}
	} catch (error) {
		// Get operation parameters used in error handling
		const continueOnFail = this.getNodeParameter("continueOnFail", index, true) as boolean;
		const takeScreenshot = this.getNodeParameter("captureScreenshot", index, true) as boolean;

		// Try to get a page for error screenshot if possible
		let errorPage: Page | null = null;
		try {
			const currentSession = SessionManager.getSession(sessionId);
			if (currentSession?.browser?.isConnected()) {
				errorPage = await getActivePageFunc(currentSession.browser, this.logger) as unknown as Page;
			}
		} catch (getPageError) {
			this.logger.warn(
				`Could not get page for error screenshot: ${(getPageError as Error).message}`,
			);
		}

		// Use the standardized error response utility
		const errorResponse = await createErrorResponse({
			error: error as Error,
			operation: 'Matcher',
			sessionId,
			nodeId,
			nodeName,
			page: errorPage,
			logger: this.logger,
			takeScreenshot,
			startTime,
			additionalData: {}
		});

		if (!continueOnFail) {
			throw error;
		}

		// Return error as response with continue on fail
		return {
			json: errorResponse,
		};
	}
}
