import type {
	IDataObject,
	Logger as ILogger,
} from 'n8n-workflow';
import type * as puppeteer from 'puppeteer-core';

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
