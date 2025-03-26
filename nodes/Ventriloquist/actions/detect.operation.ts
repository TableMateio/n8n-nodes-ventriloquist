import type {
	IExecuteFunctions,
	IDataObject,
	INodeExecutionData,
	INodeProperties,
} from 'n8n-workflow';
import { Ventriloquist } from '../Ventriloquist.node';
import type * as puppeteer from 'puppeteer-core';

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
];

/**
 * Safely matches strings according to the specified match type
 */
function matchStrings(value: string, targetValue: string, matchType: string, caseSensitive: boolean): boolean {
	// Apply case sensitivity
	let compareValue = value;
	let compareTarget = targetValue;

	if (!caseSensitive) {
		compareValue = value.toLowerCase();
		compareTarget = targetValue.toLowerCase();
	}

	// Apply match type
	switch (matchType) {
		case 'exact':
			return compareValue === compareTarget;
		case 'contains':
			return compareValue.includes(compareTarget);
		case 'startsWith':
			return compareValue.startsWith(compareTarget);
		case 'endsWith':
			return compareValue.endsWith(compareTarget);
		case 'regex':
			try {
				const regex = new RegExp(targetValue, caseSensitive ? '' : 'i');
				return regex.test(value);
			} catch (error) {
				return false;
			}
		default:
			return compareValue.includes(compareTarget);
	}
}

/**
 * Compare element counts based on the comparison operator
 */
function compareCount(actualCount: number, expectedCount: number, operator: string): boolean {
	switch (operator) {
		case 'equal':
			return actualCount === expectedCount;
		case 'greater':
			return actualCount > expectedCount;
		case 'less':
			return actualCount < expectedCount;
		case 'greaterEqual':
			return actualCount >= expectedCount;
		case 'lessEqual':
			return actualCount <= expectedCount;
		default:
			return actualCount === expectedCount;
	}
}

/**
 * Format the return value based on the return type
 */
function formatReturnValue(
	success: boolean,
	actualValue: string | number,
	returnType: string,
	successValue: string,
	failureValue: string,
	invertResult: boolean,
): string | number | boolean {
	// Apply inversion if requested
	const result = invertResult ? !success : success;

	// Format return value based on type
	switch (returnType) {
		case 'boolean':
			return result;
		case 'string':
			return result ? successValue : failureValue;
		case 'number':
			return result ? 1 : 0;
		case 'value':
			return actualValue;
		default:
			return result;
	}
}

/**
 * Process a single detection and return its result
 */
async function processDetection(
	page: puppeteer.Page,
	detection: IDataObject,
	currentUrl: string,
	waitForSelectors: boolean,
	timeout: number,
	logger: IExecuteFunctions['logger'],
): Promise<{
	success: boolean;
	actualValue: string | number;
	details: IDataObject;
}> {
	const detectionType = detection.detectionType as string;

	// Variables to store the detection result
	let detectionSuccess = false;
	let actualValue: string | number = '';
	const detectionDetails: IDataObject = {};

	// Process the specific detection type
	switch (detectionType) {
		case 'elementExists': {
			const selector = detection.selector as string;
			let exists = false;

			try {
				if (waitForSelectors) {
					// Wait for the selector with timeout
					await page.waitForSelector(selector, { timeout });
					exists = true;
				} else {
					// Just check if the element exists without waiting
					exists = await page.$(selector) !== null;
				}
			} catch (error) {
				// If timeout occurs while waiting, element doesn't exist
				exists = false;
			}

			detectionSuccess = exists;
			actualValue = exists ? 'true' : 'false';
			detectionDetails.selector = selector;
			break;
		}

		case 'textContains': {
			const selector = detection.selector as string;
			const textToCheck = detection.textToCheck as string;
			const matchType = (detection.matchType as string) || 'contains';
			const caseSensitive = detection.caseSensitive === true;

			let elementText = '';
			let textMatches = false;

			try {
				if (waitForSelectors) {
					// Wait for the selector with timeout
					await page.waitForSelector(selector, { timeout });
				}

				// Get the text content of the element
				elementText = await page.$eval(selector, (el) => el.textContent?.trim() || '');

				// Check if the text matches according to the match type
				textMatches = matchStrings(elementText, textToCheck, matchType, caseSensitive);
			} catch (error) {
				// If error occurs, detection fails
				textMatches = false;
				logger.debug(`Text contains detection error: ${(error as Error).message}`);
			}

			detectionSuccess = textMatches;
			actualValue = elementText;
			Object.assign(detectionDetails, {
				selector,
				textToCheck,
				matchType,
				caseSensitive
			});
			break;
		}

		case 'attributeValue': {
			const selector = detection.selector as string;
			const attributeName = detection.attributeName as string;
			const attributeValue = detection.attributeValue as string;
			const matchType = (detection.matchType as string) || 'contains';
			const caseSensitive = detection.caseSensitive === true;

			let actualAttributeValue = '';
			let attributeMatches = false;

			try {
				if (waitForSelectors) {
					// Wait for the selector with timeout
					await page.waitForSelector(selector, { timeout });
				}

				// Get the attribute value
				actualAttributeValue = await page.$eval(
					selector,
					(el, attr) => el.getAttribute(attr) || '',
					attributeName
				);

				// Check if the attribute value matches according to the match type
				attributeMatches = matchStrings(actualAttributeValue, attributeValue, matchType, caseSensitive);
			} catch (error) {
				// If error occurs, detection fails
				attributeMatches = false;
				logger.debug(`Attribute value detection error: ${(error as Error).message}`);
			}

			detectionSuccess = attributeMatches;
			actualValue = actualAttributeValue;
			Object.assign(detectionDetails, {
				selector,
				attributeName,
				attributeValue,
				matchType,
				caseSensitive
			});
			break;
		}

		case 'elementCount': {
			const selector = detection.selector as string;
			const expectedCount = (detection.expectedCount as number) || 1;
			const countComparison = (detection.countComparison as string) || 'equal';

			let actualCount = 0;
			let countMatches = false;

			try {
				if (waitForSelectors) {
					try {
						// Wait for at least one element to appear
						await page.waitForSelector(selector, { timeout });
					} catch (error) {
						// If timeout occurs, count is 0
						actualCount = 0;
					}
				}

				// Count all matching elements
				actualCount = (await page.$$(selector)).length;

				// Compare counts according to the comparison operator
				countMatches = compareCount(actualCount, expectedCount, countComparison);
			} catch (error) {
				// If error occurs, detection fails
				countMatches = false;
				actualCount = 0;
				logger.debug(`Element count detection error: ${(error as Error).message}`);
			}

			detectionSuccess = countMatches;
			actualValue = actualCount;
			Object.assign(detectionDetails, {
				selector,
				expectedCount,
				countComparison,
				actualCount
			});
			break;
		}

		case 'urlContains': {
			const urlSubstring = detection.urlSubstring as string;
			const matchType = (detection.matchType as string) || 'contains';
			const caseSensitive = detection.caseSensitive === true;

			// Check if the URL matches according to the match type
			const urlMatches = matchStrings(currentUrl, urlSubstring, matchType, caseSensitive);

			detectionSuccess = urlMatches;
			actualValue = currentUrl;
			Object.assign(detectionDetails, {
				urlSubstring,
				matchType,
				caseSensitive
			});
			break;
		}
	}

	return {
		success: detectionSuccess,
		actualValue,
		details: detectionDetails,
	};
}

