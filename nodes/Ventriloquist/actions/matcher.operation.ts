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
	buildNodeResponse,
} from "../utils/resultUtils";
import { createErrorResponse } from "../utils/errorUtils";
import { logPageDebugInfo } from "../utils/debugUtils";
import { EntityMatcherFactory } from "../utils/middlewares/matching/entityMatcherFactory";
import type {
	ISourceEntity,
	IEntityMatcherExtractionConfig,
	IEntityMatcherComparisonConfig,
	IEntityMatcherActionConfig,
	IEntityMatcherOutput,
} from "../utils/middlewares/types/entityMatcherTypes";

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
		displayName: "Match Result Type",
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
		displayName: "Scoring Mode",
		name: "scoringMode",
		type: "options",
		options: [
			{
				name: "Combined Weighted Score",
				value: "weighted",
				description: "Calculate final score as weighted sum of all criteria",
			},
			{
				name: "Rule-Based Priority",
				value: "ruleBased",
				description: "Return first candidate to pass highest-priority rules",
			},
			{
				name: "AI Selected",
				value: "aiSelected",
				description: "Let AI choose from candidates based on all criteria",
			},
		],
		default: "weighted",
		description: "How to calculate the match quality score for candidates",
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
		displayName: "Minimum Score Threshold",
		name: "minimumScoreThreshold",
		type: "number",
		default: 0.5,
		typeOptions: {
			minValue: 0,
			maxValue: 1,
		},
		description: "Minimum score required for a match (0-1)",
		displayOptions: {
			show: {
				operation: ["matcher"],
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
		displayName: "Results Container Selector",
		name: "resultsSelector",
		type: "string",
		default: "",
		placeholder: "ol.co_searchResult_list",
		description: "CSS selector for the container holding all potential matches",
		displayOptions: {
			show: {
				operation: ["matcher"],
			},
		},
	},
	{
		displayName: "Item Selector",
		name: "itemSelector",
		type: "string",
		default: "",
		placeholder: "ol.co_searchResult_list > li",
		description: "CSS selector for individual items within the container",
		displayOptions: {
			show: {
				operation: ["matcher"],
			},
		},
	},
	{
		displayName: "Wait for Container Selector",
		name: "waitForSelector",
		type: "boolean",
		default: true,
		description: "Wait for the container selector to appear before attempting extraction",
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
		placeholder: "Add Comparison Criterion",
		type: "fixedCollection",
		typeOptions: {
			multipleValues: true,
		},
		default: {},
		options: [
			{
				name: "values",
				displayName: "Criteria",
				values: [
					{
						displayName: "Reference Value",
						name: "referenceValue",
						type: "string",
						default: "",
						description: "Value to compare against (typically from input data)",
					},
					{
						displayName: "Target Selector",
						name: "selector",
						type: "string",
						default: "",
						description: "CSS selector for element to extract value from",
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
					},
					{
						displayName: "Comparison Type",
						name: "comparisonType",
						type: "options",
						options: [
							{
								name: "Levenshtein",
								value: "levenshtein",
								description: "Edit distance (default)",
							},
							{
								name: "Exact Match",
								value: "exact",
								description: "Strings must match exactly",
							},
							{
								name: "Contains",
								value: "contains",
								description: "One string contains the other",
							},
							{
								name: "Starts With",
								value: "startsWith",
								description: "String starts with reference",
							},
							{
								name: "Ends With",
								value: "endsWith",
								description: "String ends with reference",
							},
							{
								name: "Numeric Distance",
								value: "numeric",
								description: "Numeric values comparison",
							},
							{
								name: "Date Distance",
								value: "date",
								description: "Date comparison",
							},
							{
								name: "Semantic Similarity",
								value: "semantic",
								description: "Meaning-based comparison",
							},
							{
								name: "Regex",
								value: "regex",
								description: "Regular expression matching",
							},
						],
						default: "levenshtein",
						description: "Algorithm to use for comparison",
					},
					{
						displayName: "Threshold",
						name: "threshold",
						type: "number",
						typeOptions: {
							minValue: 0,
							maxValue: 1,
						},
						default: 0.7,
						description:
							"Minimum similarity score required for this field (0-1)",
					},
					{
						displayName: "Must Match",
						name: "mustMatch",
						type: "boolean",
						default: false,
						description: "Whether this criterion must match for a successful result",
					},
					{
						displayName: "Weight",
						name: "weight",
						type: "number",
						typeOptions: {
							minValue: 0,
							maxValue: 10,
						},
						default: 1,
						description:
							"How important this criterion is compared to others",
					},
					{
						displayName: "Priority",
						name: "priority",
						type: "number",
						typeOptions: {
							minValue: 1,
							maxValue: 10,
						},
						default: 1,
						description: "Priority level for rule-based scoring (1=lowest, 10=highest)",
						displayOptions: {
							show: {
								'/scoringMode': ["ruleBased"],
							},
						},
					},
					{
						displayName: "Transformation",
						name: "transformation",
						type: "string",
						default: "",
						description:
							"Optional expression to transform the value before comparison",
						placeholder: "$value.replace(/[^a-zA-Z0-9]/g, '')",
					},
					{
						displayName: "Tolerance",
						name: "tolerance",
						type: "number",
						default: 0.01,
						description:
							"Tolerance for numeric/date comparisons",
						displayOptions: {
							show: {
								comparisonType: ["numeric", "date"],
							},
						},
					},
				],
			},
		],
		description: "Fields to compare when evaluating matches",
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
	// Get basic selector parameters
	const resultsSelector = this.getNodeParameter('resultsSelector', index, '') as string;
	const itemSelector = this.getNodeParameter('itemSelector', index, '') as string;
	const waitForSelector = this.getNodeParameter('waitForSelector', index, true) as boolean;
	const selectorTimeout = this.getNodeParameter('selectorTimeout', index, 10000) as number;

	// Get field extraction configurations from comparison criteria
	const criteria = this.getNodeParameter('comparisonCriteria.values', index, []) as IDataObject[];

	return {
		resultsSelector,
		itemSelector,
		waitForSelector,
		selectorTimeout,
		fields: criteria.map(criterion => ({
			name: criterion.selector as string,
			selector: criterion.selector as string,
			attribute: criterion.dataFormat === 'attribute' ? criterion.attribute as string : undefined,
			weight: criterion.weight as number || 1,
			required: criterion.mustMatch as boolean,
		})),
	};
}

/**
 * Builds comparison configuration from input parameters
 */
function buildComparisonConfig(this: IExecuteFunctions, index: number): IEntityMatcherComparisonConfig {
	// Get comparison parameters
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
		return {
			field: criterion.selector as string,
			algorithm: criterion.comparisonType as any || 'levenshtein',
			weight: criterion.weight as number || 1,
		};
	});

	// Get the threshold from UI
	const threshold = this.getNodeParameter('minimumScoreThreshold', index, 0.5) as number;

	return {
		fieldComparisons,
		threshold,
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

	// Get scoring mode and details output flag
	const scoringMode = this.getNodeParameter('scoringMode', index, 'weighted') as string;
	const includeScoreDetails = true; // Always include scoring details

	// Get criteria for custom configurations
	const criteria = this.getNodeParameter('comparisonCriteria.values', index, []) as IDataObject[];

	// Extract per-field settings that don't fit in the standard interfaces
	const fieldSettings = criteria.map(criterion => {
		return {
			field: criterion.selector as string,
			threshold: criterion.threshold as number || 0.7,
			transformation: criterion.transformation as string || '',
			tolerance: criterion.tolerance as number || 0.01,
			dataFormat: criterion.dataFormat as string || 'text',
			priority: criterion.priority as number || 1, // For rule-based priority scoring
			required: criterion.mustMatch as boolean || false, // For "must match" functionality
		};
	});

	return {
		maxItems: maxItemsToCompare,
		fieldSettings,
		scoringMode,
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

			return {
				name: field.name,
				selector: field.selector,
				attribute: field.attribute,
				weight: field.weight,
				required: field.required,
				comparisonAlgorithm: additionalField.dataFormat === 'attribute' ? 'exact' : 'levenshtein',
			};
		}),

		// Matching configuration
		threshold: comparisonConfig.threshold,
		matchMode: comparisonConfig.matchMode || 'best',
		limitResults: comparisonConfig.limitResults,
		sortResults: comparisonConfig.sortResults,

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

		// Get the page
		let page = sessionResult.page;
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
		const matcherResult = await entityMatcher.execute();

		// Log timing information
		createTimingLog(
			"Matcher",
			startTime,
			this.logger,
			nodeName,
			nodeId,
			index
		);

		// Create success response
		const successResponse = await createSuccessResponse({
			operation: "matcher",
			sessionId,
			page,
			logger: this.logger,
			startTime,
			additionalData: {
				matches: matcherResult.matches,
				selectedMatch: matcherResult.selectedMatch,
				matchCount: matcherResult.matches.length,
				hasMatch: !!matcherResult.selectedMatch,
				actionPerformed: matcherResult.actionPerformed || false,
				actionResult: matcherResult.actionResult,
			},
			inputData: items[index].json,
		});

		return buildNodeResponse(successResponse);
	} catch (error) {
		// Use the standardized error response utility
		const errorResponse = await createErrorResponse({
			error: error as Error,
			operation: "matcher",
			sessionId,
			logger: this.logger,
			startTime,
		});

		return buildNodeResponse(errorResponse);
	}
}




