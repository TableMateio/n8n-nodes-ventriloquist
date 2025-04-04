import type {
	IExecuteFunctions,
	IDataObject,
	INodeExecutionData,
	INodeProperties,
} from 'n8n-workflow';
import type * as puppeteer from 'puppeteer-core';
import type { IDetectionOptions, IDetectionResult } from '../utils/detectionUtils';
import { SessionManager } from '../utils/sessionManager';
import {
	formatReturnValue,
	takePageScreenshot,
	detectElement,
	detectText,
	detectCount,
	detectUrl,
	detectWorkflowCondition
} from '../utils/detectionUtils';
import { formatOperationLog, createSuccessResponse, createTimingLog } from '../utils/resultUtils';
import { createErrorResponse } from '../utils/errorUtils';

/**
 * Detect operation description
 */
export const description: INodeProperties[] = [
	{
		displayName: 'Session ID',
		name: 'explicitSessionId',
		type: 'string',
		default: '',
		description: 'Session ID to use (leave empty to use ID from input or create new)',
		displayOptions: {
			show: {
				operation: ['detect'],
			},
		},
	},
	{
		displayName: 'Detections',
		name: 'detections',
		placeholder: 'Add Detection',
		type: 'fixedCollection',
		typeOptions: {
			multipleValues: true,
			sortable: true,
		},
		displayOptions: {
			show: {
				operation: ['detect'],
			},
		},
		description: 'Define detection conditions to check elements on the page',
		default: {},
		options: [
			{
				name: 'detection',
				displayName: 'Detection',
				values: [
					{
						displayName: 'Detection Type',
						name: 'detectionType',
						type: 'options',
						options: [
							{
								name: 'Attribute Value',
								value: 'attributeValue',
								description: 'Check if an element has a specific attribute value',
							},
							{
								name: 'Element Count',
								value: 'elementCount',
								description: 'Count how many elements match a selector',
							},
							{
								name: 'Element Exists',
								value: 'elementExists',
								description: 'Check if an element exists on the page',
							},
							{
								name: 'Text Contains',
								value: 'textContains',
								description: 'Check if an element contains specific text',
							},
							{
								name: 'URL Contains',
								value: 'urlContains',
								description: 'Check if the current URL contains a specific string',
							},
						],
						default: 'elementExists',
						description: 'Type of detection to perform',
					},
					{
						displayName: 'Output Label',
						name: 'name',
						type: 'string',
						default: '',
						description: 'Label for this detection result in the output',
						placeholder: 'e.g., loginButton',
						required: true,
					},
					{
						displayName: 'Selector',
						name: 'selector',
						type: 'string',
						default: '',
						placeholder: '#element, .class, div[data-test="value"]',
						description: 'CSS selector to target the element(s)',
						displayOptions: {
							show: {
								detectionType: ['elementExists', 'textContains', 'attributeValue', 'elementCount'],
							},
						},
					},
					{
						displayName: 'Text to Check',
						name: 'textToCheck',
						type: 'string',
						default: '',
						description: 'Text content to check for in the selected element',
						displayOptions: {
							show: {
								detectionType: ['textContains'],
							},
						},
					},
					{
						displayName: 'URL Substring',
						name: 'urlSubstring',
						type: 'string',
						default: '',
						description: 'String to check for in the current URL',
						displayOptions: {
							show: {
								detectionType: ['urlContains'],
							},
						},
					},
					{
						displayName: 'Attribute Name',
						name: 'attributeName',
						type: 'string',
						default: '',
						placeholder: 'data-ID, class, href',
						description: 'Name of the attribute to check',
						displayOptions: {
							show: {
								detectionType: ['attributeValue'],
							},
						},
					},
					{
						displayName: 'Attribute Value',
						name: 'attributeValue',
						type: 'string',
						default: '',
						description: 'Expected value of the attribute',
						displayOptions: {
							show: {
								detectionType: ['attributeValue'],
							},
						},
					},
					{
						displayName: 'Expected Count',
						name: 'expectedCount',
						type: 'number',
						default: 1,
						description: 'Expected number of elements to find',
						displayOptions: {
							show: {
								detectionType: ['elementCount'],
							},
						},
					},
					{
						displayName: 'Count Comparison',
						name: 'countComparison',
						type: 'options',
						options: [
							{
								name: 'Equal To',
								value: 'equal',
							},
							{
								name: 'Greater Than',
								value: 'greater',
							},
							{
								name: 'Greater Than or Equal To',
								value: 'greaterEqual',
							},
							{
								name: 'Less Than',
								value: 'less',
							},
							{
								name: 'Less Than or Equal To',
								value: 'lessEqual',
							},
						],
						default: 'equal',
						description: 'How to compare the actual count with the expected count',
						displayOptions: {
							show: {
								detectionType: ['elementCount'],
							},
						},
					},
					{
						displayName: 'Match Type',
						name: 'matchType',
						type: 'options',
						options: [
							{
								name: 'Contains',
								value: 'contains',
								description: 'Value must contain the specified string',
							},
							{
								name: 'Ends With',
								value: 'endsWith',
								description: 'Value must end with the specified string',
							},
							{
								name: 'Exact Match',
								value: 'exact',
								description: 'Value must match exactly',
							},
							{
								name: 'RegEx',
								value: 'regex',
								description: 'Match using a regular expression',
							},
							{
								name: 'Starts With',
								value: 'startsWith',
								description: 'Value must start with the specified string',
							},
						],
						default: 'contains',
						description: 'How to match the text or attribute value',
						displayOptions: {
							show: {
								detectionType: ['textContains', 'attributeValue', 'urlContains'],
							},
						},
					},
					{
						displayName: 'Case Sensitive',
						name: 'caseSensitive',
						type: 'boolean',
						default: false,
						description: 'Whether the matching should be case-sensitive',
						displayOptions: {
							show: {
								detectionType: ['textContains', 'attributeValue', 'urlContains'],
							},
						},
					},
					{
						displayName: 'Return Type',
						name: 'returnType',
						type: 'options',
						options: [
							{
								name: 'Boolean (True/False)',
								value: 'boolean',
								description: 'Return true or false based on the detection result',
							},
							{
								name: 'String',
								value: 'string',
								description: 'Return custom strings for success and failure',
							},
							{
								name: 'Number',
								value: 'number',
								description: 'Return 1 for success, 0 for failure (useful for math operations)',
							},
							{
								name: 'Actual Value',
								value: 'value',
								description: 'Return the actual text, attribute value, or count found',
							},
						],
						default: 'boolean',
						description: 'The type of value to return in the result',
					},
					{
						displayName: 'Success Value',
						name: 'successValue',
						type: 'string',
						default: 'success',
						description: 'Value to return when detection succeeds',
						displayOptions: {
							show: {
								returnType: ['string'],
							},
						},
					},
					{
						displayName: 'Failure Value',
						name: 'failureValue',
						type: 'string',
						default: 'failure',
						description: 'Value to return when detection fails',
						displayOptions: {
							show: {
								returnType: ['string'],
							},
						},
					},
					{
						displayName: 'Invert Result',
						name: 'invertResult',
						type: 'boolean',
						default: false,
						description: 'Whether to invert the detection result (true becomes false, false becomes true)',
					},
				],
			},
		],
		required: true,
	},
	{
		displayName: 'Wait For Selectors',
		name: 'waitForSelectors',
		type: 'boolean',
		default: true,
		description: 'Whether to wait for selectors to appear within the timeout period',
		displayOptions: {
			show: {
				operation: ['detect'],
			},
		},
	},
	{
		displayName: 'Detection Method',
		name: 'detectionMethod',
		type: 'options',
		options: [
			{
				name: 'Smart (Auto-Exit When Found)',
				value: 'smart',
				description: 'Auto-exits when element is found instead of waiting full timeout',
			},
			{
				name: 'Fixed (Wait Full Timeout)',
				value: 'fixed',
				description: 'Always waits for full timeout period',
			},
		],
		default: 'smart',
		description: 'Method to use when waiting for elements',
		displayOptions: {
			show: {
				operation: ['detect'],
				waitForSelectors: [true],
			},
		},
	},
	{
		displayName: 'Timeout (MS)',
		name: 'timeout',
		type: 'number',
		default: 5000,
		description: 'Maximum time in milliseconds to wait for detection operations',
		displayOptions: {
			show: {
				operation: ['detect'],
			},
		},
	},
	{
		displayName: 'Take Screenshot',
		name: 'takeScreenshot',
		type: 'boolean',
		default: false,
		description: 'Whether to capture a screenshot after detection',
		displayOptions: {
			show: {
				operation: ['detect'],
			},
		},
	},
	{
		displayName: 'Continue On Fail',
		name: 'continueOnFail',
		type: 'boolean',
		default: true,
		description: 'Whether to continue execution even when detection operations fail (cannot find element or timeout)',
		displayOptions: {
			show: {
				operation: ['detect'],
			},
		},
	},
	{
		displayName: 'Early Exit Delay (MS)',
		name: 'earlyExitDelay',
		type: 'number',
		default: 500,
		description: 'Time in milliseconds to wait after detecting an element before exiting (for Smart detection only)',
		displayOptions: {
			show: {
				operation: ['detect'],
				waitForSelectors: [true],
				detectionMethod: ['smart'],
			},
		},
	},
];

