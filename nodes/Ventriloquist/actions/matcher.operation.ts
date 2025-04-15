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
import { smartWaitForSelector, detectElement } from '../utils/detectionUtils';

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
		displayName: "Selector Timeout (ms)",
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
						displayName: "Date Tolerance (days)",
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
		description: "Action to perform on matched items",
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
		displayName: "Wait Time (milliseconds)",
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
 * Builds extraction configuration from input parameters
 */
function buildExtractionConfig(this: IExecuteFunctions, index: number): IEntityMatcherExtractionConfig {
	// Get selection method and selectors
	const selectionMethod = this.getNodeParameter('selectionMethod', index, 'containerItems') as string;

	// Get basic selector parameters
	let resultsSelector = '';
	let itemSelector = '';
	let autoDetectChildren = false;

	if (selectionMethod === 'containerItems') {
		// Get container selector
		resultsSelector = this.getNodeParameter('resultsSelector', index, '') as string;

		// Get auto-detect parameter explicitly
		autoDetectChildren = this.getNodeParameter('autoDetectChildren', index, true) as boolean;
		this.logger.info(`[Matcher] Auto-detect children parameter value: ${autoDetectChildren}`);

		// Direct debug log of the raw selector value
		this.logger.info(`[Matcher] Raw container selector value: "${resultsSelector}"`);

		// Check if the selector is empty
		if (!resultsSelector) {
			this.logger.warn(`[Matcher] Warning: Empty results container selector. This will cause matching to fail.`);
		}

		// Only get itemSelector if not auto-detecting
		if (!autoDetectChildren) {
			itemSelector = this.getNodeParameter('itemSelector', index, '') as string;
		}

		// Log the selectors for debugging
		this.logger.info(`Using container selector: "${resultsSelector}" with ${autoDetectChildren ? 'auto-detection' : `item selector: "${itemSelector}"`}`);
	} else {
		// For direct item selection, we use the item selector directly
		itemSelector = this.getNodeParameter('directItemSelector', index, '') as string;
		this.logger.info(`Using direct item selector: "${itemSelector}"`);
	}

	const waitForSelector = this.getNodeParameter('waitForSelector', index, true) as boolean;
	const selectorTimeout = this.getNodeParameter('selectorTimeout', index, 10000) as number;

	// Get field extraction configurations from comparison criteria
	const criteria = this.getNodeParameter('comparisonCriteria.values', index, []) as IDataObject[];

	return {
		resultsSelector,
		itemSelector,
		waitForSelector,
		selectorTimeout,
		fields: criteria.map(criterion => {
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
		}),
		// Add auto-detection flag for children when only container is specified
		autoDetectChildren: selectionMethod === 'containerItems' && autoDetectChildren,
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
		// Source entity data
		sourceEntity: sourceEntity.fields,
		normalizationOptions: sourceEntity.normalizationOptions,

		// Selectors for finding results
		resultsSelector: extractionConfig.resultsSelector,
		itemSelector: extractionConfig.itemSelector,

		// Field extraction configuration
		fields: extractionConfig.fields.map((field, index) => {
			// Merge with additional field settings
			const additionalField = additionalConfig.fieldSettings[index] || {};

			// Use the data format from either the extraction config or additional settings
			const dataFormat = field.dataFormat || additionalField.dataFormat || 'text';

			return {
				name: field.name,
				selector: field.selector,
				attribute: field.attribute,
				weight: field.weight,
				required: field.required,
				comparisonAlgorithm: dataFormat === 'attribute' ? 'exact' : 'levenshtein',
				// Ensure data format is properly passed through to the entity matcher
				dataFormat,
			};
		}),

		// Matching configuration
		threshold: comparisonConfig.threshold,
		matchMode: comparisonConfig.matchMode || 'best',
		limitResults: comparisonConfig.limitResults,
		sortResults: comparisonConfig.sortResults,

		// Auto-detect children (explicitly setting this)
		autoDetectChildren: extractionConfig.autoDetectChildren === true,

		// Action configuration
		action: actionConfig.action,
		actionSelector: actionConfig.actionSelector,
		actionAttribute: actionConfig.actionAttribute,
		waitAfterAction: actionConfig.waitAfterAction,
		waitTime: actionConfig.waitTime,
		waitSelector: actionConfig.waitSelector,

		// Timing configuration
		waitForSelector: extractionConfig.waitForSelector,
		selectorTimeout: extractionConfig.selectorTimeout,

		// Additional settings (handled by our custom implementation)
		maxItems: additionalConfig.maxItems,
		fieldSettings: additionalConfig.fieldSettings,
	};
}

