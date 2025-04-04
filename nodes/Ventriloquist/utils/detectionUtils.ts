import type {
	IDataObject,
	Logger as ILogger,
} from 'n8n-workflow';
import type * as puppeteer from 'puppeteer-core';
import { formatOperationLog } from './resultUtils';

/**
 * Interface for detection options
 */
export interface IDetectionOptions {
	waitForSelectors: boolean;
	selectorTimeout: number;
	detectionMethod: string;
	earlyExitDelay: number;
	nodeName: string;
	nodeId: string;
	index: number;
}

/**
 * Interface for detection results
 */
export interface IDetectionResult {
	success: boolean;
	actualValue: string | number;
	details: IDataObject;
}

/**
 * Safely matches strings according to the specified match type
 */
export function matchStrings(value: string, targetValue: string, matchType: string, caseSensitive: boolean): boolean {
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
 * Compare count values according to a specific operator
 */
export function compareCount(actualCount: number, expectedCount: number, operator: string): boolean {
	switch (operator) {
		case 'equal':
			return actualCount === expectedCount;
		case 'greater':
			return actualCount > expectedCount;
		case 'greaterEqual':
			return actualCount >= expectedCount;
		case 'less':
			return actualCount < expectedCount;
		case 'lessEqual':
			return actualCount <= expectedCount;
		default:
			return actualCount === expectedCount;
	}
}

/**
 * Format the return value based on the return type
 */
export function formatReturnValue(
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
export async function smartWaitForSelector(
	page: puppeteer.Page,
	selector: string,
	timeout: number,
	earlyExitDelay: number,
	logger: ILogger,
	nodeName: string = 'unknown',
	nodeId: string = 'unknown',
): Promise<boolean> {
	logger.debug(formatOperationLog('Detection', nodeName, nodeId, 0, `Smart waiting for selector: ${selector} (timeout: ${timeout}ms)`));

	// Create a promise that resolves when the element is found
	const elementPromise = page.waitForSelector(selector, { timeout })
		.then(() => {
			logger.debug(formatOperationLog('Detection', nodeName, nodeId, 0, `Element found: ${selector}`));
			return true;
		})
		.catch(() => {
			logger.debug(formatOperationLog('Detection', nodeName, nodeId, 0, `Element not found within timeout: ${selector}`));
			return false;
		});

	// Check if the DOM is already loaded
	const domState = await page.evaluate(() => {
		return {
			readyState: document.readyState,
			bodyExists: !!document.body,
		};
	});

	logger.debug(formatOperationLog('Detection', nodeName, nodeId, 0, `DOM state: readyState=${domState.readyState}, bodyExists=${domState.bodyExists}`));

	// If DOM is not loaded yet, wait for it
	if (domState.readyState !== 'complete' && domState.readyState !== 'interactive') {
		logger.debug(formatOperationLog('Detection', nodeName, nodeId, 0, 'DOM not ready, waiting for it to load...'));
		await page.waitForFunction(
			() => document.readyState === 'complete' || document.readyState === 'interactive',
			{ timeout: Math.min(timeout, 10000) }, // Cap at 10 seconds max for DOM loading
		);
	}

	// If there's no body yet (rare case), wait for it
	if (!domState.bodyExists) {
		logger.debug(formatOperationLog('Detection', nodeName, nodeId, 0, 'Document body not found, waiting for it...'));
		await page.waitForFunction(() => !!document.body, {
			timeout: Math.min(timeout, 5000), // Cap at 5 seconds max for body
		});
	}

	// Wait a small delay to allow dynamic content to load
	if (earlyExitDelay > 0) {
		logger.debug(formatOperationLog('Detection', nodeName, nodeId, 0, `Waiting ${earlyExitDelay}ms early exit delay...`));
		await new Promise(resolve => setTimeout(resolve, earlyExitDelay));
	}

	// Check if element exists without waiting (quick check)
	const elementExistsNow = await page.evaluate((sel) => {
		return document.querySelector(sel) !== null;
	}, selector);

	if (elementExistsNow) {
		logger.debug(formatOperationLog('Detection', nodeName, nodeId, 0, `Element found immediately after DOM ready: ${selector}`));
		return true;
	}

	logger.debug(formatOperationLog('Detection', nodeName, nodeId, 0, `Element not found in initial check, waiting up to timeout: ${selector}`));
	// If not found immediately, wait for the original promise with timeout
	return elementPromise;
}

/**
 * Detect if an element exists on the page with options for waiting
 */
export async function detectElement(
	page: puppeteer.Page,
	selector: string,
	options: IDetectionOptions,
	logger: ILogger,
): Promise<IDetectionResult> {
	const { waitForSelectors, selectorTimeout, detectionMethod, earlyExitDelay, nodeName, nodeId, index } = options;

	let exists = false;
	const detailsInfo: IDataObject = { selector };

	try {
		if (waitForSelectors) {
			if (detectionMethod === 'smart') {
				// Use smart detection approach
				exists = await smartWaitForSelector(
					page,
					selector,
					selectorTimeout,
					earlyExitDelay,
					logger,
					nodeName,
					nodeId
				);
			} else {
				// Use traditional fixed timeout approach
				try {
					await page.waitForSelector(selector, { timeout: selectorTimeout });
					exists = true;
				} catch (error) {
					exists = false;
				}
			}
		} else {
			// Just check if the element exists without waiting
			exists = await page.$(selector) !== null;
		}

		logger.debug(formatOperationLog('Detection', nodeName, nodeId, index,
			`Element exists detection result for "${selector}": ${exists ? 'FOUND' : 'NOT FOUND'}`));
	} catch (error) {
		// If error occurs while checking, element doesn't exist
		exists = false;
		logger.debug(formatOperationLog('Detection', nodeName, nodeId, index,
			`Element exists detection error: ${(error as Error).message}`));
	}

	return {
		success: exists,
		actualValue: exists ? 'true' : 'false',
		details: detailsInfo,
	};
}

/**
 * Detect if element text matches specified criteria
 */
export async function detectText(
	page: puppeteer.Page,
	selector: string,
	textToMatch: string,
	matchType: string = 'contains',
	caseSensitive: boolean = false,
	options: IDetectionOptions,
	logger: ILogger,
): Promise<IDetectionResult> {
	const { nodeName, nodeId, index } = options;

	let elementText = '';
	let textMatches = false;
	const detailsInfo: IDataObject = {
		selector,
		textToMatch,
		matchType,
		caseSensitive
	};

	try {
		// First check if element exists
		const elementExists = await detectElement(page, selector, options, logger);

		if (!elementExists.success) {
			logger.debug(formatOperationLog('Detection', nodeName, nodeId, index,
				`Text detection failed: Element not found: ${selector}`));
			return {
				success: false,
				actualValue: '',
				details: {
					...detailsInfo,
					error: 'Element not found'
				},
			};
		}

		// Extract text from the element
		elementText = await page.$eval(selector, (el) => el.textContent || '');

		// Check if the text matches
		textMatches = matchStrings(elementText, textToMatch, matchType, caseSensitive);

		logger.debug(formatOperationLog('Detection', nodeName, nodeId, index,
			`Text detection for "${selector}": ${textMatches ? 'MATCHED' : 'NOT MATCHED'}, actual text: "${elementText.substring(0, 50)}${elementText.length > 50 ? '...' : ''}"`));
	} catch (error) {
		logger.debug(formatOperationLog('Detection', nodeName, nodeId, index,
			`Text detection error: ${(error as Error).message}`));
		textMatches = false;
		elementText = '';
	}

	return {
		success: textMatches,
		actualValue: elementText,
		details: detailsInfo,
	};
}

/**
 * Detect if a URL matches specified criteria
 */
export async function detectUrl(
	page: puppeteer.Page,
	urlToMatch: string,
	matchType: string = 'contains',
	caseSensitive: boolean = false,
	options: IDetectionOptions,
	logger: ILogger,
): Promise<IDetectionResult> {
	const { nodeName, nodeId, index } = options;

	let currentUrl = '';
	let urlMatches = false;
	const detailsInfo: IDataObject = {
		urlToMatch,
		matchType,
		caseSensitive
	};

	try {
		// Get current URL
		currentUrl = await page.url();

		// Check if the URL matches
		urlMatches = matchStrings(currentUrl, urlToMatch, matchType, caseSensitive);

		logger.debug(formatOperationLog('Detection', nodeName, nodeId, index,
			`URL detection: ${urlMatches ? 'MATCHED' : 'NOT MATCHED'}, current URL: "${currentUrl}"`));
	} catch (error) {
		logger.debug(formatOperationLog('Detection', nodeName, nodeId, index,
			`URL detection error: ${(error as Error).message}`));
		urlMatches = false;
	}

	return {
		success: urlMatches,
		actualValue: currentUrl,
		details: detailsInfo,
	};
}

/**
 * Detect the count of elements matching a selector
 */
export async function detectCount(
	page: puppeteer.Page,
	selector: string,
	expectedCount: number,
	countComparison: string = 'equal',
	options: IDetectionOptions,
	logger: ILogger,
): Promise<IDetectionResult> {
	const { nodeName, nodeId, index } = options;

	let elementCount = 0;
	let countMatches = false;
	const detailsInfo: IDataObject = {
		selector,
		expectedCount,
		countComparison
	};

	try {
		// Get the count of elements
		elementCount = (await page.$$(selector)).length;

		// Compare the counts
		countMatches = compareCount(elementCount, expectedCount, countComparison);

		logger.debug(formatOperationLog('Detection', nodeName, nodeId, index,
			`Count detection for "${selector}": ${countMatches ? 'MATCHED' : 'NOT MATCHED'}, found ${elementCount} elements, expected ${countComparison} ${expectedCount}`));
	} catch (error) {
		logger.debug(formatOperationLog('Detection', nodeName, nodeId, index,
			`Count detection error: ${(error as Error).message}`));
		countMatches = false;
	}

	return {
		success: countMatches,
		actualValue: elementCount,
		details: detailsInfo,
	};
}

/**
 * Evaluate a JavaScript expression on the page
 */
export async function detectExpression(
	page: puppeteer.Page,
	expression: string,
	options: IDetectionOptions,
	logger: ILogger,
): Promise<IDetectionResult> {
	const { nodeName, nodeId, index } = options;

	let expressionResult = false;
	let actualValue: string | number = '';
	const detailsInfo: IDataObject = { expression };

	try {
		// Execute the JavaScript expression on the page
		const result = await page.evaluate((expr) => {
			try {
				// eslint-disable-next-line no-eval
				const evalResult = eval(expr);
				return {
					success: true,
					value: evalResult,
					valueType: typeof evalResult
				};
			} catch (error) {
				return {
					success: false,
					error: error instanceof Error ? error.message : String(error),
					value: null,
					valueType: 'null'
				};
			}
		}, expression);

		if (result.success) {
			expressionResult = !!result.value;

			// Format actual value based on the type
			if (result.valueType === 'object') {
				try {
					actualValue = JSON.stringify(result.value);
				} catch (e) {
					actualValue = '[Object]';
				}
			} else if (result.valueType === 'function') {
				actualValue = '[Function]';
			} else {
				actualValue = String(result.value);
			}
		} else {
			expressionResult = false;
			actualValue = `Error: ${result.error}`;
			detailsInfo.error = result.error;
		}

		logger.debug(formatOperationLog('Detection', nodeName, nodeId, index,
			`Expression detection: ${expressionResult ? 'TRUTHY' : 'FALSY'}, result: ${actualValue}`));
	} catch (error) {
		logger.debug(formatOperationLog('Detection', nodeName, nodeId, index,
			`Expression detection error: ${(error as Error).message}`));
		expressionResult = false;
		actualValue = `Error: ${(error as Error).message}`;
		detailsInfo.error = (error as Error).message;
	}

	return {
		success: expressionResult,
		actualValue,
		details: detailsInfo,
	};
}

/**
 * Process a single detection and return its result
 */
export async function processDetection(
	page: puppeteer.Page,
	detection: IDataObject,
	currentUrl: string,
	waitForSelectors: boolean,
	timeout: number,
	detectionMethod: string,
	earlyExitDelay: number,
	logger: ILogger,
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

					if (!elementExists) {
						throw new Error(`Element not found: ${selector}`);
					}
				}

				// Extract text from the element
				elementText = await page.$eval(selector, (el) => el.textContent || '');

				// Check if the text matches
				textMatches = matchStrings(elementText, textToCheck, matchType, caseSensitive);
			} catch (error) {
				logger.debug(`[Ventriloquist][${nodeName}][${nodeId}][Detect] Text contains detection failed: ${(error as Error).message}`);
				textMatches = false;
			}

			detectionSuccess = textMatches;
			actualValue = elementText;
			detectionDetails.selector = selector;
			detectionDetails.expected = textToCheck;
			detectionDetails.matchType = matchType;
			break;
		}

		case 'attributeValue': {
			const selector = detection.selector as string;
			const attributeName = detection.attributeName as string;
			const attributeValue = detection.attributeValue as string;
			const matchType = (detection.matchType as string) || 'contains';
			const caseSensitive = detection.caseSensitive === true;

			let actualAttributeValue = '';
			let attrMatches = false;

			try {
				if (waitForSelectors) {
					let elementExists = false;

					if (detectionMethod === 'smart') {
						// Use smart detection approach
						elementExists = await smartWaitForSelector(page, selector, timeout, earlyExitDelay, logger, nodeName, nodeId);
					} else {
						// Use traditional approach
						try {
							await page.waitForSelector(selector, { timeout });
							elementExists = true;
						} catch {
							elementExists = false;
						}
					}

					if (!elementExists) {
						throw new Error(`Element not found: ${selector}`);
					}
				}

				// Extract attribute from the element
				actualAttributeValue = await page.$eval(
					selector,
					(el, attr) => el.getAttribute(attr) || '',
					attributeName
				);

				// Check if the attribute matches
				attrMatches = matchStrings(actualAttributeValue, attributeValue, matchType, caseSensitive);
			} catch (error) {
				logger.debug(`[Ventriloquist][${nodeName}][${nodeId}][Detect] Attribute value detection failed: ${(error as Error).message}`);
				attrMatches = false;
			}

			detectionSuccess = attrMatches;
			actualValue = actualAttributeValue;
			detectionDetails.selector = selector;
			detectionDetails.attributeName = attributeName;
			detectionDetails.expected = attributeValue;
			detectionDetails.matchType = matchType;
			break;
		}

		case 'elementCount': {
			const selector = detection.selector as string;
			const expectedCount = (detection.expectedCount as number) || 1;
			const countComparison = (detection.countComparison as string) || 'equal';

			let elementCount = 0;
			let countMatches = false;

			try {
				// Get the count of elements
				elementCount = await page.$$eval(selector, (elements) => elements.length);

				// Compare the counts
				countMatches = compareCount(elementCount, expectedCount, countComparison);
			} catch (error) {
				logger.debug(`[Ventriloquist][${nodeName}][${nodeId}][Detect] Element count detection failed: ${(error as Error).message}`);
				countMatches = false;
			}

			detectionSuccess = countMatches;
			actualValue = elementCount;
			detectionDetails.selector = selector;
			detectionDetails.expected = expectedCount;
			detectionDetails.comparison = countComparison;
			break;
		}

		case 'urlContains': {
			const urlSubstring = detection.urlSubstring as string;
			const matchType = (detection.matchType as string) || 'contains';
			const caseSensitive = detection.caseSensitive === true;

			// Check if the URL matches
			const urlMatches = matchStrings(currentUrl, urlSubstring, matchType, caseSensitive);

			detectionSuccess = urlMatches;
			actualValue = currentUrl;
			detectionDetails.expected = urlSubstring;
			detectionDetails.matchType = matchType;
			break;
		}

		default:
			throw new Error(`Unknown detection type: ${detectionType}`);
	}

	return {
		success: detectionSuccess,
		actualValue,
		details: detectionDetails,
	};
}

/**
 * Take a screenshot of the current page
 */
export async function takePageScreenshot(
	page: puppeteer.Page,
	logger: ILogger,
	nodeName: string,
	nodeId: string,
): Promise<string> {
	try {
		const screenshotBuffer = await page.screenshot({
			encoding: 'base64',
			type: 'jpeg',
			quality: 80,
		});

		const screenshot = `data:image/jpeg;base64,${screenshotBuffer}`;
		logger.debug(`[Ventriloquist][${nodeName}][${nodeId}][Detect] Captured screenshot`);
		return screenshot;
	} catch (error) {
		logger.warn(`[Ventriloquist][${nodeName}][${nodeId}][Detect] Failed to capture screenshot: ${(error as Error).message}`);
		return '';
	}
}