/**
 * Execute the detect operation
 */
export async function execute(
	this: IExecuteFunctions,
	index: number,
	websocketEndpoint: string,
	workflowId: string,
): Promise<INodeExecutionData> {
	const startTime = Date.now();
	const items = this.getInputData();
	let sessionId = '';
	let page: puppeteer.Page | null = null;

	// Added for better logging
	const nodeName = this.getNode().name;
	const nodeId = this.getNode().id;

	// Visual marker to clearly indicate a new node is starting
	this.logger.info('============ STARTING NODE EXECUTION ============');
	this.logger.info(formatOperationLog('Detect', nodeName, nodeId, index, 'Starting execution'));

	// Get parameters
	const waitForSelectors = this.getNodeParameter('waitForSelectors', index, true) as boolean;
	const timeout = this.getNodeParameter('timeout', index, 5000) as number;
	const takeScreenshotOption = this.getNodeParameter('takeScreenshot', index, false) as boolean;
	const continueOnFail = this.getNodeParameter('continueOnFail', index, true) as boolean;
	const explicitSessionId = this.getNodeParameter('explicitSessionId', index, '') as string;

	// Get new parameters for smart detection
	const detectionMethod = waitForSelectors
		? this.getNodeParameter('detectionMethod', index, 'smart') as string
		: 'fixed';
	const earlyExitDelay = detectionMethod === 'smart'
		? this.getNodeParameter('earlyExitDelay', index, 500) as number
		: 0;

	// Log the detection approach being used
	this.logger.info(formatOperationLog('Detect', nodeName, nodeId, index,
		`Parameters: waitForSelectors=${waitForSelectors}, timeout=${timeout}ms, method=${detectionMethod}`));

	if (detectionMethod === 'smart') {
		this.logger.info(formatOperationLog('Detect', nodeName, nodeId, index,
			`Smart detection configured with ${earlyExitDelay}ms early exit delay`));
	}

	try {
		// Use the centralized session management instead of duplicating code
		const sessionResult = await SessionManager.getOrCreatePageSession(this.logger, {
			explicitSessionId,
			websocketEndpoint,
			workflowId,
			operationName: 'Detect',
			nodeId,
			nodeName,
			index,
		});

		page = sessionResult.page;
		sessionId = sessionResult.sessionId;

		if (!page) {
			throw new Error('Failed to get or create a page');
		}

		// Get current page info for later use
		const currentUrl = page.url();
		const pageTitle = await page.title();

		this.logger.info(formatOperationLog('Detect', nodeName, nodeId, index,
			`Connected to page: URL=${currentUrl}, title=${pageTitle}`));

		// Get detections
		const detectionsData = this.getNodeParameter('detections.detection', index, []) as IDataObject[];

		if (detectionsData.length === 0) {
			throw new Error('No detections defined.');
		}

		this.logger.info(formatOperationLog('Detect', nodeName, nodeId, index,
			`Processing ${detectionsData.length} detection rules`));

		// Initialize results objects
		const results: IDataObject = {};
		const detailsInfo: IDataObject[] = [];

		// Process each detection
		for (const detection of detectionsData) {
			const detectionName = detection.name as string;
			const detectionType = detection.detectionType as string;
			const returnType = (detection.returnType as string) || 'boolean';
			const successValue = (detection.successValue as string) || 'success';
			const failureValue = (detection.failureValue as string) || 'failure';
			const invertResult = detection.invertResult === true;

			this.logger.info(formatOperationLog('Detect', nodeName, nodeId, index,
				`Evaluating detection "${detectionName}" (type: ${detectionType})`));

			// Create detection options
			const detectionOptions: IDetectionOptions = {
				waitForSelectors,
				selectorTimeout: timeout,
				detectionMethod,
				earlyExitDelay,
				nodeName,
				nodeId,
				index,
			};

			// Process the detection based on type
			let result: IDetectionResult;

			switch (detectionType) {
				case 'elementExists': {
					const selector = detection.selector as string;
					result = await detectElement(page, selector, detectionOptions, this.logger);
					break;
				}
				case 'textContains': {
					const selector = detection.selector as string;
					const textToCheck = detection.textToCheck as string;
					const matchType = (detection.matchType as string) || 'contains';
					const caseSensitive = detection.caseSensitive === true;

					result = await detectText(
						page,
						selector,
						textToCheck,
						matchType,
						caseSensitive,
						detectionOptions,
						this.logger
					);
					break;
				}
				case 'elementCount': {
					const selector = detection.selector as string;
					const expectedCount = (detection.expectedCount as number) || 1;
					const countComparison = (detection.countComparison as string) || 'equal';

					result = await detectCount(
						page,
						selector,
						expectedCount,
						countComparison,
						detectionOptions,
						this.logger
					);
					break;
				}
				case 'urlContains': {
					const urlSubstring = detection.urlSubstring as string;
					const matchType = (detection.matchType as string) || 'contains';
					const caseSensitive = detection.caseSensitive === true;

					result = await detectUrl(
						page,
						urlSubstring,
						matchType,
						caseSensitive,
						detectionOptions,
						this.logger
					);
					break;
				}
				case 'attributeValue': {
					// Since we don't have a specific detectAttribute function yet,
					// we need to use a similar approach to what was in processDetection
					const selector = detection.selector as string;
					const attributeName = detection.attributeName as string;
					const attributeValue = detection.attributeValue as string;
					const matchType = (detection.matchType as string) || 'contains';
					// We pass the matchType to detectWorkflowCondition which handles the matching

					// First check element exists
					const elementResult = await detectElement(page, selector, detectionOptions, this.logger);
					if (!elementResult.success) {
						result = {
							success: false,
							actualValue: '',
							details: {
								selector,
								attributeName,
								expected: attributeValue,
								error: 'Element not found'
							}
						};
					} else {
						try {
							// Extract attribute from the element
							const actualAttributeValue = await page.$eval(
								selector,
								(el, attr) => el.getAttribute(attr) || '',
								attributeName
							);

							// Use the detectWorkflowCondition utility to check the match
							result = detectWorkflowCondition(
								'attributeValue',
								actualAttributeValue,
								attributeValue,
								matchType,
								detectionOptions,
								this.logger
							);

							// Add additional details
							result.details.selector = selector;
							result.details.attributeName = attributeName;
						} catch (error) {
							result = {
								success: false,
								actualValue: '',
								details: {
									selector,
									attributeName,
									expected: attributeValue,
									error: (error as Error).message
								}
							};
						}
					}
					break;
				}
				default:
					throw new Error(`Unknown detection type: ${detectionType}`);
			}

			// Format the return value based on user preferences
			const formattedResult = formatReturnValue(
				result.success,
				result.actualValue,
				returnType,
				successValue,
				failureValue,
				invertResult
			);

			const finalSuccess = invertResult ? !result.success : result.success;
			this.logger.info(formatOperationLog('Detect', nodeName, nodeId, index,
				`Detection "${detectionName}" result: ${finalSuccess ? 'success' : 'failure'}, value=${formattedResult}`));

			// Add the results to the main output
			results[detectionName] = formattedResult;

			// Add details for debugging if needed
			detailsInfo.push({
				name: detectionName,
				type: detectionType,
				success: finalSuccess,
				actualValue: result.actualValue,
				formattedResult,
				...result.details,
			});
		}

		// Take screenshot if requested
		if (takeScreenshotOption && page) {
			await takePageScreenshot(page, this.logger, nodeName, nodeId);
		}

		// Log timing information
		createTimingLog('Detect', startTime, this.logger, nodeName, nodeId, index);

		// Create success response with the detection results
		const successResponse = await createSuccessResponse({
			operation: 'detect',
			sessionId,
			page,
			logger: this.logger,
			startTime,
			takeScreenshot: takeScreenshotOption,
			additionalData: {
				detections: results,
				detectionDetails: detailsInfo,
			},
			inputData: items[index].json,
		});

		return { json: successResponse };
	} catch (error) {
		// Use the standardized error response utility
		const errorResponse = await createErrorResponse({
			error: error as Error,
			operation: 'detect',
			sessionId,
			nodeId,
			nodeName,
			page,
			logger: this.logger,
			takeScreenshot: takeScreenshotOption,
			startTime,
			additionalData: {
				...items[index].json,
			}
		});

		if (!continueOnFail) {
			throw error;
		}

		// Return error as response with continue on fail
		return {
			json: errorResponse
		};
	}
}
