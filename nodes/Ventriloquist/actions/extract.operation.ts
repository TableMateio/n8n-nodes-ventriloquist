import type {
	IExecuteFunctions,
	IDataObject,
	INodeExecutionData,
	INodeProperties,
} from 'n8n-workflow';
import type * as puppeteer from 'puppeteer-core';
import { SessionManager } from '../utils/sessionManager';
import {
	formatExtractedDataForLog,
	getHumanDelay,
	extractTextContent,
	extractHtmlContent,
	extractInputValue,
	extractAttributeValue,
	extractTableData,
	extractMultipleElements,
	getPageInfo,
} from '../utils/extractionUtils';
import { formatOperationLog, createSuccessResponse, createTimingLog } from '../utils/resultUtils';
import { createErrorResponse } from '../utils/errorUtils';

/**
 * Extended PageInfo interface with bodyText
 */
interface PageInfo {
	url: string;
	title: string;
	bodyText: string;
}

/**
 * Extract operation description
 */
export const description: INodeProperties[] = [
	{
		displayName: 'Session ID',
		name: 'explicitSessionId',
		type: 'string',
		default: '',
		description: 'Session ID to use (leave empty to use ID from input or create new)',
		displayOptions: {
			show: {
				operation: ['extract'],
			},
		},
	},
	{
		displayName: 'Extraction Type',
		name: 'extractionType',
		type: 'options',
		options: [
			{
				name: 'Attribute',
				value: 'attribute',
				description: 'Extract specific attribute from an element',
			},
			{
				name: 'HTML',
				value: 'html',
				description: 'Extract HTML content from an element',
			},
			{
				name: 'Input Value',
				value: 'value',
				description: 'Extract value from input, select or textarea',
			},
			{
				name: 'Multiple Elements',
				value: 'multiple',
				description: 'Extract data from multiple elements matching a selector',
			},
			{
				name: 'Table',
				value: 'table',
				description: 'Extract data from a table',
			},
			{
				name: 'Text Content',
				value: 'text',
				description: 'Extract text content from an element',
			},
		],
		default: 'text',
		description: 'What type of data to extract from the page',
		displayOptions: {
			show: {
				operation: ['extract'],
			},
		},
	},
	{
		displayName: 'Selector',
		name: 'selector',
		type: 'string',
		default: '',
		placeholder: '#main-content, .result-title, table.data',
		description: 'CSS selector to target the element. Use "#ID" for IDs, ".class" for classes, "tag" for HTML elements, or "tag[attr=value]" for attributes.',
		required: true,
		displayOptions: {
			show: {
				operation: ['extract'],
			},
		},
	},
	{
		displayName: 'Wait For Selector',
		name: 'waitForSelector',
		type: 'boolean',
		default: true,
		description: 'Whether to wait for the selector to appear in page',
		displayOptions: {
			show: {
				operation: ['extract'],
			},
		},
	},
	{
		displayName: 'Timeout',
		name: 'timeout',
		type: 'number',
		default: 30000,
		description: 'Maximum time to wait for the selector in milliseconds',
		displayOptions: {
			show: {
				operation: ['extract'],
				waitForSelector: [true],
			},
		},
	},
	{
		displayName: 'Debug Page Content',
		name: 'debugPageContent',
		type: 'boolean',
		default: false,
		description: 'Whether to include page information in debug logs',
		displayOptions: {
			show: {
				operation: ['extract'],
			},
		},
	},
	{
		displayName: 'Attribute Name',
		name: 'attributeName',
		type: 'string',
		default: '',
		placeholder: 'href, src, data-ID',
		description: 'Name of the attribute to extract from the element',
		displayOptions: {
			show: {
				operation: ['extract'],
				extractionType: ['attribute'],
			},
		},
		required: true,
	},
	{
		displayName: 'HTML Options',
		name: 'htmlOptions',
		type: 'collection',
		placeholder: 'Add Option',
		default: {},
		typeOptions: {
			multipleValues: false,
		},
		displayOptions: {
			show: {
				operation: ['extract'],
				extractionType: ['html'],
			},
		},
		options: [
			{
				displayName: 'Output Format',
				name: 'outputFormat',
				type: 'options',
				options: [
					{
						name: 'HTML (String)',
						value: 'html',
						description: 'Return the HTML as a raw string',
					},
					{
						name: 'JSON',
						value: 'json',
						description: 'Return the HTML wrapped in a JSON object',
					},
				],
				default: 'html',
				description: 'Format of the output data',
			},
			{
				displayName: 'Include Metadata',
				name: 'includeMetadata',
				type: 'boolean',
				default: false,
				description: 'Whether to include metadata about the HTML (length, structure info)',
			},
		],
	},
	{
		displayName: 'Table Options',
		name: 'tableOptions',
		type: 'collection',
		placeholder: 'Add Option',
		default: {},
		typeOptions: {
			multipleValues: false,
		},
		displayOptions: {
			show: {
				operation: ['extract'],
				extractionType: ['table'],
			},
		},
		options: [
			{
				displayName: 'Include Headers',
				name: 'includeHeaders',
				type: 'boolean',
				default: true,
				description: 'Whether to use the first row as headers in the output',
			},
			{
				displayName: 'Row Selector',
				name: 'rowSelector',
				type: 'string',
				default: 'tr',
				description: 'CSS selector for table rows relative to table selector (default: tr)',
			},
			{
				displayName: 'Cell Selector',
				name: 'cellSelector',
				type: 'string',
				default: 'td, th',
				description: 'CSS selector for table cells relative to row selector (default: td, th)',
			},
			{
				displayName: 'Output Format',
				name: 'outputFormat',
				type: 'options',
				options: [
					{
						name: 'JSON Objects',
						value: 'json',
						description: 'Return table as array of JSON objects using headers as keys',
					},
					{
						name: 'Array of Arrays',
						value: 'array',
						description: 'Return table as a simple array of arrays (rows and cells)',
					},
					{
						name: 'HTML',
						value: 'html',
						description: 'Return the original HTML of the table',
					},
					{
						name: 'CSV',
						value: 'csv',
						description: 'Return the table formatted as CSV text',
					},
				],
				default: 'json',
				description: 'Format of the extracted table data',
			},
		],
	},
	{
		displayName: 'Multiple Elements Options',
		name: 'multipleOptions',
		type: 'collection',
		placeholder: 'Add Option',
		default: {},
		typeOptions: {
			multipleValues: false,
		},
		displayOptions: {
			show: {
				operation: ['extract'],
				extractionType: ['multiple'],
			},
		},
		options: [
			{
				displayName: 'Extraction Property',
				name: 'extractionProperty',
				type: 'options',
				options: [
					{
						name: 'Text Content',
						value: 'textContent',
					},
					{
						name: 'Inner HTML',
						value: 'innerHTML',
					},
					{
						name: 'Outer HTML',
						value: 'outerHTML',
					},
					{
						name: 'Attribute',
						value: 'attribute',
					},
				],
				default: 'textContent',
				description: 'Property to extract from each matching element',
			},
			{
				displayName: 'Attribute Name',
				name: 'attributeName',
				type: 'string',
				default: '',
				description: 'Name of the attribute to extract (if Extraction Property is set to Attribute)',
				displayOptions: {
					show: {
						extractionProperty: ['attribute'],
					},
				},
			},
			{
				displayName: 'Limit',
				name: 'limit',
				type: 'number',
				default: 50,
				description: 'Max number of results to return',
				typeOptions: {
					minValue: 1,
				},
			},
			{
				displayName: 'Output Format',
				name: 'outputFormat',
				type: 'options',
				options: [
					{
						name: 'Array',
						value: 'array',
						description: 'Return results as a simple array',
					},
					{
						name: 'JSON Objects',
						value: 'json',
						description: 'Return results as array of objects with indices as keys',
					},
					{
						name: 'Concatenated String',
						value: 'string',
						description: 'Combine all results into one string with separator',
					},
				],
				default: 'array',
				description: 'Format of the extracted data',
			},
			{
				displayName: 'Separator',
				name: 'separator',
				type: 'string',
				default: ',',
				description: 'Separator to use when concatenating results (if Output Format is String)',
				displayOptions: {
					show: {
						outputFormat: ['string'],
					},
				},
			},
		],
	},
	{
		displayName: 'Use Human-Like Delays',
		name: 'useHumanDelays',
		type: 'boolean',
		default: false,
		description: 'Whether to add a random delay before extraction to simulate human behavior',
		displayOptions: {
			show: {
				operation: ['extract'],
			},
		},
	},
	{
		displayName: 'Take Screenshot',
		name: 'takeScreenshot',
		type: 'boolean',
		default: false,
		description: 'Whether to capture a screenshot after extraction',
		displayOptions: {
			show: {
				operation: ['extract'],
			},
		},
	},
	{
		displayName: 'Continue On Fail',
		name: 'continueOnFail',
		type: 'boolean',
		default: true,
		description: 'Whether to continue execution even when extraction fails',
		displayOptions: {
			show: {
				operation: ['extract'],
			},
		},
	},
];

