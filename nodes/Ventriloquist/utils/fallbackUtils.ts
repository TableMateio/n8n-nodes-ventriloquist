import type { IDataObject, IExecuteFunctions } from 'n8n-workflow';
import type * as puppeteer from 'puppeteer-core';
import { formatOperationLog } from './resultUtils';
import { waitAndClick } from './clickOperations';
import { navigateWithRetry } from './navigationUtils';
import { takeScreenshot } from './navigationUtils';
import { executeAction, ActionType, IActionOptions, IActionParameters } from './actionUtils';

export interface IFallbackOptions {
	enableFallback: boolean;
	fallbackAction: string;
	fallbackSelector?: string;
	fallbackUrl?: string;
	fallbackTimeout?: number;
}

/**
 * Execute fallback actions if primary action fails
 */
export async function executeFallback(
	page: puppeteer.Page,
	fallbackOptions: IFallbackOptions,
	resultData: IDataObject,
	index: number,
	thisNode: IExecuteFunctions
): Promise<boolean> {
	const nodeName = thisNode.getNode().name;
	const nodeId = thisNode.getNode().id;

	// Quick return if fallback is disabled
	if (!fallbackOptions.enableFallback) {
		return false;
	}

	try {
		const fallbackAction = fallbackOptions.fallbackAction || 'none';

		// If fallback action is none, then nothing to do
		if (fallbackAction === 'none') {
			thisNode.logger.debug(formatOperationLog('FallbackUtils', nodeName, nodeId, index,
				'No fallback action specified, skipping fallback'));
			return false;
		}

		// Default timeout for fallback operations
		const fallbackTimeout = fallbackOptions.fallbackTimeout || 30000;

		thisNode.logger.info(formatOperationLog('FallbackUtils', nodeName, nodeId, index,
			`Executing fallback action: ${fallbackAction}`));

		// Execute the appropriate fallback action
		switch (fallbackAction) {
			case 'click': {
				// Validate required parameters
				if (!fallbackOptions.fallbackSelector) {
					thisNode.logger.error(formatOperationLog('FallbackUtils', nodeName, nodeId, index,
						'Missing required parameter: fallbackSelector'));
					throw new Error('Missing required parameter: fallbackSelector');
				}

				const fallbackSelector = fallbackOptions.fallbackSelector;

				thisNode.logger.info(formatOperationLog('FallbackUtils', nodeName, nodeId, index,
					`Attempting fallback click on selector: ${fallbackSelector}`));

				// Perform click - using the correct signature
				await waitAndClick(
					page,
					fallbackSelector,
					{ waitTimeout: fallbackTimeout }
				);

				thisNode.logger.info(formatOperationLog('FallbackUtils', nodeName, nodeId, index,
					'Fallback click action completed successfully'));

				// Store the fallback action in the result data
				resultData.fallbackAction = {
					type: 'click',
					selector: fallbackSelector,
					success: true,
				};

				// Take a screenshot after the fallback action
				try {
					const screenshot = await takeScreenshot(page, thisNode.logger);
					if (screenshot) {
						resultData.fallbackActionScreenshot = screenshot;
					}
				} catch (screenshotError) {
					thisNode.logger.warn(formatOperationLog('FallbackUtils', nodeName, nodeId, index,
						`Failed to take screenshot after fallback action: ${(screenshotError as Error).message}`));
				}

				return true;
			}

			case 'navigate': {
				// Validate required parameters
				if (!fallbackOptions.fallbackUrl) {
					thisNode.logger.error(formatOperationLog('FallbackUtils', nodeName, nodeId, index,
						'Missing required parameter: fallbackUrl'));
					throw new Error('Missing required parameter: fallbackUrl');
				}

				const fallbackUrl = fallbackOptions.fallbackUrl;

				thisNode.logger.info(formatOperationLog('FallbackUtils', nodeName, nodeId, index,
					`Attempting fallback navigation to: ${fallbackUrl}`));

				// Perform navigation with correct signature
				const navigationResult = await navigateWithRetry(
					page,
					fallbackUrl,
					{
						waitUntil: 'domcontentloaded',
						timeout: fallbackTimeout,
						maxRetries: 2,
					},
					thisNode.logger
				);

				if (!navigationResult) {
					thisNode.logger.warn(formatOperationLog('FallbackUtils', nodeName, nodeId, index,
						'Fallback navigation may have encountered issues, but continuing execution'));
				} else {
					thisNode.logger.info(formatOperationLog('FallbackUtils', nodeName, nodeId, index,
						`Fallback navigation completed successfully to ${fallbackUrl}`));
				}

				// Store the fallback action in the result data
				resultData.fallbackAction = {
					type: 'navigate',
					url: fallbackUrl,
					success: !!navigationResult,
				};

				// Take a screenshot after the fallback action
				try {
					const screenshot = await takeScreenshot(page, thisNode.logger);
					if (screenshot) {
						resultData.fallbackActionScreenshot = screenshot;
					}
				} catch (screenshotError) {
					thisNode.logger.warn(formatOperationLog('FallbackUtils', nodeName, nodeId, index,
						`Failed to take screenshot after fallback action: ${(screenshotError as Error).message}`));
				}

				return true;
			}

			case 'fill': {
				// Validate required parameters
				if (!fallbackOptions.fallbackSelector) {
					thisNode.logger.error(formatOperationLog('FallbackUtils', nodeName, nodeId, index,
						'Missing required parameter: fallbackSelector'));
					throw new Error('Missing required parameter: fallbackSelector');
				}

				const fallbackSelector = fallbackOptions.fallbackSelector;
				const fallbackInputType = thisNode.getNodeParameter('fallbackInputType', index, 'text') as string;
				const fallbackText = thisNode.getNodeParameter('fallbackText', index, '') as string;

				// Get parameters specific to input types
				let checked = true;
				let fallbackCheckState = '';
				let fallbackClearField = false;
				let fallbackPressEnter = false;
				let fallbackFilePath = '';

				// Extract the appropriate parameters based on input type
				if (fallbackInputType === 'checkbox' || fallbackInputType === 'radio') {
					fallbackCheckState = thisNode.getNodeParameter('fallbackCheckState', index, 'check') as string;
					checked = fallbackCheckState === 'check';
				} else if (fallbackInputType === 'text') {
					fallbackClearField = thisNode.getNodeParameter('fallbackClearField', index, false) as boolean;
					fallbackPressEnter = thisNode.getNodeParameter('fallbackPressEnter', index, false) as boolean;
				} else if (fallbackInputType === 'file') {
					fallbackFilePath = thisNode.getNodeParameter('fallbackFilePath', index, '') as string;
				}

				thisNode.logger.info(formatOperationLog('FallbackUtils', nodeName, nodeId, index,
					`Attempting fallback fill on selector: ${fallbackSelector} with type: ${fallbackInputType}`));

				// Create action parameters
				const actionParameters: IActionParameters = {
					selector: fallbackSelector,
					fieldType: fallbackInputType,
					value: fallbackText,
					clearField: fallbackClearField,
					pressEnter: fallbackPressEnter,
					checked: checked,
					checkState: fallbackCheckState,
					filePath: fallbackFilePath
				};

				// Create action options
				const actionOptions: IActionOptions = {
					waitForSelector: true,
					selectorTimeout: fallbackTimeout,
					detectionMethod: 'standard',
					earlyExitDelay: 500,
					nodeName,
					nodeId,
					index,
					useHumanDelays: false
				};

				// Execute the fill action
				const actionResult = await executeAction(
					page,
					'fill' as ActionType,
					actionParameters,
					actionOptions,
					thisNode.logger
				);

				// Handle result
				if (!actionResult.success) {
					thisNode.logger.warn(formatOperationLog('FallbackUtils', nodeName, nodeId, index,
						`Fallback fill action failed: ${actionResult.error}`));
				} else {
					thisNode.logger.info(formatOperationLog('FallbackUtils', nodeName, nodeId, index,
						'Fallback fill action completed successfully'));
				}

				// Store the fallback action in the result data
				resultData.fallbackAction = {
					type: 'fill',
					selector: fallbackSelector,
					inputType: fallbackInputType,
					success: actionResult.success,
					details: actionResult.details
				};

				// Take a screenshot after the fallback action
				try {
					const screenshot = await takeScreenshot(page, thisNode.logger);
					if (screenshot) {
						resultData.fallbackActionScreenshot = screenshot;
					}
				} catch (screenshotError) {
					thisNode.logger.warn(formatOperationLog('FallbackUtils', nodeName, nodeId, index,
						`Failed to take screenshot after fallback action: ${(screenshotError as Error).message}`));
				}

				return actionResult.success;
			}

			default:
				thisNode.logger.warn(formatOperationLog('FallbackUtils', nodeName, nodeId, index,
					`Unknown fallback action: ${fallbackAction}`));
				return false;
		}
	} catch (error) {
		// If we encounter an error in the fallback action, log it but don't throw
		thisNode.logger.error(formatOperationLog('FallbackUtils', nodeName, nodeId, index,
			`Error executing fallback action: ${(error as Error).message}`));

		// Store the fallback action error in the result data
		resultData.fallbackActionError = {
			message: (error as Error).message,
			stack: (error as Error).stack,
		};

		return false;
	}
}
