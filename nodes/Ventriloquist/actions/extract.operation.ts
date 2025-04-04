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
	takePageScreenshot,
	getPageInfo,
} from '../utils/extractionUtils';

/**
 * Extract operation description
 */
export const description: INodeProperties[] = [
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
		displayName: 'Take Screenshot',
		name: 'takeScreenshot',
		type: 'boolean',
		default: false,
		description: 'Whether to take a screenshot of the page',
		displayOptions: {
			show: {
				operation: ['extract'],
			},
		},
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
		displayName: 'Continue On Fail',
		name: 'continueOnFail',
		type: 'boolean',
		default: true,
		description: 'Whether to continue execution even when the extraction fails (selector not found or timeout)',
		displayOptions: {
			show: {
				operation: ['extract'],
			},
		},
	},
	{
		displayName: 'Debug Page Content',
		name: 'debugPageContent',
		type: 'boolean',
		default: false,
		description: 'Whether to include debug information about page content when extraction fails (helpful for debugging)',
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
	explicitSessionId?: string,
): Promise<INodeExecutionData> {
	const startTime = Date.now();

	// Get the node and extract parameters
	const selector = this.getNodeParameter('selector', index) as string;
	const extractionType = this.getNodeParameter('extractionType', index) as string;
	const waitForSelector = this.getNodeParameter('waitForSelector', index, true) as boolean;
	const timeout = this.getNodeParameter('timeout', index, 30000) as number;
	const useHumanDelays = this.getNodeParameter('useHumanDelays', index, false) as boolean;
	const takeScreenshotOption = this.getNodeParameter('takeScreenshot', index, false) as boolean;
	const continueOnFail = this.getNodeParameter('continueOnFail', index, true) as boolean;
	const debugPageContent = this.getNodeParameter('debugPageContent', index, false) as boolean;

	// Added for better logging
	const nodeName = this.getNode().name;
	const nodeId = this.getNode().id;
	this.logger.info(`[Ventriloquist][${nodeName}][${nodeId}][Extract] ========== START EXTRACT NODE EXECUTION ==========`);
	this.logger.info(`[Ventriloquist][${nodeName}][${nodeId}][Extract] Parameters: selector=${selector}, extractionType=${extractionType}, timeout=${timeout}ms`);

	// Create page variable with appropriate type and default values
	let page: puppeteer.Page | undefined;
	let sessionId = ''; // Initialize with empty string

	try {
		// Check if an explicit session ID was provided to reuse
		if (explicitSessionId) {
			this.logger.info(`[Ventriloquist][${nodeName}][${nodeId}][Extract] Looking for explicitly provided session ID: ${explicitSessionId}`);

			try {
				// Use SessionManager to get the page
				page = SessionManager.getPage(explicitSessionId);

				if (page) {
					sessionId = explicitSessionId;
					this.logger.info(`[Ventriloquist][${nodeName}][${nodeId}][Extract] Found existing page with explicit session ID: ${sessionId}`);
				} else {
					this.logger.warn(`[Ventriloquist][${nodeName}][${nodeId}][Extract] Provided session ID ${explicitSessionId} not found, will create a new session`);
				}
			} catch (error) {
				this.logger.warn(`[Ventriloquist][${nodeName}][${nodeId}][Extract] Error retrieving page with session ID ${explicitSessionId}: ${(error as Error).message}`);
			}
		}

		// If no page is found yet, get or create a session
		if (!page) {
			// Get WebSocket URL from credentials
			const credentials = await this.getCredentials('browserlessApi');
			const actualWebsocketEndpoint = SessionManager.getWebSocketUrlFromCredentials(
				this.logger,
				'browserlessApi',
				credentials
			);

			try {
				// Create a new session
				const sessionResult = await SessionManager.createSession(
					this.logger,
					actualWebsocketEndpoint,
					{
						forceNew: false, // Don't force a new session - reuse existing
						credentialType: 'browserlessApi',
					}
				);

				// Store session details
				const browser = sessionResult.browser;
				sessionId = sessionResult.sessionId;

				// Try to get existing page or create a new one
				const pages = await browser.pages();
				if (pages.length > 0) {
					// Use the first available page
					page = pages[0];
					this.logger.info(`[Ventriloquist][${nodeName}][${nodeId}][Extract] Using existing page from browser session`);
				} else {
					// Create a new page
					page = await browser.newPage();
					this.logger.info(`[Ventriloquist][${nodeName}][${nodeId}][Extract] Created new page with session ID: ${sessionId}`);

					// Navigate to a blank page to initialize it
					await page.goto('about:blank');
				}

				// Store the page for future operations
				SessionManager.storePage(sessionId, `page_${Date.now()}`, page);
			} catch (error) {
				this.logger.error(`[Ventriloquist][${nodeName}][${nodeId}][Extract] Failed to create session: ${(error as Error).message}`);
				throw new Error(`Failed to create session: ${(error as Error).message}`);
			}
		}

		// At this point we must have a page - add a final check
		if (!page) {
			throw new Error('Failed to get or create a valid page');
		}

		this.logger.info(`[Ventriloquist][${nodeName}][${nodeId}][Extract] Starting extraction operation with selector: ${selector}`);

		// Add a human-like delay if enabled
		if (useHumanDelays) {
			const delay = getHumanDelay();
			this.logger.info(`[Ventriloquist][${nodeName}][${nodeId}][Extract] Adding human-like delay: ${delay}ms`);
			await new Promise(resolve => setTimeout(resolve, delay));
		}

		// Wait for the selector if needed
		if (waitForSelector) {
			this.logger.info(`[Ventriloquist][${nodeName}][${nodeId}][Extract] Waiting for selector: ${selector} (timeout: ${timeout}ms)`);
			try {
				await page.waitForSelector(selector, { timeout });
				this.logger.info(`[Ventriloquist][${nodeName}][${nodeId}][Extract] Selector found: ${selector}`);
			} catch (error) {
				this.logger.error(`[Ventriloquist][${nodeName}][${nodeId}][Extract] Selector timeout: ${selector} after ${timeout}ms`);
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
				const tableData = await extractTableData(
					page,
					selector,
					{
						includeHeaders,
						rowSelector,
						cellSelector,
						outputFormat
					},
					this.logger,
					nodeName,
					nodeId
				);

				if (typeof tableData === 'string') {
					extractedData = tableData;
				} else if (Array.isArray(tableData)) {
					if (tableData.length > 0 && Array.isArray(tableData[0])) {
						// Handle string[][] case by converting to IDataObject[]
						const processedData = tableData.map(row => {
							if (Array.isArray(row)) {
								// Convert string[] to IDataObject with numeric indexes
								const rowObj: IDataObject = {};
								row.forEach((cell, i) => {
									rowObj[i.toString()] = cell;
								});
								return rowObj;
							}
							return row;
						});
						extractedData = processedData;
					} else {
						extractedData = tableData as IDataObject[];
					}
				}

				// Set extraction details
				extractionDetails = {
					rowCount: Array.isArray(tableData) ? tableData.length : 0,
					format: outputFormat,
				};

				const truncatedTable = formatExtractedDataForLog(extractedData, 'table');
				const rowCount = extractionDetails.rowCount || 0;
				this.logger.info(`[Ventriloquist][${nodeName}][${nodeId}][Extract] Extracted table data (${rowCount} rows): ${truncatedTable}`);
				break;
			}

			case 'multiple': {
				// Extract data from multiple elements
				const multipleOptions = this.getNodeParameter('multipleOptions', index, {}) as IDataObject;
				const extractionProperty = (multipleOptions.extractionProperty as string) || 'textContent';
				const attributeName = (multipleOptions.attributeName as string) || '';
				const limit = (multipleOptions.limit as number) || 50;
				const outputFormat = (multipleOptions.outputFormat as string) || 'array';
				const separator = (multipleOptions.separator as string) || ',';

				// Extract data from multiple elements using utility function
				extractedData = await extractMultipleElements(
					page,
					selector,
					{
						attributeName,
						extractionProperty,
						limit,
						outputFormat,
						separator
					},
					this.logger,
					nodeName,
					nodeId
				);

				// Set extraction details
				extractionDetails = {
					matchCount: Array.isArray(extractedData) ? extractedData.length : 0,
					extractionProperty,
					outputFormat,
					...(extractionProperty === 'attribute' ? { attributeName } : {}),
				};

				const truncatedMultiple = formatExtractedDataForLog(extractedData, 'multiple');
				const elementCount = extractionDetails.matchCount || 0;
				this.logger.info(`[Ventriloquist][${nodeName}][${nodeId}][Extract] Extracted ${elementCount} elements: ${truncatedMultiple}`);
				break;
			}
		}

		// Get current page info using utility function
		const { url: currentUrl, title: pageTitle } = await getPageInfo(page);

		// Ensure the page is properly stored again after extraction
		SessionManager.storePage(sessionId, `page_${Date.now()}`, page);
		this.logger.info(`[Ventriloquist][${nodeName}][${nodeId}][Extract] Updated page reference in session store after extraction (URL: ${currentUrl})`);

		// Take a screenshot if requested using utility function
		let screenshot = '';
		if (takeScreenshotOption) {
			screenshot = await takePageScreenshot(page, this.logger, nodeName, nodeId);
		}

		// Include debug page content if requested
		let htmlContent = '';
		if (debugPageContent) {
			htmlContent = await page.content();
			this.logger.debug(`[Ventriloquist][${nodeName}][${nodeId}][Extract] Captured page HTML (${htmlContent.length} bytes)`);
		}

		const executionDuration = Date.now() - startTime;
		this.logger.info(`[Ventriloquist][${nodeName}][${nodeId}][Extract] Extraction completed in ${executionDuration}ms`);
		this.logger.info(`[Ventriloquist][${nodeName}][${nodeId}][Extract] ========== END EXTRACT NODE EXECUTION ==========`);

		// Create the output object
		const result: IDataObject = {
			success: true,
			operation: 'extract',
			selector,
			extractionType,
			extractedData,
			url: currentUrl,
			title: pageTitle,
			timestamp: new Date().toISOString(),
			sessionId,
			executionDuration,
		};

		// Only include screenshot if it was taken
		if (screenshot) {
			result.screenshot = screenshot;
		}

		// Include HTML content if debug was enabled
		if (htmlContent) {
			result.htmlContent = htmlContent;
		}

		// Include extraction details if any were collected
		if (Object.keys(extractionDetails).length > 0) {
			result.details = extractionDetails;
		}

		return {
			json: result,
		};
	} catch (error) {
		// Handle errors
		this.logger.error(`[Ventriloquist][${nodeName}][${nodeId}][Extract] Extract operation error: ${(error as Error).message}`);

		// Take error screenshot if requested
		let errorScreenshot = '';
		if (takeScreenshotOption && page) {
			try {
				errorScreenshot = await takePageScreenshot(page, this.logger, nodeName, nodeId);
			} catch (screenshotError) {
				this.logger.warn(`[Ventriloquist][${nodeName}][${nodeId}][Extract] Failed to capture error screenshot: ${(screenshotError as Error).message}`);
			}
		}

		// Get some page info if available
		let currentUrl = 'unknown';
		let pageTitle = 'unknown';
		try {
			if (page) {
				const pageInfo = await getPageInfo(page);
				currentUrl = pageInfo.url;
				pageTitle = pageInfo.title;
			}
		} catch (pageInfoError) {
			this.logger.warn(`[Ventriloquist][${nodeName}][${nodeId}][Extract] Failed to get page info: ${(pageInfoError as Error).message}`);
		}

		const executionDuration = Date.now() - startTime;
		this.logger.info(`[Ventriloquist][${nodeName}][${nodeId}][Extract] ========== END EXTRACT NODE EXECUTION (WITH ERROR) ==========`);

		if (continueOnFail) {
			// Return error information in the output
			const result: IDataObject = {
				success: false,
				operation: 'extract',
				selector,
				error: (error as Error).message,
				url: currentUrl,
				title: pageTitle,
				timestamp: new Date().toISOString(),
				sessionId: sessionId || 'unknown',
				executionDuration,
			};

			// Include error screenshot if available
			if (errorScreenshot) {
				result.screenshot = errorScreenshot;
			}

			return {
				json: result,
			};
		}

		// Re-throw the error if we should not continue on failure
		throw error;
	}
}
