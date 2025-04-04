import type {
	IExecuteFunctions,
	IDataObject,
	INodeExecutionData,
	INodeProperties,
} from 'n8n-workflow';
import type * as puppeteer from 'puppeteer-core';
import { SessionManager } from '../utils/sessionManager';
import {
	formatReturnValue,
	processDetection,
	takePageScreenshot,
} from '../utils/detectionUtils';

/**
 * Detect operation description
 */
export const description: INodeProperties[] = [
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
		displayName: 'Wait for Selectors',
		name: 'waitForSelectors',
		type: 'boolean',
		default: true,
		description: 'Whether to actively wait for selectors to appear before checking (uses timeout value)',
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
				name: 'Smart Detection (DOM-Aware)',
				value: 'smart',
				description: 'Intelligently detects when the page is fully loaded before checking for elements (faster for elements that don\'t exist)',
			},
			{
				name: 'Fixed Timeout',
				value: 'fixed',
				description: 'Simply waits for the specified timeout (may be slower but more thorough)',
			},
		],
		default: 'smart',
		description: 'Method to use when checking for elements',
		displayOptions: {
			show: {
				operation: ['detect'],
				waitForSelectors: [true],
			},
		},
	},
	{
		displayName: 'Timeout',
		name: 'timeout',
		type: 'number',
		default: 5000,
		description: 'Maximum time in milliseconds to wait for selectors to appear (only applies if Wait for Selectors is enabled)',
		displayOptions: {
			show: {
				operation: ['detect'],
				waitForSelectors: [true],
			},
		},
	},
	{
		displayName: 'Early Exit Delay (MS)',
		name: 'earlyExitDelay',
		type: 'number',
		default: 500,
		description: 'Time in milliseconds to wait after DOM is loaded before checking for elements (for Smart Detection only)',
		displayOptions: {
			show: {
				operation: ['detect'],
				waitForSelectors: [true],
				detectionMethod: ['smart'],
			},
		},
	},
	{
		displayName: 'Take Screenshot',
		name: 'takeScreenshot',
		type: 'boolean',
		default: false,
		description: 'Whether to take a screenshot of the page',
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

	// Added for better logging
	const nodeName = this.getNode().name;
	const nodeId = this.getNode().id;
	this.logger.info(`[Ventriloquist][${nodeName}][${nodeId}][Detect] ========== START DETECT NODE EXECUTION ==========`);

	// Get parameters
	const waitForSelectors = this.getNodeParameter('waitForSelectors', index, true) as boolean;
	const timeout = this.getNodeParameter('timeout', index, 5000) as number;
	const takeScreenshotOption = this.getNodeParameter('takeScreenshot', index, false) as boolean;
	const continueOnFail = this.getNodeParameter('continueOnFail', index, true) as boolean;

	// Get new parameters for smart detection
	const detectionMethod = waitForSelectors
		? this.getNodeParameter('detectionMethod', index, 'smart') as string
		: 'fixed';
	const earlyExitDelay = detectionMethod === 'smart'
		? this.getNodeParameter('earlyExitDelay', index, 500) as number
		: 0;

	// Log the detection approach being used
	this.logger.info(`[Ventriloquist][${nodeName}][${nodeId}][Detect] Parameters: waitForSelectors=${waitForSelectors}, timeout=${timeout}ms, method=${detectionMethod}`);
	if (detectionMethod === 'smart') {
		this.logger.info(`[Ventriloquist][${nodeName}][${nodeId}][Detect] Smart detection configured with ${earlyExitDelay}ms early exit delay`);
	}

	// Check if an explicit session ID was provided
	const explicitSessionId = this.getNodeParameter('explicitSessionId', index, '') as string;

	// Create page variable with appropriate type and default values
	let page: puppeteer.Page | undefined;
	let sessionId = ''; // Initialize with empty string

	try {
		// Check if an explicit session ID was provided to reuse
		if (explicitSessionId) {
			this.logger.info(`[Ventriloquist][${nodeName}][${nodeId}][Detect] Looking for explicitly provided session ID: ${explicitSessionId}`);

			try {
				// Use SessionManager to get the page
				page = SessionManager.getPage(explicitSessionId);

				if (page) {
					sessionId = explicitSessionId;
					this.logger.info(`[Ventriloquist][${nodeName}][${nodeId}][Detect] Found existing page with explicit session ID: ${sessionId}`);
				} else {
					this.logger.warn(`[Ventriloquist][${nodeName}][${nodeId}][Detect] Provided session ID ${explicitSessionId} not found, will create a new session`);
				}
			} catch (error) {
				this.logger.warn(`[Ventriloquist][${nodeName}][${nodeId}][Detect] Error retrieving page with session ID ${explicitSessionId}: ${(error as Error).message}`);
			}
		}

		// If no page is found yet, get or create a session
		if (!page) {
			// Get WebSocket URL from credentials
			const credentials = await this.getCredentials('browserlessApi');
			const actualWebsocketEndpoint = SessionManager.getWebSocketUrlFromCredentials(
				this.logger,
				'browserlessApi',
				credentials
			);

			try {
				// Create a new session
				const sessionResult = await SessionManager.createSession(
					this.logger,
					actualWebsocketEndpoint,
					{
						forceNew: false, // Don't force a new session - reuse existing
						credentialType: 'browserlessApi',
					}
				);

				// Store session details
				const browser = sessionResult.browser;
				sessionId = sessionResult.sessionId;

				// Try to get existing page or create a new one
				const pages = await browser.pages();
				if (pages.length > 0) {
					// Use the first available page
					page = pages[0];
					this.logger.info(`[Ventriloquist][${nodeName}][${nodeId}][Detect] Using existing page from browser session`);
				} else {
					// Create a new page
					page = await browser.newPage();
					this.logger.info(`[Ventriloquist][${nodeName}][${nodeId}][Detect] Created new page with session ID: ${sessionId}`);

					// Navigate to a blank page to initialize it
					await page.goto('about:blank');
				}

				// Store the page for future operations
				SessionManager.storePage(sessionId, `page_${Date.now()}`, page);
			} catch (error) {
				this.logger.error(`[Ventriloquist][${nodeName}][${nodeId}][Detect] Failed to create session: ${(error as Error).message}`);
				throw new Error(`Failed to create session: ${(error as Error).message}`);
			}
		}

		// At this point we must have a page - add a final check
		if (!page) {
			throw new Error('Failed to get or create a valid page');
		}

		// Get current page info for later use
		const currentUrl = page.url();
		const pageTitle = await page.title();
		let screenshot = '';

		this.logger.info(`[Ventriloquist][${nodeName}][${nodeId}][Detect] Connected to page: URL=${currentUrl}, title=${pageTitle}`);

		try {
			this.logger.info(`[Ventriloquist][${nodeName}][${nodeId}][Detect] Starting detection operations`);

			// Get detections
			const detectionsData = this.getNodeParameter('detections.detection', index, []) as IDataObject[];

			if (detectionsData.length === 0) {
				throw new Error('No detections defined.');
			}

			this.logger.info(`[Ventriloquist][${nodeName}][${nodeId}][Detect] Processing ${detectionsData.length} detection rules`);

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

				this.logger.info(`[Ventriloquist][${nodeName}][${nodeId}][Detect] Evaluating detection "${detectionName}" (type: ${detectionType})`);

				// Process the detection with the chosen method
				const { success, actualValue, details: detectionDetails } = await processDetection(
					page,
					detection,
					currentUrl,
					waitForSelectors,
					timeout,
					detectionMethod,
					earlyExitDelay,
					this.logger,
					nodeName,
					nodeId
				);

				// Format the return value based on user preferences
				const formattedResult = formatReturnValue(
					success,
					actualValue,
					returnType,
					successValue,
					failureValue,
					invertResult
				);

				const finalSuccess = invertResult ? !success : success;
				this.logger.info(`[Ventriloquist][${nodeName}][${nodeId}][Detect] Detection "${detectionName}" result: ${finalSuccess ? 'success' : 'failure'}, value=${formattedResult}`);

				// Add the results to the main output
				results[detectionName] = formattedResult;

				// Add details for debugging if needed
				detailsInfo.push({
					name: detectionName,
					type: detectionType,
					success: finalSuccess,
					result: formattedResult,
					actualValue,
					...detectionDetails,
				});
			}

			// Take a screenshot if requested
			if (takeScreenshotOption) {
				screenshot = await takePageScreenshot(page, this.logger, nodeName, nodeId);
			}

			const executionDuration = Date.now() - startTime;
			this.logger.info(`[Ventriloquist][${nodeName}][${nodeId}][Detect] Completed execution in ${executionDuration}ms`);
			this.logger.info(`[Ventriloquist][${nodeName}][${nodeId}][Detect] ========== END DETECT NODE EXECUTION ==========`);

			// Build the final output
			const output: IDataObject = {
				// Primary detection results at top level
				...results,

				// Metadata
				success: true,
				operation: 'detect',
				sessionId,
				url: currentUrl,
				title: pageTitle,
				timestamp: new Date().toISOString(),
				executionDuration,
			};

			// Only include screenshot if requested
			if (screenshot) {
				output.screenshot = screenshot;
			}

			// Include details for debugging
			output._details = detailsInfo;

			// Return the results
			return {
				json: output,
			};
		} catch (error) {
			// Handle errors
			this.logger.error(`[Ventriloquist][${nodeName}][${nodeId}][Detect] Error during detection: ${(error as Error).message}`);

			// Take error screenshot if requested
			if (takeScreenshotOption && page) {
				try {
					screenshot = await takePageScreenshot(page, this.logger, nodeName, nodeId);
				} catch (screenshotError) {
					this.logger.warn(`[Ventriloquist][${nodeName}][${nodeId}][Detect] Failed to capture error screenshot: ${(screenshotError as Error).message}`);
				}
			}

			if (continueOnFail) {
				const executionDuration = Date.now() - startTime;
				this.logger.info(`[Ventriloquist][${nodeName}][${nodeId}][Detect] Continuing despite error (continueOnFail=true), duration=${executionDuration}ms`);
				this.logger.info(`[Ventriloquist][${nodeName}][${nodeId}][Detect] ========== END DETECT NODE EXECUTION (WITH ERROR) ==========`);

				// Return error information in the output
				return {
					json: {
						success: false,
						error: (error as Error).message,
						operation: 'detect',
						url: currentUrl || 'unknown',
						title: pageTitle || 'unknown',
						sessionId,
						timestamp: new Date().toISOString(),
						executionDuration,
						screenshot,
					},
				};
			}

			// If continueOnFail is false, rethrow the error
			throw error;
		}
	} catch (error) {
		// Handle session creation errors
		this.logger.error(`[Ventriloquist][${nodeName}][${nodeId}][Detect] Session creation error: ${(error as Error).message}`);
		this.logger.info(`[Ventriloquist][${nodeName}][${nodeId}][Detect] ========== END DETECT NODE EXECUTION (SESSION ERROR) ==========`);

		if (continueOnFail) {
			const executionDuration = Date.now() - startTime;

			return {
				json: {
					success: false,
					error: (error as Error).message,
					operation: 'detect',
					sessionId: '',
					timestamp: new Date().toISOString(),
					executionDuration,
				},
			};
		}

		throw error;
	}
}