/**
 * Process match results to ensure proper data type conversion
 */
function processMatchResult(
	matchResult: IEntityMatchResult | null,
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
 * Apply transformations to the entity matcher results
 */
function applyResultTransformations(
	results: IEntityMatcherOutput,
	additionalConfig: any,
	logger: ILogger,
	nodeName: string,
	nodeId: string
): INodeExecutionData {
	const logPrefix = `[Matcher][${nodeName}][${nodeId}]`;
	const returnData: IDataObject = {};

	// Process the selected match with type conversions
	if (results.selectedMatch) {
		const processedMatch = processMatchResult(
			results.selectedMatch,
			additionalConfig.fieldSettings || [],
			logger,
			logPrefix
		);

		if (processedMatch) {
			returnData.match = processedMatch;
			returnData.found = true;
			returnData.similarity = processedMatch._similarity;
		}
	} else {
		returnData.found = false;
		returnData.match = null;
		returnData.similarity = 0;
	}

	// Process all matches if needed
	if (results.matches && results.matches.length > 0) {
		returnData.allMatches = results.matches.map(match =>
			processMatchResult(match, additionalConfig.fieldSettings || [], logger, logPrefix)
		);
		returnData.count = results.matches.length;
	} else {
		returnData.allMatches = [];
		returnData.count = 0;
	}

	// Add debugging info if requested
	if (additionalConfig.includeScoreDetails) {
		// Create detailed info about the matching process
		returnData.matchDetails = {
			threshold: additionalConfig.threshold,
			matchMode: additionalConfig.matchMode,
			containerSelector: results.containerSelector,
			itemSelector: results.itemSelector,
			containerFound: results.containerFound,
			totalExtracted: results.itemsFound
		};
	}

	return {
		json: returnData,
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

		const comparisonConfig = buildComparisonConfig.call(this, index);
		const actionConfig = buildActionConfig.call(this, index);
		const additionalConfig = getAdditionalMatcherConfig.call(this, index);

		// Build combined config for the entity matcher
		const entityMatcherConfig = buildEntityMatcherConfig(
			sourceEntity,
			extractionConfig,
			comparisonConfig,
			actionConfig,
			additionalConfig
		);

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

		// Add enhanced selector verification
		try {
			const selectorInfo: IContainerInfo = await page.evaluate((containerSelector, itemSelector, autoDetect) => {
				console.log(`[Selector Verification] Checking container: ${containerSelector}`);

				const container = document.querySelector(containerSelector);
				if (!container) {
					console.log(`[Selector Verification] Container not found: ${containerSelector}`);

					// Get document diagnostics
					const docState = {
						readyState: document.readyState,
						bodyChildCount: document.body.childElementCount
					};

					// Get sample of available classes
					const classes = new Set();
					document.querySelectorAll('[class]').forEach(el => {
						el.className.split(/\s+/).forEach(cls => {
							if (cls) classes.add(cls);
						});
					});

					return {
						containerFound: false,
						documentState: docState,
						availableClasses: Array.from(classes).slice(0, 20), // limit to 20
						listElements: document.querySelectorAll('ul, ol').length,
						tables: document.querySelectorAll('table').length,
						itemContainers: document.querySelectorAll('.item, .items, .result, .results, .list, .product').length
					};
				}

				// Container exists, check details
				const containerInfo: IContainerInfo = {
					containerFound: true,
					tagName: container.tagName,
					className: container.className,
					childCount: container.children.length,
					itemsFound: 0
				};

				// Check item selector if provided
				if (itemSelector && !autoDetect) {
					const items = container.querySelectorAll(itemSelector);
					containerInfo.itemsFound = items.length;

					// If no items found but selector provided, suggest alternatives
					if (items.length === 0) {
						const suggestions = [];

						// Check for list items
						const listItems = container.querySelectorAll('li');
						if (listItems.length > 0) {
							suggestions.push({ selector: 'li', count: listItems.length });
						}

						// Check for other common patterns
						['item', 'result', 'card', 'row', 'product'].forEach(cls => {
							const elements = container.querySelectorAll(`[class*="${cls}"]`);
							if (elements.length > 0) {
								suggestions.push({ selector: `[class*="${cls}"]`, count: elements.length });
							}
						});

						containerInfo.suggestions = suggestions;
					}
				} else if (autoDetect) {
					containerInfo.autoDetectEnabled = true;
				}

				return containerInfo;
			}, entityMatcherConfig.resultsSelector, entityMatcherConfig.itemSelector, entityMatcherConfig.autoDetectChildren);

			// Log selector verification results
			if (!selectorInfo.containerFound) {
				this.logger.warn(`[Matcher][${nodeName}] Container selector not found: ${entityMatcherConfig.resultsSelector}`);
				// Log additional details about the selector state
				if (selectorInfo.documentState) {
					this.logger.info(`[Matcher][${nodeName}] Page state: ${selectorInfo.documentState.readyState}, Body child elements: ${selectorInfo.documentState.bodyChildCount}`);
				}

				if (selectorInfo.listElements && selectorInfo.tables && selectorInfo.itemContainers) {
					this.logger.info(`[Matcher][${nodeName}] Found ${selectorInfo.listElements} list elements, ${selectorInfo.tables} tables, ${selectorInfo.itemContainers} item containers`);
				}

				if (selectorInfo.availableClasses) {
					this.logger.info(`[Matcher][${nodeName}] Sample classes: ${selectorInfo.availableClasses.join(', ')}`);
				}
			} else {
				this.logger.info(`[Matcher][${nodeName}] Container found: ${entityMatcherConfig.resultsSelector} ${selectorInfo.tagName ? `(${selectorInfo.tagName}, class="${selectorInfo.className || ''}")` : ''} ${selectorInfo.childCount ? `with ${selectorInfo.childCount} direct children` : ''}`);

				if (selectorInfo.itemsFound !== undefined && selectorInfo.itemsFound > 0) {
					this.logger.info(`[Matcher][${nodeName}] Found ${selectorInfo.itemsFound} items using selector: ${entityMatcherConfig.itemSelector}`);
				} else {
					this.logger.warn(`[Matcher][${nodeName}] No items found with selector: ${entityMatcherConfig.itemSelector}`);
				}

				if (selectorInfo.suggestions && selectorInfo.suggestions.length > 0) {
					this.logger.info(`[Matcher][${nodeName}] Selector suggestions available: ${selectorInfo.suggestions.length}`);

					selectorInfo.suggestions.forEach(s => {
						this.logger.info(`[Matcher][${nodeName}] Suggested selector: ${s}`);
					});
				}
			}
		} catch (error) {
			this.logger.warn(`[Matcher][${nodeName}] Error during selector verification: ${(error as Error).message}`);
		}

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
		const result = await entityMatcher.execute();

		// Apply transformations to the results
		const returnData = applyResultTransformations(
			result,
			additionalConfig,
			this.logger,
			nodeName,
			nodeId
		);

		// Log timing information
		createTimingLog(
			"Matcher",
			startTime,
			this.logger,
			nodeName,
			nodeId,
			index
		);

		return returnData;
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




