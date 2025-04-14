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
		type: "fixedCollection",
		typeOptions: {
			multipleValues: true,
			sortable: true,
		},
		default: { values: [] },
		description: "Define how to compare reference values with content on the page",
		displayOptions: {
			show: {
				operation: ["matcher"],
			},
		},
		options: [
			{
				name: "values",
				displayName: "Criterion",
				values: [
					{
						displayName: "Reference Value",
						name: "referenceValue",
						type: "string",
						default: "",
						placeholder: "{{$json.name}} or static value",
						description: "Value to match against content on the page (can use expressions)",
						required: true,
					},
					{
						displayName: "Target Selector",
						name: "selector",
						type: "string",
						default: "",
						placeholder: "h3 a, .address, .phone",
						description: "CSS selector to extract this field from each item",
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
								description: "Plain text content",
							},
							{
								name: "HTML",
								value: "html",
								description: "HTML content",
							},
							{
								name: "Attribute",
								value: "attribute",
								description: "Specific attribute value",
							},
							{
								name: "Number",
								value: "number",
								description: "Numeric value",
							},
						],
						default: "text",
						description: "Format of the data to extract",
					},
					{
						displayName: "Attribute Name",
						name: "attribute",
						type: "string",
						default: "",
						placeholder: "href, src, data-id",
						description: "Name of the attribute to extract",
						displayOptions: {
							show: {
								dataFormat: ["attribute"],
							},
						},
					},
					{
						displayName: "Comparison Type",
						name: "comparisonType",
						type: "options",
						options: [
							{
								name: "Fuzzy Match",
								value: "levenshtein",
								description: "Compare using string similarity (Levenshtein distance)",
							},
							{
								name: "Contains",
								value: "contains",
								description: "Check if target contains the reference value",
							},
							{
								name: "Exact Match",
								value: "exact",
								description: "Check for exact string match (case sensitive)",
							},
							{
								name: "Case Insensitive Match",
								value: "caseInsensitive",
								description: "Check for exact string match (case insensitive)",
							},
							{
								name: "Regular Expression",
								value: "regex",
								description: "Match using regular expression pattern",
							},
							{
								name: "Numeric Comparison",
								value: "numeric",
								description: "Compare numeric values (within tolerance)",
							},
						],
						default: "levenshtein",
						description: "How to compare the reference value with the extracted content",
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
						description: "Minimum similarity score required for a match (0-1)",
						displayOptions: {
							show: {
								comparisonType: ["levenshtein"],
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
								comparisonType: ["numeric"],
							},
						},
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
						description: "Importance of this criterion relative to others (0-10)",
					},
					{
						displayName: "Must Match",
						name: "mustMatch",
						type: "boolean",
						default: false,
						description: "If enabled, items that don't match this criterion will be excluded regardless of other criteria",
					},
					{
						displayName: "Transformation",
						name: "transformation",
						type: "string",
						typeOptions: {
							rows: 2,
						},
						default: "",
						placeholder: ".split(' ')[0] or .toLowerCase().trim()",
						description: "Optional JavaScript expression to transform values before comparison (applied to both reference and target)",
					},
				]
			}
		]
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
	const limitItemsToCompare = this.getNodeParameter('limitCandidatesCompared', index, false) as boolean;
	const maxItemsToCompare = limitItemsToCompare
		? this.getNodeParameter('maxCandidates', index, 10) as number
		: 0; // 0 means no limit

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
		};
	});

	return {
		maxItems: maxItemsToCompare,
		fieldSettings,
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



