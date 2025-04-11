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
	{
		displayName: "Source Entity Configuration",
		name: "sourceEntity",
		type: "fixedCollection",
		default: {
			fields: [
				{
					fieldName: "name",
					value: "{{$node[\"Previous Node\"].json[\"name\"]}}"
				}
			]
		},
		typeOptions: {
			multipleValues: false,
		},
		description: "Entity data to match against",
		displayOptions: {
			show: {
				operation: ["matcher"],
			},
		},
		options: [
			{
				name: "fields",
				displayName: "Fields",
				values: [
					{
						displayName: "Field Name",
						name: "fieldName",
						type: "string",
						default: "",
						placeholder: "e.g., name, id, price",
						description: "Name of the field in the source entity",
						required: true,
					},
					{
						displayName: "Value",
						name: "value",
						type: "string",
						default: "",
						description: "Value to match against",
						required: true,
					}
				],
			},
			{
				name: "normalizationOptions",
				displayName: "Text Normalization Options",
				values: [
					{
						displayName: "Normalize Company Names",
						name: "normalizeCompanyNames",
						type: "boolean",
						default: true,
						description: "Normalize company names (remove legal suffixes, standardize common terms)",
					},
					{
						displayName: "Normalize Product Identifiers",
						name: "normalizeProductIdentifiers",
						type: "boolean",
						default: true,
						description: "Standardize product identifiers (remove hyphens, standardize formats)",
					},
					{
						displayName: "Normalize Addresses",
						name: "normalizeAddresses",
						type: "boolean",
						default: true,
						description: "Standardize address formats",
					}
				],
			},
		],
	},
	{
		displayName: "Results Configuration",
		name: "extractionConfig",
		type: "fixedCollection",
		default: {
			config: [
				{
					resultsSelector: "",
					itemSelector: "",
				}
			]
		},
		typeOptions: {
			multipleValues: false,
		},
		description: "Configure how to extract potential matches",
		displayOptions: {
			show: {
				operation: ["matcher"],
			},
		},
		options: [
			{
				name: "config",
				displayName: "Configuration",
				values: [
					{
						displayName: "Results Container Selector",
						name: "resultsSelector",
						type: "string",
						default: "",
						placeholder: ".search-results, #results-list",
						description: "CSS selector for the container holding all potential matches",
						required: true,
					},
					{
						displayName: "Item Selector",
						name: "itemSelector",
						type: "string",
						default: "",
						placeholder: ".result-item, .card",
						description: "CSS selector for individual items within the results container",
						required: true,
					},
					{
						displayName: "Wait for Selector",
						name: "waitForSelector",
						type: "boolean",
						default: true,
						description: "Wait for the results selector to appear before attempting extraction",
					},
					{
						displayName: "Timeout (ms)",
						name: "selectorTimeout",
						type: "number",
						default: 10000,
						description: "Maximum time to wait for selectors to appear (in milliseconds)",
						displayOptions: {
							show: {
								waitForSelector: [true],
							},
						},
					},
				],
			},
		],
	},
	{
		displayName: "Field Mapping",
		name: "fieldMapping",
		type: "fixedCollection",
		typeOptions: {
			multipleValues: true,
			sortable: true,
		},
		default: {
			fields: [
				{
					name: "name",
					selector: ".item-name",
					weight: 1
				}
			]
		},
		description: "Map fields to extract from each result item",
		displayOptions: {
			show: {
				operation: ["matcher"],
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
						placeholder: "e.g., name, price, id",
						description: "Name of the field to extract (should match source entity field names for comparison)",
						required: true,
					},
					{
						displayName: "Selector",
						name: "selector",
						type: "string",
						default: "",
						placeholder: ".product-name, .price",
						description: "CSS selector to extract this field from each result item",
						required: true,
					},
					{
						displayName: "Attribute",
						name: "attribute",
						type: "string",
						default: "",
						placeholder: "href, data-id",
						description: "Optional attribute to extract instead of text content (leave empty for text)",
					},
					{
						displayName: "Weight",
						name: "weight",
						type: "number",
						default: 1,
						description: "Importance of this field when calculating match score (higher = more important)",
						required: true,
					},
					{
						displayName: "Required Field",
						name: "required",
						type: "boolean",
						default: false,
						description: "Whether this field must be present for an item to be considered a match",
					},
				],
			},
		],
	},
	{
		displayName: "Matching Configuration",
		name: "comparisonConfig",
		type: "fixedCollection",
		default: {
			config: [
				{
					threshold: 0.7,
					matchMode: "best",
					limitResults: 10,
					sortResults: true,
				}
			]
		},
		typeOptions: {
			multipleValues: false,
		},
		description: "Configure how matching is performed",
		displayOptions: {
			show: {
				operation: ["matcher"],
			},
		},
		options: [
			{
				name: "config",
				displayName: "Configuration",
				values: [
					{
						displayName: "Similarity Threshold",
						name: "threshold",
						type: "number",
						default: 0.7,
						typeOptions: {
							minValue: 0,
							maxValue: 1,
						},
						description: "Minimum similarity score required to consider an item a match (0-1)",
						required: true,
					},
					{
						displayName: "Match Mode",
						name: "matchMode",
						type: "options",
						options: [
							{
								name: "Best Match Only",
								value: "best",
								description: "Return only the best matching item",
							},
							{
								name: "All Above Threshold",
								value: "all",
								description: "Return all items above the threshold",
							},
							{
								name: "First Above Threshold",
								value: "firstAboveThreshold",
								description: "Return the first item that exceeds the threshold",
							},
						],
						default: "best",
						description: "How to select matches from the results",
					},
					{
						displayName: "Limit Results",
						name: "limitResults",
						type: "number",
						default: 10,
						description: "Maximum number of results to return when using 'All Above Threshold'",
						displayOptions: {
							show: {
								matchMode: ["all"],
							},
						},
					},
					{
						displayName: "Sort Results",
						name: "sortResults",
						type: "boolean",
						default: true,
						description: "Sort results by similarity score (highest first)",
					},
				],
			},
		],
	},
	{
		displayName: "Action Configuration",
		name: "actionConfig",
		type: "fixedCollection",
		default: {
			config: [
				{
					action: "none",
				}
			]
		},
		typeOptions: {
			multipleValues: false,
		},
		description: "Configure what action to take on the best match",
		displayOptions: {
			show: {
				operation: ["matcher"],
			},
		},
		options: [
			{
				name: "config",
				displayName: "Configuration",
				values: [
					{
						displayName: "Action",
						name: "action",
						type: "options",
						options: [
							{
								name: "Click",
								value: "click",
								description: "Click on an element within or related to the matched item",
							},
							{
								name: "Extract Additional Data",
								value: "extract",
								description: "Extract additional data from the matched item",
							},
							{
								name: "None",
								value: "none",
								description: "Just return the match without taking any action",
							},
						],
						default: "none",
						description: "Action to perform on the best match",
					},
					{
						displayName: "Action Selector",
						name: "actionSelector",
						type: "string",
						default: "",
						placeholder: ".view-details, .add-to-cart",
						description: "CSS selector for the element to interact with (relative to the matched item)",
						displayOptions: {
							show: {
								action: ["click", "extract"],
							},
						},
					},
					{
						displayName: "Action Attribute",
						name: "actionAttribute",
						type: "string",
						default: "",
						placeholder: "href, data-url",
						description: "For extract action, the attribute to extract",
						displayOptions: {
							show: {
								action: ["extract"],
							},
						},
					},
					{
						displayName: "Wait After Action",
						name: "waitAfterAction",
						type: "boolean",
						default: false,
						description: "Wait for navigation or a specific selector after performing the action",
						displayOptions: {
							show: {
								action: ["click"],
							},
						},
					},
					{
						displayName: "Wait Time (ms)",
						name: "waitTime",
						type: "number",
						default: 1000,
						description: "Time to wait after action in milliseconds",
						displayOptions: {
							show: {
								action: ["click"],
								waitAfterAction: [true],
							},
						},
					},
					{
						displayName: "Wait For Selector",
						name: "waitSelector",
						type: "string",
						default: "",
						placeholder: "#details-content, .loading-complete",
						description: "Selector to wait for after action (leave empty to wait for navigation to complete)",
						displayOptions: {
							show: {
								action: ["click"],
								waitAfterAction: [true],
							},
						},
					},
				],
			},
		],
	},
];

