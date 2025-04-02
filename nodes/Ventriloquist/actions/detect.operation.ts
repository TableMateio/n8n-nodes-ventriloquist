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
		displayName: 'Detection Method',
		name: 'detectionMethod',
		type: 'options',
		options: [
			{
				name: 'Smart Detection (DOM-aware)',
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
 * Smart Wait For Selector implementation that tries to optimize for detection speed
 * while still being accurate
 */
async function smartWaitForSelector(
	page: puppeteer.Page,
	selector: string,
	timeout: number,
	earlyExitDelay: number,
	logger: IExecuteFunctions['logger'],
	nodeName: string,
	nodeId: string,
): Promise<boolean> {
	// Create a promise that resolves when the element is found
	const elementPromise = page.waitForSelector(selector, { timeout })
		.then(() => {
			logger.debug(`[Ventriloquist][${nodeName}][${nodeId}][Detect] Element found: ${selector}`);
			return true;
		})
		.catch(() => {
			logger.debug(`[Ventriloquist][${nodeName}][${nodeId}][Detect] Element not found within timeout: ${selector}`);
			return false;
		});

	// Check if the DOM is already loaded
	const domState = await page.evaluate(() => {
		return {
			readyState: document.readyState,
			domContentLoaded: document.readyState === 'interactive' || document.readyState === 'complete',
			loaded: document.readyState === 'complete',
		};
	});

	logger.debug(`[Ventriloquist][${nodeName}][${nodeId}][Detect] Current DOM state: ${JSON.stringify(domState)}`);

	// If DOM is already loaded, do a quick check first
	if (domState.domContentLoaded) {
		// Do an immediate check
		const elementExists = await page.evaluate((sel) => {
			return document.querySelector(sel) !== null;
		}, selector);

		if (elementExists) {
			logger.debug(`[Ventriloquist][${nodeName}][${nodeId}][Detect] Element found immediately (DOM already loaded): ${selector}`);
			return true;
		}

		// If DOM is fully loaded and element doesn't exist, we can exit early
		if (domState.loaded) {
			logger.debug(`[Ventriloquist][${nodeName}][${nodeId}][Detect] DOM fully loaded but element not found, waiting short delay: ${selector}`);
			await new Promise(resolve => setTimeout(resolve, earlyExitDelay));

			// Check one more time after the delay
			const elementExistsAfterDelay = await page.evaluate((sel) => {
				return document.querySelector(sel) !== null;
			}, selector);

			if (elementExistsAfterDelay) {
				logger.debug(`[Ventriloquist][${nodeName}][${nodeId}][Detect] Element found after delay: ${selector}`);
				return true;
			}

			logger.debug(`[Ventriloquist][${nodeName}][${nodeId}][Detect] Element not found after DOM load and delay, exiting early: ${selector}`);
			return false;
		}
	}

	// If we got here, either:
	// 1. DOM is not fully loaded, so we need to wait
	// 2. DOM is interactive but not complete, so we should wait a bit longer

	// Wait for DOM content to be fully loaded first (if it isn't already)
	if (!domState.loaded) {
		const domLoadPromise = page.waitForFunction(
			() => document.readyState === 'complete',
			{ timeout: Math.min(timeout, 5000) } // Use smaller timeout for DOM wait
		).catch(() => {
			logger.debug(`[Ventriloquist][${nodeName}][${nodeId}][Detect] Timed out waiting for DOM to be complete`);
		});

		// Wait for either the element to appear or the DOM to load
		const winner = await Promise.race([
			elementPromise,
			domLoadPromise.then(() => 'DOM-Loaded')
		]);

		// If element was found during this race, return true
		if (winner === true) {
			return true;
		}

		// If DOM loaded but element wasn't found, do one quick check
		if (winner === 'DOM-Loaded') {
			logger.debug(`[Ventriloquist][${nodeName}][${nodeId}][Detect] DOM loaded, performing final element check`);

			// Wait short additional time for any final elements to appear
			await new Promise(resolve => setTimeout(resolve, earlyExitDelay));

			// Final check
			const elementExistsAfterDOM = await page.evaluate((sel) => {
				return document.querySelector(sel) !== null;
			}, selector);

			if (elementExistsAfterDOM) {
				logger.debug(`[Ventriloquist][${nodeName}][${nodeId}][Detect] Element found after DOM loaded: ${selector}`);
				return true;
			}

			logger.debug(`[Ventriloquist][${nodeName}][${nodeId}][Detect] DOM loaded but element still not found: ${selector}`);
			return false;
		}
	}

	// If we reach here, we need to just wait for the element promise
	return elementPromise;
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
	detectionMethod: string,
	earlyExitDelay: number,
	logger: IExecuteFunctions['logger'],
	nodeName: string,
	nodeId: string,
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
					if (detectionMethod === 'smart') {
						// Use smart detection approach
						exists = await smartWaitForSelector(page, selector, timeout, earlyExitDelay, logger, nodeName, nodeId);
					} else {
						// Use traditional fixed timeout approach
						await page.waitForSelector(selector, { timeout });
						exists = true;
					}
				} else {
					// Just check if the element exists without waiting
					exists = await page.$(selector) !== null;
				}
			} catch (error) {
				// If timeout occurs while waiting, element doesn't exist
				exists = false;
				logger.debug(`[Ventriloquist][${nodeName}][${nodeId}][Detect] Element exists detection failed: ${(error as Error).message}`);
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
					let elementExists = false;

					if (detectionMethod === 'smart') {
						// Use smart detection approach
						elementExists = await smartWaitForSelector(page, selector, timeout, earlyExitDelay, logger, nodeName, nodeId);
					} else {
						// Use traditional approach with fixed timeout
						try {
							await page.waitForSelector(selector, { timeout });
							elementExists = true;
						} catch {
							elementExists = false;
						}
					}

					// Only proceed if element exists
					if (!elementExists) {
						throw new Error(`Element with selector "${selector}" not found`);
					}
				}

				// Get the text content of the element
				elementText = await page.$eval(selector, (el) => el.textContent?.trim() || '');

				// Check if the text matches according to the match type
				textMatches = matchStrings(elementText, textToCheck, matchType, caseSensitive);
			} catch (error) {
				// If error occurs, detection fails
				textMatches = false;
				logger.debug(`[Ventriloquist][${nodeName}][${nodeId}][Detect] Text contains detection error: ${(error as Error).message}`);
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
					let elementExists = false;

					if (detectionMethod === 'smart') {
						// Use smart detection approach
						elementExists = await smartWaitForSelector(page, selector, timeout, earlyExitDelay, logger, nodeName, nodeId);
					} else {
						// Use traditional approach with fixed timeout
						try {
							await page.waitForSelector(selector, { timeout });
							elementExists = true;
						} catch {
							elementExists = false;
						}
					}

					// Only proceed if element exists
					if (!elementExists) {
						throw new Error(`Element with selector "${selector}" not found`);
					}
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
				logger.debug(`[Ventriloquist][${nodeName}][${nodeId}][Detect] Attribute value detection error: ${(error as Error).message}`);
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
					if (detectionMethod === 'smart') {
						// Use smart detection approach - just need to know if at least one element exists
						const anyElementExists = await smartWaitForSelector(page, selector, timeout, earlyExitDelay, logger, nodeName, nodeId);

						// If no elements exist in smart mode, we know the count is 0
						if (!anyElementExists) {
							actualCount = 0;
							countMatches = compareCount(0, expectedCount, countComparison);
							break; // Exit early with count = 0
						}
					} else {
						// Traditional approach - try to wait for at least one element
						try {
							await page.waitForSelector(selector, { timeout });
						} catch {
							// If timeout occurs, count is 0
							actualCount = 0;
							countMatches = compareCount(0, expectedCount, countComparison);
							break; // Exit early with count = 0
						}
					}
				}

				// Count all matching elements
				actualCount = await page.$$eval(selector, (elements) => elements.length);
				countMatches = compareCount(actualCount, expectedCount, countComparison);
			} catch (error) {
				// If error occurs, detection fails
				countMatches = false;
				actualCount = 0;
				logger.debug(`[Ventriloquist][${nodeName}][${nodeId}][Detect] Element count detection error: ${(error as Error).message}`);
			}

			detectionSuccess = countMatches;
			actualValue = actualCount.toString();
			Object.assign(detectionDetails, {
				selector,
				expectedCount,
				countComparison
			});
			break;
		}

		case 'urlContains': {
			const urlToCheck = detection.urlToCheck as string;
			const matchType = (detection.matchType as string) || 'contains';
			const caseSensitive = detection.caseSensitive === true;

			// Check if the current URL matches the criteria
			const urlMatches = matchStrings(currentUrl, urlToCheck, matchType, caseSensitive);

			detectionSuccess = urlMatches;
			actualValue = currentUrl;
			Object.assign(detectionDetails, {
				urlToCheck,
				matchType,
				caseSensitive
			});

			logger.debug(`[Ventriloquist][${nodeName}][${nodeId}][Detect] URL check: Current=${currentUrl}, Expected=${urlToCheck}, Match=${urlMatches}`);
			break;
		}

		case 'jsExpression': {
			const expression = detection.expression as string;
			let result: string | boolean = false;

			try {
				// Evaluate the JavaScript expression in the page context
				result = await page.evaluate((expr) => {
					// eslint-disable-next-line no-eval
					return eval(expr);
				}, expression);

				// Convert boolean result to string if needed
				if (typeof result === 'boolean') {
					detectionSuccess = result;
					actualValue = result.toString();
				} else {
					// For non-boolean results, check if it's truthy
					detectionSuccess = Boolean(result);
					actualValue = typeof result === 'object'
						? JSON.stringify(result)
						: String(result);
				}
			} catch (error) {
				// If error occurs during evaluation, detection fails
				detectionSuccess = false;
				actualValue = `Error: ${(error as Error).message}`;
				logger.debug(`[Ventriloquist][${nodeName}][${nodeId}][Detect] JS expression evaluation error: ${(error as Error).message}`);
			}

			detectionDetails.expression = expression;
			break;
		}

		case 'hasClass': {
			const selector = detection.selector as string;
			const className = detection.className as string;

			let hasClass = false;

			try {
				if (waitForSelectors) {
					let elementExists = false;

					if (detectionMethod === 'smart') {
						// Use smart detection approach
						elementExists = await smartWaitForSelector(page, selector, timeout, earlyExitDelay, logger, nodeName, nodeId);
					} else {
						// Use traditional approach with fixed timeout
						try {
							await page.waitForSelector(selector, { timeout });
							elementExists = true;
						} catch {
							elementExists = false;
						}
					}

					// Only proceed if element exists
					if (!elementExists) {
						throw new Error(`Element with selector "${selector}" not found`);
					}
				}

				// Check if the element has the specified class
				hasClass = await page.$eval(
					selector,
					(el, cls) => el.classList.contains(cls),
					className
				);
			} catch (error) {
				// If error occurs, detection fails
				hasClass = false;
				logger.debug(`[Ventriloquist][${nodeName}][${nodeId}][Detect] Has class detection error: ${(error as Error).message}`);
			}

			detectionSuccess = hasClass;
			actualValue = hasClass ? 'true' : 'false';
			Object.assign(detectionDetails, {
				selector,
				className
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
	const startTime = Date.now();

	// Added for better logging
	const nodeName = this.getNode().name;
	const nodeId = this.getNode().id;
	this.logger.info(`[Ventriloquist][${nodeName}][${nodeId}][Detect] ========== START DETECT NODE EXECUTION ==========`);

	// Get parameters
	const waitForSelectors = this.getNodeParameter('waitForSelectors', index, true) as boolean;
	const timeout = this.getNodeParameter('timeout', index, 5000) as number;
	const takeScreenshot = this.getNodeParameter('takeScreenshot', index, false) as boolean;
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

	// Get or create browser session
	let page: puppeteer.Page | undefined;
	let sessionId = '';

	try {
		// Create a session or reuse an existing one
		const { browser, sessionId: newSessionId } = await Ventriloquist.getOrCreateSession(
			workflowId,
			websocketEndpoint,
			this.logger,
			undefined, // Use existing timeout set during open
		);

		// If an explicit sessionId was provided, try to get that page first
		if (explicitSessionId) {
			this.logger.info(`[Ventriloquist][${nodeName}][${nodeId}][Detect] Looking for explicitly provided session ID: ${explicitSessionId}`);
			page = Ventriloquist.getPage(workflowId, explicitSessionId);

			if (page) {
				sessionId = explicitSessionId;
				this.logger.info(`[Ventriloquist][${nodeName}][${nodeId}][Detect] Found existing page with explicit session ID: ${sessionId}`);
			} else {
				this.logger.warn(`[Ventriloquist][${nodeName}][${nodeId}][Detect] Provided session ID ${explicitSessionId} not found, will create a new session`);
			}
		}

		// If no explicit session or explicit session not found, proceed with normal flow
		if (!explicitSessionId || !page) {
			// Try to get any existing page from the browser
			const pages = await browser.pages();

			if (pages.length > 0) {
				// Use the first available page
				page = pages[0];
				sessionId = `existing_${Date.now()}`;
				this.logger.info(`[Ventriloquist][${nodeName}][${nodeId}][Detect] Using existing page from browser session`);
			} else {
				// Create a new page if none exists
				page = await browser.newPage();
				sessionId = newSessionId;
				this.logger.info(`[Ventriloquist][${nodeName}][${nodeId}][Detect] Created new page with session ID: ${sessionId}`);

				// Store the new page for future operations
				Ventriloquist.storePage(workflowId, sessionId, page);

				// Navigate to a blank page to initialize it
				await page.goto('about:blank');
			}
		}

		// At this point we must have a valid page
		if (!page) {
			throw new Error('Failed to get or create a page');
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
			if (takeScreenshot) {
				this.logger.debug(`[Ventriloquist][${nodeName}][${nodeId}][Detect] Capturing screenshot`);
				const screenshotBuffer = await page.screenshot({
					encoding: 'base64',
					type: 'jpeg',
					quality: 80,
				});

				screenshot = `data:image/jpeg;base64,${screenshotBuffer}`;
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
			if (takeScreenshot && page) {
				try {
					this.logger.debug(`[Ventriloquist][${nodeName}][${nodeId}][Detect] Capturing error screenshot`);
					const screenshotBuffer = await page.screenshot({
						encoding: 'base64',
						type: 'jpeg',
						quality: 80,
					});

					screenshot = `data:image/jpeg;base64,${screenshotBuffer}`;
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
