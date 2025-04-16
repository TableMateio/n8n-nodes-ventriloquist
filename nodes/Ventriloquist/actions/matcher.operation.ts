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
	// Basic session configuration
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

	// Results Configuration
	{
		displayName: "Results",
		name: "resultsSection",
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
				value: "container",
				description: "Select a container with items",
			},
			{
				name: "Best Match",
				value: "bestMatch",
				description: "Find the best matching item",
			},
		],
		default: "container",
		description: "Method to select and compare items",
		displayOptions: {
			show: {
				operation: ["matcher"],
			},
		},
	},
	{
		displayName: "Results Container Selector",
		name: "containerSelector",
		type: "string",
		default: "",
		placeholder: "CSS selector (e.g., #results, .search-results)",
		description: "CSS selector for the container with the items to match",
		displayOptions: {
			show: {
				operation: ["matcher"],
				selectionMethod: ["container"],
			},
		},
	},
	{
		displayName: "Limit Candidates Compared",
		name: "limitCandidates",
		type: "boolean",
		default: false,
		description: "Whether to limit the number of candidates compared",
		displayOptions: {
			show: {
				operation: ["matcher"],
			},
		},
	},
	{
		displayName: "Auto-Detect Children",
		name: "autoDetectChildren",
		type: "boolean",
		default: true,
		description: "Automatically detect the repeating child elements within the container",
		displayOptions: {
			show: {
				operation: ["matcher"],
				selectionMethod: ["container"],
			},
		},
	},
	{
		displayName: "Wait for Elements",
		name: "waitForElements",
		type: "boolean",
		default: true,
		description: "Wait for elements to be present in DOM before matching",
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
		description: "Maximum time to wait for elements in milliseconds",
		displayOptions: {
			show: {
				operation: ["matcher"],
				waitForElements: [true],
			},
		},
	},

	// Comparison Criteria Section
	{
		displayName: "Comparison Criteria",
		name: "comparisonCriteria",
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
				description: "Compare based on text similarity",
			},
			{
				name: "Exact Match",
				value: "exact",
				description: "Require exact matches",
			},
		],
		default: "similarity",
		description: "Method to use for matching",
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

	// Smart Match (All Text) settings
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
				name: "Flexible Matching (Fuzzy)",
				value: "fuzzy",
				description: "Best for natural language and names",
			},
			{
				name: "Exact Containment",
				value: "containment",
				description: "Check if reference is fully contained in target",
			},
			{
				name: "Word Overlap",
				value: "jaccard",
				description: "Best for comparing sets of keywords",
			},
			{
				name: "Edit Distance",
				value: "levenshtein",
				description: "Best for typos and small variations",
			},
		],
		default: "fuzzy",
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
		name: "threshold",
		type: "number",
		typeOptions: {
			minValue: 0,
			maxValue: 1,
		},
		default: 0.7,
		description: "Minimum similarity score (0-1) required to consider a match",
		displayOptions: {
			show: {
				operation: ["matcher"],
				matchMethod: ["similarity"],
			},
		},
	},
	{
		displayName: "Must Match",
		name: "mustMatch",
		type: "boolean",
		default: false,
		description: "Whether this criterion must be matched (required)",
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
		description: "Weight of this criterion in the overall match score (0-1)",
		displayOptions: {
			show: {
				operation: ["matcher"],
				matchingApproach: ["smartAll"],
			},
		},
	},

	// Field by Field matching settings - using a fixedCollection
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
					targetSelector: "",
					similarityAlgorithm: "fuzzy",
					threshold: 0.7,
					importance: 0.5,
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
						name: "targetSelector",
						type: "string",
						default: "",
						placeholder: "h3 a, .price, span.location",
						description: "CSS selector to extract the value to compare against",
						required: true,
					},
					{
						displayName: "Similarity Algorithm",
						name: "similarityAlgorithm",
						type: "options",
						options: [
							{
								name: "Flexible Matching (Fuzzy)",
								value: "fuzzy",
								description: "Best for natural language and names",
							},
							{
								name: "Exact Containment",
								value: "containment",
								description: "Check if reference is fully contained in target",
							},
							{
								name: "Word Overlap",
								value: "jaccard",
								description: "Best for comparing sets of keywords",
							},
							{
								name: "Edit Distance",
								value: "levenshtein",
								description: "Best for typos and small variations",
							},
							{
								name: "Exact Match",
								value: "exact",
								description: "Require exact matches",
							},
						],
						default: "fuzzy",
						description: "Algorithm to use for calculating similarity",
						displayOptions: {
							show: {
								"/operation": ["matcher"],
								"/matchingApproach": ["fieldByField"],
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
						description: "Minimum similarity score (0-1) required for this field",
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
						description: "Weight of this field in the overall match score (0-1)",
					},
					{
						displayName: "Must Match",
						name: "mustMatch",
						type: "boolean",
						default: false,
						description: "Whether this field must match (required)",
					},
				],
			},
		],
	},

	// Action Configuration
	{
		displayName: "Actions",
		name: "actionsSection",
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
		name: "actionAfterMatch",
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
		description: "What action to perform after finding a match",
		displayOptions: {
			show: {
				operation: ["matcher"],
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

		// Get matching configuration
		const referenceValue = this.getNodeParameter('referenceValue', index, '') as string;
		const threshold = this.getNodeParameter('threshold', index, 0.7) as number;

		this.logger.info(`${logPrefix} Starting entity matching with reference value: ${referenceValue}`);

		// Create extracted items in the correct format
		const extractedItems: IExtractedItem[] = items.map((item, itemIndex) => {
			// Extract all field values from the item's JSON
			const extractedFields: Record<string, IExtractedField> = {};

			// Add a default text field using entire item JSON as text
			extractedFields['text'] = {
				name: 'text',
				value: typeof item.json === 'object' ? JSON.stringify(item.json) : String(item.json),
				original: typeof item.json === 'object' ? JSON.stringify(item.json) : String(item.json),
				normalized: typeof item.json === 'object' ? JSON.stringify(item.json) : String(item.json),
			};

			// Also add individual fields
			if (typeof item.json === 'object') {
				Object.entries(item.json).forEach(([key, value]) => {
					extractedFields[key] = {
						name: key,
						value: String(value),
						original: String(value),
						normalized: String(value),
					};
				});
			}

			return {
				index: itemIndex,
				element: item,
				fields: extractedFields,
			};
		});

		// Configure field comparisons based on available fields
		const fieldComparisons: IFieldComparisonConfig[] = [{
			field: 'text',
			weight: 1.0,
			algorithm: 'smart',
			threshold,
		}];

		// Configure comparison middleware
		const comparisonConfig: IEntityMatcherComparisonConfig = {
			threshold,
			matchMode: 'best',
			fieldComparisons,
			limitResults: 10,
			sortResults: true,
		};

		// Create middleware instance
		const matcherMiddleware = new EntityMatcherComparisonMiddleware();

		// Execute comparison
		const result = await matcherMiddleware.execute(
			{
				sourceEntity: {
					fields: { text: referenceValue },
				},
				extractedItems,
				comparisonConfig,
			},
			{
				logger: this.logger,
				nodeName: this.getNode().name,
				nodeId: this.getNode().id,
				index,
				sessionId,
			}
		);

		const endTime = Date.now();
		const executionDuration = endTime - startTime;

		// Return the matching results
		return {
			json: {
				success: true,
				sessionId,
				referenceValue,
				threshold,
				candidatesCount: extractedItems.length,
				matchesCount: result.matches?.length || 0,
				matches: result.matches,
				selectedMatch: result.selectedMatch,
				executionDuration,
			}
		};
	} catch (error) {
		const errorMessage = error instanceof Error ? error.message : String(error);
		this.logger.error(`${logPrefix} Error in matcher operation: ${errorMessage}`);

		// Use proper error response format with json property
		return {
			json: {
				success: false,
				error: errorMessage,
			}
		};
	}
}
