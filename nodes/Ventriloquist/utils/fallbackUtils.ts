import type { IDataObject, IExecuteFunctions } from 'n8n-workflow';
import type * as puppeteer from 'puppeteer-core';
import { formatOperationLog } from './resultUtils';
import { waitAndClick } from './clickOperations';
import { navigateWithRetry } from './navigationUtils';
import { takeScreenshot } from './navigationUtils';

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
