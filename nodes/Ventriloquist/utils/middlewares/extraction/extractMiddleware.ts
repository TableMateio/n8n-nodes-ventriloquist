import type {
	IDataObject,
	Logger as ILogger,
} from 'n8n-workflow';
import type * as puppeteer from 'puppeteer-core';
import {
	extractTextContent,
	extractHtmlContent,
	extractInputValue,
	extractAttributeValue,
	extractTableData,
	extractMultipleElements,
	formatExtractedDataForLog
} from '../../extractionUtils';
import { formatOperationLog } from '../../resultUtils';
import { IMiddleware, IMiddlewareContext } from '../middleware';

export interface IExtractOptions {
	extractionType: string;
	selector: string;
	attributeName?: string;
	outputFormat?: string;
	includeMetadata?: boolean;
	includeHeaders?: boolean;
	rowSelector?: string;
	cellSelector?: string;
	extractionProperty?: string;
	limit?: number;
	separator?: string;
	waitForSelector?: boolean;
	selectorTimeout?: number;
	detectionMethod?: string;
	earlyExitDelay?: number;
	nodeName: string;
	nodeId: string;
	index: number;
}

export interface IExtractInput {
	page: puppeteer.Page;
	options: IExtractOptions;
}

export interface IExtractResult {
	success: boolean;
	data: string | IDataObject | Array<unknown> | null;
	selector: string;
	extractionType: string;
	details?: IDataObject;
	error?: Error;
}

/**
 * Middleware class for extraction operations
 * This provides a unified way to handle extractions across different operation types
 */
export class ExtractionMiddleware implements IMiddleware<IExtractInput, IExtractResult> {
	/**
	 * Execute the extraction middleware
	 */
	public async execute(
		input: IExtractInput,
		context: IMiddlewareContext
	): Promise<IExtractResult> {
		const { page, options } = input;
		const { logger } = context;
		const {
			extractionType,
			selector,
			attributeName,
			outputFormat = 'html',
			includeMetadata = false,
			includeHeaders = true,
			rowSelector = 'tr',
			cellSelector = 'td, th',
			extractionProperty = 'textContent',
			limit = 0,
			separator = ',',
			nodeName,
			nodeId,
			index,
		} = options;

		logger.info(formatOperationLog('ExtractionMiddleware', nodeName, nodeId, index,
			`Executing extraction: type=${extractionType}, selector=${selector}`));

		try {
			let extractedData: string | IDataObject | Array<unknown> | null = null;

			// Process different extraction types
			switch (extractionType) {
				case 'text': {
					extractedData = await extractTextContent(page, selector, logger, nodeName, nodeId);
					break;
				}

				case 'html': {
					extractedData = await extractHtmlContent(
						page,
						selector,
						{
							outputFormat: outputFormat as string,
							includeMetadata: includeMetadata as boolean
						},
						logger,
						nodeName,
						nodeId
					);
					break;
				}

				case 'value': {
					extractedData = await extractInputValue(page, selector, logger, nodeName, nodeId);
					break;
				}

				case 'attribute': {
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
				}

				case 'table': {
					extractedData = await extractTableData(
						page,
						selector,
						{
							includeHeaders,
							rowSelector,
							cellSelector,
							outputFormat: outputFormat as string
						},
						logger,
						nodeName,
						nodeId
					);
					break;
				}

				case 'multiple': {
					extractedData = await extractMultipleElements(
						page,
						selector,
						{
							attributeName: attributeName || '',
							extractionProperty,
							limit,
							outputFormat: outputFormat as string,
							separator
						},
						logger,
						nodeName,
						nodeId
					);
					break;
				}

				default:
					throw new Error(`Unknown extraction type: ${extractionType}`);
			}

			// Format extracted data for logging
			const truncatedData = formatExtractedDataForLog(extractedData, extractionType);
			logger.info(formatOperationLog('ExtractionMiddleware', nodeName, nodeId, index,
				`Extraction successful: ${truncatedData}`));

			// Build and return the result
			return {
				success: true,
				data: extractedData,
				selector,
				extractionType,
				details: {
					...extractionType === 'attribute' ? { attributeName } : {},
					...extractionType === 'html' ? { outputFormat, includeMetadata } : {},
					...extractionType === 'table' ? { rowSelector, cellSelector, includeHeaders, outputFormat } : {},
					...extractionType === 'multiple' ? {
						extractionProperty,
						limit,
						outputFormat,
						separator,
						...attributeName ? { attributeName } : {}
					} : {}
				}
			};
		} catch (error) {
			logger.error(formatOperationLog('ExtractionMiddleware', nodeName, nodeId, index,
				`Extraction failed: ${(error as Error).message}`));

			return {
				success: false,
				data: null,
				selector,
				extractionType,
				error: error as Error
			};
		}
	}
}

/**
 * Legacy function for backward compatibility
 * @deprecated Use the ExtractionMiddleware class instead
 */
export async function executeExtraction(
	page: puppeteer.Page,
	options: IExtractOptions,
	logger: ILogger
): Promise<IExtractResult> {
	const middleware = new ExtractionMiddleware();
	const context: IMiddlewareContext = {
		logger,
		nodeName: options.nodeName,
		nodeId: options.nodeId,
		sessionId: '',
		index: options.index,
	};

	return middleware.execute({ page, options }, context);
}
