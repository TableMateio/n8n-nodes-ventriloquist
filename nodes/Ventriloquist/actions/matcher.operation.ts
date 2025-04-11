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
		displayName: "Target Entity Configuration",
		name: "targetEntity",
		type: "fixedCollection",
		default: {},
		typeOptions: {
			multipleValues: false,
		},
		description: "Configure how to find and extract entities from the page",
		displayOptions: {
			show: {
				operation: ["matcher"],
			},
		},
		options: [
			{
				name: "selectors",
				displayName: "Content Selection",
				values: [
					{
						displayName: "Container Selector",
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
						description: "CSS selector for individual items within the container",
						required: true,
					},
					{
						displayName: "Wait for Selector",
						name: "waitForSelector",
						type: "boolean",
						default: true,
						description: "Wait for the container selector to appear before attempting extraction",
					},
					{
						displayName: "Timeout",
						name: "selectorTimeout",
						type: "number",
						default: 10000,
						description: "Maximum time to wait for selectors to appear (in milliseconds)",
						displayOptions: {
							show: {
								waitForSelector: [true],
							},
						},
					}
				]
			},
			{
				name: "matching",
				displayName: "Matching Options",
				values: [
					{
						displayName: "Match Selection",
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
								value: "first",
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
					}
				]
			},
			{
				name: "textProcessing",
				displayName: "Text Processing",
				values: [
					{
						displayName: "Text Normalization",
						name: "textNormalization",
						type: "options",
						options: [
							{
								name: "None",
								value: "none",
								description: "No text normalization",
							},
							{
								name: "Basic Cleanup",
								value: "basic",
								description: "Trim whitespace, normalize spaces",
							},
							{
								name: "Company Names",
								value: "company",
								description: "Remove legal suffixes, standardize company terms",
							},
							{
								name: "Product Identifiers",
								value: "product",
								description: "Standardize product IDs and codes",
							},
							{
								name: "Addresses",
								value: "address",
								description: "Standardize address formats",
							},
							{
								name: "Full Normalization",
								value: "full",
								description: "Apply all normalization techniques",
							},
							{
								name: "Custom",
								value: "custom",
								description: "Define custom text normalization rules",
							}
						],
						default: "basic",
						description: "How to normalize text before comparison",
					},
					{
						displayName: "Case Sensitivity",
						name: "caseSensitive",
						type: "boolean",
						default: false,
						description: "Whether text comparison should be case sensitive",
					},
					{
						displayName: "Custom Normalization Expression",
						name: "customNormalization",
						type: "string",
						default: "return text.trim().toLowerCase().replace(/\\s+/g, ' ');",
						description: "JavaScript expression to normalize text (input: 'text', output: normalized text)",
						displayOptions: {
							show: {
								textNormalization: ["custom"],
							},
						},
					}
				]
			}
		],
	},
	{
		displayName: "Data to Match",
		name: "dataToMatch",
		type: "fixedCollection",
		typeOptions: {
			multipleValues: true,
			sortable: true,
		},
		default: {},
		description: "Define data fields you want to match against page content",
		displayOptions: {
			show: {
				operation: ["matcher"],
			},
		},
		options: [
			{
				name: "fields",
				displayName: "Field",
				values: [
					{
						displayName: "Field Name",
						name: "name",
						type: "string",
						default: "name",
						placeholder: "e.g., name, price, ID",
						description: "Name of the field to match",
						required: true,
					},
					{
						displayName: "Value",
						name: "value",
						type: "string",
						default: "{{$json.name}}",
						description: "Value to match against",
						required: true,
					},
					{
						displayName: "Match Type",
						name: "matchType",
						type: "options",
						options: [
							{
								name: "Fuzzy Match",
								value: "fuzzy",
								description: "Find closest matches using string similarity",
							},
							{
								name: "Contains",
								value: "contains",
								description: "Check if text contains this value",
							},
							{
								name: "Exact Match",
								value: "exact",
								description: "Match exactly (case sensitive)",
							},
							{
								name: "Case Insensitive Match",
								value: "caseInsensitive",
								description: "Match exactly but ignore case",
							},
							{
								name: "Regular Expression",
								value: "regex",
								description: "Match using regular expression pattern",
							},
						],
						default: "fuzzy",
						description: "How to compare this value with target values",
					},
					{
						displayName: "Minimum Match Score",
						name: "threshold",
						type: "number",
						default: 0.7,
						typeOptions: {
							minValue: 0,
							maxValue: 1,
						},
						description: "Minimum similarity score required (0-1)",
						displayOptions: {
							show: {
								matchType: ["fuzzy"],
							},
						},
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
					}
				],
			},
		],
	},
	{
		displayName: "Field Extractors",
		name: "fieldExtractors",
		type: "fixedCollection",
		typeOptions: {
			multipleValues: true,
			sortable: true,
		},
		default: {},
		description: "Define which fields to extract from each potential match",
		displayOptions: {
			show: {
				operation: ["matcher"],
			},
		},
		options: [
			{
				name: "extractors",
				displayName: "Extractor",
				values: [
					{
						displayName: "Field Name",
						name: "name",
						type: "string",
						default: "",
						placeholder: "e.g., name, price, ID",
						description: "Name of the field to extract",
						required: true,
					},
					{
						displayName: "Selector",
						name: "selector",
						type: "string",
						default: "",
						placeholder: ".product-name, .price",
						description: "CSS selector to extract this field (relative to each item)",
						required: true,
					},
					{
						displayName: "Extraction Type",
						name: "extractionType",
						type: "options",
						options: [
							{
								name: "Text Content",
								value: "text",
								description: "Extract text content of the element",
							},
							{
								name: "Attribute",
								value: "attribute",
								description: "Extract specific attribute value",
							},
							{
								name: "HTML",
								value: "html",
								description: "Extract inner HTML of the element",
							},
							{
								name: "Outer HTML",
								value: "outerHtml",
								description: "Extract outer HTML of the element",
							},
						],
						default: "text",
						description: "How to extract data from the selected element",
					},
					{
						displayName: "Attribute Name",
						name: "attributeName",
						type: "string",
						default: "",
						placeholder: "href, data-id",
						description: "Attribute to extract (only used with Attribute extraction type)",
						displayOptions: {
							show: {
								extractionType: ["attribute"],
							},
						},
					}
				],
			},
		],
	},
	{
		displayName: "Match Action",
		name: "matchAction",
		type: "fixedCollection",
		default: {},
		typeOptions: {
			multipleValues: false,
		},
		description: "What to do with matched items",
		displayOptions: {
			show: {
				operation: ["matcher"],
			},
		},
		options: [
			{
				name: "action",
				displayName: "Action Configuration",
				values: [
					{
						displayName: "Action Type",
						name: "actionType",
						type: "options",
						options: [
							{
								name: "No Action (Return Match Only)",
								value: "none",
								description: "Just return the match without taking any action",
							},
							{
								name: "Click Element",
								value: "click",
								description: "Click on an element within or related to the matched item",
							},
							{
								name: "Extract Additional Data",
								value: "extract",
								description: "Extract additional data from the matched item",
							},
							{
								name: "Fill Form Field",
								value: "fill",
								description: "Fill a form field within the matched item",
							},
							{
								name: "Navigate to URL",
								value: "navigate",
								description: "Navigate to a URL found in the matched item",
							}
						],
						default: "none",
					},
					{
						displayName: "Element Selector",
						name: "actionSelector",
						type: "string",
						default: "",
						placeholder: ".view-details, .add-to-cart",
						description: "CSS selector for the element to interact with (relative to the matched item)",
						displayOptions: {
							show: {
								actionType: ["click", "extract", "fill"],
							},
						},
					},
					{
						displayName: "Wait After Action",
						name: "waitAfterAction",
						type: "boolean",
						default: false,
						description: "Wait after performing the action",
						displayOptions: {
							show: {
								actionType: ["click", "fill", "navigate"],
							},
						},
					},
					{
						displayName: "Wait Type",
						name: "waitType",
						type: "options",
						options: [
							{
								name: "Fixed Time",
								value: "fixed",
								description: "Wait a fixed amount of time",
							},
							{
								name: "Wait For Navigation",
								value: "navigation",
								description: "Wait for page navigation to complete",
							},
							{
								name: "Wait For Selector",
								value: "selector",
								description: "Wait for a specific selector to appear",
							},
							{
								name: "Wait For URL Change",
								value: "urlChange",
								description: "Wait for the URL to change",
							},
						],
						default: "fixed",
						description: "How to wait after the action",
						displayOptions: {
							show: {
								actionType: ["click", "fill", "navigate"],
								waitAfterAction: [true],
							},
						},
					},
					{
						displayName: "Wait Time",
						name: "waitTime",
						type: "number",
						default: 1000,
						description: "Time to wait after action in milliseconds",
						displayOptions: {
							show: {
								actionType: ["click", "fill", "navigate"],
								waitAfterAction: [true],
								waitType: ["fixed"],
							},
						},
					},
					{
						displayName: "Wait Selector",
						name: "waitSelector",
						type: "string",
						default: "",
						placeholder: "#details-content, .loading-complete",
						description: "Selector to wait for after action",
						displayOptions: {
							show: {
								actionType: ["click", "navigate"],
								waitAfterAction: [true],
								waitType: ["selector"],
							},
						},
					},
					{
						displayName: "Field Value",
						name: "fieldValue",
						type: "string",
						default: "",
						description: "Value to fill in the form field",
						displayOptions: {
							show: {
								actionType: ["fill"],
							},
						},
					},
				],
			},
		],
	},
	{
		displayName: "Fallback Options",
		name: "fallbackOptions",
		type: "fixedCollection",
		default: {},
		typeOptions: {
			multipleValues: false,
		},
		description: "What to do if no match is found",
		displayOptions: {
			show: {
				operation: ["matcher"],
			},
		},
		options: [
			{
				name: "options",
				displayName: "Fallback Configuration",
				values: [
					{
						displayName: "Fallback Action",
						name: "fallbackAction",
						type: "options",
						options: [
							{
								name: "Return Error",
								value: "error",
								description: "Return an error if no match is found",
							},
							{
								name: "Return Empty Result",
								value: "empty",
								description: "Return an empty result if no match is found",
							},
							{
								name: "Use Default Values",
								value: "default",
								description: "Use default values if no match is found",
							},
							{
								name: "Take Specific Action",
								value: "action",
								description: "Take a specific action if no match is found",
							},
						],
						default: "error",
					},
					{
						displayName: "Error Message",
						name: "errorMessage",
						type: "string",
						default: "No matching entity found",
						description: "Error message to return if no match is found",
						displayOptions: {
							show: {
								fallbackAction: ["error"],
							},
						},
					},
					{
						displayName: "Fallback Action Type",
						name: "fallbackActionType",
						type: "options",
						options: [
							{
								name: "Click Element",
								value: "click",
								description: "Click on an element as fallback",
							},
							{
								name: "Navigate to URL",
								value: "navigate",
								description: "Navigate to a URL as fallback",
							},
							{
								name: "Execute JavaScript",
								value: "javascript",
								description: "Execute custom JavaScript as fallback",
							},
						],
						default: "click",
						description: "Action to take if no match is found",
						displayOptions: {
							show: {
								fallbackAction: ["action"],
							},
						},
					},
					{
						displayName: "Fallback Selector",
						name: "fallbackSelector",
						type: "string",
						default: "",
						description: "Selector for fallback action",
						displayOptions: {
							show: {
								fallbackAction: ["action"],
								fallbackActionType: ["click"],
							},
						},
					},
					{
						displayName: "Fallback URL",
						name: "fallbackUrl",
						type: "string",
						default: "",
						description: "URL to navigate to as fallback",
						displayOptions: {
							show: {
								fallbackAction: ["action"],
								fallbackActionType: ["navigate"],
							},
						},
					},
					{
						displayName: "JavaScript Code",
						name: "javascriptCode",
						type: "string",
						default: "",
						description: "JavaScript code to execute as fallback",
						displayOptions: {
							show: {
								fallbackAction: ["action"],
								fallbackActionType: ["javascript"],
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