/**
 * Execute the detect operation
 */
export async function execute(
	this: IExecuteFunctions,
	index: number,
	websocketEndpoint: string,
	workflowId: string,
): Promise<INodeExecutionData> {
	// Get parameters
	const waitForSelectors = this.getNodeParameter('waitForSelectors', index, true) as boolean;
	const timeout = this.getNodeParameter('timeout', index, 5000) as number;
	const takeScreenshot = this.getNodeParameter('takeScreenshot', index, false) as boolean;

	// Get or create browser session
	let page: puppeteer.Page;
	let sessionId: string;

	try {
		// Create a session or reuse an existing one
		const { browser, sessionId: newSessionId } = await Ventriloquist.getOrCreateSession(
			workflowId,
			websocketEndpoint,
			this.logger
		);

		// Try to get any existing page from the browser
		const pages = await browser.pages();

		if (pages.length > 0) {
			// Use the first available page
			page = pages[0];
			sessionId = `existing_${Date.now()}`;
			this.logger.info('Using existing page from browser session');
		} else {
			// Create a new page if none exists
			page = await browser.newPage();
			sessionId = newSessionId;
			this.logger.info(`Created new page with session ID: ${sessionId}`);

			// Store the new page for future operations
			Ventriloquist.storePage(workflowId, sessionId, page);

			// Navigate to a blank page to initialize it
			await page.goto('about:blank');
		}
	} catch (error) {
		throw new Error(`Failed to get or create a page: ${(error as Error).message}`);
	}

	// Get current page info for later use
	const currentUrl = page.url();
	const pageTitle = await page.title();
	let screenshot = '';

	try {
		this.logger.info('Starting detection operations');

		// Get detections
		const detectionsData = this.getNodeParameter('detections.detection', index, []) as IDataObject[];

		if (detectionsData.length === 0) {
			throw new Error('No detections defined.');
		}

		// Initialize results objects
		const results: IDataObject = {};
		const detailsInfo: IDataObject[] = [];

		// Process each detection
		for (const detection of detectionsData) {
			const detectionName = detection.name as string;
			const returnType = (detection.returnType as string) || 'boolean';
			const successValue = (detection.successValue as string) || 'success';
			const failureValue = (detection.failureValue as string) || 'failure';
			const invertResult = detection.invertResult === true;

			// Process the detection
			const { success, actualValue, details: detectionDetails } = await processDetection(
				page,
				detection,
				currentUrl,
				waitForSelectors,
				timeout,
				this.logger
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

			// Add the results to the main output
			results[detectionName] = formattedResult;

			// Add details for debugging if needed
			detailsInfo.push({
				name: detectionName,
				type: detection.detectionType,
				success: invertResult ? !success : success,
				result: formattedResult,
				actualValue,
				...detectionDetails,
			});
		}

		// Take a screenshot if requested
		if (takeScreenshot) {
			const screenshotBuffer = await page.screenshot({
				encoding: 'base64',
				type: 'jpeg',
				quality: 80,
			});

			screenshot = `data:image/jpeg;base64,${screenshotBuffer}`;
		}

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
		this.logger.error(`Detect operation error: ${(error as Error).message}`);

		// Take error screenshot if requested
		if (takeScreenshot && page) {
			try {
				const screenshotBuffer = await page.screenshot({
					encoding: 'base64',
					type: 'jpeg',
					quality: 80,
				});
				screenshot = `data:image/jpeg;base64,${screenshotBuffer}`;
			} catch {
				// Ignore screenshot errors
			}
		}

		// Return error info
		return {
			json: {
				success: false,
				operation: 'detect',
				error: (error as Error).message,
				sessionId,
				timestamp: new Date().toISOString(),
				...(screenshot ? { screenshot } : {}),
			},
		};
	}
}
