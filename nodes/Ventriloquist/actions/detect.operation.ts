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
		displayOptions: {
			show: {
				operation: ['detect'],
			},
		},
	},
	{
		displayName: 'Selector',
		name: 'selector',
		type: 'string',
		default: '',
		placeholder: '#element, .class, div[data-test="value"]',
		description: 'CSS selector to target the element(s)',
		required: true,
		displayOptions: {
			show: {
				operation: ['detect'],
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
		required: true,
		displayOptions: {
			show: {
				operation: ['detect'],
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
		required: true,
		displayOptions: {
			show: {
				operation: ['detect'],
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
		required: true,
		displayOptions: {
			show: {
				operation: ['detect'],
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
		required: true,
		displayOptions: {
			show: {
				operation: ['detect'],
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
				operation: ['detect'],
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
				operation: ['detect'],
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
				operation: ['detect'],
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
				operation: ['detect'],
				detectionType: ['textContains', 'attributeValue', 'urlContains'],
			},
		},
	},
	{
		displayName: 'Wait for Selector',
		name: 'waitForSelector',
		type: 'boolean',
		default: true,
		description: 'Whether to wait for the selector to appear in page before checking',
		displayOptions: {
			show: {
				operation: ['detect'],
				detectionType: ['elementExists', 'textContains', 'attributeValue', 'elementCount'],
			},
		},
	},
	{
		displayName: 'Timeout',
		name: 'timeout',
		type: 'number',
		default: 5000,
		description: 'Maximum time to wait for the selector in milliseconds',
		displayOptions: {
			show: {
				operation: ['detect'],
				waitForSelector: [true],
			},
		},
	},
	{
		displayName: 'Return Type',
		name: 'returnType',
		type: 'options',
		options: [
			{
				name: 'Boolean (true/false)',
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
		displayOptions: {
			show: {
				operation: ['detect'],
			},
		},
	},
	{
		displayName: 'Success Value',
		name: 'successValue',
		type: 'string',
		default: 'success',
		description: 'Value to return when detection succeeds',
		displayOptions: {
			show: {
				operation: ['detect'],
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
				operation: ['detect'],
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
 * Execute the detect operation
 */
export async function execute(
	this: IExecuteFunctions,
	index: number,
	websocketEndpoint: string,
	workflowId: string,
): Promise<INodeExecutionData> {
	// Get parameters
	const detectionType = this.getNodeParameter('detectionType', index, 'elementExists') as string;
	const waitForSelector = this.getNodeParameter('waitForSelector', index, true) as boolean;
	const timeout = this.getNodeParameter('timeout', index, 5000) as number;
	const takeScreenshot = this.getNodeParameter('takeScreenshot', index, false) as boolean;
	const returnType = this.getNodeParameter('returnType', index, 'boolean') as string;
	const invertResult = this.getNodeParameter('invertResult', index, false) as boolean;

	// Return type specific parameters
	const successValue = this.getNodeParameter('successValue', index, 'success') as string;
	const failureValue = this.getNodeParameter('failureValue', index, 'failure') as string;

	// Get or create browser session
	let page: puppeteer.Page;
	let pageId: string;

	try {
		// Create a session or reuse an existing one
		const { browser, pageId: newPageId } = await Ventriloquist.getOrCreateSession(
			workflowId,
			websocketEndpoint,
			this.logger
		);

		// Try to get any existing page from the browser
		const pages = await browser.pages();

		if (pages.length > 0) {
			// Use the first available page
			page = pages[0];
			pageId = `existing_${Date.now()}`;
			this.logger.info('Using existing page from browser session');
		} else {
			// Create a new page if none exists
			page = await browser.newPage();
			pageId = newPageId;
			this.logger.info(`Created new page with ID: ${pageId}`);

			// Store the new page for future operations
			Ventriloquist.storePage(workflowId, pageId, page);

			// Navigate to a blank page to initialize it
			await page.goto('about:blank');
		}
	} catch (error) {
		throw new Error(`Failed to get or create a page: ${(error as Error).message}`);
	}

	// Variables to store results
	let detectionSuccess = false;
	let actualValue: string | number = '';
	let detectionDetails: IDataObject = {};

	try {
		this.logger.info(`Starting detection operation of type: ${detectionType}`);

		// Different detection logic based on the type
		switch (detectionType) {
			case 'elementExists': {
				const selector = this.getNodeParameter('selector', index) as string;
				let exists = false;

				try {
					if (waitForSelector) {
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
				detectionDetails = { selector };
				break;
			}

			case 'textContains': {
				const selector = this.getNodeParameter('selector', index) as string;
				const textToCheck = this.getNodeParameter('textToCheck', index) as string;
				const matchType = this.getNodeParameter('matchType', index, 'contains') as string;
				const caseSensitive = this.getNodeParameter('caseSensitive', index, false) as boolean;

				let elementText = '';
				let textMatches = false;

				try {
					if (waitForSelector) {
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
				}

				detectionSuccess = textMatches;
				actualValue = elementText;
				detectionDetails = { selector, textToCheck, matchType, caseSensitive };
				break;
			}

			case 'attributeValue': {
				const selector = this.getNodeParameter('selector', index) as string;
				const attributeName = this.getNodeParameter('attributeName', index) as string;
				const attributeValue = this.getNodeParameter('attributeValue', index) as string;
				const matchType = this.getNodeParameter('matchType', index, 'contains') as string;
				const caseSensitive = this.getNodeParameter('caseSensitive', index, false) as boolean;

				let actualAttributeValue = '';
				let attributeMatches = false;

				try {
					if (waitForSelector) {
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
				}

				detectionSuccess = attributeMatches;
				actualValue = actualAttributeValue;
				detectionDetails = { selector, attributeName, attributeValue, matchType, caseSensitive };
				break;
			}

			case 'elementCount': {
				const selector = this.getNodeParameter('selector', index) as string;
				const expectedCount = this.getNodeParameter('expectedCount', index, 1) as number;
				const countComparison = this.getNodeParameter('countComparison', index, 'equal') as string;

				let actualCount = 0;
				let countMatches = false;

				try {
					if (waitForSelector) {
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
				}

				detectionSuccess = countMatches;
				actualValue = actualCount;
				detectionDetails = { selector, expectedCount, countComparison, actualCount };
				break;
			}

			case 'urlContains': {
				const urlSubstring = this.getNodeParameter('urlSubstring', index) as string;
				const matchType = this.getNodeParameter('matchType', index, 'contains') as string;
				const caseSensitive = this.getNodeParameter('caseSensitive', index, false) as boolean;

				// Get the current URL
				const currentUrl = page.url();

				// Check if the URL matches according to the match type
				const urlMatches = matchStrings(currentUrl, urlSubstring, matchType, caseSensitive);

				detectionSuccess = urlMatches;
				actualValue = currentUrl;
				detectionDetails = { urlSubstring, matchType, caseSensitive };
				break;
			}
		}

		// Get current page info
		const currentUrl = page.url();
		const pageTitle = await page.title();

		// Take a screenshot if requested
		let screenshot = '';
		if (takeScreenshot) {
			const screenshotBuffer = await page.screenshot({
				encoding: 'base64',
				type: 'jpeg',
				quality: 80,
			});

			screenshot = `data:image/jpeg;base64,${screenshotBuffer}`;
		}

		// Format the return value based on user preferences
		const formattedResult = formatReturnValue(
			detectionSuccess,
			actualValue,
			returnType,
			successValue,
			failureValue,
			invertResult
		);

		// Return the results
		return {
			json: {
				success: true,
				operation: 'detect',
				detectionType,
				result: formattedResult,
				detected: invertResult ? !detectionSuccess : detectionSuccess,
				actualValue,
				pageId,
				url: currentUrl,
				title: pageTitle,
				...detectionDetails,
				timestamp: new Date().toISOString(),
				screenshot,
			},
		};
	} catch (error) {
		// Handle errors
		this.logger.error(`Detect operation error: ${(error as Error).message}`);

		// Take error screenshot if requested
		let screenshot = '';
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

		return {
			json: {
				success: false,
				operation: 'detect',
				detectionType,
				error: (error as Error).message,
				pageId,
				timestamp: new Date().toISOString(),
				screenshot,
			},
		};
	}
}