/**
 * Execute the extract operation
 */
export async function execute(
	this: IExecuteFunctions,
	index: number,
	websocketEndpoint: string,
	workflowId: string,
): Promise<INodeExecutionData> {
	const startTime = Date.now();
	const items = this.getInputData();
	let sessionId = '';
	let page: puppeteer.Page | null = null;

	// Added for better logging
	const nodeName = this.getNode().name;
	const nodeId = this.getNode().id;

	// Visual marker to clearly indicate a new node is starting
	this.logger.info('============ STARTING NODE EXECUTION ============');
	this.logger.info(formatOperationLog('Extract', nodeName, nodeId, index, 'Starting execution'));

	// Get the node and extract parameters
	const selector = this.getNodeParameter('selector', index) as string;
	const extractionType = this.getNodeParameter('extractionType', index) as string;
	const waitForSelector = this.getNodeParameter('waitForSelector', index, true) as boolean;
	const timeout = this.getNodeParameter('timeout', index, 30000) as number;
	const useHumanDelays = this.getNodeParameter('useHumanDelays', index, false) as boolean;
	const takeScreenshotOption = this.getNodeParameter('takeScreenshot', index, false) as boolean;
	const continueOnFail = this.getNodeParameter('continueOnFail', index, true) as boolean;
	const debugPageContent = this.getNodeParameter('debugPageContent', index, false) as boolean;
	const explicitSessionId = this.getNodeParameter('explicitSessionId', index, '') as string;

	this.logger.info(formatOperationLog('Extract', nodeName, nodeId, index,
		`Parameters: selector=${selector}, extractionType=${extractionType}, timeout=${timeout}ms`));

	try {
		// Use the centralized session management instead of duplicating code
		const sessionResult = await SessionManager.getOrCreatePageSession(this.logger, {
			explicitSessionId,
			websocketEndpoint,
			workflowId,
			operationName: 'Extract',
			nodeId,
			nodeName,
			index,
		});

		page = sessionResult.page;
		sessionId = sessionResult.sessionId;

		if (!page) {
			throw new Error('Failed to get or create a page');
		}

		this.logger.info(formatOperationLog('Extract', nodeName, nodeId, index,
			`Starting extraction operation with selector: ${selector}`));

		// Add a human-like delay if enabled
		if (useHumanDelays) {
			const delay = getHumanDelay();
			this.logger.info(formatOperationLog('Extract', nodeName, nodeId, index,
				`Adding human-like delay: ${delay}ms`));
			await new Promise(resolve => setTimeout(resolve, delay));
		}

		// Wait for the selector if needed
		if (waitForSelector) {
			this.logger.info(formatOperationLog('Extract', nodeName, nodeId, index,
				`Waiting for selector: ${selector} (timeout: ${timeout}ms)`));
			try {
				await page.waitForSelector(selector, { timeout });
				this.logger.info(formatOperationLog('Extract', nodeName, nodeId, index,
					`Selector found: ${selector}`));
			} catch (error) {
				this.logger.error(formatOperationLog('Extract', nodeName, nodeId, index,
					`Selector timeout: ${selector} after ${timeout}ms`));
				throw error;
			}
		}

		let extractedData: string | IDataObject | Array<string | IDataObject> = '';
		let extractionDetails: IDataObject = {};

		// Process different extraction types
		switch (extractionType) {
			case 'text': {
				// Extract text content using utility function
				extractedData = await extractTextContent(page, selector, this.logger, nodeName, nodeId);
				break;
			}

			case 'html': {
				// Get HTML options
				const htmlOptions = this.getNodeParameter('htmlOptions', index, {}) as IDataObject;
				const outputFormat = (htmlOptions.outputFormat as string) || 'html';
				const includeMetadata = htmlOptions.includeMetadata === true;

				// Extract HTML content using utility function
				extractedData = await extractHtmlContent(
					page,
					selector,
					{
						outputFormat,
						includeMetadata
					},
					this.logger,
					nodeName,
					nodeId
				);

				// Set extraction details
				if (outputFormat === 'json') {
					extractionDetails = {
						format: 'json',
					};
				}
				break;
			}

			case 'attribute': {
				// Get attribute name
				const attributeName = this.getNodeParameter('attributeName', index) as string;

				// Extract attribute value using utility function
				extractedData = await extractAttributeValue(page, selector, attributeName, this.logger, nodeName, nodeId);

				// Set extraction details
				extractionDetails = {
					attributeName,
				};
				break;
			}

			case 'value': {
				// Extract input value using utility function
				extractedData = await extractInputValue(page, selector, this.logger, nodeName, nodeId);
				break;
			}

			case 'table': {
				// Extract data from a table
				const tableOptions = this.getNodeParameter('tableOptions', index, {}) as IDataObject;
				const includeHeaders = tableOptions.includeHeaders !== false;
				const rowSelector = (tableOptions.rowSelector as string) || 'tr';
				const cellSelector = (tableOptions.cellSelector as string) || 'td, th';
				const outputFormat = (tableOptions.outputFormat as string) || 'json';

				// Extract table data using utility function
				extractedData = await extractTableData(
					page,
					selector,
					{
						includeHeaders,
						rowSelector,
						cellSelector,
						outputFormat,
					},
					this.logger,
					nodeName,
					nodeId
				) as string | IDataObject[];

				// Set extraction details
				extractionDetails = {
					rowSelector,
					cellSelector,
					includeHeaders,
					outputFormat,
				};
				break;
			}

			case 'multiple': {
				// Get multiple options
				const multipleOptions = this.getNodeParameter('multipleOptions', index, {}) as IDataObject;
				const extractionSubType = (multipleOptions.extractionSubType as string) || 'text';
				const extractionAttribute = (multipleOptions.extractionAttribute as string) || '';
				const outputLimit = (multipleOptions.outputLimit as number) || 0;
				const extractProperty = multipleOptions.extractProperty as boolean;
				const propertyKey = (multipleOptions.propertyKey as string) || 'value';

				// Extract from multiple elements
				extractedData = await extractMultipleElements(
					page,
					selector,
					{
						attributeName: extractionAttribute,
						extractionProperty: extractionSubType,
						limit: outputLimit,
						outputFormat: extractProperty ? 'object' : 'array',
						separator: propertyKey,
					},
					this.logger,
					nodeName,
					nodeId
				);

				// Set extraction details
				extractionDetails = {
					extractionSubType,
					limit: outputLimit,
					...(extractionSubType === 'attribute' ? { attributeName: extractionAttribute } : {}),
				};
				break;
			}

			default:
				throw new Error(`Unsupported extraction type: ${extractionType}`);
		}

		// Debug page content if enabled
		if (debugPageContent) {
			const pageInfo = await getPageInfo(page) as PageInfo;
			this.logger.info(formatOperationLog('Extract', nodeName, nodeId, index,
				`Page info: URL=${pageInfo.url}, title=${pageInfo.title}`));
			this.logger.info(formatOperationLog('Extract', nodeName, nodeId, index,
				`Page body preview: ${pageInfo.bodyText.substring(0, 200)}...`));
		}

		// Format the data for logging (avoid large outputs)
		const logSafeData = formatExtractedDataForLog(extractedData, extractionType);
		this.logger.info(formatOperationLog('Extract', nodeName, nodeId, index,
			`Extraction result (${extractionType}): ${logSafeData}`));

		// Log timing information
		createTimingLog('Extract', startTime, this.logger, nodeName, nodeId, index);

		// Create success response with the extracted data
		const successResponse = await createSuccessResponse({
			operation: 'extract',
			sessionId,
			page,
			logger: this.logger,
			startTime,
			takeScreenshot: takeScreenshotOption,
			additionalData: {
				extractionType,
				selector,
				data: extractedData,
				...extractionDetails,
			},
			inputData: items[index].json,
		});

		return { json: successResponse };
	} catch (error) {
		// Use the standardized error response utility
		const errorResponse = await createErrorResponse({
			error: error as Error,
			operation: 'extract',
			sessionId,
			nodeId,
			nodeName,
			selector,
			page,
			logger: this.logger,
			takeScreenshot: takeScreenshotOption,
			startTime,
			additionalData: {
				...items[index].json,
				extractionType,
			}
		});

		if (!continueOnFail) {
			throw error;
		}

		// Return error as response with continue on fail
		return {
			json: errorResponse
		};
	}
}