/**
 * Convert input data to source entity configuration
 */
function buildSourceEntity(input: IDataObject): ISourceEntity {
	const sourceEntity: ISourceEntity = {
		fields: {},
	};

	// Process source entity fields
	if (input.sourceEntity && (input.sourceEntity as IDataObject).fields) {
		const fields = (input.sourceEntity as IDataObject).fields as IDataObject[];

		for (const field of fields) {
			const fieldName = field.fieldName as string;
			const value = field.value as string;

			if (fieldName && value !== undefined) {
				sourceEntity.fields[fieldName] = value;
			}
		}
	}

	// Process normalization options
	if (input.sourceEntity && (input.sourceEntity as IDataObject).normalizationOptions) {
		const options = (input.sourceEntity as IDataObject).normalizationOptions as IDataObject[];

		if (options.length > 0) {
			sourceEntity.normalizationOptions = {
				normalizeCompanyNames: options[0].normalizeCompanyNames as boolean,
				normalizeProductIdentifiers: options[0].normalizeProductIdentifiers as boolean,
				normalizeAddresses: options[0].normalizeAddresses as boolean,
			};
		}
	}

	return sourceEntity;
}

/**
 * Convert input data to extraction configuration
 */
function buildExtractionConfig(input: IDataObject): IEntityMatcherExtractionConfig {
	const extractionConfig: IEntityMatcherExtractionConfig = {
		resultsSelector: "",
		itemSelector: "",
		fields: [],
	};

	// Process extraction config
	if (input.extractionConfig && (input.extractionConfig as IDataObject).config) {
		const config = ((input.extractionConfig as IDataObject).config as IDataObject[])[0];

		extractionConfig.resultsSelector = config.resultsSelector as string;
		extractionConfig.itemSelector = config.itemSelector as string;
		extractionConfig.waitForSelector = config.waitForSelector as boolean;
		extractionConfig.selectorTimeout = config.selectorTimeout as number;
	}

	// Process field mapping
	if (input.fieldMapping && (input.fieldMapping as IDataObject).fields) {
		const fields = (input.fieldMapping as IDataObject).fields as IDataObject[];

		for (const field of fields) {
			extractionConfig.fields.push({
				name: field.name as string,
				selector: field.selector as string,
				attribute: field.attribute as string,
				weight: field.weight as number || 1,
				required: field.required as boolean,
			});
		}
	}

	return extractionConfig;
}

