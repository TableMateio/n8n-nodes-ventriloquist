import type {
	IDataObject,
	Logger as ILogger,
} from 'n8n-workflow';
import type * as puppeteer from 'puppeteer-core';
import { formatOperationLog } from './resultUtils';
import { waitAndClick } from './clickOperations';
import { processFormField } from './formOperations';
import { navigateWithRetry } from './navigationUtils';
import {
	extractTextContent,
	extractHtmlContent,
	extractInputValue,
	extractAttributeValue,
	extractTableData,
	extractMultipleElements
} from './extractionUtils';
import { smartWaitForSelector } from './detectionUtils';

/**
 * Action types supported by the action executor
 */
export type ActionType = 'click' | 'fill' | 'extract' | 'navigate' | 'none';

/**
 * Interface for action options
 */
export interface IActionOptions {
	waitForSelector: boolean;
	selectorTimeout: number;
	detectionMethod: string;
	earlyExitDelay: number;
	nodeName: string;
	nodeId: string;
	index: number;
	useHumanDelays?: boolean;
}

/**
 * Interface for action parameters
 */
export interface IActionParameters extends IDataObject {
	// Common parameters
	selector?: string;

	// Click parameters
	waitAfterAction?: string;
	waitTime?: number;
	waitSelector?: string;

	// Fill parameters
	fieldType?: string;
	value?: string;
	clearField?: boolean;
	pressEnter?: boolean;
	checkState?: string;
	filePath?: string;
	checked?: boolean;

	// Extract parameters
	extractionType?: string;
	attributeName?: string;
	includeMetadata?: boolean;
	outputFormat?: string;

	// Navigate parameters
	url?: string;
	waitUntil?: string;
}

/**
 * Interface for action results
 */
export interface IActionResult {
	success: boolean;
	actionType: ActionType;
	details: IDataObject;
	error?: Error | string;
}

/**
 * Execute a click action on the page
 */
async function executeClickAction(
	page: puppeteer.Page,
	parameters: IActionParameters,
	options: IActionOptions,
	logger: ILogger
): Promise<IActionResult> {
	const { selector, waitAfterAction = 'domContentLoaded', waitTime = 5000, waitSelector } = parameters;
	const { nodeName, nodeId, index, selectorTimeout } = options;

	if (!selector) {
		return {
			success: false,
			actionType: 'click',
			details: { error: 'No selector provided for click action' },
			error: 'No selector provided for click action'
		};
	}

	try {
		logger.info(formatOperationLog('Action', nodeName, nodeId, index,
			`Executing click on "${selector}" (wait: ${waitAfterAction}, timeout: ${waitTime}ms)`));

		// Use the waitAndClick utility which handles both waiting for the selector and clicking it
		const clickResult = await waitAndClick(
			page,
			selector,
			{
				waitTimeout: selectorTimeout,
				retries: 2,
				waitBetweenRetries: 1000,
				logger: logger
			}
		);

		// Handle click failures
		if (!clickResult.success) {
			throw new Error(`Action failed: Could not click element "${selector}": ${clickResult.error?.message || 'Unknown error'}`);
		}

		logger.info(formatOperationLog('Action', nodeName, nodeId, index,
			`Click successful on "${selector}"`));

		// Handle post-click waiting
		if (waitAfterAction === 'fixedTime') {
			await new Promise(resolve => setTimeout(resolve, waitTime));
		} else if (waitAfterAction === 'urlChanged') {
			await page.waitForNavigation({ timeout: waitTime });
		} else if (waitAfterAction === 'selector' && waitSelector) {
			await page.waitForSelector(waitSelector, { timeout: waitTime });
		}

		return {
			success: true,
			actionType: 'click',
			details: {
				selector,
				waitAfterAction,
				waitTime
			}
		};
	} catch (error) {
		logger.error(formatOperationLog('Action', nodeName, nodeId, index,
			`Error during click action: ${(error as Error).message}`));

		return {
			success: false,
			actionType: 'click',
			details: {
				selector,
				waitAfterAction,
				waitTime
			},
			error: error as Error
		};
	}
}

/**
 * Execute a form fill action on the page
 */
