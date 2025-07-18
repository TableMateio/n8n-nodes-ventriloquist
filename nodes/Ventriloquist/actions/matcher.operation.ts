import {
	IDataObject,
	IExecuteFunctions,
	INodeExecutionData,
	INodeProperties,
	IWebhookResponseData,
	Logger as ILogger,
	INodeType,
	NodeOperationError
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
	type IEntityMatchResult,
	type IEntityMatcherExtractionConfig,
	type IEntityMatcherComparisonConfig,
	type IEntityMatcherActionConfig,
	type ISourceEntity,
	type IEntityMatcherOutput,
	type IExtractedItem,
	type IExtractedField,
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
		displayOptions: {
			show: {
				operation: ["matcher"],
			},
		},
	},

	// ==================== 2. MATCH CONFIGURATION ====================
	{
		displayName: "Selection Method",
		name: "selectionMethod",
		type: "options",
		options: [
			{
				name: "Container with auto-detected children",
				value: "containerItems",
				description: "Select a container element whose children will be auto-detected for matching",
			},
			{
				name: "Direct Items",
				value: "directItems",
				description: "Select items directly with a specific selector (no auto-detection)",
			},
		],
		default: "containerItems",
		description: "How to select elements to match against",
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
		placeholder: "ul.results, #search-results, table tbody, li, .result, tr",
		description: "CSS selector for items to match against. For 'Container with auto-detected children' mode: select the container element. For 'Direct Items' mode: select the items directly.",
		displayOptions: {
			show: {
				operation: ["matcher"],
			},
		},
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
		displayOptions: {
			show: {
				operation: ["matcher"],
			},
		},
	},
	{
		displayName: "Wait For Selectors",
		name: "waitForSelectors",
		type: "boolean",
		default: true,
		description: "Wait for selectors to appear before processing",
		displayOptions: {
			show: {
				operation: ["matcher"],
			},
		},
	},
	{
		displayName: "Timeout (ms)",
		name: "timeout",
		type: "number",
		default: 10000,
		description: "How long to wait for selectors in milliseconds",
		displayOptions: {
			show: {
				operation: ["matcher"],
				waitForSelectors: [true],
			},
		},
	},

	// ==================== 3. COMPARISON CRITERIA ====================
	{
		displayName: "Match Criteria",
		name: "matchCriteria",
		type: "fixedCollection",
		typeOptions: {
			multipleValues: true,
			sortable: true,
		},
		default: { criteria: [{ name: "criterion1", comparisonApproach: "smartAll", referenceValue: "" }] },
		description: "Define criteria for matching",
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
						displayName: "Name",
						name: "name",
						type: "string",
						default: "",
						description: "Name to identify this criterion",
						required: true,
					},
					{
						displayName: "Comparison Approach",
						name: "comparisonApproach",
						type: "options",
						options: [
							{
								name: "Smart Match (All)",
								value: "smartAll",
								description: "Smart comparison of the entire content (handles auto-extracted text)",
							},
							{
								name: "Match All",
								value: "matchAll",
								description: "Compare with the entire visible content of items",
							},
							{
								name: "Field by Field",
								value: "fieldByField",
								description: "Compare specific fields individually",
							},
						],
						default: "smartAll",
					},
					{
						displayName: "Reference Value",
						name: "referenceValue",
						type: "string",
						typeOptions: {
							rows: 2,
						},
						default: "",
						description: "Text to search for in the items",
						displayOptions: {
							show: {
								comparisonApproach: ["smartAll", "matchAll"],
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
						default: 0.3,
						description: "Minimum similarity score (0-1) required for this criterion. Matches below this threshold will be ignored.",
						displayOptions: {
							show: {
								comparisonApproach: ["smartAll", "matchAll"],
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
							},
						},
					},
					{
						displayName: "Weight",
						name: "weight",
						type: "number",
						typeOptions: {
							minValue: 0,
							maxValue: 1,
						},
						default: 1,
						description: "How important this criterion is in the overall match (0-1)",
						displayOptions: {
							show: {
								comparisonApproach: ["smartAll", "matchAll"],
							},
						},
					},
					// Field-by-field comparison options
					{
						displayName: "Field Comparisons",
						name: "fieldComparisons",
						type: "fixedCollection",
						default: {},
						typeOptions: {
							multipleValues: true,
						},
						description: "Define field-by-field comparison criteria",
						displayOptions: {
							show: {
								comparisonApproach: ["fieldByField"],
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
										description: "Name to identify this field",
										required: true,
									},
									{
										displayName: "Reference Value",
										name: "referenceValue",
										type: "string",
										default: "",
										description: "Text to search for in this field",
										required: true,
									},
									{
										displayName: "Target Selector",
										name: "selector",
										type: "string",
										default: "",
										placeholder: ".title, h3, td:nth-child(2)",
										description:
											"CSS selector to target specific element (relative to the result item)",
									},
									{
										displayName: "Comparison Algorithm",
										name: "algorithm",
										type: "options",
										options: [
											{
												name: "Smart (Mixed Strategies)",
												value: "smart",
												description: "Best all-purpose text comparison",
											},
											{
												name: "Contains",
												value: "contains",
												description: "Check if target contains reference",
											},
											{
												name: "Containment",
												value: "containment",
												description: "Optimized for finding text within larger content",
											},
											{
												name: "Exact Match",
												value: "exact",
												description: "Require exact text match",
											},
											{
												name: "Levenshtein",
												value: "levenshtein",
												description: "Edit distance-based similarity",
											},
											{
												name: "Jaccard",
												value: "jaccard",
												description: "Word overlap similarity",
											},
										],
										default: "smart",
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
												description: "Element attribute value",
											},
										],
										default: "text",
									},
									{
										displayName: "Attribute Name",
										name: "attribute",
										type: "string",
										default: "",
										placeholder: "href, data-id, title",
										description: "Element attribute to extract (leave empty for text content)",
										displayOptions: {
											show: {
												dataFormat: ["attribute"],
											},
										},
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
										default: 0.3,
										description: "Minimum similarity for this specific field to be considered a match",
									},
								],
							},
						],
					},
				]
			}
		]
	},

	// ==================== 4. ACTION HANDLING ====================
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
				actionOnMatch: ["click", "extract"],
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
				name: "Element",
				value: "element",
				description: "Wait for a specific element to appear",
			},
			{
				name: "Delay",
				value: "delay",
				description: "Wait for a specific amount of time",
			},
		],
		default: "navigation",
		description: "What to wait for after the action",
		displayOptions: {
			show: {
				operation: ["matcher"],
				actionOnMatch: ["click", "extract"],
				waitAfterAction: [true],
			},
		},
	},
	{
		displayName: "Wait Selector",
		name: "waitSelector",
		type: "string",
		default: "",
		description: "Element to wait for after action",
		placeholder: "#result, .success-message",
		displayOptions: {
			show: {
				operation: ["matcher"],
				actionOnMatch: ["click", "extract"],
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
		description: "Maximum time to wait in milliseconds",
		displayOptions: {
			show: {
				operation: ["matcher"],
				actionOnMatch: ["click", "extract"],
				waitAfterAction: [true],
				waitFor: ["navigation", "element"],
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
				actionOnMatch: ["click", "extract"],
				waitAfterAction: [true],
				waitFor: ["delay"],
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
		description: "Controls the performance vs. accuracy tradeoff",
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
	{
		displayName: "Output Input Data",
		name: "outputInputData",
		type: "boolean",
		default: true,
		description: "Whether to include the input data in the output",
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
	websocketEndpoint: string,
): Promise<INodeExecutionData> {
	// Get operation start time for performance logging
	const startTime = Date.now();

	// Get the node information for logging
	const nodeId = this.getNode().id || "unknown";
	const nodeName = this.getNode().name;

	// Get session ID or use empty string if not available
	const sessionId = this.getNodeParameter('explicitSessionId', index, '') as string;

	// Get input data and output settings
	const item = this.getInputData()[index];
	const outputInputData = this.getNodeParameter('outputInputData', index, true) as boolean;

	this.logger.info(`[Matcher][${nodeId}] Starting matcher operation`);

	// Initialize page as null so it's accessible in catch block
	let page: Page | null = null;

	try {
		// Get browser and page using the SessionManager instead of direct parameter access
		const sessionResult = await SessionManager.getOrCreatePageSession(this.logger, {
			explicitSessionId: sessionId,
			websocketEndpoint, // Now we use the passed websocketEndpoint
			workflowId,
			operationName: 'Matcher',
			nodeId,
			nodeName,
			index,
		});

		page = sessionResult.page;
		if (!page) throw new Error("No active page found");

		this.logger.info(`[Matcher][${nodeId}] Starting matcher operation on: ${await page.url()}`);

		// Get configuration values
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
		let itemSelector = '';

		if (selectionMethod === 'containerItems') {
			itemSelector = this.getNodeParameter('itemSelector', index, '') as string;
		} else {
			itemSelector = this.getNodeParameter('itemSelector', index, '') as string;
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

		// Define the selector to use based on selection method
		let actualItemSelector: string;
		let container: boolean | null = null;

		if (selectionMethod === 'containerItems') {
			// For container method, use the container selector directly
			// The extraction middleware will handle finding children
			actualItemSelector = itemSelector;

			// Check if container exists and wait for it if needed
			if (waitForSelectors) {
				try {
					await page.waitForSelector(itemSelector, { timeout });
					container = true;
				} catch (error) {
					container = false;
				}
			} else {
				container = await page.evaluate((selector: string) => {
					return !!document.querySelector(selector);
				}, itemSelector);
			}

			if (!container) {
				this.logger.warn(
					formatOperationLog(
						'Matcher',
						nodeName,
						nodeId,
						index,
						`Container selector not found: ${itemSelector}`
					)
				);
				const error = new NodeOperationError(this.getNode(), `Container selector not found: ${itemSelector}`);
				const debugInfo: IDataObject = {
					containerSelector: itemSelector,
					itemSelector: actualItemSelector,
					waitForSelectors,
					timeout
				};
				return {
					json: {
						...(outputInputData && item.json ? item.json : {}),
						success: 0,
						containerFound: 0,
						error,
						debug: debugInfo,
						matches: [],
						itemsFound: 0,
						executionDuration: Date.now() - startTime,
						sessionId
					}
				};
			}

			// Log the container's children count for debugging
			if (enableDetailedLogs) {
				const containerInfo = await page.evaluate((selector: string) => {
					const container = document.querySelector(selector);
					if (!container) return null;
					return {
						tagName: container.tagName,
						className: container.className,
						childCount: container.children.length,
						childTags: Array.from(container.children).map(child => child.tagName)
					};
				}, itemSelector);

				if (containerInfo) {
					this.logger.info(
						formatOperationLog(
							'Matcher',
							nodeName,
							nodeId,
							index,
							`Container found: ${containerInfo.tagName}${containerInfo.className ? '.' + containerInfo.className : ''} with ${containerInfo.childCount} children (${containerInfo.childTags.join(', ')})`
						)
					);
				}
			}
		} else {
			// For direct method, use the provided item selector
			actualItemSelector = itemSelector;
		}

		// Create match configuration object
		const maxItems = matchMode === 'all' ?
			(this.getNodeParameter('maxItems', index, 10) as number) :
			(this.getNodeParameter('maxItems', index, 20) as number);

		// Build field comparison configurations from criteria
		const fieldComparisons: any[] = [];

		for (let i = 0; i < matchCriteria.length; i++) {
			const criterion = matchCriteria[i];
			const mustMatch = criterion.mustMatch === true;
			const weight = criterion.weight !== undefined ? Number(criterion.weight) : 1;
			const threshold = criterion.threshold !== undefined ? Number(criterion.threshold) : 0.3;

			if (criterion.comparisonApproach === 'smartAll' || criterion.comparisonApproach === 'matchAll') {
				// For Smart Match (All) and Match All methods, add a field comparison entry
				const fieldName = criterion.name as string || `criterion_${i}`;

				fieldComparisons.push({
					field: fieldName,
					weight,
					mustMatch,
					threshold,
					algorithm: criterion.comparisonApproach === 'smartAll' ? 'smart' : 'containment'
				});
			} else if (criterion.comparisonApproach === 'fieldByField') {
				// For Field by Field, extract all field comparisons
				const fieldComparisonConfigs = (criterion.fieldComparisons as IDataObject)?.fields as IDataObject[] || [];

				for (const fieldConfig of fieldComparisonConfigs) {
					fieldComparisons.push({
						field: fieldConfig.name as string,
						weight: fieldConfig.weight !== undefined ? Number(fieldConfig.weight) : 0.5,
						mustMatch: fieldConfig.mustMatch === true,
						threshold: fieldConfig.threshold !== undefined ? Number(fieldConfig.threshold) : threshold,
						algorithm: fieldConfig.algorithm as string || 'smart',
						selector: fieldConfig.selector as string || ''
					});
				}
			}
		}

		// If no field comparisons were created, create a default one using all criteria
		if (fieldComparisons.length === 0 && Object.keys(sourceEntity).length > 0) {
			// Create a default comparison using all fields as a single smart comparison
			fieldComparisons.push({
				field: 'Default Criterion',
				weight: 1,
				mustMatch: false,
				threshold: Number(matchCriteria[0].threshold) || 0.3,
				algorithm: 'smart'
			});

			this.logger.info(`[Matcher] Created default field comparison for all criteria`);
		}

		// Create entity matcher configuration
		const matcherConfig: IEntityMatcherConfig = {
			resultsSelector: actualItemSelector,
			itemSelector: selectionMethod === 'containerItems' ? '> *' : '',
			autoDetectChildren: selectionMethod === 'containerItems',
			fields: matchCriteria,
			threshold: Number(matchCriteria[0].threshold) || 0.3,
			matchMode: matchMode as 'best' | 'all' | 'firstAboveThreshold',
			maxItems,
			performanceMode: performanceMode as 'balanced' | 'speed' | 'accuracy',
			debugMode: enableDetailedLogs,
			sourceEntity: sourceEntity || {}, // Pass the actual source entity
			fieldComparisons: fieldComparisons || [],
			// Add action configuration
			action: actionOnMatch as 'click' | 'extract' | 'none',
			actionSelector: this.getNodeParameter('actionSelector', index, '') as string,
			waitAfterAction: this.getNodeParameter('waitAfterAction', index, true) as boolean,
			waitTime: this.getNodeParameter('waitTime', index, 2000) as number,
			waitSelector: this.getNodeParameter('waitSelector', index, '') as string
		};

		// Debug log: print out the sourceEntity and reference values
		if (enableDetailedLogs) {
			this.logger.info('[Matcher][DEBUG] About to call entity matcher with sourceEntity: ' + JSON.stringify(matcherConfig.sourceEntity, null, 2));
			this.logger.info('[Matcher][DEBUG] Reference values from matchCriteria: ' + JSON.stringify(matchCriteria, null, 2));
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
			this.logger.info(`[Matcher] Found ${matchResult.matches?.length || 0} matches above threshold`);
			if (matchResult.selectedMatch) {
				this.logger.info(`[Matcher] Selected match with score: ${matchResult.selectedMatch.overallSimilarity.toFixed(4)}`);
			}

			// Additional logging for total items compared
			if (matchResult.comparisons) {
				this.logger.info(`[Matcher] Compared ${matchResult.comparisons.length} total items`);
			}

			// If there are matches but no selections, log why
			if (matchResult.matches?.length > 0 && !matchResult.selectedMatch) {
				this.logger.warn(`[Matcher] No match was selected despite finding matches. Check match criteria and threshold.`);
			}
		} else {
			this.logger.warn(`[Matcher] No matches found: ${matchResult.error || matchResult.message || 'Unknown error'}`);
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

				// Log comparison details for debugging
				if (matchResult.comparisons && matchResult.comparisons.length > 0) {
					this.logger.info(`[Matcher] Top comparison details:`);
					const topComparison = matchResult.comparisons[0];
					this.logger.info(`  - Index: ${topComparison.index}`);
					this.logger.info(`  - Overall similarity: ${topComparison.overallSimilarity.toFixed(4)}`);
					this.logger.info(`  - Selected: ${topComparison.selected}`);

					// Log field similarities
					if (topComparison.similarities) {
						for (const [field, score] of Object.entries(topComparison.similarities)) {
							this.logger.info(`  - ${field}: ${(score as number).toFixed(4)}`);
						}
					}
				}
			} catch (error) {
				this.logger.error(`[Matcher] Debug logging error: ${(error as Error).message}`);
			}
		}

		// Create output item with clearer structure
		let matches = matchResult.matches || matchResult.comparisons || [];

		// When using "best" or "firstAboveThreshold" match mode, filter matches to only include the selected match
		if ((matchMode === 'best' || matchMode === 'firstAboveThreshold') && matchResult.selectedMatch) {
			// Keep only the selected match in the matches array
			matches = matches.filter((m: IEntityMatchResult) => m.selected === true);
			this.logger.info(`[Matcher] Filtered matches to only include the selected match in "${matchMode}" match mode`);
		}

		const resultData = {
			...matchResult,
			// For backward compatibility, keep the matches array, but filtered for best match mode
			matches,
			// Add clear distinction between matches and all comparisons
			actualMatches: matches,
			allComparisons: matchResult.comparisons || [],
			// Make it clearer if anything was actually matched
			matchesFound: (matches.length || 0) > 0,
			matchSelected: !!matchResult.selectedMatch,
			// Add standardized formatting to match counts
			matchCount: matches.length || 0,
			totalCompared: matchResult.totalCompared || matchResult.comparisons?.length || matchResult.itemsFound || 0,
			// Include unique selectors for matched elements
			uniqueSelectors: {
				selected: matchResult.selectedMatch?.uniqueSelector || null,
				matches: matches.filter((m: IEntityMatchResult) => m.uniqueSelector).map((m: IEntityMatchResult) => ({
					index: m.index,
					selector: m.uniqueSelector,
					similarity: m.overallSimilarity
				})) || []
			},
			// Add information about matches that helps explain the selection
			matchDetails: {
				richestMatch: matchResult.comparisons?.sort((a: IEntityMatchResult, b: IEntityMatchResult) =>
					(b.informationRichness || 0) - (a.informationRichness || 0)
				)[0] || null,
				selectedReason: matchResult.selectedMatch ?
					`Best overall similarity (${matchResult.selectedMatch.overallSimilarity.toFixed(4)}) with information richness ${(matchResult.selectedMatch.informationRichness || 0).toFixed(4)}` :
					'No match selected',
				scoringFactors: [
					'Overall similarity score (primary factor)',
					'Information richness (secondary factor, breaks ties)',
					'Matching of key identifiers and numeric values',
					'Word overlap and sequence matching'
				]
			},
			// Include the sessionId in the output
			sessionId,
			duration: Date.now() - startTime,
		};

		return {
			json: {
				...(outputInputData && item.json ? item.json : {}),
				...resultData
			}
		};

	} catch (error: any) {
		this.logger.error(
			`[Ventriloquist][${nodeName}#${index}][Matcher][${nodeId}] Error: ${error.message}`,
		);

		// Return error response
		const errorResponse = await createErrorResponse({
			error,
			operation: "matcher",
			sessionId,
			nodeId,
			nodeName,
			startTime,
			logger: this.logger,
			page
		});

		return {
			json: {
				...(outputInputData && item.json ? item.json : {}),
				...errorResponse
			}
		};
	}
}

