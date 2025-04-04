import type { IDataObject, Logger as ILogger } from 'n8n-workflow';
import type * as puppeteer from 'puppeteer-core';
import { formatOperationLog } from './resultUtils';
import { navigateWithRetry } from './navigationUtils';
import { processFormField } from './formOperations';
import { waitAndClick } from './clickOperations';

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
		outputFormat = 'html',
		includeMetadata = false,
		includeHeaders = true,
		rowSelector = 'tr',
		cellSelector = 'td, th',
		extractionProperty = 'textContent',
		limit = 0,
		separator = ','
	} = parameters;
	const { nodeName, nodeId, index, waitForSelector = true, selectorTimeout = 5000, detectionMethod = 'standard', earlyExitDelay = 500 } = options;

	if (!selector) {
		return {
			success: false,
			actionType: 'extract',
			details: { error: 'No selector provided for extraction action' },
			error: 'No selector provided for extraction action'
		};
	}

	try {
		logger.info(formatOperationLog('Action', nodeName, nodeId, index,
			`Executing extraction from "${selector}" (type: ${extractionType})`));

		// Import the extraction middleware
		const { executeExtraction } = await import('./middlewares/extractMiddleware');

		// Prepare extract options
		const extractOptions = {
			extractionType: extractionType as string,
			selector: selector as string,
			attributeName: attributeName as string,
			outputFormat: outputFormat as string,
			includeMetadata: includeMetadata === true,
			includeHeaders: includeHeaders === true,
			rowSelector: rowSelector as string,
			cellSelector: cellSelector as string,
			extractionProperty: extractionProperty as string,
			limit: Number(limit) || 0,
			separator: separator as string,
			waitForSelector: waitForSelector === true,
			selectorTimeout: Number(selectorTimeout) || 5000,
			detectionMethod: detectionMethod as string,
			earlyExitDelay: Number(earlyExitDelay) || 500,
			nodeName: nodeName as string,
			nodeId: nodeId as string,
			index: Number(index) || 0
		};

		// Use the extraction middleware
		const extractResult = await executeExtraction(page, extractOptions, logger);

		if (!extractResult.success) {
			throw extractResult.error || new Error(`Unknown error during extraction from "${selector}"`);
		}

		return {
			success: true,
			actionType: 'extract',
			details: {
				selector,
				extractionType,
				data: extractResult.data,
				...extractResult.details
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