/**
 * Convert input data to comparison configuration
 */
function buildComparisonConfig(input: IDataObject): IEntityMatcherComparisonConfig {
	const comparisonConfig: IEntityMatcherComparisonConfig = {
		fieldComparisons: [],
		threshold: 0.7,
	};

	// Process comparison config
	if (input.comparisonConfig && (input.comparisonConfig as IDataObject).config) {
		const config = ((input.comparisonConfig as IDataObject).config as IDataObject[])[0];

		comparisonConfig.threshold = config.threshold as number;
		comparisonConfig.matchMode = config.matchMode as 'best' | 'all' | 'firstAboveThreshold';
		comparisonConfig.limitResults = config.limitResults as number;
		comparisonConfig.sortResults = config.sortResults as boolean;
	}

	// Build field comparisons based on extraction fields
	if (input.fieldMapping && (input.fieldMapping as IDataObject).fields) {
		const fields = (input.fieldMapping as IDataObject).fields as IDataObject[];

		for (const field of fields) {
			comparisonConfig.fieldComparisons.push({
				field: field.name as string,
				algorithm: 'levenshtein', // Default algorithm for now
				weight: field.weight as number || 1,
			});
		}
	}

	return comparisonConfig;
}

/**
 * Convert input data to action configuration
 */
function buildActionConfig(input: IDataObject): IEntityMatcherActionConfig {
	const actionConfig: IEntityMatcherActionConfig = {
		action: 'none',
	};

	// Process action config
	if (input.actionConfig && (input.actionConfig as IDataObject).config) {
		const config = ((input.actionConfig as IDataObject).config as IDataObject[])[0];

		actionConfig.action = config.action as 'click' | 'extract' | 'none';
		actionConfig.actionSelector = config.actionSelector as string;
		actionConfig.actionAttribute = config.actionAttribute as string;
		actionConfig.waitAfterAction = config.waitAfterAction as boolean;
		actionConfig.waitTime = config.waitTime as number;
		actionConfig.waitSelector = config.waitSelector as string;
	}

	return actionConfig;
}

/**
 * Build a complete entity matcher config object from the individual config objects
 */
function buildEntityMatcherConfig(
	sourceEntity: ISourceEntity,
	extractionConfig: IEntityMatcherExtractionConfig,
	comparisonConfig: IEntityMatcherComparisonConfig,
	actionConfig: IEntityMatcherActionConfig
) {
	return {
		// Source entity data
		sourceEntity: sourceEntity.fields,
		normalizationOptions: sourceEntity.normalizationOptions,

		// Selectors for finding results
		resultsSelector: extractionConfig.resultsSelector,
		itemSelector: extractionConfig.itemSelector,

		// Field extraction configuration
		fields: extractionConfig.fields.map(field => ({
			name: field.name,
			selector: field.selector,
			attribute: field.attribute,
			weight: field.weight,
			required: field.required,
			comparisonAlgorithm: 'levenshtein', // Default for now
			normalizationOptions: field.normalizationOptions,
		})),

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
		const sourceEntity = buildSourceEntity(this.getNodeParameter('sourceEntity', index, {}) as IDataObject);
		const extractionConfig = buildExtractionConfig(this.getNodeParameter('extractionConfig', index, {}) as IDataObject);
		const comparisonConfig = buildComparisonConfig(this.getNodeParameter('comparisonConfig', index, {}) as IDataObject);
		const actionConfig = buildActionConfig(this.getNodeParameter('actionConfig', index, {}) as IDataObject);

		// Build combined config for the entity matcher
		const entityMatcherConfig = buildEntityMatcherConfig(
			sourceEntity,
			extractionConfig,
			comparisonConfig,
			actionConfig
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
