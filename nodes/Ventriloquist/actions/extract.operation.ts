import type {
	IExecuteFunctions,
	IDataObject,
	INodeExecutionData,
	INodeProperties,
} from 'n8n-workflow';
import { Ventriloquist } from '../Ventriloquist.node';
import type * as puppeteer from 'puppeteer-core';

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
 * Get a random human-like delay between 300-800ms (faster than before)
 */
function getHumanDelay(): number {
	return Math.floor(Math.random() * (800 - 300 + 1) + 300);
}

/**
 * Helper function to format extracted data for logging
 * Truncates the data to make it more log-friendly
 */
function formatExtractedDataForLog(data: any, extractionType: string): string {
	if (data === null || data === undefined) {
		return 'null';
	}

	const truncateLength = 100; // Maximum string length to show in logs
	const truncateMessage = '... (truncated)';

	if (typeof data === 'string') {
		// For string data, truncate if too long
		if (data.length > truncateLength) {
			return `"${data.substring(0, truncateLength)}${truncateMessage}" (${data.length} chars)`;
		}
		return `"${data}"`;
	} else if (Array.isArray(data)) {
		// For arrays, summarize content
		const itemCount = data.length;
		if (itemCount === 0) {
			return '[] (empty array)';
		}

		// Sample a few items from the array
		const sampleSize = Math.min(3, itemCount);
		const sample = data.slice(0, sampleSize).map(item => {
			if (typeof item === 'string') {
				return item.length > 20 ? `"${item.substring(0, 20)}..."` : `"${item}"`;
			} else if (typeof item === 'object') {
				return '[object]';
			}
			return String(item);
		});

		return `[${sample.join(', ')}${itemCount > sampleSize ? `, ... (${itemCount - sampleSize} more)` : ''}]`;
	} else if (typeof data === 'object') {
		// For objects, show a sample of keys and values
		if (data === null) {
			return 'null';
		}

		if (extractionType === 'table') {
			// Special handling for table data
			const rowCount = Array.isArray(data) ? data.length : Object.prototype.hasOwnProperty.call(data, 'rowCount') ? data.rowCount : 'unknown';
			return `[Table data: ${rowCount} row(s)]`;
		}

		// For other objects, sample a few properties
		const keys = Object.keys(data);
		if (keys.length === 0) {
			return '{} (empty object)';
		}

		// Only show a few keys
		const sampleSize = Math.min(3, keys.length);
		const sample = keys.slice(0, sampleSize).map(key => {
			const value = data[key];

			// Format the value based on its type
			let valueStr;
			if (typeof value === 'string') {
				valueStr = value.length > 15 ? `"${value.substring(0, 15)}..."` : `"${value}"`;
			} else if (typeof value === 'object') {
				valueStr = '[object]';
			} else {
				valueStr = String(value);
			}

			return `${key}: ${valueStr}`;
		});

		return `{${sample.join(', ')}${keys.length > sampleSize ? `, ... (${keys.length - sampleSize} more)` : ''}}`;
	}

	// For other data types, convert to string
	return String(data);
}

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
	// Get parameters for the extract operation
	const selector = this.getNodeParameter('selector', index) as string;
	const extractionType = this.getNodeParameter('extractionType', index) as string;
	const waitForSelector = this.getNodeParameter('waitForSelector', index, true) as boolean;
	const timeout = this.getNodeParameter('timeout', index, 30000) as number;
	const takeScreenshot = this.getNodeParameter('takeScreenshot', index, false) as boolean;
	const useHumanDelays = this.getNodeParameter('useHumanDelays', index, false) as boolean;
	const continueOnFail = this.getNodeParameter('continueOnFail', index, true) as boolean;
	const debugPageContent = this.getNodeParameter('debugPageContent', index, false) as boolean;

	// Added for better logging
	const nodeName = this.getNode().name;
	const nodeId = this.getNode().id;
	this.logger.info(`[Ventriloquist][${nodeName}][${nodeId}][Extract] ========== START EXTRACT NODE EXECUTION ==========`);
	this.logger.info(`[Ventriloquist][${nodeName}][${nodeId}][Extract] Parameters: selector=${selector}, extractionType=${extractionType}, timeout=${timeout}ms`);

	// Get or create browser session
	let page: puppeteer.Page;
	let sessionId: string;

	try {
		// Create a session or reuse an existing one
		const { browser, sessionId: newSessionId } = await Ventriloquist.getOrCreateSession(
			workflowId,
			websocketEndpoint,
			this.logger,
			undefined,
		);

		// Try to get any existing page from the browser
		const pages = await browser.pages();

		if (pages.length > 0) {
			// Use the first available page
			page = pages[0];
			sessionId = `existing_${Date.now()}`;
			this.logger.info(`[Ventriloquist][${nodeName}][${nodeId}][Extract] Using existing page from browser session`);
		} else {
			// Create a new page if none exists
			page = await browser.newPage();
			sessionId = newSessionId;
			this.logger.info(`[Ventriloquist][${nodeName}][${nodeId}][Extract] Created new page with session ID: ${sessionId}`);

			// Store the new page for future operations
			Ventriloquist.storePage(workflowId, sessionId, page);

			// Navigate to a blank page to initialize it
			await page.goto('about:blank');
		}
	} catch (error) {
		this.logger.error(`[Ventriloquist][${nodeName}][${nodeId}][Extract] Failed to get or create a page: ${(error as Error).message}`);
		this.logger.info(`[Ventriloquist][${nodeName}][${nodeId}][Extract] ========== END EXTRACT NODE EXECUTION (SESSION ERROR) ==========`);
		throw new Error(`Failed to get or create a page: ${(error as Error).message}`);
	}

	try {
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

		// Ensure the page is properly stored in the session registry
		Ventriloquist.storePage(workflowId, sessionId, page);
		this.logger.info(`[Ventriloquist][${nodeName}][${nodeId}][Extract] Ensured page reference in session store before extraction`);

		let extractedData: IDataObject | string | Array<string | IDataObject> = '';
		let extractionDetails: IDataObject = {};

		// Process different extraction types
		switch (extractionType) {
			case 'text': {
				// Extract text content
				extractedData = await page.$eval(selector, (el) => el.textContent?.trim() || '');
				const truncatedData = formatExtractedDataForLog(extractedData, 'text');
				this.logger.info(`[Ventriloquist][${nodeName}][${nodeId}][Extract] Extracted text content: ${truncatedData}`);
				break;
			}

			case 'html': {
				// Get HTML options
				const htmlOptions = this.getNodeParameter('htmlOptions', index, {}) as IDataObject;
				const outputFormat = (htmlOptions.outputFormat as string) || 'html';
				const includeMetadata = htmlOptions.includeMetadata === true;

				// Extract HTML content (inner HTML)
				const htmlContent = await page.$eval(selector, (el) => el.innerHTML);

				if (outputFormat === 'html') {
					// Return as raw HTML string
					extractedData = htmlContent;
				} else {
					// Return as JSON object
					extractedData = { html: htmlContent };
				}

				// Add metadata if requested
				if (includeMetadata) {
					// Calculate some basic metadata about the HTML
					const elementCount = await page.$eval(selector, (el) => el.querySelectorAll('*').length);
					const imageCount = await page.$eval(selector, (el) => el.querySelectorAll('img').length);
					const linkCount = await page.$eval(selector, (el) => el.querySelectorAll('a').length);

					extractionDetails = {
						htmlLength: htmlContent.length,
						elementCount,
						imageCount,
						linkCount,
					};
				} else {
					extractionDetails = { htmlLength: htmlContent.length };
				}

				const truncatedHtml = formatExtractedDataForLog(outputFormat === 'html' ? htmlContent : extractedData, 'html');
				this.logger.info(`[Ventriloquist][${nodeName}][${nodeId}][Extract] Extracted HTML (${htmlContent.length} bytes): ${truncatedHtml}`);
				break;
			}

			case 'attribute': {
				// Extract an attribute from an element
				const attributeName = this.getNodeParameter('attributeName', index) as string;
				extractedData = await page.$eval(
					selector,
					(el, attr) => el.getAttribute(attr) || '',
					attributeName
				);
				extractionDetails = { attributeName };

				const truncatedAttr = formatExtractedDataForLog(extractedData, 'attribute');
				this.logger.info(`[Ventriloquist][${nodeName}][${nodeId}][Extract] Extracted attribute "${attributeName}": ${truncatedAttr}`);
				break;
			}

			case 'value': {
				// Extract value from input, select, or textarea
				extractedData = await page.$eval(selector, (el) => {
					if (el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement || el instanceof HTMLSelectElement) {
						return el.value;
					}
					return '';
				});

				const truncatedValue = formatExtractedDataForLog(extractedData, 'value');
				this.logger.info(`[Ventriloquist][${nodeName}][${nodeId}][Extract] Extracted input value: ${truncatedValue}`);
				break;
			}

			case 'table': {
				// Extract data from a table
				const tableOptions = this.getNodeParameter('tableOptions', index, {}) as IDataObject;
				const includeHeaders = tableOptions.includeHeaders !== false;
				const rowSelector = (tableOptions.rowSelector as string) || 'tr';
				const cellSelector = (tableOptions.cellSelector as string) || 'td, th';
				const outputFormat = (tableOptions.outputFormat as string) || 'json';

				// Handle different output formats
				if (outputFormat === 'html') {
					// Extract original table HTML
					extractedData = await page.$eval(selector, (el) => el.outerHTML);
					extractionDetails = {
						format: 'html',
					};
				} else {
					// Extract the table data as arrays first
					const tableData = await page.$$eval(
						`${selector} ${rowSelector}`,
						(rows, options) => {
							const { cellSelector } = options as {
								cellSelector: string;
							};

							// Extract all rows
							const extractedRows = Array.from(rows).map((row) => {
								const cells = Array.from(row.querySelectorAll(cellSelector));
								return cells.map((cell) => cell.textContent?.trim() || '');
							});

							return extractedRows;
						},
						{ cellSelector, includeHeaders }
					);

					if (tableData.length === 0) {
						extractedData = [];
					} else if (outputFormat === 'json' && includeHeaders && tableData.length > 1) {
						// Convert to array of objects using first row as keys
						const headers = tableData[0];
						const jsonData = tableData.slice(1).map((row) => {
							const obj: IDataObject = {};
							headers.forEach((header, i) => {
								if (header && i < row.length) {
									obj[header] = row[i];
								}
							});
							return obj;
						});
						extractedData = jsonData;
					} else if (outputFormat === 'csv') {
						// Convert to CSV string
						const csvRows = tableData.map(row => row.join(','));
						extractedData = csvRows.join('\n');
					} else {
						// Return as array of arrays (ensure it's properly typed)
						extractedData = includeHeaders ? tableData as unknown as IDataObject[] : tableData.slice(1) as unknown as IDataObject[];
					}

					extractionDetails = {
						rowCount: Array.isArray(tableData) ? tableData.length : 0,
						format: outputFormat,
					};
				}

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

				// Extract data from all matching elements
				const elementsData = await page.$$eval(
					selector,
					(elements, options) => {
						const { extractionProperty, attributeName, limit } = options as {
							extractionProperty: string;
							attributeName: string;
							limit: number;
						};

						// Apply limit if specified
						const limitedElements = limit > 0 ? elements.slice(0, limit) : elements;

						// Extract the specified property from each element
						return limitedElements.map((el) => {
							switch (extractionProperty) {
								case 'textContent':
									return el.textContent?.trim() || '';
								case 'innerHTML':
									return el.innerHTML;
								case 'outerHTML':
									return el.outerHTML;
								case 'attribute':
									return el.getAttribute(attributeName) || '';
								default:
									return el.textContent?.trim() || '';
							}
						});
					},
					{ extractionProperty, attributeName, limit }
				);

				if (outputFormat === 'json') {
					// Convert to array of objects with indices as keys
					extractedData = elementsData.map((value, index) => ({
						index,
						value,
					}));
				} else if (outputFormat === 'string') {
					// Join all elements into one string with the specified separator
					extractedData = elementsData.join(separator);
				} else {
					// Default array format
					extractedData = elementsData;
				}

				extractionDetails = {
					matchCount: Array.isArray(elementsData) ? elementsData.length : 0,
					extractionProperty,
					outputFormat,
					...(extractionProperty === 'attribute' ? { attributeName } : {}),
				};

				const truncatedMultiple = formatExtractedDataForLog(extractedData, 'multiple');
				const elementCount = Array.isArray(elementsData) ? elementsData.length : 0;
				this.logger.info(`[Ventriloquist][${nodeName}][${nodeId}][Extract] Extracted ${elementCount} elements: ${truncatedMultiple}`);
				break;
			}
		}

		// Get current page info
		const currentUrl = page.url();
		const pageTitle = await page.title();

		// Ensure the page is properly stored again after extraction
		Ventriloquist.storePage(workflowId, sessionId, page);
		this.logger.info(`[Ventriloquist][${nodeName}][${nodeId}][Extract] Updated page reference in session store after extraction (URL: ${currentUrl})`);

		// Take a screenshot if requested
		let screenshot = '';
		if (takeScreenshot) {
			const screenshotBuffer = await page.screenshot({
				encoding: 'base64',
				type: 'jpeg',
				quality: 80,
			});

			screenshot = `data:image/jpeg;base64,${screenshotBuffer}`;
			this.logger.debug(`[Ventriloquist][${nodeName}][${nodeId}][Extract] Captured screenshot during extraction`);
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
		if (takeScreenshot && page) {
			try {
				const screenshotBuffer = await page.screenshot({
					encoding: 'base64',
					type: 'jpeg',
					quality: 80,
				});

				errorScreenshot = `data:image/jpeg;base64,${screenshotBuffer}`;
				this.logger.debug(`[Ventriloquist][${nodeName}][${nodeId}][Extract] Captured error screenshot`);
			} catch (screenshotError) {
				this.logger.warn(`[Ventriloquist][${nodeName}][${nodeId}][Extract] Failed to capture error screenshot: ${(screenshotError as Error).message}`);
			}
		}

		// Get some page info if available
		let currentUrl = 'unknown';
		let pageTitle = 'unknown';
		try {
			if (page) {
				currentUrl = page.url();
				pageTitle = await page.title();
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
