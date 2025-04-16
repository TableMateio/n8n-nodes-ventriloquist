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
		displayName: "Match Configuration",
		name: "matchConfig",
		type: "fixedCollection",
		default: {},
		options: [
			{
				name: "config",
				displayName: "Match Configuration",
				values: [
					{
						displayName: "Results Container Selector",
						name: "resultsSelector",
						type: "string",
						default: "",
						placeholder: "ul.results, #search-results, table tbody",
						description: "CSS selector for container with all results",
						required: true,
					},
					{
						displayName: "Item Selector",
						name: "itemSelector",
						type: "string",
						default: "",
						placeholder: "li, .result, tr",
						description: "CSS selector for individual result items (leave empty to auto-detect)",
					},
					{
						displayName: "Auto-detect Children",
						name: "autoDetectChildren",
						type: "boolean",
						default: true,
						description: "Automatically detect child elements for extraction",
					},
					{
						displayName: "Maximum Items to Compare",
						name: "maxItems",
						type: "number",
						typeOptions: {
							minValue: 1,
							maxValue: 100,
						},
						default: 10,
						description: "Maximum number of items to extract for comparison",
					},
					{
						displayName: "Similarity Threshold",
						name: "threshold",
						type: "number",
						typeOptions: {
							minValue: 0,
							maxValue: 1,
						},
						default: 0.3,
						description: "Minimum similarity score (0-1) required for an overall match. Matches below this threshold will be ignored.",
					},
					{
						displayName: "Match Mode",
						name: "matchMode",
						type: "options",
						options: [
							{
								name: "Best Match",
								value: "best",
								description: "Select only the best match above threshold",
							},
							{
								name: "All Matches",
								value: "all",
								description: "Return all matches above threshold",
							},
							{
								name: "First Match Above Threshold",
								value: "firstAboveThreshold",
								description: "Select first match that meets threshold",
							},
						],
						default: "best",
						description: "How to select matches from the results",
					},
					{
						displayName: "Limit Results",
						name: "limitResults",
						type: "number",
						typeOptions: {
							minValue: 1,
							maxValue: 100,
						},
						default: 3,
						description: "Maximum number of matches to return",
						displayOptions: {
							show: {
								matchMode: ["all"],
							},
						},
					},
					{
						displayName: "Wait For Container",
						name: "waitForSelectors",
						type: "boolean",
						default: true,
						description: "Wait for results container to appear in the page",
					},
					{
						displayName: "Timeout (ms)",
						name: "timeout",
						type: "number",
						default: 10000,
						description: "Maximum wait time in milliseconds",
						displayOptions: {
							show: {
								waitForSelectors: [true],
							},
						},
					},
				],
			},
		],
	},

	// ==================== 3. CRITERIA COLLECTION ====================
	{
		displayName: "Match Criteria",
		name: "matchCriteria",
		type: "fixedCollection",
		typeOptions: {
			multipleValues: true,
			sortable: true,
			multipleValueButtonText: "Add Criterion",
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
								comparisonApproach: ["fieldByField"],
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
		description: "CSS selector relative to the matched element (leave empty to use the matched element itself)",
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
	// Performance and Debugging options moved to the end
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
];

/**
 * Execute the matcher operation
 */
export async function execute(
	this: IExecuteFunctions,
	index: number,
	workflowId: string,
): Promise<INodeExecutionData> {
	// Get operation start time for performance logging
	const startTime = Date.now();

	// Get the browser from session
	const browser = await this.getNodeParameter('browser', index) as any;

	// Get active page using the function from sessionUtils
	const page = await getActivePageFunc.call(this, browser, this.logger);
	if (!page) throw new Error("No active page found");

	// Get session ID or use empty string if not available
	const sessionId = this.getNodeParameter('explicitSessionId', index, '') as string;

	const nodeId = this.getNode().id || "unknown";
	const nodeName = this.getNode().name;
	this.logger.info(`[Matcher][${nodeId}] Starting matcher operation on: ${await page.url()}`);

	try {
		// Get configuration values
		const matchConfig = this.getNodeParameter('matchConfig.config', index) as IDataObject;
		this.logger.debug(`[Matcher] Match configuration: ${JSON.stringify(matchConfig)}`);

		const matchCriteria = this.getNodeParameter('matchCriteria.criteria', index, []) as IDataObject[];
		this.logger.debug(`[Matcher] Match criteria: ${JSON.stringify(matchCriteria)}`);

		if (!matchCriteria || matchCriteria.length === 0) {
			throw new Error('No match criteria specified. Please add at least one criterion.');
		}

		// Build source entity from criteria
		const sourceEntity: Record<string, string> = {};

		for (let i = 0; i < matchCriteria.length; i++) {
			const criterion = matchCriteria[i];

			if (criterion.comparisonApproach === 'smartAll' || criterion.comparisonApproach === 'matchAll') {
				// For Smart Match (All) and Match All, use criterion name as field name and reference value as value
				const fieldName = criterion.name as string || `criterion_${i}`;
				const refValue = criterion.referenceValue as string || '';

				if (!refValue || refValue.trim() === '') {
					this.logger.warn(`[Matcher] Empty reference value for criterion "${fieldName}"`);
				}

				sourceEntity[fieldName] = refValue;
			} else if (criterion.comparisonApproach === 'fieldByField') {
				// For Field by Field, get field comparisons
				const fieldComparisons = (criterion.fieldComparisons as IDataObject)?.fields as IDataObject[] || [];

				for (const field of fieldComparisons) {
					const fieldName = field.name as string;
					const refValue = field.referenceValue as string || '';

					if (!refValue || refValue.trim() === '') {
						this.logger.warn(`[Matcher] Empty reference value for field "${fieldName}"`);
					}

					sourceEntity[fieldName] = refValue;
				}
			}
		}

		// Validate we have at least one non-empty reference value
		const nonEmptyValues = Object.values(sourceEntity).filter(value => value && value.trim() !== '');
		if (nonEmptyValues.length === 0) {
			throw new Error('All reference values are empty. Please provide at least one non-empty reference value to match against.');
		}

		// Get parameters
		const selectionMethod = this.getNodeParameter('selectionMethod', index, 'containerItems') as string;
		let resultsSelector = '';
		let itemSelector = '';
		let directItemSelector = '';

		if (selectionMethod === 'containerItems') {
			resultsSelector = this.getNodeParameter('resultsSelector', index, '') as string;
		} else {
			directItemSelector = this.getNodeParameter('directItemSelector', index, '') as string;
		}

		const waitForSelectors = this.getNodeParameter('waitForSelectors', index, true) as boolean;
		const timeout = this.getNodeParameter('timeout', index, 10000) as number;
		const matchMode = this.getNodeParameter('matchMode', index, 'best') as string;
		const actionOnMatch = this.getNodeParameter('actionOnMatch', index, 'none') as string;
		const performanceMode = this.getNodeParameter('performanceMode', index, 'balanced') as string;
		const enableDetailedLogs = this.getNodeParameter('enableDetailedLogs', index, false) as boolean;

		// Visual marker to clearly indicate a new node is starting
		this.logger.info(`${'='.repeat(40)}`);
		this.logger.info(`[Ventriloquist][${nodeName}#${index}][Matcher] Starting operation`);

		// Set up matcher configuration
		let containerInfo: IContainerInfo = { containerFound: false };

		// Wait for elements if requested
		if (waitForSelectors) {
			if (selectionMethod === 'containerItems') {
				if (resultsSelector) {
					this.logger.info(`[Matcher] Waiting for results container: ${resultsSelector}`);
					try {
						await smartWaitForSelector(
							page,
							resultsSelector,
							timeout,
							250, // Use a reasonable default early exit delay
							this.logger,
							nodeName,
							nodeId
						);

						// Get additional info about the container
						containerInfo = await page.evaluate((selector: string) => {
							const container = document.querySelector(selector);
							if (!container) return { containerFound: false };

							return {
								containerFound: true,
								tagName: container.tagName,
								className: container.className,
								childCount: container.childElementCount,
								documentState: {
									readyState: document.readyState,
									bodyChildCount: document.body.childElementCount,
								}
							};
						}, resultsSelector);

						this.logger.info(`[Matcher] Found container: ${JSON.stringify(containerInfo)}`);
					} catch (error) {
						this.logger.warn(`[Matcher] Container selector timed out: ${(error as Error).message}`);
						containerInfo.containerFound = false;
					}
				}
			} else if (selectionMethod === 'directItems' && directItemSelector) {
				this.logger.info(`[Matcher] Waiting for direct item selector: ${directItemSelector}`);
				try {
					await smartWaitForSelector(
						page,
						directItemSelector,
						timeout,
						250, // Use a reasonable default early exit delay
						this.logger,
						nodeName,
						nodeId
					);
				} catch (error) {
					this.logger.warn(`[Matcher] Direct item selector timed out: ${(error as Error).message}`);
				}
			}
		}

		// Create match configuration object
		const maxResults = matchMode === 'all' ? 10 : 1;

		// Create entity matcher configuration
		const matcherConfig: IEntityMatcherConfig = {
			resultsSelector: selectionMethod === 'containerItems' ? resultsSelector : directItemSelector,
			itemSelector,
			autoDetectChildren: true,
			threshold: Number(matchConfig.threshold) || 0.3,
			matchMode: matchMode as 'best' | 'all' | 'firstAboveThreshold',
			limitResults: maxResults,
			sourceEntity,
			fieldComparisons: [],
			fields: [],
			performanceMode: performanceMode as 'balanced' | 'speed' | 'accuracy',
			debugMode: enableDetailedLogs,
			action: actionOnMatch as 'click' | 'extract' | 'none',
			waitForSelectors,
			timeout,
		};

		// Configure additional action parameters if an action is selected
		if (actionOnMatch !== 'none') {
			matcherConfig.actionSelector = this.getNodeParameter('actionSelector', index, '') as string;
			matcherConfig.waitAfterAction = this.getNodeParameter('waitAfterAction', index, true) as boolean;

			if (matcherConfig.waitAfterAction) {
				const waitFor = this.getNodeParameter('waitFor', index, 'navigation') as string;
				if (waitFor === 'element') {
					matcherConfig.waitSelector = this.getNodeParameter('waitSelector', index, '') as string;
				} else if (waitFor === 'delay') {
					matcherConfig.waitTime = this.getNodeParameter('waitTime', index, 2000) as number;
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

		const matchResult = await entityMatcher.execute();

		// Log the match result
		if (matchResult.success) {
			this.logger.info(`[Matcher] Found ${matchResult.matches?.length || 0} matches`);
			if (matchResult.selectedMatch) {
				this.logger.info(`[Matcher] Selected match with score: ${matchResult.selectedMatch.overallSimilarity}`);
			}
		} else {
			this.logger.warn(`[Matcher] No matches found: ${matchResult.error || 'Unknown error'}`);
		}

		// Log additional debug info if enabled
		if (enableDetailedLogs) {
			try {
				// Log additional page debug info
				await logPageDebugInfo(page, this.logger, {
					operation: 'matcher',
					nodeName,
					nodeId,
					index
				});
			} catch (error) {
				this.logger.error(`[Matcher] Debug logging error: ${(error as Error).message}`);
			}
		}

		// Create output item
		const item = {
			json: {
				...matchResult,
				duration: Date.now() - startTime,
			}
		};

		return item;
	} catch (error: any) {
		this.logger.error(
			`[Ventriloquist][${nodeName}#${index}][Matcher][${nodeId}] Error: ${error.message}`,
		);

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