async function executeFillAction(
	page: puppeteer.Page,
	parameters: IActionParameters,
	options: IActionOptions,
	logger: ILogger
): Promise<IActionResult> {
	const {
		selector,
		value = '',
		fieldType = 'text',
		clearField = true,
		pressEnter = false,
		checkState = 'check',
		checked = true,
		filePath = ''
	} = parameters;
	const { nodeName, nodeId, index, useHumanDelays = false } = options;

	if (!selector) {
		return {
			success: false,
			actionType: 'fill',
			details: { error: 'No selector provided for fill action' },
			error: 'No selector provided for fill action'
		};
	}

	try {
		logger.info(formatOperationLog('Action', nodeName, nodeId, index,
			`Executing form fill on "${selector}" (type: ${fieldType})`));

		// Process the form field using our utility function
		const field: IDataObject = {
			fieldType,
			selector,
			value,
			// Add options based on field type
			...(fieldType === 'text' || fieldType === 'textarea' ? {
				clearField,
				humanLike: useHumanDelays,
				pressEnter
			} : {}),
			...(fieldType === 'checkbox' ? {
				checked
			} : {}),
			...(fieldType === 'radio' ? {
				checkState
			} : {}),
			...(fieldType === 'file' ? {
				filePath
			} : {})
		};

		const { success, fieldResult } = await processFormField(
			page,
			field,
			logger
		);

		if (!success) {
			throw new Error(`Failed to fill form field: ${selector} (type: ${fieldType})`);
		}

		return {
			success: true,
			actionType: 'fill',
			details: {
				...fieldResult
			}
		};
	} catch (error) {
		logger.error(formatOperationLog('Action', nodeName, nodeId, index,
			`Error during fill action: ${(error as Error).message}`));

		return {
			success: false,
			actionType: 'fill',
			details: {
				selector,
				fieldType,
				value
			},
			error: error as Error
		};
	}
}

/**
 * Execute an extraction action on the page
 */
async function executeExtractAction(
	page: puppeteer.Page,
	parameters: IActionParameters,
	options: IActionOptions,
	logger: ILogger
): Promise<IActionResult> {
	const {
		selector,
		extractionType = 'text',
		attributeName = '',
		includeMetadata = false,
		outputFormat = 'text'
	} = parameters;
	const { nodeName, nodeId, index, waitForSelector, selectorTimeout, detectionMethod, earlyExitDelay } = options;

	if (!selector) {
		return {
			success: false,
			actionType: 'extract',
			details: { error: 'No selector provided for extract action' },
			error: 'No selector provided for extract action'
		};
	}

	try {
		logger.info(formatOperationLog('Action', nodeName, nodeId, index,
			`Executing extraction from "${selector}" (type: ${extractionType})`));

		// Wait for the element if needed
		if (waitForSelector) {
			if (detectionMethod === 'smart') {
				const elementExists = await smartWaitForSelector(
					page,
					selector,
					selectorTimeout,
					earlyExitDelay,
					logger,
					nodeName,
					nodeId
				);

				if (!elementExists) {
					throw new Error(`Element "${selector}" not found for extraction`);
				}
			} else {
				await page.waitForSelector(selector, { timeout: selectorTimeout });
			}
		}

		let extractedData: string | Record<string, unknown> | Array<unknown> | null = null;

		// Extract data based on the extraction type
		switch (extractionType) {
			case 'text':
				extractedData = await extractTextContent(page, selector, logger, nodeName, nodeId);
				break;

			case 'html':
				extractedData = await extractHtmlContent(
					page,
					selector,
					{
						includeMetadata,
						outputFormat: outputFormat as 'html' | 'json'
					},
					logger,
					nodeName,
					nodeId
				);
				break;

			case 'value':
				extractedData = await extractInputValue(page, selector, logger, nodeName, nodeId);
				break;

			case 'attribute':
				if (!attributeName) {
					throw new Error('No attribute name provided for attribute extraction');
				}
				extractedData = await extractAttributeValue(
					page,
					selector,
					attributeName,
					logger,
					nodeName,
					nodeId
				);
				break;

			case 'table':
				extractedData = await extractTableData(
					page,
					selector,
					{
						includeHeaders: true,
						rowSelector: 'tr',
						cellSelector: 'td, th',
						outputFormat: 'array'
					},
					logger,
					nodeName,
					nodeId
				);
				break;

			case 'multiple':
				extractedData = await extractMultipleElements(
					page,
					selector,
					{
						attributeName: '',
						extractionProperty: 'textContent',
						limit: 0,
						outputFormat: 'array',
						separator: ','
					},
					logger,
					nodeName,
					nodeId
				);
				break;

			default:
				throw new Error(`Unknown extraction type: ${extractionType}`);
		}

		logger.info(formatOperationLog('Action', nodeName, nodeId, index,
			`Extraction successful from "${selector}"`));

		return {
			success: true,
			actionType: 'extract',
			details: {
				selector,
				extractionType,
				data: extractedData
			}
		};
	} catch (error) {
		logger.error(formatOperationLog('Action', nodeName, nodeId, index,
			`Error during extract action: ${(error as Error).message}`));

		return {
			success: false,
			actionType: 'extract',
			details: {
				selector,
				extractionType
			},
			error: error as Error
		};
	}
}

