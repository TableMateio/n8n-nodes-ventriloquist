import type { IDataObject, IExecuteFunctions } from 'n8n-workflow';
import type * as puppeteer from 'puppeteer-core';
import type { IFallbackOptions as IFallbackOptionsInternal, IFallbackResult } from './middlewares/fallback/fallbackMiddleware';
import { executeFallbackAction } from './middlewares/fallback/fallbackMiddleware';

/**
 * Execute fallback actions if primary action fails
 * This is a wrapper around the fallback middleware for backward compatibility
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

	// Prepare context for the fallback middleware
	const context = {
		nodeName,
		nodeId,
		index,
		resultData
	};

	// Add additional parameters from the node if not already in options
	if (fallbackOptions.fallbackAction === 'fill') {
		// Only extract these parameters if they're not already provided
		if (fallbackOptions.fallbackInputType === undefined) {
			fallbackOptions.fallbackInputType = thisNode.getNodeParameter('fallbackInputType', index, 'text') as string;
		}

		if (fallbackOptions.fallbackText === undefined) {
			fallbackOptions.fallbackText = thisNode.getNodeParameter('fallbackText', index, '') as string;
		}

		// Extract parameters specific to input types
		if (fallbackOptions.fallbackInputType === 'checkbox' || fallbackOptions.fallbackInputType === 'radio') {
			if (fallbackOptions.fallbackCheckState === undefined) {
				fallbackOptions.fallbackCheckState = thisNode.getNodeParameter('fallbackCheckState', index, 'check') as string;
			}
		} else if (fallbackOptions.fallbackInputType === 'text') {
			if (fallbackOptions.fallbackClearField === undefined) {
				fallbackOptions.fallbackClearField = thisNode.getNodeParameter('fallbackClearField', index, false) as boolean;
			}

			if (fallbackOptions.fallbackPressEnter === undefined) {
				fallbackOptions.fallbackPressEnter = thisNode.getNodeParameter('fallbackPressEnter', index, false) as boolean;
			}
		} else if (fallbackOptions.fallbackInputType === 'file') {
			if (fallbackOptions.fallbackFilePath === undefined) {
				fallbackOptions.fallbackFilePath = thisNode.getNodeParameter('fallbackFilePath', index, '') as string;
			}
		}
	}

	// Execute the fallback action using the middleware
	const fallbackResult: IFallbackResult = await executeFallbackAction(
		page,
		fallbackOptions,
		context,
		thisNode.logger
	);

	// Return success status (for backward compatibility)
	return fallbackResult.success;
}

// Re-export the interface for backward compatibility
export type IFallbackOptions = IFallbackOptionsInternal;