/**
 * Execute a navigation action
 */
async function executeNavigateAction(
	page: puppeteer.Page,
	parameters: IActionParameters,
	options: IActionOptions,
	logger: ILogger
): Promise<IActionResult> {
	const { url, waitUntil = 'domcontentloaded', waitTime = 30000 } = parameters;
	const { nodeName, nodeId, index } = options;

	if (!url) {
		return {
			success: false,
			actionType: 'navigate',
			details: { error: 'No URL provided for navigation action' },
			error: 'No URL provided for navigation action'
		};
	}

	try {
		logger.info(formatOperationLog('Action', nodeName, nodeId, index,
			`Executing navigation to "${url}" (waitUntil: ${waitUntil}, timeout: ${waitTime}ms)`));

		// Use navigation with retry utility
		const navigationResult = await navigateWithRetry(
			page,
			url,
			{
				waitUntil: waitUntil as 'load' | 'domcontentloaded' | 'networkidle0' | 'networkidle2',
				timeout: waitTime as number,
				maxRetries: 2,
				retryDelay: 1000,
			},
			logger
		);

		if (!navigationResult) {
			throw new Error(`Navigation to "${url}" failed or timed out`);
		}

		logger.info(formatOperationLog('Action', nodeName, nodeId, index,
			`Navigation successful to "${url}"`));

		return {
			success: true,
			actionType: 'navigate',
			details: {
				url,
				waitUntil,
				waitTime
			}
		};
	} catch (error) {
		logger.error(formatOperationLog('Action', nodeName, nodeId, index,
			`Error during navigation action: ${(error as Error).message}`));

		return {
			success: false,
			actionType: 'navigate',
			details: {
				url,
				waitUntil,
				waitTime
			},
			error: error as Error
		};
	}
}

/**
 * Execute an action based on its type
 */
export async function executeAction(
	page: puppeteer.Page,
	actionType: ActionType,
	parameters: IActionParameters,
	options: IActionOptions,
	logger: ILogger
): Promise<IActionResult> {
	// Log action start
	logger.debug(formatOperationLog('Action', options.nodeName, options.nodeId, options.index,
		`Starting action execution: ${actionType}`));

	// Execute based on action type
	switch (actionType) {
		case 'click':
			return executeClickAction(page, parameters, options, logger);

		case 'fill':
			return executeFillAction(page, parameters, options, logger);

		case 'extract':
			return executeExtractAction(page, parameters, options, logger);

		case 'navigate':
			return executeNavigateAction(page, parameters, options, logger);

		case 'none':
			logger.debug(formatOperationLog('Action', options.nodeName, options.nodeId, options.index,
				'No action requested (action type: none)'));

			return {
				success: true,
				actionType: 'none',
				details: { message: 'No action performed' }
			};

		default:
			logger.error(formatOperationLog('Action', options.nodeName, options.nodeId, options.index,
				`Unknown action type: ${actionType}`));

			return {
				success: false,
				actionType: actionType as ActionType,
				details: { error: `Unknown action type: ${actionType}` },
				error: `Unknown action type: ${actionType}`
			};
	}
}
